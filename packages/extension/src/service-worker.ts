export {};

// Session type matching server output
interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string;
  cwd?: string;
  startTime: string;
  lastActivity: string;
  lastTool?: string;
  toolCount: number;
  waitingForInputSince?: string;
}

interface NotificationConfig {
  enabled: boolean;
  onWaiting: boolean;
  onFinished: boolean;
  onDisconnected: boolean;
}

// Productivity stats interface
interface DailyStats {
  date: string; // YYYY-MM-DD
  totalWorkingMs: number;
  totalWaitingMs: number;
  totalIdleMs: number;
  sessionsStarted: number;
  sessionsEnded: number;
}

// Track state timestamps per session for stats calculation
interface SessionStateTracking {
  lastStatus: "idle" | "working" | "waiting_for_input";
  lastStatusChangeTime: number; // timestamp in ms
}

const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: true,
  onWaiting: true,
  onFinished: true,
  onDisconnected: true,
};

const WS_URL = "ws://localhost:8765/ws";
const KEEPALIVE_INTERVAL = 20_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;

// The actual state - service worker is single source of truth
interface State {
  serverConnected: boolean;
  sessions: Session[];
  bypassUntil: number | null;
}

const state: State = {
  serverConnected: false,
  sessions: [],
  bypassUntil: null,
};

// Previous state for detecting changes
let previousSessions: Session[] = [];
let wasConnected = false;

// Session state tracking for stats
const sessionStateTracking: Map<string, SessionStateTracking> = new Map();

// Notification config
let notificationConfig: NotificationConfig = DEFAULT_NOTIFICATION_CONFIG;

let websocket: WebSocket | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;

// Get today's date in YYYY-MM-DD format
function getTodayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Get storage key for daily stats
function getStatsStorageKey(date: string): string {
  return `stats_${date}`;
}

// Load daily stats from storage
async function loadDailyStats(date: string): Promise<DailyStats> {
  const key = getStatsStorageKey(date);
  const result = await chrome.storage.local.get([key]);
  if (result[key]) {
    return result[key] as DailyStats;
  }
  // Return default empty stats for the date
  return {
    date,
    totalWorkingMs: 0,
    totalWaitingMs: 0,
    totalIdleMs: 0,
    sessionsStarted: 0,
    sessionsEnded: 0,
  };
}

// Save daily stats to storage
async function saveDailyStats(stats: DailyStats): Promise<void> {
  const key = getStatsStorageKey(stats.date);
  await chrome.storage.local.set({ [key]: stats });
}

// Update daily stats based on session state changes
async function updateDailyStats(
  newSessions: Session[],
  oldSessions: Session[]
): Promise<void> {
  const now = Date.now();
  const todayKey = getTodayDateKey();
  const stats = await loadDailyStats(todayKey);

  // Create maps for easier lookup
  const oldMap = new Map(oldSessions.map((s) => [s.id, s]));
  const newMap = new Map(newSessions.map((s) => [s.id, s]));

  // Track new sessions (sessions that appear in new but not in old)
  for (const session of newSessions) {
    if (!oldMap.has(session.id)) {
      stats.sessionsStarted++;
      // Initialize tracking for new session
      sessionStateTracking.set(session.id, {
        lastStatus: session.status,
        lastStatusChangeTime: now,
      });
    }
  }

  // Track ended sessions (sessions that were in old but not in new)
  for (const oldSession of oldSessions) {
    if (!newMap.has(oldSession.id)) {
      stats.sessionsEnded++;

      // Add remaining time from last known state
      const tracking = sessionStateTracking.get(oldSession.id);
      if (tracking) {
        const timeInState = now - tracking.lastStatusChangeTime;
        switch (tracking.lastStatus) {
          case "working":
            stats.totalWorkingMs += timeInState;
            break;
          case "waiting_for_input":
            stats.totalWaitingMs += timeInState;
            break;
          case "idle":
            stats.totalIdleMs += timeInState;
            break;
        }
        // Clean up tracking for ended session
        sessionStateTracking.delete(oldSession.id);
      }
    }
  }

  // Track state changes for existing sessions
  for (const newSession of newSessions) {
    const oldSession = oldMap.get(newSession.id);
    const tracking = sessionStateTracking.get(newSession.id);

    if (tracking) {
      // Check if status changed
      if (newSession.status !== tracking.lastStatus) {
        // Calculate time spent in previous state
        const timeInPreviousState = now - tracking.lastStatusChangeTime;

        switch (tracking.lastStatus) {
          case "working":
            stats.totalWorkingMs += timeInPreviousState;
            break;
          case "waiting_for_input":
            stats.totalWaitingMs += timeInPreviousState;
            break;
          case "idle":
            stats.totalIdleMs += timeInPreviousState;
            break;
        }

        // Update tracking with new state
        tracking.lastStatus = newSession.status;
        tracking.lastStatusChangeTime = now;
      }
    } else if (oldSession) {
      // Session exists but wasn't being tracked (edge case after service worker restart)
      sessionStateTracking.set(newSession.id, {
        lastStatus: newSession.status,
        lastStatusChangeTime: now,
      });
    }
  }

  // Save updated stats
  await saveDailyStats(stats);
}

