import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import type { Session, HookPayload, ServerMessage, InternalSession, ToolCall, InternalToolCall } from "./types.js";
import { SESSION_TIMEOUT_MS, USER_INPUT_TOOLS } from "./types.js";

type StateChangeCallback = (message: ServerMessage) => void;

// Persistence configuration
const DATA_DIR = path.join(homedir(), ".claude-blocker");
const DATA_FILE = path.join(DATA_DIR, "sessions.json");
const HISTORY_MAX_DAYS = 7;

interface PersistedData {
  version: number;
  history: HistoricalSession[];
  lastSaved: string;
}

interface HistoricalSession {
  id: string;
  projectName: string;
  initialCwd?: string; // Original project directory
  cwd?: string; // Current directory at session end
  startTime: string;
  endTime: string;
  lastTool?: string;
  toolCount: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

// Derive project name from cwd or use truncated session ID
function getProjectName(cwd?: string, sessionId?: string): string {
  if (cwd) {
    return path.basename(cwd);
  }
  if (sessionId) {
    return sessionId.substring(0, 8);
  }
  return "Unknown";
}

// Load persisted data from disk
function loadPersistedData(): PersistedData {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = readFileSync(DATA_FILE, "utf-8");
      const data = JSON.parse(raw) as PersistedData;
      // Clean up old history entries
      const cutoff = Date.now() - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
      data.history = data.history.filter((h) => new Date(h.endTime).getTime() > cutoff);
      return data;
    }
  } catch (err) {
    console.error("Failed to load persisted data:", err);
  }
  return { version: 1, history: [], lastSaved: new Date().toISOString() };
}

// Save data to disk
function savePersistedData(data: PersistedData): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    data.lastSaved = new Date().toISOString();
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save persisted data:", err);
  }
}

// Convert internal tool call to shared ToolCall format
function toToolCall(internal: InternalToolCall): ToolCall {
  const toolCall: ToolCall = {
    name: internal.name,
    timestamp: internal.timestamp.toISOString(),
  };

  // Extract only the relevant input fields
  if (internal.input) {
    const input: ToolCall["input"] = {};
    if (typeof internal.input.file_path === "string") input.file_path = internal.input.file_path;
    if (typeof internal.input.command === "string") input.command = internal.input.command;
    if (typeof internal.input.pattern === "string") input.pattern = internal.input.pattern;
    if (typeof internal.input.description === "string") input.description = internal.input.description;
    if (Object.keys(input).length > 0) toolCall.input = input;
  }

  return toolCall;
}

// Convert internal session (with Date objects) to shared Session (with ISO strings)
function toSession(internal: InternalSession): Session {
  return {
    id: internal.id,
    status: internal.status,
    projectName: internal.projectName,
    initialCwd: internal.initialCwd,
    cwd: internal.cwd,
    startTime: internal.startTime.toISOString(),
    lastActivity: internal.lastActivity.toISOString(),
    lastTool: internal.lastTool,
    toolCount: internal.toolCount,
    recentTools: internal.recentTools.map(toToolCall),
    waitingForInputSince: internal.waitingForInputSince?.toISOString(),
    inputTokens: internal.inputTokens,
    outputTokens: internal.outputTokens,
    totalTokens: internal.totalTokens,
    costUsd: internal.costUsd,
  };
}

class SessionState {
  private sessions: Map<string, InternalSession> = new Map();
  private listeners: Set<StateChangeCallback> = new Set();
  // Track first-seen cwd for each session ID to preserve original project directory
  private sessionInitialCwds: Map<string, string> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private persistedData: PersistedData;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Load persisted data on startup
    this.persistedData = loadPersistedData();
    console.log(`Loaded ${this.persistedData.history.length} historical sessions`);

