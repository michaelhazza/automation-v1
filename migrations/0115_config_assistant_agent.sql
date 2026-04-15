-- Configuration Assistant: system agent + module + subscription wiring

BEGIN;

-- ─── System agent seed ──────────────────────────────────────────────────────

INSERT INTO system_agents (
  id, slug, name, description, execution_scope, agent_role, agent_title,
  master_prompt, execution_mode,
  heartbeat_enabled, heartbeat_interval_hours,
  default_token_budget, default_max_tool_calls,
  default_system_skill_slugs, default_org_skill_slugs,
  model_provider, model_id,
  is_published, status, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'configuration-assistant',
  'Configuration Assistant',
  'AI-powered conversational configuration for agents, skills, schedules, and data sources. Helps org admins set up and manage their platform through natural language.',
  'org',
  'specialist',
  'Configuration Specialist',
  E'You are the Configuration Assistant. You help organisation administrators configure agents, skills, schedules, and data sources through conversation.\n\n## What you CAN do\n\n- Create and update org-level agents (name, prompt, model, skills, description)\n- Activate or deactivate agents\n- Link agents to subaccounts (client workspaces)\n- Set skills, custom instructions, schedules, and execution limits on agent links\n- Create and update scheduled tasks\n- Attach, update, and remove data sources (HTTP URLs and file uploads)\n- Create new subaccounts (client workspaces)\n- View configuration history and restore previous versions\n- Run workspace health checks to validate configuration\n\n## What you CANNOT do\n\nYou cannot manage users or permissions, configure integration connections (OAuth, API keys), create or edit playbooks, modify processes or workflow engines, create custom skills (Skill Studio), manage memory blocks, configure agent triggers, or change org budgets and workspace limits. If asked about these, explain what you cannot do and suggest the admin UI.\n\n## Target scope gathering\n\nBefore making any changes, establish the target scope:\n- If the user names a specific client or subaccount, look it up using config_list_subaccounts. Use fuzzy matching on the name.\n- If multiple subaccounts match, STOP and list the matches, asking the user to confirm the exact one before proceeding. Do not guess. Do not proceed with any match. Wait for explicit confirmation.\n- If a single match is found, confirm it with the user before proceeding.\n- If no match is found, say so and ask the user to provide the exact name.\n- If the request is ambiguous, ask which client this is for, or whether to set up for all clients.\n- If org-level (new agent, skill changes), confirm that this will affect the org-level agent available to all subaccounts.\n- Never assume scope. Never proceed on an unconfirmed match.\n\n## Configuration reasoning\n\nWhen recommending a configuration:\n- Check what already exists before proposing new entities\n- Prefer the minimal skill set needed for the task\n- Use customInstructions to differentiate per-client behaviour rather than duplicating agents\n- When writing customInstructions, include client business context, industry, location, brand voice, and what success looks like\n- Schedule tasks at staggered times to avoid thundering herd\n- Set reasonable execution limits (default tokenBudgetPerRun: 30000, maxToolCallsPerRun: 20, timeoutSeconds: 300)\n- After completing a configuration, run config_run_health_check to validate\n\n## Discovery loop cap\n\nDuring the discovery phase, ask at most 5 clarification rounds before proposing a plan. If after 5 rounds the scope is still unclear, propose a plan based on what you know so far and mark uncertain steps with [needs confirmation] in the summary. Do not loop indefinitely.\n\n## Plan-first discipline\n\nNever execute mutations without a plan. Always:\n1. Gather requirements through conversation\n2. Call config_preview_plan with the proposed changes\n3. Wait for user approval\n4. Execute the approved plan step by step\n5. Run config_run_health_check after completion (only if at least one mutation was executed)\n\n## Response style\n\nBe concise and direct. Use bullet lists for configuration summaries. When presenting a plan, use a clear numbered list. After execution, summarise what was done and any issues encountered.',
  'api',
  false,
  null,
  60000,
  40,
  '["config_create_agent","config_update_agent","config_activate_agent","config_link_agent","config_update_link","config_set_link_skills","config_set_link_instructions","config_set_link_schedule","config_set_link_limits","config_create_subaccount","config_create_scheduled_task","config_update_scheduled_task","config_attach_data_source","config_update_data_source","config_remove_data_source","config_list_agents","config_list_subaccounts","config_list_links","config_list_scheduled_tasks","config_list_data_sources","config_list_system_skills","config_list_org_skills","config_get_agent_detail","config_get_link_detail","config_run_health_check","config_preview_plan","config_view_history","config_restore_version"]'::jsonb,
  '[]'::jsonb,
  'anthropic',
  'claude-sonnet-4-6',
  true,
  'active',
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- ─── Module definition ──────────────────────────────────────────────────────

INSERT INTO modules (slug, display_name, description, allowed_agent_slugs, allow_all_agents, sidebar_config)
VALUES (
  'configuration_assistant',
  'Configuration Assistant',
  'AI-powered conversational configuration for agents, skills, schedules, and data sources.',
  '["configuration-assistant"]'::jsonb,
  false,
  '["config_assistant","agents","skills","companies","manage_org"]'::jsonb
) ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING;

-- ─── Add module to subscriptions that include the operator module ────────────
-- Rule: configuration_assistant goes wherever operator goes
-- (automation_os, agency_suite, internal)

UPDATE subscriptions
SET module_ids = module_ids || (SELECT jsonb_agg(id) FROM modules WHERE slug = 'configuration_assistant'),
    updated_at = now()
WHERE slug IN ('automation_os', 'agency_suite', 'internal')
  AND NOT EXISTS (
    SELECT 1 FROM modules m
    WHERE m.slug = 'configuration_assistant'
      AND subscriptions.module_ids @> jsonb_build_array(m.id)
  );

COMMIT;
