-- Sprint 4 P3.1 — Playbook multi-execution-mode toggle
-- Adds run_mode column (auto/supervised/background/bulk), nullable parent_run_id
-- and target_subaccount_id for bulk fan-out, widens status CHECK to include 'partial'.

-- 1. Add run_mode column with CHECK constraint
ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'auto'
    CHECK (run_mode IN ('auto', 'supervised', 'background', 'bulk'));

-- 2. Add bulk parent/child relationship columns
ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES playbook_runs(id);

ALTER TABLE playbook_runs
  ADD COLUMN IF NOT EXISTS target_subaccount_id uuid REFERENCES subaccounts(id);

-- 3. Widen the status CHECK constraint to include 'partial'
-- Drop the existing constraint if present, then re-add
DO $$
BEGIN
  -- Check if the constraint exists before dropping
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'playbook_runs_status_check'
      AND conrelid = 'playbook_runs'::regclass
  ) THEN
    ALTER TABLE playbook_runs DROP CONSTRAINT playbook_runs_status_check;
  END IF;
END $$;

ALTER TABLE playbook_runs
  ADD CONSTRAINT playbook_runs_status_check
    CHECK (status IN (
      'pending', 'running', 'awaiting_input', 'awaiting_approval',
      'completed', 'completed_with_errors', 'failed',
      'cancelling', 'cancelled', 'partial'
    ));

-- 4. Index for bulk parent → children lookups
CREATE INDEX IF NOT EXISTS playbook_runs_parent_run_id_idx
  ON playbook_runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;

-- 5. Idempotency index for bulk child creation: (parent_run_id, target_subaccount_id) unique
CREATE UNIQUE INDEX IF NOT EXISTS playbook_runs_bulk_child_unique_idx
  ON playbook_runs (parent_run_id, target_subaccount_id)
  WHERE parent_run_id IS NOT NULL AND target_subaccount_id IS NOT NULL;
