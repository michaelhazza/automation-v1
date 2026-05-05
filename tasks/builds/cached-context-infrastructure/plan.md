# Cached Context Infrastructure — Implementation Plan

**Slug:** cached-context-infrastructure
**Spec:** `docs/cached-context-infrastructure-spec.md`
**Branch:** `claude/implementation-plan-Y622C`
**Classification:** Major
**Date:** 2026-04-23
**Plan shape:** overview in this file + per-phase detail in sibling `plan-phase-{1..6}.md` + `plan-testing-and-rollout.md`. See Chunking note below.

---

## Mental model

`Documents → (implicit bundle) → Snapshot → Assembly → Router → Ledger.`

Reference documents are user-curated artefacts attached to an agent (or subaccount or org). At attachment time they form an implicit bundle whose identity is derived deterministically from the ordered set of `(referenceDocumentVersionId, includedFlag)` pairs. At run time, the bundle resolver takes an immutable snapshot of the bundle (copy-on-resolve — bundle rows may change after, snapshot rows never do), the assembly engine packs the snapshot plus the execution budget into a stable, cache-friendly prefix, the LLM router sends the prefix with `cache_control` markers, and the ledger records per-request cache hits, misses, creations, plus the `prefix_hash` that links a request back to the assembly that produced it. HITL acts as the fallback when budget breaches would otherwise silently truncate context.

## How to read this plan

This plan mirrors the spec's §10 six-phase structure. Each phase is a standalone commit series that is individually mergeable to main in the order given — Phase 1 does not depend on Phase 2 merging first, but Phase 2 depends on Phase 1 being in place, and so on. Later phases never reach backward into earlier phases to mutate their contracts; any change that would require touching a prior phase's migration, service surface, or public route shape means the prior phase's spec was wrong and needs to be revisited, not patched.

Execution expectation is `superpowers:subagent-driven-development` — each phase's chunks are further decomposed into sub-agent units (service, Pure helper, routes, migrations) that one sub-agent can complete independently. The plan deliberately does not prescribe sub-agent boundaries inside a phase; the executing session makes that call based on how it wants to parallelise.

Phase gates: `spec-conformance` runs after every phase claims completion (before `pr-reviewer`), `pr-reviewer` before any PR is opened, `dual-reviewer` optional per CLAUDE.md and only when the user explicitly asks.

## Phase table-of-contents

| # | Title | Migrations | Spec anchor | Detail file |
|---|---|---|---|---|
| 1 | Data model foundations | 0202–0208 | §10 Phase 1; §5.1–§5.7, §5.11; §6.1; §7.1 | `plan-phase-1.md` |
| 2 | Bundles + attachment + suggestion | 0212 | §10 Phase 2; §5.3–§5.5, §5.12; §6.2; §7.2 | `plan-phase-2.md` |
| 3 | Budget resolver + assembly engine (pure) | none | §10 Phase 3; §4.1–§4.4; §6.4–§6.5 | `plan-phase-3.md` |
| 4 | Bundle resolution + orchestrator | 0209 | §10 Phase 4; §5.8; §6.3; §6.6 | `plan-phase-4.md` |
| 5 | Ledger attribution + HITL block path | 0210 | §10 Phase 5; §4.5; §5.9; §6.6 (router write-through) | `plan-phase-5.md` |
| 6 | Pilot validation | none | §10 Phase 6; §16 success criteria | `plan-phase-6.md` |

Testing plan, risks, success criteria: `plan-testing-and-rollout.md`.

## Cross-cutting invariants

Every phase must respect these. Tagged with spec section or risk ID.

