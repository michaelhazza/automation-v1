# Spec review plan — agentic-commerce

- Spec path: `tasks/builds/agentic-commerce/spec.md`
- Spec commit at start: bd8920c3 (HEAD of claude/agentic-commerce-spending)
- Spec-context commit: read at iteration start (`docs/spec-context.md`)
- MAX_ITERATIONS: 5
- Stopping heuristic: two consecutive mechanical-only rounds = stop before cap.

## Pre-loop context check

- spec-context.md exists and is current as of 2026-04-16. No mismatch detected against spec framing (the spec explicitly references spec-context's posture in §19 Testing Posture and is built on the pre-production / no-feature-flags / static-gates-primary defaults).
- Spec was authored 2026-05-03 (today); spec-context unchanged since 2026-04-24. No drift.
- No prior `spec-review-checkpoint-agentic-commerce-*` files exist; first iteration available is N=1; full 5-iteration budget available.
