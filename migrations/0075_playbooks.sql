-- =============================================================================
-- Playbooks — multi-step automation engine
--
-- Spec: tasks/playbooks-spec.md (final, build-ready)
--
-- Schema only — services, routes, engine, and UI ship in subsequent commits
-- per §12.1 implementation order. Forward-only migration per project
-- convention. Down migration kept at 0075_playbooks.down.sql for local
-- rollback only — never run in production.
--
-- Tables created:
--   1. system_playbook_templates              (platform-shipped templates)
--   2. system_playbook_template_versions      (immutable system versions)
--   3. playbook_templates                     (org-owned, may fork from system)
--   4. playbook_template_versions             (immutable org versions)
--   5. playbook_runs                          (run instances per subaccount)
--   6. playbook_run_event_sequences           (per-run WS sequence counter)
--   7. playbook_step_runs                     (per-step execution records)
--   8. playbook_step_reviews                  (HITL approval gate records)
--   9. playbook_studio_sessions               (Studio chat authoring sessions)
--
-- One additive column on agent_runs:
--   - playbook_step_run_id                    (engine reverse lookup)
--
-- Side-effect classification, status enums, and check constraints follow the
-- repo convention of TEXT + CHECK (no Postgres CREATE TYPE).
-- =============================================================================

-- ─── 1. system_playbook_templates ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_playbook_templates (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            TEXT        NOT NULL UNIQUE,
  name            TEXT        NOT NULL,
  description     TEXT        NOT NULL DEFAULT '',
  latest_version  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS system_playbook_templates_slug_idx
  ON system_playbook_templates (slug)
  WHERE deleted_at IS NULL;

-- ─── 2. system_playbook_template_versions ────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_playbook_template_versions (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  system_template_id  UUID        NOT NULL REFERENCES system_playbook_templates(id) ON DELETE RESTRICT,
  version             INTEGER     NOT NULL,
  definition_json     JSONB       NOT NULL,
  published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS system_playbook_template_versions_unique_idx
  ON system_playbook_template_versions (system_template_id, version);

-- ─── 3. playbook_templates ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS playbook_templates (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id         UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  slug                    TEXT        NOT NULL,
  name                    TEXT        NOT NULL,
  description             TEXT        NOT NULL DEFAULT '',
  forked_from_system_id   UUID        REFERENCES system_playbook_templates(id) ON DELETE SET NULL,
  forked_from_version     INTEGER,
  latest_version          INTEGER     NOT NULL DEFAULT 0,
  created_by_user_id      UUID        REFERENCES users(id),
  -- Phase 1.5 — parameterization layer column. Empty in Phase 1.
  params_json             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS playbook_templates_org_slug_unique_idx
  ON playbook_templates (organisation_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS playbook_templates_org_idx
  ON playbook_templates (organisation_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS playbook_templates_forked_from_idx
  ON playbook_templates (forked_from_system_id);

-- ─── 4. playbook_template_versions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS playbook_template_versions (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id           UUID        NOT NULL REFERENCES playbook_templates(id) ON DELETE RESTRICT,
  version               INTEGER     NOT NULL,
  definition_json       JSONB       NOT NULL,
  published_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by_user_id  UUID        REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS playbook_template_versions_unique_idx
  ON playbook_template_versions (template_id, version);

-- ─── 5. playbook_runs ────────────────────────────────────────────────────────
--
-- status values:
--   pending, running, awaiting_input, awaiting_approval,
--   completed, completed_with_errors, failed, cancelling, cancelled
--
-- replay_mode: when true, engine reads stored outputs instead of dispatching
--              external work — see spec §5.10
-- retain_indefinitely: opt-in audit retention; excluded from inline-ref GC

CREATE TABLE IF NOT EXISTS playbook_runs (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id         UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id           UUID        NOT NULL REFERENCES subaccounts(id) ON DELETE RESTRICT,
  template_version_id     UUID        NOT NULL REFERENCES playbook_template_versions(id) ON DELETE RESTRICT,
  status                  TEXT        NOT NULL DEFAULT 'pending',
  context_json            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  context_size_bytes      INTEGER     NOT NULL DEFAULT 0,
  replay_mode             BOOLEAN     NOT NULL DEFAULT FALSE,
  retain_indefinitely     BOOLEAN     NOT NULL DEFAULT FALSE,
  started_by_user_id      UUID        REFERENCES users(id),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  error                   TEXT,
  failed_due_to_step_id   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT playbook_runs_status_chk CHECK (status IN (
    'pending', 'running', 'awaiting_input', 'awaiting_approval',
    'completed', 'completed_with_errors', 'failed', 'cancelling', 'cancelled'
  ))
);

CREATE INDEX IF NOT EXISTS playbook_runs_org_status_idx
  ON playbook_runs (organisation_id, status);

CREATE INDEX IF NOT EXISTS playbook_runs_subaccount_status_idx
  ON playbook_runs (subaccount_id, status);

CREATE INDEX IF NOT EXISTS playbook_runs_template_version_idx
  ON playbook_runs (template_version_id);

-- ─── 6. playbook_run_event_sequences ─────────────────────────────────────────
-- Per-run monotonic counter for WebSocket event envelope (spec §8.2).
-- Allocated via UPDATE ... RETURNING last_sequence + 1 in the same tx as
-- the state mutation that emits the event.

CREATE TABLE IF NOT EXISTS playbook_run_event_sequences (
  run_id          UUID    NOT NULL PRIMARY KEY REFERENCES playbook_runs(id) ON DELETE CASCADE,
  last_sequence   BIGINT  NOT NULL DEFAULT 0
);

-- ─── 7. playbook_step_runs ───────────────────────────────────────────────────
--
-- step_type values: prompt, agent_call, user_input, approval, conditional
-- status values: pending, running, awaiting_input, awaiting_approval,
--                completed, failed, skipped, invalidated
-- side_effect_type values: none, idempotent, reversible, irreversible

CREATE TABLE IF NOT EXISTS playbook_step_runs (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id              UUID        NOT NULL REFERENCES playbook_runs(id) ON DELETE CASCADE,
  step_id             TEXT        NOT NULL,
  step_type           TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending',
  side_effect_type    TEXT        NOT NULL,
  depends_on          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  input_json          JSONB,
  input_hash          TEXT,
  output_json         JSONB,
  output_hash         TEXT,
  output_inline_ref_id UUID,
  quality_score       SMALLINT,
  evaluation_meta     JSONB,
  agent_run_id        UUID, -- reverse FK added separately below; set on dispatch
  attempt             INTEGER     NOT NULL DEFAULT 1,
  version             INTEGER     NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT playbook_step_runs_status_chk CHECK (status IN (
    'pending', 'running', 'awaiting_input', 'awaiting_approval',
    'completed', 'failed', 'skipped', 'invalidated'
  )),
  CONSTRAINT playbook_step_runs_step_type_chk CHECK (step_type IN (
    'prompt', 'agent_call', 'user_input', 'approval', 'conditional'
  )),
  CONSTRAINT playbook_step_runs_side_effect_chk CHECK (side_effect_type IN (
    'none', 'idempotent', 'reversible', 'irreversible'
  ))
);

CREATE INDEX IF NOT EXISTS playbook_step_runs_run_id_status_idx
  ON playbook_step_runs (run_id, status);

CREATE INDEX IF NOT EXISTS playbook_step_runs_agent_run_id_idx
  ON playbook_step_runs (agent_run_id)
  WHERE agent_run_id IS NOT NULL;

-- Partial unique: only one live attempt per (run, step). 'invalidated' and
-- 'failed' rows stay for audit but do not occupy the slot.
CREATE UNIQUE INDEX IF NOT EXISTS playbook_step_runs_run_step_live_unique_idx
  ON playbook_step_runs (run_id, step_id)
  WHERE status NOT IN ('invalidated', 'failed');

-- ─── 8. playbook_step_reviews ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS playbook_step_reviews (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  step_run_id         UUID        NOT NULL REFERENCES playbook_step_runs(id) ON DELETE CASCADE,
  review_item_id      UUID,       -- references review_items but FK added later if needed
  decision            TEXT        NOT NULL DEFAULT 'pending',
  decided_by_user_id  UUID        REFERENCES users(id),
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT playbook_step_reviews_decision_chk CHECK (decision IN (
    'pending', 'approved', 'rejected', 'edited'
  ))
);

CREATE INDEX IF NOT EXISTS playbook_step_reviews_step_run_idx
  ON playbook_step_reviews (step_run_id);

-- ─── 9. playbook_studio_sessions (Studio authoring; spec §10.8.7) ────────────

CREATE TABLE IF NOT EXISTS playbook_studio_sessions (
  id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by_user_id          UUID        NOT NULL REFERENCES users(id),
  agent_run_id                UUID,       -- links to underlying chat agent run
  candidate_file_contents     TEXT        NOT NULL DEFAULT '',
  candidate_validation_state  TEXT        NOT NULL DEFAULT 'unvalidated',
  pr_url                      TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT playbook_studio_sessions_validation_chk CHECK (candidate_validation_state IN (
    'unvalidated', 'valid', 'invalid'
  ))
);

CREATE INDEX IF NOT EXISTS playbook_studio_sessions_user_idx
  ON playbook_studio_sessions (created_by_user_id);

-- ─── 10. agent_runs additive column ──────────────────────────────────────────
-- Reverse link from agent_runs to playbook_step_runs so the engine's
-- onAgentRunCompleted hook can find the originating step run.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS playbook_step_run_id UUID;

CREATE INDEX IF NOT EXISTS agent_runs_playbook_step_run_id_idx
  ON agent_runs (playbook_step_run_id)
  WHERE playbook_step_run_id IS NOT NULL;
