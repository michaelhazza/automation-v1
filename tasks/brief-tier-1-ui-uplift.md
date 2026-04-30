# Development Brief: Tier 1 UI Uplift (HyperAgent-inspired)

**Date:** 2026-04-30
**Status:** Draft — reviewed, pre-spec. Codebase verified 2026-04-30.
**Origin:** HyperAgent demo digest (Howie Liu / Greg Isenberg podcast). Tier 1 items A–E from the analysis returned to the user 2026-04-30.

---

## Contents

1. Why
2. Architectural invariants (cross-cutting)
3. Scope: items A–E
4. Item A — Thread Context doc + plan checklist
5. Item B — Per-thread cost & token meter in the header
6. Item C — Suggested next-action chips after agent turns
7. Item D — Invocations card on the agent edit page
8. Item E — Inline integration-setup card in chat
9. Sequencing recommendation
10. Estimated total effort
11. What this brief does NOT decide

---

## 1. Why

We watched a demo of HyperAgent — a likely competitor with strong UX patterns we can learn from. The five items below are the highest-value-for-effort uplifts that fit existing surfaces (`AgentChatPage`, `AdminAgentEditPage`) and don't require new backend systems. They cluster well as a single design pass: they all sharpen the agent-as-coworker narrative on the screens users spend the most time on.

Out of scope for this brief (deferred to later tiers): rubrics + LLM-as-judge, conversational skill creation, live mode, memory defrag, custom-skill-from-API-docs, personalised onboarding.

---

## 2. Architectural invariants (cross-cutting)

These rules apply to A–E together. Each item's spec must honour them; violations are blocking review issues. Lifted to the top because A and E both define new architectural primitives, and inconsistency between them will compound.

1. **Thread Context is the only durable working state per conversation.** Single writer (the `update_thread_context` tool); never reconstructed from messages or compacted history; the DB row is the source of truth. System-message injection at compaction time is *read-only display* of that state, not its origin.
2. **All agent-initiated UI extensions are structured message metadata.** Suggested-action chips (C), inline integration cards (E), and any future agent-emitted UI element are columns/JSONB on the message row — never free-text parsed at render time. The wire format is reviewed and stable; the LLM does not invent it on the fly.
3. **The LLM never emits raw internal action slugs.** Agent outputs that trigger system actions go through a controlled enum (`actionKey`) mapped to handlers via the existing `ACTION_REGISTRY` (`server/config/actionRegistry.ts`). No string matching on LLM output.
4. **All resumable executions are idempotent and versioned.** Any run that pauses for external action (E, future tiers) must (a) issue a single resume token, (b) tolerate duplicate resume calls without re-executing side effects, and (c) carry an explicit expiry.
5. **Cost aggregation is deterministic and tied to a stable scope.** A given `(conversation_id, model_id)` pair yields the same total regardless of when it's queried. Define which run statuses count (likely successful + partial; not failed retries that produced no output) once, in the Item B spec, and reuse that rule everywhere cost is shown.
6. **All cross-boundary events emit structured logs.** Every context update, cost aggregation, run state transition, resume event, and suggested-action click logs `{ conversationId, runId, state, action }` at minimum. This is the observability floor — without it, debugging the features added in this brief will rely on inference from incomplete data.

These are stated once here so each item below can reference them without restating.

---

## 3. Scope: items A–E

| Item | One-liner | Primary surface |
|------|-----------|-----------------|
| A | Thread Context doc + plan checklist visible in the chat | `AgentChatPage` (right pane) |
| B | Per-thread cost & token meter in the header | `AgentChatPage` (header) |
| C | Suggested next-action chips after agent turns | `AgentChatPage` (composer area) |
| D | Invocations card consolidating triggers/heartbeat/Slack/email | `AdminAgentEditPage` |
| E | Inline integration-setup card rendered in the chat thread | `AgentChatPage` (message stream) |

---

## 4. Item A — Thread Context doc + plan checklist

