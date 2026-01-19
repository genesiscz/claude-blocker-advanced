# Overlays, session tracking, productivity timeline and notifications

Hello! Let me start by thanking [Theo Browne](https://github.com/t3dotgg) for creating such a fun experiment with [claude-blocker](https://github.com/T3-Content/claude-blocker). The idea is brilliant!

I loved the concept and wanted to iterate on it a bit. I ended up going quite deep into the rabbit hole of adding new features. Initially, I planned to submit a bunch of PRs once I finished, but it evolved into something more complex than I anticipated. Splitting the commits into separate PRs at this point would take significant effort, and I'm not sure if you're even open to contributions of this scope.

I've published my fork at [genesiscz/claude-blocker-advanced](https://github.com/genesiscz/claude-blocker-advanced) - you're welcome to try it out! I'm totally open to porting some or all features back to the original repo if you're interested. Here's what I've added:

## Always-On Status Overlay
A small pill in the corner of your screen showing what Claude is doing right now. Hover to expand and see all active sessions. Drag it wherever you want - it remembers the position. Quick action buttons let you jump to your project without leaving the current tab.


<img width="393" height="257" alt="Image" src="https://github.com/user-attachments/assets/9a124ee9-76bb-433b-ba63-2f0cc0e20046" />

<img width="661" height="478" alt="Image" src="https://github.com/user-attachments/assets/980d8143-829c-442d-97ef-1076baa07df0" />


## Rich Session Dashboard
The options page is now a full dashboard. See all your Claude sessions at a glance with project names, how long they've been running, what tool was last used, and whether Claude is working or waiting for your input. Filter by status, sort by activity.

<img width="674" height="207" alt="Image" src="https://github.com/user-attachments/assets/153b108e-b924-4a09-a732-e3e99f43748c" />

<img width="674" height="287" alt="Image" src="https://github.com/user-attachments/assets/0fd8ce4f-7170-422f-9085-a245a176d9a9" />

## Never Miss When Claude Needs You
Get notified when Claude finishes working and needs your input. Chrome notifications pop up so you know exactly when to switch back. Optional sound alerts if you want an audio ping.


<img width="662" height="1247" alt="Image" src="https://github.com/user-attachments/assets/de34f6d8-6178-408c-8cee-1b9d0c27b0af" />

## Quick Actions Everywhere
One click to open your project folder, launch it in VS Code/Cursor, or open a terminal right there. Copy the claude command to quickly resume a session. All accessible from the dashboard and the overlay.

<img width="187" height="47" alt="Image" src="https://github.com/user-attachments/assets/a5a7304a-f7d9-485b-84f6-a03412467ad1" />

## Activity Timeline
See a visual timeline of your Claude usage - when sessions were active, when they were waiting, when they went idle. Great for understanding your workflow patterns.

<img width="670" height="713" alt="Image" src="https://github.com/user-attachments/assets/fc86277e-23e2-4287-8387-6ed18bae20c3" />

## Session History
Browse your recent sessions from the past week. Quickly jump back into any project you were working on. Everything persists even if you restart the server.

<img width="663" height="753" alt="Image" src="https://github.com/user-attachments/assets/06821a90-1635-4d29-a444-fbeeebcd168f" />

## Productivity Insights
Track how much time you spend with Claude each day. See the breakdown between active coding vs waiting for input vs idle time.

<img width="669" height="1050" alt="Image" src="https://github.com/user-attachments/assets/1e7edb2f-d3ca-4027-a760-a227288d8c84" />

---

Try it out: `npx claude-blocker-advanced@latest`

Let me know what you think! Happy to discuss any of these features. I am totally open to help port them upstream if you're interested.
