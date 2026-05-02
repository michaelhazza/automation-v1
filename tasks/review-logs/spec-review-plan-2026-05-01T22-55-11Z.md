# Spec Review Plan — subaccount-optimiser

- Spec: `docs/sub-account-optimiser-spec.md`
- Spec commit at start: 638bf157
- Spec-context commit at start: 03cf8188
- MAX_ITERATIONS: 5
- Stopping heuristic: two consecutive mechanical-only rounds = stop early.

## Pre-loop context check

Spec framing reviewed against `docs/spec-context.md`:

- Pre-production / no live users — spec aligns (no feature flags, no staged rollout language).
- Rapid evolution / static-gates-primary — spec aligns (pure unit tests + 1 integration test, no frontend / E2E / API contract tests).
- Prefer existing primitives — spec extends `agentScheduleService`, `skillExecutor`, `cost_aggregates`, `review_items`, `pg-boss`, etc. The `agent_recommendations` + `output.recommend` + `<AgentRecommendationsList>` triplet IS a deliberately-new primitive, justified in §0.1 / §6 / §6.4 — design-locked.
- No staged rollout / no feature flags — spec uses an opt-out toggle (`subaccount_settings.optimiser_enabled`), which is a behaviour-mode toggle, not a rollout flag. Aligns with `feature_flags: only_for_behaviour_modes`.

No mismatch. Proceed with iteration 1.
