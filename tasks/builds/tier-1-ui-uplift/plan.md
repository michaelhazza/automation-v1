# Tier 1 UI Uplift — Implementation Plan

**Status:** Plan finalised, pre-implementation.
**Date:** 2026-04-30.
**Source brief:** `tasks/brief-tier-1-ui-uplift.md` (read first; the brief is the substantive source of truth, this plan turns it into builder contracts).
**Source mockups:** `tasks/mockups/tier-1-ui-uplift.html` (user-approved design direction).
**Sequencing:** B → C → A → E → D.

---

## Contents

1. System invariants (cross-cutting, binding)
2. Architecture notes — key decisions per item
3. Chunk decomposition (overview)
4. Chunk B — Per-thread cost & token meter
5. Chunk C — Suggested next-action chips
6. Chunk A — Thread Context doc + plan checklist
7. Chunk E — Inline integration-setup card
8. Chunk D — Invocations card on the agent edit page
9. Risks & mitigations
10. Open questions
11. Deferred items
12. Executor notes

---

## 1. System invariants (cross-cutting, binding)

These are the six architectural invariants from `tasks/brief-tier-1-ui-uplift.md` §2, restated as implementation-binding rules. **Any chunk that violates one is blocked at review.** Where a chunk-level decision narrows an invariant, that narrowing is repeated in the chunk's "Acceptance criteria" section so it cannot be missed.

**I-1 — Thread Context is the only durable working state per conversation.**
- Single writer: the `update_thread_context` action handler invoked through `ACTION_REGISTRY` (Chunk A).
- Source of truth: the DB row in `conversation_thread_context`. Never reconstructed from messages or compacted history.
- LLM injection at compaction or run start is *display* of state, not its origin. Producing the injected system message and rendering the UI panel both call the same canonical read-projection function (`buildThreadContextReadModel`).
- A chunk that writes thread-context state via any path other than the registered handler is blocked.

**I-2 — All agent-initiated UI extensions are structured message metadata.**
- Suggested-action chips (C), inline integration cards (E), and any future agent-emitted UI element are columns on `agent_messages` (or a controlled JSONB sub-shape on the existing `tool_calls` / new `meta` column), never free-text parsed at render time.
- The wire format is reviewed and stable; new variants require a Zod schema change + a typed discriminated union update.
- A chunk that renders an agent-emitted UI element by string-matching message text is blocked.

**I-3 — The LLM never emits raw internal action slugs.**
- Agent outputs that trigger system actions go through a controlled enum. v1 introduces `SuggestedActionKey` (Chunk C). Future structured-message variants (e.g. integration cards in Chunk E) carry their action target via a typed field on a discriminated union, never as free-text the LLM minted.
- Mapping enum → handler happens server-side via `ACTION_REGISTRY` lookup or a small per-feature dispatch table — never via direct string match on LLM output.
- Unknown enum values are dropped at parse time, with a structured warn-log (`{ conversationId, runId, droppedKey }`).
- A chunk that wires the LLM straight into a handler by the LLM's own slug name is blocked.

**I-4 — All resumable executions are idempotent and versioned.**
- Any run that pauses for external action (Chunk E in this plan; future tiers may add more) MUST (a) issue exactly one resume token per block instance, (b) tolerate duplicate resume calls without re-executing side effects, (c) carry an explicit expiry timestamp.
- The resume token validates against an explicit `pre_state` predicate (`UPDATE … WHERE blocked_reason = 'integration_required' AND id = ?`). 0 rows updated = already resumed/expired/cancelled = caller gets a 410 Gone (conflict-on-state, not 500).
- A chunk that adds a new resumable transition without these three guarantees is blocked.

**I-5 — Cost aggregation is deterministic and tied to a stable scope.**
- A given `(conversation_id, model_id)` pair yields the same total regardless of when it's queried, holding the underlying `cost_aggregates` rows constant.
- **Canonical inclusion rule (defined once here, reused everywhere cost is shown):** *Count the cost of every run that produced at least one persisted `agent_messages` row whose `triggered_run_id` references that run, exactly once.* This is implemented as `SELECT DISTINCT triggered_run_id FROM agent_messages WHERE conversation_id = ? AND triggered_run_id IS NOT NULL`, then `JOIN cost_aggregates ON cost_aggregates.entity_type = 'run' AND cost_aggregates.entity_id = run.id::text` and `SUM`.
  - This handles partial retries: if Run A failed mid-flight but emitted a user-visible message, and Run B retried and succeeded, both runs' costs are counted (their messages exist on the thread).
  - This excludes silent-failure runs: a run that produced no `agent_messages` row is excluded, regardless of `agent_runs.status`.
  - Deduplication is via run-id linkage from the messages table — never via filtering on `agent_runs.status` directly.
- Every cost-rollup surface (Chunk B; future org/skill cost views) calls the same `conversationCostService.getConversationCost(conversationId, orgId)` function. Reimplementing the rollup elsewhere is blocked.

**I-6 — All cross-boundary events emit structured logs.**
- Every thread-context update, cost rollup, run state transition, resume event, suggested-action click, integration-card render, and integration-card dismiss emits a structured log record at `info` level minimum.
- Mandatory fields per record: `{ conversationId, runId?, state, action }`. Additional fields are encouraged (token count, dropped-key, expiry, dedup-hash) but the four above are the floor.
- A chunk that adds a new state transition without a structured log is blocked.

**I-7 — Every assistant message participating in cost rollup or UI extensions MUST carry `triggered_run_id`.**
- This is not yet enforced at the write layer (deferred to a follow-up hardening item in §11), but it is a named invariant so future code does not introduce violations unknowingly.
- Chunks B, C, A, and E all depend on `triggered_run_id` being present on assistant messages they query or emit. Any new assistant-message write path must set this field.
- A chunk that emits an assistant message with a null `triggered_run_id` in a context where a run is active is a bug, not a deferred item.

---

## 2. Architecture notes — key decisions per item

This section records the **non-obvious decisions** for each item. For each decision: the problem it solves, the option picked, the option(s) considered and rejected, and the linkage back to the invariants. Where the user's approved direction settles a question, that direction is stated as final and the alternative is listed only as historical context.

### 2.1 Item B — cost meter

**B-1. Run → conversation linkage = Option 2 (roll up via messages).**
- Problem: `agent_runs` has no `conversation_id` column today; no native join exists.
- Decision: query `agent_messages.triggered_run_id` for the conversation, dedupe distinct run IDs, JOIN to `cost_aggregates`. No schema change.
- Rejected:
  - *Option 1* — adding `conversation_id` to `agent_runs` and backfilling. Rejected because (a) many runs are not conversation-scoped (heartbeat / scheduled / webhook), (b) the column would be nullable for the majority, (c) backfilling is correctness-sensitive across run-source heuristics. Revisit if cost-by-conversation views proliferate beyond chat.
  - *Option 3* — `conversation_run_links` join table. Rejected as premature; many-to-many is not a v1 need.
- Linkage: I-5 cost-determinism rule is anchored on the message-JOIN approach.

**B-2. Combined input + output token count.**
- The header pill displays a single number `{tokenCount}` that is `totalTokensIn + totalTokensOut`. The expanded dropdown can split per model; the collapsed pill does not.
- Rejected: split-by-default. User-approved: combined.

**B-3. Permission scope: own-thread for non-admin, org-wide for admin.**
- The endpoint always scopes by `organisationId` (RLS-enforced).
- Additional check: a non-admin requesting a conversation owned by another user gets 403 (the existing `agent_conversations.user_id` check, already present on the conversation messages route).
- Org-wide cost views are NOT introduced in this chunk (deferred — see §11).

**B-4. Refresh strategy: on each new assistant message.**
- The client refetches `/api/agents/:agentId/conversations/:convId/cost` after every assistant message arrives via the existing `conversation:message` socket event. No polling.
- Tradeoff: a brief lag while `cost_aggregates` finishes its async rollup is acceptable; the pill can show stale-by-seconds and self-corrects on the next message.

**B-5. Linkage to brief invariant #5 (cost-determinism).**
- See §1, I-5. The exact SQL pattern is fixed in `conversationCostService` and is the single allowed read path. Any future cost surface (per-skill, per-agent, org rollup) calls the same function (or refactors it before adding a sibling surface). Two cost-rollup services in `server/services/` is an automatic review block.

### 2.2 Item C — suggested chips

**C-1. Storage: extend `agent_messages` with a typed `suggestedActions` JSONB column.**
- Schema migration adds `suggested_actions JSONB NULL` to `agent_messages`. Historical rows default to `null`; renderer treats `null` and `[]` interchangeably.
- Rejected: a separate `message_suggested_actions` table. Rejected because (a) chips are tightly coupled to their parent message lifetime, (b) querying them never happens cross-message, (c) a join adds latency for no benefit.

**C-2. Wire format: discriminated union, closed enum.**
- `kind: 'prompt'` carries free-text the agent wants pre-filled into the composer.
- `kind: 'system'` carries an `actionKey` from a closed `SuggestedActionKey` enum (initial v1 set: `save_thread_as_agent`, `schedule_daily`, `pin_skill`).
- Server validates the parsed shape against a Zod schema. Unknown enum values are **dropped at parse time** with a structured warn-log; the rest of the array is preserved.
- Linkage: I-3 (no raw slugs).

**C-3. Dispatch layer: `suggestedActionDispatchService` thin shim over `ACTION_REGISTRY`.**
- For each `SuggestedActionKey`, the dispatch service maps to a handler invocation. Where an `ACTION_REGISTRY` entry already exists (`save_thread_as_agent` → existing save-as-agent route), the dispatch delegates rather than duplicates.
- `pin_skill` and `schedule_daily` are wired to existing modal flows on the client; the server-side dispatch entry exists for telemetry parity but the actual mutation is the existing endpoint.
- Permission check happens at execute time, mirroring whichever surface owns the action today. The client may pre-check and render a disabled chip; the server still re-checks.

**C-4. Chip placement: only on the most recent assistant message.**
- Historical messages do not render chips, even if their `suggestedActions` column is populated.
- Renders only if the agent emits ≥1 chip; max 4 chips. Empty array = no row.

