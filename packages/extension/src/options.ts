export {};

const DEFAULT_DOMAINS = ["x.com", "youtube.com"];

interface Session {
  id: string;
  status: "idle" | "working" | "waiting_for_input";
  projectName: string;
  startTime: string;
  lastActivity: string;
  lastTool?: string;
  toolCount: number;
  waitingForInputSince?: string;
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

const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  enabled: true,
  scope: "all",
  style: "pill",
  position: "top-right",
  opacity: 0.9,
};

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

// Overlay settings elements
const overlayEnabled = document.getElementById("overlay-enabled") as HTMLInputElement;
const overlayScope = document.getElementById("overlay-scope") as HTMLSelectElement;
const overlayPosition = document.getElementById("overlay-position") as HTMLSelectElement;
const overlayOpacity = document.getElementById("overlay-opacity") as HTMLInputElement;
const opacityValue = document.getElementById("opacity-value") as HTMLElement;
const overlayPreview = document.getElementById("overlay-preview") as HTMLElement;

let bypassCountdown: ReturnType<typeof setInterval> | null = null;
let currentDomains: string[] = [];
let currentOverlayConfig: OverlayConfig = DEFAULT_OVERLAY_CONFIG;
let lastSessions: Session[] = [];

// Format duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
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

// Render sessions list
function renderSessions(sessions: Session[]): void {
  lastSessions = sessions;

  if (sessions.length === 0) {
    sessionsList.innerHTML = '<div class="no-sessions">No active sessions</div>';
    return;
  }

  const now = Date.now();
  const sorted = [...sessions].sort((a, b) => {
    const order = { working: 0, waiting_for_input: 1, idle: 2 };
    return order[a.status] - order[b.status];
  });

  sessionsList.innerHTML = sorted.map(session => {
    const uptime = formatDuration(now - new Date(session.startTime).getTime());
    const dotClass = session.status === "working" ? "working"
      : session.status === "waiting_for_input" ? "waiting" : "idle";

    let waitHtml = "";
    if (session.status === "waiting_for_input" && session.waitingForInputSince) {
      const waitTime = now - new Date(session.waitingForInputSince).getTime();
      const waitClass = waitTime > 300000 ? "long" : "";
      waitHtml = `<span class="waiting-time ${waitClass}">Waiting ${formatDuration(waitTime)}</span>`;
    }

    const toolHtml = session.lastTool
      ? `<span class="session-tool">${session.lastTool}</span>` : "";

    return `
      <div class="session-card">
        <span class="session-dot ${dotClass}"></span>
        <div class="session-info">
          <div class="session-name">${session.projectName}</div>
          <div class="session-meta">
            <span>${uptime}</span>
            ${waitHtml}
          </div>
        </div>
        ${toolHtml}
        <span class="session-id" title="Click to copy">${session.id.substring(0, 8)}</span>
      </div>
    `;
  }).join("");

  // Add click to copy session ID
  sessionsList.querySelectorAll(".session-id").forEach((el, i) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText(sorted[i].id);
      el.textContent = "Copied!";
      setTimeout(() => {
        el.textContent = sorted[i].id.substring(0, 8);
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
      bypassText.textContent = `Bypass Active · ${minutes}:${seconds.toString().padStart(2, "0")}`;

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

// Overlay settings event listeners
overlayEnabled.addEventListener("change", handleOverlayChange);
overlayScope.addEventListener("change", handleOverlayChange);
overlayPosition.addEventListener("change", handleOverlayChange);
overlayOpacity.addEventListener("input", handleOverlayChange);

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

  renderDomains();
  updateOverlaySettingsUI();
  refreshState();
}

init();

// Refresh periodically
setInterval(refreshState, 1000);
