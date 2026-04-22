# Spec Review Plan

**Spec path:** `docs/skill-analyzer-v2-spec.md`
**Spec commit at start:** (untracked — spec not yet committed; HEAD = 9b75c17)
**Spec-context path:** `docs/spec-context.md`
**Spec-context commit at start:** 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
**MAX_ITERATIONS:** 5
**Stopping heuristic:** two consecutive mechanical-only rounds stops early
**Timestamp:** 2026-04-11T09:32:16Z

## Pre-loop context check — disposition

- Spec date: 2026-04-11 (fresh, 3 days after spec-context)
- Framing cross-reference:
  - Spec does NOT claim pre-production context is broken. No contradictions with `pre_production: yes`.
  - No feature-flag / staged-rollout language.
  - Spec proposes "component tests" for phase 4/5 client work — tension with `frontend_tests: none_for_now`. Flagging as a rubric finding in iteration 1, not pre-loop blocker (spec framing does not claim a new testing posture — it just drifts in the build-phase test plans).
  - Spec proposes a "full pipeline integration test" — tension with `runtime_tests: pure_function_only`. Same disposition.
- Conclusion: no hard mismatch blocks the loop. Proceeding to iteration 1.

## Review notes from the caller

- Caller already ran a self-review and fixed 5 issues. No prior checkpoint to resume.
- Spec is on disk, uncommitted. No rebase/history context.

## Relevant current-code grounding gathered before iteration 1

- `server/services/systemSkillService.ts` is FILE-BASED (reads `server/skills/*.md`), no `createSystemSkill` or `updateSystemSkill` method. Only writable field is `visibility`, and it rewrites markdown frontmatter.
- `server/db/schema/systemSkills.ts` declares a DB table, but `grep` shows no service reads/writes it — the file-based service is the only consumer.
- `server/routes/systemSkills.ts` explicitly returns 405 on POST/DELETE with message "System skills are managed as files in server/skills/."
- The spec's Execute step (§8) calls `systemSkillService.createSystemSkill()` / `updateSystemSkill()`, which DO NOT EXIST in the current codebase.
- The spec's §11 "Open items" acknowledges this as a question for the implementation plan, but the rest of the spec (goals, data model, pipeline, UI, phases) is written assuming the DB path is correct.
- This is likely to surface as a critical rubric finding in iteration 1 and will probably be classified as directional.
