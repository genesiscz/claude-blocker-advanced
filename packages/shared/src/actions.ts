// Shared action handlers for session management

import type { EditorApp } from "./types";
import { EDITOR_COMMANDS } from "./types";

const SERVER_URL = "http://localhost:8765";

export interface SessionActionParams {
  sessionId?: string;
  cwd?: string;
  terminalApp?: string;
  editorApp?: EditorApp;
}

/**
 * Copy session ID to clipboard
 */
export async function copySessionId(sessionId: string): Promise<void> {
  await navigator.clipboard.writeText(sessionId);
}

/**
 * Copy resume command to clipboard
 */
export async function copyResumeCommand(sessionId: string): Promise<void> {
  await navigator.clipboard.writeText(`claude --resume ${sessionId}`);
}

/**
 * Copy working directory path to clipboard
 */
export async function copyCwd(cwd: string): Promise<void> {
  await navigator.clipboard.writeText(cwd);
}

/**
 * Open folder in Finder
 */
export async function openInFinder(cwd: string): Promise<void> {
  const response = await fetch(`${SERVER_URL}/action/open-finder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: cwd }),
  });

  if (!response.ok) {
    throw new Error(`Failed to open folder: ${response.statusText}`);
  }
}

/**
 * Open project in terminal and run resume command
 * Falls back to copying command to clipboard if server request fails
 */
export async function openInTerminal(
  cwd: string,
  sessionId: string,
  terminalApp: string = "warp"
): Promise<void> {
  const command = `claude --resume ${sessionId}`;

  try {
    const response = await fetch(`${SERVER_URL}/action/open-terminal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: cwd,
        command,
        app: terminalApp,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to open terminal: ${response.statusText}`);
    }
  } catch (err) {
    // Fallback: copy full command with cd
    await navigator.clipboard.writeText(`cd "${cwd}" && ${command}`);
    throw err; // Re-throw so caller knows it fell back
  }
}

/**
 * Open project in code editor
 * Falls back to copying command to clipboard if server request fails
 */
export async function openInEditor(
  cwd: string,
  editorApp: EditorApp = "cursor"
): Promise<void> {
  try {
    const response = await fetch(`${SERVER_URL}/action/open-editor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: cwd,
        app: editorApp,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to open editor: ${response.statusText}`);
    }
  } catch (err) {
    // Fallback: copy editor command to clipboard
    const editorCommand = EDITOR_COMMANDS[editorApp];
    await navigator.clipboard.writeText(`${editorCommand} "${cwd}"`);
    throw err; // Re-throw so caller knows it fell back
  }
}

/**
 * Execute a session action based on action type
 */
export async function executeSessionAction(
  action: string,
  params: SessionActionParams
): Promise<{ success: boolean; fallback?: boolean; error?: string }> {
  try {
    switch (action) {
      case "copy-id":
        if (!params.sessionId) throw new Error("Session ID required");
        await copySessionId(params.sessionId);
        return { success: true };

      case "copy-command":
        if (!params.sessionId) throw new Error("Session ID required");
        await copyResumeCommand(params.sessionId);
        return { success: true };

      case "copy-cwd":
        if (!params.cwd) throw new Error("Working directory required");
        await copyCwd(params.cwd);
        return { success: true };

      case "open-folder":
        if (!params.cwd) throw new Error("Working directory required");
        await openInFinder(params.cwd);
        return { success: true };

      case "open-terminal":
        if (!params.cwd || !params.sessionId) {
          throw new Error("Working directory and session ID required");
        }
        try {
          await openInTerminal(params.cwd, params.sessionId, params.terminalApp);
          return { success: true };
        } catch (err) {
          // Fallback succeeded (copied to clipboard)
          return { success: true, fallback: true };
        }

      case "open-editor":
        if (!params.cwd) {
          throw new Error("Working directory required");
        }
        try {
          await openInEditor(params.cwd, params.editorApp);
          return { success: true };
        } catch (err) {
          // Fallback succeeded (copied to clipboard)
          return { success: true, fallback: true };
        }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
