-- 0077_hierarchy_templates_system_template_id.sql
--
-- Adds `hierarchy_templates.system_template_id` — a nullable back-reference
-- to the source system hierarchy template used when `source_type = 'from_system'`.
--
-- The column was already referenced by `orgConfigService.getOperationalConfig`
-- (for finding an org's currently-applied system template) and by
-- `systemTemplateService.loadTemplate` (the upsert path that refreshes
-- operational config when an org re-loads a system template) but had never
-- been added to the Drizzle schema or migrations, so the code was broken at
-- runtime and the server tsc build was red. This migration closes that gap.
--
-- No backfill required — existing rows predate the `from_system` source
-- flow and legitimately have no system template to reference.

ALTER TABLE hierarchy_templates
  ADD COLUMN IF NOT EXISTS system_template_id UUID REFERENCES system_hierarchy_templates(id);

CREATE INDEX IF NOT EXISTS hierarchy_templates_system_template_idx
  ON hierarchy_templates (system_template_id)
  WHERE system_template_id IS NOT NULL;
