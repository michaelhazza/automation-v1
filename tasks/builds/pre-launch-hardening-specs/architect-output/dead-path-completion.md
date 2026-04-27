# Chunk 3 — Dead-Path Completion — Architect Resolution

**Authored:** 2026-04-26 (architect output, captured to file from agent response)
**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 3
**Invariants pinned by:** `cf2ecbd0` (`docs/pre-launch-hardening-invariants.md`)
**Consumed by:** Chunk 3 spec at `docs/pre-launch-dead-path-completion-spec.md`

This document captures the architect's resolution for the four decisions in Chunk 3. The Chunk 3 spec embeds these decisions and pins this file's commit SHA in its front-matter.

---

## Table of contents

1. DR3 — BriefApprovalCard approve/reject
2. DR2 — Conversation follow-up → agent run
3. DR1 — POST /api/rules/draft-candidates route
4. C4a-REVIEWED-DISP — Post-approval invoke_automation dispatch
5. Cross-decision coherence check + cross-chunk dependencies

---

## 1. DR3 (todo.md:371) — BriefApprovalCard approve/reject

### Decision

- **Route shape:** `POST /api/briefs/:briefId/approvals/:artefactId/decision` with request body `{ decision: 'approve' | 'reject', reason?: string }`.
- **Dispatch path:** New `briefApprovalService.decideBriefApproval()` that composes `actionService.proposeAction` (accepted primitive). **Inline (synchronous)** dispatch — not enqueued via pg-boss; the approval HTTP call awaits the proposeAction result.
- **Execution record linkage:** Superseding artefact emitted through `writeConversationMessage` using the existing `parentArtefactId` chain. No new `brief_approvals` table. The decision artefact carries `executionId` + `executionStatus` + `decisionMadeAt` + `decisionMadeBy` and supersedes the original approval artefact via the parent-link.
- **Client refresh strategy:** The 200 response body returns the superseding artefact directly so the client can patch state in-place; a WS event (`emitBriefArtefactUpdated`) covers other tabs / sessions.

### Rejected options

- **New `brief_approvals` table** — schema change for storage that already fits the artefact JSONB chain. Violates `prefer_existing_primitives`.
- **pg-boss enqueue with deferred response** — adds async complexity for a synchronous user action; the proposeAction call is fast enough to complete inline.

### Files affected

- `server/services/briefApprovalService.ts` (new)
- `server/services/briefConversationService.ts` (extend; calls into briefApprovalService)
- `server/routes/briefs.ts` (new POST endpoint)
- `client/src/components/briefs/BriefApprovalCard.tsx` (wire onApprove / onReject handlers)
- `client/src/pages/BriefDetailPage.tsx` (pass handlers down; refresh on response)

### Downstream ripple

- `actionService.proposeAction` signature unchanged (reused as-is).
- `writeConversationMessage` parent-link mechanic already exists; reused.
- WS room: existing `brief:<briefId>` room — new event `brief.artefact.updated`.

### Open sub-questions for the spec author

- **High-risk action handling.** If the action is `actionPolicy.requiresHumanApproval === true` even after the brief approval, what's the behaviour? Architect recommends: brief approval IS the only required human gate for the artefact's action.

---

## 2. DR2 (todo.md:370) — Conversation follow-up → agent run

### Decision

- **Trigger semantics:** `classifyChatIntent` gate on every follow-up message. The classifier already exists in the brief-creation path; reuse it.
- **Passive acks ("thanks", "got it"):** `simple_reply` classification route produces inline artefacts and skips Orchestrator. The existing `FILLER_RE` regex inside the classifier handles this.
- **Threshold-based / explicit user action:** Rejected — adds UX surface; the classifier output is sufficient.
- **Non-Brief scopes (`task`, `agent_run`):** **explicitly excluded from this spec.** Rationale: those surfaces don't currently enqueue orchestration; adding follow-up re-invocation there would be a new feature, not dead-path completion. Documented in spec § Items NOT closed.
- **Idempotency for passive acks:** the classifier short-circuit handles this — `simple_reply` doesn't enqueue, so there's nothing to dedupe.
- **`simple_reply` / `cheap_answer` inline artefacts on follow-ups:** YES, via the same `generateSimpleReply` path used during brief creation.

