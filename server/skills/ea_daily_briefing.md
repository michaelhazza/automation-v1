---
slug: ea.daily_briefing
name: EA Daily Briefing
description: Runs the morning briefing workflow for the Personal Assistant — assembles upcoming meetings, pending email drafts, and action items into a structured daily summary.
actionType: ea.daily_briefing
riskTier: 2
defaultGate: auto
requiredIntegration: null
topics:
  - calendar
  - email
  - slack
---

## Purpose

Assemble and return a structured daily briefing for the owner. Read-heavy; no sends are initiated in this workflow.

Emit `workflow.started` at entry. Emit exactly one of `workflow.completed`, `workflow.failed`, or `workflow.partial` at terminal.

## Steps

1. List today's calendar events via `calendar.list_events` with `timeMin` set to the start of today and `timeMax` set to the end of today.
2. Query pending EA drafts: `actions WHERE status = 'pending_approval' AND kind = 'ea_draft'` scoped to the owner. Count the rows; do not read body content.
3. If a Slack integration is connected, scan relevant channels via `slack.read_channel` for unread mentions since the last briefing run.
4. Assemble a structured summary containing: upcoming meetings (time, title, attendee count), pending approval count, and any flagged Slack messages.
5. If a voice profile is available (`voice_profiles WHERE owner_user_id = $ownerUserId AND state = 'ready'`), apply the owner's tone and style when phrasing the summary output.

## Output

Structured summary object:
- `meetings`: list of today's events with start time, title, and attendee count
- `pendingApprovals`: integer count of drafts awaiting approval
- `flaggedMessages`: list of Slack message excerpts flagged as requiring action (empty array if Slack unavailable)

## Error paths

- Calendar credential expired: emit `workflow.partial` with note `calendar_unavailable`; continue with remaining data sources.
- Slack integration unavailable or credential revoked: emit `workflow.partial` with note `slack_unavailable`; return briefing without Slack section.
- All data sources fail: emit `workflow.failed`.
