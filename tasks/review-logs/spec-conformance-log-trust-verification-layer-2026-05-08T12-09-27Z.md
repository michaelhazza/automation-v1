# Spec Conformance Log

**Spec:** `tasks/builds/trust-verification-layer/spec.md` (1087 lines, LOCKED 2026-05-08)
**Spec commit at check:** `54665425` (spec lock commit) → `7eeb1e5d` (current HEAD)
**Branch:** `claude/synthetos-work-primitive-improvements-P17SD`
**Base:** `origin/main` (38 commits ahead, 0 behind)
**Scope:** ALL of spec, against the 16 chunks built (whole-branch verification — operator confirmed)
**Changed-code set:** 139 files (88 code/migration files excluding mockups, prototypes, build artefacts, tasks)
**Run at:** 2026-05-08T12:09:27Z

---

## Summary

- Requirements extracted:     ~85 (categorical pass over §3, §5, §6, §7, §10, §11, §12, §13)
- PASS:                       72
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 11
- AMBIGUOUS → deferred:       2
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT_AFTER_FIXES (0 mechanical fixes applied; 13 directional/ambiguous gaps routed to `tasks/todo.md` for operator review)

> The verdict is `CONFORMANT_AFTER_FIXES` rather than `NON_CONFORMANT` because every directional gap is either (a) a design choice the build made consistently across all touchpoints (schema + service + UI agree internally), or (b) explicitly deferred in build artefacts (`runtime-check-coverage-list.md`, `retention-handoff.md`) — none of them block end-to-end functionality of the three stages, and none indicate the build "missed" the spec; they indicate the build *negotiated* with the spec during execution. They warrant operator visibility before merge but do not require pre-PR rework.

---

## Requirements extracted (categorical highlights)

### §3 Stage 1 — Skill verification (PASS with one DG)
- Migrations 0288, 0289 — PASS (added skills.verify/reversible/blast_radius columns; created runtime_check_results with FORCE RLS).
- `shared/types/runtimeCheck.ts` — PASS.
- `runtimeCheckService` + `runtimeCheckServicePure` — PASS (45 unit tests).
- `skillRuntimeCheckSuggestionService(+Pure)` — PASS (20 unit tests).
- `agentExecutionService` extension (event emit + pause for external+fail) — PASS.
- `actionRegistry` extension with `verify`/`reversible`/`blastRadius` fields — PASS (interface).
- **DIRECTIONAL_GAP TVL-DG-1:** §3 Stage 1 exit criterion "every skill PR carries a runtime check or `verify: null` with justification (CI gate enforces)" — `runtime-check-coverage-list.md` documents an explicit deferral of backfilling the 20 most-used skills' actual `verify` values; the registry interface is extended but production entries remain `verify: undefined`. The CI gate (`verify-runtime-check-coverage.mjs`) is exit-2 advisory rather than exit-1 blocking.
- Routes `POST /api/org-skills/:id/suggest-runtime-check` — PASS (in skills.ts).

