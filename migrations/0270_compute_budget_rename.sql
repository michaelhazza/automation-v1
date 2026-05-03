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
