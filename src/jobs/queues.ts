/**
 * Job names. Every queue must be declared here and created at worker startup —
 * pg-boss v10 requires explicit queue creation before send() or work().
 */
export const QUEUES = {
  // Phase 1 — intake and scoring
  sheetPoll: "sheet.poll",
  leadEnrich: "lead.enrich",
  leadScore: "lead.score",

  // Phase 2 — outreach and sending
  outreachDraft: "outreach.draft",
  sendApproved: "send.approved",

  // Phase 3 — the follow-up engine
  cadenceScan: "cadence.scan",
  cadenceStep: "cadence.step",
  replyPoll: "reply.poll",
  replyTriage: "reply.triage",
  slaWatchdog: "sla.watchdog",

  // Phase 4 — meetings
  meetingPrep: "meeting.prep",
  transcriptAnalyse: "transcript.analyse",

  // Phase 5 — proposals and contracts
  proposalDraft: "proposal.draft",
  contractDraft: "contract.draft",

  // Phase 6 — analytics
  weeklyReport: "weekly.report",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Cron schedules. These are the heartbeat of the system: the cadence scan is
 * what makes "follow-ups never slip" a property of the software rather than a
 * good intention. All times UTC.
 */
export const CRONS: ReadonlyArray<{ queue: QueueName; cron: string; note: string }> = [
  { queue: QUEUES.sheetPoll, cron: "*/5 * * * *", note: "pull new lead rows from the sheet" },
  { queue: QUEUES.cadenceScan, cron: "*/15 * * * *", note: "fire every due follow-up step" },
  { queue: QUEUES.replyPoll, cron: "*/5 * * * *", note: "pull inbound replies" },
  { queue: QUEUES.slaWatchdog, cron: "0 * * * *", note: "flag deals past next_action_at" },
  { queue: QUEUES.meetingPrep, cron: "0 7 * * *", note: "brief for meetings in the next 24h" },
  { queue: QUEUES.weeklyReport, cron: "0 8 * * 1", note: "Monday pipeline analysis" },
];
