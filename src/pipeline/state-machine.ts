import type { PoolClient } from "pg";
import { withTransaction } from "../db/index.ts";
import { IllegalTransitionError, isLegalTransition, type Stage } from "./stages.ts";

export { STAGES, isLegalTransition, legalTransitions, IllegalTransitionError } from "./stages.ts";
export type { Stage } from "./stages.ts";

export interface TransitionResult {
  dealId: string;
  from: Stage;
  to: Stage;
  /** True when the deal was already in the target stage and nothing changed. */
  noop: boolean;
}

/**
 * The ONLY writer of deals.stage. Agents propose transitions via a tool that
 * calls this; the function validates legality, writes the audit row, and
 * updates the deal atomically.
 *
 * Re-transitioning to the current stage is a no-op rather than an error, so a
 * retried job is safe.
 */
export async function transition(
  dealId: string,
  to: Stage,
  reason: string,
  actor: string,
): Promise<TransitionResult> {
  if (!reason.trim()) throw new Error("transition() requires a non-empty reason");
  if (!actor.trim()) throw new Error("transition() requires a non-empty actor");

  return withTransaction(async (client: PoolClient) => {
    // Lock the row so two concurrent agents cannot both advance the same deal.
    const { rows } = await client.query<{ stage: Stage }>(
      "SELECT stage FROM deals WHERE id = $1 FOR UPDATE",
      [dealId],
    );
    const current = rows[0]?.stage;
    if (!current) throw new Error(`Deal not found: ${dealId}`);

    if (current === to) return { dealId, from: current, to, noop: true };
    if (!isLegalTransition(current, to)) {
      throw new IllegalTransitionError(dealId, current, to);
    }

    await client.query(
      "UPDATE deals SET stage = $2, updated_at = now() WHERE id = $1",
      [dealId, to],
    );
    await client.query(
      `INSERT INTO stage_transitions (deal_id, from_stage, to_stage, reason, actor)
       VALUES ($1, $2, $3, $4, $5)`,
      [dealId, current, to, reason, actor],
    );

    return { dealId, from: current, to, noop: false };
  });
}
