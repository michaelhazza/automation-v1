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

**phase_status: PHASE_1_COMPLETE**
