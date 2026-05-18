# Implementation Plan — memory-tiered-consolidation

**Spec:** `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md` (1108 lines)
**Build slug:** `memory-tiered-consolidation`
**Branch:** `memory-tiered-consolidation`
**Plan author:** architect (Opus)
**Plan date:** 2026-05-18
**Chunk count:** 12

## Table of contents

1. Model-collapse check
2. Architecture Notes
3. Locked Config Values
4. Migration Numbers
5. Open Questions (require operator decision before build)
6. Chunk Plan
   - Chunk 1 — Shared types + transition validator + feature flag
   - Chunk 2 — Schema + migration (consolidation_tier column)
   - Chunk 3 — LAEL extension (memory.retrieved fields + memory.block.promoted event)
   - Chunk 4 — decayPure (pure decay-weight helper)
   - Chunk 5 — MemoryConsolidationConfig (versioned config object)
   - Chunk 6 — reinforcementBatch (batched access tracker)
   - Chunk 7 — hybridRetrieval post-fusion lens + retrieve plumbing
   - Chunk 8 — memoryDecayJob replacement (logging-only)
   - Chunk 9 — evaluatePromotion (pure promotion evaluator)
   - Chunk 10 — Phase 4 schema migrations (review-queue + memory_block_versions if applicable)
   - Chunk 11 — promotion dispatcher + auto job + procedural review-queue integration
   - Chunk 12 — Audit script + trend log + capabilities/runbook/architecture docs
7. Test Inventory
8. Risks and Mitigations
9. Verification gate posture
10. Files NOT touched
11. Phase 2 entry checklist

---

## Model-collapse check

Could the build collapse into a single frontier-model call with structured output? **No, reject collapse.**

The feature is not an ingest → extract → transform → render pipeline. It is a stateful schema + scoring + lifecycle-management system: persistent column state (`consolidation_tier`, `last_accessed_at`), pure-function scoring (decay, signal weighting, transition validation), background batch infrastructure (reinforcement flusher, hourly promotion job), operator-confirmation queue, and a long-horizon audit-script gate (§13). A single-call alternative ("given a block, output its new tier") throws away determinism, idempotency, audit replayability, the `MEMORY_CONSOLIDATION_CONFIG_HISTORY` versioning contract per §9.2, and the §13 audit-script gate that production flag-flip depends on. The right shape is exactly what the spec describes: typed schema column + versioned config + pure helpers + outbox events + audit script reading the trace data.

---

## Architecture Notes

### Integration with the existing RRF pipeline (without touching queryIntent.ts)

`server/lib/queryIntent.ts` exports `RetrievalProfile` = `'temporal' | 'factual' | 'general' | 'exploratory' | 'relational'` and `RETRIEVAL_PROFILES` (weights for rrf / quality / recency). Spec §3 Goal 4 and §8 lock `queryIntent.ts` as untouched. Tier multipliers live in `MemoryConsolidationConfig.tierMultipliersByProfile` keyed by the same `RetrievalProfile` union, NOT a parallel "conversational / workflow_execution / reporting / neutral" set. The spec's §9.2 example uses illustrative profile names; the actual config uses the five existing profiles. Spec §9.2 explicitly says "The numbers above are illustrative only, architect locks initial values at plan." That carve-out covers the key set too: the profile names must match `RetrievalProfile`; the spec's example names are illustrative.

In `hybridRetrieval.ts`, after RRF fusion + recency boost + reranker + graph expansion + topK slice, the post-fusion lens runs:
1. For each candidate, read its `consolidation_tier` (joined in via the SQL CTE, see "tier column placement" below).
2. Compute `decayWeight = computeDecayWeight(tier, lastAccessedAt, now, decayConfig)`.
3. Look up `tierMultiplier = config.tierMultipliersByProfile[profile][tier] ?? 1.0`.
4. `candidate.combined_score *= decayWeight * tierMultiplier`.
5. Re-sort by `combined_score` (same pattern as the existing recency boost).
6. Emit `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval` on each entry in the LAEL `memory.retrieved` payload.

Whole block runs behind `getMemoryConsolidationTierEnabled()`. Flag OFF: the entire post-fusion lens is skipped. Per-component flag-off paths per §11.4.

### CRITICAL — Tier column placement: spec inconsistency, architect resolution

**Finding (P0).** The spec puts `consolidation_tier` on `memory_blocks` (§6 Phase 1, §8, §9.1). But the retrieval pipeline the spec extends (§8 `hybridRetrieval.ts`) operates on `workspace_memory_entries`, not `memory_blocks`. These are different tables: `memory_blocks` is the Letta-pattern named-blocks table (admin-managed, low volume, attached to agents); `workspace_memory_entries` is the agent-written facts table (high volume, embedded, RRF-retrieved). `memoryDecayJob.ts` operates on `workspace_memory_entries` (see body: `pruneStaleMemoryEntries`). `graphExpansion.ts` queries `workspace_memory_entries`. The spec literally added the column to a table whose rows are not what the retrieval pipeline returns.

**Architect resolution.** Place `consolidation_tier` on `workspace_memory_entries`, the table whose rows ARE retrieval candidates. This:
- Lets `hybridRetrieval.ts` read the tier directly from the candidate-pool CTE (no cross-table join, no denormalisation).
- Lets `reinforcementBatch.ts` UPDATE the same rows that the access trace points at.
- Lets `memoryBlockSynthesisService.evaluatePromotion` operate against the same row type as the existing `decideTier(confidence)` already does (existing function reads `workspace_memory_entries` clusters; new function reads `workspace_memory_entries` rows directly).
- Preserves the `memory_blocks.tier smallint` baseline-artefact column untouched (no collision, that column was the original concern; on a different table it cannot collide).
- Matches the spec's INTENT (Ebbinghaus decay + reinforcement on the retrieval candidates) even though it contradicts the spec's LITERAL table name.

**The plan adds `consolidation_tier text NOT NULL DEFAULT 'episodic'` to `workspace_memory_entries` (NOT `memory_blocks`).** This is an accepted architectural deviation from the spec's literal table name — the spec's INTENT (decay + reinforcement on retrieval candidates) is correctly served by `workspace_memory_entries`, which is the table the retrieval pipeline actually operates on. The spec text contained a table-name error; the operator confirmed `workspace_memory_entries` on 2026-05-18. The spec has been amended to document this as an accepted implementation deviation. The Phase 4 migration on `memory_block_versions` is dropped (OQ-2 resolved: skip version mint — replaced by the durable `workspace_memory_entry_tier_transitions` table pending operator decision on F2).

**Note on `last_accessed_at` collision.** `workspace_memory_entries` already has a `last_accessed_at` timestamp column (visible in `hybridRetrieval.ts` SQL line 188 and the recency-boost block at lines 251-260). The spec's Phase 1 migration adds `last_accessed_at` as if it were new. It is not. The existing column already exists, is currently bumped by the access-counter UPDATE in `hybridRetrieval.ts` lines 387-393, and is exactly what `reinforcementBatch.ts` should write. The plan therefore:
- Does NOT add a new `last_accessed_at` column (it already exists).
- DOES add `consolidation_tier text NOT NULL DEFAULT 'episodic'` and the partial CHECK + index.
- Replaces the existing `hybridRetrieval.ts` synchronous access-counter UPDATE (lines 387-393) with a call to `reinforcementBatch.recordAccess` so writes go through the batched flusher instead of per-retrieval. This preserves `last_accessed_at` semantics while satisfying the spec's "never per-retrieval synchronous writes" goal (Goal 3).

**This decision is confirmed: `workspace_memory_entries` (operator confirmed 2026-05-18).**

### reinforcementBatch.ts (new) fits with hybridRetrieval.ts and retrieve.ts (existing, extended in place)

`reinforcementBatch.ts` exports `recordAccess(entryId, organisationId, subaccountId): void`, sync API, returns immediately. The buffer is a `Map<string /* ${orgId}:${subaccountId} */, Map<string /* entryId */, number /* access count */>>` plus a per-tenant last-flush timestamp. Each `recordAccess` call increments the inner map's count for the given `entryId` (or initialises it to 1). This preserves true access-count semantics: N calls within a flush window produce `access_count = access_count + N` on flush, not `access_count + 1`. A `setInterval(flushAll, 1000)` ticks every second to check per-tenant flush eligibility (60s elapsed OR ≥ 500 buffered entries). The flusher iterates each tenant, runs `withOrgTx` per tenant, and for each `(entryId, count)` pair issues `UPDATE workspace_memory_entries SET last_accessed_at = greatest(last_accessed_at, now()), access_count = access_count + $count WHERE id = $entryId AND organisation_id = $orgId AND subaccount_id = $subaccountId` (batched via VALUES/unnest at build time). The `greatest(...)` makes flushes monotonically idempotent (safe under retry). Per-tenant in-process advisory lock prevents two concurrent flushes for the same tenant.

