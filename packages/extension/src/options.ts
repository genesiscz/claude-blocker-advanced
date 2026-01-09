export {};

const DEFAULT_DOMAINS = ["x.com", "youtube.com"];

interface ToolCall {
  name: string;
  timestamp: string;
  input?: {
    file_path?: string;
    command?: string;
    pattern?: string;
    description?: string;
  };
}

interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string;
  cwd?: string;
  startTime: string;
  lastActivity: string;
  lastTool?: string;
  toolCount: number;
  recentTools: ToolCall[];
  waitingForInputSince?: string;
  // Token tracking
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
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
}

interface ExtensionState {
  blocked: boolean;
  serverConnected: boolean;
  sessions: Session[];
  sessionCount: number;
  working: number;
  waitingForInput: number;
  bypassActive: boolean;
}

interface BypassStatus {
  usedToday: boolean;
  bypassActive: boolean;
  bypassUntil: number | null;
}

interface OverlayConfig {
  enabled: boolean;
  scope: "all" | "blocked" | "none";
  style: "pill" | "sidebar" | "dot";
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  opacity: number;
}

interface NotificationConfig {
  enabled: boolean;
  onWaiting: boolean;
  onFinished: boolean;
  onDisconnected: boolean;
}

// Timeline activity tracking
interface ActivitySegment {
  status: "idle" | "working" | "waiting_for_input";
  startTime: number;
  endTime: number;
}

interface SessionActivity {
  sessionId: string;
  projectName: string;
  segments: ActivitySegment[];
}

type SortMode = "status" | "project" | "activity" | "uptime";
type HistoryFilter = "all" | "today" | "yesterday" | "week";

const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  enabled: true,
  scope: "all",
  style: "pill",
  position: "top-right",
  opacity: 0.9,
};

const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: true,
  onWaiting: true,
  onFinished: true,
  onDisconnected: true,
};

// Timeline constants
const TIMELINE_HOURS = 4; // Show last 4 hours
const TIMELINE_MS = TIMELINE_HOURS * 60 * 60 * 1000;

// Elements
const statusIndicator = document.getElementById("status-indicator") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const sessionsEl = document.getElementById("sessions") as HTMLElement;
const workingEl = document.getElementById("working") as HTMLElement;
const blockStatusEl = document.getElementById("block-status") as HTMLElement;
const addForm = document.getElementById("add-form") as HTMLFormElement;
const domainInput = document.getElementById("domain-input") as HTMLInputElement;
const domainList = document.getElementById("domain-list") as HTMLUListElement;
const siteCount = document.getElementById("site-count") as HTMLElement;
const bypassBtn = document.getElementById("bypass-btn") as HTMLButtonElement;
const bypassText = document.getElementById("bypass-text") as HTMLElement;
const bypassStatus = document.getElementById("bypass-status") as HTMLElement;

// Sessions panel elements
const sessionsList = document.getElementById("sessions-list") as HTMLElement;
const sessionsBadge = document.getElementById("sessions-badge") as HTMLElement;
const sessionSort = document.getElementById("session-sort") as HTMLSelectElement;

// History panel elements
const historyList = document.getElementById("history-list") as HTMLElement;
const historyBadge = document.getElementById("history-badge") as HTMLElement;
const historyFilter = document.getElementById("history-filter") as HTMLSelectElement;

// Timeline elements
const timelineTimeAxis = document.getElementById("timeline-time-axis") as HTMLElement;
const timelineTracks = document.getElementById("timeline-tracks") as HTMLElement;

// Overlay settings elements
const overlayEnabled = document.getElementById("overlay-enabled") as HTMLInputElement;
const overlayScope = document.getElementById("overlay-scope") as HTMLSelectElement;
const overlayPosition = document.getElementById("overlay-position") as HTMLSelectElement;
const overlayOpacity = document.getElementById("overlay-opacity") as HTMLInputElement;
const opacityValue = document.getElementById("opacity-value") as HTMLElement;
const overlayPreview = document.getElementById("overlay-preview") as HTMLElement;

