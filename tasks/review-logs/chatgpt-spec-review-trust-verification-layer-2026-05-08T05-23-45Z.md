# ChatGPT spec review — trust-verification-layer

- **Spec under review:** `tasks/builds/trust-verification-layer/spec.md`
- **Round:** 1 (operator-paste mode; the autonomous `chatgpt-spec-review` agent did not run because it requires manual ChatGPT-web paste-back per its caller contract)
- **Reviewer source:** ChatGPT-web (operator paste-back)
- **Captured:** 2026-05-08
- **Outcome:** APPROVED WITH TIGHTENINGS — F1 through F6 + M2, M3, M4 applied; M1 deferred with posture commitment

## Reviewer overall verdict (verbatim)

- Architecture direction: strong
- Primitive reuse discipline: excellent
- Phase isolation: very strong
- Multi-tenant/RLS discipline: strong
- Operational semantics: mostly excellent
- Biggest remaining risk: Stage 2 + Stage 3 complexity coupling
- Biggest missing invariant: scorecard/version drift semantics
- Biggest scalability risk: unbounded judgement payload retention
- Biggest UX risk: hidden "Pending" ambiguity resurfacing operationally
- Classification: APPROVED WITH TIGHTENINGS — not blocked

## Findings triage

| ID | Category | Reviewer call | Operator decision | Disposition |
|---|---|---|---|---|
| F1 | High-impact / mechanical | Apply | Apply | Applied — §6.5 ScorecardJudgement now snapshots `qualityCheckName`, `qualityCheckDescription`, `passMark`, `judgeModelId`, `scorecardUpdatedAt` at judgement time + invariant pinned. §17 deferred-items entry for scorecard versioning rewritten to reflect Stage-2 mitigation. |
| F2 | High-impact / mechanical | Apply | Apply | Applied — §6.6 BenchResult: `rawJudgements: ScorecardJudgement[]` → `rawJudgementIds: string[]`. Details fetched lazily. |
| F3 | High-impact / mechanical | Apply (schema reservation only, retry logic stays deferred) | Apply | Applied — `attempt_number integer NOT NULL DEFAULT 1` reserved in `runtime_check_results`; uniqueness key updated in §10.1, §10.6, §10.7; §17 deferred-items entry rewritten to clarify "schema reserved, orchestration deferred". |
| F4 | High-impact / directional | Apply (pin v1 algorithm) | Apply | Applied — §13.3 step 2 pins clustering: exact match on `agent_id` + `skill_slug`, cosine similarity over embedded `editedOutput` (existing memory-embedding model), threshold 0.82, min cluster size 3, lookback 30 days. All three thresholds env-tunable. |
| F5 | High-impact / mechanical | Apply | Apply | Applied — §12.4 pins approval atomicity invariant: `bench_runs.approved_model_id` write + agent default-model update in single `withOrgTx`, or compensating `bench_approval_failed` event with revert. UI reads `approved_model_id` after terminal event, never optimistically. |
| F6 | High-impact / mechanical | Apply | Apply | Applied — §6.2 pins analytics invariant: aggregations/dashboards/trend charts/drift analytics MUST use internal `state` value, never the collapsed three-state operator badge. |
| M1 | Medium / directional | Optional | Defer with posture commitment | Applied as deferred item — §17 adds retention-and-archival policy entry. Posture: retention windows pinned before Stage 2 GA (ship-blocker, not deferred-forever). Working assumption logged: 90-day hot for `runtime_check_results` and `scorecard_judgements`, 365-day for `bench_results`, then aggregate-and-archive. Re-pin against observed growth before Stage 2 GA. |
| M2 | Medium / mechanical | Optional | Apply | Applied — §12.4 pins judge ≠ candidate invariant: judge model substituted to org-default if it appears in `candidateModels` set; operator notice surfaced on Setup. Prevents self-grading bias. |
| M3 | Medium / mechanical | Optional | Apply | Applied — §12.4 pins server-side cost cap: `BENCH_MAX_COST_CENTS` env var (default 5000 = $50/run); over-cap returns 422 `BENCH_COST_CAP_EXCEEDED` and never enters `awaiting_confirm`. Independent of UX confirmation. |
| M4 | Medium / mechanical | Optional | Apply | Applied — new §11.5 "Timeout and cancellation semantics": `RUNTIME_CHECK_TIMEOUT_MS` default 250ms, timeout → `state: 'inconclusive'` (never `'fail'`); cancellation/transient/treatment rules pinned. |

