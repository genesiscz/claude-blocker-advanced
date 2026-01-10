import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { execSync } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import type { HookPayload, ClientMessage } from "./types.js";
import { DEFAULT_PORT } from "./types.js";
import { state } from "./state.js";

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startServer(port: number = DEFAULT_PORT): void {
  const server = createServer(async (req, res) => {
    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // Health check / status endpoint
    if (req.method === "GET" && url.pathname === "/status") {
      sendJson(res, state.getStatus());
      return;
    }

    // Session history endpoint
    if (req.method === "GET" && url.pathname === "/history") {
      sendJson(res, { history: state.getHistory() });
      return;
    }

    // Hook endpoint - receives notifications from Claude Code
    if (req.method === "POST" && url.pathname === "/hook") {
      try {
        const body = await parseBody(req);
        const payload = JSON.parse(body) as HookPayload;

        if (!payload.session_id || !payload.hook_event_name) {
          sendJson(res, { error: "Invalid payload" }, 400);
          return;
        }

        state.handleHook(payload);
        sendJson(res, { ok: true });
      } catch {
        sendJson(res, { error: "Invalid JSON" }, 400);
      }
      return;
    }

    // Statusline endpoint - receives token and cost data from statusline script
    if (req.method === "POST" && url.pathname === "/statusline") {
      try {
        const body = await parseBody(req);
        const payload = JSON.parse(body) as Record<string, unknown>;

        const sessionId = payload.session_id as string | undefined;
        if (!sessionId) {
          sendJson(res, { error: "session_id required" }, 400);
          return;
        }

        // Extract metrics from statusline payload
        const cost = payload.cost as Record<string, unknown> | undefined;
        const contextWindow = payload.context_window as Record<string, unknown> | undefined;

        const costUsd = (cost?.total_cost_usd as number) || 0;
        const inputTokens = (contextWindow?.total_input_tokens as number) || 0;
        const outputTokens = (contextWindow?.total_output_tokens as number) || 0;

        state.updateSessionMetrics(sessionId, {
          costUsd,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        });

        sendJson(res, { ok: true });
      } catch {
        sendJson(res, { error: "Invalid JSON" }, 400);
      }
      return;
    }

    // Action: Open in Finder (macOS)
    if (req.method === "POST" && url.pathname === "/action/open-finder") {
      try {
        const body = await parseBody(req);
        const { path } = JSON.parse(body) as { path: string };

        if (!path) {
          sendJson(res, { success: false, error: "Path is required" }, 400);
          return;
        }

        // Use 'open' command on macOS to open folder in Finder
        execSync(`open "${path.replace(/"/g, '\\"')}"`);
        sendJson(res, { success: true });
      } catch (error) {
        sendJson(res, { success: false, error: String(error) }, 500);
      }
      return;
    }

    // Action: Open in Terminal (macOS)
    if (req.method === "POST" && url.pathname === "/action/open-terminal") {
      try {
        const body = await parseBody(req);
        const { path, command, app } = JSON.parse(body) as {
          path: string;
          command: string;
          app: "warp" | "iterm2" | "terminal" | "ghostty";
        };

        if (!path || !command || !app) {
          sendJson(res, { success: false, error: "path, command, and app are required" }, 400);
          return;
        }

        const escapedPath = path.replace(/'/g, "'\\''");
        const escapedCommand = command.replace(/'/g, "'\\''");
        const fullCommand = `cd '${escapedPath}' && ${escapedCommand}`;

        switch (app) {
          case "warp":
            // Warp: Use LaunchServices URL scheme
            execSync(
              `osascript -e 'tell application "Warp" to activate' -e 'delay 0.3' -e 'tell application "System Events" to tell process "Warp" to keystroke "t" using command down' -e 'delay 0.2' -e 'tell application "System Events" to tell process "Warp" to keystroke "${fullCommand.replace(/"/g, '\\"')}"' -e 'tell application "System Events" to tell process "Warp" to key code 36'`
            );
            break;
          case "iterm2":
            execSync(
              `osascript -e 'tell application "iTerm2"
                activate
                create window with default profile
                tell current session of current window
                  write text "${fullCommand.replace(/"/g, '\\"')}"
                end tell
              end tell'`
            );
            break;
          case "terminal":
            execSync(
              `osascript -e 'tell application "Terminal" to do script "${fullCommand.replace(/"/g, '\\"')}"'`
            );
            break;
          case "ghostty":
            // Ghostty: Open app and use System Events
            execSync(
              `osascript -e 'tell application "Ghostty" to activate' -e 'delay 0.3' -e 'tell application "System Events" to tell process "Ghostty" to keystroke "t" using command down' -e 'delay 0.2' -e 'tell application "System Events" to tell process "Ghostty" to keystroke "${fullCommand.replace(/"/g, '\\"')}"' -e 'tell application "System Events" to tell process "Ghostty" to key code 36'`
            );
            break;
          default:
            sendJson(res, { success: false, error: `Unknown terminal app: ${app}` }, 400);
            return;
        }

        sendJson(res, { success: true });
      } catch (error) {
        sendJson(res, { success: false, error: String(error) }, 500);
      }
      return;
    }

    // Action: Open in Editor (macOS)
    if (req.method === "POST" && url.pathname === "/action/open-editor") {
      try {
        const body = await parseBody(req);
        const { path, app } = JSON.parse(body) as {
          path: string;
          app: "cursor" | "vscode" | "windsurf" | "zed" | "sublime" | "webstorm";
        };

        if (!path || !app) {
          sendJson(res, { success: false, error: "path and app are required" }, 400);
          return;
        }

        // CLI commands for each editor
        const editorCommands: Record<string, string> = {
          cursor: "cursor",
          vscode: "code",
          windsurf: "windsurf",
          zed: "zed",
          sublime: "subl",
          webstorm: "webstorm",
        };

        const editorCommand = editorCommands[app];
        if (!editorCommand) {
          sendJson(res, { success: false, error: `Unknown editor app: ${app}` }, 400);
          return;
        }

        // Editors typically open via their CLI directly
        const escapedPath = path.replace(/"/g, '\\"');
        execSync(`${editorCommand} "${escapedPath}"`);

        sendJson(res, { success: true });
      } catch (error) {
        sendJson(res, { success: false, error: String(error) }, 500);
      }
      return;
    }

    // 404 for unknown routes
    sendJson(res, { error: "Not found" }, 404);
  });

  // WebSocket server for Chrome extension
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    console.log("Extension connected");

    // Subscribe to state changes
    const unsubscribe = state.subscribe((message) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;

        if (message.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on("close", () => {
      console.log("Extension disconnected");
      unsubscribe();
    });

    ws.on("error", () => {
      unsubscribe();
    });
  });

  server.listen(port, () => {
    console.log(`
┌───────────────────────────────────────────┐
│                                           │
│   Claude Blocker Advanced Server          │
│                                           │
│   HTTP:      http://localhost:${port}        │
│   WebSocket: ws://localhost:${port}/ws       │
│                                           │
│   Waiting for Claude Code hooks...        │
│                                           │
└───────────────────────────────────────────┘
`);
  });

  // Graceful shutdown - use once to prevent stacking handlers
  process.once("SIGINT", () => {
    console.log("\nShutting down...");
    state.destroy();
    wss.close();
    server.close();
    process.exit(0);
  });
}
