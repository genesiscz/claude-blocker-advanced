// Re-export shared types
export type {
  HookPayload,
  Session,
  ServerMessage,
  ClientMessage,
  ToolCall,
} from "@claude-blocker/shared";

export {
  DEFAULT_PORT,
  SESSION_TIMEOUT_MS,
  USER_INPUT_TOOLS,
} from "@claude-blocker/shared";

// Internal tool call (with Date objects for easier manipulation)
export interface InternalToolCall {
  name: string;
  timestamp: Date;
  input?: Record<string, unknown>;
}

// Internal session state (with Date objects for easier manipulation)
export interface InternalSession {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string;
  initialCwd?: string; // Original project directory (never changes after first set)
  cwd?: string; // Current directory (may change on session recreation)
  startTime: Date;
  lastActivity: Date;
  lastTool?: string;
  toolCount: number;
  recentTools: InternalToolCall[]; // Last 5 tool calls
  waitingForInputSince?: Date;
  // Token tracking
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}