## Reviewer commendations (preserved verbatim)

- Primitive reuse discipline — "genuinely excellent". Avoided primitive explosion, parallel governance systems, memory duplication, policy-engine creep.
- Stage isolation — "Stage 3 remains useful without Stage 2" is the correct decision.
- Blast-radius model — "Simple. Composable. Extensible. Operator understandable. Excellent abstraction level."
- "No auto-routing" — "Very good restraint. Prevents premature autonomy, invisible model decisions, governance opacity, debugging nightmares."
- Source-of-truth precedence — `table row > event projection` is "exactly the right pattern. Strong invariant."

## Reviewer strategic recommendation (preserved)

> Do NOT let Stage 3 expand before Stages 1–2 are live. Stage 3 is the speculative intelligence layer; Stages 1–2 are the operational trust substrate. The dangerous temptation will be auto-learning, adaptive correction, memory synthesis, scorecard evolution, autonomous optimisation before runtime checks, scorecards, bench infrastructure, governance analytics have enough real production signal. Current sequencing is correct. Protect it aggressively.

This stance is consistent with §3 Phase plan (three stages) and §17 deferred items. No spec change required.

## Files changed in this round

- `tasks/builds/trust-verification-layer/spec.md` (1062 → 1087 lines; +25 lines net across 9 sections: §6.2, §6.5, §6.6, §10.1, §10.6, §10.7, §11.5 (new subsection), §12.4, §13.3, §17)

## Outstanding items for Phase 2

- **6 open questions** in §18 remain unanswered by this review round; they predate the review and need operator confirmation before/during Phase 2.
- **REVIEW_GAP** still logged: `spec-reviewer` (Codex CLI) skipped — Codex unavailable in this environment. Phase 2 review pipeline (per-chunk `pr-reviewer` + branch-level `dual-reviewer`/`adversarial-reviewer` + Phase 3 `chatgpt-pr-review`) absorbs the missing second-opinion coverage. Logged in `progress.md` and `handoff.md`.
- **No further rounds requested** — operator may run additional ChatGPT-web rounds before launching Phase 2, or proceed to `feature-coordinator` directly with this round as the last review pass.

## Next step

Operator commits the spec changes manually (per CLAUDE.md preference: no auto-commits from main session). Once committed, either run another ChatGPT-web round or `launch feature coordinator` in a new session for Phase 2.

---

## Round 2 — close-out (2026-05-08, operator paste-back)

**Reviewer verdict:** "Looks good. Round 1 findings were applied cleanly and the spec is materially stronger now. Two small follow-up tightenings before build."

**Two consistency findings (drift between Round 1 tightenings and prior locked sections):**

| ID | Finding | Disposition |
|---|---|---|
| R2-1 | §18 Q3 stale — still framed as open question with default "always allowed with explicit confirmation"; §12.4 now enforces `BENCH_MAX_COST_CENTS` (default $50, 422 over-cap). | Applied — §18 Q3 marked **RESOLVED (Round 1 review)** with cross-reference to §12.4. Original question text struck through; resolution describes the two-layer enforcement (server cap + UX confirmation below cap). |
| R2-2 | §4 stale — `runtime_check_results` reuse-decision row still showed uniqueness key `(run_id, sequence_number, skill_slug)`; §10.1 now uses `(run_id, sequence_number, skill_slug, attempt_number)` per F3. | Applied — §4 row updated to `(run_id, sequence_number, skill_slug, attempt_number)` with cross-reference to §10.1. |

**Reviewer final disposition:** "After those two consistency edits, I'd approve and move to Phase 2."

**Spec status after Round 2:** **LOCKED.** No further review rounds planned. Approved for Phase 2 plan generation.

**Files changed in Round 2:**
- `tasks/builds/trust-verification-layer/spec.md` — 2 surgical edits (§4 row, §18 Q3)

**Round 2 line delta:** +1 line (Q3 expanded from 1 line to 2 lines — RESOLVED note added; §4 row in place)

