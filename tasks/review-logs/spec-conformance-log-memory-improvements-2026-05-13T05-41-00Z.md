# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md`
**Spec status at check:** accepted, locked 2026-05-13
**Branch:** `claude/add-memvid-integration-ehAOr`
**Base:** `effe82ac5bb68fb1ff43105959bd967cea8a6ca1` (merge-base with main)
**Scope:** all spec — completed implementation, all 11 chunks committed as a single branch
**Changed-code set:** 38 files (per caller's filtered list)
**Run at:** 2026-05-13T05:41:00Z
**Commit at finish:** a3b006cc

---

## Summary

- Requirements extracted:     68
- PASS:                       61
- MECHANICAL_GAP → fixed:     1
- DIRECTIONAL_GAP → deferred: 6
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

> `AMBIGUOUS` is reported separately for diagnostic visibility. Two REQs were initially flagged AMBIGUOUS during classification (#64, #67) and reclassified to DIRECTIONAL on fail-closed evaluation. Both routed to `tasks/todo.md`.

**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical fix landed; 6 directional gaps routed to `tasks/todo.md` for human decision — none are blocking for the implementation already shipped).

---

## Requirements extracted (full checklist)

Detailed REQ list with verdicts is in the scratch file:

`tasks/review-logs/spec-conformance-scratch-memory-improvements-2026-05-13T05-41-00Z.md`

The scratch is retained alongside this final log for traceability (not deleted) because the verdict carries directional findings the operator will want to review against the per-REQ evidence.

Per-chunk summary:

| Chunk | Topic | REQs | PASS | Gaps |
|-------|-------|------|------|------|
| 1 | A — Migration 0333 + RLS manifest | #1–7 | 6 | 1 mechanical (#1) |
| 2 | A — Lineage write at synthesis | #8–15 | 8 | 0 |
| 3 | A — Sources route + UI tab | #16–24 | 8 | 1 directional (#20 payload shape) |
| 4 | B1 — Migration 0334 + write site | #25–28 | 4 | 0 |
| 5 | B1 — MV 0343 + nightly refresh | #29–38 | 9 | 1 directional (#38 missing aggregator pure helper) |
| 6 | B2 — Memory Utility API route | #39–44 | 5 | 1 directional (#41 payload missing top-level fields) |
| 7 | B2 — Daily-series pure helper + tests | #45–48 | 4 | 0 |
| 8 | B2 — Dashboard UI tab | #49–54 | 6 | 0 |
| 9 | D — Semantic ranker behind env flag | #55–61 | 7 | 0 |
| 10 | D — Telemetry + observability wiring | #62–64 | 2 | 1 directional (#64 degraded-reason not on result) |
| 11 | Doc-sync | #65–67 | 2 | 1 directional (#67 capabilities.md unchanged) |
| Cross | Opportunistic cleanup | #68 | 0 | 1 directional (#68 not shipped — explicitly optional per spec) |

---

## Mechanical fixes applied

**[FIXED] REQ #1 — Migration 0333 invalid PostgreSQL RLS syntax**
- File: `migrations/0333_memory_block_version_sources.sql`
- Lines: 25-26
- Spec quote: "ALTER TABLE memory_block_version_sources ENABLE ROW LEVEL SECURITY; ALTER TABLE memory_block_version_sources FORCE ROW LEVEL SECURITY;" (§4 Phase 1)
- Change: replaced invalid bare `ENABLE/FORCE ROW LEVEL SECURITY ON memory_block_version_sources;` form with the valid `ALTER TABLE memory_block_version_sources ENABLE/FORCE ROW LEVEL SECURITY;` form matching spec §4 Phase 1 and all neighbouring migrations (0079-0083). The invalid form would have failed migration deployment immediately.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

All routed to a single new section in `tasks/todo.md`:

> `## Deferred from spec-conformance review — memory-improvements (2026-05-13)`

| REQ | Spec section | Summary |
|-----|--------------|---------|
| #20 | §6.1 | `MemoryBlockSourcesPayload` flattened shape vs spec's nested discriminated-union form (`sourceEntry: {…}\|null`, `sourceRun: {…}\|null`); missing top-level `blockVersionId` and `capturedAt`. |
| #38 | §5.1, §12.1 | Missing `memoryUtilityAggregatorPure.ts` + test (named in spec file inventory). Aggregator collapsed into SQL CTE (migration 0343); spec-amend lighter than backfilling JS aggregator. |
| #41 | §6.6 | `MemoryUtilityPayload` missing spec-named top-level fields `organisationId`, `generatedAt`, `windowDays: 30`; `AgentUtilityRow` interface omits four totals that are present in DB rows. |
| #64 | §6.5 | Two new degraded reasons (`retrieval.embedding_failed`, `retrieval.empty_after_semantic`) added to the union (PASS) but never attached to `RetrievalResult.degradedReason` — only `logger.warn(...)` emission. Run-trace UI won't see these events. |
| #67 | §5.3 | `docs/capabilities.md` is modified but contains no entry for memory-utility / lineage / AKR-semantic-ranker capability. §5.3 conditions this on "if currently catalogued"; plan §10 defers provisionally. |
| #68 | §4 Opportunistic, §5.2 | Opportunistic cleanup (`MEMORY_BLOCK_TOP_K`, `MEMORY_BLOCK_POOL_MULTIPLIER` env-overridable) not shipped. Spec explicitly opts in: "Not required for the spec to land." |

---

## Files modified by this run

- `migrations/0333_memory_block_version_sources.sql` — RLS syntax fix (REQ #1)
- `tasks/todo.md` — appended deferred-items section
- `tasks/review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md` — this file
- `tasks/review-logs/spec-conformance-scratch-memory-improvements-2026-05-13T05-41-00Z.md` — REQ-by-REQ scratch trail (retained, not deleted)

---

## Verification of fixes

After the single mechanical fix landed:

- `npm run lint`: 0 errors (895 warnings, pre-existing — none introduced by this run).
- `npm run typecheck`: passed (server tsconfig + root tsconfig both clean).

---

## Next step

**CONFORMANT_AFTER_FIXES** — re-run `pr-reviewer` on the expanded changed-code set so it sees the fixed migration. Six DIRECTIONAL items in `tasks/todo.md` are NOT blockers for the implementation already shipped — they are spec-vs-shipped reconciliation questions for the operator:

- REQs #20 + #41: payload-shape divergences. Either reshape responses to match spec, or amend spec to match shipped (the spec-amend path is lighter; both shipped forms are coherent).
- REQ #38: missing aggregator pure helper + test. Spec inventory names them; SQL CTE was used instead. Spec-amend or backfill.
- REQ #64: degraded-reason not threaded to `RetrievalResult`. Plumbing change in `retrievalService.ts` to mark `degraded: true` + set `degradedReason` on the legacy-fallback path.
- REQ #67: `docs/capabilities.md` entry deferred per plan §10.
- REQ #68: opportunistic cleanup explicitly optional per spec; ship as standalone or close as won't-do.

Per playbook §"Auto-commit-and-push on finish", this run modified 4 files (1 mechanical fix + 2 review-log files + tasks/todo.md). Auto-commit + push at the end of the run.
