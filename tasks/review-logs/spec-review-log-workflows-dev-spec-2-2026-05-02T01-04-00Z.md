# Spec Review Log — workflows-dev-spec — Iteration 2

**Spec:** `docs/workflows-dev-spec.md`
**Spec commit at start:** `a0f7f4856bba34f9258d95383db4e1803aa7e7ee`
**Started:** 2026-05-02T01-04-00Z

## Codex findings (5 total: 2 high, 3 medium)

H1 §8.1 / §8.2 — Replay event store: §8.1 says `agentExecutionEventService` allocates "per agent run" sequence; §8.2 requires `event_id` monotonic per task and replay by task_id. For workflow-fired tasks with multiple agent runs these are different ordering models. Also, the iteration 1 edit conditionally introduced `task_id` column on `agent_execution_events` but that schema delta is not in §3.
H2 §10.1 / §10.6 / §13.2 — Studio draft handoff route inconsistency: §10.1 says `/admin/workflows/:id/edit?fromDraft=`; §10.6 / §13.2 say `/admin/workflows/new?fromDraft=`. Discard semantics also conflict: §3.3 says `consumed_at` is set on discard (delete/garbage-collect); §10.6 says discard "returns to chat with the draft intact for further iteration". Implementation needs one lifecycle.
M3 §3.2 / §11.4 / §8.2 — Ask skip: `allowSkip` and `skipped: boolean` are added but §8.2 has no `ask.skipped` event, no skip endpoint contract, no card-collapse rendering rule for the skipped case.
M4 §5.1.1 / §3 — UNIQUE constraint on `workflow_step_reviews (workflow_run_id, step_id, deciding_user_id)` is committed in §5.1.1 prose but not in the §3 schema deltas (the migration plan can't add it as written).
M5 §7.5 / §8.2 — Pause/resume missing event: `/run/resume` defined but no `run.resumed` event in §8.2 taxonomy; multi-viewer clients can't see when the pause clears. Also §7.3 still mentions "another approver if routing is configured for resume" — that resume-routing primitive doesn't exist anywhere else; §14.5 defines visibility-based permissions instead.

## Classification

All five findings are mechanical:

- H1: pick canonical ordering primitive — per-task. Document the schema delta (add the column or use existing per-task correlation). Apply.
- H2: pick canonical route — `/admin/workflows/new?fromDraft=` (matches §10.6 / §13.2 since drafts produce a new template, not edit an existing one). Update §10.1 routes table. Reconcile discard semantics: drafts ARE persisted across tab close per §13.2 ("If the operator closes the tab, the draft persists"); but explicit "Discard" via the chat card sets `consumed_at` and removes from Studio. Document both paths cleanly. Apply.
- M3: add `ask.skipped` event to §8.2; add `POST /api/tasks/:taskId/ask/:stepId/skip` endpoint contract to §11.4 (mirrors submit shape, body-less, returns 200 with same skipped-output payload). Add receipt rendering for skipped case. Apply.
- M4: add UNIQUE `(workflow_run_id, step_id, deciding_user_id)` to §3.4 indexes table (with the right naming since it's both an index and a constraint in Postgres). Apply.
- M5: add `run.resumed` event to §8.2; remove the "or another approver if routing is configured for resume" stale phrase from §7.3 (replaced with §14.5 visibility set). Apply.

No directional findings. No ambiguous findings. No rejections.

## Decisions log

[ACCEPT] H1 — pick per-task ordering primitive; add `task_id` column to `agent_execution_events` in §3.1 schema deltas; remove "(if not already present)" hedge from §8.1; pin per-task monotonic sequence as the contract.
[ACCEPT] H2 — canonical route `/admin/workflows/new?fromDraft=<draftId>`; update §10.1 routes table; reconcile discard semantics with explicit prose ("Discard" sets consumed_at; closing the tab does not).
[ACCEPT] M3 — add `ask.skipped` event to §8.2; add skip endpoint contract to §11.4; add card-collapse rendering for skipped case.
[ACCEPT] M4 — add UNIQUE `(workflow_run_id, step_id, deciding_user_id)` to §3.4 indexes table.
[ACCEPT] M5 — add `run.resumed` event to §8.2; remove stale "another approver if routing is configured for resume" phrase from §7.3.

## Iteration 2 Summary

- Mechanical findings accepted:  5 (H1, H2, M3, M4, M5)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (set after Step 8b commit)

**Note for stopping heuristic.** This iteration was mechanical-only (zero directional, zero ambiguous, zero reclassified). If iteration 3 is also mechanical-only, the loop exits per the preferred two-consecutive-mechanical-only condition.

