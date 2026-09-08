import { getBoss, registerCrons, stopBoss } from "./boss.ts";
import { QUEUES } from "./queues.ts";
import { closePool } from "../db/index.ts";
import { config } from "../config.ts";

/**
 * Worker entry point. Handlers are registered per phase; queues that have no
 * handler yet simply accumulate jobs rather than failing, which is what we want
 * while the pipeline is being built out.
 */
async function main(): Promise<void> {
  const boss = await getBoss();

  console.log(`[worker] starting — DRY_RUN=${config.dryRun}`);
  if (!config.dryRun) {
    console.warn("[worker] *** DRY_RUN IS OFF — real emails will be sent ***");
  }

  // Phase 0: prove the queue round-trips. Replaced by real handlers in Phase 1.
  await boss.work(QUEUES.sheetPoll, async ([job]) => {
    console.log(`[${QUEUES.sheetPoll}] tick`, job?.id ?? "");
  });

  // Phase 1: sheetPoll -> leadEnrich -> leadScore
  // Phase 2: outreachDraft, sendApproved
  // Phase 3: cadenceScan -> cadenceStep, replyPoll -> replyTriage, slaWatchdog
  // Phase 4: meetingPrep, transcriptAnalyse
  // Phase 5: proposalDraft, contractDraft
  // Phase 6: weeklyReport

  await registerCrons();
  console.log("[worker] ready");
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, shutting down`);
  await stopBoss();
  await closePool();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((error: unknown) => {
  console.error("[worker] fatal:", error);
  process.exitCode = 1;
});