**C-5. Chip click semantics:**
- `kind: 'prompt'` → fills the composer with `prompt`, focuses it, does NOT auto-send. The user can edit before sending. (Aligns with HyperAgent reference.)
- `kind: 'system'` → calls a lightweight client handler that POSTs to the dispatch endpoint, which routes to the registered handler. UI shows pending → success/error inline.

### 2.3 Item A — Thread Context

**A-1. New table `conversation_thread_context`, 1:1 with `agent_conversations.id`.**
- Rejected: extending `agent_conversations` with three JSONB columns. Rejected because (a) `conversation_thread_context` has its own version counter and update cadence, (b) we expect to add per-section update timestamps and possibly a write-history table later — keeping it isolated avoids polluting the conversations row, (c) the brief explicitly calls for a separate primitive ("a new `conversation_context` record keyed by conversation id").
- Linkage: I-1 — this row is the source of truth.

**A-2. Patch-op semantics, not blob overwrites.**
- The `update_thread_context` tool accepts a typed `ThreadContextPatch` (per-section add/update/remove/replace). The handler applies the patch in-place, bumps `version`, returns the new version + the IDs of any newly-created tasks/decisions.
- Rejected: full-document replace. Rejected because a single missing field in a "rewrite" call would silently delete state.
- Concurrency model: last-write-wins on each individual patch op. No optimistic-concurrency rejection in v1 (intra-run is sequential by construction; cross-run races are rare and lost updates are acceptable for v1 with `version` bumped on every write so we can detect them after the fact).

**A-3. Server-generated IDs for tasks and decisions.**
- The agent supplies a `clientRefId` for de-duplication within a single tool call. The server generates the canonical ID (UUID) and returns the mapping in the tool response.
- Subsequent ops (`updateStatus`, `remove`) reference the canonical server ID. The agent cannot mint canonical IDs.
- Linkage: prevents the agent from re-using stale IDs across runs.

**A-4. Single canonical read projection.**
- One server function — `buildThreadContextReadModel(conversationId, orgId)` — produces the projection used by both LLM injection and the UI panel. Both call sites read this function; neither constructs a parallel projection.
- Pruning rules (deterministic, order-stable):
  - Completed tasks: oldest-completedAt first, when total task count > 50.
  - Decisions: never auto-pruned (cap 100 enforced at write time → reject the patch op).
  - Approach: max 10,000 characters; never silently truncated — rejected with `APPROACH_TOO_LONG` if the cap would be exceeded. Only fully replaced via `approach.replace`.
- Linkage: I-1 ("system message at compaction is display of state, not origin").

**A-5. Read-only in v1 (user does not edit).**
- The UI panel renders the three sections. No edit affordance. A `version` is exposed for debugging only.
- Future tier: user-editable tasks would add a second writer; v1 sidesteps this entirely.

**A-6. Live updates via existing socket room.**
- `useSocketRoom('conversation', activeConvId, …)` is already subscribed. The server emits a new event `conversation:thread_context_updated` carrying the new read model after every successful patch. Client replaces local state on receipt.

**A-7. Live badge + completed-above-pending ordering (user-approved UX).**
- The Context tab shows a green dot when at least one run for the conversation is in `running`/`pending`/`delegated` status (live count from existing run-state data).
- Tasks list ordering: completed tasks above pending, completed sorted by most-recently-done, pending sorted by oldest-added.
- An in-progress task pulses while a run is active.

### 2.4 Item E — inline integration card

**E-1. Parallel `blocked_reason` + `integration_resume_token` columns; status enum NOT extended.**
- User-approved direction: lower-risk schema change.
- New columns on `agent_runs`: `blocked_reason TEXT NULL`, `blocked_expires_at TIMESTAMPTZ NULL`, `integration_resume_token TEXT NULL`, `integration_dedup_key TEXT NULL`.
- The existing `status` column stays as-is. The `running` value is reused while `blocked_reason` is set.
- Rejected: extending the `status` enum with `blocked_on_integration`. Rejected because (a) the brief's verified direction is parallel column for lower risk, (b) a status-enum change ripples into every consumer that switch-cases on status (workspace health, dashboards, terminal-state computations), (c) the parallel column is independently nullable and easier to roll forward/back.
- The existing `resumeToken` payload (in `agent_run_snapshots.checkpoint.resumeToken`) is **NOT reused** — those are SHA-256 hashes of `runId:iteration` for crash-recovery checkpointing. We introduce a separate `integration_resume_token` column with its own generation policy and lifecycle.

**E-2. `blocked_reason` is a repeatable state; each block carries a monotonic `blockSequence`.**
- A run may transition into and out of `blocked_reason = 'integration_required'` multiple times (Notion → Slack → success). Each block increments `runMetadata.currentBlockSequence` (starting at 1) before issuing the token.
- Each block:
  - Increments `runMetadata.currentBlockSequence`.
  - Sets `blocked_reason = 'integration_required'`, `blocked_expires_at = now() + 24h`, `integration_resume_token = sha256(plaintextToken)`, `integration_dedup_key = sha256(toolName + stableStringify(toolArgs) + integrationId)`.
  - Persists `runMetadata.currentBlockSequence` alongside the token so the resume path can validate it.
  - `integration_dedup_key` is deterministic given the same logical block — retries of the same blocked tool call produce the same key, enabling safe re-execution on resume.
  - Emits one `integration_card` message (carrying `blockSequence`) into the conversation.
- Each resume:
  - Appends `runMetadata.currentBlockSequence` to `runMetadata.completedBlockSequences`.
  - Clears `blocked_reason`, `blocked_expires_at`, `integration_resume_token` to NULL.
  - Continues run execution. The `integration_dedup_key` of the *just-completed* block stays in `runMetadata` for audit/dedup.
- Linkage: I-4 — repeatable, idempotent, versioned per block.

**E-3. Resume = re-execute the blocked tool call (Option B / safe-to-retry marker).**
- The blocked tool call's args are persisted on `runMetadata.blockedToolCall`. On resume, the executor inspects `ACTION_REGISTRY[toolName].idempotencyStrategy`:
  - `read_only` → re-execute unconditionally.
  - `keyed_write` → re-execute, passing `integration_dedup_key` as the idempotency key.
  - `locked` → acquire pg advisory lock keyed on `integration_dedup_key`, then re-execute.
- Rejected: *Option A* (always-store dedup key on the tool call). Rejected because B reuses the existing `idempotencyStrategy` field already declared on every action — no schema additions on the registry side.

**E-4. OAuth popup, not same-tab redirect.**
- The card's `actionUrl` opens via `window.open(url, 'oauth_popup', '...')`. On success the popup `postMessage`s `{ type: 'oauth_success', resumeToken }` to its opener; the opener calls `POST /api/agent-runs/resume-from-integration` with the token.
- The same-tab redirect option is rejected because it loses chat scroll position and forces a full page reload.

**E-5. TTL = 24 hours, fixed.**
- 24h is the v1 default; per-integration override is deferred.
- On expiry: a one-shot job (or just-in-time check on the next read) transitions the run to `status = 'cancelled'`, sets `runResultStatus = 'failed'`, leaves `blocked_reason = 'integration_required'` until the cancellation transition runs (so the audit trail reads coherently).
- The card's "Try again" CTA on an expired card creates a **new run** (not a resume).

**E-6. Run status terminal model — `cancelled` covers integration timeouts.**
- The existing `cancelled` status (already on `agent_runs.status`) is the terminal target for TTL-expired blocks. We add a discriminator on `runMetadata.cancelReason = 'integration_connect_timeout'` so dashboards can distinguish operator-cancel from TTL-cancel.
- Rejected: introducing a new `failed` substatus. The brief explicitly distinguishes "deliberate terminal" (cancelled) from "unexpected execution error" (failed).

**E-7. A + E interaction — re-read Thread Context on resume.**
- On resume, the executor re-injects the current `buildThreadContextReadModel(conversationId, orgId)` output as a system message before handing control to the LLM. This is the same injection mechanism used at run start.
- This matters only if Thread Context was actively written during the pause; v1 makes it unconditional because the cost (one extra system-message tokens) is bounded and the bug if we skip it is silent prompt drift.

### 2.5 Item D — invocations card

**D-1. Tile grid as default collapsed view, click expands in-place (user-approved).**
- Six tiles, fixed order: Scheduled, Webhook, Slack, Email, SMS (visual stub), MCP (visual stub).
- Clicking a tile transitions it to an expanded accordion row with the existing config UI inline. Other tiles collapse.
- Rejected: a sit-on-top card with all configs visible. Rejected because it doesn't meaningfully reduce surface area.

**D-2. Replaces scattered sections (does not sit on top of them).**
- The existing Heartbeat section (line ~1413 of `AdminAgentEditPage.tsx`) and any Slack/email/webhook config sections are removed from their current locations. Their UI moves verbatim into the corresponding accordion row.
- Rejected: keeping both. Rejected because it leaves the user with two truths and contradicts the brief.

**D-3. "Active" definition for Slack = channel count.**
- "Slack — Active · 3 channels" pulls the count of distinct Slack channels the agent appears in (`slack_conversations` rows or equivalent). Recent activity is NOT used as the signal; channel-presence is the v1 definition.

**D-4. SMS and MCP are visual stubs (not clickable).**
- Tiles render with a "Soon" badge and `cursor: not-allowed`. No click handler, no expansion.
- Rejected: "Notify me when available" CTA. Rejected because no email-capture infrastructure exists for this; v1 is visual only.

**D-5. Pure client refactor — no server changes for D.**
- Every existing config endpoint stays as-is. The new `InvocationsCard` component composes existing form sections.
- Linkage: D has no inter-item dependency; it can ship any time after B settles (because the Manage button on the chat header lives next to the cost pill from B).

---

## 3. Chunk decomposition (overview)

