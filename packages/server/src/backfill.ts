import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
import { homedir } from "os";
import type { TokenBreakdown, DailyStats } from "./types.js";
import { calculateCost } from "./price-resolver.js";

// Configuration
const CLAUDE_PROJECTS_DIR = path.join(homedir(), ".claude", "projects");
const DATA_DIR = path.join(homedir(), ".claude-blocker");
const HISTORICAL_STATS_FILE = path.join(DATA_DIR, "historical-stats.json");

// Backfill progress callback type
export type BackfillProgressCallback = (progress: BackfillProgress) => void;

export interface BackfillProgress {
  totalFiles: number;
  scannedFiles: number; // Total files scanned so far
  processedFiles: number; // Files actually parsed (new)
  skippedFiles: number; // Files skipped (already processed)
  currentFile?: string;
  status: "scanning" | "processing" | "complete" | "error";
  error?: string;
}

// Historical stats by date
export interface HistoricalStatsData {
  version: number;
  lastBackfill: string; // ISO timestamp
  dailyStats: Record<string, DailyStats>;
  // Map of processed transcript paths to avoid re-processing
  processedTranscripts: Record<string, boolean>;
}

// Transcript data types
interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface TranscriptEntry {
  type?: string;
  requestId?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: TranscriptUsage;
    stop_reason?: string | null;
    content?: Array<{
      type?: string;
      name?: string;
    }>;
  };
}

interface RequestUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model?: string;
  timestamp?: Date;
}

interface TranscriptParseResult {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  model?: string;
  modelBreakdown: Record<string, TokenBreakdown>;
  firstTimestamp?: Date;
  lastTimestamp?: Date;
  totalWorkingMs: number;
  totalWaitingMs: number;
  totalIdleMs: number;
}

/**
 * Parse a transcript file for token data (reusing logic from state.ts)
 */
function parseTranscript(transcriptPath: string): TranscriptParseResult | null {
  const requestUsage = new Map<string, RequestUsage>();
  let firstTimestamp: Date | undefined;
  let lastTimestamp: Date | undefined;

  // Time reconstruction state machine
  let currentState: "idle" | "working" | "waiting_for_input" = "idle";
  let lastTransitionTime: number | undefined;
  let totalWorkingMs = 0;
  let totalWaitingMs = 0;
  let totalIdleMs = 0;

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptEntry;

        // Track timestamps
        if (entry.timestamp) {
          const ts = new Date(entry.timestamp);
          if (!firstTimestamp || ts < firstTimestamp) {
            firstTimestamp = ts;
          }
          if (!lastTimestamp || ts > lastTimestamp) {
            lastTimestamp = ts;
          }
        }

        // --- Time reconstruction ---
        const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : undefined;

        if (entry.type === "user" && entry.message?.role === "user" && entryTime) {
          // Check if this is an actual user prompt (has text content) vs tool results
          const hasTextContent = entry.message.content?.some(
            (c) => c.type === "text"
          );

          if (hasTextContent && currentState !== "working") {
            // User typed a prompt → transition to working
            if (lastTransitionTime) {
              const duration = entryTime - lastTransitionTime;
              if (currentState === "idle") totalIdleMs += duration;
              else if (currentState === "waiting_for_input") totalWaitingMs += duration;
            }
            currentState = "working";
            lastTransitionTime = entryTime;
          } else if (!lastTransitionTime) {
            // First event in transcript — set baseline
            lastTransitionTime = entryTime;
            currentState = "working";
          }
        }

        if (entry.type === "assistant" && entry.message?.role === "assistant" && entryTime) {
          const hasAskUser = entry.message.content?.some(
            (c) => c.type === "tool_use" && c.name === "AskUserQuestion"
          );

          if (hasAskUser) {
            // AskUserQuestion → transition to waiting_for_input
            if (lastTransitionTime && currentState === "working") {
              totalWorkingMs += entryTime - lastTransitionTime;
            }
            currentState = "waiting_for_input";
            lastTransitionTime = entryTime;
          } else if (entry.message.stop_reason !== "tool_use") {
            // Final response (no pending tools) → transition to idle
            if (lastTransitionTime && currentState === "working") {
              totalWorkingMs += entryTime - lastTransitionTime;
            }
            currentState = "idle";
            lastTransitionTime = entryTime;
          }
          // If stop_reason === "tool_use" (not AskUserQuestion), stay working
        }

        // Process assistant messages with usage data
        if (entry.type === "assistant" && entry.message?.usage && entry.requestId) {
          const usage = entry.message.usage;
          const requestId = entry.requestId;
          const model = entry.message.model;

          const current = requestUsage.get(requestId) || {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            model: undefined,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
          };

          if (model && !current.model) {
            current.model = model;
          }

          if (usage.input_tokens) {
            current.inputTokens = Math.max(current.inputTokens, usage.input_tokens);
          }
          if (usage.output_tokens) {
            current.outputTokens = Math.max(current.outputTokens, usage.output_tokens);
          }
          if (usage.cache_creation_input_tokens) {
            current.cacheCreationTokens = Math.max(
              current.cacheCreationTokens,
              usage.cache_creation_input_tokens
            );
          }
          if (usage.cache_read_input_tokens) {
            current.cacheReadTokens = Math.max(
              current.cacheReadTokens,
              usage.cache_read_input_tokens
            );
          }

          requestUsage.set(requestId, current);
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    return null;
  }

  if (requestUsage.size === 0) {
    return null;
  }

  // Aggregate results
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let primaryModel: string | undefined;
  const modelBreakdown: Record<string, TokenBreakdown> = {};

  for (const usage of requestUsage.values()) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheCreationTokens += usage.cacheCreationTokens;
    cacheReadTokens += usage.cacheReadTokens;

    if (usage.model && !primaryModel) {
      primaryModel = usage.model;
    }

    if (usage.model) {
      const existing = modelBreakdown[usage.model] || {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.cacheCreationTokens += usage.cacheCreationTokens;
      existing.cacheReadTokens += usage.cacheReadTokens;
      modelBreakdown[usage.model] = existing;
    }
  }

  const totalTokens = inputTokens + cacheReadTokens + outputTokens;

  // Calculate cost
  let costUsd = 0;
  if (Object.keys(modelBreakdown).length > 0) {
    for (const [model, tokens] of Object.entries(modelBreakdown)) {
      costUsd += calculateCost(tokens, model);
    }
  } else {
    costUsd = calculateCost(
      { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens },
      primaryModel
    );
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens,
    costUsd,
    model: primaryModel,
    modelBreakdown,
    firstTimestamp,
    lastTimestamp,
    totalWorkingMs,
    totalWaitingMs,
    totalIdleMs,
  };
}

