-- =============================================================================
-- LLM Router: monetisation engine, financial control layer, audit system
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. llm_pricing — provider pricing table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "llm_pricing" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider"       text NOT NULL,
  "model"          text NOT NULL,
  "input_rate"     numeric(12,8) NOT NULL,
  "output_rate"    numeric(12,8) NOT NULL,
  "effective_from" timestamptz NOT NULL,
  "effective_to"   timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE("provider", "model", "effective_from")
);

-- Seed current pricing
INSERT INTO "llm_pricing" ("provider", "model", "input_rate", "output_rate", "effective_from") VALUES
  ('anthropic', 'claude-opus-4-6',    0.01500000, 0.07500000, now()),
  ('anthropic', 'claude-sonnet-4-6',  0.00300000, 0.01500000, now()),
  ('anthropic', 'claude-haiku-4-5',   0.00025000, 0.00125000, now()),
  ('openai',    'gpt-4o',             0.00250000, 0.01000000, now()),
  ('openai',    'gpt-4o-mini',        0.00015000, 0.00060000, now()),
  ('gemini',    'gemini-2.0-flash',   0.00010000, 0.00040000, now())
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. org_margin_configs — markup layer
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "org_margin_configs" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id"   uuid REFERENCES "organisations"("id"),
  "margin_multiplier" numeric(6,4) NOT NULL DEFAULT 1.30,
  "fixed_fee_cents"   integer NOT NULL DEFAULT 0,
  "notes"             text,
  "effective_from"    timestamptz NOT NULL DEFAULT now(),
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

-- Default platform margin row (NULL organisation_id = platform default)
INSERT INTO "org_margin_configs" ("margin_multiplier", "fixed_fee_cents", "notes")
VALUES (1.30, 0, 'Platform default margin')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. llm_requests — append-only financial ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "llm_requests" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotency (exactly-once billing + execution)
  "idempotency_key"          text UNIQUE NOT NULL,

  -- Attribution
  "organisation_id"          uuid NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id"            uuid REFERENCES "subaccounts"("id"),
  "user_id"                  uuid REFERENCES "users"("id"),
  "source_type"              text NOT NULL DEFAULT 'agent_run',
  "run_id"                   uuid REFERENCES "agent_runs"("id"),
  "execution_id"             uuid REFERENCES "executions"("id"),
  "agent_name"               text,
  "task_type"                text NOT NULL DEFAULT 'general',

  -- Provider
  "provider"                 text NOT NULL DEFAULT 'anthropic',
  "model"                    text NOT NULL,
  "provider_request_id"      text,

  -- Tokens (two sources for dispute resolution)
  "tokens_in"                integer NOT NULL DEFAULT 0,
  "tokens_out"               integer NOT NULL DEFAULT 0,
  "provider_tokens_in"       integer,
  "provider_tokens_out"      integer,

  -- Cost (audit-grade precision)
  "cost_raw"                 numeric(12,8) NOT NULL DEFAULT 0,
  "cost_with_margin"         numeric(12,8) NOT NULL DEFAULT 0,
  "cost_with_margin_cents"   integer NOT NULL DEFAULT 0,
  "margin_multiplier"        numeric(6,4) NOT NULL DEFAULT 1.30,
  "fixed_fee_cents"          integer NOT NULL DEFAULT 0,

  -- Audit hashes
  "request_payload_hash"     text,
  "response_payload_hash"    text,

  -- Latency
  "provider_latency_ms"      integer,
  "router_overhead_ms"       integer,

  -- Status and retry tracking
  "status"                   text NOT NULL DEFAULT 'success',
  "error_message"            text,
  "attempt_number"           integer NOT NULL DEFAULT 1,

  -- Billing period (derived from created_at UTC at insert time)
  "billing_month"            text NOT NULL,
  "billing_day"              text NOT NULL,

  "created_at"               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "llm_requests_org_month_idx"     ON "llm_requests" ("organisation_id", "billing_month");
