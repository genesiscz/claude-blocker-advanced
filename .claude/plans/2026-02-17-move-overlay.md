# Move Overlay Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a double-click context menu to the overlay pill that lets users move it to a different corner or open the statistics page, without overlapping the sessions dropdown.

**Architecture:** The context menu lives inside the overlay's existing shadow DOM (appended to `.pill-wrapper`). It opens **horizontally to the side** of the pill (right for left-anchored pills, left for right-anchored pills) so it never overlaps the sessions list which opens vertically. Clicking a position saves to `chrome.storage.sync`, broadcasts `OVERLAY_CONFIG_UPDATED`, and shows a toast. "Statistics" opens `options.html#stats` via `chrome.tabs.create`. Hash-based tab routing is added to `options.ts`.

**Tech Stack:** TypeScript, Chrome Extension MV3, Shadow DOM, `chrome.storage.sync`, `chrome.tabs.create`

---

### Task 1: Add hash-based tab routing to options.ts

**Files:**
- Modify: `packages/extension/src/options.ts`

**Step 1: Find the tab event listeners block**

Search for the `tabButtons.forEach` event listener block (around line 2674). It looks like:

```typescript
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    if (tabName) {
      switchTab(tabName);
    }
  });
});
```

**Step 2: Add hash routing right after that block**

```typescript
// Hash-based tab routing — e.g. options.html#stats selects the Stats tab
function activateTabFromHash(): void {
  const hash = window.location.hash.replace("#", "");
  const validTabs = ["sessions", "history", "stats", "settings", "about"];
  if (hash && validTabs.includes(hash)) {
    switchTab(hash);
  }
}
activateTabFromHash();
window.addEventListener("hashchange", activateTabFromHash);
```

**Step 3: Build and verify**

```bash
cd packages/extension && bun run build
```

Open `dist/options.html#stats` in a browser — Stats tab should be active on load.

---

### Task 2: Add context menu CSS + HTML to the overlay shadow DOM

**Files:**
- Modify: `packages/extension/src/content-script.ts`

**Step 1: Find `createOverlay()` (around line 306)**

The function builds `shadow.innerHTML` with a `<style>` block and HTML. We'll add to both.

**Step 2: Append these CSS rules inside the `<style>` block** (before the closing `</style>`):

```css
.pill { user-select: none; }
.context-menu {
  display: none; position: absolute; background: #1a1a1a;
  border: 1px solid #333; border-radius: 12px; overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5); min-width: 160px; z-index: 2;
}
.context-menu.open { display: block; }
.context-menu-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  cursor: pointer; font-size: 12px; color: #999; transition: background 0.15s, color 0.15s;
  white-space: nowrap; border: none; background: none; width: 100%; text-align: left;
  font-family: Arial, Helvetica, sans-serif; box-sizing: border-box;
}
.context-menu-item:hover { background: #252525; color: #fff; }
.context-menu-item .menu-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
.context-menu-separator { height: 1px; background: #2a2a2a; margin: 4px 0; }
.pill-wrapper.menu-open .sessions-list { display: none !important; }
```

The last rule hides the hover-based sessions list while the context menu is open.

**Step 3: Update the HTML inside `shadow.innerHTML`**

Current HTML (after `</style>`):
```html
<div class="overlay">
  <div class="pill-wrapper">
    <div class="pill">
      <span class="status-dot" id="overlay-dot"></span>
      <span class="label" id="overlay-label">—</span>
    </div>
    <div class="sessions-list" id="overlay-sessions"></div>
  </div>
</div>
```

Replace with (adds `id` attributes and the context menu div):
```html
<div class="overlay">
  <div class="pill-wrapper" id="pill-wrapper">
    <div class="pill" id="overlay-pill">
      <span class="status-dot" id="overlay-dot"></span>
      <span class="label" id="overlay-label">—</span>
    </div>
    <div class="sessions-list" id="overlay-sessions"></div>
    <div class="context-menu" id="overlay-context-menu"></div>
  </div>
</div>
```

**Step 4: Build to verify no syntax errors**

```bash
cd packages/extension && bun run build
```

---

### Task 3: Add position constants and context menu logic to content-script.ts

**Files:**
- Modify: `packages/extension/src/content-script.ts`

**Step 1: Add position constants after the `OverlayConfig` interface (around line 53)**

