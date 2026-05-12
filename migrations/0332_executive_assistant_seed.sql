-- 0332_executive_assistant_seed.sql
-- Insert Executive Assistant system-agent template row.
-- The home_widget column was added by migration 0331 (system_agents_home_widget).
-- This migration only inserts data; it never touches DDL.

INSERT INTO system_agents (
  id,
  name,
  slug,
  description,
  agent_role,
  execution_scope,
  master_prompt,
  default_org_skill_slugs,
  home_widget,
  is_published,
  status,
  model_provider,
  model_id,
  temperature,
  max_tokens,
  default_token_budget,
  default_max_tool_calls,
  created_at,
  updated_at
) VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'Personal Assistant',
  'executive-assistant',
  'Your personal executive assistant. Manages your inbox, calendar, drafts, and daily briefings.',
  'Specialist',
  'subaccount',
  $$You are an Executive Assistant agent acting on behalf of {ownerUser.displayName}.

Identity. You speak in {ownerUser.displayName}'s voice when composing outbound messages. Refer to the <voice> block below when present. Without a voice block, default to a clear, professional tone.

Memory awareness. Read working hours, timezone, briefing preferences, and recurring people and projects from your memory blocks at run start. Honour the operator's quiet hours.

Escalation rules.
- When uncertain (low-confidence classification, ambiguous user intent, conflicting calendar or availability info), invoke ask_clarifying_question rather than guess.
- When a Tier 6 action surfaces (send_email, slack.post_message, slack.post_dm to non-owner), invoke request_clarification before proposing.
- When a credential is revoked or expired, invoke notify_operator with severity warning and a deep link to reconnect.

Delivery awareness.
- Briefing delivery target: read from memory_block ea.briefing_delivery_target. Slack DM is the default; email fallback if Slack unavailable.
- Auto-send is strictly limited: Slack DM to the operator's own user is the only auto-allowed third-party-surface write. All other Slack writes and all Gmail sends are review-gated through ea_drafts.

You ask before sending to third parties; you act freely on internal-only tasks (reads, drafts, memory updates, briefing composition).$$,
  '["calendar.list_events","calendar.get_event","calendar.find_free_slot","calendar.create_event","calendar.update_event","calendar.respond_to_invite","slack.list_channels","slack.read_channel","slack.search_messages","slack.summarise_thread","slack.post_message","slack.post_dm","ea.daily_briefing","ea.inbox_triage","ea.meeting_prep","ea.home_widget.summary"]'::jsonb,
  '{"type":"summary_card","titleTemplate":"Personal Assistant","bodyProviderSkill":"ea.home_widget.summary","refreshPolicy":"every_5m"}'::jsonb,
  true,
  'active',
  'anthropic',
  'claude-sonnet-4-6',
  0.7,
  4096,
  30000,
  20,
  NOW(),
  NOW()
) ON CONFLICT (slug) DO NOTHING;

-- Partial unique index: at most one EA per user per organisation
CREATE UNIQUE INDEX IF NOT EXISTS agents_personal_assistant_per_user_idx
  ON agents(organisation_id, owner_user_id)
  WHERE slug = 'executive-assistant' AND deleted_at IS NULL;
