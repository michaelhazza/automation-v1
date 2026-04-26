# Pre-Launch Dead-Path Completion — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 3
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2`)
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
- **Error envelope:** flat `{ error: string }` matching existing `rules.ts` pattern. Migration to `{ code, message, context }` deferred to Chunk 5 C4a-6-RETSHAPE.

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
