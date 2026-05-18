# Memory Tiered Consolidation — Phase 1 Progress

**Build slug:** `memory-tiered-consolidation`
**Branch:** `memory-tiered-consolidation`
**Phase:** 2 (BUILD)
**Started:** 2026-05-18
**Scope class:** Significant (possibly Major — architect to confirm)
**UI-touching:** no (server/db only; operator surface unchanged per brief)

## Phase 1 status

| Step | Status | Notes |
|------|--------|-------|
| 0. Context loading + PLANNING lock | done | Lock acquired 2026-05-18; wave-6 PR #343 marked merged per operator confirmation |
| 1. TodoWrite emitted | done | 13 items |
| 2. S0 branch-sync | done | 0 commits behind `origin/main`; no merge needed |
| 3. Intent intake + UI-touch | done | `ui_touch = false`; Step 5 mockup loop skipped |
| 3a. Duplication / Strategy Check | **revise gate fired** | See escalation block below |
| 3b. Grill-me Q&A | pending | Will run after operator resolves revise loop |
| 4. Build slug + directory | partial | Slug pre-existing (`memory-tiered-consolidation`); directory pre-existing |
| 5. Mockup loop | skipped | `ui_touch = false` |
| 6. Spec authoring | pending | |
| 7. spec-reviewer | pending | |
| 8. chatgpt-spec-review | pending | MANUAL mode |
| 9. Handoff write | pending | |
| 10. current-focus.md → BUILDING | pending | |
| 11. End-of-phase prompt + auto-commit | pending | |

---

## Brief reference

Source brief: [`tasks/builds/memory-tiered-consolidation/brief.md`](./brief.md) (v3.1, 2026-05-18)

Intent file: [`tasks/builds/memory-tiered-consolidation/intent.md`](./intent.md) (authored 2026-05-18 from brief)

---

### Revise loop

**Step 3a outputs (filled in `intent.md § Duplication / Strategy Check`):**

| Output | Value |
|---|---|
| Duplication assessment | partial overlap |
| Strategic fit | clear |
| Recommendation | revise |

**Why the gate fired:**

A deep code audit performed during Step 3a (operator requested verification of the original handoff signal that flagged `memory-improvements` as unbuilt) revealed two distinct overlap problems with the brief as written:

1. **The brief's diagnosis is factually wrong against current shipped state.** `workspaceMemoryService` is NOT a flat store. RRF fusion is already implemented (`hybridRetrieval.ts` with `RRF_K` / `RRF_MIN_SCORE`); graph expansion is already implemented (`graphExpansion.ts` joining by `task_slug`); the `memory_blocks.tier` column already exists (migration 0277, `1=foundational, 2=strategic`); intent-classified retrieval profiles, HyDE, reranker, and recency boost are all shipped.

2. **The handoff.md for `memory-improvements` was stale.** That build was actually merged as PR #298 on 2026-05-13 (commit `2bd3d6d3`). Synthesis lineage, citation utility metric, AKR semantic ranker, the `memory_block_version_sources` table, `injected_entry_ids` column, and `mv_memory_utility_30d` materialised view all shipped.

The genuinely-novel content the brief proposes — four-tier semantic model (`working | episodic | semantic | procedural`), tier promotion via consolidation, Ebbinghaus decay with tier-specific strength, reinforcement-on-access tracking, and a deeper explicit `memory_block_edges` graph table — has no shipped equivalent. But this is a much narrower scope than the brief currently describes.

**Direct collision:** the proposed `memory_blocks.tier` enum (`working|episodic|semantic|procedural`) would conflict with the existing `tier smallint` column whose values are `1|2`. Either rename the new column (e.g. `consolidation_tier`) or rename / migrate the existing column. Decision required at intent-amendment time.

**Operator action required:**

Amend `intent.md` to:

