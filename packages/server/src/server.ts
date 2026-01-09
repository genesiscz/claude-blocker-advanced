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
┌─────────────────────────────────────┐
│                                     │
│   Claude Blocker Server             │
│                                     │
│   HTTP:      http://localhost:${port}  │
│   WebSocket: ws://localhost:${port}/ws │
│                                     │
│   Waiting for Claude Code hooks...  │
│                                     │
└─────────────────────────────────────┘
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
