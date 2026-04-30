# Development Brief: Tier 1 UI Uplift (HyperAgent-inspired)

**Date:** 2026-04-30
**Status:** Draft — pre-spec
**Origin:** HyperAgent demo digest (Howie Liu / Greg Isenberg podcast). Tier 1 items A–E from the analysis returned to the user 2026-04-30.

---

## Contents

1. Why
2. Scope: items A–E
3. Item A — Thread Context doc + plan checklist
4. Item B — Per-thread cost & token meter in the header
5. Item C — Suggested next-action chips after agent turns
6. Item D — Invocations card on the agent edit page
7. Item E — Inline integration-setup card in chat
8. Sequencing recommendation
9. Estimated total effort
10. What this brief does NOT decide

---

## 1. Why

We watched a demo of HyperAgent — a likely competitor with strong UX patterns we can learn from. The five items below are the highest-value-for-effort uplifts that fit existing surfaces (`AgentChatPage`, `AdminAgentEditPage`) and don't require new backend systems. They cluster well as a single design pass: they all sharpen the agent-as-coworker narrative on the screens users spend the most time on.

Out of scope for this brief (deferred to later tiers): rubrics + LLM-as-judge, conversational skill creation, live mode, memory defrag, custom-skill-from-API-docs, personalised onboarding.

---

## 2. Scope: items A–E

| Item | One-liner | Primary surface |
|------|-----------|-----------------|
| A | Thread Context doc + plan checklist visible in the chat | `AgentChatPage` (right pane) |
| B | Per-thread cost & token meter in the header | `AgentChatPage` (header) |
| C | Suggested next-action chips after agent turns | `AgentChatPage` (composer area) |
| D | Invocations card consolidating triggers/heartbeat/Slack/email | `AdminAgentEditPage` |
| E | Inline integration-setup card rendered in the chat thread | `AgentChatPage` (message stream) |

---

## 3. Item A — Thread Context doc + plan checklist

### What HyperAgent does
A pinned document inside every thread containing three sections: **Decisions**, **Architecture/Approach**, **Plan Tasks** (with checkboxes that strike through as work completes). The agent writes and updates it as it works. It survives context compaction — when the thread compacts, this is the durable state.

### Why we want it
- The user's stated instinct: "see what context the bot is working with and creating on for that individual task." This *is* that.
- Today our right pane shows a hierarchy/trace. Useful for debugging, but doesn't tell the user what the agent has *decided* or *what's left*.
- We already have a handoff schema (`AgentRunHandoff` in `AgentChatPage.tsx:9-16`) with `accomplishments`, `decisions`, `blockers`, `nextRecommendedAction`. That's most of the data — it's just per-run, not per-conversation, and it's not visible inline.

### What we'd build
- A new `conversation_context` record (or extension of `conversations`) keyed by conversation id, holding three structured sections:
  - `decisions: { decision, rationale }[]`
  - `approach: string` (markdown)
  - `tasks: { id, label, status: 'pending' | 'in_progress' | 'done' }[]`
- Server-side: agent writes to it via a tool (e.g. `update_thread_context`) the same way it currently emits handoffs. Plumb through `agentExecutionService`.
- Client-side: render in the existing right pane (or a new tab next to "Hierarchy"). Live-updates via the WebSocket room `AgentChatPage` already subscribes to (`useSocketRoom`).
- Compaction-safe: when the context window fills, the most recent thread context doc is re-injected as a system message. (Defer the actual compaction wiring to spec — but the data model must support it.)

### Open questions for spec
- Per-conversation or per-run? (Lean: per-conversation, with run-level deltas.)
- Does the user edit the tasks directly, or only the agent? (Lean: read-only for v1; edit comes later.)
- How does it interact with `AgentRunHandoff`? Same data, different shape, or layered? (Likely: handoff stays as the per-run summary; thread-context is the durable working doc.)

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

## 4. Item B — Per-thread cost & token meter in the header

### What HyperAgent does
Title bar shows `Opus 4.7 · 164.5k · $4.07` updated live. Cost transparency at the unit (task) level, not just at the org level. Drives intuition for which tasks justify Opus vs Sonnet.

