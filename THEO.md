# Created claude-blocker-advanced with overlays, session tracking, productivity timeline and notifications

Hello! Let me start by thanking you for creating such a fun experiment.

I loved the idea and wanted to iterate on it a bit. I ended up going quite deep into the rabbit hole of adding new features. Initially, I planned to submit a bunch of PRs once I finished, but it evolved into something more comprehensive than I anticipated. Splitting the commits into separate PRs at this point would take significant effort, and I'm not sure if you're even open to contributions of this scope.

I've published my fork at [genesiscz/claude-blocker](https://github.com/genesiscz/claude-blocker) - you're welcome to try it out! I'm totally open to porting some or all features back to the original repo if you're interested. Here's what I've added:

## Always-On Status Overlay

A small pill in the corner of your screen showing what Claude is doing right now. Hover to expand and see all active sessions. Drag it wherever you want - it remembers the position. Quick action buttons let you jump to your project without leaving the current tab.

## Rich Session Dashboard

The options page is now a full dashboard. See all your Claude sessions at a glance with project names, how long they've been running, what tool was last used, and whether Claude is working or waiting for your input. Filter by status, sort by activity.

## Never Miss When Claude Needs You

Get notified when Claude finishes working and needs your input. Chrome notifications pop up so you know exactly when to switch back. Optional sound alerts if you want an audio ping.

## Quick Actions Everywhere

One click to open your project folder, launch it in VS Code/Cursor, or open a terminal right there. Copy the claude command to quickly resume a session. All accessible from the dashboard and the overlay.

## Activity Timeline

See a visual timeline of your Claude usage - when sessions were active, when they were waiting, when they went idle. Great for understanding your workflow patterns.

## Session History

Browse your recent sessions from the past week. Quickly jump back into any project you were working on. Everything persists even if you restart the server.

## Productivity Insights

Track how much time you spend with Claude each day. See the breakdown between active coding vs waiting for input vs idle time.

---

Try it out: `npx claude-blocker-advanced@latest`

Let me know what you think! Happy to discuss any of these features or help port them upstream if you're interested.