# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`
**Spec commit at start:** uncommitted (untracked); first commit `aece209f` in iter 1
**Spec commit at finish:** `7feb4609`
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318` (last_reviewed_at 2026-05-11; green)
**Iterations run:** 5 of 5 (lifetime cap reached)
**Exit condition:** iteration-cap
**Verdict:** READY_FOR_BUILD (5 iterations, 69 mechanical fixes applied, 0 directional findings, 1 finding rejected)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 35 | 0 | 34 | 1 (mojibake hallucination) | 0 | 0 | 0 |
| 2 | 15 | 0 | 15 | 0 | 0 | 0 | 0 |
| 3 | 10 | 0 | 10 | 0 | 0 | 0 | 0 |
| 4 | 6 | 0 | 6 | 0 | 0 | 0 | 0 |
| 5 | 4 | 0 | 4 | 0 | 0 | 0 | 0 |

**Trajectory:** 35 → 15 → 10 → 6 → 4. Clean diminishing-returns curve; the spec has converged.

**Zero directional / ambiguous findings across all 5 iterations.** The operator's 9-round grill upstream had already eliminated the entire class of "add a feature flag", "stage the rollout", "add more tests", "add a new abstraction" findings that the framing assumptions would auto-reject. Codex stayed within the mechanical lane.

---

## Mechanical changes applied (highlights)

### Schema & contracts
- `consolidation_tier` pinned as `NOT NULL DEFAULT 'episodic'` (column default doubles as backfill; new-row default avoids touching `extract.ts`).
- Promotion path mints a new `memory_block_versions` row (`change_source = 'tier_promotion'`, new columns `tier_at_capture`, `old_tier_at_capture`, `config_version_at_capture`) BEFORE invoking `writeLineageRowsForVersion(cluster: [])`. Verified against `server/services/memoryBlockLineageService.ts:11-23` — the function signature requires `blockVersionId`; empty-cluster invocation is a no-op (verified at `:65-68`).
- Review-queue schema mismatch fixed: spec said `decision_type`, the actual `server/db/schema/memoryReviewQueue.ts:36` uses `item_type` and stores item-type-specific data in JSONB `payload`. Added top-level `block_id` + `cooldown_until` columns; partial unique index for procedural-promotion dedupe.
- `server/config/featureFlags.ts` pinned as **New** file (verified does not exist); `getMemoryConsolidationTierEnabled(): boolean` exported.
- `memoryReviewQueueService.ts` (verified exists) added to file inventory as the owner of `approvePromoteToProcedural` / `rejectPromoteToProcedural` methods; routes are thin shims.

### Signal sourcing
- `reinforcementCount` and `crossSessionRecurrence` derive from `agent_run_prompts JOIN agent_runs` (the persisted retrieval-trace path). The `last_accessed_at` column tracks LATEST access only and cannot answer count or distinct-day questions — only `recency` uses it.
- Audit Check 5 rewritten with two sub-checks: trace-derived activity (eligibility) + sample-vs-column reconciliation (verifies the batch flusher actually advanced `last_accessed_at`).
- JSONB-path predicate pinned: `EXISTS (SELECT 1 FROM jsonb_array_elements(payload -> 'memory.retrieved' -> 'topEntries') AS entry WHERE entry ->> 'blockId' = $blockId)`.

### Transactional invariants
- Canonical promotion transaction order pinned for BOTH paths: validate → guarded UPDATE → mint version → lineage → [procedural only: mark queue approved] → commit → outbox emit `memory.block.promoted`.
- LAEL event emission moved to outbox pattern (post-commit, best-effort, tier-3 retry); audit Check 2 reconciles `memory_block_versions` rows (`change_source = 'tier_promotion'`) against emitted events using `(memory_block_id, old_tier_at_capture, tier_at_capture, config_version_at_capture)` as the canonical key.
- Idempotency key for `memory.block.promoted` pinned at `(blockId, oldTier, newTier, configVersion)` — timestamp dropped (would defeat retry-dedup).
- `null → procedural` made structurally impossible by the `NOT NULL DEFAULT 'episodic'` column.
- Shared `isValidPromotionTransition(oldTier, newTier): boolean` helper pinned at `shared/types/memoryConsolidation.ts`; called by every tier-write path AND by audit Check 2.

### Audit script
- Path locked: `scripts/audit/audit-memory-consolidation.ts` (no `scripts/gates/` fallback).
- `AuditCheckResult.status` extended with `'n/a'`; verdict computation treats `pass | n/a` as pass. Check 1 (tier distribution) requires ≥ 100 blocks per tenant for `fail` eligibility; Check 2 (promotion events) requires either ≥ 10 source-tier candidates with signal scores (auto) or ≥ 1 pending procedural review-queue row (operator-approved) for `fail` eligibility.
- Check 3 (signal dominance) formula pinned: `weightedContribution = signalValue × signalWeight; dominanceFraction = weightedContribution / event.totalScore`; uses the EVENT's `configVersion`, not the active config (historical correctness).
- Flag-flip evidence pinned: four per-pass JSON snapshots committed to `tasks/operational/memory-tiered-consolidation-staging-audit-<ISO-date>.json`; REVIEW_GAP override at `tasks/operational/memory-tiered-consolidation-flag-flip-override-<ISO-date>.md` following `CLAUDE.md § REVIEW_GAP artifact format`.

### Config selector
- `MEMORY_CONSOLIDATION_CONFIG_HISTORY: MemoryConsolidationConfig[]` + `ACTIVE_MEMORY_CONSOLIDATION_CONFIG_VERSION: number` both exported from `server/config/memoryConsolidationConfig.ts`. Consumers use `.find(c => c.version === ACTIVE_…)` lookup — no implicit `slice(-1)[0]` selection.
- Tier multipliers pinned as living in `MemoryConsolidationConfig.tierMultipliersByProfile` (single source of truth). `queryIntent.ts` / `RetrievalProfile` is NOT modified.

### Other
- 5 §17 Open Questions resolved at spec (decay-job role; review-queue migration phase; permission key; CI integration; audit-script path).
- 1 finding rejected (iter 1 F35 mojibake — Codex TUI rendering artefact; file is proper UTF-8 per `file` command and `→`/`§` char counts).

---

## Rejected findings

- **iter 1 F35 — Mojibake (whole document encoding).** REJECTED. Codex claimed the spec file contains mojibake for arrows / section symbols. Verified false: `file` reports proper UTF-8; direct character-count grep confirms `→` = 48 occurrences, `§` = 70 occurrences (matching expected). This is a Codex TUI rendering artefact during its review pass, not a real file issue.

---

## Directional and ambiguous findings (autonomously decided)

**None.** Zero directional and zero ambiguous findings across all 5 iterations. The operator's 9-round grill (see `tasks/builds/memory-tiered-consolidation/intent.md § Grill-me Q&A`) had pre-emptively addressed every class of finding that would have been classified as directional (feature-flag posture, testing posture, scope decisions, primitive choices). Codex stayed entirely in the mechanical lane.

No items routed to `tasks/todo.md`.

---

## Iteration commit trail

- iter 1 → `aece209f` — 34 mechanical fixes (including load-bearing `writeLineageRowsForVersion` contract fix)
- iter 2 → `283d1ada` — 15 schema-shape fixes (review_queue, memory_block_versions) + iter-1 ripples
- iter 3 → `7ebc0021` — 10 iter-2 ripple cleanups (transaction order, old_tier_at_capture, JSONB-path pin)
- iter 4 → `d7d8071f` — 6 stale-prose cleanups (migration counts, snake_case→camelCase, decay-job wording)
- iter 5 → `7feb4609` — 4 final convergence fixes (tier-multiplier SSOT, step-count wording, optional-fields list)

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The lifetime iteration cap (5) was reached, but the trajectory (35 → 15 → 10 → 6 → 4) shows clean convergence; iter 6 would likely return ≤ 3 narrow findings. However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §5 Framing assumptions section yourself before calling the spec implementation-ready. As of 2026-05-18, `docs/spec-context.md` is 7 days old (green; well within the 60-day warn threshold).
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement. The 9-round operator grill upstream (see `intent.md`) is the right place to look for any directional surface area that survives — its Q&A is the durable record of the operator's framing choices.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job (specifically: handoff to `architect` for the plan-chunk breakdown).

**Recommended next step:** the operator re-reads §3 Goals + §5 Framing assumptions + §6 Phase plan (first ~270 lines of the spec) to confirm the headline framing matches current intent, then invokes `architect` to break the spec into builder chunks. The architect's plan is the next gate.