/**
 * Get date key (YYYY-MM-DD) from a Date
 */
export function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Find all transcript files in the Claude projects directory
 */
function findTranscriptFiles(): string[] {
  const transcripts: string[] = [];

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return transcripts;
  }

  try {
    const entries = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectDir = path.join(CLAUDE_PROJECTS_DIR, entry.name);
        try {
          const files = readdirSync(projectDir);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              transcripts.push(path.join(projectDir, file));
            }
          }
        } catch {
          // Skip directories we can't read
        }
      }
    }
  } catch (err) {
    console.error("[Backfill] Error scanning projects directory:", err);
  }

  return transcripts;
}

/**
 * Load existing historical stats
 */
export function loadHistoricalStats(): HistoricalStatsData {
  try {
    if (existsSync(HISTORICAL_STATS_FILE)) {
      const raw = readFileSync(HISTORICAL_STATS_FILE, "utf-8");
      return JSON.parse(raw) as HistoricalStatsData;
    }
  } catch (err) {
    console.error("[Backfill] Error loading historical stats:", err);
  }

  return {
    version: 1,
    lastBackfill: "",
    dailyStats: {},
    processedTranscripts: {},
  };
}

/**
 * Save historical stats
 */
export function saveHistoricalStats(data: HistoricalStatsData): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    data.lastBackfill = new Date().toISOString();
    writeFileSync(HISTORICAL_STATS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[Backfill] Error saving historical stats:", err);
  }
}

/**
 * Merge token breakdown into daily stats
 */
