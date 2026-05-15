# Spec Conformance Log

**Spec:** `tasks/builds/split-services-soft-cap-batch/spec.md`
**Spec commit at check:** `0998dedc3767fc19d08a4b40c4c5a9ceb2c53a25` (HEAD)
**Branch:** `claude/split-services-soft-cap-batch`
**Base (merge-base):** `6e5d3a77849c7251491dbb4867a3ad151a61b974`
**Scope:** Phase 2 branch-level — all 5 splits per spec §7 acceptance criteria
**Changed-code set:** 59 source files across the 5 sibling trees + 5 barrels
**Run at:** 2026-05-15T12:35:05Z

---

## Summary

- Requirements extracted:     13
- PASS:                       12
- MECHANICAL_GAP fixed:       0
- DIRECTIONAL_GAP deferred:   1
- AMBIGUOUS deferred:         0
- OUT_OF_SCOPE skipped:       1 (REQ #10 — finalisation handles closure markers)

**Verdict:** NON_CONFORMANT (1 blocking gap — positional gate-baseline drift)

---

## Requirements extracted (full checklist)

### REQ #1 — All 5 barrels < 250 LOC, contain only re-exports

- Spec section: §7 criterion 1; §6.2 barrel layout
- Verdict: PASS
- Evidence: `server/services/agentService.ts` = 39 LOC; `server/jobs/skillAnalyzerJob.ts` = 1 LOC; `server/services/workspaceMemoryService.ts` = 45 LOC; `server/services/llmRouter.ts` = 46 LOC; `server/services/queueService.ts` = 29 LOC. Each is a thin re-export skeleton plus spread assembly for object exports. Read in full and confirmed pure re-export shape.

### REQ #2 — Each sibling directory contains architect-confirmed module set

- Spec section: §7 criterion 2; §6.4 per-target seam guidance
- Verdict: PASS
- Evidence: All 5 trees present.
  - `server/services/agentService/`: 10 files (types, helpers, caches, scheduler, externalFetchers, dataSourceScope, crud, agentDataSources, scheduledTaskDataSources, agentFullView).
  - `server/jobs/skillAnalyzerJob/`: 17 files (orchestrator + 15 stage files + types + helpers).
  - `server/services/workspaceMemoryService/`: 13 files (types + 12 lifecycle phase modules).
  - `server/services/llmRouter/`: 8 files (types, billing, cooldown, fallbackMap, aggregateEnqueue, ieeResolver, routeCall + 1).
  - `server/services/queueService/`: 9 files (types, backend, enqueueHelpers, executionProcessor, migrationAdapter + maintenanceJobs/ subdir with 3 files).

### REQ #3 — `npm run build:server` exits 0

- Spec section: §7 criterion 3
- Verdict: PASS
- Evidence: Local run completed with exit code 0; `tsc -p server/tsconfig.json` produced no errors.

### REQ #4 — `npm run lint` exits 0 (errors-not-warnings)

- Spec section: §7 criterion 4; caller invocation clarification
- Verdict: PASS
- Evidence: Lint run reports "0 errors, 882 warnings". All warnings pre-date this branch (any-types, unused-vars in test fixtures, etc.).

### REQ #5 — `verify-loc-cap.sh` passes (immediate-child rule)

- Spec section: §7 criterion 5; caller invocation note about sub-dir exemption
- Verdict: PASS
- Evidence: `scripts/lib/loc-cap-pure.mjs` regex `/^server\/services\/[^/]+\.ts$/` matches only immediate-child files. All 5 barrels (max 46 LOC) are far below soft cap 1500. Sub-directory files such as `llmRouter/routeCall.ts` (1637 LOC) and `skillAnalyzerJob/stage5Classify.ts` (1182 LOC) are exempt by regex. `loc-cap.txt` baseline lists Wave 1 targets only — none of our 5 are in it, and no new entries needed.

### REQ #6 — No new baseline entries in `verify-with-org-tx-or-scoped-db.sh` inside new trees

- Spec section: §7 criterion 6
- Verdict: PASS (subject to CI confirmation)
- Evidence: Gate uses NUMERIC baseline (`scripts/guard-baselines.json` count=2153) via `check_baseline`. The per-file `.txt` is informational only (script comments at lines 143-150 are explicit). The split moved the same `db.X()` calls to new file paths without adding new ones — count is unchanged. CI's authoritative count run will confirm.

### REQ #7 — No new `verify-canonical-retry.sh` baseline entries

- Spec section: §7 criterion 7
- Verdict: DIRECTIONAL_GAP
- Evidence: Count of retry-counter declarations: 4 (origin/main) → 4 (HEAD). Same declarations, moved to:
  - `server/services/queueService/backend.ts:24` (from `queueService.ts:105`)
  - `server/services/queueService/executionProcessor.ts:131` (from `queueService.ts:263`)
  - `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:558` (from `queueService.ts:1095`)
  - `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:593` (from `queueService.ts:1130`)
- Gap: Spec criterion is honoured at the code level (no new occurrences), but the gate uses `check_expiring_baseline` (positional, keyed on `<path>:<line>:<message>`). The 4 entries in `scripts/.gate-baselines/canonical-retry.txt` still reference old `queueService.ts:<line>` paths. CI will see 4 new violations and 4 stale baseline entries — gate trips with exit 1.
- Why DIRECTIONAL not MECHANICAL: touches `scripts/.gate-baselines/` (outside the changed-code set); spec does not explicitly name these baseline files; fix involves a coordination decision (rebaseline at the new paths vs remediate via `withBackoff`).

### REQ #8 — `verify-duplicate-blocks.sh` does not regress

- Spec section: §7 criterion 8
- Verdict: PASS (subject to CI confirmation)
- Evidence: Numeric `clone-count:8769` baseline. Split is extraction-not-rewrite (verified by spot-check: `listAgents` body byte-identical before/after). Clone count should be stable. CI's `jscpd` run will confirm.

### REQ #9 — All callers compile against new barrels without source edits

- Spec section: §7 criterion 9; §5 public-surface lock
- Verdict: PASS
- Evidence: `git diff origin/main...HEAD --name-only` shows ZERO files outside the 5 target trees, their barrels, and `tasks/`. All ~60 caller files (per plan §Chunk 0 caller sweep) compile unchanged. `build:server` exits 0.

### REQ #10 — `tasks/todo.md` closure markers for Area 10 register + SA3

- Spec section: §7 criterion 10
- Verdict: OUT_OF_SCOPE
- Evidence: Per caller's invocation: "these closure markers can be added in finalisation; not blocking here." Deferred to Phase 3 finalisation.

### REQ #11 — No `*Pure.ts` companions added in new trees

- Spec section: §3 (non-goals)
- Verdict: PASS
- Evidence: `find` over the 5 sibling trees returns no `*Pure.ts` files. Spec §3 honoured.

### REQ #12 — No Wave 1 splits touched

- Spec section: §3 (non-goals)
- Verdict: PASS
- Evidence: `git diff origin/main...HEAD --name-only | grep -E 'workflowEngine|skillExecutor|agentExecutionService|skillAnalyzerService'` returns no results. Wave 1 targets untouched.

### REQ #13 — No new cross-target imports; pre-existing edges via barrel

- Spec section: §6.3
- Verdict: PASS
- Evidence: All cross-target imports from `workspaceMemoryService/*.ts` and `skillAnalyzerJob/*.ts` go to `../llmRouter.js` (the barrel), not into `llmRouter/<sub-module>.js`. Confirmed by grep:
  - `workspaceMemoryService/{dedup,enrichmentJob,entities,extract,hybridRetrieval,regenerateSummary,types}.ts` import `routeCall` from `'../llmRouter.js'`.
  - `skillAnalyzerJob/{stage5Classify,stage7bAgentSuggest,stage8bClusterRecommend}.ts` import `routeCall` from `'../../services/llmRouter.js'`.
- No file imports from `server/services/llmRouter/<anything>` outside the `llmRouter/` tree itself.

### Public-surface lock verification (per caller's invocation table)

Cross-checked every name in the caller's "Locked public surface per target" table against the actual barrel re-exports. Result: all named exports present and importable from the canonical barrel paths.

- `agentService.ts`: all 5 type exports + `dataSyncScheduler` + `loadSourceContent` + `fetchDataSourcesByScope` + `fetchAgentDataSources` + `agentService` object with 36 methods (including underscore-prefixed `_assertNotSystemManaged`, `_assertEtag`, `_getScheduledTaskOrThrow`). Spec's "~25 methods" was approximate — original `git show origin/main:server/services/agentService.ts` shows 33 method headers; the split preserves all of them.
- `skillAnalyzerJob.ts`: `processSkillAnalyzerJob` (only export, matches spec).
- `workspaceMemoryService.ts`: `ExtractRunInsightsOptions`, `agentRoleToDomain`, `setContextEnrichmentJobSender`, `workspaceMemoryService` (object with ~24 methods, matches spec's "~20"), `pruneStaleMemoryEntries`, `reembedEntry`, `getStaleEmbeddingsBatch`, `recomputeStaleEmbeddings`, `processContextEnrichment`.
- `llmRouter.ts`: `shouldEmitLaelLifecycle`, `LLMCallContext`, `RouterCallParams`, `ProviderTimeoutError`, `callWithTimeout`, `routeCall`, `TaskType`/`SourceType`/`ExecutionPhase`/`RoutingMode` (type), `TASK_TYPES`/`SOURCE_TYPES`/`EXECUTION_PHASES`/`ROUTING_MODES` (value), `countTokens`, `SUPPORTED_MODEL_FAMILIES`, `SupportedModelFamily`.
- `queueService.ts`: `queueService` object with all 7 named methods (`enqueueExecution`, `sendJob`, `cleanupExpiredExecutionFiles`, `cleanupExpiredComputeReservations`, `enqueueWorkflowResume`, `enqueueRegressionCapture`, `startMaintenanceJobs`).

## Mechanical fixes applied

None.

## Directional gaps routed to tasks/todo.md

**REQ #7 — Positional gate-baseline drift after queueService split**

- Two baseline files reference `server/services/queueService.ts:<line>` entries that no longer exist (the barrel is 29 LOC now):
  - `scripts/.gate-baselines/canonical-retry.txt` — 4 entries (`:105, :263, :1095, :1130`); declarations moved to `queueService/backend.ts:24`, `queueService/executionProcessor.ts:131`, `queueService/maintenanceJobs/pgBossRegistrations.ts:558` and `:593`.
  - `scripts/.gate-baselines/no-silent-failures.txt` — 1 entry (`:1200`); moved to `queueService/maintenanceJobs/pgBossRegistrations.ts:663`.
- Both gates use `check_expiring_baseline` (positional keying). CI will report these as new violations.
- Spec criterion (no new code occurrences) is honoured: 4→4 retry counters, 1→1 swallowed promise. The drift is purely in baseline bookkeeping.

Routed to `tasks/todo.md` under "Deferred from spec-conformance review — split-services-soft-cap-batch (2026-05-15)".

## Files modified by this run

- `tasks/todo.md` (appended deferred-items section)
- this log file

## Next step

NON_CONFORMANT — 1 directional gap. Two paths forward, operator chooses:

1. **Rebaseline path** (mechanical, fast): edit `scripts/.gate-baselines/canonical-retry.txt` to repoint the 4 entries at the new sub-module paths, and the 1 entry in `scripts/.gate-baselines/no-silent-failures.txt`. Keep existing `expires:` dates. This is the canonical "code moved, baseline follows" pattern from DEVELOPMENT_GUIDELINES.md §5. Roughly 5 minutes.
2. **Remediate path** (structural): replace the 4 raw retry counters in queueService sub-modules with `withBackoff` calls, and route the 1 `.catch(() => undefined)` through `logger.warn` per DEVELOPMENT_GUIDELINES.md §8.36. Larger blast radius; deserves its own sub-PR.

Recommended: path 1 (rebaseline). The split's promise was no-behaviour-change; remediation would violate spec §3 ("No drive-by lint cleanup").

After the fix, no need to re-run `spec-conformance` (the gap is bookkeeping, not spec-conformance). Hand off to `pr-reviewer` for the standard Phase 2 code-review pass.
