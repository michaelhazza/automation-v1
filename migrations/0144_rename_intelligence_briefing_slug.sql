-- Migration 0144 — rename "daily-intelligence-brief" → "intelligence-briefing"
--
-- Updates historical rows that reference the old playbook slug so the
-- renamed playbook (S18) continues to resolve its history, schedules, and
-- portal visibility. Idempotent — safe to re-run.
--
-- Spec: docs/memory-and-briefings-spec.md §7.1 (S18)

-- scheduled_tasks rows
UPDATE scheduled_tasks
   SET created_by_playbook_slug = 'intelligence-briefing'
 WHERE created_by_playbook_slug = 'daily-intelligence-brief';

-- playbook_runs rows
UPDATE playbook_runs
   SET playbook_slug = 'intelligence-briefing'
 WHERE playbook_slug = 'daily-intelligence-brief';

-- memory_blocks.last_written_by_playbook_slug (optional back-link)
UPDATE memory_blocks
   SET last_written_by_playbook_slug = 'intelligence-briefing'
 WHERE last_written_by_playbook_slug = 'daily-intelligence-brief';

-- workspace_memory_entries.task_slug — matches the "<slug>-<subaccountId>"
-- pattern used by the playbook's knowledgeBindings writer.
UPDATE workspace_memory_entries
   SET task_slug = REPLACE(task_slug, 'daily-intelligence-brief-', 'intelligence-briefing-')
 WHERE task_slug LIKE 'daily-intelligence-brief-%';

-- modules.onboarding_playbook_slugs — array column; replace old slug in place.
UPDATE modules
   SET onboarding_playbook_slugs = (
     SELECT array_agg(
       CASE WHEN s = 'daily-intelligence-brief' THEN 'intelligence-briefing' ELSE s END
     )
     FROM unnest(onboarding_playbook_slugs) AS s
   )
 WHERE 'daily-intelligence-brief' = ANY(onboarding_playbook_slugs);
