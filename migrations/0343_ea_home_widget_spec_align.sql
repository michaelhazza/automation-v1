-- 0343_ea_home_widget_spec_align.sql
-- Aligns the executive-assistant system-agent template with spec §13.1 +
-- §13.2 (Personal Assistant V1):
--   * REQ-EA4 — home_widget.refreshPolicy: every_5m -> on_login (reduce API load)
--   * REQ-EA5 — home_widget.titleTemplate: 'Personal Assistant' ->
--               '${agent.displayName}' (required for §13.6 rename feature)
--   * REQ-EA1 — default_org_skill_slugs: add the 7 spec-listed skills that
--               are not in universal-skills coverage (read_inbox, send_email,
--               read_data_source, fetch_url, scrape_structured,
--               update_memory_block, notify_operator).
--
-- Data-only update; no DDL. Idempotent — UPDATE filters on the canonical EA
-- slug. The other 7 spec-listed platform-meta skills (ask_clarifying_question,
-- request_clarification, read_workspace, web_search, search_agent_history,
-- read_priority_feed, plus the read_codebase developer skill that is also
-- universal) are provided by server/config/universalSkills.ts and are always
-- in scope regardless of the allowlist.

UPDATE system_agents
SET home_widget = jsonb_build_object(
      'type', 'summary_card',
      'titleTemplate', '${agent.displayName}',
      'bodyProviderSkill', 'ea.home_widget.summary',
      'refreshPolicy', 'on_login'
    ),
    default_org_skill_slugs = '[
      "read_inbox",
      "send_email",
      "calendar.list_events",
      "calendar.get_event",
      "calendar.find_free_slot",
      "calendar.create_event",
      "calendar.update_event",
      "calendar.respond_to_invite",
      "slack.list_channels",
      "slack.read_channel",
      "slack.search_messages",
      "slack.summarise_thread",
      "slack.post_message",
      "slack.post_dm",
      "read_data_source",
      "fetch_url",
      "scrape_structured",
      "update_memory_block",
      "notify_operator",
      "ea.daily_briefing",
      "ea.inbox_triage",
      "ea.meeting_prep",
      "ea.home_widget.summary"
    ]'::jsonb,
    updated_at = NOW()
WHERE slug = 'executive-assistant'
  AND deleted_at IS NULL;
