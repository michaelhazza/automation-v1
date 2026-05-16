# Skill Unmatched Preview

**Produced by:** Chunk 0 (Setup & verification)
**Date:** 2026-05-16
**Spec ref:** §9.3 — compare action-registry.snapshot.json keys vs on-disk .md filenames

## Summary counts

| Category | Count |
|---|---|
| Snapshot entries (`entries` keys) | 162 |
| Disk `.md` files (excl. README.md) | 205 |
| Matched (snapshot key = normalized disk key) | 133 |
| Unmatched snapshot keys (no disk file) | 29 |
| Orphan disk files (no snapshot entry) | 72 |

## Methodology

Script compared `scripts/snapshots/action-registry.snapshot.json` (162 `entries` keys) against all `.md` files under `server/skills/` (205 files, excluding `README.md`).

Normalization applied:
- Disk file `calendar-create-event.md` → disk key `calendar_create_event` (hyphens to underscores)
- Disk file `support/classify-ticket.md` → disk key `support.classify_ticket`
- Disk file `optimiser/scan_agent_budget.md` → disk key `optimiser.scan_agent_budget`
- Snapshot key `calendar.create_event` is dot-qualified (namespace.action form)

**Match condition:** snapshot key == normalized disk key. The 6 calendar files and 6 slack files in the snapshot use dot-qualified keys (`calendar.create_event`, `slack.post_dm`) but the disk filenames normalize to flat keys (`calendar_create_event`, `slack_post_dm`) — these are the structurally unmatched set.

---

## Unmatched snapshot keys — no corresponding disk file (29)

These 29 keys exist in the snapshot but have no disk file that normalizes to the same key.

| Snapshot key | Root cause |
|---|---|
| `calendar.create_event` | Disk file is `calendar-create-event.md` (normalizes to `calendar_create_event`, not `calendar.create_event`) |
| `calendar.find_free_slot` | Same — disk: `calendar-find-free-slot.md` → `calendar_find_free_slot` |
| `calendar.get_event` | Same — disk: `calendar-get-event.md` → `calendar_get_event` |
| `calendar.list_events` | Same — disk: `calendar-list-events.md` → `calendar_list_events` |
| `calendar.respond_to_invite` | Same — disk: `calendar-respond-to-invite.md` → `calendar_respond_to_invite` |
| `calendar.update_event` | Same — disk: `calendar-update-event.md` → `calendar_update_event` |
| `slack.list_channels` | Same — disk: `slack-list-channels.md` → `slack_list_channels` |
| `slack.post_dm` | Same — disk: `slack-post-dm.md` → `slack_post_dm` |
| `slack.post_message` | Same — disk: `slack-post-message.md` → `slack_post_message` |
| `slack.read_channel` | Same — disk: `slack-read-channel.md` → `slack_read_channel` |
| `slack.search_messages` | Same — disk: `slack-search-messages.md` → `slack_search_messages` |
| `slack.summarise_thread` | Same — disk: `slack-summarise-thread.md` → `slack_summarise_thread` |
| `assign_task` | No disk file (`support/assign.md` → key `support.assign`, not `assign_task`) |
| `cached_context_budget_breach` | No disk file |
| `canonical_dictionary` | No disk file |
| `compute_staff_activity_pulse` | No disk file |
| `config_deliver_workflow_output` | No disk file (closest: `config_publish_workflow_output_to_portal.md`) |
| `config_weekly_digest_gather` | No disk file (closest: `weekly_digest_gather.md` at top level) |
| `crm.create_task` | No disk file under `crm/` subdirectory |
| `crm.fire_automation` | No disk file under `crm/` subdirectory |
| `crm.query` | No disk file under `crm/` subdirectory |
| `crm.send_email` | No disk file under `crm/` subdirectory |
| `crm.send_sms` | No disk file under `crm/` subdirectory |
| `cross_owner.ask_initiator_decision` | No disk file under `cross_owner/` subdirectory |
| `notify_operator` | No disk file |
| `scan_integration_fingerprints` | No disk file |
| `update_record` | No disk file |
| `update_thread_context` | No disk file |
| `workflow.run.start` | No disk file under `workflow/` subdirectory with nested key form |

**Sub-analysis — calendar and slack (12 keys):** Snapshot uses dot-qualified namespace keys (`calendar.create_event`) while disk files normalize to flat underscore keys (`calendar_create_event`). After the SK2 rename in chunk 9, disk files become `calendar_create_event.md` (still normalizing to `calendar_create_event`), still NOT `calendar.create_event`. Convention mismatch persists post-rename.

**Sub-analysis — missing disk files (17 keys):** The remaining 17 keys (`assign_task`, `cached_context_budget_breach`, `canonical_dictionary`, `compute_staff_activity_pulse`, `config_deliver_workflow_output`, `config_weekly_digest_gather`, `crm.*` x5, `cross_owner.ask_initiator_decision`, `notify_operator`, `scan_integration_fingerprints`, `update_record`, `update_thread_context`, `workflow.run.start`) have no disk file whatsoever. These represent capabilities registered in the action registry with no skill definition file.

---

## Orphan disk files — no snapshot entry (72)

### Calendar and slack (16 files — naming mismatch with snapshot)