### Why we want it
- Users today have no idea what a thread is costing them. Cost is buried in admin reports.
- Pairs with the user's frustration about model selection — once cost is visible per-task, "why am I using Opus for this?" becomes an obvious question the user can answer themselves.
- We already have all the data:
  - `RunCostResponse` (`shared/types/runCost.ts`) returns `totalCostCents`, `totalTokensIn`, `totalTokensOut` per run.
  - `agentExecutionService.ts` tracks `totalTokensUsed` per execution (lines ~2328, 2470).
  - `claudeCodeRunner.ts` returns `costUsd` per call.

### What we'd build
- New endpoint: `GET /api/agents/:agentId/conversations/:convId/cost` returning aggregate across all runs in the conversation:
  ```ts
  {
    totalCostCents: number;
    totalTokensIn: number;
    totalTokensOut: number;
    runCount: number;
    modelBreakdown: { modelId: string; costCents: number; tokens: number }[];
  }
  ```
- Implementation: SQL rollup over `cost_aggregates` filtered by `conversation_id` (we'll need to ensure that link exists — verify `agentRuns.conversationId` is populated on every run).
- Client: header in `AgentChatPage.tsx:372` already shows `agent.modelId` (line 383). Add `· {tokenCount} · ${cost}` next to it. Refetch on each new assistant message.
- Format: `164.5k` for tokens (k after 1k, M after 1M), `$4.07` for cost (cents → dollars).

### Open questions for spec
- Token count: input + output combined, or split? (Lean: combined, like HyperAgent.)
- Header summary or expandable detail? (Lean: header summary, click to expand for model breakdown.)
- Permission: do non-admin users see cost? (Default yes — it's their own usage. Admin sees org-wide.)

### Files likely touched
- `server/routes/conversations.ts` (or wherever conversations endpoints live) — new GET handler
- `server/services/conversationCostService.ts` (new) — SQL aggregation
- `client/src/pages/AgentChatPage.tsx` — header render + refetch hook
- Possibly `client/src/lib/formatCost.ts` (new) — shared formatter

### Effort estimate
Small. Endpoint ~0.5 day; client render ~0.5 day. No spec needed — direct implementation against existing data.

---

## 5. Item C — Suggested next-action chips after agent turns

### What HyperAgent does
After the agent finishes a turn, it surfaces 3–4 suggested follow-ups as buttons: "Save the skill", "Tighten voice rules", "Rewrite weakest draft", "Generate second batch on different trends". User clicks → that becomes the next message.

### Why we want it
- High perceived intelligence for low effort. Reduces the blank-cursor problem.
- Surfaces system actions inline ("Save this thread as an agent", "Schedule daily at 8am") without forcing the user to a settings page.
- Architecturally tiny: agent emits an `actions[]` array on its final response; client renders chips that pre-fill the composer or trigger a system action.

### What we'd build
- Extend the assistant message shape to include an optional `suggestedActions` field:
  ```ts
  type SuggestedAction = {
    label: string;
    kind: 'prompt' | 'system';
    payload: string; // 'prompt' → message body to send; 'system' → action slug
  };
  ```
- Backend: agent's system prompt updated to emit `<suggested_actions>` JSON in its response, parsed and stripped before storage. Stored on the message row.
- Client: chips rendered below the most recent assistant message only (not historical ones — keeps the UI clean). Click → either fills the composer (`prompt` kind) or invokes a system action handler (`system` kind).
- v1 system actions: `save_thread_as_agent`, `schedule_daily`, `pin_skill`. Each maps to an existing route or modal.

### Open questions for spec
- How aggressive is the suggestion model? Always 3 chips, or sometimes zero? (Lean: optional, agent decides — many turns shouldn't have any.)
- Show chips on historical messages or only the latest? (Lean: latest only.)
- Does the agent see prior chip clicks as context? (Yes — they're real user messages once clicked.)

### Files likely touched
- `shared/types/messageSuggestedActions.ts` (new)
- `server/services/agentExecutionService.ts` — parse & strip from response
- `server/db/migrations/<n>_message_suggested_actions.sql` — column add
- `client/src/pages/AgentChatPage.tsx` — render chips + click handlers
- `client/src/components/SuggestedActionChips.tsx` (new)
- Agent system prompts — instruct on the format

### Effort estimate
Small-Medium. Schema + parsing ~0.5 day; client render + handlers ~0.5 day; prompt engineering iterations ~1 day. No formal spec needed but agent-prompt section needs review.

---

## 6. Item D — Invocations card on the agent edit page

### What HyperAgent does
Single card titled "Invocations" with a row of icons: **Slack** (active count badge), **Scheduled**, **Webhook**, **Email** (each with "Setup" badge if not configured), **SMS** / **MCP Server** (each with "Soon"). One unified surface for "ways to start a conversation with this agent."

### Why we want it
- We currently scatter trigger configuration across multiple sections of `AdminAgentEditPage` (heartbeat at line ~1413, separate Slack/email config elsewhere). The user's words: "Invocations is what our activity is supposed to be."
- Consumer-simple framing — instead of "configure a trigger," it's "this agent answers when X."
- Forcing function for our trigger model: invocations should be a first-class concept, not scattered fields.

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

## 7. Item E — Inline integration-setup card in chat

### What HyperAgent does
When an agent needs an unconnected integration (e.g. Notion), it renders a connect card *inline in the chat thread*: icon, name, "Authorize access" button, all wrapped in the assistant's message. User clicks, OAuths, returns to the same thread. No "go to settings, come back."

### Why we want it
- Massive friction reducer. We already have `ConnectorConfigsPage` and OAuth flows for major integrations — this just changes where the "connect" button shows up.
- Pairs naturally with C (suggested actions) — an integration-setup card is essentially a system-action chip with a richer render.

### What we'd build
- Extend message rendering to support an `integration_card` content type (alongside text). Schema:
  ```ts
  type IntegrationCardContent = {
    type: 'integration_card';
    integrationId: string;
    title: string;
    description: string;
    actionLabel: string; // e.g. "Connect Notion"
    actionUrl: string;   // OAuth start URL with return-to-thread param
  };
  ```
- Server: when the agent invokes a tool that requires a missing integration, instead of erroring the executor emits an integration-card message into the conversation.
- Client: render the card inline in the message stream. Click → opens OAuth in a popup or new tab; on success, postMessage back to the thread → resume the agent's run.
- Return-to-thread wiring: existing OAuth callbacks need to accept a `?conversationId=...` param and trigger a thread refresh.

### Open questions for spec
- What's the agent's behaviour after the user connects? Auto-resume, or does the user have to retype? (Lean: auto-resume — that's the magic.)
- Do we render dismiss / ignore? (Yes — user can decline.)
- How does this interact with the existing `ConnectorConfigsPage` flow? (It's additive — that page still exists for upfront setup.)

### Files likely touched
- `shared/types/messageContent.ts` (or extend existing message types)
- `server/services/agentExecutionService.ts` — integration-missing branch
- `server/routes/oauth.ts` (or equivalent) — accept conversationId, trigger resume
- `client/src/pages/AgentChatPage.tsx` — message renderer dispatch
- `client/src/components/InlineIntegrationCard.tsx` (new)

### Effort estimate
Medium. Server logic for the missing-integration branch ~1 day; client card render ~0.5 day; OAuth return-to-thread wiring ~1 day. Spec recommended — the resume semantics need design.

---

## 8. Sequencing recommendation

Build in this order — earlier items unlock the patterns the later items reuse:

1. **B (cost meter)** — smallest, no spec, validates the per-conversation rollup pattern.
2. **C (suggested chips)** — establishes the message-extension pattern (`suggestedActions`) that E (`integrationCard`) reuses.
3. **A (thread context)** — biggest UX win. Spec required.
4. **D (invocations card)** — pure client refactor; can run alongside any of the above.
5. **E (inline integration card)** — last; depends on C's message-extension pattern.

A and E need short specs before implementation. B, C, D can go direct.

---

## 9. Estimated total effort

~6–8 working days for a single engineer if each item ships sequentially. Probably ~4–5 days if A and B are parallelised across two sessions.

---

## 10. What this brief does NOT decide

- Whether thread context is per-conversation or per-run (A).
- The exact suggested-action grammar the agent emits (C).
- Whether D's reorganisation is destructive or additive (D).
- OAuth return-to-thread resume semantics (E).
- Visual design — colours, iconography, exact typography — handled at implementation.

These are spec-level questions to answer when each item moves from brief → spec.
