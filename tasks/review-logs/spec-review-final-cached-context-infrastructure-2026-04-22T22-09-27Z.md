# Spec Review Final Report — cached-context-infrastructure

**Spec:** `docs/cached-context-infrastructure-spec.md`
**Spec commit at start:** da825a10ae5f630d398c24837596e401c6baa39b
**Spec commit at finish:** c7ea51cbdcb28b2ecb9731493a5834483dd89f64
**Spec-context commit:** `docs/spec-context.md` (unchanged — 2026-04-21 22:23:24)
**Iterations run:** 2 of 5 (lifetime cap)
**Exit condition:** two-consecutive-mechanical-only

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|
| 1 | 23 | 0 (merged) | 23 | 0 | 0 | none |
| 2 | 11 | 1 (cascade, merged) | 12 | 0 | 0 | none |

**Total mechanical fixes applied:** 35
**Total findings rejected:** 0
**Total directional / ambiguous findings:** 0

Every Codex finding across both rounds was a genuine consistency or contract bug. No directional signals surfaced; this is consistent with the spec having been through four external-review passes before this loop.

---

## Mechanical changes applied — grouped by spec section

### Contracts (§4)
- §4.1 added `perDocumentMaxTokens`; clarified `maxOutputTokens ≤ reserveOutputTokens` equality under narrowing
- §4.2 `prefixHash` is now the call-level assembled hash; per-pack components live only on snapshot rows
- §4.3 renamed per-doc hash field `contentHash` → `serializedBytesHash`; documented `UNIQUE(pack_id, prefix_hash)` per-pack dedup
- §4.4 renamed `documentContentHashes` → `documentSerializedBytesHashes`; removed phantom `llm_requests.prefix_hash_components` column; documented correct diagnosis path via `agent_runs.pack_snapshot_ids`
- §4.5 dropped `max_total_cost_usd` from `thresholdBreached` enum (cost enforcement → existing `runCostBreaker`); referenced one-retry cap
- §4.6 rewrote "atomic terminal write" invariant to match the actual UPDATE-with-optimistic-lock mechanism

### Schema (§5)
- §5.2 clarified `contentHash` (raw) vs `serializedBytesHash` (prefix identity) roles
- §5.6 changed unique index from `(prefix_hash)` → `(pack_id, prefix_hash)`; added non-unique prefix_hash lookup index
- §5.11 summary table updated; run-outcome invariant rewritten

### Services (§6)
- §6.1 added `listVersions()`; extended error codes with `CACHED_CONTEXT_DOC_CONTAINS_DELIMITER`, `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING`
- §6.2 aligned `attach` prose with §5.5 partial-unique-index semantics
- §6.3 added token-count-presence check (new failure path) + ON-CONFLICT-retry path emitting `CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST`; renamed `contentHash` → `serializedBytesHash` in pure signatures
- §6.4 added pre-step: engine loads pinned version rows + re-hashes (throws `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION`); added `computeAssembledPrefixHash`; fixed hash-sort bug (sort snapshots by packId, not hashes lexicographically)
- §6.5 clarified step 4 narrowing semantics
- §6.6 made `CachedContextOrchestratorResult` a discriminated union with 11-value `failureReason` enum; added explicit error-to-failureReason mapping table; bounded HITL loop at one retry; wired `maxOutputTokens` to router; rewrote terminal UPDATE to COALESCE pack_snapshot_ids + variable_input_hash (failed-path attribution); dropped phantom TTL narrowing
- §6.7 declared `withAdminConnection` + `admin_role`; added live-member-recomputation fallback for stale snapshots

### Permissions / RLS (§8)
- §8.1 added custom RLS policy for `model_tier_budget_policies` (permits `organisation_id IS NULL` platform defaults for SELECT)
- §8.6 added documented carve-out for `packUtilizationJob`; named `scripts/gates/rls-bypass-allowlist.txt` as the explicit compliance mechanism

### Execution model (§9)
- §9.3 rewrote transactional boundaries to describe the actual pattern
- §9.4 dropped phantom TTL resolver-narrowing

### Phased implementation (§10)
- Phase 4 acceptance clarified (llm_requests columns land Phase 5)
- Router-side additions: reconciled two-phase landing

### Testing (§11)
- §11.1 three-layered golden-fixture test (per-pack hash, assembled bytes, call-level hash)
- §11.2 integration test moved to Phase 5; added `hitl_second_breach` retry-cap case
- §11.3 concurrency test updated for new uniqueness
- §11.4 added allow-list compliance check

### Deferred items (§12)
- Added §12.14 (new-model-family backfill) and §12.15 (resolver-narrowed cache TTL)

### File inventory (§13)
- §13.5 router entry updated; §13.10 added RLS bypass allow-list file; §13.11 moved integration test to Phase 5

### Risks / open questions / success criteria (§14–§16)
- R3, R8 updated for new uniqueness + golden fixture
- §15 item 5 rewritten to match implemented schema; Q4 converted to explicit v1 decision
- §16.6 success criterion rewritten for correct diagnosis path

### Framing (§1–§2)
- Overview items 2, 4, 5 rewritten (snapshot semantics, full ExecutionBudget shape, split per-pack/call-level prefix-hash contracts)
- §2.1 documented existing `maxTokens` router parameter

---

## Rejected findings

None. Both iterations produced only mechanical findings; none were framing-level or false positives.

## Directional / ambiguous findings (autonomously decided)

None. `tasks/todo.md` was not appended during this review.

---

## Mechanically tight, but verify directionally

The spec is now mechanically tight against the rubric and against Codex's best-effort review after two iterations. All 35 findings across the two rounds were mechanical consistency bugs (contract mismatches, stale terminology, file-inventory drift, missing verdicts, missing error paths, phase-sequencing bugs). The exit condition — two consecutive mechanical-only rounds — is the ideal convergence signal for a spec that has been through multiple external-review passes.

**Not re-verified in this loop:**

- Framing assumptions. The spec self-asserts alignment with `docs/spec-context.md`. The loop accepted those assertions; re-read §Framing / §3 / §9.5 / §11 yourself before calling this implementation-ready.
- Scope sequencing across the 6-phase plan. Per-phase self-consistency was verified; overall pacing, the Phase 4/5 split, and the Phase 6 pilot gate are still product decisions.
- Directional judgement. Automated review does not generate insight from product judgement. New-primitive vs memory-block-extension, three-input budget narrowing, HITL-block-on-breach posture — all still human decisions.
- Implementation-time gates. The loop does not verify that the services the spec names will pass `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, or the pure-function test golden fixtures once actually implemented — those gates run at implementation time.

**Recommended next step:** read the spec's §Framing (first ≈200 lines) and §9 Execution Model once more, confirm the headline posture still matches intent, and then start implementation against the 6-phase plan.