// Load bypass from storage on startup
chrome.storage.sync.get(["bypassUntil"], (result) => {
  if (result.bypassUntil && result.bypassUntil > Date.now()) {
    state.bypassUntil = result.bypassUntil;
  }
});

// Load notification config from storage on startup
chrome.storage.sync.get(["notificationConfig"], (result) => {
  if (result.notificationConfig) {
    notificationConfig = { ...DEFAULT_NOTIFICATION_CONFIG, ...result.notificationConfig };
  }
});

// Listen for notification config updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.notificationConfig) {
    notificationConfig = { ...DEFAULT_NOTIFICATION_CONFIG, ...changes.notificationConfig.newValue };
  }
});

// Send Chrome notification
function sendNotification(title: string, message: string, notificationId?: string): void {
  if (!notificationConfig.enabled) return;

  chrome.notifications.create(notificationId ?? `claude-blocker-${Date.now()}`, {
    type: "basic",
    iconUrl: "icon-128.png",
    title,
    message,
    priority: 1,
  });
}

// Check for session state changes and send notifications
function checkForNotifications(newSessions: Session[]): void {
  if (!notificationConfig.enabled) return;

  // Create maps for easier lookup
  const prevMap = new Map(previousSessions.map((s) => [s.id, s]));
  const newMap = new Map(newSessions.map((s) => [s.id, s]));

  // Check each new session for state changes
  for (const session of newSessions) {
    const prev = prevMap.get(session.id);

    // Session became "waiting_for_input"
    if (
      notificationConfig.onWaiting &&
      session.status === "waiting_for_input" &&
      prev?.status !== "waiting_for_input"
    ) {
      sendNotification(
        "Claude has a question",
        `${session.projectName} is waiting for your input`,
        `waiting-${session.id}`
      );
    }

    // Session finished working (was working, now idle)
    if (
      notificationConfig.onFinished &&
      session.status === "idle" &&
      prev?.status === "working"
    ) {
      sendNotification(
        "Claude finished working",
        `${session.projectName} has completed its task`,
        `finished-${session.id}`
      );
    }
  }

  // Check for disconnected sessions (was in prev, not in new)
  if (notificationConfig.onDisconnected) {
    for (const prev of previousSessions) {
      if (!newMap.has(prev.id)) {
        sendNotification(
          "Session disconnected",
          `${prev.projectName} has ended`,
          `disconnected-${prev.id}`
        );
      }
    }
  }
}

// Compute derived state
function getPublicState() {
  const bypassActive = state.bypassUntil !== null && state.bypassUntil > Date.now();
  const working = state.sessions.filter((s) => s.status === "working").length;
  const waitingForInput = state.sessions.filter((s) => s.status === "waiting_for_input").length;

  // Don't block if waiting for input - only block when truly idle
  const isIdle = working === 0 && waitingForInput === 0;
  const shouldBlock = !bypassActive && (isIdle || !state.serverConnected);

  return {
    serverConnected: state.serverConnected,
    sessions: state.sessions,
    sessionCount: state.sessions.length,
    working,
    waitingForInput,
    blocked: shouldBlock,
    bypassActive,
    bypassUntil: state.bypassUntil,
  };
}