`hybridRetrieval.ts` calls `recordAccess` for every entry in the top-K result set, exactly the spec's intent. It replaces the existing synchronous access-counter UPDATE (which currently does `accessCount: sql\`access_count + 1\`, lastAccessedAt: now`). The replacement keeps `accessCount` incrementing inside the batch flush (the UPDATE includes `access_count = access_count + $count` where `$count` is the accumulated call count for that entry within the flush window), so the existing `accessCount`-dependent decay rules in `memoryDecayJob` still see correct counts. Multiple retrievals of the same entry within a 60-second window are faithfully reflected as N increments, not collapsed to 1.

Flag OFF: `recordAccess` is a no-op; the in-process buffer is not allocated; the timer is not registered. `hybridRetrieval.ts` falls back to the existing synchronous UPDATE path (lines 387-393) to preserve flag-OFF behavioural identity.

### Promotion dispatcher keeps evaluatePromotion (pure) separate from side effects

`memoryBlockSynthesisService.ts` gets a new pure function `evaluatePromotion(currentTier, signals, config): PromotionVerdict`. It does not touch DB. It does not invoke `writeLineageRowsForVersion`. It does not emit events. It is pure.

The side-effect dance lives in `memoryConsolidationPromotionDispatcher.ts` (new, Phase 4). The dispatcher:
1. Loads the candidate row (tier + last_accessed_at).
2. Computes `PromotionSignals` via the `agent_run_prompts` JOIN per §9.3.
3. Calls `evaluatePromotion(currentTier, signals, config)` and reads the verdict.
4. If `shouldPromote === false`, increments a per-cycle counter keyed by the `reason` and continues.
5. If `mode === 'operator-approved'`, INSERTs into `memory_review_queue` with `ON CONFLICT DO NOTHING` against the new partial unique index; emits no event yet (the event fires on approve).
6. If `mode === 'auto'`, opens `withOrgTx`, runs the canonical promotion sequence (validate-transition → guarded UPDATE → conditional version+lineage → commit → outbox event).

Empty-cluster `writeLineageRowsForVersion` is verified safe: the function body (`memoryBlockLineageService.ts:65-67`) is `for (let i = 0; i < cluster.length; i++)` which is a no-op on empty input and returns `{ rowsWritten: 0 }`.

### Version-minting sequence at promotion time (§14.1 + §9.8)

For each auto-promotion or operator-approved promotion, the dispatcher (NOT `evaluatePromotion`) mints the `memory_block_versions` row when applicable. Recommendation per handoff §4.4 locked at plan: **dispatcher mints**. The pure-function evaluator stays pure; the dispatcher composes all side effects (DB update + version mint + lineage + event).

Reading order inside `withOrgTx`:
1. `isValidPromotionTransition(oldTier, newTier)` → if false, log and abort (no DB write).
2. `UPDATE workspace_memory_entries SET consolidation_tier = $newTier, last_accessed_at = greatest(last_accessed_at, now()) WHERE id = $blockId AND consolidation_tier = $oldTier RETURNING id` → 0 rows = race lost, abort transaction.
3. **No version mint** (OQ-2 resolved). The `memory.block.promoted` event serves as the audit trail. Audit Check 2 reconciles event counts against `agent_run_prompts` trace-derived signal-clearance counts.
4. Commit.
5. Post-commit, best-effort: emit `memory.block.promoted` via `tryEmitAgentEvent`.

### Feature flag gating strategy: single flag wrapping all subsystems

`server/config/featureFlags.ts` (NEW file, confirmed not present in repo). Exports:
- `getMemoryConsolidationTierEnabled(): boolean` reads `process.env.MEMORY_CONSOLIDATION_TIER_ENABLED`, parses `'true' | '1' | 'yes'` (case-insensitive) → true; anything else → false. Read once per retrieval; not cached at module load.
- `parseBooleanEnv(name: string): boolean` small helper for future flag readers.

Single flag gates:
- `hybridRetrieval.ts` post-fusion lens (skip block if OFF).
- `reinforcementBatch.recordAccess` (no-op if OFF; timer not registered).
- `memoryDecayJob` (early-exit after flag check if OFF; job still dispatches and the flag check is logged).
- `memoryConsolidationPromotionJob` (early-exit if OFF).
- `memory.retrieved` event tier fields (`null` when OFF).

`MEMORY_CONSOLIDATION_TIER_ENABLED` env var defaults missing → `false` in every environment. G1 satisfied.

### Migration safety: NOT NULL DEFAULT 'episodic'

The Postgres ≥ 11 fast-path for `ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT '<non-volatile literal>'` does not rewrite the table. `'episodic'` is a non-volatile literal. The CHECK constraint is added in the same statement; Postgres validates it against the new column default which trivially passes. The partial index on `(organisation_id, subaccount_id, consolidation_tier) WHERE deleted_at IS NULL` is built non-CONCURRENTLY (migration runner uses transactional migrations); current data volumes are well under any lock-budget threshold (audit script Check 1 has a "≥ 100 blocks per tenant" eligibility precondition; an index build over a few thousand rows is sub-second).

`last_accessed_at` is the existing column on `workspace_memory_entries` (no migration needed).

### Architect deviations from the spec (recorded)

Three notes for the operator:

| # | Spec says | Plan does | Reason | Status |
|---|---|---|---|---|
| 1 | `consolidation_tier` on `memory_blocks` | `consolidation_tier` on `workspace_memory_entries` | Retrieval pipeline operates on the latter; placing the column on the former produces unreachable join paths | **Accepted architectural deviation — spec amended 2026-05-18.** Operator confirmed `workspace_memory_entries`. |
| 2 | Spec's profile names `conversational / workflow_execution / reporting / neutral` | Use the existing `temporal / factual / general / exploratory / relational` from `queryIntent.ts` | Spec §9.2 explicitly marks values as illustrative; profile names are not a contract since `queryIntent.ts` is locked | OQ-3 RESOLVED (no action, informational only) |
| 3 | Phase 4 mints `memory_block_versions` rows for tier promotions | Replaced by durable `workspace_memory_entry_tier_transitions` table written inside the promotion transaction | The `memory_block_versions` FK is to `memory_blocks.id`; cannot mint a row keyed to a different table; event emission is best-effort so a separate durable table is required | **Accepted architectural deviation — spec amended 2026-05-18. Operator decision pending on F2 scope addition.** |

---

## Locked Config Values

`MemoryConsolidationConfig` v1, exported from `server/config/memoryConsolidationConfig.ts` per §9.2:

```typescript
export const MEMORY_CONSOLIDATION_CONFIG_HISTORY: MemoryConsolidationConfig[] = [
  {
    version: 1,
    decayConfig: {
      strengthByTier: {
        working:    3,        // days; weight = exp(-t/3); ~5% remaining after 9 days
        episodic:   14,       // days; ~5% remaining after 42 days
        semantic:   90,       // days; ~70% remaining at 30 days
        procedural: 999999,   // effectively infinite; computeDecayWeight short-circuits to 1.0
      },
    },
    promotionConfig: {
      signalWeights: {
        reinforcementCount:     0.5,    // raw count of distinct agent_run_prompts hits
        crossSessionRecurrence: 0.3,    // raw count of distinct agent_runs hits
        recency:                0.2,    // exp(-t/S) factor in [0, 1]
      },
      thresholds: {
        workingToEpisodic:     3.0,     // ~6 hits in a week clears with default weights
        episodicToSemantic:    8.0,     // ~15 hits in 30 days clears
        episodicToProcedural: 15.0,     // procedural is operator-approved; threshold is high
        semanticToProcedural: 15.0,     // ditto
      },
    },
    tierMultipliersByProfile: {
      temporal:    { working: 1.3, episodic: 1.1, semantic: 0.9, procedural: 0.8 },
      factual:     { working: 0.9, episodic: 1.0, semantic: 1.3, procedural: 1.2 },
      general:     { working: 1.0, episodic: 1.0, semantic: 1.0, procedural: 1.0 },
      exploratory: { working: 1.2, episodic: 1.1, semantic: 0.9, procedural: 0.9 },
      relational:  { working: 1.0, episodic: 1.1, semantic: 1.2, procedural: 1.3 },
    },
  },
];

export const ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number = 1;
```

Reinforcement batch:
- Flush interval: **60 seconds** OR **500 buffered events**, whichever comes first.
- Buffer key: `(organisationId, subaccountId)` Map.
- Per-tenant in-process advisory lock (single flusher per tenant at a time).

