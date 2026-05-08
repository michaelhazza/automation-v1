-- document_promotion_audit: append-only ledger for the file→reference-document promotion path.
-- The unique partial index is the idempotency anchor: two concurrent promotes of the same file
-- collide here and the loser receives a 409 Conflict with the existing documentId.
CREATE TABLE document_promotion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  file_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES reference_documents(id),
  principal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX document_promotion_audit_unique_per_file
  ON document_promotion_audit (file_id)
  WHERE deleted_at IS NULL;

CREATE INDEX document_promotion_audit_org_idx
  ON document_promotion_audit (organisation_id);

ALTER TABLE document_promotion_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_promotion_audit FORCE ROW LEVEL SECURITY;

CREATE POLICY document_promotion_audit_org_isolation
  ON document_promotion_audit
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
