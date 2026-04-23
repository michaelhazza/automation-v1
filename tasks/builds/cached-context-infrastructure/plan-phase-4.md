# Phase 4 — Bundle resolution + orchestrator

**Spec anchors:** §10 Phase 4 · §5.8 agent_runs additions · §6.3 `bundleResolutionService` · §6.6 `cachedContextOrchestrator` · §7.3 router surface changes · §11.3 concurrency test
**Migrations:** 0209 (`agent_runs` columns)
**Pre-condition:** Phases 1–3 merged. Assembly engine + budget resolver exist as dead code. Bundle service works. `shared/types/cachedContext.ts` complete.

## Purpose

Wire up the orchestrator: `resolveAtRunStart` → `executionBudgetResolver.resolve` → `contextAssemblyEngine.assembleAndValidate` → HITL-on-breach (one-retry) → `llmRouter.routeCall`. Land migration 0209 to extend `agent_runs` with the five new columns. Router gains optional `prefixHash` + `cacheTtl` params but Phase 4 discards `prefixHash` (column lands in Phase 5's migration 0210).

Exit state: a call to `cachedContextOrchestrator.execute(...)` can run end-to-end against a test DB and stubbed adapter. Snapshots persist, `agent_runs.bundle_snapshot_ids` / `variable_input_hash` / `run_outcome` / `soft_warn_tripped` / `degraded_reason` are written correctly. Concurrency test proves snapshot insert idempotency.

## Chunked deliverables

- Chunk 4.1 — Migration 0209 + `agentRuns.ts` schema diff
- Chunk 4.2 — `bundleResolutionServicePure` + stateful service
- Chunk 4.3 — `cachedContextOrchestrator`
- Chunk 4.4 — Router surface extension (`prefixHash` / `cacheTtl` params)
- Chunk 4.5 — Pure tests + concurrency test

### Chunk 4.1 — Migration 0209 + `agentRuns.ts` schema diff

- Create `migrations/0209_agent_runs_cached_context.sql` per §5.8:
  - `ALTER TABLE agent_runs ADD COLUMN bundle_snapshot_ids jsonb;`
  - `ALTER TABLE agent_runs ADD COLUMN variable_input_hash text;`
  - `ALTER TABLE agent_runs ADD COLUMN run_outcome text;`
  - `ALTER TABLE agent_runs ADD COLUMN soft_warn_tripped boolean NOT NULL DEFAULT false;`
  - `ALTER TABLE agent_runs ADD COLUMN degraded_reason text;`
  - `CREATE INDEX agent_runs_run_outcome_idx ON agent_runs (run_outcome) WHERE run_outcome IS NOT NULL;`
  - `CREATE INDEX agent_runs_degraded_reason_idx ON agent_runs (degraded_reason) WHERE degraded_reason IS NOT NULL;`
- Update `server/db/schema/agentRuns.ts` with the five new columns + Drizzle `$type<...>` for `runOutcome` and `degradedReason`.

### Chunk 4.2 — `bundleResolutionServicePure` + stateful service

Create `server/services/bundleResolutionServicePure.ts`:

- `orderDocumentsDeterministically(members: Array<{ documentId, documentVersion, serializedBytesHash, tokenCount, pausedAt, deprecatedAt }>): Array<{...}>` — sorts by `documentId` asc, filters out paused/deprecated/soft-deleted. Returns only `(documentId, documentVersion, serializedBytesHash, tokenCount)`.
- `buildSnapshotRow(input)` — produces `{ orderedDocumentVersions, prefixHash, prefixHashComponents, estimatedPrefixTokens }` without DB-generated `id` + `createdAt`. Uses `contextAssemblyEnginePure.computePrefixHash` for the hash — cross-module pure-layer call.

Create `server/services/bundleResolutionService.ts`:

- `resolveAtRunStart({ organisationId, subaccountId, subjectType, subjectId, modelFamily, assemblyVersion })` → `{ snapshots, totalEstimatedPrefixTokens }`.
- Transaction per §6.3 steps 1–7, with the **mid-resolution consistency invariant** applied: either `REPEATABLE READ` isolation for the read block, or `SELECT ... FOR KEY SHARE` on the target `document_bundles` row before reading members, or version-lock recheck with retry. Pick one and apply it consistently — the concurrency test (Chunk 4.5) exercises whichever was chosen.
- Step 1: read live `document_bundle_attachments` for `(subjectType, subjectId)` where `deleted_at IS NULL`; filter out soft-deleted bundles.
- Step 2: per bundle, read `currentVersion` + live members + each member's current `reference_document_versions` row.
- Step 3: filter paused / deprecated / soft-deleted documents.
- Step 4: assert `tokenCounts[modelFamily]` present for every surviving version row → else `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` (500).
- Step 5: `orderDocumentsDeterministically` via the pure helper.
- Step 6: `buildSnapshotRow` — computes `prefixHash` + `prefixHashComponents` via `contextAssemblyEnginePure.computePrefixHash`.
- Step 7: `INSERT INTO bundle_resolution_snapshots ... ON CONFLICT (bundle_id, prefix_hash) DO NOTHING RETURNING *`. If no row returned, re-select `WHERE (bundle_id, prefix_hash) = (...)`. Up to 3 retries on zero-row re-select (snapshot-isolation edge case) → else `CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST` (500).
- Step 8: sum `estimatedPrefixTokens` across all snapshots.
- Raise `CACHED_CONTEXT_NO_BUNDLES_ATTACHED` (409) if zero attached bundles after Step 1 filtering.
- `getSnapshot(snapshotId)` — straightforward read.
- No writes to live tables. Only writes to `bundle_resolution_snapshots`.

### Chunk 4.3 — `cachedContextOrchestrator`

Create `server/services/cachedContextOrchestrator.ts` per §6.6. No Pure sibling (pure orchestration).

- `execute({ organisationId, subaccountId, subjectType, subjectId, runId, variableInput, instructions, modelFamily, taskConfig, ttl }) → CachedContextOrchestratorResult` (discriminated union).
- Flow per §6.6 steps 1–9:
  1. `executionBudgetResolver.resolve`.
  2. `bundleResolutionService.resolveAtRunStart`.
  3. `contextAssemblyEngine.assembleAndValidate`.
  4. If `{ kind: 'budget_breach' }` → `actionService.proposeAction({ actionType: 'cached_context_budget_breach', gateLevel: 'block', payloadJson: blockPayload })`. Wait on `hitlService`. On approval → **re-run steps 1–3 exactly once from scratch** — fresh budget resolve, fresh snapshot resolve (may reuse existing snapshot rows via dedup), fresh assembly. Retry breach classification is independent of the original `thresholdBreached` dimension. If second assembly also breaches → terminate `failed` with `failureReason='hitl_second_breach'`. No third attempt, no second HITL block. Rejection → `hitl_rejected`. Timeout → `hitl_timeout`.
  5. Pre-call write: update `agent_runs` with `bundle_snapshot_ids`, `variable_input_hash`, `soft_warn_tripped`. `run_outcome` stays NULL.
  6. `llmRouter.routeCall({ payload: routerPayload, estimatedContextTokens, prefixHash: assembledPrefixHash, featureTag: 'cached-context', maxTokens: resolvedBudget.maxOutputTokens, cacheTtl: ttl ?? '1h', ... })`. In Phase 4 the router accepts both params but discards `prefixHash` (column lands in 0210).
  7. Parse `response.usage`: `cachedPromptTokens = cache_read_input_tokens`; `cacheCreationTokens = cache_creation_input_tokens` (stored server-side but not yet persisted — Phase 5). Determine `hitType` from ratios.
  8. Run-outcome classification per §4.6 precedence: `soft_warn > token_drift > cache_miss > completed`.
  9. Terminal `UPDATE agent_runs SET run_outcome = :outcome, degraded_reason = :reason, bundle_snapshot_ids = COALESCE(..., :snapshotIds), variable_input_hash = COALESCE(..., :hash), soft_warn_tripped = :warn WHERE id = :runId AND run_outcome IS NULL`. Optimistic lock on `run_outcome IS NULL`.
- Failure path also runs the same terminal UPDATE with `:outcome = 'failed'`, `:reason = NULL`, and `:snapshotIds` + `:hash` populated only when known (post-§6.3 + post-§6.4 success respectively).
- Error → `failureReason` mapping table per §6.6 (copy verbatim into the orchestrator's try/catch so every thrown `CACHED_CONTEXT_*` maps to an explicit `failureReason`).

### Chunk 4.4 — Router surface extension

- Modify `server/services/llmRouter.ts`:
  - Add optional params to `routeCall`: `prefixHash?: string`, `cacheTtl?: '5m' | '1h'`.
  - Pass `cacheTtl` through to `anthropicAdapter` (the adapter already accepts `cache_control: { type: 'ephemeral', ttl: '1h' }` via its existing shape).
  - **Discard `prefixHash` in Phase 4** — column `llm_requests.prefix_hash` does not exist until 0210. TODO comment anchoring the Phase 5 switchover. No error if caller passes it; just silent drop.
- No changes to idempotency, attribution, provider fallback, or cost-breaker integration.

### Chunk 4.5 — Pure tests + concurrency test

Create `server/services/__tests__/bundleResolutionServicePure.test.ts` per §11.1:

- `orderDocumentsDeterministically` sorts by `documentId` asc stably; carries `serializedBytesHash` verbatim; filters paused / deprecated / soft-deleted.
- `buildSnapshotRow` produces a `prefixHash` that matches `contextAssemblyEnginePure.computePrefixHash(components)` on the same components — cross-module consistency.

Create `server/services/__tests__/bundleResolutionService.concurrency.test.ts` per §11.3 (declared carve-out):

- tsx script against a test Postgres.
- Seed: org, subaccount, 3 docs, 1 bundle, 1 attachment.
- Start two concurrent `resolveAtRunStart` calls with identical inputs (Promise.all on the service method, or two tsx sub-processes).
- Assert: exactly one row in `bundle_resolution_snapshots` for `(bundle_id, prefix_hash)`; both calls return the same snapshot row (same `id`).
- Validates `UNIQUE(bundle_id, prefix_hash)` + `ON CONFLICT DO NOTHING` + re-select under race.

## Acceptance (Phase 4 complete)

- [ ] Migration 0209 applies cleanly.
- [ ] `npm run db:generate` produces no diff after `agentRuns.ts` changes.
- [ ] `bundleResolutionServicePure.test.ts` passes.
- [ ] `bundleResolutionService.concurrency.test.ts` passes (two concurrent resolutions produce exactly one row).
- [ ] `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` pass (no new bypasses).
- [ ] Manual smoke: invoke `cachedContextOrchestrator.execute` against a test task with one attached bundle + stubbed `anthropicAdapter.call`; assert snapshot row created, `agent_runs` updated with all five new columns, router called with `prefixHash` + `cacheTtl` (discarded at write). Budget-breach path creates `actions` row with `gateLevel='block'` and the structured payload. Approve the block → orchestrator re-resolves + retries once → second breach terminates with `failureReason='hitl_second_breach'`.
- [ ] `npm run typecheck` + `npm run lint` green.
- [ ] `spec-conformance` Phase 4 subset clean. `pr-reviewer` clean.

## Out of scope for Phase 4

- `llm_requests` column additions (Phase 5 migration 0210).
- Cache attribution write-through on `prefix_hash` + `cache_creation_tokens` (Phase 5).
- HITL action registry entry (Phase 5).
- End-to-end integration test asserting ledger columns (Phase 5 — it needs 0210 to land first).
- `bundleUtilizationJob` schedule enablement (Phase 6).