| # | Chunk | Sub-chunks | Depends on | Independently testable? |
|---|-------|------------|------------|-------------------------|
| 1 | **B — Cost meter** | B.1 service + endpoint, B.2 client header pill + dropdown | none | yes |
| 2 | **C — Suggested chips** | C.1 schema + parser + dispatch, C.2 client render + handlers | none (parallel to B) | yes |
| 3 | **A — Thread Context** | A.1 schema + read projection, A.2 update tool + handler, A.3 client panel + socket | C (reuses message-extension pattern); B (proves cost-determinism approach) | yes |
| 4 | **E — Inline integration card** | E.1 schema + state machine, E.2 executor branch + token issue, E.3 resume service + OAuth wiring, E.4 client card + states | A (re-read thread context on resume); C (message-extension pattern + actionKey enum) | yes |
| 5 | **D — Invocations card** | single chunk | B (header coexistence proven) — but no code dependency | yes |

Order is fixed by the brief §9. Each chunk lands as one PR (sub-chunks may land as commits within the PR, or as sequential PRs at the executor's discretion if a sub-chunk grows). Forward-only dependency graph: no chunk references state created by a later chunk.

---

## 4. Chunk B — Per-thread cost & token meter

### 4.1 Scope

What this chunk does:
- Adds a server endpoint `GET /api/agents/:agentId/conversations/:convId/cost` that returns the canonical conversation cost rollup.
- Adds a `conversationCostService` containing the single allowed read path defined in I-5.
- Adds a header pill in `AgentChatPage` showing `{tokenCount} · ${cost}` next to the model tag.
- Adds an expandable dropdown showing per-model breakdown.
- Refetches cost on each new assistant message via the existing socket event.

What this chunk does NOT do:
- Org-wide cost views (deferred — §11).
- Per-skill cost views (deferred — §11).
- Splitting tokens-in vs tokens-out in the collapsed pill (combined per user direction).
- Adding `conversation_id` to `agent_runs` (rejected — see §2.1 B-1).
- Backfilling cost for historical runs (data is already present in `cost_aggregates`; no backfill needed).

### 4.2 Files to create or modify

**Create:**
- `server/services/conversationCostService.ts` — single read function, the only allowed implementation of I-5's rule.
- `server/services/__tests__/conversationCostServicePure.test.ts` — pure unit test covering: (a) the message-JOIN dedup, (b) silent-failure exclusion, (c) partial-retry inclusion.
- `client/src/components/CostMeterPill.tsx` — collapsed pill + expand-dropdown component.
- `client/src/lib/formatCost.ts` — shared formatter (`164.5k`, `$4.07`).
- `client/src/lib/__tests__/formatCostPure.test.ts` — pure unit test for the formatter edge cases (zero, sub-cent, 1M+).

**Modify:**
- `server/routes/agents.ts` — register the new GET handler near the existing conversation routes (line ~225 area).
- `shared/types/conversationCost.ts` — new file exporting `ConversationCostResponse`. (Adjacent to the existing `shared/types/runCost.ts`.)
- `client/src/pages/AgentChatPage.tsx` — render the pill in the header (line ~383 area), call the new endpoint, refetch on `conversation:message` socket event.

### 4.3 Contracts

**TypeScript — `shared/types/conversationCost.ts`:**

```ts
export interface ConversationCostModelBreakdown {
  modelId: string;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  runCount: number;
}

export interface ConversationCostResponse {
  conversationId: string;
  totalCostCents: number;     // sum across all included runs
  totalTokensIn: number;      // sum across all included runs
  totalTokensOut: number;     // sum across all included runs
  totalTokens: number;        // totalTokensIn + totalTokensOut, computed once server-side
  runCount: number;           // distinct runs that produced ≥1 user-visible message in this conversation
  modelBreakdown: ConversationCostModelBreakdown[]; // at least one entry per model that contributed cost
  computedAt: string;         // ISO timestamp; clients use this as a cache key
}
```

**SQL — the canonical query (pinned here, do not reimplement elsewhere):**

```sql
WITH run_ids AS (
  SELECT DISTINCT triggered_run_id AS run_id
  FROM agent_messages
  WHERE conversation_id = $1 AND triggered_run_id IS NOT NULL
)
SELECT
  ar.id AS run_id,
  a.model_id AS model_id,           -- agents.model_id via ar.agent_id FK
  ca.total_cost_cents,
  ca.total_tokens_in,
  ca.total_tokens_out
FROM run_ids ri
JOIN agent_runs ar ON ar.id = ri.run_id
JOIN agents a ON a.id = ar.agent_id
LEFT JOIN cost_aggregates ca
  ON ca.entity_type = 'run' AND ca.entity_id = ar.id::text AND ca.period_type = 'run'
WHERE ar.organisation_id = $2;
```

Aggregation (summing into `ConversationCostResponse`) happens in-service after the query returns. Runs with no `cost_aggregates` row contribute zero (LEFT JOIN). `model_id` is resolved via `agents.model_id` — confirmed 2026-04-30: `configSnapshot` does not store the model (it contains `{ tokenBudget, maxToolCalls, timeoutMs, skillSlugs, customInstructions, executionScope }` only). Resolves §10.1. The `modelBreakdown` array is sorted `ORDER BY costCents DESC` before returning, so the highest-cost model always appears first. This produces stable UI rendering across calls and avoids client-side sort ambiguity.

**Route shape:**
- Method: `GET`
- Path: `/api/agents/:agentId/conversations/:convId/cost`
- Auth: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)` (mirrors the existing message read route)
- Path validation: existing conversation-ownership check (the conversation row's `userId` matches `req.user.id` unless caller is org_admin/system_admin)
- Response: `200 OK` with `ConversationCostResponse`
- Errors: `404` if conversation not found; `403` if conversation belongs to a different user and caller is not admin; `500` on unexpected DB error (asyncHandler default)

### 4.4 Error handling

- Service throws `{ statusCode: 404, message: 'Conversation not found', errorCode: 'CONVERSATION_NOT_FOUND' }` if the conversation row doesn't exist or doesn't match the orgId.
- Service throws `{ statusCode: 403, message: 'Forbidden', errorCode: 'FORBIDDEN' }` if the caller is non-admin and the conversation `user_id` doesn't match.
- Service does NOT throw for "no cost data yet" — returns zeros. Cost rollup is async; the first few seconds of a new conversation legitimately return zeros.

### 4.5 Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/conversationCostServicePure.test.ts`
- `npx tsx client/src/lib/__tests__/formatCostPure.test.ts`

### 4.6 Acceptance criteria

- The pill renders next to `agent.modelId` in the chat header, monospace, format `{tokenCount} · ${cost}`. Numbers update visibly within ~2s of an assistant message arriving.
- Clicking the pill opens a small dropdown listing each model that contributed cost, with cost bars proportional to share of total.
- Two runs in the same conversation both producing user-visible messages (one originally-failed-then-retried, one straight success) — both costs appear in the rollup. Verified via the unit test.
- A run that produced no user-visible message (silent failure) does NOT appear in the rollup. Verified via the unit test.
- A non-admin user requesting `/cost` for a conversation owned by another user receives `403` with `errorCode: 'FORBIDDEN'`.
- A second cost-rollup implementation does not appear anywhere in `server/`. Reviewer greps for `triggered_run_id` + cost JOIN; only `conversationCostService.ts` matches.
- Structured log line on each cost call: `{ conversationId, runCount, totalCostCents, totalTokens, action: 'conversation_cost_computed' }` (I-6).

### 4.7 Dependencies

- None. B is the first chunk in the build sequence.

---

## 5. Chunk C — Suggested next-action chips

### 5.1 Scope

What this chunk does:
- Adds a `suggestedActions` JSONB column to `agent_messages`.
- Defines the `SuggestedAction` discriminated union and the `SuggestedActionKey` closed enum.
- Adds a parser in `agentExecutionService` that extracts the suggestions from the agent's terminal turn output and validates them.
- Adds a thin server-side `suggestedActionDispatchService` that maps `SuggestedActionKey` → handler invocation (delegating to existing routes/handlers where present).
- Renders chips in `AgentChatPage` only on the most recent assistant message.
- Pre-fills composer (prompt chips) or fires dispatch endpoint (system chips).
- Disables chips that fail a client-side permission pre-check.

What this chunk does NOT do:
- Add new system-level actions beyond the v1 `SuggestedActionKey` set (`save_thread_as_agent`, `schedule_daily`, `pin_skill`).
- Render chips on historical messages (only the latest assistant message renders chips).
- Backfill `suggestedActions` for existing messages (column is nullable; historical rows = `null`).
- Auto-send on prompt-chip click (the user must press Send; this matches the HyperAgent reference).

### 5.2 Files to create or modify

**Create:**
- `server/db/migrations/<n>_message_suggested_actions.sql` — adds `suggested_actions JSONB NULL` to `agent_messages`.
- `shared/types/messageSuggestedActions.ts` — `SuggestedAction`, `SuggestedActionKey`, Zod schema, drop-unknown parser.
- `server/services/suggestedActionDispatchService.ts` — `dispatch({ actionKey, conversationId, runId, userId, orgId })` returns `{ success: true }` or throws `{ statusCode, message, errorCode }`.
- `server/services/__tests__/suggestedActionsPure.test.ts` — Zod parse, drop-unknown behaviour, dispatch routing matrix.
- `client/src/components/SuggestedActionChips.tsx` — chip row, prompt vs system styling, click handlers.
- `server/routes/suggestedActions.ts` — `POST /api/agents/:agentId/conversations/:convId/messages/:messageId/dispatch-action`.

**Modify:**
- `server/db/schema/agentMessages.ts` — add `suggestedActions` column declaration.
- `server/services/agentExecutionService.ts` — after the agent's final assistant message is generated, parse the terminal turn for suggestions, strip them from the visible content, persist on the message row.
- `server/index.ts` (or the route-mounting file) — mount the new dispatch route.
- `client/src/pages/AgentChatPage.tsx` — render `<SuggestedActionChips />` above the composer for the most recent assistant message; wire prompt-fill and dispatch handlers.

### 5.3 Contracts

**TypeScript — `shared/types/messageSuggestedActions.ts`:**

