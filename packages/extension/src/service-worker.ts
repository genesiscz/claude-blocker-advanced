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
  // Token and cost tracking (detailed breakdown)
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  // Model tracking
  model?: string;
  // Recent tool calls
  recentTools?: Array<{
    name: string;
    timestamp: string;
    input?: {
      file_path?: string;
      command?: string;
      pattern?: string;
      description?: string;
    };
  }>;
}

// Historical session - session that has ended
interface HistoricalSession {
  id: string;
  projectName: string;
  cwd?: string;
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
  recentTools?: Array<{
    name: string;
    timestamp: string;
    input?: {
      file_path?: string;
      command?: string;
      pattern?: string;
      description?: string;
    };
  }>;
  // Token and cost tracking (detailed breakdown)
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  // Model tracking
  model?: string;
}

interface NotificationConfig {
  enabled: boolean;
  onWaiting: boolean;
  onFinished: boolean;
  onDisconnected: boolean;
}

// Sound configuration
type SoundStyle = "none" | "subtle" | "clear" | "say";

interface SoundConfig {
  enabled: boolean;
  volume: number; // 0-100
  perEvent: {
    onWaiting: SoundStyle;
    onFinished: SoundStyle;
    onDisconnected: SoundStyle;
  };
}

const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 70,
  perEvent: {
    onWaiting: "subtle",
    onFinished: "subtle",
    onDisconnected: "subtle",
  },
};

// Productivity stats interface
interface DailyStats {
  date: string; // YYYY-MM-DD
  totalWorkingMs: number;
  totalWaitingMs: number;
  totalIdleMs: number;
  sessionsStarted: number;
  sessionsEnded: number;
  // Token and cost tracking (detailed breakdown)
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  // Model breakdown (per-model token usage)
  modelBreakdown?: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }>;
}

// Activity segment for timeline
interface ActivitySegment {
  status: "idle" | "working" | "waiting_for_input";
  startTime: number; // timestamp in ms
  endTime: number; // timestamp in ms
}

// Track state timestamps per session for stats calculation
interface SessionStateTracking {
  lastStatus: "idle" | "working" | "waiting_for_input";
  lastStatusChangeTime: number; // timestamp in ms
  // Accumulated time per state for this session
  accumulatedWorkingMs: number;
  accumulatedWaitingMs: number;
  accumulatedIdleMs: number;
  // Actual timeline segments (for history)
  segments: ActivitySegment[];
}

const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: true,
  onWaiting: true,
  onFinished: true,
  onDisconnected: true,
};

const WS_URL = "ws://localhost:8765/ws";
const SERVER_URL = "http://localhost:8765";
const KEEPALIVE_INTERVAL = 20_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;
const SESSION_HISTORY_MAX_DAYS = 7;
const SESSION_HISTORY_STORAGE_KEY = "sessionHistory";
const STATS_SYNC_DAYS = 10; // Number of days to sync on connect

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

// Sound config
let soundConfig: SoundConfig = DEFAULT_SOUND_CONFIG;

// Offscreen document state
let offscreenCreated = false;

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