// Notification settings elements
const notificationsEnabled = document.getElementById("notifications-enabled") as HTMLInputElement;
const notifyWaiting = document.getElementById("notify-waiting") as HTMLInputElement;
const notifyFinished = document.getElementById("notify-finished") as HTMLInputElement;
const notifyDisconnected = document.getElementById("notify-disconnected") as HTMLInputElement;

// Tab elements
const tabButtons = document.querySelectorAll(".tab-btn") as NodeListOf<HTMLButtonElement>;
const tabContents = document.querySelectorAll(".tab-content") as NodeListOf<HTMLElement>;

let bypassCountdown: ReturnType<typeof setInterval> | null = null;
let currentDomains: string[] = [];
let currentOverlayConfig: OverlayConfig = DEFAULT_OVERLAY_CONFIG;
let currentNotificationConfig: NotificationConfig = DEFAULT_NOTIFICATION_CONFIG;
let lastSessions: Session[] = [];
let currentSortMode: SortMode = "status";
let currentHistoryFilter: HistoryFilter = "all";
let sessionHistory: HistoricalSession[] = [];

// Activity tracking - maps session ID to activity history
const sessionActivities: Map<string, SessionActivity> = new Map();

// Format duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// Format token count for display
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(tokens);
}

// Format cost for display
function formatCost(usd: number): string {
  if (usd >= 1) {
    return `$${usd.toFixed(2)}`;
  }
  if (usd >= 0.01) {
    return `${(usd * 100).toFixed(1)}¢`;
  }
  if (usd > 0) {
    return `<1¢`;
  }
  return "";
}

// Format time for timeline axis
function formatTimeLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

// Format relative time for history
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Check if same day
  const isToday = date.toDateString() === now.toDateString();

  // Check if yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = formatTimeLabel(date);

  if (diffMinutes < 1) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (isToday) {
    return `Today ${timeStr}`;
  } else if (isYesterday) {
    return `Yesterday ${timeStr}`;
  } else if (diffDays < 7) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `${dayNames[date.getDay()]} ${timeStr}`;
  } else {
    const month = date.toLocaleString("default", { month: "short" });
    const day = date.getDate();
    return `${month} ${day} ${timeStr}`;
  }
}

// Format relative time from ms (e.g., "-30s", "-5m")
function formatToolRelativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `-${hours}h`;
  if (minutes > 0) return `-${minutes}m`;
  return `-${seconds}s`;
}

// Format tool label with truncated input info
function formatToolLabel(tool: ToolCall): string {
  const { name, input } = tool;
  if (!input) return name;

  if (input.file_path) {
    const filename = input.file_path.split("/").pop() ?? input.file_path;
    return `${name}: ${filename}`;
  }
  if (input.command) {
    const firstWord = input.command.split(" ")[0];
    return `${name}: ${firstWord}`;
  }
  if (input.pattern) {
    const truncated = input.pattern.length > 12 ? input.pattern.slice(0, 12) + "…" : input.pattern;
    return `${name}: "${truncated}"`;
  }
  return name;
}

// Get date category for filtering
function getDateCategory(dateString: string): "today" | "yesterday" | "week" | "older" {
  const date = new Date(dateString);
  const now = new Date();

  // Check if same day
  if (date.toDateString() === now.toDateString()) {
    return "today";
  }

  // Check if yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "yesterday";
  }

  // Check if within 7 days
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return "week";
  }

  return "older";
}

// Truncate path for display
function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  // Show first part and last 2 parts
  return `${parts[0]}/.../${parts.slice(-2).join("/")}`;
}

// Load domains from storage
async function loadDomains(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["blockedDomains"], (result) => {
      if (result.blockedDomains && Array.isArray(result.blockedDomains)) {
        resolve(result.blockedDomains);
      } else {
        chrome.storage.sync.set({ blockedDomains: DEFAULT_DOMAINS });
        resolve(DEFAULT_DOMAINS);
      }
    });
  });
}

// Load overlay config from storage
async function loadOverlayConfig(): Promise<OverlayConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["overlayConfig"], (result) => {
      if (result.overlayConfig) {
        resolve({ ...DEFAULT_OVERLAY_CONFIG, ...result.overlayConfig });
      } else {
        resolve(DEFAULT_OVERLAY_CONFIG);
      }
    });
  });
}

