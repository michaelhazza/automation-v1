# Spec Review Plan — riley-observations-dev-spec

- **Spec path:** `docs/riley-observations-dev-spec.md`
- **Spec commit at start:** `0d5978062347ac9e50dae7acfa7e5e361586d9fe`
- **Spec-context commit at start:** `1eb4ad72f73deb0bd79ad333b3f8caef23418392`
- **HEAD at start:** `db8590cdadb79bb81de60327e456772f58984d21`
- **Iteration cap (MAX_ITERATIONS):** 5
- **Stopping heuristic:** two consecutive mechanical-only rounds exits early

## Context-freshness check

- Spec last modified: 2026-04-22 (more recent than spec-context 2026-04-21 — fresh)
- Spec framing §2 "Pre-launch posture. No live users, no paying customers..." — matches `live_users: no`
- Spec uses one feature flag (`heartbeat_activity_gate_enabled`) for behaviour-mode opt-in on a specific agent — aligns with `feature_flags: only_for_behaviour_modes`
- §11.1 "Build waves" — spec-internal ordering, not user-facing staged rollout
- §7.11 "Enable on Portfolio Health Agent only in the initial rollout. Monitor for 2 weeks" — per-agent opt-in, not staged user rollout

No HITL mismatch. Proceed with iteration 1.

## Lifetime iteration count

- No prior `spec-review-checkpoint-riley-observations-*` or `spec-review-final-riley-observations-*` files detected
- Next iteration: 1 of 5
