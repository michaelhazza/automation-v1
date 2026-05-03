-- Workflows V1 Chunk 13: task deliverable version history for diff/revert.
-- Spec: docs/workflows-dev-spec.md §12.

CREATE TABLE IF NOT EXISTS task_deliverable_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  deliverable_id uuid NOT NULL REFERENCES task_deliverables(id) ON DELETE CASCADE,
  version integer NOT NULL,
  body_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  change_note text,
  CONSTRAINT task_deliverable_versions_deliverable_version_uq UNIQUE (deliverable_id, version)
);

CREATE INDEX IF NOT EXISTS task_deliverable_versions_deliverable_version_idx
  ON task_deliverable_versions (deliverable_id, version);

CREATE INDEX IF NOT EXISTS task_deliverable_versions_org_idx
  ON task_deliverable_versions (organisation_id);

-- RLS: read/write scoped by organisation_id
ALTER TABLE task_deliverable_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_deliverable_versions_org_isolation
  ON task_deliverable_versions
  USING (organisation_id = current_setting('app.current_organisation_id', TRUE)::uuid);