1. Refresh **Problem Statement** to acknowledge that RRF + graph + intent-classified retrieval is already shipped. The actual gap is "no semantic-tier model that controls retention vs surfacing, and no reinforcement-driven promotion".
2. Refresh **Desired Outcome** to scope down to the genuinely-novel content: tier-semantic model + consolidation + Ebbinghaus decay + reinforcement tracking + (optional) deeper graph layer. Drop the "introduce RRF" framing.
3. Reconcile **Affected Capability Area** stays `Memory & Knowledge` (no change).
4. Reconcile **Non-Goals** to add: "do not re-implement RRF, intent classification, graph expansion, HyDE, reranker, or recency boost — extend the existing primitives instead".
5. Decide on the `tier` column collision: rename new column, or migrate existing column, or use a different schema strategy.
6. Acknowledge dependencies on shipped `memory-improvements` work (lineage table, utility metric) where the new consolidation rules will compose against them.

After amending `intent.md`, append the following line at the end of this `### Revise loop` section to release the gate:

```
**Operator decision:** revision complete
```

Coordinator then re-runs Step 3a from the top.

**Reference for the audit:**
- `server/services/workspaceMemoryService/hybridRetrieval.ts` (RRF + intent profiles + HyDE + reranker)
- `server/services/workspaceMemoryService/graphExpansion.ts` (existing graph layer)
- `server/services/workspaceMemoryService/retrieve.ts` (RRF wrapper)
- `server/db/schema/memoryBlocks.ts` lines 116-119, 151-154 (existing `tier` column + index)
- `server/services/memoryBlockSynthesisService.ts` lines 10, 175-188 (existing `SynthesisTier` confidence routing)
- `server/jobs/memoryDecayJob.ts` (18 lines — minimal stub, no tier awareness or Ebbinghaus)
- `tasks/builds/memory-improvements/progress.md` (proof of full Phase 2 + Phase 3 completion despite stale handoff.md)
- PR #298 commit `2bd3d6d3` (merged 2026-05-13)

**Operator decision (2026-05-18):** scope-down rewrite chosen. `brief.md` rewritten to v4.0 (re-grounded against shipped state, tier column collision documented with Path A default, non-rebuild list added). `intent.md` refreshed to v2 with refreshed Problem Statement, Desired Outcome, Non-Goals, Assumptions, and Open Questions. Tier collision resolution defaulted to Path A (`consolidation_tier text` added; existing `tier smallint` retained for F1 baseline-artefact injection).

**Operator decision:** revision complete

### Step 3a re-run (2026-05-18)

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

Rationale recorded in `intent.md § Duplication / Strategy Check § Step 3a re-run`. Coordinator advances to Step 3b (grill-me).

---

## Phase 2 (BUILD) status

| Chunk | Status | G1 attempts | Notes |
|-------|--------|-------------|-------|
| 1 — Shared types + flag | in_progress | — | |
| 2 — Schema + migration | pending | — | |
| 3 — LAEL extension | pending | — | |
| 4 — decayPure | pending | — | |
| 5 — MemoryConsolidationConfig | pending | — | |
| 6 — reinforcementBatch | pending | — | |
| 7 — hybridRetrieval post-fusion lens | pending | — | |
| 8 — memoryDecayJob replacement | pending | — | |
| 9 — evaluatePromotion | pending | — | |
| 10 — Phase 4 schema migrations | pending | — | |
| 11 — Promotion dispatcher + job + queue | pending | — | |
| 12 — Audit script + docs | pending | — | |

**Plan path:** `tasks/builds/memory-tiered-consolidation/plan.md`
**Plan gate:** APPROVED 2026-05-18 (3 ChatGPT rounds — F1 spec amended, F2 tier_transitions table, F3a/b cleanup, F4 risk update)
**Scope class:** Significant (architect confirmed)

## Environment snapshot
- last_chunk_committed: chunk 12 (audit script + docs)
- head: 55312220 (post review pass + dispatcher ordering fix)
- package_lock_md5: 7030fff678b1ab99274c65d4decc80f6
- migration_count: 480 (3 new: 0370, 0371, 0372)
- captured_at: 2026-05-18T06:49:29Z