// Get last N days as date keys
function getLastNDays(n: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

// Sync recent stats from server on connect
async function syncRecentStats(): Promise<void> {
  if (!state.serverConnected) return;

  try {
    const dates = getLastNDays(STATS_SYNC_DAYS);
    const response = await fetch(`${SERVER_URL}/stats/range?dates=${dates.join(",")}`);
    if (!response.ok) {
      console.log("[Claude Blocker Advanced] Failed to sync stats from server:", response.status);
      return;
    }

    const data = await response.json();
    // Server returns { stats: [...] }
    const statsArray = data?.stats ?? data;
    if (!Array.isArray(statsArray)) {
      console.log("[Claude Blocker Advanced] Invalid stats response from server");
      return;
    }

    // Merge each day's server stats with local data (preserves extension-tracked time)
    for (const stats of statsArray) {
      if (stats?.date) {
        await mergeServerStats(stats);
      }
    }

    console.log(`[Claude Blocker Advanced] Synced ${statsArray.length} days of stats from server`);
  } catch (err) {
    console.log("[Claude Blocker Advanced] Error syncing stats:", err);
  }
}

// Fetch stats for a specific date from server
async function fetchStatsFromServer(date: string): Promise<DailyStats | null> {
  if (!state.serverConnected) return null;

  try {
    const response = await fetch(`${SERVER_URL}/stats/${date}`);
    if (!response.ok) return null;

    const data = await response.json();
    if (data?.stats) {
      // Merge with local storage to preserve extension-tracked time
      await mergeServerStats(data.stats);
      return data.stats;
    }
  } catch {
    // Server not available, fall back to local storage
  }
  return null;
}

// Check if a date is within the last N days
function isWithinLastNDays(date: string, n: number): boolean {
  const dates = getLastNDays(n);
  return dates.includes(date);
}

// Load daily stats from storage, fetching from server if needed
async function loadDailyStats(date: string): Promise<DailyStats> {
  const key = getStatsStorageKey(date);
  const result = await chrome.storage.local.get([key]);

  // If we have cached data, return it (it's already synced from server for recent days)
  if (result[key]) {
    const stats = result[key] as DailyStats;
    return {
      ...stats,
      totalInputTokens: stats.totalInputTokens ?? 0,
      totalOutputTokens: stats.totalOutputTokens ?? 0,
      totalCacheCreationTokens: stats.totalCacheCreationTokens ?? 0,
      totalCacheReadTokens: stats.totalCacheReadTokens ?? 0,
      totalCostUsd: stats.totalCostUsd ?? 0,
    };
  }

  // For older dates (beyond sync range), try to fetch from server on demand
  if (!isWithinLastNDays(date, STATS_SYNC_DAYS) && state.serverConnected) {
    const serverStats = await fetchStatsFromServer(date);
    if (serverStats) {
      return serverStats;
    }
  }

  // Return default empty stats for the date
  return {
    date,
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
}

// Save daily stats to storage
async function saveDailyStats(stats: DailyStats): Promise<void> {
  const key = getStatsStorageKey(stats.date);
  await chrome.storage.local.set({ [key]: stats });
}

// Merge server stats with local data — trust server when it has time data, fall back to local otherwise
async function mergeServerStats(serverStats: DailyStats): Promise<void> {
  const hasServerTimeData = (serverStats.totalWorkingMs ?? 0) > 0 ||
                             (serverStats.totalWaitingMs ?? 0) > 0 ||
                             (serverStats.totalIdleMs ?? 0) > 0 ||
                             (serverStats.sessionsStarted ?? 0) > 0;

  if (hasServerTimeData) {
    // Server has real tracking data — use it directly
    await saveDailyStats(serverStats);
  } else {
    // Server has zeros — preserve extension-tracked values
    const localStats = await loadDailyStats(serverStats.date);
    const merged: DailyStats = {
      ...serverStats,
      totalWorkingMs: localStats.totalWorkingMs,
      totalWaitingMs: localStats.totalWaitingMs,
      totalIdleMs: localStats.totalIdleMs,
      sessionsStarted: localStats.sessionsStarted,
    };
    await saveDailyStats(merged);
  }
}

// Load session history from storage
async function loadSessionHistory(): Promise<HistoricalSession[]> {
  const result = await chrome.storage.local.get([SESSION_HISTORY_STORAGE_KEY]);
  if (result[SESSION_HISTORY_STORAGE_KEY] && Array.isArray(result[SESSION_HISTORY_STORAGE_KEY])) {
    return result[SESSION_HISTORY_STORAGE_KEY] as HistoricalSession[];
  }
  return [];
}

// Save session history to storage
async function saveSessionHistory(history: HistoricalSession[]): Promise<void> {
  await chrome.storage.local.set({ [SESSION_HISTORY_STORAGE_KEY]: history });
}

// Add a session to history when it ends
async function addSessionToHistory(
  session: Session,
  tracking?: SessionStateTracking
): Promise<void> {
  const now = Date.now();
  const startTimeMs = new Date(session.startTime).getTime();
  const totalDurationMs = now - startTimeMs;

  const historicalSession: HistoricalSession = {
    id: session.id,
    projectName: session.projectName,
    cwd: session.cwd,
    startTime: session.startTime,
    endTime: new Date(now).toISOString(),
    lastActivity: session.lastActivity,
    lastTool: session.lastTool,
    toolCount: session.toolCount,
    totalDurationMs,
    // Include time breakdown if available
    totalWorkingMs: tracking?.accumulatedWorkingMs,
    totalWaitingMs: tracking?.accumulatedWaitingMs,
    totalIdleMs: tracking?.accumulatedIdleMs,
    // Include activity segments for timeline
    segments: tracking?.segments,
    // Include recent tools (up to 5)
    recentTools: session.recentTools?.slice(0, 5),
    // Include token and cost data
    totalTokens: session.totalTokens ?? 0,
    costUsd: session.costUsd ?? 0,
  };

  const history = await loadSessionHistory();

  // Add to beginning (most recent first)
  history.unshift(historicalSession);

  // Clean up old entries (older than 7 days)
  const cutoffTime = now - SESSION_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
  const filteredHistory = history.filter((h) => {
    const endTime = new Date(h.endTime).getTime();
    return endTime > cutoffTime;
  });

  await saveSessionHistory(filteredHistory);
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
        accumulatedWorkingMs: 0,
        accumulatedWaitingMs: 0,
        accumulatedIdleMs: 0,
        segments: [{
          status: session.status,
          startTime: now,
          endTime: now,
        }],
      });
    }
  }

  // Track ended sessions (sessions that were in old but not in new)
  for (const oldSession of oldSessions) {
    if (!newMap.has(oldSession.id)) {
      stats.sessionsEnded++;

      // Aggregate token and cost data from ended session
      stats.totalInputTokens += oldSession.inputTokens ?? 0;
      stats.totalOutputTokens += oldSession.outputTokens ?? 0;
      stats.totalCostUsd += oldSession.costUsd ?? 0;

      // Add remaining time from last known state
      const tracking = sessionStateTracking.get(oldSession.id);
      if (tracking) {
        const timeInState = now - tracking.lastStatusChangeTime;
        switch (tracking.lastStatus) {
          case "working":
            stats.totalWorkingMs += timeInState;
            tracking.accumulatedWorkingMs += timeInState;
            break;
          case "waiting_for_input":
            stats.totalWaitingMs += timeInState;
            tracking.accumulatedWaitingMs += timeInState;
            break;
          case "idle":
            stats.totalIdleMs += timeInState;
            tracking.accumulatedIdleMs += timeInState;
            break;
        }

        // Close the last segment
        const lastSegment = tracking.segments[tracking.segments.length - 1];
        if (lastSegment) {
          lastSegment.endTime = now;
        }

        // Add session to history with accumulated times and segments
        addSessionToHistory(oldSession, tracking).catch((err) => {
          console.error("[Claude Blocker Advanced] Failed to add session to history:", err);
        });

        // Clean up tracking for ended session
        sessionStateTracking.delete(oldSession.id);
      } else {
        // No tracking data, add with just session info
        addSessionToHistory(oldSession).catch((err) => {
          console.error("[Claude Blocker Advanced] Failed to add session to history:", err);
        });
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

        // Update daily stats
        switch (tracking.lastStatus) {
          case "working":
            stats.totalWorkingMs += timeInPreviousState;
            tracking.accumulatedWorkingMs += timeInPreviousState;
            break;
          case "waiting_for_input":
            stats.totalWaitingMs += timeInPreviousState;
            tracking.accumulatedWaitingMs += timeInPreviousState;
            break;
          case "idle":
            stats.totalIdleMs += timeInPreviousState;
            tracking.accumulatedIdleMs += timeInPreviousState;
            break;
        }

        // Close the last segment and start a new one
        const lastSegment = tracking.segments[tracking.segments.length - 1];
        if (lastSegment) {
          lastSegment.endTime = now;
        }
        tracking.segments.push({
          status: newSession.status,
          startTime: now,
          endTime: now,
        });

        // Update tracking with new state
        tracking.lastStatus = newSession.status;
        tracking.lastStatusChangeTime = now;
      } else {
        // Status unchanged - just update the endTime of the last segment
        const lastSegment = tracking.segments[tracking.segments.length - 1];
        if (lastSegment) {
          lastSegment.endTime = now;
        }
      }
    } else if (oldSession) {
      // Session exists but wasn't being tracked (edge case after service worker restart)
      sessionStateTracking.set(newSession.id, {
        lastStatus: newSession.status,
        lastStatusChangeTime: now,
        accumulatedWorkingMs: 0,
        accumulatedWaitingMs: 0,
        accumulatedIdleMs: 0,
        segments: [{
          status: newSession.status,
          startTime: now,
          endTime: now,
        }],
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
  if (changes.soundConfig) {
    soundConfig = { ...DEFAULT_SOUND_CONFIG, ...changes.soundConfig.newValue };
  }
});

// Load sound config from storage on startup
chrome.storage.sync.get(["soundConfig"], (result) => {
  if (result.soundConfig) {
    soundConfig = { ...DEFAULT_SOUND_CONFIG, ...result.soundConfig };
  }
});

// Create offscreen document for audio playback
async function ensureOffscreenDocument(): Promise<boolean> {
  if (offscreenCreated) {
    return true;
  }

  // Check if document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("offscreen.html")],
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return true;
  }

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Play notification sounds",
    });
    offscreenCreated = true;
    console.log("[Claude Blocker Advanced] Offscreen document created for audio");
    return true;
  } catch (error) {
    console.error("[Claude Blocker Advanced] Failed to create offscreen document:", error);
    return false;
  }
}

