-- Migration A (down): revert portal_cards back to portal_briefs

ALTER INDEX portal_cards_subaccount_slug_idx RENAME TO portal_briefs_subaccount_slug_idx;
ALTER INDEX portal_cards_run_id_idx RENAME TO portal_briefs_run_id_idx;

ALTER TABLE portal_cards RENAME TO portal_briefs;
