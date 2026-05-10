CREATE TABLE run_artifacts (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID         NOT NULL REFERENCES organisations(id),
  agent_run_id      UUID         REFERENCES agent_runs(id) ON DELETE SET NULL,
  iee_run_id        UUID         REFERENCES iee_runs(id) ON DELETE SET NULL,
  artifact_kind     TEXT         NOT NULL CHECK (artifact_kind IN ('report','transcript','media','attachment','log')),
  display_name      TEXT         NOT NULL,
  mime_type         TEXT         NOT NULL,
  size_bytes        BIGINT       NOT NULL,
  content_hash      TEXT         NOT NULL,
  storage_provider  TEXT         NOT NULL DEFAULT 's3' CHECK (storage_provider IN ('s3','gcs','r2')),
  storage_key       TEXT         NOT NULL,
  storage_region    TEXT,
  retain_until      TIMESTAMP WITH TIME ZONE,
  download_count    INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Composite partial unique index — key-based idempotency
-- Excludes NULL agent_run_id (happens after ON DELETE SET NULL)
CREATE UNIQUE INDEX run_artifacts_run_kind_hash_unique
  ON run_artifacts (organisation_id, agent_run_id, artifact_kind, content_hash)
  WHERE agent_run_id IS NOT NULL;

CREATE INDEX run_artifacts_org_run_idx ON run_artifacts (organisation_id, agent_run_id);
CREATE INDEX run_artifacts_retain_until_idx ON run_artifacts (retain_until) WHERE retain_until IS NOT NULL;

ALTER TABLE run_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS run_artifacts_org_isolation ON run_artifacts;
CREATE POLICY run_artifacts_org_isolation ON run_artifacts
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
