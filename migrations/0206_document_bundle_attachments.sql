-- 0206_document_bundle_attachments.sql
--
-- Cached Context Infrastructure Phase 1: document_bundle_attachments table.
-- Polymorphic join table: links a bundle to an agent, task, or scheduled_task.
-- subject_id has no DB FK (polymorphic); enforced at the service layer.
--
-- See docs/cached-context-infrastructure-spec.md §5.5

CREATE TABLE document_bundle_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid REFERENCES subaccounts(id),

  bundle_id           uuid NOT NULL REFERENCES document_bundles(id) ON DELETE CASCADE,

  subject_type        text NOT NULL,   -- 'agent' | 'task' | 'scheduled_task'
  subject_id          uuid NOT NULL,   -- polymorphic; service-enforced

  attachment_mode     text NOT NULL DEFAULT 'always_load',  -- v1: always 'always_load'

  attached_by_user_id uuid REFERENCES users(id),

  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- One live attachment per (bundle, subject) pair.
CREATE UNIQUE INDEX document_bundle_attachments_bundle_subject_uq
  ON document_bundle_attachments (bundle_id, subject_type, subject_id)
  WHERE deleted_at IS NULL;

CREATE INDEX document_bundle_attachments_subject_idx
  ON document_bundle_attachments (subject_type, subject_id);

CREATE INDEX document_bundle_attachments_org_idx
  ON document_bundle_attachments (organisation_id);

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE document_bundle_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_bundle_attachments_org_isolation ON document_bundle_attachments
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);

CREATE POLICY document_bundle_attachments_subaccount_isolation ON document_bundle_attachments
  USING (
    subaccount_id IS NULL
    OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid
  );
