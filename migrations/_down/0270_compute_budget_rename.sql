-- Down migration 0270: Reverse Compute Budget rename
-- Restores the original table/column names. For local rollback only.

-- ── 1. Reverse column rename on org_compute_budgets ─────────────────────────

ALTER TABLE org_compute_budgets
  RENAME COLUMN monthly_compute_limit_cents TO monthly_cost_limit_cents;

-- ── 2. Reverse index renames on compute_reservations ────────────────────────

ALTER INDEX IF EXISTS compute_reservations_idempotency_key_unique
  RENAME TO budget_reservations_idempotency_key_unique;

ALTER INDEX IF EXISTS compute_reservations_entity_status_idx
  RENAME TO budget_reservations_entity_status_idx;

ALTER INDEX IF EXISTS compute_reservations_expires_idx
  RENAME TO budget_reservations_expires_idx;

-- ── 3. Reverse table renames ─────────────────────────────────────────────────

ALTER TABLE org_compute_budgets RENAME TO org_budgets;
ALTER TABLE compute_reservations RENAME TO budget_reservations;