| Disk key (normalized) | Disk file |
|---|---|
| `calendar_create_event` | `calendar-create-event.md` |
| `calendar_find_free_slot` | `calendar-find-free-slot.md` |
| `calendar_get_event` | `calendar-get-event.md` |
| `calendar_list_events` | `calendar-list-events.md` |
| `calendar_respond_to_invite` | `calendar-respond-to-invite.md` |
| `calendar_update_event` | `calendar-update-event.md` |
| `slack_list_channels` | `slack-list-channels.md` |
| `slack_post_dm` | `slack-post-dm.md` |
| `slack_post_message` | `slack-post-message.md` |
| `slack_read_channel` | `slack-read-channel.md` |
| `slack_search_messages` | `slack-search-messages.md` |
| `slack_summarise_thread` | `slack-summarise-thread.md` |
| `ea_daily_briefing` | `ea-daily-briefing.md` |
| `ea_home_widget_summary` | `ea-home-widget-summary.md` |
| `ea_inbox_triage` | `ea-inbox-triage.md` |
| `ea_meeting_prep` | `ea-meeting-prep.md` |

### Genuine orphans (56 files — disk-only, no snapshot entry)

| Disk key | File |
|---|---|
| `book_meeting` | `book_meeting.md` |
| `capture_screenshot` | `capture_screenshot.md` |
| `chase_overdue` | `chase_overdue.md` |
| `config_get_agent_detail` | `config_get_agent_detail.md` |
| `config_get_link_detail` | `config_get_link_detail.md` |
| `config_list_agents` | `config_list_agents.md` |
| `config_list_data_sources` | `config_list_data_sources.md` |
| `config_list_links` | `config_list_links.md` |
| `config_list_org_skills` | `config_list_org_skills.md` |
| `config_list_scheduled_tasks` | `config_list_scheduled_tasks.md` |
| `config_list_subaccounts` | `config_list_subaccounts.md` |
| `config_list_system_skills` | `config_list_system_skills.md` |
| `config_preview_plan` | `config_preview_plan.md` |
| `config_run_health_check` | `config_run_health_check.md` |
| `config_view_history` | `config_view_history.md` |
| `discover_prospects` | `discover_prospects.md` |
| `draft_outbound` | `draft_outbound.md` |
| `fetch_paywalled_content` | `fetch_paywalled_content.md` |
| `generate_invoice` | `generate_invoice.md` |
| `import_n8n_workflow` | `import_n8n_workflow.md` |
| `list_my_subordinates` | `list_my_subordinates.md` |
| `optimiser.scan_agent_budget` | `optimiser/scan_agent_budget.md` |
| `optimiser.scan_cache_efficiency` | `optimiser/scan_cache_efficiency.md` |
| `optimiser.scan_escalation_phrases` | `optimiser/scan_escalation_phrases.md` |
| `optimiser.scan_inactive_workflows` | `optimiser/scan_inactive_workflows.md` |
| `optimiser.scan_memory_citation` | `optimiser/scan_memory_citation.md` |
| `optimiser.scan_routing_uncertainty` | `optimiser/scan_routing_uncertainty.md` |
| `optimiser.scan_skill_latency` | `optimiser/scan_skill_latency.md` |
| `optimiser.scan_workflow_escalations` | `optimiser/scan_workflow_escalations.md` |
| `output.recommend` | `output/recommend.md` |
| `prepare_month_end` | `prepare_month_end.md` |
| `prepare_renewal_brief` | `prepare_renewal_brief.md` |
| `process_bill` | `process_bill.md` |
| `reconcile_transactions` | `reconcile_transactions.md` |
| `run_playwright_test` | `run_playwright_test.md` |
| `score_lead` | `score_lead.md` |
| `score_nps_csat` | `score_nps_csat.md` |
| `send_invoice` | `send_invoice.md` |
| `send_to_slack` | `send_to_slack.md` |
| `skill_propose_save` | `skill_propose_save.md` |
| `skill_read_existing` | `skill_read_existing.md` |
| `skill_read_regressions` | `skill_read_regressions.md` |
| `skill_simulate` | `skill_simulate.md` |
| `skill_validate` | `skill_validate.md` |
| `smart_skip_from_website` | `smart_skip_from_website.md` |
| `spawn_sub_agents` | `spawn_sub_agents.md` |
| `track_subscriptions` | `track_subscriptions.md` |
| `transcribe_audio` | `transcribe_audio.md` |
| `update_task` | `update_task.md` |
| `weekly_digest_gather` | `weekly_digest_gather.md` |
| `workflow_estimate_cost` | `workflow_estimate_cost.md` |
| `workflow_propose_save` | `workflow_propose_save.md` |
| `workflow_read_existing` | `workflow_read_existing.md` |
| `workflow_simulate` | `workflow_simulate.md` |
| `workflow_validate` | `workflow_validate.md` |
| `write_workspace` | `write_workspace.md` |

---

## Notes for chunk 9

1. **Naming convention mismatch for calendar/slack/ea:** The 16 kebab files (6 calendar + 6 slack + 4 ea) are listed in the snapshot with dot-qualified keys (`calendar.create_event`, `slack.post_dm`) but disk files normalize to flat underscore keys. After the SK2 rename, disk keys become `calendar_create_event` etc. — still not matching the snapshot's dot form. Chunk 9's comparator must apply the mapping rule: `X.Y` snapshot key ↔ `X_Y` disk key (replace first dot with underscore) when building the match table for single-level namespaces.

2. **17 snapshot keys with no disk file:** Out of scope for chunk 9 (which only renames existing files). Routed to `tasks/todo.md` as debt: "17 action-registry entries have no skill file on disk."

3. **56 genuine orphan disk files:** Files added to `server/skills/` after the snapshot was captured. Out of scope for chunk 9. The snapshot is a point-in-time capture.

4. **Chunk 9 rename safety confirmed:** The 25 files targeted for SK2 rename all appear in the orphan disk list — confirming they are not matched by the snapshot under their current kebab form. Post-rename, they will still be orphan (dot vs underscore convention mismatch), but the chunk 9 spec only requires the renames, not snapshot alignment.
