# Task Chat — Development Brief

**Status:** Captured for future spec. Not in active development.
**Captured:** 2026-04-08
**Related discussions:** Cascading data sources / context attachment hierarchy

---

## The gap

Today, work on a task happens through formal agent runs. An orchestrator picks up a task, hands off to specialists, agents produce deliverables, the task moves through statuses. The human's view of all of this is `taskActivities` — an **immutable audit log**. There is no interactive surface.

This creates a real workflow gap:

- After a deliverable is produced, there's no way to ask follow-up questions about it ("can you tighten the second paragraph?", "why did you choose this structure?")
- There's no way to give mid-stream guidance to whichever agent is currently working on the task
- The "click on the agent → chat" surface that exists today carries **no task context** — the agent doesn't know which task you're discussing
- Adjustments require manually retriggering agent runs with new prompts, losing the conversational thread

The mental model users actually want is the one they already have from Linear discussions, GitHub issue comments, Slack threads, and Claude Project chats: **a conversation tied to a piece of work, where everyone (human and agents) has the work's full context loaded.**

## Conceptual model

Every task gets a **thread**. The thread is the canonical conversation surface for that task.

- Anyone with read permission on the task can see the thread
- Anyone with comment permission can post a message
- When a message is posted, it routes through the **subaccount orchestrator agent**
- The orchestrator decides what to do: respond directly, hand off to a specialist agent, create a sub-task, escalate to review, do nothing
- Whichever agent responds has the task's **full context** loaded into its run: deliverables, prior agent run outputs, attachments, parent/child tasks, board state, the thread history itself
- Replies stream back into the thread in real-time via WebSocket
- Mentioning a specific agent (`@research-agent`) bypasses orchestrator routing and goes straight to that agent

This turns a task from a "fire and forget" unit of work into a **collaborative workspace** where humans and agents iterate together, with state preserved across the conversation.

## Why now (eventually)

This is the missing piece for the cascading attachments hierarchy discussed in the data sources work. The three levels are:

1. **Agent level** — `contextDataSources` attached to the agent (cross-task knowledge)
2. **Scheduled task level** — `contextDataSources` attached to the recurring task definition (project-equivalent files)
3. **Chat level** — files uploaded into a task thread message (one-off context)

Without task chat, level 3 has nowhere to live. Building task chat unlocks the third tier without inventing a parallel attachment system.

## Use cases this enables

1. **"Tighten that paragraph"** — agent produces a deliverable, user asks for an adjustment in the thread, orchestrator routes back to the writing agent with full context, edit lands as a new deliverable version
2. **"Why did you do it that way?"** — user can interrogate decisions without losing context
3. **Multi-agent collaboration with human in the loop** — orchestrator hands to research, then writer, then editor; user can interject at any point with guidance
4. **Drop-in context** — user attaches a file mid-conversation ("here's the latest data, regenerate"), the file becomes part of the task's context for subsequent runs
5. **Async iteration on a draft** — same deliverable, multiple rounds of refinement, all preserved in one thread

## Open questions for the spec phase

These are decisions to make when we sit down to write the actual implementation spec. Captured here so we don't have to rediscover them.

### Storage

- **New `taskMessages` table** (cleaner separation, dedicated schema for message-specific fields like reactions, edits, attachments) **vs extend `taskActivities`** (less duplication, but conflates audit log with conversation)
- Recommendation lean: separate table. `taskActivities` is immutable audit; messages are conversational, can be edited/deleted, carry attachments and routing metadata.

### Routing & agent reply mechanism

- When a user posts a message, how does it reach an agent?
  - Direct enqueue of an agent run with the thread message as the trigger?
  - A new pg-boss queue (`task-thread-message`) processed by the orchestrator service?
- When an agent run was triggered by a thread message, how does the agent post its reply back into the thread?
  - Implicit: the run's final output is auto-posted as a thread message
  - Explicit: a new skill `post_to_task_thread` lets the agent decide what to send back
  - Recommendation lean: explicit skill, so the agent can post intermediate updates ("working on it...") and only the final response gets marked as the answer

