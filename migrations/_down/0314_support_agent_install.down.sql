DROP INDEX IF EXISTS subaccount_agents_support_agent_singleton_idx;
ALTER TABLE subaccount_agents DROP COLUMN IF EXISTS applied_template_slug;
DELETE FROM system_agents WHERE slug = 'support-agent';
