export {};

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
}

interface PopupState {
  blocked: boolean;
  serverConnected: boolean;
  sessions: Session[];
  sessionCount: number;
  working: number;
  waitingForInput: number;
  bypassActive: boolean;
}

const statusDot = document.getElementById("status-dot") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const blockBadge = document.getElementById("block-badge") as HTMLElement;
const blockStatus = document.getElementById("block-status") as HTMLElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const noSessions = document.getElementById("no-sessions") as HTMLElement;
const sessionsList = document.getElementById("sessions-list") as HTMLElement;

// Format duration from milliseconds
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// Format relative time (e.g., "-30s", "-5m")
function formatRelativeTime(ms: number): string {
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

// Get status dot class
function getStatusClass(status: Session["status"]): string {
  switch (status) {
    case "working":
      return "session-status working";
    case "waiting_for_input":
      return "session-status waiting";
    default:
      return "session-status idle";
  }
}

// Get status label
function getStatusLabel(status: Session["status"]): string {
  switch (status) {
    case "working":
      return "Working";
    case "waiting_for_input":
      return "Waiting";
    default:
      return "Idle";
  }
}

function renderSession(session: Session): HTMLElement {
  const now = Date.now();
  const startTime = new Date(session.startTime).getTime();
  const uptime = now - startTime;

  const el = document.createElement("div");
  el.className = "session-item";

  let waitInfo = "";
  if (session.status === "waiting_for_input" && session.waitingForInputSince) {
    const waitTime = now - new Date(session.waitingForInputSince).getTime();
    const waitClass = waitTime > 300000 ? "wait-long" : waitTime > 120000 ? "wait-medium" : "";
    waitInfo = `<span class="session-wait ${waitClass}">⏳ ${formatDuration(waitTime)}</span>`;
  }

  // Render recent tools with relative timestamps
  let toolsHtml = "";
  if (session.recentTools && session.recentTools.length > 0) {
    const toolBadges = session.recentTools.map((tool, i) => {
      const timeSince = now - new Date(tool.timestamp).getTime();
      const timeStr = formatRelativeTime(timeSince);
      const label = formatToolLabel(tool);
      const latestClass = i === 0 ? "latest" : "";
      return `<span class="tool-badge ${latestClass}" title="${tool.name}">${label} <span class="tool-time">${timeStr}</span></span>`;
    });
    toolsHtml = `<div class="session-tools">${toolBadges.join("")}</div>`;
  }

  el.innerHTML = `
    <div class="session-main">
      <span class="${getStatusClass(session.status)}"></span>
      <span class="session-name">${session.projectName}</span>
      <span class="session-uptime">${formatDuration(uptime)}</span>
    </div>
    <div class="session-details">
      ${waitInfo}
    </div>
    ${toolsHtml}
  `;

  return el;
}

function updateUI(state: PopupState): void {
  // Status indicator
  if (!state.serverConnected) {
    statusDot.className = "status-dot disconnected";
    statusText.textContent = "Offline";
  } else if (state.working > 0) {
    statusDot.className = "status-dot working";
    statusText.textContent = `${state.working} working`;
  } else if (state.waitingForInput > 0) {
    statusDot.className = "status-dot waiting";
    statusText.textContent = "Waiting";
  } else if (state.sessionCount > 0) {
    statusDot.className = "status-dot connected";
    statusText.textContent = `${state.sessionCount} session${state.sessionCount > 1 ? "s" : ""}`;
  } else {
    statusDot.className = "status-dot connected";
    statusText.textContent = "Connected";
  }

  // Block badge
  if (state.bypassActive) {
    blockBadge.className = "block-badge bypass";
    blockStatus.textContent = "Bypass";
  } else if (state.blocked) {
    blockBadge.className = "block-badge blocked";
    blockStatus.textContent = "Blocked";
  } else {
    blockBadge.className = "block-badge open";
    blockStatus.textContent = "Open";
  }

  // Sessions list
  if (state.sessions.length === 0) {
    noSessions.style.display = "flex";
    sessionsList.style.display = "none";
  } else {
    noSessions.style.display = "none";
    sessionsList.style.display = "block";
    sessionsList.innerHTML = "";

    // Sort: working first, then waiting, then idle
    const sorted = [...state.sessions].sort((a, b) => {
      const order = { working: 0, waiting_for_input: 1, idle: 2 };
      return order[a.status] - order[b.status];
    });

    for (const session of sorted) {
      sessionsList.appendChild(renderSession(session));
    }
  }
}

function refreshState(): void {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state: PopupState) => {
    if (state) {
      updateUI(state);
    }
  });
}

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") {
    updateUI(message);
  }
});

refreshState();
// Refresh every second to update uptime/wait counters
setInterval(refreshState, 1000);
