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
  - [§0.5 Critical invariants index](#05-critical-invariants-index)
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
| `server/services/briefConversationService.ts` (return-type extension only — see §1.1 Approach step 2) | §1.1 | — |
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

### §0.5 Critical invariants index

Quick-reference list of the contracts this spec establishes. Any change to the codebase that would weaken one of these requires re-reviewing the corresponding §1 item before merge.

- **DR2 — Branch-before-write mutual exclusion.** `routes/conversations.ts` MUST branch on `selectConversationFollowUpAction(conv)` BEFORE any call to `writeConversationMessage`. The brief branch goes through `handleConversationFollowUp`; the noop branch calls `writeConversationMessage` directly. The two paths are mutually exclusive — never both, never inline write before branching. Source: §1.1 Approach steps 2–3.
- **DR2 — `writeConversationMessage` dedupe semantics.** DR2's "no duplicate user messages on retry" guarantee depends on `writeConversationMessage` providing duplicate-message suppression for identical `(conversationId, content)` writes. Any change to its dedupe key, window, or removal of dedupe entirely MUST trigger a DR2 re-review. Source: §1.1 Approach step 5.
- **DR2 — Uniform response shape.** `POST /api/conversations/:id/messages` returns `{ ...message, route, fastPathDecision }` on every successful response. `route` and `fastPathDecision` are populated for the brief branch and `null` for the noop branch — never `undefined`, never omitted. Source: §1.1 Approach step 4.
- **S8 — Middleware ordering.** `postCommitEmitterMiddleware` MUST be mounted AFTER the org-tx middleware in `server/index.ts`. Mounting it earlier breaks the emit-after-commit guarantee and re-introduces ghost emits. Source: §1.2 Approach step 2.
- **S8 — Closed-store immediate emit.** Once `flushAll()` or `reset()` runs, the post-commit store transitions to closed. Subsequent `enqueue(emit)` calls execute `emit` immediately rather than queuing. Without this, post-`res.finish` async continuations silently drop their emits. Source: §1.2 Approach step 1.
- **N7 — `created_at` monotonicity.** Backward pagination over `conversation_messages` is duplicate-safe under concurrent inserts ONLY while every new row's `created_at` is ≥ every existing row's. Currently true via `created_at = now()` and single-primary writes. Violations (clock skew, replication, manual backdated inserts) force client-side `msgId` dedupe as the required fallback until the violation source is fixed. Source: §1.3 Pagination consistency model.

---

## §1 Items

### §1.1 DR2 — Re-invoke fast-path + Orchestrator on follow-up conversation messages

**Source.** `tasks/todo.md` § "Deferred from dual-reviewer review — Universal Brief" → DR2. Spec: `docs/universal-brief-dev-spec.md` §7.11 / §7.12 ("Re-invokes the fast path + Orchestrator if the message looks like a follow-up intent rather than a passive 'thanks'").

**Files.**
- `server/routes/conversations.ts` — `POST /api/conversations/:conversationId/messages` handler at lines 74-105.
- `server/services/briefConversationService.ts` — `handleConversationFollowUp` already exported (used by `routes/briefs.ts`); this spec extends its return type to additionally surface the written conversation message (one extra capture + return field — see Approach step 2).
- `server/services/__tests__/conversationsRoutePure.test.ts` (NEW — pure tests for the scope-dispatch predicate).

**Goal.** When a user posts a follow-up message to `/api/conversations/:conversationId/messages`, the handler currently writes the user message and returns. For Brief-scoped conversations, the spec requires the handler to ALSO re-invoke the fast-path classifier and (where appropriate) re-enqueue the Orchestrator. The plumbing already exists in `briefConversationService.handleConversationFollowUp` — this item wires it into the polymorphic conversations route. Non-Brief scopes (`task`, `agent_run`) remain out of scope per the deferral note (covered in §3).

**Write-path invariant (mandatory contract).** Stated explicitly so future refactors cannot silently reintroduce a duplicate write:

> **For `scopeType === 'brief'`:** the route MUST NOT call `writeConversationMessage` directly. ALL message writes for the brief branch MUST go through `handleConversationFollowUp` (which calls `writeConversationMessage` internally at briefConversationService.ts:141).
>
> **For all other scope types (`task`, `agent_run`, …):** the route MUST NOT call `handleConversationFollowUp`. Message writes go through the inline `writeConversationMessage` call.
>
> The two paths are mutually exclusive — branch FIRST on scope, write SECOND. Never write inline before branching.

**Approach.**
1. **Pure scope-dispatch predicate.** Extract a tiny pure helper `selectConversationFollowUpAction(conv) → 'brief_followup' | 'noop'` that returns `'brief_followup'` iff `conv.scopeType === 'brief'`. All other scope types return `'noop'` for v1. Place in a new `server/services/conversationsRoutePure.ts` (since `routes/*` lacks a `*Pure` companion convention; mirror the pattern from `chatTriageClassifierPure.ts`).
2. **Extend `handleConversationFollowUp` to return the written message.** Currently `handleConversationFollowUp` returns `{ route, fastPathDecision }` and discards the result of its internal `writeConversationMessage` call (briefConversationService.ts:141). Capture that result and add it to the return:
   ```ts
   // briefConversationService.ts — minimal extension
   export async function handleConversationFollowUp(input: {...})
     : Promise<{ message: ConversationMessage; route: DispatchRoute; fastPathDecision: FastPathDecision }> {
     // ...
     const message = await writeConversationMessage({ /* unchanged args */ });
     const dispatch = await handleBriefMessage({ /* unchanged args */ });
     return { message, ...dispatch };
   }
   ```
   This is the only change to `briefConversationService.ts` — no behavioural change, no new primitive, just surfacing data that already exists internally. Required so the route's brief branch can produce the same `{ ...message, route, fastPathDecision }` response shape as the noop branch (see step 4).
3. **Wire `handleConversationFollowUp` into the route — branch BEFORE any write.** In `routes/conversations.ts:75-105`, after the existing `assertCanViewConversation` check, branch on `selectConversationFollowUpAction(conv)` BEFORE any call to `writeConversationMessage`. The current route writes the message inline first; the new structure inverts that order so the brief branch returns early without ever invoking the inline writer:
   ```ts
   // Branch FIRST — do not touch writeConversationMessage above this point.
   const action = selectConversationFollowUpAction(conv);

   if (action === 'brief_followup') {
     // briefId is stored on conv.scopeId for scopeType === 'brief'.
     // handleConversationFollowUp owns the message write internally and
     // (per step 2) returns the message alongside the dispatch result.
     const result = await handleConversationFollowUp({
       conversationId,
       briefId: conv.scopeId,
       organisationId: req.orgId!,
       subaccountId: conv.subaccountId ?? null,
       text: content.trim(),
       uiContext: { source: 'conversations_route' },
       senderUserId: req.user!.id,
     });
     res.status(201).json({
       ...result.message,
       route: result.route,
       fastPathDecision: result.fastPathDecision,
     });
     return;
   }

   // 'noop' branch — task / agent_run scopes. Inline write is the ONLY
   // write path here; handleConversationFollowUp is never invoked.
   const messageWriteResult = await writeConversationMessage({ /* ... existing args ... */ });
   res.status(201).json({
     ...messageWriteResult,
     route: null,
     fastPathDecision: null,
   });
   ```
   **Why early-return.** Inverting the order eliminates the failure mode where a future refactor re-orders the inline write above the branch and silently produces two user messages per Brief follow-up. The structural property (write happens in exactly one of two mutually-exclusive branches) is now visible in the code shape, not just stated as an invariant.
4. **Response shape — uniform, never polymorphic.** Both branches return the same JSON keys: `{ ...message, route, fastPathDecision }`. The brief branch populates `route` and `fastPathDecision` from `handleConversationFollowUp`'s result; the noop branch sets both to `null`. Frontend code consumes a single non-discriminated shape — no `if (response.route !== undefined)` branching. This is the contract.
5. **Idempotency for follow-up re-invocation.** `handleBriefMessage` (called inside `handleConversationFollowUp`) performs `classifyChatIntent` and conditionally enqueues the orchestrator. Idempotency is the existing concern of those primitives, NOT a new contract this spec introduces. If the same message is posted twice (network retry), the duplicate-message detection in `writeConversationMessage` already short-circuits the second write — verify this assumption holds by reading the function before shipping. If it does not, surface as a §1.1 implementation blocker (not a scope expansion).

   **Dependency invariant (tripwire for future maintainers).** DR2 depends on `writeConversationMessage` providing duplicate-message suppression for identical `(conversationId, content)` writes within a short window. If that suppression is weakened, removed, or has its dedupe key changed (including for performance reasons), DR2's "no duplicate user messages on retry" acceptance criterion regresses silently. Any change to `writeConversationMessage`'s dedupe semantics MUST trigger a re-review of this section. This is documentation, not enforcement — the next person modifying the writer sees the constraint here, not in a runtime check.
6. **Subaccount context.** `conversations.subaccountId` is the canonical source. The route currently does not read `conv.subaccountId` because the direct `writeConversationMessage` call passes `subaccountId: undefined`. The new branch must pass `conv.subaccountId ?? null` through — `handleConversationFollowUp` requires it for orchestrator-routing context.
7. **Non-Brief scopes (task / agent_run).** The original deferral note explicitly carves these out:
   > "Architectural scope — needs design for non-Brief scopes (`task`, `agent_run`) that don't currently enqueue orchestration, idempotency for passive acks, and whether simple_reply/cheap_answer can produce new inline artefacts on follow-ups."
   This spec ships ONLY the brief branch. The `'noop'` branch matches the route's pre-spec behaviour for `task` / `agent_run`. A future spec covers them.
8. **Telemetry log.** On entry to the brief-followup branch, emit a structured info log `conversations_route.brief_followup_dispatched` with `{ conversationId, briefId, organisationId, fastPathDecisionKind: result.fastPathDecision.kind }` so the testing round can confirm the wiring fires from real traffic.

**Acceptance criteria.**
- `POST /api/conversations/:id/messages` against a Brief-scoped conversation: writes the user message exactly once (no duplication), invokes `classifyChatIntent`, and re-enqueues `orchestratorFromTaskJob` for `needs_orchestrator` / `needs_clarification` decisions.
- Same endpoint against a `task` or `agent_run`-scoped conversation: writes the user message and returns 201 (existing behaviour preserved).
- **Uniform response shape.** Both branches return `{ ...message, route, fastPathDecision }`. Brief branch populates `route` and `fastPathDecision`; noop branch sets both to `null`. The keys are present on every successful response — never `undefined`, never omitted.
- **Write-path mutual exclusion.** A code-grep over `routes/conversations.ts` shows exactly one call to `writeConversationMessage` and exactly one call to `handleConversationFollowUp`, both inside scope-discriminated branches; neither call appears outside its branch. Verified by reading the diff before merge.
- A duplicate POST with the same `(conversationId, content)` does not produce two user messages (existing duplicate-detection in `writeConversationMessage` is honoured by both branches — the brief branch via `handleConversationFollowUp`'s internal call, the noop branch directly).
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
     readonly isClosed: boolean;
   }

   // AsyncLocalStorage-backed singleton; the middleware (below) creates a
   // fresh store per request and binds it to the async context.
   export function getPostCommitStore(): PostCommitStore | null;
   export function runWithPostCommitStore<T>(store: PostCommitStore, fn: () => Promise<T>): Promise<T>;
   ```
   Implementation uses `node:async_hooks` `AsyncLocalStorage<PostCommitStore>`. The store has three observable states:
   - **Open** — initial state; `enqueue(emit)` appends to an in-memory array.
   - **Closed** — entered after `flushAll()` or `reset()` runs; further `enqueue(emit)` calls MUST execute the emit immediately (do not append). Identical to the no-store fallback (see step 3).
   - **Absent** — caller has no bound store at all (job workers, cron); `getPostCommitStore()` returns `null`.

   `flushAll` iterates the queue and invokes each emit (best-effort — if one throws, log and continue), then transitions the store to closed and clears the queue. `reset` clears the queue without invoking any emits, then transitions to closed. **Both `flushAll` and `reset` are terminal — once closed, the store cannot reopen for the remainder of the request.** Calling either method twice is a no-op (queue already empty, state already closed).

   **Why closed → immediate emit (not silent drop).** Without this, an async continuation that runs after `res.finish` (e.g. a fire-and-forget orchestrator enqueue inside the request handler that schedules a `writeConversationMessage` further along its async chain) would land its emits on a dead queue and silently lose them. The closed-store fallback collapses this to the same code path as job-worker callers: there is no request lifecycle to wait for, so emit immediately. The two failure modes the deferral was set up to close are still closed: (a) tx-rollback-then-emit cannot occur because rollback happens inside the request and the queue is dropped via the 4xx/5xx branch in step 2 BEFORE close, (b) premature-disconnect-then-emit cannot occur because `res.close` runs `reset()` BEFORE the store is closed, dropping enqueued emits. The closed-state fallback covers ONLY the post-`res.finish` async-continuation case where the request already succeeded.
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

   **Middleware ordering invariant (mandatory contract).** `postCommitEmitterMiddleware` MUST be mounted AFTER the org-tx middleware in `server/index.ts`. Mounting it before, or at a position that escapes the tx-middleware's async context, breaks the "emit-after-commit" guarantee — enqueues that occur inside `withOrgTx` callbacks would land on a store bound to a parent async context, which may flush before the inner tx commits, reintroducing the ghost-emit failure mode this spec is closing. Any refactor of `server/index.ts` middleware order MUST preserve this ordering. Verified at PR-review time by direct inspection of the mount sequence; no runtime assert (the tx middleware does not currently expose a request flag this primitive could check, and adding one is out of scope per §0.3).
3. **Refactor `briefConversationWriter.ts`.** Replace the three direct emit calls with enqueues. `enqueue` itself handles the closed-store fallback, so callers don't branch on `isClosed`:
   ```ts
   const store = getPostCommitStore();
   if (store) {
     // store.enqueue handles BOTH open (append) AND closed (immediate emit)
     // states — caller does not need to inspect store.isClosed.
     store.enqueue(() => emitConversationUpdate(input.conversationId, 'conversation-message:new', { ... }));
     // ... and similarly for emitBriefArtefactNew / emitBriefArtefactUpdated
   } else {
     // Absent-store fallback: jobs / cron / non-request callers have no
     // bound store. Emit directly — there is no request lifecycle to wait
     // for. Behaviourally identical to the closed-store path inside enqueue.
     emitConversationUpdate(input.conversationId, 'conversation-message:new', { ... });
   }
   ```
   The fallback is critical for callers that invoke `writeConversationMessage` from job workers (e.g. orchestrator-from-task) — those have no `res.finish` to wait for; emits there fire as soon as the writer commits.
4. **Tx-vs-emit ordering.** The middleware runs OUTSIDE the request's org transaction (`withOrgTx` is per-route, started inside route handlers). The store is bound to the async context for the whole request, including inside any `withOrgTx` block. An enqueue happens during the tx; the actual emit fires post-`res.finish`, which is post-commit. **No new tx integration required.**
5. **Why not a tx-outbox table?** The deferred-item note suggests "defer emits until `res.finish`, OR adopt a tx-outbox pattern." This spec picks the simpler one — `res.finish` is sufficient because the failure mode being closed (tx rollback emitting ghost events) is a request-scoped concern, not a cross-process durability concern. A tx-outbox would survive process crashes, but a process crash mid-request is a separate failure class and the lost emit is acceptable (clients reconnect and refetch on websocket reconnect — the same fallback the rest of the system uses).
6. **Logging.** Three structured log lines so the testing round has full visibility:
   - `post_commit_emit_flushed { requestId, emitCount }` — emitted by `flushAll()` on success path. Confirms the deferral pattern is firing.
   - `post_commit_emit_dropped { requestId, droppedCount, statusCode }` — emitted on `res.finish` with `statusCode >= 400` (or on `res.close` regardless of status). Confirms ghost-emit prevention is firing.
   - `post_commit_emit_fallback { reason: 'no_store' | 'closed_store' }` — emitted at the immediate-emit code path inside `enqueue` (closed_store) and at the absent-store branch in `briefConversationWriter` (no_store). Tells us during debugging when an emit fired immediately rather than via the deferral queue. Both reasons are expected — `no_store` for every job-worker emit, `closed_store` for any post-`res.finish` async continuation. A spike in `closed_store` would indicate a code path doing more async work than the request lifecycle accounts for; worth investigating but not an error.

**Acceptance criteria.**
- A successful `POST /api/briefs/:id/messages` (200/201) results in: DB row written → tx committed → response sent → `res.finish` fires → enqueued emits flush. Verifiable by log ordering.
- A failed POST that returns 4xx/5xx after the writer ran (contrived test): DB row written-then-rolled-back via outer error → enqueued emit dropped via the `statusCode >= 400` branch. NO websocket event reaches clients.
- A premature client disconnect (`res.on('close')` fires before `'finish'`): enqueued emits dropped.
- Job-worker callers of `writeConversationMessage` (no request store): emits fire inline (fallback branch); `post_commit_emit_fallback { reason: 'no_store' }` logged.
- **Post-`res.finish` async continuation:** an async path that calls `writeConversationMessage` AFTER `flushAll`/`reset` has run does NOT silently drop the emit — `enqueue` detects the closed state and executes the emit immediately; `post_commit_emit_fallback { reason: 'closed_store' }` logged. This is the failure mode the closed-state fallback closes.
- Idempotent re-flush: if `flushAll` is called twice on the same store (defensive double-trigger), the second call is a no-op (queue cleared and state already closed after first flush).
- The `post_commit_emit_flushed`, `post_commit_emit_dropped`, and `post_commit_emit_fallback` log entries appear with the documented fields.
- **Middleware mount-order verification.** A direct inspection of `server/index.ts` confirms `postCommitEmitterMiddleware` is registered AFTER the org-tx middleware in the request pipeline. Captured in the PR description so the ordering is reviewable on every future change to the middleware stack.

**Tests.**
- `server/lib/__tests__/postCommitEmitter.test.ts` — cover:
  1. `enqueue` then `flushAll` invokes the emit exactly once and transitions the store to closed (`isClosed === true` after).
  2. `enqueue` then `reset` invokes nothing and transitions the store to closed.
  3. `flushAll` after `reset` invokes nothing (queue clear, state already closed).
  4. `flushAll` with one emit that throws — second emit still runs (best-effort).
  5. **Closed-state fallback:** `flushAll()` then `enqueue(emit)` — the post-flush enqueue MUST execute `emit` synchronously (not queue it), `isClosed` remains `true`, no second flush needed.
  6. **Reset-then-enqueue closed-state fallback:** `reset()` then `enqueue(emit)` — same behaviour as case 5; reset path also leaves the store closed.
  7. `runWithPostCommitStore` binds the store to the async context — `getPostCommitStore()` inside the callback returns the bound store; outside returns null.
  8. Concurrent requests get isolated stores (run two `runWithPostCommitStore` calls in parallel; assert their enqueues do not bleed).
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

**Pagination consistency model (durable contract).** Stated upfront so future readers don't re-prosecute the question.

> **Direction.** This pagination is BACKWARD-only. Page 1 returns the newest 50 artefacts; "Load older" returns the next 50 older. There is no "fetch newer than the cursor" semantic — newer artefacts arrive via the existing `emitBriefArtefactNew` websocket event and prepend to the in-memory list.
>
> **Why backward pagination is duplicate-safe under concurrent inserts.** New artefacts produced after the user's first page load have `created_at > cursor.ts` (because `conversation_messages.created_at = now()` at insert time and inserts are monotonic with wall-clock). The "Load older" query fetches `(created_at, id) < (cursor.ts, cursor.msgId)` — a strict bound that EXCLUDES every artefact newer than the cursor. New artefacts therefore reach the client via websocket and never via cursor pagination; there is no overlap, no duplicate, no skip.
>
> **Tiebreaker.** Two rows with identical `created_at` are disambiguated by the `id` column (UUID v4, lexicographic order) in both ORDER BY and the cursor predicate. This guarantees deterministic ordering even at sub-millisecond timestamp collisions.
>
> **Monotonicity assumption (explicit).** The pagination guarantee relies on `created_at` being monotonic per insert — i.e., every new row's `created_at` is `≥` every existing row's `created_at` at the moment of insert. True in this codebase given `conversation_messages.created_at = now()` and single-primary write semantics; not universally guaranteed in distributed systems (clock skew across nodes, replication lag, manual maintenance scripts inserting backdated rows would all violate it). If this invariant is violated, duplicate or skipped artefacts may occur and **client-side dedupe by `msgId` is the required fallback** until the monotonicity violation is fixed at the source.
>
> **What is explicitly out of scope.** Defensive measures against monotonicity violations (snapshot upper bound, server-side dedup, etc.) — not added in v1 because the violation is not currently possible. If a future code path introduces a backdated-insert pattern, this contract requires re-evaluation.

**Approach (server).**
1. **Query-param shape.** Match the existing cursor-pagination convention from `clientPulseHighRiskService.getPrioritisedClients`:
   ```
   GET /api/briefs/:briefId/artefacts?limit=50&cursor=<opaque>
   ```
   - `limit?: number` — default 50, max 200, validated as integer in `[1, 200]`. Out-of-range values clamp to the bound (do NOT 400). When clamping occurs, log `brief_artefacts.limit_clamped { briefId, requested, applied }` so the testing round can see whether clients are sending bad limits and whether the clamp ever silences a real bug. Log only on actual clamp (when `requested !== applied`); do not log every request.
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
- A request with `limit` outside `[1, 200]` (e.g. `limit=0`, `limit=500`, `limit=-1`) returns a clamped response (limit applied at 1 / 200 / 1 respectively) AND emits exactly one `brief_artefacts.limit_clamped` log entry per request with the requested vs applied values. A request with a valid limit emits zero clamping logs.
- Total artefacts across all pages match the unpaginated total.
- **Concurrent-insert duplicate-freedom.** Run a 3-step interleave: load page 1 → insert 5 new artefacts (simulating websocket arrivals at the top) → load page 2 with the page-1 cursor. The page-2 result MUST NOT contain any of the 5 newly-inserted artefacts (they are newer than the cursor) and MUST contain the next 50 older artefacts uninterrupted. Verifies the consistency model is honoured by the query.
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
2. **Atomic error-state lifecycle — set ONCE per fetch cycle, not per promise.** Per-promise `setErrors(e => ({ ...e, agents: true }))` calls produce two failure modes that interact badly with React's render scheduling and parallel fetches:
   - **Stale-fetch race.** Cycle A starts → user clicks Retry mid-flight → cycle B starts (resets all flags) → cycle A's late `.catch` fires → re-sets `agents: true` based on cycle A's stale closure, even though cycle B is already in flight or complete.
   - **Inconsistent UI snapshots.** With four parallel fetches, four sequential `setErrors` calls produce three intermediate render states where some flags reflect cycle N and others reflect cycle N-1.

   Use a per-cycle local-flag pattern instead. Every fetch cycle owns its own error map locally; state commits exactly once after `Promise.all` settles:
   ```ts
   async function refetchAll() {
     // Track results in cycle-local flags — never touch React state mid-cycle.
     const cycleErrors: DashboardErrorMap = {
       agents: false, activity: false, pulseAttention: false, clientHealth: false,
     };

     const [agentsRes, activityRes, pulseRes, healthRes] = await Promise.all([
       api.get('/api/agents').catch((err) => {
         logger.error('[Dashboard] agents fetch failed', err);
         cycleErrors.agents = true;
         return { data: [] };
       }),
       api.get('/api/activity').catch((err) => {
         logger.error('[Dashboard] activity fetch failed', err);
         cycleErrors.activity = true;
         return { data: [] };
       }),
       // ... pulseAttention, clientHealth — same shape
     ]);

     // Single atomic commit: reset + re-set in one render. No interleaved state.
     setErrors(cycleErrors);
     // Apply data results (existing code — agentsRes.data → setAgents(), etc.)
   }
   ```
   **Why this is structurally correct, not just stylistic.** A single `setErrors(cycleErrors)` call replaces the entire error map atomically — no stale per-promise `setErrors` updates can land. If a stale cycle's `Promise.all` settles after a newer cycle has already committed its `cycleErrors`, the stale `setErrors` call still happens but is overwritten on the next cycle's commit; in the gap between, the user sees the stale-but-internally-consistent error map (not the inconsistent partial map the per-promise pattern produces). For full stale-cycle protection, a cycle counter check (`if (myCycle === currentCycleRef.current)`) can wrap the final `setErrors` — ship the simpler version first; add the counter only if the testing round surfaces a stale-snapshot regression.
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
- **Atomic error-state commits.** During a fetch cycle, `setErrors` is called exactly once (not once per promise). Verifiable via React DevTools render-tracing: a single state update per `refetchAll` invocation, regardless of how many of the four fetches failed.
- **Mid-cycle Retry safety.** Triggering Retry while a previous cycle's fetches are still in-flight does not produce flicker: the new cycle's eventual `setErrors(cycleErrors)` overwrites the stale cycle's errors atomically, so the UI never displays a partially-merged error map.
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

**Risk.** Very low. Additive UI change; no existing flow is removed. The atomic-commit pattern (one `setErrors` per cycle, see Approach step 2) avoids re-render thrash by construction — there is no per-promise state update to thrash. The only remaining regression vector is the stale-cycle race in Approach step 2; mitigated structurally (newer cycle's commit overwrites stale cycle's commit) and escalation path documented (cycle-counter ref guard) if testing surfaces it.

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
| §1.1 DR2 | done | `4d64df6d` | branch-before-write; uniform response; predicate + DB integration tests |
| §1.2 S8 | done | `60a68d07` | AsyncLocalStorage postCommitEmitter; 8-case unit test; lifecycle integration test |
| §1.3 N7 | done | `04613015` | cursor pagination; pure tests; integration test (skips if no seeded DB) |
| §1.4 S3 | done | `6ef1ea79` | cycle-local error state; DashboardErrorBanner; pure test + 2 pages |

**Backlog tickoff checklist** — when each item closes, mark the corresponding line in `tasks/todo.md`:

- [ ] DR2 in `tasks/todo.md § Deferred from dual-reviewer review — Universal Brief`
- [ ] S8 in `tasks/todo.md § Deferred from pr-reviewer review — Universal Brief`
- [ ] N7 in `tasks/todo.md § Deferred from pr-reviewer review — Universal Brief`
- [ ] S3 in `tasks/todo.md § Deferred from pr-reviewer review — clientpulse-ui-simplification`

