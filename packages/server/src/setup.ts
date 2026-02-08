import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DEFAULT_PORT } from "@claude-blocker-advanced/shared";

interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

const HOOK_COMMAND = `curl -s -X POST http://localhost:${DEFAULT_PORT}/hook -H 'Content-Type: application/json' -d "$(cat)" > /dev/null 2>&1 &`;

const HOOKS_CONFIG = {
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  PreToolUse: [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  SessionStart: [
    {
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  SessionEnd: [
    {
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  SubagentStart: [
    {
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
  SubagentStop: [
    {
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    },
  ],
};

function setupStatuslineIntegration(): void {
  const claudeDir = join(homedir(), ".claude");
  const statuslinePath = join(claudeDir, "statusline.sh");

  // Claude Blocker section to append to statusline
  const claudeBlockerSection = `## CLAUDE BLOCKER SCRIPT - START
# Send statusline JSON to Claude Blocker server for token/cost metrics tracking
# This happens silently in the background (doesn't block statusline output)
if [[ -n "$session_id" ]]; then
  echo "$input" | curl -s -X POST http://localhost:8765/statusline \\
    -H 'Content-Type: application/json' \\
    -d @- > /dev/null 2>&1 &
fi
## CLAUDE BLOCKER SCRIPT - END`;

  // Check if statusline.sh exists and needs updating
  if (existsSync(statuslinePath)) {
    try {
      const content = readFileSync(statuslinePath, "utf-8");

      // Check if our section already exists
      if (content.includes("## CLAUDE BLOCKER SCRIPT - START")) {
        console.log("✓ Claude Blocker integration already in statusline.sh");
        return;
      }

      // Append our section before the final display section
      // Find the last "Display session_id" comment
      const displaySectionIndex = content.lastIndexOf("# Display session_id");

      if (displaySectionIndex === -1) {
        console.warn("Warning: Could not find display section in statusline.sh, appending at end");
        writeFileSync(statuslinePath, content + "\n\n" + claudeBlockerSection + "\n");
      } else {
        // Insert before the display section
        const beforeDisplay = content.substring(0, displaySectionIndex);
        const afterDisplay = content.substring(displaySectionIndex);
        writeFileSync(statuslinePath, beforeDisplay + claudeBlockerSection + "\n\n" + afterDisplay);
      }

      console.log("✓ Claude Blocker integration added to statusline.sh");
    } catch (error) {
      console.error("Error updating statusline.sh:", error);
    }
  } else {
    console.log("ℹ  statusline.sh not found at ~/.claude/statusline.sh");
    console.log("   Create it or run 'claude --setup' to configure it with Claude Code");
  }
}

export function setupHooks(): void {
  const claudeDir = join(homedir(), ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
    console.log(`Created ${claudeDir}`);
  }

  // Load existing settings or create empty object
  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(content);
      console.log("Loaded existing settings.json");
    } catch (error) {
      console.error("Error reading settings.json:", error);
      console.log("Creating new settings.json");
    }
  }

  // Merge hooks (don't overwrite existing hooks for other events)
  settings.hooks = {
    ...settings.hooks,
    ...HOOKS_CONFIG,
  };

  // Write settings
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // Setup statusline integration
  setupStatuslineIntegration();

  console.log(`
┌───────────────────────────────────────────────────────┐
│                                                       │
│   Claude Blocker Advanced Setup Complete!             │
│                                                       │
│   Hooks configured in:                                │
│   ${settingsPath}
│                                                       │
│   Configured hooks:                                   │
│   - UserPromptSubmit (work starting)                  │
│   - PreToolUse (tool executing)                       │
│   - PostToolUse (tool completed)                      │
│   - Stop (work finished)                              │
│   - SessionStart (session began)                      │
│   - SessionEnd (session ended)                        │
│   - SubagentStart (subagent spawned)                  │
│   - SubagentStop (subagent completed)                 │
│                                                       │
│   Statusline integration:                             │
│   - Token and cost metrics tracked from statusline    │
│   - Appended to ~/.claude/statusline.sh               │
│                                                       │
│   Next: Run 'npx claude-blocker-advanced' to start    │
│                                                       │
└───────────────────────────────────────────────────────┘
`);
}

export function areHooksConfigured(): boolean {
  const settingsPath = join(homedir(), ".claude", "settings.json");

  if (!existsSync(settingsPath)) {
    return false;
  }

  try {
    const content = readFileSync(settingsPath, "utf-8");
    const settings: ClaudeSettings = JSON.parse(content);

    if (!settings.hooks) {
      return false;
    }

    // Check if at least one of our hooks is configured
    return Object.keys(HOOKS_CONFIG).some(
      (hookName) => hookName in settings.hooks!
    );
  } catch {
    return false;
  }
}

function removeStatuslineIntegration(): void {
  const claudeDir = join(homedir(), ".claude");
  const statuslinePath = join(claudeDir, "statusline.sh");

  if (!existsSync(statuslinePath)) {
    return;
  }

  try {
    const content = readFileSync(statuslinePath, "utf-8");

    if (content.includes("## CLAUDE BLOCKER SCRIPT - START")) {
      // Remove the Claude Blocker section
      const startMarker = "## CLAUDE BLOCKER SCRIPT - START";
      const endMarker = "## CLAUDE BLOCKER SCRIPT - END";

      const startIndex = content.indexOf(startMarker);
      const endIndex = content.indexOf(endMarker);

      if (startIndex !== -1 && endIndex !== -1) {
        const before = content.substring(0, startIndex);
        const after = content.substring(endIndex + endMarker.length);

        writeFileSync(statuslinePath, before + after);
        console.log("✓ Claude Blocker integration removed from statusline.sh");
      }
    }
  } catch (error) {
    console.error("Error removing statusline integration:", error);
  }
}

export function removeHooks(): void {
  const settingsPath = join(homedir(), ".claude", "settings.json");

  if (!existsSync(settingsPath)) {
    console.log("No settings.json found, nothing to remove.");
    return;
  }

  try {
    const content = readFileSync(settingsPath, "utf-8");
    const settings: ClaudeSettings = JSON.parse(content);

    if (settings.hooks) {
      // Remove our hooks
      for (const hookName of Object.keys(HOOKS_CONFIG)) {
        delete settings.hooks[hookName];
      }

      // If hooks object is empty, remove it entirely
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log("✓ Claude Blocker Advanced hooks removed from settings.json");
    } else {
      console.log("No hooks found in settings.json");
    }

    // Also remove statusline integration
    removeStatuslineIntegration();
  } catch (error) {
    console.error("Error removing hooks:", error);
  }
}
