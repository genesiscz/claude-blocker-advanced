export {};

const MODAL_ID = "claude-blocker-modal";
const TOAST_ID = "claude-blocker-toast";
const OVERLAY_ID = "claude-blocker-overlay";
const DEFAULT_DOMAINS = ["x.com", "youtube.com"];

// Tool call record
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

// Session type from service worker
interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string;
  startTime: string;
  lastTool?: string;
  recentTools: ToolCall[];
  waitingForInputSince?: string;
}

// State shape from service worker
interface PublicState {
  serverConnected: boolean;
  sessions: Session[];
  sessionCount: number;
  working: number;
  waitingForInput: number;
  blocked: boolean;
  bypassActive: boolean;
}

// Overlay config from storage
interface OverlayConfig {
  enabled: boolean;
  scope: "all" | "blocked" | "none";
  style: "pill" | "sidebar" | "dot";
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  opacity: number;
}

const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  enabled: true,
  scope: "all",
  style: "pill",
  position: "top-right",
  opacity: 0.9,
};

// Track current state
let lastKnownState: PublicState | null = null;
let shouldBeBlocked = false;
let blockedDomains: string[] = [];
let toastDismissed = false;
let overlayConfig: OverlayConfig = DEFAULT_OVERLAY_CONFIG;

// Load domains from storage
function loadDomains(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["blockedDomains"], (result) => {
      if (result.blockedDomains && Array.isArray(result.blockedDomains)) {
        resolve(result.blockedDomains);
      } else {
        resolve(DEFAULT_DOMAINS);
      }
    });
  });
}

// Load overlay config from storage
function loadOverlayConfig(): Promise<OverlayConfig> {
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

function isBlockedDomain(): boolean {
  const hostname = window.location.hostname.replace(/^www\./, "");
  return blockedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

// Format duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
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
    const truncated = filename.length > 15 ? filename.slice(0, 12) + "…" : filename;
    return `${name}: ${truncated}`;
  }
  if (input.command) {
    const firstWord = input.command.split(" ")[0];
    return `${name}: ${firstWord}`;
  }
  if (input.pattern) {
    const truncated = input.pattern.length > 10 ? input.pattern.slice(0, 10) + "…" : input.pattern;
    return `${name}: "${truncated}"`;
  }
  return name;
}

// ============ BLOCKING MODAL ============

function getModal(): HTMLElement | null {
  return document.getElementById(MODAL_ID);
}

function getShadow(): ShadowRoot | null {
  return getModal()?.shadowRoot ?? null;
}

