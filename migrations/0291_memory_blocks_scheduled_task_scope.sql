-- Auto Knowledge Retrieval Phase 1D: add scheduled_task_id scope column to memory_blocks
-- This enables recurring-task scoped memory blocks (spec §4.2 four-tier model).

ALTER TABLE memory_blocks
  ADD COLUMN scheduled_task_id uuid REFERENCES scheduled_tasks(id) ON DELETE SET NULL;

CREATE INDEX memory_blocks_scheduled_task_idx
  ON memory_blocks (scheduled_task_id)
  WHERE scheduled_task_id IS NOT NULL;