Audit script:
- `--warmup-days` default: **14**.
- Procedural-rejection cooldown: **30 days** (`cooldown_until = now() + interval '30 days'`).

Profile-name caveat: §9.2 example uses `conversational / workflow_execution / reporting / neutral`; those values are illustrative per the spec's own carve-out. The plan locks the actual `RetrievalProfile` union from `server/lib/queryIntent.ts`. The five values above match.

---

## Migration Numbers

Highest existing migration on `main` at plan time: **0369**. Assignments:

| Migration | Path | Phase | Purpose |
|---|---|---|---|
| 0370 | `migrations/0370_workspace_memory_entries_consolidation_tier.sql` + `.down.sql` | 1 | Add `consolidation_tier text NOT NULL DEFAULT 'episodic'` + CHECK constraint + `workspace_memory_entries_consolidation_tier_idx` partial index on `workspace_memory_entries`. No `last_accessed_at` ADD (column already exists). |
| 0371 | `migrations/0371_memory_review_queue_procedural_promotion.sql` + `.down.sql` | 4 | Add `block_id uuid NULL` + `cooldown_until timestamptz NULL` to `memory_review_queue`; add partial unique index `memory_review_queue_pending_procedural_promotion_idx`. |
~~0372~~ — **DROPPED** (OQ-2 resolved as "skip version mint" — `memory_block_versions` not modified).

Two migrations total. Each with `.down.sql` per repo convention.

If migrations 0370 / 0371 / 0372 are claimed by another concurrent branch before this work lands, increment to the next available numbers. Migration numbers are allocated at builder time per existing convention (spec §8).

---

## Open Questions (all resolved by operator 2026-05-18)

**OQ-1 — RESOLVED: `workspace_memory_entries`.** Column placement confirmed as `workspace_memory_entries` (architect recommendation). The retrieval pipeline (`hybridRetrieval.ts`, `graphExpansion.ts`, `reinforcementBatch`) operates on this table; placing the column there makes it directly readable from the candidate-pool CTE without additional joins. This is an accepted architectural deviation from the spec's literal table name; the spec has been amended 2026-05-18 to document it formally.

**OQ-2 — RESOLVED: version mint replaced by durable tier_transitions table (pending operator decision on scope).** Since OQ-1 = `workspace_memory_entries`, the `memory_block_versions` FK to `memory_blocks.id` makes version minting structurally infeasible. Per ChatGPT round 1 review (F2), the `memory.block.promoted` event alone is insufficient as the audit trail because events are best-effort post-commit. The accepted architectural deviation replaces version minting with a transaction-bound `workspace_memory_entry_tier_transitions` table insert (written inside `withOrgTx` before commit). The LAEL event remains supplementary observability. Migration 0372 scope: previously dropped; if operator approves F2, restored with new purpose (see Chunk 10 deviation note). Spec amended 2026-05-18 to document this deviation. Audit Check 2 reconciles events against the `workspace_memory_entry_tier_transitions` table.

**OQ-3 — RESOLVED (no action, informational).** Profile-name mismatch: §9.2 example uses `conversational / workflow_execution / reporting / neutral`; actual `RetrievalProfile` is `temporal / factual / general / exploratory / relational`. Plan uses the actual five. Spec's "illustrative" carve-out in §9.2 covers this.

---

## Chunk Plan

The 12 chunks below are forward-only, chunk N depends only on chunks 1..N-1. Builder runs them in order; G1 gate per chunk per the existing `feature-coordinator` flow.

### Chunk 1 — Shared types + transition validator + feature flag

**Phase:** 1
**spec_sections:** §6 Phase 1 (flag scaffolding), §8 (shared types row + featureFlags row), §9.1, §9.2, §9.3, §9.4, §9.7, §14.7

**Files:**
- `shared/types/memoryConsolidation.ts` (NEW) exports `ConsolidationTier`, `MemoryConsolidationConfig`, `PromotionSignals`, `PromotionVerdict`, `MemoryConsolidationAuditResult`, `AuditCheckResult`, `RetrievalProfileTierMultipliers`. Exports pure helper `isValidPromotionTransition(oldTier, newTier): boolean`.
- `server/config/featureFlags.ts` (NEW) exports `getMemoryConsolidationTierEnabled(): boolean` and `parseBooleanEnv(name): boolean`. Reads `process.env.MEMORY_CONSOLIDATION_TIER_ENABLED`. Reads at call time (not module-load).
- `shared/types/__tests__/memoryConsolidation.test.ts` (NEW) Vitest tests for `isValidPromotionTransition`.

**Module shape:**
- *Public interface this chunk exposes:* `ConsolidationTier` union, `MemoryConsolidationConfig` record shape, `PromotionSignals`, `PromotionVerdict`, `isValidPromotionTransition(oldTier, newTier): boolean`, `getMemoryConsolidationTierEnabled(): boolean`, `parseBooleanEnv(name): boolean`.
- *What stays hidden behind it:* nothing, these are pure type + helper exports with no internal state.

**Contracts:**
- `ConsolidationTier = 'working' | 'episodic' | 'semantic' | 'procedural'`.
- `isValidPromotionTransition` returns `true` ONLY for `(working, episodic)`, `(episodic, semantic)`, `(episodic, procedural)`, `(semantic, procedural)`. Everything else `false`. Implemented via exhaustive switch with TypeScript `never` typing in the default arm so adding a new tier value surfaces missing cases at compile time.
- `getMemoryConsolidationTierEnabled` parses `'true' | '1' | 'yes'` (case-insensitive) → `true`; anything else (including undefined) → `false`.

**Error handling:** No runtime errors. All helpers are pure and total. Invalid input types are caught at TypeScript compile time.

**Test files:**
- `shared/types/__tests__/memoryConsolidation.test.ts` covers: four valid transitions true; six invalid `(working, semantic)`, `(working, procedural)`, `(episodic, working)`, `(semantic, episodic)`, `(procedural, working)`, `(procedural, procedural)` false; each tier paired with itself false; exhaustiveness assertion via `never` typing.

**Dependencies:** None. Foundation chunk.

**Acceptance criteria:**
- Both new files compile under `npm run typecheck` (dual-tsconfig form).
- `npx vitest run shared/types/__tests__/memoryConsolidation.test.ts` passes.
- `npm run lint` passes.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run shared/types/__tests__/memoryConsolidation.test.ts`.

### Chunk 2 — Schema + migration (consolidation_tier column)

**Phase:** 1
**spec_sections:** §6 Phase 1 (Schema additions, Backfill), §8, §9.1, §10.2

**Files:**
- `migrations/0370_workspace_memory_entries_consolidation_tier.sql` (NEW) `ALTER TABLE workspace_memory_entries ADD COLUMN consolidation_tier text NOT NULL DEFAULT 'episodic' CHECK (consolidation_tier IN ('working','episodic','semantic','procedural'))`; `CREATE INDEX workspace_memory_entries_consolidation_tier_idx ON workspace_memory_entries (organisation_id, subaccount_id, consolidation_tier) WHERE deleted_at IS NULL;`. (`last_accessed_at` already exists on this table — no new column needed.)
- `migrations/0370_workspace_memory_entries_consolidation_tier.down.sql` (NEW) `DROP INDEX IF EXISTS workspace_memory_entries_consolidation_tier_idx; ALTER TABLE workspace_memory_entries DROP COLUMN IF EXISTS consolidation_tier;`. Drop index before column.
- `server/db/schema/workspaceMemories.ts` (MODIFY) add `consolidationTier: text('consolidation_tier').$type<ConsolidationTier>().notNull().default('episodic')` field; declare the partial index in the `(table) => ({ ... })` builder.

**Module shape:**
- *Public interface this chunk exposes:* the new `consolidation_tier` column readable / writable through the existing Drizzle schema. Other chunks read it via `workspaceMemoryEntries.consolidationTier`.
- *What stays hidden behind it:* the CHECK constraint, the partial index, the `'episodic'` default. Callers never reference these directly.

**Contracts:**
- Every existing row in `workspace_memory_entries` after migration has `consolidation_tier = 'episodic'` (implicit via DEFAULT).
- New inserts that do not set `consolidation_tier` get `'episodic'` (no INSERT pathway changes; extraction stays untouched per spec §8).
- RLS: column inherits the existing `workspace_memory_entries_organisation_isolation` policy. No new `CREATE POLICY` / `ALTER POLICY` / `GRANT` in the migration. No new entry in `rlsProtectedTables.ts`.

**Error handling:** `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT '<literal>'` is metadata-only on Postgres ≥ 11; current data volume well under any lock-budget threshold. CHECK constraint validation is trivial against the literal default. Re-running the migration is structurally prevented per repo convention.

**Test files:** None for migrations per repo convention.

**Dependencies:** Chunk 1 (`ConsolidationTier` type imported by the schema mirror).

**Acceptance criteria:**
- Migration applies cleanly on local dev.
- Schema mirror compiles under typecheck.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate` (verify drizzle does not detect schema drift), local migration apply.