// Play a sound via the offscreen document
async function playSound(sound: SoundStyle, message?: string): Promise<void> {
  if (!soundConfig.enabled || sound === "none") {
    return;
  }

  // Ensure offscreen document exists
  const ready = await ensureOffscreenDocument();
  if (!ready) {
    console.error("[Claude Blocker Advanced] Cannot play sound - offscreen document not ready");
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: "PLAY_SOUND",
      sound,
      volume: soundConfig.volume,
      message,
    });
    console.log("[Claude Blocker Advanced] Sound played:", sound);
  } catch (error) {
    console.error("[Claude Blocker Advanced] Failed to play sound:", error);
  }
}

// Track notification count for debugging
let notificationCount = 0;

// Send Chrome notification
function sendNotification(title: string, message: string, notificationId?: string): void {
  console.log("[Claude Blocker Advanced] sendNotification called:", {
    title,
    message,
    notificationId,
    enabled: notificationConfig.enabled,
    config: notificationConfig
  });

  if (!notificationConfig.enabled) {
    console.log("[Claude Blocker Advanced] Notification skipped - notifications disabled");
    return;
  }

  const id = notificationId ?? `claude-blocker-advanced-${Date.now()}`;
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icon-128.png",
    title,
    message,
    priority: 1,
    silent: soundConfig.enabled, // Silence Chrome's default sound when we play our own
  }, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error("[Claude Blocker Advanced] Notification failed:", chrome.runtime.lastError);
    } else {
      notificationCount++;
      console.log("[Claude Blocker Advanced] Notification created:", createdId, "Total count:", notificationCount);
    }
  });
}

