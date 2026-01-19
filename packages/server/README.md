# claude-blocker-advanced

CLI tool and server for [Claude Blocker Advanced](https://github.com/genesiscz/claude-blocker-advanced) — block distracting websites unless Claude Code is actively running inference.

> **Fork of** [Theo's claude-blocker](https://github.com/T3-Content/claude-blocker) with advanced features.

## Installation

```bash
npm install -g claude-blocker-advanced
# or
npx claude-blocker-advanced
```

## Quick Start

```bash
# First time setup (configures Claude Code hooks)
npx claude-blocker-advanced --setup

# The server will start automatically after setup
```

## Usage

```bash
# Start server (default port 8765)
npx claude-blocker-advanced

# Start with setup (configures hooks if not already done)
npx claude-blocker-advanced --setup

# Custom port
npx claude-blocker-advanced --port 9000

# Remove hooks from Claude Code
npx claude-blocker-advanced --remove

# Show help
npx claude-blocker-advanced --help
```

## How It Works

1. **Hooks** — The `--setup` command adds hooks to `~/.claude/settings.json` that notify the server when:
   - You submit a prompt (`UserPromptSubmit`)
   - Claude uses a tool (`PreToolUse`)
   - Claude finishes (`Stop`)
   - A session starts/ends (`SessionStart`, `SessionEnd`)

2. **Statusline Integration** — The `--setup` command also:
   - Appends tracking code to `~/.claude/statusline.sh`
   - Sends real-time token and cost metrics to the server at `/statusline` endpoint
   - Enables accurate usage tracking per session

3. **Server** — Runs on localhost and:
   - Tracks all active Claude Code sessions
   - Knows when sessions are "working" vs "idle"
   - Accumulates token counts and costs from statusline
   - Persists session history to `~/.claude-blocker/sessions.json`
   - Broadcasts state via WebSocket to the Chrome extension

4. **Extension** — Connects to the server and:
   - Blocks configured sites when no sessions are working
   - Shows a modal overlay (soft block, not network block)
   - Displays session metrics (tokens, costs, duration)
   - Shows productivity statistics with date navigation
   - Breaks down usage by project
   - Updates in real-time without page refresh

## API

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Returns current state (blocked, sessions, working, waiting) |
| `/history` | GET | Returns session history for last 7 days |
| `/hook` | POST | Receives hook payloads from Claude Code |
| `/statusline` | POST | Receives token and cost metrics from statusline script |
| `/action/open-finder` | POST | Opens folder in macOS Finder |
| `/action/open-terminal` | POST | Opens folder in terminal with resume command |
| `/action/open-editor` | POST | Opens folder in code editor |

### Status Endpoint Response

```json
{
  "blocked": false,
  "sessions": [
    {
      "id": "abc123...",
      "status": "working",
      "projectName": "my-project",
      "initialCwd": "/path/to/project",
      "cwd": "/path/to/project",
      "startTime": "2026-01-10T10:00:00Z",
      "lastActivity": "2026-01-10T10:05:00Z",
      "lastTool": "Read",
      "toolCount": 5,
      "recentTools": [],
      "inputTokens": 1500,
      "outputTokens": 450,
      "totalTokens": 1950,
      "costUsd": 0.035
    }
  ],
  "working": 1,
  "waitingForInput": 0
}
```

### Statusline Endpoint

Receives metrics from the statusline script:

```json
{
  "session_id": "abc123...",
  "cost": {
    "total_cost_usd": 0.035
  },
  "context_window": {
    "total_input_tokens": 1500,
    "total_output_tokens": 450
  }
}
```

### WebSocket

Connect to `ws://localhost:8765/ws` to receive real-time state updates:

```json
{
  "type": "state",
  "blocked": false,
  "sessions": [...],
  "working": 1,
  "waitingForInput": 0
}
```

## Features

### Session Tracking
- **Real-time status** — Tracks active/idle/waiting-for-input states
- **Token metrics** — Accumulates input/output tokens from statusline
- **Cost tracking** — Accumulates USD cost per session
- **Project context** — Preserves original project directory across session recreations
- **Activity history** — Records recent tool usage (last 5 tools)
- **Auto-persistence** — Saves session history to `~/.claude-blocker/sessions.json`

### Productivity Analytics
- **Daily stats** — Time breakdown by session status (working/waiting/idle)
- **Historical view** — Browse productivity data for any date with date picker
- **Project breakdown** — See token usage and costs aggregated by project
- **Weekly trends** — Visual 7-day activity chart with 3-color status indicators
- **Cost visibility** — Track USD spending per session and per project

### Session Management
- **Resume tracking** — Save and resume sessions with correct project paths
- **Folder actions** — Quick links to open project in Finder/Terminal/Editor
- **Session history** — Full history of ended sessions (7-day retention)
- **Timeout handling** — Auto-expire idle sessions after 5 minutes

## Programmatic Usage

```typescript
import { startServer } from 'claude-blocker-advanced';

// Start on default port (8765)
startServer();

// Or custom port
startServer(9000);
```

## Requirements

- Node.js 18+
- [Claude Code](https://claude.ai/claude-code)

## License

MIT
