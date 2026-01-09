// Hook event payload (from Claude Code)
export interface HookPayload {
  session_id: string;
  hook_event_name:
    | "UserPromptSubmit"
    | "PreToolUse"
    | "Stop"
    | "SessionStart"
    | "SessionEnd";
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
}

// Session state tracked by server
export interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string; // basename of cwd, or truncated session ID if no cwd
  cwd?: string;
  startTime: string; // ISO string for JSON serialization
  lastActivity: string; // ISO string for JSON serialization
  lastTool?: string;
  toolCount: number;
  waitingForInputSince?: string; // ISO string for JSON serialization
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
