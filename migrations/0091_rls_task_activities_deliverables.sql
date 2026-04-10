-- 0091_rls_task_activities_deliverables.sql
--
-- Adds organisation_id to task_activities and task_deliverables (denormalised
-- from tasks.organisation_id via task_id FK), backfills existing rows, then
-- creates the standard fail-closed RLS org-isolation policies.
--
-- See 0079 for the policy shape + fail-closed rationale.

-- ---------------------------------------------------------------------------
-- task_activities — add column, backfill, set NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE task_activities
  ADD COLUMN organisation_id UUID;

UPDATE task_activities ta
  SET organisation_id = t.organisation_id
  FROM tasks t
  WHERE ta.task_id = t.id;

-- Any orphaned rows (task deleted with CASCADE) get cleaned up
DELETE FROM task_activities WHERE organisation_id IS NULL;

ALTER TABLE task_activities
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE task_activities
  ADD CONSTRAINT task_activities_organisation_id_fk
  FOREIGN KEY (organisation_id) REFERENCES organisations(id);

CREATE INDEX task_activities_org_idx ON task_activities (organisation_id);

-- RLS
ALTER TABLE task_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_activities_org_isolation ON task_activities;
CREATE POLICY task_activities_org_isolation ON task_activities
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

-- ---------------------------------------------------------------------------
-- task_deliverables — add column, backfill, set NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE task_deliverables
  ADD COLUMN organisation_id UUID;

UPDATE task_deliverables td
  SET organisation_id = t.organisation_id
  FROM tasks t
  WHERE td.task_id = t.id;

-- Any orphaned rows (task deleted with CASCADE) get cleaned up
DELETE FROM task_deliverables WHERE organisation_id IS NULL;

ALTER TABLE task_deliverables
  ALTER COLUMN organisation_id SET NOT NULL;

ALTER TABLE task_deliverables
  ADD CONSTRAINT task_deliverables_organisation_id_fk
  FOREIGN KEY (organisation_id) REFERENCES organisations(id);

CREATE INDEX task_deliverables_org_idx ON task_deliverables (organisation_id);

-- RLS
ALTER TABLE task_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_deliverables FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_deliverables_org_isolation ON task_deliverables;
CREATE POLICY task_deliverables_org_isolation ON task_deliverables
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
