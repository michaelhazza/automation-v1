-- Migration 0212: bundle_suggestion_dismissals
-- Records per-user permanent dismissals of the bundle-save suggestion (§5.12).

CREATE TABLE bundle_suggestion_dismissals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisations(id),
  subaccount_id    uuid REFERENCES subaccounts(id),
  user_id          uuid NOT NULL REFERENCES users(id),

  -- Canonical hash of the document set (sorted IDs, SHA-256)
  doc_set_hash     text NOT NULL,

  dismissed_at     timestamptz NOT NULL DEFAULT now()
);

-- One dismissal per user per doc set
CREATE UNIQUE INDEX bundle_suggestion_dismissals_user_doc_set_uq
  ON bundle_suggestion_dismissals (user_id, doc_set_hash);

CREATE INDEX bundle_suggestion_dismissals_user_idx
  ON bundle_suggestion_dismissals (user_id);

CREATE INDEX bundle_suggestion_dismissals_org_idx
  ON bundle_suggestion_dismissals (organisation_id);

-- RLS
ALTER TABLE bundle_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY bundle_suggestion_dismissals_org_isolation
  ON bundle_suggestion_dismissals
  USING (organisation_id = current_setting('app.current_organisation_id', true)::uuid);
