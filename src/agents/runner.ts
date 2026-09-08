import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { query } from "../db/index.ts";
import { costUsd, type ModelId, type Usage } from "./models.ts";
import { loadPlaybooks, type PlaybookName } from "./playbooks.ts";

export const client = new Anthropic();

/** Effort: "low" for classification, "high" for judgment. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentSpec<TOut extends z.ZodTypeAny> {
  /** Stable agent name, recorded on every run. */
  name: string;
  model: ModelId;
  effort: Effort;
  /** Playbooks forming the cached prompt prefix. Order-independent. */
  playbooks: readonly PlaybookName[];
  /** Agent-specific instructions, appended after the playbooks. Must be static. */
  instructions: string;
  /** Structured output schema. The agent's contract with the rest of the system. */
  output: TOut;
  maxTokens?: number;
}

export interface RunContext {
  dealId?: string;
  leadId?: string;
}

export interface AgentResult<T> {
  output: T;
  runId: string;
  costUsd: number;
  cacheHit: boolean;
}

const RETRYABLE_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.InternalServerError) return true;
  if (error instanceof Anthropic.APIError) return (error.status ?? 0) >= 500;
  return false;
}

async function withRetries<T>(agent: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === RETRYABLE_ATTEMPTS) throw error;
      const backoffMs = 500 * 2 ** (attempt - 1);
      console.warn(`[${agent}] attempt ${attempt} failed, retrying in ${backoffMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

async function recordRun(row: {
  agent: string;
  model: string;
  playbookHash: string;
  ctx: RunContext;
  input: unknown;
  output: unknown;
  error: string | null;
  usage: Usage | null;
  durationMs: number;
}): Promise<{ id: string; cost: number }> {
  const usage = row.usage;
  const cost = usage ? costUsd(row.model, usage) : 0;
  const rows = await query<{ id: string }>(
    `INSERT INTO agent_runs
       (agent, model, playbook_hash, deal_id, lead_id, input, output, error,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_usd, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      row.agent,
      row.model,
      row.playbookHash,
      row.ctx.dealId ?? null,
      row.ctx.leadId ?? null,
      JSON.stringify(row.input),
      row.output === undefined ? null : JSON.stringify(row.output),
      row.error,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
      usage?.cache_read_input_tokens ?? 0,
      usage?.cache_creation_input_tokens ?? 0,
      cost.toFixed(6),
      row.durationMs,
    ],
  );
  return { id: rows[0]!.id, cost };
}

/**
 * Builds the system prompt as two blocks:
 *   [0] playbooks + static instructions, marked cacheable with a 1h TTL
 *   (nothing else — per-lead data goes in the user message)
 *
 * If you ever find yourself interpolating a date, a UUID, or a lead field into
 * this prefix, stop: it will silently zero the cache hit rate. Put it in the
 * user message instead.
 */
interface PromptShape {
  name: string;
  playbooks: readonly PlaybookName[];
  instructions: string;
}

