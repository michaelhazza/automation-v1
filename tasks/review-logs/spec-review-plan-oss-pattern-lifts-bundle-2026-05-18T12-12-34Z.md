# Spec Review Plan — oss-pattern-lifts-bundle

- Spec path: `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
- Spec commit at start: 76fbf1d45da165d9e15baaeeb49ef3bacdc96d79
- Spec-context commit: 645a2462e90a722a170ab5bed9718ddab17d6f15
- MAX_ITERATIONS: 5
- Spec-context staleness: 7 days (green; warn at 60, block at 120)
- Pre-loop framing cross-reference: no mismatch — §3 Framing Assumptions explicitly cites pre-production, static_gates_primary, commit_and_revert.
- Stopping heuristic note: two consecutive mechanical-only rounds = stop before cap.
