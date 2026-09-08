# Hosting options

Railway is no longer available for this project. This document is the decision
aid for replacing it.

> Free-tier limits change frequently. Everything below was accurate when written
> (September 2026) — verify current limits before committing.

## What this project actually needs

Any host has to satisfy all five of these, or the pipeline is only partly alive:

| Need | Why | Where it lives in this repo |
|---|---|---|
| Node 20+ runtime | Runs the agents and job handlers | all of `src/` |
| Postgres | System of record **and** the job queue itself | `src/db/schema.sql`, pg-boss tables |
| A persistent process | `boss.work()` holds long-lived listeners | `src/jobs/worker.ts` |
| A scheduler | The 15-minute cadence scan is the anti-slippage guarantee | `src/jobs/queues.ts` → `CRONS` |
| A public HTTPS endpoint | Inbound webhooks: Cal.com bookings, transcripts, Gmail push | Phase 2/4 |

The last one is easy to overlook. Booking and transcript webhooks have to reach
you from the outside, so a cron-only setup cannot receive them.

## What GitHub itself can and cannot do

**GitHub Pages hosts static files only.** No Node process, no Postgres. It cannot
run this project — not partially, not with a workaround. The repository link is
for reading the code, not for running it.

**GitHub Actions can run the scheduled half.** Ephemeral runners with a Node
runtime, on a cron. That covers the cadence scan, the sheet poll, and the weekly
report — but not the persistent worker or the webhooks, and it needs a code
change (see the caveat at the bottom).

## Options

### Zero cost

| Piece | Service | Notes |
|---|---|---|
| Postgres | **Neon** free tier | Serverless, generous free storage. Scales to zero — expect a cold-start delay on the first query. |
| Postgres (alt) | **Supabase** free tier | Also fine. Pauses after ~a week of inactivity, which the cron traffic prevents. |
| Cron jobs | **GitHub Actions** scheduled workflows | Free and unlimited minutes on a public repo. Minimum interval 5 minutes, and scheduled runs are queued best-effort — delays of 5–15 minutes under load are normal and expected. |
| Approval UI + webhooks | **Vercel** free (Hobby) | Next.js is a first-class citizen. Serverless functions receive the webhooks. Hobby tier is for non-commercial use — read the terms, since this is a commercial sales pipeline. |

**Verdict:** genuinely free, but the cadence engine becomes best-effort rather
than punctual. Given that the whole point of this system is that follow-ups do
not slip, a 15-minute scan that sometimes runs 30 minutes late is a real
compromise — though still vastly better than a human remembering.

### Low cost — recommended

| Piece | Service | Rough cost |
|---|---|---|
| Worker + web | **Render** or **Fly.io** | ~$5–7/month for a small always-on instance |
| Postgres | **Neon** free tier, or the host's managed Postgres | $0–7/month |

A single always-on instance runs `npm run worker` exactly as written — no code
changes, real pg-boss scheduling, punctual crons, and it can serve the webhook
endpoints. **Render** is the closest thing to Railway in feel: connect the repo,
it builds and deploys on push. **Fly.io** is cheaper at small scale and gives you
regions, at the cost of more configuration.

**Koyeb** is worth a look as a third option; it has historically offered a small
always-on free instance, which would make this tier free.

**Verdict:** about the price of a coffee per month, and the architecture in the
plan works unmodified. This is the right choice unless the budget is genuinely
zero.

## Recommendation

Go with **Render (or Fly.io) + Neon**. The system's core promise is that
follow-ups fire on time; paying ~$5/month to keep that a hard guarantee rather
than a best-effort one is the correct trade. Use the zero-cost stack only if the
budget is truly zero, and accept the timing slop.

## Caveat if you choose GitHub Actions

`src/jobs/worker.ts` is written as a long-running process: it calls
`boss.work()` to register listeners and then stays alive. An Actions runner is
ephemeral and exits, so this file cannot be used as-is.

Moving to Actions means adding a one-shot entry point that:

1. connects, 2. fetches jobs due right now, 3. processes them, 4. exits.

pg-boss supports this via `boss.fetch()` + manual completion instead of
`boss.work()`. It is maybe half a day of work, and it permanently splits the
codebase into two execution models. Worth knowing before choosing the free path.
