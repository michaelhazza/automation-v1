# Pre-Launch Dead-Path Completion — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 3
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `1cc81656138663496a09915db28587ffd83fbddc`)
**Architect input:** `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md` (commit SHA: `6bbbd737d48b9393146cd35f4930c0efdbb1be54`)
**Implementation order:** `1 → {2, 4, 6} → 5 → 3` (Chunk 3 lands LAST — depends on RLS + schema + execution-correctness foundations)
**Status:** draft, ready for user review

---

## Table of contents

1. Goal + non-goals
2. Items closed
3. Items NOT closed
4. Key decisions (per architect output)
5. Files touched
6. Implementation Guardrails
7. Test plan
8. Done criteria
9. Rollback notes
10. Deferred Items
11. Review Residuals
12. Coverage Check

---

## 1. Goal + non-goals

### Goal

Wire up the four silently-dead write paths the product surfaces today, so the testing round runs against a fully-functional Brief approval flow, conversation-follow-up agent-run path, rule-drafting endpoint, and post-approval automation dispatch.

After Chunk 3 lands:

- BriefApprovalCard's approve/reject buttons end-to-end functional with execution record linkage (DR3).
- Follow-up messages in any Brief surface re-invoke fast-path or Orchestrator via `classifyChatIntent` (DR2).
- `POST /api/rules/draft-candidates` returns 200 with valid `candidates[]` payload (DR1).
- Approved review-gated `invoke_automation` steps actually dispatch their webhook (C4a-REVIEWED-DISP).

### Non-goals

- Adding follow-up re-invocation for non-Brief scopes (`task`, `agent_run`). Per DR2 architect resolution: explicitly excluded; those surfaces don't currently enqueue orchestration; adding them is a new feature.
- Async post-approval dispatch. C4a-REVIEWED-DISP architect resolution picks Option A (synchronous resume) for v1; pg-boss enqueue is a documented Deferred Item.
- Skill error envelope migration. DR1 uses the legacy flat `{ error: string }` matching `rules.ts` precedent; envelope migration is bound to Chunk 5 C4a-6-RETSHAPE.

---

## 2. Items closed

All 4 cited items are truly open (verified 2026-04-26 — no surrounding work has closed any of them):

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `DR3` | 371 | "DR3 — wire approve/reject actions on `BriefApprovalCard` artefacts" | New `briefApprovalService.decideBriefApproval()` + new POST route + superseding-artefact pattern. See § 4.1. |
| `DR2` | 370 | "DR2 — re-invoke fast-path + Orchestrator on follow-up conversation messages" | `classifyChatIntent` gate on follow-ups; `simple_reply` skips Orchestrator; non-Brief scopes excluded; shared `handleBriefMessage()` helper extracted. See § 4.2. |
| `DR1` | 369 | "DR1 — add `POST /api/rules/draft-candidates` route" | New POST handler in `server/routes/rules.ts` with `authenticate + requireOrgPermission(BRIEFS_WRITE)`. Calls `ruleCandidateDrafter.draftCandidates(...)`. See § 4.3. |
| `C4a-REVIEWED-DISP` | 665 | "Review-gated `invoke_automation` steps never dispatch after approval" | Option A — dedicated resume path. New `WorkflowEngineService.resumeInvokeAutomationStep()`; `decideApproval` routes `invoke_automation` step type to it instead of `completeStepRun`. See § 4.4. |

Verified state on 2026-04-26:

- DR1: `grep "draft-candidates" server/routes/rules.ts` → no matches. Route still missing.
- DR2: `briefConversationService.ts` has no `classifyChatIntent` call; only `briefCreationService.ts` does. Follow-ups still one-way.
- DR3: `client/src/components/brief-artefacts/ApprovalCard.tsx` exists; `onApprove`/`onReject` not wired (per mini-spec).
- C4a-REVIEWED-DISP: `server/services/workflowRunService.ts:537 decideApproval` → calls `completeStepRun` at lines 503, 581 unconditionally; no step-type-aware routing.

---

## 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Follow-up re-invocation for non-Brief scopes (`task`, `agent_run` conversations) | Architect explicitly excludes; those surfaces don't currently enqueue orchestration; new feature | Post-launch feature backlog |
| Async post-approval dispatch (pg-boss enqueue) | v1 picks synchronous resume; webhooks typically <30s | `## Deferred Items` § 10 below |
| Skill error envelope migration in `rules.ts` | Bound to Chunk 5 C4a-6-RETSHAPE branch decision | Chunk 5 spec § 4.3 |
| Conversation-level rate limiting (DR2 spam protection) | Architect-flagged open question | `## Open Decisions` (§ Review Residuals) |
| Brief-approval second-tier human approval (high-risk action chain) | Architect recommends single-gate | `## Open Decisions` (§ Review Residuals) |

---

## 4. Key decisions (per architect output)

Each decision below is a verbatim distillation of the architect's resolution document at `tasks/builds/pre-launch-hardening-specs/architect-output/dead-path-completion.md`. The architect SHA `6bbbd737` is pinned in front-matter; any amendment of that file requires re-pinning per invariant 5.5.

### 4.1 DR3 — BriefApprovalCard approve/reject