// Load notification config from storage
async function loadNotificationConfig(): Promise<NotificationConfig> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["notificationConfig"], (result) => {
      if (result.notificationConfig) {
        resolve({ ...DEFAULT_NOTIFICATION_CONFIG, ...result.notificationConfig });
      } else {
        resolve(DEFAULT_NOTIFICATION_CONFIG);
      }
    });
  });
}

// Load session history from service worker
async function loadSessionHistory(): Promise<HistoricalSession[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_SESSION_HISTORY" }, (response) => {
      if (response?.success && Array.isArray(response.history)) {
        resolve(response.history);
      } else {
        resolve([]);
      }
    });
  });
}

// Save overlay config to storage
async function saveOverlayConfig(config: OverlayConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ overlayConfig: config }, () => {
      // Notify all tabs about the change
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "OVERLAY_CONFIG_UPDATED", config }).catch(() => {});
          }
        }
      });
      resolve();
    });
  });
}

// Save notification config to storage
async function saveNotificationConfig(config: NotificationConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ notificationConfig: config }, resolve);
  });
}

// Save domains to storage
async function saveDomains(domains: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ blockedDomains: domains }, () => {
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "DOMAINS_UPDATED", domains }).catch(() => {});
          }
        }
      });
      resolve();
    });
  });
}

// Normalize domain input
function normalizeDomain(input: string): string {
  let domain = input.toLowerCase().trim();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.replace(/\/.*$/, "");
  return domain;
}

// Validate domain format
function isValidDomain(domain: string): boolean {
  const regex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
  return regex.test(domain);
}

// Render the domain list
function renderDomains(): void {
  domainList.innerHTML = "";
  siteCount.textContent = String(currentDomains.length);

  if (currentDomains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    domainList.appendChild(empty);
    return;
  }

  for (const domain of currentDomains) {
    const li = document.createElement("li");
    li.className = "domain-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "domain-name";
    nameSpan.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.title = "Remove site";
    removeBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
    removeBtn.addEventListener("click", () => removeDomain(domain));

    li.appendChild(nameSpan);
    li.appendChild(removeBtn);
    domainList.appendChild(li);
  }
}