```ts
import { z } from 'zod';

export const SUGGESTED_ACTION_KEYS = [
  'save_thread_as_agent',
  'schedule_daily',
  'pin_skill',
] as const;

export type SuggestedActionKey = typeof SUGGESTED_ACTION_KEYS[number];

export const suggestedActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prompt'),
    label: z.string().min(1).max(80),
    prompt: z.string().min(1).max(2000),
  }),
  z.object({
    kind: z.literal('system'),
    label: z.string().min(1).max(80),
    actionKey: z.enum(SUGGESTED_ACTION_KEYS),
  }),
]);

export type SuggestedAction = z.infer<typeof suggestedActionSchema>;

export const suggestedActionsArraySchema = z.array(suggestedActionSchema).max(4);

/**
 * Parse an unknown value into a valid SuggestedAction[] — drops invalid
 * entries with a structured warn-log (caller passes the logger). Never
 * throws on malformed input. Empty array is valid; null is valid (no row).
 */
export function parseSuggestedActions(
  raw: unknown,
  logCtx: { conversationId: string; runId: string }
): SuggestedAction[];
```

**Drizzle — `agent_messages.suggested_actions`:**

```ts
suggestedActions: jsonb('suggested_actions').$type<SuggestedAction[] | null>(),
```

**Migration sketch (the executor writes the canonical Drizzle migration):**

```sql
ALTER TABLE agent_messages
  ADD COLUMN suggested_actions JSONB NULL;
COMMENT ON COLUMN agent_messages.suggested_actions IS
  'Optional structured chip metadata emitted by the agent on terminal turns; null or [] = no chips. See shared/types/messageSuggestedActions.ts';
```

No new index is needed; chips are read alongside the message row already.

**Route shape — dispatch:**
- Method: `POST`
- Path: `/api/agents/:agentId/conversations/:convId/messages/:messageId/dispatch-action`
- Auth: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)`
- Body (Zod-validated):
  ```ts
  { actionKey: SuggestedActionKey }
  ```
- Response: `200 OK` with `{ success: true, dispatchedActionKey: SuggestedActionKey, redirectUrl?: string }` (some actions may return a redirect target — e.g. `pin_skill` → skill picker URL).
- Errors:
  - `400 INVALID_ACTION_KEY` if `actionKey` not in enum.
  - `403 FORBIDDEN` if the underlying delegated handler's permission check fails.
  - `404 NOT_FOUND` if conversation/message not found.
  - `409 ACTION_NOT_AVAILABLE` if the action's preconditions aren't met (e.g. `pin_skill` on a thread with no skills used).

### 5.4 Error handling

- Parser drops invalid entries and emits one structured log per drop: `{ conversationId, runId, droppedKey: <key|'malformed'>, action: 'suggested_action_dropped' }` (I-3, I-6).
- Dispatch service catches the underlying handler's errors and re-throws shaped: `{ statusCode, message, errorCode }`. The caller receives the underlying handler's status code with a wrapped message.
- Permission failure on dispatch returns 403; client renders inline error inside the chip row.

### 5.5 Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify migration file is generated and named correctly
- `npm run build:client`
- `npx tsx server/services/__tests__/suggestedActionsPure.test.ts`

### 5.6 Acceptance criteria

- A new assistant message that emits 3 valid chips renders 3 chips above the composer; the message row in DB has `suggested_actions` populated.
- A new assistant message that emits 0 chips renders nothing — no empty row, no spacer.
- A chip emitting an unknown `actionKey` is dropped at parse; valid sibling chips on the same message render.
- Prompt-chip click fills the composer with the chip's `prompt`, focuses the textarea, does NOT auto-send.
- System-chip click POSTs to `/dispatch-action`, shows pending → success/error inline.
- Historical assistant messages older than the most recent never render chips, even if the column is populated.
- Disabled chips render visually (opacity 60%, `cursor: not-allowed`) when the client pre-check fails. The server still enforces on click.
- Migration is idempotent (`ADD COLUMN` is no-op on second run via Drizzle's hash-tracking).
- Style: prompt chips white/slate; system chips indigo-tinted (per user-approved direction).

### 5.7 Dependencies

- None at the schema level (parallel to B).
- The executor may run B and C in either order; brief §9 places C after B because B locks down the cost-determinism rule, but C has no code dependency on B. Run them sequentially anyway to keep the review surface small per PR.

---

## 6. Chunk A — Thread Context doc + plan checklist

### 6.1 Scope

What this chunk does:
- Introduces `conversation_thread_context` — a new tenant-scoped table, 1:1 with `agent_conversations.id`.
- Adds an `update_thread_context` action handler registered in `ACTION_REGISTRY` with patch-op semantics.
- Adds `buildThreadContextReadModel(conversationId, orgId)` — the **single** canonical read projection for both LLM injection and UI rendering.
- Adds a Context tab to the existing right pane in `AgentChatPage`, alongside the existing Hierarchy tab.
- Wires live updates via the existing `useSocketRoom('conversation', …)` channel with a new event `conversation:thread_context_updated`.

What this chunk does NOT do:
- Allow the user to edit tasks/decisions directly (read-only in v1).
- Implement compaction (no compaction code exists today; see §11 deferred).
- Add per-section update history (only `updatedAt` and `version`; full history deferred).
- Change `AgentRunHandoff` semantics — the per-run terminal handoff is unchanged; thread context is a sibling primitive.

### 6.2 Files to create or modify

**Create:**
- `server/db/migrations/<n>_conversation_thread_context.sql` — new table + RLS policy + manifest entry.
- `server/db/schema/conversationThreadContext.ts` — Drizzle table.
- `shared/types/conversationThreadContext.ts` — `ThreadContextDecision`, `ThreadContextTask`, `ThreadContextPatch`, `ThreadContextReadModel`, all Zod schemas.
- `server/services/conversationThreadContextService.ts` — patch application, version bumping, prune, returns updated read model.
- `server/services/conversationThreadContextServicePure.ts` — pure functions for patch application + prune, fully unit-tested.
- `server/services/__tests__/conversationThreadContextServicePure.test.ts` — patch-op coverage including no-op patches, multi-op patches, prune at cap, version bump determinism, ID generation idempotence (via `clientRefId`).
- `server/actions/updateThreadContext.ts` — handler exported and registered in `ACTION_REGISTRY` (`actionType: 'update_thread_context'`, `idempotencyStrategy: 'keyed_write'` keyed on `runId + version`).
- `server/routes/conversationThreadContext.ts` — `GET /api/agents/:agentId/conversations/:convId/thread-context` returns the read model. (Read-only; no PATCH route in v1 — only the LLM tool path writes.)
- `client/src/components/ThreadContextPanel.tsx` — three sections (Tasks, Approach, Decisions), live badge, completed-above-pending ordering.
- `server/config/rlsProtectedTables.ts` — add the new table to the manifest (existing pattern).

**Modify:**
- `server/config/actionRegistry.ts` — register `update_thread_context` with `idempotencyStrategy: 'keyed_write'`, `readPath: 'none'`, `actionCategory: 'worker'`, parameter schema = `ThreadContextPatch`.
- `server/services/agentExecutionService.ts` — at run start AND at resume time (Chunk E will use this), inject `buildThreadContextReadModel(conversationId)` as a system message before the LLM continuation. At run start, capture the read model's `version` field into `runMetadata.threadContextVersionAtStart`. Also surface the `update_thread_context` tool in the run trace so debugging is unblocked.
- `client/src/pages/AgentChatPage.tsx` — add Context tab toggle to the right pane; render `<ThreadContextPanel />` when active.
- `server/services/socketBroadcaster.ts` (or whichever service owns `conversation:*` emissions) — emit `conversation:thread_context_updated` after every successful patch.

### 6.3 Contracts

**Drizzle table — `conversation_thread_context`:**

```ts
export const conversationThreadContext = pgTable(
  'conversation_thread_context',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').notNull().unique()
      .references(() => agentConversations.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    decisions: jsonb('decisions').$type<ThreadContextDecision[]>().notNull().default([]),
    tasks: jsonb('tasks').$type<ThreadContextTask[]>().notNull().default([]),
    approach: text('approach').notNull().default(''),  // markdown, may be empty
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('conv_thread_ctx_org_idx').on(table.organisationId),
    conversationUniq: uniqueIndex('conv_thread_ctx_conv_uniq').on(table.conversationId),
  })
);
```

**TypeScript — `shared/types/conversationThreadContext.ts`:**

```ts
export type TaskStatus = 'pending' | 'in_progress' | 'done';

export interface ThreadContextDecision {
  id: string;          // server-generated
  decision: string;    // ≤ 500 chars
  rationale: string;   // ≤ 1500 chars
  addedAt: string;     // ISO
}

export interface ThreadContextTask {
  id: string;          // server-generated
  label: string;       // ≤ 200 chars
  status: TaskStatus;
  addedAt: string;     // ISO
  updatedAt: string;   // ISO; equals addedAt on creation
  completedAt: string | null;  // set when status transitions to 'done'
}

export interface ThreadContextPatch {
  decisions?: {
    add?: Array<{ clientRefId?: string; decision: string; rationale: string }>;
    remove?: string[];                // canonical IDs
  };
  tasks?: {
    add?: Array<{ clientRefId?: string; label: string }>;
    updateStatus?: Array<{ id: string; status: TaskStatus }>;
    remove?: string[];                // canonical IDs
  };
  approach?: { replace?: string; appendNote?: string };
}

export interface ThreadContextPatchResult {
  version: number;
  createdIds: Record<string, string>; // clientRefId → server ID
  readModel: ThreadContextReadModel;
}

