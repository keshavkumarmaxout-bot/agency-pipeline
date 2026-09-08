import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGES,
  isLegalTransition,
  legalTransitions,
  type Stage,
} from "../src/pipeline/stages.ts";

/**
 * Table-driven: every transition the pipeline is supposed to allow, and a
 * sample of the nonsense jumps an agent might propose. These are pure checks —
 * no database required, so they run in CI without Postgres.
 */
const LEGAL: ReadonlyArray<[Stage, Stage]> = [
  ["new", "enriched"],
  ["enriched", "scored"],
  ["scored", "outreach_queued"],
  ["outreach_queued", "contacted"],
  ["contacted", "engaged"],
  ["contacted", "meeting_scheduled"],
  ["engaged", "meeting_scheduled"],
  ["meeting_scheduled", "meeting_held"],
  ["meeting_scheduled", "contacted"],
  ["meeting_held", "proposal_drafted"],
  ["proposal_drafted", "proposal_sent"],
  ["proposal_sent", "negotiating"],
  ["proposal_sent", "contract_sent"],
  ["negotiating", "contract_sent"],
  ["negotiating", "proposal_drafted"],
  ["contract_sent", "won"],
  ["lost", "nurture"],
  ["nurture", "outreach_queued"],
];

const ILLEGAL: ReadonlyArray<[Stage, Stage]> = [
  ["new", "contract_sent"],
  ["new", "won"],
  ["scored", "proposal_sent"],
  ["contacted", "won"],
  ["meeting_held", "won"],
  ["proposal_drafted", "contract_sent"],
  ["won", "negotiating"],
  ["won", "lost"],
  ["won", "nurture"],
  ["enriched", "new"],
  ["proposal_sent", "meeting_held"],
];

test("declared legal transitions are permitted", () => {
  for (const [from, to] of LEGAL) {
    assert.equal(isLegalTransition(from, to), true, `${from} -> ${to} should be legal`);
  }
});

test("nonsense jumps are rejected", () => {
  for (const [from, to] of ILLEGAL) {
    assert.equal(isLegalTransition(from, to), false, `${from} -> ${to} should be illegal`);
  }
});

test("a deal can be lost or moved to nurture from any non-terminal stage", () => {
  for (const stage of STAGES) {
    if (stage === "won") continue;
    if (stage !== "lost") {
      assert.equal(isLegalTransition(stage, "lost"), true, `${stage} -> lost`);
    }
    if (stage !== "nurture") {
      assert.equal(isLegalTransition(stage, "nurture"), true, `${stage} -> nurture`);
    }
  }
});

test("won is terminal", () => {
  assert.deepEqual(legalTransitions("won"), []);
});

test("no stage lists itself as a legal transition", () => {
  for (const stage of STAGES) {
    assert.equal(
      legalTransitions(stage).includes(stage),
      false,
      `${stage} should not transition to itself (same-stage is handled as a no-op)`,
    );
  }
});

test("every stage except the terminal one has somewhere to go", () => {
  for (const stage of STAGES) {
    if (stage === "won") continue;
    assert.ok(legalTransitions(stage).length > 0, `${stage} is a dead end`);
  }
});

test("no duplicate targets in a stage's transition list", () => {
  for (const stage of STAGES) {
    const targets = legalTransitions(stage);
    assert.equal(new Set(targets).size, targets.length, `${stage} has duplicate targets`);
  }
});