// Sort sessions based on current mode
function sortSessions(sessions: Session[]): Session[] {
  const sorted = [...sessions];

  switch (currentSortMode) {
    case "status": {
      const order = { working: 0, waiting_for_input: 1, idle: 2 };
      return sorted.sort((a, b) => order[a.status] - order[b.status]);
    }
    case "project":
      return sorted.sort((a, b) => a.projectName.localeCompare(b.projectName));
    case "activity":
      return sorted.sort((a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      );
    case "uptime":
      return sorted.sort((a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
    default:
      return sorted;
  }
}

// Filter history based on current filter
function filterHistory(history: HistoricalSession[]): HistoricalSession[] {
  if (currentHistoryFilter === "all") {
    return history;
  }

  return history.filter((session) => {
    const category = getDateCategory(session.endTime);
    switch (currentHistoryFilter) {
      case "today":
        return category === "today";
      case "yesterday":
        return category === "yesterday";
      case "week":
        return category === "today" || category === "yesterday" || category === "week";
      default:
        return true;
    }
  });
}

// Copy session ID to clipboard with feedback
function copySessionId(sessionId: string, button: HTMLButtonElement): void {
  navigator.clipboard.writeText(sessionId).then(() => {
    // Show "Copied!" feedback
    const originalTitle = button.title;
    button.title = "Copied!";
    button.classList.add("copied");
    setTimeout(() => {
      button.title = originalTitle;
      button.classList.remove("copied");
    }, 1500);
  });
}

// Open project folder in Finder via server
async function openProjectFolder(cwd: string): Promise<void> {
  try {
    const response = await fetch("http://localhost:8765/action/open-finder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cwd }),
    });
    if (!response.ok) throw new Error("Failed to open folder");
  } catch {
    // Fallback: copy path to clipboard
    await navigator.clipboard.writeText(cwd);
  }
}

// Update session activity tracking
function updateSessionActivity(session: Session): void {
  const now = Date.now();
  const activity = sessionActivities.get(session.id);

  if (!activity) {
    // New session - create initial activity
    sessionActivities.set(session.id, {
      sessionId: session.id,
      projectName: session.projectName,
      segments: [{
        status: session.status,
        startTime: new Date(session.startTime).getTime(),
        endTime: now,
      }],
    });
    return;
  }

  // Update project name in case it changed
  activity.projectName = session.projectName;

  const lastSegment = activity.segments[activity.segments.length - 1];

  if (lastSegment.status === session.status) {
    // Same status - extend the current segment
    lastSegment.endTime = now;
  } else {
    // Status changed - close current segment and start new one
    lastSegment.endTime = now;
    activity.segments.push({
      status: session.status,
      startTime: now,
      endTime: now,
    });
  }

  // Clean up old segments (older than timeline window)
  const cutoff = now - TIMELINE_MS;
  activity.segments = activity.segments.filter(seg => seg.endTime > cutoff);

  // Adjust start time of first segment if it starts before cutoff
  if (activity.segments.length > 0 && activity.segments[0].startTime < cutoff) {
    activity.segments[0].startTime = cutoff;
  }
}

// Render timeline time axis
function renderTimelineAxis(): void {
  const now = Date.now();
  const startTime = now - TIMELINE_MS;

  // Create 5 time labels (every hour for 4 hours)
  const labels: string[] = [];
  for (let i = 0; i <= TIMELINE_HOURS; i++) {
    const time = new Date(startTime + (i * 60 * 60 * 1000));
    labels.push(formatTimeLabel(time));
  }

  timelineTimeAxis.innerHTML = labels
    .map(label => `<span class="timeline-time-label">${label}</span>`)
    .join("");
}

// Render timeline for all sessions
function renderTimeline(sessions: Session[]): void {
  // Update activity tracking for all sessions
  for (const session of sessions) {
    updateSessionActivity(session);
  }

  // Clean up activities for sessions that no longer exist
  const activeSessionIds = new Set(sessions.map(s => s.id));
  for (const [sessionId, activity] of sessionActivities) {
    if (!activeSessionIds.has(sessionId)) {
      // Keep ended sessions for a bit to show their final state
      const lastSegment = activity.segments[activity.segments.length - 1];
      if (lastSegment) {
        lastSegment.endTime = Date.now();
      }
    }
  }

  // Render time axis
  renderTimelineAxis();

  // Get activities to render (active sessions + recently ended)
  const now = Date.now();
  const cutoff = now - TIMELINE_MS;
  const activitiesToRender: SessionActivity[] = [];

  for (const activity of sessionActivities.values()) {
    // Include if has segments within timeline window
    const hasRecentActivity = activity.segments.some(seg => seg.endTime > cutoff);
    if (hasRecentActivity) {
      activitiesToRender.push(activity);
    }
  }

  if (activitiesToRender.length === 0) {
    timelineTracks.innerHTML = '<div class="no-timeline">No activity to display</div>';
    return;
  }

  // Sort by project name
  activitiesToRender.sort((a, b) => a.projectName.localeCompare(b.projectName));

  // Render tracks
  timelineTracks.innerHTML = activitiesToRender.map(activity => {
    // Calculate total duration
    const totalDuration = activity.segments.reduce((sum, seg) => {
      const segStart = Math.max(seg.startTime, cutoff);
      const segEnd = Math.min(seg.endTime, now);
      return sum + Math.max(0, segEnd - segStart);
    }, 0);

    // Render segments
    const segmentsHtml = activity.segments.map(seg => {
      const segStart = Math.max(seg.startTime, cutoff);
      const segEnd = Math.min(seg.endTime, now);
      const duration = segEnd - segStart;

      if (duration <= 0) return "";

      // Calculate position and width as percentage of timeline
      const leftPercent = ((segStart - cutoff) / TIMELINE_MS) * 100;
      const widthPercent = (duration / TIMELINE_MS) * 100;

      const statusClass = seg.status === "waiting_for_input" ? "waiting" : seg.status;
      const durationText = formatDuration(duration);

      return `
        <div class="timeline-segment ${statusClass}"
             style="position: absolute; left: ${leftPercent}%; width: ${widthPercent}%;"
             title="${statusClass}: ${durationText}">
          <span class="timeline-segment-tooltip">${statusClass}: ${durationText}</span>
        </div>
      `;
    }).join("");

    return `
      <div class="timeline-track">
        <div class="timeline-track-label">
          <span class="track-project">${activity.projectName}</span>
          <span class="track-duration">${formatDuration(totalDuration)}</span>
        </div>
        <div class="timeline-bar">
          ${segmentsHtml}
        </div>
      </div>
    `;
  }).join("");
}

// Render sessions list
function renderSessions(sessions: Session[]): void {
  lastSessions = sessions;

  // Update badge
  sessionsBadge.textContent = String(sessions.length);
  if (sessions.length > 0) {
    sessionsBadge.classList.add("has-sessions");
  } else {
    sessionsBadge.classList.remove("has-sessions");
  }

  if (sessions.length === 0) {
    sessionsList.innerHTML = '<div class="no-sessions">No active sessions</div>';
    renderTimeline([]);
    return;
  }

  const now = Date.now();
  const sorted = sortSessions(sessions);

  sessionsList.innerHTML = sorted.map((session, index) => {
    const uptime = formatDuration(now - new Date(session.startTime).getTime());
    const dotClass = session.status === "working" ? "working"
      : session.status === "waiting_for_input" ? "waiting" : "idle";

    let waitHtml = "";
    if (session.status === "waiting_for_input" && session.waitingForInputSince) {
      const waitTime = now - new Date(session.waitingForInputSince).getTime();
      const waitClass = waitTime > 300000 ? "long" : "";
      waitHtml = `<span class="waiting-time ${waitClass}">Waiting ${formatDuration(waitTime)}</span>`;
    }

    // Render recent tools with relative timestamps
    let toolsHtml = "";
    if (session.recentTools && session.recentTools.length > 0) {
      const toolBadges = session.recentTools.map((tool, i) => {
        const timeSince = now - new Date(tool.timestamp).getTime();
        const timeStr = formatToolRelativeTime(timeSince);
        const label = formatToolLabel(tool);
        const latestClass = i === 0 ? "latest" : "";
        return `<span class="tool-badge ${latestClass}" title="${tool.name}">${label} <span class="tool-time">${timeStr}</span></span>`;
      });
      toolsHtml = `<div class="session-tools">${toolBadges.join("")}</div>`;
    }

    // Add cwd display if available
    const cwdHtml = session.cwd
      ? `<div class="session-cwd" title="${session.cwd}">${truncatePath(session.cwd)}</div>`
      : "";

    // Quick action buttons
    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`;

    const folderIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`;

    const actionsHtml = `
      <div class="session-actions">
        <button class="session-action-btn copy-id-btn" data-session-index="${index}" title="Copy full session ID">
          ${copyIcon}
        </button>
        ${session.cwd ? `
        <button class="session-action-btn open-folder-btn" data-session-index="${index}" title="Open in Finder">
          ${folderIcon}
        </button>
        ` : ""}
      </div>
    `;

    // Token display (only show if tokens > 0)
    const hasTokens = session.totalTokens > 0;
    const tokenTitle = hasTokens
      ? `Input: ${formatTokens(session.inputTokens)} | Output: ${formatTokens(session.outputTokens)}${session.costUsd > 0 ? ` | Cost: ${formatCost(session.costUsd)}` : ""}`
      : "No token data";
    const tokenHtml = hasTokens
      ? `<span class="session-tokens" title="${tokenTitle}">${formatTokens(session.totalTokens)} tok</span>`
      : "";

    return `
      <div class="session-card">
        <span class="session-dot ${dotClass}"></span>
        <div class="session-info">
          <div class="session-name">${session.projectName}</div>
          ${cwdHtml}
          <div class="session-meta">
            <span>${uptime}</span>
            ${waitHtml}
            ${tokenHtml}
          </div>
          ${toolsHtml}
        </div>
        ${actionsHtml}
        <span class="session-id" title="Click to copy">${session.id.substring(0, 8)}</span>
      </div>
    `;
  }).join("");

  // Add click handlers for quick action buttons
  sessionsList.querySelectorAll(".copy-id-btn").forEach((btn) => {
    const button = btn as HTMLButtonElement;
    const index = parseInt(button.dataset.sessionIndex || "0", 10);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      copySessionId(sorted[index].id, button);
    });
  });

  sessionsList.querySelectorAll(".open-folder-btn").forEach((btn) => {
    const button = btn as HTMLButtonElement;
    const index = parseInt(button.dataset.sessionIndex || "0", 10);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const session = sorted[index];
      if (session.cwd) {
        openProjectFolder(session.cwd);
      }
    });
  });

  // Add click to copy session ID (existing functionality)
  sessionsList.querySelectorAll(".session-id").forEach((el, i) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText(sorted[i].id);
      el.textContent = "Copied!";
      setTimeout(() => {
        el.textContent = sorted[i].id.substring(0, 8);
      }, 1000);
    });
  });

  // Render timeline
  renderTimeline(sessions);
}