### LLM context budget

- How much of the prior thread history is loaded into the agent run?
  - All of it? Truncate to last N messages? Summarize old messages?
- Recommendation lean: a token budget (e.g. 20k tokens of recent thread history) with summarization fallback for older messages

### Permissions

- New permission keys: `tasks.read_thread`, `tasks.post_thread_message`
- Probably default-granted to anyone with `tasks.read` / `tasks.write`
- Subaccount-scoped

### Real-time delivery

- New WebSocket room: `task-thread:{taskId}`
- Subscribe on thread open, unsubscribe on close
- Reuse existing `useSocket` hook

### Mentions

- `@agent-name` syntax in message body
- Resolved against the subaccount's agent roster
- Bypasses orchestrator, routes directly
- UI: autocomplete picker

### Attachments on messages

- This is the level-3 of the cascading data sources work
- Files attached to a message are loaded into context for any agent run triggered by that message
- Storage: reuse `contextDataSources` table with a new owner type `task_message_id`, OR a dedicated `taskMessageAttachments` table that wraps the same storage
- Lifetime: attachments persist with the message; if the message is deleted, attachments orphan (or cascade)

### Notifications

- How does a user know the agent replied?
- Reuse existing notification system (if one exists) or extend `taskActivities` to flag thread events
- Email digest? In-app toast? Both?

### Cross-task references

- Can a thread message reference another task (`#task-id`)?
- Useful for "see also #432" linking
- Can defer to a v2

### Review gates

- If a task has `reviewRequired: true`, do thread messages from agents also flow through the review queue?
- Probably yes for actions, no for plain text replies

### Editing and deletion

- Can a user edit their own message? (Yes — but with edit history)
- Can an agent edit its own message? (No — agents append, never modify)
- Can anyone delete a message? (Soft delete only, with audit event)

### Search and history

- Searchable history across all task threads in a subaccount — defer to v2
- Per-task search within a thread — v1 nice-to-have

## Out of scope

Things that are explicitly NOT part of this feature, even in v1:

- Email-style nested replies (keep threads linear for v1)
- Direct messages between agents (agents already use the handoff system)
- Cross-subaccount thread search
- Voice/video attachments
- Reactions and emoji (nice but not core)
- Real-time typing indicators
- Read receipts

## Related systems

- `tasks`, `taskActivities`, `taskDeliverables` schemas
- Orchestrator agent and reactive subtask wakeup (`subtaskWakeupService`)
- Agent runs, idempotency keys, handoff system, `MAX_HANDOFF_DEPTH`
- WebSocket rooms (already have subaccount-scoped rooms)
- Review queue (`reviewItems`, `hitlService`)
- Skill system (will need at least `post_to_task_thread`)
- Cascading context data sources (level 3 of the hierarchy)
- Audit events (thread events should emit audit records)

## Estimated scope

This is a **Major** task by the project's task classification:

- New schema (messages table, possibly attachments)
- New service (thread routing, agent invocation from messages)
- New skill (`post_to_task_thread`)
- New routes (CRUD on messages, real-time subscription)
- New WebSocket room
- New UI surface (thread panel on task detail page, message composer, mention autocomplete, attachment uploader)
- New permission keys
- Notification integration

Should be planned via `feature-coordinator` when prioritized. Pre-work: confirm or design the orchestrator's routing logic for thread messages, and decide the storage model.

## Why this is captured here

This brief exists because the gap was identified during the cascading data sources discussion (April 2026). Building chat-level attachments without first building the chat surface is impossible, so the chat-level tier was deferred. This document is the placeholder so the context isn't lost when the team is ready to pick this up.

When ready to build: take this brief into a `feature-coordinator` session, validate the open questions with the team, and produce a real implementation spec.
