# Handoff — trust-verification-layer

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** `tasks/builds/trust-verification-layer/spec.md`
**Brief path:** `tasks/builds/trust-verification-layer/brief.md`
**Mockup index:** `prototypes/trust-verification-layer/index.html`
**Branch:** `claude/synthetos-work-primitive-improvements-P17SD`
**Build slug:** `trust-verification-layer`
**Scope class:** Major
**UI-touching:** yes
**Mockup paths:**
- `prototypes/trust-verification-layer/index.html` (entry point)
- `prototypes/trust-verification-layer/skill-create.html` (Layer 1)
- `prototypes/trust-verification-layer/run-trace.html` (Layer 1 + Layer 3)
- `prototypes/trust-verification-layer/govern-quality.html` (Layer 2)
- `prototypes/trust-verification-layer/scorecard-library.html` (Layer 2)
- `prototypes/trust-verification-layer/scorecard-create.html` (Layer 2)
- `prototypes/trust-verification-layer/agent-create.html` (Layer 2)
- `prototypes/trust-verification-layer/agent-edit-scorecard.html` (Layer 2)
- `prototypes/trust-verification-layer/model-bench.html` (Layer 2)
- `prototypes/trust-verification-layer/knowledge.html` (Layer 3)
- `prototypes/trust-verification-layer/_shared.css`, `_sidebar.js` (shared)

**Spec-reviewer iterations used:** 0 / 5 — **SKIPPED.** Codex CLI not available in this environment (`which codex` returned nothing). Per the precedent from `consolidation-foundation` and `pre-launch-phase-2`, this is logged as REVIEW_GAP. If Codex becomes available before Phase 2, run `spec-reviewer: review tasks/builds/trust-verification-layer/spec.md` standalone before launching feature-coordinator.

