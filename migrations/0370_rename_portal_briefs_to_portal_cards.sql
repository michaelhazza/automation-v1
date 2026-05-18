-- Migration A: rename portal_briefs to portal_cards
--
-- ALTER TABLE RENAME preserves attached RLS policies. Policy names will
-- cosmetically reference the old name "portal_briefs" — this is a known
-- cosmetic state; policy logic is unaffected. The rls-coverage gate uses
-- the physical table name (portal_cards) after this migration runs.
-- ---------------------------------------------------------------------------

ALTER TABLE portal_briefs RENAME TO portal_cards;

ALTER INDEX portal_briefs_run_id_idx RENAME TO portal_cards_run_id_idx;
ALTER INDEX portal_briefs_subaccount_slug_idx RENAME TO portal_cards_subaccount_slug_idx;
