---
status: READY_FOR_BUILD
date: 2026-05-15
author: architect (claude opus 4.7)
spec: tasks/builds/split-skill-analyzer/spec.md
build_slug: split-skill-analyzer
branch: split/skill-analyzer
scope_class: Significant
chunks: 15
---

# Wave 1 Env B — Implementation Plan

Decomposes `server/services/skillAnalyzerServicePure.ts` (3,727 LOC) and `server/services/skillAnalyzerService.ts` (2,642 LOC) into sibling directory trees behind two thin barrels. Adds the missing RLS policy on `skill_analyzer_results` (SA1), migrates raw-`db` writes inside the impure shell to `getOrgScopedDb` (SA6), and converts the direct `boss.work('skill-analyzer', ...)` call in `server/index.ts:691` to the canonical `createWorker(...)` pattern (SA4). Public API preserved at every chunk boundary.

The spec (`tasks/builds/split-skill-analyzer/spec.md`) is the source of truth for goals, non-goals, and the public-surface lock. The pattern-setter (`tasks/builds/feat-split-skillexecutor/spec.md` § 5) governs decomposition conventions. The recent companion (`tasks/builds/feat-split-agentexecutionservice/plan.md`) is the reference for chunk shape and per-chunk detail depth.

## Table of contents

- Model-collapse check
- Architecture notes
- Chunk 0 — Caller Sweep & Surface Lock
- Dependency direction
- Chunk 1 — Pure leaves: statuses + similarity + serialisation
- Chunk 2 — Pure classification/*
- Chunk 3 — Pure mergeWarnings/*
- Chunk 4 — Pure concurrency + validation + ruleBasedMerge + textExtraction
- Chunk 5 — Pure tableRemediation + collisions + agentRanking + consolidation + diff
- Chunk 6 — Pure barrel re-export + aggregate composition
- Chunk 7 — Impure types + hashing + helpers
- Chunk 8 — Impure jobLifecycle/*
- Chunk 9 — Impure results/*
- Chunk 10 — Impure execute/*
- Chunk 11 — Impure persistence/* + progress
- Chunk 12 — Impure barrel re-export + aggregate composition
- Chunk 13 — SA4 worker fix: boss.work → createWorker
- Chunk 14 — SA1 RLS migration + SA6 raw-db → getOrgScopedDb
- Chunk 15 — Caller sweep + doc sync
- Risks & mitigations
- Out of scope / deferred
- Executor notes

---

## Model-collapse check

This is a structural refactor of two existing TypeScript files plus a Postgres RLS migration plus a single worker-registration cleanup. There is no ingest → extract → transform → render pipeline in scope, and no LLM-call surface is being introduced or modified. Reject collapse: the work is mechanical code reorganisation and tenant-isolation hardening, not a multi-step inference pipeline.

---

## Architecture Notes

**Decision 1 — Sequencing of SA1 (RLS) vs SA4 (worker) vs SA6 (raw-db migration).** Spec § 9 lists the chunks as Pure (1–5) → Impure (6–10) → RLS+SA6 (11) → SA4 (12) → final (13). This plan flips the order of the RLS+SA6 step and the SA4 step: **SA4 lands before SA6.** Rationale: `getOrgScopedDb` reads the active org-scoped transaction context via `getOrgTxContext()` and throws `failure('missing_org_context')` if none is set. Today the skill-analyzer worker registration at `server/index.ts:691` does NOT open an org-scoped tx — it calls the handler directly with `{ jobId }`. Migrating `insertResults` / `insertSingleResult` (the SA6 raw-db sites at lines 2001, 2009 of the impure shell) to `getOrgScopedDb('...')` BEFORE SA4 lands would cause every job to throw at first Stage-6 write. Inverting the order means the worker wraps the handler in `withOrgTx` first; then SA6 swaps `db.insert(...)` → `getOrgScopedDb(...).insert(...)` safely. RLS landing in the same chunk as SA6 is symmetric: the policy and the org-scoped write that satisfies it ship together. New order: Chunk 13 = SA4 (worker), Chunk 14 = SA1 (RLS) + SA6 (raw-db migration).

**Decision 2 — Worker payload extension over resolver opt-out.** `createWorker`'s default `resolveOrgContext` reads `organisationId` from the job payload. The current payload at both enqueue sites (`server/services/skillAnalyzerService.ts:150` and `:273`) is `{ jobId }` only. Two options: (a) extend the payload to `{ jobId, organisationId }` at both enqueue sites and use the default resolver; (b) pass `resolveOrgContext: () => null` to opt out of the tx-opening prelude and have the handler manage its own context. Pick (a). Rationale: matches the helper's documented intent ("payload MUST carry organisationId explicitly"), gives org context to every DB op in the handler chain (including downstream `getOrgScopedDb` calls Chunk 14 introduces), and aligns the skill-analyzer queue with the other queues already on `createWorker`. If the default resolver path fails, stop and revise the plan; the null-resolver opt-out is not a valid fallback for this build.

**Decision 3 — Pure barrel surface includes the aggregate `skillAnalyzerServicePure` object.** Lines 3699–3727 of the Pure file export a `skillAnalyzerServicePure` const that aggregates 27 of the named helpers under one symbol. Three callers consume this aggregate by name: `server/jobs/skillAnalyzerJob.ts:47`, `scripts/audit-skill-library-shallowness.ts:54` (via `import * as`), `scripts/smoke-test-agent-embeddings.ts:17`. The aggregate stays in the Pure BARREL (not in a sub-module) because it is the public-surface composition of named helpers — keeping it in the barrel makes the barrel the single edit site whenever the aggregate's membership changes. Sub-modules export their named functions; the barrel imports them and assembles the aggregate. One fewer hop than the pattern-setter's `registry.ts` placement; the aggregate is small enough for the barrel.

**Decision 4 — Impure barrel keeps the `skillAnalyzerService` object inline.** Lines 2614–2642 of the impure shell export a `skillAnalyzerService` object that aggregates 26 async functions. The single external consumer is `server/routes/skillAnalyzer.ts:5` which imports the value. Same rationale as Decision 3: the aggregate stays in the impure BARREL; sub-modules export named functions; the barrel composes the aggregate. Closing over the 26 functions in a single literal preserves the consumer's `skillAnalyzerService.<method>` call shape exactly.

**Decision 5 — No new pure-helper extractions beyond the moves named in spec §5.2.** New pure-extraction opportunities are out of scope per spec §2.

**Decision 6 — RLS policy uses parent-EXISTS, not a direct column join.** `skill_analyzer_results` has no `organisation_id` column (verified — see Chunk 0 sweep result 3). The canonical org-isolation template in `architecture.md § Canonical org-isolation policy template` assumes a direct `organisation_id = current_setting('app.organisation_id', true)::uuid` clause. We adapt to parent-EXISTS against `skill_analyzer_jobs.organisation_id`. This is the first parent-EXISTS RLS policy in the codebase (verified by grep against `migrations/`); future tables with the same FK-only shape can copy the policy form. Both `USING` and `WITH CHECK` carry the same EXISTS; `FORCE ROW LEVEL SECURITY` enabled per the canonical-template invariant. `IS NOT NULL` and `<> ''` guards on `current_setting` preserved.

**No patterns applied beyond extract-to-sibling-module + canonical RLS template + canonical createWorker pattern.** This is intentionally mechanical.

---

## Chunk 0 — Caller Sweep & Surface Lock

Resolved at plan-authoring time. Recorded here as the locked surface for the build.

### Sweep 1 — Pure-file callers (verifying spec § 3 claim of 16)

Real-import grep (matches actual `import ... from '...skillAnalyzerServicePure...'` only):

```bash
rg -nP "from\s+['\"][^'\"]*skillAnalyzerServicePure" --glob '**/*.{ts,tsx,js,jsx}'
```

Verified count: **16 distinct files**. The spec count is correct.

| # | Path | Symbols imported |
|---|---|---|
| 1 | `server/jobs/skillAnalyzerJob.ts` | `skillAnalyzerServicePure`, `validateMergeOutput`, `extractInvocationBlock`, `richnessScore`, `buildRuleBasedMerge`, `buildClassifierFailureOutcome`, `remediateTables`, `decontaminateSectionRows`, `stripSourceAnnotations`, `recoverDroppedTableRows`, `recoverOutputFormat`, `startsWithPersonaOpener`, `detectContentOverlap`, `detectSkillGraphCollision`, `buildConsolidationPrompt`, `parseConsolidationResponse`, `computeConsolidationViolations`, types `LibrarySkillSummary` / `MergeWarning` / `ProposedMerge` / `ValidationThresholds` / `ConsolidationOutcome` |
| 2 | `server/jobs/staleAnalyzerJobSweepJobPure.ts` | helpers at L31 |
| 3 | `server/db/schema/skillAnalyzerJobs.ts` | type-only `SkillAnalyzerJobStatus` (L15) |
| 4 | `server/services/skillAnalyzerConfigService.ts` | helpers at L10 |
| 5 | `server/services/skillAnalyzerService.ts` | `skillAnalyzerServicePure` (L10), types at L12, named helpers at L13, status re-export block at L84-93 |
| 6 | `server/services/__tests__/skillAnalyzerServicePure.orchestration.test.ts` | helpers at L15 |
| 7 | `server/services/__tests__/skillAnalyzerServicePure.test.ts` | helpers at L15, type `LibrarySkillSummary` at L16 |
| 8 | `server/services/__tests__/skillAnalyzerServicePure.consolidation.test.ts` | helpers at L19 |
| 9 | `server/services/__tests__/skillAnalyzerServicePureDiffRows.test.ts` | `deriveDiffRows`, type `DiffToken` (L13) |
| 10 | `server/services/__tests__/skillAnalyzerServicePureAgentRanking.test.ts` | helpers at L18 |
| 11 | `server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts` | helpers at L16, types `ProposedMerge` / `MergeWarning` at L17 |
| 12 | `server/services/__tests__/skillAnalyzerServicePureMergePrompt.test.ts` | helpers at L19 |
| 13 | `server/services/__tests__/skillAnalyzerServicePureValidation.test.ts` | helpers at L15, types `MergeWarningCode` at L16, `ProposedMerge` at L17 |
| 14 | `server/services/__tests__/skillAnalyzerServicePureV6.test.ts` | helpers at L15, type `MergeWarning` at L16 |
| 15 | `scripts/audit-skill-library-shallowness.ts` | `import * as skillAnalyzerServicePure` (L54), type `LibrarySkillSummary` (L57) |
| 16 | `scripts/smoke-test-agent-embeddings.ts` | named `skillAnalyzerServicePure` (L17) |

**Surface lock for the Pure barrel:** preserve every named export listed in spec §4.1 PLUS the aggregate `skillAnalyzerServicePure` object at lines 3699-3727 of source. The aggregate is consumed by entries 1, 5, 15, 16 above — its membership is locked at the current 27 keys.

### Sweep 2 — Impure-shell callers (correcting spec § 3 claim of "0 callers")

The spec § 3 says "naive grep returns 0 callers" for `skillAnalyzerService.ts`. **This is wrong.** Real-import grep finds 6 distinct files:

```bash
rg -nP "from\s+['\"][^'\"]*skillAnalyzerService(\.js)?['\"]" --glob '**/*.{ts,tsx,js,jsx}'
```

| # | Path | Symbols imported |
|---|---|---|
| 1 | `server/routes/skillAnalyzer.ts` | `skillAnalyzerService` (the aggregate object, L5) |
| 2 | `server/jobs/skillAnalyzerJob.ts` | `updateJobProgress`, `getJobById`, `insertResults`, `insertSingleResult`, `listResultIndicesForJob`, `markSkillInFlight`, `unmarkSkillInFlight`, `updateResultAgentProposals`, `updateJobAgentRecommendation`, `appendBatchCollisionWarnings`, `applyBatchDeductionAndWarningAtomic` (L31-43) |
| 3 | `scripts/smoke-test-agent-proposal-patch.ts` | `updateAgentProposal` (L15) |
| 4 | `scripts/smoke-test-merge-endpoints.ts` | `patchMergeFields`, `resetMergeToOriginal` (L14) |
| 5 | `scripts/smoke-test-getjob-shape.ts` | `getJob` (L16) |
| 6 | `scripts/smoke-test-execute-approved.ts` | `executeApproved` (L33) |

No barrel re-exports under `server/services/index.ts` (the file doesn't exist). No path-aliased imports outside the import-extension convention. No `vi.mock` of the impure shell.

**Surface lock for the impure barrel:** preserve every named export listed in spec §4.2 PLUS the aggregate `skillAnalyzerService` object at line 2614, PLUS the status re-export block at lines 84-93. The aggregate is consumed by entry 1 (the routes file); its membership is locked at the current 26 keys. The named-function consumers (entries 2-6) collectively touch 13 of the 26 — every individual function is named in the spec §4.2 lock.

### Sweep 3 — FK column name on `skill_analyzer_results`

Source: `server/db/schema/skillAnalyzerResults.ts` lines 22-25.

```ts
jobId: uuid('job_id')
  .notNull()
  .references(() => skillAnalyzerJobs.id, { onDelete: 'cascade' }),