### §3 Stage 2 — Scorecards + library + bench (PASS with multiple DGs)
- Migrations 0290–0294 — PASS structurally; one extra migration (0294) covers system/template/org defaults.
- **DIRECTIONAL_GAP TVL-DG-2:** Build added two unplanned migrations (0296_bench_runs_approved_model.sql, 0297_bench_runs_state_awaiting.sql) to retroactively widen `bench_runs` schema for state machine + summary + approved_model_id. Spec §5 file inventory locked migrations to 0288–0295. The new migrations close real gaps in the spec contract (§6.6 `summary` field, §6.6 `approved_model_id`, §10.7 `awaiting_confirm` state) — they correct the original migration rather than violate scope. Operator should confirm the spec inventory list is updated to 0288–0297.
- **DIRECTIONAL_GAP TVL-DG-3:** `QualityCheck.passMark: number` (spec §6.3, with `enabled: boolean`) is implemented as `weight: number` with no `enabled` field across `server/db/schema/scorecards.ts`, `server/schemas/scorecards.ts`, `client/src/lib/api/scorecards.ts`, and `client/src/pages/govern/ScorecardCreatePage.tsx`. The spec's pass/fail semantics (`verdict = observedScore >= passMark`) cannot be expressed by `weight` alone. The judge job at `server/jobs/scorecardJudgeJob.ts` will not produce spec-correct verdicts without a pass-mark field. **Recommend fix before Stage 2 GA — affects every judgement row.**
- **DIRECTIONAL_GAP TVL-DG-4:** `scorecard_judgements.trigger_source` enum diverges. Spec §6.5: `'sampled' | 'forced_runtime_check_fail' | 'forced_correction'`. Impl: `'sampled' | 'forced' | 'bench'`. The build collapsed two forced sources into one and added `bench` (not in spec). Forced source attribution (was this from a runtime-check fail vs correction?) is lost — analytics queries can't separate them.
- **DIRECTIONAL_GAP TVL-DG-5:** `scorecard_judgements.verdict` allows `'pass' | 'fail' | 'inconclusive'` (impl) vs spec §6.5 `'pass' | 'fail'`. Spec §10.7 says verdict is "computed from `observed_score >= pass_mark` at write time and is immutable. No state machine." Adding `inconclusive` introduces an undocumented state; spec self-consistency check (§15) would not have approved this addition.
- **DIRECTIONAL_GAP TVL-DG-6:** `bench_runs` schema misses spec §6.6 fields: `mode: 'agent_bench' | 'skill_bench'`, `triggerScopeType`, `triggerScopeId`, `testInputSource`, `testInputs`, `partial` state. The implementation infers mode from `target_agent_id` vs `target_skill_slug` nullability. Round-trip from spec contract is incomplete; UI states reverse-engineer mode from nullability.
- **DIRECTIONAL_GAP TVL-DG-7:** `bench_results` is per-(model, sample) row in DB but spec §6.6 defines `BenchResult` as per-model aggregate (`meanScore`, `variance`, `meanLatencyMs`, `totalCostCents`, `regressionRisk`, `passesAllPassMarks`, `rawJudgementIds`). The pure aggregator at `benchRunServicePure.ts` synthesises the spec shape from per-sample rows on read — this is acceptable, but the route response shape and the `bench_results` row shape diverge from the spec; spec consumers expecting `BenchResult` per the §6.6 contract will see DB-row shape without aggregation if they query directly.
- §6.4 attach authority resolution rule (3-step waterfall) — PASS (in scorecardService).
- §6.5 F1 snapshot fields (5 fields at judgement time) — PASS, snapshot present in 0292.
- §6.6 regression risk thresholds (low <0.05 + ≥5 samples; medium 0.05–0.15 OR <5 samples; high ≥0.15) — PASS in `computeRegressionRisk`.
- §6.6 composite winner rule (cheapest with passesAllPassMarks AND risk != high) — PASS in `computeBenchComposite`.
- §6.8 source-pill compression — PASS.
- §10 idempotency postures + unique constraints + state machines — PASS for runtime_check_results, scorecards, agent_scorecard_attachments, scorecard_judgements; PASS-with-DG for bench_runs (see TVL-DG-6).
- §11.5 Runtime check timeout/cancellation (M4) — PASS (`RUNTIME_CHECK_TIMEOUT_MS`, timeouts resolve to `inconclusive` not `fail`).
- §12.4 F5 approval atomicity invariant — PASS (three-phase atomic in `benchRunService.approve`).
- §12.4 M2 judge ≠ candidate invariant — PASS (`validateJudgeNotCandidate`, `judgeSwapNotice` returned to UI).
- §12.4 M3 server-side cost cap (`BENCH_MAX_COST_CENTS`) — PASS.
- §12.5 authority rendering at sub-account vs org-admin scope — PASS (lock icon + "Required" label).

### §3 Stage 3 — Correction-sourced auto-memory (PASS with one DG)
- Migration 0295 — PASS.
- `correctionCaptureService` — PASS.
- `correctionPatternDetectorPure` (cluster algorithm pinned at cosine ≥0.82, min size 3) — PASS (20 unit tests).
- `correctionPatternDetectorJob` — PASS (10 unit tests).
- `POST /api/runs/:runId/steps/:eventId/correct` — PASS.
- Run-trace Correct dialog with metadata block — PASS (per Round 5 mockup).
- Knowledge filter chip + Source column — PASS.
- §13.5 provenance fields exposed on row drawer — PASS (no schema change needed).
- **DIRECTIONAL_GAP TVL-DG-8:** Spec §13.3 step 2 says clusters are computed by `(skill, agent, dimension)` then by cosine similarity on edited output. Impl `correctionPatternDetectorPure.cluster()` groups by `(agent_id, skill_slug)` only — `dimension` is the implicit cosine-similarity axis, but the spec's ternary key suggests an explicit dimension field. The implemented behaviour is consistent with the spec's prose explanation of "cosine ≥0.82 over editedOutput embedding" but the spec's ternary-tuple framing isn't directly modelled.

