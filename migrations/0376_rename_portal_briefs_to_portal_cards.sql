-- Migration A: rename portal_briefs to portal_cards
-- ---------------------------------------------------------------------------

ALTER TABLE portal_briefs RENAME TO portal_cards;

ALTER INDEX portal_briefs_run_id_idx RENAME TO portal_cards_run_id_idx;
ALTER INDEX portal_briefs_subaccount_workflow_slug_idx RENAME TO portal_cards_subaccount_workflow_slug_idx;

-- ── Recreate RLS policy on portal_cards under the new table name ─────────────
--
-- Postgres carries policies through ALTER TABLE RENAME, so the runtime RLS
-- on portal_cards is already active (inherited from the portal_briefs policy
-- created in migration 0245). However, the canonical RLS-coverage gate
-- (scripts/verify-rls-coverage.sh) does static analysis on migration text and
-- only sees `CREATE POLICY ... ON portal_cards` if we emit it explicitly.
-- DROP + CREATE under the new name keeps the gate satisfied without changing
-- runtime semantics. Also re-asserts ENABLE / FORCE RLS on the renamed table
-- for the same reason.

ALTER TABLE portal_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_cards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_cards_org_isolation ON portal_cards;
DROP POLICY IF EXISTS portal_briefs_org_isolation ON portal_cards;

CREATE POLICY portal_cards_org_isolation ON portal_cards
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
