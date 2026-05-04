# Spec Review Iteration 5 — agentic-commerce (lifetime cap)

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Iteration:** 5 of 5 (lifetime cap)
**Started:** 2026-05-03T06-01-55Z
**Reviewer:** Claude Opus 4.7 (1M context) + Codex (`codex exec --sandbox read-only`)

## Codex output

5 distinct findings. All 5 mechanical. Codex closed with: "Those are the remaining material issues I'd block on; I would not add more beyond these." — explicit convergence signal.

## Findings 1-5

### FINDING #5.1 — `succeeded` "conditionally terminal" still self-contradictory with §9.4

- Source: Codex (#1)
- Section: §4 / §9.4 / §10
- Description: My iter-4 fix called succeeded "conditionally terminal" but §9.4 still said "every charge produces exactly one terminal state transition" — implies succeeded counts as terminal, contradicting the succeeded → refunded / disputed transitions.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §4 + §9.4 + §10 invariant 9 + §16.2 + §9.3 — Reclassified as: succeeded and disputed are NON-terminal at the state-machine level. Truly-terminal set: blocked, denied, failed, shadow_settled, refunded. §9.4 prose now says "every charge eventually settles in exactly one truly-terminal state". Reserved-capacity math also fixed: settled-bucket = succeeded + (refunded subtracts); reserved-bucket = pending_approval + approved + executed; disputed and succeeded are NOT double-counted; shadow_settled doesn't move money.

### FINDING #5.2 — Org-scoped budgets: which SPT do they spend through

- Source: Codex (#2)
- Section: §3, §7.4, §15
- Description: SPTs are per-sub-account. Portfolio Health Agent has org-level budget that attributes to recipient sub-accounts. Spec didn't say which SPT the cross-sub-account spend uses.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §3 — Added explicit rule: live execution resolves SPT from `agent_charges.subaccount_id` (the recipient sub-account). If recipient has no active stripe_agent connection, charge is blocked with `reason = 'spt_unavailable'`. Operators must onboard each recipient sub-account before org-scoped budget can fund charges to it.

### FINDING #5.3 — §18.2 missing `spend_completion` worker-side modifications

- Source: Codex (#3)
- Section: §5.2 vs §17 Chunk 11 vs §18.2
- Description: Iter 3/4 added spend_completion to §5.2 + Chunk 11 but §18.2 still said only "spend_request" for the worker-side files.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §18.2 — `shared/iee/actionSchema.ts`, `worker/src/loop/executionLoop.ts`, `worker/src/persistence/runs.ts` entries now all explicitly include both spend_request and spend_completion modifications.

### FINDING #5.4 — Promote-to-live route in Chunk 13 vs workflow in Chunk 15 sequencing

- Source: Codex (#4)
- Section: §11.3, §17 Chunks 13 + 15, §18.1
- Description: Chunk 13 ships the promote-to-live route + `spendingBudgets.ts` but Chunk 15 ships the actual HITL action and policy-flip logic.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §17 Chunks 13 + 15 — Chunk 13 ships the route SHELL only, returning HTTP 501 with `reason: 'promotion_flow_pending'` until Chunk 15 lands. Chunk 15 explicitly replaces the Chunk 13 stub with the working implementation. UI in Chunk 13 shows "promote to live: not yet available"; replaced by working button + modal in Chunk 15.

### FINDING #5.5 — Invariant 3 "bound to one ledgerRowId" overclaims actual enforcement

- Source: Codex (#5)
- Section: §10 invariant 3, §20
- Description: Invariant 3 said "bound to one ledgerRowId" but the listed enforcement only achieves one-delivery + same-call idempotency, not cryptographic binding.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §10 invariant 3 — Replaced overclaim with truthful operational-discipline statement. The SPT is the raw Stripe SPT (NOT cryptographically bound to the ledger row); v1 enforcement is operational (worker code MUST drop the token, MUST attach charge idempotency_key as Stripe header) plus the DB UNIQUE constraint. Cross-charge reuse risk is acknowledged and tracked as a §20 hardening item ("Server-minted single-use chargeToken wrapper").

## Iteration 5 Summary

- Mechanical findings accepted:  5
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (set by commit step)

Iteration 5 hit the lifetime cap. Codex's closing statement ("I would not add more beyond these") plus the small finding count and absence of new structural concerns indicate the spec has converged. Exit on iteration-cap.
