# Spec Review Plan — CRM Query Planner v1

**Spec path:** `tasks/builds/crm-query-planner/spec.md`
**Spec commit at start:** `76bbd36905353d2cfb021c3afd0bac25b95a7d3e`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**MAX_ITERATIONS:** 5
**Stopping heuristic:** two consecutive mechanical-only rounds = stop before cap.
**Context mismatches found:** None. Spec §21.1 explicitly honours `feature_flags: only_for_behaviour_modes` ("No feature flag v1"). Spec-context says `staged_rollout: never_for_this_codebase_yet` — spec §21.3 "Phased rollout per org" post-P3 on main is granular org-level capability rollout (permission grants), not a % traffic or feature-flag rollout. Flag as soft-watch during iteration 1 to confirm it doesn't drift into staged-rollout territory.
