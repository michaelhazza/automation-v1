-- =============================================================================
-- 0036_phase1b_review_audit_and_oauth.sql
-- Phase 1B: Review audit records + OAuth columns on integration_connections.
--
-- Changes:
--   1. Create review_audit_records — HumanFeedbackResult audit log (Section 4)
--   2. Extend integration_connections with OAuth-specific columns (Section 5)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. audit_events — lightweight security audit log for compliance & debugging
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id"               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "organisation_id"  UUID        REFERENCES "organisations"("id"),
  "actor_id"         UUID,
  "actor_type"       TEXT        NOT NULL,
  "action"           TEXT        NOT NULL,
  "entity_type"      TEXT,
  "entity_id"        UUID,
  "metadata"         JSONB,
  "ip_address"       TEXT,
  "created_at"       TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_events_org_created_idx"
  ON "audit_events" ("organisation_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_actor_created_idx"
  ON "audit_events" ("actor_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_action_created_idx"
  ON "audit_events" ("action", "created_at");

-- ---------------------------------------------------------------------------
-- 1. review_audit_records
--    Append-only. One row per human decision on a review-gated action.
--    Modelled after CrewAI's HumanFeedbackResult schema.
--    The DB-level CHECK constraint enforces comment requirement on rejection;
--    the API also enforces this before we reach the service layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "review_audit_records" (
  "id"               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "action_id"        UUID        NOT NULL REFERENCES "actions"("id"),
  "organisation_id"  UUID        NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id"    UUID        NOT NULL REFERENCES "subaccounts"("id"),
  "agent_run_id"     UUID        REFERENCES "agent_runs"("id"),
  "tool_slug"        TEXT        NOT NULL,

  -- Snapshot of what the agent proposed at review time
  "agent_output"     JSONB       NOT NULL,

  -- Human decision
  "decided_by"       UUID        NOT NULL REFERENCES "users"("id"),
  "decision"         TEXT        NOT NULL
    CHECK ("decision" IN ('approved', 'rejected', 'edited', 'timed_out')),
  "raw_feedback"     TEXT,
  -- LLM-collapsed outcome (async, written after record insert)
  "collapsed_outcome" TEXT
    CHECK ("collapsed_outcome" IN ('approved', 'rejected', 'needs_revision')),
  "edited_args"      JSONB,

  -- Timing
  "proposed_at"      TIMESTAMPTZ NOT NULL,
  "decided_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- decided_at - proposed_at in ms — computed by application layer
  "wait_duration_ms" INTEGER,

  CONSTRAINT "feedback_required"
    CHECK (
      "decision" != 'rejected'
      OR ("raw_feedback" IS NOT NULL AND length("raw_feedback") > 0)
    )
);

CREATE INDEX IF NOT EXISTS "review_audit_org_idx"
  ON "review_audit_records" ("organisation_id", "decided_at" DESC);

CREATE INDEX IF NOT EXISTS "review_audit_subaccount_idx"
  ON "review_audit_records" ("subaccount_id", "decided_at" DESC);

CREATE INDEX IF NOT EXISTS "review_audit_action_idx"
  ON "review_audit_records" ("action_id");

-- ---------------------------------------------------------------------------
-- 2. integration_connections — OAuth-specific columns (Activepieces pattern)
--
-- claimed_at + expires_in avoids clock-drift issues with stored expires_at.
-- token_url / client_id_enc / client_secret_enc stored for refresh calls.
-- connection_status gains two new values: expired, disconnected.
-- ---------------------------------------------------------------------------
ALTER TABLE "integration_connections"
  ADD COLUMN IF NOT EXISTS "claimed_at"        BIGINT,
  ADD COLUMN IF NOT EXISTS "expires_in"        INTEGER,
  ADD COLUMN IF NOT EXISTS "token_url"         TEXT,
  -- Encrypted with TOKEN_ENCRYPTION_KEY (same AES-256-GCM as access_token)
  ADD COLUMN IF NOT EXISTS "client_id_enc"     TEXT,
  ADD COLUMN IF NOT EXISTS "client_secret_enc" TEXT,
  -- Extend status values — handle in application layer for existing 'revoked'
  ADD COLUMN IF NOT EXISTS "oauth_status"      TEXT DEFAULT 'active'
    CHECK ("oauth_status" IN ('active', 'expired', 'error', 'disconnected'));
