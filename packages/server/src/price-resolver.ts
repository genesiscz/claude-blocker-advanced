import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { homedir } from "os";

// Token breakdown for detailed cost tracking
export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Model pricing structure (all values in dollars per token)
export interface ModelPricing {
  input: number; // Cost per input token
  output: number; // Cost per output token
  cacheCreate: number; // Cost per cache creation token
  cacheRead: number; // Cost per cache read token
}

// Fallback pricing for Claude models (used until LiteLLM data loads or on failure)
// Prices in dollars per token (not per million)
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  // Opus 4.5: $15/M input, $75/M output, $18.75/M cache create, $1.50/M cache read
  "claude-opus-4-5": {
    input: 15e-6,
    output: 75e-6,
    cacheCreate: 18.75e-6,
    cacheRead: 1.5e-6,
  },
  // Sonnet 4: $3/M input, $15/M output, $3.75/M cache create, $0.30/M cache read
  "claude-sonnet-4": {
    input: 3e-6,
    output: 15e-6,
    cacheCreate: 3.75e-6,
    cacheRead: 0.3e-6,
  },
  // Haiku 4.5: $0.80/M input, $4/M output, $1.00/M cache create, $0.08/M cache read
  "claude-haiku-4-5": {
    input: 0.8e-6,
    output: 4e-6,
    cacheCreate: 1e-6,
    cacheRead: 0.08e-6,
  },
  // Legacy Sonnet 3.5: $3/M input, $15/M output
  "claude-sonnet-3-5": {
    input: 3e-6,
    output: 15e-6,
    cacheCreate: 3.75e-6,
    cacheRead: 0.3e-6,
  },
};

// Default pricing to use when model is unknown (Sonnet rates)
const DEFAULT_PRICING: ModelPricing = {
  input: 3e-6,
  output: 15e-6,
  cacheCreate: 3.75e-6,
  cacheRead: 0.3e-6,
};

// Cache file location
const DATA_DIR = path.join(homedir(), ".claude-blocker");
const PRICING_CACHE_FILE = path.join(DATA_DIR, "pricing-cache.json");
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

// In-memory pricing cache (loaded from LiteLLM or fallback)
let pricingCache: Record<string, ModelPricing> = { ...FALLBACK_PRICING };
let pricingLoaded = false;
let pricingLoadPromise: Promise<void> | null = null;

/**
 * Load cached pricing from disk if available
 */
function loadCachedPricing(): boolean {
  try {
    if (existsSync(PRICING_CACHE_FILE)) {
      const raw = readFileSync(PRICING_CACHE_FILE, "utf-8");
      const cached = JSON.parse(raw) as {
        timestamp: number;
        pricing: Record<string, ModelPricing>;
      };

      // Use cached data if less than 24 hours old
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      if (Date.now() - cached.timestamp < ONE_DAY_MS && cached.pricing) {
        pricingCache = { ...FALLBACK_PRICING, ...cached.pricing };
        console.log(
          `[PriceResolver] Loaded ${Object.keys(cached.pricing).length} models from cache`
        );
        return true;
      }
    }
  } catch (err) {
    console.error("[PriceResolver] Error loading cached pricing:", err);
  }
  return false;
}

/**
 * Save pricing to disk cache
 */
function savePricingCache(pricing: Record<string, ModelPricing>): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(
      PRICING_CACHE_FILE,
      JSON.stringify(
        {
          timestamp: Date.now(),
          pricing,
        },
        null,
        2
      )
    );
    console.log(
      `[PriceResolver] Saved ${Object.keys(pricing).length} models to cache`
    );
  } catch (err) {
    console.error("[PriceResolver] Error saving pricing cache:", err);
  }
}

/**
 * Parse LiteLLM model name to normalized Claude model key
 */
function normalizeModelKey(modelName: string): string | null {
  // Match Claude models: claude-opus-4-5, claude-sonnet-4, claude-haiku-4-5, etc.
  const lowerName = modelName.toLowerCase();

  if (lowerName.includes("opus") && lowerName.includes("4")) {
    return "claude-opus-4-5";
  }
  if (lowerName.includes("sonnet") && lowerName.includes("4")) {
    return "claude-sonnet-4";
  }
  if (lowerName.includes("haiku") && lowerName.includes("4")) {
    return "claude-haiku-4-5";
  }
  if (lowerName.includes("sonnet") && lowerName.includes("3.5")) {
    return "claude-sonnet-3-5";
  }

  return null;
}

/**
 * Parse LiteLLM pricing JSON and extract Claude model pricing
 */
