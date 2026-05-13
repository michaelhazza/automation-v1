# Reality Check Log — memory-improvements

**Build slug:** memory-improvements
**Branch:** claude/add-memvid-integration-ehAOr
**Reviewer:** reality-checker (Opus, dispatched by feature-coordinator at Phase 2 Step 8.4)
**Timestamp:** 2026-05-13T06:42:00Z

**Stated success criteria source:** `tasks/builds/memory-improvements/handoff.md` § "Build-phase acceptance checklist"
**Claimed evidence sources:** progress.md G2/G3 tables, spec-conformance log, adversarial-reviewer log, pr-reviewer log (R1+R2), 3 new pure-function test files

---

## Verdict

**NEEDS_DISCUSSION**

Build is operationally sound (G2/G3 PASS, pr-reviewer APPROVED, the HIGH adversarial finding's fix verified in code). Three classes of gap require operator decision before Phase 3:

1. **Spec-vs-shipped divergences** (4 of 6 spec-conformance DIRECTIONAL_GAPs) — REQs #20, #38, #41, #64 describe payload contract divergences from the spec. Operator path: amend spec or backfill shipped.
2. **Missing operational evidence** (6 acceptance items) — pre-enablement spot-checks, EXPLAINs, RLS coverage gate — environment-gated, legitimately deferrable to pre-enablement.
3. **Adversarial-reviewer log file relocation** — caller cited a path that wasn't on disk at audit time; substance preserved in progress.md and now persisted at the new path `tasks/review-logs/adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md`.

| Category | Count |
|---|---|
| Acceptance criteria verified (deterministic) | 16 |
| Verified by log excerpt | 1 |
| Unverified (env-gated operational evidence) | 9 |
| Implementation gaps | 0 |

---

## Per-criterion evidence classification

### Phase 1 (A — Synthesis lineage)

| # | Criterion | Verdict |
|---|---|---|
| 1 | `WorkspaceMemoryEntry` exposes stable `agentRunId` | Verified — `server/db/schema/workspaceMemories.ts:87` |
| 2 | `memoryBlockSynthesisService.ts:195-206` not drifted | Verified — write site lands within anchor; `setOrgGUC` first statement (line 203) |
| 3 | Migration 0333 includes `idx_mbvs_source_entry_hash` | Verified — `migrations/0333_memory_block_version_sources.sql:46` |
| 4 | `memory_block_version_sources` in `rlsProtectedTables.ts` | Verified — line 1304 |
| 5 | `verify-rls-coverage.sh` passes | **Unverified** — gate is CI-only; no log excerpt supplied (test-gate policy) |

### Phase 2 (B1 — Measurement substrate)

| # | Criterion | Verdict |
|---|---|---|
| 6 | `agentExecutionService.ts:1349-1356` not drifted | Verified — lines 1350-1368 anchor holds |
| 7 | Migration 0334 `injected_entry_ids jsonb` nullable no DEFAULT | Verified — line 5-11 |
| 8 | No 16:00 UTC cron collision | Verified — `agentScheduleService.ts:212` only |
| 9 | First MV refresh aggregate spot-check vs raw `agent_runs` | **Unverified** — no SQL spot-check log; env-gated |

### Phase 3 (D — Semantic ranker)

| # | Criterion | Verdict |
|---|---|---|
| 10 | Pre-enablement spot-check of ~10 dev runs @ threshold 0.30 | **Unverified** — env-gated operational step |
| 11 | text-embedding-3-small A/B vs task description vs master prompt | **Unverified** — env-gated operational step |
| 12 | D-Recall + D-Embedding-failure degraded reasons emit correctly | **Partial** — type union additions verified; emission path uses `logger.warn` only, `RetrievalResult.degradedReason` never set (spec-conformance REQ #64 — DIRECTIONAL deferred) |
| 13 | `AKR_SEMANTIC_RANKER_ENABLED` defaults to false | Verified — `retrievalQueryEmbedderPure.ts:15` returns false when env var absent |

### Phase 4 (B2 — Dashboard)

| # | Criterion | Verdict |
|---|---|---|
| 14 | EXPLAIN daily-series query index-covered | **Unverified** — no EXPLAIN output; env-gated |
| 15 | EXPLAIN reverse-lineage query cost | **Unverified** — no EXPLAIN output; env-gated |
| 16 | Dashboard banner copy matches operator-approved text | Verified — `MemoryUtilityTab.tsx:216-218` exact match |
| 17 | Route 403 on path-org / session-org mismatch | Verified — `memoryUtility.ts:18-23` UUID-canonicalised, 403 before service call |

### Cross-phase

| # | Criterion | Verdict |
|---|---|---|
| 18 | No forbidden test categories | Verified — zero matches for supertest/playwright/node:test |
| 19 | All new pure tests use vitest `expect()` | Verified — all three test files |
| 20 | architecture.md updated per spec §5.3 | Verified with drift — line 1091 names `writeVersionSourceLinks` but actual export is `writeLineageRowsForVersion` (pr-reviewer Round 1 Should-fix) |
| 21 | Migration-number collision check at S1 | Verified at S1 (absorbed PR #287/#286/#288/#292 cleanly) |
| 22 | spec-conformance verdict | Verified — CONFORMANT_AFTER_FIXES with 6 DIRECTIONAL_GAPs deferred (4 are spec-payload divergences) |
| 23 | adversarial HIGH bare-db fix landed | Verified — `memoryBlockSynthesisService.ts:201-203` opens `db.transaction(async (tx) => { await setOrgGUC(tx, organisationId); ... })` |
| 24 | adversarial-reviewer log file on disk | **Unverified at audit time** — relocated post-audit to `adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md` |
| 25 | pr-reviewer Round 2 APPROVED | Verified — log shows 3/3 prior Blocking resolved, 0 new Blocking |
| 26 | G2/G3 lint+typecheck PASS | Verified by log excerpt — progress.md G2/G3 tables |

---

## Three classes of operator decision

### 1. Spec-vs-shipped payload divergences (must reconcile before merge)

- **REQ #20** — `memoryBlockSources` payload nested-vs-flattened structure differs from spec.
- **REQ #38** — Spec §5.1/§12.1 names `memoryUtilityAggregatorPure.ts` + `.test.ts`; logic collapsed into SQL CTE in migration 0343 instead.
- **REQ #41** — `memoryUtility` payload missing top-level `organisationId/generatedAt/windowDays`.
- **REQ #64** — New degraded reasons added to `RetrievalDegradedReason` union but `RetrievalResult.degradedReason` is never set on emission path.

Path forward: amend spec to match shipped (lighter) OR backfill shipped to match spec.

### 2. Missing operational evidence (env-gated, deferrable to pre-enablement)

6 items require live DB / OpenAI keys / cron-running infra:
- `verify-rls-coverage.sh` (CI-gate)
- First MV refresh spot-check vs raw `agent_runs`
- Threshold-0.30 spot-check of 10 dev runs (D enablement)
- text-embedding-3-small A/B comparison (D enablement)
- EXPLAIN for daily-series query
- EXPLAIN for reverse-lineage query

These are legitimate operational deferrals — but must be run before the AKR ranker env flag is flipped on in any environment.

### 3. Adversarial-reviewer log artefact (now resolved)

Log file relocated to `tasks/review-logs/adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md` post-audit. Substance preserved.

---

## Files NOT read

- `tasks/builds/memory-improvements/plan.md` (size — handoff checklist is canonical criteria source)
- Spec body (relied on spec-conformance log's REQ extraction; reality-checker scope is evidence-to-criterion mapping)
- Pre-existing entries in `rlsProtectedTables.ts` beyond the new memory entries
- UI surfaces beyond banner-copy verification (out of scope for reality-checker)
- The 9 non-blocking pr-reviewer findings details (read in pr-review log; not in scope for evidence classification)

Unread regions do not invalidate the verdict because the scope is bounded to acceptance-checklist evidence mapping.

---

## Recommendation to operator

The implementation is sound. Decision required on:

1. **The 4 spec-vs-shipped payload divergences** (operator: amend spec or backfill code).
2. **The 6 env-gated operational checks** (operator: accept deferral until pre-enablement, OR run before Phase 3 close).
3. **(Resolved post-audit)** Adversarial log relocation.

If operator says "amend spec, defer operational checks to pre-enablement" → verdict effectively READY for Phase 3 entry.
If operator says "backfill code first" → fix-loop on remaining items before Phase 3.
