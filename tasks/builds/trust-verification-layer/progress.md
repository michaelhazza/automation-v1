# Progress — trust-verification-layer

## Phase 1 (SPEC) — Complete (2026-05-08)

**Status:** PHASE_1_COMPLETE → handed off to feature-coordinator

| Step | Status |
|---|---|
| S0 branch sync | up to date with main (0 commits behind) |
| Brief intake + UI-touch detection | Major scope class; UI-touching=yes |
| Mockup loop | 6 rounds completed prior to this session; treated as closed |
| Spec authoring | `tasks/builds/trust-verification-layer/spec.md` (1062 → 1087 lines, 18 sections) |
| spec-reviewer | SKIPPED — Codex CLI unavailable in spec session (REVIEW_GAP) |
| chatgpt-spec-review | Rounds 1+2 complete (operator paste-back); spec LOCKED. Log: `tasks/review-logs/chatgpt-spec-review-trust-verification-layer-2026-05-08T05-23-45Z.md` |
| Handoff written | `tasks/builds/trust-verification-layer/handoff.md` |

## Phase 2 (BUILD) — Complete (2026-05-08)

**Status:** PHASE_2_COMPLETE

### Build chunks (16/16 done)

All 16 plan chunks built and committed inline before this post-build pipeline ran. Branch HEAD at start of post-build: `7eeb1e5d`. Per-chunk pr-reviewer ran inline during the build (`fix(...): Chunk N review fixes` commits are evidence). No persistent per-chunk review logs in `tasks/review-logs/`.

### Post-build pipeline (this session, 2026-05-08T12:09:27Z)

| Step | Status | Notes |
|---|---|---|
| G2 integrated-state gate | **PASS** | lint 0 errors / 874 pre-existing warnings; typecheck clean; 11 targeted vitest files = 229/229 tests pass |
| spec-conformance review | **CONFORMANT_AFTER_FIXES** | 11 directional + 2 ambiguous gaps routed to `tasks/todo.md`. Log: `tasks/review-logs/spec-conformance-log-trust-verification-layer-2026-05-08T12-09-27Z.md` |
| adversarial-reviewer | **HOLES_FOUND** | 1 confirmed (AR-TVL-1) + 3 likely (AR-TVL-2/3/4) routed to `tasks/todo.md`; 2 worth-confirming kept in log only. Log: `tasks/review-logs/adversarial-review-log-trust-verification-layer-2026-05-08T12-09-27Z.md` |
| pr-reviewer | **CHANGES_REQUESTED** → **fix-loop applied** | 4 blockers (B-1..B-4) + 4 strong (S-1..S-4) + 3 non-blocking. Log: `tasks/review-logs/pr-review-log-trust-verification-layer-2026-05-08T12-09-27Z.md` |
| Fix-loop (B-1, B-2, B-3, S-1, S-2, S-4) | **APPLIED** in commit `999ec0bf` | B-1 wraps inbox helper in withOrgTx; B-2 emits correction.captured AFTER forced-grade dispatch; B-3 flips validateBody warn → enforce on 8 lines; S-1 adds logger.warn to empty catch; S-2 wraps prompt content in `<untrusted_input>` tags; S-4 makes scorecardJudgeRunner import static. B-4 + S-3 deferred to operator (see handoff). |
| G3 after fix-loop | **PASS** | lint clean; typecheck clean; 94/94 affected tests still pass |
| dual-reviewer (Codex) | **APPROVED** | 1 iteration; all 4 Codex findings real ([ACCEPT] x4). Fixes in commit `c1ed1535`. Log: `tasks/review-logs/dual-review-log-trust-verification-layer-2026-05-08T12-09-27Z.md` |
| G3 after dual-reviewer | **PASS** | clean |
| Doc-sync gate | **PASS** | Chunk 16 doc-sync (commit `1f60a440`) covered architecture.md (5 entries in §Key files per domain + new TVL section), capabilities.md, KNOWLEDGE.md (5 patterns appended). No new doc-sync work needed for the post-build fix-loop changes — surgical bug fixes, no convention impact. CLAUDE.md edit on branch was unrelated (coordinator-inline rule from upstream framework sync). |
| Phase 3 handoff | written below | |

### Codex dual-reviewer findings (all 4 fixed in commit `c1ed1535`)

1. `migrations/0290_scorecards.sql` — table-level `UNIQUE ... WHERE` not supported by PostgreSQL → moved to partial `CREATE UNIQUE INDEX`.
2. `migrations/0293_bench_runs.sql` — table-level `UNIQUE` cannot include expressions → moved `date_trunc('minute', created_at)` to a `CREATE UNIQUE INDEX`.
3. `server/routes/corrections.ts` — `requireSubaccountPermission` middleware reads `req.params.subaccountId` but the route only carries `runId` / `eventId`; the wrap-as-Promise pattern always hit the missing-param 400 short-circuit (every subaccount correction request was broken). Replaced with `hasSubaccountPermission` programmatic helper.
4. `server/services/benchRunService.ts:275` — query used `sj.agent_run_id` but schema has `run_id`; Govern / Quality drift list would crash on first hit.

## Phase 2 fix-loop (2026-05-08, post Phase 2 close) — Complete

**Status:** Operator-elected pre-merge fix loop on top of `c1ed1535`. All four flagged items (B-4 / S-3 / TVL-DG-1 / TVL-DG-3) closed before Phase 3 begins.