export interface ThreadContextReadModel {
  decisions: string[];       // "<decision>: <rationale>" flattened for LLM
  approach: string;          // verbatim markdown
  openTasks: string[];       // labels of pending + in_progress
  completedTasks: string[];  // labels of done, oldest-completed last (post-prune cap)
  version: number;
  updatedAt: string;
}
```

**Caps (deterministic, fixed in v1):**
- 50 total tasks (open + completed). When cap exceeded, the oldest `completedAt`-stamped task is removed first; if no completed tasks exist, the patch is rejected with `errorCode: 'TASK_CAP_REACHED'`.
- 100 total decisions. When cap exceeded, the patch is rejected with `errorCode: 'DECISION_CAP_REACHED'` (decisions are never auto-pruned per A-4).
- Approach = max 10,000 characters. `approach.replace` or `approach.appendNote` that would push the total over the cap is rejected with `errorCode: 'APPROACH_TOO_LONG'`. A structured log line is emitted on every rejection: `{ conversationId, runId, action: 'approach_cap_rejected', currentLength, attemptedLength }`. The agent must issue a `replace` with a shorter value.

**Source-of-truth precedence:**
- The DB row (`conversation_thread_context`) is canonical.
- The system-message injection is *display* of state. If two sources disagree, the DB wins; the renderer/injector is buggy and must be fixed.

**Read projection contract:**
- One server function: `buildThreadContextReadModel(conversationId, orgId): Promise<ThreadContextReadModel>`.
- Invariant: given the same DB state, the same read model is produced regardless of caller, call order, or time.
- Both LLM injection (server-side) and UI panel (via `GET /thread-context`) call this function. No parallel projections.

**Route shape — read:**
- Method: `GET`
- Path: `/api/agents/:agentId/conversations/:convId/thread-context`
- Auth: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)`
- Response: `200 OK` with `ThreadContextReadModel`. Returns an "empty" read model (zero version, empty arrays, empty approach) if no row exists yet — never 404.
- Errors: `403` if the conversation belongs to a different user and caller is non-admin; `404` only if the conversation itself doesn't exist.

**Action handler — `update_thread_context` (LLM tool, not HTTP):**
- Registered in `ACTION_REGISTRY` with:
  - `actionType: 'update_thread_context'`
  - `actionCategory: 'worker'`
  - `idempotencyStrategy: 'keyed_write'` (idempotency key = `${runId}:${sha256(normalizePatch(patch))}`; same normalized patch in the same run = no-op; see §6.5 for normalization rules)
  - `readPath: 'none'`
  - `parameterSchema` = the Zod schema for `ThreadContextPatch`
- Handler signature: `(input: ThreadContextPatch, ctx: { conversationId, runId, orgId, subaccountId }) → Promise<ThreadContextPatchResult>`.
- Throws `{ statusCode: 400, message, errorCode: 'INVALID_PATCH' }` for malformed patches; `{ 409, errorCode: 'TASK_CAP_REACHED' }` etc. for cap violations.

### 6.4 Permissions / RLS checklist

- [x] **RLS policy** in the same migration. Three-layer policy (`organisation_id = app.organisation_id`).
- [x] **Manifest entry** in `server/config/rlsProtectedTables.ts`.
- [x] **Route guard** — the `GET /thread-context` route uses `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)`.
- [x] **Principal-scoped context** — the action handler runs inside an agent execution context which already establishes principal-scoped RLS. The handler service calls go through `withOrgTx(organisationId, …)`.

### 6.5 Execution-safety contracts (per Section 10 of the authoring checklist)

- **Idempotency posture:** `keyed_write` with key = `${runId}:${sha256(normalizePatch(patch))}`. `normalizePatch` produces a canonical representation before hashing: sort all arrays (`decisions.add`, `decisions.remove`, `tasks.add`, `tasks.updateStatus`, `tasks.remove`) by a stable key (label/id alphabetically), and strip `clientRefId` from the hash input (it is a per-call hint, not part of the logical operation). This ensures a retry that reorders array elements produces the same hash. A retry of the same normalized patch in the same run is a no-op. Different patches in the same run produce sequential version bumps.
- **Retry classification:** `guarded` — the handler is idempotent under the dedup key; pg-boss retries are safe.
- **Concurrency guard:** patch application is wrapped in `BEGIN; SELECT … FOR UPDATE; UPDATE … WHERE id = ? AND version = ?; COMMIT;`. The optimistic predicate uses the version snapshot read at the start of the patch. 0 rows updated = lost race; the loser bumps version and retries once. Two retries with no progress = throw `{ 409, errorCode: 'CONCURRENT_PATCH_FAILURE' }` (the agent loop tolerates this).
- **Terminal event guarantee:** `update_thread_context` is not a state-machine transition; no terminal event applies.
- **Unique-constraint mapping:** the unique index on `conversation_id` is hit only on row-creation race. The handler does `INSERT … ON CONFLICT (conversation_id) DO NOTHING` followed by an `UPDATE`; no `23505` ever bubbles to the caller.

### 6.6 Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify migration file
- `npm run build:client`
- `npx tsx server/services/__tests__/conversationThreadContextServicePure.test.ts`

### 6.7 Acceptance criteria

