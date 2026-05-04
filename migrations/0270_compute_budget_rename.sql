-- Migration 0270: Compute Budget rename
-- Renames the LLM cost ceiling tables and columns from the bare "Budget"
-- vocabulary to "Compute Budget" so the two budget concepts (Compute Budget
-- vs. Spending Budget) are unambiguous in code, UI, and documentation.
-- Spec: tasks/builds/agentic-commerce/spec.md §2
-- Plan: tasks/builds/agentic-commerce/plan.md §3.4 / Chunk 1
-- Branch: claude/agentic-commerce-spending

-- ── 1. Rename tables ─────────────────────────────────────────────────────────

ALTER TABLE budget_reservations RENAME TO compute_reservations;
ALTER TABLE org_budgets RENAME TO org_compute_budgets;

-- ── 2. Rename indexes on compute_reservations ────────────────────────────────

ALTER INDEX IF EXISTS budget_reservations_idempotency_key_unique
  RENAME TO compute_reservations_idempotency_key_unique;

ALTER INDEX IF EXISTS budget_reservations_entity_status_idx
  RENAME TO compute_reservations_entity_status_idx;

ALTER INDEX IF EXISTS budget_reservations_expires_idx
  RENAME TO compute_reservations_expires_idx;

-- ── 3. Rename column on org_compute_budgets ──────────────────────────────────

ALTER TABLE org_compute_budgets
  RENAME COLUMN monthly_cost_limit_cents TO monthly_compute_limit_cents;

-- ── 4. Recreate RLS policy under the new table name ─────────────────────────
--
-- Postgres carries policies through ALTER TABLE RENAME, so the runtime RLS
-- on org_compute_budgets is already active (inherited from the org_budgets
-- policy created in migration 0245). However, the canonical RLS-coverage
-- gate (scripts/verify-rls-coverage.sh) does static analysis on migration
-- text and only sees `CREATE POLICY ... ON org_compute_budgets` if we emit
-- it explicitly. DROP + CREATE under the new name keeps the gate satisfied
-- without changing runtime semantics. Also re-asserts ENABLE / FORCE RLS on
-- the renamed table for the same reason.

ALTER TABLE org_compute_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_compute_budgets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_compute_budgets_org_isolation ON org_compute_budgets;
DROP POLICY IF EXISTS org_budgets_org_isolation ON org_compute_budgets;

CREATE POLICY org_compute_budgets_org_isolation ON org_compute_budgets
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

-- Same treatment for compute_reservations (renamed from budget_reservations).
ALTER TABLE compute_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compute_reservations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compute_reservations_org_isolation ON compute_reservations;
DROP POLICY IF EXISTS budget_reservations_org_isolation ON compute_reservations;

CREATE POLICY compute_reservations_org_isolation ON compute_reservations
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
