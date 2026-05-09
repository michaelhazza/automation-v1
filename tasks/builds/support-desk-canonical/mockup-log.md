# Mockup log: support-desk-canonical

## Round 1 — 2026-05-09 (initial draft)

**Operator feedback:** Initial draft — brief v5.1 locked.

**Changes made:**
- Created `prototypes/support-desk-canonical/` multi-screen directory (shared CSS already existed from earlier scaffolding).
- Built `index.html`: catalogue page linking all five screens, with brief description and "deliberately not built" section.
- Built `integration-setup.html`: three-step wizard (Connect, Choose inboxes, Confirm). OAuth/API key tab switcher on step 1. Multi-select inbox list with toggle-all on step 2. Backfill window radio (open tickets + 30-day message history vs. headers only) plus connection summary on step 3. Completion/success state with links to tickets and inbox config. All steps navigable via JS.
- Built `tickets-list.html`: full ticket table with subject, customer email, inbox, canonical status badge (all six statuses present in data), priority, assignee, last activity. Quarantine inline banner at top with dismiss and "show quarantined" shortcut. Inbox filter pills and status filter pills (actionable / waiting / resolved / quarantined) wired to JS to show/hide rows. Two quarantined rows hidden by default, revealed by quarantined filter or banner link.
- Built `ticket-detail.html`: three-panel layout (app nav, thread main, right rail). Ticket header with back link, subject, status/priority/inbox/assignee/SLA row. Five messages: customer inbound, bot reply (confirmed, with source_draft_id draft link visible on hover), internal note (amber visually distinct), customer follow-up, in-flight bot draft in `dispatching` state with dashed border and spinner. Right rail: customer identity (name, CRM link, account), recent tickets (3 rows with canonical status badges), revenue (plan/MRR/since), ticket details (opened, source, first-response SLA).
- Built `draft-review.html`: two-panel split. Left: four draft items (two awaiting review, one blocked/red, one awaiting). Right: selected draft detail with collapsible thread context, proposed reply, provenance block (agent run ID, model, prompt, created at), pre-send policy checks. Draft 1 shows all-green policy checks. Draft 3 (API rate limits) shows red collision-window block with human_collision_blocked code and red border. Approve button triggers overlay success state. Edit toggles body to textarea. Reject visually updates list item.
- Built `inbox-config.html`: left inbox list (three inboxes, active state), right config panel per inbox. Each inbox shows identity header (name, email, provider chip). Mode radio grid (autonomous/assisted/disabled) with visual selection state. Collision window: minutes input + respect-human-assignee toggle. Draft expiry hours input. Advanced section collapsed by default showing model and prompt override selects. Billing inbox shows autonomous-mode warning callout. Save bar with dirty state tracking.

**Frontend-design-principles checks:**
- Start with primary task: yes — each screen is task-focused. Integration setup: connect Teamwork. Tickets list: find and triage tickets. Ticket detail: read the thread and understand status. Draft review: approve or reject a draft. Inbox config: set agent behaviour per inbox.
- Default to hidden: yes — no KPI dashboards, no aggregate charts, no raw IDs in default views. Draft ID appears only on hover in ticket thread. Agent run ID, idempotency key, model version are in provenance block on draft review (which is a deliberate safety-critical workflow — acceptable per "safety-critical information-dense screens" exception). Quarantined tickets hidden from default list view, surfaced only via inline indicator and filter.
- One primary action: yes — integration setup has "Start sync" at step 3. Tickets list has no primary action (list/browse screen). Ticket detail has the action bar controls. Draft review primary action is "Approve and send." Inbox config primary action is "Save changes."
- Inline state: yes — status dots on every ticket row. SLA indicator inline in ticket header. Spinning dispatcher label on in-flight bot draft. Collision block shown inline in draft detail, not a separate page.
- Re-check passed: yes — a non-technical CEO could connect Teamwork in three steps, see which tickets need attention, read the thread, approve a bot draft, and configure an inbox without feeling overwhelmed. No engineering concepts exposed by default.

**Rule violations flagged:** None. The provenance block on draft-review.html surfaces model/prompt version and agent run ID — this is the "safety-critical information-dense screen" exception (HITL review gate), not a default monitoring view.

**Files modified:**
- `prototypes/support-desk-canonical/index.html` (new)
- `prototypes/support-desk-canonical/integration-setup.html` (new)
- `prototypes/support-desk-canonical/tickets-list.html` (new)
- `prototypes/support-desk-canonical/ticket-detail.html` (new)
- `prototypes/support-desk-canonical/draft-review.html` (new)
- `prototypes/support-desk-canonical/inbox-config.html` (new)
- `tasks/builds/support-desk-canonical/mockup-log.md` (new)
