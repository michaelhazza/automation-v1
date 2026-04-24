# Testing, risks, and rollout

**Spec anchors:** §11 Testing plan · §12 Deferred items · §14 Risks & mitigations · §15 Open questions · §16 Success criteria

Companion document to the per-phase plan files. Read this before kicking off execution — it is the cross-cutting rulebook.

## Testing posture (locked)

Per `docs/spec-context.md`:

- `testing_posture: static_gates_primary`
- `runtime_tests: pure_function_only`
- `frontend_tests: none_for_now`
- `api_contract_tests: none_for_now`
- `e2e_tests_of_own_app: none_for_now`

Do not introduce vitest, jest, supertest, or playwright at any layer. tsx + the existing static-gate convention is the only runtime-test runner.

## Pure unit tests (primary test surface)

Per §11.1. One test file per `*Pure.ts` module:

| Module | Test file | Phase |
|---|---|---|
| `referenceDocumentServicePure` | `server/services/__tests__/referenceDocumentServicePure.test.ts` | 1 |
| `documentBundleServicePure` | `server/services/__tests__/documentBundleServicePure.test.ts` | 2 (+ Phase 3 cross-module append) |
| `contextAssemblyEnginePure` | `server/services/__tests__/contextAssemblyEnginePure.test.ts` | 3 |
| `executionBudgetResolverPure` | `server/services/__tests__/executionBudgetResolverPure.test.ts` | 3 |
| `bundleResolutionServicePure` | `server/services/__tests__/bundleResolutionServicePure.test.ts` | 4 |

**Golden-fixture coverage (R1/R8 mitigation):** `contextAssemblyEnginePure.test.ts` is three-layered per §11.1:

1. `computePrefixHash(GOLDEN_COMPONENTS_BUNDLE_{A,B}) === GOLDEN_PER_BUNDLE_HASH_{A,B}`.
2. `assemblePrefix(GOLDEN_SNAPSHOTS, GOLDEN_VERSION_ROWS) === GOLDEN_ASSEMBLED_PREFIX_BYTES` (full bytes).
3. `computeAssembledPrefixHash(...) === GOLDEN_CALL_LEVEL_HASH`.

Any serialization / separator / ordering / hash-input change must regenerate the matching fixture AND bump `ASSEMBLY_VERSION`. A PR that does either without the other fails the test.

## Declared integration + concurrency carve-outs (§11.5)

Two files only. Documented in `plan-phase-4.md` and `plan-phase-5.md`.

| File | Phase | Justification |
|---|---|---|
| `server/services/__tests__/cachedContextOrchestrator.integration.test.ts` | 5 | Convergence point for four subsystems (budget resolver, bundle resolution, assembly engine, router cache-attribution). Stubbing all four seams verifies the stubs, not the contract. One file, stubs only `anthropicAdapter.call`. |
| `server/services/__tests__/bundleResolutionService.concurrency.test.ts` | 4 | Snapshot-insert idempotency + `UNIQUE(bundle_id, prefix_hash)` + `ON CONFLICT DO NOTHING` + re-select pattern cannot be expressed as a pure test — the guarantee is specifically about real transactions racing on a real DB. |

No additional integration tests. No API contract tests. No frontend / E2E.

## Static gates (Phase-by-phase invocations)

| Gate | Enforces | When to run |
|---|---|---|
| `scripts/gates/verify-rls-coverage.sh` | Every new tenant-scoped table in §5 appears in `rlsProtectedTables.ts` | After each migration in Phase 1 + Phase 2 |
| `scripts/gates/verify-rls-contract-compliance.sh` | No direct-DB bypass in services; `bundleUtilizationJob` on the allow-list with inline justification | After Phase 2 Chunk 2.7 + every subsequent phase that adds service code |
| `npm run typecheck` | TypeScript compiles | After every chunk |
| `npm run lint` | Lint clean | After every chunk |
| `npm run db:generate` | No drift between migrations and Drizzle schema | After each migration chunk (1.1–1.7, 2.1, 4.1, 5.1) |

All gates must be green before phase PRs.

## Review-loop protocol (per CLAUDE.md)

After every phase claims completion:

1. `spec-conformance: verify phase N of docs/cached-context-infrastructure-spec.md`. Auto-fixes mechanical gaps; routes directional gaps to `tasks/todo.md` under a dated section `## Deferred from spec-conformance review — cached-context-infrastructure`. If it applied any mechanical fixes, re-run `pr-reviewer` on the expanded change set. Triage per the CLAUDE.md "Processing `spec-conformance` NON_CONFORMANT findings — standalone contract" rule.
2. `pr-reviewer`. Persist the fenced `pr-review-log` block to `tasks/review-logs/pr-review-log-cached-context-infrastructure-phase-<N>-<timestamp>.md`. Process blocking non-architectural findings in-session; route architectural ones to `tasks/todo.md` under `## PR Review deferred items / ### cached-context-infrastructure`.
3. `dual-reviewer` — **only if the user explicitly asks and the session is local**. Never auto-invoke.
4. Chatgpt review — optional, runs in a dedicated new Claude Code session per CLAUDE.md.

