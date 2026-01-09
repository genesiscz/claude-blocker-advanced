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

// Format tool detail info (more verbose for vertical layout)
function formatToolDetail(tool: ToolCall): string {
  const { input } = tool;
  if (!input) return "";

  if (input.file_path) {
    // Show filename with optional path hint
    const parts = input.file_path.split("/");
    if (parts.length > 2) {
      return `…/${parts.slice(-2).join("/")}`;
    }
    return input.file_path;
  }
  if (input.command) {
    // Show first 40 chars of command
    const truncated = input.command.length > 40 ? input.command.slice(0, 40) + "…" : input.command;
    return truncated;
  }
  if (input.pattern) {
    const truncated = input.pattern.length > 30 ? input.pattern.slice(0, 30) + "…" : input.pattern;
    return `"${truncated}"`;
  }
  if (input.description) {
    const truncated = input.description.length > 40 ? input.description.slice(0, 40) + "…" : input.description;
    return truncated;
  }
  return "";
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

const SERVER_URL = "http://localhost:8765";

// Handle copy session ID to clipboard
async function copySessionId(sessionId: string, button: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(sessionId);
    button.classList.add("copied");
    button.title = "Copied!";
    setTimeout(() => {
      button.classList.remove("copied");
      button.title = "Copy session ID";
    }, 1500);
  } catch (error) {
    console.error("Failed to copy:", error);
  }
}

// Handle open in terminal action
async function openInTerminal(cwd: string, sessionId: string): Promise<void> {
  const command = `claude --resume ${sessionId}`;

  // Load terminal config
  const config = await new Promise<{ app?: string }>((resolve) => {
    chrome.storage.sync.get(["terminalConfig"], (result) => {
      resolve(result.terminalConfig || { app: "warp" });
    });
  });

  try {
    const response = await fetch(`${SERVER_URL}/action/open-terminal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: cwd,
        command,
        app: config.app || "warp",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to open terminal: ${response.statusText}`);
    }
  } catch (err) {
    // Fallback: copy full command with cd
    await navigator.clipboard.writeText(`cd "${cwd}" && ${command}`);
    console.log("Terminal action fell back to copying command to clipboard");
  }
}

// Handle open folder action
async function openFolder(cwd: string): Promise<void> {
  try {
    const response = await fetch(`${SERVER_URL}/action/open-finder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cwd }),
    });

    if (!response.ok) {
      throw new Error(`Failed to open folder: ${response.statusText}`);
    }
  } catch (err) {
    console.error("Failed to open folder:", err);
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

  // Render recent tools with vertical layout
  let toolsHtml = "";
  if (session.recentTools && session.recentTools.length > 0) {
    const toolRows = session.recentTools.map((tool, i) => {
      const timeSince = now - new Date(tool.timestamp).getTime();
      const timeStr = formatRelativeTime(timeSince);
      const detail = formatToolDetail(tool);
      const latestClass = i === 0 ? "latest" : "";
      const detailHtml = detail ? `<span class="tool-detail" title="${detail}">${detail}</span>` : "";
      return `<div class="tool-row ${latestClass}">
        <span class="tool-name">${tool.name}</span>
        ${detailHtml}
        <span class="tool-time">${timeStr}</span>
      </div>`;
    });
    toolsHtml = `<div class="session-tools">${toolRows.join("")}</div>`;
  }

  el.innerHTML = `
    <div class="session-main">
      <span class="${getStatusClass(session.status)}"></span>
      <span class="session-name">${session.projectName}</span>
      <span class="session-uptime">${formatDuration(uptime)}</span>
    </div>
    <div class="session-actions">
      <button class="action-btn copy-btn" title="Copy session ID" data-session-id="${session.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      ${session.cwd ? `
        <button class="action-btn folder-btn" title="Open folder" data-cwd="${session.cwd}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="action-btn terminal-btn" title="Open in terminal" data-cwd="${session.cwd}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"/>
            <line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        </button>
      ` : ""}
    </div>
    <div class="session-details">
      ${waitInfo}
    </div>
    ${toolsHtml}
  `;

  // Add event listeners for action buttons
  const copyBtn = el.querySelector(".copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copySessionId(session.id, copyBtn as HTMLElement);
    });
  }

  const folderBtn = el.querySelector(".folder-btn");
  if (folderBtn && session.cwd) {
    folderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openFolder(session.cwd!);
    });
  }

  const terminalBtn = el.querySelector(".terminal-btn");
  if (terminalBtn && session.cwd) {
    terminalBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openInTerminal(session.cwd!, session.id);
    });
  }

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
