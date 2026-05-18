# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Spec commit at start:** `76fbf1d4` (untracked)
**Spec commit at finish:** `d8cf1146`
**Spec-context commit:** `645a2462`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap
**Verdict:** READY_FOR_BUILD (5 iterations, 44 mechanical fixes applied + 1 AUTO-DECIDED directional)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|
| 1 | 14 | 5 distinct | 19 | 0 | 0 |
| 2 | 8 | 0 | 8 | 0 | 0 |
| 3 | 8 | 0 | 8 | 0 | 0 |
| 4 | 6 | 0 | 6 | 0 | 1 (Path B over Path C, no new pg-boss queue for approval resume) |
| 5 | 8 | 0 | 8 | 0 | 0 |
| **Total** | **44** | **5** | **49** | **0** | **1** |

Note: counts include iteration-1 rubric findings; subsequent iterations did not surface new rubric items beyond what Codex caught.

---

## Mechanical changes applied (grouped by spec section)

### §3 Framing Assumptions
- `bound_run_id` requirement narrowed to `kind='oauth'` only; nullable for approval / external_event (iter 3).

### §4.1 + §4.2 Data Model + RLS
- `bound_run_id` column note: required for oauth only (iter 4).
- RLS sweep mechanism: added explicit `SET LOCAL ROLE admin_role` requirement (iter 1).
- `withAdminConnection` FORBIDDEN for `createWaitpoint`/`completeWaitpoint` (iter 1).

### §5 Service Interface
- §5.1 `createWaitpoint` now returns `{plaintext, expiresAt}` (iter 2); validation enforces boundRunId for oauth only and approvedActionId+workflowStepRunId for approval (iters 1, 3, 4).
- §5.2 `completeWaitpoint(params, tx?)` signature with optional caller-supplied transaction (iter 4-5); per-kind enqueue behaviour split out (oauth enqueues `agent-run-resume-from-waitpoint` via `sendWithTx`, approval is tx-bound and does not enqueue — Path B); `getJobConfig` subset extraction documented (iter 2); 0-row update branches between `already_completed` and `RESUME_TOKEN_EXPIRED` (iter 5).
- §5.3 `expireWaitpoints`: explicit two-part admin pattern (`withAdminConnection` + `SET LOCAL ROLE admin_role`) (iter 1); per-kind downstream cleanup (oauth → `agent_runs` transition matching `blockedRunExpiryJob`; approval → `workflow_step_runs` failure matching `failStepRunInternal` + `workflow-run-tick` via `sendWithTx`) with explicit `AND organisation_id = wp.organisation_id` predicates (iters 2-3); softened legacy-drain framing (iter 3).

### §7 Call-Site Migrations
- §7.2 OAuth: CREATE moved to `agentExecutionLoop.ts` with detailed reuse-of-`checkRequiredIntegration` contract (iter 1-2); COMPLETE clarifies how `agentResumeService.resumeFromIntegrationConnect` delegates (iter 1).
- §7.3 Approval: heading + complete-side moved to `reviewService.ts` (iter 4-5); CREATE-side payload carries `workflowStepRunId` (sr.id) instead of bogus `agentRunId`/`run.id` (iter 3); inline `resumeActionCallAfterApproval` continues to drive resume — no pg-boss enqueue for approval (Path B, iter 4-5).

### §8 Contracts
- §8.1 createWaitpoint result `{plaintext, expiresAt: Date}` with documented permitted persistence sites (iters 1, 3).
- §8.2 source-of-truth precedence now pair-based `(status, expires_at)` (iter 1).
- §8.4 workflow-resume queue clarified as legacy `flowRuns` path — NOT dispatched by approval waitpoints in V1 (iter 5).

### §11 Execution Model
- Per-kind split for `completeWaitpoint` (iter 5).
- `workflow-run-tick` added as the queue triggered by `expireWaitpoints` on approval timeout (iter 4).

### §12 Permissions / RLS
- Approval-path route-guard provenance updated to `reviewService.approveItem` (called from `reviewItems.ts` route) (iters 1, 4).
- `withAdminConnection` forbidden statement added (iter 1).

