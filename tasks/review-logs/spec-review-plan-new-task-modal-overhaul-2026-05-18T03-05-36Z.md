# Spec Review Plan — new-task-modal-overhaul

- **Spec path:** `docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md`
- **Spec commit at start:** `771a0da9` (HEAD of builds/new-task-modal-overhaul)
- **Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
- **Spec-context staleness:** 7 days old, green (warn at 60, block at 120)
- **MAX_ITERATIONS:** 5 (lifetime cap; first invocation, so iterations 1–5 available)
- **Stopping heuristic:** two consecutive mechanical-only rounds, or zero new findings, or zero-acceptance drought
- **Codex CLI:** codex-cli 0.125.0, authenticated via ChatGPT
- **Context mismatch check:** none found — spec framing aligns with spec-context.md (pre-production, no live users, hard cutover, no feature flags)