```

Physical column name: **`job_id`**, referencing `skill_analyzer_jobs.id` with `ON DELETE CASCADE`. Tenant key on the parent table: `skill_analyzer_jobs.organisation_id` (uuid NOT NULL, references `organisations.id` — confirmed at `server/db/schema/skillAnalyzerJobs.ts:30-32`). The RLS policy in Chunk 14 uses `job_id` literally.

### Sweep 4 — Canonical `createWorker` helper

Helper at `server/lib/createWorker.ts` (157 LOC). Signature:

```ts
export function createWorker<T>(options: {
  queue: JobName;
  boss: PgBoss;
  handler: (job: PgBoss.Job<T>) => Promise<void>;
  concurrency?: number;
  timeoutMs?: number;
  resolveOrgContext?: (job: PgBoss.Job<T>) => { organisationId: string; subaccountId?: string | null } | null;
}): Promise<...>;
```

Behaviour:
- Reads retry / timeout config from `JOB_CONFIG[options.queue]`.
- Default org-context resolver reads `organisationId` from the job payload; throws `failure('missing_org_context')` when absent.
- Wraps the handler in `db.transaction` + `SELECT set_config('app.organisation_id', $1, true)` + `withOrgTx({ tx, organisationId, subaccountId, source })`.
- Calls `withTimeout(...)` around the wrapped handler.
- Classifies retryable vs non-retryable errors via `isNonRetryable` / `isTimeoutError`.

`'skill-analyzer'` is already a key in `server/config/jobConfig.ts:395` with `retryLimit: 1`, `expireInSeconds: 14400`, `deadLetter: 'skill-analyzer__dlq'`, `idempotencyStrategy: 'one-shot'`. No JOB_CONFIG change required.

The 4 OTHER direct `boss.work` calls in `server/index.ts` (lines 652, 928, 941, 954) are **out of scope** for this build. Each will need its own conversion in a future build (Env D / Track A3 follow-up).

Call-shape reference (existing line 801 of `server/index.ts` is the workflow-gate-stall-notify worker — same shape):

```ts
await createWorker({
  queue: 'skill-analyzer',
  boss: pgboss,
  handler: async (job) => {
    const { jobId } = job.data as { jobId: string };
    const retryCount = getRetryCount(job as unknown as { retrycount?: number } & Record<string, unknown>);
    await runSkillAnalyzerJobWithIncidentEmission(jobId, retryCount);
  },
});
```

---

## Dependency direction (forward-only chunk graph)

```
Chunk 0 (sweep — done at plan time)
Chunk 1 (Pure leaves: statuses + similarity + serialisation)
Chunk 2 (Pure classification/*)                              ─ depends on 1
Chunk 3 (Pure mergeWarnings/*)                               ─ depends on 1
Chunk 4 (Pure concurrency + validation + ruleBasedMerge
         + textExtraction)                                    ─ depends on 1, 2, 3
Chunk 5 (Pure tableRemediation + collisions + agentRanking
         + consolidation + diff)                              ─ depends on 1, 2, 3, 4
Chunk 6 (Pure barrel re-export)                              ─ depends on 1, 2, 3, 4, 5
Chunk 7 (Impure types + hashing + helpers)                   ─ depends on 6
Chunk 8 (Impure jobLifecycle/*)                              ─ depends on 7
Chunk 9 (Impure results/*)                                   ─ depends on 7
Chunk 10 (Impure execute/*)                                  ─ depends on 7, 8, 9
Chunk 11 (Impure persistence/* + progress)                   ─ depends on 7, 10
Chunk 12 (Impure barrel re-export)                           ─ depends on 7, 8, 9, 10, 11
Chunk 13 (SA4 worker fix)                                    ─ depends on 12 (enqueue sites now in sub-modules)
Chunk 14 (SA1 RLS + SA6 raw-db)                              ─ depends on 13 (needs org-scoped tx)
Chunk 15 (caller sweep + doc sync)                           ─ depends on ALL prior
```

Chunk 5 depends on Chunk 4 because `agentRanking.ts` consumes leaf helpers (similarity types from Chunk 1) and `consolidation.ts` consumes serialisation (Chunk 1) — but neither consumes anything from the 4-file group. Edges 1, 2, 3 are the load-bearing inputs; the 4→5 edge exists only so the two sub-trees of the original "remainder" land in plan order. Chunk 11 depends on Chunk 10 because `persistence/results.ts` and `persistence/progress.ts` are referenced by callers that the execute tree itself does not reach into, but persistence and execute share imports of the impure types (Chunk 7); listing 10 in 11's prerequisites preserves a strict forward chain.

**Parallelisation recommendation: serialise.** The two trees are file-disjoint, so in principle the Impure track could start once Chunk 6 lands. In practice `feature-coordinator` processes chunks serially in plan order; the wall-clock saving only materialises if the operator hand-fans-out to multiple builder sessions. Recommend not to: chunk count (15) is already manageable, every G1 is fast, and serialising removes the spec-conformance risk of two builders touching `skillAnalyzerServicePure.ts` in overlapping commits. The canonical execution order is the chunk numbering above.

Safe fork point if the operator does want to parallelise: after Chunk 6 lands, Chunk 7 can run in parallel with the remainder of the Pure track ONLY if Pure is already complete. Do not branch earlier.

---

## Chunk 1 — Pure leaves: statuses + similarity + serialisation

**Scope:** Extract three independent leaf modules from `skillAnalyzerServicePure.ts`. No cross-dependencies; these are the foundation that mergeWarnings (Chunk 3), classification (Chunk 2), and the barrel (Chunk 6) compose.

**spec_sections:** §5.1, §5.2 (Pure tree leaves), §5.3 (dependency direction), §10 (caller sweep)

**Files created:**
- `server/services/skillAnalyzerServicePure/statuses.ts`
- `server/services/skillAnalyzerServicePure/similarity.ts`
- `server/services/skillAnalyzerServicePure/serialisation.ts`

**Files modified:**
- `server/services/skillAnalyzerServicePure.ts` — delete moved source ranges; add transitional re-exports (barrel rewrite is Chunk 6).

**Source moves (from `skillAnalyzerServicePure.ts`):**
- Lines 24-59 → `statuses.ts`: `SKILL_ANALYZER_MID_FLIGHT_STATUSES`, `SKILL_ANALYZER_TERMINAL_STATUSES`, `SKILL_ANALYZER_JOB_STATUSES`, types `SkillAnalyzerMidFlightStatus` / `SkillAnalyzerTerminalStatus` / `SkillAnalyzerJobStatus`, `isSkillAnalyzerTerminalStatus`, `isSkillAnalyzerMidFlightStatus`.
- Lines 61-134, 147-273 → `similarity.ts`: type `LibrarySkillSummary` (L61-70), type `ClassificationResult` (L72-102), type `SimilarityBand` (L104), `cosineSimilarity` (L112), `classifyBand` (L126), `computeBestMatches` (L148-273). Note `deriveClassificationFailureReason` (L135-146) lives in Chunk 2 (`classification/failureReason.ts`); the spec §4.1 groups it under "Classification primitives".
- The two private helpers `canonicalJSON` and `sortKeys` (per `architecture.md §2768`) → `serialisation.ts`. Builder greps the source at chunk execution time to find their declaration lines (currently private to the Pure file; consumed by `validateMergeOutput` and `evaluateApprovalState`). They become `export function canonicalJSON(...)` / `export function sortKeys(...)` in `serialisation.ts`.

**Imports added to the new files:** none (zero-dependency leaves).

**Module shape:**
- *Public interface:* status enums + type guards (locked per spec §4.1), `SimilarityBand`, `cosineSimilarity`, `classifyBand`, `computeBestMatches`, types `LibrarySkillSummary` / `ClassificationResult`, plus `canonicalJSON` / `sortKeys` (exposed at module level for cross-tree consumers in Chunks 3 and 4).
- *What stays hidden:* the constant arrays' `as const` derivation; the per-pair similarity loop in `computeBestMatches`; the key-order-tolerant deep-equality logic in `canonicalJSON`.

**Error handling:** All helpers pure, throw-free, behaviour-preserving.

**Test considerations:**
- The 8 existing `skillAnalyzerServicePure*.test.ts` files import from `../skillAnalyzerServicePure.js` (the barrel). They MUST keep resolving via the barrel re-export. No test file moves; no assertions change.
- Targeted re-run: `npx vitest run server/services/__tests__/skillAnalyzerServicePureDiffRows.test.ts` (smallest file).

**Dependencies:** None.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/skillAnalyzerServicePureDiffRows.test.ts`

**Acceptance criteria:**
- Three new files exist with the named exports above.
- Source ranges 24-59, 61-134, 147-273 (+ the two private serialisation helpers) deleted from `skillAnalyzerServicePure.ts`.
- The barrel re-exports the moved symbols transitionally; every name in spec §4.1 still resolves from `server/services/skillAnalyzerServicePure.js`.
- `npm run typecheck` clean.

---

## Chunk 2 — Pure classification/*

**Scope:** Extract the LLM-classification prompt/parser/failure-reason tree.

**spec_sections:** §5.1, §5.2 (Pure tree → `classification/`), §5.3

**Files created:**
- `server/services/skillAnalyzerServicePure/classification/prompts.ts`
- `server/services/skillAnalyzerServicePure/classification/parse.ts`
- `server/services/skillAnalyzerServicePure/classification/failureReason.ts`

**Files modified:**
- `server/services/skillAnalyzerServicePure.ts` — delete moved ranges; add re-exports.

**Source moves:**
- Lines 275-356 → `classification/prompts.ts`: `buildClassificationPrompt`, plus `CLASSIFICATION_SYSTEM_PROMPT` and `formatSkillForPrompt` (private helpers — grep declaration lines).
- Lines 1111-1178 → `classification/prompts.ts` (continuation): `buildClassifyPromptWithMerge`, plus `CLASSIFICATION_WITH_MERGE_SYSTEM_PROMPT` (private constant).
- Lines 358-400 → `classification/parse.ts`: `parseClassificationResponse`, plus the private `isValidClassification` predicate.
- Lines 908-1110, 1179-1250 → `classification/parse.ts` (continuation): type `ClassificationResultWithMerge` (the L908-? interface boundaries — builder confirms the end of the type), `parseClassificationResponseWithMerge`.
- Lines 135-146 → `classification/failureReason.ts`: `deriveClassificationFailureReason`.

**Imports added:**
- `classification/prompts.ts` — imports `LibrarySkillSummary` from `../similarity.js`.
- `classification/parse.ts` — imports `ClassificationResult` from `../similarity.js`.
- `classification/failureReason.ts` — none.

**Module shape:**
- *Public interface:* `buildClassificationPrompt`, `buildClassifyPromptWithMerge`, `parseClassificationResponse`, `parseClassificationResponseWithMerge`, type `ClassificationResultWithMerge`, `deriveClassificationFailureReason`.
- *What stays hidden:* the two SYSTEM_PROMPT constants; `formatSkillForPrompt`; `isValidClassification`; JSON-shape coercion paths inside the parsers; rate-limit / parse-error / timed-out classification logic in `deriveClassificationFailureReason`.

**Error handling:** Parsers return `null` on malformed input (preserved exactly). No throws.

**Test considerations:**
- `skillAnalyzerServicePureMergePrompt.test.ts` exercises `buildClassifyPromptWithMerge` and `parseClassificationResponseWithMerge` — must continue to resolve via the barrel.
- Targeted re-run: `npx vitest run server/services/__tests__/skillAnalyzerServicePureMergePrompt.test.ts`.

**Dependencies:** Chunk 1.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/skillAnalyzerServicePureMergePrompt.test.ts`

**Acceptance criteria:**
- Three new files under `classification/` with the named exports.
- All moved ranges deleted from `skillAnalyzerServicePure.ts`.
- Barrel re-exports preserve every name in spec §4.1 "Classification primitives".
- `npm run typecheck` clean.

---

## Chunk 3 — Pure mergeWarnings/*

**Scope:** Extract the merge-warning system — types, defaults, sort, resolutions, approval state. Largest Pure sub-tree.

**spec_sections:** §5.1, §5.2 (Pure tree → `mergeWarnings/`), §5.3

**Files created:**
- `server/services/skillAnalyzerServicePure/mergeWarnings/types.ts`
- `server/services/skillAnalyzerServicePure/mergeWarnings/defaults.ts`
- `server/services/skillAnalyzerServicePure/mergeWarnings/sort.ts`
- `server/services/skillAnalyzerServicePure/mergeWarnings/resolutions.ts`
- `server/services/skillAnalyzerServicePure/mergeWarnings/approval.ts`

**Files modified:**
- `server/services/skillAnalyzerServicePure.ts` — delete moved ranges; add re-exports.

**Source moves:**
- 402-451 → `mergeWarnings/types.ts`: interface `ProposedMerge`, type `MergeWarningCode`, type `MergeWarningSeverity`, interface `MergeWarning`, type `WarningTier`.
- 454-491 → `mergeWarnings/defaults.ts`: const `DEFAULT_WARNING_TIER_MAP`, plus private constants `WARNING_SEVERITY_PRIORITY` and `WARNING_TIER_PRIORITY` (grep declaration lines).
- 493-507 → `mergeWarnings/sort.ts`: function `sortWarningsBySeverity`.
- 509-595 → `mergeWarnings/resolutions.ts`: type `WarningResolutionKind`, interface `WarningResolution`, interface `ApprovalBlockingReason`, interface `RequiredResolution`, interface `ApprovalState`, const `RESOLUTIONS_FOR_CODE`.
- 597-906 → `mergeWarnings/approval.ts`: `parseDemotedFields`, type `DemotedFieldStatus`, `parseDemotedFieldStatuses`, `classifyDemotedFields`, `adjustClassifierConfidence`, `evaluateApprovalState`. `evaluateApprovalState` imports `sortKeys` from `../serialisation.js` (Chunk 1).

**Imports added:**
- `mergeWarnings/types.ts` — none.
- `mergeWarnings/defaults.ts` — imports `MergeWarningCode` / `WarningTier` from `./types.js`.
- `mergeWarnings/sort.ts` — imports `MergeWarning` / `MergeWarningSeverity` / `WarningTier` from `./types.js`, `WARNING_SEVERITY_PRIORITY` / `WARNING_TIER_PRIORITY` / `DEFAULT_WARNING_TIER_MAP` from `./defaults.js`.
- `mergeWarnings/resolutions.ts` — imports `MergeWarningCode` from `./types.js`.
- `mergeWarnings/approval.ts` — imports from `./types.js`, `./defaults.js`, `./sort.ts`, `./resolutions.ts`, `../serialisation.js`.

**Module shape:**
- *Public interface:* type `ProposedMerge`, type `MergeWarning`, type `MergeWarningCode`, type `MergeWarningSeverity`, type `WarningTier`, const `DEFAULT_WARNING_TIER_MAP`, `sortWarningsBySeverity`, type `WarningResolution`, type `WarningResolutionKind`, const `RESOLUTIONS_FOR_CODE`, type `RequiredResolution`, type `ApprovalState`, type `ApprovalBlockingReason`, `parseDemotedFields`, type `DemotedFieldStatus`, `parseDemotedFieldStatuses`, `classifyDemotedFields`, `adjustClassifierConfidence`, `evaluateApprovalState`.
- *What stays hidden:* the priority-table sort order; the demoted-field tokeniser; the resolution-cascade evaluation inside `evaluateApprovalState`; the canonicalJSON reuse for the deterministic approval-decision hash.

**Error handling:** All helpers pure and throw-free. `evaluateApprovalState` returns a discriminated result.

**Test considerations:**
- `skillAnalyzerServicePureValidation.test.ts` exercises validation + approval — must resolve via the barrel.
- Targeted re-run: `npx vitest run server/services/__tests__/skillAnalyzerServicePureValidation.test.ts`.

**Dependencies:** Chunk 1 (for `serialisation.ts`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/skillAnalyzerServicePureValidation.test.ts`

**Acceptance criteria:**
- Five new files under `mergeWarnings/`.
- All moved ranges deleted from source.
- Barrel re-exports every name in spec §4.1 "Merge-warning system".
- `npm run typecheck` clean.

---

## Chunk 4 — Pure concurrency + validation + ruleBasedMerge + textExtraction

**Scope:** Extract the concurrency check, output validators, rule-based merger + classifier-failure tree, and the text-shape extraction helpers. 4 files; first half of the original "remaining Pure modules" set.

**spec_sections:** §5.1, §5.2 (Pure tree → `concurrency`, `validation`, `ruleBasedMerge`, `textExtraction`), §5.3

**Files created (4):**
- `server/services/skillAnalyzerServicePure/concurrency.ts`
- `server/services/skillAnalyzerServicePure/validation.ts` (`validateMergeOutput`, `ValidationThresholds`)
- `server/services/skillAnalyzerServicePure/ruleBasedMerge.ts` (`buildRuleBasedMerge` + I/O types, `CLASSIFIER_FALLBACK_REASONING`, `CLASSIFIER_FALLBACK_WARNING`, `ClassifierFailureOutcome`, `buildClassifierFailureOutcome`, `rationaleArguesAgainstMerge`, `crossReferencesLibrarySkill`)
- `server/services/skillAnalyzerServicePure/textExtraction.ts` (`richnessScore`, `extractInvocationBlock`, `containsHitlGate`, `containsApprovalIntent`, `hasOutputFormatBlock`, `extractTables`, `extractTablesWithRows`, `decontaminateSectionRows`, `stripSourceAnnotations`, `startsWithPersonaOpener`, `extractOutputFormatSection`, `recoverOutputFormat`, `wordOverlapRatio`, `recoverDroppedTableRows`)

**Files modified:**
- `server/services/skillAnalyzerServicePure.ts` — delete moved ranges; add re-exports.

**Source moves:**
- 556-571 → `concurrency.ts`: `ConcurrencyCheckResult`, `checkConcurrencyStamp`.
- 1251-1346, 1429-1626, 1626-1632, 2947-?, 3156-3299 → `textExtraction.ts` (text-shape helpers; builder confirms exact bounds via source grep).
- 1881-2151 → `validation.ts`: `ValidationThresholds`, `validateMergeOutput`.
- 2153-2405 → `ruleBasedMerge.ts`: rule-based merge tree + classifier-failure tree.
- 2406-2522 → `ruleBasedMerge.ts` (continuation): `rationaleArguesAgainstMerge`, `crossReferencesLibrarySkill`.

**Imports added:** each new file imports only what it consumes; cross-tree edges allowed within `skillAnalyzerServicePure/*` per §5.3 (mergeWarnings types/defaults/sort consumed by `validation.ts`; serialisation consumed by `validation.ts`; similarity types consumed where needed).

**Module shape:**
- *Public interface:* `ConcurrencyCheckResult`, `checkConcurrencyStamp`, `validateMergeOutput`, `ValidationThresholds`, `buildRuleBasedMerge` (+ I/O types), `CLASSIFIER_FALLBACK_REASONING`, `CLASSIFIER_FALLBACK_WARNING`, `ClassifierFailureOutcome`, `buildClassifierFailureOutcome`, `rationaleArguesAgainstMerge`, `crossReferencesLibrarySkill`, `richnessScore`, `extractInvocationBlock`, `containsHitlGate`, `containsApprovalIntent`, `hasOutputFormatBlock`, `extractTables`, `extractTablesWithRows`, `decontaminateSectionRows`, `stripSourceAnnotations`, `startsWithPersonaOpener`, `extractOutputFormatSection`, `recoverOutputFormat`, `recoverDroppedTableRows`, `wordOverlapRatio`.
- *What stays hidden:* per-warning validator branches; multi-stage rule-based merger composition; regex tables and tokenisers inside text-extraction helpers; the concurrency-stamp ±2s tolerance.

**Error handling:** Every function pure; parsers return `null` on malformed input; validators return structured warning arrays. No retry, no I/O, no throws beyond the existing behaviour.

**Test considerations:**
- The 8 existing `skillAnalyzerServicePure*.test.ts` files exercise these via the barrel — none modified.
- Targeted re-run: `npx vitest run server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts`.

**Dependencies:** Chunks 1, 2, 3.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts`

**Acceptance criteria:**
- All 4 listed new files exist with listed exports.
- All moved ranges deleted from `skillAnalyzerServicePure.ts`.
- Barrel still re-exports every name in spec §4.1 covered by this chunk (verify by post-chunk grep against the spec list).
- `npm run typecheck` clean.

---

## Chunk 5 — Pure tableRemediation + collisions + agentRanking + consolidation + diff

**Scope:** Extract the remaining Pure-tree sub-modules: table remediation, collision detection, agent ranking + diff-rows + non-skill detection + agent suggestion + cluster recommendation, consolidation tree, and the diff-summary helper. 5 files; second half of the original "remaining Pure modules" set.

**spec_sections:** §5.1, §5.2 (Pure tree → `tableRemediation`, `collisions`, `agentRanking`, `consolidation`, `diff`), §5.3

**Files created (5):**
- `server/services/skillAnalyzerServicePure/tableRemediation.ts` (`RemediateTablesInput`, `RemediateTablesOutput`, `remediateTables`)
- `server/services/skillAnalyzerServicePure/collisions.ts` (`SkillGraphCollisionCheckInput`, `SkillGraphCollision`, `detectSkillGraphCollision`, `ContentOverlapResult`, `detectContentOverlap`, `NameMismatch`, `detectNameMismatch`)
- `server/services/skillAnalyzerServicePure/agentRanking.ts` (`AGENT_PROPOSAL_TOPK`, `AGENT_PROPOSAL_THRESHOLD`, `RankableAgent`, `AgentProposal`, `rankAgentsForCandidate`, `DiffToken`, `deriveDiffRows`, `NonSkillFlags`, `detectNonSkillFile`, `AgentSuggestionResult`, `buildAgentSuggestionPrompt`, `parseAgentSuggestionResponse`, `AGENT_RECOMMENDATION_THRESHOLD`, `AGENT_RECOMMENDATION_MIN_SKILLS`, `AgentRecommendation`, `buildAgentClusterRecommendationPrompt`, `parseAgentClusterRecommendationResponse`)
- `server/services/skillAnalyzerServicePure/consolidation.ts` (`ConsolidationOutcome`, `PreservationInventoryItem`, `PreservationInventory`, `extractPreservationInventory`, `buildConsolidationPrompt`, `ConsolidationParseResult`, `ConsolidationParseRejection`, `parseConsolidationResponse`, `computeConsolidationViolations`)
- `server/services/skillAnalyzerServicePure/diff.ts` (`generateDiffSummary`)

**Files modified:**
- `server/services/skillAnalyzerServicePure.ts` — delete moved ranges; add re-exports.

**Source moves:**
- 1346-1428, 3300-3340 → `collisions.ts` (name-mismatch + collision detection + content-overlap).
- 1633-1768 → `tableRemediation.ts`.
- 2523-2569 → `diff.ts`: `generateDiffSummary`.
- 2571-2932 → `agentRanking.ts`: agent ranking + diff rows + non-skill detection + agent suggestion + cluster recommendation.
- 3341-3697 → `consolidation.ts`.

**Imports added:** each new file imports only what it consumes; cross-tree edges allowed within `skillAnalyzerServicePure/*` per §5.3 (serialisation consumed by `consolidation.ts`; similarity types consumed by `agentRanking.ts`). No imports from Chunk 4's leaf-module helpers in this chunk — the 4→5 edge is plan-order only.

**Module shape:**
- *Public interface:* `remediateTables` (+ I/O types), `detectSkillGraphCollision` (+ I/O types), `detectContentOverlap` (+ result type), `detectNameMismatch` (+ result type), agent-ranking exports (`rankAgentsForCandidate`, `AGENT_PROPOSAL_TOPK`, `AGENT_PROPOSAL_THRESHOLD`, `RankableAgent`, `AgentProposal`), diff-row exports (`DiffToken`, `deriveDiffRows`), non-skill-detection exports (`NonSkillFlags`, `detectNonSkillFile`), agent-suggestion exports (`AgentSuggestionResult`, `buildAgentSuggestionPrompt`, `parseAgentSuggestionResponse`), agent-cluster-recommendation exports (`AGENT_RECOMMENDATION_THRESHOLD`, `AGENT_RECOMMENDATION_MIN_SKILLS`, `AgentRecommendation`, `buildAgentClusterRecommendationPrompt`, `parseAgentClusterRecommendationResponse`), consolidation exports, `generateDiffSummary`.
- *What stays hidden:* table-remediation row-conflict resolution; LLM-output coercion paths inside the consolidation parser; cosine-sort + threshold filter inside `rankAgentsForCandidate`; content-overlap n-gram derivation.

**Error handling:** Every function pure; parsers return `null` on malformed input. No retry, no I/O, no throws beyond the existing behaviour.

**Test considerations:**
- All 8 existing `skillAnalyzerServicePure*.test.ts` files exercise these via the barrel — none modified.
- Targeted re-run: `npx vitest run server/services/__tests__/skillAnalyzerServicePureV6.test.ts`.

**Dependencies:** Chunks 1, 2, 3, 4.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/skillAnalyzerServicePureV6.test.ts`

**Acceptance criteria:**
- All 5 listed new files exist with listed exports.
- All moved ranges deleted from `skillAnalyzerServicePure.ts`.
- Barrel still re-exports every name in spec §4.1 covered by this chunk (verify by post-chunk grep against the spec list).
- `npm run typecheck` clean.

---

## Chunk 6 — Pure barrel re-export + aggregate composition

**Scope:** Rewrite `skillAnalyzerServicePure.ts` as a thin barrel: re-exports from sub-modules + the `skillAnalyzerServicePure` aggregate object. No remaining inline definitions.

**spec_sections:** §1 Goal 1, §4.1, §5.2, §5.7 (barrel shape adopted from pattern-setter), §8 AC 1 + 9 (LOC cap)

**Files modified:**
- `server/services/skillAnalyzerServicePure.ts` — rewrite as barrel (< 250 LOC target per spec §1 Goal 1).

**Barrel target shape:**

```ts
// Pure barrel — assembles the public surface from sub-modules.
// Existing callers continue to import from './skillAnalyzerServicePure.js'.

export * from './skillAnalyzerServicePure/statuses.js';
export * from './skillAnalyzerServicePure/similarity.js';
export * from './skillAnalyzerServicePure/serialisation.js';
export * from './skillAnalyzerServicePure/classification/prompts.js';
export * from './skillAnalyzerServicePure/classification/parse.js';
export * from './skillAnalyzerServicePure/classification/failureReason.js';
export * from './skillAnalyzerServicePure/mergeWarnings/types.js';
export * from './skillAnalyzerServicePure/mergeWarnings/defaults.js';
export * from './skillAnalyzerServicePure/mergeWarnings/sort.js';
export * from './skillAnalyzerServicePure/mergeWarnings/resolutions.js';
export * from './skillAnalyzerServicePure/mergeWarnings/approval.js';
export * from './skillAnalyzerServicePure/concurrency.js';
export * from './skillAnalyzerServicePure/validation.js';
export * from './skillAnalyzerServicePure/ruleBasedMerge.js';
export * from './skillAnalyzerServicePure/textExtraction.js';
export * from './skillAnalyzerServicePure/tableRemediation.js';
export * from './skillAnalyzerServicePure/collisions.js';
export * from './skillAnalyzerServicePure/agentRanking.js';
export * from './skillAnalyzerServicePure/diff.js';
export * from './skillAnalyzerServicePure/consolidation.js';

// Aggregate object — preserves the `skillAnalyzerServicePure.<name>` call shape
// used by `server/jobs/skillAnalyzerJob.ts`, `scripts/audit-skill-library-shallowness.ts`,
// and `scripts/smoke-test-agent-embeddings.ts`. Membership locked at the
// current 27 keys per Chunk 0 Sweep 1.
import { cosineSimilarity, classifyBand, computeBestMatches } from './skillAnalyzerServicePure/similarity.js';
import { deriveClassificationFailureReason } from './skillAnalyzerServicePure/classification/failureReason.js';
import { buildClassificationPrompt, buildClassifyPromptWithMerge } from './skillAnalyzerServicePure/classification/prompts.js';
import { parseClassificationResponse, parseClassificationResponseWithMerge } from './skillAnalyzerServicePure/classification/parse.js';
import { generateDiffSummary } from './skillAnalyzerServicePure/diff.js';
import { rankAgentsForCandidate, deriveDiffRows, detectNonSkillFile, buildAgentSuggestionPrompt, parseAgentSuggestionResponse, buildAgentClusterRecommendationPrompt, parseAgentClusterRecommendationResponse, AGENT_RECOMMENDATION_THRESHOLD, AGENT_RECOMMENDATION_MIN_SKILLS } from './skillAnalyzerServicePure/agentRanking.js';
import { crossReferencesLibrarySkill, rationaleArguesAgainstMerge } from './skillAnalyzerServicePure/ruleBasedMerge.js';
import { classifyDemotedFields, parseDemotedFieldStatuses, adjustClassifierConfidence } from './skillAnalyzerServicePure/mergeWarnings/approval.js';
import { extractPreservationInventory, buildConsolidationPrompt, parseConsolidationResponse, computeConsolidationViolations } from './skillAnalyzerServicePure/consolidation.js';

export const skillAnalyzerServicePure = {
  cosineSimilarity,
  classifyBand,
  computeBestMatches,
  buildClassificationPrompt,
  parseClassificationResponse,
  buildClassifyPromptWithMerge,
  parseClassificationResponseWithMerge,
  generateDiffSummary,
  rankAgentsForCandidate,
  deriveDiffRows,
  deriveClassificationFailureReason,
  detectNonSkillFile,
  buildAgentSuggestionPrompt,
  parseAgentSuggestionResponse,
  buildAgentClusterRecommendationPrompt,
  parseAgentClusterRecommendationResponse,
  crossReferencesLibrarySkill,
  rationaleArguesAgainstMerge,
  classifyDemotedFields,
  parseDemotedFieldStatuses,
  adjustClassifierConfidence,
  AGENT_RECOMMENDATION_THRESHOLD,
  AGENT_RECOMMENDATION_MIN_SKILLS,
  extractPreservationInventory,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  computeConsolidationViolations,
};
```

Aggregate membership: **27 keys** — verbatim from source lines 3699-3727.

**Module shape:**
- *Public interface:* every name in spec §4.1 — verified by post-chunk grep against the spec table.
- *What stays hidden:* the sub-directory tree under `skillAnalyzerServicePure/` is now the carry surface.

**Error handling:** N/A (re-exports only).

**Test considerations:**
- Targeted re-run: `npx vitest run server/services/__tests__/skillAnalyzerServicePure.test.ts`.

**Dependencies:** Chunks 1, 2, 3, 4, 5.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/services/__tests__/skillAnalyzerServicePure.test.ts`

**Acceptance criteria:**
- `server/services/skillAnalyzerServicePure.ts` < 250 LOC.
- Aggregate object membership unchanged (27 keys).
- All 16 Pure-file callers compile and import without source modification.
- `npm run typecheck` clean.
- If `scripts/.gate-baselines/loc-cap.txt` lists `skillAnalyzerServicePure.ts`, that entry is removed in this chunk (the file is no longer over the cap).

---

## Chunk 7 — Impure types + hashing + helpers

**Scope:** Begin the impure-shell split. Extract public type interfaces, the stable-stringify / hash helpers, the slugify helper.

**spec_sections:** §5.1, §5.2 (Impure tree leaves), §5.3, §4.2 (public types)

**Files created:**
- `server/services/skillAnalyzerService/types.ts`
- `server/services/skillAnalyzerService/hashing.ts`
- `server/services/skillAnalyzerService/helpers/slugify.ts`

**Files modified:**
- `server/services/skillAnalyzerService.ts` — delete moved ranges; add re-exports.

**Source moves (from `skillAnalyzerService.ts`):**
- Lines 284-329 → `types.ts`: `MatchedSkillContent` (L284-294), `AvailableSystemAgent` (L295-301), `EnrichedResult` type alias (L302-309), `GetJobResponse` (L310-321).
- Plus (from later in the file): `ResolveWarningParams` (L613-630), `UpdateAgentProposalParams` (L755-774), `PatchMergeFieldsParams` (L950-967).
- `stableStringify` / `hashSkillContent` / `toErrorMessage` helpers — find their declaration lines (private to the shell) and move to `hashing.ts`.
- `slugifyName` helper — find its declaration line and move to `helpers/slugify.ts`.

**Imports added:**
- `types.ts` — imports the table type `typeof skillAnalyzerResults.$inferSelect` from `../../db/schema/index.js` (for `EnrichedResult`).
- `hashing.ts` — `crypto` from Node stdlib for the hash.
- `helpers/slugify.ts` — none.

**Module shape:**
- *Public interface:* type `MatchedSkillContent`, type `AvailableSystemAgent`, type `EnrichedResult`, type `GetJobResponse`, type `ResolveWarningParams`, type `UpdateAgentProposalParams`, type `PatchMergeFieldsParams` (all re-exported by the barrel; locked per spec §4.2). Plus internal helpers `stableStringify`, `hashSkillContent`, `toErrorMessage`, `slugifyName` — used by sibling sub-modules in Chunks 8-11; NOT re-exported by the barrel.
- *What stays hidden:* the JSON stable-ordering implementation; the SHA-256 derivation in `hashSkillContent`; the slug-validation rules in `slugifyName`.

**Error handling:** Throw-free.

**Test considerations:**
- No existing tests for the impure shell. None added.
- Smoke-test scripts get build-time typecheck coverage only.

**Dependencies:** Chunk 6 (Pure barrel must be stable before the impure shell starts moving).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Three new files with the listed exports.
- Source ranges deleted from `skillAnalyzerService.ts`.
- Barrel re-exports the seven type interfaces such that every import from spec §4.2 list still resolves.
- `npm run typecheck` clean.

---

## Chunk 8 — Impure jobLifecycle/* (create + resume + get + list)

**Scope:** Extract the four job-lifecycle async functions into per-operation modules.

**spec_sections:** §5.2 (Impure tree → `jobLifecycle/`), §4.2

**Files created:**
- `server/services/skillAnalyzerService/jobLifecycle/create.ts`
- `server/services/skillAnalyzerService/jobLifecycle/resume.ts`
- `server/services/skillAnalyzerService/jobLifecycle/get.ts` (housing `getJob`, `getJobById`, `listJobs`)

**Files modified:**
- `server/services/skillAnalyzerService.ts` — delete moved ranges; add re-exports.

**Source moves:**
- Lines 98-156 → `jobLifecycle/create.ts`: `createJob`. Includes the `boss.send('skill-analyzer', { jobId }, ...)` call at L150 — keep this call inside `create.ts` UNTIL Chunk 13 extends the payload.
- Lines 158-280 → `jobLifecycle/resume.ts`: `resumeJob`, plus the `RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS` constant (L177). The `boss.send('skill-analyzer', { jobId }, ...)` call at L273 also stays here until Chunk 13.
- Lines 322-422 → `jobLifecycle/get.ts`: `getJob`. Plus the `getJobById` internal function (L1984-1993) and `listJobs` (L408-422) — co-located for read-path cohesion.

**Imports added:**
- `create.ts` — `db`, `skillAnalyzerJobs` table, `skillAnalyzerConfigService`, `skillParserService`, `getPgBoss`, `getJobConfig`, `logger` (find each in source).
- `resume.ts` — `db`, `eq`, `skillAnalyzerJobs` table, `getPgBoss`, `getJobConfig`, `logger`, plus pg-boss state-introspection imports.
- `get.ts` — `db`, `eq`, `desc`, `skillAnalyzerJobs` / `skillAnalyzerResults` tables, `systemSkillService` (for live `matchedSkillContent` computation per source comment), `MatchedSkillContent` / `EnrichedResult` / `GetJobResponse` types from `../types.js`.

**Module shape:**
- *Public interface:* `createJob`, `resumeJob`, `getJob`, `getJobById`, `listJobs` — locked per spec §4.2.
- *What stays hidden:* parse-immediate logic in `createJob`; multi-status guard cascade in `resumeJob`; enrichment fan-out in `getJob` for `matchedSkillContent` / `availableSystemAgents`.

**Error handling:** Existing service throws of `{statusCode, message, errorCode?}` shape preserved exactly.

**Test considerations:**
- No collocated tests; none added.
- Smoke-test consumer: `scripts/smoke-test-getjob-shape.ts` imports `getJob` — must continue to resolve via the barrel.

**Dependencies:** Chunk 7 (types).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Three new files with listed exports.
- All four lifecycle functions plus `getJobById` deleted from the impure shell.
- Barrel re-exports preserve `skillAnalyzerService.createJob` / `.resumeJob` / `.getJob` / `.listJobs` / `.getJobById` such that `server/routes/skillAnalyzer.ts:5` continues to compose correctly.
- `npm run typecheck` clean.

---

## Chunk 9 — Impure results/* (per-result operations)

**Scope:** Extract per-result-row operations: setAction / updateProposal / warnings / merge.

**spec_sections:** §5.2 (Impure tree → `results/`), §4.2

**Files created:**
- `server/services/skillAnalyzerService/results/setAction.ts` (`setResultAction`, `bulkSetResultAction`)
- `server/services/skillAnalyzerService/results/updateProposal.ts` (`updateProposedAgent`, `updateAgentProposal`, `updateResultAgentProposals`)
- `server/services/skillAnalyzerService/results/warnings.ts` (`resolveWarning`, `appendBatchCollisionWarnings`, `applyBatchDeductionAndWarningAtomic`)
- `server/services/skillAnalyzerService/results/merge.ts` (`patchMergeFields`, `resetMergeToOriginal`)

**Files modified:**
- `server/services/skillAnalyzerService.ts` — delete moved ranges; add re-exports.

**Source moves:**
- Lines 423-572 → `results/setAction.ts`: `setResultAction`, `bulkSetResultAction`.
- Lines 574-611, 775-948, 2111-2131 → `results/updateProposal.ts`: `updateProposedAgent`, `updateAgentProposal`, `updateResultAgentProposals`.
- Lines 632-753, 2536-2613 → `results/warnings.ts`: `resolveWarning`, `appendBatchCollisionWarnings`, `applyBatchDeductionAndWarningAtomic`. Parameter interfaces (`ResolveWarningParams`) stay in `types.ts` from Chunk 7 and `warnings.ts` imports them.
- Lines 968-1242 → `results/merge.ts`: `patchMergeFields`, `resetMergeToOriginal`.

**Imports added:**
- All four files: tables (`skillAnalyzerResults`, `skillAnalyzerJobs`), drizzle helpers (`eq`, `and`, `inArray`, `sql`), Pure-side functions from `../../skillAnalyzerServicePure.js` (the barrel).
- `setAction.ts` — additionally imports `evaluateApprovalState` from the Pure barrel.
- `updateProposal.ts` — additionally imports `rankAgentsForCandidate`, type `AgentProposal` from the Pure barrel.
- `warnings.ts` — imports `MergeWarning`, `WarningResolution`, `RESOLUTIONS_FOR_CODE`, `checkConcurrencyStamp` (for the If-Unmodified-Since check).
- `merge.ts` — imports `validateMergeOutput`, `ValidationThresholds`, `evaluateApprovalState` (post-edit re-evaluation).

**Module shape:**
- *Public interface:* the seven async functions listed plus `ResolveWarningParams`, `UpdateAgentProposalParams`, `PatchMergeFieldsParams` (re-exported via `types.ts` from Chunk 7).
- *What stays hidden:* per-row validation re-runs after edits; warning deduplication by `(warningCode, details.field)`; batch-collision warning append SQL; concurrency-stamp comparison against `mergeUpdatedAt ?? createdAt` with the ±2s tolerance.

**Error handling:** Structured `{statusCode, message}` throws preserved (`409 STALE_RESOLVE` from concurrency check; `404` on missing row; `423` on already-approved rows).

**Test considerations:**
- No collocated tests. Smoke-test consumers: `scripts/smoke-test-merge-endpoints.ts` (`patchMergeFields`, `resetMergeToOriginal`), `scripts/smoke-test-agent-proposal-patch.ts` (`updateAgentProposal`) — both continue to resolve via the barrel.

**Dependencies:** Chunks 6 (Pure barrel) and 7 (impure types).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Four new files with listed exports.
- All seven async functions deleted from the impure shell.
- Barrel still re-exports each function; `skillAnalyzerService` aggregate still composes.
- `npm run typecheck` clean.

---

## Chunk 10 — Impure execute/* (approved + retry + unlock)

**Scope:** Extract the execute and retry tree. 3 files.

**spec_sections:** §5.2 (Impure tree → `execute/`), §4.2

**Files created (3):**
- `server/services/skillAnalyzerService/execute/approved.ts` (`executeApproved`)
- `server/services/skillAnalyzerService/execute/retry.ts` (`retryClassification`, `bulkRetryFailedClassifications`)
- `server/services/skillAnalyzerService/execute/unlock.ts` (`unlockStaleExecution`)

**Files modified:**
- `server/services/skillAnalyzerService.ts` — delete moved ranges; add re-exports.

**Source moves:**
- Lines 1244-1322 → `execute/approved.ts`: `executeApproved`.
- Lines 2357-2535 → `execute/retry.ts`: `retryClassification`, `bulkRetryFailedClassifications`.
- Lines 1324-1944 → `execute/unlock.ts`: `unlockStaleExecution`. Note: source range includes a large block; builder reads the source at chunk-execution time to confirm whether any interleaved private helpers should accompany it (see Risk R3). If interleaved helpers belong elsewhere (e.g. `getJobById` lives in `jobLifecycle/get.ts` per Chunk 8, or `updateJobProgress` / in-flight helpers live in Chunk 11's persistence/* tree), route them per spec §5.2.

**Imports added:**
- `execute/approved.ts` — `db`, drizzle helpers, `withOrgTx`, Pure-side `evaluateApprovalState`, the actual execution service (find in source).
- `execute/retry.ts` — `db`, drizzle helpers, Pure-side `buildClassifierFailureOutcome`, LLM router `routeCall`.
- `execute/unlock.ts` — `db`, drizzle helpers.

**Module shape:**
- *Public interface:* `executeApproved`, `retryClassification`, `bulkRetryFailedClassifications`, `unlockStaleExecution` — all locked per spec §4.2.
- *What stays hidden:* row-by-row execute fan-out inside `executeApproved`; LLM-retry payload reconstruction inside `retryClassification`; lock-stale recovery logic inside `unlockStaleExecution`.

**Error handling:** Existing throws preserved (`409` on execution-lock contention; `404` paths; structured `failure(...)` calls).

**Test considerations:**
- No collocated tests. Smoke-test consumer: `scripts/smoke-test-execute-approved.ts` (`executeApproved`) — continues to resolve via the barrel.

**Dependencies:** Chunks 7, 8, 9.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Three new files with listed exports.
- All four execute-tree functions deleted from the impure shell.
- Barrel re-exports preserve every spec-§4.2 execute name; `skillAnalyzerService` aggregate still composes.
- `npm run typecheck` clean.

---

## Chunk 11 — Impure persistence/* + progress

**Scope:** Extract persistence helpers and the progress / agent-recommendation updaters. 3 files.

**spec_sections:** §5.2 (Impure tree → `persistence/`), §4.2

**Files created (3):**
- `server/services/skillAnalyzerService/persistence/results.ts` (`insertResults`, `insertSingleResult`, `listResultIndicesForJob`)
- `server/services/skillAnalyzerService/persistence/inFlight.ts` (`markSkillInFlight`, `unmarkSkillInFlight`)
- `server/services/skillAnalyzerService/persistence/progress.ts` (`updateJobProgress`, `updateJobAgentRecommendation`)

**Files modified:**
- `server/services/skillAnalyzerService.ts` — delete moved ranges; add re-exports.

**Source moves:**
- Lines 1996-2010 → `persistence/results.ts`: `insertResults`, `insertSingleResult`. **DO NOT migrate `db.insert(...)` → `getOrgScopedDb(...).insert(...)` in this chunk.** That swap is Chunk 14. Chunk 11 keeps the existing `db.insert(...)` literal verbatim.
- Lines 2033-2074 → `persistence/results.ts` (continuation): `listResultIndicesForJob`.
- Lines 2076-2110 → `persistence/inFlight.ts`: `markSkillInFlight`, `unmarkSkillInFlight`.
- Lines 1945-1979 → `persistence/progress.ts`: `updateJobProgress`.
- Lines 2132-2151 → `persistence/progress.ts` (continuation): `updateJobAgentRecommendation`.

**Imports added:**
- `persistence/results.ts` — `db`, `skillAnalyzerResults` table.
- `persistence/inFlight.ts` — `db`, `eq`, `sql`, `skillAnalyzerJobs` table.
- `persistence/progress.ts` — `db`, `eq`, `skillAnalyzerJobs` table.

**Module shape:**
- *Public interface:* `insertResults`, `insertSingleResult`, `listResultIndicesForJob`, `markSkillInFlight`, `unmarkSkillInFlight`, `updateJobProgress`, `updateJobAgentRecommendation` — all locked per spec §4.2.
- *What stays hidden:* batch-size loop in `insertResults`; in-flight stamp comparison inside `markSkillInFlight` / `unmarkSkillInFlight`; the progress-update SQL shape.

**Error handling:** Existing throws preserved (`404` paths; structured `failure(...)` calls).

**Test considerations:**
- No collocated tests. Job-handler caller `server/jobs/skillAnalyzerJob.ts` imports each named function directly — must continue to resolve via the barrel.

**Dependencies:** Chunks 7, 10. Chunk 11 depends on Chunk 10 even though execute/* and persistence/* are file-disjoint — both share impure types (Chunk 7) and listing 10 in 11's prerequisites preserves the strict forward chain across the impure tree.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Three new files with listed exports.
- All seven persistence + progress functions deleted from the impure shell.
- Barrel re-exports preserve every spec-§4.2 persistence + progress name; `skillAnalyzerService` aggregate still composes.
- `npm run typecheck` clean.

---

## Chunk 12 — Impure barrel re-export + aggregate composition

**Scope:** Rewrite `skillAnalyzerService.ts` as a thin barrel: re-exports from sub-modules + the `skillAnalyzerService` aggregate object + the status re-export block.

**spec_sections:** §1 Goal 2, §4.2, §5.2, §8 AC 2 + 9

**Files modified:**
- `server/services/skillAnalyzerService.ts` — rewrite as barrel (< 250 LOC target per spec §1 Goal 2).

**Barrel target shape:**

```ts
// Impure-shell barrel — assembles the operation surface from sub-modules.

// Status enums live in the Pure tree; re-export here so existing callers
// keep their import path.
export {
  SKILL_ANALYZER_JOB_STATUSES,
  SKILL_ANALYZER_MID_FLIGHT_STATUSES,
  SKILL_ANALYZER_TERMINAL_STATUSES,
  isSkillAnalyzerTerminalStatus,
  isSkillAnalyzerMidFlightStatus,
  type SkillAnalyzerJobStatus,
  type SkillAnalyzerMidFlightStatus,
  type SkillAnalyzerTerminalStatus,
} from './skillAnalyzerServicePure.js';

// Public types
export type {
  MatchedSkillContent,
  AvailableSystemAgent,
  EnrichedResult,
  GetJobResponse,
  ResolveWarningParams,
  UpdateAgentProposalParams,
  PatchMergeFieldsParams,
} from './skillAnalyzerService/types.js';

// Operations
import { createJob } from './skillAnalyzerService/jobLifecycle/create.js';
import { resumeJob } from './skillAnalyzerService/jobLifecycle/resume.js';
import { getJob, getJobById, listJobs } from './skillAnalyzerService/jobLifecycle/get.js';
import { setResultAction, bulkSetResultAction } from './skillAnalyzerService/results/setAction.js';
import { updateProposedAgent, updateAgentProposal, updateResultAgentProposals } from './skillAnalyzerService/results/updateProposal.js';
import { resolveWarning, appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic } from './skillAnalyzerService/results/warnings.js';
import { patchMergeFields, resetMergeToOriginal } from './skillAnalyzerService/results/merge.js';
import { executeApproved } from './skillAnalyzerService/execute/approved.js';
import { retryClassification, bulkRetryFailedClassifications } from './skillAnalyzerService/execute/retry.js';
import { unlockStaleExecution } from './skillAnalyzerService/execute/unlock.js';
import { insertResults, insertSingleResult, listResultIndicesForJob } from './skillAnalyzerService/persistence/results.js';
import { markSkillInFlight, unmarkSkillInFlight } from './skillAnalyzerService/persistence/inFlight.js';
import { updateJobProgress, updateJobAgentRecommendation } from './skillAnalyzerService/persistence/progress.js';

export {
  createJob, resumeJob, getJob, listJobs,
  setResultAction, bulkSetResultAction,
  updateProposedAgent, updateAgentProposal,
  patchMergeFields, resetMergeToOriginal,
  resolveWarning,
  executeApproved, unlockStaleExecution,
  updateJobProgress,
  retryClassification, bulkRetryFailedClassifications,
  getJobById, insertResults, insertSingleResult, listResultIndicesForJob,
  markSkillInFlight, unmarkSkillInFlight,
  updateResultAgentProposals, updateJobAgentRecommendation,
  appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic,
};

export const skillAnalyzerService = {
  createJob, resumeJob, getJob, listJobs,
  setResultAction, bulkSetResultAction,
  updateAgentProposal, updateProposedAgent,
  patchMergeFields, resetMergeToOriginal,
  resolveWarning,
  executeApproved, unlockStaleExecution,
  updateJobProgress,
  retryClassification, bulkRetryFailedClassifications,
  getJobById, insertResults, insertSingleResult, listResultIndicesForJob,
  markSkillInFlight, unmarkSkillInFlight,
  updateResultAgentProposals, updateJobAgentRecommendation,
  appendBatchCollisionWarnings, applyBatchDeductionAndWarningAtomic,
};
```

Aggregate membership: 26 keys — locked at source lines 2614-2642.

**Module shape:**
- *Public interface:* every name in spec §4.2 — verified by post-chunk grep.
- *What stays hidden:* the sub-directory tree under `skillAnalyzerService/`.

**Error handling:** N/A (re-exports only).

**Test considerations:**
- No tests. Smoke-test scripts (entries 3-6 in Chunk 0 Sweep 2) continue to resolve every named import.

**Dependencies:** Chunks 7, 8, 9, 10, 11.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- `server/services/skillAnalyzerService.ts` < 250 LOC.
- Aggregate `skillAnalyzerService` membership unchanged (26 keys).
- All 6 impure-shell callers compile without source modification.
- If `scripts/.gate-baselines/any-budget.txt` / `loc-cap.txt` carry entries for `skillAnalyzerService.ts` or `skillAnalyzerServicePure.ts`, those entries are removed in this chunk.
- `npm run typecheck` clean.

---

## Chunk 13 — SA4 worker fix: convert `boss.work` → `createWorker`

**Scope:** Convert the direct `boss.work('skill-analyzer', ...)` call at `server/index.ts:691` to `createWorker(...)`. Extend the job payload at both enqueue sites to include `organisationId`. **DO NOT** touch the 4 other `boss.work` calls in `server/index.ts`.

**spec_sections:** §1 Goal 6, §7 (Worker Pattern Fix — SA4), §8 AC 10

**Files modified:**
- `server/index.ts` — replace the `boss.work('skill-analyzer', ...)` block at lines 691-695 with a `createWorker({...})` call.
- `server/services/skillAnalyzerService/jobLifecycle/create.ts` — extend the `boss.send('skill-analyzer', { jobId }, ...)` payload to `{ jobId, organisationId }`.
- `server/services/skillAnalyzerService/jobLifecycle/resume.ts` — same extension.

**Source changes:**

In `server/index.ts` (within the existing `if (env.JOB_QUEUE_BACKEND === 'pg-boss')` block around line 680):

```diff
   try {
     const boss = await getPgBoss();
     const { runSkillAnalyzerJobWithIncidentEmission } = await import('./jobs/skillAnalyzerJobWithIncidentEmission.js');
     const { getRetryCount } = await import('./lib/jobErrors.js');
+    const { createWorker } = await import('./lib/createWorker.js');
     // [existing comment block preserved verbatim]
-    await boss.work('skill-analyzer', async (job) => {
-      const { jobId } = job.data as { jobId: string };
+    await createWorker<{ jobId: string; organisationId: string }>({
+      queue: 'skill-analyzer',
+      boss,
+      handler: async (job) => {
+        const { jobId } = job.data;
         const retryCount = getRetryCount(job as unknown as { retrycount?: number } & Record<string, unknown>);
         await runSkillAnalyzerJobWithIncidentEmission(jobId, retryCount);
-    });
+      },
+    });
   } catch (err) {
     console.error('[boot] failed to register skill-analyzer worker', err);
   }
```

In `jobLifecycle/create.ts` (post-Chunk-8 home of `createJob`):

```diff
-  await boss.send('skill-analyzer', { jobId }, {
+  await boss.send('skill-analyzer', { jobId, organisationId }, {
     ...getJobConfig('skill-analyzer'),
     singletonKey: undefined,
   });
```

In `jobLifecycle/resume.ts` (post-Chunk-8 home of `resumeJob`):

```diff
-  await boss.send('skill-analyzer', { jobId }, {
+  await boss.send('skill-analyzer', { jobId, organisationId }, {
     ...getJobConfig('skill-analyzer'),
     singletonKey: undefined,
   });
```

`organisationId` is already in scope at both sites.

**Module shape:**
- *Public interface:* none changed. The worker registration is a boot-time side effect; `runSkillAnalyzerJobWithIncidentEmission(jobId, retryCount)` is called identically.
- *What stays hidden:* the org-tx wrapping logic flows through `createWorker`'s default resolver; the handler body is otherwise unchanged.

**Error handling:** `createWorker`'s default `resolveOrgContext` throws `failure('missing_org_context')` if the payload lacks `organisationId`. Both enqueue sites now include it. `runSkillAnalyzerJobWithIncidentEmission` continues to surface terminal failures to the System Monitor exactly as before.

**Test considerations:**
- No existing test exercises the boss.work registration directly. Plan does NOT add a new test for this chunk; the runtime contract (handler still receives `{ jobId }`-compatible data and calls `runSkillAnalyzerJobWithIncidentEmission`) is preserved by inspection.
- The wrapper file `server/jobs/skillAnalyzerJobWithIncidentEmission.ts` is unchanged.

**Dependencies:** Chunk 12 (impure barrel is now thin; the two enqueue sites have moved to `jobLifecycle/`).

**Fallback path:** If `createWorker`'s default resolver causes any unforeseen issue (e.g. the wrapper's incident-emission path does its own connection management that conflicts with `withOrgTx`), **stop and revise the plan; do not proceed to Chunk 14 until the worker opens an org-scoped tx by another explicit mechanism.** The `resolveOrgContext: () => null` opt-out is NOT a valid fallback here because Chunk 14 migrates `insertResults` / `insertSingleResult` to `getOrgScopedDb(...)`, which requires an active org-scoped transaction; taking the null-resolver path would make every Stage-6 write fail with `missing_org_context`. If the default resolver path fails, the only valid recovery is to fix the underlying conflict (or restructure the wrapper) so that `withOrgTx` opens around the handler — never to skip org-context resolution.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- `server/index.ts:691` no longer contains a `boss.work(...)` literal for the skill-analyzer queue.
- The replacement is a `createWorker({ queue: 'skill-analyzer', boss, handler })` call.
- Both `boss.send('skill-analyzer', ...)` payloads extended to include `organisationId`.
- The 4 OTHER `boss.work` calls at lines 652, 928, 941, 954 in `server/index.ts` are UNTOUCHED (verify by post-chunk `grep -n "boss.work" server/index.ts` returning exactly 4 matches).
- `npm run lint` + `npm run typecheck` + `npm run build:server` clean.

---

## Chunk 14 — SA1 RLS migration + SA6 raw-db → getOrgScopedDb

**Scope:** Land the RLS policy on `skill_analyzer_results` (parent-EXISTS pattern), add the table to the manifest, migrate the two raw `db.insert(skillAnalyzerResults)` sites in `persistence/results.ts` to `getOrgScopedDb`.

**spec_sections:** §1 Goal 4-5 + 7, §6 (RLS Migration Scope), §8 AC 6 + 7 + 8 + 11

**Files created:**
- `migrations/0359_skill_analyzer_results_rls.sql`
- `migrations/0359_skill_analyzer_results_rls.down.sql`

**Files modified:**
- `server/config/rlsProtectedTables.ts` — add one entry for `skill_analyzer_results`.
- `server/services/skillAnalyzerService/persistence/results.ts` (file home created in Chunk 11) — swap `db.insert(skillAnalyzerResults)` for `getOrgScopedDb('skillAnalyzerService.insertResults').insert(skillAnalyzerResults)` and similar for `insertSingleResult`. Update the stale comment about "admin bypass path".

**Migration SQL (up — `migrations/0359_skill_analyzer_results_rls.sql`):**

```sql
-- Migration 0359: Enable RLS on skill_analyzer_results (Track A3 SA1)
--
-- skill_analyzer_results has no direct organisation_id column. Tenant
-- isolation is achieved via the parent-EXISTS pattern against
-- skill_analyzer_jobs.organisation_id — the FK column (job_id) cascades on
-- DELETE so orphaned rows are not a concern.
--
-- All routes touching skill_analyzer are gated system-admin-only today, so
-- the practical cross-tenant exposure window has been narrow; this policy
-- closes the layer-1 hole regardless.
--
-- See architecture.md § Canonical org-isolation policy template — this
-- migration adapts the template to the parent-EXISTS shape because the row
-- itself does not carry organisation_id.

ALTER TABLE skill_analyzer_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_analyzer_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_analyzer_results_org_isolation ON skill_analyzer_results;

CREATE POLICY skill_analyzer_results_org_isolation ON skill_analyzer_results
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM skill_analyzer_jobs saj
      WHERE saj.id = skill_analyzer_results.job_id
        AND saj.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM skill_analyzer_jobs saj
      WHERE saj.id = skill_analyzer_results.job_id
        AND saj.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
```

**Migration SQL (down — `migrations/0359_skill_analyzer_results_rls.down.sql`):**

```sql
-- Down-migration for 0359 — drops the RLS policy and disables row-level
-- security on skill_analyzer_results. Reverses the up exactly.

DROP POLICY IF EXISTS skill_analyzer_results_org_isolation ON skill_analyzer_results;
ALTER TABLE skill_analyzer_results NO FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_analyzer_results DISABLE ROW LEVEL SECURITY;
```

**`rlsProtectedTables.ts` entry (append at the end of the array, preserving migration-order convention):**

```ts
// 0359 — skill analyzer (Track A3 SA1)
{
  tableName: 'skill_analyzer_results',
  schemaFile: 'skillAnalyzerResults.ts',
  policyMigration: '0359_skill_analyzer_results_rls.sql',
  rationale:
    'Per-candidate classification results from the skill analyzer — proposed merges and LLM reasoning ' +
    'tied to a specific job and tenant via skill_analyzer_jobs.organisation_id. Cross-tenant exposure ' +
    'would leak proposed-merge content and merge-warning details. Tenant isolation uses the parent-EXISTS ' +
    'pattern against skill_analyzer_jobs (no direct organisation_id column on this table).',
},
```

**SA6 raw-db migration in `persistence/results.ts`:**

```diff
-import { db } from '../../../db/index.js';
+import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
 import { skillAnalyzerResults } from '../../../db/schema/index.js';

 export async function insertResults(
   rows: (typeof skillAnalyzerResults.$inferInsert)[]
 ): Promise<void> {
   if (rows.length === 0) return;
+  const tx = getOrgScopedDb('skillAnalyzerService.insertResults');
   for (let i = 0; i < rows.length; i += 100) {
-    await db.insert(skillAnalyzerResults).values(rows.slice(i, i + 100));
+    await tx.insert(skillAnalyzerResults).values(rows.slice(i, i + 100));
   }
 }

 export async function insertSingleResult(
   row: typeof skillAnalyzerResults.$inferInsert,
 ): Promise<void> {
-  await db.insert(skillAnalyzerResults).values(row);
+  await getOrgScopedDb('skillAnalyzerService.insertSingleResult').insert(skillAnalyzerResults).values(row);
 }
```

Also update the stale comment at the top of the section (carried over from `skillAnalyzerService.ts:1980-1981` during Chunk 11):

```diff
-// Internal functions for job handler use (no org-scoping — admin bypass path)
+// Internal functions for job handler use. The job handler now opens an
+// org-scoped transaction via createWorker (Chunk 13), so these writes
+// flow through getOrgScopedDb to satisfy the RLS policy on
+// skill_analyzer_results (migration 0359).
```

**Module shape:**
- *Public interface:* `insertResults` and `insertSingleResult` keep their signatures. RLS becomes a silent post-condition on every write through these helpers.
- *What stays hidden:* the org-tx context is read implicitly via `getOrgScopedDb`'s ALS lookup; callers don't pass org ids in.

**Error handling:**
- `getOrgScopedDb` throws `failure('missing_org_context')` when called outside an org-scoped tx. This is fail-loud by design.
- RLS fails closed: writes outside an org-tx see `WITH CHECK` violation. The `getOrgScopedDb` throw fires before the SQL hits the wire, so callers see the structured failure not a Postgres error.
- No new unique-constraint or `23505` paths.

**Test considerations:**
- No new test files required (spec §13 testing posture).
- **Optional targeted invariant test:** the builder MAY write `server/services/__tests__/skillAnalyzerResultsRlsManifest.test.ts` — a single-file Vitest test asserting `RLS_PROTECTED_TABLES` includes `{ tableName: 'skill_analyzer_results' }` and that the named `policyMigration` file exists on disk. ~ 30 LOC. Targeted run only: `npx vitest run server/services/__tests__/skillAnalyzerResultsRlsManifest.test.ts`. Authoring is allowed; not required.

**Dependencies:** Chunk 13 (worker now opens an org-scoped tx around the handler — `getOrgScopedDb` resolves to that tx).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- Static migration-file verification (instead of `npm run db:generate` — the migration is RLS-only and outside Drizzle's tracked surface; running the generator could produce ambiguous "no-op" output or stray artefacts depending on repo state):
  - Confirm both files exist: `ls migrations/0359_skill_analyzer_results_rls.sql migrations/0359_skill_analyzer_results_rls.down.sql`
  - Grep the up-migration for the required clauses:
    - `grep -n "ENABLE ROW LEVEL SECURITY" migrations/0359_skill_analyzer_results_rls.sql`
    - `grep -n "FORCE ROW LEVEL SECURITY" migrations/0359_skill_analyzer_results_rls.sql`
    - `grep -n "WITH CHECK" migrations/0359_skill_analyzer_results_rls.sql`
    - `grep -n "skill_analyzer_jobs" migrations/0359_skill_analyzer_results_rls.sql`
  - Grep the manifest for the new entry: `grep -n "skill_analyzer_results" server/config/rlsProtectedTables.ts`

**Acceptance criteria:**
- `migrations/0359_skill_analyzer_results_rls.sql` + `.down.sql` exist with the SQL above.
- Static verification greps above all return non-empty results.
- `rlsProtectedTables.ts` contains the new entry.
- `db.insert(skillAnalyzerResults)` calls in `persistence/results.ts` migrated to `getOrgScopedDb(...).insert(...)`.
- The stale "admin bypass" comment removed; the forward-looking comment added.
- `npm run typecheck` clean.
- (CI gate, not local) `scripts/verify-rls-coverage.sh` + `scripts/verify-rls-protected-tables.sh` pass once CI picks up the change.

---

## Chunk 15 — Caller sweep + doc sync

**Scope:** Final caller-sweep pass and doc updates. Caller migration to canonical sub-module paths is **explicitly out of scope** for this build.

**spec_sections:** §10 (Caller Sweep), §8 AC 12 + 13

**Files modified:**
- `architecture.md` — update the "Key files per domain" entry for the skill analyzer to reflect the new directory tree (one short paragraph and a pointer to the directories). Locate the existing entry near line 2768 (`server/services/skillAnalyzerServicePure.ts`) and add a sibling entry for `server/services/skillAnalyzerService.ts`. Replace both prose descriptions with directory pointers.

**Not modified in this chunk (intentional):**
- The 16 Pure-file callers + 6 impure-shell callers from Chunk 0 remain on the existing barrel paths. **Migrating any caller to a canonical sub-module path is out of scope for this build.** The Chunk 15 acceptance criteria require unchanged grep counts (16 Pure-file imports + 6 impure-shell imports); migrating callers would invalidate those counts. Caller migration, if desired, ships as a separate follow-up build after the barrels stabilise.
- `tasks/todo.md` — NOT modified here. Closure of SA1, SA2, SA4, SA6 is owned by `finalisation-coordinator` once the PR number is known. Chunk 15 emits the closure-text proposal in `progress.md` (and in the PR description) for finalisation to apply. See "Out of scope / deferred" below.

**Caller sweep procedure:**
1. Re-run `rg -nP "from\s+['\"][^'\"]*skillAnalyzerServicePure" --glob '**/*.{ts,tsx,js,jsx}'` — confirm 16 hits unchanged.
2. Re-run `rg -nP "from\s+['\"][^'\"]*skillAnalyzerService(\.js)?['\"]" --glob '**/*.{ts,tsx,js,jsx}'` — confirm 6 hits unchanged.
3. Confirm no new transitive import path violates §5.3 dependency direction (`server/services/skillAnalyzerServicePure/**` MUST NOT import from `server/services/skillAnalyzerService/**`).
4. Confirm `grep -n "boss.work" server/index.ts` returns exactly 4 hits (down from 5 before Chunk 13).
5. Confirm `wc -l server/services/skillAnalyzerService*.ts` shows both barrels < 250 LOC.

**Module shape:**
- *Public interface:* unchanged.
- *What stays hidden:* unchanged.

**Error handling:** N/A — verification chunk.

**Test considerations:** None added.

**Dependencies:** ALL prior chunks.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`

**Acceptance criteria:**
- Caller-sweep grep counts match Chunk 0 baseline (16 Pure-file imports, 6 impure-shell imports — unchanged).
- `architecture.md § Key files per domain` updated.
- `tasks/builds/split-skill-analyzer/progress.md` records the closure-text proposal for `tasks/todo.md` items SA1, SA2, SA4, SA6 (e.g. "Mark SA1 `[status:closed:pr:<num>]`" repeated for each) so `finalisation-coordinator` can apply it once the PR number is known.
- The PR description includes the same four closure lines for visibility.
- `tasks/todo.md` is NOT edited in this chunk.
- `npm run typecheck` clean.

---

## Risks & Mitigations

**R1 — The two private helpers `canonicalJSON` / `sortKeys` are referenced from multiple sub-trees.** `evaluateApprovalState` (mergeWarnings/approval), `validateMergeOutput` (validation), and potentially `parseClassificationResponseWithMerge` (classification/parse) all rely on key-order-tolerant deep-equality. Chunk 1 places them in `serialisation.ts` as a Pure leaf module. **Mitigation:** every consumer imports from `../serialisation.js`; the Chunk 1 PR description names every cross-tree consumer so reviewers can verify no consumer was missed.

**R2 — The `skillAnalyzerServicePure` aggregate object's membership might drift during the split.** The aggregate at lines 3699-3727 has 27 keys; the spec table at §4.1 mentions "~70 additional exports beyond line 600". Mixing up named-export count vs aggregate-membership count is a real foot-gun. **Mitigation:** Chunk 0 Sweep 1 locks the aggregate membership at exactly the 27 keys present in source. Chunk 6's barrel assembles those 27 keys verbatim. Any chunk that proposes to drop a member must amend the spec first.

**R3 — `unlockStaleExecution`'s source range (1324-1944) is suspiciously large for one function.** Spec §5.2 lists it as a single function under `execute/unlock.ts`. **Mitigation:** Chunk 10's builder reads the source at execution time, identifies any interleaved helpers (`getJobById`, `updateJobProgress`, `markSkillInFlight`, `unmarkSkillInFlight` may be physically interleaved in that range — their spec §4.2 line ranges 1945-2110 suggest source-file organisation is NOT strictly contiguous), and routes each helper to its named destination per §5.2 (note: `getJobById` lives in Chunk 8's `jobLifecycle/get.ts`; the persistence-tree helpers live in Chunk 11). If the spec's line ranges are wrong, the builder records the actual layout in the PR description and proceeds with the destination map per §5.2. Finding, not blocker.

**R4 — The SA6 raw-db migration order vs SA4 worker fix.** If a builder takes Chunk 14 before Chunk 13, `getOrgScopedDb('skillAnalyzerService.insertResults')` will throw `missing_org_context` on every job execution — Stage 6 (Write) fails immediately. **Mitigation:** the dependency graph names Chunk 13 as a hard prerequisite for Chunk 14. Each chunk's header restates this. Builder G1 doesn't exercise Stage 6; the failure mode surfaces only in CI integration paths if any exercise the queue. Even there it would be caught fast.

**R5 — Pre-existing baseline entries for both source files in `scripts/.gate-baselines/loc-cap.txt` and `any-budget.txt`.** The split is intended to drop the post-build LOC below the cap. If a builder accidentally leaves either file over-cap (e.g. botched barrel shape), the baselines remain valid and CI won't catch the regression. **Mitigation:** Chunks 6 and 12 each have an explicit AC line for barrel LOC target (< 250). The chunk PR description must include `wc -l server/services/skillAnalyzer*.ts` output; reviewers verify both barrels under cap. The baseline entries are REMOVED in Chunks 6 and 12 (whichever lands the file under the cap first).

**R6 — RLS policy verification on the FK column name.** Chunk 0 Sweep 3 confirms `job_id` is the FK column. If a renamed-column migration lands between plan authoring and chunk execution, the policy SQL will reference a non-existent column. **Mitigation:** Chunk 14's PR description must include re-verification of the column name (`grep -n "'job_id'" server/db/schema/skillAnalyzerResults.ts`) at execution time. The check takes 2 seconds.

**R7 — Smoke-test scripts under `scripts/smoke-test-*` are not part of CI.** The 4 impure-shell smoke-test consumers live in `scripts/`. They get build-time typecheck coverage but no runtime exercise. **Mitigation:** Chunk 15 caller-sweep re-runs the import grep to confirm every smoke-test import still resolves. The scripts compile under `npm run typecheck`; that's the contract.

**R8 — Pre-existing spec drift (now patched).** The spec §3 claim of "0 impure-shell callers" was wrong (Chunk 0 Sweep 2 found 6). Patched in-flight during chatgpt-plan-review Round 1: spec §3 line 76 now reads "shows 6 external callers per Chunk 0 sweep result 2" instead of "shows 0 external callers in a naive grep". Spec §10 line 252 left as-is (it correctly says "naive grep returns 0" and instructs the architect to investigate — the architect's investigation is exactly what produced the Chunk 0 sweep). No spec-conformance friction expected.

**R9 — The 4 other `boss.work` calls in `server/index.ts` are tempting drive-bys.** Lines 652, 928, 941, 954 are all the same anti-pattern. **Mitigation:** the operator brief explicitly names them as out of scope. Chunk 13's AC includes "verify 4 untouched". The post-build PR description must NOT mention modifying them. They are queued separately as a future build (Env D / Track A3 follow-up).

---

## Out of scope / deferred

- **SA3 — split `server/jobs/skillAnalyzerJob.ts` (2,254 LOC).** Separate Wave-1 build (Track A3 SA3 backlog). The job handler stays a single file.
- **SA5 — URL-path naming (UK vs US spelling).** Track A3 SA5 backlog.
- **The 4 other `boss.work` calls in `server/index.ts` (lines 652, 928, 941, 954).** Env D will batch-convert with a prevention gate.
- **New unit tests for the splits.** Spec §13 testing posture is `static_gates_primary`; no new Vitest files required for behaviour-preserving moves. Optional one-file invariant tests in Chunks 1, 2, 3, 14 are named in those chunks; builders may add them or skip.
- **`config_update_organisation_config` / `notify_operator` dynamic-import sites in the worker-adapter dispatch.** Pattern-setter §5.3 mentions these; not in scope for skill-analyzer.
- **Drop or rename any spec §4.1 / §4.2 export.** Public-surface lock per §4 forbids it.
- **Migrating `scripts/audit-skill-library-shallowness.ts` from `npx tsx` to Vitest.** This script is not a test file; the existing `import * as skillAnalyzerServicePure` continues to resolve via the post-split barrel.
- **Caller migration to canonical sub-module paths.** The 16 Pure-file callers + 6 impure-shell callers from Chunk 0 remain on the existing barrel paths through this build. Chunk 15's caller-sweep AC requires unchanged grep counts; any caller migration would invalidate those counts. Ships as a separate follow-up build if needed.
- **`tasks/todo.md` closure for SA1, SA2, SA4, SA6.** Owned by `finalisation-coordinator` once the PR number is known. Chunk 15 emits the closure-text proposal in `progress.md` and the PR description; finalisation-coordinator applies it during the merge sequence.

---

## Executor notes

- The pattern-setter (`tasks/builds/feat-split-skillexecutor/spec.md` § 5) governs decomposition conventions. When the present plan and the pattern-setter disagree, the pattern-setter wins.
- The companion (`tasks/builds/feat-split-agentexecutionservice/plan.md`) is the reference for chunk shape and module-shape disclosure; mirror its level of detail.
- Each chunk's PR description must list: (a) the moved source-line ranges, (b) the new file names with their exports, (c) any cross-tree edges introduced, (d) the spec §4.1 / §4.2 surface check (every name on the spec list resolves via the barrel after the chunk).
- The previous draft of this plan grouped the remaining Pure modules into a single oversized "Chunk 4" (9 files) and the impure execute+persistence trees into a single oversized "Chunk 9" (6 files). Both have been formally split: Chunks 4 + 5 carry the Pure remainder (4 files + 5 files), Chunks 10 + 11 carry the impure execute/* and persistence/* trees (3 files + 3 files). No further mid-execution splitting is expected.
- Capability registration: this build refactors `Mature` capabilities; no new capability is registered. `docs/capabilities.md` requires no change.
- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

---
