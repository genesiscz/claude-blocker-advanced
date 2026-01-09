# Terminal Tab Discovery Research

This document details the automation capabilities of each supported terminal application for discovering and focusing existing tabs running Claude Code sessions.

## Summary

| Terminal | Can Find Existing Tabs? | Can Focus? | Status |
|----------|------------------------|------------|--------|
| **iTerm2** | Yes | Yes | Full support via AppleScript/Python API |
| **Terminal.app** | Partial | Yes | Can search tab contents (unreliable) |
| **Warp** | No | No | No AppleScript support |
| **Ghostty** | No | No | Scripting API planned for future |

---

## iTerm2

**Status: Full Support**

iTerm2 has excellent AppleScript support and a Python API for automation.

### Capabilities
- Enumerate windows, tabs, and sessions
- Get session properties including PID
- Match running command via `ps`
- Activate/focus specific sessions

### AppleScript Approach

```applescript
tell application "iTerm2"
  repeat with aWindow in windows
    repeat with aTab in tabs of aWindow
      repeat with aSession in sessions of aTab
        set thePID to variable named "pid" of aSession
        -- Use shell: ps -o args= -ww -fp {thePID}
        -- If matches "claude --resume {session_id}", activate session
        select aSession
        activate
      end repeat
    end repeat
  end repeat
end tell
```

### Python API (Recommended)

```python
#!/usr/bin/env python3
import iterm2
import subprocess

async def find_and_activate_session(session_id):
    connection = await iterm2.Connection.async_create()
    app = await iterm2.async_get_app(connection)

    for window in app.windows:
        for tab in window.tabs:
            for session in tab.sessions:
                pid = await session.async_get_variable("pid")
                result = subprocess.run(
                    ["ps", "-o", "args=", "-ww", "-fp", str(pid)],
                    capture_output=True, text=True
                )
                if f"claude --resume {session_id}" in result.stdout:
                    await session.async_activate()
                    return True
    return False

iterm2.run_until_complete(find_and_activate_session)
```

### References
- [iTerm2 Scripting Documentation](https://iterm2.com/documentation-scripting.html)
- [iTerm2 Python API](https://iterm2.com/python-api/)
- [Find Pane with Process Example](https://iterm2.com/python-api/examples/findps.html)

---

## Terminal.app

**Status: Limited Support**

Terminal.app has basic AppleScript support but limited introspection capabilities.

### Capabilities
- Enumerate windows and tabs
- Access tab titles and contents
- Activate/focus specific tabs
- Cannot directly access process info (PID)

### AppleScript Approach

Search through tab contents (unreliable if buffer has scrolled):

```applescript
tell application "Terminal"
  repeat with win in every window
    repeat with t from 1 to count of tabs of win
      set tabContents to contents of tab t of win as text
      if tabContents contains "claude --resume {session_id}" then
        set selected of tab t of win to true
        set frontmost of win to true
        activate
        return
      end if
    end repeat
  end repeat
end tell
```

### Limitations
- `contents` only captures visible buffer, may miss command if scrolled
- No direct access to running process/PID
- Must rely on tab titles or buffer search

### References
- [Terminal AppleScript Guide](https://hea-www.harvard.edu/~fine/OSX/terminal-tabs.html)

---

## Warp

**Status: No Support**

Warp does not support AppleScript or any programmatic tab discovery.

### Current State
- No AppleScript dictionary
- No CLI for tab management
- Feature requested since 2022 ([GitHub Issue #3364](https://github.com/warpdotdev/Warp/issues/3364))

### Available Workarounds
1. **URI Schemes** - Can open new tabs with launch configurations, but cannot query existing tabs
2. **GUI Scripting** - Could use System Events to simulate keystrokes (requires accessibility permissions, unreliable)

### Recommendation
Continue using current implementation (always opens new tab).

---

## Ghostty

**Status: No Support (Planned)**

Ghostty is a newer terminal and scripting support is planned but not yet implemented.

### Current State
- No AppleScript support
- No CLI for tab management
- Scripting API planned via macOS App Intents framework ([Discussion #2353](https://github.com/ghostty-org/ghostty/discussions/2353))

### Planned Features (Future)
- Create/list windows and tabs
- AppleScript via App Intents
- Platform integration (Hammerspoon, etc.)

### Recommendation
Wait for future releases with scripting support. Currently use "open new tab" approach.

---

## Technical Notes

### Finding Process by PID

```bash
# Get full command line for a process
ps -o args= -ww -fp {PID}

# Example output:
# claude --resume abc123-def456-789
```

### Finding Process by TTY

```bash
# List processes on a specific terminal device
lsof /dev/ttys001 | grep tty
```

---

## Conclusion

For implementing a "focus existing session" feature:

1. **iTerm2 users** - Fully feasible using AppleScript + shell commands or Python API
2. **Terminal.app users** - Partially feasible but unreliable (buffer search)
3. **Warp/Ghostty users** - Not feasible until those apps add scripting support

A future implementation could add this as an iTerm2-only feature, or wait until Warp/Ghostty add the necessary APIs.
