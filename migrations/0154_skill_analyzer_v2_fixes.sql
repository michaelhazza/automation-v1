-- Migration 0154 — skill_analyzer v2 bug-fix cycle
-- See tasks/skill-analyzer-v2-bug-fix-plan.md for the full rationale.
-- Adds resolution tracking, approval freeze, execution lock, config snapshot,
-- proposed-new-agents support, and the skill_analyzer_config singleton.

-- ---------------------------------------------------------------------------
-- skill_analyzer_results: reviewer decisions, approval freeze, debug traces
-- ---------------------------------------------------------------------------

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS warning_resolutions jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Append-only entries (deduped by composite key (warningCode, details.field)):
--   { warningCode, resolution, resolvedAt, resolvedBy, details? }
-- Wiped atomically on any merge edit (§11.11.1).

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS classifier_fallback_applied boolean NOT NULL DEFAULT false;
-- True when the rule-based merger produced this row's proposedMergedContent.

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS execution_resolved_name text;
-- Canonical skill name selected via NAME_MISMATCH resolution; authoritative
-- at Execute time (§11.7 Fix 7).

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
-- Set by setResultAction when action='approved'; presence locks the row
-- against further merge / resolution edits (§11.11.2).

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS approval_decision_snapshot jsonb;
-- Snapshot of evaluateApprovalState result at approve time. Debug trace.

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS approval_hash text;
-- sha256 of stable-stringified approval_decision_snapshot. Used at Execute
-- to detect drift (§11.12.1).

ALTER TABLE skill_analyzer_results
  ADD COLUMN IF NOT EXISTS was_approved_before boolean NOT NULL DEFAULT false;
-- Set true on first approval; never reset. UI uses it to surface an
-- "edited after previous approval" badge after unapprove/edit/re-approve.

-- ---------------------------------------------------------------------------
-- skill_analyzer_jobs: config snapshot, proposed agents array, execute lock
-- ---------------------------------------------------------------------------

ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS proposed_new_agents jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Array of proposed agent entries supporting N-per-job. Each entry:
-- { proposedAgentIndex, slug, name, description, reasoning, skillSlugs,
--   status: 'proposed'|'confirmed'|'rejected', confirmedAt?, rejectedAt? }

ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb;
-- Full skill_analyzer_config row captured at job start; immutable after
-- INSERT. Validator, collision detector, and Execute read from here, never
-- from the live config table.

ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS config_version_used integer;
-- Derived from config_snapshot.config_version. Kept for UI display.

ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS execution_lock boolean NOT NULL DEFAULT false;
ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;
ALTER TABLE skill_analyzer_jobs
  ADD COLUMN IF NOT EXISTS execution_finished_at timestamptz;
-- Atomic concurrency guard against double-Execute (§11.11.3).

-- ---------------------------------------------------------------------------
-- skill_analyzer_config: singleton tunable thresholds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_analyzer_config (
  key                                      text        PRIMARY KEY DEFAULT 'default',
  config_version                           integer     NOT NULL DEFAULT 1,
  classifier_fallback_confidence_score     real        NOT NULL DEFAULT 0.30,
  scope_expansion_standard_threshold       real        NOT NULL DEFAULT 0.40,
  scope_expansion_critical_threshold       real        NOT NULL DEFAULT 0.75,
  collision_detection_threshold            real        NOT NULL DEFAULT 0.40,
  collision_max_candidates                 integer     NOT NULL DEFAULT 20,
  max_table_growth_ratio                   real        NOT NULL DEFAULT 1.5,
  execution_lock_stale_seconds             integer     NOT NULL DEFAULT 600,
  execution_auto_unlock_enabled            boolean     NOT NULL DEFAULT false,
  critical_warning_confirmation_phrase     text        NOT NULL DEFAULT 'I accept this critical warning',
  warning_tier_map                         jsonb       NOT NULL DEFAULT '{
    "REQUIRED_FIELD_DEMOTED":   "decision_required",
    "NAME_MISMATCH":            "decision_required",
    "SKILL_GRAPH_COLLISION":    "decision_required",
    "INVOCATION_LOST":          "decision_required",
    "HITL_LOST":                "decision_required",
    "CLASSIFIER_FALLBACK":      "decision_required",
    "SCOPE_EXPANSION_CRITICAL": "critical",
    "SCOPE_EXPANSION":          "standard",
    "CAPABILITY_OVERLAP":       "standard",
    "TABLE_ROWS_DROPPED":       "informational",
    "OUTPUT_FORMAT_LOST":       "informational",
    "WARNINGS_TRUNCATED":       "informational"
  }'::jsonb,
  updated_at                               timestamptz NOT NULL DEFAULT now(),
  updated_by                               uuid
);

-- Seed the default row (idempotent).
INSERT INTO skill_analyzer_config (key) VALUES ('default')
ON CONFLICT (key) DO NOTHING;
