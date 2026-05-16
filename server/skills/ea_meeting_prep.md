---
slug: ea.meeting_prep
name: EA Meeting Prep
description: Prepares a briefing for an upcoming meeting — retrieves attendee context, relevant prior correspondence, and action items, returning a structured prep note.
actionType: ea.meeting_prep
riskTier: 2
defaultGate: auto
requiredIntegration: null
topics:
  - calendar
  - slack
---

## Purpose

Produce a structured prep note for an upcoming meeting. Read-only; no sends are initiated in this workflow.

Emit `workflow.started` at entry. Emit exactly one of `workflow.completed`, `workflow.failed`, or `workflow.partial` at terminal.

## Input

- `eventId`: calendar event ID (string). If not provided, use the next upcoming event within the configured lookahead window.

## Steps

1. Fetch event details via `calendar.get_event` using `eventId`. Extract title, start time, duration, location, description, and attendee list.
2. Identify all attendees by email address.
3. If a Slack integration is connected, search for recent threads involving attendees via `slack.search_messages`. Query each attendee's email or display name, limited to the past 14 days.
4. Assemble a prep note containing: meeting purpose (from event title and description), attendee list with names, recent Slack context involving attendees (if available), and any open action items from prior meeting notes in the workspace.
5. If a voice profile is available (`voice_profiles WHERE owner_user_id = $ownerUserId AND state = 'ready'`), format the prep note to match the owner's preferred communication style.

## Output

Structured prep note object:
- `event`: title, start time, duration, location
- `attendees`: list of names and email addresses
- `recentContext`: list of relevant Slack thread excerpts (empty array if Slack unavailable or plan does not support `search:read`)
- `actionItems`: list of open items from workspace related to this meeting or its attendees
- `prepNote`: formatted prose summary suitable for reading before the meeting

## Error paths

- Calendar event not found for the given `eventId`: emit `workflow.failed` with note `event_not_found`.
- Slack search unavailable due to plan restriction (`PLAN_NOT_SUPPORTED`): emit `workflow.partial` with note `slack_search_unavailable`; return prep note without Slack context.
- Slack credential unavailable: emit `workflow.partial` with note `slack_unavailable`; return prep note without Slack context.