### What HyperAgent does
A pinned document inside every thread containing three sections: **Decisions**, **Architecture/Approach**, **Plan Tasks** (with checkboxes that strike through as work completes). The agent writes and updates it as it works. It survives context compaction — when the thread compacts, this is the durable state.

### Why we want it
- The user's stated instinct: "see what context the bot is working with and creating on for that individual task." This *is* that.
- Today our right pane shows a hierarchy/trace. Useful for debugging, but doesn't tell the user what the agent has *decided* or *what's left*.
- We already have a handoff schema (`AgentRunHandoff` in `AgentChatPage.tsx:9-16`) with `accomplishments`, `decisions`, `blockers`, `nextRecommendedAction`. That's most of the data — it's just per-run, not per-conversation, and it's not visible inline.

### What we'd build
- A new `conversation_context` record keyed by conversation id, holding three structured sections plus metadata:
  - `decisions: { id, decision, rationale, addedAt }[]`
  - `approach: string` (markdown)
  - `tasks: { id, label, status: 'pending' | 'in_progress' | 'done', addedAt, updatedAt }[]`
  - `version: number` (monotonically increasing)
  - `updatedAt: timestamp`
- Server-side: agent writes via a single tool (`update_thread_context`) plumbed through `agentExecutionService`. Storage is JSONB on a new row keyed by `conversation_id` (1:1, no per-run rows).
- Client-side: render in the existing right pane (new tab next to "Hierarchy"). Live updates via the WebSocket room `AgentChatPage` already subscribes to (`useSocketRoom`).

### Update semantics — patch ops, not blob overwrites
The tool accepts a typed patch, not a full replacement:
```ts
type ThreadContextUpdate = {
  decisions?: { add?: Decision[]; update?: Decision[]; remove?: string[] };
  tasks?: { add?: Task[]; updateStatus?: { id: string; status: TaskStatus }[]; remove?: string[] };
  approach?: { replace?: string; appendNote?: string };
};
```
Rationale: a single missing field in a "rewrite the whole doc" call would silently delete state. Patch ops also keep the model's per-call output small and reviewable.

### Concurrency model
- **Within a single run, tool calls run sequentially** (`agentExecutionService.ts:2584+`, `for…of` with `await`). No intra-run race.
- **Cross-run writes can race** — retries, scheduled re-entries, future parallel runs. Acceptable behaviour for v1: last-write-wins on the patch op, with `version` bumped on every write. The tool returns the new version; the caller (agent loop) does not need to read-before-write.
- No optimistic-concurrency rejection in v1 — flagged in the spec as "revisit if we observe lost updates."

### Task identity
- IDs are **server-generated** (UUID or short slug) and returned in the tool response.
- Agent references tasks by ID for `updateStatus` / `remove` ops. It cannot mint IDs.
- Adds use a client-supplied `clientRefId` only for de-duplication within a single tool call; the canonical ID is the server's response.

### Read model contract
The agent and the UI must see the same representation. Having the DB store rich JSONB while the LLM injection uses arbitrary markdown is the root cause of prompt drift.

Define one canonical read projection used for **both** LLM context injection and UI rendering:

```ts
type ThreadContextReadModel = {
  decisions: string[];       // flattened "<decision>: <rationale>" strings for LLM
  approach: string;          // verbatim markdown
  openTasks: string[];       // labels of pending + in_progress tasks
  completedTasks: string[];  // labels of done tasks (pruned to last N per rules below)
};
```

- DB stores the rich structure (IDs, timestamps, full rationale).
- The read projection is a deterministic derivation from it — not a separately maintained doc.
- One server function produces this projection; it is the only path by which Thread Context enters an LLM prompt or a UI pane.

### Pruning rules (deterministic)
The soft-cap note in the data model section is not enough. Pruning must be deterministic and order-stable across runs:

- **Completed tasks**: pruned oldest-first when the total task count (open + completed) exceeds the cap. A task is only eligible for pruning once its `status === 'done'`.
- **Decisions**: never auto-pruned. Agent may explicitly `remove` a decision by ID if it is superseded. Stale decisions are the agent's responsibility to mark obsolete.
- **Approach**: never truncated — only fully replaced via `approach.replace`. Partial overwrites are not allowed.
- **Cap**: 50 total tasks and 100 decisions as defaults. Spec may tune; the rules above are fixed regardless of cap.

