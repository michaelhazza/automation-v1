# Spec Review Plan — lint-typecheck-post-merge-spec

- **Spec path:** `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
- **Spec commit at start:** `dda669c4a53c2d5520546e8b3ed497287244b273`
- **Spec mtime:** 2026-05-01 11:48:54 +1000
- **Spec-context mtime:** 2026-04-21 22:23:24 +0000
- **MAX_ITERATIONS:** 5 (lifetime cap; iteration 1 of 5)
- **Stopping heuristic:** two consecutive mechanical-only rounds → stop early; preferred exit before cap.
- **Pre-loop context check:** spec is a remediation/cleanup checklist, not a new-feature spec. No staged-rollout language, no feature flags, no production-caution claims. Proposes two integration tests (F14, F28) — to be evaluated against `runtime_tests: pure_function_only` during the loop. No HITL pause needed; no spec-context mismatch to log.
