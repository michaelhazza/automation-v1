# Spec Review Plan — session-1-foundation-spec (iteration 1)

- Spec: tasks/builds/clientpulse/session-1-foundation-spec.md
- Spec commit at start: a08433bf328712c0abc49d738f18f797959d300d
- Spec-context commit: 00a67e9bec29554f6ca9cb10d1387e7f5eeca73f
- Iteration cap: 5 lifetime (this is iteration 1)
- Stopping heuristic: two consecutive mechanical-only rounds exits early
- Pre-loop context check: PASS — spec framing (cleanup, no feature flags, pure tests, no staged rollout) aligns with spec-context `pre_production: yes`, `rollout_model: commit_and_revert`, `testing_posture: static_gates_primary`.
- User-locked contracts (do not re-litigate): org FK locked; legacy slug normalisation contract (l); route retirement no redirect; migration 0178 → 0180 via git mv; AGENTS_EDIT reuse; reset-to-default option (a); JSON intervention editor for S1; chips fresh / transcript resume; no multi-tab dedup; reuse OAuth + invite infra; log-once legacy alias; §10.8 audits stay as chunk-kickoff discovery.
