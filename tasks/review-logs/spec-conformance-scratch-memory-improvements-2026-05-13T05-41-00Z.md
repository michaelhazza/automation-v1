# Spec Conformance Scratch — memory-improvements

**Spec:** docs/superpowers/specs/2026-05-13-memory-improvements-spec.md (Status: accepted, locked 2026-05-13)
**Plan:** tasks/builds/memory-improvements/plan.md
**Branch:** claude/add-memvid-integration-ehAOr
**Base:** effe82ac
**Scope:** All 11 chunks
**Run at:** 2026-05-13T05:41:00Z

## TOC
- Chunk 1 — A: Migration 0333 + RLS manifest (REQ #1–7)
- Chunk 2 — A: Lineage write at synthesis (REQ #8–15)
- Chunk 3 — A: Sources route + UI tab (REQ #16–24)
- Chunk 4 — B1: Migration 0334 + agentExecutionService write (REQ #25–28)
- Chunk 5 — B1: Materialised view + nightly refresh (REQ #29–38)
- Chunk 6 — B2: Memory Utility API route (REQ #39–44)
- Chunk 7 — B2: Daily-series pure helper + tests (REQ #45–48)
- Chunk 8 — B2: Dashboard UI tab (REQ #49–54)
- Chunk 9 — D: Semantic ranker behind env flag (REQ #55–61)
- Chunk 10 — D: Telemetry + observability wiring (REQ #62–64)
- Chunk 11 — Doc-sync (REQ #65–67)
- Cross-chunk (REQ #68)
- Summary

---

## Chunk 1 — A: Migration 0333 + RLS manifest entry

**REQ #1** — Category: migration. Spec §4 Phase 1, §5.1. Migration `0333_memory_block_version_sources.sql` creates table + RLS + FORCE RLS + four indexes. **MECHANICAL_GAP** — file uses INVALID PostgreSQL syntax `ENABLE/FORCE ROW LEVEL SECURITY ON memory_block_version_sources;` (lines 25-26). Spec §4 Phase 1 and all neighbouring migrations (0079-0083) use `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`. Migration would fail at deploy. Fix: replace with `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY;` form.

**REQ #2** — Down migration file present. PASS.

**REQ #3** — Drizzle schema `memoryBlockVersionSources.ts` mirrors columns with `sourceType` narrowed to `$type<'workspace_memory'>()`. PASS (lines 15-37).

**REQ #4** — `server/db/schema/index.ts` exports new schema. PASS (lines 186-187).

**REQ #5** — `rlsProtectedTables.ts` has entry for `memory_block_version_sources`. PASS (lines 1302-1308).

**REQ #6** — Unique constraint on `(block_version_id, source_entry_id_hash)`. PASS (constraint name differs but column set matches; spec quote does not pin name).

**REQ #7** — Four indexes (idx_mbvs_block_version, _source_entry, _source_entry_hash, _source_run). PASS (lines 32-36).

---

## Chunk 2 — A: Lineage write at synthesis

**REQ #8** — New `memoryBlockLineageService.ts` exports `writeLineageRowsForVersion`. PASS.

**REQ #9** — Synthesis service wraps block insert + writeVersionRow + lineage write in single tx. PASS (memoryBlockSynthesisService.ts:200-254).

**REQ #10** — Lineage insert uses `onConflictDoNothing()`. PASS (line 117).

**REQ #11** — `entry.agentRunId == null` → all three run fields NULL, never inferred. PASS (lines 74-98).

**REQ #12** — sha256 hashes for `source_entry_id_hash`, `content_hash`; `source_type='workspace_memory'`. PASS.

**REQ #13** — Label format `"AgentName · YYYY-MM-DD HH:MM"` UTC. PASS (lines 34-42).

**REQ #14** — `writeVersionRow` null → skip lineage + INFO `synthesis.lineage_skipped_unchanged_content`. PASS (memoryBlockSynthesisService.ts:225-236).

**REQ #15** — `contribution_rank = i + 1` (1-indexed). PASS (line 112).

---

## Chunk 3 — A: Sources route + UI tab

**REQ #16** — `GET /api/memory-blocks/:id/sources` admin route, AGENTS_VIEW gate. PASS — shipped as `/api/orgs/:orgId/memory-blocks/:blockId/sources` per plan §10 Q2 explicit operator-approved deviation (org-scoped path enables 403-before-query).

**REQ #17** — 403-before-query UUID-canonicalised path/session compare. PASS (memoryBlockSources.ts:17-23).

**REQ #18** — New `memoryBlockSourcesService.ts`. PASS.

**REQ #19** — New `memoryBlockSourcesServicePure.ts` (zero DB imports). PASS.

**REQ #20** — Payload shape per §6.1: `blockId`, `blockVersionId`, `versionNumber`, `capturedAt`, `sources[]` with nested `sourceEntry: { id, content, isDeleted } | null`, `sourceRun: { id, label, isDeleted } | null`, plus `sourceEntryIdHash`, `contentHash`, `sourceRunLabelAtCapture`, optional `reverseLineageByEntry`. **DIRECTIONAL_GAP** — shipped payload exposes top-level `{ blockId, blockSource, versionNumber, sources, reverseLineageByEntry? }` (missing `blockVersionId`, `capturedAt`); each `sources[]` row is flattened (`sourceEntryId`, `contentExcerpt`, `isDeleted`, `sourceRunId`, `sourceRunLabel`, `sourceRunLabelAtCapture` collapsed to `sourceRunLabel`) instead of nested `sourceEntry: {…} | null` / `sourceRun: {…} | null` discriminated unions. UI consumes flattened form internally so no caller break in this branch, but the spec contract names the nested shape. Reshaping is a design choice — direction needs human decision.

**REQ #21** — Sources tab visible only when `block.source === 'auto_synthesised'`, hidden (not greyed) otherwise. PASS (MemoryBlockDetailPage.tsx:154-162).

**REQ #22** — Route wired in `server/index.ts`. PASS (lines 170, 381).

**REQ #23** — Pure-function test covers source present/soft-deleted/hard-deleted, run present/absent/both, reverse-lineage, empty input. PASS.

**REQ #24** — Soft-deleted strikethrough + reduced opacity; hard-deleted "(source removed)" placeholder. PASS (MemoryBlockSourcesTab.tsx:117-127).

---

## Chunk 4 — B1: Migration 0334 + agentExecutionService write

**REQ #25** — Migration 0334 adds `agent_runs.injected_entry_ids jsonb` nullable no DEFAULT. PASS.

**REQ #26** — Down migration present. PASS.

**REQ #27** — Drizzle field `injectedEntryIds: jsonb(...).$type<string[] | null>()`. PASS (agentRuns.ts:128-129).

**REQ #28** — agentExecutionService write site persists IDs fire-and-forget with `.catch(() => {})`. PASS (agentExecutionService.ts:1361-1368).

---

## Chunk 5 — B1: Materialised view 0343 + nightly refresh

**REQ #29** — `mv_memory_utility_30d` migration with per_run CTE + measured discriminator + COALESCE'd aggregates. PASS.

**REQ #30** — Null-stable unique index `idx_mv_memory_utility_30d` using `COALESCE(subaccount_id, '00…00'::uuid)`. PASS (lines 86-91).

**REQ #31** — pg-boss schedule cron `'0 16 * * *'` UTC, queue `refresh_memory_utility_30d`. PASS (agentScheduleService.ts:206-212).

**REQ #32** — `refreshMemoryUtility30dJob.ts` job handler. PASS.

**REQ #33** — Refresh wraps `REFRESH MATERIALIZED VIEW CONCURRENTLY ...` in `withAdminConnection` + advisory lock + SET LOCAL ROLE admin_role. PASS.

**REQ #34** — `rlsExclusions.ts` entry with route-layer rationale. PASS (line 25).

**REQ #35** — Events `memory_utility.refresh.completed` / `.attempt_failed` / (`.failed` optional per plan). PASS — completed + attempt_failed emitted; terminal `failed` deferred to DLQ exhaustion per plan.

**REQ #36** — Down migration `DROP MATERIALIZED VIEW IF EXISTS … CASCADE;`. PASS.

**REQ #37** — Drizzle MV declaration `mvMemoryUtility30d.ts` using `.existing()`. PASS.

**REQ #38** — `memoryUtilityAggregatorPure.ts` + `.test.ts` (per §5.1 + §12.1). **DIRECTIONAL_GAP** — file inventory at §5.1 lists these two files explicitly; neither exists in the branch. The aggregator logic was collapsed into the SQL CTE in migration 0343 (consistent with intent) and a daily-series pure helper was shipped instead (`memoryUtilityDailySeriesPure.ts`). Spec §12.1 also names `memoryUtilityAggregatorPure.test.ts` as a required pure-function test. Whether to ship the JS aggregator or rely on the SQL aggregate is a design choice — routing as DIRECTIONAL for human review.

---

## Chunk 6 — B2: Memory Utility API route

**REQ #39** — `GET /api/orgs/:orgId/usage/memory-utility` with `authenticate + requireOrgPermission(SETTINGS_VIEW)` + inline 403-before-query. PASS.

**REQ #40** — `memoryUtilityQueryService.ts` exposes `getMemoryUtilityForOrg(orgId)`. PASS.

**REQ #41** — Payload shape per §6.6: `organisationId`, `generatedAt`, `windowDays: 30`, `agents[]` (with all named per-row fields including `totalInjectedEntries`, `totalCitedEntries`, `totalInjectedBlocks`, `totalCitedBlocks`), `dailySeries[]`. **DIRECTIONAL_GAP** — shipped payload is `{ agents, dailySeries }` only (top-level fields `organisationId`, `generatedAt`, `windowDays` absent). The `AgentUtilityRow` interface only names `runsMeasuredEntries`, `runsUnmeasuredEntries`, `entryUtility30d`, `blockUtility30d` (the four spec totals are present in the rows because `db.select()` returns all MV columns, but not declared in the interface — UI does not consume them). Adding the three top-level fields requires a design choice (`generatedAt` source clock?), and the per-agent shape divergence is intentional pruning. Routing as DIRECTIONAL.

**REQ #42** — DB-anchored `transaction_timestamp()` for both 30-day window and JS bucket boundaries (R2 F7). PASS (memoryUtilityQueryService.ts:53-75).

**REQ #43** — MV read filters by `organisation_id` (no unfiltered cross-org SELECT). PASS (lines 35-38).

**REQ #44** — Route wired in `server/index.ts`. PASS (lines 172, 382).

---

## Chunk 7 — B2: Daily-series pure helper + tests

**REQ #45** — `memoryUtilityDailySeriesPure.ts` exports `bucketDailySeries`. PASS.

**REQ #46** — 30-bucket gap-fill, UTC midnight boundary, 23:59:59.999Z lands in same-day bucket. PASS.

**REQ #47** — `entryUtility` null on measuredCount=0; `blockUtility` null on no blocks. PASS (lines 70-76).

**REQ #48** — Vitest tests cover all named cases from §12.1 + R2-T2 incl. determinism. PASS.

---

## Chunk 8 — B2: Dashboard UI tab

**REQ #49** — New `MemoryUtilityTab.tsx`. PASS.

**REQ #50** — `UsagePage.tsx` adds `'memory_utility'` to tab union + array + render. PASS (lines 6, 196, 227, 733).

**REQ #51** — Banner copy verbatim (no em-dashes). PASS (MemoryUtilityTab.tsx:215-220).

**REQ #52** — Two canvas line charts with null = gap (line breaks), not zero. PASS (drawUtilityChart lines 66-96).

**REQ #53** — Per-agent table sorted by entry utility desc; `<10` total runs shows "Insufficient data". PASS.

**REQ #54** — Banner dismissable; state persisted to localStorage. PASS (lines 26, 140-142, 162-165).

---

## Chunk 9 — D: Semantic ranker behind env flag

**REQ #55** — `retrievalQueryEmbedderPure.ts` exports `cosineSimilarity`, `scoreCandidates`, `recallFallbackPredicate`, `getRetrievalConfig`. PASS.

**REQ #56** — Env vars `AKR_SEMANTIC_RANKER_ENABLED` (default false) + `AKR_RETRIEVAL_THRESHOLD` (default 0.30); invalid threshold → 0.30 + WARN. PASS.

**REQ #57** — `retrievalService.ts:197/276` `finalScore: 0` literals replaced with cosine when query embedding available. PASS (lines 226-233, 325-332).

**REQ #58** — Task-description embedding via `generateEmbedding(taskText)`; failure caught + WARN + null embedding fallback. PASS (lines 70-94).

**REQ #59** — Per-category recall fallback: filter non-empty pool to zero → emit `retrieval.empty_after_semantic` with `category`, fall back to legacy ordering. PASS (lines 254-261, 347-354).

**REQ #60** — Per-candidate vector error skip silently (R2 F3). PASS (`scoreCandidates` try/catch lines 50-60).

**REQ #61** — Vitest tests cover cosine math, threshold boundary, empty-after-semantic predicate, vector-error skip, determinism. PASS.

---

## Chunk 10 — D: Telemetry + observability wiring

**REQ #62** — `RetrievalDegradedReason` union extended with `'retrieval.embedding_failed'` and `'retrieval.empty_after_semantic'`. PASS (shared/types/retrieval.ts:18-19).

**REQ #63** — `embedding_failed` ≤ 1× per run; `empty_after_semantic` ≤ 1× per affected category; embedding failure precludes `empty_after_semantic`. PASS — embedding-failed catch leaves `queryEmbedding=null`, which guards both `recallFallbackPredicate` checks (chunks line 254, blocks line 347).

**REQ #64** — Two new degraded reasons emit via existing observability service (run trace shows degradedReason). **DIRECTIONAL_GAP** — the two values are added to the union (REQ #62 PASS), but the emission path uses `logger.warn(...)` only and never sets `RetrievalResult.degradedReason = 'retrieval.embedding_failed'` (or `'retrieval.empty_after_semantic'`) on the returned result. The fallback re-runs the legacy path and `truncateForEmission(ranked)` returns `degraded: false`. Spec §6.5 names `retrievalObservabilityService` as the consumer; the run-trace UI reads `RetrievalResult.degradedReason`. As wired today, embedding failures and empty-after-semantic events do NOT surface to the run trace via `degradedReason` — only to logs. Wiring this through is a design choice (do we degrade the result wholesale on embedding failure, or keep current "log + fall back to legacy succeeds"?). Routing as DIRECTIONAL.

---

## Chunk 11 — Doc-sync

**REQ #65** — `architecture.md` updated per §5.3 (lineage table, telemetry substrate, D env flag). PASS — grep confirms relevant symbols present.

**REQ #66** — `KNOWLEDGE.md` append per §5.3. PASS — grep confirms relevant symbols present.

**REQ #67** — `docs/capabilities.md` operator-facing utility-metric capability (conditional). **DIRECTIONAL_GAP** — capabilities.md is in changed-code set but Grep finds NO match for memory-utility / lineage / AKR-semantic-ranker capability terms. Spec §5.3 itself says "if it's currently catalogued"; plan §10 Assumptions defers provisionally. Route as DIRECTIONAL for visibility — operator may want to land the capability entry in a follow-up.

---

## Cross-chunk

**REQ #68** — Opportunistic cleanup: promote `MEMORY_BLOCK_TOP_K` + `MEMORY_BLOCK_POOL_MULTIPLIER` to env-overridable in `server/config/limits.ts`. **DIRECTIONAL_GAP** — explicitly NOT required for the spec to land ("Not required for the spec to land"). Files not modified. Route as DIRECTIONAL for visibility per spec's explicit opt-in. Not a blocking gap.

---

## Summary

- Total REQs extracted: 68
- PASS: 61
- MECHANICAL_GAP → will fix: 1 (REQ #1 — migration 0333 RLS syntax)
- DIRECTIONAL_GAP / AMBIGUOUS → routed to tasks/todo.md: 6 (REQ #20, #38, #41, #64, #67, #68)
- OUT_OF_SCOPE: 0

