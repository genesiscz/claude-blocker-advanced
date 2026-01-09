# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies (use bun or pnpm)
bun install

# Build all packages
bun run build

# Development mode (watch)
bun run dev

# Type check
bun run typecheck

# Run server directly (from packages/server)
cd packages/server && bun run dev

# Setup Claude Code hooks
cd packages/server && bun run dev -- --setup

# Pack extension for distribution
cd packages/extension && bun run zip
```

## Architecture

This is a pnpm/bun workspace monorepo with three packages:

```
packages/
├── server/     # Node.js HTTP + WebSocket server, CLI (published to npm as "claude-blocker")
├── extension/  # Chrome extension (Manifest V3, IIFE bundles)
└── shared/     # Shared TypeScript types (used as source, not built)
```

### Data Flow

1. **Claude Code** → sends hook events (UserPromptSubmit, PreToolUse, Stop, SessionStart, SessionEnd) via HTTP POST to `/hook`
2. **Server** → tracks sessions in memory, broadcasts state changes over WebSocket at `/ws`
3. **Extension** → connects to WebSocket, receives state updates, blocks/unblocks sites via content script overlay

### Key Types (packages/shared/src/types.ts)

- `HookPayload` - Events from Claude Code hooks
- `Session` - Tracked session state (id, status: idle/working/waiting_for_input, lastActivity, cwd)
- `ServerMessage` - WebSocket messages to extension (state updates, pong)
- `ClientMessage` - WebSocket messages from extension (ping, subscribe)

### Server State Machine (packages/server/src/state.ts)

Sessions transition between states:
- `idle` → `working` (on UserPromptSubmit or PreToolUse)
- `working` → `waiting_for_input` (on AskUserQuestion tool)
- `working` → `idle` (on Stop)
- Sessions auto-expire after 5 minutes of inactivity

### Extension Components

- `service-worker.ts` - WebSocket connection to server, manages extension state
- `content-script.ts` - Injects blocking overlay on matched domains
- `popup.ts` - Extension popup UI
- `options.ts` - Settings page for blocked domains

## Hook Configuration

Hooks are configured in `~/.claude/settings.json` by running `--setup`. The server receives JSON payloads at `POST /hook` containing session_id, hook_event_name, and optional tool_name/cwd.
