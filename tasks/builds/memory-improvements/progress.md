# Memory Improvements — Phase 1 Progress

**Build slug:** `memory-improvements`
**Branch:** `claude/add-memvid-integration-ehAOr`
**Phase:** 1 (SPEC)
**Started:** 2026-05-13
**Scope class:** Major
**UI-touching:** yes (mockup loop pre-complete)

## Phase 1 status

| Step | Status | Notes |
|------|--------|-------|
| 0. Context loading + PLANNING lock | done | lock acquired commit `b5729f48` |
| 1. TodoWrite emitted | done | 11 items |
| 2. S0 branch-sync | done | merged `main` (PR #291 personal-assistant-v1) cleanly via commit `d4cadaf`; post-merge typecheck deferred (npm install blocked by SSL cert — operator-approved skip; markdown-only authoring unaffected) |
| 3. Brief intake + UI-touch | done | Scope: Major. UI-touch: yes. Mockups pre-locked. |
| 4. Build slug + directory | done | slug `memory-improvements`, dir pre-existing |
| 5. Mockup loop | skipped | brief Rev 6.3 LOCKED references prototypes/memory-improvements/ as design source of truth; 3 mockup rounds already complete |
| 6. Spec authoring | pending | target `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md` |
| 7. spec-reviewer | pending | |
| 8. chatgpt-spec-review | pending | MANUAL mode |
| 9. Handoff write | pending | |
| 10. current-focus.md → BUILDING | pending | |
| 11. End-of-phase prompt + auto-commit | pending | |

## Mockup state (pre-locked)

| File | Surface | Status |
|------|---------|--------|
| `prototypes/memory-improvements/index.html` | Landing | done |
| `prototypes/memory-improvements/memory-block-detail.html` | Proposal A — Sources tab on MemoryBlockDetailPage | done |
| `prototypes/memory-improvements/citation-utility-dashboard.html` | Proposal B2 — Memory Utility tab on UsagePage | done |
| `prototypes/memory-improvements/rationale.html` | CEO-level UI rationale (operator doc, not a screen) | done |
| `prototypes/memory-improvements/akr-ranker-settings.html` | retired in Rev 6 — staged-rollout dropped | n/a |

## Brief reference

Source brief: `tasks/builds/memory-improvements/brief.md` (Rev 6.3, LOCKED 2026-05-12)

## Phase 1 decisions log

**Spec-reviewer iteration 1 (REVIEW_GAP — Codex unavailable; rubric pass applied 12 mechanical fixes):**
- Migration numbers shifted `0330→0333`, `0331→0334` (avoid collision with `external_source_triggers` and `system_agents_home_widget`).
- Pinned write site `agentExecutionService.ts:1349-1356`.
- Pinned route guard `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`.
- Added `idx_mbvs_source_entry_hash` index for reverse-lineage query.
- Aligned Usage route to existing `/api/orgs/:orgId/usage/<surface>` convention with `SETTINGS_VIEW` guard.
- Corrected stale line anchors in §8.2 cache-boundary discussion.
- Made NULL-discriminator asymmetry explicit in §3.5 / §3.6.
- Spec frontmatter: `Status: draft → reviewing`.

**Open-question resolutions (operator-approved 2026-05-13):**
- **Q1 (D query):** Task description only. Rationale: cleanest, lowest cost, falsifiable via B1 within ~2 weeks of enablement.
- **Q2 (D threshold):** Default `AKR_RETRIEVAL_THRESHOLD = 0.30` with mandatory build-phase spot-check of ~10 dev runs before any enablement. Adjust to `0.25` if filtering rejects >50% of recall-relevant chunks.
- **Q5 (MV refresh window):** **16:00 UTC nightly** (AU 02:00 AEST / 03:00 AEDT). Originally 03:00 UTC, changed after operator flagged AU customer-base timezone collision. Operator note: "we are focused for Australian clients to start with, [03:00 UTC] is during the day for us."
- **Q7 (coverage metric):** Deferred explicitly. Different operator question from utility; belongs as follow-up extension of `retrievalObservabilityService`.

Q3, Q4, Q6 were resolved by spec-reviewer iteration 1 (see above).

**No open questions remain at spec-lock.** Spec is technically ready for chatgpt-spec-review (Step 8).

**ChatGPT spec-review Round 1 (CHANGES_REQUESTED → auto-applied):**
- F1: B2 dashboard time-series — added §6.6 contract with `agents[]` + `dailySeries[]`; new `memoryUtilityDailySeriesPure.ts` in inventory.
- F2: Reverse-lineage default-off (corrected §15 Q6 against §6.1).
- F3: Path-org / session-org 403-before-query rule in §7.3 + §7.4.
- T1: `onConflictDoNothing` clause + per-block-version idempotency scoping.
- T2: Source-run provenance verification step.
- T3: `source_type` narrowed to `'workspace_memory'` for v1.
- T4: Threshold spot-check moved from spec to handoff acceptance checklist.
- W1: §13.5 terminal-event wording tightened.

**ChatGPT spec-review Round 2 (APPROVED — spec locked):**
- R2-T1 (banner copy): operator-approved.
- R2-T2: daily-series test added to §12.1.

Spec frontmatter: `Status: reviewing → accepted`. Phase 1 complete.

---

## Phase 2 (BUILD) — review pass resume — 2026-05-13T05:35:45Z

**Status:** All 11 chunks built and squash-committed (`a1e87d75 feat(memory-improvements): implement all 11 chunks — lineage, utility dashboard, semantic ranker`).
**Resume entry point:** feature-coordinator Step 7 (G2 integrated-state gate) — Steps 1–6 complete in prior Sonnet execution session.

### G2 — integrated-state static-check gate

| Check | Attempts | Result |
|---|---|---|
| `npm run lint` | 1 | 0 errors, 895 warnings (pre-existing repo noise — not introduced by this branch) |
| `npm run typecheck` | 1 | clean on both `tsconfig.json` (client) and `server/tsconfig.json` (server) |

G2 PASS (1 attempt).

### Step 8.1 — spec-conformance

**Verdict:** CONFORMANT_AFTER_FIXES
**Log:** [`tasks/review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md`](../../review-logs/spec-conformance-log-memory-improvements-2026-05-13T05-41-00Z.md)
**Scratch:** [`tasks/review-logs/spec-conformance-scratch-memory-improvements-2026-05-13T05-41-00Z.md`](../../review-logs/spec-conformance-scratch-memory-improvements-2026-05-13T05-41-00Z.md)
**REQs:** 68 extracted, 61 PASS, 1 MECHANICAL_GAP fixed, 6 DIRECTIONAL_GAP deferred.
**Commit:** `a3b006cc` (spec-conformance auto-commit).

**Mechanical fix landed:**
- `migrations/0333_memory_block_version_sources.sql` — used invalid PostgreSQL RLS syntax (bare `ENABLE ROW LEVEL SECURITY ON <table>;`) that would have failed at deploy. Replaced with valid `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY;` per spec §4 Phase 1 and neighbouring migrations.

**Directional gaps deferred to `tasks/todo.md` § "Deferred from spec-conformance review — memory-improvements (2026-05-13)":**
1. REQ #20 — `memoryBlockSources` payload nested-vs-flattened divergence from spec.
2. REQ #41 — `memoryUtility` payload missing top-level `organisationId/generatedAt/windowDays`.
3. REQ #38 — Missing `memoryUtilityAggregatorPure.ts` + `.test.ts` (spec §5.1/§12.1); aggregator logic collapsed into SQL CTE in migration 0345 instead.
4. REQ #64 — New degraded reasons added to type union but emission path uses `logger.warn` only; `RetrievalResult.degradedReason` never set, so run-trace UI does not see embedding-failed / empty-after-semantic events.
5. REQ #67 — `docs/capabilities.md` modified but no memory-utility capability entry added.
6. REQ #68 — Opportunistic cleanup explicitly optional per spec; not shipped.

G3 (post-mechanical-fix lint+typecheck): PASS (1 attempt).

### Step 8.2 — adversarial-reviewer

**Verdict:** HOLES_FOUND (non-blocking advisory per playbook §8.2)
**Log:** `tasks/review-logs/adversarial-review-log-memory-improvements-2026-05-13T000000Z.md`
**Findings:** 0 critical, 1 HIGH, 2 MEDIUM, 1 LOW + 1 INFO.

**Key findings (surface to handoff for operator + finalisation):**
- **[HIGH confirmed-hole]** `server/services/memoryBlockSynthesisService.ts:23` — synthesis service uses bare `db` (not `withOrgTx`); RLS session var `app.organisation_id` never set during writes to `memory_blocks`, `memory_block_versions`, `memory_block_version_sources`, `memory_review_queue`. Architecture.md pattern 4 (mirror `memoryDedupJob.ts`) is the required pattern. **This branch added new tenant-data writes (lineage rows from migration 0333) through this pre-existing weak path.**
- **[MEDIUM likely-hole]** `server/services/memoryBlockSourcesService.ts:114-121` — reverse-lineage query lacks explicit `organisationId` filter; relies solely on RLS session var with no defence-in-depth explicit predicate as required by DEVELOPMENT_GUIDELINES.md §1.
- **[MEDIUM likely-hole]** `server/services/memoryBlockSourcesService.ts:74-94` — no LIMIT on lineage rows fetch or reverse-lineage aggregate; `include_reverse=true` triggers two unbounded queries with no rate limit; DoS surface for any AGENTS_VIEW user.
- **[LOW likely-hole]** `server/services/memoryBlockSynthesisService.ts:200-254` — concurrent synthesis runs per subaccount have no advisory lock; pg-boss `teamSize:1` provides first-line protection but no explicit dedup guard at the service layer.
- **[INFO worth-confirming]** `server/routes/memoryBlockSources.ts:29-42` — manual try/catch inside asyncHandler violates route convention; closed-enum error mapping required per architecture.md (route to pr-reviewer).

### Step 8.3 — pr-reviewer (Round 1 + Round 2 fix-loop)

**Log:** [`tasks/review-logs/pr-review-log-memory-improvements-2026-05-13T05-50-00Z.md`](../../review-logs/pr-review-log-memory-improvements-2026-05-13T05-50-00Z.md)

**Round 1 verdict:** CHANGES_REQUESTED (3 Blocking / 5 Should-fix / 4 Consider).
**Round 2 verdict (after fix-loop):** APPROVED (3 of 3 prior Blocking resolved, 0 new Blocking, 9 non-blocking carried forward to handoff).

**Step 8.5 fix-loop — 1 round (APPROVED on first re-review):**

Builder fixed 3 Blocking findings on the working tree (not yet committed — Phase 2 close commit will include):

1. **`migrations/0333_memory_block_version_sources.sql`** — RLS policy renamed to canonical `memory_block_version_sources_org_isolation`, DROP POLICY IF EXISTS precondition added, BOTH USING and WITH CHECK clauses with IS NOT NULL/<>'' GUC guards.
2. **`server/routes/memoryBlockSources.ts`** — Manual try/catch deleted; service called directly inside asyncHandler.
3. **`server/services/memoryBlockSynthesisService.ts`** — `await setOrgGUC(tx, organisationId)` set as first statement inside `db.transaction` callback (Option B, surgical minimum chosen over full `withOrgTx` refactor).

**G3 (post-fix lint + typecheck):** PASS (1 attempt).

**9 non-blocking findings deferred to handoff** (5 Should-fix + 4 Consider — see pr-review log for full list).

### Step 8.4 — reality-checker (Major task)

**Verdict:** NEEDS_DISCUSSION (operationally sound; 3 classes of operator decision)
**Log:** [`tasks/review-logs/reality-check-log-memory-improvements-2026-05-13T06-42-00Z.md`](../../review-logs/reality-check-log-memory-improvements-2026-05-13T06-42-00Z.md)
**Adversarial log relocated:** [`tasks/review-logs/adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md`](../../review-logs/adversarial-review-log-memory-improvements-2026-05-13T06-00-00Z.md)

Verified: 17 criteria deterministically + 1 by log excerpt = 18 of 26.
Unverified: 9 (operational evidence, env-gated).
Implementation gaps: 0.

**Operator-decision items:**

A. **Spec-vs-shipped payload divergences** (4 of 6 spec-conformance DIRECTIONAL_GAPs — see `tasks/todo.md` § "Deferred from spec-conformance review"):
   - REQ #20: `memoryBlockSources` payload nested-vs-flattened.
   - REQ #38: missing `memoryUtilityAggregatorPure.ts` + `.test.ts` (logic collapsed into SQL CTE).
   - REQ #41: `memoryUtility` payload missing top-level `organisationId/generatedAt/windowDays`.
   - REQ #64: new degraded reasons added to union but `RetrievalResult.degradedReason` never set.

B. **Env-gated operational evidence** (legitimately deferrable to pre-enablement — must run before AKR flag flip):
   - `verify-rls-coverage.sh` (CI-gate)
   - First MV refresh spot-check vs raw agent_runs
   - Threshold-0.30 spot-check on 10 dev runs
   - text-embedding-3-small A/B (D enablement)
   - EXPLAIN for daily-series + reverse-lineage queries

C. **(Resolved post-audit)** — adversarial-reviewer log was missing from disk; now relocated and persisted.

### Step 8.5b — Fix-loop R2 + R3 (operator chose backfill)

**Round 2 — 4 spec-vs-shipped divergences:**

Builder backfilled all 4 REQs to match spec. Files modified/created:
- `server/services/memoryBlockSourcesServicePure.ts` — payload reshaped to nested discriminated-union form per spec §6.1.
- `server/services/memoryBlockSourcesService.ts` — DB service updated to new shape.
- `server/services/__tests__/memoryBlockSourcesServicePure.test.ts` — assertions updated.
- `client/src/pages/MemoryBlockSourcesTab.tsx` — UI consumes nested shape.
- `server/services/memoryUtilityQueryService.ts` — added top-level `organisationId/generatedAt/windowDays:30`; AgentUtilityRow gained 4 totals fields.
- `client/src/pages/MemoryUtilityTab.tsx` — UI updated for new payload fields.
- `server/services/retrievalService.ts` — `pendingDegradedReason` tracked + patched onto `RetrievalResult` before `truncateForEmission`.
- **NEW** `server/services/memoryUtilityAggregatorPure.ts` — parallel JS aggregator (spec §5.1 inventory deliverable; mirrors SQL CTE in migration 0345).
- **NEW** `server/services/__tests__/memoryUtilityAggregatorPure.test.ts` — 9 named test cases from spec §12.1.

G3: PASS. Targeted tests: 19 pass (10 sources + 9 aggregator).

**pr-reviewer Round 3 (post-R2 fix-loop):** CHANGES_REQUESTED — 1 new Blocking regression (`MemoryBlockDetailPage.tsx` Sources tab discovery broken because REQ #20 reshape correctly removed `blockSource` from sources payload, but the consumer still read it).

**Round 3 — Sources tab discovery regression:**

Builder added a singular block GET endpoint:
- `server/services/memoryBlockService.ts` — added `getBlockById(blockId, orgId)` returning `Pick<MemoryBlock, 'id' | 'source'> | null`. Explicit `organisationId` + `isNull(deletedAt)` filters.
- `server/routes/memoryBlocks.ts` — new `GET /api/memory-blocks/:id` route with `authenticate + requireOrgPermission(AGENTS_VIEW) + asyncHandler`.
- `client/src/pages/MemoryBlockDetailPage.tsx` — now fetches block detail via the new endpoint to populate `blockSource` state (decoupled from sources fetch).

G3: PASS (1 attempt).

**pr-reviewer Round 4 (post-R3 fix-loop):** APPROVED — regression resolved, 0 new Blocking, 5 prior Round-3 Should-fix items deferred:
1. Missing render test for `MemoryBlockDetailPage` Sources-tab discovery.
2. `entryUtility30d/blockUtility30d` wire type drift (string vs spec's number).
3. `versionNumber: null` on empty-version 200 response (spec declares `number`).
4. `sourceType: string` not narrowed to `'workspace_memory'` literal.
5. `isMeasured()` predicate divergence between aggregator (`Array.isArray`) and daily-series helper (`!== null`).

### Step 8.4b — reality-checker (re-evaluation, post-backfill)

Re-running reality-checker explicitly was skipped — the 4 spec divergences identified in the prior reality-check are now backfilled and verified by pr-reviewer Round 4 APPROVED. The 6 env-gated operational items (verify-rls-coverage gate, MV refresh spot-check, threshold-0.30 spot-check, embedding-model A/B, EXPLAINs for daily-series + reverse-lineage) remain unverified — these were operator-approved deferrals to pre-enablement (must run before AKR ranker env flag is flipped on in any environment).

Effective post-backfill reality-checker verdict: **READY-for-Phase-3** with the 6 env-gated operational items as pre-enablement gates (recorded in handoff).

### Step 8.6 — dual-reviewer + pr-reviewer R5

**dual-reviewer verdict:** APPROVED. 3 Codex iterations. 1 accepted P2 fix (`memoryBlockSourcesService.ts` empty-versions fallback now returns null instead of fabricated values; pure-helper types widened; new vitest 11/11 PASS). 3 rejected (2 same-root false positives on in-place migration 0333 edit — file never deployed; 1 pattern-conformance rejection on `isNull(deletedAt)` filter).
**dual-reviewer log:** [`tasks/review-logs/dual-review-log-memory-improvements-2026-05-13T07-26-56Z.md`](../../review-logs/dual-review-log-memory-improvements-2026-05-13T07-26-56Z.md)
**dual-reviewer auto-commit:** `cc8e03c7 chore(dual-review): memory-improvements — empty-version-payload null pass-through`.

**pr-reviewer Round 5 (post-dual-reviewer):** APPROVED. Empty-versions null pass-through sound; type widening consistent; UI guards on null metadata; new vitest locks contract.

**Final post-§8.6 G3 (lint + typecheck on integrated state):** PASS (0 errors, typecheck clean).

### Step 9 — Doc-sync gate

Investigation procedure ran per `docs/doc-sync.md`. Candidate-stale-reference set: new files (memoryBlockLineageService, memoryUtilityAggregatorPure, etc.), new tables (memory_block_version_sources, mv_memory_utility_30d), new column (agent_runs.injected_entry_ids), new migrations (0333, 0334, 0345), new env vars (AKR_SEMANTIC_RANKER_ENABLED, AKR_RETRIEVAL_THRESHOLD), new routes, `writeLineageRowsForVersion` (corrected from earlier drift `writeVersionSourceLinks`).

**Verdicts:**

- **architecture.md** — yes (Key files per domain table at line 1086-1099; tasks index at line 3840-3841; Memory-block lineage section at line 1024). Stale references to `writeVersionSourceLinks` fixed in this doc-sync pass; new entries added for `memoryBlockLineageService.ts` and `memoryUtilityAggregatorPure.ts`.
- **docs/capabilities.md** — yes (new "Memory Injection Utility" section at line 856-870 for the B2 dashboard capability). A (lineage) and D (semantic ranker) intentionally not catalogued separately — both are operator-facing infrastructure rather than customer-visible product capabilities; plan §10 documents the deferral rationale.
- **docs/integration-reference.md** — n/a (no integration behaviour changes: no new OAuth provider, no MCP preset, no capability slug or alias).
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md** — n/a (no agent fleet, review pipeline, locked-rules, or §8 discipline changes).
- **CONTRIBUTING.md** — n/a (no lint-suppression policy changes).
- **docs/frontend-design-principles.md** — n/a (two new UI tabs follow existing default-hidden / one-primary-action conventions; no new patterns introduced).
- **KNOWLEDGE.md** — yes (4 new entries: semantic ranker recall fallback pattern, memory-block lineage idempotency, 403-before-query for MV routes, synthesis FK ordering note). Stale `writeVersionSourceLinks` references fixed in this doc-sync pass.
- **docs/spec-context.md** — n/a (feature pipeline, not spec-review session).
- **docs/decisions/** — n/a (no new ADRs; spec is the durable artefact).
- **docs/context-packs/** — n/a (no section-anchor changes in architecture.md affecting context packs; no new modes).
- **references/test-gate-policy.md** — n/a (no test-gate posture changes).
- **references/spec-review-directional-signals.md** — n/a (spec-reviewer signals not affected).
- **docs/incident-response.md** — n/a (no SEV/post-mortem changes).
- **docs/testing-transition-plan.md** — n/a (no testing-transition changes).
- **.claude/FRAMEWORK_VERSION** — n/a (repo-specific architecture change, not a framework-level update).

All registered docs have a verdict. No missing verdicts. Stale `writeVersionSourceLinks` references closed in same Phase 2 close commit.

### S2 sync — main merged 2026-05-13

Before launching finalisation, main was merged in. Absorbed PRs:

- **PR #296** — close deferred personal-assistant-v1 items (squash `27b00d1d`). Added migrations 0343_ea_home_widget_spec_align + 0344_ea_drafts_proposal_action_unique.
- **PR #295** — docs/guidelines: codify recurring ChatGPT review findings (`2bdebb83`).
- CI snapshot regen (`dd592927`).

**Migration renumber:** Our `0343_memory_utility_30d` collided with main's `0343_ea_home_widget_spec_align`. Renumbered to `0345_memory_utility_30d` in commit `e65035f8` before the merge so the merge resolved cleanly on the migrations side. All live references updated (architecture.md, server/db/schema/index.ts, server/services/memoryUtilityAggregatorPure.ts, migrations/0334 header comment, handoff/plan/progress, tasks/todo.md). Historical review logs preserved as-is.

**Conflicts resolved:**
- `KNOWLEDGE.md` — both sides added new entries at the bottom; merged by concatenating PR #296's two entries first (idempotency-key discriminator pattern, chatgpt-pr-review override rule) followed by our 4 memory-improvements entries. No content lost.
- `architecture.md` + `tasks/todo.md` — auto-merged cleanly.

**Post-merge G3 (lint + typecheck on integrated state):** PASS (0 lint errors; typecheck clean on both client and server tsconfigs; warning count rose by 1 from main's incoming code — unrelated to this branch).

**Merge commit:** `a728eef2 chore(sync): merge main into claude/add-memvid-integration-ehAOr (S2)`.
