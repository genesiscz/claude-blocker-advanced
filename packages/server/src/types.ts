// Re-export shared types
export type {
  HookPayload,
  Session,
  ServerMessage,
  ClientMessage,
} from "@claude-blocker/shared";

export {
  DEFAULT_PORT,
  SESSION_TIMEOUT_MS,
  USER_INPUT_TOOLS,
} from "@claude-blocker/shared";

// Internal session state (with Date objects for easier manipulation)
export interface InternalSession {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string;
  cwd?: string;
  startTime: Date;
  lastActivity: Date;
  lastTool?: string;
  toolCount: number;
  waitingForInputSince?: Date;
  // Token tracking
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}
