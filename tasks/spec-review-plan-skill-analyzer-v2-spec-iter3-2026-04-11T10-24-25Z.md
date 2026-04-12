# Spec Review Plan — Iteration 3

- Spec: `docs/skill-analyzer-v2-spec.md` (untracked; working-tree only; HEAD = 9b75c17)
- Spec-context commit: 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
- Iteration cap: 5
- Iteration 1 outcome: 5 HITL findings, all resolved `apply-with-modification`, spec rewritten by caller.
- Iteration 2 outcome: 6 mechanical auto-applied + 1 HITL (visibility-vs-isActive). Finding 2.1 resolved `apply`; caller applied changes directly to the spec.
- Iteration 3 goal: verify Finding 2.1 application (drift check), then fresh Codex + rubric pass to see if the spec has converged.
- Stopping heuristic status: Neither iteration 1 nor 2 was mechanical-only, so the "two consecutive mechanical-only rounds" streak has not started. Iteration 3 must be mechanical-only AND at least one more round (iter 4) must also be mechanical-only to exit via that heuristic. Other exit conditions: iteration cap (5), Codex + rubric produce zero findings, or HITL decision `stop-loop`.
- Drift check before iteration 3 begins: verified Phase 0 migration adds `visibility text` column with CHECK constraint, backfill reads frontmatter visibility, service rewrite spells out concrete SQL for `updateSkillVisibility` / `listVisibleSkills` / `listActiveSkills` / `listSkills`, §11 #5 removed, analyzer library-read bullet tightened to the `isActive = false` question. Checkpoint 2.1 application matches recommendation exactly — no drift logged.
