**Status:** draft
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18
**Author:** spec-coordinator (Opus + operator decisions captured in `tasks/builds/memory-tiered-consolidation/intent.md`)
**Build slug:** memory-tiered-consolidation
**Source brief:** [`tasks/builds/memory-tiered-consolidation/brief.md`](../../../tasks/builds/memory-tiered-consolidation/brief.md) (v4.0, 2026-05-18)
**Source intent:** [`tasks/builds/memory-tiered-consolidation/intent.md`](../../../tasks/builds/memory-tiered-consolidation/intent.md) (v2 with 9 grill rounds)

# Memory Tiered Consolidation — Spec

Adds a four-tier consolidation lifecycle (`working | episodic | semantic | procedural`) to `memory_blocks`, with Ebbinghaus decay, multi-signal reinforcement-driven tier promotion, batched reinforcement-on-access tracking, and tier-aware retrieval boosting integrated into the existing RRF fusion pipeline. Ships behind a behaviour flag (default OFF in every environment) and gates the flag flip on a new audit script returning `pass` against staging for four consecutive weekly runs.

## Table of contents

1. Lifecycle Declaration
2. ABCd Lifecycle Estimate
3. Goals
4. Non-Goals
5. Framing assumptions
6. Phase plan
7. Phase sequencing (dependency graph)
8. File inventory lock
9. Contracts
10. Permissions / RLS checklist
11. Execution model
12. Locked Guardrails (G1, G2, G3)
13. Audit script specification
14. Execution-safety contracts
15. Testing posture
16. Deferred Items
17. Open Questions
18. Self-consistency pass result

---

## 1. Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Memory & Knowledge |
| Capability owner | ai-agent |
| Lifecycle state on launch | Growth |
| Risk surface | server/db/schema, RLS migrations, agent runtime |
| Review cadence | quarterly (with audit script trend reviewed weekly during behaviour-flag warmup) |

This build registers a new capability row in `docs/capabilities.md` at finalisation (per development-lifecycle-governance-upgrade §6.2). Capability name working title: `Memory Tiered Consolidation`. The existing `memory-knowledge-system` Asset Register row is unchanged; this capability is a distinct extension visible to operators via the procedural-promotion approval queue.

Launch state is `Growth` (not `Inception`) because the underlying `memory_blocks` table is already in production with live data and the new tier behaviour ships behind a flag that defaults OFF — so production traffic exists but the consolidation behaviour stays dormant until per-environment enablement after the audit-script gate.