```typescript
type OverlayPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const POSITION_ICONS: Record<OverlayPosition, string> = {
  "top-left": "↖",
  "top-right": "↗",
  "bottom-left": "↙",
  "bottom-right": "↘",
};

const POSITION_LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top Left",
  "top-right": "Top Right",
  "bottom-left": "Bottom Left",
  "bottom-right": "Bottom Right",
};

// Clockwise order used for rendering menu items
const ALL_POSITIONS: OverlayPosition[] = ["top-left", "top-right", "bottom-right", "bottom-left"];
```

**Step 2: Add `getContextMenuStyles()` helper after `getSessionsListPositionStyles()` (around line 304)**

The context menu opens **to the side** of the pill (so it never overlaps the sessions list which opens vertically).
- Left-anchored pill → menu opens to the right: `left: 100%; margin-left: 4px`
- Right-anchored pill → menu opens to the left: `right: 100%; margin-right: 4px`
- Vertically it aligns to the near edge of the pill.

```typescript
function getContextMenuStyles(): string {
  const pos = overlayConfig.position;
  const isRight = pos.includes("right");
  const isBottom = pos.includes("bottom");
  const h = isRight ? "right: 100%; margin-right: 4px;" : "left: 100%; margin-left: 4px;";
  const v = isBottom ? "bottom: 0;" : "top: 0;";
  return `${h} ${v}`;
}
```

**Step 3: Add `savePosition()` helper (add after `getContextMenuStyles()`)**

This persists a new position and notifies all content scripts:

```typescript
function savePosition(newPos: OverlayPosition): void {
  overlayConfig = { ...overlayConfig, position: newPos };
  chrome.storage.sync.get(["overlayConfig"], (result) => {
    const updated = { ...(result.overlayConfig || {}), position: newPos };
    chrome.storage.sync.set({ overlayConfig: updated });
  });
  // Notify all tabs (service worker will broadcast OVERLAY_CONFIG_UPDATED)
  chrome.runtime.sendMessage({ type: "SAVE_OVERLAY_CONFIG", config: overlayConfig });
}
```

Wait — we need to check if `SAVE_OVERLAY_CONFIG` is handled by service-worker. Let me check what message types exist. If not, we can just write directly to storage and then remove+recreate the overlay.

Actually, the simplest approach that definitely works without needing service-worker changes: write to storage directly from content script, then trigger local recreate. Other tabs will pick it up on their next storage read or when they receive state updates. But other open tabs won't update immediately.

Better approach: check how `OVERLAY_CONFIG_UPDATED` is currently triggered (from options.ts save). Let's use the same path — save to storage directly and dispatch `OVERLAY_CONFIG_UPDATED` to ourselves, since we're already listening for it in the content script message listener.

```typescript
function savePosition(newPos: OverlayPosition): void {
  overlayConfig = { ...overlayConfig, position: newPos };
  // Persist to storage
  chrome.storage.sync.get(["overlayConfig"], (result) => {
    const updated = { ...(result.overlayConfig ?? {}), position: newPos };
    chrome.storage.sync.set({ overlayConfig: updated });
  });
  // Re-render immediately on this tab
  removeOverlay();
  if (lastKnownState) updateOverlay(lastKnownState);
  // Broadcast to other tabs via service worker
  chrome.runtime.sendMessage({ type: "BROADCAST_OVERLAY_CONFIG", config: overlayConfig });
}
```

We'll need to check if `BROADCAST_OVERLAY_CONFIG` is handled in service-worker, or add it. See Task 4.

**Step 4: Add `setupContextMenu()` function**

Add this function after `createOverlay()` (around line 368):

