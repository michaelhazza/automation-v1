# Spec Review Final Report

**Spec:** `docs/workflows-dev-spec.md`
**Spec commit at start:** `05176dd36f1bd2837d061b90f727c8f9d2f7a9f7`
**Spec commit at finish:** `99f176f51b8a1e16a66013f9071c9cac6d617a66`
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD (3 iterations, 24 mechanical fixes applied, 4 directional findings auto-decided to tasks/todo.md, 2 framing-conflict findings auto-rejected)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 11 | 10 (R1-R10; R9/R10 fold into I5) | 13 | 0 | 2 (R2, R4) | 0 | 4 (C2, C3, I6, I7) |
| 2 | 5 | 0 | 5 | 0 | 0 | 0 | 0 |
| 3 | 6 | 0 | 6 | 0 | 0 | 0 | 0 |

---

## Mechanical changes applied

### §3 Schema deltas

- Added `workflow_drafts` table (Studio-handoff persistence) with `(subaccount_id, session_id)` UNIQUE + `(consumed_at, created_at)` partial index for the 7-day reaper. RLS-protected.
- Added `workflow_step_gates` table holding gate-level snapshot fields (`seen_payload`, `seen_confidence`, `approver_pool_snapshot`, `is_critical_synthesised`) keyed by `(workflow_run_id, step_id)` UNIQUE. RLS-protected.
- Removed gate-level snapshot columns from `workflow_step_reviews` (which now holds only per-decider fields: `gate_id` FK, `decision_reason`).
- Added `task_id` + `task_sequence` columns to `agent_execution_events` for per-task replay.
- Added `effective_cost_ceiling_cents`, `effective_wall_clock_cap_seconds`, `extension_count` to `workflow_runs` for durable Pause/Resume state.
- Added `allowSkip:boolean default false` to Ask `params` shape; pinned full Ask params Contracts entry.
- Updated §3.4 indexes/constraints table: added UNIQUE `(gate_id, deciding_user_id)` on `workflow_step_reviews`; added `(task_id, task_sequence)` UNIQUE on `agent_execution_events`; added `workflow_step_gates` indexes.
- Updated §3.5 to acknowledge two new tables.

### §4-§5 Validator + state machine

- Capped `quorum` at 1 for Ask in §4.8 (single-submit / first-wins resolution).
- Replaced "edit the workflow" stale recovery path in §4.6 with explicit `/refresh-pool` + Stop options.
- Added §5.1.1 Approval Execution-Safety contract (idempotency posture, retry classification, concurrency guard, 23505 to 200 mapping, state-machine closure).
- Added §5.1.2 `/refresh-pool` admin endpoint contract (response shape, idempotency, event emission, below-quorum behaviour, concurrency guard).
- Updated pool-resolution prose in §5.1 to point at `workflow_step_gates.approver_pool_snapshot`.
- Updated §5.4 engine entry-points table to reflect gate-row insert as the snapshot path.

### §6 Confidence + audit

- Added §6.2.1 `seen_confidence` JSONB Contracts entry (value, reason, computed_at, signals).

### §7 Pause / Stop / Resume

- Added §7.5 state-machine subsection (paused/running/stopped/failed transitions, forbidden transitions).
- Added Resume API contract (POST /api/tasks/:taskId/run/resume) with state-based idempotency, permission guard (§14.5), 2-extension cap, no-extension-after-cap-pause rule (returns `extension_required`), concurrency guard.
- Added Stop API contract (POST /api/tasks/:taskId/run/stop) with state-based idempotency.
- Removed stale "another approver if routing is configured for resume" phrase.

### §8 WebSocket / event taxonomy

- Named `agentExecutionEventService` as the persisted event log + per-task monotonic sequence source for replay.
- Pinned replay query contract.
- Added `ask.skipped`, `run.resumed`, `approval.pool_refreshed` events to the event taxonomy.
- Updated per-pane subscription table for Chat to include `ask.skipped` and `run.resumed`.

### §9 Open task view UI

- Added resolution-note in §9.4 declaring the spec resolves brief §6.3's internal contradiction (canonical: 3 tabs, Now/Plan/Files, matching brief §6.4 #2).

### §10 Studio

- Reconciled Studio handoff route to canonical `/admin/workflows/new?fromDraft=:draftId` (was inconsistent with `/admin/workflows/:id/edit?fromDraft=` in §10.1).
- Reconciled draft discard semantics (publish or explicit-discard sets `consumed_at`; closing tab does not — repeatable read while `consumed_at IS NULL`).

### §11 Ask runtime

- Added §11.4 Contracts entry for the Ask submitted-output JSON shape.
- Added §11.4.1 Ask Execution-Safety contract (state-based predicate, 0-rows to 409, state-machine closure).
- Added §11.4.2 Skip endpoint contract (POST /api/tasks/:taskId/ask/:stepId/skip) with permission guard, idempotency, persisted-output shape, event emission.

### §12 Files

- Added §12.4 per-hunk revert Contracts (hunk identity, request shape, idempotency posture, concurrency guard, 200/409 response shape).

### §13 Orchestrator

- Added §13.4 `workflow.run.start` skill contract (input/output, permission guard, version selection, task creation semantics, failure modes).
- §13.5 Files-referenced table updated with cleanup job + skill registration entries.

### §14 Permissions

- Replaced cross-subaccount Ask audit-sink reference (was incorrect: `workflow_step_reviews.seen_payload`) with `agent_execution_events` `ask.queued`/`ask.submitted` events. For Approval, points at `workflow_step_gates.approver_pool_snapshot` + per-decider `workflow_step_reviews`.