### Chunk 3 — LAEL extension (memory.retrieved fields + memory.block.promoted event)

**Phase:** 1
**spec_sections:** §6 Phase 1 (Observability scaffolding), §8, §9.5, §9.6, §12 G2

**Files:**
- `shared/types/agentExecutionLog.ts` (MODIFY) extend `memory.retrieved` payload: add `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval` (all nullable) to each `MemoryRetrievedTopEntry`. Add new `'memory.block.promoted'` discriminated-union member per §9.5 schema. Add `'memory.block.promoted': false` entry to `AGENT_EXECUTION_EVENT_CRITICALITY` (tier-3). Add `'memory.block.promoted'` to the `AgentExecutionEventType` union.
- `server/services/agentExecutionEventEmitter.ts` (MODIFY if needed) confirm the emitter accepts the new event type. If no change needed, this file drops from the chunk.

**Module shape:**
- *Public interface this chunk exposes:* the extended `MemoryRetrievedTopEntry` payload shape and the new `'memory.block.promoted'` event type.
- *What stays hidden behind it:* nothing, these are type-level extensions.

**Contracts:**
- All five new `memory.retrieved` fields are nullable. Existing consumers that don't read them are unaffected.
- `memory.block.promoted` payload required fields per §9.5: `blockId`, `organisationId`, `subaccountId`, `oldTier`, `newTier`, `signalContributions`, `totalScore`, `threshold`, `configVersion`, `promotionMode`. Optional: `approvedByUserId` (iff `operator-approved`), `queueItemId` (iff `operator-approved`), `jobId` (iff `auto`).
- Criticality `tier-3` (operational, non-critical, retry-on-failure).

**Error handling:** Type-only chunk; no runtime error surface.

**Test files:** None.

**Dependencies:** Chunk 1.

**Acceptance criteria:**
- `npm run typecheck` passes after the type extension.
- No existing call site of `tryEmitAgentEvent` for `'memory.retrieved'` breaks.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

### Chunk 4 — decayPure (pure decay-weight helper)

**Phase:** 2
**spec_sections:** §6 Phase 2 (Decay function), §8, §11.1

**Files:**
- `server/services/workspaceMemoryService/decayPure.ts` (NEW) exports `computeDecayWeight(tier: ConsolidationTier, lastAccessedAt: Date | null, now: Date, config: MemoryConsolidationConfig['decayConfig']): number`.
- `server/services/workspaceMemoryService/__tests__/decayPure.test.ts` (NEW).

**Module shape:**
- *Public interface this chunk exposes:* `computeDecayWeight(tier, lastAccessedAt, now, decayConfig): number`.
- *What stays hidden behind it:* the formula (`exp(-t/S)`), special-case handling for `procedural` and `null lastAccessedAt`, the time-delta computation in days.

**Contracts:**
- Formula: `weight = exp(-t/S)` where `t = (now.getTime() - lastAccessedAt.getTime()) / 86400000` (days) and `S = config.strengthByTier[tier]`.
- Special case 1: `tier === 'procedural'` returns `1.0` regardless.
- Special case 2: `lastAccessedAt === null` returns `1.0`.
- Special case 3: `t < 0` (clock skew / future timestamp) returns `1.0` (clamp; do not boost above 1).
- Output is in `[0, 1]` always.

**Error handling:** Pure function; no I/O. A defensive `?? 1.0` covers the `config.strengthByTier[tier]` lookup if config is malformed.

**Test files:**
- `server/services/workspaceMemoryService/__tests__/decayPure.test.ts` minimum cases:
  - `working` tier at `t = 0` returns `1.0`.
  - `working` tier at `t = 1 day` with `S = 3` returns approximately `exp(-1/3) ≈ 0.7165`.
  - `episodic` tier at `t = 30 days` with `S = 14` returns approximately `exp(-30/14) ≈ 0.117`.
  - `semantic` tier at `t = 30 days` with `S = 90` returns approximately `exp(-30/90) ≈ 0.717`. (Note: the spec text said "> 0.9 at 30 days"; locked `S = 90` gives `> 0.7`. The test asserts `> 0.7`.)
  - `procedural` tier at `t = 365 days` returns `1.0`.
  - `null` lastAccessedAt returns `1.0`.
  - Negative `t` (future-timestamped row) returns `1.0`.

**Dependencies:** Chunk 1.

**Acceptance criteria:**
- Targeted vitest run passes. Typecheck passes.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/workspaceMemoryService/__tests__/decayPure.test.ts`.

### Chunk 5 — MemoryConsolidationConfig (versioned config object)

**Phase:** 3 (introduced early so chunks 6–10 can import it)
**spec_sections:** §6 Phase 3 (Versioned config), §8, §9.2

**Files:**
- `server/config/memoryConsolidationConfig.ts` (NEW) exports:
  - `MEMORY_CONSOLIDATION_CONFIG_HISTORY: MemoryConsolidationConfig[]` (append-only).
  - `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number` (currently `1`).
  - `getActiveMemoryConsolidationConfig(): MemoryConsolidationConfig` helper that returns `MEMORY_CONSOLIDATION_CONFIG_HISTORY.find(c => c.version === ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION) ?? throw new Error('Active config version not found in history')`.

**Module shape:**
- *Public interface this chunk exposes:* `MEMORY_CONSOLIDATION_CONFIG_HISTORY`, `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION`, `getActiveMemoryConsolidationConfig()`.
- *What stays hidden behind it:* the inline config values, the version-selection mechanism.

**Contracts:**
- `getActiveMemoryConsolidationConfig` throws if the active version is not present in history (build-time mistake; never silent fallback).
- v1 initial values exactly as locked in "Locked Config Values" above.
- Bumping the active version is a deliberate two-line code edit.

**Error handling:** Throws on missing active version (intentional).

**Test files:** None. The config is data, not behaviour. The helper is trivially correct; pure-helper tests live in chunks that consume the config.

**Dependencies:** Chunk 1.

**Acceptance criteria:** File compiles; `getActiveMemoryConsolidationConfig()` returns the v1 entry at module load.

**Verification commands:** `npm run lint`, `npm run typecheck`.

### Chunk 6 — reinforcementBatch (batched access tracker)

**Phase:** 2
**spec_sections:** §6 Phase 2 (Batched reinforcement tracker), §8, §11.1, §14.1, §14.3 (c)

**Files:**
- `server/services/workspaceMemoryService/reinforcementBatch.ts` (NEW) exports:
  - `recordAccess(entryId: string, organisationId: string, subaccountId: string): void`.
  - `startReinforcementBatchFlusher(): void`.
  - `stopReinforcementBatchFlusher(): Promise<void>`.
  - `__testing` namespace export with the internal buffer + `flushNow(orgId, subaccountId): Promise<void>` for tests.
- `server/services/workspaceMemoryService/__tests__/reinforcementBatchPure.test.ts` (NEW).
- `server/index.ts` (MODIFY) call `startReinforcementBatchFlusher()` once during server boot.

**Module shape:**
- *Public interface this chunk exposes:* `recordAccess`, `startReinforcementBatchFlusher`, `stopReinforcementBatchFlusher`.
- *What stays hidden behind it:* the in-process `Map<string, Map<string, number>>` buffer (outer key: `${orgId}:${subaccountId}`; inner key: `entryId`; inner value: access count within the flush window), the per-tenant advisory lock, the `setInterval` timer, the per-tenant flush SQL, the count + time triggers, the per-entry count accumulation, the buffer-cap pruning.

**Contracts:**
- `recordAccess` is sync, returns immediately, never throws, never blocks. If flag is OFF, no-op (does not allocate buffer state).
- Flush trigger: every `1000ms` tick checks each tenant; flush if `(now - lastFlush) >= 60000ms` OR `buffer.size >= 500`.
- Flush operation: for each `(entryId, count)` pair in the tenant's inner map, issue `UPDATE workspace_memory_entries SET last_accessed_at = greatest(last_accessed_at, now()), access_count = access_count + $count WHERE id = $entryId AND organisation_id = $orgId AND subaccount_id = $subaccountId`. This preserves the true access-count value across the flush window — multiple `recordAccess` calls for the same entry within a flush interval increment the inner map count, and the flush applies the full accumulated count in a single `access_count = access_count + $count` write. A batched form using a VALUES list or `unnest` is preferred over N individual UPDATEs (architect resolves at build time).
- Per-tenant advisory lock (in-process): a `Set<string>` of `${orgId}:${subaccountId}` keys currently flushing; flusher skips a tenant if already in the set.
- Structured logs per flush cycle per tenant: `reinforcement_batch_updates_total`, `reinforcement_batch_flush_ms`.

**Error handling:**
- Flush DB error logged with `[ReinforcementBatch] flush failed for tenant ${orgId}:${subaccountId}: ${err}`; buffer is NOT cleared (next flush will retry); flusher continues with next tenant.
- Defensive buffer cap: `5000 entries per tenant` triggers `[ReinforcementBatch] buffer cap exceeded, dropping oldest` and discards oldest half. Audit Check 5b surfaces this drift.
- Shutdown: `stopReinforcementBatchFlusher` waits up to 10s for in-flight flushes to drain.

**Test files:**
- `server/services/workspaceMemoryService/__tests__/reinforcementBatchPure.test.ts` covers the pure buffer logic only (not DB writes): per-entry count accumulation (multiple `recordAccess` calls for the same entry within a window produce a single map entry with the summed count, not one entry per call); `shouldFlushByTime(lastFlush, now, intervalMs): boolean`; `shouldFlushByCount(bufferSize, threshold): boolean`; buffer-cap pruning. Extract pure helpers from the implementation file.

**Dependencies:** Chunks 1, 2, 5. Uses existing `withOrgTx` from `server/lib/orgScoping.ts` and `getOrgScopedDb`.

**Acceptance criteria:**
- Targeted vitest run passes.
- `npm run build:server` succeeds (server boot path includes the new flusher).
- Flag OFF verification: test asserts the buffer Map is empty after a `recordAccess` call when the flag returns false.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/workspaceMemoryService/__tests__/reinforcementBatchPure.test.ts`, `npm run build:server`.

