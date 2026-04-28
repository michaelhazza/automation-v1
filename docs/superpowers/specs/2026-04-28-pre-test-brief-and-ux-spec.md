# Pre-Test Universal Brief Follow-up + Dashboard Error UX — Spec

**Created:** 2026-04-28
**Status:** draft (ready for spec-reviewer)
**Source backlog:** `tasks/todo.md` (Tier 1+2 audit triage, 2026-04-28 session)
**Pair spec:** `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md`
**Concurrency:** designed to run on a separate branch from the pair spec; file-disjoint by construction (see §0.4).

---

## Contents

- [§0 Why this spec exists](#0-why-this-spec-exists)
  - [§0.1 Framing assumptions](#01-framing-assumptions)
  - [§0.2 Testing posture](#02-testing-posture)
  - [§0.3 No new primitives unless named](#03-no-new-primitives-unless-named)
  - [§0.4 Concurrency contract with pair spec](#04-concurrency-contract-with-pair-spec)
- [§1 Items](#1-items)
  - [§1.1 DR2 — Re-invoke fast-path + Orchestrator on follow-up conversation messages](#11-dr2--re-invoke-fast-path--orchestrator-on-follow-up-conversation-messages)
  - [§1.2 S8 — Move conversation-message websocket emits to a post-commit boundary](#12-s8--move-conversation-message-websocket-emits-to-a-post-commit-boundary)
  - [§1.3 N7 — Paginate `GET /api/briefs/:briefId/artefacts`](#13-n7--paginate-get-apibriefsbriefidartefacts)
  - [§1.4 S3 — Surface inline error states on `DashboardPage` and `ClientPulseDashboardPage`](#14-s3--surface-inline-error-states-on-dashboardpage-and-clientpulsedashboardpage)
- [§2 Sequencing](#2-sequencing)
- [§3 Out of scope](#3-out-of-scope)
- [§4 Definition of Done](#4-definition-of-done)
- [§5 Tracking](#5-tracking)

---

## §0 Why this spec exists

The product is pre-production and has not yet been through a structured testing round. A 2026-04-28 audit of `tasks/todo.md` triaged ~20 deferred items against the lens "what would corrupt or weaken the signal from a first major testing pass?" Most items had already shipped; the residual set splits between "backend observability + plumbing + safety" (the pair spec) and four items consolidated here.

This spec covers four items united by a single property: **they make the signal from user-facing testing tractable**. Without them:
- DR2 makes Brief follow-up chat surfaces silently one-way after the first turn — testers will report "the agent ignored my second message" repeatedly.
- S8 emits websocket events for tx-rolled-back inserts, producing flaky "ghost artefact" UI behaviours that look like bugs but aren't.
- N7's unbounded artefact list bogs down any Brief that produces more than a handful of artefacts during testing.
- S3's silent dashboard errors collapse two distinct failure modes ("no data" vs "fetch broke") into the same empty UI — testers can't tell whether they're seeing the right thing.

The four items split clean into two surfaces: **Universal Brief follow-up flow** (DR2 + S8 + N7) and **dashboard error visibility** (S3). All four are file-disjoint from the pair spec (see §0.4).

### §0.1 Framing assumptions

Imported from `docs/spec-context.md`:

- **Pre-production.** Backwards compatibility shims, feature flags, and migration windows are not required. Drop deprecated patterns directly.
- **Rapid evolution.** Prefer simple, deterministic implementations over abstractions designed for hypothetical reuse.
- **No feature flags.** Conditional behaviour goes via env vars only when the env-var requirement is itself the spec.
- **Prefer existing primitives.** `handleConversationFollowUp`, `handleBriefMessage`, `classifyChatIntent`, `enqueueOrchestratorRoutingIfEligible`, `emitBriefArtefactNew` / `emitBriefArtefactUpdated` / `emitConversationUpdate`, `getOrgScopedDb`, `assertCanViewConversation` already exist. Items in this spec consume them; they do not introduce parallel abstractions.

### §0.2 Testing posture

Per `docs/spec-context.md`:

- **Pure-function unit tests** (`*Pure.ts` + `*.test.ts`) are the default for new logic.
- **Targeted integration tests** are permitted only inside the existing carve-out for hot-path concerns (RLS, idempotency, crash-resume parity). §1.1 DR2 sits inside that carve-out for the routing-loop re-invocation test.
- **Manual browser smoke tests** are the right tool for §1.4 S3 (UI behaviour under fetch failure) — assert results in `tasks/builds/<slug>/progress.md`.
- **No new test harnesses.** Use `node:test` + `node:assert` for server tests; React Testing Library / Vitest already exists for client tests where present.

### §0.3 No new primitives unless named

No item in §1 may introduce a new abstraction, helper module, primitive, or system-level pattern unless that primitive is **explicitly named in the item's Files list and Approach section**. This rule mirrors the pair spec's §0.3.

Concrete consequences:
- §1.1 DR2 introduces no new primitive — `handleConversationFollowUp` (and its inner `handleBriefMessage`) already exist; this spec wires them into the route.
- §1.2 S8 names exactly one new helper module: `server/lib/postCommitEmitter.ts` exposing a request-scoped emit-deferral primitive (see §1.2 Approach for the full surface). No additional helpers may emerge.
- §1.3 N7 introduces no new primitive — pagination follows the existing cursor-pagination pattern from `clientPulseHighRiskService.getPrioritisedClients` (cursor encoding, query-param shape).
- §1.4 S3 introduces no new client primitive — error-state surfacing uses the existing inline-banner / retry-button conventions present elsewhere in the client codebase.

If implementation surfaces a need for a primitive not named here, **stop, log to `tasks/todo.md`, and ship the item against its stated scope only**.

### §0.4 Concurrency contract with pair spec

This spec runs concurrently with `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` on a separate branch. The matrix below confirms file-disjointness.

| File | This spec | Pair spec |
|------|-----------|-----------|
| `server/routes/conversations.ts` | §1.1 | — |
| `server/services/briefConversationService.ts` (read-only consume) | §1.1 | — |
| `server/services/briefConversationWriter.ts` | §1.2 | — |
| `server/lib/postCommitEmitter.ts` (NEW) | §1.2 | — |
| `server/middleware/postCommitEmitter.ts` (NEW — request-scoped middleware) | §1.2 | — |
| `server/index.ts` (one-line middleware registration) | §1.2 | — |
| `server/routes/briefs.ts` | §1.3 | — |
| `server/services/briefCreationService.ts` | §1.3 | — |
| `client/src/pages/BriefDetailPage.tsx` | §1.3 | — |
| `client/src/pages/DashboardPage.tsx` | §1.4 | — |
| `client/src/pages/ClientPulseDashboardPage.tsx` | §1.4 | — |
| `server/services/llmRouter.ts` | — | §1.1 (pair) |
| `server/services/agentRunPayloadWriter.ts` | — | §1.1 (pair) |
| `server/services/agentExecutionEventEmitter.ts` | — | §1.1 (pair) |
| `server/services/invokeAutomationStepService.ts` | — | §1.2 (pair) |
| `server/services/workflowEngineService.ts` | — | §1.3 (pair) |
| `server/services/workflowRunService.ts` | — | §1.3 (pair) |
| `migrations/0240_*.sql` | — | §1.4 (pair) |
| `server/db/schema/conversations.ts` | — | §1.4 (pair) |
| `server/services/clientPulseHighRiskService.ts` | — | §1.5 (pair) |
| `server/services/briefArtefactValidatorPure.ts` | — | §1.6 (pair) |
| `server/services/incidentIngestor.ts` | — | §1.7 (pair) |

**Migration coordination.** This spec reserves zero migration slots. The pair spec reserves `0240`. If this spec needs a migration during implementation, it MUST claim `0241` and add a written entry to its §0.4 matrix before allocating.

**`tasks/todo.md` coordination.** Each spec ticks off its own deferred-item entries. Merge-time conflicts on `tasks/todo.md` are expected; resolve by retaining both sets of completion marks.

**Schema coordination caveat.** §1.1 DR2 reads from the `conversations` table whose unique index is being changed by the pair spec's §1.4 N3. The change is strictly more permissive (drops nothing, only adds the org-scope dimension); §1.1 DR2's reads are by `(conversationId, organisationId)` which the new index covers as a leading-column subset. **No coordination required between the two specs.**

---

## §1 Items

### §1.1 DR2 — Re-invoke fast-path + Orchestrator on follow-up conversation messages

**Source.** `tasks/todo.md` § "Deferred from dual-reviewer review — Universal Brief" → DR2. Spec: `docs/universal-brief-dev-spec.md` §7.11 / §7.12 ("Re-invokes the fast path + Orchestrator if the message looks like a follow-up intent rather than a passive 'thanks'").

**Files.**
- `server/routes/conversations.ts` — `POST /api/conversations/:conversationId/messages` handler at lines 74-105.
- `server/services/briefConversationService.ts` (read-only consume — `handleConversationFollowUp` already exported, used by `routes/briefs.ts`).
- `server/services/__tests__/conversationsRoutePure.test.ts` (NEW — pure tests for the scope-dispatch predicate).

**Goal.** When a user posts a follow-up message to `/api/conversations/:conversationId/messages`, the handler currently writes the user message and returns. For Brief-scoped conversations, the spec requires the handler to ALSO re-invoke the fast-path classifier and (where appropriate) re-enqueue the Orchestrator. The plumbing already exists in `briefConversationService.handleConversationFollowUp` — this item wires it into the polymorphic conversations route. Non-Brief scopes (`task`, `agent_run`) remain out of scope per the deferral note (covered in §3).

**Approach.**
1. **Pure scope-dispatch predicate.** Extract a tiny pure helper `selectConversationFollowUpAction(conv) → 'brief_followup' | 'noop'` that returns `'brief_followup'` iff `conv.scopeType === 'brief'`. All other scope types return `'noop'` for v1. Place in a new `server/services/conversationsRoutePure.ts` (since `routes/*` lacks a `*Pure` companion convention; mirror the pattern from `chatTriageClassifierPure.ts`).
2. **Wire `handleConversationFollowUp` into the route.** In `routes/conversations.ts:75-105`, after the existing `assertCanViewConversation` check and the user-message write, branch on `selectConversationFollowUpAction(conv)`:
   ```ts
   const action = selectConversationFollowUpAction(conv);
   if (action === 'brief_followup') {
     // briefId is stored on conv.scopeId for scopeType === 'brief'
     const result = await handleConversationFollowUp({
       conversationId,
       briefId: conv.scopeId,
       organisationId: req.orgId!,
       subaccountId: conv.subaccountId ?? null,
       text: content.trim(),
       uiContext: { source: 'conversations_route' },
       senderUserId: req.user!.id,
     });
     res.status(201).json({ ...messageWriteResult, route: result.route, fastPathDecision: result.fastPathDecision });
     return;
   }
   // 'noop' branch — for task / agent_run scopes, preserve current behaviour
   res.status(201).json(messageWriteResult);
   ```
   **Important:** `handleConversationFollowUp` ALREADY calls `writeConversationMessage` internally (briefConversationService.ts:141). The route currently calls `writeConversationMessage` directly at lines 94-101. **The wiring change must drop the direct `writeConversationMessage` call from the brief-followup branch** to avoid duplicating the user message. The `'noop'` branch keeps the direct call.
3. **Idempotency for follow-up re-invocation.** `handleBriefMessage` (called inside `handleConversationFollowUp`) performs `classifyChatIntent` and conditionally enqueues the orchestrator. Idempotency is the existing concern of those primitives, NOT a new contract this spec introduces. If the same message is posted twice (network retry), the duplicate-message detection in `writeConversationMessage` already short-circuits the second write — verify this assumption holds by reading the function before shipping. If it does not, surface as a §1.1 implementation blocker (not a scope expansion).
4. **Subaccount context.** `conversations.subaccountId` is the canonical source. The route currently does not read `conv.subaccountId` because the direct `writeConversationMessage` call passes `subaccountId: undefined`. The new branch must pass `conv.subaccountId ?? null` through — `handleConversationFollowUp` requires it for orchestrator-routing context.
5. **Non-Brief scopes (task / agent_run).** The original deferral note explicitly carves these out:
   > "Architectural scope — needs design for non-Brief scopes (`task`, `agent_run`) that don't currently enqueue orchestration, idempotency for passive acks, and whether simple_reply/cheap_answer can produce new inline artefacts on follow-ups."
   This spec ships ONLY the brief branch. The `'noop'` branch matches the route's pre-spec behaviour for `task` / `agent_run`. A future spec covers them.
6. **Telemetry log.** On entry to the brief-followup branch, emit a structured info log `conversations_route.brief_followup_dispatched` with `{ conversationId, briefId, organisationId, fastPathDecisionKind: result.fastPathDecision.kind }` so the testing round can confirm the wiring fires from real traffic.

**Acceptance criteria.**
- `POST /api/conversations/:id/messages` against a Brief-scoped conversation: writes the user message exactly once (no duplication), invokes `classifyChatIntent`, and re-enqueues `orchestratorFromTaskJob` for `needs_orchestrator` / `needs_clarification` decisions.
- Same endpoint against a `task` or `agent_run`-scoped conversation: writes the user message and returns 201 (existing behaviour preserved).
- Response body for the brief branch carries `route` + `fastPathDecision` fields in addition to the standard message-write result; non-Brief branch returns the existing shape unchanged.
- A duplicate POST with the same `(conversationId, content)` does not produce two user messages (existing duplicate-detection in `writeConversationMessage` is honoured by the brief branch).
- The `conversations_route.brief_followup_dispatched` log entry appears for every brief-followup dispatch, with the four documented fields.
- Cross-brief / cross-conversation safety: `handleConversationFollowUp` already verifies the conversation belongs to the brief — the route relies on that check, no duplication.

**Tests.**
- `server/services/__tests__/conversationsRoutePure.test.ts` — exhaustive matrix on `selectConversationFollowUpAction(conv)`:
  - `scopeType: 'brief'` → `'brief_followup'`
  - `scopeType: 'task' | 'agent_run' | 'agent'` → `'noop'` (3 cases, one per non-brief scope)
  - Missing/null `scopeType` → `'noop'` (defensive default)
- **Carved-out integration test** (allowed under §0.2): `server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts` exercises the route end-to-end against a fake LLM provider, asserts user message is written once, fast-path classification fires, and orchestrator-routing job is enqueued for a `needs_orchestrator` decision.

**Dependencies.** `handleConversationFollowUp` already exists and is wired into `routes/briefs.ts:136`; this item reuses it. No upstream blocker.

**Risk.** Low-medium. The route gains a new branch but the new branch composes existing well-tested primitives. The main risk is the duplicate-message-write trap in step 2: the existing route writes the message inline, but `handleConversationFollowUp` ALSO writes the message internally. The branch must drop the inline write — verify by reading both call sites before shipping. A test asserting "exactly one message row after one POST" catches the regression.

**Definition of Done.** All acceptance criteria pass; pure tests added and green; integration test added and green; route's brief-followup path verified manually against the dev DB (post a follow-up, confirm orchestrator job enqueues, observe the structured log line); `tasks/todo.md § DR2` ticked off.

---

### §1.2 S8 — Move conversation-message websocket emits to a post-commit boundary

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — Universal Brief" → S8.

**Files.**
- `server/services/briefConversationWriter.ts` — current emit sites at line 203 (`emitConversationUpdate`) and line ~214-216 (`emitBriefArtefactNew` / `emitBriefArtefactUpdated`).
- `server/lib/postCommitEmitter.ts` (NEW) — request-scoped emit-deferral primitive.
- `server/middleware/postCommitEmitter.ts` (NEW) — Express middleware that installs the request-scoped store and flushes on `res.finish`.
- `server/index.ts` — one-line registration of the new middleware (mount BEFORE the route handlers so every request has a store).
- `server/lib/__tests__/postCommitEmitter.test.ts` (NEW).

**Goal.** Today, `briefConversationWriter.writeConversationMessage` emits websocket events inline immediately after the DB insert. If the outer request transaction rolls back AFTER the insert (e.g. a downstream validation error in a later route step), the row never persists but clients have already received "artefact appeared" events — UI shows a ghost artefact, refetch wipes it. During a testing round these phantom artefacts are indistinguishable from real bugs. Defer the emits until the response is successfully sent (`res.finish`), so a tx rollback ALWAYS prevents the corresponding emit.

**Approach.**
1. **New primitive: `postCommitEmitter.ts`.** Surface:
   ```ts
   // server/lib/postCommitEmitter.ts
   export interface PostCommitStore {
     enqueue(emit: () => void): void;
     flushAll(): void;
     reset(): void;
   }

   // AsyncLocalStorage-backed singleton; the middleware (below) creates a
   // fresh store per request and binds it to the async context.
   export function getPostCommitStore(): PostCommitStore | null;
   export function runWithPostCommitStore<T>(store: PostCommitStore, fn: () => Promise<T>): Promise<T>;
   ```
   Implementation uses `node:async_hooks` `AsyncLocalStorage<PostCommitStore>`. `enqueue` pushes onto an in-memory array. `flushAll` iterates and invokes each emit; if any emit throws, log and continue (best-effort — one failed emit must not block the others). `reset` clears the queue (used after flush).
2. **New middleware: `postCommitEmitter.ts`.**
   ```ts
   // server/middleware/postCommitEmitter.ts
   import { runWithPostCommitStore, type PostCommitStore } from '../lib/postCommitEmitter.js';
   import type { RequestHandler } from 'express';

   export const postCommitEmitterMiddleware: RequestHandler = (req, res, next) => {
     const store: PostCommitStore = createStore();
     // Flush only on successful response (2xx / 3xx). A 4xx / 5xx
     // response indicates the request did not produce committed state
     // we want to emit events for; drop the queue.
     res.on('finish', () => {
       if (res.statusCode >= 200 && res.statusCode < 400) {
         store.flushAll();
       } else {
         store.reset();
       }
     });
     // 'close' fires on premature disconnect; drop the queue regardless.
     res.on('close', () => store.reset());
     runWithPostCommitStore(store, async () => next()).catch(next);
   };
   ```
   Mount in `server/index.ts` before the route registrations and AFTER the org-tx middleware (so the store sits inside the tx context — important because emits enqueued during the tx must flush after the tx commits).
3. **Refactor `briefConversationWriter.ts`.** Replace the three direct emit calls with enqueues:
   ```ts
   const store = getPostCommitStore();
   if (store) {
     store.enqueue(() => emitConversationUpdate(input.conversationId, 'conversation-message:new', { ... }));
     // ... and similarly for emitBriefArtefactNew / emitBriefArtefactUpdated
   } else {
     // Fallback: jobs / cron / non-request callers do not have a store.
     // Emit directly — there is no request to wait for.
     emitConversationUpdate(input.conversationId, 'conversation-message:new', { ... });
   }
   ```
   The fallback is critical for callers that invoke `writeConversationMessage` from job workers (e.g. orchestrator-from-task) — those have no `res.finish` to wait for; emits there fire as soon as the writer commits.
4. **Tx-vs-emit ordering.** The middleware runs OUTSIDE the request's org transaction (`withOrgTx` is per-route, started inside route handlers). The store is bound to the async context for the whole request, including inside any `withOrgTx` block. An enqueue happens during the tx; the actual emit fires post-`res.finish`, which is post-commit. **No new tx integration required.**
5. **Why not a tx-outbox table?** The deferred-item note suggests "defer emits until `res.finish`, OR adopt a tx-outbox pattern." This spec picks the simpler one — `res.finish` is sufficient because the failure mode being closed (tx rollback emitting ghost events) is a request-scoped concern, not a cross-process durability concern. A tx-outbox would survive process crashes, but a process crash mid-request is a separate failure class and the lost emit is acceptable (clients reconnect and refetch on websocket reconnect — the same fallback the rest of the system uses).
6. **Logging.** On flush, log a single structured `post_commit_emit_flushed` entry with `{ requestId, emitCount }` so the testing round can confirm the deferral pattern is firing. On `res.finish` with `statusCode >= 400`, log `post_commit_emit_dropped` with `{ requestId, droppedCount, statusCode }` so we can see how often non-2xx responses were preventing ghost-emits.

**Acceptance criteria.**
- A successful `POST /api/briefs/:id/messages` (200/201) results in: DB row written → tx committed → response sent → `res.finish` fires → enqueued emits flush. Verifiable by log ordering.
- A failed POST that returns 4xx/5xx after the writer ran (contrived test): DB row written-then-rolled-back via outer error → enqueued emit dropped via the `statusCode >= 400` branch. NO websocket event reaches clients.
- A premature client disconnect (`res.on('close')` fires before `'finish'`): enqueued emits dropped.
- Job-worker callers of `writeConversationMessage` (no request store): emits fire inline (fallback branch).
- Idempotent re-flush: if `flushAll` is called twice on the same store (defensive double-trigger), the second call is a no-op (queue cleared after first flush).
- The `post_commit_emit_flushed` and `post_commit_emit_dropped` log entries appear with the documented fields.

**Tests.**
- `server/lib/__tests__/postCommitEmitter.test.ts` — cover:
  1. `enqueue` then `flushAll` invokes the emit exactly once.
  2. `enqueue` then `reset` invokes nothing.
  3. `flushAll` after `reset` invokes nothing (queue clear).
  4. `flushAll` with one emit that throws — second emit still runs (best-effort).
  5. `runWithPostCommitStore` binds the store to the async context — `getPostCommitStore()` inside the callback returns the bound store; outside returns null.
  6. Concurrent requests get isolated stores (run two `runWithPostCommitStore` calls in parallel; assert their enqueues do not bleed).
- **Carved-out integration test** (allowed under §0.2): `server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts` simulates a request lifecycle: middleware → writer enqueues → `res.finish` fires → assert emit invoked. Then a second case: middleware → writer enqueues → `res.statusCode = 500` → `res.finish` fires → assert emit NOT invoked.
- Manual smoke: trigger a contrived 500 in a route after `writeConversationMessage` runs; observe in browser dev tools that NO websocket event arrives. Trigger a happy-path message; observe the event arrives normally.

**Dependencies.** None. `AsyncLocalStorage` is standard Node, available in all supported runtimes.

**Risk.** Medium. Introducing async-local-storage into the request lifecycle has knock-on potential: any code path currently relying on the inline emit (e.g. a test that reads the websocket event synchronously after the writer call) breaks. Mitigation: search the codebase for tests that depend on the inline emit; update them to either await `res.finish` or call the writer via the fallback path. The `flushAll` failure mode (best-effort with logging) is documented inline at the catch site so a future reader knows why emit failures don't propagate.

**Definition of Done.** All acceptance criteria pass; pure tests added and green; integration test added and green; manual smoke for the 500-rollback case completed and noted in `tasks/builds/<slug>/progress.md`; `tasks/todo.md § S8` ticked off; KNOWLEDGE.md entry captured for the post-commit emit pattern (it generalises beyond Brief artefacts).

---

### §1.3 N7 — Paginate `GET /api/briefs/:briefId/artefacts`

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — Universal Brief" → N7.

**Files.**
- `server/routes/briefs.ts` — `GET /api/briefs/:briefId/artefacts` handler at lines 74-86.
- `server/services/briefCreationService.ts` — `getBriefArtefacts` function (the data-access primitive the route delegates to).
- `server/services/__tests__/briefArtefactCursorPure.test.ts` (NEW — pure cursor encode/decode tests).
- `client/src/pages/BriefDetailPage.tsx` — consumer; needs to pass through cursor state and add a "Load older" affordance.

**Goal.** Currently the route pulls every artefact for the brief and the client flattens all of them. A real Brief during testing produces tens to hundreds of artefacts (inline structured replies, approval cards, error cards). Add bounded pagination so the initial fetch returns the most-recent N and clients page backwards on demand.

**Approach (server).**
1. **Query-param shape.** Match the existing cursor-pagination convention from `clientPulseHighRiskService.getPrioritisedClients`:
   ```
   GET /api/briefs/:briefId/artefacts?limit=50&cursor=<opaque>
   ```
   - `limit?: number` — default 50, max 200, validated as integer in `[1, 200]`. Out-of-range values clamp to the bound (do NOT 400).
   - `cursor?: string` — opaque base64-url-encoded JSON `{ ts: ISO8601, msgId: UUID }` representing "fetch artefacts older than this conversation_message". Absent on first request.
2. **Pure cursor primitives.** In a new pure helper file `server/services/briefArtefactCursorPure.ts`:
   ```ts
   export interface CursorPosition { ts: string; msgId: string }
   export function encodeCursor(position: CursorPosition): string;
   export function decodeCursor(encoded: string): CursorPosition | null;  // null on malformed input
   export function isValidCursor(encoded: unknown): boolean;
   ```
   `encodeCursor` JSON-stringifies + base64url-encodes. `decodeCursor` returns `null` for malformed input (gracefully handle stale clients sending old cursors); the route treats null as "first page" rather than 400.
3. **`getBriefArtefacts` signature change.** From:
   ```ts
   getBriefArtefacts(briefId: string, organisationId: string): Promise<Artefact[]>
   ```
   To:
   ```ts
   getBriefArtefacts(
     briefId: string,
     organisationId: string,
     opts?: { limit?: number; cursor?: CursorPosition | null },
   ): Promise<{ items: Artefact[]; nextCursor: string | null }>
   ```
   The query orders `conversation_messages.created_at DESC, conversation_messages.id DESC` (deterministic tiebreaker on identical timestamps) and applies the cursor as `(created_at, id) < (cursor.ts, cursor.msgId)` — strict less-than because the cursor row was already returned in the previous page.
   `nextCursor` is non-null iff the result set hit the limit AND a row exists past the limit. Compute by fetching `limit + 1` rows; if `result.length > limit`, drop the extra row and emit `nextCursor` from the last kept row.
4. **Existing call sites.** Internal callers of `getBriefArtefacts` that don't pass `opts` get the default `limit: 50, cursor: null` and a `{ items, nextCursor }` shape they didn't expect. Two options: (a) add a sibling `getAllBriefArtefacts(briefId, organisationId)` for full-fetch semantics that internal jobs / migrations can use, OR (b) update every caller to consume `result.items`. Pick (a) — simpler, less call-site churn, and the only remaining full-fetch consumer is the artefact-backstop path which is documented as "no-op until Phase 6.4" so no harm.
5. **Route handler.** Pass through `req.query.limit` (parse + clamp), `req.query.cursor` (decode via `decodeCursor`, treat null-on-malformed as "first page"), and return `{ items, nextCursor }` directly. The current response shape is just an array — switching to `{ items, nextCursor }` is a contract change; the client must update too (see client section below).

**Approach (client).**
1. **Initial fetch.** `BriefDetailPage.tsx` issues `GET /api/briefs/:id/artefacts?limit=50` on mount. Stores `items` in component state plus `nextCursor: string | null`.
2. **"Load older" affordance.** When `nextCursor` is non-null, render a small button/link "Load older artefacts" at the top of the artefact list (artefacts render newest-first per the existing UI; older is "scroll up"). Click fetches `?limit=50&cursor=<nextCursor>`, prepends results to state, updates `nextCursor`.
3. **Websocket-driven inserts.** New artefacts arriving via the existing `emitBriefArtefactNew` socket event continue to prepend to state — no change. The new artefact is "newer than the current top" so it does not interact with the cursor (cursors page backwards into history).
4. **Keep "Load older" simple.** No infinite-scroll observer, no scroll-position restoration. A button is enough for v1; testing-round users will exercise it deliberately. If scroll-restoration becomes necessary, route to a follow-up.

**Acceptance criteria.**
- A first-page request returns at most 50 artefacts (or up to `limit`, max 200) and a `nextCursor` if more exist.
- A page-2 request with the cursor returns the next 50 older artefacts; `nextCursor` is null when the end is reached.
- An invalid / stale cursor produces a first-page response (graceful), not a 400.
- Total artefacts across all pages match the unpaginated total.
- Client UI: "Load older" appears iff `nextCursor !== null`; clicking it appends older artefacts in correct chronological order; the button disappears when `nextCursor === null`.
- New artefacts arriving via websocket continue to render at the top of the list independent of pagination state.
- Internal callers using the new `getAllBriefArtefacts` (option (a) in step 4) still pull the full result.

**Tests.**
- `server/services/__tests__/briefArtefactCursorPure.test.ts` — round-trip encode/decode for a valid position, decode of garbage strings returns null, decode of empty string returns null, decode of valid-base64-but-not-JSON returns null.
- `server/services/__tests__/briefArtefactPaginationPure.test.ts` (NEW) — pure logic for "do we emit a nextCursor?" given a result set of size N and limit L (N < L → no cursor; N === L+1 → cursor from item L; N === L → no cursor (means we hit the limit but no more rows existed)).
- **Carved-out integration test** (allowed under §0.2): `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts` seeds a brief with 75 artefacts; first request returns 50 + cursor; second request returns 25 + null cursor; concatenation matches the seeded list in newest-first order.
- **Client manual smoke**: open a Brief with > 50 artefacts in dev; verify initial render shows 50; click "Load older", verify next 50 appear above (older). Note in `tasks/builds/<slug>/progress.md`.

**Dependencies.** None.

**Risk.** Low-medium. The contract change from `Artefact[]` to `{ items, nextCursor }` is breaking for any out-of-band consumer (internal scripts, tests). Mitigation: grep for callers of `getBriefArtefacts` and the route URL before shipping; update all consumers in the same commit. The artefact-backstop path is documented as no-op until Phase 6.4 — confirm before assuming it's safe.

**Definition of Done.** All acceptance criteria pass; pure tests added and green; integration test added and green; client smoke test recorded; `tasks/todo.md § N7` ticked off.

---

### §1.4 S3 — Surface inline error states on `DashboardPage` and `ClientPulseDashboardPage`

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — clientpulse-ui-simplification (2026-04-24)" → S3.

**Files.**
- `client/src/pages/DashboardPage.tsx` — error sites at lines 34-46 (the four parallel fetches) and the `.catch(() => ...)` patterns at lines 232-235 and 253.
- `client/src/pages/ClientPulseDashboardPage.tsx` — error sites at lines 57-71 (the socket merge / fetch flow).

**Goal.** Both dashboard pages currently swallow every fetch error with `console.error` and return null/empty. Users see a zero-state UI that's indistinguishable from "no data exists yet". During a testing round, every fetch failure gets misreported as a missing-data bug. Track per-source error state and render an inline retry banner so testers can see when fetches actually fail.

**Approach (DashboardPage.tsx).**
1. **Per-source error state.** Add a state object tracking which fetches failed:
   ```ts
   type DashboardErrorMap = {
     agents: boolean;
     activity: boolean;
     pulseAttention: boolean;
     clientHealth: boolean;
   };
   const [errors, setErrors] = useState<DashboardErrorMap>({
     agents: false, activity: false, pulseAttention: false, clientHealth: false,
   });
   ```
2. **Replace `.catch(() => ...)` with explicit error setters.** Today the parallel fetches at lines 232-235 use `.catch((err) => { console.error(...); return { data: ... } })`. Change each to set the corresponding error flag AND continue with the fallback shape:
   ```ts
   api.get('/api/agents').catch((err) => {
     logger.error('[Dashboard] agents fetch failed', err);
     setErrors(e => ({ ...e, agents: true }));
     return { data: [] };
   }),
   ```
   On retry success (next `setLoading(true)` cycle), clear the flag: `setErrors(e => ({ ...e, agents: false }));` at the start of the fetch chain.
3. **Inline retry banner component.** Add a small `<DashboardErrorBanner errors={errors} onRetry={refetchAll} />` rendered above the main grid. It shows up only when at least one error is true:
   ```tsx
   {Object.values(errors).some(Boolean) && (
     <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
       <p>Some data couldn't load: {failedSourceNames(errors).join(', ')}.</p>
       <button onClick={onRetry} className="mt-1 text-amber-700 underline">Retry</button>
     </div>
   )}
   ```
   `failedSourceNames` is a tiny pure helper mapping `errors` to user-friendly labels (`'agents' → 'Agents'`, `'activity' → 'Activity feed'`, etc.).
4. **Refetch handler.** `refetchAll` re-runs the same fetch chain. The existing `refetchApprovals` / `refetchActivity` / `refetchClientHealth` (lines 105-160) are per-source — pull a single `refetchAll` that calls them in parallel.
5. **Keep individual section refetch buttons unchanged.** The retry banner is global (top of page); per-section refresh affordances elsewhere on the page (if any) stay as-is. This change is additive.

**Approach (ClientPulseDashboardPage.tsx).**
1. **Per-source error state.** Same shape, scoped to ClientPulse fetches:
   ```ts
   type ClientPulseErrorMap = {
     summary: boolean;
     prioritised: boolean;
   };
   ```
   Adapt to the actual fetches in the file (read lines 57-71 to identify them; the pattern is the same).
2. **Socket-merge validation guard (sibling concern noted in S7).** S7 calls out that the socket merge at lines 74-79 lacks key validation. This spec does NOT fix S7 (out of scope); the new error state must NOT regress S7's current behaviour — keep the existing socket merge as-is.
3. **Inline retry banner.** Same component shape as DashboardPage. The two pages can share a `DashboardErrorBanner.tsx` component if the React tree allows it; if not, two siblings is fine — do NOT extract a generic primitive (out of §0.3 unless the architect names it).

**Acceptance criteria.**
- DashboardPage: when one fetch fails (simulate by setting an invalid endpoint or by stopping the dev server mid-fetch), the banner appears naming the failed source. The rest of the dashboard renders with empty data for that source. Clicking Retry re-runs the fetch; on success the banner disappears.
- DashboardPage: when no fetches fail, the banner does NOT render.
- ClientPulseDashboardPage: same behaviours, scoped to its two/three fetches.
- "No data" empty state and "fetch failed" error state are visually distinct — testers can tell at a glance which is which.
- No regression of existing live-polling, websocket merging, or auth-redirect behaviours.

**Tests.**
- Pure helper test: `failedSourceNames({ agents: true, activity: false, ... })` returns the expected human-readable list. Place in a `*Pure.ts` companion to keep DashboardPage testable without React Testing Library.
- **Manual browser smoke test.** With dev server running, simulate fetch failure by:
  1. Stopping the API server temporarily, refresh the page, observe banner.
  2. Restarting the API, click Retry, observe banner clears.
  3. Repeat per page. Note results in `tasks/builds/<slug>/progress.md`.
- No new client-side integration test framework introduced (per §0.3).

**Dependencies.** None.

**Risk.** Very low. Additive UI change; no existing flow is removed. The only regression vector is the per-source error state introducing re-render thrash if `setErrors` runs on every fetch — mitigate by setting only when the error flag actually changes (`setErrors(e => e.agents === true ? e : { ...e, agents: true })`).

**Definition of Done.** All acceptance criteria pass; pure helper test green; manual smoke recorded; `tasks/todo.md § S3` ticked off.

---

## §2 Sequencing

The four items can ship in any order. Recommended sequence minimises rework:

1. **§1.4 S3** (dashboard error states) — pure additive client change; ship first to give the testing round visible error feedback even before the deeper plumbing items land.
2. **§1.3 N7** (paginate brief artefacts) — server contract change. Ship before §1.1 DR2 so the consumer side is stable when DR2 starts producing more follow-up artefacts during testing.
3. **§1.2 S8** (post-commit websocket emits) — touches `briefConversationWriter` which both §1.1 DR2 and §1.3 N7 depend on transitively. Lands the post-commit primitive before DR2 increases the message-write traffic.
4. **§1.1 DR2** (follow-up re-invocation) — biggest user-visible change; ship last so the previous three are in place to absorb the increased follow-up traffic and produce visible signal during testing.

**Branch.** Single feature branch (suggested name `claude/pre-test-brief-and-ux`). Each §1.x ships as its own commit so review can proceed item-by-item. Final PR consolidates all four commits.

**Pre-merge gates.**
- `npx tsc --noEmit` passes.
- `bash scripts/run-all-unit-tests.sh` passes.
- `npm run build:client` passes (UI changes affect the client bundle).
- The carved-out integration tests in §1.1 / §1.2 / §1.3 pass.
- Manual browser smoke for §1.4 S3 (both dashboard pages) and §1.3 N7 (Brief pagination) recorded.
- `npm run test:gates` is the merge-gate per the gate-cadence rule in CLAUDE.md — run only at PR-finalisation time.

---

## §3 Out of scope

Items deliberately excluded from this spec; route to follow-up work or separate specs as noted.

- **DR2 non-Brief scopes (`task` / `agent_run`).** The deferred-item note explicitly carves this out — non-Brief scopes need design for orchestration enqueue, idempotency for passive acks, and inline-artefact follow-up rules. This spec ships ONLY the brief branch. A future spec covers them.
- **S7 — `ClientPulseDashboardPage` socket merge validation.** Sibling concern raised in the same review pass; this spec deliberately leaves S7's socket merge as-is to keep §1.4's surface narrow.
- **DR1 + DR3 (Universal Brief approval write paths).** Already shipped in `main` (verified during the 2026-04-28 audit triage). Not part of this spec.
- **B10 (maintenance jobs `withAdminConnection` wrap).** Already shipped (verified in `server/jobs/ruleAutoDeprecateJob.ts`). Not part of this spec.
- **CGF6 (idempotency key for `saveRule`).** Out of scope — separate Brief follow-up PR.
- **N3, N5, N6, S2, S4, S6** — covered by the pair backend-hardening spec or routed to other follow-ups.
- **Tx-outbox pattern for §1.2.** Considered and rejected per §1.2 step 5; the request-scoped `res.finish` deferral is sufficient for the failure mode being closed. Defer tx-outbox until a cross-process durability requirement surfaces.
- **Infinite-scroll / scroll-position restoration for §1.3 N7.** A "Load older" button is sufficient for v1. Defer until testing surfaces a concrete UX issue.
- **Generic `<ErrorBanner>` component for §1.4 S3.** Per §0.3, no new shared primitive unless named. Two sibling banners (one per page) is fine; promote to a shared component only when a third use case surfaces.
- **Any item outside the explicit §1 list.** Per §0.3, scope expansion during implementation is forbidden — log to `tasks/todo.md` and continue.

---

## §4 Definition of Done

The spec is complete when ALL of the following hold:

1. Each §1.x item's per-item Definition of Done is met.
2. `tasks/todo.md` reflects every closed item with a `[x]` mark and a one-line resolution note pointing at the commit SHA or PR number.
3. The branch passes the §2 pre-merge gates.
4. The PR description summarises which items shipped and links to the relevant `tasks/todo.md` lines.
5. `tasks/builds/<slug>/progress.md` carries the final session-end summary.
6. `KNOWLEDGE.md` is updated with the post-commit emit pattern from §1.2 (it generalises beyond Brief artefacts and is the most reusable pattern surfaced by this spec).

---

## §5 Tracking

Per-item status table — single source of truth. Update after each commit.

| Item | Status | Commit SHA | Notes |
|------|--------|------------|-------|
| §1.1 DR2 | pending | — | — |
| §1.2 S8 | pending | — | — |
| §1.3 N7 | pending | — | — |
| §1.4 S3 | pending | — | — |

**Backlog tickoff checklist** — when each item closes, mark the corresponding line in `tasks/todo.md`:

- [ ] DR2 in `tasks/todo.md § Deferred from dual-reviewer review — Universal Brief`
- [ ] S8 in `tasks/todo.md § Deferred from pr-reviewer review — Universal Brief`
- [ ] N7 in `tasks/todo.md § Deferred from pr-reviewer review — Universal Brief`
- [ ] S3 in `tasks/todo.md § Deferred from pr-reviewer review — clientpulse-ui-simplification`

