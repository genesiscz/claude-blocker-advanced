import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { execSync } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import type { HookPayload, ClientMessage, ServerMessage, DailyStats } from "./types.js";
import { DEFAULT_PORT } from "./types.js";
import { state } from "./state.js";
import {
  runBackfill,
  getHistoricalStats,
  getDailyStatsRange,
  needsBackfill,
  type BackfillProgress,
} from "./backfill.js";

// Backfill state
let backfillInProgress = false;
let lastBackfillProgress: BackfillProgress | null = null;

// Stats broadcast subscribers
const statsSubscribers: Set<WebSocket> = new Set();

// Get today's date key
function getTodayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Broadcast stats update to all WebSocket subscribers
function broadcastStatsUpdate(): void {
  if (statsSubscribers.size === 0) return;

  const todayKey = getTodayDateKey();
  const stats = getDailyStatsRange([todayKey]);
  const todayStats: DailyStats = stats[0] || {
    date: todayKey,
    totalWorkingMs: 0,
    totalWaitingMs: 0,
    totalIdleMs: 0,
    sessionsStarted: 0,
    sessionsEnded: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0,
  };

  const message: ServerMessage = {
    type: "stats_update",
    dailyStats: todayStats,
    backfillProgress: lastBackfillProgress
      ? {
          totalFiles: lastBackfillProgress.totalFiles,
          processedFiles: lastBackfillProgress.processedFiles,
          status: lastBackfillProgress.status,
        }
      : undefined,
  };

  const messageStr = JSON.stringify(message);
  for (const ws of statsSubscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  }
}