function createModal(): void {
  if (getModal()) return;

  const container = document.createElement("div");
  container.id = MODAL_ID;
  const shadow = container.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <div style="all:initial;position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;z-index:2147483647;-webkit-font-smoothing:antialiased;">
      <div style="all:initial;background:#1a1a1a;border:1px solid #333;border-radius:16px;padding:40px;max-width:480px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;">
        <svg style="width:64px;height:64px;margin-bottom:24px;" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="11" width="18" height="11" rx="2" fill="#FFD700" stroke="#B8860B" stroke-width="1"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#888" stroke-width="2" fill="none"/>
        </svg>
        <div style="color:#fff;font-size:24px;font-weight:bold;margin:0 0 16px;line-height:1.2;">Time to Work</div>
        <div id="message" style="color:#888;font-size:16px;line-height:1.5;margin:0 0 24px;font-weight:normal;">Loading...</div>
        <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:#2a2a2a;border-radius:20px;font-size:14px;color:#666;line-height:1;">
          <span id="dot" style="width:8px;height:8px;border-radius:50%;background:#666;flex-shrink:0;"></span>
          <span id="status" style="color:#666;font-size:14px;font-family:Arial,Helvetica,sans-serif;">...</span>
        </div>
        <div id="hint" style="margin-top:24px;font-size:13px;color:#555;line-height:1.4;font-family:Arial,Helvetica,sans-serif;"></div>
        <button id="bypass-btn" style="all:initial;margin-top:24px;padding:12px 24px;background:#333;border:1px solid #444;border-radius:8px;color:#888;font-family:Arial,Helvetica,sans-serif;font-size:13px;cursor:pointer;transition:all 0.2s;">
          Give me 5 minutes (1x per day)
        </button>
      </div>
    </div>
  `;

  // Wire up bypass button
  const bypassBtn = shadow.getElementById("bypass-btn");
  if (bypassBtn) {
    chrome.runtime.sendMessage({ type: "GET_BYPASS_STATUS" }, (status) => {
      if (status?.usedToday) {
        bypassBtn.textContent = "Bypass already used today";
        (bypassBtn as HTMLButtonElement).disabled = true;
        bypassBtn.style.opacity = "0.5";
        bypassBtn.style.cursor = "not-allowed";
      }
    });

    bypassBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "ACTIVATE_BYPASS" }, (response) => {
        if (response?.success) {
          removeModal();
        } else if (response?.reason) {
          bypassBtn.textContent = response.reason;
          (bypassBtn as HTMLButtonElement).disabled = true;
          bypassBtn.style.opacity = "0.5";
          bypassBtn.style.cursor = "not-allowed";
        }
      });
    });

    bypassBtn.addEventListener("mouseenter", () => {
      if (!(bypassBtn as HTMLButtonElement).disabled) {
        bypassBtn.style.background = "#444";
        bypassBtn.style.color = "#aaa";
      }
    });
    bypassBtn.addEventListener("mouseleave", () => {
      bypassBtn.style.background = "#333";
      bypassBtn.style.color = "#888";
    });
  }

  document.documentElement.appendChild(container);
}

function removeModal(): void {
  getModal()?.remove();
}

// ============ TOAST NOTIFICATION ============

function getToast(): HTMLElement | null {
  return document.getElementById(TOAST_ID);
}

function showToast(): void {
  if (getToast() || toastDismissed) return;

  const container = document.createElement("div");
  container.id = TOAST_ID;
  const shadow = container.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <div style="all:initial;position:fixed;bottom:24px;right:24px;background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#fff;z-index:2147483646;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);-webkit-font-smoothing:antialiased;">
      <span style="font-size:18px;">💬</span>
      <span>Claude has a question for you!</span>
      <button id="dismiss" style="all:initial;margin-left:8px;padding:4px 8px;background:#333;border:none;border-radius:6px;color:#888;font-family:Arial,Helvetica,sans-serif;font-size:12px;cursor:pointer;">Dismiss</button>
    </div>
  `;

  const dismissBtn = shadow.getElementById("dismiss");
  dismissBtn?.addEventListener("click", () => {
    toastDismissed = true;
    removeToast();
  });

  document.documentElement.appendChild(container);
}

function removeToast(): void {
  getToast()?.remove();
}

// ============ MINI OVERLAY ============

function getOverlay(): HTMLElement | null {
  return document.getElementById(OVERLAY_ID);
}

function shouldShowOverlay(): boolean {
  if (!overlayConfig.enabled) return false;
  if (overlayConfig.scope === "none") return false;
  if (overlayConfig.scope === "blocked" && !isBlockedDomain()) return false;
  return true;
}

function getPositionStyles(): string {
  const pos = overlayConfig.position;
  const margin = "16px";
  switch (pos) {
    case "top-left":
      return `top:${margin};left:${margin};`;
    case "top-right":
      return `top:${margin};right:${margin};`;
    case "bottom-left":
      return `bottom:${margin};left:${margin};`;
    case "bottom-right":
      return `bottom:${margin};right:${margin};`;
    default:
      return `top:${margin};right:${margin};`;
  }
}

