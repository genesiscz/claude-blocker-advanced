#!/usr/bin/env node

import { createInterface } from "readline";
import { startServer } from "./server.js";
import { setupHooks, removeHooks, areHooksConfigured } from "./setup.js";
import { DEFAULT_PORT } from "@claude-blocker-advanced/shared";

const args = process.argv.slice(2);

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function printHelp(): void {
  console.log(`
Claude Blocker Advanced - Block distracting sites when Claude Code isn't working
(Fork of Theo's claude-blocker with advanced features)

Usage:
  npx claude-blocker-advanced [options]

Options:
  --setup     Configure Claude Code hooks
  --remove    Remove Claude Code hooks
  --port      Server port (default: ${DEFAULT_PORT})
  --help      Show this help message

Examples:
  npx claude-blocker-advanced            # Start the server (prompts for setup on first run)
  npx claude-blocker-advanced --port 9000
`);
}

async function main(): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--setup")) {
    setupHooks();
    process.exit(0);
  }

  if (args.includes("--remove")) {
    removeHooks();
    process.exit(0);
  }

  // Parse port
  let port = DEFAULT_PORT;
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    const parsed = parseInt(args[portIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      port = parsed;
    } else {
      console.error("Invalid port number");
      process.exit(1);
    }
  }

  // Check if hooks are configured, prompt for setup if not
  if (!areHooksConfigured()) {
    console.log("Claude Blocker Advanced hooks are not configured yet.\n");
    const answer = await prompt("Would you like to set them up now? (Y/n) ");
    const normalized = answer.trim().toLowerCase();

    if (normalized === "" || normalized === "y" || normalized === "yes") {
      setupHooks();
      console.log(""); // Add spacing before server start
    } else {
      console.log("\nSkipping setup. You can run 'npx claude-blocker-advanced --setup' later.\n");
    }
  }

  startServer(port);
}

main();
