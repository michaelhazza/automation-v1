-- 1. Add applied_template_slug column
ALTER TABLE subaccount_agents ADD COLUMN applied_template_slug text;

-- 2. Backfill from system_agents.slug via agents join
UPDATE subaccount_agents sa
SET    applied_template_slug = sysa.slug
FROM   agents a
JOIN   system_agents sysa ON sysa.id = a.system_agent_id
WHERE  sa.agent_id = a.id
  AND  a.system_agent_id IS NOT NULL
  AND  sa.applied_template_slug IS NULL;

-- 3. Partial unique index (singleton guard)
CREATE UNIQUE INDEX subaccount_agents_support_agent_singleton_idx
ON subaccount_agents (subaccount_id)
WHERE is_active = true
  AND applied_template_slug = 'support-agent';

-- 4. Seed support-agent system_agents row
INSERT INTO system_agents (
  name,
  slug,
  description,
  master_prompt,
  model_provider,
  model_id,
  default_system_skill_slugs,
  execution_scope
) VALUES (
  'Support Agent',
  'support-agent',
  'AI-powered support agent that classifies tickets, drafts replies, and routes to humans when needed.',
  '{{MASTER_PROMPT_PLACEHOLDER}}',
  'anthropic',
  'claude-sonnet-4-6',
  '["support.list_open_tickets","support.read_thread","support.classify_ticket","support.find_customer_history","support.propose_reply","support.add_internal_note","support.approve_draft","support.reject_draft","support.assign","support.set_status","support.tag","support.set_custom_field"]'::jsonb,
  'subaccount'
) ON CONFLICT (slug) DO NOTHING;
