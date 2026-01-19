# Claude Blocker Advanced Roadmap

## Overview

Transform claude-blocker-advanced from a simple site blocker into a comprehensive Claude Code monitoring dashboard.

---

## Phase 1: Core Session Info Display
**Status: Done**

### Server Enhancements
- [x] Track `startTime` per session (when SessionStart received)
- [x] Track `projectName` (derived from cwd basename)
- [x] Track `lastTool` (from PreToolUse events)
- [x] Track `toolCount` per session
- [x] Calculate `uptime` (now - startTime)
- [x] Calculate `waitDuration` (now - waitingForInputSince)
- [x] Sync shared types with server types (add `waiting_for_input` status)

### WebSocket Protocol
- [x] Send full session array instead of just counts
- [x] New message format: `{ type: "state", blocked, sessions: Session[] }`
- [x] Session object includes: id, status, projectName, cwd, startTime, lastActivity, lastTool, waitingForInputSince

### Extension Popup
- [x] Show session list with project names
- [x] Status badges (🟢 working, 🟡 waiting, ⚪ idle)
- [x] Uptime display per session
- [x] Wait time with warning colors (yellow >2min, red >5min)
- [x] Last tool used indicator

### Always-On Overlay (Content Script)
- [x] New mini-overlay in top-right corner (configurable position)
- [x] Shows compact session list: "ProjectName • 2h 34m • 🟢"
- [x] Expandable on hover for more details
- [x] Configurable: enable/disable, position, opacity
- [x] Draggable position with persistence

---

## Phase 2: Dashboard Enhancements
**Status: Done**

### Options Page Redesign
- [x] Full dashboard layout with sidebar navigation
- [x] Sessions panel with rich detail cards
- [x] Real-time updates without polling (WebSocket direct)
- [x] Session cards with:
  - Project name (large)
  - Session ID (truncated, copy button)
  - Status badge with glow
  - Uptime counter
  - Wait time (if applicable)
  - Last tool used
  - Working directory path
- [x] Activity sparkline per session (last 30 min)
- [x] Filter/sort sessions by status, project, activity

### Settings Panel
- [x] Blocked domains management (existing)
- [x] Overlay configuration:
  - Enable/disable always-on overlay
  - Position (top-left, top-right, bottom-left, bottom-right)
  - Opacity slider
  - Compact vs expanded mode
- [x] Notification preferences (Phase 3)
- [x] Sound preferences (Phase 3)

---

## Phase 3: Notifications with Sound Alerts
**Status: Done (Chrome notifications only, sound alerts deferred)**

### Chrome Notifications
- [x] Session started notification
- [x] Session ended notification
- [x] Waiting for input notification (with configurable delay)
- [x] Session idle too long notification
- [ ] Daily summary notification (end of day)

### Sound Alerts
- [ ] Built-in sound library (subtle, chime, alert, etc.)
- [ ] Per-event sound configuration
- [ ] Volume control
- [ ] Mute schedule (e.g., after 10pm)
- [ ] Test sound button in settings

### Notification Settings
- [x] Master enable/disable
- [x] Per-event toggle
- [x] Quiet hours configuration
- [x] Do Not Disturb mode
- [ ] Notification grouping preferences

---

## Phase 4: Quick Actions
**Status: Done**

### Session Actions
- [x] Copy session ID to clipboard
- [x] Open project folder in Finder/Explorer
- [x] Open project in VS Code/Cursor (configurable)
- [x] Open transcript file
- [x] Pause blocking for specific session
- [ ] Rename/tag session with custom label

### Global Actions
- [x] Quick bypass (existing, enhanced)
- [x] Pause all blocking
- [x] Refresh all sessions
- [x] Export session data

### Keyboard Shortcuts
- [x] Alt+Shift+C - Open dashboard
- [x] Alt+Shift+B - Quick bypass
- [x] Configurable shortcuts in settings

---

## Phase 5: Session Timeline
**Status: Done**

### Timeline View
- [x] Horizontal timeline showing session activity
- [x] Color-coded segments (working, waiting, idle)
- [x] Zoomable (hour, 4h, day view)
- [x] Hover for segment details
- [x] Multiple sessions stacked vertically

