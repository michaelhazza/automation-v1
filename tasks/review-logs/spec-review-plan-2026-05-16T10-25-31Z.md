# Spec Review Plan — wave-5-prevention-gates-and-rls

- **Spec path**: `tasks/builds/wave-5-prevention-gates-and-rls/spec.md`
- **Spec commit (start)**: `86730eea38c1f2ca628f16175093b079a8616ec5`
- **Spec-context commit**: same (`docs/spec-context.md`, last touched 2026-05-12)
- **Iteration cap (MAX_ITERATIONS)**: 5
- **Prior iterations on this spec**: 0 (no `spec-review-checkpoint-wave-5*` or `spec-review-final-wave-5*` found)
- **Stopping heuristic**: two consecutive mechanical-only rounds = stop before cap
- **Spec-context staleness**: green (last_reviewed_at 2026-05-11, age 5 days, warn at 60)

## Pre-flight rubric notes

Cross-reference against actual repo state surfaced multiple drift points BEFORE iteration 1:
- PP-CD1 (`verify-no-new-cycles.sh`): already exists; promoted to error 2026-05-15; baseline already seeded.
- PP-DUP1: existing gate `verify-duplicate-blocks.sh` (not the spec's filename), baseline seeded 2026-05-14; spec proposes different jscpd params + different scope.
- PP-SK2: `verify-universal-skill-sync.sh` is ALREADY bidirectional (asserts set equality both ways).
- PP-MC2: `verify-critical-path-coverage.sh` already exists.
- PP-FE2: `verify-frontend-design-budget.sh` already exists with allowlist approach; spec proposes a new overlapping gate.

Rubric findings will be raised in iteration 1 alongside Codex output.