### Refactoring requirement

The brief-creation path in `briefCreationService.createBrief` and the new follow-up path share the same classify→dispatch logic. Extract into a shared helper `handleBriefMessage()` to avoid duplication.

### Rejected options

- **Auto-invoke on every message** — wastes LLM cost on passive acks; bypasses the classifier we already have.
- **Threshold-based** — fragile (what threshold?); the classifier IS the threshold.
- **Explicit user action ("re-run agent" button)** — adds UX surface; defeats the goal of "follow-up just works".

### Files affected

- `server/services/briefConversationService.ts` (extend POST /messages handler with `handleBriefMessage` helper call)
- `server/services/briefCreationService.ts` (refactor to use the shared `handleBriefMessage` helper)
- New `server/services/briefMessageHandlerPure.ts` (or co-located inside briefConversationService) — the shared classify→dispatch logic.

### Downstream ripple

- `classifyChatIntent` reused as-is.
- `orchestratorFromTaskJob` reused for `needs_orchestrator` / `needs_clarification` paths.
- `generateSimpleReply` reused for `simple_reply` path.

### Open sub-questions for the spec author

- **Conversation-level rate limiting.** A user could spam follow-ups and trigger many Orchestrator runs in quick succession. Architect recommends: defer rate-limiting to the existing testRunRateLimit infrastructure or document as a Deferred Item. Spec § Open Decisions should ask the user whether to add a per-conversation cooldown in v1.

---

## 3. DR1 (todo.md:369) — POST /api/rules/draft-candidates route

### Decision

- **Location:** Added to existing `server/routes/rules.ts` (extends the rules router).
- **Guards:** `authenticate` middleware + `requireOrgPermission(BRIEFS_WRITE)` (per existing rules-route pattern).
- **Server logic:**
  1. Resolve `req.orgId` from authenticated user.
  2. Org-scoped JSONB scan: `SELECT id, artefacts FROM conversation_messages WHERE organisation_id = $1 AND artefacts @> $2::jsonb LIMIT 1` where `$2 = '[{"id": "<artefactId>"}]'`.
  3. Validate the matched artefact has `kind === 'approval'`.
  4. Load the parent brief: `SELECT description FROM tasks WHERE id = (parent task id of the conversation) AND organisation_id = $1`. Use `tasks.description` as the `briefContext` payload.
  5. Call `listRules({ orgId, ...filterParams })` to fetch up to 20 existing rules for the related-rules lookup.
  6. Call `ruleCandidateDrafter.draftCandidates({ artefactId, wasApproved, briefContext, existingRules })`.
- **Error envelope:** Flat `{ error: string }` matching the existing `rules.ts` route pattern. Migration to nested envelope is **deferred to Chunk 5 C4a-6-RETSHAPE** — both routes get migrated together when that decision lands.

### Rejected options

- **New dedicated `server/routes/ruleDraftCandidates.ts` file** — file proliferation for a single endpoint. Existing `rules.ts` is the right home.
- **Different auth guard (e.g. `requireOrgMember` only)** — less restrictive than other rules-write endpoints; inconsistency.
- **Nested error envelope today** — would diverge from rest of `rules.ts`; wait for Chunk 5's coordinated migration.

### Files affected

- `server/routes/rules.ts` (new POST handler)
- `server/services/ruleCandidateDrafter.ts` (no change; already implements `draftCandidates(...)`)
- `client/src/components/briefs/ApprovalSuggestionPanel.tsx` (existing client; the route already matches what the panel posts to)

### Contracts (worked example)

**Request:**

```json
POST /api/rules/draft-candidates
{
  "artefactId": "art_01h...",
  "wasApproved": true
}
```

**Response 200:**

```json
{
  "candidates": [
    {
      "ruleText": "When the customer mentions 'price', escalate to billing-tier",
      "confidence": 0.82,
      "scope": "subaccount",
      "draftId": "draft_01h..."
    }
  ]
}
```

**Response 404:** `{ "error": "artefact_not_found" }`
**Response 422:** `{ "error": "artefact_not_approval" }`

### Open sub-questions for the spec author