### Chunk 7 — hybridRetrieval post-fusion lens + retrieve plumbing

**Phase:** 2 + 3 combined (one logical responsibility: extend the retrieval pipeline)
**spec_sections:** §6 Phase 2 (Apply decay at retrieval), §6 Phase 3 (post-fusion multiplier), §8, §9.6, §11.4, §12 G1

**Files:**
- `server/services/workspaceMemoryService/hybridRetrieval.ts` (MODIFY):
  - Extend the candidate-pool CTE SELECT to include `consolidation_tier`.
  - Extend the outer SELECT to return `consolidation_tier` per row.
  - Extend `HybridResult` (in `types.ts`) to include `consolidation_tier: ConsolidationTier`.
  - After RRF + recency-boost + reranker + graph expansion + topK slice, if `getMemoryConsolidationTierEnabled()`: compute `decayWeight` per candidate via `computeDecayWeight`, look up `tierMultiplier` from the active config, set `combined_score *= decayWeight * tierMultiplier`, re-sort.
  - Replace the synchronous `accessCount + 1` UPDATE at lines 387-393 with: if flag ON, call `reinforcementBatch.recordAccess(r.id, orgId, subaccountId)` per top-K entry; if flag OFF, fall through to the existing synchronous UPDATE.
  - Extend both `tryEmitAgentEvent` call sites (the zero-result early-return AND the final return) to include the five new fields per `topEntries[]` entry: `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval`. Flag OFF: all five `null`. Flag ON: populate from the per-candidate computed values; `lastAccessedAtAtRetrieval` is the raw `cp.last_accessed_at::text` at retrieval time.
- `server/services/workspaceMemoryService/retrieve.ts` (MODIFY) extend `getRelevantMemories` return shape to include the five new fields (forwarded from `HybridResult`). No new behaviour; pure plumbing.
- `server/services/workspaceMemoryService/types.ts` (MODIFY) extend `HybridResult` interface.
- `server/services/workspaceMemoryService/tierMultiplierPure.ts` (NEW) exports `applyTierMultiplier(tier, profileName, config): number`.
- `server/services/workspaceMemoryService/__tests__/tierMultiplierPure.test.ts` (NEW).

**Module shape:**
- *Public interface this chunk exposes:* the existing `hybridRetrieve` signature is unchanged; the return shape gains five nullable fields on each entry. The pure helper `applyTierMultiplier(tier, profileName, config): number` is the only NEW publicly tested function.
- *What stays hidden behind it:* the post-fusion lens flow, the flag-branch wiring, the per-candidate decay computation, the LAEL field population logic, the access-counter rewiring.

**Contracts:**
- Flag OFF: candidate ordering, scoring, selected memory IDs, and prompt inputs derived from retrieval are byte-identical to pre-build behaviour modulo the additive nullable LAEL fields (per §12 G1 narrowed claim).
- Flag ON: post-fusion multipliers apply; re-sort respects the new scores; `memory.retrieved` event carries real values.
- Flag ON: `reinforcementBatch.recordAccess` called per top-K entry; flag OFF: existing synchronous UPDATE preserved (no behaviour change for OFF mode).
- `applyTierMultiplier(tier, profileName, config)` returns `config.tierMultipliersByProfile[profileName]?.[tier] ?? 1.0`.

**Error handling:**
- Flag read failure defaults to OFF (the env var read is sync; a malformed value parses as `false`).
- Active config not found at module load throws (chunk 5 contract).
- `recordAccess` call from inside `hybridRetrieve` cannot throw per chunk 6 contract.

**Test files:**
- `server/services/workspaceMemoryService/__tests__/tierMultiplierPure.test.ts` covers: each profile × each tier returns locked v1 value; unknown profile multipliers default to `1.0`; unknown tier (defensive, unreachable in TS) returns `1.0`.

**Dependencies:** Chunks 1, 2, 4, 5, 6.

**Acceptance criteria:**
- Targeted vitest run passes for `tierMultiplierPure.test.ts`.
- Typecheck + lint + `npm run build:server` succeed.
- Manual smoke: in local dev with flag OFF, retrieval ordering matches pre-build behaviour for a sample query (validated by spec-conformance fixture-replay in the review pass).

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/workspaceMemoryService/__tests__/tierMultiplierPure.test.ts`, `npm run build:server`.

### Chunk 8 — memoryDecayJob replacement (logging-only)

**Phase:** 2
**spec_sections:** §6 Phase 2 (Replace memoryDecayJob stub), §8, §11.1, §11.4

**Files:**
- `server/jobs/memoryDecayJob.ts` (REPLACE, the existing file is the 18-line `pruneStaleMemoryEntries` invocation; replace its body entirely).
- `server/services/workspaceMemoryService.ts` (MODIFY) if `pruneStaleMemoryEntries` is no longer called from anywhere after this chunk, deprecate it (leave the function in place; surface "no callers" to `tasks/todo.md`); do NOT delete it (per CLAUDE.md "Surface, don't smuggle"). Verify caller list before deciding.

**Module shape:**
- *Public interface this chunk exposes:* the existing `runMemoryDecay()` export. Signature unchanged. Behaviour changed: no row mutations, only structured per-tenant per-tier distribution logs.
- *What stays hidden behind it:* the per-tenant iteration loop, the per-tier count SQL, the log-line format.

**Contracts:**
- Job runs at the existing schedule (hourly per architecture.md cadence; architect verifies the cron registration in `server/jobs/registry.ts` or equivalent at build time).
- For each tenant (iterated via the existing tenant-enumeration helper used by `memoryDedupJob.ts`), emit one structured log line per tier with fields: `tier`, `count_total`, `count_with_lastAccessedAt_within_7d`, `count_with_lastAccessedAt_older_than_30d`, `count_with_null_lastAccessedAt`.
- Flag OFF: job exits early after flag check with one log line `memory.decay_job.skipped flag=off`.
- Job never writes to `workspace_memory_entries` (or `memory_blocks`). Decay is applied at retrieval time in Chunk 7. `last_accessed_at` is owned by Chunk 6's reinforcement batch.

**Error handling:**
- Per-tenant query error logged with tenant id; continue with next tenant; do not abort the cycle.
- Cycle-level fatal error bubbles up to pg-boss for tier-3 retry.

**Test files:** None, logging-only.

**Dependencies:** Chunks 1, 2.

**Acceptance criteria:**
- Typecheck + lint + build pass.
- `verify-no-direct-boss-work` (CI gate) continues to pass.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`.

### Chunk 9 — evaluatePromotion (pure promotion evaluator)

**Phase:** 4
**spec_sections:** §6 Phase 4 (Promotion concern in synthesis service), §8, §9.3, §9.4, §14.7