Invariant: given the same DB state, the same read model is produced every time regardless of call order or caller.

### Relationship to `AgentRunHandoff`
- `AgentRunHandoff` (verified: stored as JSONB on `agent_runs.handoff_json`, fields `accomplishments[]`, `decisions[]`, `blockers[]`, `nextRecommendedAction`, `keyArtefacts[]`) stays as the per-run terminal summary. It is the run's exit report.
- Thread Context is the durable working state across runs. The handoff may *trigger* updates to thread context (the agent reading its own handoff and patching the doc), but the two are not the same row, and one does not derive from the other.

### Compaction invariant
- No compaction code exists today (verified). The data model must not assume it does.
- When compaction lands: the DB row is the source of truth. The most recent thread context is re-injected as a system message at compaction time. **The system message is display-only; the DB is canonical.** Never reconstruct the doc from compacted message history.

### Open questions for spec
- Does the user edit tasks directly in v1, or only the agent? (Lean: read-only for v1; user edits in a later tier.)
- Should the `update_thread_context` tool be visible in the run trace pane? (Lean: yes — it's a high-signal call to surface for debugging.)
- Is there a per-conversation cap on tasks/decisions to prevent unbounded growth? (Lean: soft cap of ~50 each, oldest-completed pruned.)

### Files likely touched
- `shared/types/conversationContext.ts` (new)
- `server/db/migrations/<n>_conversation_context.sql` or extend `conversations` table
- `server/services/agentExecutionService.ts` — add tool emission path
- `server/actions/updateThreadContext.ts` (new) — register in `actionRegistry`
- `client/src/pages/AgentChatPage.tsx` — right-pane render
- `client/src/components/ThreadContextPanel.tsx` (new)

### Effort estimate
Medium. Backend new model + tool ~1 day; client render + live updates ~1 day; integration with agent loop & prompt updates ~0.5 day. Spec required.

---

## 5. Item B — Per-thread cost & token meter in the header

### What HyperAgent does
Title bar shows `Opus 4.7 · 164.5k · $4.07` updated live. Cost transparency at the unit (task) level, not just at the org level. Drives intuition for which tasks justify Opus vs Sonnet.

### Why we want it
- Users today have no idea what a thread is costing them. Cost is buried in admin reports.
- Pairs with the user's frustration about model selection — once cost is visible per-task, "why am I using Opus for this?" becomes an obvious question the user can answer themselves.
- We already have all the data:
  - `RunCostResponse` (`shared/types/runCost.ts`) returns `totalCostCents`, `totalTokensIn`, `totalTokensOut` per run.
  - `agentExecutionService.ts` tracks `totalTokensUsed` per execution (lines ~2328, 2470).
  - `claudeCodeRunner.ts` returns `costUsd` per call.

### Hard prerequisite: run → conversation linkage does not exist today
Verified against the schema: **`agent_runs` has no `conversation_id` column**. `agent_conversations` is a separate table not linked to runs. Many runs are not conversation-scoped at all (heartbeat, scheduled, webhook-triggered). `cost_aggregates` exists with `entityType='run'` but does not aggregate by status (failed retries are counted alongside successes).

This means Item B is **not** a thin client change against existing data. The spec must decide one of:

- **Option 1 — Add `conversation_id` to `agent_runs`** (nullable for non-conversation runs). Backfill for runs that were chat-triggered. Then roll up `cost_aggregates` filtered by it. Cleanest long-term, but a real schema change with a backfill step.
- **Option 2 — Roll up via messages.** Each chat-triggered message links to the run that produced it; sum the costs of those runs. Avoids a schema change but only works for conversation surfaces (which is exactly the surface this item targets).
- **Option 3 — Defer to a `conversation_run_links` join table** if we expect many-to-many later.

Lean: Option 2 for v1 (no schema change), Option 1 in a follow-up if the linkage proves useful elsewhere. The spec must pick before this item starts.

### What we'd build (assuming Option 2)
- New endpoint: `GET /api/agents/:agentId/conversations/:convId/cost` returning:
  ```ts
  {
    totalCostCents: number;
    totalTokensIn: number;
    totalTokensOut: number;
    runCount: number;
    modelBreakdown: { modelId: string; costCents: number; tokens: number }[];
  }
  ```
- Implementation: join `messages` → `agent_runs` → `cost_aggregates`, filter by `messages.conversationId`, **filter run statuses per the deterministic rule defined in invariant #5**.
  - Canonical rule: **count all runs that produced at least one user-visible message, exactly once.** This handles the partial-retry case — if Run A fails halfway but emitted output, and Retry Run B succeeds, both are counted (their output is visible). If Run A failed silently with no emitted messages, it is excluded. Deduplication is via message linkage, not run status alone.
  - Consequence: rollup should `JOIN` to `messages` and count distinct `run_id`s that appear there, not filter on `agent_runs.status` directly.
- Client: header in `AgentChatPage.tsx:372` already shows `agent.modelId` (line 383). Add `· {tokenCount} · ${cost}` next to it. Refetch on each new assistant message.
- Format: `164.5k` for tokens (k after 1k, M after 1M), `$4.07` for cost (cents → dollars).

### Open questions for spec
- Pick the linkage option (1, 2, or 3 above).
- Define the canonical "which run statuses count" rule (invariant #5). This rule is reused by future cost surfaces (org-wide reports, per-skill cost) — do not let it diverge.
- Token count: input + output combined, or split? (Lean: combined.)
- Header summary or expandable detail? (Lean: header summary, click to expand for model breakdown.)
- Permission: do non-admin users see cost? (Lean: yes — own thread cost only. Cost visibility must respect tenant/subaccount scope: non-admin users never see org-wide aggregates or other users' threads. Admin sees org-wide.)

### Files likely touched
- `server/routes/conversations.ts` — new GET handler
- `server/services/conversationCostService.ts` (new) — SQL aggregation with the canonical status filter
- `client/src/pages/AgentChatPage.tsx` — header render + refetch hook
- `client/src/lib/formatCost.ts` (new) — shared formatter
- Schema migration *only* if Option 1 is picked

### Effort estimate
Revised to Medium (was Small). Linkage decision + spec ~0.5 day; aggregation service ~0.5–1 day; client render ~0.5 day; schema migration if Option 1 ~0.5 day. **Spec needed** — even though the UI is small, the cost-determinism rule is durable.

---

## 6. Item C — Suggested next-action chips after agent turns

### What HyperAgent does
After the agent finishes a turn, it surfaces 3–4 suggested follow-ups as buttons: "Save the skill", "Tighten voice rules", "Rewrite weakest draft", "Generate second batch on different trends". User clicks → that becomes the next message.

### Why we want it
- High perceived intelligence for low effort. Reduces the blank-cursor problem.
- Surfaces system actions inline ("Save this thread as an agent", "Schedule daily at 8am") without forcing the user to a settings page.
- Architecturally tiny: agent emits an `actions[]` array on its final response; client renders chips that pre-fill the composer or trigger a system action.

### What we'd build
- Extend the assistant message shape to include an optional `suggestedActions` field. Critically: the LLM never emits raw internal slugs (invariant #3). The wire format uses a controlled `actionKey` enum, mapped server-side to handlers via the existing `ACTION_REGISTRY` (`server/config/actionRegistry.ts`):
  ```ts
  type SuggestedAction =
    | { label: string; kind: 'prompt'; prompt: string }
    | { label: string; kind: 'system'; actionKey: SuggestedActionKey };

  type SuggestedActionKey =
    | 'save_thread_as_agent'
    | 'schedule_daily'
    | 'pin_skill';
  // Add cases here as the v1 set grows. Unknown values are dropped at parse time.
  ```
- Backend: agent's system prompt is given the closed enum and an example. Output is parsed, validated against the enum (unknown keys dropped, not passed through), and stripped from the visible message before storage. Stored on the message row.
- The dispatch layer translates `actionKey` → handler. v1 keys map to:
  - `save_thread_as_agent` → existing "save as agent" route
  - `schedule_daily` → existing schedule modal
  - `pin_skill` → existing skill-pin endpoint
  Where an existing `ACTION_REGISTRY` action already covers the behaviour, the suggested-action handler should delegate to it rather than duplicate logic.
- **Permission and context validation at execution time.** The agent suggesting an action does not imply the user is allowed to execute it. Before invoking the handler, the dispatch layer runs the same permission + context checks that the equivalent UI surface would run. An action that fails validation either renders as a visually disabled chip (if the client can pre-check) or fails gracefully with an inline error on click. The agent does not need to know whether its suggestion was executable — this is the dispatch layer's responsibility, not a prompt constraint.

### Open questions for spec
- How aggressive is the suggestion model? Always 3 chips, or sometimes zero? (Lean: optional, agent decides — many turns shouldn't have any.)
- Show chips on historical messages or only the latest? (Lean: latest only.)
- Does the agent see prior chip clicks as context? (Yes — they're real user messages once clicked.)

### Files likely touched
- `shared/types/messageSuggestedActions.ts` (new)
- `server/services/agentExecutionService.ts` — parse & strip from response
- `server/db/migrations/<n>_message_suggested_actions.sql` — column add (nullable; historical rows default to `null`; the renderer and any JSON consumers must tolerate `null` or `[]` interchangeably)
- `client/src/pages/AgentChatPage.tsx` — render chips + click handlers
- `client/src/components/SuggestedActionChips.tsx` (new)
- Agent system prompts — instruct on the format

### Effort estimate
Small-Medium. Schema + parsing ~0.5 day; client render + handlers ~0.5 day; prompt engineering iterations ~1 day. No formal spec needed but agent-prompt section needs review.

---

## 7. Item D — Invocations card on the agent edit page

### What HyperAgent does
Single card titled "Invocations" with a row of icons: **Slack** (active count badge), **Scheduled**, **Webhook**, **Email** (each with "Setup" badge if not configured), **SMS** / **MCP Server** (each with "Soon"). One unified surface for "ways to start a conversation with this agent."

### Why we want it
- We currently scatter trigger configuration across multiple sections of `AdminAgentEditPage` (heartbeat at line ~1413, separate Slack/email config elsewhere). The user's words: "Invocations is what our activity is supposed to be."
- Consumer-simple framing — instead of "configure a trigger," it's "this agent answers when X."
- Forcing function for our trigger model: invocations should be a first-class concept, not scattered fields.

**Ontology note (for naming consistency across docs and future first-class model):** An *invocation* is any event — external, scheduled, or internal — that initiates or resumes a conversation with this agent. External: Slack message, email, webhook, OAuth resume. Scheduled: heartbeat. Internal: retry jobs, escalation flows, future automation-chain triggers. v1 is UI-only consolidation; this name should propagate to future code so we don't drift between "trigger," "channel," and "invocation."

### What we'd build
- A single card component on `AdminAgentEditPage` that lists all invocation channels with their status:
  - **Scheduled** — already exists as heartbeat (`heartbeatEnabled`, `heartbeatIntervalHours`, etc.). Reframe label.
  - **Webhook** — already exists.
  - **Slack** — already exists; pull active channel count.
  - **Email** — already exists (mailbox).
  - **SMS** — coming-soon placeholder.
  - **MCP Server** — coming-soon placeholder.
- Each channel shows: icon, label, status badge ("Active" with count, "Setup" if available but not configured, "Soon" if not yet built).
- Click opens the existing config UI for that channel — no backend changes, just visual consolidation.

### Open questions for spec
- Does this *replace* the scattered sections or sit on top of them? (Lean: replace — the existing sections collapse into expandable detail under each invocation.)
- What counts as an "active" Slack invocation? Channel count? Recent activity? (Lean: count of channels the agent is in.)
- Do we add MCP/SMS as actual placeholders (with a "Notify me when available" CTA) or just visual stubs? (Lean: visual stubs for v1.)

### Files likely touched
- `client/src/pages/AdminAgentEditPage.tsx` — major reorganisation of upper sections
- `client/src/components/InvocationsCard.tsx` (new)
- `client/src/components/InvocationChannelTile.tsx` (new)
- No backend changes for v1.

### Effort estimate
Medium. Mostly a client refactor of `AdminAgentEditPage`. ~1.5 days. No spec needed unless we change the data model — visual-only is direct implementation.

---

## 8. Item E — Inline integration-setup card in chat

### What HyperAgent does
When an agent needs an unconnected integration (e.g. Notion), it renders a connect card *inline in the chat thread*: icon, name, "Authorize access" button, all wrapped in the assistant's message. User clicks, OAuths, returns to the same thread. No "go to settings, come back."

### Why we want it
- Massive friction reducer. We already have `ConnectorConfigsPage` and OAuth flows for major integrations — this just changes where the "connect" button shows up.
- Pairs naturally with C (suggested actions) — an integration-setup card is essentially a system-action chip with a richer render.

### Context: the execution model change this item introduces
Today the agent execution model is linear: `trigger → run → response`. Item E introduces a new segment: `run → blocked_on_integration → (user OAuth) → resume → continue`. This is a genuinely new execution state that doesn't exist today.

Verified: `agentExecutionService.ts` has a `resumeAgentRun()` (lines 1944–2003) used for crash recovery and iteration checkpointing, plus a `resumeToken` (SHA-256 of `runId + iteration`). That infrastructure is adjacent but not identical — it handles *interrupted* runs, not *intentionally paused* ones. The new `blocked_on_integration` state needs its own lifecycle path alongside the existing crash-recovery path.

### Run state machine (minimum for v1)
Add these states to `agent_runs.status` (or a parallel `blocked_reason` column if touching status is high-risk):
```
running
blocked_on_integration   ← new
resumed                  ← new
completed
failed
cancelled                ← new (user dismiss+abandon, system TTL expiry escalation, manual stop)
```
`cancelled` is a deliberate terminal state, distinct from `failed`. Without it, user-abandoned runs and silent TTL expirations both map to `failed`, muddying run analytics and making debugging painful. A run is `cancelled` when it will not be retried; it is `failed` when it errored unexpectedly.

### Resume token + idempotency
- A `resumeToken` is generated when the run transitions to `blocked_on_integration` and stored on the `agent_runs` row (the existing `resumeToken` column can be reused if its semantics are compatible — verify in spec).
- The OAuth return URL embeds `?resumeToken=<token>&conversationId=<id>`.
- On return: the server validates the token, checks the run is still in `blocked_on_integration`, and triggers resume. **Duplicate calls with the same token must be idempotent** — the second call is a no-op if the run has already resumed.
- If the run has expired or completed (state != `blocked_on_integration`): return a clear error to the client, don't silently re-run.

### Expiry
Define a TTL for `blocked_on_integration` runs (lean: 24 hours). On expiry:
- Transition status to `cancelled` with `cancelReason: 'integration_connect_timeout'`. (`failed` is reserved for unexpected execution errors — a TTL expiry is a deliberate terminal state, not an error.)
- The conversation thread shows the card in a "timed out" visual state with a "Try again" CTA (which creates a new run, not a resume).
- No silent abandonment.

### Non-idempotent tool calls on resume
Re-executing the blocked tool call on resume is safe if and only if the tool is idempotent. Many are not (send email, create record, post Slack message). Without a guard, resume will produce duplicate side effects.

Invariant: **blocked tool calls must either be idempotent or carry an explicit deduplication key.** Two implementation options for spec to pick:
- **Option A — dedup key on the tool call.** Before blocking, the executor stores a `dedupKey` (e.g. `sha256(runId + toolName + inputHash)`) alongside the blocked tool state. On resume, the tool checks for prior execution with the same key.
- **Option B — safe-to-retry marker in ACTION_REGISTRY.** Non-idempotent tools declare `idempotencyStrategy: 'keyed_write'` (already exists in `server/config/actionRegistry.ts`). The resume path checks this flag and gates re-execution accordingly.

Option B is lighter and reuses existing infrastructure — lean toward it.

### Multi-block handling
A run may need multiple integrations in sequence (e.g. Notion then Slack), or prompt for multiple accounts of the same integration. The v1 implementation handles one block at a time, but the state model must allow re-entry:

- `blocked_on_integration` is a repeatable state, not a one-way transition.
- After resuming and continuing, the run may re-enter `blocked_on_integration` for a different integration — each block generates a new `resumeToken` and a new integration-card message.
- v1 does not need to batch multiple blocks into a single card. Sequential single-blocks with independent resume tokens are sufficient.

This does not require scope change for v1 — just ensure the state machine doesn't treat the first resume as a final-exit from `blocked_on_integration`.

### A + E interaction: stale Thread Context on resume
When a run resumes after an OAuth flow, its injected Thread Context snapshot is from before the block. If another run updated Thread Context during the pause (unlikely but possible), the resuming run would continue with a stale plan.

Rule: **on resume, the agent must re-read Thread Context before continuing execution.** In practice this means the resume path re-injects the current Thread Context read model (§4) as a system message before handing control back to the LLM continuation. This is the same injection mechanism used at run start — it just needs to be called at resume time too.

Note: this interaction only matters if Thread Context is actively being written by the agent. For v1, where most runs are single-session, this is a low-frequency edge case. It's included here so the spec author doesn't miss it when designing the resume handoff.

### What we'd build
- Extend message rendering to support an `integration_card` content type (alongside text, invariant #2). Schema:
  ```ts
  type IntegrationCardContent = {
    type: 'integration_card';
    integrationId: string;
    title: string;
    description: string;
    actionLabel: string;    // e.g. "Connect Notion"
    actionUrl: string;      // OAuth start URL with resumeToken + conversationId
    resumeToken: string;    // stored here so the client can render dismiss/expired states
    expiresAt: string;      // ISO timestamp — client shows TTL countdown or expired state
  };
  ```
- Server: when the agent invokes a tool that requires a missing integration, the executor transitions the run to `blocked_on_integration`, emits an integration-card message into the conversation, and saves the `resumeToken` on the run row.
- Client: render the card inline. Click "Connect" → OAuth popup; on success, `postMessage` back with the token → server validates → run resumes → thread refreshes via the existing WebSocket room.
- Dismiss renders visually (card collapses) but the run stays `blocked_on_integration` until expiry. The user can reconnect by clicking "Try again" on the collapsed state.
- Return-to-thread wiring: existing OAuth callbacks accept `?resumeToken=...&conversationId=...`; on success they call the resume endpoint, not just a thread refresh.

### Open questions for spec (mandatory — do not start without answers)
- Does `agent_runs.status` get a new `blocked_on_integration` value, or do we add a parallel `blockedReason` column to avoid touching the status enum (lower-risk schema change)?
- Is the existing `resumeToken` column on `agent_runs` compatible with this use, or do we need a separate `integrationResumeToken`?
- TTL: 24 hours, or configurable per integration type?
- After OAuth success: does the agent pick up exactly where it left off (re-execute the blocked tool call), or does it restart the run with the integration now connected?

### Files likely touched
- `shared/types/messageContent.ts` — add `IntegrationCardContent`
- `server/db/migrations/<n>_agent_run_blocked_state.sql` — new status value or `blockedReason` column + `integrationResumeToken` + `blockedExpiresAt`
- `server/services/agentExecutionService.ts` — integration-missing branch → `blocked_on_integration` transition + token generation
- `server/routes/oauth.ts` — accept `resumeToken` + `conversationId`, call resume endpoint
- `server/services/agentResumeService.ts` (new or extend existing) — validate token, idempotent resume
- `client/src/pages/AgentChatPage.tsx` — message renderer dispatch
- `client/src/components/InlineIntegrationCard.tsx` (new)

### Effort estimate
Revised to Medium-Large (was Medium). State machine + schema ~0.5–1 day; server integration-missing branch + token generation ~1 day; OAuth return wiring + resume service ~1 day; client card + dismissed/expired states ~0.5 day. **Spec required — do not implement directly.**

---

## 9. Sequencing recommendation

Build in this order — earlier items establish the patterns and decisions that later items depend on:

1. **B (cost meter)** — first, but now spec-needed (run→conversation linkage decision). Establishes the cost-determinism rule reused by future surfaces.
2. **C (suggested chips)** — establishes the message-extension pattern and the `actionKey` dispatch layer that E reuses.
3. **A (thread context)** — biggest UX win. Spec required.
4. **E (inline integration card)** — after A, because the state machine design is cleaner once the thread context data model is settled. Spec required — do not start without the four open questions answered.
5. **D (invocations card)** — pure client refactor; no inter-item dependencies; ship any time after B settles.

B, C, D: specs kept short (B now needs a brief one for the linkage decision). A and E: full spec sessions before a single line of implementation.

---

## 10. Estimated total effort

Revised estimates after codebase verification:

| Item | Original | Revised | Driver |
|------|----------|---------|--------|
| A — Thread Context | ~2.5 days | ~3–3.5 days | Patch-op semantics, cross-run versioning, task IDs, handoff wiring |
| B — Cost meter | ~1 day | ~1.5–2 days | Run→conversation linkage is missing; spec now required for cost-determinism rule |
| C — Suggested chips | ~2 days | ~2 days | Unchanged; controlled-enum approach doesn't materially change effort |
| D — Invocations card | ~1.5 days | ~1.5 days | Unchanged; pure client refactor |
| E — Inline integration card | ~2.5 days | ~3–4 days | State machine, resume token, idempotent resume, expiry — each a real work item |

**Total: ~11–13 days solo, sequentially.**
With parallelisation (A + B in separate sessions; D any time): **~7–9 days.**

The original ~6–8 day estimate assumed B was trivial and E was mostly UI. Neither holds after the prerequisite checks.

---

## 11. What this brief does NOT decide

- Whether thread context is per-conversation or per-run (A).
- The exact suggested-action grammar the agent emits (C).
- Whether D's reorganisation is destructive or additive (D).
- OAuth return-to-thread resume semantics (E).
- Visual design — colours, iconography, exact typography — handled at implementation.

These are spec-level questions to answer when each item moves from brief → spec. Grouped by item so each spec author can find their open questions immediately.

**Item A (Thread Context)**
- Does the user edit tasks/decisions directly in v1, or read-only? (Lean: read-only.)
- Is `update_thread_context` visible in the run trace pane? (Lean: yes — high-signal call.)
- Default cap (50 tasks / 100 decisions) — confirm or adjust.

**Item B (Cost meter)**
- Which of Options 1/2/3 (see §5) for the run→conversation linkage?
- Canonical "which run statuses count" rule — picked once here, reused by all cost surfaces.
- Token count: combined input+output, or split?
- Permission model: do non-admin users see cost?

**Item C (Suggested chips)**
- How aggressive is the chip model — always emit 3, or sometimes zero? (Lean: agent decides; zero is fine.)
- Closed `SuggestedActionKey` enum — what's the full v1 set? (Current lean: `save_thread_as_agent`, `schedule_daily`, `pin_skill`.)

**Item D (Invocations card)**
- Does the card replace existing scattered sections or sit above them with expandable detail?
- What counts as "active" for a Slack invocation — channel count, or recent activity?

**Item E (Inline integration card)**
- `agent_runs.status` new value vs parallel `blockedReason` column?
- Is the existing `resumeToken` column reusable for this, or do we need a separate field?
- TTL duration for `blocked_on_integration` state?
- After OAuth success: re-execute the blocked tool call, or restart the run with integration now available?
- Visual design: what does the dismissed/expired card state look like?