**chatgpt-spec-review:** **Rounds 1 + 2 complete (2026-05-08, operator paste-back mode); spec LOCKED.** Round 1: APPROVED WITH TIGHTENINGS — F1, F2, F3, F4, F5, F6, M2, M3, M4 applied; M1 (retention policy) deferred with Stage-2-GA ship-blocker posture. Sections touched in Round 1: §6.2 (analytics invariant), §6.5 (scoring provenance snapshot), §6.6 (rawJudgementIds), §10.1 (attempt_number reservation), §10.6 (HTTP mapping), §10.7 (state-machine note), §11.5 (new — timeout/cancellation semantics), §12.4 (approval atomicity + judge≠candidate + cost cap), §13.3 (clustering algorithm pinned), §17 (deferred items updated). Round 2: two consistency drift fixes — §4 uniqueness key (`runtime_check_results` row aligned with §10.1's `attempt_number` addition) and §18 Q3 (marked RESOLVED with cross-reference to §12.4 server-side cost cap). Spec line count: 1062 → 1087 (Round 1 +25 lines across 9 sections + new §11.5; Round 2 in-place edits, no line delta). Reviewer final disposition: approved for Phase 2.

**ChatGPT spec review log:** `tasks/review-logs/chatgpt-spec-review-trust-verification-layer-2026-05-08T05-23-45Z.md`

---

## Open questions for Phase 2

These six items from the spec's §18 "Open questions for operator" carry forward into Phase 2 plan generation. Each has a recommended default; if the operator does not push back during plan-review, the default applies in build:

1. **Top-20 skill backfill list.** Confirm the seed list in spec §5 against actual usage telemetry (last 30 days). Default: confirm during Phase 2 chunk that backfills the registry.
2. **Forced grade on Stage 3 correction without Stage 2 attached.** No-op when no scorecard is attached. Default: yes — Stage 3 stands alone.
3. **Bench cost-estimate ceiling.** Always allow with explicit confirmation, or hard-cap above $X? Default: always allowed with confirmation showing dollar figure.
4. **Pattern-detector cluster threshold.** N = 3 corrections within 30 days. Default: 3, configurable via env in build phase if needed.
5. **Scorecard-tightening suggestion enable.** Default on, behind feature flag (so it can be toggled without redeploy).
6. **Permission-key naming.** Six new keys in spec §5 file inventory. Default: matches existing convention (`org.review.view` shape).

---

## Decisions made in Phase 1

- **Mockup loop closed at Round 6** (terminology lock + slider bug fix). External-review pass complete in Round 5. Mockups treated as design source of truth; spec wins on contracts/thresholds.
- **Spec format:** locked spec at `tasks/builds/trust-verification-layer/spec.md` (per consolidation-govern precedent), not `docs/superpowers/specs/{date}-{slug}-spec.md`. Reason: active builds keep spec.md in the build directory; archived specs (post-merge) move to docs/.
- **Three-stage build sequence locked:** Stage 1 (skill verification) → Stage 2 (scorecards + bench) → Stage 3 (correction memory). Each stage is independent shippable value; Stage 3 has soft dependency on Stage 2 (forced-grade hook is no-op when absent).
- **Migration numbering locked:** 0288–0295 (eight migrations). Latest on main is 0287.
- **Five new RLS-protected tables:** `runtime_check_results`, `scorecards`, `agent_scorecard_attachments`, `scorecard_judgements`, `bench_runs` + `bench_results` (last is one migration with two tables).
- **Six new permission keys** named per existing convention (`org.scorecards.view`, `subaccount.corrections.create`, etc.).
- **No new memory primitive for Layer 3** — extends `memory_blocks.captured_via` enum with `'operator_correction'`. No new table.
- **Terminology lock:** "runtime check" (operator-facing) / `verify` (developer column literal). "Quality check" not "dimension". "Pass mark" not "threshold". "How often to grade" not "sampling rate". "Share with sub-accounts" toggle is the single visibility primitive.
- **Quartile control locked:** `Off | 25% | 50% | 75%`. 100% sampling intentionally excluded.
- **Source-pill compression rule pinned:** Sub-account viewer sees `Platform | Custom`; org-admin viewer sees `System | Organisation | This subaccount`.
- **Authority levels locked:** `system_mandatory | org_mandatory | suggested`. At sub-account scope, system_mandatory + org_mandatory render identically as Required (lock icon).
- **Five internal runtime-check states preserved** at schema/event level (`pass | fail | inconclusive | pending | not_applicable`); operator UI collapses to three (`Pass | Fail | Pending`).
- **Regression risk thresholds pinned** in spec §6.6: `low` < 0.05 variance + ≥5 samples; `medium` 0.05–0.15 or low variance + <5 samples; `high` ≥0.15 variance.
- **Composite winner rule:** cheapest candidate where `passesAllPassMarks` AND `regressionRisk != 'high'`.
- **No auto-routing, no Policy primitive, no per-attach pass-mark overrides, no scorecard versioning history, no auto-prompt-adaptation, no adaptive sampling.** All deferred to Stage 4 candidates per spec §17.
- **Existing primitives reused where possible:** `memory_blocks` for Layer 3 storage; `agent_recommendations` for scorecard-tightening suggestions; `agent_execution_events` for runtime-check event emission; `regressionReplayService` extended for bench regression replay; existing approval gate for failed-external-blast-radius pause.

---

## Recommendations for feature-coordinator (Phase 2)

- **Plan size:** large (Major class). Expect 12–18 chunks given three stages × multiple migrations + services + jobs + UI per stage.
- **Per-chunk reviewer cadence:** standard (`pr-reviewer` per chunk). At branch level: `dual-reviewer` if Codex available, otherwise `chatgpt-pr-review`. **Adversarial-reviewer auto-trigger:** spec touches new permissions, new RLS tables, multi-tenant scopes, new write paths — strong match for §5.1.2 security surface. Plan to run.
- **chatgpt-spec-review Rounds 1 + 2 complete; spec LOCKED.** Round 1 (operator paste-back, 2026-05-08) tightened the spec on snapshot provenance, bench payload size, retry-attempt schema reservation, clustering-algorithm pin, approval atomicity, analytics-state hygiene, runtime-check timeout semantics, judge ≠ candidate, server-side cost cap, and retention posture. Round 2 (same day) cleaned two consistency drifts and closed Q3. Reviewer signed off; no further rounds before Phase 2.
- **Mid-build Opus escalation candidates:** custom-handler runtime-check kind design (Stage 1), exact judge prompt schema for `scorecard:judge` job (Stage 2), pattern-clustering algorithm choice in `correctionPatternDetectorPure.cluster()` (Stage 3). Other implementation can stay on Sonnet.
- **Manual G2 visual diff scope:** Run-trace runtime-check badge layout; Govern / Quality drift list with sparklines; Model bench three-state page (Setup / Running / Results); Correct dialog metadata block; Knowledge page filter chip + Source column.
- **Doc-sync sweep at finalisation:** `architecture.md` (new Govern / Quality service layer + new tables in Key files per domain); `docs/capabilities.md` (new Trust & Verification Layer entry, vendor-neutral copy); `KNOWLEDGE.md` patterns to capture (cross-tenant Source-pill compression, three-tier authority lock, single-share-toggle visibility primitive, idempotent UPSERT on correction capture, runtime-check three-state UI collapse from five internal states).
- **Partial review-coverage flag:** `spec-reviewer` (Codex) skipped per environment constraint; `chatgpt-spec-review` Round 1 complete and applied. Remaining gap is the Codex second-opinion only. Phase 2 review pipeline (per-chunk `pr-reviewer` + branch-level `dual-reviewer`/`chatgpt-pr-review` + `adversarial-reviewer`) absorbs the residual risk. Feature-coordinator should weight findings accordingly.

---

## Phase status

**phase_status: PHASE_2_COMPLETE**

---

## Phase 2 (BUILD) — complete

**Plan path:** `tasks/builds/trust-verification-layer/plan.md`
**Chunks built:** 16 / 16
**Branch HEAD at handoff:** `c1ed1535`
**Post-build pipeline ran:** 2026-05-08T12:09:27Z

**G1 attempts (per chunk):** Built inline before post-build pipeline; per-chunk pr-reviewer fixes are tracked in commits `3d06e2fa` (Chunk 5), `e1b1d0bf` (Chunk 4), `d3636229` (Chunk 3), `9740723b` (Chunk 3 follow-up), `01facb66` (Chunk 8), `803984d3` (Chunk 9), `3ae846ec` (Chunk 10). No persistent per-chunk review logs.

**G2 attempts:** 1 (PASS first try — lint 0 errors; typecheck clean; 229/229 targeted tests).

**spec-conformance verdict:** CONFORMANT_AFTER_FIXES (`tasks/review-logs/spec-conformance-log-trust-verification-layer-2026-05-08T12-09-27Z.md`)

**adversarial-reviewer verdict:** HOLES_FOUND (1 confirmed, 3 likely, 2 worth-confirming) (`tasks/review-logs/adversarial-review-log-trust-verification-layer-2026-05-08T12-09-27Z.md`)

**pr-reviewer verdict:** CHANGES_REQUESTED → fix-loop applied (B-1, B-2, B-3, S-1, S-2, S-4 in commit `999ec0bf`); B-4 + S-3 deferred to operator. (`tasks/review-logs/pr-review-log-trust-verification-layer-2026-05-08T12-09-27Z.md`)

**Fix-loop iterations:** 1 (single round, no re-pr-review needed because dual-reviewer found independent SQL/route bugs that warranted their own pass).

**dual-reviewer verdict:** APPROVED (1 iteration; 4 [ACCEPT] decisions, all fixed in commit `c1ed1535`). Re-review verdict on post-dual-reviewer diff: APPROVED (changes were surgical bug fixes, no new issues). (`tasks/review-logs/dual-review-log-trust-verification-layer-2026-05-08T12-09-27Z.md`)

**spec-reviewer (Codex) — Phase 1 status:** SKIPPED — REVIEW_GAP from Phase 1 (Codex CLI unavailable in operator's spec session). chatgpt-spec-review Rounds 1+2 covered the second-opinion pass on the spec. Codex dual-reviewer in Phase 2 closed the residual code-side gap.

**Doc-sync gate verdicts:**
- `architecture.md` updated: yes (sections "Key files per domain" — 8 new TVL rows; service-layer Govern Quality entry; integrations and patterns sections) — Chunk 16, commit `1f60a440`.
- `docs/capabilities.md` updated: yes (Trust & Verification Layer entry added) — Chunk 16.
- `docs/integration-reference.md` updated: no — no integration scope/skill/status/auth-method change in this build; no stale references.
- `CLAUDE.md` updated: yes (coordinator-inline rule, framework sync from upstream — unrelated to this build but landed on the same branch via commit `7eeb1e5d`).
- `DEVELOPMENT_GUIDELINES.md` updated: no — no new build-discipline rule, RLS/service-tier convention unchanged; grepped for `scorecard|runtime.check|bench_run|correction_pattern` — zero stale references.
- `CONTRIBUTING.md` updated: no — no lint-suppression policy or comment-format change.
- `docs/frontend-design-principles.md` updated: no — no new UI hard rule; the new pages (Govern/Quality, Scorecard library, Bench, Correct dialog) follow existing primitives (Drawer, Modal, SortableTable) without inventing new patterns.
- `KNOWLEDGE.md` updated: yes (5 patterns appended in Chunk 16 commit `1f60a440`: cross-tenant source-pill compression, three-tier authority lock, single-share-toggle visibility primitive, idempotent UPSERT on operator correction capture, runtime check three-state UI collapse from five internal states; plus 1 pattern appended on the upstream framework sync — coordinators-run-inline rule).
- `references/test-gate-policy.md` updated: no — no new test-gate posture; existing static-gates-primary stance preserved.
- `references/spec-review-directional-signals.md` updated: no — spec-review session did not surface a repeated classifier signal warranting a new entry.
- `docs/spec-context.md` updated: n/a (spec-review-only doc).
- `docs/decisions/` updated: n/a — no durable architectural-choice ADR pending. The migration/route bug fixes from the dual-reviewer pass are debt removal, not policy choices.
- `docs/context-packs/` updated: n/a — no context-pack section anchor changed.
- `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` updated: n/a — repo-level architecture/feature changes only.

**Open issues for finalisation (operator decisions before merge):**

Filed in `tasks/todo.md`. **Update 2026-05-08 (post Phase 2 fix-loop): four originally-deferred items are now CLOSED. See `progress.md § Phase 2 fix-loop` for verdicts.**

- ~~**B-4 (Tier-A blocker; deferred):**~~ **CLOSED in fix-loop commit `2655acbf`.** Cross-entity guard now mandatory; corrections route requires a real `agent_execution_events.id`; trace-events route enriches each tool-call with its canonical event id via the new `linkToolCallsToEventIds` pure helper (rewritten in commit `9f99874c` per Codex P2 to match by `(skillSlug, ordinal-within-slug)` instead of global position).
- ~~**S-3 (Tier-B; deferred):**~~ **CLOSED in fix-loop commit `effce969`.** `scorecardService.assertAgentInSubaccount` checks for an active `subaccount_agents` link before the detach proceeds; cross-subaccount targeting fails-403 with `AGENT_NOT_IN_SUBACCOUNT`.

- ~~**TVL-DG-1 + TVL-DG-10:**~~ **CLOSED in fix-loop commit `3c213e16`** (refined in `9f99874c`). Every `ACTION_REGISTRY` entry has runtime-check coverage. The Windows path bug + advisory→blocking flip are both shipped. **Caveat:** initial concrete `verify` shapes on review-gated and wrapped skills were reverted in `9f99874c` per Codex P1 — they would have always evaluated inconclusive (actionService wrapper hides the inner field from the runtime-check dispatcher). Those skills now declare `verify: null` with HITL-approval or backfill-candidate justifications. A future follow-on can teach the runtime-check dispatcher to unwrap the actionService envelope, at which point concrete shapes can be re-introduced for direct-handler skills.
- ~~**TVL-DG-3:**~~ **CLOSED in fix-loop commit `05255c11`.** `weight` → `passMark` (optional, fallback to DEFAULT_PASS_MARK 0.7). New `enabled?: boolean` (default true). Disabled checks skipped at fanout, forced-grade, and dispatch layers. Judge job now passes `qc.passMark` to `computeVerdict`. UI shows "Pass mark %" + "Enabled" controls per spec §15 terminology lock.
- **TVL-DG-4:** `scorecard_judgements.trigger_source` enum collapsed `forced_runtime_check_fail` + `forced_correction` into `forced`, plus added `bench` (not in spec). Forced-source attribution lost.
- **TVL-DG-5:** `scorecard_judgements.verdict` adds `'inconclusive'` not in spec §6.5. Either drop, or amend spec to formalise three verdict states.
- **TVL-DG-6:** `bench_runs` schema misses spec §6.6 fields (`mode`, `triggerScopeType`, `triggerScopeId`, `testInputSource`, `testInputs`).
- **TVL-DG-7:** `bench_results` row shape diverges from spec §6.6 BenchResult contract (per-sample DB row vs per-model aggregate spec shape).
- **TVL-DG-9:** spec §5 file `shared/types/scorecard.ts` not created; types duplicated between server schema and client api. Drift risk.
- **TVL-DG-2:** Two unplanned migrations (0296, 0297) added during build to fix gaps in 0293. Spec §5 inventory locked migrations to 0288–0295. Operator should confirm spec inventory is updated to 0288–0297.
- **TVL-AM-1, TVL-AM-2:** §18 Q5 feature-flag for scorecard-tightening suggestion + §13.3 step 4 quality-check matching heuristic (cosine >0.75) — could not confirm presence; route to operator review.

- **Adversarial findings (Phase 1 advisory; non-blocking):**
  - **AR-TVL-1 (CONFIRMED-HOLE, HIGH):** same as B-4 above — cross-entity guard bypass.
  - **AR-TVL-4 (LIKELY-HOLE, MEDIUM):** judge prompt injection — partially mitigated by S-2 fix (`<untrusted_input>` tags); would still benefit from a structured tool-use schema as a stronger defence.
  - **AR-TVL-5, AR-TVL-6:** worth-confirming items kept in log only.

**Branch HEAD at handoff:** `9f99874c` (post fix-loop + Codex dual-reviewer P1/P2 commits). Branch is 47 commits ahead of `origin/main`.

**Recommended next action:** open a new Claude Code session and type `launch finalisation` to begin Phase 3. The four originally-flagged items are now closed; the remaining 11 directional gaps + 2 ambiguous items are operator-deferred and can ship to merge with a documented decision in the Phase 3 handoff (or be deferred further to a Stage 2 GA polish PR).

---

## Phase 2 fix-loop → merge-resolution chunk (2026-05-09)

PR #274 (auto-knowledge-retrieval) merged to `main` 2026-05-08 after TVL Phase 2 began, taking migration numbers 0288-0294 and producing 7 conflicts at the S2 sync step of finalisation. Phase 3 finalisation-coordinator hit the collision and paused; the half-done merge was aborted by the main session. A focused merge-resolution chunk (this one) was run inline to close the collision so finalisation can resume.

**Outcome:** clean merge with `origin/main` plus a TVL migration renumber. Branch is now ready for Phase 3 to resume.

**Migration range now locked at 0295-0304** (was 0288-0297 before merge):

- 0295 `skills_runtime_check_columns` (was 0288)
- 0296 `runtime_check_results` (was 0289)
- 0297 `scorecards` (was 0290)
- 0298 `agent_scorecard_attachments` (was 0291)
- 0299 `scorecard_judgements` (was 0292)
- 0300 `bench_runs` (was 0293)
- 0301 `system_agents_scorecard_defaults` (was 0294)
- 0302 `memory_blocks_operator_correction` (was 0295)
- 0303 `bench_runs_approved_model` (was 0296)
- 0304 `bench_runs_state_awaiting` (was 0297)

**Conflict resolutions (7 conflicts, all closed):**

- `shared/types/agentExecutionLog.ts` — unioned source-service, event-type, payload, criticality map.
- `server/services/agentExecutionEventServicePure.ts` — unioned switch cases.
- `server/config/rlsProtectedTables.ts` — unioned (3 AKR + 6 TVL = 9 entries); TVL `policyMigration` paths updated to new numbers.
- `client/src/pages/govern/KnowledgePage.tsx` — structural composition: main's 5-tab strip composes the page; TVL source-filter chips render inside the Auto-memory tab; useEffect deps include both `activeTab` and `source`.
- `tasks/current-focus.md` — took ours.
- `tasks/todo.md` — unioned (TVL deferred items + AKR deferred items both retained).
- `KNOWLEDGE.md` — unioned (TVL + AKR 2026-05-08 patterns both retained).

**Internal reference updates** (renumber commit): 20 file renames + 36 file edits across schema files, permissions.ts, architecture.md, spec.md, plan.md, scripts/gates/verify-scorecard-rls.sh, and the rlsProtectedTables manifest.

**Gates after merge-resolution chunk:**

- G1 lint + typecheck: PASS first try (0 errors, 874 pre-existing warnings; typecheck clean).
- G2 targeted vitest: PASS first try (321 tests across 17 files green).
- pr-reviewer (self-review on chunk diff): APPROVED — no findings.

**Commits added to branch:**

- `11903b86` — `merge: resolve PR #274 (auto-knowledge-retrieval) into trust-verification-layer`.
- `859645a9` — `rename: TVL migrations 0288-0297 → 0295-0304 + update internal refs`.

**Branch HEAD at end of merge-resolution chunk:** `859645a9`. Branch is now ahead of `origin/main` by ~50 commits (including the merge); 0 behind.

**phase_status preserved at PHASE_2_COMPLETE.** current-focus.md status remains `REVIEWING` per the chunk's stated invariant. Finalisation-coordinator will move it to `MERGE_READY` after Phase 3 completes.

**Recommended next action:** re-launch `finalisation-coordinator` in a new Claude Code session — type `launch finalisation`. The S2 collision is now resolved; finalisation can resume from G4 regression-guard onwards.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #275
**PR URL:** https://github.com/michaelhazza/automation-v1/pull/275
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-trust-verification-layer-2026-05-08T21-11-04Z.md`
**Round count:** 1
**Round 1 disposition:** APPROVED — round-2 not requested
**spec_deviations reviewed:** yes (TVL-DG-2 migration range, TVL-DG-4..7 scorecard schema field divergences, TVL-DG-8/9, TVL-AM-1/2 — all surfaced to ChatGPT and remain operator-deferred to Stage-2-GA)

**Branch state at finalisation start:** `d0ae8c57`, 51 commits ahead of `main`, 0 behind, pushed to `origin`. Steps 0-4 completed in the prior session (context loaded, S2 sync no-op since 0 behind, G4 regression-guard PASS, PR #275 already created).

**chatgpt-pr-review Round 1 verifications (5 of 5 PASS, no code changes):**

1. **Idempotency / retry consistency** — every TVL primitive has row-level idempotency at the DB layer (5 UNIQUE constraints across `runtime_check_results`, `scorecards`, `scorecard_judgements`, `bench_runs`, `bench_results`); per-handler `MAX_JSON_RETRIES = 3`; all 5 workers use `teamConcurrency: 1`; `benchExecuteJob` enforces `FOR UPDATE SKIP LOCKED` single-writer.
2. **Retention strategy exists** — spec §17 line 1073 commits 90/365-day retention as a Stage-2-GA ship-blocker (M1).
3. **RLS coverage** — all 6 TVL tables in `server/config/rlsProtectedTables.ts` (lines 1086-1124) with correct migration refs (0296-0300); enforced by `verify-rls-coverage.sh` and `rls.context-propagation.test.ts`.
4. **Deterministic replay** — F1 snapshot at judgement time, M2 judge≠candidate via `benchRunService.estimateCost()`, M3 server-side cost cap throwing `BENCH_COST_CAP_EXCEEDED` 422.
5. **Queue dedupe** — DB row-level uniqueness (V1 above) is stronger than `singletonKey`; `correction:pattern-detect` uses `boss.schedule()` daily cron.

**Doc-sync sweep verdicts** (per `docs/doc-sync.md`, full feature change-set, cross-check of chatgpt-pr-review):
- `architecture.md`: no — already updated in Phase 2 chunk 16 (commit `1f60a440`); 8 file-mapping rows + 5 permission keys + 2 queue entries present; grepped for all TVL terms — current.
- `docs/capabilities.md`: no — already updated in Phase 2 chunk 16; vendor-neutral entries present.
- `docs/integration-reference.md`: n/a — no integration scope/skill/auth-method change.
- `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md`: no — no build-discipline change; framework-sync upstream commit `7eeb1e5d` aligned both with canonical agent fleet.
- `CONTRIBUTING.md`: no — no contributor-convention change.
- `docs/frontend-design-principles.md`: no — Round 1 produced no UI changes; new pages reuse existing primitives.
- `KNOWLEDGE.md`: no — 12 TVL-related entries already present (8 from Phase 2 chunk 16, 3 from fix-loop, 1 from merge-resolution); Round 1 produced no new pattern.
- `docs/decisions/`: n/a — no durable architectural choice locked in Round 1.
- `docs/context-packs/`: n/a — no anchor change.
- `references/test-gate-policy.md`: n/a — no test-gate posture change.
- `references/spec-review-directional-signals.md`: n/a — chatgpt-pr-review session, not spec-review.
- `docs/spec-context.md`: n/a — spec-review-only doc.
- `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md`: n/a — no framework-level change.

**KNOWLEDGE.md entries added (this session):** 0 new. Round 1 produced no fixes; existing 12 TVL entries (Phase 2 chunk 16 + fix-loop + merge-resolution) already cover the patterns.

**tasks/todo.md items removed (this session):** 0 (the build's own deferred items were marked `[x]` during Phase 2 fix-loop already; Phase 3 added 5 new entries).

**tasks/todo.md items added (this session):** 4 new + 1 consolidated:
- `CHATGPT-R1-RISK-1` — Orchestration fragmentation across 5 TVL jobs (Stage-2-GA)
- `CHATGPT-R1-RISK-2` — "Corrections" semantic overload (taxonomy ADR pre-req for any second meaning)
- `CHATGPT-R1-RISK-3` — Bench / scorecard separation invariant — protect via ADR
- `CHATGPT-R1-RISK-4` — DB growth without retention — consolidated into existing M1 deferral
- `CHATGPT-R1-RISK-5` — UI complexity creep — folded into a future "Govern simplify pass" build

**ready-to-merge label applied at:** 2026-05-08T22:44:51Z

**Final phase status:** PHASE_3_COMPLETE. CI runs G5 on label apply. Operator drives the merge sequence per the end-of-phase prompt: update `current-focus.md` to NONE on the feature branch first → commit → push → `gh pr merge 275 --squash --delete-branch`. finalisation-coordinator does NOT auto-merge.
