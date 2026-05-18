# Intent — memory-tiered-consolidation

**Source brief:** [`tasks/builds/memory-tiered-consolidation/brief.md`](./brief.md) (v4.0, 2026-05-18 — re-grounded against shipped state)
**Class:** Significant (architect to confirm Major upgrade at spec authoring)
**Branch:** `memory-tiered-consolidation`
**Authored:** 2026-05-18 (intent v1)
**Revised:** 2026-05-18 (intent v2 — closes Revise loop against brief v4.0)

This intent file is the Phase 1 intake artefact for the spec-coordinator. v2 replaces v1 after the Step 3a Revise loop fired and the operator chose "Rewrite brief to scope-down". Every section is refreshed against current shipped state of `workspaceMemoryService` and `memory-improvements` (PR #298, merged 2026-05-13).

---

## Problem Statement

Today's `server/services/workspaceMemoryService/` ranks and retrieves memory effectively (RRF fusion via `hybridRetrieval.ts`, intent-classified retrieval profiles, HyDE expansion, reranker, graph expansion via `task_slug`, recency boost — all shipped) but does NOT distinguish memory by **lifecycle role**. Every memory block lives at the same conceptual layer regardless of whether it is a recent transient observation, a specific event, a consolidated fact, or a repeatable procedure. Two operator-reported failures follow:

1. **"The agent forgot what we did last week."** Recent observations age out at the same rate as durable facts; recent context gets crowded out.
2. **"The same observation keeps re-appearing instead of becoming a learned fact."** The synthesis service mints blocks but does not promote them through a lifecycle.

Root cause: absence of a **consolidation-tier lifecycle** on memory blocks. Decay parameters, retrieval boosting, and synthesis-vs-promotion semantics all want to vary by lifecycle role; today they cannot.

## Desired Outcome

Add a **consolidation-tier** lifecycle to `memory_blocks` (`working | episodic | semantic | procedural`) with tier-aware promotion via multi-signal reinforcement, Ebbinghaus decay with tier-specific strengths, async/sampled reinforcement-on-access tracking, and tier-aware retrieval boosting that integrates into the **existing** RRF fusion. Preserve every shipped primitive (pgvector, RRF, graph expansion, intent profiles, HyDE, reranker, recency boost, memory-improvements lineage + utility + AKR ranker). The retrieval API surface stays stable; tier and decay are internals. Behaviour-flagged so flag-off restores today's shipped retrieval ordering without schema rollback.

## Non-Goals

Carried from brief v3.1:
- New memory write APIs for agents.
- Cross-tenant memory sharing.
- Memory export/import tooling.
- A per-tenant UI for browsing the memory store.
- Replacing the embedding model.
- Memory-to-RAG external integration.
- Procedural memory granting autonomous execution authority.

Added in v4.0 (explicit non-rebuild list):
- Re-implementing RRF, graph expansion, intent classification, HyDE, reranker, or recency boost. All shipped; extend in place.
- Creating a parallel retrieval module. Tier-aware boosting integrates into `hybridRetrieval.ts`.
- Altering `memory_block_version_sources` (lineage), `injected_entry_ids` (utility), or AKR semantic ranker shipped by memory-improvements.
- Repurposing the existing `tier smallint` column (F1 baseline artefacts, migration 0277). New column required (Path A).
- Changing `SynthesisTier` semantics in `memoryBlockSynthesisService.ts` (confidence routing). Lifecycle promotion is a distinct concern.

## Affected Capability Area

Memory & Knowledge

(Single cluster. Modifies the `memory-knowledge-system` Asset Register row's internals without changing its external contract. `document-bundles-cached-context` and `memory-injection-utility` are NOT touched by this build.)

## User / Operator Impact

Operator surface unchanged in v1. Downstream effects:
- Personal Assistant agents distinguish recent transient observations from durable facts.
- Reporting Agents reference older consolidated decisions without re-briefing.
- Learned procedures get promoted to `procedural` tier and surface in workflow-execution contexts.
- The reinforcement signal becomes the foundation for future learn-from-correction loops.

No UI changes. No new routes. No new permissions.

## Risk Surface

server/db/schema, RLS migrations, agent runtime

(Vocabulary terms from `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.1.1`. Three terms apply: schema modification on `memory_blocks` plus optional new `memory_block_edges` table; RLS policy inheritance on both; agent runtime is the consumer of every retrieval call.)

## Assumptions

- Existing `memory_blocks` RLS policies extend cleanly to a new `consolidation_tier` column and an optional new `memory_block_edges` table (architect verifies at spec).
- Existing pgvector index remains adequate; no new vector index needed.
- Existing `memoryBlockSynthesisService.ts` can take lifecycle promotion as a distinct concern alongside its current confidence-tier routing without conflating the two.
- Existing 18-line `memoryDecayJob.ts` is a safe stub to replace with tier-aware Ebbinghaus — no production behaviour to regress.
- Existing `memory-improvements` lineage rows continue to be written correctly by promotion paths (composition, not collision).
- Behaviour-flag mechanism per `docs/spec-context.md` (`feature_flags: only_for_behaviour_modes`) suffices for rollout gating.
- Curated evaluation set of 50 historical operator conversations can be assembled during spec authoring; baseline measured against current shipped behaviour, not pre-shipping flat-store.
- `Path A` (two columns coexist — add `consolidation_tier text`, keep `tier smallint` as `baseline-artefact tier`) is the default; architect may override at spec with rationale.
- Reinforcement-on-access can be implemented async or sampled without breaking caller-visible retrieval semantics.

## Open Questions

- Multi-signal reinforcement weighting: which signals (recency, reinforcement count, contradiction score, retrieval-success score, agent confidence, operator reinforcement, cross-session recurrence) compose, and with what weights? Architect locks at spec.
- Procedural tier promotion: threshold and operator-confirmation rule? Procedural blast radius is larger; architect locks how much higher the bar is.
- Tier column collision resolution: Path A (default — two columns coexist), Path B (rename existing → `baseline_tier`), or override? Architect locks at spec.
- Tier 5 (explicit `memory_block_edges` graph table): ship as part of this build, or defer? Architect decides whether the current `task_slug` join in `graphExpansion.ts` is sufficient.
- If Tier 5 ships — graph edge governance details: edge creation rules (explicit vs inferred), directionality, edge-confidence scoring, deletion semantics, contradiction handling, cycle handling, traversal-depth ceiling, per-node fan-out cap.
- p95 retrieval latency budget number — baseline measured at spec authoring; what tolerance for tier-aware boost overhead?
- Reinforcement-on-access sampling strategy and rate.
- Backfill default: `episodic` for all existing blocks; idempotency contract for the one-time backfill.
- Replayability: persisted RRF + tier-multiplier traces vs "recomputable from seeds + config version" — which is required?

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

### Step 3a re-run (intent v2 against brief v4.0)

After the v4.0 rewrite, every shipped primitive is acknowledged in the brief's "What already exists" section and explicitly excluded from scope under "Out of scope — non-rebuild list". The genuinely-novel content (consolidation-tier lifecycle + tier promotion + Ebbinghaus decay + reinforcement tracking + tier-aware retrieval boost) has no equivalent in the Asset Register or in any in-flight or shipped build.

**Asset Register comparison:** `memory-knowledge-system` (Mature) row is the parent we extend; no row covers the consolidation lifecycle this build introduces. `memory-injection-utility` (Growth) and `document-bundles-cached-context` (Growth) are independent. No duplicate.

**In-flight spec comparison:** `memory-improvements` (PR #298, MERGED 2026-05-13) shipped lineage + utility + AKR ranker — complementary, not overlapping. `auto-knowledge-retrieval-v2-ranker` is a STUB awaiting ADR-0017 trigger — not active. No collision.

**Cluster collapse:** single cluster (`Memory & Knowledge`); no multi-cluster tie-break needed.
**Lifecycle collapse:** single Asset Register row affected (`memory-knowledge-system`, Mature); no mixed-state tie-break needed.

**Decision:** `proceed`. Coordinator advances to Step 3b (grill-me).

---

## Grill-me Q&A

### Round 0 — Tier column collision resolution (codebase-resolved, no operator question needed)

**Finding:** `memory_blocks.tier` is consumed at 6+ real call sites with the `1|2` semantics baked into the agent execution pipeline:
- `server/services/agentExecutionService/runLifecycle/prepare.ts:318,325` — Tier-2 filter for prompt injection (`(block as { tier?: 1 | 2 | null }).tier === 2`).
- `server/services/memoryBlockService.ts:312,402,409,923` — Tier-1 and Tier-2 queries; explicit "baseline artefact tier classification" comment.
- Plus tests at `server/services/__tests__/memoryBlockService.tier.test.ts`.

**Resolution:** **Path A confirmed.** Add `consolidation_tier text` as a NEW column; leave the existing `tier smallint` column and all its consumers untouched. Renaming would create unnecessary blast radius across runtime-critical baseline-artefact injection. Recorded as a closed decision; no operator confirmation needed.

### Round 1 — Tier 5 (explicit `memory_block_edges` graph table): ship or defer?

**Recommended answer:** Defer to a follow-up build. The existing `graphExpansion.ts` already implements the "graph retriever" leg via shared `task_slug` join. Tier 5 is purely additive scope on top of the core consolidation work; deferring it keeps v1 focused and creates a clean post-launch eval trigger ("does the `task_slug` join prove too coarse?") for a v2 build.

**Operator decision:** **defer.** Locked. Trigger for revisiting: post-launch eval shows the `task_slug` join is too coarse for operator-experienced retrieval failures.

### Round 2 — Pre-prod / pre-launch / pre-testing timing: proceed with this Significant build, or defer the whole thing?

Operator raised the legitimate concern that we're shipping into a pre-test, pre-prod codebase and asked whether this is the right window for a Significant memory-system upgrade. Cost-benefit walkthrough produced:

- **Migration risk:** low (`ALTER TABLE ADD COLUMN` + RLS-aware backfill — standard pattern).
- **Performance:** negligible (tier multiplier is one extra multiplication per candidate; decay already O(N)).
- **Schema lock-in:** low if tier values chosen well.
- **Maintenance / conceptual surface:** moderate (4-tier model + Ebbinghaus + reinforcement is more to reason about).
- **Coupling:** moderate, mitigatable by keeping tier as additive metadata (existing flows do not depend on it).
- **Always-on residual cost if flag is OFF:** near-zero (one nullable column, stub job that no-ops, post-fusion boost that no-ops).
- **Observability baseline already adequate:** LAEL emits `memory.retrieved` per agent run; `mv_memory_utility_30d` tracks per-agent citation rate over 30 days; `agent_run_prompts` + `agent_run_llm_payloads` capture every retrieval input/output. Pre-prod is structurally the cheapest time to add a schema column — no live agencies, no incident risk, `commit_and_revert` rollout model.

**Recommended answer:** Proceed with three guardrails locked into the spec (see below).

**Operator decision:** **proceed with guardrails locked.** Locked.

### Round 3 — Audit script as a v1 deliverable to replace the calendar-reminder model

Operator pushed back on the "30-day calendar reminder" post-launch review model and proposed a repeatable audit script that runs against any environment (local / staging / prod), trends results over time, and gates the flag-flip on data rather than a calendar date. This is a markedly better governance model and is locked as a v1 deliverable.

**Operator decision:** **lock the audit script as a v1 deliverable.** Locked.

---

## Locked Guardrails (carry into spec authoring)

Every guardrail below is a non-negotiable spec requirement that emerged from Rounds 2 and 3. Spec author MUST honour each one; deviation requires explicit operator approval.

### G1 — Behaviour-flag-default-OFF in every environment

A single feature flag (working name: `MEMORY_CONSOLIDATION_TIER_ENABLED`) gates tier-aware promotion, tier-aware decay, and tier-aware retrieval boost as a unit. Default value in every environment (local / staging / prod) at deploy time: **OFF**. Flag flips ON per-environment only after the audit gate (G3) is satisfied.

Flag-off behaviour: exact current shipped behaviour (RRF + intent profiles + HyDE + reranker + recency boost — unchanged). The new column(s) and any new tables remain in place but are unused.

### G2 — Observability built into THIS build (not a follow-up)

The following observability hooks ship as part of v1, not deferred:
- Add `tier` field to every `memory.retrieved` event payload (LAEL Phase 1) so per-retrieval tier mix is visible in run timelines.
- New event type `memory.block.promoted` with `old_tier`, `new_tier`, and signal contributions, emitted on every promotion.
- New counter `reinforcement_batch_updates` per cycle in structured logs (count of `last_accessed_at` updates applied).
- Tier multiplier values recorded alongside RRF scores in retrieval trace (for replayability).

These are the observability foundations the audit script (G3) consumes.

### G3 — Audit script + flag-flip gate

New deliverable: `scripts/audit/audit-memory-consolidation.ts` (exact path locked at spec authoring; convention follows `scripts/audit/` or `scripts/gates/` per `references/test-gate-policy.md`).

**Behaviour:**
- Takes a target environment (env var or arg); runs read-only against that database.
- Verifies seven checks:
  1. **Tier distribution** — per tenant, count of blocks in each of working / episodic / semantic / procedural. Flags tenants where a tier is empty after the warmup period.
  2. **Promotion event firing** — count of promotion events per transition over the last 30 days. Flags transitions that never fire.
  3. **Promotion signal contributions** — sample promotions and check that signals other than `reinforcement_count` are contributing. Flags transitions consistently firing on a single signal.
  4. **Decay applied** — sample N retrievals; recompute decay locally; compare to system-applied. Flags drift.
  5. **Reinforcement updates** — count `last_accessed_at` updates per day per tenant. Flags zero-update tenants.
  6. **Citation utility trend** — pulls 30-day series from `mv_memory_utility_30d`; compares to prior runs. Flags negative trend.
  7. **Flag state** — confirms whether the flag is ON or OFF in the target env so the audit results are interpretable.
- Returns `pass | warn | fail` with per-check findings.
- Appends results to a trend log (path locked at spec).
- Routes any `fail` finding into `tasks/todo.md` automatically (mirror the existing `audit-runner` pattern).

**Flag-flip gate (binding):** the feature flag MUST NOT be flipped ON in production until the audit script has returned `pass` against staging for **4 consecutive weekly runs**. This is a hard gate — no operator override without writing a `REVIEW_GAP` with explicit justification.

The audit script is the durable post-launch governance mechanism. It replaces the "30-day calendar reminder" model entirely.

---

## Post-launch follow-up (deferred from v1 — surfaced via audit script signal)

Items deferred from v1 that may trigger follow-up builds based on audit signal:

- **Tier 5 — explicit `memory_block_edges` graph table.** Trigger: audit shows retrieval failures the existing `task_slug` join cannot explain.
- **Operator dashboard for tier-distribution and promotion events.** Trigger: post-launch review shows operators need to see tier behaviour directly (no UI in v1).
- **Per-tier flag granularity** (separate flags for decay vs retrieval boost vs promotion). Trigger: any subsystem misbehaves and the operator needs surgical rollback without losing the others.
- **Reinforcement-on-access full-pipeline tracking** (per-block reinforcement history table beyond `last_accessed_at`). Trigger: signal-weighting tuning needs richer history than aggregate timestamps.
- **Sampling-rate tuning for reinforcement batch.** Trigger: audit shows reinforcement updates causing contention at production scale.

### Round 4 — Multi-signal reinforcement: which signals power tier promotion in v1?

**Recommended answer:** Three signals — `reinforcement_count` + `cross_session_recurrence` + `recency`, additive scoring with config-driven per-signal weights and per-transition thresholds. Operator pushed back on the initial two-signal recommendation with the (correct) observation that adding recency later requires backfill we can't do; cheaper to capture from day one.

**Operator decision:** **three signals locked.** The other four signals (contradiction score, agent confidence, operator reinforcement, retrieval-success score) defer to v2 because they require external infrastructure (contradiction detector, LLM self-reporting, operator UI, retrieval feedback loop) that isn't ready. Spec MUST make per-signal weights and per-transition thresholds config-lookup-driven, not hardcoded — so post-launch tuning happens via config change, not code change.

### Round 5 — Procedural promotion: operator confirmation, automatic, or auto + flag?

**Recommended answer:** Operator confirmation required. Other three tier transitions (working→episodic, episodic→semantic) fire automatically when their thresholds clear. Procedural promotion routes through the existing `memoryBlockReviewQueue` infrastructure.

**Operator decision:** **operator confirmation required.** "Build it so that it has the human in the loop, and if it's happening too frequently, then we can address it later." Locked. Reversibility plan: if approval rate trends near 100% over the first 90 days of audit data, the spec's deferred-items section lists "consider relaxing procedural promotion to auto with a higher threshold" as a follow-up trigger.

### Round 6 — Reinforcement-on-access strategy: batched vs sampled?

**Recommended answer:** Batched. Every access is logged in memory; flushed to the database in batches every minute or every N accesses (architect locks N). Easier to audit (every access eventually recorded); trivial perf at pre-prod scale; reversible if scale changes.

**Operator decision:** **batched.** Locked. If scale changes post-launch and contention surfaces in the audit script's check #5, defer-list item allows switching to sampling.

### Round 7 — Backfill default for existing memories: episodic, or smart-guess?

**Recommended answer:** Default everything to `episodic`. Promotions happen naturally over time based on real usage signals. Smart-guessing tier from existing metadata creates phantom learned data without real-usage evidence.

**Operator decision:** **episodic for all existing blocks.** Locked. Idempotent SQL backfill batch with conservative pacing (architect locks batch size and rate); single transaction per tenant; safe to re-run on partial failure.

### Round 8 — Tier-aware boost context recognition: reuse intent classifier, or hardcoded per-agent-type?

**Recommended answer:** Reuse the existing `classifyQueryIntent` + `RETRIEVAL_PROFILES`. Add a `tierMultipliers` field per profile (one lookup table addition; no new classification logic). Maximum reuse of shipped primitives.

**Operator decision:** **reuse existing intent classifier.** Locked. Per-profile tier-multiplier lookup table is part of the versioned retrieval configuration (G2 observability hook records which config version was applied per retrieval).

---

### Soft checkpoint (after Round 8)

**Branches resolved (rounds 0–8):** Tier column collision (Path A), Tier 5 graph table (defer), build go-ahead with three guardrails (G1–G3), audit script as v1 deliverable, three reinforcement signals (`reinforcement_count` + `cross_session_recurrence` + `recency`), procedural promotion requires operator confirmation, batched reinforcement tracking, episodic backfill default, intent-classifier-driven tier boost.

**Branches still open (architect-lockable engineering decisions; do not require operator input):**
- Exact threshold numbers per tier transition (architect picks conservative starting points)
- Exact decay constants per tier
- p95 latency budget number (measured baseline + tolerance at spec authoring)
- Persisted-trace vs computed-from-seeds replayability mechanism
- Specific tier-multiplier values in the per-profile lookup table
- JSONB shape for signal contributions on promotion events
- Audit script's exact path and log location
- Audit script's warmup-period parameter before flagging empty tiers
- Whether every tier promotion that mints a new version invokes `writeLineageRowsForVersion` (default: yes — composes against shipped lineage; architect verifies during file-inventory pass)

**Branches potentially needing operator input but not raised yet:**
- Operator review-queue UI shape for procedural promotion approvals. Default assumption: the existing `memoryBlockReviewQueue` UI handles this; spec author verifies. If a new UI is needed, that's a meaningful scope addition.

**Checkpoint prompt:** reply `proceed` to end the grill and advance to Step 4 (build slug ratification) + Step 6 (spec authoring); or continue with the procedural-review-queue UI question or anything else.

### Round 9 — Mockups before spec authoring?

**Recommended answer:** Skip. Review-queue card extends an existing pattern (`MemoryReviewQueuePage.tsx` already shipped). Audit script output stays CLI / JSON / log file consumed by existing observability stack. Spec author describes the new review-queue card shape in prose.

**Operator decision:** **skip mockups.** Locked. If a UX gap surfaces during spec-reviewer or chatgpt-spec-review, a mockup loop can be retro-fitted at that time.

---

**Grill terminated** by operator typing `proceed`. Total rounds: 9 (R0 codebase-resolved + R1–R9 operator-decided + soft checkpoint at R8). Coordinator advances to Step 4 (slug ratification) → Step 6 (spec authoring).
