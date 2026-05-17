---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: split-skill-analyzer
output_location: tasks/builds/split-skill-analyzer/spec.md
pattern_setter: tasks/builds/feat-split-skillexecutor/spec.md
companion: tasks/builds/feat-split-agentexecutionservice/spec.md
adopts_conventions_from: tasks/builds/feat-split-skillexecutor/spec.md § 5
---

# Wave 1 Env B — split skillAnalyzerService(+Pure) + SA1 RLS + SA4 worker fix

Coherent split of the skill-analyzer subsystem with four bundled concerns:

1. Decompose `server/services/skillAnalyzerServicePure.ts` (3,727 LOC) into cohesive sub-modules.
2. Decompose `server/services/skillAnalyzerService.ts` (2,642 LOC) — the impure shell — into per-operation modules. Splitting only the Pure file would leave an inconsistent state (impure shell calls into pure helpers; one without the other diverges).
3. Add Postgres RLS policy for `skill_analyzer_results` (Track A3 finding SA1 — currently zero RLS coverage).
4. Fix the `boss.work` direct call in `server/index.ts:691` (Track A3 finding SA4) — convert the skill-analyzer worker registration to the canonical `createWorker` pattern.

Adopts `§5 Module-Decomposition Conventions` of `tasks/builds/feat-split-skillexecutor/spec.md` by reference.

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Skill Lifecycle / De-duplication |
| Capability owner | platform |
| Lifecycle state on launch | Mature |
| Risk surface | skill classification + tenant isolation (RLS) + queue worker pattern |
| Review cadence | on-incident-only |

Both `skillAnalyzerService` and `skillAnalyzerServicePure` are `Mature` on the asset register. This build refactors existing capabilities; no new capability is registered.

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | No new capability acquired |
| Build | L | 6,369 combined LOC across two files + RLS migration + worker pattern fix. Largest Wave 1 spec. |
| Carry | S | Smaller modules; RLS closes current isolation gap; canonical worker pattern brings the subsystem in line with the rest of the codebase |
| decommission | S | Barrel pattern decommissions cleanly |
## 1. Goals

1. Reduce `server/services/skillAnalyzerServicePure.ts` from 3,727 LOC to a thin barrel (target < 250 LOC) re-exporting the public surface from sub-modules.
2. Reduce `server/services/skillAnalyzerService.ts` from 2,642 LOC to a thin barrel (target < 250 LOC) re-exporting the impure operations from sub-modules.
3. Decompose both files along their existing domain groupings:
   - **Pure file** — status enums + classification helpers + similarity helpers + merge-warning system + approval state + concurrency check + serialisation helpers.
   - **Impure shell** — job lifecycle (create / resume / get / list) + per-result operations (setResultAction, bulkSetResultAction, updateProposedAgent, resolveWarning) + per-job operations (executeApproved, unlockStaleExecution, retryClassification, bulkRetryFailedClassifications) + DB read/write helpers (getJobById, insertResults, markSkillInFlight, etc.).
4. Add a Postgres RLS policy for `skill_analyzer_results` using the parent-EXISTS pattern against `skill_analyzer_jobs.organisation_id` (closes Track A3 SA1).
5. Add `skill_analyzer_results` to `server/config/rlsProtectedTables.ts`.
6. Convert the skill-analyzer queue worker registration at `server/index.ts:691` from a direct `boss.work(queue, ...)` call to the canonical `createWorker(...)` pattern used elsewhere in the codebase (closes Track A3 SA4). Routes the org-context plumbing through the standard worker scaffold.
7. Fix raw `db.insert(skillAnalyzerResults)` in the impure shell to use `getOrgScopedDb()` (closes Track A3 SA6).
8. Preserve the public API exactly. Both `skillAnalyzerServicePure.ts` and `skillAnalyzerService.ts` keep their existing barrel exports.

## 2. Non-Goals

- No behaviour change in skill classification, deduplication, or merge logic.
- No new skill-analyzer features, no new job statuses, no new warning codes.
- No changes to LLM classification prompts or parsing logic beyond moving them into a sub-module.
- No changes to the queue name or job config keys for skill-analyzer.
- No splitting of `server/jobs/skillAnalyzerJob.ts` (2,254 LOC) in this build — that work is queued separately as Track A3 SA3 backlog.
- No URL-path naming changes (UK vs US spelling — Track A3 SA5 backlog).
- No drive-by lint cleanup, no unrelated refactors.

## 3. Framing Assumptions

