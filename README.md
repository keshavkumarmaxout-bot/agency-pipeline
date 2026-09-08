# Agency Pipeline

AI agents that run an agency sales pipeline: lead gen → follow-ups → meeting →
proposal → follow-ups → contract. Agents draft; a human approves. The plan lives
in `~/.claude/plans/for-agencies-below-is-clever-stallman.md`.

**Status: Phase 0 complete.** Foundations are in and tested. No agents yet.

## The two rules that matter

1. **Deterministic code owns timing and state. Agents own content and judgment.**
   The scheduler decides *when* a follow-up fires (`playbooks/cadence.yaml` +
   `src/jobs/queues.ts`). The agent only decides *what it says*. Never give a
   model a timer.
2. **Nothing reaches a client without a human approving a row in `approvals`.**
   Agent "send" tools enqueue; only the sender worker sends.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`. `DRY_RUN` defaults to
`true` and a missing or malformed value keeps it `true` — going live is a
deliberate act.

Provide an Anthropic credential either way:

```bash
ant auth login
```

or set `ANTHROPIC_API_KEY` in `.env`.

Then apply the schema:

```bash
npm run db:migrate
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Pure unit tests. No database or API key needed. |
| `npm run typecheck` | `tsc --noEmit`. `erasableSyntaxOnly` is on, so anything Node cannot strip fails here. |
| `npm run smoke:cache` | Live prompt-cache check. Needs a credential, no database. |
| `npm run db:migrate` | Applies `src/db/schema.sql` (idempotent). |
| `npm run worker` | Starts the pg-boss worker and registers crons. |

Node 24 runs the TypeScript directly — no build step, no loader flag.

## Layout

```
src/agents/     runner.ts (every agent goes through it), models.ts, playbooks.ts
src/pipeline/   stages.ts (pure rules), state-machine.ts (the only stage writer)
src/jobs/       queues.ts (names + crons), boss.ts, worker.ts
src/db/         schema.sql, migrate.ts, index.ts
playbooks/      the files the agency edits to change agent behaviour
tests/          pure tests + the live cache smoke test
```

## Editing agent behaviour

Edit `playbooks/*.md`. Do not put prompts in code. Those files are loaded as the
**cached** system prefix, which has one hard constraint:

> Never interpolate anything volatile — a date, a UUID, a lead field — into the
> playbook prefix. It silently zeroes the cache hit rate and multiplies the bill.
> Per-lead data goes in the user message.

`npm run smoke:cache` is the guard on that. `tests/playbooks.test.ts` catches the
cheap cases offline.

Untrusted text — website copy, email replies, transcripts — must go through
`untrusted()` from `src/agents/playbooks.ts`. It nonces the closing delimiter and
strips forged ones, so lead-supplied content cannot issue instructions.

## Cost

Every model call writes an `agent_runs` row with token counts and `cost_usd`.

```sql
SELECT agent, count(*), round(sum(cost_usd), 2) AS usd
FROM agent_runs WHERE created_at > now() - interval '7 days'
GROUP BY agent ORDER BY usd DESC;
```

Model assignment is in `src/agents/models.ts`: haiku for classification, sonnet
for drafting, opus for judgment. If an agent produces bad output, fix its
playbook before reaching for a bigger model.

## Hosting

GitHub stores this code but cannot run it — no Node runtime, no Postgres. The
project needs an always-on process plus a database. See [HOSTING.md](HOSTING.md)
for the options and the recommendation.

## Next: Phase 1

Intake and scoring. Sheets poller → dedupe → enrichment → qualifier, with an ICP
rubric in `playbooks/icp.md`. Before writing it, the agency must fill in the real
content of `playbooks/icp.md` and `playbooks/services.md` — the rubric weights
and service list currently carry TODO placeholders, and scoring quality is capped
by them.
