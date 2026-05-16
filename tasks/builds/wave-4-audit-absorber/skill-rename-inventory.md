# Skill Rename Inventory

**Produced by:** Chunk 0 (Setup & verification)
**Date:** 2026-05-16
**Spec ref:** §9.2 SK2 — rename 25 kebab-named files to snake_case

## Operator decision (from progress.md)

SK2 rename-vs-allowlist: **rename all 25** (no allowlist entries; default applied)

## Grep sweep result

Searched `server/services/**`, `server/lib/**`, `scripts/**` for kebab-named skill literals:

- `calendar-create-event`, `calendar-find-free-slot`, etc. — **0 hits** in non-skills code
- `ea-daily-briefing`, `ea-home-widget-summary`, etc. — **0 hits** in non-skills code
- `slack-list-channels`, `slack-post-dm`, etc. — **0 hits** in non-skills code
- `slack-inbound` at `pgBossRegistrations.ts:748` — queue name, NOT a skill filename reference; excluded

**Conclusion:** No code outside `server/skills/` hardcodes the kebab filenames. Renames are safe.

`server/skills/index.ts` — does NOT exist. No loader to update.

## 25 files to rename

### Top-level (16 files under `server/skills/`)

| Current filename | Rename target | Verdict |
|---|---|---|
| `calendar-create-event.md` | `calendar_create_event.md` | rename |
| `calendar-find-free-slot.md` | `calendar_find_free_slot.md` | rename |
| `calendar-get-event.md` | `calendar_get_event.md` | rename |
| `calendar-list-events.md` | `calendar_list_events.md` | rename |
| `calendar-respond-to-invite.md` | `calendar_respond_to_invite.md` | rename |
| `calendar-update-event.md` | `calendar_update_event.md` | rename |
| `ea-daily-briefing.md` | `ea_daily_briefing.md` | rename |
| `ea-home-widget-summary.md` | `ea_home_widget_summary.md` | rename |
| `ea-inbox-triage.md` | `ea_inbox_triage.md` | rename |
| `ea-meeting-prep.md` | `ea_meeting_prep.md` | rename |
| `slack-list-channels.md` | `slack_list_channels.md` | rename |
| `slack-post-dm.md` | `slack_post_dm.md` | rename |
| `slack-post-message.md` | `slack_post_message.md` | rename |
| `slack-read-channel.md` | `slack_read_channel.md` | rename |
| `slack-search-messages.md` | `slack_search_messages.md` | rename |
| `slack-summarise-thread.md` | `slack_summarise_thread.md` | rename |

### Support subdirectory (9 files under `server/skills/support/`)

| Current filename | Rename target | Verdict |
|---|---|---|
| `add-internal-note.md` | `add_internal_note.md` | rename |
| `approve-draft.md` | `approve_draft.md` | rename |
| `classify-ticket.md` | `classify_ticket.md` | rename |
| `find-customer-history.md` | `find_customer_history.md` | rename |
| `list-open-tickets.md` | `list_open_tickets.md` | rename |
| `propose-reply.md` | `propose_reply.md` | rename |
| `read-thread.md` | `read_thread.md` | rename |
| `reject-draft.md` | `reject_draft.md` | rename |
| `set-status.md` | `set_status.md` | rename |

## Allowlist

No allowlist entries. All 25 files default to rename.

## Existence verification

All 25 kebab files confirmed present on disk (from directory listing of `server/skills/`). No missing files.

## Notes for chunk 9

1. Action registry keys (`calendar.create_event`, `slack.list_channels`, etc.) use dot-qualified snake_case — already correct. Renames are on `.md` filenames only; no `ACTION_REGISTRY` key changes needed.

2. `assign.md` and `tag.md` in `server/skills/support/` are already snake_case — not in the rename list.

3. The action registry snapshot (`scripts/snapshots/action-registry.snapshot.json`) uses keys like `calendar.create_event`, `slack.list_channels`, `support.add_internal_note` — these match the snake_case of the renamed files (after replacing hyphens with underscores). The comparator in chunk 9 maps file base names to registry keys via the dot-qualified convention.
