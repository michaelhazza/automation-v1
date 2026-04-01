-- =============================================================================
-- 0035_phase1a_policy_engine_and_resume.sql
-- Phase 1A: Policy Engine, Suspend/Resume schema, and Organisation Secrets.
--
-- Changes:
--   1. Extend actions table with suspend/resume and integrity columns
--   2. Create action_resume_events — durable decision log for all approve/reject
--   3. Create organisation_secrets — per-org encryption key registry
--   4. Create policy_rules — configurable gate level per tool/context
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend actions table
-- ---------------------------------------------------------------------------
ALTER TABLE "actions"
  ADD COLUMN IF NOT EXISTS "suspend_count"     INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "suspend_until"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "wac_checkpoint"    JSONB,
  ADD COLUMN IF NOT EXISTS "input_hash"        TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_comment" TEXT;

-- ---------------------------------------------------------------------------
-- 2. action_resume_events
--    Immutable log of every human decision on a review-gated action.
--    Written by reviewService on approve/reject and on timeout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "action_resume_events" (
  "id"              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "action_id"       UUID        NOT NULL REFERENCES "actions"("id") ON DELETE CASCADE,
  "organisation_id" UUID        NOT NULL REFERENCES "organisations"("id"),
  "subaccount_id"   UUID        NOT NULL REFERENCES "subaccounts"("id"),
  -- 'approved' | 'rejected' | 'timeout' | 'edited'
  "event_type"      TEXT        NOT NULL
    CHECK ("event_type" IN ('approved', 'rejected', 'timeout', 'edited')),
  "resolved_by"     UUID        REFERENCES "users"("id"),
  "payload"         JSONB,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "action_resume_events_action_idx"
  ON "action_resume_events" ("action_id");

CREATE INDEX IF NOT EXISTS "action_resume_events_org_created_idx"
  ON "action_resume_events" ("organisation_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- 3. organisation_secrets
--    Stores one AES-256-GCM encrypted master key per organisation.
--    The encryption_key_enc value is itself encrypted with the server-level
--    KEK (ENCRYPTION_MASTER_KEY env var) so plaintext keys never touch disk.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "organisation_secrets" (
  "id"                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "organisation_id"     UUID        NOT NULL UNIQUE REFERENCES "organisations"("id"),
  "encryption_key_enc"  TEXT        NOT NULL,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "rotated_at"          TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 4. policy_rules
--    First-match, priority-ordered gate level rules per org.
--    A wildcard fallback (priority 9999, tool_slug = '*', decision = 'review')
--    is seeded for every organisation so there is always a catch-all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "policy_rules" (
  "id"                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  "organisation_id"      UUID        NOT NULL REFERENCES "organisations"("id"),
  -- null = org-wide; non-null = applies only to this subaccount
  "subaccount_id"        UUID        REFERENCES "subaccounts"("id"),
  -- exact match or '*' wildcard
  "tool_slug"            TEXT        NOT NULL,
  -- lower priority number = evaluated first; 9999 = fallback
  "priority"             INTEGER     NOT NULL DEFAULT 100,
  -- extensible condition bag (user_role, amount_usd, environment, …)
  "conditions"           JSONB       NOT NULL DEFAULT '{}',
  "decision"             TEXT        NOT NULL
    CHECK ("decision" IN ('auto', 'review', 'block')),
  "evaluation_mode"      TEXT        NOT NULL DEFAULT 'first_match',
  -- reviewer UI options (allow_ignore, allow_respond, allow_edit, allow_accept)
  "interrupt_config"     JSONB,
  -- allowed outcome types for this rule
  "allowed_decisions"    JSONB,
  -- markdown description template for the reviewer
  "description_template" TEXT,
  "timeout_seconds"      INTEGER,
  "timeout_policy"       TEXT
    CHECK ("timeout_policy" IN ('auto_reject', 'auto_approve', 'escalate')),
  "is_active"            BOOLEAN     NOT NULL DEFAULT TRUE,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "policy_rules_org_priority_idx"
  ON "policy_rules" ("organisation_id", "is_active", "priority" ASC);

CREATE INDEX IF NOT EXISTS "policy_rules_tool_idx"
  ON "policy_rules" ("organisation_id", "tool_slug")
  WHERE "is_active" = TRUE;

-- Backfill: seed the wildcard fallback rule for all existing organisations.
-- New orgs are seeded by organisationService.createOrganisation.
INSERT INTO "policy_rules"
  ("organisation_id", "tool_slug", "priority", "conditions", "decision", "evaluation_mode", "is_active")
SELECT
  "id", '*', 9999, '{}'::jsonb, 'review', 'first_match', TRUE
FROM "organisations"
WHERE "deleted_at" IS NULL
ON CONFLICT DO NOTHING;
