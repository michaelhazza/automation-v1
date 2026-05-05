-- 0205_document_bundle_members.sql
--
-- Cached Context Infrastructure Phase 1: document_bundle_members table.
-- Join table: one row per document-in-bundle membership.
-- Membership order is NOT stored; ordering is deterministic at resolution
-- time by document_id ascending.
--
-- See docs/cached-context-infrastructure-spec.md §5.4

CREATE TABLE document_bundle_members (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id               uuid NOT NULL REFERENCES document_bundles(id) ON DELETE CASCADE,
  -- RESTRICT prevents accidental document deletion while it's still a bundle member.
  document_id             uuid NOT NULL REFERENCES reference_documents(id) ON DELETE RESTRICT,

  added_in_bundle_version integer NOT NULL,

  created_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  removed_in_bundle_version integer
);

-- Prevent duplicate membership (soft-deleted rows excluded).
CREATE UNIQUE INDEX document_bundle_members_bundle_doc_uq
  ON document_bundle_members (bundle_id, document_id)
  WHERE deleted_at IS NULL;

CREATE INDEX document_bundle_members_bundle_idx
  ON document_bundle_members (bundle_id);

CREATE INDEX document_bundle_members_doc_idx
  ON document_bundle_members (document_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Inherits organisation isolation via the parent bundle row.

ALTER TABLE document_bundle_members ENABLE ROW LEVEL SECURITY;

-- @rls-baseline: phantom-var policy replaced at runtime by migration 0213_fix_cached_context_rls.sql
CREATE POLICY document_bundle_members_org_isolation ON document_bundle_members
  USING (
    EXISTS (
      SELECT 1 FROM document_bundles db
      WHERE db.id = bundle_id
        AND db.organisation_id = current_setting('app.current_organisation_id', true)::uuid
    )
  );
