import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import type { Session, HookPayload, ServerMessage, InternalSession, ToolCall, InternalToolCall, TokenBreakdown, TrackedSubagent } from "./types.js";
import { SESSION_TIMEOUT_MS, USER_INPUT_TOOLS } from "./types.js";
import { initializePricing, getPricing, calculateCost, type ModelPricing } from "./price-resolver.js";

// Initialize pricing on module load (non-blocking)
initializePricing();

interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface TranscriptEntry {
  type?: string;
  requestId?: string;
  message?: {
    model?: string;
    usage?: TranscriptUsage;
  };
}

interface RequestUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model?: string;
}

// Result of parsing a transcript
interface TranscriptParseResult {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  model?: string;
  modelBreakdown: Record<string, TokenBreakdown>;
}

// Parse transcript file to extract total token usage (synchronous to ensure completion before exit)
function parseTranscriptForTokensSync(transcriptPath: string): TranscriptParseResult {
  // Track usage by requestId to avoid counting duplicates from streaming chunks
  const requestUsage = new Map<string, RequestUsage>();

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptEntry;

        // Only process assistant messages with usage data and a requestId
        if (entry.type === "assistant" && entry.message?.usage && entry.requestId) {
          const usage = entry.message.usage;
          const requestId = entry.requestId;
          const model = entry.message.model;

          // Get or create usage record for this request
          const current = requestUsage.get(requestId) || {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            model: undefined,
          };

          // Update model (use the first model we see for this request)
          if (model && !current.model) {
            current.model = model;
          }

          // Update with maximum values (streaming chunks report cumulative)
          if (usage.input_tokens) {
            current.inputTokens = Math.max(current.inputTokens, usage.input_tokens);
          }
          if (usage.output_tokens) {
            current.outputTokens = Math.max(current.outputTokens, usage.output_tokens);
          }
          if (usage.cache_creation_input_tokens) {
            current.cacheCreationTokens = Math.max(
              current.cacheCreationTokens,
              usage.cache_creation_input_tokens
            );
          }
          if (usage.cache_read_input_tokens) {
            current.cacheReadTokens = Math.max(current.cacheReadTokens, usage.cache_read_input_tokens);
          }

          requestUsage.set(requestId, current);
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch (err) {
    console.error("Error parsing transcript:", err);
  }

  // Sum up all unique requests and build model breakdown
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let primaryModel: string | undefined;
  const modelBreakdown: Record<string, TokenBreakdown> = {};

  for (const usage of requestUsage.values()) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheCreationTokens += usage.cacheCreationTokens;
    cacheReadTokens += usage.cacheReadTokens;

    // Track the first model as primary (most likely the main session model)
    if (usage.model && !primaryModel) {
      primaryModel = usage.model;
    }

    // Build per-model breakdown
    if (usage.model) {
      const existing = modelBreakdown[usage.model] || {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.cacheCreationTokens += usage.cacheCreationTokens;
      existing.cacheReadTokens += usage.cacheReadTokens;
      modelBreakdown[usage.model] = existing;
    }
  }

  // Total tokens (input includes cache reads for context window purposes)
  const totalInputTokens = inputTokens + cacheReadTokens;
  const totalTokens = totalInputTokens + outputTokens;

  // Calculate cost using model-specific pricing
  // If we have model breakdown, calculate per-model and sum
  // Otherwise use the primary model or default pricing
  let costUsd = 0;

  if (Object.keys(modelBreakdown).length > 0) {
    // Calculate cost per model and sum
    for (const [model, tokens] of Object.entries(modelBreakdown)) {
      costUsd += calculateCost(tokens, model);
    }
  } else {
    // Use primary model or default pricing
    const tokens: TokenBreakdown = {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    };
    costUsd = calculateCost(tokens, primaryModel);
  }

  console.log(
    `[Transcript] Parsed ${requestUsage.size} requests: model=${primaryModel || "unknown"} in=${inputTokens} cache_read=${cacheReadTokens} cache_create=${cacheCreationTokens} out=${outputTokens} total=${totalTokens} cost=$${costUsd.toFixed(4)}`
  );

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens,
    costUsd,
    model: primaryModel,
    modelBreakdown,
  };
}

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
  // Token tracking (detailed breakdown)
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  // Model tracking
  model?: string;
  modelBreakdown?: Record<string, TokenBreakdown>;
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

    // Calculate totals for logging
    const totalTokens = data.history.reduce((sum, h) => sum + h.totalTokens, 0);
    const totalCost = data.history.reduce((sum, h) => sum + h.costUsd, 0);
    console.log(`[Save] ${DATA_FILE} - ${data.history.length} sessions, ${totalTokens} total tokens, $${totalCost.toFixed(4)} total cost`);
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
    cacheCreationTokens: internal.cacheCreationTokens,
    cacheReadTokens: internal.cacheReadTokens,
    totalTokens: internal.totalTokens,
    costUsd: internal.costUsd,
    model: internal.model,
    modelBreakdown: internal.modelBreakdown,
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
  // Track active subagents by session ID -> agent ID -> TrackedSubagent
  private activeSubagents: Map<string, Map<string, TrackedSubagent>> = new Map();

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

  // Add or update a session in history when it ends
  // If session already exists (resumed session), update it instead of adding duplicate
  private addToHistory(session: InternalSession): void {
    const now = new Date();

    // Check if this session already exists in history
    const existingIndex = this.persistedData.history.findIndex((h) => h.id === session.id);

    if (existingIndex !== -1) {
      // Update existing entry - transcript gives cumulative totals
      const existing = this.persistedData.history[existingIndex];
      const oldTokens = existing.totalTokens;
      const oldCost = existing.costUsd;

      existing.endTime = now.toISOString();
      existing.lastTool = session.lastTool;
      existing.toolCount = session.toolCount;
      existing.totalDurationMs = now.getTime() - new Date(existing.startTime).getTime();
      // Token data from transcript is cumulative, so just use new values
      existing.inputTokens = session.inputTokens;
      existing.outputTokens = session.outputTokens;
      existing.cacheCreationTokens = session.cacheCreationTokens;
      existing.cacheReadTokens = session.cacheReadTokens;
      existing.totalTokens = session.totalTokens;
      existing.costUsd = session.costUsd;
      existing.model = session.model;
      existing.modelBreakdown = session.modelBreakdown;

      // Move to front of history (most recent)
      this.persistedData.history.splice(existingIndex, 1);
      this.persistedData.history.unshift(existing);

      this.scheduleSave();
      console.log(`[History] Updated: ${session.projectName} (resumed) tokens=${existing.totalTokens} (was ${oldTokens}) cost=$${existing.costUsd.toFixed(4)} (was $${oldCost.toFixed(4)})`);
      return;
    }

    // New session - add to history
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
      cacheCreationTokens: session.cacheCreationTokens,
      cacheReadTokens: session.cacheReadTokens,
      totalTokens: session.totalTokens,
      costUsd: session.costUsd,
      model: session.model,
      modelBreakdown: session.modelBreakdown,
    };

    // Add to beginning of history
    this.persistedData.history.unshift(historicalSession);

    // Keep only last 7 days
    const cutoff = Date.now() - HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
    this.persistedData.history = this.persistedData.history.filter(
      (h) => new Date(h.endTime).getTime() > cutoff
    );

    this.scheduleSave();
    console.log(`[History] Added: ${session.projectName} tokens=${historicalSession.totalTokens} cost=$${historicalSession.costUsd.toFixed(4)}`);
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

        // Check if this session exists in history (resumed session)
        const existingHistoricalSession = this.persistedData.history.find((h) => h.id === session_id);

        const newSession: InternalSession = {
          id: session_id,
          status: "idle",
          projectName: getProjectName(initialCwd || payload.cwd, session_id),
          initialCwd,
          cwd: payload.cwd,
          startTime: existingHistoricalSession ? new Date(existingHistoricalSession.startTime) : now,
          lastActivity: now,
          toolCount: existingHistoricalSession?.toolCount ?? 0,
          recentTools: [],
          // Restore token data from history if available (resumed session)
          inputTokens: existingHistoricalSession?.inputTokens ?? 0,
          outputTokens: existingHistoricalSession?.outputTokens ?? 0,
          cacheCreationTokens: existingHistoricalSession?.cacheCreationTokens ?? 0,
          cacheReadTokens: existingHistoricalSession?.cacheReadTokens ?? 0,
          totalTokens: existingHistoricalSession?.totalTokens ?? 0,
          costUsd: existingHistoricalSession?.costUsd ?? 0,
          model: existingHistoricalSession?.model,
          modelBreakdown: existingHistoricalSession?.modelBreakdown,
        };

        this.sessions.set(session_id, newSession);

        if (existingHistoricalSession) {
          console.log(`Session resumed: ${newSession.projectName} (${existingHistoricalSession.totalTokens} tokens, $${existingHistoricalSession.costUsd.toFixed(4)} from previous run)`);
        } else {
          console.log(`Session started: ${getProjectName(initialCwd || payload.cwd, session_id)}`);
        }
        break;
      }

      case "SessionEnd": {
        const endingSession = this.sessions.get(session_id);
        if (endingSession) {
          // Try to read transcript for accurate token data (synchronous to ensure completion)
          const transcriptPath = payload.transcript_path;
          if (transcriptPath && existsSync(transcriptPath)) {
            try {
              const tokenData = parseTranscriptForTokensSync(transcriptPath);
              // Update session with transcript data (more accurate than statusline)
              if (tokenData.totalTokens > 0) {
                endingSession.inputTokens = tokenData.inputTokens;
                endingSession.outputTokens = tokenData.outputTokens;
                endingSession.cacheCreationTokens = tokenData.cacheCreationTokens;
                endingSession.cacheReadTokens = tokenData.cacheReadTokens;
                endingSession.totalTokens = tokenData.totalTokens;
                endingSession.costUsd = tokenData.costUsd;
                endingSession.model = tokenData.model;
                endingSession.modelBreakdown = tokenData.modelBreakdown;
                console.log(
                  `Session ${endingSession.projectName} tokens from transcript: ${tokenData.totalTokens} ($${tokenData.costUsd.toFixed(4)}) model=${tokenData.model || "unknown"}`
                );
              }
            } catch (err) {
              console.error("Error reading transcript:", err);
            }
          }
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

      case "SubagentStart": {
        // Track the start of a subagent
        const agentId = payload.agent_id;
        const agentType = payload.agent_type;

        if (!agentId) {
          console.warn("[SubagentStart] Missing agent_id");
          break;
        }

        // Get or create subagent map for this session
        if (!this.activeSubagents.has(session_id)) {
          this.activeSubagents.set(session_id, new Map());
        }
        const sessionSubagents = this.activeSubagents.get(session_id)!;

        const subagent: TrackedSubagent = {
          id: agentId,
          type: agentType || "unknown",
          startTime: new Date(),
        };
        sessionSubagents.set(agentId, subagent);

        console.log(
          `[Subagent] Started: ${agentType || "unknown"} (${agentId.substring(0, 8)}) for session ${session_id.substring(0, 8)}`
        );
        break;
      }

      case "SubagentStop": {
        // Process subagent completion and aggregate tokens
        const stoppedAgentId = payload.agent_id;
        const agentTranscriptPath = payload.agent_transcript_path;

        if (!stoppedAgentId) {
          console.warn("[SubagentStop] Missing agent_id");
          break;
        }

        // Get the subagent from tracking
        const sessionSubagentsMap = this.activeSubagents.get(session_id);
        const subagent = sessionSubagentsMap?.get(stoppedAgentId);

        if (!subagent) {
          console.warn(`[SubagentStop] Unknown subagent: ${stoppedAgentId.substring(0, 8)}`);
        }

        // Parse subagent transcript for token data
        if (agentTranscriptPath && existsSync(agentTranscriptPath)) {
          try {
            const tokenData = parseTranscriptForTokensSync(agentTranscriptPath);
            if (tokenData.totalTokens > 0) {
              // Get the session and add subagent tokens to it
              const session = this.sessions.get(session_id);
              if (session) {
                session.inputTokens += tokenData.inputTokens;
                session.outputTokens += tokenData.outputTokens;
                session.cacheCreationTokens += tokenData.cacheCreationTokens;
                session.cacheReadTokens += tokenData.cacheReadTokens;
                session.totalTokens += tokenData.totalTokens;
                session.costUsd += tokenData.costUsd;

                // Merge model breakdown
                if (tokenData.modelBreakdown) {
                  if (!session.modelBreakdown) {
                    session.modelBreakdown = {};
                  }
                  for (const [model, tokens] of Object.entries(tokenData.modelBreakdown)) {
                    const existing = session.modelBreakdown[model] || {
                      inputTokens: 0,
                      outputTokens: 0,
                      cacheCreationTokens: 0,
                      cacheReadTokens: 0,
                    };
                    existing.inputTokens += tokens.inputTokens;
                    existing.outputTokens += tokens.outputTokens;
                    existing.cacheCreationTokens += tokens.cacheCreationTokens;
                    existing.cacheReadTokens += tokens.cacheReadTokens;
                    session.modelBreakdown[model] = existing;
                  }
                }

                console.log(
                  `[Subagent] Tokens added from ${subagent?.type || "unknown"} (${stoppedAgentId.substring(0, 8)}): ${tokenData.totalTokens} ($${tokenData.costUsd.toFixed(4)})`
                );
              }
            }
          } catch (err) {
            console.error(`[SubagentStop] Error parsing transcript:`, err);
          }
        }

        // Remove from active tracking
        if (subagent) {
          subagent.endTime = new Date();
          sessionSubagentsMap?.delete(stoppedAgentId);
        }
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
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
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
