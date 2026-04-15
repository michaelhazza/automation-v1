-- Phase D2 — onboarding-playbooks spec §8.4 / §7.5.
--
-- Adds the provenance + safety columns required for `knowledgeBindings[]`
-- to upsert Memory Blocks on playbook run completion:
--
--   confidence                       — 'low' | 'normal'. 'low' flags blocks
--                                      first written by a `firstRunOnly`
--                                      binding so the Knowledge page can
--                                      surface a "review recommended"
--                                      indicator. Reset to 'normal' on any
--                                      human save.
--   source_run_id                    — backlink to the playbookRun that last
--                                      wrote the block. Drives the per-run
--                                      rate-limit (§7.5, 10 blocks per run)
--                                      and trace-to-run navigation.
--   last_edited_by_agent_id          — null when the most recent write came
--                                      from a human editor (Knowledge page).
--                                      Non-null when an agent/playbook wrote
--                                      it. Drives the HITL overwrite rule.
--   last_written_by_playbook_slug    — slug of the playbook that last wrote
--                                      the block. Used so a playbook can
--                                      safely rewrite blocks IT previously
--                                      wrote, without tripping the HITL
--                                      overwrite rule.
--
-- All columns default safely (confidence defaults to 'normal'; the others
-- default NULL meaning "last edited by a human"). Existing rows require no
-- backfill.

ALTER TABLE memory_blocks
  ADD COLUMN confidence                    TEXT        NOT NULL DEFAULT 'normal',
  ADD COLUMN source_run_id                 UUID,
  ADD COLUMN last_edited_by_agent_id       UUID REFERENCES agents(id),
  ADD COLUMN last_written_by_playbook_slug TEXT;

-- Indexes used by the per-run rate-limit query and the lifecycle lookup.
CREATE INDEX memory_blocks_source_run_idx
  ON memory_blocks (source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX memory_blocks_last_playbook_slug_idx
  ON memory_blocks (last_written_by_playbook_slug)
  WHERE last_written_by_playbook_slug IS NOT NULL;
