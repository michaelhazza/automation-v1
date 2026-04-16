-- Migration 0141 — drop_zone_upload_audit
--
-- Append-only audit log for every drop-zone upload (agency + client portal).
-- Immutable by design — no deleted_at, no updated_at trigger. Source of
-- truth for the Weekly Digest "uploads this week" summary, trust-state
-- recomputation, and compliance review.
--
-- Spec: docs/memory-and-briefings-spec.md §5.5 (S9)

CREATE TABLE IF NOT EXISTS drop_zone_upload_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL
    REFERENCES organisations(id),
  subaccount_id uuid NOT NULL
    REFERENCES subaccounts(id),

  /** Null for client-portal uploads (no user session). */
  uploader_user_id uuid,
  uploader_role text NOT NULL
    CHECK (uploader_role IN ('agency_staff', 'client_contact')),

  file_name text NOT NULL,
  /** sha256 hex — dedupe detection. */
  file_hash text NOT NULL,
  proposed_destinations jsonb NOT NULL,
  selected_destinations jsonb NOT NULL,
  applied_destinations jsonb,
  required_approval boolean NOT NULL,
  approved_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  /** Null if rejected or still pending. */
  applied_at timestamptz
);

-- Required indexes per §5.5
CREATE INDEX IF NOT EXISTS drop_zone_upload_audit_subaccount_created_idx
  ON drop_zone_upload_audit (subaccount_id, created_at DESC);
CREATE INDEX IF NOT EXISTS drop_zone_upload_audit_file_hash_idx
  ON drop_zone_upload_audit (file_hash);
CREATE INDEX IF NOT EXISTS drop_zone_upload_audit_role_created_idx
  ON drop_zone_upload_audit (subaccount_id, uploader_role, created_at DESC);

-- RLS
ALTER TABLE drop_zone_upload_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drop_zone_upload_audit_tenant_isolation ON drop_zone_upload_audit;
CREATE POLICY drop_zone_upload_audit_tenant_isolation ON drop_zone_upload_audit
  USING (organisation_id::text = current_setting('app.organisation_id', true));