function mergeIntoDailyStats(
  stats: HistoricalStatsData,
  dateKey: string,
  result: TranscriptParseResult
): void {
  const existing = stats.dailyStats[dateKey] || {
    date: dateKey,
    totalWorkingMs: 0,
    totalWaitingMs: 0,
    totalIdleMs: 0,
    sessionsStarted: 0,
    sessionsEnded: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCostUsd: 0,
    modelBreakdown: {},
  };

  existing.sessionsStarted++;
  existing.sessionsEnded++;
  existing.totalWorkingMs += result.totalWorkingMs;
  existing.totalWaitingMs += result.totalWaitingMs;
  existing.totalIdleMs += result.totalIdleMs;
  existing.totalInputTokens += result.inputTokens;
  existing.totalOutputTokens += result.outputTokens;
  existing.totalCacheCreationTokens += result.cacheCreationTokens;
  existing.totalCacheReadTokens += result.cacheReadTokens;
  existing.totalCostUsd += result.costUsd;

  // Merge model breakdown
  if (result.modelBreakdown) {
    if (!existing.modelBreakdown) {
      existing.modelBreakdown = {};
    }
    for (const [model, tokens] of Object.entries(result.modelBreakdown)) {
      const modelExisting = existing.modelBreakdown[model] || {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      modelExisting.inputTokens += tokens.inputTokens;
      modelExisting.outputTokens += tokens.outputTokens;
      modelExisting.cacheCreationTokens += tokens.cacheCreationTokens;
      modelExisting.cacheReadTokens += tokens.cacheReadTokens;
      existing.modelBreakdown[model] = modelExisting;
    }
  }

  stats.dailyStats[dateKey] = existing;
}

/**
 * Run the backfill process asynchronously
 * @param onProgress Optional callback for progress updates
 * @param batchSize Number of files to process per batch (default: 10)
 * @param batchDelayMs Delay between batches in ms (default: 100)
 */
export async function runBackfill(
  onProgress?: BackfillProgressCallback,
  batchSize = 10,
  batchDelayMs = 100
): Promise<HistoricalStatsData> {
  const progress: BackfillProgress = {
    totalFiles: 0,
    scannedFiles: 0,
    processedFiles: 0,
    skippedFiles: 0,
    status: "scanning",
  };

  // Report scanning status
  onProgress?.(progress);

  // Find all transcript files
  console.log("[Backfill] Scanning for transcripts...");
  const transcripts = findTranscriptFiles();
  progress.totalFiles = transcripts.length;
  console.log(`[Backfill] Found ${transcripts.length} transcript files`);

  if (transcripts.length === 0) {
    progress.status = "complete";
    onProgress?.(progress);
    return loadHistoricalStats();
  }

  // Load existing stats
  const stats = loadHistoricalStats();

  // Version 2 adds time reconstruction — force re-process all transcripts
  if (stats.version < 2) {
    console.log("[Backfill] Upgrading to v2 (time reconstruction) — re-processing all transcripts");
    stats.processedTranscripts = {};
    stats.dailyStats = {};
    stats.version = 2;
  }

  progress.status = "processing";

  // Process in batches to avoid blocking
  let newFilesProcessed = 0;
  let totalTokensFound = 0;
  let totalCostFound = 0;

  for (let i = 0; i < transcripts.length; i += batchSize) {
    const batch = transcripts.slice(i, i + batchSize);

    for (const transcriptPath of batch) {
      progress.scannedFiles++;
      progress.currentFile = path.basename(transcriptPath);

      // Skip if already processed
      if (stats.processedTranscripts[transcriptPath]) {
        progress.skippedFiles++;
        onProgress?.(progress);
        continue;
      }

      // Report progress for new file being processed
      onProgress?.(progress);

      // Get file modification time to determine date
      let dateKey: string;
      try {
        const fileStat = statSync(transcriptPath);
        dateKey = getDateKey(fileStat.mtime);
      } catch {
        continue;
      }

      // Parse transcript
      const result = parseTranscript(transcriptPath);
      if (!result || result.totalTokens === 0) {
        // Mark as processed even if empty
        stats.processedTranscripts[transcriptPath] = true;
        continue;
      }

      // Use transcript timestamps if available
      if (result.lastTimestamp) {
        dateKey = getDateKey(result.lastTimestamp);
      }

      // Merge into daily stats
      mergeIntoDailyStats(stats, dateKey, result);
      stats.processedTranscripts[transcriptPath] = true;

      progress.processedFiles++;
      newFilesProcessed++;
      totalTokensFound += result.totalTokens;
      totalCostFound += result.costUsd;
    }

    // Delay between batches to avoid blocking
    if (i + batchSize < transcripts.length) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
  }

  // Save results
  saveHistoricalStats(stats);

  progress.status = "complete";
  onProgress?.(progress);

  console.log(
    `[Backfill] Complete: processed ${newFilesProcessed} new files, ${totalTokensFound} tokens, $${totalCostFound.toFixed(4)} total cost`
  );

  return stats;
}

/**
 * Get historical stats (loads from file, runs backfill if needed)
 */
export function getHistoricalStats(): HistoricalStatsData {
  return loadHistoricalStats();
}

/**
 * Get daily stats for a specific date
 */
export function getDailyStats(dateKey: string): DailyStats | null {
  const stats = loadHistoricalStats();
  return stats.dailyStats[dateKey] || null;
}

/**
 * Get daily stats for a range of dates
 */
export function getDailyStatsRange(dateKeys: string[]): DailyStats[] {
  const stats = loadHistoricalStats();
  return dateKeys.map((key) => {
    return (
      stats.dailyStats[key] || {
        date: key,
        totalWorkingMs: 0,
        totalWaitingMs: 0,
        totalIdleMs: 0,
        sessionsStarted: 0,
        sessionsEnded: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalCostUsd: 0,
      }
    );
  });
}

/**
 * Check if backfill is needed (hasn't run today)
 */
export function needsBackfill(): boolean {
  const stats = loadHistoricalStats();
  if (!stats.lastBackfill) {
    return true;
  }

  const lastBackfill = new Date(stats.lastBackfill);
  const today = new Date();

  // Run backfill if it hasn't been run today
  return getDateKey(lastBackfill) !== getDateKey(today);
}