- Repo is pre-production per `docs/spec-context.md`; testing posture is `static_gates_primary`. No new unit tests required for the splits.
- The Pure file is "inverted-larger than its impure shell" (Track A3 SA2). This is a real anti-pattern; the goal is not to balance the sizes but to make both files maintainable by splitting along clean domain seams. After the build, neither file will be the largest single TypeScript file in the repo.
- `skill_analyzer_results` is currently FK-scoped via `skill_analyzer_jobs.id`, with no direct `organisation_id` column. The RLS policy uses the parent-EXISTS pattern; this matches the existing pattern documented in `architecture.md` for FK-only tenant-scoped tables.
- The current `boss.work` call at `server/index.ts:691` registers the worker outside the canonical `createWorker` pattern, bypassing org-context plumbing. There are 4 other direct `boss.work` calls in `server/index.ts` — these are OUT of scope for this build (each needs its own conversion). This build fixes only the skill-analyzer one.
- 16 callers import from `skillAnalyzerServicePure.ts` (confirmed via grep). The impure shell shows 6 external callers per Chunk 0 sweep result 2 (1 route, 1 job handler, 4 smoke-test scripts) — the surface is locked in `tasks/builds/split-skill-analyzer/plan.md § Chunk 0` and includes the `skillAnalyzerService` aggregate object (line 2614) plus 5 named-function imports.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.
- All routes touching skill-analyzer are gated `system-admin-only` per Track A3 SA1 mitigating note; the RLS hole is narrower than other tenant tables but still real.
## 4. Public-Surface Lock

### 4.1. Pure file (`skillAnalyzerServicePure.ts`)

These exports MUST remain importable from `server/services/skillAnalyzerServicePure.js` at the end of the migration:

| Export group | Examples (architect enumerates full list at chunk 0) | Notes |
|---|---|---|
| Status enums + type guards | `SKILL_ANALYZER_MID_FLIGHT_STATUSES`, `SKILL_ANALYZER_TERMINAL_STATUSES`, `SKILL_ANALYZER_JOB_STATUSES`, `isSkillAnalyzerTerminalStatus`, `isSkillAnalyzerMidFlightStatus`, type aliases | Locked |
| Classification primitives | `ClassificationResult`, `LibrarySkillSummary`, `buildClassificationPrompt`, `parseClassificationResponse`, `deriveClassificationFailureReason` | Locked |
| Similarity primitives | `SimilarityBand`, `cosineSimilarity`, `classifyBand`, `computeBestMatches` | Locked |
| Merge-warning system | `ProposedMerge`, `MergeWarning`, `MergeWarningCode`, `MergeWarningSeverity`, `WarningTier`, `DEFAULT_WARNING_TIER_MAP`, `sortWarningsBySeverity`, `WarningResolution`, `WarningResolutionKind`, `RESOLUTIONS_FOR_CODE`, `RequiredResolution`, `ApprovalState`, `ApprovalBlockingReason` | Locked |
| Concurrency check | `ConcurrencyCheckResult`, `checkConcurrencyStamp` | Locked |
| Plus ~70 additional exports beyond line 600 | Architect enumerates during chunk 0 | All locked |

### 4.2. Impure shell (`skillAnalyzerService.ts`)

These exports MUST remain importable:

| Export | Kind | Notes |
|---|---|---|
| `createJob`, `resumeJob`, `getJob`, `listJobs` | async functions | Locked |
| `setResultAction`, `bulkSetResultAction`, `updateProposedAgent`, `resolveWarning`, `updateAgentProposal`, `patchMergeFields`, `resetMergeToOriginal` | async functions | Locked |
| `executeApproved`, `unlockStaleExecution`, `retryClassification`, `bulkRetryFailedClassifications` | async functions | Locked |
| `updateJobProgress`, `getJobById`, `insertResults`, `insertSingleResult`, `listResultIndicesForJob`, `markSkillInFlight`, `unmarkSkillInFlight`, `updateResultAgentProposals`, `updateJobAgentRecommendation` | async functions | Locked |
| `appendBatchCollisionWarnings`, `applyBatchDeductionAndWarningAtomic` | async functions | Locked |
| `skillAnalyzerService` | object at line 2614 — composite of the operations above | Locked (if used by external callers — architect confirms) |
| `MatchedSkillContent`, `AvailableSystemAgent`, `EnrichedResult`, `GetJobResponse`, `ResolveWarningParams`, `UpdateAgentProposalParams`, `PatchMergeFieldsParams` | exported interfaces | Locked |

## 5. Module-Decomposition Conventions

### 5.1. Reference to pattern-setter

Adopts §5.1, §5.4, §5.5, and §5.6 from `tasks/builds/feat-split-skillexecutor/spec.md` verbatim.

This build does NOT introduce a handler-registry placement rule — operations are bespoke, named functions decomposed by domain group, not by an enumerable handler set.

### 5.2. Directory layout

Two barrels, two sibling directories. Barrels stay at their existing paths.