CREATE INDEX IF NOT EXISTS "llm_requests_subaccount_month_idx" ON "llm_requests" ("subaccount_id", "billing_month");
CREATE INDEX IF NOT EXISTS "llm_requests_run_idx"           ON "llm_requests" ("run_id");
CREATE INDEX IF NOT EXISTS "llm_requests_provider_model_idx" ON "llm_requests" ("provider", "model", "billing_month");
CREATE INDEX IF NOT EXISTS "llm_requests_billing_day_idx"   ON "llm_requests" ("billing_day");
CREATE INDEX IF NOT EXISTS "llm_requests_created_at_idx"    ON "llm_requests" ("created_at" DESC);

-- ---------------------------------------------------------------------------
-- 4. cost_aggregates — pre-aggregated totals (eventually consistent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "cost_aggregates" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type"                text NOT NULL,
  "entity_id"                  text NOT NULL,
  "period_type"                text NOT NULL,
  "period_key"                 text NOT NULL,

  "total_cost_raw"             numeric(12,8) NOT NULL DEFAULT 0,
  "total_cost_with_margin"     numeric(12,8) NOT NULL DEFAULT 0,
  "total_cost_cents"           integer NOT NULL DEFAULT 0,
  "total_tokens_in"            integer NOT NULL DEFAULT 0,
  "total_tokens_out"           integer NOT NULL DEFAULT 0,
  "request_count"              integer NOT NULL DEFAULT 0,
  "error_count"                integer NOT NULL DEFAULT 0,

  "updated_at"                 timestamptz NOT NULL DEFAULT now(),

  UNIQUE("entity_type", "entity_id", "period_type", "period_key")
);

CREATE INDEX IF NOT EXISTS "cost_aggregates_entity_idx" ON "cost_aggregates" ("entity_type", "entity_id", "period_type");

-- ---------------------------------------------------------------------------
-- 5. budget_reservations — soft reservation for concurrency safety
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "budget_reservations" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotency_key"       text NOT NULL,
  "entity_type"           text NOT NULL,
  "entity_id"             text NOT NULL,
  "estimated_cost_cents"  integer NOT NULL,
  "actual_cost_cents"     integer,
  "status"                text NOT NULL DEFAULT 'active',
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "expires_at"            timestamptz NOT NULL DEFAULT (now() + INTERVAL '5 minutes')
);

CREATE INDEX IF NOT EXISTS "budget_reservations_entity_status_idx" ON "budget_reservations" ("entity_type", "entity_id", "status");
CREATE INDEX IF NOT EXISTS "budget_reservations_expires_idx"        ON "budget_reservations" ("expires_at") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "budget_reservations_idempotency_idx"    ON "budget_reservations" ("idempotency_key");

-- ---------------------------------------------------------------------------
-- 6. org_budgets — org-level aggregate monthly caps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "org_budgets" (
  "id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id"           uuid NOT NULL UNIQUE REFERENCES "organisations"("id"),
  "monthly_cost_limit_cents"  integer,
  "alert_threshold_pct"       integer NOT NULL DEFAULT 80,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_at"                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. Extend workspace_limits
-- ---------------------------------------------------------------------------
ALTER TABLE "workspace_limits"
  ADD COLUMN IF NOT EXISTS "monthly_cost_limit_cents"  integer,
  ADD COLUMN IF NOT EXISTS "max_cost_per_run_cents"    integer,
  ADD COLUMN IF NOT EXISTS "max_tokens_per_request"    integer,
  ADD COLUMN IF NOT EXISTS "max_requests_per_minute"   integer,
  ADD COLUMN IF NOT EXISTS "max_requests_per_hour"     integer,
  ADD COLUMN IF NOT EXISTS "max_llm_calls_per_run"     integer;

-- ---------------------------------------------------------------------------
-- 8. Extend subaccount_agents with cost caps
-- ---------------------------------------------------------------------------
ALTER TABLE "subaccount_agents"
  ADD COLUMN IF NOT EXISTS "max_cost_per_run_cents"    integer,
  ADD COLUMN IF NOT EXISTS "max_llm_calls_per_run"     integer;
