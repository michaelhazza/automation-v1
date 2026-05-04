# Spec Review Plan — workflows-dev-spec

**Spec path:** `docs/workflows-dev-spec.md`
**Spec slug:** `workflows-dev-spec`
**Spec commit at start:** `05176dd36f1bd2837d061b90f727c8f9d2f7a9f7`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Branch:** `claude/workflows-brainstorm-LSdMm`
**Iteration cap (MAX_ITERATIONS):** 5
**Stopping heuristic:** two consecutive mechanical-only rounds = exit before cap

## Pre-loop context check

Spec framing was cross-referenced against `docs/spec-context.md`:

- Spec assumes pre-production (default per context): consistent.
- Spec testing posture (§17): pure-function unit tests, static gates, no frontend/E2E — explicitly states "Per CLAUDE.md, full test-gate suites run in CI. Locally, only targeted unit tests for the file authored for THIS change". Consistent with `testing_posture: static_gates_primary`.
- However, §17.5 names `*.test.tsx` UI tests (e.g. `plan-tab-empty-state.test.tsx`, `chat-milestone-vs-narration.test.tsx`, `studio-publish-notes-modal.test.tsx`, etc.) — this is a frontend-test posture that contradicts `frontend_tests: none_for_now`. **Mismatch logged below as a potential framing deviation; will surface in iteration 1 rubric pass.**
- Spec rollout (§18.1): "Deploy to staging; smoke-test the three system templates run successfully end-to-end. Deploy to production; no operator-visible disruption." This contradicts `staged_rollout: never_for_this_codebase_yet`. **Mismatch logged.**
- Spec mentions "configurable per workflow" cost ceilings (§7.1) and "opt-in 'Pin to version vN' toggle" (§3.1) — these are user-config, not feature flags. Not a framing mismatch.

Both mismatches will be raised as rubric findings in iteration 1, classified per the standard rules. The loop proceeds.

## Notes for the loop

- Brief is at `docs/workflows-dev-brief.md`; both files just landed in commit 05176dd. No prior `spec-review-*-workflows-dev-spec-*` checkpoints exist.
- Special framing per caller:
  - Brief retired: mobile in V1, visual node-graph drag-drop, inline human file editing, workflow→workflow nesting, webhook triggers, while/do-until, cost dashboards, run-history search, timeout escalation. Auto-reject Codex revival of any of these.
  - Engine + schema + system templates assumed already on `main` per brief §2. Reject "build the engine first" findings.
  - Test posture: targeted unit tests + static gates only. Reject E2E/frontend/contract additions.