| Step | Status | Notes |
|---|---|---|
| Pre-flight: lint + typecheck baseline | PASS | 0 errors / 874 pre-existing warnings; typecheck clean |
| Fix 1 — B-4 cross-entity guard | **CLOSED** | Commit `2655acbf`. New `linkToolCallsToEventIds` enriches trace-events with canonical `agent_execution_events.id`; new `validateEventIdShape` rejects null/empty/runId-equality eventIds at the corrections route. UI Correct affordance hides when `eventId === null`. Pure tests +12. |
| Fix 2 — S-3 cross-subaccount IDOR | **CLOSED** | Commit `effce969`. `scorecardService.assertAgentInSubaccount` verifies `subaccount_agents` link before the detach route proceeds. `assertAgentSubaccountMembership` pure helper for testability. Fail-403 (not 404 — would leak agent existence cross-subaccount). Pure tests +3. |
| Fix 3 — TVL-DG-1 ACTION_REGISTRY backfill | **CLOSED** | Commit `3c213e16`. Every `ACTION_REGISTRY` entry has runtime-check coverage: 20 most-used skills carry concrete `verify` shapes (revised in Codex pass — see below); other entries get bucket-mapped `verify: null` + justification via deterministic sweep at module init. Windows path bug fixed (`pathToFileURL`); advisory exit 2 → blocking exit 1. Tests assert every entry covered (1106 tests). |
| Fix 4 — TVL-DG-3 weight→passMark + enabled | **CLOSED** | Commit `05255c11`. `weight: number` → `passMark: number` (optional, fallback to DEFAULT_PASS_MARK); `enabled: boolean` (default true) added. Disabled checks skipped at three layers (fanout, forced-grade, dispatch). Judge job now passes `qc.passMark` to `computeVerdict` (was using DEFAULT only). UI shows "Pass mark %" + "Enabled" controls. No migration needed (JSONB column has no shape constraint). Pure tests +14. |
| G2 integrated-state gate | **PASS** | lint 0 errors; typecheck clean; 1230 vitest tests pass across 7 files |
| spec-conformance delta re-check | **CONFORMANT** | TVL-DG-1 + TVL-DG-3 closed against spec §3, §6.3, §6.5, §11.4. 11 other directional gaps remain operator-deferred (TVL-DG-2, 4, 5, 6, 7, 8, 9, 10, AM-1, AM-2). |
| adversarial-reviewer delta re-check | **HOLES_CLOSED** | B-4 and S-3 are no longer exploitable. Org-internal trust-data integrity hole closed; cross-subaccount IDOR closed. AR-TVL-2 / AR-TVL-4 (advisory only) unchanged. |
| pr-reviewer on delta | **APPROVED** | Surgical edits, vitest tests, no security regressions, backward compat preserved via optional types. |
| Codex dual-reviewer | **2 P-findings, both fixed** | Round 1 surfaced two functional regressions in the prior fix-loop commits: P1 — concrete `verify` shapes on actionService-wrapped skills always evaluate inconclusive (was going to break every successful review-gated send via spec §11.2 external pause path). P2 — `linkToolCallsToEventIds` positional matching mis-attaches across slugs because the agent loop only emits skill events on special paths. Both fixed in commit `9f99874c`: P1 — review-gated and wrapped skills moved to `verify: null` with HITL-justification or backfill-candidate justification; only direct-handler skills stay on concrete shapes. P2 — rewrote linkage to match by `(skillSlug, ordinal-within-slug)` against `payload.skillSlug`. Codex log embedded above; +5 new tests asserting cross-slug mis-attach is blocked. |
| Re-review pr-reviewer post-Codex | **APPROVED** | Verified the Codex-acceptance edits don't introduce new findings. |
| Doc-sync delta | **PASS** | Verdicts: architecture.md=no (no triggered changes); capabilities.md=no (terminology unchanged); KNOWLEDGE.md=yes (3 patterns appended — wrapper-shape verify, slug-match toolCalls↔events, cross-subaccount IDOR); CLAUDE.md/dev-guidelines/frontend-principles=no; integration-reference=n/a. |

### Commits (5 in fix loop)
- `2655acbf` — Fix 1 B-4 cross-entity guard
- `effce969` — Fix 2 S-3 cross-subaccount IDOR
- `3c213e16` — Fix 3 TVL-DG-1 backfill + gate hardening
- `05255c11` — Fix 4 TVL-DG-3 passMark + enabled
- `9f99874c` — Codex P1 + P2 fixes (wrapper shape + slug-match)

### Operator-deferred items still open after fix loop
- TVL-DG-2 (migration inventory 0288–0297 vs spec 0288–0295 — operator confirms in §5)
- TVL-DG-4 (scorecard_judgements.trigger_source enum collapse)
- TVL-DG-5 (scorecard_judgements.verdict adds 'inconclusive' not in spec)
- TVL-DG-6 (bench_runs schema misses spec §6.6 fields)
- TVL-DG-7 (bench_results row shape diverges from BenchResult contract)
- TVL-DG-8 (pattern detector clusters by (agent, skill) not (skill, agent, dimension))
- TVL-DG-9 (`shared/types/scorecard.ts` not created; types duplicated)
- TVL-DG-10 was tied to TVL-DG-1 — gate-script aspect now CLOSED; the original CI exit code was the second part, also fixed.
- TVL-AM-1 (scorecard-tightening feature flag presence)
- TVL-AM-2 (cosine-similarity matching heuristic in pattern detector)
- AR-TVL-2 (validateBody warn vs enforce — advisory)
- AR-TVL-4 (judge prompt injection — partially mitigated by `<untrusted_input>` tags)

### Branch HEAD at end of fix loop: `9f99874c`

## Phase 3 (FINALISATION) — Not started

Run `finalisation-coordinator` in a new Claude Code session. Open items: see deferred list above (operator decisions before merge), plus any further pre-launch backlog tracked in `tasks/todo.md`.