- **Route:** `POST /api/briefs/:briefId/approvals/:artefactId/decision`. Body: `{ decision: 'approve' | 'reject', reason?: string }`.
- **Dispatch:** New `briefApprovalService.decideBriefApproval()` composing `actionService.proposeAction` (accepted primitive). **Synchronous** — not pg-boss.
- **Execution-record linkage:** Superseding artefact via `writeConversationMessage` using existing `parentArtefactId` chain. No new `brief_approvals` table.
- **Client refresh:** 200 response carries the superseding artefact for in-place state patch; WS event `brief.artefact.updated` covers other tabs.

### 4.2 DR2 — Conversation follow-up → agent run

- **Trigger:** `classifyChatIntent` gate on every follow-up.
- **Passive acks:** `simple_reply` route produces inline artefacts; skips Orchestrator. `FILLER_RE` regex inside the classifier handles dedupe.
- **Non-Brief scopes:** explicitly excluded.
- **Refactor:** Extract shared `handleBriefMessage()` helper from `briefCreationService.createBrief` and reuse from the follow-up path in `briefConversationService`.

### 4.3 DR1 — POST /api/rules/draft-candidates

- **Location:** `server/routes/rules.ts` (extends existing rules router).
- **Guards:** `authenticate` + `requireOrgPermission(BRIEFS_WRITE)`.
- **Logic:** org-scoped JSONB scan for artefactId → validate `kind === 'approval'` → load `tasks.description` for `briefContext` → call `listRules({ orgId, ... })` (top 20) → call `ruleCandidateDrafter.draftCandidates(...)`.
- **Error envelope:** flat `{ error: string }` matching existing `rules.ts` pattern. Aligns with Chunk 5 C4a-6-RETSHAPE Branch A recommendation (grandfather flat-string); see Chunk 5 spec § 4.3. If user picks Branch B at review, Chunk 5 + Chunk 3 ship together against nested envelope.

### 4.4 C4a-REVIEWED-DISP — Post-approval invoke_automation dispatch

**Option A — dedicated resume path.**