**Files:**
- `server/services/memoryBlockSynthesisService.ts` (MODIFY) add new function `evaluatePromotion(currentTier: ConsolidationTier, signals: PromotionSignals, config: MemoryConsolidationConfig): PromotionVerdict`. Existing `decideTier(confidence)` and the rest of the synthesis service are untouched.
- `server/services/__tests__/memoryBlockSynthesisServicePure.test.ts` (NEW or MODIFY if exists).

**Module shape:**
- *Public interface this chunk exposes:* `evaluatePromotion(currentTier, signals, config): PromotionVerdict`.
- *What stays hidden behind it:* the additive weighted-sum formula, the per-transition threshold lookup, the tier-next-tier routing logic, the auto-vs-operator-approved mode selection, the `isValidPromotionTransition` invocation.

**Contracts:**
- Total score: `totalScore = signals.reinforcementCount * config.promotionConfig.signalWeights.reinforcementCount + signals.crossSessionRecurrence * config.promotionConfig.signalWeights.crossSessionRecurrence + signals.recency * config.promotionConfig.signalWeights.recency`.
- Per `currentTier`, select candidate `(nextTier, threshold, mode)` pairs in priority order (highest tier first):
  - `working`: `[('episodic', config.thresholds.workingToEpisodic, 'auto')]`.
  - `episodic`: `[('procedural', config.thresholds.episodicToProcedural, 'operator-approved'), ('semantic', config.thresholds.episodicToSemantic, 'auto')]` (procedural checked first; clearing the procedural threshold ALSO clears the semantic threshold, the procedural promotion is the dominant verdict).
  - `semantic`: `[('procedural', config.thresholds.semanticToProcedural, 'operator-approved')]`.
  - `procedural`: returns `{ shouldPromote: false, reason: 'already_top_tier' }`.
- For each candidate `(nextTier, threshold, mode)`: if `!isValidPromotionTransition(currentTier, nextTier)` → continue; if `totalScore < threshold` → continue; else return `{ shouldPromote: true, nextTier, mode, signalContributions: signals, totalScore, threshold, configVersion: config.version }`.
- If no candidate clears: `{ shouldPromote: false, reason: 'below_threshold' }`.
- Invalid `currentTier` (unreachable in TS): `{ shouldPromote: false, reason: 'invalid_source_tier' }`.

**Error handling:** Pure function; no I/O; no exceptions.

**Test files:**
- `server/services/__tests__/memoryBlockSynthesisServicePure.test.ts` minimum cases:
  - working with high `reinforcementCount` → auto promotion to episodic.
  - episodic with mid signals → auto promotion to semantic.
  - episodic with high signals → operator-approved promotion to procedural.
  - semantic with high signals → operator-approved promotion to procedural.
  - procedural → `already_top_tier`.
  - Below-threshold case for each non-procedural tier → `below_threshold`.
  - `configVersion` is passed through.

**Dependencies:** Chunks 1, 5.

**Acceptance criteria:**
- Targeted vitest run passes.
- `decideTier` and existing synthesis behaviour unchanged.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/__tests__/memoryBlockSynthesisServicePure.test.ts`.

### Chunk 10 — Phase 4 schema migrations (review-queue + memory_block_versions if applicable)

**Phase:** 4
**spec_sections:** §6 Phase 4, §8, §10.3

**Files:**
- `migrations/0371_memory_review_queue_procedural_promotion.sql` (NEW) `ALTER TABLE memory_review_queue ADD COLUMN block_id uuid NULL`; `ALTER TABLE memory_review_queue ADD COLUMN cooldown_until timestamptz NULL`; `CREATE UNIQUE INDEX memory_review_queue_pending_procedural_promotion_idx ON memory_review_queue (block_id, item_type) WHERE block_id IS NOT NULL AND item_type = 'promote_to_procedural' AND status = 'pending';`.
- `migrations/0371_memory_review_queue_procedural_promotion.down.sql` (NEW) drop index, then columns.
- `server/db/schema/memoryReviewQueue.ts` (MODIFY) extend `MemoryReviewItemType` union with `'promote_to_procedural'`; add `blockId: uuid('block_id')` (nullable); add `cooldownUntil: timestamp('cooldown_until', { withTimezone: true })`; declare the partial unique index in the table builder.
*(Migration 0372 dropped — OQ-2 resolved as "skip version mint". `memory_block_versions` is NOT modified. `memory.block.promoted` event is the audit trail.)*

**Module shape:**
- *Public interface this chunk exposes:* `memory_review_queue.block_id` + `memory_review_queue.cooldown_until` columns + new `item_type = 'promote_to_procedural'` value, all readable / writable through the Drizzle schema. (`memory_block_versions` is not modified — OQ-2 resolved.)
- *What stays hidden behind it:* the partial unique index semantics; the lack of a Postgres enum (the discriminator is text-only via Drizzle `$type`).

**Contracts:**
- `memory_review_queue.block_id` is nullable; existing item types leave it `NULL`; new `'promote_to_procedural'` rows populate it.
- Partial unique index ensures `(block_id, item_type='promote_to_procedural', status='pending')` is unique → `ON CONFLICT DO NOTHING` works.
- RLS: column adds inherit existing `memory_review_queue_organisation_isolation` policy. No new policy. `memory_review_queue` is already in `rlsProtectedTables.ts`.

**Error handling:** Migration runner contract per repo convention.

**Test files:** None.

**Dependencies:** Chunk 1.

**Acceptance criteria:**
- Both migrations apply on local dev.
- Schema mirror compiles.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run db:generate`, local migration apply.

### Chunk 11 — promotion dispatcher + auto job + procedural review-queue integration

**Phase:** 4
**spec_sections:** §6 Phase 4 (Auto-promotion path, Operator-confirmed path, Lineage composition), §8, §9.5, §11.1, §11.4, §14.1–14.7

**Files:**
- `server/services/memoryConsolidationPromotionDispatcher.ts` (NEW) exports:
  - `dispatchPromotionsForTenant(orgId: string, subaccountId: string): Promise<DispatchSummary>` (per-tenant scan + dispatch).
  - `DispatchSummary` = `{ auto_promotions_applied, auto_promotions_attempted_but_lost_race, procedural_promotions_queued, procedural_promotions_skipped_in_cooldown, invalid_transition_skipped, evaluation_errors }`.
- `server/jobs/memoryConsolidationPromotionJob.ts` (NEW) `runMemoryConsolidationPromotion(): Promise<void>` flag-gated; per-tenant iteration; logs `memory.consolidation.promotion_job.completed` (or `.partial` if `evaluation_errors > 0`) with the full DispatchSummary.
- `server/services/memoryReviewQueueService.ts` (MODIFY) add `approvePromoteToProcedural(queueItemId, approverUserId)` and `rejectPromoteToProcedural(queueItemId, rejecterUserId, cooldownDuration)` methods per the canonical transaction order in §6 Phase 4 + §14.7.
- `server/routes/memoryReviewQueue.ts` (MODIFY) extend the existing `approve` / `reject` handlers to route `item_type === 'promote_to_procedural'` rows to the new service methods. Use `ORG_PERMISSIONS.SUBACCOUNTS_EDIT` (the existing approve permission; confirmed in repo at line 53 of the current file).
- `client/src/pages/MemoryReviewQueuePage.tsx` (MODIFY) render the new `promote_to_procedural` card variant. Display: truncated block content, proposed tier transition (currentTier → procedural), `signalContributions`, `totalScore`, `threshold`, source memories (joined via existing lineage path), approve / reject buttons. Copy is plain English per CLAUDE.md (no em-dashes).
- Pg-boss registration: the job is registered in the existing pg-boss schedule file (architect locates at build time, `server/jobs/index.ts` or `server/jobs/registry.ts` per repo convention) with queue name `memory-consolidation-promotion`, schedule `0 * * * *` (hourly).

**Module shape:**
- *Public interface this chunk exposes:*
  - `dispatchPromotionsForTenant(orgId, subaccountId): Promise<DispatchSummary>`.
  - `runMemoryConsolidationPromotion(): Promise<void>` (registered with pg-boss).
  - `memoryReviewQueueService.approvePromoteToProcedural` and `.rejectPromoteToProcedural`.
  - The extended HTTP route variants (no new URL paths; same `/approve` and `/reject` endpoints with new payload branch).
  - The extended UI card variant (no new URL).
