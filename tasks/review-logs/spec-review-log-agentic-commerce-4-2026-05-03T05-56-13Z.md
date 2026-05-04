# Spec Review Iteration 4 — agentic-commerce

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Iteration:** 4 of 5
**Started:** 2026-05-03T05-56-13Z
**Reviewer:** Claude Opus 4.7 (1M context) + Codex (`codex exec --sandbox read-only`)

## Codex output

9 distinct findings. All 9 mechanical. Notable: several are regressions from my own iter 3 fixes (e.g. `executed` rows in execution-timeout job conflicts with §16.6 reconciliation; `expires_at`/`approval_expires_at` listed as immutable but state machine sets them at transitions).

## Findings 1-5

### FINDING #4.1 — `succeeded` declared terminal but state machine has succeeded → refunded / disputed

- Source: Codex (#1)
- Section: §4 States/Transitions/Rules, §9.4
- Description: §4 rule said "succeeded is terminal. No further transitions." But the same §4 has succeeded → refunded and succeeded → disputed transitions.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §4 Rules — `succeeded` reclassified as "conditionally terminal" — terminal under normal flow but the explicit Stripe-driven transitions (succeeded → refunded for dispute-loss; succeeded → disputed for chargeback-open) are allowed paths out per §4 transitions. Callers treat succeeded as terminal; the dispute / refund post-transitions are observability-only.

### FINDING #4.2 — Execution-timeout job conflicts with §16.6 reconciliation rules

- Source: Codex (#2)
- Section: §4 Rules, §12, §16.6
- Description: My iter-3 fix put `executed` rows in the timeout job's scan, but §16.6 says executed rows stay executed pending webhook/reconciliation.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §4 Rules — Timeout job now scans `WHERE status = 'approved' AND expires_at < NOW()` only. `executed` rows are NOT touched by the timeout job; they live forever pending webhook arrival or worker completion (§16.6 reconciliation poll surfaces stale ones as warnings). Note added explaining the boundary.

### FINDING #4.3 — `expires_at` / `approval_expires_at` declared immutable but transitions set them

- Source: Codex (#3)
- Section: §5.1, §4 Rules
- Description: My iter-1 fix listed expires_at and approval_expires_at as immutable post-insert, but state machine transitions set them.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §5.1 — Both columns moved INTO the mutable-on-transition allowlist. `expires_at` set at proposed → approved; `approval_expires_at` set at proposed → pending_approval. Removed from the immutable column list.

### FINDING #4.4 — Worker completion needs to UPDATE provider_charge_id while staying in `executed`

- Source: Codex (#4)
- Section: §5.1, §6.1 worker-hosted-form path, §8.4a
- Description: My iter-3 WorkerSpendCompletion handler updates provider_charge_id without changing status, but the trigger only allowed updates as part of a status transition.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §5.1 — Trigger's "valid lifecycle UPDATE" check now accepts EITHER a status transition listed in §4 OR a non-status update setting only provider_charge_id (+updated_at) on a row already in `executed` (the only no-op-status update permitted). Gated on caller identity matching the WorkerSpendCompletion handler.

### FINDING #4.5 — WorkerSpendRequest carries `agentRunId` not `skillRunId`

- Source: Codex (#5)
- Section: §8.3, §9.1, §8.1
- Description: Idempotency key uses skillRunId; ChargeRouterRequest has skillRunId; WorkerSpendRequest had only agentRunId. Main app couldn't recompute the key from the wire fields.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §8.3 — Replaced `agentRunId` with `skillRunId` in WorkerSpendRequest. Note added clarifying that skillRunId and agentRunId refer to the same uuid throughout the spec; the wire/contract field is named skillRunId for consistency with §8.1 and §9.1.

## Findings 6-9

### FINDING #4.6 — Shadow response shape inconsistency

- Source: Codex (#6)
- Section: §6.1, §8.2, §14
- Description: §6.1 said "same response shape as live"; §8.2 has a distinct `shadow_settled` union member; §14 says worker returns chargeToken: null in shadow.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §6.1 + §14 — §6.1 now says shadow returns the distinct `{ outcome: 'shadow_settled', chargeId }` per §8.2 (not "same shape as live"); chargeToken/providerChargeId fields absent. §14 expanded to spell out the per-execution-path shadow behaviour: worker-hosted-form skips form-fill in shadow; main-app-direct skips Stripe API call in shadow; no executed transition in shadow.

### FINDING #4.7 — `shared/iee/actionSchema.ts` modifications inconsistent

- Source: Codex (#7)
- Section: §5.2, §17 Chunk 11, §18.2
- Description: §5.2 said the schema adds only `spend_request`; my iter-3 Chunk 11 update added `spend_completion` too. §5.2 was stale.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §5.2 — Updated to "Add `spend_request` and `spend_completion`" with note explaining `spend_completion` fires only on the worker_hosted_form path corresponding to the §8.4a queue contract.

### FINDING #4.8 — Authority model ambiguous for ex-admins retaining permission

- Source: Codex (#8)
- Section: §11.1
- Description: My iter-3 fix said "admins removed from role retain spend_approver until explicit revoke" but scope membership is defined in role terms — what happens to a former admin who keeps the permission?
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §11.1 Authority rule — Made explicit: scope membership is evaluated against the user's CURRENT role state. A former admin who lost the role but retained the permission falls out of authority for any budget where they were not added to `spending_budget_approvers`. The role-based default grant evaporates the moment the role is removed. Operators wanting a former admin to retain authority must add them to `spending_budget_approvers` BEFORE removing the role.

### FINDING #4.9 — Webhook route path inconsistency (`:connectionId`)

- Source: Codex (#9)
- Section: §7.5, §11.3, §17 Chunk 12
- Description: §7.5 + §11.3 use `/api/webhooks/stripe-agent/:connectionId`; Chunk 12 still said `/api/webhooks/stripe-agent`.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §17 Chunk 12 — Path updated to `/api/webhooks/stripe-agent/:connectionId` with cross-reference to §7.5 explaining the connectionId is required for signature lookup.

## Iteration 4 Summary

- Mechanical findings accepted:  9
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set by commit step)

Stopping heuristic check: iter 4 was mechanical-only. Iter 1, 2, 3 all mechanical-only. Four consecutive mechanical-only rounds — far past the two-round threshold. However, iter 4 surfaced multiple regressions from my own iter-3 fixes (executed-rows-in-timeout-job, expires_at-immutability, provider_charge_id-no-status-update, agentRunId-vs-skillRunId). The pattern is "I introduce a small inconsistency in iteration N, Codex catches it in N+1". This suggests iteration 5 will likely find any regressions from iter 4's fixes. Run iteration 5 (the cap) for final convergence; if iter 5 produces only minor / no-substance findings, exit on that round.
