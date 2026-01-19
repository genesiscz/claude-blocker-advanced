// Tool call record (for tracking recent tools)
export interface ToolCall {
  name: string;
  timestamp: string; // ISO string
  input?: {
    file_path?: string;
    command?: string;
    pattern?: string;
    description?: string;
  };
}

// Hook event payload (from Claude Code)
export interface HookPayload {
  session_id: string;
  hook_event_name:
    | "UserPromptSubmit"
    | "PreToolUse"
    | "PostToolUse"
    | "Stop"
    | "SessionStart"
    | "SessionEnd";
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
  // Token tracking (if provided by Claude Code)
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  // Cost tracking (if provided)
  cost_usd?: number;
}

// Session state tracked by server
export interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string; // basename of cwd, or truncated session ID if no cwd
  initialCwd?: string; // Original project directory (never changes after first set)
  cwd?: string; // Current directory (may change on session recreation)
  startTime: string; // ISO string for JSON serialization
  lastActivity: string; // ISO string for JSON serialization
  lastTool?: string;
  toolCount: number;
  recentTools: ToolCall[]; // Last 5 tool calls
  waitingForInputSince?: string; // ISO string for JSON serialization
  // Token tracking
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

// WebSocket messages from server to extension
export type ServerMessage =
  | {
      type: "state";
      blocked: boolean;
      sessions: Session[]; // Full session array for rich display
      working: number;
      waitingForInput: number;
    }
  | { type: "pong" };

// WebSocket messages from extension to server
export type ClientMessage = { type: "ping" } | { type: "subscribe" };

// Extension storage schema
export interface ExtensionState {
  blockedDomains: string[];
  lastBypassDate: string | null; // ISO date string, e.g. "2025-01-15"
  bypassUntil: number | null; // timestamp when current bypass expires
}

// Overlay configuration
export interface OverlayConfig {
  enabled: boolean;
  scope: "all" | "blocked" | "none";
  style: "pill" | "sidebar" | "dot";
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  opacity: number;
  customPosition?: { x: number; y: number };
}

// Sound configuration
export type SoundStyle = "none" | "subtle" | "clear" | "say";

export interface SoundConfig {
  enabled: boolean;
  volume: number; // 0-100
  perEvent: {
    onWaiting: SoundStyle;
    onFinished: SoundStyle;
    onDisconnected: SoundStyle;
  };
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 70,
  perEvent: {
    onWaiting: "subtle",
    onFinished: "subtle",
    onDisconnected: "subtle",
  },
};

// Default blocked domains
export const DEFAULT_BLOCKED_DOMAINS = ["x.com", "twitter.com"];

// Default overlay config
export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  enabled: true,
  scope: "all",
  style: "pill",
  position: "top-right",
  opacity: 0.9,
};

// Server configuration
export const DEFAULT_PORT = 8765;
export const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const KEEPALIVE_INTERVAL_MS = 20 * 1000; // 20 seconds

// Tools that indicate Claude is waiting for user input
export const USER_INPUT_TOOLS = ["AskUserQuestion", "ask_user", "ask_human"];

// Terminal application options
export type TerminalApp = "warp" | "iterm2" | "terminal" | "ghostty";

export interface TerminalConfig {
  app: TerminalApp;
}

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  app: "warp",
};

export const TERMINAL_OPTIONS: { value: TerminalApp; label: string }[] = [
  { value: "warp", label: "Warp" },
  { value: "iterm2", label: "iTerm2" },
  { value: "terminal", label: "Terminal.app" },
  { value: "ghostty", label: "Ghostty" },
];

// Editor application options
export type EditorApp =
  | "cursor"
  | "vscode"
  | "windsurf"
  | "zed"
  | "sublime"
  | "webstorm";

export interface EditorConfig {
  app: EditorApp;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  app: "cursor",
};

export const EDITOR_OPTIONS: { value: EditorApp; label: string }[] = [
  { value: "cursor", label: "Cursor" },
  { value: "vscode", label: "VS Code" },
  { value: "windsurf", label: "Windsurf" },
  { value: "zed", label: "Zed" },
  { value: "sublime", label: "Sublime Text" },
  { value: "webstorm", label: "WebStorm" },
];

// CLI commands for each editor
export const EDITOR_COMMANDS: Record<EditorApp, string> = {
  cursor: "cursor",
  vscode: "code",
  windsurf: "windsurf",
  zed: "zed",
  sublime: "subl",
  webstorm: "webstorm",
};

// Historical session - session that has ended (for history display)
export interface HistoricalSession {
  id: string;
  projectName: string;
  initialCwd?: string; // Original project directory
  cwd?: string; // Current directory at session end
  startTime: string;
  endTime: string;
  lastActivity: string;
  lastTool?: string;
  toolCount: number;
  totalDurationMs: number;
  // Time breakdown per state
  totalWorkingMs?: number;
  totalWaitingMs?: number;
  totalIdleMs?: number;
  // Activity segments for timeline (timestamps in ms)
  segments?: Array<{
    status: "idle" | "working" | "waiting_for_input";
    startTime: number;
    endTime: number;
  }>;
  // Recent tool calls (up to 5)
  recentTools?: ToolCall[];
  // Token and cost tracking
  totalTokens?: number;
  costUsd?: number;
}

// Daily productivity stats
export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalWorkingMs: number;
  totalWaitingMs: number;
  totalIdleMs: number;
  sessionsStarted: number;
  sessionsEnded: number;
  // Token and cost tracking
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

// Project stats for breakdown display
export interface ProjectStats {
  projectName: string;
  sessionCount: number;
  totalDuration: number;
  totalTokens: number;
  totalCost: number;
}