    // Start cleanup interval for stale sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 30_000); // Check every 30 seconds
  }

  // Debounced save to avoid too frequent disk writes
  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      savePersistedData(this.persistedData);
    }, 5000); // Save after 5 seconds of inactivity
  }

  // Add a session to history when it ends
  private addToHistory(session: InternalSession): void {
    const now = new Date();
    const historicalSession: HistoricalSession = {
      id: session.id,
      projectName: session.projectName,
      initialCwd: session.initialCwd,
      cwd: session.cwd,
      startTime: session.startTime.toISOString(),
      endTime: now.toISOString(),
      lastTool: session.lastTool,
      toolCount: session.toolCount,
      totalDurationMs: now.getTime() - session.startTime.getTime(),
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      totalTokens: session.totalTokens,
      costUsd: session.costUsd,
    };

    // Add to beginning of history
    this.persistedData.history.unshift(historicalSession);

    // Keep only last 7 days
    const cutoff = Date.now() - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
    this.persistedData.history = this.persistedData.history.filter(
      (h) => new Date(h.endTime).getTime() > cutoff
    );

    this.scheduleSave();
    console.log(`Session added to history: ${session.projectName}`);
  }

  // Get session history
  getHistory(): HistoricalSession[] {
    return this.persistedData.history;
  }

  subscribe(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    // Immediately send current state to new subscriber
    callback(this.getStateMessage());
    return () => this.listeners.delete(callback);
  }

  private broadcast(): void {
    const message = this.getStateMessage();
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private getStateMessage(): ServerMessage {
    const internalSessions = Array.from(this.sessions.values());
    const sessions = internalSessions.map(toSession);
    const working = internalSessions.filter((s) => s.status === "working").length;
    const waitingForInput = internalSessions.filter(
      (s) => s.status === "waiting_for_input"
    ).length;
    return {
      type: "state",
      blocked: working === 0,
      sessions,
      working,
      waitingForInput,
    };
  }

  handleHook(payload: HookPayload): void {
    const { session_id, hook_event_name } = payload;

    switch (hook_event_name) {
      case "SessionStart": {
        const now = new Date();
        // Track first-seen cwd for this session ID (preserves original project directory)
        if (payload.cwd && !this.sessionInitialCwds.has(session_id)) {
          this.sessionInitialCwds.set(session_id, payload.cwd);
        }
        const initialCwd = this.sessionInitialCwds.get(session_id);
        this.sessions.set(session_id, {
          id: session_id,
          status: "idle",
          projectName: getProjectName(initialCwd || payload.cwd, session_id),
          initialCwd,
          cwd: payload.cwd,
          startTime: now,
          lastActivity: now,
          toolCount: 0,
          recentTools: [],
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        });
        console.log(`Session started: ${getProjectName(initialCwd || payload.cwd, session_id)}`);
        break;
      }

      case "SessionEnd": {
        const endingSession = this.sessions.get(session_id);
        if (endingSession) {
          this.addToHistory(endingSession);
          console.log(`Session ended: ${endingSession.projectName}`);
        }
        this.sessions.delete(session_id);
        break;
      }

      case "UserPromptSubmit": {
        this.ensureSession(session_id, payload.cwd);
        const promptSession = this.sessions.get(session_id)!;
        promptSession.status = "working";
        promptSession.waitingForInputSince = undefined;
        promptSession.lastActivity = new Date();
        this.accumulateTokens(promptSession, payload);
        break;
      }

      case "PreToolUse": {
        this.ensureSession(session_id, payload.cwd);
        const toolSession = this.sessions.get(session_id)!;

        // Track tool usage
        toolSession.toolCount++;
        if (payload.tool_name) {
          toolSession.lastTool = payload.tool_name;

          // Add to recent tools history (keep last 5)
          const toolCall: InternalToolCall = {
            name: payload.tool_name,
            timestamp: new Date(),
            input: payload.tool_input,
          };
          toolSession.recentTools = [toolCall, ...toolSession.recentTools].slice(0, 5);
        }

        // Check if this is a user input tool
        if (payload.tool_name && USER_INPUT_TOOLS.includes(payload.tool_name)) {
          toolSession.status = "waiting_for_input";
          toolSession.waitingForInputSince = new Date();
        } else if (toolSession.status === "waiting_for_input") {
          // If waiting for input, only reset after 500ms (to ignore immediate tool calls like Edit)
          const elapsed = Date.now() - (toolSession.waitingForInputSince?.getTime() ?? 0);
          if (elapsed > 500) {
            toolSession.status = "working";
            toolSession.waitingForInputSince = undefined;
          }
        } else {
          toolSession.status = "working";
        }
        toolSession.lastActivity = new Date();
        this.accumulateTokens(toolSession, payload);
        break;
      }

      case "PostToolUse": {
        // PostToolUse often contains token usage data
        this.ensureSession(session_id, payload.cwd);
        const postToolSession = this.sessions.get(session_id)!;
        postToolSession.lastActivity = new Date();
        this.accumulateTokens(postToolSession, payload);
        break;
      }

      case "Stop": {
        this.ensureSession(session_id, payload.cwd);
        const idleSession = this.sessions.get(session_id)!;
        if (idleSession.status === "waiting_for_input") {
          // If waiting for input, only reset after 500ms (to ignore immediate Stop after AskUserQuestion)
          const elapsed = Date.now() - (idleSession.waitingForInputSince?.getTime() ?? 0);
          if (elapsed > 500) {
            idleSession.status = "idle";
            idleSession.waitingForInputSince = undefined;
          }
        } else {
          idleSession.status = "idle";
        }
        idleSession.lastActivity = new Date();
        // Stop event may contain final token counts
        this.accumulateTokens(idleSession, payload);
        break;
      }
    }

    this.broadcast();
  }

  private ensureSession(sessionId: string, cwd?: string): void {
    // Track first-seen cwd for this session ID (preserves original project directory)
    if (cwd && !this.sessionInitialCwds.has(sessionId)) {
      this.sessionInitialCwds.set(sessionId, cwd);
    }

    if (!this.sessions.has(sessionId)) {
      const now = new Date();
      const initialCwd = this.sessionInitialCwds.get(sessionId);
      this.sessions.set(sessionId, {
        id: sessionId,
        status: "idle",
        projectName: getProjectName(initialCwd || cwd, sessionId),
        initialCwd,
        cwd,
        startTime: now,
        lastActivity: now,
        toolCount: 0,
        recentTools: [],
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      });
      console.log(`Session connected: ${getProjectName(initialCwd || cwd, sessionId)}`);
    }
  }

  // Accumulate token counts from hook payload
  private accumulateTokens(session: InternalSession, payload: HookPayload): void {
    if (payload.input_tokens) {
      session.inputTokens += payload.input_tokens;
    }
    if (payload.output_tokens) {
      session.outputTokens += payload.output_tokens;
    }
    if (payload.total_tokens) {
      session.totalTokens += payload.total_tokens;
    } else if (payload.input_tokens || payload.output_tokens) {
      // Calculate total if not provided
      session.totalTokens = session.inputTokens + session.outputTokens;
    }
    if (payload.cost_usd) {
      session.costUsd += payload.cost_usd;
    }
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > SESSION_TIMEOUT_MS) {
        // Add to history before removing
        this.addToHistory(session);
        console.log(`Session timed out: ${session.projectName}`);
        this.sessions.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.broadcast();
    }
  }

  getStatus(): { blocked: boolean; sessions: Session[] } {
    const internalSessions = Array.from(this.sessions.values());
    const sessions = internalSessions.map(toSession);
    const working = internalSessions.filter((s) => s.status === "working").length;
    return {
      blocked: working === 0,
      sessions,
    };
  }

  // Update session metrics from statusline (tokens and cost)
  // Note: statusline provides absolute totals, not deltas, so we set rather than accumulate
  updateSessionMetrics(
    sessionId: string,
    metrics: {
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.costUsd = metrics.costUsd;
    session.inputTokens = metrics.inputTokens;
    session.outputTokens = metrics.outputTokens;
    session.totalTokens = metrics.totalTokens;
    session.lastActivity = new Date();

    this.broadcast();
  }

  destroy(): void {
    // Save any pending changes immediately
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    savePersistedData(this.persistedData);

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
    this.listeners.clear();
  }
}

export const state = new SessionState();