1. **Prefix-hash identity is content-based and stable.** Per-bundle `prefix_hash` hashes `{orderedDocumentIds, documentSerializedBytesHashes, includedFlags, modelFamily, assemblyVersion}`. Call-level `assembledPrefixHash` hashes the per-bundle hashes in `bundleId`-asc order + `modelFamily` + `assemblyVersion`. [§4.4]
2. **`ASSEMBLY_VERSION` must be bumped when serialization, separators, sort order, or hash inputs change.** Golden-fixture tests fail the build otherwise. [§4.4, §11.1, R1/R8]
3. **Snapshot rows are immutable.** No UPDATE, no soft-delete, no retention sweep in v1. [§5.6, §12.2]
4. **Version rows are immutable.** `reference_document_versions` rows are never updated or deleted; new content creates a new version. [§5.2]
5. **Snapshot↔version-row FK is structural.** Every `(documentId, documentVersion)` pair in a snapshot resolves to an existing version row for the snapshot's lifetime. [§5.2 named invariant]
6. **Bundle resolution is version-locked under `REPEATABLE READ` or `SELECT FOR KEY SHARE`.** Reading `bundle.currentVersion` and reading members must observe one point-in-time bundle state. [§6.3]
7. **Snapshot-insert is idempotent under concurrency.** `UNIQUE(bundle_id, prefix_hash)` + `ON CONFLICT DO NOTHING` + re-select; N parallel resolutions converge to one row. [§6.3 named invariant]
8. **Cross-tenant hash identity is permitted.** Two tenants sending identical document bytes share the provider's cache entry; no tenant-salting. [§4.4]
9. **Hash collisions are NOT handled at runtime.** A mismatch between recorded `prefix_hash` and re-computed hash is a fatal `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION` — never a probabilistic collision fallback. [§4.4, §6.4 fail-fast, R7]
10. **HITL retry is exactly once and re-resolves from scratch.** After operator approval the orchestrator re-runs budget resolve + snapshot resolve + assembly against current state. Retry breach classification is independent of the original breach dimension. [§6.6 step 4]
11. **Single-attachment-per-parent is idempotent.** `attach` on a live `(bundle, subject)` returns the existing row, not an error. Re-attaching after soft-delete inserts a fresh row. [§6.2, §5.5]
12. **`degraded_reason` precedence is `soft_warn > token_drift > cache_miss`.** Computed once at terminal write; internal-only, never surfaced in UI. [§4.6]
13. **Unnamed bundle identity is a pure function of `(org, subaccount, documentIds)`.** Never depends on subject type, user role, upload vs picker path, or model family. [§6.2 invariant #6]
14. **Named-bundle promotion preserves `id`, members, and per-snapshot `prefix_hash` values.** Flips `is_auto_created` and sets `name`; everything else untouched. Attachments survive. [§6.2 invariant #7]
15. **`suggestBundle` is deterministic and indexed-only.** Pure function over queried state; three-query composition via indexed lookups; p95 < 20ms. [§6.2 invariants #8, #9]
16. **No silent fallback.** The orchestrator never auto-truncates, auto-drops, or auto-downgrades. Assembly either succeeds, blocks at HITL, or terminates `failed`. [§6.6]
17. **Document rename does not affect prefix-hash identity.** `name` is metadata only; never an input to any hash. [§5.1]
18. **Token counts are computed once at version-write time, not at assembly time.** `tokenCounts` is source of truth; assembly reads, never recomputes. [§5.2]
19. **No RLS bypass on the request path.** `withAdminConnection` is forbidden for every service, route, and orchestrator. Only `bundleUtilizationJob` is allow-listed. [§8.6]
20. **Terminal `agent_runs.run_outcome` UPDATE uses `WHERE run_outcome IS NULL` optimistic lock.** Duplicate terminal writes update 0 rows and are treated as idempotent no-ops. [§6.6 step 9, §9.3]

## Primitive reuse

| Primitive | Extended / reused how | Spec ref |
|---|---|---|
| `llmRouter.routeCall` | Gains two optional params (`prefixHash`, `cacheTtl`) in Phase 4. No other surface change. Phase 5 wires write-through to `llm_requests.prefix_hash` + `cache_creation_tokens`. | §2.1, §6.6, §7.3 |
| `anthropicAdapter` | Already sets `cache_control: ephemeral` on the system stablePrefix and reads cache_read / cache_creation tokens. No logic changes — Phase 1 adds one `countTokens` helper; Phase 5 persists `cache_creation_input_tokens` onto the ledger. | §Related artefacts, §2.1, §6.1 |
| `hitlService` + `actions` | Consumed verbatim. New `actionType='cached_context_budget_breach'` registered in `actionRegistry`; `gateLevel='block'` uses existing suspend/approve/reject flow. | §4.5, §6.6 step 4 |
| `llm_requests` ledger | Append-only; Phase 5 migration 0210 adds `cache_creation_tokens` (integer, default 0) + `prefix_hash` (text, nullable). `cachedPromptTokens` already exists. | §2.1, §5.9 |
| `agent_runs` | Extended in Phase 4 migration 0209 with 4 new columns (`bundle_snapshot_ids`, `variable_input_hash`, `run_outcome`, `soft_warn_tripped`) + `degraded_reason` from the round-3 review. | §5.8, §4.6 |
| `scheduled_tasks` | Optional `scheduled_tasks` schema addition is deferred; attachments flow via `document_bundle_attachments` with `subject_type='scheduled_task'`. Migration slot 0211 is skipped entirely. | §5.10 |
| `runCostBreaker` | No changes. Composes with `executionBudgetResolver`: assembly-time validates request shape (pre-flight); `runCostBreaker` handles mid-flight cost variance. Do not duplicate enforcement. | §2.1, §6.5 |
| `memory_blocks` (sibling, NOT extended) | Explicitly NOT extended — documents are user-curated reference material; memory blocks are engine-learned facts. Universal Brief's injection path remains unchanged. | §3.3 |
| `withPrincipalContext` | Bound by the run harness (`agentExecutionService`) before the orchestrator runs. All snapshot reads + writes flow through it. | §8.4 |
| `rlsProtectedTables.ts` manifest | Phase 1 adds 7 entries; Phase 2 adds `bundle_suggestion_dismissals`. CI gate `verify-rls-coverage.sh` enforces. | §8.2, §13.10 |

## Phase sequencing rules

- **Linear phase order:** 1 → 2 → 3 → 4 → 5 → 6. No skipping.
- **Migrations land per phase.** 0202–0208 in Phase 1; 0212 in Phase 2 (note the gap — intentional, 0209 is Phase 4); 0209 in Phase 4; 0210 in Phase 5. Slot 0211 is intentionally skipped (§5.10 decision).
- **Phase 3 ships pure logic as dead code.** `executionBudgetResolver` and `contextAssemblyEngine` exist but no caller invokes them until Phase 4's orchestrator wires them up. Acceptable because the golden-fixture tests exercise them standalone.
- **Router surface change is split across phases 4 + 5.** Phase 4 adds optional `prefixHash` / `cacheTtl` params to `llmRouter.routeCall` — the params are accepted but `prefixHash` is discarded (column lands in 0210). Phase 5's migration 0210 enables write-through to `llm_requests.prefix_hash` + `cache_creation_tokens` with no further code change to callers — the orchestrator is already passing the values.
- **Types file (`shared/types/cachedContext.ts`) lands in Phase 3** — the first phase that needs the shared types. `BundleSuggestion` + `BundleSuggestionDismissal` types are appended in Phase 2 (required by §6.2 before the types file formally lands, so Phase 2 creates the file stubbed and Phase 3 fills in the remaining exports, per §13.9).
- **Per-phase review gates:** after each phase claims completion, run `spec-conformance` → `pr-reviewer` in that order. `spec-conformance` auto-fixes mechanical gaps and routes directional gaps to `tasks/todo.md` under `## Deferred from spec-conformance review — cached-context-infrastructure`. If `spec-conformance` applied any mechanical fixes, re-run `pr-reviewer` on the expanded change set.
- **`dual-reviewer` is optional and user-triggered only.** Do not auto-invoke (local-only, explicit ask per CLAUDE.md).
- **Docs sync in the Phase 6 PR.** `architecture.md` (Key files per domain entry) + `docs/capabilities.md` (File-attached recurring tasks under the relevant category) updated in the same commit as the pilot-validation completion.
- **Permission seeding per migration.** Phase 1 migration 0202 seeds `reference_documents.*` permission keys; Phase 2 migration 0204/0212 seeds `document_bundles.*`. `server/config/permissions.ts` gains all six keys across the two phases.
- **Testing posture honoured strictly.** `static_gates_primary` + `runtime_tests: pure_function_only` plus the two declared carve-outs in §11.5 — one integration test (`cachedContextOrchestrator.integration.test.ts` in Phase 5) and one concurrency test (`bundleResolutionService.concurrency.test.ts` in Phase 4). No supertest, no vitest, no jest, no playwright.
- **Rollout model `commit_and_revert`.** No feature flags beyond the existing behaviour-mode pattern. If the pilot regresses, revert the phase commit; no runtime toggle.

## Top risks to watch during execution

- **R1/R8 — `ASSEMBLY_VERSION` drift.** A change to `serializeDocument`, separators, sort order, `computePrefixHash`, or `computeAssembledPrefixHash` without a matching fixture regeneration silently invalidates caches and corrupts diagnosis. Mitigation: three-layered golden fixture in `contextAssemblyEnginePure.test.ts` (Phase 3); any PR touching those functions must update the fixture and bump `ASSEMBLY_VERSION` together.
- **R7 — prefix-hash collision.** SHA-256 collisions are cryptographically negligible; collision-handling fallback logic is explicitly REJECTED. Any reviewer proposal to add "if hashes match but bytes differ" branching must be turned down. Integrity check in `contextAssemblyEngine` fails fast on mismatch as `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION`.
- **R9 — router contract extension drift.** Only `cachedContextOrchestrator` should pass `prefixHash` / `cacheTtl`. A future caller passing these accidentally writes to `llm_requests.prefix_hash`. Mitigation: code review. Optional future guard: one-line check at the router callsite validating the `featureTag` matches.
- **R11 — unbounded unnamed bundle growth.** `findOrCreateUnnamedBundle` creates a new unnamed bundle for every previously-unseen doc set. A power user iterating on doc selections can create tens of unnamed bundles in a session. v1 ships no GC policy, but the system MUST support future lifecycle management (§12.16). Watch during pilot; if volumes bloat, trigger the follow-up spec before general availability.
- **R2 — orphan attachments.** `document_bundle_attachments.subject_id` is polymorphic with no DB-level FK. Deleting an agent/task/scheduled-task leaves orphan attachment rows. v1 relies on soft-delete on target tables; a future sweep job handles cleanup. Watch during pilot.
- **R6 — concurrent bundle edits vs in-flight runs.** Resolved by snapshot-at-run-start (§4.3, §6.3). The `REPEATABLE READ` / `SELECT FOR KEY SHARE` rule inside `resolveAtRunStart` is load-bearing; the concurrency test in Phase 4 exercises it.

## Chunking note

This plan was built in the main session after the `architect` agent hit repeated stream-idle timeouts on the 2700-line spec (two attempts, 119 s and 300 s respectively before timing out mid-document). The content is derived directly from the spec's §10 phased-implementation breakdown plus §3.6 UX contract, §4 contracts, §5 schema, §6 services, §7 routes, §8 permissions, §9 execution model, §11 testing, §12 deferred, §13 file inventory, §14 risks, §15 open questions, §16 success criteria.

Plan shape is one overview file (this file) + six phase-detail files (`plan-phase-1.md` through `plan-phase-6.md`) + one testing/rollout file (`plan-testing-and-rollout.md`). This avoids the 10,000-character Write threshold that would otherwise trip the long-doc-guard hook on a monolithic plan and keeps each file focused on one decision surface.

Each phase file is self-contained: it lists the migrations, services, routes, tests, acceptance criteria, and exit conditions for that phase alone, with spec-section cross-references. The executing session can read one phase file and have enough context to start work without re-reading the overview.