function buildSystem(spec: PromptShape): {
  system: Anthropic.TextBlockParam[];
  playbookHash: string;
} {
  const { text, hash } = loadPlaybooks(spec.playbooks);
  return {
    system: [
      {
        type: "text",
        text: `${text}\n\n<instructions agent="${spec.name}">\n${spec.instructions.trim()}\n</instructions>`,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    playbookHash: hash,
  };
}

/**
 * Runs a single-shot structured-output agent (scoring, triage, call analysis,
 * drafting). No tools — the agent returns validated JSON and the caller decides
 * what to persist. This is the right shape for most of the roster: it keeps the
 * agent's authority to "judge and describe", never to "act".
 */
export async function runAgent<TOut extends z.ZodTypeAny>(
  spec: AgentSpec<TOut>,
  userContent: string,
  ctx: RunContext = {},
): Promise<AgentResult<z.infer<TOut>>> {
  const { system, playbookHash } = buildSystem(spec);
  const started = Date.now();

  try {
    const response = await withRetries(spec.name, () =>
      client.messages.parse({
        model: spec.model,
        max_tokens: spec.maxTokens ?? 16_000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: spec.effort,
          format: zodOutputFormat(spec.output),
        },
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    );

    if (response.stop_reason === "refusal") {
      throw new Error(
        `[${spec.name}] model refused: ${response.stop_details?.category ?? "unknown"}`,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error(`[${spec.name}] hit max_tokens — output truncated, raise maxTokens`);
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error(`[${spec.name}] structured output failed to parse`);
    }

    const { id, cost } = await recordRun({
      agent: spec.name,
      model: spec.model,
      playbookHash,
      ctx,
      input: { userContent },
      output: parsed,
      error: null,
      usage: response.usage,
      durationMs: Date.now() - started,
    });

    return {
      output: parsed,
      runId: id,
      costUsd: cost,
      cacheHit: (response.usage.cache_read_input_tokens ?? 0) > 0,
    };
  } catch (error) {
    await recordRun({
      agent: spec.name,
      model: spec.model,
      playbookHash,
      ctx,
      input: { userContent },
      output: null,
      error: error instanceof Error ? error.message : String(error),
      usage: null,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

export interface ToolAgentSpec {
  name: string;
  model: ModelId;
  effort: Effort;
  playbooks: readonly PlaybookName[];
  instructions: string;
  /** betaZodTool definitions and/or raw server-tool objects. */
  tools: readonly unknown[];
  maxTokens?: number;
  maxIterations?: number;
}

export interface ToolAgentResult {
  /** Text of the final assistant message. */
  text: string;
  runId: string;
  costUsd: number;
  cacheHit: boolean;
}

/**
 * Runs a tool-using agent via the SDK's Tool Runner (enrichment, meeting prep —
 * anything that needs web fetch/search or must write through a tool).
 *
 * Human-in-the-loop approval does NOT need a manual loop: the tools themselves
 * enqueue into `approvals` and return "queued", so the agent literally cannot
 * send anything.
 *
 * Server tools can stop a turn with `pause_turn`, which the runner does not
 * auto-resume — an unhandled pause looks like a complete-but-truncated answer
 * with no error at all. We resume explicitly below.
 */
export async function runToolAgent(
  spec: ToolAgentSpec,
  userContent: string,
  ctx: RunContext = {},
): Promise<ToolAgentResult> {
  const { system, playbookHash } = buildSystem(spec);
  const started = Date.now();

  const totals: Usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  try {
    const runner = client.beta.messages.toolRunner({
      model: spec.model,
      max_tokens: spec.maxTokens ?? 16_000,
      thinking: { type: "adaptive" },
      output_config: { effort: spec.effort },
      max_iterations: spec.maxIterations ?? 12,
      system,
      tools: spec.tools as never,
      messages: [{ role: "user", content: userContent }],
    });

    for await (const message of runner) {
      totals.input_tokens += message.usage.input_tokens;
      totals.output_tokens += message.usage.output_tokens;
      totals.cache_read_input_tokens =
        (totals.cache_read_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
      totals.cache_creation_input_tokens =
        (totals.cache_creation_input_tokens ?? 0) +
        (message.usage.cache_creation_input_tokens ?? 0);

      if (message.stop_reason === "pause_turn") {
        runner.pushMessages({ role: "assistant", content: message.content });
      }
      if (message.stop_reason === "refusal") {
        throw new Error(
          `[${spec.name}] model refused: ${message.stop_details?.category ?? "unknown"}`,
        );
      }
    }

    const final = await runner.done();
    if (final.stop_reason === "pause_turn") {
      throw new Error(
        `[${spec.name}] ended on pause_turn — iteration cap hit mid-server-tool, result is incomplete`,
      );
    }

    const text = final.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const { id, cost } = await recordRun({
      agent: spec.name,
      model: spec.model,
      playbookHash,
      ctx,
      input: { userContent },
      output: { text },
      error: null,
      usage: totals,
      durationMs: Date.now() - started,
    });

    return {
      text,
      runId: id,
      costUsd: cost,
      cacheHit: (totals.cache_read_input_tokens ?? 0) > 0,
    };
  } catch (error) {
    await recordRun({
      agent: spec.name,
      model: spec.model,
      playbookHash,
      ctx,
      input: { userContent },
      output: null,
      error: error instanceof Error ? error.message : String(error),
      usage: totals,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}
