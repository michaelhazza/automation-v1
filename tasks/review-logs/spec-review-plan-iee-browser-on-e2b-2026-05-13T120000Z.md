# Spec Review Plan — iee-browser-on-e2b

- **Spec path:** `tasks/builds/iee-browser-on-e2b/spec.md`
- **Spec commit at start:** 39ed427e0fc4f6832a82a6a8d976ecaece8346c7 (HEAD; spec not yet committed in isolation — workspace status: `M tasks/builds/iee-browser-on-e2b/brief.md`, untracked spec.md)
- **Spec-context commit at start:** 62497257 (last touched 2026-05-11; declares `last_reviewed_at: 2026-05-11`)
- **Context freshness:** GREEN — `age_days = 2`, well below `stale_after_days: 60`.
- **Expected iteration cap:** MAX_ITERATIONS = 5 (no prior checkpoints for this slug)
- **First iteration:** 1 (no prior `spec-review-checkpoint-iee-browser-on-e2b-*` files exist)
- **Stopping heuristic note:** exit at two consecutive mechanical-only rounds even before cap; preferred exit condition.
- **Pre-loop notes:**
  - Spec framing §3 explicitly cites `docs/spec-context.md` (pre_production, static_gates_primary, pure_function_only, feature_flags only_for_behaviour_modes, prefer_existing_primitives_over_new_ones). No framing mismatch.
  - Source brief `tasks/builds/iee-browser-on-e2b/brief.md` is LOCKED v7. Brief's locked decisions are non-negotiable — Codex findings that contradict brief v7 locked stance route to `rejected-mechanical`.
  - Pre-emptive rubric flag (will be raised in iteration 1): the spec references Spec D's profile primitive as **§3.15** in 6 places (lines 9, 55, 85, 93, 110, 397, 620). The brief references the same primitive as **§3.13** (verified, lines 5, 101, 120, 134, 170, 183, 198, 302). One of the two is wrong; the brief is locked v7 so spec is the side that must reconcile. Spec author note in §17 OQ3 already acknowledges "exact file path TBD" for the e2b provider — this section-number mismatch belongs in the same bucket.