## 2. ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | Every infrastructure dependency exists: pgvector indexes, RLS three-layer model, pg-boss job runner, RRF fusion, intent classifier, retrieval-trace persistence, behaviour-flag mechanism, LAEL event emission, `memoryBlockReviewQueue` UI. No new infra to acquire. |
| Build | M | Five-phase build: schema + backfill, decay + reinforcement, tier-aware boost, promotion logic, audit script. Multi-week effort across the file set inventoried in §8 (the source-of-truth count; not duplicated here to avoid drift). Audit script + behaviour-flag gating add modest extra surface beyond core consolidation logic. |
| Carry | M | Four-tier model is moderate conceptual surface for future agents to reason about. Reinforcement batch needs operational monitoring (audit check #5). Audit script needs ongoing maintenance and trend interpretation. Per-signal weights and per-transition thresholds tuned post-launch via versioned config. |
| decommission | S | Single behaviour flag turns the entire system off (G1). The `consolidation_tier` column (NOT NULL DEFAULT `'episodic'` per §6 Phase 1) can be dropped via `ALTER TABLE ... DROP COLUMN` if the capability is fully retired — the default makes existing rows safe to drop. Existing `tier smallint` column and all its consumers are untouched and never need cleanup. |

## 3. Goals

1. Add a `consolidation_tier text` column to `memory_blocks` with the four-value enum `working | episodic | semantic | procedural` AND a `last_accessed_at timestamptz` column. Inherit existing RLS policies. Backfill all existing blocks to `episodic`.
2. Replace the 18-line `memoryDecayJob.ts` stub with tier-aware Ebbinghaus decay computed at retrieval time (not write time). The job itself is **logging-only**: it emits structured per-tenant decay-distribution log lines (count of blocks per tier with `last_accessed_at` older than N days). It does NOT mutate `last_accessed_at` — `reinforcementBatch.ts` owns that column. Decay weights are computed inline during `hybridRetrieval.ts` candidate scoring.
3. Introduce a batched reinforcement tracker that flushes access events to `memory_blocks.last_accessed_at` in batches every minute or every N events (architect locks N). Never per-retrieval synchronous writes.
4. Source tier multipliers from `MemoryConsolidationConfig.tierMultipliersByProfile` (single source of truth per §9.2); `server/lib/queryIntent.ts` and its `RETRIEVAL_PROFILES` struct are unchanged. Apply tier-aware multipliers as a post-fusion step in `hybridRetrieval.ts` by looking up `config.tierMultipliersByProfile[profileName]` for the active profile name. Multipliers are part of a versioned retrieval configuration; every retrieval records the config version.
5. Extend `memoryBlockSynthesisService.ts` with a NEW lifecycle-promotion concern, kept architecturally separate from the existing `SynthesisTier` confidence-routing concern. Promotion logic uses three signals (`reinforcementCount`, `crossSessionRecurrence`, `recency` per §9.3 contract) with config-driven additive weighting and per-transition thresholds.
6. Working→episodic and episodic→semantic transitions fire automatically when threshold clears. Episodic→procedural and semantic→procedural require operator confirmation routed through the existing `memoryBlockReviewQueue` infrastructure.
7. Every promotion mints a new `memory_block_versions` row (`change_source = 'tier_promotion'` — new literal added to the existing change_source union; same content as the prior version; bumped `version` number; new `tier_at_capture` column carries the new tier) AND invokes `writeLineageRowsForVersion` with `cluster: []` (tier promotion is a metadata event without workspace-memory sources; the lineage chain is implicit in the version-row sequence per §9.8 (5)). The memory-improvements audit trail continues to capture provenance unchanged for content-edit versions.
8. Register the `memory.block.promoted` event type with payload schema `{ old_tier, new_tier, signal contributions, ... }`. Emit the event as supplementary observability when a `runId` (agent_runs.id FK) is available in the caller's context (per LAEL emission contract). Background-job and HITL-approval contexts that lack `runId` do not emit — the durable `workspace_memory_entry_tier_transitions` row written inside the promotion transaction is the canonical audit trail (per the §6 Phase 4 OQ-2 deviation note). Audit Check 2 reconciles emitted events against `workspace_memory_entry_tier_transitions` rows so missing events surface as a `warn`/`fail` finding. Extend `memory.retrieved` event payload to include the tier of each retrieved block when the behaviour flag is ON; emit `null` for the tier field when the flag is OFF (the null encodes flag-off mode for observability consumers).

> **Accepted Implementation Deviation (2026-05-18):** Goal 8's emit clause is fulfilled by the type registration + durable audit-row pattern. The runtime `tryEmitAgentEvent` call from background-job and HITL contexts is deferred until `AppendEventInput.runId` is made nullable (or a `synthetic` background runId scheme is adopted) AND `AgentExecutionSourceService` is extended to include the new producer literals. Routed to `tasks/todo.md`. Audit Check 2 is the canonical observability path until then.
9. Ship a new audit script at `scripts/audit/audit-memory-consolidation.ts` (exact path per `references/test-gate-policy.md` convention) that runs read-only against any environment, performs seven checks, returns `pass | warn | fail`, appends results to a trend log, and routes `fail` findings into `tasks/todo.md`.
10. Gate the behaviour flag flip in production on the audit script returning `pass` against staging for four consecutive weekly runs.

## 4. Non-Goals

Carried from brief v4.0 (no rebuild list):
- Re-implementing RRF, graph expansion, intent classification, HyDE, reranker, or recency boost — all shipped in `workspaceMemoryService`; extend in place.
- Creating a parallel retrieval module. Tier-aware boosting integrates into the existing `hybridRetrieval.ts` pipeline.
- Altering `memory_block_version_sources` (lineage), `injected_entry_ids` (utility), or AKR semantic ranker shipped by memory-improvements (PR #298). Compose against them; do not rebuild.
- Repurposing the existing `tier smallint` column (F1 baseline artefacts, migration 0277). Path A confirmed: NEW column `consolidation_tier text`; existing `tier` column and its 6+ consumer sites untouched.
- Changing `SynthesisTier` semantics in `memoryBlockSynthesisService.ts` (confidence routing). Lifecycle promotion is a distinct concern; the spec keeps the two architecturally separate.
- New memory write APIs for agents (existing extract pipeline stays the input path).
- Cross-tenant memory sharing of any kind.
- Memory export / import tooling.
- A per-tenant UI for browsing the memory store. The only new operator surface is the procedural-promotion approval row in the existing `MemoryReviewQueuePage.tsx`.
- Replacing the embedding model (`text-embedding-3-small` stays).
- Introducing a new vector DB (pgvector stays).
- Memory-to-RAG integration with external knowledge bases.
- Procedural memory granting autonomous execution authority. Procedural tier feeds prompts; it never bypasses approval or policy gates.

Locked-out scope additions surfaced during grill but explicitly deferred:
- **Tier 5 — explicit `memory_block_edges` graph table** (Round 1). Trigger for revisiting: post-launch audit shows retrieval failures the existing `task_slug` join in `graphExpansion.ts` cannot explain.
- **Four additional reinforcement signals** (contradiction score, agent confidence, operator reinforcement, retrieval-success score) per Round 4. Trigger: their external infrastructure (contradiction detector, LLM self-reporting, operator UI feedback loop) ships independently.
- **Per-tier flag granularity** (separate flags for decay / boost / promotion). Trigger: any subsystem misbehaves and operator needs surgical rollback without losing the others.
- **Operator dashboard for tier-distribution and promotion events** beyond the audit script's CLI/log output. Trigger: post-launch review shows operators need to see tier behaviour directly.
- **Sampled reinforcement** (Round 6 alternative). Trigger: audit shows reinforcement batch updates causing contention at production scale.

## 5. Framing assumptions

These statements are the framing ground truth the spec is authored against. They are cross-referenced against `docs/spec-context.md` to confirm no framing drift before review.

1. **Pre-production codebase.** `live_users: no`, `stage: rapid_evolution`, `rollout_model: commit_and_revert`. Adding a nullable column and a flag-gated subsystem to a table that already has live data is the cheapest time to make this change.
2. **Behaviour flag fits the framing.** `docs/spec-context.md` says `feature_flags: only_for_behaviour_modes`. The flag here gates a behaviour mode (tier-aware vs flat), not a staged rollout, so it conforms.
3. **Test posture is static-gates-primary + pure-function unit tests only.** No new vitest of own app, no API contract tests, no E2E tests of own app. Targeted pure-function tests for decay computation, signal scoring, tier-multiplier application, audit-script check logic.
4. **Existing primitives extend, do not duplicate.** RRF + intent classifier + HyDE + reranker + recency boost in `hybridRetrieval.ts` are foundations; tier-aware multipliers are a thin lens on top. Existing `memoryBlockReviewQueue` UI handles procedural-promotion approvals; no new approval surface.
5. **Composition with memory-improvements (PR #298) is required.** Promotion paths that mint new memory block versions must invoke `writeLineageRowsForVersion`; the existing `injected_entry_ids` and `mv_memory_utility_30d` continue to function unchanged.
6. **Tier column collision resolved at intake.** Path A — new column `consolidation_tier text` coexists with existing `tier smallint` (F1 baseline artefact filtering). No rename, no reuse of existing column.
7. **Operator-confirmed procedural promotion is the v1 posture.** Working→episodic and episodic→semantic fire automatically. Procedural promotion routes through the review queue. Reversibility: if approval rate trends near 100% over 90 days of audit data, the spec's deferred items list "consider relaxing to auto with higher threshold."
8. **Audit script is the durable post-launch governance mechanism.** Replaces calendar-reminder model. Gates flag flip on data, not on dates.

## 6. Phase plan

The build is split into five phases. Each phase ships as one or more builder chunks (architect locks chunk decomposition at plan authoring). Phases are layered so each successive phase consumes the prior phase's outputs but never depends on a later phase.

### Phase 1 — Schema, backfill, observability scaffolding

> **Accepted Implementation Deviation (2026-05-18):** `consolidation_tier` is placed on `workspace_memory_entries`, not `memory_blocks` as written below. The retrieval pipeline (`hybridRetrieval.ts`, `graphExpansion.ts`, `reinforcementBatch.ts`) operates on `workspace_memory_entries`; placing the column on `memory_blocks` would produce unreachable join paths. The spec text contained a table-name error. Operator confirmed `workspace_memory_entries` on 2026-05-18. Every reference to `memory_blocks.consolidation_tier` in this spec means `workspace_memory_entries.consolidation_tier`. Additionally, `last_accessed_at` already exists on `workspace_memory_entries` — the Phase 1 migration does NOT add it again.

**Schema additions** (one migration):
- Add `consolidation_tier text NOT NULL DEFAULT 'episodic'` to `memory_blocks`. The `DEFAULT 'episodic'` covers BOTH backfill (existing rows) AND new-row inserts (extraction does NOT need to set the tier explicitly — Path A: `extract.ts` remains untouched per §8).
- Add `last_accessed_at timestamptz` to `memory_blocks` (nullable).
- Add CHECK constraint: `consolidation_tier IN ('working','episodic','semantic','procedural')` (no `OR IS NULL` clause — the column is `NOT NULL` with a default).
- Add index `memory_blocks_consolidation_tier_idx` on `(organisation_id, subaccount_id, consolidation_tier) WHERE deleted_at IS NULL` for tier-distribution audit queries.

**Backfill** (handled by the `DEFAULT 'episodic'` clause above):
- Adding a `NOT NULL DEFAULT 'episodic'` column on an existing table sets every existing row to `'episodic'` as part of the ALTER. No explicit UPDATE statement is needed; the column default IS the backfill.
- Run-once semantics: migrations in this codebase run exactly once per environment per filename (managed by the existing migration runner). Re-running the migration file is structurally prevented; if attempted manually, Postgres rejects re-adding an existing column with an error — this matches the migration-runner contract.
- Current data volumes are well under the threshold where an `ALTER TABLE ... ADD COLUMN ... DEFAULT` causes a long lock (Postgres ≥ 11 uses a virtual default with no table rewrite for non-volatile defaults). Architect verifies at plan.

**RLS audit:**
- The new column inherits the existing `memory_blocks_organisation_isolation` policy (column-level RLS is not used in this codebase).
- Confirm in spec-conformance step that the existing FORCE ROW LEVEL SECURITY posture continues to apply.
- No new entry in `server/config/rlsProtectedTables.ts` needed (column add to existing protected table).

**Observability scaffolding:**
- Extend `tryEmitAgentEvent` payload schema (in `shared/types/agentExecutionLog.ts`) so each entry of `memory.retrieved.topEntries[]` carries the full §9.6 field set: `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval` (all nullable; all set during Phase 2-3 wiring; in Phase 1 they ship as type extensions only with no candidate-side population).
- Register a new event type: `memory.block.promoted`. Discriminated-union member at `shared/types/agentExecutionLog.ts`. Payload: `{ blockId, organisationId, subaccountId, oldTier, newTier, signalContributions: { reinforcementCount: number, crossSessionRecurrence: number, recency: number }, totalScore, threshold, configVersion, promotionMode: 'auto' | 'operator-approved', approvedByUserId?: string }`.
- Criticality tier for `memory.block.promoted` registered in `AGENT_EXECUTION_EVENT_CRITICALITY` registry. Recommended: `tier-3` (operational, non-critical, retry-on-failure).

**Behaviour flag scaffolding:**
- New env var: `MEMORY_CONSOLIDATION_TIER_ENABLED` (boolean, defaults to `false` in every environment per G1).
- New file `server/config/featureFlags.ts` — this file does NOT currently exist in the repo (verified during spec-review iter 1). Phase 1 creates it with a single exported typed reader `getMemoryConsolidationTierEnabled(): boolean` that reads `process.env.MEMORY_CONSOLIDATION_TIER_ENABLED` and parses the standard truthy values (`'true' | '1' | 'yes'` → `true`; anything else → `false`). The file is set up to host future behaviour-flag readers; the architect may add a thin helper `parseBooleanEnv(name): boolean` if convenient.
- Flag is read at retrieval time and at promotion-job dispatch time; default-OFF means tier-aware boost is skipped and promotion job exits early.

**Phase 1 success criteria:**
- Migration applied; backfill complete; every existing block has `consolidation_tier = 'episodic'`.
- LAEL `memory.retrieved` events include `tier: null` for all entries — this is the **interim** Phase 1 state (the payload type extension is wired through `retrieve.ts` per §8 but no candidate-side tier read is in place yet). The runtime contract per §9.6 — `tier` populated when flag ON post-Phase 2, `null` when flag OFF — is reached after Phase 2 ships.
- Flag defaults `false`; no new behaviour fires.

### Phase 2 — Tier-aware Ebbinghaus decay + reinforcement batch

**Decay function** (pure module):
- New file `server/services/workspaceMemoryService/decayPure.ts`.
- Function `computeDecayWeight(tier: ConsolidationTier, lastAccessedAt: Date | null, now: Date, config: DecayConfig): number`.
- Formula: `weight = exp(-t/S)` where `t = (now - lastAccessedAt) in days` and `S = config.strengthByTier[tier]`.
- Special case: `procedural` tier returns `1.0` regardless of `t` (no automatic decay).
- Special case: `lastAccessedAt === null` returns `1.0` (never accessed — neutral weight).
- Decay config stored in `server/config/memoryConsolidationConfig.ts` as a versioned object (see Contracts §9).

**Replace memoryDecayJob stub:**
- `server/jobs/memoryDecayJob.ts` currently is an 18-line stub. Replace its body with a **logging-only** routine: read the active `MemoryConsolidationConfig` version; for each tenant, emit a structured log line per tier with `(tier, count_total, count_with_lastAccessedAt_within_7d, count_with_lastAccessedAt_older_than_30d, count_with_null_lastAccessedAt)`.
- The job NEVER writes to `memory_blocks` — `reinforcementBatch.ts` is the sole writer to `last_accessed_at`. The job NEVER computes decay weights or mutates scores. Decay weight is computed at retrieval time per Goal 2.
- Schedule: hourly (architect confirms cadence at plan).

**Apply decay at retrieval:**
- Modify `server/services/workspaceMemoryService/hybridRetrieval.ts` to call `computeDecayWeight` on each candidate after RRF fusion (before tier multiplier from Phase 3).
- If flag is OFF, skip both decay and tier multiplier — candidates pass through with their existing RRF scores unchanged.

**Batched reinforcement tracker:**
- New service: `server/services/workspaceMemoryService/reinforcementBatch.ts`.
- API: `recordAccess(blockId: string, organisationId: string, subaccountId: string): void` (sync, non-blocking — adds to in-process buffer).
- Flush trigger: every 60 seconds (architect confirms) OR every N buffered events (architect locks N, recommended 500).
- Flush operation: single `UPDATE memory_blocks SET last_accessed_at = greatest(last_accessed_at, $now) WHERE id = ANY($buffered_ids) AND organisation_id = $orgId AND subaccount_id = $subId` per tenant, scoped via `withOrgTx` for RLS. The explicit `organisation_id` and `subaccount_id` predicates are belt-and-braces: RLS guarantees the org predicate at the policy layer, but stamping both predicates in the SQL documents the per-process buffer-key invariant (the buffer is keyed by `(organisationId, subaccountId)`) and prevents a per-process buffer-key bug from leaking across subaccounts inside the same org.
- Counter `reinforcement_batch_updates_total` and `reinforcement_batch_flush_ms` in structured logs.
- If flag is OFF, `recordAccess` is a no-op (no buffer, no flush).

**Hook reinforcement into retrieval:**
- `hybridRetrieval.ts` calls `recordAccess(candidate.id, ...)` for every candidate returned in the final top-K (post-RRF, post-decay, post-tier-multiplier).
- This is synchronous-call-into-async-buffer, not synchronous DB write — per G6 in operational constraints.

**Phase 2 success criteria:**
- `computeDecayWeight` pure-function unit tests pass (architect-locked test cases — at minimum: working tier decays after 1 day; semantic tier still > 0.9 after 30 days; procedural tier returns 1.0 regardless).
- `memoryDecayJob` runs hourly and emits structured log line; no errors.
- Reinforcement batch flushes successfully under simulated load (pure-function tests of batch-flush logic; integration verified at audit-script run).
- Flag-OFF behaviour identical to pre-Phase-2 (no scores change for any candidate).

### Phase 3 — Tier-aware retrieval boost (post-fusion multiplier)

**Pin tier-multiplier source:**
- The single source of truth for tier multipliers is `MemoryConsolidationConfig.tierMultipliersByProfile` per §9.2. `RETRIEVAL_PROFILES` in `server/lib/queryIntent.ts` is NOT extended with a duplicate `tierMultipliers` field; the profile struct stays as-is. At retrieval time, `hybridRetrieval.ts` reads the active `MemoryConsolidationConfig` (via `MEMORY_CONSOLIDATION_CONFIG_HISTORY.find(c => c.version === ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION)`) and looks up `config.tierMultipliersByProfile[profileName]` for the active profile.
- Default multiplier values per profile locked at spec by architect (initial `version: 1` entry in `MEMORY_CONSOLIDATION_CONFIG_HISTORY`); spec recommends: conversational → boost working; workflow-execution → boost procedural; reporting → boost semantic; neutral default → all 1.0.

**Apply post-fusion multiplier:**
- `hybridRetrieval.ts` — after RRF fusion AND decay weight, apply `candidate.finalScore *= config.tierMultipliersByProfile[profileName][candidate.consolidationTier] ?? 1.0`.
- Record `tierMultiplier` and `memoryConsolidationConfigVersion` per candidate in the retrieval trace.
- If flag is OFF: skip entirely.

**Versioned config:**
- Single config object stored in `server/config/memoryConsolidationConfig.ts`:
  - `version: number` (monotonic; bumped on every change).
  - `decayConfig.strengthByTier: { working, episodic, semantic, procedural }`.
  - `promotionConfig.signalWeights: { reinforcementCount, crossSessionRecurrence, recency }`.
  - `promotionConfig.thresholds: { workingToEpisodic, episodicToSemantic, episodicToProcedural, semanticToProcedural }`.
  - `tierMultipliersByProfile: Record<RetrievalProfileName, { working, episodic, semantic, procedural }>`.
- Retrieval trace records `memoryConsolidationConfigVersion: number` per retrieval (for replayability).

**Phase 3 success criteria:**
- With flag ON in dev, candidate ordering changes consistently with the configured tier multipliers (spot-check via dev fixture).
- Retrieval traces record config version on every retrieval.
- Flag-OFF behaviour identical to Phase 2 end state.

### Phase 4 — Lifecycle promotion logic

**Promotion concern in synthesis service:**
- Extend `server/services/memoryBlockSynthesisService.ts` with a NEW function `evaluatePromotion(block: MemoryBlock, signals: PromotionSignals, config: MemoryConsolidationConfig): PromotionVerdict`.
- Architecturally separate from the existing `decideTier(confidence)` confidence-routing function — they share a file but not call-paths.
- `PromotionSignals` shape: `{ reinforcementCount: number, crossSessionRecurrence: number, recency: number }` — sources per §9.3: `reinforcementCount` and `crossSessionRecurrence` are derived from `agent_run_prompts` JOIN `agent_runs` (the persisted retrieval-trace path); `recency` is the only signal that uses `memory_blocks.last_accessed_at` (it is `computeDecayWeight(...)` evaluated against that timestamp).
- `PromotionVerdict`: `{ shouldPromote: false } | { shouldPromote: true; nextTier: ConsolidationTier; mode: 'auto' | 'operator-approved'; signalContributions: ...; totalScore: number; threshold: number; configVersion: number }`.

**Auto-promotion path (working→episodic, episodic→semantic):**

> **Accepted Implementation Deviation (2026-05-18):** Version mint on `memory_block_versions` is replaced by a transaction-bound INSERT into `workspace_memory_entry_tier_transitions` (new table, migration 0372). This table is the durable ground-truth audit trail for tier promotions. The `memory.block.promoted` LAEL event is supplementary observability. Audit Check 2 reconciles LAEL events against `workspace_memory_entry_tier_transitions` rows. Operator confirmed 2026-05-18.

- New file `server/jobs/memoryConsolidationPromotionJob.ts` (pg-boss queue `memory-consolidation-promotion`).
- Runs hourly (architect confirms cadence). Per tenant, batch-queries `memory_blocks` with non-null `consolidation_tier`, computes signals, calls `evaluatePromotion`, applies auto-promotions inside `withOrgTx`.
- Each auto-promotion (in transactional order inside `withOrgTx`):
  1. Call `isValidPromotionTransition(oldTier, newTier)` (pure helper per §14.7) — if false: skip this candidate, log `promotion.invalid_transition.skipped` with `{ blockId, oldTier, newTier, configVersion }`, and do NOT open or write the promotion transaction. Increment the per-cycle `invalid_transition_skipped` counter per §14.5.
  2. Guarded UPDATE `memory_blocks SET consolidation_tier = $newTier, updated_at = now() WHERE id = $blockId AND consolidation_tier = $oldTier`. If 0 rows updated → race lost; log `promotion.race.lost`; abort the transaction.
  3. **Mint a new `memory_block_versions` row** using the existing columns (verified at `server/db/schema/memoryBlockVersions.ts`) plus the three columns added in the Phase 4 migration: `memory_block_id = $blockId`, `version = previousVersion + 1` (the column is `version`, not `version_number`), `content = previousVersionContent` (the version is a tier-promotion event, not a content edit; carry the prior content forward unchanged), `change_source = 'tier_promotion'`, `tier_at_capture = $newTier`, `old_tier_at_capture = $oldTier`, `config_version_at_capture = ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION`. The mint returns `newBlockVersionId`. *(See deviation note above — replaced by `workspace_memory_entry_tier_transitions` insert in the implementation.)*
  4. Invoke `writeLineageRowsForVersion({ tx, blockVersionId: newBlockVersionId, organisationId, cluster: [], avgQuality: 0 })`. The cluster is **empty** because tier promotion has no workspace-memory source entries — the lineage is implicit in the version chain (per §9.8 (5)). `writeLineageRowsForVersion` returns `{ rowsWritten: 0 }` for an empty cluster (verified at `server/services/memoryBlockLineageService.ts:65-68` — the for-loop is a no-op on empty input). *(See deviation note above — not called in the implementation.)*
- **After commit:** emit `memory.block.promoted` event with `promotionMode: 'auto'` via the existing LAEL outbox pattern (per §14.5). Event emission is best-effort with tier-3 retry; audit Check 2 reconciles `workspace_memory_entry_tier_transitions` rows against emitted events to detect missing events (per deviation note above).
- Idempotency: predicate `AND consolidation_tier = $oldTier` on the UPDATE.

**Operator-confirmed path (episodic→procedural, semantic→procedural):**
- The existing `memory_review_queue` table (verified at `server/db/schema/memoryReviewQueue.ts`) uses `item_type text` (not `decision_type`) as the discriminator and carries item-type-specific data in a JSONB `payload` column. This build EXTENDS the table:
  - Add new `item_type` value `'promote_to_procedural'` (Phase 4 migration; the type is a free-text column typed via `$type<MemoryReviewItemType>()` in Drizzle — no enum `ALTER TYPE` needed; the type-union in `memoryReviewQueue.ts` gains the new literal).
  - Add a new top-level column `block_id uuid NULL` to `memory_review_queue` so tier-promotion rows can be deduped without parsing JSONB. The column is nullable because existing item types (`belief_conflict`, `block_proposal`, `clarification_pending`) do not have a single block id; only `'promote_to_procedural'` populates `block_id`.
- Promotion job inserts a row with `item_type = 'promote_to_procedural'`, `block_id = $candidateBlockId`, `payload = { oldTier, signalContributions, totalScore, threshold, configVersion }`, `confidence = totalScore`, `status = 'pending'`. Insert uses `ON CONFLICT DO NOTHING` against a new partial unique index `memory_review_queue_pending_procedural_promotion_idx ON memory_review_queue (block_id, item_type) WHERE block_id IS NOT NULL AND item_type = 'promote_to_procedural' AND status = 'pending'` so re-running the hourly job against the same candidate produces no duplicates.
- Review queue UI (`MemoryReviewQueuePage.tsx`) renders these alongside existing entries; spec author describes the new card shape in prose (no mockup per Round 9).
- New card displays: block content (truncated), proposed tier transition (current→procedural), signal contributions, total score, threshold, source memories (joined via existing lineage), approve / reject buttons.
- On approve (HTTP route → `memoryReviewQueueService.approvePromoteToProcedural(queueItemId, approverUserId)` per §8). The service runs inside one `withOrgTx` in the **canonical transaction order** (the auto path's four-step promotion-write sequence plus a queue SELECT FOR UPDATE prepended and a queue-approval UPDATE appended — both inside the same transaction): (1) SELECT FOR UPDATE the pending `memory_review_queue` row → (2) call `isValidPromotionTransition($oldTier, 'procedural')` → (3) guarded UPDATE `memory_blocks SET consolidation_tier = 'procedural' WHERE id = $blockId AND consolidation_tier IN ('episodic','semantic') AND consolidation_tier = $oldTier`; 0 rows → race-loss, abort the transaction → (4) mint `memory_block_versions` row with `change_source = 'tier_promotion'`, `tier_at_capture = 'procedural'`, `old_tier_at_capture = $oldTier`, `config_version_at_capture = ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` → (5) invoke `writeLineageRowsForVersion({ tx, blockVersionId, organisationId, cluster: [], avgQuality: 0 })` → (6) mark queue row `status = 'approved'`, `resolvedByUserId = $approverUserId`, `resolvedAt = now()`. After commit, emit `memory.block.promoted` with `promotionMode: 'operator-approved'`, `approvedByUserId`, and `queueItemId`.
- On reject (HTTP route → `memoryReviewQueueService.rejectPromoteToProcedural(queueItemId, rejecterUserId, cooldownDuration)`): mark queue row `status = 'rejected'`; set `cooldown_until = now() + $cooldownDuration` on the same row (no new column on `memory_blocks`; cooldown lives on the review-queue row per §14.3 (b)). `evaluatePromotion` checks the most-recent review-queue row for this `(block_id, item_type = 'promote_to_procedural')` and treats `cooldown_until > now()` as `cooldown_active`. Cooldown duration is in §17 Open Questions (recommended 30 days).

**Lineage composition (G7 framing assumption):**
- Every promotion path (auto AND operator-approved) MUST invoke `writeLineageRowsForVersion` for the promotion event so the `memory_block_version_sources` table continues to capture provenance unchanged. Spec-conformance verifies.

**Phase 4 success criteria:**
- Promotion job runs hourly with flag ON; some blocks auto-promote in dev fixture.
- Procedural candidates queue in `memory_review_queue` and render in the UI.
- `memory.block.promoted` events fire on every successful promotion.
- `writeLineageRowsForVersion` invoked on every promotion path (architect verifies via spec-conformance pass).
- Flag-OFF behaviour identical: promotion job exits early; no promotions; no review-queue entries.

### Phase 5 — Audit script + post-launch governance

**Audit script:**
- New file `scripts/audit/audit-memory-consolidation.ts` (path locked at spec per §13.1).
- CLI args: `--env <env>` (target environment connection string source; defaults to local dev), `--warmup-days <N>` (default 14 — tiers permitted to be empty for the first N days), `--out <path>` (default `scripts/audit/_logs/memory-consolidation-audit-<env>-<ISO-date>.json`).
- Runs read-only against the target database; uses the same `getOrgScopedDb` admin path as existing audit scripts.
- Seven checks per §13 (Audit script specification). Each check returns `{ status: 'pass' | 'warn' | 'fail' | 'n/a', findings: string[], evidence: unknown }` per §9.7.
- Overall return code per §13.3: `pass` (every check is `pass` or `n/a` — `n/a` means the check's eligibility precondition was not met), `warn` (no `fail`; ≥ 1 `warn`), `fail` (any check returns `fail`).
- Appends one result entry per run to a trend log file (JSONL; one line per run).
- For any `fail` finding, writes a `tasks/todo.md` entry with a templated header (mirroring the `audit-runner` convention).

**Flag-flip gate:**
- Spec records: production flag flip MUST NOT happen until the audit script returns `pass` against staging for **4 consecutive weekly runs** (G3).
- This gate is documented in the spec and in the post-launch runbook (architect adds runbook entry at plan or build).
- Operator override requires writing a `REVIEW_GAP` with explicit justification, per CLAUDE.md REVIEW_GAP protocol.

**CI integration:** NOT in v1 scope. The audit script is operator-run from a local terminal in v1. Weekly CI integration is recorded in §16 Deferred Items as a follow-up.

**Phase 5 success criteria:**
- Audit script runs end-to-end against local dev with flag OFF, returns expected results (warmup tier-empty findings expected; promotion-firing zero findings expected; reinforcement updates zero findings expected; flag-state check confirms OFF).
- Audit script runs end-to-end against local dev with flag ON, returns expected results after seeded test data.
- Trend log written; structure parseable.
- The audit script splits the todo-routing path into two functions: `formatTodoEntry(finding): string` (pure) and `routeTodoEntry(text, path): void` (filesystem i/o). Vitest covers `formatTodoEntry` only — never writes to a real `tasks/todo.md` during tests. The `routeTodoEntry` half is verified by the Phase 5 manual audit run.

## 7. Phase sequencing (dependency graph)

Phases are strictly layered. Each phase consumes ONLY the prior phase's outputs.

| Phase | Depends on | Outputs |
|---|---|---|
| 1 | Nothing (greenfield in scope) | `consolidation_tier` column + `last_accessed_at` column + backfill + RLS audit + LAEL tier field + `memory.block.promoted` event registered + flag scaffolding |
| 2 | Phase 1 (column + flag) | `decayPure.ts` + replaced `memoryDecayJob.ts` + `reinforcementBatch.ts` + retrieval-time decay application in `hybridRetrieval.ts` |
| 3 | Phase 2 (decay in place) | Versioned `memoryConsolidationConfig.ts` with `tierMultipliersByProfile` (sole source of truth per §9.2; `queryIntent.ts` unchanged) + post-fusion multiplier in `hybridRetrieval.ts` + config-version recording on retrieval traces |
| 4 | Phase 3 (config in place) | `evaluatePromotion` in `memoryBlockSynthesisService.ts` + `memoryConsolidationPromotionJob.ts` + procedural-promotion review queue integration + `writeLineageRowsForVersion` composition |
| 5 | Phase 4 (full system in place) | `scripts/audit/audit-memory-consolidation.ts` + trend log + `fail`-to-todo routing + post-launch runbook entry |

**No backward dependencies.** Phase N never references a column / table / service introduced in Phase N+k.
**No orphaned deferrals.** Every deferred item is in §16. Every "later" / "Phase N+1 will" prose reference points at a §16 entry.
**No phase-boundary contradictions.** Three migrations total — Phase 1 owns the `memory_blocks` column-add migration; Phase 4 owns the `memory_review_queue` columns + partial unique index migration; Phase 4 also owns the `memory_block_versions` columns migration (`tier_at_capture` + `old_tier_at_capture` + `config_version_at_capture` — required by the Phase 4 promotion path and by audit Check 2 reconciliation). Each migration is locked to its phase per §8 to preserve the no-backward-dependencies rule (Phase 4 is where every consumer of those columns lands).

## 8. File inventory lock

Every file the build touches is listed below with its phase and reason. Spec-conformance verifies that every file in the implementation set appears here, and every entry here is touched by the implementation. New entries added during build require a spec amendment.

### Schema files

| File | Phase | Action | Reason |
|---|---|---|---|
| `server/db/schema/memoryBlocks.ts` | 1 | Modify | Add `consolidationTier text('consolidation_tier').$type<ConsolidationTier>().notNull().default('episodic')` and `lastAccessedAt timestamp('last_accessed_at', { withTimezone: true })` columns + index `memory_blocks_consolidation_tier_idx`. |
| `server/db/migrations/<NNNN>_memory_consolidation_tier.sql` | 1 | New | `ALTER TABLE memory_blocks ADD COLUMN consolidation_tier text NOT NULL DEFAULT 'episodic' CHECK (consolidation_tier IN ('working','episodic','semantic','procedural'))`; `ALTER TABLE memory_blocks ADD COLUMN last_accessed_at timestamptz`; create the partial index. Backfill is implicit in the column default — no explicit UPDATE statement. Number `<NNNN>` allocated at builder time per existing convention. |
| `server/db/migrations/<NNNN>_memory_consolidation_tier.down.sql` | 1 | New | `DROP INDEX IF EXISTS memory_blocks_consolidation_tier_idx;` then `ALTER TABLE memory_blocks DROP COLUMN IF EXISTS consolidation_tier, DROP COLUMN IF EXISTS last_accessed_at;`. Drop the index BEFORE the columns (the partial index is defined on `consolidation_tier`; dropping the column first would force an implicit index drop with non-deterministic ordering). Idempotent per repo convention. |
| `server/db/schema/memoryBlockVersions.ts` | 4 | Modify | Extend the `change_source` Drizzle `$type<...>()` union with `'tier_promotion'` literal. Add three new nullable columns: `tierAtCapture: text('tier_at_capture').$type<ConsolidationTier \| null>()` (the NEW tier for `change_source = 'tier_promotion'` rows; null for content-edit rows); `oldTierAtCapture: text('old_tier_at_capture').$type<ConsolidationTier \| null>()` (the PRIOR tier for `change_source = 'tier_promotion'` rows; null for content-edit rows — required because content-edit versions in the history chain may not have a tier marker, so the promotion row must carry both old and new tier explicitly); `configVersionAtCapture: integer('config_version_at_capture')` (populated for `tier_promotion` rows; null for content-edit). All three required by audit Check 2 reconciliation per §13. |
| `server/db/migrations/<NNNN>_memory_block_versions_tier_promotion.sql` | 4 | New | `ALTER TABLE memory_block_versions ADD COLUMN tier_at_capture text NULL CHECK (tier_at_capture IS NULL OR tier_at_capture IN ('working','episodic','semantic','procedural'))`; `ALTER TABLE memory_block_versions ADD COLUMN old_tier_at_capture text NULL CHECK (old_tier_at_capture IS NULL OR old_tier_at_capture IN ('working','episodic','semantic','procedural'))`; `ALTER TABLE memory_block_versions ADD COLUMN config_version_at_capture integer NULL`. The `change_source` column is `text` typed via Drizzle (verified at `memoryBlockVersions.ts:26-28`) — no Postgres enum to alter; the new literal lands via the type-union only. |
| `server/db/migrations/<NNNN>_memory_block_versions_tier_promotion.down.sql` | 4 | New | `ALTER TABLE memory_block_versions DROP COLUMN IF EXISTS config_version_at_capture, DROP COLUMN IF EXISTS old_tier_at_capture, DROP COLUMN IF EXISTS tier_at_capture;`. |

### Shared type definitions

| File | Phase | Action | Reason |
|---|---|---|---|
| `shared/types/agentExecutionLog.ts` | 1 | Modify | Extend `memory.retrieved` payload type per §9.6: add `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval` (all nullable) on each `topEntries[]` entry. Add new `memory.block.promoted` discriminated-union member per §9.5 (with canonical idempotency key implied by `(blockId, oldTier, newTier, configVersion)` per §14.4). Add `AGENT_EXECUTION_EVENT_CRITICALITY` registry entry (`tier-3`) for the new event. |
| `shared/types/memoryConsolidation.ts` | 1 | New | Export `ConsolidationTier`, `MemoryConsolidationConfig`, `PromotionSignals`, `PromotionVerdict`, and `MemoryConsolidationAuditResult` types. ALSO exports pure helper `isValidPromotionTransition(oldTier, newTier): boolean` per §14.7 — used by every tier-write path and by §13 Check 2. Shared between server runtime, audit script, and tests. |

### Config files

| File | Phase | Action | Reason |
|---|---|---|---|
| `server/config/featureFlags.ts` | 1 | **New** | File does NOT currently exist (verified spec-review iter 1). Create with exported `getMemoryConsolidationTierEnabled(): boolean` reading `MEMORY_CONSOLIDATION_TIER_ENABLED` env var (defaults `false`). Designed to host future flag readers. |
| `server/config/memoryConsolidationConfig.ts` | 3 | New | Versioned config: `{ version, decayConfig.strengthByTier, promotionConfig.signalWeights, promotionConfig.thresholds, tierMultipliersByProfile }`. Read at runtime by retrieval, decay, promotion job, and audit script. Initial values are architect-locked at plan; tuning appends to `MEMORY_CONSOLIDATION_CONFIG_HISTORY: MemoryConsolidationConfig[]` AND updates `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number` (both exported from this file). All consumers select the active config via the integer selector per §9.2. |
| `server/lib/queryIntent.ts` | — | **Not modified** | `RetrievalProfile` struct stays as-is. Tier multipliers are sourced from `MemoryConsolidationConfig.tierMultipliersByProfile[profileName]` per §9.2 (single source of truth). The profile name is read from `queryIntent.ts`; the multipliers are read from `memoryConsolidationConfig.ts`. |

### Service layer

| File | Phase | Action | Reason |
|---|---|---|---|
| `server/services/workspaceMemoryService/hybridRetrieval.ts` | 2, 3 | Modify | Phase 2: apply `computeDecayWeight` to each candidate after RRF fusion; record `decayWeight` in retrieval trace. Phase 3: apply `tierMultipliers[candidate.consolidationTier]` after decay; record `tierMultiplier` and `memoryConsolidationConfigVersion` in trace. Hook `recordAccess` for top-K candidates. Skip all of this if flag is OFF. |
| `server/services/workspaceMemoryService/retrieve.ts` | 1 | Modify | Phase 1 work is **plumbing only**: extend the candidate shape forwarded to `tryEmitAgentEvent` with the new §9.6 fields (`tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval`) — all emitted as `null` in Phase 1 (no candidate-side reads yet). Phase 2 wires the actual `tier` value (read from the new column); Phase 3 wires the `decayWeight` / `tierMultiplier` values when the flag is ON. |
| `server/services/workspaceMemoryService/decayPure.ts` | 2 | New | `computeDecayWeight(tier, lastAccessedAt, now, config): number` pure function. Decay formula `exp(-t/S)` with tier-specific `S`. Special cases: procedural → 1.0; null lastAccessedAt → 1.0. |
| `server/services/workspaceMemoryService/reinforcementBatch.ts` | 2 | New | Batched access tracker. API `recordAccess(blockId, organisationId, subaccountId)`. Internal in-process buffer keyed by `(organisationId, subaccountId)`. Flush every 60s or every N events. Single UPDATE per tenant inside `withOrgTx`. No-op if flag is OFF. |
| `server/services/memoryBlockSynthesisService.ts` | 4 | Modify | Add `evaluatePromotion(block, signals, config): PromotionVerdict`. Architecturally distinct from existing `decideTier(confidence)` confidence-routing function. No changes to existing function. |
| `server/services/memoryConsolidationPromotionDispatcher.ts` | 4 | New | Helper invoked by promotion job. For each candidate: compute `PromotionSignals` via composed queries (per §9.3), call `evaluatePromotion`. Auto-promotions execute the full transactional sequence per §6 Phase 4 inside `withOrgTx`: `isValidPromotionTransition` → guarded UPDATE on `memory_blocks` → mint `memory_block_versions` row (`change_source = 'tier_promotion'`, `tier_at_capture`, `old_tier_at_capture`, `config_version_at_capture`) → `writeLineageRowsForVersion(cluster: [])`. After commit, emit `memory.block.promoted` via the LAEL outbox (post-commit, best-effort). Procedural candidates are dispatched into `memory_review_queue` per §6 Phase 4 (insert with `ON CONFLICT DO NOTHING` against the partial unique index). |

### Job layer

| File | Phase | Action | Reason |
|---|---|---|---|
| `server/jobs/memoryDecayJob.ts` | 2 | Replace (18-line stub) | Hourly **logging-only** job — emits structured per-tenant per-tier decay-distribution log lines (per §6 Phase 2 + §11.1). Never mutates `memory_blocks` (`reinforcementBatch.ts` owns `last_accessed_at`); never computes decay weights or mutates scores (those are retrieval-time). The stub today does nothing functional so replacement is low-risk. |
| `server/jobs/memoryConsolidationPromotionJob.ts` | 4 | New | Hourly pg-boss queue `memory-consolidation-promotion`. Per-tenant scan via the dispatcher above. Idempotency: optimistic predicate `WHERE consolidation_tier = $oldTier`. Exits early if flag is OFF. |

### Review-queue integration

| File | Phase | Action | Reason |
|---|---|---|---|
| `server/db/schema/memoryReviewQueue.ts` | 4 | Modify | Extend the `MemoryReviewItemType` union with `'promote_to_procedural'` (the column is text + `$type<...>()` — no Postgres enum to alter). Add new top-level column `blockId: uuid('block_id')` (nullable) on the table; carries the promoted block's id for `promote_to_procedural` rows. Add `cooldownUntil: timestamp('cooldown_until', { withTimezone: true })` (nullable; used by rejected procedural-promotion rows per §14.3 (b)). Existing RLS policies cover. Migration is owned by Phase 4 (not folded into Phase 1) to preserve the "no backward dependencies" rule per §7. |
| `server/db/migrations/<NNNN>_memory_review_queue_procedural_promotion.sql` | 4 | New | `ALTER TABLE memory_review_queue ADD COLUMN block_id uuid NULL`; `ALTER TABLE memory_review_queue ADD COLUMN cooldown_until timestamptz NULL`; create partial unique index `CREATE UNIQUE INDEX memory_review_queue_pending_procedural_promotion_idx ON memory_review_queue (block_id, item_type) WHERE block_id IS NOT NULL AND item_type = 'promote_to_procedural' AND status = 'pending'`. (No `ALTER TYPE` — the discriminator is `text` not a Postgres enum; the new value enters the codebase via the Drizzle type-union only.) |
| `server/db/migrations/<NNNN>_memory_review_queue_procedural_promotion.down.sql` | 4 | New | `DROP INDEX IF EXISTS memory_review_queue_pending_procedural_promotion_idx; ALTER TABLE memory_review_queue DROP COLUMN IF EXISTS cooldown_until, DROP COLUMN IF EXISTS block_id;`. |
| `client/src/pages/MemoryReviewQueuePage.tsx` | 4 | Modify | Render the new `promote_to_procedural` card variant. Display: block content (truncated), proposed tier transition, signal contributions, total score, threshold, source memories (via existing lineage join), approve / reject buttons. No mockup per Round 9; spec author describes shape; spec-reviewer / chatgpt-spec-review surfaces UX gaps. |
| `server/services/memoryReviewQueueService.ts` | 4 | Modify | Add two methods extending the existing service: `approvePromoteToProcedural(queueItemId, approverUserId)` — runs the full transaction in the canonical order per §6 Phase 4 + §14.7: SELECT FOR UPDATE pending row → `isValidPromotionTransition` → guarded UPDATE on `memory_blocks` (predicate `consolidation_tier IN ('episodic','semantic') AND consolidation_tier = $oldTier`; 0 rows = abort) → mint `memory_block_versions` row (`change_source = 'tier_promotion'`, `tier_at_capture`, `old_tier_at_capture`, `config_version_at_capture`) → `writeLineageRowsForVersion(cluster: [])` → mark queue row `status = 'approved'`, `resolvedByUserId = $approverUserId`, `resolvedAt = now()` — all inside `withOrgTx`; post-commit emits `memory.block.promoted` via outbox. `rejectPromoteToProcedural(queueItemId, rejecterUserId, cooldownDuration)` — marks queue row `status = 'rejected'`, sets `cooldown_until = now() + $cooldownDuration`. Both methods preserve the existing approve/reject error semantics for other `item_type` values. |
| `server/routes/memoryReviewQueue.ts` (or equivalent existing route file — architect verifies) | 4 | Modify | Thin HTTP shim: route the `promote_to_procedural` approve / reject requests to `memoryReviewQueueService.approvePromoteToProcedural` / `.rejectPromoteToProcedural`. HTTP-status mapping per §14.6. |

### Audit script

| File | Phase | Action | Reason |
|---|---|---|---|
| `scripts/audit/audit-memory-consolidation.ts` | 5 | New | CLI script per §13. Read-only against target env; 7 checks; `pass / warn / fail`; appends to trend log; routes `fail` findings to `tasks/todo.md`. |
| `scripts/audit/_logs/.gitkeep` | 5 | New | Trend-log directory placeholder. Trend log files at `scripts/audit/_logs/memory-consolidation-audit-<env>-<ISO-date>.json` excluded from git via `.gitignore` entry. |
| `.gitignore` | 5 | Modify | Add `scripts/audit/_logs/memory-consolidation-audit-*.json` and `scripts/audit/_logs/memory-consolidation-audit-trend-*.jsonl` to ignore list. |

### Tests

| File | Phase | Action | Reason |
|---|---|---|---|
| `shared/types/__tests__/memoryConsolidation.test.ts` | 1 | New | Vitest pure-function tests for `isValidPromotionTransition`. Minimum cases: four valid transitions return true; six invalid (reverse, skip, terminal, self-loop) return false; exhaustiveness of the `ConsolidationTier` enum is asserted via TypeScript `never` typing in a switch arm. |
| `server/services/workspaceMemoryService/__tests__/decayPure.test.ts` | 2 | New | Vitest pure-function tests for `computeDecayWeight`. Architect locks test cases; minimum: working decays in days; semantic still > 0.9 at 30 days; procedural returns 1.0 always; null lastAccessedAt returns 1.0. |
| `server/services/__tests__/memoryBlockSynthesisServicePure.test.ts` (extend existing if present, or new) | 4 | New / Modify | Vitest pure-function tests for `evaluatePromotion`: signal-additive scoring, threshold-clearing, per-transition routing, config-version pass-through, multi-tier promotion paths. |
| `server/services/__tests__/reinforcementBatchPure.test.ts` | 2 | New | Vitest pure-function tests for the batch's deduplication-by-blockId and `greatest(last_accessed_at, $now)` semantics. The flush trigger logic (timer + count) is tested via a controllable time / counter injection. |
| `server/services/workspaceMemoryService/__tests__/tierMultiplierPure.test.ts` | 3 | New | Vitest pure-function tests for the tier-multiplier application logic — `applyTierMultiplier(candidate, config, profileName): number` — verifying multipliers from `MemoryConsolidationConfig.tierMultipliersByProfile` are looked up by profile name and applied multiplicatively per `consolidationTier`. (Replaces the earlier plan to test `queryIntent.ts` — the multipliers now live in the consolidation config, not on the retrieval profile.) |
| `scripts/audit/__tests__/audit-memory-consolidation.test.ts` | 5 | New | Vitest pure-function tests for the audit script's per-check logic: tier-distribution flagging, promotion-firing detection, signal-distribution check, decay-drift sampling, reinforcement-update detection, citation-trend comparison, flag-state reporting, `fail`-routing to `tasks/todo.md`. |

### Documentation

| File | Phase | Action | Reason |
|---|---|---|---|
| `architecture.md` | 5 | Modify | Add a section under "Memory & Knowledge" describing the four-tier consolidation model + decay + promotion + audit script. Add audit script to "Key files per domain". |
| `docs/runbooks/memory-tiered-consolidation-runbook.md` | 5 | **New** | Operator runbook: how to invoke the audit script, how to interpret each check's `pass / warn / fail / n/a` output, the flag-flip checklist (four committed staging snapshots per §12 G3), how to triage a `fail`-routed `tasks/todo.md` entry, how to write a `REVIEW_GAP` override at the documented path per §12 G3. Phase 5 deliverable (`finalisation-coordinator` may also touch). |
| `docs/capabilities.md` | 5 | Modify (finalisation-coordinator handles) | Register new capability `Memory Tiered Consolidation`, Memory & Knowledge cluster, Growth lifecycle state, owner `ai-agent`, risk surface per §1, review cadence quarterly + weekly during warmup. Per development-lifecycle-governance-upgrade §6.2.1 verdict format. |
| `KNOWLEDGE.md` | 5 | Modify | Append patterns surfaced: (a) "always compute decay at retrieval time, never at write time," (b) "batched reinforcement-on-access tracking with single-UPDATE-per-tenant," (c) "promotion-event signal-contribution payload shape for audit signal-distribution checks," (d) "behaviour-flag default-OFF + audit-script gate as the canonical pre-launch governance pattern." |
| `docs/spec-context.md` | n/a | No change | Framing already covers behaviour flags as legitimate for behaviour modes; no new framing introduced. |
| `references/test-gate-policy.md` | n/a | No change unless architect determines audit script needs a CI integration (deferred per Phase 5 spec) | If CI integration ships, add the audit script as a recurring CI job; otherwise unchanged. |

### Files explicitly NOT in scope

To prevent file-inventory drift, the spec records files that are GLOSSED over in prose but explicitly NOT touched:

- `server/services/workspaceMemoryService/graphExpansion.ts` — existing graph layer; untouched (Tier 5 deferred per Round 1).
- `server/services/workspaceMemoryService/dedup.ts`, `enrichmentJob.ts`, `entities.ts`, `extract.ts`, `hydeCache.ts`, `quality.ts`, `read.ts`, `regenerateSummary.ts` — existing modules; untouched.
- `server/services/memoryBlockLineageService.ts` — composed against (called by promotion paths via existing `writeLineageRowsForVersion`); not modified.
- `server/services/memoryUtilityQueryService.ts`, `memoryUtilityAggregatorPure.ts`, `memoryUtilityDailySeriesPure.ts` — memory-improvements utility-metric services; untouched (downstream consumers of consolidation work).
- `server/services/retrievalService.ts` — AKR (auto-knowledge-retrieval) chunk-retrieval path; SEPARATE from `workspaceMemoryService`; untouched.
- `mv_memory_utility_30d` materialised view — read by audit check #6; not modified.
- `server/config/rlsProtectedTables.ts` — `memory_blocks` already listed; not modified (column add inherits existing protection).

### Inventory count reconciliation

Per spec-authoring-checklist §8 numeric-count grep:

| Count claim | Section | Reconciled value |
|---|---|---|
| "five phases" | §6, §7 | 5 (Phase 1 through Phase 5) |
| "two columns" (added to `memory_blocks`) | §6 Phase 1, §8 | 2 (`consolidation_tier`, `last_accessed_at`) |
| "three signals" | §3 Goal 5, §6 Phase 4, §9.3, intent.md Round 4 | 3 — contract names per §9.3: `reinforcementCount`, `crossSessionRecurrence`, `recency` (snake_case `reinforcement_count` / `cross_session_recurrence` in earlier prose are aliases for the same fields). |
| "four tier transitions" | §6 Phase 4 | 4 (working→episodic, episodic→semantic, episodic→procedural, semantic→procedural) |
| "seven checks" (audit script) | §3 Goal 9, §6 Phase 5, §13 | 7 (tier distribution, promotion firing, signal contributions, decay applied, reinforcement updates, citation trend, flag state) |
| "four consecutive weekly runs" (flag-flip gate) | §3 Goal 10, §6 Phase 5, §12 G3 | 4 |
| "3 migrations" total | §6 Phase 1, §6 Phase 4, §8 | 3 — Phase 1 column-add migration (`memory_blocks` columns + index); Phase 4 review-queue migration (`block_id` + `cooldown_until` columns + partial unique index); Phase 4 `memory_block_versions` migration (`tier_at_capture` + `old_tier_at_capture` + `config_version_at_capture` columns). Migrations are owned by their respective phases per §7 dependency rules. |
| "2 jobs" (decay + promotion) | §6 Phases 2, 4, §8 | 2 (`memoryDecayJob.ts` replace + `memoryConsolidationPromotionJob.ts` new) |

## 9. Contracts

Every data shape that crosses a service boundary or is consumed by a parser is pinned below with type, example, nullability rules, producer, and consumer.

### 9.1 `ConsolidationTier`

- **Name:** `ConsolidationTier`
- **Type:** TypeScript discriminated union → `'working' | 'episodic' | 'semantic' | 'procedural'`
- **Storage type (Postgres):** `text NOT NULL DEFAULT 'episodic'` with CHECK constraint `consolidation_tier IN ('working','episodic','semantic','procedural')`. The column is never null at the application layer — backfill + new-row default both land at `'episodic'`.
- **Nullable:** no at the column level. The column is `NOT NULL DEFAULT 'episodic'`. Both backfill (existing rows on ALTER) and new-row inserts (extraction does not set the tier; the default applies) land at `'episodic'`. Promotion is the only path that changes the tier post-insert.
- **Producer:** schema column default (sets `'episodic'` for all rows — existing on ALTER, new on INSERT); promotion job + procedural-approval handler (mutates tier on promotion). `extract.ts` is NOT a producer per §8 — it remains untouched and benefits from the column default.
- **Consumer:** `hybridRetrieval.ts` (reads to apply tier-multiplier post-fusion), `decayPure.ts` (reads to select decay strength), `evaluatePromotion` (reads to determine eligible next tier), `tryEmitAgentEvent` payload (records per-retrieval), audit script check #1 (counts distribution).
- **Example:** `'working'`.

### 9.2 `MemoryConsolidationConfig`

- **Name:** `MemoryConsolidationConfig`
- **Type:** TypeScript record (immutable) and JSON-shape if serialised.
- **Schema:**

```typescript
type MemoryConsolidationConfig = {
  version: number;
  decayConfig: {
    strengthByTier: {
      working: number;
      episodic: number;
      semantic: number;
      procedural: number;
    };
  };
  promotionConfig: {
    signalWeights: {
      reinforcementCount: number;
      crossSessionRecurrence: number;
      recency: number;
    };
    thresholds: {
      workingToEpisodic: number;
      episodicToSemantic: number;
      episodicToProcedural: number;
      semanticToProcedural: number;
    };
  };
  tierMultipliersByProfile: Record<RetrievalProfileName, {
    working: number;
    episodic: number;
    semantic: number;
    procedural: number;
  }>;
};
```

- **Example instance:**

```json
{
  "version": 1,
  "decayConfig": {
    "strengthByTier": { "working": 3, "episodic": 14, "semantic": 90, "procedural": 999999 }
  },
  "promotionConfig": {
    "signalWeights": { "reinforcementCount": 0.5, "crossSessionRecurrence": 0.3, "recency": 0.2 },
    "thresholds": {
      "workingToEpisodic": 3.0,
      "episodicToSemantic": 8.0,
      "episodicToProcedural": 15.0,
      "semanticToProcedural": 15.0
    }
  },
  "tierMultipliersByProfile": {
    "conversational": { "working": 1.4, "episodic": 1.0, "semantic": 0.9, "procedural": 0.8 },
    "workflow_execution": { "working": 0.9, "episodic": 1.0, "semantic": 1.0, "procedural": 1.5 },
    "reporting": { "working": 0.9, "episodic": 1.1, "semantic": 1.3, "procedural": 0.9 },
    "neutral": { "working": 1.0, "episodic": 1.0, "semantic": 1.0, "procedural": 1.0 }
  }
}
```

The numbers above are **illustrative only** — architect locks initial values at plan after eval-set spot-checks. Spec contract pins the SHAPE, not the values.

- **Nullable:** no — config is always-present at runtime; build fails if missing.
- **Producer:** `server/config/memoryConsolidationConfig.ts` (single source of truth in-source). The file exports `MEMORY_CONSOLIDATION_CONFIG_HISTORY: MemoryConsolidationConfig[]` (append-only, indexed by `version`) AND `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number` (the single integer that picks the active entry). All consumers select the active config via `MEMORY_CONSOLIDATION_CONFIG_HISTORY.find(c => c.version === ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION)`; never by `slice(-1)[0]` or other implicit selection. Bumping the active version is a deliberate two-line code edit: append a new history entry, then update `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION`.
- **Consumer:** `hybridRetrieval.ts`, `decayPure.ts`, `evaluatePromotion`, `memoryConsolidationPromotionJob.ts`, audit script (all 7 checks reference config to compute expected values).

### 9.3 `PromotionSignals`

- **Name:** `PromotionSignals`
- **Type:** TypeScript record.
- **Schema:**

```typescript
type PromotionSignals = {
  reinforcementCount: number;       // count of distinct `agent_run_prompts` rows in the lookback window where this block id appears in the `memory.retrieved` topEntries[]
  crossSessionRecurrence: number;   // count of distinct `agent_runs.id` values in the lookback window where this block id appears (i.e. distinct runs, not distinct retrievals)
  recency: number;                  // exp(-t/S) where t = days since `memory_blocks.last_accessed_at`; S = config.decayConfig.strengthByTier[currentTier]
};
```

- **Source-of-truth note:** both counts are derived from `agent_run_prompts` (the existing persisted retrieval-trace path; `agentRunPromptService` is the producer per `docs/spec-context.md` accepted_primitives) JOINed to `agent_runs`. The `memory_blocks.last_accessed_at` column tracks LATEST access only and CANNOT produce a count or distinct-run count — the trace source is the only correct origin for the count signals. The `last_accessed_at` column remains the source for `recency` only (because `recency` is "how long ago", not "how many times").
- **Producer:** `memoryConsolidationPromotionDispatcher.ts` computes both counts via a `SELECT COUNT(*) FILTER (WHERE ...)` join on `agent_run_prompts` and `agent_runs`, filtered by tenant, by lookback-window, and by presence of `$blockId` in the persisted retrieval trace. The persisted trace shape per §9.6 includes `memory.retrieved.topEntries[]` — each entry is an object with a `blockId: string` field. The JSONB-path predicate is `EXISTS (SELECT 1 FROM jsonb_array_elements(agent_run_prompts.payload -> 'memory.retrieved' -> 'topEntries') AS entry WHERE entry ->> 'blockId' = $blockId)` (architect verifies the exact `agent_run_prompts.payload` envelope shape at plan; recommend a GIN index on `agent_run_prompts.payload` if the existing index does not already cover the predicate). Calls `computeDecayWeight` for the `recency` value.
- **Consumer:** `evaluatePromotion` (combines via additive weighted sum).
- **Lookback window:** architect locks at plan (recommend 30 days for `reinforcementCount` and `crossSessionRecurrence`; matches the window used by `mv_memory_utility_30d`).
- **Nullable:** no — every signal is computable; absent data computes as 0.

> **Accepted Implementation Deviation (2026-05-18):** The v1 implementation computes `reinforcementCount` and `crossSessionRecurrence` using the proxy columns `workspace_memory_entries.access_count` and `workspace_memory_entries.cited_count` (incremented by `reinforcementBatch.ts`) rather than the `agent_run_prompts` JSONB join specified above. The JSONB-path predicate approach (joining `agent_run_prompts` → `agent_runs` filtered by presence of `$blockId` in `memory.retrieved.topEntries[]`) could not be implemented in v1 because the `agent_run_prompts.payload` envelope shape was not confirmed compatible with the `memory.retrieved` event shape at plan time, and no GIN index covering the predicate exists on `agent_run_prompts.payload`. The proxy-column approach is a valid approximation for v1: `access_count` is an access-frequency proxy for `reinforcementCount`; `cited_count` is a cross-session proxy for `crossSessionRecurrence`. Both columns are maintained by the batched reinforcement path, making them structurally equivalent for promotion scoring. The `agent_run_prompts` JSONB join remains the spec's target signal shape; this deviation is recorded for the next schema-compatibility review.

### 9.4 `PromotionVerdict`

- **Name:** `PromotionVerdict`
- **Type:** discriminated union.
- **Schema:**

```typescript
type PromotionVerdict =
  | { shouldPromote: false; reason: 'below_threshold' | 'already_top_tier' | 'cooldown_active' | 'invalid_source_tier' | 'invalid_transition' }
  | {
      shouldPromote: true;
      nextTier: ConsolidationTier;
      mode: 'auto' | 'operator-approved';
      signalContributions: PromotionSignals;
      totalScore: number;
      threshold: number;
      configVersion: number;
    };
```

Reason semantics: `below_threshold` (signals didn't clear the configured threshold for any valid next tier); `already_top_tier` (currentTier is `procedural`); `cooldown_active` (per §14.3 (b)); `invalid_source_tier` (currentTier is anything other than `working | episodic | semantic`); `invalid_transition` (a candidate (oldTier, newTier) pair failed `isValidPromotionTransition` — defense-in-depth for paths that bypass `evaluatePromotion`).

- **Nullable:** no.
- **Producer:** `evaluatePromotion` (pure function in `memoryBlockSynthesisService.ts`).
- **Consumer:** `memoryConsolidationPromotionDispatcher.ts` (auto path dispatches the UPDATE; operator-approved path inserts review-queue row).
- **Example (auto promotion):**

```json
{
  "shouldPromote": true,
  "nextTier": "semantic",
  "mode": "auto",
  "signalContributions": { "reinforcementCount": 12, "crossSessionRecurrence": 4, "recency": 0.85 },
  "totalScore": 9.27,
  "threshold": 8.0,
  "configVersion": 1
}
```

- **Example (procedural promotion):**

```json
{
  "shouldPromote": true,
  "nextTier": "procedural",
  "mode": "operator-approved",
  "signalContributions": { "reinforcementCount": 24, "crossSessionRecurrence": 9, "recency": 0.92 },
  "totalScore": 18.12,
  "threshold": 15.0,
  "configVersion": 1
}
```

### 9.5 `memory.block.promoted` event payload

- **Name:** `memory.block.promoted`
- **Type:** discriminated-union member of the existing agent-execution-event taxonomy in `shared/types/agentExecutionLog.ts`.
- **Criticality tier:** `tier-3` (operational, non-critical, retry-on-failure) per `AGENT_EXECUTION_EVENT_CRITICALITY` registry.
- **Schema:**

```typescript
type MemoryBlockPromotedEvent = {
  eventType: 'memory.block.promoted';
  critical: false;
  blockId: string;
  organisationId: string;
  subaccountId: string;
  oldTier: ConsolidationTier;
  newTier: ConsolidationTier;
  signalContributions: PromotionSignals;
  totalScore: number;
  threshold: number;
  configVersion: number;
  promotionMode: 'auto' | 'operator-approved';
  approvedByUserId?: string;   // present iff promotionMode === 'operator-approved'
  queueItemId?: string;        // present iff promotionMode === 'operator-approved' (the approved memory_review_queue.id; serves as correlation context)
  jobId?: string;              // present iff promotionMode === 'auto' (the pg-boss job_id; serves as correlation context)
};
```

- **Producer:** `memoryConsolidationPromotionDispatcher.ts` (auto path — emits with `runId = NULL` plus the pg-boss `job_id` as correlation context; system-action). `memoryReviewQueueService.approvePromoteToProcedural` (operator-approved path — emits with `runId = NULL` because the approve handler is an HTTP operator action, not an agent run; uses the approved `memory_review_queue.id` as `queueItemId` correlation context, plus `approvedByUserId` to identify the actor).
- **Consumer:** LAEL (Live Agent Execution Log) timeline UI (renders the event); audit script check #2 (counts events per transition over 30 days) and check #3 (samples events to verify signal contributions are not single-signal-dominated). Consumers dedupe by the canonical key `(blockId, oldTier, newTier, configVersion)` per §14.4 when retries produce multiple physical rows.
- **Nullable / optional fields by mode:**
  - `approvedByUserId?` — present iff `promotionMode === 'operator-approved'`; absent for `'auto'`.
  - `queueItemId?` — present iff `promotionMode === 'operator-approved'` (the `memory_review_queue.id` of the approved row; correlation context); absent for `'auto'`.
  - `jobId?` — present iff `promotionMode === 'auto'` (the pg-boss `job_id`; correlation context); absent for `'operator-approved'`.
  - All other fields are required and non-nullable.

### 9.6 Extended `memory.retrieved` event payload

- **Name:** `memory.retrieved` (extension of existing event)
- **Change:** add the following fields to each entry of `topEntries[]`:
  - `tier: ConsolidationTier | null`
  - `decayWeight: number | null`
  - `tierMultiplier: number | null`
  - `memoryConsolidationConfigVersion: number | null`
  - `lastAccessedAtAtRetrieval: string | null` (ISO 8601 timestamp; the value of `memory_blocks.last_accessed_at` at the moment the retrieval ran — required by audit Check 4 to recompute decay against trace-time state, not current state).
- All five new fields are `null` when the behaviour flag is OFF (the null encodes flag-off mode for observability consumers).
- **Persistence path:** the `memory.retrieved` event is emitted via the existing LAEL pipeline (`tryEmitAgentEvent` → `agentExecutionEventService`) AND its full payload — including the new fields — is persisted by `agentRunPromptService` into `agent_run_prompts.payload` (the existing per-run prompt store keyed on `(run_id, assembly_number)`). The audit script reads `agent_run_prompts` as the canonical retrieval-trace source.
- **Producer:** `tryEmitAgentEvent` called from `hybridRetrieval.ts`; persisted by `agentRunPromptService`.
- **Consumer:** LAEL timeline UI; audit script (Checks 4 and 5; consumes `agent_run_prompts` to spot-check retrieval ordering and reinforcement activity).
- **Backwards compatibility:** new fields are optional + nullable. Existing consumers of `memory.retrieved` that don't read the new fields continue to function. No event-schema version bump needed for additive optional fields per existing convention.

### 9.7 `MemoryConsolidationAuditResult`

- **Name:** `MemoryConsolidationAuditResult`
- **Type:** TypeScript record + JSON write-out shape.
- **Schema:**

```typescript
type MemoryConsolidationAuditResult = {
  schemaVersion: 1;
  runAt: string;            // ISO 8601 timestamp
  env: string;              // target env identifier (e.g. 'local-dev', 'staging', 'prod')
  warmupDays: number;       // value of --warmup-days arg
  flagState: 'on' | 'off' | 'unknown';
  overall: 'pass' | 'warn' | 'fail';
  checks: {
    tierDistribution: AuditCheckResult;
    promotionEventFiring: AuditCheckResult;
    promotionSignalContributions: AuditCheckResult;
    decayApplied: AuditCheckResult;
    reinforcementUpdates: AuditCheckResult;
    citationUtilityTrend: AuditCheckResult;
    flagState: AuditCheckResult;
  };
};

type AuditCheckResult = {
  status: 'pass' | 'warn' | 'fail' | 'n/a';
  findings: string[];
  evidence: unknown;       // check-specific structured evidence; surface in audit log for operator
};
```

- **Source-of-truth precedence:** the audit script writes one `MemoryConsolidationAuditResult` per run to the trend-log file (JSONL). The trend log is the canonical historical record. The CLI stdout output is a human-readable rendering of the same data — if stdout and trend log disagree, the trend log wins.
- **Producer:** `scripts/audit/audit-memory-consolidation.ts`.
- **Consumer:** operator (CLI), `tasks/todo.md` (any `fail` finding → templated todo entry per `audit-runner` convention), post-launch governance (4-consecutive-pass gate consumes recent trend-log entries).

### 9.8 Source-of-truth precedence (multiple representations of memory state)

When tier-related data exists in more than one representation, the canonical read path is:

1. **For "what tier is this block?"** → `memory_blocks.consolidation_tier` column. Single source of truth. Promotion events are an audit trail, not the current state.
2. **For "when was this block last accessed?"** → `memory_blocks.last_accessed_at` column. Reinforcement batch writes here; retrieval traces emit copies for observability, but the column is canonical.
3. **For "what's the current promotion config?"** → `MEMORY_CONSOLIDATION_CONFIG_HISTORY.find(c => c.version === ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION)` in `server/config/memoryConsolidationConfig.ts`. Both constants are exported from the same file; the integer `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` is the single selector. Audit checks compare on-disk config to per-retrieval-recorded `memoryConsolidationConfigVersion` to detect drift between when a retrieval/promotion ran and the current active version.
4. **For "did a promotion happen on this block?"** → `memory.block.promoted` events. `memory_blocks.updated_at` shifts on promotion (UPDATE statement) but is not specific to promotion — it shifts on any write. The event is canonical for "promotion fired."
5. **For "what's the lineage of this block version?"** → for content-change rows (`change_source IN ('manual_edit','auto_synthesis','workflow_upsert','reset_to_canonical','seed')`), `memory_block_version_sources` (existing memory-improvements table) carries the per-version sources. For tier-promotion rows (`change_source = 'tier_promotion'`, new in this build), no `memory_block_version_sources` rows are written — `writeLineageRowsForVersion` is invoked with `cluster: []` (per §6 Phase 4) and returns `{ rowsWritten: 0 }`. The lineage of a tier-promotion version is implicit in the version chain: the prior `memory_block_versions` row for the same `memory_block_id` is the antecedent, and its `tier_at_capture` (or its own `change_source`-specific lineage) is the source.

Disagreement between these representations is a bug. Spec-conformance verifies that every promotion path writes through the same canonical order — auto path: (1) validate-transition → (2) guarded UPDATE on `memory_blocks` → (3) mint `memory_block_versions` row → (4) `writeLineageRowsForVersion(cluster: [])` (all four inside `withOrgTx`) → (5) commit → (6) emit `memory.block.promoted` (outbox, post-commit); procedural path is identical with a prepended (0) SELECT FOR UPDATE on the pending review-queue row and an appended (5') mark queue row approved before commit. Steps 1-5 are atomic; step 6 is best-effort with audit-script Check 2 reconciliation detecting missing events.

## 10. Permissions / RLS checklist

### 10.1 RLS posture statement

**Canonical sentence:** RLS enforces the organisation boundary; subaccount filtering is service-layer.

`memory_blocks` uses single-GUC RLS (the `memory_blocks_organisation_isolation` policy enforces `organisation_id = current_setting('app.organisation_id')::uuid` only). Subaccount filtering is done by service-layer predicates inside `withOrgTx`. This is the standard pattern documented in `architecture.md § Row-Level Security — Three-Layer Fail-Closed Data Isolation`.

### 10.2 Column-add RLS audit (Phase 1)

The new `consolidation_tier text NOT NULL DEFAULT 'episodic'` and `last_accessed_at timestamptz` columns are added to the existing `memory_blocks` table. Postgres column-level RLS is not in use anywhere in this codebase, so the existing table-level policy automatically covers the new columns. No new policy required.

**Spec-conformance verifies:**
1. The Phase 1 migration does NOT include any new `CREATE POLICY` or `ALTER POLICY` statement (the existing policy is sufficient).
2. The Phase 1 migration does NOT include a parallel `consolidation_tier`-specific GRANT (the existing table-level grants cover).
3. `server/config/rlsProtectedTables.ts` already lists `memory_blocks`; no entry change needed.
4. Integration tests in `server/services/__tests__/rls.context-propagation.test.ts` cover `memory_blocks` access patterns; no test changes needed for the column add.

### 10.3 Review-queue item-type extension (Phase 4)

The `memory_review_queue` table (verified at `server/db/schema/memoryReviewQueue.ts`) gains a new `item_type` literal value `'promote_to_procedural'` (the column is `text` typed via Drizzle `$type<MemoryReviewItemType>()` — there is no Postgres enum to alter). It also gains two nullable top-level columns: `block_id uuid` (carries the candidate block id for tier-promotion rows; null for other item types) and `cooldown_until timestamptz` (rejected-row cooldown per §14.3 (b)). The existing RLS policy on `memory_review_queue` covers all three additions — no policy change.

**Spec-conformance verifies:**
1. The Phase 4 migration adds the two columns + the partial unique index per §8; no `ALTER TYPE` (the discriminator is a text column).
2. No new table created; no `rlsProtectedTables.ts` change.

### 10.4 Route guards (Phase 4)

The review-queue approve / reject handlers in `server/routes/memoryReviewQueue.ts` (or equivalent existing route file) are extended to handle the new `promote_to_procedural` variant. They MUST use the same guard chain as the existing handlers:

```
authenticate → resolveSubaccount → requireOrgPermission(ORG_PERMISSIONS.MEMORY_REVIEW_APPROVE)
```

**Permission decision (locked at spec):** REUSE the existing review-queue approve permission. Procedural-promotion approval is conceptually the same as memory-block-content-edit approval — same operator role, same risk surface. Architect locates the exact `ORG_PERMISSIONS.*` symbol at plan (a discovery task against the existing permission catalogue, not a design decision). No new `MEMORY_PROMOTE_APPROVE` permission is added.

### 10.5 Principal-scoped RLS (Phase 4 promotion job)

`memoryConsolidationPromotionJob.ts` runs as a server-side maintenance job, not in an agent execution context. It uses `withOrgTx` per tenant (mirrors the existing `memoryDedupJob.ts` pattern). Per-principal context is not required because the job is not acting on behalf of a user — it's a system action.

### 10.6 Audit script tenant-scope verification

The audit script runs in TWO distinct read postures, both documented:

**(a) Per-tenant checks (Checks 1, 2, 3, 4, 5, 7).** These iterate tenants via the existing tenant-enumeration helper (architect locates and reuses — typically `listAllOrganisations()` or similar). Each tenant's queries run inside `withOrgTx`, which sets `app.organisation_id` and lets the existing RLS policy enforce the tenant boundary. The check code does NOT write `WHERE organisation_id = $x` predicates manually for those queries — RLS already handles it.

**(b) Cross-tenant aggregate read (Check 6).** Reads `mv_memory_utility_30d`, which is a materialised view that intentionally aggregates across all tenants for fleet-wide trend analysis. Materialised views in this codebase do not carry per-row RLS policies the same way base tables do, so this read goes through `withAdminConnection` (per `docs/spec-context.md` accepted_primitives) which explicitly bypasses RLS. This is a deliberate carve-out for the cross-tenant aggregate — Check 6 is the ONLY check that uses the admin-bypass posture; it is explicitly named here and in the audit-script source comment so reviewers can audit the carve-out.

Spec-conformance verifies: every audit query is either (a) inside `withOrgTx` (RLS enforced; no manual predicate needed) or (b) explicitly wrapped in `withAdminConnection` with a comment naming the cross-tenant aggregate justification. No bare admin connection without that wrap+comment is permitted.

## 11. Execution model

### 11.1 Per-component execution model

| Component | Model | Justification |
|---|---|---|
| Retrieval (decay + tier multiplier application in `hybridRetrieval.ts`) | Inline / synchronous | Caller of `workspaceMemoryService.retrieve` blocks on the result. Existing pattern; new tier-aware logic adds no new boundary. |
| Reinforcement on access (`recordAccess`) | Async, in-process buffered | Sync API for callers (returns immediately after pushing to buffer); buffer flushes asynchronously. Per G6 operational constraint: every retrieval mutating a DB row is unacceptable. |
| Reinforcement batch flush | Async, time-or-count triggered | Flushes every 60s OR every N events per tenant (whichever comes first). Single `UPDATE` inside `withOrgTx`. Not pg-boss — runs in the main server process as a `setInterval` / event-driven flusher. |
| `memoryDecayJob` | Async, queued (pg-boss) | Hourly cadence; **logging-only** — emits per-tenant per-tier distribution log lines. Never writes to `memory_blocks` (`reinforcementBatch.ts` owns `last_accessed_at`). Never computes decay weights (retrieval-time). Decoupled from caller; durable; retryable. |
| `memoryConsolidationPromotionJob` | Async, queued (pg-boss) | Hourly cadence; per-tenant batch evaluation; durable; retryable. Auto-promotions write inside `withOrgTx`; procedural promotions queue into `memory_review_queue`. |
| Procedural-promotion approval (operator click) | Inline / synchronous (HTTP route) | Standard request-response pattern. Approve handler does UPDATE + `writeLineageRowsForVersion` + emit event in a single transaction. |
| Audit script run | Inline / synchronous (CLI invocation) | Operator runs the script from a terminal; script runs to completion and returns an exit code. No async/queued behaviour. Optional weekly CI integration deferred per Phase 5. |

### 11.2 Job idempotency table entries

Per `architecture.md` job conventions, every pg-boss job gets an entry in `JOB_PAYLOAD_FIXTURES` (in `server/jobs/__tests__/` or equivalent — architect locates) for static-gate verification:

- `memory-decay` — fixture: empty payload (job runs unconditionally over all tenants per its hourly schedule).
- `memory-consolidation-promotion` — fixture: empty payload (same pattern; iterates all tenants).

### 11.3 Cache / prompt-partition implications

This build does NOT introduce any LLM prompt partition changes. Memory blocks are retrieved via `workspaceMemoryService` and injected into the prompt by existing `getMemoryForPrompt` / `getMemoryForPromptWithTracking`. Tier-aware retrieval changes the ORDERING and SCORING of candidates but does NOT change the partition placement or the prompt-cache-key composition. No `stablePrefix` vs `dynamicSuffix` decision is in scope.

### 11.4 Behaviour-flag execution paths

Per G1, the flag gates three downstream behaviours; each component's flag-off path is explicitly named:

| Component | Flag-ON behaviour | Flag-OFF behaviour |
|---|---|---|
| `hybridRetrieval.ts` decay + tier-multiplier application | Computed and applied to every candidate | Skipped; candidates pass through with RRF scores unchanged |
| `reinforcementBatch.ts` `recordAccess` | Buffered; flushed on schedule | No-op (buffer not allocated; no flush scheduled) |
| `memoryDecayJob` | Runs and emits per-tenant per-tier distribution log lines only (no row mutations; `reinforcementBatch.ts` owns `last_accessed_at` writes) | Job dispatched but exits early after flag check |
| `memoryConsolidationPromotionJob` | Runs; computes signals; dispatches auto-promotions + queues procedural candidates | Job dispatched but exits early after flag check |
| Procedural-promotion approve handler | Functional (operator can approve queued items) | Functional (handler still works; just no new items queue when flag is OFF) |
| `memory.retrieved` event tier fields | Populated with real values | Set to `null` (signals flag-off mode to consumers) |
| `memory.block.promoted` event | Emitted on every promotion | Never emitted (no promotions occur) |

Spec-conformance verifies every flag-gated component has an explicit early-exit branch on flag-off. Flag-OFF retrieval ordering, scoring, selected memory IDs, and prompt inputs are identical to pre-build fixture outputs. Observability payload shape may differ by additive nullable fields (the new §9.6 fields ship as `null` in flag-OFF mode) — payload shape is therefore NOT byte-identical, but the behavioural surface consumed by `getMemoryForPrompt` callers IS. Regression check via fixture-replay against `getMemoryForPrompt` outputs (not raw event payloads).

## 12. Locked Guardrails

These three guardrails emerged from grill Rounds 2 and 3 (`intent.md § Locked Guardrails`) and are non-negotiable spec requirements. Deviation requires explicit operator approval logged as a `REVIEW_GAP` per CLAUDE.md.

### G1 — Behaviour-flag-default-OFF in every environment

A single feature flag `MEMORY_CONSOLIDATION_TIER_ENABLED` (env var) gates tier-aware promotion, tier-aware decay, and tier-aware retrieval boost as a unit. Default value in every environment (local / staging / prod) at deploy time: **OFF (false)**. Flag flips ON per-environment only after G3 is satisfied for that environment.

**Flag-off behaviour invariant:** Flag-OFF retrieval ordering, scoring, selected memory IDs, and prompt inputs derived from retrieval are identical to pre-build fixture outputs. The `memory.retrieved` event payload gains nullable observability fields (`tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval`) which are emitted as `null` in flag-OFF mode — observability payload shape may therefore differ by additive nullable fields, but the behavioural surface (the four behavioural axes above) does not. The Phase 1 plumbing through `retrieve.ts` per §8 changes the candidate-shape forwarded to `tryEmitAgentEvent`, so payload-shape parity is not claimed and is not the regression check. New column(s) and any new tables remain in place but unused. Per-component flag-off paths enumerated in §11.4. Spec-conformance verifies the behavioural-identity claim via fixture-replay of `getMemoryForPrompt` outputs (not raw event payloads).

**Spec contract:** the flag is read at retrieval time AND at promotion-job dispatch time. The read site is `server/config/featureFlags.ts` (new in Phase 1 per §8 — the file does NOT currently exist). The read result is cached for the duration of a single retrieval call (not process-lifetime) so flag flips take effect immediately on the next retrieval without process restart.

### G2 — Observability built into THIS build (not a follow-up)

Four observability hooks ship as part of v1, NOT deferred:

1. **`memory.retrieved` event payload extension** — `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval` fields on each `topEntries[]` entry (full set per §9.6; audit Check 4 depends on `lastAccessedAtAtRetrieval` to recompute decay against trace-time state). All nullable; `null` when flag is OFF.
2. **New event type `memory.block.promoted`** — registered in `shared/types/agentExecutionLog.ts` with full schema per §9.5. Criticality tier `tier-3`.
3. **Reinforcement batch counter `reinforcement_batch_updates_total`** and **`reinforcement_batch_flush_ms`** — emitted as structured log lines per flush cycle per tenant.
4. **Promotion-job emits structured log** `memory.consolidation.promotion_job.completed` with per-tenant counts: `auto_promotions_applied`, `procedural_promotions_queued`, `evaluation_duration_ms`. Per-cycle, per-tenant.

These are the data sources the audit script (G3) consumes. Spec-conformance verifies all four hooks are present in the build.

### G3 — Audit script + flag-flip gate

The audit script at `scripts/audit/audit-memory-consolidation.ts` is a v1 deliverable per §6 Phase 5. Full specification in §13.

**Flag-flip gate (binding):** the feature flag MUST NOT be flipped ON in production until the audit script has returned `pass` against staging for **4 consecutive weekly runs**.

**Operational evidence requirement:** for each of the four staging passes, the operator MUST commit a snapshot of that run's full `MemoryConsolidationAuditResult` per §9.7 to `tasks/operational/memory-tiered-consolidation-staging-audit-<ISO-date>.json`. Production flag flip requires four such files dated within a 4-to-6 week window to be present in the repo at the time of the flip. This is the durable artefact the gate is enforced against — the trend log itself is gitignored per §8, so the per-pass committed snapshots are the canonical evidence trail.

- Operator override: requires a `REVIEW_GAP` artifact written to `tasks/operational/memory-tiered-consolidation-flag-flip-override-<ISO-date>.md` following the format in `CLAUDE.md § REVIEW_GAP artifact format` with explicit justification.
- "Consecutive weekly runs" interpreted as four passes within a 4-to-6 week window — i.e. operator may slip a week for ops reasons but cannot collapse the four runs into a single weekend.
- Per-environment gating: the gate applies to production. Staging itself can flip the flag at any time for the audit script to evaluate against. Local-dev can flip freely.

## 13. Audit script specification

### 13.1 Script identity and CLI

- **Path:** `scripts/audit/audit-memory-consolidation.ts`.
- **Invocation:** `npx tsx scripts/audit/audit-memory-consolidation.ts [args]` — per existing audit-script convention; architect verifies and aligns.
- **CLI args:**
  - `--env <env>` — target environment connection string source. Acceptable values: `local-dev`, `staging`, `prod`. Defaults to local dev.
  - `--warmup-days <N>` — number of days from launch during which empty-tier findings are downgraded to `warn` (not `fail`). Default 14.
  - `--out <path>` — output path for the JSON result file. Default `scripts/audit/_logs/memory-consolidation-audit-<env>-<ISO-date>.json`.
  - `--trend-log <path>` — append-only JSONL trend log path. Default `scripts/audit/_logs/memory-consolidation-audit-trend-<env>.jsonl`.
  - `--no-todo-routing` — disables auto-routing of `fail` findings into `tasks/todo.md` (for dry-run / dev experiments).

### 13.2 The seven checks

Each check produces an `AuditCheckResult` per §9.7.

**Check 1 — Tier distribution.** Per tenant, count blocks in each tier (`working | episodic | semantic | procedural`). Eligibility precondition: tenant has ≥ 100 total non-deleted blocks. **Eligible tenants:** flag `fail` for tenants where any tier is empty AFTER the warmup window. **Below-eligibility tenants:** report `n/a` for the tier-distribution check (do not flag); their tier population is structurally too small to draw a signal from. During warmup, all tenants flag at most `warn`. Evidence: per-tenant tier-count table with eligibility-marker column.

**Check 2 — Promotion event firing + version-to-event reconciliation.** For each of the four tier transitions, count `memory.block.promoted` events in the last 30 days. Eligibility precondition differs by transition mode:
- **Auto transitions** (`working → episodic`, `episodic → semantic`): eligible when ≥ 10 blocks at the source tier meet the configured signal-score threshold in the audit window. Eligible + zero events = `fail`. Ineligible = `n/a`. During warmup, eligible + zero events = `warn`.
- **Operator-approved transitions** (`episodic → procedural`, `semantic → procedural`): eligible when there is at least one pending unresolved `memory_review_queue` row with `item_type = 'promote_to_procedural'` for the transition's source tier. Eligible + zero events = `fail` (operator is queueing but never approving — surface for triage). Ineligible (no pending procedural candidates) = `n/a`. During warmup, eligible + zero events = `warn`.

**Reconciliation sub-check (back-stop for outbox event drops per §14.5):** the audit also queries `memory_block_versions` rows with `change_source = 'tier_promotion'` in the 30-day window and JOINs each row against emitted `memory.block.promoted` events using the canonical key directly from the version row's columns: `(memory_block_id, old_tier_at_capture, tier_at_capture, config_version_at_capture)`. The version row carries both old and new tier explicitly (per §8 Phase 4 schema modification), so reconciliation does not require walking the version chain or inferring `oldTier` from prior content-edit rows (which have `tier_at_capture = NULL`). Any version row without a matching event → `fail` for auto transitions, `warn` for operator-approved (operator may have approved out-of-band). Block ids surfaced in evidence.

**Persisted-invalid-transition sub-check (per §14.7 audit row):** for every `memory_block_versions` row with `change_source = 'tier_promotion'` in the audit window, evaluate `isValidPromotionTransition(old_tier_at_capture, tier_at_capture)`. Any row that returns `false` → `fail` ("persisted invalid promotion") with the block id, version id, and the offending `(oldTier, newTier)` pair in evidence. This is the audit-side enforcement of §14.7's single-rule contract — it surfaces both (a) bugs that bypass `isValidPromotionTransition` at write time and (b) data drift after a future spec change to the valid-transition set.

Evidence: per-transition event-count table with eligibility column, sample event ids, per-transition list of unmatched promotion-version rows, list of persisted-invalid-transition rows.

**Check 3 — Promotion signal contributions.** Sample 20 promotion events per transition. The `signalContributions` field per §9.5 stores RAW signal values; the audit must apply the active config's `signalWeights` to compute weighted contributions before computing dominance. Formula:

```
weightedContribution(signal) = signalContributions[signal] × config.promotionConfig.signalWeights[signal]
dominanceFraction(signal)   = weightedContribution(signal) / event.totalScore
```

The check uses the config version recorded in `event.configVersion` (not the active config) so that historical events are evaluated against their contemporaneous weights. Any single signal's `dominanceFraction > 0.80` triggers `warn`; `> 0.95` triggers `fail`. Evidence: per-transition signal-distribution histogram of weighted contributions.

**Check 4 — Decay applied.** Sample 50 recent retrievals from `agent_run_prompts` (the persisted retrieval-trace path; producer is `agentRunPromptService` per `docs/spec-context.md`). For each sampled retrieval, recompute the expected `decayWeight` locally using the **trace-time** values: the per-trace `memoryConsolidationConfigVersion`, the per-trace `agent_runs.started_at` as `now`, and the per-trace `lastAccessedAtAtRetrieval` (new field on §9.6 — see below). Compare to the persisted per-entry `decayWeight` in the same trace. Flag `fail` for any drift > 1% absolute. Evidence: sample-by-sample comparison table, drift histogram. The check rejects mutable-state drift (config bumps, `last_accessed_at` updates since the retrieval) as causes of false positives.

**Check 5 — Reinforcement updates.** Per tenant, perform two sub-checks:

**Sub-check 5a — Trace-derived activity (eligibility gate).** Derive "distinct-day reinforcement activity" from `agent_run_prompts` over the last 7 days (count distinct `DATE(agent_runs.started_at)` values where `agent_run_prompts.payload` references any block id from this tenant). The `last_accessed_at` column itself is overwritten on every batch flush and cannot answer distinct-day questions, so the trace source is canonical for this measure.

**Sub-check 5b — Trace-to-column reconciliation (back-stop for batch failures).** Sample 10 of the blocks identified by sub-check 5a as trace-active. For each, verify `memory_blocks.last_accessed_at` is within the last 7 days (i.e. `reinforcementBatch.ts` actually advanced the column). Any sample with `last_accessed_at` older than 7 days (or null) when the trace shows recent activity → indicates the batch flusher silently failed; surface the block id as evidence.

**Verdict combination (flag ON):**
- Sub-check 5a returns zero distinct days → `fail` (no reinforcement activity at all).
- Sub-check 5a passes; sub-check 5b finds any drift → `fail` (batch flusher broken; column not advancing).
- Sub-check 5a passes; sub-check 5b clean → `pass`.

Flag OFF: this check downgrades to `pass` (reinforcement is a no-op when flag is OFF). Evidence: per-tenant 7-day distinct-day count, sample-block `last_accessed_at` values, list of drifted block ids.

**Check 6 — Citation utility trend.** Read `mv_memory_utility_30d` aggregate values. Compare to the prior audit run's recorded values from the trend log. Flag `warn` for any per-agent 30-day rate that decreased by > 5 percentage points across runs. Flag `fail` for any per-agent 30-day rate that decreased by > 15 percentage points. Evidence: per-agent before/after comparison.

**Check 7 — Flag state.** Read the `MEMORY_CONSOLIDATION_TIER_ENABLED` env var value from the target environment via `getMemoryConsolidationTierEnabled()` (exported from the new `server/config/featureFlags.ts` per §8). Report `pass` regardless of value — this check exists for INTERPRETABILITY of the other checks, not for pass/fail. The value is recorded in `MemoryConsolidationAuditResult.flagState`.

### 13.3 Overall verdict computation

- **`pass`** — every check returns `pass` or `n/a` (treated as "no signal contributed"; eligibility precondition not met).
- **`warn`** — no checks return `fail`; ≥ 1 returns `warn`.
- **`fail`** — any check returns `fail`.

The `n/a` status is a legitimate "this check could not be evaluated meaningfully for this environment" outcome (e.g. low-volume tenant per Check 1, no pending procedural candidates per Check 2). It is structurally distinct from `pass` (which asserts a positive observation) and from `warn` (which surfaces a soft concern). The trend log records each check's status verbatim so operators can see whether `pass` is real or `n/a` mode.

### 13.4 Trend log + fail-to-todo routing

- Every run appends ONE line to the trend log (JSONL) with the full `MemoryConsolidationAuditResult` per §9.7.
- For every `fail` finding from any check, append a `tasks/todo.md` entry under a section `## Deferred from audit-memory-consolidation` (auto-created if missing). Entry format:

```markdown
- **[<ISO-date>] [<env>] [<check-id>]** <finding text from check's findings[]>. Evidence: `scripts/audit/_logs/memory-consolidation-audit-<env>-<ISO-date>.json`.
```

If the audit script is invoked with `--no-todo-routing`, this routing is skipped.

### 13.5 Audit script's own coverage

Pure-function tests (Vitest) cover the per-check logic. Integration of the script itself is verified via a manual run during Phase 5 build verification — this is acceptable per the codebase's `static_gates_primary` testing posture in `docs/spec-context.md` (no E2E tests of own scripts).

## 14. Execution-safety contracts

Per spec-authoring-checklist §10, every new write path declares its idempotency posture, retry classification, concurrency guard, terminal-event guarantee, no-silent-partial-success rule, unique-constraint mapping, and state-machine closure.

### 14.1 Idempotency posture

| Write path | Posture | Mechanism |
|---|---|---|
| Phase 1 column add `ALTER TABLE memory_blocks ADD COLUMN consolidation_tier text NOT NULL DEFAULT 'episodic'` | `run-once` (migration-runner contract) | Backfill is implicit in the column default. The migration runs exactly once per environment per filename via the existing migration runner; manual re-execution errors out at the Postgres layer (cannot re-add an existing column). No explicit UPDATE statement to make idempotent. |
| Reinforcement batch flush — `UPDATE memory_blocks SET last_accessed_at = greatest(last_accessed_at, $now) WHERE id = ANY($buffered_ids) AND organisation_id = $orgId AND subaccount_id = $subId` | `safe` (unconditionally retryable) | `greatest(...)` makes the write monotonic; retrying the same flush never decreases `last_accessed_at`. Explicit org+subaccount predicates document the buffer-key invariant per §6 Phase 2. |
| Auto-promotion — `UPDATE memory_blocks SET consolidation_tier = $newTier WHERE id = $blockId AND consolidation_tier = $oldTier` | `state-based` | Optimistic predicate `AND consolidation_tier = $oldTier`; 0 rows affected = race lost; caller logs and exits silently. |
| `writeLineageRowsForVersion` invocation on promotion | inherits memory-improvements' existing posture (`key-based` per `(version_id, source_entry_id)` unique constraint) | No new posture introduced; composes against shipped path. |
| `memory.block.promoted` event emission | `outbox-backed, key-based at the logical layer` | Physical persistence via the existing LAEL path is best-effort (post-commit, retried on transient failure per tier-3 criticality). Physical duplicates may exist when retries succeed after a partial failure. Logical consumers dedupe by the canonical key `(blockId, oldTier, newTier, configVersion)` per §14.4 — not by `(run_id, sequence)`. The audit script Check 2 reconciliation (per §13) detects logical events that never persisted at all and surfaces the corresponding `memory_block_versions` row. |
| Operator-approved promotion — review-queue approve handler | `state-based` | `UPDATE memory_blocks ... AND consolidation_tier = $oldTier` plus `UPDATE memory_review_queue SET status = 'approved', resolved_by_user_id = $approverId, resolved_at = now() WHERE id = $queueId AND status = 'pending'`. Both predicates guard against double-approval. (Status enum is `'pending' \| 'approved' \| 'rejected' \| 'auto_applied' \| 'expired'` per the existing `MemoryReviewStatus` type at `server/db/schema/memoryReviewQueue.ts:17`.) |
| `tasks/todo.md` append from audit script fail | `non-idempotent (intentional)` | Each audit run is a distinct point-in-time observation; multiple failing runs produce multiple todo entries (each dated). Operator dedupes during triage. Documented as intentional in §13.4. |

### 14.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| Reinforcement batch flush | `safe` | Standalone `UPDATE` per tenant; retried unconditionally by the flusher with exponential backoff. |
| Decay job | `safe` | Read-mostly job (writes only to logs); retried by pg-boss on transient failure. |
| Promotion job (auto-promotion path) | `guarded` | State-based idempotency per row (§14.1); retried by pg-boss. |
| Promotion job (procedural-queue insert path) | `guarded` | Per-block cooldown predicate prevents duplicate queueing; retried by pg-boss. |
| Operator approve handler | `guarded` | State-based idempotency on `memory_blocks` AND `memory_review_queue`; retry-safe at the HTTP layer (idempotent re-submit returns the same result). |
| `memory.block.promoted` event emission | `guarded` | Two emission contexts: (a) operator-approve path emitted from `memoryReviewQueueService.approvePromoteToProcedural` uses `runId = NULL`, `queueItemId = approved row id`, `approvedByUserId = approver`; (b) auto-promotions emitted from `memoryConsolidationPromotionJob` use `runId = NULL` plus the pg-boss `job_id` as the correlation context. In both cases, the canonical idempotency key per §14.4 — `(blockId, oldTier, newTier, configVersion)` — is the dedupe primitive, NOT `runId+sequence`. Retry classification is `guarded` because the LAEL pipeline may produce a second physical row on retry; consumers dedupe by the canonical key. |
| Audit script | `safe` | Read-only against DB; idempotent over its own outputs (each run is a separate trend-log line; no overwriting). |

### 14.3 Concurrency guards

Three places where two concurrent callers can race to write the same row or terminal state:

**(a) Concurrent promotions of the same block.** Two promotion-job dispatches (one stuck retry + one fresh dispatch; or two replicas) might both try to promote block X from `working` to `episodic`.

- Guard: optimistic predicate `WHERE consolidation_tier = 'working'`.
- DB mechanism: row-level update with predicate; 0 rows affected = conflict.
- Losing caller: logs `promotion.race.lost` with `blockId` + `oldTier` + `newTier`; exits silently. The first caller's promotion is canonical; the loser does NOT re-emit the event or write a duplicate lineage row.

**(b) Concurrent operator approval + auto-promotion.** Block X is queued for procedural approval (operator-approved path); concurrently the promotion job tries to auto-promote it on a different transition path.

- Guard: the auto-promotion job's `evaluatePromotion` checks for (i) a pending `memory_review_queue` row with `item_type = 'promote_to_procedural'` AND `block_id = $candidateBlockId` — if found, returns `shouldPromote: false, reason: 'cooldown_active'`; (ii) the most recent rejected `memory_review_queue` row with `item_type = 'promote_to_procedural'` AND `block_id = $candidateBlockId` where `cooldown_until > now()` — if found, returns `shouldPromote: false, reason: 'cooldown_active'`. The `block_id` and `cooldown_until` columns are added by the Phase 4 migration per §8.
- Operator approve handler uses optimistic predicate `WHERE consolidation_tier IN ('episodic','semantic') AND consolidation_tier = $oldTier` (the IN-clause is the §14.7 service-layer guard against `null → procedural`). 0 rows affected → return 409 to the operator with a "block has been re-tiered concurrently; reload the queue" message.

**(c) Concurrent reinforcement batch flushes.** Two flushers (two replicas, or a stuck-but-restarted flusher) might both try to flush the same buffer of blockIds for the same tenant.

- Guard: each tenant has an in-process advisory lock (one flusher at a time per tenant). Cross-process: the buffer lives per-process; two replicas have independent buffers, so concurrent flushes are independent UPDATEs against potentially overlapping blockIds. The `greatest(last_accessed_at, $now)` semantics make this `safe` even under overlap.

### 14.4 Terminal event guarantee

Every promotion is a logical operation with exactly ONE terminal event: `memory.block.promoted` with the resulting `newTier`. The event has a `status`-equivalent expressed via the `promotionMode` + (implicit) presence — if the event fires, the promotion succeeded; if it doesn't, the promotion was either rejected (in operator-approved path), raced-and-lost (in auto path), or the post-commit outbox emission failed (in which case the audit script's Check 2 surfaces the missing event over the window — the underlying tier change still stands per §14.5).

- **Canonical idempotency key:** `(blockId, oldTier, newTier, configVersion)`. The tuple is naturally distinct across consecutive promotions on the same block because tier transitions are non-cyclic (a block's progression is `working → episodic → semantic → procedural`; the second event on the same block has a different `oldTier`). Timestamps are NOT part of the key — including them would defeat retry-dedup. Retried emissions of the same logical promotion produce the same key.
- **No further events with the same correlation key after the terminal.** A block can be promoted multiple times (`working → episodic → semantic → procedural` across its lifetime), but each promotion has its OWN terminal event with a distinct canonical key. They are sequentially distinct, not duplicate.
- **Mutually exclusive paths:** auto vs operator-approved are mutually exclusive for a single transition. A transition fires through one path or the other, never both — the cooldown guard in §14.3 (b) ensures this.

### 14.5 No-silent-partial-success

A promotion's state change is atomic at the DB layer in the canonical order (per §9.8 closing): validate-transition → guarded UPDATE on `memory_blocks` → mint new `memory_block_versions` row → `writeLineageRowsForVersion(cluster: [])`. The procedural path also serialises on a SELECT FOR UPDATE of the pending review-queue row before validate-transition AND marks the row `approved` after lineage. All steps run inside one `withOrgTx`. If any step fails (including 0-rows-affected on the guarded UPDATE), the entire transaction aborts and the row stays at `oldTier`.

The `memory.block.promoted` event uses an **outbox pattern** (emitted via the existing LAEL pipeline AFTER the transaction commits). This is a deliberate concession to the LAEL emission path not being transaction-bound. Event emission is best-effort with tier-3 retry. If the event ultimately never fires, the underlying tier change still stands — the audit script's Check 2 detects any block whose `consolidation_tier` changed without a corresponding event over the audit window, and the discrepancy is the explicit failure-mode signal.

The promotion job's per-cycle terminal log line `memory.consolidation.promotion_job.completed` includes:
- `auto_promotions_applied: number`
- `auto_promotions_attempted_but_lost_race: number` (counts predicate-failed UPDATEs)
- `procedural_promotions_queued: number`
- `procedural_promotions_skipped_in_cooldown: number`
- `invalid_transition_skipped: number` (counts dispatcher-side `isValidPromotionTransition` failures per §14.7 audit row; defense-in-depth — expected to be 0 in steady state)
- `evaluation_errors: number` (count of per-block `evaluatePromotion` exceptions)

A job cycle with `evaluation_errors > 0` emits log `memory.consolidation.promotion_job.partial` instead of `.completed` — explicit partial-success terminal event. Audit script check #2 (promotion event firing) interprets `.partial` as `warn`, not `fail`.

### 14.6 Unique-constraint-to-HTTP mapping

This build introduces ONE new unique constraint: a partial unique index `memory_review_queue_pending_procedural_promotion_idx ON memory_review_queue (block_id, item_type) WHERE block_id IS NOT NULL AND item_type = 'promote_to_procedural' AND status = 'pending'` (Phase 4 migration per §8). The promotion-job insert uses `ON CONFLICT DO NOTHING` so a 23505 here never propagates as an HTTP error — duplicate insert is silently swallowed. The `memory_block_version_sources` table (unchanged from memory-improvements) keeps its existing `(version_id, source_entry_id)` constraint and its existing 23505 → 409 mapping in `memoryBlockLineageService.ts`. The new `consolidation_tier` column has no unique constraint.

The review-queue approve handler returns:
- `200 OK` on successful approve, OR on idempotent re-submit of an already-approved row whose resolved target tier matches the request (returns the prior approval's result; idempotency per §14.1).
- `409 Conflict` if the optimistic predicate fails because the block was re-tiered concurrently, OR if the review-queue row is already resolved with a DIFFERENT outcome (e.g. previously rejected).
- `404 Not Found` if the review-queue row does not exist.
- `403 Forbidden` if caller lacks the required permission.
- `500 Internal Server Error` for unexpected exceptions (existing route convention).

### 14.7 State machine closure (`ConsolidationTier`)

The `ConsolidationTier` enum is a closed set of values. Spec amendments are required to add a new value.

**Valid transitions** (in promotion direction; demotion is OUT OF SCOPE per Goal 5):

```
working → episodic      (auto)
episodic → semantic     (auto)
episodic → procedural   (operator-approved)
semantic → procedural   (operator-approved)
```

**Forbidden transitions:**
- `working → semantic` (must go through episodic — no skipping tiers)
- `working → procedural` (must go through episodic — no skipping tiers; and procedural is operator-approved only)
- Any reverse transition (`episodic → working`, etc) — demotion is out of scope.
- `procedural → anything` — procedural is the terminal tier; no further promotion.
- `null → anything` directly — structurally impossible because the column is `NOT NULL DEFAULT 'episodic'` per §6 Phase 1 + §9.1; no service-layer guard needed (the schema makes the case unreachable).

**Shared transition validator (pinned at spec) — single helper, four call sites, four consistent behaviours:**

- `shared/types/memoryConsolidation.ts` exports a pure helper `isValidPromotionTransition(oldTier: ConsolidationTier, newTier: ConsolidationTier): boolean` that returns `true` only for the four valid transitions above and `false` for everything else.

| Call site | Behaviour on `false` | Visible result |
|---|---|---|
| `evaluatePromotion` (pure evaluator, `memoryBlockSynthesisService.ts`) | Returns `{ shouldPromote: false, reason: 'invalid_transition' }` (per §9.4 reason union). | The candidate is not dispatched; signal still surfaces in evaluation logs. |
| `memoryConsolidationPromotionDispatcher.ts` (auto job path) | Skips this candidate and does NOT open or write the promotion transaction; logs `promotion.invalid_transition.skipped` with `{ blockId, oldTier, newTier, configVersion }`; counts in the per-cycle terminal log per §14.5 under a new `evaluation_errors`-adjacent counter `invalid_transition_skipped`. Does NOT mint a version row or emit a `memory.block.promoted` event. | Job completes; the block stays at `oldTier`; audit Check 2's reconciliation observes the matching log line. |
| `routes/memoryReviewQueue.ts` approve handler (HTTP operator action) | Returns HTTP 400 with body `{ error: 'invalid_transition', oldTier, newTier }`. Defense-in-depth — should never fire because the queue insert only happens for valid transitions. | Operator UI surfaces the 400 with the transition pair; queue row stays at `status = 'pending'`. |
| Audit script §13 Check 2 (reconciliation) | Treats any persisted `memory_block_versions` row with `change_source = 'tier_promotion'` whose `(old_tier_at_capture, tier_at_capture)` pair fails `isValidPromotionTransition` as `fail` — surfaces as a "persisted invalid promotion" finding with the block id and version id in evidence. | Operator triages whether the write was legitimate (spec change pending) or a bug to fix. |

The helper is the ONE place the four-transition rule is encoded. Every consumer in the table above imports it and never re-implements the rule inline. The four behaviours are intentionally distinct (pure evaluator returns a structured reason; auto job logs and aborts; HTTP returns 400; audit treats persisted invalid as fail) — they are NOT four different rules, they are four different contexts applying the same rule.

**Pre-conditions for terminal-tier write:**
- For any UPDATE to `consolidation_tier`, the prior value MUST exist and pass `isValidPromotionTransition(oldTier, newTier)`. Column is `NOT NULL DEFAULT 'episodic'` so prior-value existence is structurally guaranteed.
- For procedural promotions, the `memoryReviewQueueService.approvePromoteToProcedural` handler runs the full transaction in the **canonical order** (matching the auto path) inside one `withOrgTx`: (1) SELECT FOR UPDATE the pending `memory_review_queue` row with `item_type = 'promote_to_procedural'` AND `status = 'pending'` AND `id = $queueItemId` → (2) `isValidPromotionTransition($oldTier, 'procedural')` check → (3) guarded UPDATE on `memory_blocks` with predicate `WHERE id = $blockId AND consolidation_tier IN ('episodic','semantic') AND consolidation_tier = $oldTier` (0 rows → race-loss, abort transaction) → (4) mint `memory_block_versions` row → (5) `writeLineageRowsForVersion(cluster: [])` → (6) UPDATE on `memory_review_queue` setting `status = 'approved'`, `resolvedByUserId`, `resolvedAt`. The pending → approved status transition happens INSIDE the same transaction as the tier write, not before. Concurrent approve attempts on the same queue row are serialised by the SELECT FOR UPDATE in step 1.

**Status set closure:** adding a new `ConsolidationTier` value (e.g. `archival` or `forgotten`) requires a spec amendment. Service-layer code uses exhaustive switch statements (TypeScript `never` typing) so missing-case bugs surface at compile time.

## 15. Testing posture

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`, `frontend_tests: none_for_now`, `api_contract_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`.

This build conforms:

- **Pure-function unit tests (Vitest):** every test in §8 inventory. Architect locks test cases at plan; spec's testing inventory above names the test files and the minimum case set per file.
- **No API contract tests:** the only new HTTP surface is the review-queue approve-handler extension. It reuses the existing route convention; no new contract test.
- **No frontend unit tests:** the `MemoryReviewQueuePage.tsx` change is a card-variant render. No new frontend test.
- **No E2E tests of own app:** the audit script verifies end-to-end behaviour from outside; this is the closest the codebase gets to E2E and conforms to the static-gates-primary posture.
- **Integration verification at build time:** the Phase 5 audit script's first run against local dev is the integration verification. Architect locks the seeded-fixture set at plan so the audit's first run produces predictable per-check results.
- **Static gates (CI-only per `references/test-gate-policy.md`):** existing `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-no-direct-boss-work`, `verify-test-quality.sh` all continue to apply. No new static gate introduced by this build.

**Framing-deviation acknowledgement:** the audit script is conceptually a new gate. It is NOT in the codebase's existing static-gate definition (those gates are CI-blocking; the audit script is operator-run and only `fail`-routes to `tasks/todo.md`). This is intentional — the audit is a post-launch governance mechanism, not a CI gate. Spec records this as a deliberate framing-conformance call.

## 16. Deferred Items

Items mentioned in the spec prose with "deferred", "later", "follow-up", or "Phase N+1 will" wording, plus items deferred from the brief / intent:

- **Tier 5 — explicit `memory_block_edges` graph table.** Source: brief v4.0 §6 Tier 5; intent.md Round 1. Trigger: post-launch audit shows retrieval failures the existing `graphExpansion.ts` `task_slug` join cannot explain.
- **Four additional reinforcement signals** (contradiction score, agent confidence, operator reinforcement, retrieval-success score). Source: intent.md Round 4. Trigger: each signal's external infrastructure ships independently.
- **Per-tier flag granularity** (separate flags for decay / boost / promotion). Source: intent.md Locked Guardrails G1 + Post-launch follow-up. Trigger: any subsystem misbehaves and operator needs surgical rollback without losing the others.
- **Operator dashboard for tier-distribution and promotion events.** Source: intent.md Post-launch follow-up. Trigger: post-launch review shows operators need to see tier behaviour directly beyond the audit script's CLI/JSON output.
- **Sampled reinforcement** (Round 6 alternative to batched). Source: intent.md Round 6 + Post-launch follow-up. Trigger: audit shows reinforcement batch updates causing contention at production scale.
- **Demotion transitions** (`semantic → episodic`, `episodic → working`). Source: §14.7 forbidden transitions list. Trigger: post-launch review shows blocks that should naturally demote (e.g. a "fact" that turned out to be wrong, an "event" that's now ancient working noise).
- **Relaxing procedural promotion to auto with higher threshold.** Source: intent.md Round 5. Trigger: approval rate trends near 100% over the first 90 days of audit data — operator is rubber-stamping, auto would be safe.
- **CI integration for the audit script** (weekly scheduled run; results auto-committed; notification on `fail`). Source: §6 Phase 5. Trigger: architect rolls in at plan, or post-launch operator decision.
- **Promotion-event signal-contribution UI visualisation** (per-promotion drill-down showing the signal mix). Source: implicit in audit check #3. Trigger: operator wants to understand "why was X promoted" beyond raw event payload.
- **`MEMORY_CONSOLIDATION_CONFIG_HISTORY` persistence in DB** (currently in-source). Source: §8 file inventory `memoryConsolidationConfig.ts`. Trigger: config-tuning frequency exceeds the rate at which in-source code-review is comfortable.

## 17. Open Questions

Items the spec deliberately leaves to architect / plan / build phase. Each carries a named owner and a resolution gate.

| Question | Owner | Resolution gate |
|---|---|---|
| Exact threshold numbers per tier transition (`workingToEpisodic`, etc) | Architect at plan | Locked in `MemoryConsolidationConfig` initial values; tuned post-launch via versioned config |
| Exact decay constants per tier (`strengthByTier`) | Architect at plan | Same as above |
| p95 retrieval latency budget number | Spec author measures baseline at plan | Locked in spec amendment if material; otherwise "no regression vs measured baseline" |
| Persisted-trace vs computed-from-seeds replayability mechanism | Architect at plan | Decision recorded in plan; reflected in retrieval-trace shape change if any |
| Specific tier-multiplier values per profile | Architect at plan | Locked in `MemoryConsolidationConfig` initial values |
| JSONB shape for signal contributions on promotion events | Architect at plan | Locked in `shared/types/agentExecutionLog.ts` discriminated-union member |
| ~~Audit script's exact path (`scripts/audit/` vs `scripts/gates/`)~~ | — | **Resolved at spec:** locked to `scripts/audit/audit-memory-consolidation.ts` per §13.1 + §8. |
| Audit script's warmup-days default | Architect at plan | Default 14; locked at plan |
| Reinforcement batch flush interval and event-count threshold | Architect at plan | Defaults 60s / 500 events; locked at plan |
| ~~Whether the Phase 4 review-queue migration is folded into the Phase 1 migration or kept separate~~ | — | **Resolved at spec:** kept separate in Phase 4 (per §6 Phase 4, §8 review-queue table). Preserves the §7 "no backward dependencies" invariant. |
| ~~Whether `memoryDecayJob` is fully removed in favour of materialising last-access projections only at retrieval, or retained as hourly maintenance with a documented purpose~~ | — | **Resolved at spec:** retained as hourly logging-only job per §6 Phase 2 + §11.1 (writes structured per-tenant per-tier distribution log lines; never mutates rows). |
| ~~Whether a separate `MEMORY_PROMOTE_APPROVE` permission key is added or the existing review-approve permission is reused~~ | — | **Resolved at spec:** REUSE existing review-queue approve permission (§10.4). Architect locates the exact `ORG_PERMISSIONS.*` symbol at plan (discovery task). |
| Whether `MEMORY_CONSOLIDATION_CONFIG_HISTORY` lives in-source or in DB | Architect at plan | Recommended in-source initially; defer DB if tuning frequency demands |
| ~~Whether the audit script auto-runs in CI weekly~~ | — | **Resolved at spec:** NOT in v1 per §6 Phase 5; deferred to §16. |
| Whether per-block cooldown for rejected procedural promotions is hours, days, or weeks | Architect at plan | Recommend 30 days; locked at plan |

None of these block spec acceptance. All are operator-shaped only insofar as their post-launch tuning will be operator-led; initial values are architect-locked engineering decisions.

## 18. Self-consistency pass result

Per spec-authoring-checklist §8, this section records the result of the final self-consistency pass before sending the spec to `spec-reviewer`.

### Goals ↔ Implementation match

- Goal 1 (schema + backfill) → Phase 1 → File inventory `memoryBlocks.ts` + `<NNNN>_memory_consolidation_tier.sql`. **Match.**
- Goal 2 (Ebbinghaus at retrieval, not write) → Phase 2 → `decayPure.ts` + `hybridRetrieval.ts` modification; `memoryDecayJob.ts` is logging-only per §6 Phase 2 + §11.1 (no row mutations; reinforcementBatch owns `last_accessed_at`). **Match.**
- Goal 3 (batched reinforcement, never sync per retrieval) → Phase 2 → `reinforcementBatch.ts` + §11.1 + §14.1 (safe / monotonic). **Match.**
- Goal 4 (versioned config + tier multiplier per profile) → Phase 3 → `memoryConsolidationConfig.ts` `tierMultipliersByProfile` (sole source of truth per §9.2; `queryIntent.ts` unchanged per §8) + post-fusion lookup in `hybridRetrieval.ts` + retrieval-trace config-version recording. **Match.**
- Goal 5 (promotion logic distinct from confidence routing) → Phase 4 → `evaluatePromotion` in `memoryBlockSynthesisService.ts` (NEW function, existing `decideTier` untouched). **Match.**
- Goal 6 (auto vs operator-approved per transition) → Phase 4 dispatch logic + review-queue integration + §14.7 state-machine closure. **Match.**
- Goal 7 (every promotion mints a version + writes lineage) → Phase 4 dispatcher mints `memory_block_versions` row then invokes `writeLineageRowsForVersion` inside `withOrgTx`; §14.5 documents the outbox handoff for the post-commit event. **Match.**
- Goal 8 (observability events) → G2 + Phase 1 LAEL extension + Phase 4 promotion-event emission. **Match.**
- Goal 9 (audit script) → Phase 5 + §13 specification. **Match.**
- Goal 10 (4-pass flag-flip gate) → G3 + §12. **Match.**

### Numeric count reconciliation (re-run of grep)

| Count claim | Sections | Reconciled |
|---|---|---|
| "five phases" | §6, §7 | 5 ✓ |
| "two columns" added to `memory_blocks` | §6 Phase 1, §8 | 2 ✓ |
| "three signals" | §3 Goal 5, §6 Phase 4, §9.3, §13 Check 3 | 3 ✓ |
| "four tier transitions" | §6 Phase 4, §13 Check 2, §14.7 | 4 ✓ |
| "seven checks" (audit script) | §3 Goal 9, §6 Phase 5, §13.2 | 7 ✓ |
| "four consecutive weekly runs" (flag-flip gate) | §3 Goal 10, §12 G3 | 4 ✓ |
| "two jobs" (decay + promotion) | §6 Phases 2, 4, §8, §11.1 | 2 ✓ |
| "three migrations" | §6 Phase 1, §6 Phase 4, §8, §7 phase-dependency note | 3 ✓ (Phase 1 memory_blocks + Phase 4 memory_review_queue + Phase 4 memory_block_versions) |
| "three guardrails" (G1, G2, G3) | §12 | 3 ✓ |

### Single-source-of-truth claims (load-bearing mechanism check)

- "`memory_blocks.consolidation_tier` is the single source of truth for current tier" → §9.8 (1). Mechanism: column is the only written representation of current state; events are audit trail. **Backed.**
- "`MEMORY_CONSOLIDATION_CONFIG_HISTORY` + `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION` is the single source of truth for active config" → §9.2 + §9.8 (3). Mechanism: in-source append-only history array + integer selector; all consumers use the `.find(c => c.version === ACTIVE_…)` lookup. **Backed.**
- "audit-script trend log is the single canonical historical record" → §9.7. Mechanism: JSONL append-only. **Backed.**
- "every promotion writes validate-transition → guarded UPDATE → mint version → lineage inside `withOrgTx`, then outbox-emits the event post-commit" (procedural path also serialises on the pending review-queue row and marks it approved inside the same tx) → §9.8 closing line + §14.5 + §6 Phase 4 (both paths). Mechanism: single `withOrgTx` for steps 1-5; LAEL outbox emission for step 6; spec-conformance verifies order. **Backed.**

### Load-bearing claims with named mechanism

- "RLS continues to be the canonical enforcement layer" → §10.1 + §10.2 + §10.6. Mechanism: existing table-level policy on `memory_blocks` covers the new columns; per-tenant audit reads use `withOrgTx`; cross-tenant aggregate (Check 6) explicitly carves out via `withAdminConnection`. **Backed.**
- "Flag-OFF retrieval ordering, scoring, selected memory IDs, and prompt inputs are identical to pre-build fixture outputs; observability payload shape may differ by additive nullable fields" → §11.4 + §12 G1 (narrowed wording). Mechanism: per-component early-exit branches; spec-conformance fixture-replay regression check against `getMemoryForPrompt` outputs (not raw event payloads, which carry nullable observability fields in OFF mode). **Backed.**
- "Every promotion is idempotent under concurrent retry" → §14.1 + §14.3 (a) + §14.4. Mechanism: optimistic predicate `WHERE consolidation_tier = $oldTier`; canonical event idempotency key `(blockId, oldTier, newTier, configVersion)`. **Backed.**
- "Procedural review-queue inserts are dedupable" → §6 Phase 4 + §14.6. Mechanism: new partial unique index + `ON CONFLICT DO NOTHING`. **Backed.**
- "Audit script gates flag-flip" → §12 G3 + §13.4. Mechanism: spec records the binding gate; four per-pass committed JSON snapshots at `tasks/operational/memory-tiered-consolidation-staging-audit-<ISO-date>.json` are the durable evidence; operator override requires `REVIEW_GAP` written at the documented path. **Backed.**
- "Promotion lineage composes with memory-improvements primitive" → §3 Goal 7 + §6 Phase 4 + §9.8 (5). Mechanism: every promotion mints a `memory_block_versions` row with `change_source = 'tier_promotion'` (plus `tier_at_capture`, `old_tier_at_capture`, `config_version_at_capture`) then invokes `writeLineageRowsForVersion({ ..., cluster: [], avgQuality: 0 })` per the existing signature. **Backed.**
- "Tier transitions are validated centrally" → §14.7. Mechanism: pure helper `isValidPromotionTransition` in `shared/types/memoryConsolidation.ts` is called by every tier-write path and by audit Check 2. **Backed.**

### Phase dependency check

Per §7: every Phase N depends only on outputs from Phases 1..N-1. No backward references. No orphaned deferrals (every "later" / "follow-up" in prose has a §16 Deferred Items entry). Three migrations total: Phase 1 (`memory_blocks` column add); Phase 4 (`memory_review_queue` `block_id` + `cooldown_until` columns + partial unique index); Phase 4 (`memory_block_versions` `tier_at_capture` + `old_tier_at_capture` + `config_version_at_capture` columns). Each migration has a matching `.down.sql`. Each owned by its respective phase per §6 and §8.

### Pre-checklist signoff

- [x] §0 Verify present state — operator-requested deep audit during Step 3a verified shipped state (memory-improvements PR #298, workspaceMemoryService RRF/graph/intent-profiles).
- [x] §1 Existing primitives — `workspaceMemoryService`, `memoryBlockSynthesisService`, `memoryDecayJob`, `memoryBlockReviewQueue`, `writeLineageRowsForVersion`, `RETRIEVAL_PROFILES`, `tryEmitAgentEvent`, `LAEL`, `withOrgTx`, `getOrgScopedDb`, behaviour-flag mechanism all extended; no new primitives invented.
- [x] §2 File inventory — every new/modified file in §8; no prose reference outside the inventory.
- [x] §3 Contracts — all 7 cross-boundary shapes pinned with examples (§9.1–9.7); source-of-truth precedence declared (§9.8).
- [x] §4 RLS — canonical sentence stated (§10.1); column add inherits (§10.2); enum discriminator add inherits (§10.3); route guards named (§10.4); audit script tenant-scope verified (§10.6).
- [x] §5 Execution model — per-component model declared (§11.1); job idempotency table entries (§11.2); no prompt-partition implications (§11.3); flag-off paths enumerated (§11.4).
- [x] §6 Phase sequencing — no backward references; no orphaned deferrals; no phase-boundary contradictions (§7).
- [x] §7 Deferred Items present (§16).
- [x] §8 Self-consistency pass — this section (§18).
- [x] §9 Testing posture — conforms to `docs/spec-context.md` framing (§15); audit script's framing-deviation acknowledged.
- [x] §10 Execution-safety contracts — idempotency posture, retry classification, concurrency guards, terminal events, no-silent-partial-success, unique-constraint mapping, state-machine closure all declared (§14).
- [x] §11 Frontmatter present (top of file).
- [x] §12 Lifecycle Declaration (§1) and ABCd Estimate (§2) present.

**Self-consistency pass result: PASS.** Spec is ready for `spec-reviewer` (Step 7).