```
server/services/
  skillAnalyzerServicePure.ts           ← barrel only (target < 250 LOC)
  skillAnalyzerService.ts               ← barrel only (target < 250 LOC)
  skillAnalyzerServicePure/
    statuses.ts                         ← mid-flight, terminal, job statuses + type guards
    similarity.ts                       ← cosineSimilarity, classifyBand, computeBestMatches
    classification/
      prompts.ts                        ← CLASSIFICATION_SYSTEM_PROMPT + formatSkillForPrompt
      parse.ts                          ← parseClassificationResponse + isValidClassification
      failureReason.ts                  ← deriveClassificationFailureReason
    mergeWarnings/
      types.ts                          ← MergeWarning, MergeWarningCode, ProposedMerge, severity/tier types
      defaults.ts                       ← DEFAULT_WARNING_TIER_MAP, WARNING_SEVERITY_PRIORITY, WARNING_TIER_PRIORITY
      sort.ts                           ← sortWarningsBySeverity
      resolutions.ts                    ← WarningResolution, WarningResolutionKind, RESOLUTIONS_FOR_CODE, RequiredResolution
      approval.ts                       ← ApprovalState, ApprovalBlockingReason, derive helpers
    concurrency.ts                      ← ConcurrencyCheckResult, checkConcurrencyStamp
    serialisation.ts                    ← canonicalJSON, sortKeys
    [further per-domain modules — architect refines at chunk 0]
  skillAnalyzerService/
    types.ts                            ← MatchedSkillContent, AvailableSystemAgent, EnrichedResult, etc.
    hashing.ts                          ← stableStringify, hashSkillContent, toErrorMessage
    jobLifecycle/
      create.ts                         ← createJob
      resume.ts                         ← resumeJob
      get.ts                            ← getJob, getJobById, listJobs
    results/
      setAction.ts                      ← setResultAction, bulkSetResultAction
      updateProposal.ts                 ← updateProposedAgent, updateAgentProposal, updateResultAgentProposals
      warnings.ts                       ← resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic
      merge.ts                          ← patchMergeFields, resetMergeToOriginal
    execute/
      approved.ts                       ← executeApproved
      retry.ts                          ← retryClassification, bulkRetryFailedClassifications
      unlock.ts                         ← unlockStaleExecution
    persistence/
      results.ts                        ← insertResults, insertSingleResult, listResultIndicesForJob
      inFlight.ts                       ← markSkillInFlight, unmarkSkillInFlight
      progress.ts                       ← updateJobProgress, updateJobAgentRecommendation
    helpers/
      slugify.ts                        ← slugifyName
```

### 5.3. Dependency direction

- Impure shell modules MAY import from Pure modules; Pure modules MUST NOT import from impure shell.
- Within Pure: `mergeWarnings/*` may import from `mergeWarnings/types.ts`; `classification/*` may import from `classification/parse.ts`; no cross-tree cycles.
- Within Impure: deeper modules may import from sibling `helpers/`, `types.ts`, `hashing.ts`; no upward imports to the barrel.
- Both barrels compose the exposed surface by re-exporting from sub-modules.

### 5.4. Edge cases

- The `skillAnalyzerService` object at line 2614 of the impure shell — if it's a public-API surface (architect confirms during chunk 0), the barrel composes it from the per-operation modules.
- `appendBatchCollisionWarnings` and `applyBatchDeductionAndWarningAtomic` are atomic-DB ops; they STAY in the impure shell tree (`results/warnings.ts` per the layout above).
- The `boss.work` worker registration at `server/index.ts:691` is NOT in the skill-analyzer module — it lives in the app entrypoint. Chunk 7 (SA4 fix) modifies `server/index.ts`, not anything under `server/services/skillAnalyzer*`.
## 6. RLS Migration Scope (SA1)

Migration filename: next sequential under `migrations/` (architect numbers during plan phase).

Migration content:

1. `ENABLE ROW LEVEL SECURITY` on `skill_analyzer_results`.
2. `CREATE POLICY skill_analyzer_results_org_isolation ON skill_analyzer_results FOR ALL USING (EXISTS (SELECT 1 FROM skill_analyzer_jobs saj WHERE saj.id = skill_analyzer_results.job_id AND saj.organisation_id = current_setting('app.org_id')::uuid))` — parent-EXISTS pattern, since `skill_analyzer_results` has no direct `organisation_id` column.
3. Add `skill_analyzer_results` to `server/config/rlsProtectedTables.ts` allowlist.
4. `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` must pass.

Pair with `*.down.sql`. Use `IF EXISTS` guards.

Architect's plan: confirm the actual FK column name on `skill_analyzer_results` against `server/db/schema/`. The placeholder above uses `job_id` — verify before writing the policy.

## 7. Worker Pattern Fix (SA4)

Current state at `server/index.ts:691`: a direct `boss.work(SKILL_ANALYZER_QUEUE, handler)` registration that bypasses the canonical `createWorker` scaffold used elsewhere in the codebase. Bypasses org-context plumbing.

