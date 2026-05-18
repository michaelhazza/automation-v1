-- Migration B: rename fast_path_decisions.brief_id to task_id
--
-- The FK target (tasks.id) is unchanged. Only the column name and the
-- auto-generated FK constraint name are updated.
-- ---------------------------------------------------------------------------

ALTER TABLE fast_path_decisions RENAME COLUMN brief_id TO task_id;

ALTER TABLE fast_path_decisions
  RENAME CONSTRAINT fast_path_decisions_brief_id_fkey TO fast_path_decisions_task_id_fkey;

ALTER INDEX fast_path_brief_idx RENAME TO fast_path_task_idx;
