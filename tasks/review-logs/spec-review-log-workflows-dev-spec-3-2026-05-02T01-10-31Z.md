# Spec Review Log — workflows-dev-spec — Iteration 3

**Spec:** `docs/workflows-dev-spec.md`
**Spec commit at start:** `c6658b17d54080467f54661ba3756e3cf0e8cc50`
**Started:** 2026-05-02T01-10-31Z

## Codex findings (6 total: 3 high, 3 medium)

H1 §3.1 / §5.1 / §6 — Approval gate snapshots have no coherent persisted shape. `approver_pool_snapshot`, `seen_payload`, `seen_confidence` are added to `workflow_step_reviews`, but the same table now also holds per-decider write rows keyed by `UNIQUE (workflow_run_id, step_id, deciding_user_id)`. There's no unambiguous home for queue-time data BEFORE any decider acts; multi-approver quorum would duplicate or fragment the snapshot across rows.
H2 §7.5 — Pause/resume extension state isn't durably persisted. `extend_cost_cents` / `extend_seconds` / `extension_count_per_run` are referenced but no schema column. After worker restart / replay, the engine can't know current cap state. Also: resume with no extension after a cap-triggered pause would immediately re-hit the same ceiling.
H3 §11.4 / §14.6 — Cross-subaccount Ask auditing points to the wrong primitive. §14.6 says cross-subaccount Ask access is audited in `workflow_step_reviews.seen_payload`, but Ask steps don't create review rows. Audit sink missing.
M4 §4.6 — `POST /api/tasks/:taskId/reviews/:reviewId/refresh-pool` introduced for team-approval recovery has no response shape, idempotency/concurrency, event emission, or behaviour when refreshed pool is still below quorum.
M5 §3.3 / §10.6 / §13.2 — `workflow_drafts` lifecycle: §3.3 says "Read once on ?fromDraft= to hydrate"; §10.6 / §13.2 allow closing the tab and re-entering later. Fetch semantics need to be single-consume or repeatable, not both.
M6 §16.1 #1 — Schema-migration build item #1 lists only the iteration-0 column set; missing `workflow_drafts`, `approver_pool_snapshot`, `is_critical_synthesised`, `agent_execution_events.task_id/task_sequence`. Build punch list out of date.

## Classification

All six findings are mechanical:

- H1: Resolve by adding a new `workflow_step_review_gates` table (or use an existing per-gate table if one exists) keyed on `(workflow_run_id, step_id)` UNIQUE that holds the queue-time snapshot once. `workflow_step_reviews` per-decider rows reference it via FK. Alternative: keep the snapshot on the FIRST review row (deciding_user_id = NULL, status = 'pending') and treat subsequent decider rows as decisions referencing the gate. Best-judgment: the cleaner model is a separate gate row. But adding a new table on iteration 3 is more invasive than the simpler fix — denormalise the snapshot onto the workflow_step row itself (the existing `workflow_template_steps` runtime instance / `workflow_steps` row, depending on engine schema). Apply path 2 (denormalise onto the per-run step row) since the spec already references `workflow_steps` status transitions in §11.4.1 and §5.1.1; this is consistent. Move `seen_payload`, `seen_confidence`, `approver_pool_snapshot`, `is_critical_synthesised` to the per-run-step row (`workflow_step_runs` or whatever the engine names the per-run step instance). Update §3.1 schema deltas accordingly. Each `workflow_step_reviews` row records ONE decider's decision; the gate-level snapshot lives on the step-run row that all reviews FK back to.

  Wait — better path: the spec already places `decision_reason` on `workflow_step_reviews` (per-decider). That's correct per-decider. The OTHER fields (snapshot at gate-creation, before any decider acts) belong on the gate, not on each decision row. Add a small new table `workflow_step_gates` keyed `(workflow_run_id, step_id) UNIQUE` holding `seen_payload`, `seen_confidence`, `approver_pool_snapshot`, `is_critical_synthesised`. `workflow_step_reviews.gate_id` FKs to it. This keeps the per-decider write rows clean and the gate-level snapshot durable from queue-time. Apply.

- H2: Add `effective_cost_ceiling_cents`, `effective_wall_clock_cap_seconds`, `extension_count` columns to the per-run table (architect picks: the run row, not the workflow template row — these are run-level overrides). Resume API resets these accordingly. Forbid no-extension resume immediately after a cap-triggered pause: require either an extension OR Stop. Apply.

- H3: Pick the correct audit sink for Ask. The simplest fix: audit cross-subaccount Ask access via the existing `agent_execution_events` event log (which now has `task_id` per H1 of iteration 2). The compliance claim in §14.6 should point at the `ask.queued` / `ask.submitted` events with the cross-subaccount actor info, not at `workflow_step_reviews`. Apply.

- M4: Pin the contract for `/refresh-pool`: response shape `{ refreshed: true, pool_size: int }` or `{ refreshed: false, reason: 'unchanged' | 'gate_already_resolved' }`; idempotency = state-based (only refreshes when the gate is still `pending`); emits `approval.pool_refreshed` event; if refreshed pool is still below quorum, emits the existing error and the run remains stalled. Apply.

- M5: Resolve fetch semantics: drafts are repeatable-read while `consumed_at IS NULL`. Studio reads on every visit; only a publish or explicit discard sets `consumed_at`. Update §3.3 lifecycle bullet from "Read once" to "Read while `consumed_at IS NULL` (repeatable)". Apply.

- M6: Update §16.1 build item #1 to include all schema deltas from §3 (workflow_drafts table + approver_pool_snapshot + is_critical_synthesised + agent_execution_events extensions); architect can re-decompose. Apply.

No directional. No ambiguous. No rejections.

## Decisions log

[ACCEPT] H1 — add `workflow_step_gates` table per (workflow_run_id, step_id) UNIQUE; move gate-level snapshot fields off `workflow_step_reviews` onto this table; `workflow_step_reviews.gate_id` FK; update §3.1, §3.3, §3.4, §5.1 references.
[ACCEPT] H2 — add `effective_cost_ceiling_cents`, `effective_wall_clock_cap_seconds`, `extension_count` to the run-level row (architect verifies the table; the spec writes them as a §3.1 addition); update §7.5 resume contract to forbid no-extension resume after cap-triggered pause.
[ACCEPT] H3 — replace §14.6 audit-sink reference from `workflow_step_reviews.seen_payload` to `agent_execution_events` `ask.queued` / `ask.submitted` events.
[ACCEPT] M4 — pin /refresh-pool contract (response shape, idempotency, event emission, below-quorum behaviour) in §4.6 / §5.1.
[ACCEPT] M5 — rewrite §3.3 lifecycle bullet from "Read once" to "Read while consumed_at IS NULL".
[ACCEPT] M6 — update §16.1 #1 to enumerate the full schema delta list.

## Iteration 3 Summary

- Mechanical findings accepted:  6 (H1, H2, H3, M4, M5, M6)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   `99f176f51b8a1e16a66013f9071c9cac6d617a66`

**Stopping heuristic.** Iteration 2 was mechanical-only (0 directional, 0 ambiguous, 0 reclassified). Iteration 3 was also mechanical-only. **Two consecutive mechanical-only rounds** = preferred exit condition met. The loop will not start iteration 4.

