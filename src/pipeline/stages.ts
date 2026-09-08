/**
 * Pure stage rules — deliberately zero imports.
 *
 * The legality of a transition is a property of the pipeline, not of the
 * database, so it lives here and is testable with no infrastructure at all.
 * `transition()` in state-machine.ts is the side-effecting half.
 */

export const STAGES = [
  "new",
  "enriched",
  "scored",
  "outreach_queued",
  "contacted",
  "engaged",
  "meeting_scheduled",
  "meeting_held",
  "proposal_drafted",
  "proposal_sent",
  "negotiating",
  "contract_sent",
  "won",
  "lost",
  "nurture",
] as const;

export type Stage = (typeof STAGES)[number];

/** Terminal stages. Nothing leaves `won`; `lost` and `nurture` can be revived. */
const TERMINAL: readonly Stage[] = ["won"];

/**
 * Legal forward transitions. Anything not listed here throws — an agent that
 * proposes a nonsense jump (e.g. `new` straight to `contract_sent`) fails loudly
 * rather than silently corrupting the pipeline.
 *
 * `lost` and `nurture` are reachable from every non-terminal stage and are added
 * programmatically below, since a deal can die or go cold at any point.
 */
const FORWARD: Partial<Record<Stage, readonly Stage[]>> = {
  new: ["enriched"],
  enriched: ["scored"],
  scored: ["outreach_queued"],
  outreach_queued: ["contacted"],
  contacted: ["engaged", "meeting_scheduled"],
  engaged: ["meeting_scheduled"],
  meeting_scheduled: ["meeting_held", "contacted"],
  meeting_held: ["proposal_drafted"],
  proposal_drafted: ["proposal_sent"],
  proposal_sent: ["negotiating", "contract_sent"],
  negotiating: ["proposal_drafted", "contract_sent"],
  contract_sent: ["won", "negotiating"],
  lost: ["nurture"],
  nurture: ["outreach_queued"],
};

const ALWAYS_REACHABLE: readonly Stage[] = ["lost", "nurture"];

export function legalTransitions(from: Stage): readonly Stage[] {
  if (TERMINAL.includes(from)) return [];
  const forward = FORWARD[from] ?? [];
  const extra = ALWAYS_REACHABLE.filter((s) => s !== from && !forward.includes(s));
  return [...forward, ...extra];
}

export function isLegalTransition(from: Stage, to: Stage): boolean {
  return legalTransitions(from).includes(to);
}

export class IllegalTransitionError extends Error {
  readonly dealId: string;
  readonly from: Stage;
  readonly to: Stage;

  constructor(dealId: string, from: Stage, to: Stage) {
    super(
      `Illegal stage transition for deal ${dealId}: ${from} -> ${to}. ` +
        `Legal from ${from}: ${legalTransitions(from).join(", ") || "(none — terminal)"}`,
    );
    this.name = "IllegalTransitionError";
    this.dealId = dealId;
    this.from = from;
    this.to = to;
  }
}
