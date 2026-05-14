# Spec Review Plan

- **Spec path:** `tasks/builds/feat-split-layout/spec.md`
- **Spec commit at start:** uncommitted (working tree)
- **Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
- **Iteration cap:** 5 (MAX_ITERATIONS)
- **Stopping heuristic:** two consecutive mechanical-only rounds, or codex-found-nothing, or zero-acceptance-drought.
- **Staleness check:** spec-context.md is 3 days old (2026-05-11), well within 60-day warn threshold. GREEN.
- **Context cross-reference:** spec framing aligns with `docs/spec-context.md` — no flagged mismatch. Spec explicitly opts in to "pure-function unit tests" per `runtime_tests: pure_function_only`. Spec is frontend-only refactor; no RLS / execution-model / state-machine sections apply (consistent with `none_for_now` testing posture).
