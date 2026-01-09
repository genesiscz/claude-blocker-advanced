# Claude Blocker Roadmap

## Overview

Transform claude-blocker from a simple site blocker into a comprehensive Claude Code monitoring dashboard.

---

## Phase 1: Core Session Info Display
**Status: Done**

### Server Enhancements
- [ ] Track `startTime` per session (when SessionStart received)
- [ ] Track `projectName` (derived from cwd basename)
- [ ] Track `lastTool` (from PreToolUse events)
- [ ] Track `toolCount` per session
- [ ] Calculate `uptime` (now - startTime)
- [ ] Calculate `waitDuration` (now - waitingForInputSince)
- [ ] Sync shared types with server types (add `waiting_for_input` status)

### WebSocket Protocol
- [ ] Send full session array instead of just counts
- [ ] New message format: `{ type: "state", blocked, sessions: Session[] }`
- [ ] Session object includes: id, status, projectName, cwd, startTime, lastActivity, lastTool, waitingForInputSince

### Extension Popup
- [ ] Show session list with project names
- [ ] Status badges (🟢 working, 🟡 waiting, ⚪ idle)
- [ ] Uptime display per session
- [ ] Wait time with warning colors (yellow >2min, red >5min)
- [ ] Last tool used indicator

### Always-On Overlay (Content Script)
- [ ] New mini-overlay in top-right corner (configurable position)
- [ ] Shows compact session list: "ProjectName • 2h 34m • 🟢"
- [ ] Expandable on hover for more details
- [ ] Configurable: enable/disable, position, opacity
- [ ] Draggable position with persistence

---

## Phase 2: Dashboard Enhancements
**Status: Done**

### Options Page Redesign
- [ ] Full dashboard layout with sidebar navigation
- [ ] Sessions panel with rich detail cards
- [ ] Real-time updates without polling (WebSocket direct)
- [ ] Session cards with:
  - Project name (large)
  - Session ID (truncated, copy button)
  - Status badge with glow
  - Uptime counter
  - Wait time (if applicable)
  - Last tool used
  - Working directory path
- [ ] Activity sparkline per session (last 30 min)
- [ ] Filter/sort sessions by status, project, activity

### Settings Panel
- [ ] Blocked domains management (existing)
- [ ] Overlay configuration:
  - Enable/disable always-on overlay
  - Position (top-left, top-right, bottom-left, bottom-right)
  - Opacity slider
  - Compact vs expanded mode
- [ ] Notification preferences (Phase 3)
- [ ] Sound preferences (Phase 3)

---

## Phase 3: Notifications with Sound Alerts
**Status: Done (Chrome notifications only, sound alerts deferred)**

### Chrome Notifications
- [ ] Session started notification
- [ ] Session ended notification
- [ ] Waiting for input notification (with configurable delay)
- [ ] Session idle too long notification
- [ ] Daily summary notification (end of day)

### Sound Alerts
- [ ] Built-in sound library (subtle, chime, alert, etc.)
- [ ] Per-event sound configuration
- [ ] Volume control
- [ ] Mute schedule (e.g., after 10pm)
- [ ] Test sound button in settings

### Notification Settings
- [ ] Master enable/disable
- [ ] Per-event toggle
- [ ] Quiet hours configuration
- [ ] Do Not Disturb mode
- [ ] Notification grouping preferences

---

## Phase 4: Quick Actions
**Status: Done**

### Session Actions
- [ ] Copy session ID to clipboard
- [ ] Open project folder in Finder/Explorer
- [ ] Open project in VS Code/Cursor (configurable)
- [ ] Open transcript file
- [ ] Pause blocking for specific session
- [ ] Rename/tag session with custom label

### Global Actions
- [ ] Quick bypass (existing, enhanced)
- [ ] Pause all blocking
- [ ] Refresh all sessions
- [ ] Export session data

### Keyboard Shortcuts
- [ ] Alt+Shift+C - Open dashboard
- [ ] Alt+Shift+B - Quick bypass
- [ ] Configurable shortcuts in settings

---

## Phase 5: Session Timeline
**Status: Done**

### Timeline View
- [ ] Horizontal timeline showing session activity
- [ ] Color-coded segments (working, waiting, idle)
- [ ] Zoomable (hour, 4h, day view)
- [ ] Hover for segment details
- [ ] Multiple sessions stacked vertically

### Event Markers
- [ ] Session start/end markers
- [ ] Tool usage dots
- [ ] User input markers
- [ ] Error markers (future)

### Timeline Controls
- [ ] Play/pause live updates
- [ ] Jump to specific time
- [ ] Export timeline as image

---

## Phase 6: Productivity Stats
**Status: Done (tracking backend only, UI in future)**

### Daily Stats
- [ ] Total Claude time today
- [ ] Active vs waiting vs idle breakdown
- [ ] Sessions started/ended count
- [ ] Most active project

### Weekly/Monthly Stats
- [ ] Productivity trends graph
- [ ] Peak hours heatmap
- [ ] Project time distribution pie chart
- [ ] Comparison with previous periods

### Insights
- [ ] Average session duration
- [ ] Average wait time
- [ ] Most productive day of week
- [ ] Time saved estimates

### Data Storage
- [ ] Local storage for historical data
- [ ] Export stats as JSON/CSV
- [ ] Data retention settings (7d, 30d, 90d, forever)

---

## Phase 7: Quick Resume Links
**Status: Done**

### Session History
- [ ] List of recent sessions (last 7 days)
- [ ] Session metadata preserved after end
- [ ] Quick filters (today, yesterday, this week)

### Resume Features
- [ ] Click to open project directory
- [ ] Click to open transcript
- [ ] Copy last used command
- [ ] Session notes/annotations (user-added)

### Session Bookmarks
- [ ] Pin important sessions
- [ ] Custom tags/labels
- [ ] Search past sessions

---

## Phase 8: Token Tracking
**Status: Planned**

### Per-Session Tokens
- [ ] Track input/output tokens (requires hook enhancement)
- [ ] Running total display
- [ ] Token rate (tokens/minute)
- [ ] Cost estimation (configurable rates)

### Aggregate Token Stats
- [ ] Daily token usage
- [ ] Per-project token breakdown
- [ ] Token usage trends
- [ ] Budget alerts

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