// Render history list
function renderHistory(): void {
  const filtered = filterHistory(sessionHistory);

  // Update badge
  historyBadge.textContent = String(sessionHistory.length);
  if (sessionHistory.length > 0) {
    historyBadge.classList.add("has-sessions");
  } else {
    historyBadge.classList.remove("has-sessions");
  }

  if (filtered.length === 0) {
    if (sessionHistory.length === 0) {
      historyList.innerHTML = '<div class="no-history">No session history yet</div>';
    } else {
      historyList.innerHTML = '<div class="no-history">No sessions match the selected filter</div>';
    }
    return;
  }

  historyList.innerHTML = filtered.map((session, index) => {
    const duration = formatDuration(session.totalDurationMs);
    const endTimeRelative = formatRelativeTime(session.endTime);

    // Add cwd display if available
    const cwdHtml = session.cwd
      ? `<div class="history-cwd" title="${session.cwd}">${truncatePath(session.cwd)}</div>`
      : "";

    // Quick action buttons
    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`;

    const folderIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`;

    const actionsHtml = `
      <div class="history-actions">
        <button class="history-action-btn copy-history-id-btn" data-history-index="${index}" title="Copy full session ID">
          ${copyIcon}
        </button>
        ${session.cwd ? `
        <button class="history-action-btn open-history-folder-btn" data-history-index="${index}" title="Open in Finder">
          ${folderIcon}
        </button>
        ` : ""}
      </div>
    `;

    const toolHtml = session.lastTool
      ? `<span class="history-tool">${session.lastTool}</span>` : "";

    return `
      <div class="history-card">
        <div class="history-info">
          <div class="history-name">${session.projectName}</div>
          ${cwdHtml}
          <div class="history-meta">
            <span class="history-time">${endTimeRelative}</span>
            <span class="history-duration">${duration}</span>
            ${toolHtml}
          </div>
        </div>
        ${actionsHtml}
        <span class="history-id" title="Click to copy">${session.id.substring(0, 8)}</span>
      </div>
    `;
  }).join("");

  // Add click handlers for quick action buttons
  historyList.querySelectorAll(".copy-history-id-btn").forEach((btn) => {
    const button = btn as HTMLButtonElement;
    const index = parseInt(button.dataset.historyIndex || "0", 10);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      copySessionId(filtered[index].id, button);
    });
  });

  historyList.querySelectorAll(".open-history-folder-btn").forEach((btn) => {
    const button = btn as HTMLButtonElement;
    const index = parseInt(button.dataset.historyIndex || "0", 10);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const session = filtered[index];
      if (session.cwd) {
        openProjectFolder(session.cwd);
      }
    });
  });

  // Add click to copy session ID
  historyList.querySelectorAll(".history-id").forEach((el, i) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText(filtered[i].id);
      el.textContent = "Copied!";
      setTimeout(() => {
        el.textContent = filtered[i].id.substring(0, 8);
      }, 1000);
    });
  });
}