### §16 Build punch list

- Updated #1 schema-migration item to enumerate the full §3 schema delta list (workflow_drafts, workflow_step_gates, all column additions, RLS manifest entries).
- Added 35a workflow_drafts cleanup job entry.
- Added §13.4 reference to #37 workflow.run.start item.

### §17 Test plan

- Removed the `*.test.tsx` block from §17.5; replaced with a deviation note pointing at `spec-context.md frontend_tests: none_for_now`.
- Renamed §17.6 `pause-stop-button-visibility.test.tsx` to a server-side `pause-stop-visibility.test.ts`.

### §18 Migration plan

- Replaced "Deploy to staging; smoke-test... Deploy to production" with the codebase's commit-and-revert pattern (per `spec-context.md staged_rollout: never_for_this_codebase_yet`).
- Updated default-safe column list to include the new columns added in iterations 2-3.
- Updated migration steps to include both new tables in `RLS_PROTECTED_TABLES`.

### Deferred Items (new section)

- Added a single canonical `## Deferred Items` section before §19 consolidating §1.2 + §19.3 + scattered V2 mentions per spec-authoring-checklist §7.

## Rejected findings

None. Every finding raised by Codex (22 across 3 iterations) and every rubric finding raised by the reviewer (10 in iteration 1) was either accepted as mechanical, auto-decided as directional, or auto-rejected per a baked-in framing assumption. No finding was rejected on its merits.

## Directional and ambiguous findings (autonomously decided)

### Iteration 1 — auto-decided directional (route to tasks/todo.md)

- **C2 (Ask multi-submitter semantics).** Decision: Ask is single-submit / first-wins. `submitterGroup` defines who CAN submit; only one DOES. Cap `quorum` at 1 for Ask in §4.8. Rationale: matches the brief's implicit model (single submitted-values JSON per Ask step) and avoids inventing a multi-submit aggregation concept. Routed to tasks/todo.md as D-W1-C2.
- **C3 (Idempotency posture for Approval/Ask writes).** Decision: state-based + UNIQUE on `(gate_id, deciding_user_id)` for Approval; state-based predicate on Ask step status, 23505 to 409 mapping. Rationale: standard repo posture per spec-authoring-checklist §10. Routed to tasks/todo.md as D-W1-C3.
- **I6 (Ask form params Contracts entry).** Decision: pin full Ask params schema in §3.2 (seven field types, prompt, submitterGroup, quorum=1, autoFillFrom enum, allowSkip default false). Rationale: structural Contracts cleanup, not scope change. Routed to tasks/todo.md as D-W1-I6.
- **I7 (Pause state machine + resume API).** Decision: path b chosen — pin the full state machine + resume API rather than cutting extend from V1. Rationale: spec already commits to extension affordance via §7.2 mock and spec-time decision #4; ripping it out is more invasive than pinning. Routed to tasks/todo.md as D-W1-I7.

### Iteration 1 — auto-rejected directional (framing)

- **R2 (staging deploy step).** Auto-rejected per `spec-context.md staged_rollout: never_for_this_codebase_yet` and `rollout_model: commit_and_revert`. §18.1 staging step replaced with commit-and-revert.
- **R4 (frontend `*.test.tsx` tests).** Auto-rejected per `spec-context.md frontend_tests: none_for_now` and `convention_rejections` "do not add frontend unit tests". §17.5 .test.tsx block removed; deviation note added.

### Iterations 2 and 3

No directional findings. Both iterations were mechanical-only — the preferred convergence signal.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across three iterations. The reviewer adjudicated 22 Codex findings + 10 rubric findings; converged on a stable set of mechanical fixes after the first iteration; iterations 2 and 3 surfaced only mechanical follow-ons from earlier edits (a sign the structure is converging). However:

- **The review did not re-verify the framing assumptions.** If the product context has shifted since the brief and spec were written (stage of app, testing posture, rollout model), re-read §1 (Summary, scope, related docs), §1.2 (What this spec does NOT cover), and the new `## Deferred Items` section before calling the spec implementation-ready. The framing assumptions used during the review were: pre-production, rapid evolution, no feature flags, no staged rollout, no frontend tests, prefer-existing-primitives.
- **The review did not catch directional findings that Codex and the rubric did not see.** Automated review converges on known classes of problem (idempotency contracts, file-inventory drift, schema overlap, stale recovery paths). It does not generate insight from product judgement. The spec proposes a substantial new operator surface (open task view three-pane), a new authoring surface (Studio canvas with four A's inspectors), and a real-time WebSocket coordination layer with sub-200ms latency targets. Whether those scope choices are correct is the human's call.
- **Several auto-decided directional resolutions were applied as mechanical edits to keep the loop moving.** The four entries in `tasks/todo.md` (D-W1-C2 through D-W1-I7) name the resolutions chosen and the validation a human should run before treating the spec as implementation-ready. The most consequential of the four is **D-W1-I7 (Pause/Resume state machine path b)** — the spec now ships extend-with-resume as V1 scope rather than the simpler Stop-only alternative. If the codebase wants Stop-only V1, this is the choice to revisit before architect decomposition.
- **The review did not prescribe what to build first.** Sprint sequencing, scope trade-offs, and priority decisions remain the architect's job during plan-gate.

**Recommended next step:** read the spec's framing sections (§1, §2, the new `## Deferred Items`, §19) one more time, confirm the `tasks/todo.md` D-W1-* entries match your current intent, and then invoke `architect` to decompose into implementation chunks.
