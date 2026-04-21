# Spec Review Log — Iteration 4

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit at iteration start:** `947111d0ddb919023ddb7bdfd58af8579197499a` + iter 1/2/3 uncommitted edits + iter-3 HITL edits applied this session
**Iteration:** 4 of 5
**Timestamp:** 2026-04-21T04:00:00Z

## Iteration-3 HITL decisions applied (before Codex pass)

- **3.1 (apply)** — Dropped `PlaybookRunDetailPage.tsx` from Phase A. Updated §2, §3 in-scope, §4.1 row + totals, §5.3 prose, §5.5 layout table, §5.9 done #1, §9 framing counts, §10 step 2. Added §11.4 #10 deferred item for playbook-run cost visibility.
- **3.2 (apply)** — Kept `runResultStatus='partial'` for `outcomeLearningService` call site. Added trailing `options?: { taskSlug?; overrides?: { isUnverified?; provenanceConfidence? } }` bag to `extractRunInsights`. Updated §4.2 `outcomeLearningService` row, §4.2 `workspaceMemoryService` row, §6.4 signature + second-caller bullet, §6.7.1 caller-specific exception, §8.3 `ExtractRunInsightsOptions` contract, §9.2 override test case.

## Codex findings (iteration 4)

### FINDING #1 — §7.3 pseudocode bare-`assertWithinRunBudget` vs §7.4.1/§4.3/§8.3 direct-ledger selector
- Source: Codex P1
- Classification: mechanical (internal contradiction — architectural choice already pinned; only the pseudocode needs to reflect it)
- Disposition: **auto-apply**

### FINDING #2 — Frontend + API-contract test surfaces lack explicit HITL framing override
- Source: Codex P2 (actually P1 in Codex output)
- Classification: directional — but **already HITL-resolved in iteration 1**
- Disposition: **reject** (already resolved). The §9 lines 891-896 framing-deviation acknowledgement section is the documented override; the audit trail is `tasks/spec-review-checkpoint-hermes-audit-tier-1-1-2026-04-21T01-35-09Z.md`. Re-raising a resolved HITL finding does not advance the spec.

### FINDING #3 — `options.overrides` test case placed in pure test file; pure exports have no overrides surface
- Source: Codex P1
- Classification: mechanical (introduced by iter-3 edit — my own error)
- Disposition: **auto-apply**

### FINDING #4 — §5.1 / §5.3 / §11.5 stale prose after PlaybookRunDetailPage drop
- Source: Codex P2
- Classification: mechanical (stale language cleanup)
- Disposition: **auto-apply**

### FINDING #5 — §1 / §4.5 / §11.4 prose claims "consume `TrajectoryDiff.pass`", contradicts §6.4's "always `null` in Phase B"
- Source: Codex P2
- Classification: mechanical (stale framing from early draft; detailed contract is clear)
- Disposition: **auto-apply**

### FINDING #6 — §6.3.1 service-boundary guard names unknown `finaliseAgentRun`; load-bearing claim without contract
- Source: Codex P2
- Classification: mechanical (rubric — load-bearing claim without contract)
- Disposition: **auto-apply** — rewrite the guard to pin it at each write site with a SQL-level `WHERE run_result_status IS NULL` clause on the atomic UPDATE, which is the natural idempotency guarantee.

### FINDING #7 — PR review log artifact not in §4 inventory; inventory lock is ambiguous about generated artifacts
- Source: Codex P2
- Classification: mechanical (inventory clarity)
- Disposition: **auto-apply** — add a short exemption note to §4 for generated review / log artifacts.

## Mechanical accepts this iteration

- [ACCEPT] §7.3 pseudocode — aligns bare `assertWithinRunBudget` call with §7.4.1/§4.3 direct-ledger decision.
- [ACCEPT] §9.2 test plan — move `options.overrides` test case out of the pure test file.
- [ACCEPT] §5.1 / §5.3 / §11.5 — drop stale PlaybookRunDetailPage phrasing ("agent or playbook run", "all four host pages").
- [ACCEPT] §1 / §4.5 / §11.4 #6 — downgrade "consume `TrajectoryDiff.pass`" to "reserved forward-compatible slot".
- [ACCEPT] §6.3.1 — replace vague `finaliseAgentRun` service-boundary guard with a SQL-level `WHERE run_result_status IS NULL` clause on each atomic UPDATE.
- [ACCEPT] §4 — explicitly exempt generated review / log artifacts from the inventory lock.

## Rejects this iteration

- [REJECT] Finding #2 — already HITL-resolved in iteration 1. Audit trail exists. Re-raising does not advance the spec.

## Iteration 4 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  1 (resolved-in-prior-iteration, not a wrong rejection)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec commit after iteration:   947111d + iter 1/2/3 + iter-3 HITL + iter 4 mechanical (uncommitted)