// Update overlay settings UI
function updateOverlaySettingsUI(): void {
  overlayEnabled.checked = currentOverlayConfig.enabled;
  overlayScope.value = currentOverlayConfig.scope;
  overlayPosition.value = currentOverlayConfig.position;
  overlayOpacity.value = String(currentOverlayConfig.opacity);
  opacityValue.textContent = `${Math.round(currentOverlayConfig.opacity * 100)}%`;
  updatePreviewPosition();
}

// Update notification settings UI
function updateNotificationSettingsUI(): void {
  notificationsEnabled.checked = currentNotificationConfig.enabled;
  notifyWaiting.checked = currentNotificationConfig.onWaiting;
  notifyFinished.checked = currentNotificationConfig.onFinished;
  notifyDisconnected.checked = currentNotificationConfig.onDisconnected;
  updateSubTogglesState();
}

// Update sub-toggles disabled state based on master toggle
function updateSubTogglesState(): void {
  const subToggles = [notifyWaiting, notifyFinished, notifyDisconnected];
  const enabled = notificationsEnabled.checked;

  for (const toggle of subToggles) {
    const row = toggle.closest(".toggle-row");
    if (row) {
      if (enabled) {
        row.classList.remove("disabled");
      } else {
        row.classList.add("disabled");
      }
    }
  }
}

