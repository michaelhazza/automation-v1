-- Add soft-delete column to task_deliverables.
-- The column was added to the Drizzle schema (taskDeliverables.ts) but never
-- received a corresponding SQL migration, causing getTask() to 500 on any
-- SELECT that included it.

ALTER TABLE task_deliverables
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