// Broadcast overlay toast notification to all content scripts
function broadcastOverlayNotification(
  event: "waiting" | "finished" | "disconnected",
  projectName: string,
  message: string
): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "OVERLAY_NOTIFICATION",
          event,
          projectName,
          message,
        }).catch(() => {});
      }
    }
  });
}

// Check for session state changes and send notifications
function checkForNotifications(newSessions: Session[]): void {
  console.log("[Claude Blocker Advanced] checkForNotifications called:", {
    enabled: notificationConfig.enabled,
    newSessionsCount: newSessions.length,
    prevSessionsCount: previousSessions.length,
    newSessions: newSessions.map(s => ({ id: s.id.slice(0, 8), status: s.status, project: s.projectName })),
    prevSessions: previousSessions.map(s => ({ id: s.id.slice(0, 8), status: s.status, project: s.projectName }))
  });

  if (!notificationConfig.enabled) {
    console.log("[Claude Blocker Advanced] Notification check skipped - notifications disabled");
    return;
  }

  // Create maps for easier lookup
  const prevMap = new Map(previousSessions.map((s) => [s.id, s]));
  const newMap = new Map(newSessions.map((s) => [s.id, s]));

  // Check each new session for state changes
  for (const session of newSessions) {
    const prev = prevMap.get(session.id);

    // Session became "waiting_for_input"
    if (
      session.status === "waiting_for_input" &&
      prev?.status !== "waiting_for_input"
    ) {
      const message = `${session.projectName} is waiting for your input`;

      // Broadcast to overlay (always, regardless of notification config)
      broadcastOverlayNotification("waiting", session.projectName, message);

      if (notificationConfig.onWaiting) {
        sendNotification(
          "Claude has a question",
          message,
          `waiting-${session.id}`
        );
      }
      // Play sound based on config
      const soundStyle = soundConfig.perEvent.onWaiting;
      if (soundStyle === "say") {
        playSound(soundStyle, message);
      } else {
        playSound(soundStyle);
      }
    }

    // Session finished working (was working, now idle)
    if (
      session.status === "idle" &&
      prev?.status === "working"
    ) {
      const message = `${session.projectName} has completed its task`;

      // Broadcast to overlay (always, regardless of notification config)
      broadcastOverlayNotification("finished", session.projectName, message);

      if (notificationConfig.onFinished) {
        sendNotification(
          "Claude finished working",
          message,
          `finished-${session.id}`
        );
      }
      // Play sound based on config
      const soundStyle = soundConfig.perEvent.onFinished;
      if (soundStyle === "say") {
        playSound(soundStyle, message);
      } else {
        playSound(soundStyle);
      }
    }
  }

  // Check for disconnected sessions (was in prev, not in new)
  for (const prev of previousSessions) {
    if (!newMap.has(prev.id)) {
      const message = `${prev.projectName} has ended`;

      // Broadcast to overlay (always, regardless of notification config)
      broadcastOverlayNotification("disconnected", prev.projectName, message);

      if (notificationConfig.onDisconnected) {
        sendNotification(
          "Session disconnected",
          message,
          `disconnected-${prev.id}`
        );
      }
      // Play sound based on config
      const soundStyle = soundConfig.perEvent.onDisconnected;
      if (soundStyle === "say") {
        playSound(soundStyle, message);
      } else {
        playSound(soundStyle);
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
      console.log("[Claude Blocker Advanced] Connected");
      state.serverConnected = true;
      wasConnected = true;
      retryCount = 0;
      startKeepalive();
      broadcast();

      // Sync recent stats from server on connect
      syncRecentStats().catch((err) => {
        console.log("[Claude Blocker Advanced] Failed to sync stats on connect:", err);
      });
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
            console.error("[Claude Blocker Advanced] Failed to update stats:", err);
          });

          // Update previous sessions for next comparison
          previousSessions = state.sessions;

          // Now receiving full sessions array from server
          state.sessions = newSessions;
          broadcast();
        }

        // Handle stats update from server
        if (msg.type === "stats_update") {
          // Merge server stats with local data (keep higher values to avoid losing extension-tracked time)
          const serverStats = msg.dailyStats as DailyStats;
          if (serverStats?.date) {
            mergeServerStats(serverStats).catch((err) => {
              console.error("[Claude Blocker Advanced] Failed to merge server stats:", err);
            });
          }
          // Broadcast stats update to any listening tabs
          chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: "STATS_UPDATE",
                  dailyStats: serverStats,
                  backfillProgress: msg.backfillProgress,
                }).catch(() => {});
              }
            }
          });
        }
      } catch {}
    };

    websocket.onclose = () => {
      console.log("[Claude Blocker Advanced] Disconnected");

      // Send notification if we were previously connected
      if (wasConnected && notificationConfig.enabled && notificationConfig.onDisconnected) {
        sendNotification(
          "Server disconnected",
          "Claude Blocker Advanced server is no longer reachable",
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

  if (message.type === "GET_SESSION_HISTORY") {
    loadSessionHistory()
      .then((history) => {
        sendResponse({ success: true, history });
      })
      .catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "TEST_NOTIFICATION") {
    console.log("[Claude Blocker Advanced] Test notification requested");
    // Temporarily enable notifications for the test
    const testId = `test-${Date.now()}`;
    chrome.notifications.create(testId, {
      type: "basic",
      iconUrl: "icon-128.png",
      title: "Test Notification",
      message: "If you see this, notifications are working!",
      priority: 2,
    }, (createdId) => {
      if (chrome.runtime.lastError) {
        console.error("[Claude Blocker Advanced] Test notification failed:", chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log("[Claude Blocker Advanced] Test notification created:", createdId);
        sendResponse({ success: true, notificationId: createdId });
      }
    });
    return true;
  }

  if (message.type === "GET_NOTIFICATION_DEBUG") {
    sendResponse({
      success: true,
      config: notificationConfig,
      soundConfig,
      notificationCount,
      serverConnected: state.serverConnected,
      sessionsCount: state.sessions.length,
      sessions: state.sessions.map(s => ({ id: s.id.slice(0, 8), status: s.status, project: s.projectName }))
    });
    return true;
  }

  if (message.type === "TEST_SOUND") {
    console.log("[Claude Blocker Advanced] Test sound requested:", message.sound);
    playSound(message.sound as SoundStyle, message.message)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  }

  if (message.type === "SYNC_STATS") {
    // Force sync stats from server
    syncRecentStats()
      .then(() => {
        sendResponse({ success: true, serverConnected: state.serverConnected });
      })
      .catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "GET_SERVER_STATUS") {
    sendResponse({
      serverConnected: state.serverConnected,
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