- The Context tab appears in the right pane next to Hierarchy. Clicking it renders three sections (Tasks, Approach, Decisions). On a brand-new conversation, all three are empty placeholder states.
- Live badge: a green dot appears when ≥1 run for the conversation is in `pending|running|delegated`. The dot disappears within ~2s of all runs reaching terminal status.
- Tasks list ordering: completed tasks above pending; completed sorted by `completedAt` desc; pending sorted by `addedAt` asc.
- An in-progress task pulses (CSS animation) while a run is active; the pulse stops when no run is active.
- Calling `update_thread_context` with `{ tasks: { add: [{ clientRefId: 'abc', label: '…' }] } }` returns the new server-generated ID and bumps `version` by 1.
- Calling `update_thread_context` twice with the **same patch** in the same run = no version drift (idempotency key dedups). Verified via unit test.
- Calling `update_thread_context` with a remove of a non-existent ID does NOT throw (silent no-op; the patch op is "best-effort" per agent-friendliness). The structured log records the no-op.
- A pruning operation that removes the oldest completed task fires when the 51st task is added; deterministic, verified via unit test.
- A 101st decision is rejected with `errorCode: 'DECISION_CAP_REACHED'`; agent receives the error and may issue a `remove` patch on a stale decision.
- The LLM injection at run start and the UI panel both display the same content (verified by reading the response of `/thread-context` and grepping the run's system-prompt snapshot).
- Structured log on every patch: `{ conversationId, runId, version, action: 'thread_context_patched', opsApplied: { decisionsAdded, decisionsRemoved, tasksAdded, tasksUpdated, tasksRemoved, approachReplaced, approachAppended } }` (I-1, I-6).
- The `update_thread_context` tool call appears in the run trace pane (existing trace surface) labelled with the patch summary.

### 6.8 Dependencies

- C — reuses the message-extension and ACTION_REGISTRY-dispatch patterns for the action-handler registration.
- B — proves out the conversation-cost rollup approach which informs the read-projection caching policy here (no caching needed; reads are cheap).

---

## 7. Chunk E — Inline integration-setup card

### 7.1 Scope

What this chunk does:
- Adds four columns to `agent_runs` for the blocked-on-integration state: `blocked_reason`, `blocked_expires_at`, `integration_resume_token`, `integration_dedup_key`.
- Adds an `integration_card` content variant on `agent_messages` (typed JSONB sub-shape, per I-2).
- Adds an executor branch in `agentExecutionService.ts` that recognises a tool call requiring a missing integration, transitions the run to "blocked", emits the integration card message, and persists the blocked tool call on `runMetadata`.
- Adds an `agentResumeService` (or extends the existing one) with a single `resumeFromIntegrationConnect(resumeToken)` entrypoint that is idempotent under the optimistic-state predicate.
- Wires the OAuth callback path (`server/routes/oauthIntegrations.ts`) to call the resume endpoint when both `resumeToken` and `conversationId` query params are present.
- Adds a `BlockedRunExpiryJob` (one-shot pg-boss recurring job) that scans for `blocked_expires_at < now()` and transitions matching runs to `cancelled`.
- Renders the inline card in `AgentChatPage` with the four visual states: Active, Dismissed, Expired, Connected. Only `dismissed` is persisted on the message; the other three states are derived at read time from the card's `blockSequence`, `expiresAt`, and `runMetadata.completedBlockSequences` / `currentBlockSequence` (see §7.3 `IntegrationCardContent`). This ensures correct per-card state in multi-block runs.
- Pops OAuth in a popup (not same-tab); receives `postMessage` on success.

What this chunk does NOT do:
- Multi-block-batched cards (one card per block; sequential blocks produce sequential cards).
- Per-integration TTL (24h is fixed in v1).
- Integration disconnect from inside the chat (separate surface).
- Backfill historical runs (no retroactive blocked-state needed).

### 7.2 Files to create or modify

**Create:**
- `server/db/migrations/<n>_agent_run_blocked_state.sql` — adds the four columns + a partial index on `(blocked_reason, blocked_expires_at)` for the expiry sweep.
- `shared/types/integrationCardContent.ts` — `IntegrationCardContent` discriminated-union variant + Zod schema.
- `server/services/agentResumeService.ts` (or extend the existing `agentExecutionService` resume path under a new exported function — executor's choice; the brief permits either) — `resumeFromIntegrationConnect({ resumeToken, conversationId, orgId })`.
- `server/services/__tests__/agentResumeServicePure.test.ts` — pure tests: token validates against pre-state, duplicate calls are no-op, expired runs return 410, stale tokens return 410.
- `server/jobs/blockedRunExpiryJob.ts` — recurring sweep, registered in `server/services/queueService.ts`.
- `server/services/integrationBlockService.ts` — central place that decides whether a tool call is blocked on a missing integration. Called by the executor before tool dispatch.
- `server/services/__tests__/integrationBlockServicePure.test.ts` — tests for the block-decision matrix.
- `client/src/components/InlineIntegrationCard.tsx` — the inline card component with all four visual states.
- `client/src/hooks/useOAuthPopup.ts` — small hook wrapping `window.open` + the `postMessage` listener, returns `{ open(url): void; status: 'idle'|'pending'|'success'|'error' }`.

**Modify:**
- `server/db/schema/agentRuns.ts` — add the four new columns.
- `server/services/agentExecutionService.ts` — before tool dispatch, call `integrationBlockService.checkRequiredIntegrations(toolName, toolArgs, ctx)`. If blocked, transition the run, emit the card message, persist `runMetadata.blockedToolCall`, return control to the agent loop with a "paused" terminal-of-this-iteration. On resume, re-execute the persisted blocked tool call respecting the `idempotencyStrategy` (Option B).
- `server/routes/oauthIntegrations.ts` — when `?resumeToken=…&conversationId=…` are present on the OAuth callback, call `resumeFromIntegrationConnect` after the connection record is persisted. The callback page sends `postMessage({ type: 'oauth_success', resumeToken })` to the opener and closes itself.
- `server/routes/agentRuns.ts` (or new `agentResume.ts`) — add `POST /api/agent-runs/resume-from-integration` accepting `{ resumeToken }` body for opener-side fallback when popup `postMessage` is missed.
- `server/services/queueService.ts` — register `blocked-run-expiry-sweep` recurring job (every 5 minutes).
- `server/db/schema/agentMessages.ts` — extend `tool_calls` typing OR add a `metadata` JSONB column to carry `IntegrationCardContent` (executor's choice; the brief frames this as an optional new column. Choosing **a new `meta` JSONB column on `agent_messages`** keeps the existing `toolCalls` shape stable and lets future I-2 extensions live in `meta`. State this decision in the chunk's commit message.)
- `client/src/pages/AgentChatPage.tsx` — message renderer dispatch: when `meta.kind === 'integration_card'`, render `<InlineIntegrationCard />` instead of plain text.

### 7.3 Contracts

**New columns on `agent_runs`:**

```ts
blockedReason: text('blocked_reason').$type<'integration_required' | null>(),
blockedExpiresAt: timestamp('blocked_expires_at', { withTimezone: true }),
integrationResumeToken: text('integration_resume_token'),
integrationDedupKey: text('integration_dedup_key'),
```

A partial index for the expiry sweep:

```sql
CREATE INDEX agent_runs_blocked_expiry_idx
  ON agent_runs (blocked_expires_at)
  WHERE blocked_reason IS NOT NULL;
```

**New `meta` column on `agent_messages` (carries the typed UI extension per I-2):**

```ts
meta: jsonb('meta').$type<MessageMeta | null>(),
```

```ts
export type MessageMeta =
  | IntegrationCardContent
  | { kind: 'reserved_for_future' };  // discriminated union; new kinds add here

export interface IntegrationCardContent {
  kind: 'integration_card';
  schemaVersion: 1;              // fixed literal; bump when wire format changes
  integrationId: string;        // canonical integration slug ('notion', 'slack', …)
  blockSequence: number;        // monotonic block counter for this run (1, 2, 3…); used to derive per-card state
  title: string;                // ≤ 80 chars
  description: string;          // ≤ 240 chars
  actionLabel: string;          // 'Connect Notion'
  actionUrl: string;            // OAuth start URL with ?resumeToken=…&conversationId=…
  resumeToken: string;          // plaintext bearer token; never stored in DB
  expiresAt: string;            // ISO; 24h after issue
  dismissed: boolean;           // ONLY persisted state — set true on user dismiss action
  // visual state is NOT stored; DERIVED at read time from blockSequence + run metadata:
  // 'dismissed'  → dismissed === true
  // 'connected'  → blockSequence ∈ runMetadata.completedBlockSequences
  // 'expired'    → !dismissed && expiresAt < now() && blockSequence not yet completed
  // 'active'     → !dismissed && expiresAt >= now() && blockSequence === runMetadata.currentBlockSequence
}
```

**`integration_resume_token` generation:**
- 32 bytes from `crypto.randomBytes(32).toString('hex')`. The **plaintext token** is stored only in the message's `meta.resumeToken` (RLS-scoped, visible only to the conversation owner). The DB column `agent_runs.integration_resume_token` stores `sha256(plaintext)` — never the plaintext itself. Server validates by hashing the submitted token and comparing: `encode(sha256(submittedToken::bytea), 'hex') === storedHash`.
- Lifetime: 24 hours. Becomes invalid the moment the run transitions out of `blocked_reason = 'integration_required'`.

**Resume endpoint — `POST /api/agent-runs/resume-from-integration`:**
- Body (Zod): `{ resumeToken: string }`
- Auth: `authenticate` + `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)` (the same user who started the conversation must complete the OAuth — verified in the resume service via `agent_conversations.user_id`).
- Response: `200 OK` `{ runId: string, conversationId: string, status: 'resumed' | 'already_resumed' }`.
- Errors:
  - `400 INVALID_TOKEN` — token format wrong.
  - `403 FORBIDDEN` — caller is not the conversation owner.
  - `410 RESUME_TOKEN_EXPIRED` — `blocked_expires_at < now()` OR run is no longer in `blocked_reason = 'integration_required'`.
  - `404 RUN_NOT_FOUND` — no run with that token.

**Resume — the optimistic-predicate write (the I-4 enforcement):**

```sql
UPDATE agent_runs
SET blocked_reason = NULL,
    blocked_expires_at = NULL,
    integration_resume_token = NULL,
    updated_at = now()
WHERE id = $1
  AND organisation_id = $2
  AND blocked_reason = 'integration_required'
  AND integration_resume_token = encode(sha256($3::bytea), 'hex')
  AND blocked_expires_at > now()
RETURNING id;
```

0 rows updated → perform a follow-up read. Return `{ status: 'already_resumed' }` with HTTP 200 **only if** all three hold: (1) the run exists and `blocked_reason` is NULL, (2) `runMetadata.lastResumeTokenHash === sha256(submittedToken)`, and (3) `runMetadata.lastResumeBlockSequence === token.blockSequence`. Any other state → 410. Condition (3) closes the cross-block replay gap: a token from a previous block (e.g. block A's token submitted after block B has started) matches condition (2) but fails condition (3) and correctly returns 410. On a successful UPDATE, write both `runMetadata.lastResumeTokenHash = sha256(submittedToken)` and `runMetadata.lastResumeBlockSequence = currentBlockSequence` before returning.

**Resume — re-execute the blocked tool call:**
- Read `runMetadata.blockedToolCall = { toolName, toolArgs, dedupKey }`.
- Look up `ACTION_REGISTRY[toolName].idempotencyStrategy`.
- Re-execute via the existing tool dispatch path, passing `dedupKey` as the idempotency key for `keyed_write` strategies. The executor then continues the agent loop from the iteration after the block.
- Before handing control back to the LLM, re-inject `buildThreadContextReadModel(conversationId, orgId)` as a system message (A + E interaction, §2.4 E-7). If the read model's `version` differs from `runMetadata.threadContextVersionAtStart`, prepend an additional system message: `"Note: Thread context has been updated since this run started. The current state is shown above."` This makes context drift visible to the LLM without blocking execution.

### 7.4 Permissions / RLS checklist

- The four new columns live on `agent_runs` which is already RLS-scoped. No new manifest entry needed.
- The resume endpoint uses `requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT)` and additionally re-validates `agent_conversations.user_id === req.user.id` (or admin bypass).
- The `integration_resume_token` DB column stores `sha256(plaintext)` — the plaintext is never persisted in the DB. The plaintext lives only in `meta.resumeToken` of the originating message (RLS-scoped to the conversation owner). Never logged in plain text, never returned in any list endpoint, never exposed in `runs/:id` GET responses.

### 7.5 Execution-safety contracts (per Section 10)

- **State machine closure:** the `blocked_reason` field is a closed enum (v1: `integration_required` only). Adding a new value requires a spec amendment.
- **Valid transitions:** `blocked_reason = NULL → 'integration_required'` (executor blocks, increments `currentBlockSequence`); `'integration_required' → NULL` (resume, appends `currentBlockSequence` to `completedBlockSequences`); `'integration_required' → cancelled` (TTL expiry); `'integration_required' → 'integration_required'` is **forbidden** (each block is a fresh transition with a new token; the executor must clear before re-blocking).
- **Idempotency posture:** `state-based` for the resume write (optimistic predicate above). The "already_resumed" path validates both `runMetadata.lastResumeTokenHash === sha256(submittedToken)` and `runMetadata.lastResumeBlockSequence === token.blockSequence` — either mismatch → 410. This prevents a stale token from a prior block being accepted as a valid idempotent success for a later block. `keyed_write` for the re-executed tool call (`integration_dedup_key`).
- **Retry classification:** `guarded` for resume; the underlying tool re-execution is `guarded` for `keyed_write`/`locked` strategies and `safe` for `read_only`. `unsafe` strategies are NOT permitted to participate in blocking — if a tool whose handler is `unsafe` ends up in `runMetadata.blockedToolCall`, the resume rejects with `errorCode: 'TOOL_NOT_RESUMABLE'` and the run is cancelled with `cancelReason: 'tool_not_resumable'`.
- **Concurrency guard:** the optimistic predicate above. Two simultaneous resume calls → exactly one wins the UPDATE, the other observes 0 rows and falls into the idempotent-success path.
- **Terminal event guarantee:** every blocked run reaches exactly one of: `running → completed` (resume succeeded and run finished), `running → cancelled` (TTL expired or user gave up), `running → failed` (resume succeeded but execution then errored unrecoverably). Post-terminal: no further `meta.kind === 'integration_card'` messages may be emitted with the same run's tokens.
- **No silent partial success:** TTL expiry produces `status: 'cancelled'` with `runMetadata.cancelReason: 'integration_connect_timeout'` — never `status: 'success'`.
- **Unique constraint mapping:** none introduced; the `integration_resume_token` is high-entropy random, no UNIQUE index needed (a collision is a 2^-128 event; the optimistic predicate handles the race anyway).

### 7.6 Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify migration file
- `npm run build:server`
- `npm run build:client`
- `npx tsx server/services/__tests__/agentResumeServicePure.test.ts`
- `npx tsx server/services/__tests__/integrationBlockServicePure.test.ts`

### 7.7 Acceptance criteria

- An agent invokes a tool requiring an integration the user hasn't connected. The run transitions to `blocked_reason = 'integration_required'`, an `integration_card` message appears inline in the chat, and the run does not loop / time out.
- Clicking "Connect" opens an OAuth popup. On success, the popup posts `{ type: 'oauth_success', resumeToken }` to the opener; the opener calls the resume endpoint; the run resumes; the conversation refreshes via the existing socket and shows continued execution.
- Same flow but the popup closes without success: the card stays in "Active" state; the user can click "Connect" again.
- Click "Dismiss" → card collapses to a 1-line stub. The run stays `blocked` (the user has not actually connected the integration). User can click the stub to expand and reconnect.
- After 24h with no resume, the `BlockedRunExpiryJob` transitions the run to `status = 'cancelled'`, `runMetadata.cancelReason = 'integration_connect_timeout'`. The card visual state flips to "Expired" with a "Try again" CTA. Verified via a unit test that pins the time-window math.
- Clicking "Try again" on an expired card creates a **new run**, not a resume of the cancelled run. The new run inherits the conversation context (Chunk A's read model is re-injected at run start).
- Two simultaneous OAuth callbacks for the same `resumeToken` (race): exactly one wins the UPDATE, both clients observe `status: 'resumed'` (the loser via the idempotent path). Verified via the resume service unit test with two concurrent calls.
- A run blocked on integration A, resumed, then blocked on integration B: produces two separate cards, two separate tokens, two separate completion paths. Each block is a clean state transition (verified by the state-machine unit test).
- A tool with `idempotencyStrategy: 'unsafe'` (none today, but if/when introduced) is rejected at block-time with a clear log, the run is cancelled with `cancelReason: 'tool_not_resumable'`, and a non-card error message appears in the conversation.
- Structured logs on every state transition (I-6): `{ conversationId, runId, blockedReason, integrationId, action: 'run_blocked' | 'run_resumed' | 'run_blocked_expired' }`.
- The resume token is never written to logs in plain text. Logs use the SHA-256 prefix (8 chars) of the token for correlation.

### 7.8 Dependencies

- A — the `buildThreadContextReadModel` re-injection on resume (E-7).
- C — the message-extension pattern proves out the `meta` JSONB approach for typed UI variants (I-2).

---

## 8. Chunk D — Invocations card on the agent edit page

### 8.1 Scope

What this chunk does:
- Adds a single `InvocationsCard` to the upper portion of `AdminAgentEditPage` (Scheduling tab area).
- Renders a 6-tile grid: Scheduled, Webhook, Slack, Email, SMS (stub), MCP (stub).
- Each tile shows status badge: "Active · {n}" / "Setup" / "Soon".
- Clicking a clickable tile transitions it to an expanded accordion row with the existing config UI inline.
- Removes the existing scattered config sections (Heartbeat at line ~1413, plus any Slack/email/webhook sections) — replaces them.
- Pure client refactor — no backend changes.

What this chunk does NOT do:
- Add new server endpoints.
- Change any existing config endpoint contracts.
- Implement SMS or MCP configuration (visual stubs only).
- Add a "Notify me when available" capture for the stubs.
- Change the `invocations` ontology in the data model (the ontology note in the brief §7 is a naming-consistency commitment for future code; it does NOT force a refactor of existing column names in this chunk).

### 8.2 Files to create or modify

**Create:**
- `client/src/components/InvocationsCard.tsx` — the wrapping card and tile grid.
- `client/src/components/InvocationChannelTile.tsx` — single tile (icon, label, status badge, click handler).
- `client/src/components/__tests__/InvocationsCardPure.test.tsx` (optional — only if logic warrants; mostly visual).

**Modify:**
- `client/src/pages/AdminAgentEditPage.tsx` — major reorganisation of the upper sections of the Scheduling tab (and adjacent Slack/email config sections wherever they live today). The existing form-state shape stays; only the rendering tree changes. The accordion-expansion state is local component state inside `InvocationsCard`, not lifted.

### 8.3 Contracts

This chunk introduces no new server-tier contracts. The component contract:

```ts
type InvocationKind = 'scheduled' | 'webhook' | 'slack' | 'email' | 'sms' | 'mcp';

interface InvocationsCardProps {
  agentId: string;
  // Each tile receives the existing form state slices it already consumes.
  // Implementation detail — the executor decides the prop split when refactoring.
  scheduling: { /* current heartbeat form state */ };
  webhook:    { /* current webhook form state */ };
  slack:      { /* current slack channel binding state */ };
  email:      { /* current email mailbox state */ };
  // sms and mcp render as stubs; no props needed.
  onChange: (slice: Partial<…>) => void;  // existing AdminAgentEditPage form setter
}
```

The "active count" badge for Slack reads from whatever existing source the page already uses — likely a count derived from a Slack channels query already on the page. If no count is currently displayed on the page, the executor adds a one-line read against an existing Slack-channel-count endpoint and surfaces it; this is a small additive read, not a new endpoint.

### 8.4 Error handling

- No new error paths. Existing config-save error handling is preserved verbatim.

### 8.5 Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

### 8.6 Acceptance criteria

- `AdminAgentEditPage` opens with the InvocationsCard prominent at the top of the Scheduling tab. Six tiles visible in the documented order.
- Scheduled tile shows the heartbeat status (Active · every 4h / Inactive). Click expands to show the existing heartbeat editor inline. Saving works as before.
- Webhook tile expands to show the existing webhook config UI. Saving works as before.
- Slack tile shows "Active · 3 channels" if the agent is in 3 channels. Click expands to show the channel-binding UI.
- Email tile expands to show the existing mailbox config UI.
- SMS and MCP tiles render with "Soon" badge, `cursor: not-allowed`. Click does nothing.
- The previously-scattered config sections no longer exist outside the InvocationsCard. Scrolling the page does not reveal a duplicate copy of the heartbeat editor.
- Existing form-validation, save-button, and unsaved-changes warnings continue to function. Saving the agent saves all the same fields as before; no field is unintentionally dropped from the submit payload.
- Visual styling matches the user-approved mockup: tile grid layout, expanded-row inline accordion, tile colours per the mockup.

### 8.7 Dependencies

- None at the code level. D is sequenced after B in the brief but has no code dependency on it. The executor can ship D in parallel with any later chunk if convenient. Default order: ship D last because it's the lowest-risk and the team can absorb the visual change after the functional chunks have stabilised.

---

## 9. Risks & mitigations

The following risks are load-bearing. Each has a named mitigation that lives in a specific chunk.

### 9.1 Cost rollup divergence (B)

**Risk:** Future surfaces (per-skill cost, org P&L, agent-level breakdowns) implement their own SQL roll-up that disagrees with `conversationCostService` on which runs to count.

**Mitigation:**
- Pin the canonical SQL pattern in §1 I-5 and in §4.3 of this plan as the single allowed implementation.
- The reviewer greps for parallel implementations on every cost-touching PR; a second message-JOIN-to-cost-aggregates query in `server/services/` is a hard block.
- When a third cost surface lands, refactor `conversationCostService` to accept a scope parameter rather than fork.

### 9.2 Stale cost pill (B)

**Risk:** `cost_aggregates` is async; the pill can show stale-by-seconds values immediately after a message arrives.

**Mitigation:**
- The pill displays a faint "computing…" affordance for the first 2s after a new assistant message, then polls once at 2s and 6s if the totals haven't changed. No infinite polling.
- The brief and §2.1 B-4 explicitly accept a few-second lag.
- If the aggregator falls > 30s behind in production, that's an operations-tier issue, not a UI one.

### 9.3 Suggested-actions prompt drift (C)

**Risk:** The agent's system prompt evolves; a new prompt teaches it to emit raw slugs that aren't in the v1 enum, OR a future prompt re-teaches it to emit free-text actions.

**Mitigation:**
- I-3 enforced at parse: unknown enum values are dropped at the parser. The drop is a structured warn-log, surfacing prompt drift in observability.
- The Zod schema is the single allowlist; the parser is unit-tested with a "future agent emits unknown key" case to keep the drop behaviour pinned.
- Telemetry: alert when `suggested_action_dropped` exceeds 1% of message volume — this signals prompt drift.

### 9.4 Thread Context lost-write race (A)

**Risk:** Two concurrent runs patch the same conversation's thread context. Last-write-wins drops the loser's edits silently.

**Mitigation:**
- v1 accepts the loss; `version` is bumped on every successful patch so post-hoc detection is possible from logs.
- Concurrency guard via `UPDATE … WHERE version = ?` returns 0 rows on conflict; the loser retries once. After 2 failed retries → throws `CONCURRENT_PATCH_FAILURE` and the agent loop logs and continues. This bounds the "silent loss" risk to genuine high-frequency writes which are not v1's expected pattern.
- Telemetry: log `CONCURRENT_PATCH_FAILURE` count per day; if it exceeds 5 across all orgs, escalate to optimistic-concurrency-with-rejection in a follow-up.

### 9.5 Thread Context staleness on resume (A + E)

**Risk:** A run is paused on integration; meanwhile another run in the same conversation patches Thread Context. The resuming run's prompt is built from a snapshot taken before the pause and is now stale.

**Mitigation:**
- On resume, the executor re-injects `buildThreadContextReadModel` as a system message before continuing (E-7).
- This is unconditional in v1 — even if the cost is N tokens of redundancy when no patch happened during the pause, it eliminates the silent-staleness class entirely.
- Verified by a unit test that pins the resume prompt assembly path.

### 9.6 Resume-token leakage (E)

**Risk:** `integration_resume_token` is a bearer credential. If logged in plain text or echoed in a debug endpoint, anyone with log access can hijack the resume.

**Mitigation:**
- The DB column stores `sha256(plaintext)` — a DB leak exposes only the hash, which cannot be used to resume a run. The plaintext token lives only in the originating message's `meta.resumeToken` (RLS-scoped to the conversation owner).
- Logs use `sha256(token).slice(0, 8)` for correlation, never the plaintext itself.
- The column is never returned in any list/admin endpoint — `agentRuns.ts` GET handlers must omit it. Add a regression unit test pinning that the column is absent from the GET response shape.
- Lifetime is 24h; enforced on the optimistic predicate (`blocked_expires_at > now()`).

### 9.7 Tool-not-resumable surprise (E)

**Risk:** A tool that turns out to be `unsafe` is called inside a path that gets blocked on integration. Re-execution on resume produces duplicate side effects.

**Mitigation:**
- The block-decision service `integrationBlockService.shouldBlock(toolName, …)` checks `ACTION_REGISTRY[toolName].idempotencyStrategy`. If `unsafe` (or absent), the run is cancelled immediately with `cancelReason: 'tool_not_resumable'` and a non-card error message is emitted to the conversation.
- Today every action declares `idempotencyStrategy` (enforced by `verify-idempotency-strategy-declared.sh`). The risk is genuine only if a future tool is registered with no strategy — which the gate already blocks.

### 9.8 OAuth popup blocking / mobile (E)

**Risk:** Browser popup blockers; mobile browsers that don't support `window.opener.postMessage`.

**Mitigation:**
- The card's "Connect" button is a direct user gesture in response to a click, which most popup blockers allow.
- If `window.open` returns `null`, the card falls back to a same-tab redirect with a "Return here when done" notice. The OAuth callback page on success calls `POST /api/agent-runs/resume-from-integration` directly and then redirects back to `/agents/:id?conv=:id`. This is a graceful degradation — rare for desktop, the fallback for mobile.
- Both paths exercise the same resume endpoint, so the idempotency guarantees are uniform.

### 9.9 Invocations card refactor leaves duplicate sections (D)

**Risk:** The refactor moves the heartbeat editor into the Scheduled tile but leaves the original section in the page; the user sees two heartbeat editors.

**Mitigation:**
- Acceptance criterion §8.6 explicitly states the previously-scattered sections must not appear outside the card.
- Reviewer scrolls the entire Scheduling tab in PR review and grep-confirms the heartbeat-editor block appears only inside `InvocationsCard.tsx`.

### 9.10 Telemetry cascade (cross-chunk)

**Risk:** Each chunk adds new structured logs (I-6); the aggregate volume strains log ingestion or observability budgets.

**Mitigation:**
- All new logs are at `info` level and are well-bounded: one log per cost call (rare), one per patch (rare), one per state transition (rare), one per dropped chip (very rare). No per-message hot-path logging is introduced.
- If volume becomes a concern, the team can demote selected actions to `debug` after a week of production observation. That tuning is out of scope for this plan.

### 9.11 Integration-card schema collides with future message-meta extensions (E)

**Risk:** The new `meta` JSONB column on `agent_messages` is reused by future features (file-card, calendar-card, etc.) and the integration-card consumer doesn't tolerate other variants.

**Mitigation:**
- The `MessageMeta` type is a discriminated union from day one (`kind` discriminator). The renderer dispatches on `kind`; unknown kinds render plain text and emit a `meta_unknown_kind_dropped` log.
- Adding a new `MessageMeta` variant is a typed change in `shared/types/integrationCardContent.ts` (rename to `messageMeta.ts` if the file outgrows the integration-card concept) — not a schema migration.

---

## 10. Open questions

The user has approved the design direction and settled the major architectural choices. The following remain open for implementation-time clarification — the executor MUST resolve them before merging the relevant chunk and document the resolution in the PR description:

### 10.1 Chunk B — model-id resolution path ✅ RESOLVED

**Resolved 2026-04-30.** `config_snapshot` does NOT contain `modelId` — it stores `{ tokenBudget, maxToolCalls, timeoutMs, skillSlugs, customInstructions, executionScope }` only. The model is on `agents.model_id` (text column, e.g. `'claude-sonnet-4-6'`), reachable via `agent_runs.agent_id → agents.id`. The SQL in §4.3 has been updated accordingly (`JOIN agents a ON a.id = ar.agent_id`, then `a.model_id`). If an agent's model changes between runs, each model value appears as a distinct breakdown line — intentional and correct.

### 10.2 Chunk C — server prompt instructions for the chip enum

The agent's system prompt must teach it the closed enum. **Open:** which prompt partition does the enum description belong in (system prelude vs per-turn footer)? Lean: prelude, because the enum is invariant for the whole conversation. The executor decides at implementation time and notes it in the PR.

### 10.3 Chunk A — `update_thread_context` tool surfacing in the run trace

The brief lean is "yes, surface it". **Open:** is the existing run-trace renderer extensible to a new tool category, or does it need a small additive change? The executor scopes this when implementing; if extensible, do it; if not, defer the trace-surfacing visualisation to a follow-up and only ensure the tool call exists in `agent_run_messages` (it will, by virtue of being a registered ACTION_REGISTRY entry).

### 10.4 Chunk E — fallback when the OAuth provider does not return `?conversationId`

Some OAuth providers may strip query params or use state-token-only round-trips. **Open:** does every integration we plan to enable for v1 (Notion, Slack, Email/Gmail, GHL) preserve the `resumeToken` + `conversationId` query params on callback? If a provider strips them, the OAuth start URL must encode them in the `state` parameter and the callback must decode them. The executor confirms per-provider during E.3 implementation; if ambiguous, the safe path is "always encode in state".

### 10.5 Chunk D — Slack channel-count source

The "Active · {n}" badge for Slack reads channel count. **Open:** is there a single existing endpoint (or service helper) that returns the count, or is it currently computed client-side from a list endpoint? If list-then-count, the addition is trivial; if no source exists, add a one-line read in the existing slack-connection service. The executor decides when implementing D.

---

## 11. Deferred items

The following are explicitly **out of scope for this brief** and should NOT be implemented as part of the Tier 1 UI Uplift:

- **Org-wide cost view, per-skill cost view.** B's `conversationCostService` is the foundation, but no admin dashboards or per-skill breakdowns ship in this plan. When they ship, they must reuse the canonical I-5 rule.
- **`agent_runs.conversation_id` column.** Rejected as Option 1 in §2.1 B-1; revisit if cost-by-conversation surfaces proliferate beyond chat.
- **User-editable Thread Context.** Read-only in v1. A future tier may add edit affordances; the patch-op contract supports it but the UI does not.
- **Compaction.** No compaction code exists today. When it lands, the DB row is the source of truth and the system message is display-only (I-1 fixes the rule).
- **Per-section thread-context history / audit trail.** Only `version`, `createdAt`, `updatedAt` are tracked in v1. A `conversation_thread_context_revisions` audit table is a future ask.
- **Optimistic-concurrency rejection on Thread Context.** v1 is last-write-wins. Revisit if `CONCURRENT_PATCH_FAILURE` exceeds 5/day.
- **Multi-block batched integration cards.** v1 emits sequential single-block cards. Batching multiple integrations into one card is deferred.
- **Per-integration TTL on the blocked state.** 24h fixed in v1.
- **SMS / MCP invocations — actual configuration.** v1 is visual stubs only. "Notify me when available" capture is also deferred.
- **First-class "invocation" data model.** The brief's ontology note (§7) is a naming-consistency commitment for future code, not a v1 refactor of `heartbeat*` / `webhookConfig` / etc. column names.
- **`dual-reviewer`-style spec second-pass on this plan.** This plan is the architect's output; review happens via the standard pipeline (`pr-reviewer` after implementation; `dual-reviewer` only if the user asks).
- **Cost rendering for failed-only runs.** I-5 specifies counting any run that produced a user-visible message — including partial successes. Pure-failed-no-output runs are excluded by design and are not surfaced separately in the Tier 1 UI.
- **Pre-execution integration capability check (E).** Before the LLM generates a tool call, a pre-check layer could inject an instruction when a required integration is missing — preventing the LLM from emitting the tool call and wasting tokens on a guaranteed-blocked path. Requires an integration-requirement registry not yet built. Defer to a Phase 2 optimisation of Chunk E.
- **`triggered_run_id` write-layer enforcement (B).** The I-5 cost-determinism rule handles the current case via the message-JOIN approach. A write-layer invariant enforcing that every persisted assistant message carries a non-null `triggered_run_id` is valid hardening but belongs in the general message-writing contract, not this plan. Route to `tasks/todo.md` as a follow-up hardening item.
- **Cost query scalability (B).** The canonical `SELECT DISTINCT triggered_run_id FROM agent_messages WHERE conversation_id = ?` query is cheap for typical conversation sizes. At high message volume (>5k messages per conversation), a lightweight `conversation_run_index` materialized table keyed on `(conversation_id, run_id)` would eliminate the full-scan. Not needed for v1; revisit if `conversationCostService` latency becomes observable in production.
- **Patch no-op reason field (A).** When `update_thread_context` emits a no-op log (remove of non-existent ID, duplicate patch, task already in target state), the log currently has no `reason` discriminator. A future `reason: 'id_not_found' | 'already_in_state' | 'duplicate_patch'` field would make agent prompt debugging significantly faster. Defer to a logging-hygiene pass post-launch.
- **Integration dedup key versioning (E).** `integration_dedup_key = sha256(toolName + stableStringify(toolArgs) + integrationId)` does not incorporate a tool contract version. If a tool's argument schema changes in a backward-incompatible way, an old dedup key stored in `runMetadata` could match a new tool invocation with different semantics. Mitigated in practice by the fact that tool arg schemas evolve rarely. Formal versioning (appending `actionVersion` from `ACTION_REGISTRY`) is deferred until the registry gains a version field.

---

## 12. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

**Per-chunk verification:** each chunk's "Verification commands" section lists ONLY `npm run lint`, `npm run typecheck`, optional `npm run build:server` / `npm run build:client`, optional `npm run db:generate`, and targeted `npx tsx <path>` invocations of the unit tests authored in that chunk. CI runs the broader suite on the PR.

**Plan gate:** This plan is the final pre-implementation artefact for the Tier 1 UI Uplift. Per `CLAUDE.md` § "Model guidance per phase", the user reviews this plan before switching to Sonnet for execution. Do not proceed to implementation until the user has explicitly approved this document.

**Execution order:** The chunks ship sequentially as described in §3 — B, then C, then A, then E, then D. Each chunk is one PR (sub-chunks may collapse into commits within a PR or land as sequential PRs at the executor's discretion). Sequencing is forward-only: no chunk depends on state created by a later chunk.

**Per-chunk PR shape:** every chunk ends with a complete, mergeable PR. The PR description includes:
- A pointer to this plan and the specific chunk section.
- The acceptance-criteria checklist from the chunk, with ticks as evidence.
- The structured-log examples that the chunk emits (I-6 receipts).
- For chunks A and E: an explicit re-confirmation that the relevant invariants (I-1, I-3, I-4) are satisfied, with grep evidence.

**Reviewer expectations:** `pr-reviewer` reviews each chunk against this plan. Where this plan's contracts diverge from the brief, the plan wins (it is the build contract); flag any divergence in the review log if discovered. Spec-conformance is the brief; this plan operationalises it.

**Documentation updates:** when each chunk lands, update `architecture.md` to point at the new primitives (single-line pointers, not deep duplication) — `conversation_thread_context`, `conversationCostService`, `meta` column on `agent_messages`, `blocked_reason` on `agent_runs`. Stale docs are worse than missing docs (CLAUDE.md §11).

