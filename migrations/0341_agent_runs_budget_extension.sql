-- Migration 0341: Add per_task_budget_extension_minutes to agent_runs
--
-- Adds the per-task budget extension accumulator column. Written by the
-- operator-task extend-budget route (POST /api/operator-tasks/:id/extend-budget).
-- The dispatcher reads this column and adds it to the effective
-- per_task_budget_cap_minutes before writing the settings_snapshot for a new
-- chain link — keeping budget extensions task-scoped rather than bleeding into
-- the subaccount-wide subaccount_operator_settings row.
--
-- DEFAULT 0: all existing rows (non-operator and pre-fix operator tasks) start
-- with no extension. The column is never reset; it accumulates across multiple
-- extend-budget calls on the same task.
--
-- Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.17.4

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS per_task_budget_extension_minutes integer NOT NULL DEFAULT 0;
