-- =============================================================================
-- Reporting Agent paywall workflow — Code Change D + ancillary T12/T16
-- Spec: docs/reporting-agent-paywall-workflow-spec.md §6 (Code Change D),
--       §6.7.2 (T16 fingerprint), §6.7.3 (T12 inline text durability).
--
-- Schema changes only — runtime helpers, services and routes are added in
-- separate commits. Forward-only migration per project convention.
-- =============================================================================

-- ─── 1. Fingerprint storage on subaccount_agents (T16, by-intent shape) ──────
-- Map of intent → fingerprint of last successfully processed content. Persisted
-- only after download + validation + transcribe + report all succeed so a
-- partial failure does not poison future runs.

ALTER TABLE subaccount_agents
  ADD COLUMN IF NOT EXISTS last_processed_fingerprints_by_intent JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ─── 2. Inline text durability on iee_artifacts (T12) ────────────────────────
-- Allows small text artifacts (transcripts, generated reports) to survive
-- worker container cleanup. Hard ceiling enforced in application code by
-- writeWithLimit() — see server/lib/inlineTextWriter.ts.

ALTER TABLE iee_artifacts
  ADD COLUMN IF NOT EXISTS inline_text TEXT;

ALTER TABLE iee_artifacts
  ADD COLUMN IF NOT EXISTS inline_text_truncated BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 3. Inline text durability on task_deliverables (T12) ────────────────────
-- Source of truth for deliverable bodies, so they outlive ephemeral worker
-- file paths.

ALTER TABLE task_deliverables
  ADD COLUMN IF NOT EXISTS body_text TEXT;

ALTER TABLE task_deliverables
  ADD COLUMN IF NOT EXISTS body_text_truncated BOOLEAN NOT NULL DEFAULT FALSE;

-- Note: integration_connections.providerType and authType enums are TEXT
-- columns with TypeScript-side $type narrowing; no schema change is needed
-- to add 'web_login' as a valid value. The application layer enforces the
-- enum via zod validation in route schemas.
