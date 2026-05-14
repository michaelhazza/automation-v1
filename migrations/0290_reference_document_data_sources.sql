CREATE TABLE reference_document_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  -- Five-tier scope: exactly zero or one of the four FK columns is non-NULL.
  -- organisation tier = all four NULL.
  subaccount_id uuid REFERENCES subaccounts(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
  scheduled_task_id uuid REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  task_instance_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- Scope-tier CHECK: exactly zero or one FK column is non-NULL
  CONSTRAINT rdds_exactly_one_scope_tier CHECK (
    (CASE WHEN subaccount_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN scheduled_task_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN task_instance_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  )
);

-- Partial unique indexes — one per scope tier
CREATE UNIQUE INDEX rdds_org_tier_uq ON reference_document_data_sources (document_id) WHERE subaccount_id IS NULL AND agent_id IS NULL AND scheduled_task_id IS NULL AND task_instance_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX rdds_subaccount_tier_uq ON reference_document_data_sources (document_id, subaccount_id) WHERE subaccount_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX rdds_agent_tier_uq ON reference_document_data_sources (document_id, agent_id) WHERE agent_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX rdds_scheduled_task_tier_uq ON reference_document_data_sources (document_id, scheduled_task_id) WHERE scheduled_task_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX rdds_task_instance_tier_uq ON reference_document_data_sources (document_id, task_instance_id) WHERE task_instance_id IS NOT NULL AND deleted_at IS NULL;

-- Lookup indexes per scope FK
CREATE INDEX rdds_subaccount_idx ON reference_document_data_sources (subaccount_id) WHERE subaccount_id IS NOT NULL;
CREATE INDEX rdds_agent_idx ON reference_document_data_sources (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX rdds_scheduled_task_idx ON reference_document_data_sources (scheduled_task_id) WHERE scheduled_task_id IS NOT NULL;
CREATE INDEX rdds_task_instance_idx ON reference_document_data_sources (task_instance_id) WHERE task_instance_id IS NOT NULL;
CREATE INDEX rdds_org_doc_idx ON reference_document_data_sources (organisation_id, document_id) WHERE deleted_at IS NULL;

-- RLS (canonical three-condition form matching migrations 0245, 0284, 0289)
ALTER TABLE reference_document_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_document_data_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_document_data_sources_org_isolation ON reference_document_data_sources
  USING (organisation_id IS NOT NULL AND organisation_id::text <> '' AND organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id IS NOT NULL AND organisation_id::text <> '' AND organisation_id = current_setting('app.organisation_id', true)::uuid);
