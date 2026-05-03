# Spec Review Plan

- **Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
- **Spec commit at start:** `c70d694fbdd3254e7320e8df24989968cb1c5648`
- **Spec-context commit:** `1eb4ad72f73deb0bd79ad333b3f8caef23418392`
- **Companion artifact:** `prototypes/sidebar-badges.html` (treated as authoritative for UI/visual decisions)
- **MAX_ITERATIONS:** 5 (lifetime cap)
- **Prior iterations on file:** 0
- **Next iteration:** 1
- **Stopping heuristic:** two consecutive mechanical-only rounds = stop before cap

## Pre-loop context check

- **Spec-context exists:** yes (`docs/spec-context.md`)
- **Framing assumptions on this run:** pre-production, no live users, rapid evolution, static-gates-primary, no feature flags, prefer existing primitives.
- **Spec/context cross-reference:** spec is a Standard cleanup spec post-PR-#249. No conflicts with framing assumptions detected. Spec explicitly invokes pre-production-friendly conventions (no flags, surgical changes, existing primitives).
- **Verdict:** clean to proceed with iteration 1.
