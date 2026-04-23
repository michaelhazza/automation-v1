# Phase 3 — Budget resolver + assembly engine (pure)

**Spec anchors:** §10 Phase 3 · §4.1–§4.4 contracts · §6.4 `contextAssemblyEngine` · §6.5 `executionBudgetResolver` · §11.1 golden-fixture tests
**Migrations:** none
**Pre-condition:** Phase 1 + Phase 2 merged. `model_tier_budget_policies` seed rows exist. `shared/types/cachedContext.ts` stubbed from Phase 2.

## Purpose

Ship the pure-logic core — the execution budget resolver and the context assembly engine — as dead code. No orchestrator wires them up yet; Phase 4 does that. Phase 3's value is in the golden-fixture tests that lock `ASSEMBLY_VERSION=1` and the three hash layers (per-bundle `computePrefixHash`, `assemblePrefix` bytes, call-level `computeAssembledPrefixHash`) before any caller depends on them.

Exit state: `shared/types/cachedContext.ts` is complete; two Pure modules + their stateful wrappers exist; one three-layered golden-fixture test + one budget-math test pass. No runtime behaviour changed from Phase 2.

## Chunked deliverables

- Chunk 3.1 — Complete `shared/types/cachedContext.ts`
- Chunk 3.2 — `executionBudgetResolverPure` + stateful wrapper
- Chunk 3.3 — `contextAssemblyEnginePure` + stateful wrapper (serialization contract)
- Chunk 3.4 — Golden-fixture + budget-math tests
- Chunk 3.5 — Cross-module doc-set-hash consistency check

### Chunk 3.1 — Complete `shared/types/cachedContext.ts`

Append the remaining exports per §4.1, §4.2, §4.4, §4.5, §4.6:

- `ResolvedExecutionBudget` interface per §4.1 (all nine fields including `modelFamily`, `modelContextWindow`, `resolvedFrom` sub-object).
- `ContextAssemblyResult` discriminated union per §4.2 (`{ kind: 'ok', routerPayload, prefixHash, variableInputHash, bundleSnapshotIds, softWarnTripped, assemblyVersion }` | `{ kind: 'budget_breach', blockPayload }`).
- `PrefixHashComponents` interface per §4.4 (`orderedDocumentIds`, `documentSerializedBytesHashes`, `includedFlags`, `modelFamily`, `assemblyVersion`).
- `HitlBudgetBlockPayload` interface per §4.5 (full shape).
- `RunOutcome = 'completed' | 'degraded' | 'failed'`.
- `DegradedReason = 'soft_warn' | 'token_drift' | 'cache_miss'`.
- `BundleResolutionSnapshot` runtime shape per §4.3.

Remove TODO comments from Phase 2's stub.

### Chunk 3.2 — `executionBudgetResolverPure` + stateful wrapper

Create `server/services/executionBudgetResolverPure.ts`:

- Export `resolveBudgetPure(input: { taskConfig, modelTierPolicy, orgCeilingPolicy })` per §6.5.
- Narrowing rule per §6.5 steps 1–6: start from `modelTierPolicy`; narrow by `orgCeilingPolicy`; narrow by `taskConfig`; `reserveOutputTokens = min(modelTierPolicy.reserveOutputTokens, resolvedMaxOutputTokens)`; assert capacity invariant → `CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED`; assert all > 0 → `CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO`.
- Export `BudgetResolutionError` with `errorCode` field.

Create `server/services/executionBudgetResolver.ts`:

- Thin wrapper calling `resolveBudgetPure` after reading the two policy rows.
- Query order: (1) org override row `WHERE organisation_id = :orgId AND model_family = :mf`; (2) platform default `WHERE organisation_id IS NULL AND model_family = :mf`.
- Raise `CACHED_CONTEXT_BUDGET_NO_POLICY` (500) if neither exists.
- No memoisation (§6.5).

### Chunk 3.3 — `contextAssemblyEnginePure` + stateful wrapper

Create `server/services/contextAssemblyEnginePure.ts`:

