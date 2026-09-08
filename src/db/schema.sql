-- Agency pipeline schema. Postgres is the system of record; the Google Sheet is intake only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- enums

DO $$ BEGIN
  CREATE TYPE deal_stage AS ENUM (
    'new', 'enriched', 'scored', 'outreach_queued', 'contacted', 'engaged',
    'meeting_scheduled', 'meeting_held', 'proposal_drafted', 'proposal_sent',
    'negotiating', 'contract_sent', 'won', 'lost', 'nurture'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_state AS ENUM ('pending', 'approved', 'rejected', 'sent', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_kind AS ENUM ('first_touch', 'followup', 'reply', 'proposal', 'contract');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE touch_direction AS ENUM ('outbound', 'inbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------- leads

CREATE TABLE IF NOT EXISTS leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL,
  raw_row_hash   text NOT NULL,
  company        text,
  domain         text,
  contact_name   text,
  email          text,
  phone          text,
  linkedin       text,
  merged_into    uuid REFERENCES leads(id),
  redacted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The dedupe guarantee: the same sheet row can never create two leads.
CREATE UNIQUE INDEX IF NOT EXISTS leads_raw_row_hash_key ON leads (raw_row_hash);
CREATE INDEX IF NOT EXISTS leads_domain_idx ON leads (lower(domain));
CREATE UNIQUE INDEX IF NOT EXISTS leads_email_key ON leads (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS enrichment (
  lead_id        uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  firmographics  jsonb NOT NULL DEFAULT '{}'::jsonb,
  tech_stack     jsonb NOT NULL DEFAULT '[]'::jsonb,
  signals        jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary        text,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  lead_id         uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  score           int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier            char(1) NOT NULL CHECK (tier IN ('A','B','C','D')),
  rubric_version  text NOT NULL,
  rationale       text NOT NULL,
  disqualifiers   jsonb NOT NULL DEFAULT '[]'::jsonb,
  scored_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- deals

CREATE TABLE IF NOT EXISTS deals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  stage            deal_stage NOT NULL DEFAULT 'new',
  owner            text,
  value_estimate   numeric(12,2),
  next_action_at   timestamptz,
  last_touch_at    timestamptz,
  sla_breached_at  timestamptz,
  close_reason     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deals_stage_idx ON deals (stage);
-- Drives the SLA watchdog scan.
CREATE INDEX IF NOT EXISTS deals_next_action_idx ON deals (next_action_at)
  WHERE next_action_at IS NOT NULL AND sla_breached_at IS NULL;

-- Append-only audit of every stage change. Written by transition() only.
CREATE TABLE IF NOT EXISTS stage_transitions (
  id          bigserial PRIMARY KEY,
  deal_id     uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage  deal_stage,
  to_stage    deal_stage NOT NULL,
  reason      text NOT NULL,
  actor       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stage_transitions_deal_idx ON stage_transitions (deal_id, created_at);

-- ---------------------------------------------------------------- comms

CREATE TABLE IF NOT EXISTS touches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  channel          text NOT NULL DEFAULT 'email',
  direction        touch_direction NOT NULL,
  subject          text,
  body             text,
  thread_id        text,
  message_id       text,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  idempotency_key  text
);

-- The double-send guarantee. A retried job cannot produce a second touch.
CREATE UNIQUE INDEX IF NOT EXISTS touches_idempotency_key
  ON touches (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS touches_deal_idx ON touches (deal_id, sent_at);
CREATE INDEX IF NOT EXISTS touches_thread_idx ON touches (thread_id);

CREATE TABLE IF NOT EXISTS sequences (
  deal_id        uuid PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  playbook_name  text NOT NULL,
  step_index     int  NOT NULL DEFAULT 0,
  next_fire_at   timestamptz,
  paused_at      timestamptz,
  exhausted      boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Drives the cadence engine's every-15-minutes scan.
CREATE INDEX IF NOT EXISTS sequences_due_idx ON sequences (next_fire_at)
  WHERE NOT exhausted AND paused_at IS NULL;

-- Checked before every send. An address here is never contacted again.
CREATE TABLE IF NOT EXISTS suppressions (
  email       text PRIMARY KEY,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- approval gate

CREATE TABLE IF NOT EXISTS approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind          approval_kind NOT NULL,
  draft         jsonb NOT NULL,
  agent_run_id  uuid,
  state         approval_state NOT NULL DEFAULT 'pending',
  edited_body   text,
  reject_reason text,
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_pending_idx ON approvals (created_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS approvals_deal_idx ON approvals (deal_id, created_at);

-- ---------------------------------------------------------------- meetings & proposals

CREATE TABLE IF NOT EXISTS meetings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  scheduled_at     timestamptz NOT NULL,
  attendees        jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_ref     text UNIQUE,
  transcript_url   text,
  transcript_text  text,
  brief            jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_upcoming_idx ON meetings (scheduled_at);

CREATE TABLE IF NOT EXISTS deal_briefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  meeting_id    uuid REFERENCES meetings(id) ON DELETE SET NULL,
  scope         jsonb NOT NULL DEFAULT '{}'::jsonb,
  budget        text,
  timeline      text,
  stakeholders  jsonb NOT NULL DEFAULT '[]'::jsonb,
  objections    jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_steps    jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence    numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  version     int  NOT NULL DEFAULT 1,
  markdown    text NOT NULL,
  line_items  jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_price numeric(12,2),
  pdf_path    text,
  sent_at     timestamptz,
  viewed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, version)
);

CREATE TABLE IF NOT EXISTS contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  template           text NOT NULL,
  esign_envelope_id  text UNIQUE,
  status             text NOT NULL DEFAULT 'draft',
  signed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- observability

CREATE TABLE IF NOT EXISTS agent_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent               text NOT NULL,
  model               text NOT NULL,
  playbook_hash       text NOT NULL,
  deal_id             uuid REFERENCES deals(id) ON DELETE SET NULL,
  lead_id             uuid REFERENCES leads(id) ON DELETE SET NULL,
  input               jsonb NOT NULL,
  output              jsonb,
  error               text,
  input_tokens        int NOT NULL DEFAULT 0,
  output_tokens       int NOT NULL DEFAULT 0,
  cache_read_tokens   int NOT NULL DEFAULT 0,
  cache_write_tokens  int NOT NULL DEFAULT 0,
  cost_usd            numeric(10,6) NOT NULL DEFAULT 0,
  duration_ms         int,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs (agent, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_cost_idx ON agent_runs (created_at);