// Log hook payload with truncated long fields
function logHook(payload: HookPayload): void {
  const truncate = (s: string | undefined, max = 60) =>
    s && s.length > max ? s.substring(0, max) + "..." : s;

  const log: Record<string, unknown> = {
    event: payload.hook_event_name,
    session: payload.session_id.substring(0, 8),
  };

  if (payload.tool_name) log.tool = payload.tool_name;
  if (payload.cwd) log.cwd = truncate(payload.cwd, 40);
  if (payload.transcript_path) log.transcript = truncate(payload.transcript_path, 50);
  if (payload.input_tokens) log.in_tokens = payload.input_tokens;
  if (payload.output_tokens) log.out_tokens = payload.output_tokens;
  if (payload.cost_usd) log.cost = payload.cost_usd;

  // Log tool_input keys only (not values - too large)
  if (payload.tool_input) {
    log.input_keys = Object.keys(payload.tool_input);
  }

  console.log("[Hook]", JSON.stringify(log));
}

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

        logHook(payload);
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

    // Stats endpoint - get all stats
    if (req.method === "GET" && url.pathname === "/stats") {
      try {
        const historicalStats = getHistoricalStats();
        const history = state.getHistory();

        // Calculate totals
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCacheCreationTokens = 0;
        let totalCacheReadTokens = 0;
        let totalCost = 0;
        let totalSessions = 0;

        for (const stats of Object.values(historicalStats.dailyStats)) {
          totalInputTokens += stats.totalInputTokens || 0;
          totalOutputTokens += stats.totalOutputTokens || 0;
          totalCacheCreationTokens += stats.totalCacheCreationTokens || 0;
          totalCacheReadTokens += stats.totalCacheReadTokens || 0;
          totalCost += stats.totalCostUsd || 0;
          totalSessions += stats.sessionsEnded || 0;
        }

        // Get project stats from history
        const projectMap = new Map<
          string,
          { sessionCount: number; totalDuration: number; totalTokens: number; totalCost: number }
        >();
        for (const session of history) {
          const existing = projectMap.get(session.projectName) || {
            sessionCount: 0,
            totalDuration: 0,
            totalTokens: 0,
            totalCost: 0,
          };
          existing.sessionCount++;
          existing.totalDuration += session.totalDurationMs;
          existing.totalTokens += session.totalTokens || 0;
          existing.totalCost += session.costUsd || 0;
          projectMap.set(session.projectName, existing);
        }

        const projects = Array.from(projectMap.entries())
          .map(([projectName, data]) => ({
            projectName,
            ...data,
          }))
          .sort((a, b) => b.totalCost - a.totalCost);

        sendJson(res, {
          daily: historicalStats.dailyStats,
          projects,
          totals: {
            tokens: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cacheCreationTokens: totalCacheCreationTokens,
              cacheReadTokens: totalCacheReadTokens,
            },
            cost: totalCost,
            sessions: totalSessions,
          },
          backfillStatus: {
            complete: !backfillInProgress,
            progress: lastBackfillProgress?.processedFiles || 0,
            total: lastBackfillProgress?.totalFiles || 0,
          },
        });
      } catch (error) {
        sendJson(res, { error: String(error) }, 500);
      }
      return;
    }

    // Stats for specific date range
    if (req.method === "GET" && url.pathname === "/stats/range") {
      try {
        const datesParam = url.searchParams.get("dates");
        if (!datesParam) {
          sendJson(res, { error: "dates parameter required (comma-separated YYYY-MM-DD)" }, 400);
          return;
        }
        const dates = datesParam.split(",").map((d) => d.trim());
        const stats = getDailyStatsRange(dates);
        sendJson(res, { stats });
      } catch (error) {
        sendJson(res, { error: String(error) }, 500);
      }
      return;
    }

    // Stats for specific date
    if (req.method === "GET" && url.pathname.startsWith("/stats/")) {
      try {
        const dateKey = url.pathname.replace("/stats/", "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          sendJson(res, { error: "Invalid date format (expected YYYY-MM-DD)" }, 400);
          return;
        }
        const stats = getDailyStatsRange([dateKey]);
        const history = state.getHistory().filter((s) => s.endTime.startsWith(dateKey));

        sendJson(res, {
          date: dateKey,
          stats: stats[0],
          sessions: history,
        });
      } catch (error) {
        sendJson(res, { error: String(error) }, 500);
      }
      return;
    }

    // Trigger manual backfill
    if (req.method === "POST" && url.pathname === "/stats/backfill") {
      if (backfillInProgress) {
        sendJson(res, { status: "already_running", progress: lastBackfillProgress });
        return;
      }

      // Start backfill in background
      backfillInProgress = true;
      runBackfill((progress) => {
        lastBackfillProgress = progress;
        broadcastStatsUpdate();
      })
        .then(() => {
          backfillInProgress = false;
          broadcastStatsUpdate();
        })
        .catch((err) => {
          console.error("[Backfill] Error:", err);
          backfillInProgress = false;
        });

      sendJson(res, { status: "started" });
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

    // Add to stats subscribers by default
    statsSubscribers.add(ws);

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;

        if (message.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }

        // Handle subscribe_stats message
        if ((message as Record<string, unknown>).type === "subscribe_stats") {
          statsSubscribers.add(ws);
          // Send current stats immediately
          broadcastStatsUpdate();
        }
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on("close", () => {
      console.log("Extension disconnected");
      unsubscribe();
      statsSubscribers.delete(ws);
    });

    ws.on("error", () => {
      unsubscribe();
      statsSubscribers.delete(ws);
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

    // Run backfill on startup if needed
    if (needsBackfill()) {
      console.log("[Backfill] Starting historical transcript backfill...");
      backfillInProgress = true;
      runBackfill((progress) => {
        lastBackfillProgress = progress;
        if (progress.status === "processing") {
          // Only log every 10 files to avoid spam
          if (progress.processedFiles % 10 === 0 || progress.processedFiles === progress.totalFiles) {
            console.log(
              `[Backfill] Progress: ${progress.processedFiles}/${progress.totalFiles} files`
            );
          }
        }
        broadcastStatsUpdate();
      })
        .then(() => {
          backfillInProgress = false;
          console.log("[Backfill] Historical transcript backfill complete");
          broadcastStatsUpdate();
        })
        .catch((err) => {
          console.error("[Backfill] Error during backfill:", err);
          backfillInProgress = false;
        });
    }
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