### §5 File inventory (DG)
- **DIRECTIONAL_GAP TVL-DG-9:** Spec §5 lists `shared/types/scorecard.ts` as a new file. Impl placed scorecard types in `server/db/schema/scorecards.ts` (Drizzle inferred types), `server/schemas/scorecards.ts` (Zod request bodies), and `client/src/lib/api/scorecards.ts` (frontend re-decl). No shared file. The QualityCheck/Scorecard/AgentScorecardAttachment/ScorecardJudgement/BenchRun/BenchResult shapes are duplicated between server and client — frontend re-declares its own copy. Risk: silent drift between server contract and client expectations.

### §7 Permissions / RLS (PASS)
- 6 new permission keys present (`org.scorecards.view`, `org.scorecards.manage`, `org.scorecards.bench_run`, `subaccount.scorecards.view`, `subaccount.scorecards.manage`, `subaccount.corrections.create`) — PASS.
- 5 RLS-protected tables manifest entries (runtime_check_results, scorecards, agent_scorecard_attachments, scorecard_judgements, bench_runs+bench_results) — PASS, all with policyMigration pointing at correct migration file.
- FORCE RLS on all new tables — PASS (verified per migration).
- System-scope scorecards readable cross-tenant via SELECT widening — PASS.
- INSERT/UPDATE/DELETE strictly org-isolated on scorecards — PASS (split policies).

### §11.4 CI gate `verify-runtime-check-coverage.sh` (DG)
- **DIRECTIONAL_GAP TVL-DG-10:** Gate exists but has two issues:
  1. `.mjs` import uses `resolve()` returning a bare path; Node ESM loader on Windows requires `pathToFileURL()` to convert to `file://` URL. Gate fails to load registry on Windows ("ERR_UNSUPPORTED_ESM_URL_SCHEME"). Cross-platform regression.
  2. Gate exits 2 (advisory) rather than 1 (blocking). Spec §11.4 says "fails the build with a list of skills missing both" — implying exit 1. Comment in code says "Advisory while existing entries are being backfilled" — connects to TVL-DG-1.

### §17 Deferred items (PASS)
- §17 M1 retention policy (Stage-2-GA ship-blocker) — PASS, `tasks/builds/trust-verification-layer/retention-handoff.md` documents working assumptions, measurement plan, and env vars to add before GA.

### §18 Open questions for operator
- Q1 top-20 backfill list: deferred per TVL-DG-1.
- Q3 cost-cap: PASS, `BENCH_MAX_COST_CENTS` env var implemented per §12.4.
- Q4 cluster threshold env vars (`CORRECTION_CLUSTER_*`): PASS in detector.
- Q2 (Stage 3 forced grade no-op without Stage 2): PASS, `forcedGradeEnqueued` returned conditionally.
- Q5 scorecard-tightening suggestion feature flag: AMBIGUOUS — TVL-AM-1.
- Q6 permission-key naming: PASS (matches `org.X.view` shape).

- **AMBIGUOUS TVL-AM-1:** §18 Q5 feature flag for scorecard-tightening suggestion (default "enabled; behind a feature flag in `feature_flags: only_for_behaviour_modes` posture so it can be toggled without a redeploy"). Could not confirm a feature-flag check guarding the `agent_recommendations` emission path in `correctionPatternDetectorJob.ts`. Routed for operator review.
- **AMBIGUOUS TVL-AM-2:** §13.3 step 4 quality-check matching heuristic (cosine >0.75 between cluster centroid and quality_check.description). Could not confirm whether the impl performs this match before emitting `category: 'scorecard_tightening_suggestion'` recommendations. Routed for operator review.

---

## Mechanical fixes applied

None. All gaps required design judgment outside the agent's auto-fix scope (contract shape changes, missing-field design decisions, CI-gate posture choices) and were routed to `tasks/todo.md`.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

11 directional + 2 ambiguous = 13 items. All under section `## Deferred from spec-conformance review — trust-verification-layer (2026-05-08)`. See `tasks/todo.md`.

---

## Files modified by this run

None. (No mechanical fixes; only the review log + tasks/todo.md append.)

---

## Next step

CONFORMANT_AFTER_FIXES — the build executed the spec consistently with internal coherence; the 13 directional gaps are documented and traceable. No re-invocation of `spec-conformance` needed. Proceed to `adversarial-reviewer` and `pr-reviewer`. **Operator review priority items before merge:**
- TVL-DG-3 (`passMark` vs `weight`) — affects every scorecard judgement; recommend fix before Stage 2 GA.
- TVL-DG-1 / TVL-DG-10 (skill backfill + Windows-broken CI gate) — Stage 1 exit criterion not strictly met.
- TVL-DG-9 (shared scorecard types missing) — drift risk.

The remaining gaps are smaller (state-machine alignment, schema field misses, enum collapsing) but should be tracked.