### §13 File Inventory
- New files 6 → 7 (added `waitpointServicePure.ts` with pinned exports) (iters 1-2).
- Modified files 9 → 12 (added `agentExecutionLoop.ts` for OAuth CREATE; `reviewService.ts` for approval COMPLETE; corrected `server/jobs/index.ts` → `pgBossRegistrations.ts`) (iters 1, 4).

### §14 Chunk Sequencing
- Env var moved from Chunk 7 to Chunk 1 (iter 2).
- `completeWaitpoint(tx?)` overload housed in Chunk 2 (service); Chunk 6 consumes it (iter 5).
- Chunk 6 description updated to name `reviewService.approveItem` (iter 5).

### §15 Execution-Safety Contracts
- §15.1 idempotency mechanism for `completeWaitpoint` split into already_completed vs RESUME_TOKEN_EXPIRED branches (iter 5).
- §15.4 terminal events: at-most-once, best-effort, post-commit; row state is source of truth (iter 1).

### §16 Testing Posture
- Pure module test list updated to validate per-kind validateCreateWaitpointParams behaviour (iter 4).
- CI gate description tightened with implementer-invariant notes (`SET LOCAL ROLE admin_role`, org-bound predicates under admin) (iter 3).

### §17 Deferred Items
- Old-code-path-removal scope narrowed: `agent_runs.blocked_reason` NOT removed (still the UI discriminator); explicit list of what cleanup PR removes (iter 3).

### §18 Self-Consistency Pass
- Rewritten in per-kind terms (Path B): OAuth atomicity via `sendWithTx`; approval atomicity via caller-supplied tx; no more "unified queue-based resume" claim (iter 5).

### Frontmatter
- `Status:` updated draft → reviewing (iter 1).

---

## Rejected findings

None. No Codex finding was rejected as wrong-on-merits.

One Codex finding (iter 1 #13 — transactional event emission) was AMBIGUOUS between architectural (scope-expansion) and precision-of-claim (mechanical); the precision-of-claim option was applied.

One structural family in iter 4 (Codex F1, F2, F4 — approval-resume queue choice) contained a directional kernel that was AUTO-DECIDED (Path B). The kernel is logged to `tasks/todo.md` as **OPLB-SR-IT4-D1**.

---

## AUTO-DECIDED — routed to tasks/todo.md

**OPLB-SR-IT4-D1 (iter 4): Approval-resume async path deferred.** The spec's original assumption — approval-kind waitpoints enqueue to the `workflow-resume` pg-boss queue — was structurally wrong (that queue is the legacy `flowRuns` path; workflow-engine HITL approval resume is INLINE inside `reviewService.approveItem`). Per Step 7 priority 3 (prefer existing primitives, prefer simplicity), Path B was chosen: approval waitpoint is token + expiry + idempotency only, with `completeWaitpoint` called inside `reviewService.approveItem`'s existing transaction and no new pg-boss queue. Path C (async-ify with a new queue) is deferred. Operator may revisit if async approval resume becomes desirable. Non-blocking.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. The human has adjudicated every directional finding that surfaced. However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written, re-read §3 Framing Assumptions and §17 Deferred Items before calling this implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- **Path B note**: the AUTO-DECIDED resolution OPLB-SR-IT4-D1 (no new pg-boss queue for approval resume) is the conservative choice but is a deliberate scope narrowing relative to the brief's "migrate both call sites" wording. The brief's intent is preserved in spirit — both call sites do use the waitpoint primitive for token + expiry + idempotency — but the approval-resume side-effect path remains synchronous. If the operator prefers Path C (async-ify approval resume), the spec needs a new chunk + new queue + new handler before build.

**Recommended next step:** read the spec's framing sections (§1 Goals, §2 Non-Goals, §3 Framing Assumptions, §11 Execution Model, §17 Deferred Items, OPLB-SR-IT4-D1) one more time, confirm the headline framing matches your current intent, accept the spec (`Status: accepted`), and proceed to the architect plan-breakdown phase.
