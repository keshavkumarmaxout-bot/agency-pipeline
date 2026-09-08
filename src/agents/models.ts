/**
 * Model assignment and cost accounting.
 *
 * Assignment is deliberate and cost-driven: cheap models do classification,
 * expensive models do judgment. Never "upgrade" an agent to a bigger model to
 * fix a bad prompt — fix the playbook first.
 */

export const MODELS = {
  /** Classification, dedupe, reply triage. */
  cheap: "claude-haiku-4-5",
  /** Enrichment summaries, outreach and follow-up drafting. */
  standard: "claude-sonnet-5",
  /** ICP scoring, call analysis, proposal generation, weekly analysis. */
  deep: "claude-opus-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

interface Rates {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * List rates, USD per million tokens. Sonnet 5 has promotional pricing
 * ($2/$10) through 2026-08-31; we bill against list price so the dashboard
 * never under-reports once the promo lapses.
 */
const RATES: Record<ModelId, Rates> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};

/** Cache reads cost ~10% of the input rate; cache writes ~125%. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: string, usage: Usage): number {
  const rates = RATES[model as ModelId];
  if (!rates) return 0;

  const perToken = rates.input / 1_000_000;
  const uncached = usage.input_tokens * perToken;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * perToken * CACHE_READ_MULTIPLIER;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * perToken * CACHE_WRITE_MULTIPLIER;
  const output = usage.output_tokens * (rates.output / 1_000_000);

  return uncached + cacheRead + cacheWrite + output;
}
