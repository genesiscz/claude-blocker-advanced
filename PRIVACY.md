# Privacy Policy for Claude Blocker Advanced

**Last updated:** January 2025

## Overview

Claude Blocker Advanced is a productivity tool that blocks distracting websites when Claude Code is not actively working. This privacy policy explains what data is collected and how it's used.

> **Note**: This is a fork of [Theo's Claude Blocker](https://github.com/T3-Content/claude-blocker). The privacy practices remain the same.

## Data Collection

### What We Collect

Claude Blocker Advanced collects and stores the following data **locally on your device**:

1. **Blocked Domains List** — The websites you configure to be blocked (default: x.com, youtube.com)
2. **Bypass State** — Whether you've used your daily emergency bypass, and when it expires
3. **Last Bypass Date** — The date of your last bypass usage (to enforce once-per-day limit)
4. **Session History** — Records of past Claude Code sessions (stored locally for 7 days)
5. **Productivity Stats** — Daily usage statistics (stored locally)

### What We Don't Collect

- No browsing history
- No personal information
- No analytics or telemetry
- No usage statistics sent externally
- No data sent to external servers

## Data Storage

All data is stored using Chrome's storage APIs:

- **Local storage** — Data is stored on your device
- **Chrome sync** — If you have Chrome sync enabled, your blocked domains list will sync across your devices via your Google account
- **No external servers** — We do not operate any servers that receive your data

## Server Communication

The extension communicates only with a **local server running on your machine** (`localhost:8765`). This server:

- Runs entirely on your computer
- Never connects to the internet
- Only receives hook notifications from Claude Code running on your machine

## Third-Party Services

Claude Blocker Advanced does not use any third-party services, analytics, or tracking.

## Data Deletion

To delete all Claude Blocker Advanced data:

1. Open Chrome extension settings
2. Click on Claude Blocker Advanced → "Remove"
3. All locally stored data will be deleted

Alternatively, clear the extension's storage via Chrome DevTools.

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `storage` | Store your blocked domains list, bypass state, and session history |
| `tabs` | Send state updates to open tabs when blocking status changes |
| `notifications` | Show desktop notifications when Claude needs your input |
| `offscreen` | Play notification sounds (Chrome MV3 requirement) |
| `<all_urls>` | Inject the blocking modal and status overlay on any website |

## Children's Privacy

Claude Blocker Advanced is not directed at children under 13 and does not knowingly collect data from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted to this page with an updated revision date.

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/genesiscz/claude-blocker/issues

## Open Source

Claude Blocker Advanced is open source software. You can review the complete source code at:
https://github.com/genesiscz/claude-blocker
