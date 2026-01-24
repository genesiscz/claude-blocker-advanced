// Import types for local use
import type { TokenBreakdown } from "@claude-blocker-advanced/shared";

// Re-export shared types
export type {
  HookPayload,
  Session,
  ServerMessage,
  ClientMessage,
  ToolCall,
  TokenBreakdown,
  ModelPricing,
  DailyStats,
  HistoricalSession as SharedHistoricalSession,
} from "@claude-blocker-advanced/shared";

export {
  DEFAULT_PORT,
  SESSION_TIMEOUT_MS,
  USER_INPUT_TOOLS,
} from "@claude-blocker-advanced/shared";

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
  // Token tracking (detailed breakdown)
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  // Model tracking
  model?: string; // Primary model used (e.g., "claude-opus-4-5-20251101")
  modelBreakdown?: Record<string, TokenBreakdown>; // Per-model token usage
}

// Tracked subagent (for aggregating subagent tokens)
export interface TrackedSubagent {
  id: string;
  type: string; // "Explore", "Plan", "Bash", etc.
  startTime: Date;
  endTime?: Date;
  tokens?: TokenBreakdown;
  model?: string;
}
