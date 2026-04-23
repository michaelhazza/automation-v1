# Spec Review Iteration 2 — cached-context-infrastructure

**Iteration:** 2 of 5 (lifetime cap)
**Timestamp:** 2026-04-22T21-58-51Z
**Spec commit at start:** 622f4848b36c... (post-iter-1)
**Codex raw output:** `_spec-review-cached-context-infrastructure-iter2-codex-output.txt`

## Classification summary

Codex surfaced 11 distinct findings, all follow-ups from iteration-1 fixes that did not fully cascade through prose. All classified mechanical. Zero directional. Zero ambiguous.

## Findings (all mechanical)

| # | Section | One-line description |
|---|---|---|
| G1 | §1–§11.3 | residual `UNIQUE(prefix_hash)` references (overview + concurrency test text) inconsistent with new `(pack_id, prefix_hash)` — normalise |
| G2 | §4.4 + §15.5 + §16.6 | "join `llm_requests.prefix_hash` to the snapshot" is wrong — call-level hash cannot match per-pack rows; describe the `pack_snapshot_ids` join path |
| G3 | §6.4 step 5 | `.sort()` sorts hashes lexicographically, not by `packId`; must match cross-pack ordering rule |
| G4 | §1.2 + §1.5 + overview | remaining `document_content_hashes` (snake_case) references in Overview + §3.3 summary must become `document_serialized_bytes_hashes` |
| G5 | §6.6 + §10 Phase 4 + §13.5 | file inventory (§13.5) says `llmRouter.ts` writes `llm_requests.prefix_hash` in Phase 4, but Phase 4 acceptance says the column lands Phase 5 — align |
| G6 | §6.1 + §6.4 + §6.6 + §12.14 | `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` has no named runtime check site nor `failureReason` mapping — name the assembly-time check + map to `failureReason='document_token_count_missing'` |
| G7 | §4.6 + §6.6 | `failureReason` union has 9 values; emission paths for non-HITL values are not named — add an error-to-failureReason mapping table |
| G8 | §6.3 + §6.6 | `ON CONFLICT DO NOTHING` loser has no named error path if re-select still misses; add retry or named error |
| G9 | §5.8 + §6.6 + §11.2 | failed-path runs after successful snapshot resolution don't persist `pack_snapshot_ids` + `variable_input_hash` on `agent_runs` — fix terminal-write for failed path |
| G10 | §8.6 + §11.4 | `packUtilizationJob` carve-out claims "maintenance scripts recognise it" but no allow-list file is named — name the `verify-rls-contract-compliance.sh` allow-list |
| G11 | §2.1 + §6.6 | `maxTokens` claimed to be "existing router parameter" in §6.6 but §2.1 doesn't list it — document or reframe |
| G12 | §1.2 + §4.3 + §6.4 | Overview prose "assembly reads from the snapshot, not from live tables" is now stale — prose must say the engine uses the snapshot as identity+integrity and reads pinned version rows |

## Action counts

- Mechanical accepted: 12 (Codex 11 raw findings, G4 split overview cascade from its original bullet)
- Mechanical rejected: 0
- Directional: 0
- Ambiguous: 0
- AUTO-DECIDED: 0

Proceeding to Step 6: apply all 12 fixes.
