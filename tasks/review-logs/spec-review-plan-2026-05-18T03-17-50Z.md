# Spec Review Plan

- **Spec path:** `docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md`
- **Spec commit at start:** untracked (new file, not yet committed)
- **Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
- **Iteration cap:** 5 (lifetime)
- **Current iteration:** 1
- **Stopping heuristic:** exit on two consecutive mechanical-only rounds, or codex-found-nothing, or zero-acceptance-drought.

## Pre-loop context check

- `docs/spec-context.md` staleness: last_reviewed_at 2026-05-11 (7 days old), stale_after 60, stale_blocks 120 → GREEN.
- Cross-reference framing: spec §4 explicitly cites `docs/spec-context.md`: `pre_production: yes`, `rollout_model: commit_and_revert`. Consistent with context file.
- No prior review iterations for this spec slug. This is iteration 1 of MAX 5.
