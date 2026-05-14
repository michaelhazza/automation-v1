-- Migration 0353: Create operator_run_files table
--
-- Tenant-scoped artefact-metadata table for operator-session file events.
-- Keyed on (agent_run_id, path) — one row per file path per run (latest-metadata
-- model). Version is updated in place via the canonical UPSERT:
--
--   INSERT INTO operator_run_files (..., version, ...) VALUES (..., 1, ...)
--   ON CONFLICT (agent_run_id, path) DO UPDATE SET
--     version        = operator_run_files.version + 1,
--     size_bytes     = EXCLUDED.size_bytes,
--     content_sha256 = EXCLUDED.content_sha256,
--     mime_type      = EXCLUDED.mime_type,
--     emitted_by     = EXCLUDED.emitted_by,
--     emitted_at     = NOW()
--   RETURNING version;
--
-- Postgres serialises conflicting INSERTs on the unique constraint; each
-- writer increments the prior version atomically under the row lock.
-- Event type is derived from the returned version: 1 => file.created,
-- >1 => file.modified. Preflight existence checks are never the event-type
-- source (spec §5.7).
--
-- RLS: canonical org-isolation policy on the row's own organisation_id column
-- (no JOIN through agent_runs — faster plan per spec §6.1).
--
-- Strategy locked 2026-05-13: new table, not an extension of execution_files.
-- execution_files is keyed on IEE executions (distinct lifecycle/domain);
-- reusing it would force confusing dual-parent semantics.
--
-- Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md
-- §4.1 (migration 0353), §5.7, §6.1, §9.1, §9.3

CREATE TABLE IF NOT EXISTS operator_run_files (
  id               UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  agent_run_id     UUID        NOT NULL REFERENCES agent_runs(id)   ON DELETE CASCADE,
  path             TEXT        NOT NULL,
  version          INTEGER     NOT NULL DEFAULT 1,
  size_bytes       BIGINT      NOT NULL DEFAULT 0,
  content_sha256   TEXT        NOT NULL,
  mime_type        TEXT        NOT NULL,
  storage_key      TEXT        NOT NULL,
  owner_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  subaccount_id    UUID        REFERENCES subaccounts(id) ON DELETE CASCADE,
  emitted_by       TEXT        NOT NULL,
  emitted_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT operator_run_files_path_run_uniq    UNIQUE (agent_run_id, path),
  CONSTRAINT operator_run_files_version_pos      CHECK  (version >= 1),
  CONSTRAINT operator_run_files_size_nonneg      CHECK  (size_bytes >= 0),
  CONSTRAINT operator_run_files_path_nonempty    CHECK  (path <> ''),
  CONSTRAINT operator_run_files_storage_nonempty CHECK  (storage_key <> ''),
  CONSTRAINT operator_run_files_emitted_by_enum  CHECK  (emitted_by IN ('tool_call', 'watcher'))
);

-- Supporting indexes
CREATE INDEX IF NOT EXISTS operator_run_files_org_run_idx
  ON operator_run_files (organisation_id, agent_run_id);

-- Row Level Security — canonical org-isolation policy.
-- Filters on the row's own organisation_id column (no JOIN needed).
ALTER TABLE operator_run_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_run_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_run_files_org_isolation ON operator_run_files;
CREATE POLICY operator_run_files_org_isolation ON operator_run_files
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
