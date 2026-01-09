import path from "path";
import type { Session, HookPayload, ServerMessage, InternalSession } from "./types.js";
import { SESSION_TIMEOUT_MS, USER_INPUT_TOOLS } from "./types.js";

type StateChangeCallback = (message: ServerMessage) => void;

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

// Convert internal session (with Date objects) to shared Session (with ISO strings)
function toSession(internal: InternalSession): Session {
  return {
    id: internal.id,
    status: internal.status,
    projectName: internal.projectName,
    cwd: internal.cwd,
    startTime: internal.startTime.toISOString(),
    lastActivity: internal.lastActivity.toISOString(),
    lastTool: internal.lastTool,
    toolCount: internal.toolCount,
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
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval for stale sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 30_000); // Check every 30 seconds
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
        this.sessions.set(session_id, {
          id: session_id,
          status: "idle",
          projectName: getProjectName(payload.cwd, session_id),
          cwd: payload.cwd,
          startTime: now,
          lastActivity: now,
          toolCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        });
        console.log(`Session started: ${getProjectName(payload.cwd, session_id)}`);
        break;
      }

      case "SessionEnd":
        const endingSession = this.sessions.get(session_id);
        if (endingSession) {
          console.log(`Session ended: ${endingSession.projectName}`);
        }
        this.sessions.delete(session_id);
        break;

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
    if (!this.sessions.has(sessionId)) {
      const now = new Date();
      this.sessions.set(sessionId, {
        id: sessionId,
        status: "idle",
        projectName: getProjectName(cwd, sessionId),
        cwd,
        startTime: now,
        lastActivity: now,
        toolCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      });
      console.log(`Session connected: ${getProjectName(cwd, sessionId)}`);
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

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
    this.listeners.clear();
  }
}

export const state = new SessionState();