- *What stays hidden behind it:*
  - The per-tenant signal-computation SQL (the `agent_run_prompts` JSONB-path predicate join per §9.3).
  - The canonical four-step transaction (validate-transition → guarded UPDATE → commit → outbox emit).
  - The cooldown check that reads the most-recent rejected `memory_review_queue` row.
  - The HTTP-status mapping (200 / 409 / 404 / 403 / 500 per §14.6).
  - The LAEL outbox emission post-commit.
  - The per-cycle counter accumulation and the `.completed` vs `.partial` log-line discriminator.

**Contracts:**
- **Dispatcher per-candidate loop:**
  1. Load candidate row + `consolidation_tier` + `last_accessed_at`.
  2. Compute `signals` per §9.3 (JOIN `agent_run_prompts` on the JSONB-path predicate; `reinforcementCount` = distinct `agent_run_prompts.id`; `crossSessionRecurrence` = distinct `agent_runs.id`; `recency = computeDecayWeight(currentTier, lastAccessedAt, now, config.decayConfig)`).
  3. Read most-recent `memory_review_queue` row for `(block_id, item_type='promote_to_procedural')`; if `cooldown_until > now()`, counter `procedural_promotions_skipped_in_cooldown += 1`, continue.
  4. Call `evaluatePromotion(currentTier, signals, config)`.
  5. If `verdict.shouldPromote === false`, increment counter keyed on `verdict.reason`, continue.
  6. If `verdict.mode === 'operator-approved'`, INSERT into `memory_review_queue` with `ON CONFLICT DO NOTHING`; if inserted, counter `procedural_promotions_queued += 1`. No event yet.
  7. If `verdict.mode === 'auto'`, open `withOrgTx`, run canonical sequence; on success counter `auto_promotions_applied += 1`; on 0-rows race-loss counter `auto_promotions_attempted_but_lost_race += 1`; on exception counter `evaluation_errors += 1`.
- **Canonical auto-promotion sequence inside `withOrgTx`:**
  1. If `!isValidPromotionTransition(verdict.currentTier, verdict.nextTier)`, log `promotion.invalid_transition.skipped`, counter `invalid_transition_skipped += 1`, return without writing.
  2. `UPDATE workspace_memory_entries SET consolidation_tier = $newTier, last_accessed_at = greatest(last_accessed_at, now()) WHERE id = $blockId AND consolidation_tier = $oldTier RETURNING id`.
  3. If 0 rows, log `promotion.race.lost`, abort transaction.
  4. Commit.
  5. Post-commit, best-effort: emit `memory.block.promoted` via `tryEmitAgentEvent`.
