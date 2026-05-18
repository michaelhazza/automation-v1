# Spec Review Log — oss-pattern-lifts-bundle — Iteration 3

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Iteration:** 3 / 5
**Codex raw output:** `tasks/review-logs/_codex_oss-pattern-lifts-bundle_iter3_2026-05-18T12-33-02Z.txt`

## Findings (all mechanical)

**F1 §5.1/§7.3 — validation says approval requires boundRunId; §7.3 makes it optional.** Mechanical contradiction introduced by iter 2. Resolution: only `oauth` requires `boundRunId`; `approval` may omit (the new spec-cycle pattern binds via `resumePayload.approvedActionId` and the actions row). Fix: §5.1 validation tightened to oauth-only; §3 framing updated; §5.3 approval cleanup pivots to actionId-based lookup (see F4).

**F2 §7.3 — action.agentRunId not in scope at dispatch.ts.** Verified — `executeActionCall` returns only `{status, actionId}`. Fix: change the §7.3 approval CREATE-side text to NOT reference `action.agentRunId` directly; instead use `result.actionId` and look up the actionRow by id with `WorkflowStepRunId` predicate filtering — OR, even simpler, leave `boundRunId: undefined` for approval waitpoints (they bind to actions/step runs, not agent_runs directly). I'll go with the simpler option: approval waitpoints have `boundRunId: undefined`, and §5.3 expireWaitpoints uses `resumePayload.approvedActionId` to locate the workflow_step_run for cleanup.

**F3 §5.3 — admin-role cleanup must explicitly use org-bound predicates.** With `SET LOCAL ROLE admin_role`, RLS is bypassed, so a `WHERE id = $1` lookup could in principle return rows from any org. Fix: every downstream UPDATE in expireWaitpoints must include `AND organisation_id = wp.organisation_id` to preserve the org boundary the waitpoint row itself enforced. State this explicitly.

**F4 §5.3/§7.3 — approval cleanup must locate step via approvedActionId, not bound_run_id.** Combined with F2: approval waitpoints have `bound_run_id` undefined, so the cleanup must use `resumePayload.approvedActionId` to find the action, then `actions.workflowStepRunId` (or equivalent) to find the step run, transitioning it from `awaiting_approval` to `failed` with org predicate.

**F5 §5.1/§8.1 — §8.1 still says return shape is `{plaintext}`.** Genuine omission in iter 2. Fix: update §8.1 to `{plaintext, expiresAt}` and document permitted persistence of `expiresAt`.

**F6 §16/§5.3 — CI gate description doesn't cover SET LOCAL ROLE / org-bound predicates.** Mechanical (gate-description completeness). Fix: §16 extends to mention `SET LOCAL ROLE admin_role` inside `expireWaitpoints` and the org-bounded downstream-update predicates. Static-gate enforcement is out of scope for this build (no new gate scripts), but the description in §16 should match what the implementation must do.

**F7 §17/§7.2/§5.3 — cleanup PR can't safely remove `agent_runs.blocked_reason`.** Genuine bug in §17 — §7.2 confirms `blocked_reason` is still written as the UI discriminator. Removing it would break the blocked-state UI surface. Fix: §17 narrows the cleanup-PR scope to remove only `integration_resume_token`, `blocked_expires_at`, the old expiry-job code, and the env var. `blocked_reason` stays until a replacement discriminator is designed (separate spec, deferred).

**F8 §5.3/§17 — "blockedRunExpiryJob finds zero candidates" overclaims.** Legacy rows created before the flag flips still carry `blocked_expires_at`. Fix: soften to "blockedRunExpiryJob drains any legacy rows until the cleanup PR removes it; new waitpoint-created rows don't carry `blocked_expires_at` and are handled by the new sweep."

## Rubric findings

None new.

## Counts

- Codex findings: 8
- Rubric findings: 0
- Mechanical accepted: 8
- Mechanical rejected: 0
- Directional / ambiguous resolved: 0
- AUTO-DECIDED: 0
- Reclassified → directional: 0
