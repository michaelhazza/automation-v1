# Handoff — memory-tiered-consolidation

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** [`docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md`](../../../docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md)
**Branch:** `memory-tiered-consolidation`
**Build slug:** `memory-tiered-consolidation`
**UI-touching:** no (only operator-visible surface is the existing `MemoryReviewQueuePage.tsx` extended with a new `promote_to_procedural` card variant — described in prose; no mockup loop per operator decision Round 9)
**Mockup paths:** n/a
**Spec-reviewer iterations used:** 5 / 5 (cap reached; READY_FOR_BUILD verdict; 69 mechanical fixes applied across 5 iterations)
**ChatGPT spec review log:** [`tasks/review-logs/chatgpt-spec-review-memory-tiered-consolidation-2026-05-18T01-22-31Z.md`](../../review-logs/chatgpt-spec-review-memory-tiered-consolidation-2026-05-18T01-22-31Z.md)
**Spec-reviewer logs:**
- Plan: `tasks/review-logs/spec-review-plan-memory-tiered-consolidation-*.md`
- Iterations 1-5: `tasks/review-logs/spec-review-log-memory-tiered-consolidation-{1..5}-*.md`
- Final report: `tasks/review-logs/spec-review-final-memory-tiered-consolidation-2026-05-18T01-11-37Z.md`