- **`approvePromoteToProcedural`:** runs the canonical sequence with a prepended (0) SELECT FOR UPDATE on the pending review-queue row and an appended (6') UPDATE `memory_review_queue SET status='approved', resolved_by_user_id=$approverId, resolved_at=now() WHERE id=$queueItemId AND status='pending'`. HTTP status mapping per §14.6.
- **`rejectPromoteToProcedural`:** UPDATE `memory_review_queue SET status='rejected', resolved_by_user_id=$rejecterId, resolved_at=now(), cooldown_until=now()+$cooldownDuration::interval WHERE id=$queueItemId AND status='pending'`. No tier write. No event emission.
- **Flag OFF:** `runMemoryConsolidationPromotion` exits early. Approve / reject HTTP handlers still function.

**Error handling:**
- Per-tenant dispatch error logged with tenant id; continue with next tenant.
- Per-candidate `evaluatePromotion` exception increments `evaluation_errors`; continue.
- `withOrgTx` rollback on any step; counter; log; continue.
- Approve handler: catches service-thrown `{ statusCode, message, errorCode? }` errors per existing route convention.
- Outbox event emission failure: tier-3 retry per existing `tryEmitAgentEvent` semantics; audit Check 2 surfaces ultimate misses.

**Test files:** None for the dispatcher (side-effect orchestrator; pure logic lives in `evaluatePromotion` and `isValidPromotionTransition` already tested in chunks 9 and 1). If during build a pure helper emerges (e.g. signal-counter accumulation), extract and test per the pure-helper convention.

**Dependencies:** Chunks 1, 2, 4, 5, 7, 9, 10.

**Acceptance criteria:**
- All listed files compile + lint.
- `npm run build:server` succeeds.
- Manual smoke (build time): with flag ON in local dev, run `dispatchPromotionsForTenant` against a seeded fixture; observe at least one auto-promotion firing and one procedural candidate queueing.
- `npm run build:client` succeeds.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npm run build:server`, `npm run build:client`.

### Chunk 12 — Audit script + trend log + capabilities/runbook/architecture docs

**Phase:** 5
**spec_sections:** §6 Phase 5, §8, §9.7, §10.6, §12 G3, §13

**Files:**
- `scripts/audit/audit-memory-consolidation.ts` (NEW) CLI script per §13.1. Args: `--env`, `--warmup-days` (default 14), `--out`, `--trend-log`, `--no-todo-routing`. Implements all seven checks per §13.2. Returns exit code 0 (`pass` or `warn`) or 1 (`fail`).
- `scripts/audit/_logs/.gitkeep` (NEW).
- `.gitignore` (MODIFY) add `scripts/audit/_logs/memory-consolidation-audit-*.json` and `scripts/audit/_logs/memory-consolidation-audit-trend-*.jsonl`.
- `scripts/audit/__tests__/audit-memory-consolidation.test.ts` (NEW) Vitest pure-function tests for per-check verdict computation (extract pure helpers `<checkName>Verdict(input): AuditCheckResult` from the script body), `formatTodoEntry(finding, env, runDate, evidencePath): string`, overall-verdict combination logic. Per spec §6 Phase 5 the `routeTodoEntry` filesystem half is verified by the Phase 5 manual run.
- `scripts/audit/_fixtures/seed-memory-consolidation-audit-fixture.ts` (NEW) operator-run fixture seeder for the first audit invocation. Not part of the audit script itself (keeps the audit purely read-only).
- `docs/runbooks/memory-tiered-consolidation-runbook.md` (NEW) operator runbook per spec §8.
- `architecture.md` (MODIFY) add a section under "Memory & Knowledge" describing the four-tier consolidation model + decay + promotion + audit script. Add audit script to "Key files per domain". Per CLAUDE.md "Docs Stay In Sync With Code."
- `docs/capabilities.md` (MODIFY) register the new capability per finalisation-coordinator §6.2.1.
- `KNOWLEDGE.md` (MODIFY) append the four patterns per spec §8.

**Module shape:**
- *Public interface this chunk exposes:* the CLI command `npx tsx scripts/audit/audit-memory-consolidation.ts [args]`. The JSON output shape `MemoryConsolidationAuditResult`.
- *What stays hidden behind it:* the per-check SQL queries, the per-check verdict thresholds, the trend-log append logic, the `tasks/todo.md` routing logic, the cross-tenant `mv_memory_utility_30d` carve-out (Check 6 only, wrapped in `withAdminConnection` with a named comment per §10.6).

**Contracts:**
- Each check returns `AuditCheckResult = { status: 'pass'|'warn'|'fail'|'n/a', findings: string[], evidence: unknown }`.
- Overall: `pass` iff every check is `pass` or `n/a`; `warn` iff no `fail` and ≥ 1 `warn`; `fail` iff any check `fail`.
- Trend log path default: `scripts/audit/_logs/memory-consolidation-audit-trend-${env}.jsonl`. Append one JSON object per run. Gitignored.
- `fail` findings routed to `tasks/todo.md` under `## Deferred from audit-memory-consolidation` (auto-created if missing). Skipped when `--no-todo-routing` is set.
- Per-tenant checks (1, 2, 3, 4, 5, 7): inside `withOrgTx(orgId, ...)`; RLS enforces tenant boundary; no manual `WHERE organisation_id = $x` predicates.
- Cross-tenant Check 6 ONLY: explicit `withAdminConnection` with a one-line comment naming the cross-tenant aggregate justification per §10.6.

**Seeded fixture for first audit run (locked at plan):**
- 5 seed tenants in local dev (`audit_seed_org_1` through `audit_seed_org_5`).
- Per tenant: 200 `workspace_memory_entries` rows seeded across tiers (60% episodic / 25% semantic / 10% working / 5% procedural) so Check 1 fires `pass` post-warmup.
- Per tenant: 10 `memory.block.promoted` events seeded across the four transitions (Check 2 fires `pass`).
- Per tenant: 50 `agent_run_prompts` rows with retrieval-trace JSONB referencing the seeded blocks within the last 7 days (Check 4 + 5a fire `pass`).
- Per tenant: 10 sampled blocks have `last_accessed_at` within 7d (Check 5b fires `pass`).
- `MEMORY_CONSOLIDATION_TIER_ENABLED=true` for the seed run (Check 7 reports ON).

**Error handling:**
- Per-check exception: check returns `{ status: 'fail', findings: [stringified error], evidence: { error } }`; overall run continues; exit code 1.
- DB connection failure: exit 1 with explanatory log.
- `tasks/todo.md` write failure: logs warning; does NOT fail the audit run.

**Test files:**
- `scripts/audit/__tests__/audit-memory-consolidation.test.ts` covers (minimum): each per-check verdict helper for `pass / warn / fail / n/a`; `formatTodoEntry` produces the templated string; overall-verdict combination correct. Tests do NOT write to a real `tasks/todo.md`.

**Dependencies:** Chunks 1, 5, 7, 11.

**Acceptance criteria:**
- Targeted vitest run passes.
- Manual run against the seeded fixture produces a `pass` JSON result. Exit code 0.
- Trend-log file exists and is parseable JSONL.
- `architecture.md`, `docs/capabilities.md`, `docs/runbooks/memory-tiered-consolidation-runbook.md`, `KNOWLEDGE.md` all updated.

**Verification commands:** `npm run lint`, `npm run typecheck`, `npx vitest run scripts/audit/__tests__/audit-memory-consolidation.test.ts`, `npm run build:server`.

---

## Test Inventory

Pure-function Vitest test files authored across the 12 chunks:

| Test file | Chunk | Minimum cases |
|---|---|---|
| `shared/types/__tests__/memoryConsolidation.test.ts` | 1 | 4 valid transitions true; 6 invalid false; self-loop false; never-exhaustiveness compile assertion |
| `server/services/workspaceMemoryService/__tests__/decayPure.test.ts` | 4 | `working@t=0 → 1`; `working@t=1d,S=3 → ≈0.7165`; `episodic@t=30d,S=14 → ≈0.117`; `semantic@t=30d,S=90 → ≈0.717`; `procedural@t=365d → 1.0`; `null lastAccessedAt → 1.0`; negative `t` clamp → 1.0 |
| `server/services/workspaceMemoryService/__tests__/reinforcementBatchPure.test.ts` | 6 | deduplication by entryId; `shouldFlushByTime`; `shouldFlushByCount`; buffer-cap pruning |
| `server/services/workspaceMemoryService/__tests__/tierMultiplierPure.test.ts` | 7 | each (profile, tier) pair returns locked v1 value; unknown profile → 1.0; unknown tier → 1.0 |
| `server/services/__tests__/memoryBlockSynthesisServicePure.test.ts` | 9 | working→episodic auto; episodic→semantic auto; episodic→procedural operator-approved; semantic→procedural operator-approved; procedural → already_top_tier; below_threshold per tier; configVersion pass-through |
| `scripts/audit/__tests__/audit-memory-consolidation.test.ts` | 12 | per-check verdict helpers (7 checks × `pass`/`warn`/`fail`/`n/a` matrix); `formatTodoEntry` shape; overall-verdict combination |

Runner: **Vitest 2.x** per `docs/testing-conventions.md` and `references/test-gate-policy.md`. No `node:test`, no `node:assert`, no handwritten harnesses, no `npx tsx`-runnable test shapes.

---

## Risks and Mitigations

### Risk 1 — Column placement on the wrong table (RESOLVED)

**OQ-1 resolved as `workspace_memory_entries` (2026-05-18).** This risk is closed. The plan is locked to `workspace_memory_entries` throughout; no conditional file paths remain.

### Risk 2 — Reinforcement-batch buffer leaks under sustained DB failures

**Risk:** If RLS misconfig or transient DB outage prevents flush from completing, the in-process buffer grows unbounded until OOM.

**Mitigation:** Per-tenant buffer cap (5000 entries) with oldest-half pruning + logged warning per Chunk 6. Audit Check 5b reconciles trace activity vs `last_accessed_at` column and surfaces drift, if the batch flusher is silently failing the audit fires `fail` and the operator triages. The cap is a defensive limit, not a normal operating mode.

### Risk 3 — Outbox event emission drops `memory.block.promoted` events

**Risk:** Per spec §14.5, the event is best-effort post-commit. Tier-3 retry may exhaust; the underlying tier change stands but the event never persists. Operators lose visibility.

**Mitigation:** Audit Check 2 reconciles event counts against either (a) `memory_block_versions` rows with `change_source='tier_promotion'` per spec (if OQ-2 = full lineage) or (b) `agent_run_prompts` trace-derived signal-clearance counts (if OQ-2 = skip version mint). Either reconciliation surfaces missing events as `fail`. The promotion-job per-cycle log (`memory.consolidation.promotion_job.completed`) records `auto_promotions_applied` independently so operators have a second signal source even if events drop.

### Risk 4 — Flag-OFF behavioural identity breaks during chunk 7

**Risk:** The Chunk 7 changes to `hybridRetrieval.ts` are subtle (extend the CTE, add a post-fusion lens, rewire the access-counter UPDATE). A regression that changes flag-OFF behaviour silently affects every existing agent run.

**Mitigation:**
- The chunk's acceptance criterion specifically calls for spec-conformance fixture-replay against `getMemoryForPrompt` outputs.
- The chunk's flag-OFF path is the existing code path with one line of additive change (forward the new fields as `null` to the LAEL payload). The post-fusion lens block is wrapped in `if (getMemoryConsolidationTierEnabled()) { ... }` so flag-OFF skips it entirely.
- The synchronous `accessCount + 1` UPDATE rewiring is the riskiest change. Mitigation: keep the existing sync UPDATE intact as the flag-OFF branch and call `recordAccess` ONLY when flag is ON. Slight behavioural asymmetry: flag-ON access-counter increments now happen on a 60-second-delayed flush, not synchronously. Documented in the runbook.
- pr-reviewer is mandatory at branch-level review; this risk is exactly what pr-reviewer should catch.

### Risk 5 — Audit script's first run mis-classifies low-volume tenants as `fail`

**Risk:** Check 1 (tier distribution) flags empty tiers as `fail` post-warmup. A tenant with fewer than 100 blocks but a few weeks of data could trip this even though the tier population is structurally too small to draw signal from.

**Mitigation:** Per spec §13.2 Check 1, the eligibility precondition "≥ 100 total non-deleted blocks per tenant" gates this, sub-threshold tenants return `n/a`. The audit script (Chunk 12) implements the gate as specified. The seeded fixture (5 tenants × 200 blocks) is above the threshold so the first audit run produces actionable signal. Real-tenant low-volume cases are correctly downgraded to `n/a`.

---

## Verification gate posture

Per `references/test-gate-policy.md`:

**Allowed locally per chunk:** `npm run lint`, `npm run typecheck`, `npm run build:server` / `npm run build:client` when relevant, targeted `npx vitest run <single-test-path>` for tests authored in THIS chunk only.

**Forbidden anywhere in this plan:** `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`. CI runs the full battery on PR.

**Executor note (verbatim required by CLAUDE.md):** Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

---

## Files NOT touched

Per spec §8 "Files explicitly NOT in scope":
- `server/services/workspaceMemoryService/graphExpansion.ts`, `dedup.ts`, `enrichmentJob.ts`, `entities.ts`, `extract.ts`, `hydeCache.ts`, `quality.ts`, `read.ts`, `regenerateSummary.ts` — untouched.
- `server/services/memoryBlockLineageService.ts` — NOT called (OQ-2 resolved: skip version mint); never modified.
- `server/services/memoryUtilityQueryService.ts`, `memoryUtilityAggregatorPure.ts`, `memoryUtilityDailySeriesPure.ts` — untouched (audit Check 6 reads `mv_memory_utility_30d` directly).
- `server/services/retrievalService.ts` (AKR chunk-retrieval path) — separate from `workspaceMemoryService`; untouched.
- `server/lib/queryIntent.ts` — locked; no modification.
- `server/config/rlsProtectedTables.ts` — no changes (both target tables already listed).
- `mv_memory_utility_30d` — read-only by audit Check 6.

---

## Phase 2 entry checklist

Per CLAUDE.md feature-coordinator hand-off:

- [x] OQ-1 resolved: `workspace_memory_entries` (2026-05-18, operator confirmation).
- [x] OQ-2 resolved: skip version mint; use `memory.block.promoted` event as audit trail (2026-05-18, operator confirmation). Migration 0372 dropped.
- [x] Locked v1 config values confirmed (decay strengths, signal weights, thresholds, tier multipliers, batch interval, warmup days, cooldown duration — all in "Locked Config Values" section above).
- [ ] Migration numbers 0370 / 0371 still free at chunk 2 / 10 start (re-check at builder time).
- [ ] feature-coordinator dispatches `builder` for Chunk 1.