- `export const ASSEMBLY_VERSION = 1 as const;`
- `serializeDocument(args: { documentId, version, content }): string` — exact delimiter format per §6.4. **Re-export** from `referenceDocumentServicePure` (Phase 1 ships the definition to keep one source of truth).
- `assemblePrefix({ snapshots, versionsByDocumentVersionKey })` — deterministic concat. Snapshots sort by `bundleId` asc; within each snapshot documents by `documentId` asc. `versionsByDocumentVersionKey: Map<'${documentId}:${version}', { content: string }>` supplied by the caller.
- `computePrefixHash(components: PrefixHashComponents): string` — per-bundle identity hash. SHA-256 over a deterministic serialization of the five fields.
- `computeAssembledPrefixHash({ snapshotPrefixHashesByBundleIdAsc, modelFamily, assemblyVersion }): string` — call-level identity hash. Caller supplies the array already sorted by `bundleId` asc.
- `validateAssembly({ assembledPrefixTokens, variableInputTokens, perDocumentTopTokens, resolvedBudget })` → `{ kind: 'ok', softWarnTripped }` or `{ kind: 'breach', payload }`. Breach selection: input breach first (`assembledPrefixTokens + variableInputTokens + reserveOutputTokens > maxInputTokens` → `'max_input_tokens'`), then per-doc (any `perDocumentTopTokens[i].tokens > perDocumentMaxTokens` → `'per_document_cap'`). Soft-warn when over `softWarnRatio * maxInputTokens` but under hard limit.
- Breach payload populates `topContributors` (top 5 by tokens desc), `resolvedBudget`, `intendedPrefixHashComponents`, `suggestedActions: ['trim_bundle', 'upgrade_model', 'split_task', 'abort']`.

Create `server/services/contextAssemblyEngine.ts`:

- `assembleAndValidate(input: { snapshots, variableInput, instructions, resolvedBudget }): ContextAssemblyResult`.
- **Stateful pre-step (integrity check):** load `reference_document_versions` for every `(documentId, documentVersion)` pair across snapshots; re-hash each row's serialized form; compare to snapshot's recorded `serializedBytesHash`. Mismatch → `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION` (500). No recovery path (fail-fast per §6.4 invariant, R7).
- Pipeline per §6.4: assemblePrefix → variableInputTokens estimate → estimatedContextTokens sum (add fixed 100-token system overhead) → computeAssembledPrefixHash with snapshots sorted by `bundleId` asc → validateAssembly → return `{ kind: 'ok', routerPayload: { system: { stablePrefix, dynamicSuffix }, messages, estimatedContextTokens }, prefixHash: assembledPrefixHash, variableInputHash, bundleSnapshotIds, softWarnTripped, assemblyVersion }` or `{ kind: 'budget_breach', blockPayload }`.
- `dynamicSuffix = instructions + "\n\n" + variableInput`.

### Chunk 3.4 — Golden-fixture + budget-math tests

`server/services/__tests__/contextAssemblyEnginePure.test.ts` — three-layered golden-fixture test per §11.1. Fixture: two bundles, three docs total, one paused-and-excluded.

- `ASSEMBLY_VERSION === 1` assertion.
- `computePrefixHash(GOLDEN_COMPONENTS_BUNDLE_A) === GOLDEN_PER_BUNDLE_HASH_A` and same for B.
- `assemblePrefix(GOLDEN_SNAPSHOTS, GOLDEN_VERSION_ROWS) === GOLDEN_ASSEMBLED_PREFIX_BYTES` (full byte assertion).
- `computeAssembledPrefixHash(...) === GOLDEN_CALL_LEVEL_HASH`.
- `serializeDocument` is byte-identical for identical input.
- `assemblePrefix` stable under input reordering.
- `validateAssembly` returns the two breach kinds correctly; returns `{ ok, softWarnTripped: true }` in the soft-warn band.

`server/services/__tests__/executionBudgetResolverPure.test.ts` per §11.1:

- Narrowing math across all four dimensions.
- Capacity invariant raises `CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED`.
- Narrow-to-zero raises `CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO`.
- `softWarnRatio` passed through verbatim.

### Chunk 3.5 — Cross-module doc-set-hash consistency check

Append to `documentBundleServicePure.test.ts` (created in Phase 2 Chunk 2.8):

- Shared fixture: `DOCUMENT_IDS = ['doc_03', 'doc_01', 'doc_02']` (unsorted).
- `computeDocSetHash(DOCUMENT_IDS) === <expected-sha256>`.
- Assert `computePrefixHash` produces the same sub-hash over `orderedDocumentIds` as `computeDocSetHash` over the same input (re-derive via public API if the sub-hash isn't exposed directly). Both modules must agree on the ordered-ID hash.

## Acceptance (Phase 3 complete)

- [ ] `shared/types/cachedContext.ts` exports the full type set; no TODO comments remain.
- [ ] Both Pure tests pass.
- [ ] Cross-module doc-set-hash check passes.
- [ ] `npm run typecheck` + `npm run lint` green.
- [ ] `spec-conformance` reports the Phase 3 subset `CONFORMANT`.
- [ ] `pr-reviewer` clean.

## Out of scope for Phase 3

- Orchestrator (Phase 4).
- Bundle resolution service (Phase 4).
- `agent_runs` column additions (Phase 4 migration 0209).
- Router param extension (Phase 4 surface; Phase 5 write-through).
- Integration + concurrency tests (Phase 4/5).