- **Rate limiting.** Same question as DR2 — should this endpoint have a per-org cooldown? Architect recommends: piggyback on existing rate-limit middleware if any; otherwise defer.

---

## 4. C4a-REVIEWED-DISP (todo.md:665) — Post-approval invoke_automation dispatch

### Decision

**Option A — dedicated resume path.**

`WorkflowRunService.decideApproval` detects `stepType === 'invoke_automation'` in the approved branch and routes to a new `WorkflowEngineService.resumeInvokeAutomationStep()` method instead of calling `completeStepRun` (which would terminate the step with empty output).

The new `resumeInvokeAutomationStep()` method:

1. Re-reads the step row + performs invalidation check per invariant 6.4 (resume paths re-enter through same state machine boundary).
2. Transitions step status from `review_required` to `running`.
3. Re-invokes `invokeAutomationStep()` with the original step's params (loaded from the step row).
4. On success: calls `completeStepRunInternal` with the real webhook output (not the empty `{}` the bug currently produces).
5. On failure: emits `automation_*` error per § 5.7 vocabulary; transitions step to `error`.

Satisfies invariants 3.1 (re-check invalidation after I/O), 6.1 (step terminal transitions need execution record), 6.2 (approval-required steps pass through exactly one decision boundary — the `decideApproval` boundary, then re-enter via the named resume path), 6.4 (resume paths re-enter through same state machine boundary).

### Rejected options

- **Option B — step-type-aware approval handling in `decideApproval` that dispatches the approved step rather than completing it.** Rejected because: (1) cross-cuts the entire approval state machine, not just `invoke_automation`; (2) breaks the existing pattern where `decideApproval` always calls `completeStepRun*`; (3) makes the approval boundary heterogeneous (different step types behave differently inside the same call).

### Files affected

- `server/services/workflowEngineService.ts` (new `resumeInvokeAutomationStep()` method)
- `server/services/workflowRunService.ts` (extend `decideApproval` to detect `invoke_automation` step type and route to the resume path)
- `server/services/invokeAutomationStepService.ts` (no change to entry signature; reused as-is by the resume path)

### Downstream ripple

- The tick loop (`workflowEngineService.tick()`) doesn't need to change — the resume path is invoked synchronously from `decideApproval`, which itself runs inside a workflow tick or a route handler.
- Audit/event emission: `workflow.step.automation.completed` event with the real webhook output, same shape as the non-approval path.
- No DB schema changes.

### Open sub-questions for the spec author

- **Approval HTTP call blocks for up to 300 seconds in v1.** The resume path runs inside the `decideApproval` HTTP request; a slow webhook means a long-blocking HTTP response. Architect recommends: document this as a `## Deferred Items` entry — "post-launch: move post-approval dispatch to a pg-boss job that the approval response acknowledges immediately." For v1 testing, the synchronous resume is acceptable because webhooks are typically <30s.

---

## 5. Cross-decision coherence check + cross-chunk dependencies

All four decisions cohere with the cross-chunk invariants:

- **Invariant 1.4 (no direct `db` in routes):** every new route uses service-layer helpers.
- **Invariant 2.4 (skill error envelope):** DR1 explicitly defers envelope migration to Chunk 5 C4a-6-RETSHAPE; both routes that touch `rules.ts` get migrated together when that decision lands.
- **Invariant 5.1 (prefer existing primitives):** `briefApprovalService` is the only new primitive; justified because it composes `actionService.proposeAction` for a domain-specific use case, not as a generic wrapper.
- **Invariant 6.1, 6.2, 6.4 (state/lifecycle):** C4a-REVIEWED-DISP option A explicitly re-uses the state machine boundary.

No conflicts between decisions.

### Cross-chunk dependencies

- **C4a-REVIEWED-DISP** depends on Chunk 5's `withInvalidationGuard` helper (invariant 3.1 enforcement). Chunk 5's PR introduces the helper; Chunk 3's resume path uses it. Implementation order: Chunk 5 lands first, Chunk 3 last.
- **DR1's flat error envelope** is contingent on Chunk 5's C4a-6-RETSHAPE branch decision. If Branch B (migrate), Chunk 5's PR migrates the rules.ts envelopes; Chunk 3 cites the migration but doesn't perform it.