function createOverlay(): void {
  if (getOverlay()) return;

  const container = document.createElement("div");
  container.id = OVERLAY_ID;
  const shadow = container.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      .overlay { all: initial; position: fixed; ${getPositionStyles()} z-index: 2147483645; font-family: Arial, Helvetica, sans-serif; opacity: ${overlayConfig.opacity}; }
      .pill { background: #1a1a1a; border: 1px solid #333; border-radius: 20px; padding: 8px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
      .pill:hover { background: #222; border-color: #444; }
      .pill:hover .sessions-list { display: block; }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .status-dot.working { background: #30d158; box-shadow: 0 0 6px #30d158; }
      .status-dot.waiting { background: #ffd60a; box-shadow: 0 0 6px #ffd60a; animation: pulse 1.5s ease-in-out infinite; }
      .status-dot.idle { background: #666; }
      .status-dot.offline { background: #ff453a; box-shadow: 0 0 6px #ff453a; }
      .label { color: #999; font-size: 12px; font-weight: 500; }
      .sessions-list { display: none; position: absolute; top: 100%; ${overlayConfig.position.includes("right") ? "right" : "left"}: 0; margin-top: 8px; background: #1a1a1a; border: 1px solid #333; border-radius: 12px; min-width: 200px; max-width: 280px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
      .session-item { padding: 10px 12px; border-bottom: 1px solid #2a2a2a; }
      .session-item:last-child { border-bottom: none; }
      .session-header { display: flex; align-items: center; gap: 8px; }
      .session-name { flex: 1; color: #fff; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .session-info { color: #666; font-size: 11px; }
      .session-wait { color: #ffd60a; font-size: 10px; margin-left: 4px; }
      .session-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; margin-left: 16px; }
      .tool-badge { font-size: 10px; padding: 2px 5px; background: #2a2a2a; border-radius: 4px; color: #777; font-family: ui-monospace, monospace; white-space: nowrap; }
      .tool-badge.latest { color: #999; background: #333; }
      .tool-time { font-size: 9px; color: #555; margin-left: 2px; }
      .tool-badge.latest .tool-time { color: #666; }
      .no-sessions { padding: 16px; text-align: center; color: #666; font-size: 12px; }
    </style>
    <div class="overlay">
      <div class="pill">
        <span class="status-dot" id="overlay-dot"></span>
        <span class="label" id="overlay-label">—</span>
        <div class="sessions-list" id="overlay-sessions"></div>
      </div>
    </div>
  `;

  document.documentElement.appendChild(container);
}

function removeOverlay(): void {
  getOverlay()?.remove();
}

function updateOverlay(state: PublicState): void {
  if (!shouldShowOverlay()) {
    removeOverlay();
    return;
  }

  if (!getOverlay()) {
    createOverlay();
  }

  const shadow = getOverlay()?.shadowRoot;
  if (!shadow) return;

  const dot = shadow.getElementById("overlay-dot");
  const label = shadow.getElementById("overlay-label");
  const sessionsList = shadow.getElementById("overlay-sessions");
  if (!dot || !label || !sessionsList) return;

  // Update status dot
  if (!state.serverConnected) {
    dot.className = "status-dot offline";
    label.textContent = "Offline";
  } else if (state.working > 0) {
    dot.className = "status-dot working";
    label.textContent = `${state.working} working`;
  } else if (state.waitingForInput > 0) {
    dot.className = "status-dot waiting";
    label.textContent = "Waiting";
  } else if (state.sessionCount > 0) {
    dot.className = "status-dot idle";
    label.textContent = `${state.sessionCount} idle`;
  } else {
    dot.className = "status-dot idle";
    label.textContent = "No sessions";
  }

  // Update sessions list
  if (state.sessions.length === 0) {
    sessionsList.innerHTML = '<div class="no-sessions">No active sessions</div>';
  } else {
    const now = Date.now();
    const sorted = [...state.sessions].sort((a, b) => {
      const order = { working: 0, waiting_for_input: 1, idle: 2 };
      return order[a.status] - order[b.status];
    });

    sessionsList.innerHTML = sorted
      .map((s) => {
        const uptime = formatDuration(now - new Date(s.startTime).getTime());
        let waitHtml = "";
        if (s.status === "waiting_for_input" && s.waitingForInputSince) {
          const waitTime = formatDuration(now - new Date(s.waitingForInputSince).getTime());
          waitHtml = `<span class="session-wait">⏳ ${waitTime}</span>`;
        }
        const dotClass =
          s.status === "working" ? "working" : s.status === "waiting_for_input" ? "waiting" : "idle";

        // Render recent tools (show up to 3 in overlay for compactness)
        let toolsHtml = "";
        if (s.recentTools && s.recentTools.length > 0) {
          const toolBadges = s.recentTools.slice(0, 3).map((tool, i) => {
            const timeSince = now - new Date(tool.timestamp).getTime();
            const timeStr = formatRelativeTime(timeSince);
            const label = formatToolLabel(tool);
            const latestClass = i === 0 ? "latest" : "";
            return `<span class="tool-badge ${latestClass}">${label}<span class="tool-time">${timeStr}</span></span>`;
          });
          toolsHtml = `<div class="session-tools">${toolBadges.join("")}</div>`;
        }

        return `
          <div class="session-item">
            <div class="session-header">
              <span class="status-dot ${dotClass}"></span>
              <span class="session-name">${s.projectName}</span>
              <span class="session-info">${uptime}${waitHtml}</span>
            </div>
            ${toolsHtml}
          </div>
        `;
      })
      .join("");
  }
}

// ============ MODAL STATE RENDERING ============

function setDotColor(dot: HTMLElement, color: "green" | "red" | "gray"): void {
  const colors = {
    green: "background:#22c55e;box-shadow:0 0 8px #22c55e;",
    red: "background:#ef4444;box-shadow:0 0 8px #ef4444;",
    gray: "background:#666;box-shadow:none;",
  };
  dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;${colors[color]}`;
}

function renderState(state: PublicState): void {
  const shadow = getShadow();
  if (!shadow) return;

  const message = shadow.getElementById("message");
  const dot = shadow.getElementById("dot");
  const status = shadow.getElementById("status");
  const hint = shadow.getElementById("hint");
  if (!message || !dot || !status || !hint) return;

  if (!state.serverConnected) {
    message.textContent = "Server offline. Start the blocker server to continue.";
    setDotColor(dot, "red");
    status.textContent = "Server Offline";
    hint.innerHTML = `Run <span style="background:#2a2a2a;padding:2px 8px;border-radius:4px;font-family:ui-monospace,monospace;font-size:12px;">npx claude-blocker</span> to start`;
  } else if (state.sessionCount === 0) {
    message.textContent = "No Claude Code sessions detected.";
    setDotColor(dot, "green");
    status.textContent = "Waiting for Claude Code";
    hint.textContent = "Open a terminal and start Claude Code";
  } else {
    message.textContent = "Your job finished!";
    setDotColor(dot, "green");
    status.textContent = `${state.sessionCount} session${state.sessionCount > 1 ? "s" : ""} idle`;
    hint.textContent = "Type a prompt in Claude Code to unblock";
  }
}

function renderError(): void {
  const shadow = getShadow();
  if (!shadow) return;

  const message = shadow.getElementById("message");
  const dot = shadow.getElementById("dot");
  const status = shadow.getElementById("status");
  const hint = shadow.getElementById("hint");
  if (!message || !dot || !status || !hint) return;

  message.textContent = "Cannot connect to extension.";
  setDotColor(dot, "red");
  status.textContent = "Extension Error";
  hint.textContent = "Try reloading the extension";
}

// ============ MUTATION OBSERVER ============

function setupMutationObserver(): void {
  const observer = new MutationObserver(() => {
    if (shouldBeBlocked && !getModal()) {
      createModal();
      if (lastKnownState) {
        renderState(lastKnownState);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

// ============ STATE HANDLING ============

function handleState(state: PublicState): void {
  lastKnownState = state;

  // Always update overlay (respects its own scope settings)
  updateOverlay(state);

  if (!isBlockedDomain()) {
    shouldBeBlocked = false;
    removeModal();
    removeToast();
    return;
  }

  // Show toast notification when Claude has a question (non-blocking)
  if (state.waitingForInput > 0) {
    showToast();
  } else {
    toastDismissed = false;
    removeToast();
  }

  // Show blocking modal when truly idle
  if (state.blocked) {
    shouldBeBlocked = true;
    createModal();
    renderState(state);
  } else {
    shouldBeBlocked = false;
    removeModal();
  }
}

function requestState(): void {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      setTimeout(requestState, 500);
      if (isBlockedDomain()) {
        createModal();
        renderError();
      }
      return;
    }
    handleState(response);
  });
}

// ============ MESSAGE LISTENERS ============

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "STATE") {
    handleState(message);
  }
  if (message.type === "DOMAINS_UPDATED") {
    blockedDomains = message.domains;
    if (lastKnownState) {
      handleState(lastKnownState);
    }
  }
  if (message.type === "OVERLAY_CONFIG_UPDATED") {
    overlayConfig = { ...DEFAULT_OVERLAY_CONFIG, ...message.config };
    removeOverlay(); // Recreate with new config
    if (lastKnownState) {
      updateOverlay(lastKnownState);
    }
  }
});

// ============ INITIALIZATION ============

async function init(): Promise<void> {
  blockedDomains = await loadDomains();
  overlayConfig = await loadOverlayConfig();

  // Always set up state listener and request state for overlay
  requestState();

  if (isBlockedDomain()) {
    setupMutationObserver();
    createModal();
  }

  // Refresh overlay periodically to update times
  setInterval(() => {
    if (lastKnownState) {
      updateOverlay(lastKnownState);
    }
  }, 1000);
}

init();
