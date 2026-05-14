-- 0301_system_agents_scorecard_defaults.down.sql
ALTER TABLE organisations DROP COLUMN IF EXISTS org_mandatory_scorecard_slugs;
ALTER TABLE agent_templates DROP COLUMN IF EXISTS default_scorecard_slugs;
ALTER TABLE system_agents
  DROP COLUMN IF EXISTS default_system_scorecard_slugs,
  DROP COLUMN IF EXISTS default_org_scorecard_slugs;
