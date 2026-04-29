-- Down migration for 0256_system_agents_human_names.sql
-- Restores original technical names. agent_role is set to NULL (was not set before).

UPDATE system_agents SET name = 'Business Analyst',   agent_role = NULL, updated_at = NOW() WHERE slug = 'business-analyst';
UPDATE system_agents SET name = 'CRM/Pipeline Agent',  agent_role = NULL, updated_at = NOW() WHERE slug = 'crm-pipeline-agent';
UPDATE system_agents SET name = 'Client Reporting Agent', agent_role = NULL, updated_at = NOW() WHERE slug = 'client-reporting-agent';
UPDATE system_agents SET name = 'Finance Agent',       agent_role = NULL, updated_at = NOW() WHERE slug = 'finance-agent';
UPDATE system_agents SET name = 'Email Outreach Agent', agent_role = NULL, updated_at = NOW() WHERE slug = 'email-outreach-agent';
UPDATE system_agents SET name = 'SDR Agent',           agent_role = NULL, updated_at = NOW() WHERE slug = 'sdr-agent';
