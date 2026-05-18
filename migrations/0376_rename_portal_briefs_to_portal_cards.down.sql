-- Migration A (down): revert portal_cards back to portal_briefs

ALTER INDEX IF EXISTS portal_cards_subaccount_workflow_slug_idx RENAME TO portal_briefs_subaccount_workflow_slug_idx;
ALTER INDEX IF EXISTS portal_cards_run_id_idx RENAME TO portal_briefs_run_id_idx;

ALTER TABLE IF EXISTS portal_cards RENAME TO portal_briefs;
