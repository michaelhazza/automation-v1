-- 0343 down — restore the pre-spec-align home_widget JSON + skill allowlist
-- (seeded by 0332).

UPDATE system_agents
SET home_widget = jsonb_build_object(
      'type', 'summary_card',
      'titleTemplate', 'Personal Assistant',
      'bodyProviderSkill', 'ea.home_widget.summary',
      'refreshPolicy', 'every_5m'
    ),
    default_org_skill_slugs = '[
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
      "ea.daily_briefing",
      "ea.inbox_triage",
      "ea.meeting_prep",
      "ea.home_widget.summary"
    ]'::jsonb,
    updated_at = NOW()
WHERE slug = 'executive-assistant'
  AND deleted_at IS NULL;