## Risks (§14) — condensed

| # | Risk | Primary mitigation | Phase that lands the mitigation |
|---|---|---|---|
| R1 | Assembly logic drifts without `ASSEMBLY_VERSION` bump | 3-layer golden fixture in `contextAssemblyEnginePure.test.ts` | 3 |
| R2 | Orphaned `document_bundle_attachments` after subject deletion | Service-layer subject existence check + soft-delete pattern; GC deferred | 2 |
| R3 | `bundle_resolution_snapshots` grows unbounded | `UNIQUE(bundle_id, prefix_hash)` per-bundle dedup; retention tiering deferred (§12.2) | 1 (unique index) |
| R4 | Model tokeniser changes invalidate stored `tokenCounts` | Strict fail + new-family backfill runbook (§12.14) | 1 (fail path); runbook via §12.14 |
| R5 | HITL suspend window elapses before approval | Existing `hitlService` timeout path produces `run_outcome='failed'` | 5 (action registry) |
| R6 | Concurrent bundle edits vs in-flight runs | Snapshot-at-run-start + mid-resolution consistency invariant | 4 |
| R7 | `prefix_hash` collision | SHA-256 cryptographically safe; integrity check fails fast; no fallback logic | 4 (integrity check in engine) |
| R8 | `ASSEMBLY_VERSION = 1` forever | Three-layer golden fixture is the only gate | 3 |
| R9 | Router contract drift — other callers accidentally passing `prefixHash` | Code review; only `cachedContextOrchestrator` passes; future optional assertion on `featureTag` | 4 (surface); 5 (write-through) |
| R10 | `run_outcome` enum drift | Text column (not Postgres ENUM); dashboards bucket unknown values | 4 |
| R11 | Unbounded unnamed bundle growth | Watch during pilot; follow-up spec required before GA per §12.16 | Watch in 6; follow-up spec |

## Rollout model

Per `docs/spec-context.md` `rollout_model: commit_and_revert`:

- No staged rollouts.
- No feature flags beyond behaviour modes (none needed for this spec — nothing is user-toggleable).
- Pilot task (§10 Phase 6) is switched by direct config edit; regression is handled by reverting the commit.
- Phase 1–5 PRs merge in sequence. Phase 6 documentation updates land in the pilot PR per CLAUDE.md rule 11.

## Per-phase classification under CLAUDE.md

| Phase | Classification | Rationale |
|---|---|---|
| 1 | **Significant** | Multiple domains (schema × 7, service, routes, RLS). Architect was invoked for planning (this document). `pr-reviewer` mandatory before PR. |
| 2 | **Significant** | Multi-file service + multi-route + UX-heavy contract. |
| 3 | **Significant** | Golden-fixture tests are load-bearing; hash identity contract. |
| 4 | **Significant** | Orchestrator composes four subsystems; concurrency test required. |
| 5 | **Significant** | Ledger column additions affect billing-adjacent surface. |
| 6 | **Standard** | Configuration + observability + 7-day monitoring; minimal code change. |

None qualify as Major in isolation; the overall spec is Major per CLAUDE.md (this file is the architect's output for the whole spec). `dual-reviewer` is optional per phase and only when the user explicitly asks.

## Deferred items (§12)

Do NOT implement during the six phases. Watch during pilot for signals that any of these need acceleration:

- §12.1 External connectors, §12.2 snapshot retention, §12.3 batch API, §12.4 multi-breakpoint cache, §12.5 estimator calibration, §12.6 access-without-always-load, §12.7 retry for degraded, §12.8 graceful no-bundles fallback, §12.9 auto-summarisation, §12.10 cross-tenant bundles, §12.11 parallel fan-out, §12.12 observability UI, §12.13 admin policy editing, §12.14 new-family backfill, §12.15 resolver-narrowed TTL, §12.16 unnamed bundle lifecycle.

§12.16 is the one watch-closely item — unnamed bundle growth during the pilot.

## Success criteria (§16) — equals Phase 6 acceptance

See `plan-phase-6.md` Acceptance section. All 9 items must be green for GA promotion.

## Plan maintenance

- Update `tasks/current-focus.md` when the active phase changes.
- Write per-session progress to `tasks/builds/cached-context-infrastructure/progress.md` (create on first session).
- Review logs under `tasks/review-logs/` (pr-review-log, spec-conformance-log, etc.) — naming per CLAUDE.md canonical convention.
- Deferred items land in `tasks/todo.md` under the dated sections the review agents create.
