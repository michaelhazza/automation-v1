# Spec Review Log — workflows-dev-spec — Iteration 1

**Spec:** `docs/workflows-dev-spec.md`
**Spec commit at start:** `05176dd36f1bd2837d061b90f727c8f9d2f7a9f7`
**Started:** 2026-05-02T00-48-25Z

## Codex findings (3 critical, 8 important)

C1 §3.3-§3.5/§10.6/§13.2/§16.3 — `workflow_drafts` referenced repeatedly, but §3.5 claims "no new tables for V1". Contradiction.
C2 §3.2/§4.8/§11.4-11.6 — Ask inherits Approval `quorum`/routing but runtime is single-submit; multi-submit semantics undefined.
C3 §5.1/§8.4/§11.4/§17.2 — New Approval/Ask writes have no idempotency posture, concurrency guard, duplicate-request HTTP mapping.
I4 §4.6/§5.2 — "edit the workflow" recovery is stale (running tasks pinned to start version per brief versioning contract).
I5 §3.1/§5.1/§5.4/§8.2 — approver-pool snapshot + `is_critical_synthesised` referenced in prose but no schema field.
I6 §10.4/§11.1-11.5 — Ask form contract underspecified: no canonical `params`, `autoFillFrom` enum, skip-flag schema, `error_message` field.
I7 §7.1-§7.4 — Pause system promises resume/extend but no endpoint, persisted state, permission contract, state-machine closure.
I8 §9.4 / brief §6.3 — Spec has 3 tabs (Now/Plan/Files); brief §6.3 still lists 4. (Brief §6.4 #2 already says 3 — brief is internally inconsistent; spec resolves correctly.)
I9 §8.1-§8.2/§8.5 — Replay depends on monotonic event log but no source/sequence named.
I10 §16.3 #37 — `workflow.run.start` skill in roadmap but no contract; no verdict.
I11 §12.4-§12.7 — Per-hunk revert: no hunk identity, request shape, concurrent-edit handling, idempotency rule.

## Rubric findings (Claude's pass)

R1 §3 + §11.1 — Skip-Ask flag mentioned in §11.1 but never in §3.2 Ask params or §3 deltas.
R2 §18.1 — "Deploy to staging; smoke-test" contradicts spec-context.md `staged_rollout: never_for_this_codebase_yet`.
R3 — No `## Deferred Items` section per spec-authoring-checklist §7 (content scattered in §1.2 + §19.3).
R4 §17.5 — ~10 `*.test.tsx` UI tests contradict spec-context.md `frontend_tests: none_for_now`.
R5 §7.3 — Stop transitions task to `failed` but state-machine closure (valid transitions) not pinned.
R6 §11.4 — Ask submitted-output JSON shape has no Contracts entry.
R7 §13.2/§10.6 — `workflow_drafts` cleanup job (7-day retention) not in §16 or any inventory.
R8 §6 — `seen_confidence` JSONB shape has no Contracts entry.
R9 §5.1 — Approver-pool-snapshot referenced but no `approver_pool_snapshot` jsonb column in §3.1 (folded into I5).
R10 §5.4 — `is_critical_synthesised` flag in prose but not in §3.1 columns (folded into I5).

## Classification

### Mechanical (auto-apply)
C1, I4, I5, I8, I9, I10, I11, R1, R5, R6, R7, R8 (R9/R10 fold into I5)

### Reclassified → Mechanical
R3 (No Deferred Items section): structural cleanup, not scope.

### AUTO-DECIDED (route to tasks/todo.md, accept and apply mechanically as the chosen resolution)
C2 — Ask multi-submitter: resolve as single-submit / first-wins; cap quorum=1 for Ask in §4.8.
C3 — Idempotency for Approval/Ask: resolve via state-based predicate + UNIQUE (workflow_run_id, step_id, deciding_user_id) on Approval, state-based predicate on Ask, 23505→409 mapping. Per checklist §10.
I6 — Ask params Contracts entry: pin the schema in §3.2/§11.2.
I7 — Pause state machine + resume API: pin both in §7.

### AUTO-REJECT — framing
R2 (staging deploy) — `staged_rollout: never_for_this_codebase_yet`. Replace with commit-and-revert language.
R4 (frontend .test.tsx) — `frontend_tests: none_for_now`. Remove .test.tsx block; add deviation note.

## Decisions log (per finding)

[ACCEPT] C1 — add `workflow_drafts` to §3 schema deltas; update §3.5; add cleanup job.
[ACCEPT] I4 — replace "edit the workflow" with explicit recovery (Stop, admin team-member change).
[ACCEPT] I5 — add `approver_pool_snapshot jsonb` + `is_critical_synthesised boolean` to §3.1 workflow_step_reviews additions.
[ACCEPT] I8 — add resolution-note in §9.4 declaring 3-tab canonical (matching brief §6.4).
[ACCEPT] I9 — name `agentExecutionEventService` (or comparable per-task event log) as the replay source; pin replay query contract.
[ACCEPT] I10 — add §13.5 (or §16.3 detail) with workflow.run.start skill contract.
[ACCEPT] I11 — add Contracts subsection to §12 (hunk identity, request shape, idempotency, concurrency).
[ACCEPT] R1 — add `allowSkip:boolean default false` to Ask params in §3.2.
[ACCEPT] R5 — add State-machine subsection to §7 (paused/running/stopped/failed transitions).
[ACCEPT] R6 — add Contracts entry for Ask submitted-output JSON.
[ACCEPT] R7 — add cleanup-job line to §16 orchestrator + §13.4 inventory.
[ACCEPT] R8 — add Contracts entry for `seen_confidence` JSONB.
[RECLASSIFIED → MECHANICAL] R3 — consolidate into a single `## Deferred Items` section before §19.
[AUTO-DECIDED - accept] C2 — apply single-submit/first-wins resolution; cap quorum=1 for Ask in §4.8; route note to tasks/todo.md.
[AUTO-DECIDED - accept] C3 — apply state-based + UNIQUE constraint pattern; route note to tasks/todo.md.
[AUTO-DECIDED - accept] I6 — apply Contracts schema for Ask params; route to tasks/todo.md.
[AUTO-DECIDED - accept] I7 — pin state machine + resume API; route to tasks/todo.md.
[AUTO-REJECT - framing] R2 — replace staging step with commit-and-revert.
[AUTO-REJECT - framing] R4 — remove .test.tsx block; add deviation note.

## Iteration 1 Summary

- Mechanical findings accepted:  13 (C1, I4, I5, I8, I9, I10, I11, R1, R5, R6, R7, R8 — plus R3 reclassified-then-applied; R9/R10 fold into I5)
- Mechanical findings rejected:  0
- Directional findings:          4 (C2, C3, I6, I7)
- Ambiguous findings:            0
- Reclassified → directional:    0 (R3 reclassified the other direction — directional → mechanical)
- Autonomous decisions (directional/ambiguous): 6
  - AUTO-REJECT (framing):    2 (R2, R4)
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             4 (C2, C3, I6, I7 — see tasks/todo.md for details)
- Spec commit after iteration:   `a0f7f4856bba34f9258d95383db4e1803aa7e7ee`