// Update preview position based on settings
function updatePreviewPosition(): void {
  const preview = overlayPreview.querySelector(".preview-overlay") as HTMLElement;
  if (!preview) return;

  // Reset all positions
  preview.style.top = "";
  preview.style.bottom = "";
  preview.style.left = "";
  preview.style.right = "";

  const pos = currentOverlayConfig.position;
  if (pos.includes("top")) preview.style.top = "16px";
  if (pos.includes("bottom")) preview.style.bottom = "16px";
  if (pos.includes("left")) preview.style.left = "16px";
  if (pos.includes("right")) preview.style.right = "16px";

  preview.style.opacity = String(currentOverlayConfig.opacity);
}

// Handle overlay settings changes
async function handleOverlayChange(): Promise<void> {
  currentOverlayConfig = {
    enabled: overlayEnabled.checked,
    scope: overlayScope.value as OverlayConfig["scope"],
    style: "pill", // Only pill style for now
    position: overlayPosition.value as OverlayConfig["position"],
    opacity: parseFloat(overlayOpacity.value),
  };

  opacityValue.textContent = `${Math.round(currentOverlayConfig.opacity * 100)}%`;
  updatePreviewPosition();
  await saveOverlayConfig(currentOverlayConfig);
}

// Handle notification settings changes
async function handleNotificationChange(): Promise<void> {
  currentNotificationConfig = {
    enabled: notificationsEnabled.checked,
    onWaiting: notifyWaiting.checked,
    onFinished: notifyFinished.checked,
    onDisconnected: notifyDisconnected.checked,
  };

  updateSubTogglesState();
  await saveNotificationConfig(currentNotificationConfig);
}

// Add a domain
async function addDomain(raw: string): Promise<void> {
  const domain = normalizeDomain(raw);

  if (!domain) return;

  if (!isValidDomain(domain)) {
    domainInput.classList.add("error");
    setTimeout(() => domainInput.classList.remove("error"), 400);
    return;
  }

  if (currentDomains.includes(domain)) {
    domainInput.value = "";
    return;
  }

  currentDomains.push(domain);
  currentDomains.sort();
  await saveDomains(currentDomains);
  renderDomains();
  domainInput.value = "";
}

// Remove a domain
async function removeDomain(domain: string): Promise<void> {
  currentDomains = currentDomains.filter((d) => d !== domain);
  await saveDomains(currentDomains);
  renderDomains();
}

// Update UI with extension state
function updateUI(state: ExtensionState): void {
  // Status badge
  if (!state.serverConnected) {
    statusIndicator.className = "status-indicator disconnected";
    statusText.textContent = "Offline";
  } else if (state.working > 0) {
    statusIndicator.className = "status-indicator working";
    statusText.textContent = "Claude Working";
  } else {
    statusIndicator.className = "status-indicator connected";
    statusText.textContent = "Connected";
  }

  // Stats
  sessionsEl.textContent = String(state.sessionCount);
  workingEl.textContent = String(state.working);

  // Block status
  if (state.bypassActive) {
    blockStatusEl.textContent = "Bypassed";
    blockStatusEl.style.color = "var(--accent-amber)";
  } else if (state.blocked) {
    blockStatusEl.textContent = "Blocking";
    blockStatusEl.style.color = "var(--accent-red)";
  } else {
    blockStatusEl.textContent = "Open";
    blockStatusEl.style.color = "var(--accent-green)";
  }

  // Sessions list
  if (state.sessions) {
    renderSessions(state.sessions);
  }
}

