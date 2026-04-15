-- Onboarding playbooks — scheduled task lifecycle + (added later in this
-- file during Phase F) the `modules.onboarding_playbook_slugs` column.
-- Single numbered file per spec §5.4.2 so the related additions travel
-- together.
--
-- Phase B2 — onboarding-playbooks spec §5.4.1, §5.4.2.
--
-- Adds the columns required to treat scheduled tasks as named, idempotent
-- resources that can be owned by a playbook:
--
--   task_slug                — logical identity inside a sub-account; combined
--                              with subaccount_id it is unique among active
--                              tasks, so re-running a playbook's
--                              `config_create_scheduled_task` returns the
--                              existing row instead of creating a duplicate.
--   created_by_playbook_slug — set when the task originates from a playbook
--                              `action_call` step; enables deterministic
--                              lifecycle management (listByPlaybookSlug,
--                              deactivateByPlaybookSlug).
--   first_run_at             — optional UTC timestamp of the very first run
--                              (populated by SchedulePicker → cron normalisation).
--   first_run_at_tz          — IANA timezone label the schedule was authored in;
--                              stored separately from the runtime timezone so
--                              replays and migrations can disambiguate DST.
--
-- Uniqueness is enforced as a partial index over active rows with non-null
-- slugs so that legacy rows (slug IS NULL) and deactivated rows never block
-- new creates.

ALTER TABLE scheduled_tasks
  ADD COLUMN task_slug                 TEXT,
  ADD COLUMN created_by_playbook_slug  TEXT DEFAULT NULL,
  ADD COLUMN first_run_at              TIMESTAMPTZ,
  ADD COLUMN first_run_at_tz           TEXT;

CREATE UNIQUE INDEX scheduled_tasks_subaccount_slug_active_uniq
  ON scheduled_tasks (subaccount_id, task_slug)
  WHERE task_slug IS NOT NULL AND is_active = true;

CREATE INDEX scheduled_tasks_playbook_slug_idx
  ON scheduled_tasks (created_by_playbook_slug)
  WHERE created_by_playbook_slug IS NOT NULL;