function parseLiteLLMPricing(
  data: Record<string, unknown>
): Record<string, ModelPricing> {
  const result: Record<string, ModelPricing> = {};

  for (const [modelName, modelData] of Object.entries(data)) {
    if (!modelName.includes("claude")) continue;

    const md = modelData as Record<string, unknown>;
    const inputCostPerToken = md.input_cost_per_token as number | undefined;
    const outputCostPerToken = md.output_cost_per_token as number | undefined;

    if (
      typeof inputCostPerToken !== "number" ||
      typeof outputCostPerToken !== "number"
    )
      continue;

    // LiteLLM may have specific cache pricing, otherwise derive from input cost
    const cacheReadCostPerToken =
      (md.cache_read_input_token_cost as number | undefined) ??
      inputCostPerToken * 0.1; // 10% of input
    const cacheCreationCostPerToken =
      (md.cache_creation_input_token_cost as number | undefined) ??
      inputCostPerToken * 1.25; // 125% of input

    const normalizedKey = normalizeModelKey(modelName);
    if (normalizedKey && !result[normalizedKey]) {
      result[normalizedKey] = {
        input: inputCostPerToken,
        output: outputCostPerToken,
        cacheCreate: cacheCreationCostPerToken,
        cacheRead: cacheReadCostPerToken,
      };
    }

    // Also store the exact model name for direct lookups
    result[modelName] = {
      input: inputCostPerToken,
      output: outputCostPerToken,
      cacheCreate: cacheCreationCostPerToken,
      cacheRead: cacheReadCostPerToken,
    };
  }

  return result;
}

/**
 * Fetch pricing from LiteLLM GitHub (async, non-blocking)
 */
async function fetchLiteLLMPricing(): Promise<void> {
  try {
    console.log("[PriceResolver] Fetching pricing from LiteLLM...");
    const response = await fetch(LITELLM_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const parsedPricing = parseLiteLLMPricing(data);

    // Merge with fallback pricing
    pricingCache = { ...FALLBACK_PRICING, ...parsedPricing };
    pricingLoaded = true;

    // Save to disk cache
    savePricingCache(parsedPricing);

    console.log(
      `[PriceResolver] Loaded ${Object.keys(parsedPricing).length} Claude models from LiteLLM`
    );
  } catch (err) {
    console.error("[PriceResolver] Failed to fetch LiteLLM pricing:", err);
    // Continue using fallback pricing
    pricingLoaded = true;
  }
}

/**
 * Initialize pricing data (call on startup)
 * Non-blocking - returns immediately, fetches in background
 */
export function initializePricing(): void {
  // First try to load from disk cache
  const hasCachedData = loadCachedPricing();

  if (!hasCachedData) {
    // Fetch fresh data asynchronously
    pricingLoadPromise = fetchLiteLLMPricing();
  } else {
    pricingLoaded = true;
    // Still fetch fresh data in background
    pricingLoadPromise = fetchLiteLLMPricing();
  }
}

/**
 * Get pricing for a specific model
 * @param model - Model ID (e.g., "claude-opus-4-5-20251101")
 * @returns ModelPricing with per-token costs
 */
export function getPricing(model?: string): ModelPricing {
  if (!model) {
    return DEFAULT_PRICING;
  }

  // Try exact match first
  if (pricingCache[model]) {
    return pricingCache[model];
  }

  // Try normalized key match
  const normalizedKey = normalizeModelKey(model);
  if (normalizedKey && pricingCache[normalizedKey]) {
    return pricingCache[normalizedKey];
  }

  // Fall back to default pricing
  return DEFAULT_PRICING;
}

/**
 * Calculate cost for a token breakdown using model-specific pricing
 * @param breakdown - Token counts by type
 * @param model - Model ID for pricing lookup
 * @returns Total cost in USD
 */
export function calculateCost(breakdown: TokenBreakdown, model?: string): number {
  const pricing = getPricing(model);

  return (
    breakdown.inputTokens * pricing.input +
    breakdown.outputTokens * pricing.output +
    breakdown.cacheCreationTokens * pricing.cacheCreate +
    breakdown.cacheReadTokens * pricing.cacheRead
  );
}

/**
 * Get all loaded pricing (for debugging/display)
 */
export function getAllPricing(): Record<string, ModelPricing> {
  return { ...pricingCache };
}

/**
 * Check if pricing has been loaded
 */
export function isPricingLoaded(): boolean {
  return pricingLoaded;
}

/**
 * Wait for pricing to be loaded (optional, for tests)
 */
export async function waitForPricing(): Promise<void> {
  if (pricingLoadPromise) {
    await pricingLoadPromise;
  }
}