**PR:** [#351](https://github.com/michaelhazza/automation-v1/pull/351)

## Table of contents

1. Open questions for Phase 2
2. Decisions made in Phase 1
3. Post-launch follow-up
4. Plan-time directives for the architect
5. Phase 2 entry checklist

---

## 1. Open questions for Phase 2

Architect at plan-authoring locks each of the following per spec §17:

| Question | Recommended default |
|---|---|
| Exact threshold numbers per tier transition | Conservative starting points; tuned post-launch via versioned config |
| Exact decay constants per tier (`strengthByTier`) | working: 3 days, episodic: 14 days, semantic: 90 days, procedural: effectively ∞ (architect locks at plan after seeded-fixture spot-checks) |
| p95 retrieval latency budget number | Measure baseline at plan; lock "no regression vs measured baseline" |
| Persisted-trace vs computed-from-seeds replayability mechanism | Plan author decides based on storage / perf tradeoff |
| Specific tier-multiplier values per profile (in `MemoryConsolidationConfig.tierMultipliersByProfile`) | Conversational boosts working; workflow-execution boosts procedural; reporting boosts semantic; neutral 1.0 baseline |
| JSONB shape for `signalContributions` on `memory.block.promoted` events | Already pinned in §9.5 — `{ reinforcementCount, crossSessionRecurrence, recency }` |
| Audit script exact path | `scripts/audit/audit-memory-consolidation.ts` (recommended per existing `audit-runner` convention) |
| Audit script warmup-days default | 14 |
| Reinforcement batch flush interval + event-count threshold | 60s OR 500 events |
| Phase 4 review-queue discriminator migration: folded into Phase 1 or kept separate | Recommended separate per §10.3 |
| Whether `memoryDecayJob` retained as hourly maintenance with logging-only role | Retain hourly with logging-only role |
| Whether a separate `MEMORY_PROMOTE_APPROVE` permission is added or existing review-approve permission is reused | Reuse existing |
| Whether `MEMORY_CONSOLIDATION_CONFIG_HISTORY` lives in-source or in DB | In-source initially |
| Whether audit script auto-runs in CI weekly | NOT in v1; deferred per §6 Phase 5 |
| Per-block cooldown duration for rejected procedural promotions | 30 days |

**Spec-reviewer cap note (per playbook Step 7 failure path):** spec-reviewer used all 5 lifetime iterations. ChatGPT-spec-review Round 2 closing line said "I'd call the spec clean for spec-reviewer" — i.e. recommended another spec-reviewer pass after the chatgpt fixes. Cap is exhausted; this cannot run. The chatgpt fixes were spec-internal consistency cleanups (one-rule-four-contexts standardisation, observability list completeness, contradiction sweep, down-migration ordering) that the next spec-reviewer pass would have caught. Directional review for any future spec amendment is **operator-owned** per the playbook.

## 2. Decisions made in Phase 1

### 2.1 Phase 1 entry decisions (Step 3a Revise loop)

- **Revise loop outcome (2026-05-18):** Brief v3.1 rewritten to v4.0 after operator-requested deep audit revealed `workspaceMemoryService` already has RRF + graph + intent classifier + HyDE + reranker (the brief's "flat store" premise was factually wrong), AND `memory-improvements` (PR #298, 2026-05-13) had already shipped synthesis lineage + citation utility + AKR semantic ranker. Brief v4.0 narrows scope to genuinely-novel content: tier-semantic model + Ebbinghaus decay + reinforcement-driven promotion + tier-aware retrieval boost.
- **Tier column collision (Round 0 — codebase-resolved):** Path A. Add NEW `consolidation_tier text` column; leave existing `tier smallint` (F1 baseline artefacts, 6+ runtime consumers) untouched.

### 2.2 Phase 1 grill decisions (Step 3b Rounds 1-9)

- **Round 1 — Tier 5 (explicit `memory_block_edges` graph table):** DEFER. The existing `graphExpansion.ts` `task_slug` join is the v1 graph layer.
- **Round 2 — Pre-prod / pre-launch timing:** PROCEED with three guardrails locked (G1 flag-default-OFF, G2 observability built in, G3 audit-script flag-flip gate).
- **Round 3 — Audit script:** LOCKED as v1 deliverable. Gates the production flag flip on 4 consecutive weekly `pass` runs against staging.
- **Round 4 — Multi-signal reinforcement:** THREE signals — `reinforcement_count + cross_session_recurrence + recency`, additive scoring, config-driven weights. Operator pushed back on the initial 2-signal recommendation correctly — adding `recency` later requires unrecoverable backfill.
- **Round 5 — Procedural promotion:** OPERATOR CONFIRMATION REQUIRED via the existing `memoryBlockReviewQueue`. Other three tier transitions fire automatically when thresholds clear.
- **Round 6 — Reinforcement-on-access:** BATCHED (not sampled). Single `UPDATE` per tenant flushed every 60s or every 500 events.
- **Round 7 — Backfill default:** Default ALL existing memories to `episodic`. Promotions happen naturally over time.
- **Round 8 — Tier-aware boost context:** Reuse the existing `classifyQueryIntent` + `RETRIEVAL_PROFILES`. Tier multipliers sourced from `MemoryConsolidationConfig.tierMultipliersByProfile`. `queryIntent.ts` itself NOT modified.
- **Round 9 — Mockups before spec authoring:** SKIP. Review-queue card extends existing pattern; audit script output is CLI / JSON / log file.

### 2.3 Locked Guardrails (G1–G3, from intent.md and spec §12)

- **G1 — Flag-default-OFF in every environment.** Single feature flag `MEMORY_CONSOLIDATION_TIER_ENABLED` gates tier-aware promotion + decay + retrieval boost as a unit. Default OFF at deploy time everywhere.
- **G2 — Observability built into THIS build.** Four hooks ship in v1: extended `memory.retrieved` payload (5 fields: `tier`, `decayWeight`, `tierMultiplier`, `memoryConsolidationConfigVersion`, `lastAccessedAtAtRetrieval`); new event `memory.block.promoted`; `reinforcement_batch_updates_total` + `reinforcement_batch_flush_ms` counters; per-cycle promotion-job structured log.
- **G3 — Audit script + flag-flip gate.** Production flag flip MUST NOT happen until the audit script returns `pass` against staging for 4 consecutive weekly runs. Operator override requires `REVIEW_GAP`.

### 2.4 Pipeline review decisions

- **Spec-reviewer (Step 7):** READY_FOR_BUILD after 5 iterations. 69 mechanical fixes; 1 rejection; 0 directional findings. Material catches: `writeLineageRowsForVersion` needs `blockVersionId` (pinned new version-minting in promotion path); `server/config/featureFlags.ts` did not exist (changed from Modify to New); review-queue schema uses `item_type` + JSONB payload (not `decision_type` column); `memory_block_versions` column-name corrections; reinforcement-count derived from `agent_run_prompts JOIN agent_runs` joins.
- **ChatGPT-spec-review (Step 8):** APPROVED_AFTER_FIXES after 2 rounds. 6 fixes total (4 R1 + 2 R2), all technical. R1 catches: §3/§7/§18 stale references to modifying `queryIntent.ts`; down migration was dropping column before index; invalid-transition handling needed standardising across 4 contexts; "byte-identical" overclaim (replaced with four-axes precision). R2 catches: §6 Phase 4 step 1 still said "abort transaction" instead of "skip + log + counter"; §12 G2 observability list was missing `lastAccessedAtAtRetrieval`.

## 3. Post-launch follow-up (from intent.md and spec §16)

Items deferred from v1, surfaced by audit-script signal:

- **Tier 5 — explicit `memory_block_edges` graph table.** Trigger: audit shows retrieval failures the existing `task_slug` join cannot explain.
- **Four additional reinforcement signals** (contradiction score, agent confidence, operator reinforcement, retrieval-success score). Trigger: their external infrastructure ships independently.
- **Per-tier flag granularity** (separate flags for decay / boost / promotion). Trigger: any subsystem misbehaves and operator needs surgical rollback.
- **Operator dashboard for tier-distribution and promotion events** beyond audit script CLI output. Trigger: post-launch review shows operators need direct UI.
- **Sampled reinforcement** alternative to batched. Trigger: audit shows reinforcement batch updates causing contention at production scale.
- **Demotion transitions** (`semantic → episodic`, `episodic → working`). Trigger: post-launch review identifies blocks that should naturally demote.
- **Relaxing procedural promotion to auto with higher threshold.** Trigger: approval rate trends near 100% over first 90 days.
- **CI integration for the audit script.** Trigger: architect rolls in at plan, or post-launch decision.
- **Promotion-event signal-contribution UI visualisation.** Trigger: operator wants drill-down beyond raw event payload.
- **`MEMORY_CONSOLIDATION_CONFIG_HISTORY` persistence in DB** (currently in-source). Trigger: config-tuning frequency exceeds in-source code-review comfort.

## 4. Plan-time directives for the architect

When `feature-coordinator` invokes `architect` for plan breakdown:

1. **Lock initial values in `MemoryConsolidationConfig` v1** for: tier-strength constants, signal weights, per-transition thresholds, per-profile tier multipliers, reinforcement batch interval, audit warmup-days. Architect picks conservative starting values; post-launch tuning happens via config-version bump per §6.
2. **Decompose into builder chunks per phase** — Phase 1 likely 2-3 chunks (migration + LAEL extension + flag scaffolding), Phase 2 likely 2-3 chunks (decayPure + memoryDecayJob replacement + reinforcementBatch), Phase 3 likely 1-2 chunks (config introduction + post-fusion multiplier), Phase 4 likely 3-4 chunks (evaluatePromotion + dispatcher + auto job + procedural review-queue integration), Phase 5 likely 2 chunks (audit script + trend-log scaffolding). Total ~10-14 chunks; architect decides final granularity.
3. **Lock test inventory** per the test files named in spec §8. Architect names the minimum test cases per file based on the contract shapes.
4. **Confirm migration numbering** for the new column-add migration AND the new Phase 4 review-queue-discriminator migration (recommend separate per §10.3 and Q-10 above).
5. **Confirm `server/config/featureFlags.ts` is a NEW file** (per spec-reviewer iter-2 correction); architect verifies and either creates it or routes the flag through an existing flag-reader if one materialises during plan inventory.
6. **Promotion path version-minting:** spec §14.1 requires every promotion mints a `memory_block_versions` row first (so `writeLineageRowsForVersion` can be invoked). Architect picks whether `evaluatePromotion` itself mints the version row or the dispatcher does. Recommend dispatcher.
7. **Audit script's first-run fixture:** architect locks the seeded-fixture set so the audit's first run against local-dev produces predictable per-check results.

## 5. Phase 2 entry checklist

Before launching `feature-coordinator` in a new session:

- [x] Spec at `docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md` (1108 lines, latest commit `46cd02e9` post-chatgpt R2).
- [x] All review logs committed and pushed.
- [x] PR #351 open and tracking the branch.
- [ ] `tasks/current-focus.md` will transition `PLANNING → BUILDING` in Step 10 (next step).
- [ ] Build directory `tasks/builds/memory-tiered-consolidation/` contains: `brief.md` (v4.0), `intent.md` (v2 + 9 grill rounds), `progress.md` (Phase 1 status table + Revise loop closure), `handoff.md` (this file).
- [ ] Operator opens a new Claude Code session and types `launch feature coordinator`.