## Doc Sync gate (2026-05-18)
- architecture.md updated: yes (Workspace Memory section — added Memory Tiered Consolidation subsection covering decay/reinforcement/promotion/audit; updated Key files per domain with 5 new server files + audit script)
- capabilities.md updated: yes: create new capability record (Memory Tiered Consolidation, Memory & Knowledge cluster, Growth state)
- integration-reference.md updated: n/a — no integration changes (no new external service, no new OAuth provider, no new MCP preset)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — checked feature-flag pattern, withAdminConnection pattern, SELECT FOR UPDATE pattern, defence-in-depth org filters; all rules already documented in existing sections (§1, §8.35) and the build follows them
- CONTRIBUTING.md updated: n/a — no lint-suppression policy or contributor-convention changes
- frontend-design-principles.md updated: n/a — UI change extends existing MemoryReviewQueuePage card pattern; no new UI rule introduced
- KNOWLEDGE.md updated: yes (6 entries — patterns 1-4 from Chunk 12 covering spec deviation documentation / in-transaction audit row / partial index volatile-function trap / conservative decay weights; patterns 5-6 from review pipeline covering cross-tenant enumeration admin-role requirement / SELECT FOR UPDATE transaction requirement)
- spec-context.md updated: n/a — feature pipeline (per playbook §9)
- docs/decisions/ — no — checked: OQ-1 (table placement) and OQ-2 (durable audit row) are documented as Accepted Implementation Deviations inline in the spec, not as standalone ADRs; the choices are spec-resolved rather than durable policy-level
- docs/context-packs/ — n/a — no architecture.md anchor changes affecting context packs
- references/test-gate-policy.md — n/a — no test gate posture changes
- references/spec-review-directional-signals.md — n/a — no recurring spec-reviewer directional pattern
- docs/incident-response.md — n/a — no incident response surface changes
- docs/testing-transition-plan.md — n/a — no test transition trigger changes
- .claude/FRAMEWORK_VERSION + CHANGELOG.md — n/a — no framework-level changes
- scripts/verify-* — n/a — no CI gate changes

## Review pass summary
- spec-conformance: CONFORMANT_AFTER_FIXES (commit 1d4bbe62) — 3 mechanical fixes; 3 directional gaps routed to tasks/todo.md
- adversarial-reviewer: HOLES_FOUND — 2 confirmed holes closed in commit c9914bfa
- pr-reviewer round 1: CHANGES_REQUESTED with 7 Blocking findings
- pr-reviewer fix-loop: all 7 closed in commit ca04b55d
- pr-reviewer round 2: APPROVED
- reality-checker: NEEDS_DISCUSSION on Goal 8 wording; spec amended in commit ad04134d
- dual-reviewer: APPROVED with 5 fixes (P1 missing CHECK constraint, tier lens before slice, ORDER BY ordering, down-migration safety, retrieveLimit bump for reranker=none)
- pr-reviewer round 3: NEEDS_DISCUSSION on dispatcher ORDER BY discrepancy; fixed in commit 93df8ee4

REVIEW_GAP entries: none (all required reviewers ran)

---

## Phase 3 — Finalisation

### chatgpt-pr-review

**Round 1 (2026-05-18):**
- F1 (promotion audit event not emitted): OPERATOR-APPROVED DEFERRAL — pre-documented in handoff.md "Open issues for finalisation". Spec already notes OQ-2 deviation; event TYPE registered, runtime emission deferred pending runId-FK nullability + AgentExecutionSourceService union extension. No code change. Spec deviation already recorded; no further action needed this round.
- F2 (promotion signals use access_count/cited_count not agent_run_prompts JOIN): OPERATOR-APPROVED DEFERRAL — pre-documented in handoff.md "Open issues for finalisation". Spec §9.3 join shape doesn't map to actual schema. No code change needed; spec §9.3 deviation note already present via handoff OQ-1. Note: spec should be amended to formally document the deviation.
- F3 (rejectPromoteToProcedural missing item_type validation): FIXED — added SELECT FOR UPDATE with item_type = 'promote_to_procedural' guard, mirroring approvePromoteToProcedural pattern. Commit pending.
- F4 (audit checks 1/2/4/5 using admin_role instead of per-tenant scoping): FIXED — removed SET LOCAL ROLE admin_role from checks 1/2/4/5; added explicit organisation_id = ANY($orgIds) predicates per spec §10.6; admin_role retained only for Check 6 (cross-tenant aggregate MV, justified per §10.6(b)); org enumeration query uses admin_role for the single necessary cross-tenant read. Commit pending.

**Round 1 diff:** `.chatgpt-diffs/pr351-round2-code-diff.diff`
