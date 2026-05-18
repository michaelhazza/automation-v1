# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`
**Spec commit at check:** `29ffc27f` (HEAD of `memory-tiered-consolidation`)
**Branch:** `memory-tiered-consolidation`
**Base:** `da370ca9` (merge-base with `main`)
**Scope:** All 12 chunks (Phase 1 through Phase 5 — full spec)
**Changed-code set:** 350 files (caller-confirmed: branch is complete implementation)
**Run at:** 2026-05-18T05:29:32Z

---

## Table of contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## 1. Summary

- Requirements extracted:     ~46 concrete spec items (file/export/schema/behaviour)
- PASS:                       43
- MECHANICAL_GAP → fixed:     3
- DIRECTIONAL_GAP → deferred: 3
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT_AFTER_FIXES (3 mechanical gaps closed in-session; 3 directional gaps routed to `tasks/todo.md`; both pre-acknowledged "known implementation gaps" from the operator's invocation note left in place as previously routed builder entries)

The pre-acknowledged formally-accepted deviations are honoured:
1. `consolidation_tier` placed on `workspace_memory_entries` (not `memory_blocks`) — verified at `server/db/schema/workspaceMemories.ts:184` and migration `0370_workspace_memory_entries_consolidation_tier.sql`.
2. `memory_block_versions` mint replaced by `workspace_memory_entry_tier_transitions` table (durable in-transaction audit trail) — verified at migration `0372` and `server/services/memoryConsolidationPromotionDispatcher.ts:204-213, 318-329`.

---

## 2. Requirements extracted (full checklist)

| REQ | Spec § | Requirement | Verdict |
|---|---|---|---|
| 1 | §6 Phase 1, §8 | Migration adds `consolidation_tier text NOT NULL DEFAULT 'episodic'` with CHECK constraint to `workspace_memory_entries` | PASS — `migrations/0370_workspace_memory_entries_consolidation_tier.sql` |
| 2 | §6 Phase 1 | Index `workspace_memory_entries_consolidation_tier_idx` on `(organisation_id, subaccount_id, consolidation_tier) WHERE deleted_at IS NULL` | PASS |
| 3 | §6 Phase 1 | `.down.sql` drops index before column | PASS |
| 4 | §8 | Drizzle schema mirror in `server/db/schema/workspaceMemories.ts` | PASS — line 184 + line 200 |
| 5 | §8 | `shared/types/memoryConsolidation.ts` exports `ConsolidationTier`, `MemoryConsolidationConfig`, `PromotionSignals`, `PromotionVerdict`, `MemoryConsolidationAuditResult` | PASS |
| 6 | §14.7 | `isValidPromotionTransition(oldTier, newTier): boolean` exported from shared types | PASS |
| 7 | §8 | `server/config/featureFlags.ts` new file exporting `getMemoryConsolidationTierEnabled()` | PASS — also exports `parseBooleanEnv` helper |
| 8 | §8, §9.2 | `memoryConsolidationConfig.ts` exports HISTORY + ACTIVE version + selector | PASS — config v1 with 5 retrieval profiles |
| 9 | §6 Phase 1, §9.6 | `MemoryRetrievedTopEntry` extended with 5 new fields (all optional+nullable) | PASS |
| 10 | §6 Phase 1, §9.5 | New `memory.block.promoted` discriminated-union member with full §9.5 shape | PASS |
| 11 | §6 Phase 1 | `AGENT_EXECUTION_EVENT_CRITICALITY` entry `'memory.block.promoted': false` (tier-3) | PASS |
| 12 | §6 Phase 2, §11.1 | `memoryDecayJob.ts` replaced with logging-only routine (per-tier distribution counts) | PASS — but cadence DIRECTIONAL_GAP (see §4) |
| 13 | §6 Phase 2 | `decayPure.ts` exports `computeDecayWeight` with procedural→1.0, null→1.0 special cases | PASS |
| 14 | §6 Phase 2 | `reinforcementBatch.ts` `recordAccess`, per-tenant buffer, time- + count-triggered flush, single UPDATE per tenant inside withOrgTx, no-op when flag OFF | PASS — flusher started in `server/index.ts:1053,1147` |
| 15 | §6 Phase 2 | `hybridRetrieval.ts` calls `computeDecayWeight` after RRF fusion; skipped if flag OFF | PASS |
| 16 | §6 Phase 3, §9.2 | `tierMultiplierPure.ts` exports `applyTierMultiplier` looking up tierMultipliersByProfile | PASS |
| 17 | §6 Phase 3 | Post-fusion multiplier applied; results re-sorted; trace records multiplier + configVersion | PASS — line 432-440 |
| 18 | §6 Phase 3 | `recordAccess` hooked into final top-K when flag ON; flag-OFF preserves existing synchronous UPDATE | PASS |
| 19 | §11.4, §12 G1 | Per-component flag-OFF early-exit branches | PASS — hybridRetrieval, reinforcementBatch, both jobs |
| 20 | §6 Phase 4 | `evaluatePromotion` exported from `memoryBlockSynthesisService.ts` as a NEW function (existing `decideTier` untouched) | PASS — line 310-361 |
| 21 | §6 Phase 4, §8 | `memoryConsolidationPromotionDispatcher.ts` per-tenant dispatch with canonical sequence | PASS — `dispatchPromotionsForTenant` + shared `runCanonicalPromotion` helper |
| 22 | §6 Phase 4 | `memoryConsolidationPromotionJob.ts` hourly pg-boss job; exits early if flag OFF | PASS |
| 23 | §6 Phase 4 | Queue `memory-consolidation-promotion` registered, schedule `'0 * * * *'` | PASS — `pgBossRegistrations.ts:358, 687` |
| 24 | §10.3, §8 | Migration `0371` adds `block_id` + `cooldown_until` + partial unique index | PASS |
| 25 | §8 | `MemoryReviewItemType` union gains `'promote_to_procedural'` literal | PASS — `memoryReviewQueue.ts:16` |
| 26 | §8 | Drizzle schema adds `blockId` and `cooldownUntil` columns + partial unique index | PASS |
| 27 | §6 Phase 4 / §14.7 | Auto-promotion: validate-transition → guarded UPDATE → audit-trail INSERT all in one tx | PASS — dispatcher line 168-217 |
| 28 | §6 Phase 4 | Procedural candidates inserted with `ON CONFLICT DO NOTHING` (idempotent) | PASS — dispatcher line 141-160 |
| 29 | §6 Phase 4 | `approvePromoteToProcedural` runs SELECT FOR UPDATE → canonical sequence → mark approved | PASS — line 271-350 |
| 30 | §6 Phase 4 | `rejectPromoteToProcedural` sets status='rejected', cooldown=now()+30d | PASS |
| 31 | §14.3 (b) | Dispatcher cooldown check via most-recent queue row | PASS — line 114-132 |
| 32 | §8 | Route dispatches `promote_to_procedural` approve/reject to new service methods | PASS — `memoryReviewQueue.ts:62-67, 94-97` |
| 33 | §8 | `MemoryReviewQueuePage.tsx` renders `promote_to_procedural` card variant | PASS — `PromoteToProceduralBody` rendered at line 202-208 |
| 34 | §8 | Migration `0372` creates `workspace_memory_entry_tier_transitions` per formally-accepted deviation | PASS — all required cols + RLS policy + lookup index |
| 35 | §8 | Drizzle schema mirrors the new table | PASS |
| 36 | §10.2 | RLS-protected-tables registry includes new table | PASS — `rlsProtectedTables.ts:1357` |
| 37 | §8 | `audit-memory-consolidation.ts` 7-check CLI with JSON output, JSONL trend log, fail-routing | PASS — 6 DB checks + 1 pure config-version check |
| 38 | §13.1 | CLI args `--env`, `--warmup-days`, `--out`, `--trend-log`, `--no-todo-routing` | PASS |
| 39 | §13.4 | `formatTodoEntry` pure + `routeFailsTodoMd` filesystem-side split | PASS |
| 40 | §8 | `scripts/audit/_logs/.gitkeep` + `.gitignore` entries | PASS — `.gitignore:37-38` |
| 41 | §8 | Six pure-function Vitest test files per inventory | PASS — all present |
| 42 | §8 | `architecture.md` updates | PASS — line 1626 audit-script entry + Memory & Knowledge section |
| 43 | §8 | `docs/runbooks/memory-tiered-consolidation-runbook.md` | PASS — 102 lines |
| 44 | §8 | `docs/capabilities.md` capability registration | PASS — line 543-557 |
| 45 | §8 | `KNOWLEDGE.md` patterns appended | PASS — line 2600 |
| 46 | §9.4 | `PromotionVerdict.reason` includes `cooldown_active` and `invalid_transition` | **MECHANICAL_GAP → FIXED** |
| 47 | §9.7 | `MemoryConsolidationAuditResult` has `schemaVersion`, `warmupDays`, `flagState` | **MECHANICAL_GAP → FIXED** |
| 48 | §9.7 | Audit script writes the new top-level fields | **MECHANICAL_GAP → FIXED** |
| — | §9.7 | `checks` typed as named record | DIRECTIONAL_GAP — routed |
| — | §6 Phase 2 | Decay-job hourly cadence | DIRECTIONAL_GAP — scheduled daily; routed |
| — | §9.5 | `AgentExecutionSourceService` includes dispatcher/approve-service | DIRECTIONAL_GAP — routed |

Two operator-pre-acknowledged known gaps (already routed in `tasks/todo.md` under "From builder — 2026-05-18"):
- Dispatcher signal-source via `access_count`/`cited_count` instead of `agent_run_prompts` JSONB join.
- `memory.block.promoted` LAEL event not emitted (durable `workspace_memory_entry_tier_transitions` row IS the audit trail).

---

## 3. Mechanical fixes applied

| File | Lines | Change | Spec quote |
|---|---|---|---|
| `shared/types/memoryConsolidation.ts` | 30-35 | `PromotionVerdict.reason` union extended with `'cooldown_active'` and `'invalid_transition'` | §9.4 — *"reason: 'below_threshold' \| 'already_top_tier' \| 'cooldown_active' \| 'invalid_source_tier' \| 'invalid_transition'"* |
| `shared/types/memoryConsolidation.ts` | 62-69 | `MemoryConsolidationAuditResult` extended with `schemaVersion: 1`, `warmupDays: number`, `flagState: 'on' \| 'off' \| 'unknown'` | §9.7 — *"schemaVersion: 1; runAt: string; env: string; warmupDays: number; flagState: 'on' \| 'off' \| 'unknown'; overall: ..."* |
| `scripts/audit/audit-memory-consolidation.ts` | 574-582 | Result construction populates `schemaVersion: 1`, `warmupDays` from CLI args, `flagState: flagEnabled ? 'on' : 'off'` | §9.7 producer contract requires the three fields to be written on every audit run |

Verification: `npm run typecheck` and `npm run lint` both clean after fixes (no new errors; no new warnings).

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

Routed under section `## Deferred from spec-conformance review — memory-tiered-consolidation (2026-05-18)`:

1. **MemoryConsolidationAuditResult.checks shape diverges from spec §9.7** — spec defines `checks` as a named record (`{ tierDistribution, promotionEventFiring, ... }`); impl uses `AuditCheckResult[]`. Refactor or amend spec.
2. **`memoryDecayJob` schedule** — daily at 03:00 vs spec-named hourly. Spec body says "architect confirms cadence" — needs operator/plan check.
3. **`AgentExecutionSourceService` union missing dispatcher entry** — paired with the pre-existing runId-FK blocker.

The two pre-acknowledged operator-noted gaps stay where the builder already routed them:
- Signal source via `access_count`/`cited_count` (pre-existing).
- `tryEmitAgentEvent` for `memory.block.promoted` not emitted (pre-existing).

---

## 5. Files modified by this run

- `shared/types/memoryConsolidation.ts`
- `scripts/audit/audit-memory-consolidation.ts`
- `tasks/todo.md` (new section appended at end)
- `tasks/review-logs/spec-conformance-log-memory-tiered-consolidation-2026-05-18T05-29-32Z.md` (this log)

---

## 6. Next step

**CONFORMANT_AFTER_FIXES** — mechanical gaps closed in-session. Re-run `pr-reviewer` on the expanded changed-code set (the reviewer should see the audit-result shape additions and the verdict-reason union extension). Three directional gaps are documented in `tasks/todo.md` for the main session and architect to resolve before finalisation — none are merge-blocking, but two of them (`memoryDecayJob` cadence and the `checks` shape) deserve an operator decision before this build is closed out.
