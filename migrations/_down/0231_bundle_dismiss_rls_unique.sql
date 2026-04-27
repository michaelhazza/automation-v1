-- Reversal for migration 0231

DROP INDEX IF EXISTS bundle_suggestion_dismissals_org_user_doc_set_uq;

CREATE UNIQUE INDEX bundle_suggestion_dismissals_user_doc_set_uq
  ON bundle_suggestion_dismissals (user_id, doc_set_hash);