### Event Markers
- [x] Session start/end markers
- [x] Tool usage dots
- [x] User input markers
- [ ] Error markers (future)

### Timeline Controls
- [x] Play/pause live updates
- [x] Jump to specific time
- [x] Export timeline as image

---

## Phase 6: Productivity Stats
**Status: Done (tracking backend only, UI in future)**

### Daily Stats
- [x] Total Claude time today
- [x] Active vs waiting vs idle breakdown
- [x] Sessions started/ended count
- [x] Most active project

### Weekly/Monthly Stats
- [ ] Productivity trends graph
- [ ] Peak hours heatmap
- [ ] Project time distribution pie chart
- [ ] Comparison with previous periods

### Insights
- [x] Average session duration
- [x] Average wait time
- [ ] Most productive day of week
- [ ] Time saved estimates

### Data Storage
- [x] Local storage for historical data
- [x] Export stats as JSON/CSV
- [x] Data retention settings (7d, 30d, 90d, forever)

---

## Phase 7: Quick Resume Links
**Status: Done**

### Session History
- [x] List of recent sessions (last 7 days)
- [x] Session metadata preserved after end
- [x] Quick filters (today, yesterday, this week)

### Resume Features
- [x] Click to open project directory
- [x] Click to open transcript
- [x] Copy last used command
- [ ] Session notes/annotations (user-added)

### Session Bookmarks
- [x] Pin important sessions
- [ ] Custom tags/labels
- [x] Search past sessions

---

## Phase 8: Token Tracking
**Status: Done (infrastructure ready, awaiting Claude Code hook data)**

### Per-Session Tokens
- [x] Track input/output tokens (requires hook enhancement)
- [x] Running total display
- [x] Token rate (tokens/minute)
- [x] Cost estimation (configurable rates)

### Aggregate Token Stats
- [x] Daily token usage
- [x] Per-project token breakdown
- [x] Token usage trends
- [x] Budget alerts

### Implementation Notes
- Requires new hook data or Claude Code API integration
- May need PostToolUse hook for accurate counting
- Consider caching transcript parsing for token estimation

---

## Nice to Have (Future Ideas)
**Status: Nice to Have**

### Multi-Session Orchestration
- [ ] Priority ordering (pin important projects)
- [ ] Group sessions by workspace
- [ ] Bulk actions on multiple sessions

### Smart Notifications
- [ ] Learn user response patterns
- [ ] Adaptive notification timing
- [ ] Urgency detection

### Integration Features
- [ ] Slack/Discord webhooks
- [ ] External API endpoint
- [ ] Raycast/Alfred extension
- [ ] Menu bar app (native)

### Session Health Indicators
- [ ] Memory/performance warnings
- [ ] Error rate tracking
- [ ] Estimated completion time

### Widget Mode
- [ ] Floating mini-widget
- [ ] Always-on-top option
- [ ] Picture-in-picture style

### Team Features
- [ ] Shared session visibility
- [ ] Team productivity dashboard
- [ ] Session handoff

---

## Technical Debt & Infrastructure
**Status: Planned**

### Type System
- [ ] Sync shared types between server and extension
- [ ] Add `waiting_for_input` status to shared Session type
- [ ] Create rich metadata interfaces

### Server Improvements
- [ ] Session persistence (survive restarts)
- [ ] API endpoint for historical data
- [ ] Rate limiting for WebSocket broadcasts

### Extension Improvements
- [ ] Direct WebSocket in options page (not polling)
- [ ] Better error handling and reconnection
- [ ] Service worker state persistence

### Build & Development
- [ ] Hot reload for extension development
- [ ] E2E tests for critical flows
- [ ] Automated extension packaging

---

## Commit Order

1. **Phase 1**: Core session info (server + extension basics)
2. **Phase 2**: Dashboard enhancements
3. **Phase 3**: Notifications with sound alerts
4. **Phase 4**: Quick actions
5. **Phase 5**: Session timeline
6. **Phase 6**: Productivity stats
7. **Phase 7**: Quick resume links
8. **Phase 8**: Token tracking

Each phase should be a separate commit/PR for clean history and easy rollback.