```typescript
function setupContextMenu(): void {
  const shadow = getOverlay()?.shadowRoot;
  if (!shadow) return;

  const pill = shadow.getElementById("overlay-pill");
  const wrapper = shadow.getElementById("pill-wrapper");
  const menu = shadow.getElementById("overlay-context-menu") as HTMLElement;
  if (!pill || !wrapper || !menu) return;

  // Apply position styles (recalculated each time overlay is created)
  menu.style.cssText = `position: absolute; ${getContextMenuStyles()}`;

  // Build menu HTML
  const otherPositions = ALL_POSITIONS.filter(p => p !== overlayConfig.position);
  const positionItems = otherPositions.map(pos => `
    <button class="context-menu-item" data-move-to="${pos}">
      <span class="menu-icon">${POSITION_ICONS[pos]}</span>
      ${POSITION_LABELS[pos]}
    </button>
  `).join("");

  menu.innerHTML = `
    ${positionItems}
    <div class="context-menu-separator"></div>
    <button class="context-menu-item" id="menu-stats-btn">
      <span class="menu-icon">📊</span>
      Statistics
    </button>
  `;

  // Double-click pill to open menu
  pill.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    e.preventDefault();
    menu.classList.add("open");
    wrapper.classList.add("menu-open");
  });

  // Close menu on outside click
  function closeMenu(e: MouseEvent): void {
    const path = e.composedPath();
    if (!path.includes(menu) && !path.includes(pill)) {
      menu.classList.remove("open");
      wrapper.classList.remove("menu-open");
    }
  }
  document.addEventListener("click", closeMenu);
  shadow.addEventListener("click", (e) => closeMenu(e as MouseEvent));

  // Escape key closes menu
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.classList.remove("open");
      wrapper.classList.remove("menu-open");
    }
  });

  // Position buttons
  menu.querySelectorAll("[data-move-to]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newPos = (btn as HTMLElement).dataset.moveTo as OverlayPosition;
      menu.classList.remove("open");
      wrapper.classList.remove("menu-open");
      savePosition(newPos);
      showOverlayToast(`Moved to ${POSITION_LABELS[newPos]}`);
    });
  });

  // Statistics button
  shadow.getElementById("menu-stats-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.remove("open");
    wrapper.classList.remove("menu-open");
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") + "#stats" });
  });
}
```

**Step 5: Call `setupContextMenu()` from `createOverlay()` at the end, right before the closing `}`**

```typescript
  document.documentElement.appendChild(container);
  setupContextMenu(); // ← add this line
}
```

**Step 6: Build**

```bash
cd packages/extension && bun run build
```

---

### Task 4: Handle BROADCAST_OVERLAY_CONFIG in service-worker.ts

**Files:**
- Modify: `packages/extension/src/service-worker.ts`

**Step 1: Find where messages are handled in service-worker.ts**

Search for `chrome.runtime.onMessage.addListener` in `service-worker.ts`.

**Step 2: Check if there's already a handler for overlay config**

Look for how `OVERLAY_CONFIG_UPDATED` is currently sent to tabs — options.ts likely saves to storage and sends a message. Find that handler and understand the pattern.

**Step 3: Add handler for `BROADCAST_OVERLAY_CONFIG`**

Inside the `onMessage.addListener` callback, add:

```typescript
if (message.type === "BROADCAST_OVERLAY_CONFIG") {
  // Broadcast updated overlay config to all content scripts
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "OVERLAY_CONFIG_UPDATED",
          config: message.config,
        }).catch(() => {}); // Ignore errors for tabs without content script
      }
    });
  });
}
```

**Step 4: Build**

```bash
cd packages/extension && bun run build
```

---

### Task 5: Verify the full feature works end-to-end

**Manual testing checklist:**

1. Load the extension in Chrome (`chrome://extensions` → Load unpacked → `dist/`)
2. Open any webpage — the overlay pill should appear in its configured corner
3. **Double-click the pill** → context menu should appear to the side (right for left-anchored, left for right-anchored)
4. **Hover the pill** while menu is open → sessions list should NOT appear (`.menu-open` suppresses it)
5. Click a **position option** → pill should move to the new corner, toast appears, menu closes
6. Click **Statistics** → options page opens in new tab with Stats tab selected
7. Open `options.html#history` in a tab → History tab should be selected on load
8. Open `options.html#settings` → Settings tab should be selected on load
9. Open `options.html` (no hash) → Sessions tab (default) should be selected
10. Verify the pill is on **top-right** → context menu opens to the **left** of the pill
11. Verify the pill is on **bottom-left** → context menu opens to the **right** of the pill
12. Press **Escape** while menu is open → menu should close
13. Click **outside** the menu → menu should close

**TypeScript check:**

```bash
cd packages/extension && bunx tsgo --noEmit 2>&1 | grep "content-script\|options"
```

Expected: no errors in our modified files.
