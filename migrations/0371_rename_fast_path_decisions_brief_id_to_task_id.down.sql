-- Migration B (down): revert task_id back to brief_id on fast_path_decisions

ALTER INDEX fast_path_task_idx RENAME TO fast_path_brief_idx;

ALTER TABLE fast_path_decisions
  RENAME CONSTRAINT fast_path_decisions_task_id_fkey TO fast_path_decisions_brief_id_fkey;

ALTER TABLE fast_path_decisions RENAME COLUMN task_id TO brief_id;
