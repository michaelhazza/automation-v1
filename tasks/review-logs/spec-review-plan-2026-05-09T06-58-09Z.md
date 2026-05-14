# Spec review plan — synthetos-foundation-refactor

- Spec: `tasks/builds/synthetos-foundation-refactor/spec.md`
- Spec commit at start: `0be368dcab237accb4de920b49dc77be5f39f729`
- Spec-context commit: `8b6f8d80e8b58cf9908fb1171fef2398c9d8e19b`
- Spec-context staleness: 2026-05-05 last_reviewed_at, 4 days old → green
- Iteration cap: MAX_ITERATIONS = 5
- Stopping heuristic: two consecutive mechanical-only rounds → exit early
- Existing prior reviews of this spec slug: none (first run)

## Pre-loop context cross-check

Spec opens with "Status: Draft v1.0" and explicitly aligns with the v1.2 brief. Quick scan of headline sections vs spec-context.md:

- spec-context: `pre_production: yes`, `live_users: no` — spec consistent (mentions roughly "10K runs/day" only as an order-of-magnitude estimate in risk register, not a live-user claim)
- spec-context: `feature_flags: only_for_behaviour_modes` — spec proposes `RUN_TRACE_API_V1` (rollout flag) and `POLICY_ENVELOPE_SNAPSHOT` (kill switch). These are rollout-posture flags, NOT behaviour modes. Likely directional findings, but candidate auto-rejects based on framing.
- spec-context: `staged_rollout: never_for_this_codebase_yet` — Section 8.5 mentions production verification + monitor 24 hours which leans staged-rollout-ish. Candidate directional.
- spec-context: `testing_posture: static_gates_primary`, `frontend_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`, `performance_baselines: defer_until_production` — spec proposes Component tests (5+ files), End-to-end smoke tests (Section 7.1, 7.6), and Performance baselines (Section 7.5). These contradict the spec-context. Candidate AUTO-REJECT directional findings if Codex flags them OR rubric flags them on its own.

These will be classified per Step 5 / Step 7. The spec is somewhat directionally rich and likely to have rubric findings even before Codex weighs in.
