# chatgpt-plan-review — synthetos-foundation-refactor

**Date:** 2026-05-09
**Plan:** tasks/builds/synthetos-foundation-refactor/plan.md
**Spec:** tasks/builds/synthetos-foundation-refactor/spec.md (LOCKED — chatgpt-spec-review APPROVED 2026-05-09)
**Handoff:** tasks/builds/synthetos-foundation-refactor/handoff.md
**Branch:** claude/openclaw-worker-mode-VnjQT
**Mode:** manual (operator pastes ChatGPT-web responses; no OpenAI API calls)
**Invoked by:** feature-coordinator (Phase 2 Step 4)
**Build slug:** synthetos-foundation-refactor

---

## Hard rules in force this session

- Spec is LOCKED — any ChatGPT proposal that mutates the spec is routed to a `spec-amendment-needed` finding, never auto-applied.
- §11 deferred CI gates (`verify-controller-style-mapping.sh`, `verify-no-direct-credential-service-calls.sh`) STAY deferred — reject any push to add them in Phase 2.
- No service-wide renames (NG7 / INV-13). Reject any rename proposal.
- Risk Tier CSV stays in chunk 4 — do not split it out.
- Build invocation = single `feature-coordinator` run with eleven chunks (per spec §12.7) — do not propose splitting into multiple builds.

---