// Broadcast current state to all tabs
function broadcast() {
  const publicState = getPublicState();
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "STATE", ...publicState }).catch(() => {});
      }
    }
  });
}

// WebSocket connection management
function connect() {
  if (websocket?.readyState === WebSocket.OPEN) return;
  if (websocket?.readyState === WebSocket.CONNECTING) return;

  try {
    websocket = new WebSocket(WS_URL);

    websocket.onopen = () => {
      console.log("[Claude Blocker] Connected");
      state.serverConnected = true;
      wasConnected = true;
      retryCount = 0;
      startKeepalive();
      broadcast();
    };

    websocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          // Check for notifications before updating state
          const newSessions: Session[] = msg.sessions ?? [];
          checkForNotifications(newSessions);

          // Update daily stats based on state changes
          updateDailyStats(newSessions, state.sessions).catch((err) => {
            console.error("[Claude Blocker] Failed to update stats:", err);
          });

          // Update previous sessions for next comparison
          previousSessions = state.sessions;

          // Now receiving full sessions array from server
          state.sessions = newSessions;
          broadcast();
        }
      } catch {}
    };

    websocket.onclose = () => {
      console.log("[Claude Blocker] Disconnected");

      // Send notification if we were previously connected
      if (wasConnected && notificationConfig.enabled && notificationConfig.onDisconnected) {
        sendNotification(
          "Server disconnected",
          "Claude Blocker server is no longer reachable",
          "server-disconnected"
        );
      }

      state.serverConnected = false;
      wasConnected = false;
      previousSessions = [];
      stopKeepalive();
      broadcast();
      scheduleReconnect();
    };

    websocket.onerror = () => {
      state.serverConnected = false;
      stopKeepalive();
    };
  } catch {
    scheduleReconnect();
  }
}

function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "ping" }));
    }
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, retryCount), RECONNECT_MAX_DELAY);
  retryCount++;
  reconnectTimeout = setTimeout(connect, delay);
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    sendResponse(getPublicState());
    return true;
  }

  if (message.type === "ACTIVATE_BYPASS") {
    const today = new Date().toDateString();
    chrome.storage.sync.get(["lastBypassDate"], (result) => {
      if (result.lastBypassDate === today) {
        sendResponse({ success: false, reason: "Already used today" });
        return;
      }
      state.bypassUntil = Date.now() + 5 * 60 * 1000;
      chrome.storage.sync.set({ bypassUntil: state.bypassUntil, lastBypassDate: today });
      broadcast();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_BYPASS_STATUS") {
    const today = new Date().toDateString();
    chrome.storage.sync.get(["lastBypassDate"], (result) => {
      sendResponse({
        usedToday: result.lastBypassDate === today,
        bypassActive: state.bypassUntil !== null && state.bypassUntil > Date.now(),
        bypassUntil: state.bypassUntil,
      });
    });
    return true;
  }

  if (message.type === "GET_DAILY_STATS") {
    // Get stats for a specific date or today
    const date = message.date ?? getTodayDateKey();
    loadDailyStats(date)
      .then((stats) => {
        sendResponse({ success: true, stats });
      })
      .catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "GET_STATS_RANGE") {
    // Get stats for a range of dates (array of date strings)
    const dates: string[] = message.dates ?? [getTodayDateKey()];
    Promise.all(dates.map((d) => loadDailyStats(d)))
      .then((statsArray) => {
        sendResponse({ success: true, stats: statsArray });
      })
      .catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  return false;
});

// Check bypass expiry
setInterval(() => {
  if (state.bypassUntil && state.bypassUntil <= Date.now()) {
    state.bypassUntil = null;
    chrome.storage.sync.remove("bypassUntil");
    broadcast();
  }
}, 5000);

// Start
connect();
