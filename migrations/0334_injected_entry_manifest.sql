-- Migration 0334: agent_runs.injected_entry_ids column.
-- Materialised view + index land in 0343 (after main's 0335-0342) to keep
-- migration files single-purpose and re-runnable independently.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS injected_entry_ids jsonb;

-- NULL = pre-migration / unwired (not measured)
-- []   = measured: run had empty injection set
-- [...] = measured: run had N entries injected
-- No DEFAULT — the NULL discriminator is load-bearing per spec §3.5 / §3.6.
