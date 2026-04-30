# Vitest Migration — Session Progress

Current phase: Phase 6 complete. PR #238 open — awaiting CI green.

Spec: docs/test-migration-spec.md
Plan: docs/superpowers/plans/2026-04-29-vitest-migration.md

## Environment

Node: v22.14.0 (local — CI uses Node 20 per .github/workflows/ci.yml; unit tests are Node-version-agnostic)
npm: 10.9.2
Platform: Windows 11 (local); Ubuntu (CI)
Phase 0 baseline commit SHA: 883b1c4b8fc217284b51361b5029ef151eb7b515

## Decisions log

- 2026-04-29: Local Node is v22.14.0 vs CI's Node 20. Unit tests are pure logic with
  no Node-version-specific APIs, so the local snapshot is valid as an I-3 oracle.
  Discrepancy noted for traceability.
- 2026-04-29: Phase 0 baseline captured. Bash runner: 278/278 passing.
  Outliers: 2 (parseContextSwitchCommand.test.ts, scopeResolutionService.test.ts).
  JSON snapshot: 277 entries (275 pass + 2 not-discovered). Proceeding to Phase 1.
- 2026-04-29: Walker fix — plan's original EXCLUDED_DIRS used name-based matching
  which also excluded server/tools/ (3 files). Fixed to path-prefix exclusion for
  tools/mission-control/** only. Correct count: 277 (275 + 2 outliers).

## Session handoff notes

Phase 3 batch 0 done (10 files). 22 batches remaining.
Converters: scripts/convert-node-test-batch.mjs (Phase 2), scripts/convert-handwritten-harness.mjs (Phase 3).
Key learnings:
- resolvePulseDetailUrl: module-level spy needs beforeEach/afterAll
- Files with top-level blocks (no function test harness): wrapped in test('assertions', () => {...})
- node:assert imports (not /strict): handled by hasNodeAssertImport flag
- if(failed>0){} without process.exit: left by boilerplate removal, needs manual cleanup
- 2026-04-30: Phase 4 complete. 10 consecutive clean runs in parallel threads mode (3 shuffle, 7 default). maxThreads=cores-1. Quarantines added: none. Env vars added: SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS, SYSTEM_INCIDENT_THROTTLE_MS.
- 2026-04-30: Phase 5 cutover: bash runner deleted, test:unit → vitest run, CI timeout 45→15min, vitest-pre-cutover tag pushed. PR #238 open.
- 2026-04-30: Phase 6 complete: testing-conventions.md updated, .nvmrc added.
- 2026-04-30 (late): post-PR triage — review feedback identified two orphan
  `*.test.ts` files in `shared/types/` and `shared/billing/` that lived
  outside `__tests__/` and were silently not picked up by Vitest's include
  globs (same failure class as 4d0cef9f canonicalAdapterContract). Both
  files migrated to vitest format (`expect` style, per
  testing-conventions.md) and relocated under `__tests__/`. Discovery guard
  (TI-002) queued for after the two remaining outlier files move per
  Phase 6 plan.
- 2026-04-30 (later): first CI run on PR #238 hit the 15-min timeout. Root
  cause: five test files were left half-migrated by Phase 2/3 conversion
  scripts — they kept handwritten-harness helpers (`asyncTest`,
  `pendingTests`, `passed++`/`failed++` counters, `await Promise.all(
  pendingTests)`). The unresolved promises and ReferenceError-throwing
  resolver path caused vitest workers to hang post-test for 13+ minutes
  before being SIGKILLed. Fixed:
    - `server/services/systemMonitor/heuristics/__tests__/heuristicsPure.test.ts`
      (47 asyncTest calls + dangling Promise.all + pendingTests array)
    - `server/services/systemMonitor/heuristics/__tests__/heuristics25Pure.test.ts`
      (entire file wrapped in a single `test('assertions')` with internal
      asyncTest helper; unwrapped into 21 top-level test() blocks)
    - `server/lib/__tests__/llmStub.test.ts` (tests defined inside an
      `async function main()` that ran via `main().catch(...)` — moved to
      top level and converted)
    - `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`
      (custom `test()` function shadowing vitest's; replaced with
      `test.skipIf(SKIP)`)
    - Two orphan-pattern files in `server/services/workspace/__tests__/`
      with no test() blocks at all — converted to proper vitest tests.
  Local result post-fix: 4555 tests pass, 33 skipped, 40s wall clock (was
  hanging at 15+ min). Net +115 tests vs pre-fix because the previously
  hidden asyncTest assertions now actually run.
- New follow-up TI-003: gate against handwritten-harness leftovers
  (asyncTest, pendingTests, passed++, etc.).
- CI unit-layer runtime baseline: pending CI run on PR #238.
