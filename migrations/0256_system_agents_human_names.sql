-- Migration 0256: Rename subaccount-facing system agents to human-style names
-- and assign explicit agent_role values.
--
-- Internal/org-level agents (orchestrator, heads) are NOT renamed.
-- The 6 agents below are the subaccount-facing "employee" templates.
-- Final list approved in Phase A planning — deviations from the spec's
-- tentative example slugs recorded in tasks/builds/agent-as-employee/progress.md.
--
-- Using ON CONFLICT DO NOTHING shape via UPDATE + WHERE slug to remain idempotent.

UPDATE system_agents
   SET name = 'Sarah',
       agent_role = 'Specialist',
       updated_at = NOW()
 WHERE slug = 'business-analyst';

UPDATE system_agents
   SET name = 'Johnny',
       agent_role = 'Worker',
       updated_at = NOW()
 WHERE slug = 'crm-pipeline-agent';

UPDATE system_agents
   SET name = 'Helena',
       agent_role = 'Specialist',
       updated_at = NOW()
 WHERE slug = 'client-reporting-agent';

UPDATE system_agents
   SET name = 'Patel',
       agent_role = 'Specialist',
       updated_at = NOW()
 WHERE slug = 'finance-agent';

UPDATE system_agents
   SET name = 'Riley',
       agent_role = 'Worker',
       updated_at = NOW()
 WHERE slug = 'email-outreach-agent';

UPDATE system_agents
   SET name = 'Dana',
       agent_role = 'Worker',
       updated_at = NOW()
 WHERE slug = 'sdr-agent';