Required change:

1. Identify the canonical `createWorker(...)` helper (likely in `server/lib/workers/` or `server/jobs/`).
2. Convert the skill-analyzer worker registration at line 691 to use `createWorker`. The handler logic stays identical; only the registration wrapper changes.
3. Ensure the new registration routes through the same org-context plumbing (`resolveOrgContext` from the job payload, `withOrgTx` for any DB work in the handler).
4. The 4 OTHER direct `boss.work` calls in `server/index.ts` are OUT of scope. Each is a separate finding to be addressed in its own build.

Verification:
- `npm run lint` + `npm run build:server` exit 0 after the change.
- A targeted Vitest run against any existing test that exercises the skill-analyzer worker registration passes (architect identifies the test file during chunk 0).
- The handler still receives the same job payload shape.

Prevention companion (out of scope for THIS build, but the operator's Env D will add): a gate `scripts/verify-no-direct-boss-work.sh` that flags `boss.work(...)` calls outside `server/lib/workers/createWorker.ts`.
## 8. Acceptance Criteria

A build is complete when ALL of the following hold:

1. `server/services/skillAnalyzerServicePure.ts` is < 250 LOC, re-exports only.
2. `server/services/skillAnalyzerService.ts` is < 250 LOC, re-exports only.
3. Directory trees under `server/services/skillAnalyzerServicePure/` and `server/services/skillAnalyzerService/` match §5.2 (architect may add files but not remove the named ones).
4. `npm run build:server` exits 0.
5. `npm run lint` exits 0.
6. RLS migration for `skill_analyzer_results` lands. `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` pass.
7. `rlsProtectedTables.ts` allowlist contains `skill_analyzer_results`.
8. `verify-with-org-tx-or-scoped-db.sh` does not introduce new baseline entries inside the new trees.
9. `verify-loc-cap.sh` passes — no file in the new trees exceeds the 1,500 LOC services soft cap; barrels under 250 LOC.
10. `server/index.ts:691` no longer contains a direct `boss.work(...)` call; the skill-analyzer worker registers via the canonical `createWorker(...)` helper.
11. `db.insert(skillAnalyzerResults)` calls inside `server/services/skillAnalyzer*` migrate to `getOrgScopedDb()`.
12. All 16 Pure-file callers + any impure-shell callers found by the architect's sweep compile against the new barrels without source-code modifications.
13. `tasks/todo.md` items SA1, SA2, SA4, SA6 marked `[status:closed:pr:<num>]` in the merge commit.

## 9. Chunks (high-level)

Architect refines during plan phase. Expected shape — note this is roughly twice the size of split-workflow-engine because of the two-file split:

- **Chunk 0**: caller sweep + locked-surface confirmation + plan write
- **Chunk 1**: Pure — extract `statuses.ts` + `similarity.ts` + `serialisation.ts` (low-risk leaves)
- **Chunk 2**: Pure — extract `classification/*`
- **Chunk 3**: Pure — extract `mergeWarnings/*` (largest sub-tree)
- **Chunk 4**: Pure — extract `concurrency.ts` + remaining sub-modules
- **Chunk 5**: Pure — barrel re-export + caller verification across 16 Pure-file callers
- **Chunk 6**: Impure — extract `types.ts` + `hashing.ts` + `helpers/`
- **Chunk 7**: Impure — extract `jobLifecycle/*`
- **Chunk 8**: Impure — extract `results/*`
- **Chunk 9**: Impure — extract `execute/*` + `persistence/*`
- **Chunk 10**: Impure — barrel re-export + caller verification
- **Chunk 11**: RLS migration for `skill_analyzer_results` (SA1) + allowlist update + raw-`db` migration to `getOrgScopedDb` (SA6)
- **Chunk 12**: `boss.work` → `createWorker` conversion at `server/index.ts:691` (SA4)
- **Chunk 13**: caller sweep + spec-conformance + final review pass

The architect MAY parallelise Pure and Impure tracks at the chunk-execution layer if the dependency direction holds; chunk 0's plan documents the order.

## 10. Caller Sweep — Architect Responsibility

The architect's plan must include a full caller sweep at chunk 0 covering:

- Every file importing from `skillAnalyzerServicePure` (16 known; verify completeness).
- Every file importing from `skillAnalyzerService` (impure shell) — naive grep returns 0; investigate aliases, re-exports through `server/services/index.ts` barrels, and any internal references inside `server/jobs/skillAnalyzerJob.ts`.
- Every file calling `db.<verb>(skillAnalyzerResults | skillAnalyzerJobs)` to flag raw-db sites needing migration to `getOrgScopedDb`.
- The exact FK column name on `skill_analyzer_results` referencing `skill_analyzer_jobs` (for the RLS policy).

Sweep result recorded in the plan and verified during spec-conformance review post-build.