// Update bypass button state
function updateBypassButton(status: BypassStatus): void {
  if (bypassCountdown) {
    clearInterval(bypassCountdown);
    bypassCountdown = null;
  }

  if (status.bypassActive && status.bypassUntil) {
    bypassBtn.disabled = true;
    bypassBtn.classList.add("active");

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((status.bypassUntil! - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      bypassText.textContent = `Bypass Active - ${minutes}:${seconds.toString().padStart(2, "0")}`;

      if (remaining <= 0) {
        if (bypassCountdown) clearInterval(bypassCountdown);
        refreshState();
      }
    };

    updateCountdown();
    bypassCountdown = setInterval(updateCountdown, 1000);
    bypassStatus.textContent = "Bypass will expire soon";
  } else if (status.usedToday) {
    bypassBtn.disabled = true;
    bypassBtn.classList.remove("active");
    bypassText.textContent = "Bypass Used Today";
    bypassStatus.textContent = "Resets at midnight";
  } else {
    bypassBtn.disabled = false;
    bypassBtn.classList.remove("active");
    bypassText.textContent = "Activate Bypass";
    bypassStatus.textContent = "5 minutes of unblocked access, once per day";
  }
}

// Refresh state from service worker
function refreshState(): void {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state: ExtensionState) => {
    if (state) {
      updateUI(state);
    }
  });

  chrome.runtime.sendMessage({ type: "GET_BYPASS_STATUS" }, (status: BypassStatus) => {
    if (status) {
      updateBypassButton(status);
    }
  });
}

// Refresh history from service worker
async function refreshHistory(): Promise<void> {
  sessionHistory = await loadSessionHistory();
  renderHistory();
}

// Tab switching
function switchTab(tabName: string): void {
  // Update buttons
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Update content
  tabContents.forEach(content => {
    if (content.id === `tab-${tabName}`) {
      content.classList.add("active");
    } else {
      content.classList.remove("active");
    }
  });

  // Refresh history when switching to history tab
  if (tabName === "history") {
    refreshHistory();
  }
}

// Event listeners
addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addDomain(domainInput.value);
});

bypassBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "ACTIVATE_BYPASS" }, (response) => {
    if (response?.success) {
      refreshState();
    } else if (response?.reason) {
      bypassStatus.textContent = response.reason;
    }
  });
});

// Tab event listeners
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    if (tabName) {
      switchTab(tabName);
    }
  });
});

// Session sort event listener
sessionSort.addEventListener("change", () => {
  currentSortMode = sessionSort.value as SortMode;
  if (lastSessions.length > 0) {
    renderSessions(lastSessions);
  }
});

// History filter event listener
historyFilter.addEventListener("change", () => {
  currentHistoryFilter = historyFilter.value as HistoryFilter;
  renderHistory();
});

// Overlay settings event listeners
overlayEnabled.addEventListener("change", handleOverlayChange);
overlayScope.addEventListener("change", handleOverlayChange);
overlayPosition.addEventListener("change", handleOverlayChange);
overlayOpacity.addEventListener("input", handleOverlayChange);

// Notification settings event listeners
notificationsEnabled.addEventListener("change", handleNotificationChange);
notifyWaiting.addEventListener("change", handleNotificationChange);
notifyFinished.addEventListener("change", handleNotificationChange);
notifyDisconnected.addEventListener("change", handleNotificationChange);

// Listen for state broadcasts
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") {
    updateUI(message);
  }
});

// Initialize
async function init(): Promise<void> {
  currentDomains = await loadDomains();
  currentOverlayConfig = await loadOverlayConfig();
  currentNotificationConfig = await loadNotificationConfig();
  sessionHistory = await loadSessionHistory();

  renderDomains();
  updateOverlaySettingsUI();
  updateNotificationSettingsUI();
  renderTimelineAxis(); // Initialize timeline axis
  renderHistory(); // Initialize history list
  refreshState();
}

init();

// Refresh periodically
setInterval(refreshState, 1000);
