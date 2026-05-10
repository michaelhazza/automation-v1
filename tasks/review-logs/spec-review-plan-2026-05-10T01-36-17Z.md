# Spec Review Plan — phase-1-showcase-mvps

- **Spec path:** `tasks/builds/phase-1-showcase-mvps/spec.md`
- **Spec commit at start:** `9e82e1a8c585d539e71361510a730c8ebe8ea9a2`
- **Spec-context commit:** (unchanged from `docs/spec-context.md` last_reviewed_at 2026-05-09)
- **Iteration cap:** MAX_ITERATIONS = 5 (lifetime)
- **Existing iterations on this spec:** 0 (no prior `spec-review-checkpoint-phase-1-showcase-mvps-*` files)
- **Stopping heuristic:** two consecutive mechanical-only rounds → stop early

## Caller framing anchors (from invocation)

- Phase 1 MVP — scope is anchored to v1.2 brief §18.1 (triage + drafts + approval).
- Section §16.2 capabilities (SLA tracking, recurring-problem detection, vector KB search) are explicit non-goals NG1, NG2, NG3 and DO NOT need to be added back.
- Light Operator escalation is implemented as "flag for human" not as a long-running Operator loop (per brief §5.2 and spec §5.3.4).
- Spec is intentionally architecture-level — function signatures, full SQL, and wireframes are out of scope.

## Operator pre-pass (already applied before review run)

- Cache-table file removed pending Open Decision 11.4
- Migration number for support_eval_runs replaced with `<next-available>` (no pinning)
- File-delivery effort double-count fixed (now counted once in §6.1.7)
- Eval thresholds (85% / 4.0) explicitly tagged as tunable during pilot
- Performance baseline criterion in §9.1 replaced with a specific 1.25x p95 wall-clock check vs pre-MVP baseline
- `RUN_ARTIFACTS_API_V1` feature flag dropped (unnecessary)
- `run_artifacts.agent_run_id` changed from CASCADE to SET NULL
- PDF rendering location clarified as main-app, not worker
- §5.3.1 system_agents fields aligned to actual schema; `is_singleton` removed and replaced with install-time check; `default_controller_style` deferred (column does not exist today)

## Pre-loop context check

- spec-context.md last_reviewed_at: 2026-05-09 → age 1 day → green, proceed.
- Cross-reference of spec framing against context: spec explicitly aligns with "Native Controller default", "deterministic Native runs", "no feature flags except behaviour modes" (the two flags listed are behaviour-mode flags). No mismatch.
