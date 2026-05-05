# Spec Review Iteration 1 — cached-context-infrastructure

**Iteration:** 1 of 5 (lifetime cap)
**Timestamp:** 2026-04-22T21-43-08Z
**Spec commit at start:** da825a10ae5f630d398c24837596e401c6baa39b
**Codex raw output:** `_spec-review-cached-context-infrastructure-iter1-codex-output.txt`

## Classification summary

Codex surfaced 23 distinct findings. All 23 are mechanical (spec-internal consistency bugs, contract gaps, stale text, missing verdicts, file-inventory drift). Zero directional. Zero ambiguous. Consistent with four prior external-review passes having drained the directional backlog.

## Findings (mechanical, all auto-applied)

| # | Section | One-line description |
|---|---|---|
| F1 | §4.1 + §6.5 | `reserveOutputTokens` narrowed to equal `maxOutputTokens` under task override; clarify intent |
| F2 | §4.1 + §4.5 + §6.4 | `thresholdBreached='per_document_cap'` requires `perDocumentMaxTokens` in `ResolvedExecutionBudget`; `'max_total_cost_usd'` has no assembly-time pricing source — drop it |
| F3 | §4.1 + §4.5 + §6.6 | `maxOutputTokens` has no enforcement path; wire through to router as the response cap |
| F4 | §4.4 + §5.9 | phantom `llm_requests.prefix_hash_components` column — remove mention in §4.4 |
| F5 | §4.3 + §5.2 + §6.3 | per-doc hash field named `contentHash` in snapshot vs `serializedBytesHash` in version row — rename snapshot field |
| F6 | §4.3 + §6.4 | engine cannot reconstruct prefix from snapshot alone — fix prose; engine reads pinned version rows |
| F7 | §5.6 | `UNIQUE(prefix_hash)` collides across packs with identical doc sets — change to `(pack_id, prefix_hash)` |
| F8 | §4.2 + §6.3 + §6.6 | multi-pack → single `llm_requests.prefix_hash` aggregation rule undefined — add `computeAssembledPrefixHash` |
| F9 | §6.4 + §11.1 | cross-pack flattening order not defined — order snapshots by `packId` asc, docs by `documentId` asc within snapshot |
| F10 | §4.2 + §6.6 | orchestrator return type unsatisfiable on failed path — discriminated union |
| F11 | §5.5 + §6.2 | re-attach after detach: §5.5 says new row, §6.2 says idempotent — align on §5.5 |
| F12 | §9.3 + §5.11 + §6.6 | "atomic terminal write" claim overblown — rewrite to describe orchestrator's UPDATE with optimistic `run_outcome IS NULL` lock |
| F13 | §6.6 | HITL approval re-assembly unbounded — cap at one retry |
| F14 | §6.7 + §8.6 | packUtilizationJob is cross-tenant; carve out §8.6 to allow `withAdminConnection` following existing convention (memoryDedupJob etc.) |
| F15 | §6.7 | stale utilization when `snapshot.packVersion < pack.currentVersion` — fall back to live-member recomputation |
| F16 | §8.1 + §8.5 | RLS template doesn't permit `organisation_id IS NULL` platform defaults — add explicit policy block for `model_tier_budget_policies` |
| F17 | §6.6 + §9.4 | phantom TTL resolver-narrowing — drop narrowing claim, treat `ttl` as caller hint |
| F18 | §10 Phase 4 + §11.2 | Phase 4 integration test asserts Phase 5 columns — move test to Phase 5 |
| F19 | §15 | stale `cached_prefix_hash` reference — rewrite to match implemented schema |
| F20 | §15 Q4 | "confirm during Phase 5" is not a verdict — convert to explicit v1 decision |
| F21 | §5.2 + §12.5 | new model-family backfill path undefined — add deferred item §12.14 |
| F22 | §7.1 + §6.1 | `GET /api/reference-documents/:id/versions` has no service method — add `listVersions` |
| F23 | R8 + §11.1 | golden-fixture asserts only hash, not assembled bytes — expand fixture to cover multi-pack assembled prefix |

## Action counts

- Mechanical accepted: 23
- Mechanical rejected: 0
- Directional: 0
- Ambiguous: 0
- AUTO-DECIDED (tasks/todo.md): 0

Proceeding to Step 6: apply all 23 fixes.
