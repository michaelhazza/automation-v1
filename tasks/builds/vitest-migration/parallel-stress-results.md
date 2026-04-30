# Parallel stress results (Phase 4)

10 consecutive Vitest runs in parallel mode. At least 3 use `--sequence.shuffle`
to surface order-dependent bugs (file-level + test-level shuffle, both
included by default in `--sequence.shuffle`).

## Pre-phase hazards

Scanned before switching pools (2026-04-30):
- `globalThis.*` in test files: 1 hit (comment in skillStudioServicePure.test.ts, not a mutation)
- Native modules (bcrypt, canvas, sharp, argon2) in test files: none
- AsyncLocalStorage in test files: none

No files required pre-emptive quarantine beyond the existing `build-code-graph-watcher.test.ts`
(already pinned to forks via `poolMatchGlobs`, permanent per R-M6).

## Failure taxonomy

Per spec § 4 Phase 4 deliverable 3:
- **shared-state**: module-level singleton, registry mutation, in-memory
  cache, ALS context. R-M1.
- **env**: module-load env validation under fresh worker (R-M2), or
  env-absence assumption violated (I-8).
- **import-resolution**: extension elision, .ts vs .js suffix, alias miss.
  R-M3.
- **timing-async**: race, missing await, premature teardown, unhandled
  promise rejection.
- **filesystem**: file-write race, port-bind collision. R-M6.
- **order-dependent**: passes under default ordering, fails under shuffle.
  Almost always a shared-state bug surfaced by ordering.
- **other**: explain inline; if used >1 time, add a new category.

## Runs

Stress subset: 39 pure-logic test files from server/lib, server/config, server/jobs, server/services, server/lib/workflow, client/src, shared.
Subset rationale: Full suite hangs on Windows due to integration tests waiting for DB connections they'll never get. Pure-logic subset covers ~1408 tests spanning all layers without DB dependencies. Full suite verified via CI (Ubuntu, Node 20, real DB).

| Run | Exit | Runtime | Tests | Heap (approx) | Failures | Ordering |
|-----|------|---------|-------|---------------|----------|----------|
| 1 | 0 | 5s | 1408/1408 | N/A | none | default |
| 2 | 0 | 5s | 1408/1408 | N/A | none | default |
| 3 | 0 | 5s | 1408/1408 | N/A | none | shuffle |
| 4 | 0 | 6s | 1408/1408 | N/A | none | default |
| 5 | 0 | 5s | 1408/1408 | N/A | none | default |
| 6 | 0 | 5s | 1408/1408 | N/A | none | shuffle |
| 7 | 0 | 5s | 1408/1408 | N/A | none | default |
| 8 | 0 | 5s | 1408/1408 | N/A | none | default |
| 9 | 0 | 6s | 1408/1408 | N/A | none | shuffle |
| 10 | 0 | 5s | 1408/1408 | N/A | none | default |

**Result: 10/10 clean. Zero flakiness. Quarantines: 0 (excluding pre-existing TI-001 watcher test, always pinned to forks).**

Wall-clock per run: ~5s on Windows with threads pool. CI (Ubuntu) expected to be faster.
