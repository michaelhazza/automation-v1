-- Migration 0231: BUNDLE-DISMISS-RLS — extend unique key on bundle_suggestion_dismissals
--
-- The existing 2-column (user_id, doc_set_hash) unique index allows a multi-org
-- user's dismissal in org A to silently conflict with an attempt to dismiss the
-- same doc-set hash in org B. The 3-column index (organisation_id, user_id,
-- doc_set_hash) scopes dismissals to the organisation, matching RLS semantics.

DROP INDEX IF EXISTS bundle_suggestion_dismissals_user_doc_set_uq;

CREATE UNIQUE INDEX bundle_suggestion_dismissals_org_user_doc_set_uq
  ON bundle_suggestion_dismissals (organisation_id, user_id, doc_set_hash);