- New `WorkflowEngineService.resumeInvokeAutomationStep()`:
  1. Re-read step row + invalidation check (per invariant 6.4 — depends on Chunk 5's `withInvalidationGuard` helper).
  2. Transition `review_required` → `running`.
  3. Re-invoke `invokeAutomationStep()` with original step params.
  4. On success: `completeStepRunInternal` with real webhook output.
  5. On failure: emit `automation_*` per § 5.7 vocabulary; transition to `error`.

- `WorkflowRunService.decideApproval` extends to detect `stepType === 'invoke_automation'` in approved branch and route to the new resume path instead of `completeStepRun`.

Satisfies invariants 3.1, 6.1, 6.2, 6.4.

---

## 4.5 Pre-implementation hardening (execution-safety contracts)

This section pins execution-safety contracts that the architect output left implicit. Folded in 2026-04-26 from external review feedback. Each item is a hard requirement for the implementation PR; missing any of them is a directional finding for the post-merge review.

### 4.5.1 DR3 idempotency contract

**Problem.** Architect § 1 doesn't pin idempotency behaviour. Failure modes: double-click approve → duplicate `proposeAction` calls; network retry → duplicate dispatch; concurrent approvals → race.

**Idempotency posture (per invariant 7.1):** `key-based`.

**Retry classification (per invariant 7.5):** `safe` (idempotent against the partial unique index).

**Retry semantics (per invariant 7.1):** retry of identical decision → HTTP 200 idempotent return (same response shape). Different decision for same artefact → HTTP 409.

**First-commit-wins rule (concurrent different decisions).** When two simultaneous requests carry different decisions for the same `artefactId` (e.g. Request A: approve, Request B: reject hitting the partial unique index in the same instant), the **first commit wins** (FIFO at the database level, decided by the partial unique index's serialisation). The losing request returns HTTP 409 with the winning decision attached. There is **no deterministic preference** between approve and reject — neither outcome is privileged. This rule prevents future "business logic override" attempts (e.g. "if approve and reject race, approve wins") from being added without a deliberate spec amendment.

**Classification clarification (idempotent-hit vs conflict).** Both `brief.approval.idempotent_hit` (HTTP 200) and `brief.approval.conflict` (HTTP 409) are non-mutating terminal outcomes. The semantic distinction:

- **idempotent_hit (`status: 'success'`):** the same decision was already recorded; the system honoured the user's intent. **No failure of any kind.**
- **conflict (`status: 'failed'`):** a *different* decision was already recorded; the user's intent for THIS request was NOT honoured. This is **failed intent, not failed system** — the system is healthy; the conflict is in the user's request relative to the already-decided state.

Monitoring/analytics may filter on `status` directly; both are non-mutating but only `conflict` indicates an unmet user intent worth surfacing.

**DR1 artefact-ID collision = hard failure.** When the JSONB scan in § 4.5.4 returns more than one row for an artefactId (per the uniqueness rule), the lookup throws `artefact_id_collision`. The HTTP response is **HTTP 500** (system error). There is **no fallback to "first match"**, **no silent continuation**, **no soft-skip**. The collision is a data-integrity red flag and MUST surface as a hard failure so operator dashboards see it. The `rule.draft_candidates.collision_detected` event is emitted alongside the throw and persists even if the request itself returns 500.

**Stale-decision guard (per invariant 7.2 source-of-truth precedence).** Before invoking `actionService.proposeAction`, the service re-validates the artefact against the current execution-record state. If the parent brief's `tasks.status` is `'cancelled'` OR the underlying action's `actionPolicy` has been disabled since the artefact was emitted, the decision is rejected with HTTP 410 `{ error: 'artefact_stale', reason: '<cancelled_brief|disabled_policy|...>' }`. Pre-launch staleness is rare (rapid testing, no live data) but the rule is in place; spec author confirms the validation surface during implementation.

**Artefact ID uniqueness (per invariant 6.5 + new requirement).** Artefact IDs are generated via the existing UUIDv7 generator in `shared/ids.ts` (or equivalent) and are **globally unique within an organisation** by construction. The org-scoped JSONB scan from § 4.5.4 returns at most one match per artefactId. If two matches are returned, the lookup throws `artefact_id_collision` — fail-loud, not silent.

**Contract.**

- **Idempotency key:** `(artefactId, decision)`. The first decision recorded for an `artefactId` is canonical; subsequent decisions for the same `artefactId` return the existing superseding artefact unchanged (HTTP 200, same response body).
- **Enforcement mechanism:** pre-check in `briefApprovalService.decideBriefApproval()` reads the `conversation_messages` JSONB chain for any artefact whose `parentArtefactId === artefactId AND kind === 'approval_decision'`. If found, return that artefact directly; do NOT call `actionService.proposeAction`. If not found, transactional INSERT of the decision artefact with a unique partial index on `(parent_artefact_id) WHERE kind = 'approval_decision'` to catch race conditions.
- **Unique-violation translation (REQUIRED).** When two requests pass the pre-check simultaneously and both attempt the INSERT, one wins; the second hits the partial unique index and Postgres raises `23505 unique_violation`. The service MUST catch this exact error code and translate it into the defined behaviour: re-fetch the now-existing decision artefact, then return either HTTP 200 idempotent (if the existing decision matches the requested decision) OR HTTP 409 conflict (if it differs). **Raw `unique_violation` errors MUST NOT bubble as HTTP 500.** Any 500 from this code path is a violation of this contract; pure tests assert the catch-and-translate handles all four cases (insert-wins / lose-with-same / lose-with-different / unrelated-error).
- **HTTP semantics:** second-and-subsequent identical requests return HTTP 200 with `idempotent: true` field on the response. Different decisions for the same `artefactId` (approve then reject) return HTTP 409 `{ error: 'approval_already_decided' }` with the prior decision attached.
- **Test:** spec-named pure test `briefApprovalServicePure.test.ts` extension — five cases: first decision succeeds; identical retry returns existing artefact + `idempotent: true`; conflicting second decision returns 409; stale artefact (cancelled brief) returns 410; collision (two matches) throws `artefact_id_collision`.

### 4.5.2 C4a-REVIEWED-DISP execution guard (CRITICAL)

**Problem.** Architect § 4 describes the resume path but doesn't pin a transition guard. Failure modes: concurrent approvals processed in parallel; approval-request retry; tick-loop overlap → duplicate webhook dispatch.

**Idempotency posture (per invariant 7.1):** `state-based` (the `WHERE status = 'review_required'` predicate is the lock).

**Retry classification (per invariant 7.5):** `guarded`.

**Retry semantics (per invariant 7.1):** retry → no-op via guard (returns `alreadyResumed: true`).

**HTTP-disconnect / gateway-timeout behaviour.** The resume path runs synchronously inside the `decideApproval` HTTP handler; the webhook fetch can take up to 30s (per § 4.5.5). If the client disconnects mid-call OR the gateway times out before the webhook completes:

- **Server-side execution continues to completion.** Node's request lifecycle is decoupled from the in-flight webhook fetch; the server does not abort the fetch when the response socket closes. The fetch completes (or times out per § 4.5.5).
- **Result is still persisted.** `completeStepRunInternal` writes the terminal `workflow_step_runs` row regardless of whether the HTTP response was delivered to the client. The decision artefact's `executionStatus` updates atomically.
- **Result is still emitted via observability events.** All events in § 4.5.7 fire regardless of HTTP-response delivery — the trace remains intact.
- **Client recovery path.** On reconnect, the client polls (or receives via WS event `brief.artefact.updated`) the latest artefact state for the conversation. The client UI sees the executed outcome even though the original HTTP response was lost.

This isolation between HTTP transport and execution lifecycle is binding for v1; testing-round operators will see consistent state regardless of network instability.

**Source of truth (per invariant 7.2):** the `workflow_step_runs` row is ground truth for the step's outcome. If the artefact's `executionStatus` field disagrees with the step row's terminal status (rare; only via partial write failure), the step row wins and the artefact is corrected on next read.

**Contract.**

- **Optimistic transition predicate.** `resumeInvokeAutomationStep` performs the `review_required → running` transition with a guarded UPDATE: `UPDATE workflow_step_runs SET status = 'running' WHERE id = $1 AND status = 'review_required' RETURNING *`. If the UPDATE returns zero rows, the resume call exits without invoking the webhook (another concurrent approval already won the race; the late caller returns success with `alreadyResumed: true`).
- **No advisory locks needed.** The optimistic predicate IS the lock — Postgres serialises the UPDATE within the row. Advisory locks add complexity for no additional safety.
- **Idempotency on retry.** If `decideApproval` HTTP request retries (network failure mid-call), the second call sees `status === 'running'` (set by the first call's UPDATE) and short-circuits before re-invoking the webhook. The decision row is the source of truth; the webhook is invoked exactly once per decision artefact.
- **Test:** pure test `resumeInvokeAutomationStepPure.test.ts` extension — concurrent-resume case: two threads call resume on the same `stepRunId`; UPDATE returns zero rows for the loser; loser exits without invoking; one webhook dispatch total.

### 4.5.3 DR2 loop protection + concurrency cap (lightweight)

**Problem.** Architect § 2 flagged "Conversation-level rate limiting" as an Open Decision but didn't pin a default. Failure mode 1 (frequency): classifier misfire on a sequence of passive-ack-shaped messages → repeated orchestrator runs. Failure mode 2 (concurrency): two follow-ups arrive in quick succession, both pass the cap check, both enqueue an orchestrator → duplicated runs.

**Idempotency posture (per invariant 7.1):** `state-based` (frequency cap + active-run check are stateful gates; not key-based, since each follow-up message is intentionally distinct).

**Retry classification (per invariant 7.5):** `guarded`.

**Retry semantics (per invariant 7.1):** retry → reclassify allowed (each follow-up classification is independent; the user message is the input). Idempotency for retries of the SAME `conversationMessageId` is provided by the underlying `conversation_messages` UNIQUE on `(conversation_id, message_id)`.

**Suppressed follow-up ordering (Option A — current behaviour, locked in v1).** When a follow-up message arrives during an active orchestrator run AND is suppressed by the concurrency cap, the message is **NOT re-queued** for orchestration after the active run completes. The message persists in `conversation_messages` (the user input is preserved as a record) and the `simple_reply` sentinel artefact is emitted, but no orchestrator job is enqueued at any future point for that suppressed message. The user must send another follow-up after the active run completes to trigger orchestration.

  Rationale: pre-launch posture; replay-on-completion (Option B) requires storing suppressed-message state and re-classifying after the active run, which is feature work beyond dead-path completion. Option B is documented in § 10 Deferred Items as a post-launch enhancement triggered by operator UX feedback.

**Contract.**

- **Frequency cap (loop protection).** Maximum **5 orchestrator invocations per conversation per 10-minute sliding window.** Tracked by counting `agent_runs` rows with `triggerType = 'brief_followup'` and `conversationId = $1` and `createdAt > now() - interval '10 minutes'`.
- **Concurrency cap (overlap protection).** Maximum **1 active orchestrator run per conversation at any time.** Before enqueue, check for any `agent_runs` row with `conversationId = $1` and `status IN (IN_FLIGHT_RUN_STATUSES from runStatus.ts)`. If one exists, short-circuit to `simple_reply` with sentinel artefact: "An analysis is still running — your follow-up will be processed once it completes." No orchestrator job enqueued.
- **When either cap reached.** The `handleBriefMessage` helper short-circuits to `simple_reply` path. No orchestrator job enqueued. Frequency-cap and concurrency-cap have distinct sentinel messages and distinct log events.
- **Caps are informational, not enforced via DB constraint.** Pure-function check at request time. If frequency cap hit, log `brief.followup.cap_hit`. If concurrency cap hit, log `brief.followup.concurrency_blocked`.
- **Cap precedence (when both exceeded simultaneously).** Frequency cap takes precedence: only `brief.followup.cap_hit` is emitted, NOT `brief.followup.concurrency_blocked`. Both events are mutually exclusive per request — never both. Rationale: frequency-cap triggers indicate user behaviour (loop-shaped traffic) while concurrency-cap triggers indicate system-state (in-flight run); when both apply, the user-behaviour signal is the more actionable one for triage.
- **Test:** pure test `briefMessageHandlerPure.test.ts` extension — six cases: 6th orchestration in 10-min window short-circuits (frequency); follow-up arriving while prior run in-flight short-circuits (concurrency); window-resets after 10 minutes; cap is per-conversation (different conversations reset independently); two simultaneous follow-ups → first wins, second sees in-flight and short-circuits; frequency check happens BEFORE concurrency check (both events emit on the appropriate trigger).

### 4.5.4 DR1 JSONB index assumption

**Problem.** Architect § 3 names the JSONB containment scan but doesn't require the supporting index. Failure mode: scan degrades to seq-scan as `conversation_messages` grows.

**Contract.**

- **Required index.** `conversation_messages.artefacts` has a GIN index. Verified at implementation time by `\d conversation_messages` and confirmed in the Drizzle schema.
- **If absent.** Implementation PR includes a corrective migration adding `CREATE INDEX CONCURRENTLY conversation_messages_artefacts_gin_idx ON conversation_messages USING GIN (artefacts)`. Verified by `EXPLAIN ANALYZE` showing index scan, not seq-scan.
- **Performance budget.** The artefact lookup query must complete in <100ms p95 on the testing-round dataset (≤10000 conversation_messages rows).
- **Test:** sanity grep at implementation time: `grep -nE "GIN.*artefacts" server/db/schema/conversationMessages.ts migrations/*conversation*.sql` → must return at least one match. If zero, the corrective migration ships in this PR.

### 4.5.5 Webhook timeout + retry posture (C4a-REVIEWED-DISP)

**Problem.** Architect § 4 says "webhooks typically <30s" but doesn't pin timeout, retry, or failure classification.

**Contract.**

- **Timeout:** the webhook fetch in `invokeAutomationStep` has a hard timeout of **30 seconds**. After 30s, the fetch is aborted; the resume path emits `automation_execution_error` with `code: 'automation_webhook_timeout'` (added to §5.7 vocabulary if not already present).
- **Retry posture:** **NO automatic retry on timeout in v1.** The decision artefact is marked failed; the timeout is a **terminal failure for that decision artefact**. A subsequent re-approve attempt by the user hits the C4a-REVIEWED-DISP idempotency guard in 4.5.2 (state-based: `status === 'running'` or terminal) and short-circuits — the prior decision is returned, NOT a fresh dispatch. **Re-dispatching the webhook for a timed-out decision requires either (a) a brand-new approval artefact emitted by the orchestrator on a subsequent run, OR (b) an explicit manual-retry mechanism (deferred to post-launch — see § 10 Deferred Items).** In v1, the user cannot directly retry the same approval after timeout; this is the documented contract, not a bug.
- **Failure classification:** webhook 4xx → user-error; webhook 5xx → system-error; timeout → system-error; network failure → system-error. Distinction surfaces in the artefact's `executionStatus` and the audit log.
- **Test:** pure test on the timeout path — assert `automation_webhook_timeout` is emitted; failure is classified as system-error; no retry attempted.

### 4.5.6 No-silent-partial-success per flow

**Problem.** Each flow can partially complete; without explicit success/partial/failure definitions, partial results can be misread as success.

**DR3 — BriefApprovalCard decision.**

- **Success:** decision artefact written + `proposeAction` returned ok + execution record linked.
- **Partial:** N/A — DR3 is atomic; if `proposeAction` fails, the decision artefact still writes, but with `executionStatus: 'failed'` so the client sees the user input was captured but the action wasn't dispatched.
- **Failure:** decision artefact write fails → HTTP 500; user re-tries via the idempotency guard.

**DR2 — Conversation follow-up.**

- **Success:** classifier returns + (Orchestrator job enqueued OR simple_reply artefact emitted).
- **Partial:** classifier returns but enqueue fails → HTTP 500 with `{ error: 'orchestrator_enqueue_failed' }`; the user message is already persisted in `conversation_messages` (independent transaction), so retry replays the classifier.
- **Failure:** classifier itself fails → log `chat_intent_classifier_failed`; default to `simple_reply` path with a sentinel artefact rather than block the user message.

**DR1 — POST /api/rules/draft-candidates.**

- **Success:** scan finds artefact + `kind === 'approval'` + `briefContext` loaded + `draftCandidates` returns ≥1 candidate → HTTP 200 with full payload.
- **Partial:** scan finds artefact + briefContext loaded + `draftCandidates` returns 0 candidates → HTTP 200 with `{ candidates: [] }` (empty is success, not partial).
- **Failure:** scan finds nothing → HTTP 404; wrong kind → HTTP 422; `draftCandidates` throws → HTTP 500.

**C4a-REVIEWED-DISP — Resume path.**

- **Success:** transition + webhook dispatch + `completeStepRunInternal` with real output.
- **Partial:** transition succeeds, webhook fails → step transitions to `error` with the right code; `executionStatus` on the brief approval artefact updates to reflect the dispatch failure; user sees the failure in-place. NOT silent.
- **Failure:** transition guard returns zero rows (concurrent winner) → exit with `alreadyResumed: true`; this is success of the SECOND caller, not a partial outcome.

### 4.5.7 Observability hooks per flow

**Problem.** Each flow needs operational signals so production incidents can be debugged without log archaeology.

**Required emissions** (use existing `agentExecutionEventService` where applicable; otherwise structured `logger.info` with the named event):

- **DR3:** terminal event (per invariant 7.7) is exactly one of `brief.approval.completed | brief.approval.failed | brief.approval.idempotent_hit`:
  - `brief.approval.received` (artefactId, decision, userId, orgId, conversationId, executionId)
  - `brief.approval.dispatched` (artefactId, executionId, latencyMs)
  - `brief.approval.idempotent_hit` (artefactId, executionId, status: 'success') — TERMINAL when 4.5.1 idempotency short-circuit fires
  - `brief.approval.completed` (artefactId, executionId, latencyMs, status: 'success', executionStatus: 'queued' | 'completed') — TERMINAL on first-decision success
  - `brief.approval.conflict` (artefactId, priorDecision, attemptedDecision, status: 'failed') — TERMINAL when 409 fires (concurrent different decisions; per § 4.5.1 first-commit-wins rule)
  - `brief.approval.stale` (artefactId, reason, status: 'failed') — TERMINAL when 410 fires (per § 4.5.1 stale-decision guard)
  - `brief.approval.failed` (artefactId, executionId, error, status: 'failed') — TERMINAL on uncaught failure
- **DR2:** terminal event (per invariant 7.7) is exactly one of `brief.followup.orchestrator_enqueued | brief.followup.simple_reply_emitted | brief.followup.cap_hit | brief.followup.concurrency_blocked | brief.followup.failed`:
  - `brief.followup.classified` (conversationId, intentKind, latencyMs, runId)
  - `brief.followup.orchestrator_enqueued` (conversationId, jobId, runId, status: 'success') — TERMINAL for orchestration path
  - `brief.followup.simple_reply_emitted` (conversationId, artefactId, runId, status: 'success') — TERMINAL for simple-reply path
  - `brief.followup.cap_hit` (conversationId, count, windowStart, status: 'partial') — frequency cap TERMINAL from 4.5.3
  - `brief.followup.concurrency_blocked` (conversationId, activeRunId, status: 'partial') — concurrency cap TERMINAL from 4.5.3
  - `brief.followup.failed` (conversationId, error, status: 'failed') — TERMINAL on classifier or enqueue failure
- **DR1:**
  - `rule.draft_candidates.requested` (artefactId, orgId)
  - `rule.draft_candidates.returned` (artefactId, candidateCount, latencyMs, status: 'success')
  - `rule.draft_candidates.collision_detected` (artefactId, orgId, matchCount) — emitted when the JSONB scan returns more than one row for an artefactId (per § 4.5.1 uniqueness rule); data-integrity red flag, surfaces to operator dashboards
  - `rule.draft_candidates.failed` (artefactId, orgId, error, status: 'failed') — terminal event per invariant 7.7
- **C4a-REVIEWED-DISP:** terminal event (per invariant 7.7) is exactly one of `step.resume.completed | step.resume.failed | step.resume.guard_blocked`:
  - `step.resume.started` (stepRunId, runId, automationId)
  - `step.resume.guard_blocked` (stepRunId, runId, status: 'success', alreadyResumed: true) — TERMINAL when optimistic predicate returns zero rows (concurrent winner)
  - `step.resume.completed` (stepRunId, runId, executionStatus, latencyMs, status: 'success' | 'partial') — TERMINAL on dispatch outcome
  - `step.resume.webhook_timeout` (stepRunId, runId, automationId, timeoutMs, status: 'failed') — from 4.5.5; followed by `step.resume.failed`
  - `step.resume.failed` (stepRunId, runId, error, status: 'failed') — TERMINAL on dispatch failure

Each event is best-effort (graded-failure tier per `accepted_primitives` / `agentExecutionEventService`); emission failure does not block the user-facing path.

**Correlation key (per invariant 7.3).** Every event in the chain `brief.approval.received → brief.approval.dispatched → step.resume.started → step.resume.completed → brief.artefact.updated` carries the same `executionId` field at top level. For DR2 the chain `brief.followup.classified → brief.followup.orchestrator_enqueued → run.terminal.*` carries `runId`. Trace reconstruction is via single-key filter on `executionId` or `runId`.

### 4.5.8 DR3 response shape (explicit contract)

Per invariant 7.4, every response carries a discriminated `status` field at top level.

```json
// HTTP 200 (first decision OR idempotent retry)
{
  "status": "success" | "partial" | "failed",   // discriminated terminal state per invariant 7.4
  "artefact": { /* superseding decision artefact, full shape */ },
  "executionId": "exec_01h...",                  // correlation key per invariant 7.3
  "executionStatus": "queued" | "completed" | "failed",
  "idempotent": false                            // true on retry of identical decision
}

// HTTP 409 (conflicting decision)
{
  "status": "failed",
  "error": "approval_already_decided",
  "priorDecision": "approve" | "reject",
  "priorArtefact": { /* the existing decision artefact */ }
}

// HTTP 410 (stale artefact — per § 4.5.1 stale-decision guard)
{
  "status": "failed",
  "error": "artefact_stale",
  "reason": "cancelled_brief" | "disabled_policy" | "other"
}

// HTTP 404 (artefact not found)
{ "status": "failed", "error": "artefact_not_found" }

// HTTP 422 (artefact exists but wrong kind)
{ "status": "failed", "error": "artefact_not_approval" }
```

---

## 5. Files touched

### Modified

| File | Change | From which decision |
|---|---|---|
| `server/services/briefApprovalService.ts` | **new file** — `decideBriefApproval()` composing `actionService.proposeAction` + superseding-artefact emission | DR3 |
| `server/services/briefConversationService.ts` | Extend POST /messages handler with `handleBriefMessage` helper call | DR2 |
| `server/services/briefCreationService.ts` | Refactor to use shared `handleBriefMessage` helper | DR2 |
| `server/services/briefMessageHandlerPure.ts` | **new file** (or co-located) — shared classify→dispatch logic | DR2 |
| `server/services/workflowEngineService.ts` | New `resumeInvokeAutomationStep()` method | C4a-REVIEWED-DISP |
| `server/services/workflowRunService.ts` | Extend `decideApproval` to route `invoke_automation` to resume path | C4a-REVIEWED-DISP |
| `server/routes/briefs.ts` | New POST `/:briefId/approvals/:artefactId/decision` handler | DR3 |
| `server/routes/rules.ts` | New POST `/draft-candidates` handler | DR1 |
| `client/src/components/brief-artefacts/ApprovalCard.tsx` | Wire `onApprove` / `onReject` handlers | DR3 |
| `client/src/pages/BriefDetailPage.tsx` (or equivalent) | Pass handlers down; refresh on response | DR3 |

### Untouched (reused as-is)

- `server/services/actionService.ts` — `proposeAction` reused.
- `server/services/ruleCandidateDrafter.ts` — `draftCandidates(...)` reused.
- `server/services/invokeAutomationStepService.ts` — entry signature reused by C4a-REVIEWED-DISP resume path.
- `server/services/chatTriageClassifier.ts` — `classifyChatIntent` reused.
- `server/services/orchestratorFromTaskJob.ts` — reused for `needs_orchestrator` / `needs_clarification` paths.

### Cross-chunk dependencies

- **Chunk 5's `withInvalidationGuard`** — C4a-REVIEWED-DISP's resume path uses it. Chunk 5 spec PR #207 introduces it. Chunk 3 implementation cannot start until Chunk 5 is merged.
- **Chunk 5's C4a-6-RETSHAPE branch decision** — affects whether DR1 ships flat or nested error envelope. If Branch B (migrate), Chunk 5's PR migrates `rules.ts` envelopes; Chunk 3 cites the migration but doesn't perform it.

---

## 6. Implementation Guardrails

### MUST reuse

- `actionService.proposeAction` (accepted primitive) — DR3 dispatch.
- `writeConversationMessage` parent-link mechanic — DR3 superseding artefact.
- `classifyChatIntent` from `chatTriageClassifier.ts` — DR2 gate.
- `generateSimpleReply` — DR2 simple_reply path.
- `orchestratorFromTaskJob` — DR2 needs_orchestrator path.
- `listRules({ orgId, ... })` — DR1 related-rules lookup.
- `ruleCandidateDrafter.draftCandidates(...)` — DR1 candidate draft.
- `WorkflowEngineService.completeStepRunInternal` — C4a-REVIEWED-DISP resume path post-success.
- `withInvalidationGuard` (from Chunk 5) — C4a-REVIEWED-DISP invalidation re-check.

### MUST NOT introduce

- New `brief_approvals` table. Architect explicitly rejects (DR3).
- New step types or new run statuses (invariants 6.5).
- pg-boss enqueue for any of the 4 paths in v1.
- Vitest / Jest / Playwright / Supertest tests (per `convention_rejections`).
- A new `WorkflowEngineFramework` abstraction. The single-method addition (`resumeInvokeAutomationStep`) is the framework.

### Known fragile areas

- **Brief-approval state machine.** The superseding-artefact pattern relies on the `parentArtefactId` chain being correctly set by the original approval emission. Audit existing approval emissions (in `briefArtefactEmitter` or equivalent) before commit.
- **`handleBriefMessage` extraction.** The brief-creation path has subtle differences from the follow-up path (e.g., the brief-creation path also writes the brief skeleton; the follow-up path only writes the message). Ensure the helper preserves both flows correctly.
- **`resumeInvokeAutomationStep` and tick loop.** The resume path runs synchronously from `decideApproval`; ensure no tick-loop side effects are duplicated (e.g., the step shouldn't appear twice in an active-step query during the resume window).
- **Conversation message JSONB scan (DR1).** The `artefacts @> ...::jsonb` scan on `conversation_messages` is unbounded. Ensure org-scoping prevents cross-org reads (it does, via the `WHERE organisation_id = $1` clause).

---

## 7. Test plan

Per `docs/spec-context.md § testing posture` (`runtime_tests: pure_function_only`):

### Pure unit tests

1. **`briefApprovalServicePure.test.ts`** — assertion: `decideBriefApproval()` calls `actionService.proposeAction` with the correct payload; emits the superseding artefact via `writeConversationMessage`; returns the artefact in the response shape.
2. **`briefMessageHandlerPure.test.ts`** — three cases: `simple_reply` produces inline artefact + skips Orchestrator; `needs_orchestrator` enqueues `orchestratorFromTaskJob`; `passive_ack` (FILLER_RE) short-circuits.
3. **`ruleDraftCandidatesPure.test.ts`** — assertion: route handler scans org-scoped artefacts; rejects non-`approval` artefacts (422); rejects missing artefacts (404); calls `draftCandidates` with the loaded `briefContext` and existing rules.
4. **`resumeInvokeAutomationStepPure.test.ts`** — assertion: re-read + invalidation check happens before re-invoke; on success, `completeStepRunInternal` receives the real webhook output (not empty `{}`); on failure, transitions to `error` with the right code.

### Static gates

- `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh` → must continue to pass (no new tenant tables; service-layer org-scoping reused).
- TypeScript build → must pass (`AgentRunRequest` may need extension for DR3 metadata; audit at impl time).
- Sanity grep before commit:
  - `grep -nE "POST.*'/:?briefId/approvals" server/routes/briefs.ts` → expect 1 match (new route).
  - `grep -nE "draft-candidates" server/routes/rules.ts` → expect 1 match.
  - `grep -nE "resumeInvokeAutomationStep" server/services/workflowEngineService.ts` → expect 1+ matches.
  - `grep -nE "classifyChatIntent" server/services/briefConversationService.ts` → expect 1+ matches via `handleBriefMessage`.

### No new test categories

No vitest, jest, playwright, supertest, frontend tests, or e2e per `docs/spec-context.md § convention_rejections`.

---

## 8. Done criteria

- [ ] DR3: `briefApprovalService.decideBriefApproval()` exists; new POST route handles approve/reject; superseding artefact emitted; `ApprovalCard.tsx` handlers wired; clicks update brief state in-place.
- [ ] DR2: `handleBriefMessage()` helper exists and is called from both creation and follow-up paths; `classifyChatIntent` runs on every follow-up; `simple_reply` produces inline artefact; `needs_orchestrator`/`needs_clarification` re-enqueues orchestrator job.
- [ ] DR1: `POST /api/rules/draft-candidates` returns 200 with `{ candidates: [] }` for valid request; 404 for missing artefactId; 422 for non-approval artefact.
- [ ] C4a-REVIEWED-DISP: `resumeInvokeAutomationStep()` exists; `decideApproval` routes `invoke_automation` to it; webhook actually fires post-approval; step row carries real output (not empty).
- [ ] All 4 pure tests pass.
- [ ] `tasks/todo.md` annotated for all 4 cited items.
- [ ] PR body links spec + architect output; test plan checked off.

---

## 9. Rollback notes

- DR3: revert `briefApprovalService.ts` (new file delete) + the route handler addition + the client handler wiring. Brief approve/reject buttons revert to silent no-ops (current production state).
- DR2: revert `handleBriefMessage` extraction; follow-ups stop re-invoking. Current production state.
- DR1: delete the route handler. The client `ApprovalSuggestionPanel` will resume 404'ing (current production state).
- C4a-REVIEWED-DISP: revert `resumeInvokeAutomationStep` + the `decideApproval` extension. Approved invoke_automation steps revert to terminating with empty output (current production state).

No DB migrations involved. All four reverts are file-revert granularity. New services are additive; deletion is safe.

---

## 10. Deferred Items

- **Async post-approval dispatch.** v1 picks synchronous resume per architect § 4. Trigger to revisit: webhook latencies routinely exceed 30s in testing-round traffic, OR an HTTP timeout incident links to a stuck approval response. Resolution: move post-approval dispatch to a pg-boss job that the approval response acknowledges immediately. Out of scope for v1.
- **Manual retry path for timed-out approvals.** v1 contract per § 4.5.5: timeout is terminal; re-dispatch requires a new artefact. Trigger to revisit: testing-round operators routinely need to retry timed-out webhooks without waiting for the orchestrator's next run. Resolution: dedicated `POST /api/briefs/:briefId/approvals/:artefactId/retry` route that emits a fresh approval artefact (new artefactId) and re-enters the dispatch path. Until then, users who want to retry a timed-out webhook must either wait for the orchestrator to re-emit the approval OR manually re-trigger the orchestrator via DR2.
- **Conversation-level rate limiting on follow-ups.** Architect-flagged risk: a user could spam follow-ups and trigger many Orchestrator runs. Trigger to revisit: spam observed in testing, OR per-org cost spike attributable to follow-up loops. Resolution: piggyback on existing rate-limit middleware OR add a per-conversation cooldown.
- **Follow-up re-invocation for non-Brief scopes.** Out-of-scope per § 1; new feature. Trigger to revisit: explicit operator request for `task` or `agent_run` conversation surfaces.
- **Skill error envelope migration in `rules.ts`.** Bound to Chunk 5 C4a-6-RETSHAPE Branch B. If Branch A (grandfather), this entry stays open indefinitely; if Branch B (migrate), this entry closes when Chunk 5 implementation lands.

---

## 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

### HITL decisions (user must answer)

- **High-risk action handling for brief approvals.** Architect recommends brief approval IS the only required human gate. User confirms or specifies a chained second-tier approval flow.
- **Rate limiting cooldown for DR1 + DR2.** User confirms "no rate-limit in v1" or specifies a cooldown.

### Directional uncertainties (explicitly accepted tradeoffs)

- **Synchronous post-approval dispatch (C4a-REVIEWED-DISP).** Architect picks synchronous over async because v1 webhooks typically <30s. Trade-off documented in § 10 with a re-visit trigger.
- **DR1 flat error envelope.** Matches existing `rules.ts` precedent; migration deferred to Chunk 5. Accepted.
- **`briefApprovalService` as a new primitive.** Justified per architect: composes `actionService.proposeAction` for a domain-specific use case, not as a generic wrapper. Accepted.

---

## 12. Coverage Check

### Mini-spec Items (verbatim)

- [x] `DR3` — `BriefApprovalCard` approve/reject buttons are silent no-ops — **addressed in § 2 + § 4.1 + § 5 modifications**.
- [x] `DR2` — Conversation follow-ups don't re-invoke fast-path/Orchestrator — **addressed in § 2 + § 4.2 + § 5 modifications**.
- [x] `DR1` — `POST /api/rules/draft-candidates` route missing — **addressed in § 2 + § 4.3 + § 5 modifications**.
- [x] `C4a-REVIEWED-DISP` — review-gated `invoke_automation` never dispatches after approval — **addressed in § 2 + § 4.4 + § 5 modifications**.

### Mini-spec Key decisions (verbatim)

- [x] **DR2: what's the trigger semantics for conversational follow-ups?** — **addressed in § 4.2** (`classifyChatIntent` gate; `simple_reply` skips; non-Brief scopes excluded).
- [x] **C4a-REVIEWED-DISP: resume the original step or branch a new one?** — **addressed in § 4.4** (Option A — dedicated resume path).

### Final assertion

- [x] **No item from mini-spec § "Chunk 3 — Dead-Path Completion" is implicitly skipped.** Every cited item appears in § 2 + § 4 + § 5. Both Key decisions are addressed in § 4.

### Mini-spec done criteria — mapped to this spec's § 8

- [x] "Approve/reject buttons end-to-end functional with tests." — § 8 first checkbox + § 7 test 1.
- [x] "Follow-up message in any chat surface results in a new agent run (or documented decision why not)." — § 8 second checkbox; non-Brief scopes documented as out-of-scope in § 3.
- [x] "Approved external automations dispatch and surface their result." — § 8 fourth checkbox + § 7 test 4.
- [x] "`POST /api/rules/draft-candidates` returns 200 with valid payload." — § 8 third checkbox + § 7 test 3.
