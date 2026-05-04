# Spec Conformance Log — workflows-v1-phase-2

**Spec:** `docs/workflows-dev-spec.md`
**Spec commit at check:** `e5db553e` (latest on branch)
**Branch:** `workflows-v1-phase-2`
**Base (merge-base with main):** `048eb812`
**Plan:** `tasks/builds/workflows-v1-phase-2/plan.md`
**Scope:** Pre-chunk P0–P6 + Chunks 9, 10, 11, 12, 13, 14a, 14b, 15, 16 (per plan §Spec coverage map continuation; Chunks 1–8 already covered by `tasks/review-logs/spec-conformance-log-workflows-v1-chunks-3-8-2026-05-03T20-29-16Z.md` and excluded from this run).
**Changed-code set:** 126 files (committed only — uncommitted change is a continuation pointer in `tasks/builds/workflows-v1/plan.md`, not a code change)
**Run at:** 2026-05-04T06:53:23Z

NOTE: TodoWrite tool not available in this session; per-subcomponent progression tracked inline in the verification flow rather than via the visible task UI.

---

## Contents

1. Summary + verdict
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## 1. Summary + verdict

| | Count |
|---|---|
| Requirements extracted | 79 |
| PASS | 67 |
| MECHANICAL_GAP → fixed | 1 |
| DIRECTIONAL_GAP → deferred | 11 |
| AMBIGUOUS → deferred | 0 |
| OUT_OF_SCOPE → skipped | 0 |

**Verdict:** NON_CONFORMANT (11 blocking gaps — see deferred items routed to `tasks/todo.md`).

The most consequential gaps cluster in **Chunk 9 event-emission integration**: `approval.queued`, `approval.decided`, `approval.pool_refreshed`, `step.approval_resolved`, `ask.queued`, `file.created`, and `task.degraded` are all defined in the discriminated union and validated by `taskEventValidator`, but never emitted from any service. Only `step.awaiting_approval`, `ask.submitted`, `ask.skipped`, and `file.edited` (revert-only) reach the WebSocket. Without server-side emission, the entire UI surface in Chunk 11 is reading an event stream that is structurally incomplete: the chat panel will not render Approval cards (`approval.queued`), the Plan tab will not transition steps from queued to current (`approval.queued`/`ask.queued`), and the projection's gap-detection self-heal (`task.degraded`) never fires. UI files build, type-check, and look complete in isolation, but the runtime feature only works for the ask-submission/skip path. This is the primary correctness gap for the phase.

The other directional items: pool snapshot normalisation contract (`normaliseApproverPoolSnapshot` exists but no service consumes it); fingerprint algorithm divergence (FNV-1a vs spec's SHA-256); workflow_runs direct-INSERT paths bypassing the SQLSTATE 23505 → 409 conversion (bulk fanout + replay); workflow_drafts route missing the spec-§3.3-mandated `subaccount_id = resolvedSubaccount.id` authorisation check (security-critical); depth fail-fast not enforced at every entry point named in plan REQ 15-7; depth metadata persisted to `_meta.workflowRunDepth` instead of spec-named `workflow_runs.metadata.workflow_run_depth`; and three integration tests named in Chunk 9 verification commands not authored.

The single MECHANICAL fix applied: two em-dashes in `client/src/pages/StudioPage.tsx` user-visible toast strings (line 90, line 158) replaced with commas to match CLAUDE.md user preference §"No em-dashes in any UI copy".

---

## 2. Requirements extracted (full checklist)

### Pre-chunk P0 — Verify A1 / A2 / A4

- REQ P0-1 → PASS — `superseded_by_gate_id` removed from `migrations/0276_*`, `server/db/schema/workflowStepGates.ts`, `shared/types/workflowStepGate.ts` (only worktrees + plan/KNOWLEDGE refs remain).
- REQ P0-2 → PASS — three CHECK constraints present in `migrations/0276_workflows_v1_additive_schema.sql:33` (`cost_accumulator_cents >= 0`), `:73` (`event_origin IN ('engine','gate','user','orchestrator')`), `:94` (`next_event_seq >= 0`). Drizzle mirrors at `server/db/schema/workflowRuns.ts:85`, `tasks.ts:88`, `agentExecutionEvents.ts:86`.
- REQ P0-3 → PASS — `server/services/workflowSeenPayloadService.ts` does not exist; `workflowSeenPayloadServicePure.ts` is the canonical entry point.

### Pre-chunk P1 — workflow_runs.task_id FK + renumber to 0276

- REQ P1-1 → PASS — `migrations/0276_workflows_v1_additive_schema.sql` exists; no `0270_workflows_v1_*` collision (0270 belongs to `compute_budget_rename`).
- REQ P1-2 → PASS — `migrations/0276_*:35-36` `ALTER TABLE workflow_runs ADD COLUMN task_id uuid NOT NULL REFERENCES tasks(id);`
- REQ P1-3 → PASS — `migrations/0276_*:38-39` `CREATE INDEX workflow_runs_task_id_idx`.
- REQ P1-4 → PASS — `migrations/0276_*:44-46` partial unique index with the spec terminal-status set.
- REQ P1-5 → PASS — `server/db/schema/workflowRuns.ts:76,116,117-118` mirror the column + both indexes.
- REQ P1-6 → PASS — `taskId: uuid('task_id').notNull()` produces non-nullable `taskId: string` on the inferred type.
- REQ P1-7 → PASS — `server/services/workflowRunService.ts:142` requires `taskId: string`; `:282-286` catches SQLSTATE `23505` for `workflow_runs_one_active_per_task_idx` and throws `TaskAlreadyHasActiveRunError`.
- REQ P1-8 → DIRECTIONAL_GAP — direct `insert(workflowRuns)` calls outside `WorkflowRunService.startRun`: `workflowEngineService.ts:2556` (bulk-child fanout) and `workflowEngineService.ts:2806` (replay). Both bypass the `23505 → TaskAlreadyHasActiveRunError → 409` conversion. Plan acceptance criterion P1-8 explicitly mandated zero matches outside the service.
- REQ P1-9 → PASS — `WORKFLOW_RUN_TERMINAL_STATUSES` exported at `shared/types/workflowRunStatus.ts:5`; predicate test at `server/db/schema/__tests__/workflowRunOneActivePerTaskPredicate.test.ts`.

### Pre-chunk P2 — task_requester resolver

- REQ P2-1 → PASS — `server/services/workflowApproverPoolService.ts:59-89` reads `tasks.created_by_user_id` joined via `workflow_runs.task_id`.
- REQ P2-2 → PASS — no V1/V2 fallback comment present.
- REQ P2-3 → PASS — `server/services/__tests__/workflowApproverPoolServicePure.test.ts:82-114` covers system-initiated case.

### Pre-chunk P3 — task-scoped pause/resume/stop routes

- REQ P3-1 → PASS — `server/routes/workflowRuns.ts:283` `/api/tasks/:taskId/run/pause`.
- REQ P3-2 → PASS — `:303` `/api/tasks/:taskId/run/resume`.
- REQ P3-3 → PASS — `:337` `/api/tasks/:taskId/run/stop`.
- REQ P3-4 → PASS — no run-scoped `POST.*workflow-runs.*pause|resume|stop` matches anywhere in `server/`.
- REQ P3-5 → PASS — `server/services/workflowRunResolverService.ts` exports `resolveActiveRunForTask(taskId, organisationId): Promise<string | null>`.
- REQ P3-6 → PASS — `server/routes/workflowRuns.ts:290,311,344` return `404 { error: 'no_active_run_for_task' }`.

### Pre-chunk P4 — workflowStepGateService consumes workflow_runs.task_id directly

- REQ P4-1 → PASS — `workflowStepGateService.ts:39-41,133,290` loads `WorkflowRun` once via `loadWorkflowRunContext(...)`, surfaces `run.taskId`. No `agent_execution_events` walk for `taskId`.
- REQ P4-2 → PASS — `workflowGateRefreshPoolService.ts:88` reads `run.taskId`.

### Pre-chunk P5 — Confidence cut-points decision

- REQ P5-1 → PASS — `tasks/builds/workflows-v1-phase-2/confidence-cut-points-decision.md` exists.
- REQ P5-2 → PASS — `workflowConfidenceServicePure.ts:31` carries architect-tuned date comment; no "placeholder" markers remain.

### Chunk 9 — WebSocket coordination

- REQ 9-1 → PASS — `shared/types/taskEvent.ts` discriminated union covers all §8.2 kinds (incl. `step.awaiting_approval`, `step.approval_resolved`, `approval.pool_refreshed`, `ask.skipped`, `run.resumed`, `run.stopped.by_user`, `task.degraded`). `TASK_EVENT_KINDS` allow-list mirrors.
- REQ 9-2 → PASS — `shared/types/taskEventValidator.ts:6-23` `validateTaskEvent`; `:25-29` `validateEventOrigin` rejects unknown origins.
- REQ 9-3 → PASS — `shared/types/approverPoolSnapshot.ts` defines `ApproverPoolSnapshot` brand, `normaliseApproverPoolSnapshot` (lowercase + dedup + UUID validate), `InvalidApproverPoolSnapshotError`.
- REQ 9-4 → PASS — `server/services/taskEventService.ts` exists; `appendAndEmitTaskEvent` consumed by `askFormSubmissionService`, `fileRevertHunkService`, `orchestratorFromTaskJob`, engine.
- REQ 9-5 → PASS — `server/websocket/taskRoom.ts` exists with join/leave handlers + permission validation.
- REQ 9-6 → PASS — `server/websocket/emitters.ts:210-216` `emitTaskEvent(taskId, envelope)` matches the spec envelope.
- REQ 9-7 → PASS — `client/src/hooks/useTaskEventStream.ts` exists with replay protocol.
- REQ 9-8 → PASS — `server/routes/taskEventStream.ts` exists; replay endpoint `/api/tasks/:taskId/event-stream/replay`.
- REQ 9-9 → DIRECTIONAL_GAP — `normaliseApproverPoolSnapshot` exported but no service consumes it. Plan acceptance: *"every snapshot write goes through `normaliseApproverPoolSnapshot`"*. Both write sites in `WorkflowApproverPoolService` and `WorkflowGateRefreshPoolService` write the raw resolver output to `workflow_step_gates.approver_pool_snapshot`. UUID-case false-negatives in `userInPool` checks are unguarded.
- REQ 9-10 → DIRECTIONAL_GAP — `WorkflowGateRefreshPoolService` does not emit `approval.pool_refreshed`. Plan acceptance: *"approval.pool_refreshed is emitted by WorkflowGateRefreshPoolService after a successful re-resolution"*.
- REQ 9-11 → DIRECTIONAL_GAP — `approval.queued` / `ask.queued` events are never emitted; `poolFingerprint` is never sent on the wire. Spec §8.2 + plan reduced-broadcast contract (`poolSize + poolFingerprint`) is unfulfilled because the upstream emit point does not exist. Sub-finding: `poolFingerprint` algorithm in `approverPoolSnapshot.ts:35-48` uses FNV-1a not SHA-256 (spec quote: *"sha256(sortedJoinedIds).slice(0, 16)"*).
- REQ 9-12 → DIRECTIONAL_GAP — `step.awaiting_approval` IS emitted at `workflowEngineService.ts:1620` and `workflowStepReviewService.ts:180`. **`step.approval_resolved` is never emitted.** Plan acceptance lists both kinds.
- REQ 9-13 → PASS — `shared/types/taskEvent.ts:53` `eventSchemaVersion: number` on the envelope; `migrations/0276_*:69` adds the column.
- REQ 9-14 → DIRECTIONAL_GAP — counters named in plan (`task_event_invalid_origin_total`, etc.) — only `console.log` event-stats counter present in `emitters.ts`. Cardinality-bounded prom-style counters not implemented.

### Chunk 10 — Permissions API + Teams CRUD UI

- REQ 10-1 → PASS — `server/services/assignableUsersService.ts` exports `resolvePool({ caller, organisationId, subaccountId, intent })`.
- REQ 10-2 → PASS — `server/routes/assignableUsers.ts` mounts `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users`.
- REQ 10-3 → PASS — `server/services/teamsService.ts` exists with CRUD + members.
- REQ 10-4 → PASS — `server/routes/teams.ts`; mounted in `server/index.ts:419`.
- REQ 10-5 → PASS — `client/src/pages/TeamsAdminPage.tsx`.
- REQ 10-6 → PASS — `client/src/components/UserPicker.tsx`.
- REQ 10-7 → PASS — `client/src/components/TeamPicker.tsx`.
- REQ 10-8 → PASS — `server/lib/permissions.ts:98` adds `TEAMS_MANAGE: 'org.teams.manage'`; permission group registered at `:208`.
- REQ 10-9 → PASS — `server/index.ts:417-419` mounts `assignableUsersRouter` + `teamsRouter`.
- REQ 10-10 → PASS — `assignableUsersService.ts:97` `email: isMember ? row.email : null` (default option 2 — redact cross-subaccount emails).
- REQ 10-11 → PASS — `shared/types/assignableUsers.ts:1-3` `type AssignableUsersIntent = 'pick_approver' | 'pick_submitter'` + `ASSIGNABLE_USERS_INTENTS` allow-list.

### Chunk 11 — Open task view UI

- REQ 11-1 through 11-13 → PASS — all 13 listed files exist under `client/src/pages/OpenTaskView.tsx` and `client/src/components/openTask/*` (ChatPane, ActivityPane, RightPaneTabs, NowTab, PlanTab, FilesTab, ThinkingBox, MilestoneCard, ApprovalCard, PauseCard, TaskHeader, openTaskViewPure.ts).
- REQ 11-14 → PASS — `client/src/hooks/useTaskProjection.ts` + `useTaskProjectionPure.ts`; tests at `client/src/hooks/__tests__/useTaskProjectionPure.test.ts`.
- REQ 11-15 → PASS — `client/src/App.tsx:424` `<Route path="/admin/tasks/:taskId" element={<OpenTaskView ... />} />`.
- REQ 11-16 → PASS — layout widths in `OpenTaskView.tsx` mockup-faithful per Tailwind classes.
- REQ 11-17 → PASS — Plan tab default initial state in `RightPaneTabs.tsx`.
- REQ 11-18 → PASS — `ActivityPane.tsx` newest-at-bottom + auto-scroll + N-pill.
- REQ 11-19 → PASS — `PauseCard.tsx` calls task-scoped routes from P3.
- REQ 11-20 → DIRECTIONAL — Approval card consumption of `poolFingerprint` is wired but the upstream emit (REQ 9-11) does not fire; surface dependency is unmet.
- REQ 11-21 → PASS — `PlanTab.tsx:4` `SHOW_CONFIDENCE_CHIP` env flag with `import.meta.env.VITE_SHOW_CONFIDENCE_CHIP`.
- REQ 11-22 → PASS — `useTaskProjection.ts:9-11,21-79` implements all five reconciliation cases (reconnect, 60s tick, 5th-tick full rebuild, time-based 20-min cap, `task.degraded` arrival).
- REQ 11-23 → PASS — `useTaskProjection.ts:29` resets to `INITIAL_TASK_PROJECTION` before replay.
- REQ 11-extra → DIRECTIONAL — server never emits `task.degraded` and never writes `workflow_runs.degradation_reason`; client self-heal trigger has no producer.

### Chunk 12 — Ask form runtime

- REQ 12-1 → PASS — `AskFormCard.tsx`.
- REQ 12-2 → PASS — `FormFieldRenderer.tsx`.
- REQ 12-3 → PASS — `askFormValidationPure.ts` + tests.
- REQ 12-4 → PASS — `server/services/askFormSubmissionService.ts`.
- REQ 12-5 → PASS — `askFormAutoFillService.ts`; tests at `__tests__/askFormAutoFillPure.test.ts`.
- REQ 12-6 → PASS — `server/routes/asks.ts:27` `/submit`, `:68` `/skip`, `:106` `/autofill`.
- REQ 12-7 → PASS — `asks.ts:50` (403), `:54` (409 already_submitted), `:58-60` (404 forwards `no_active_run_for_task` from `askFormSubmissionService.ts:54-56`).
- REQ 12-8 → PASS — skip endpoint at `asks.ts:67-103`.
- REQ 12-9 → PASS — `askFormAutoFillService.ts` enforces key+type match.
- REQ 12-10 → PASS — `askFormSubmissionService.ts:124` emits `ask.submitted` with `values`; output JSON shape matches spec §11.4 step 3.
- REQ 12-11 → DIRECTIONAL — sidebar badge for pending Asks alongside Approvals not directly verified at file level; spec §11.6 names this routing path.

### Chunk 13 — Files tab + diff renderer + per-hunk revert

- REQ 13-1 through 13-4 → PASS — `FilesTab.tsx`, `FileReader.tsx`, `DiffRenderer.tsx`, `filesTabPure.ts`.
- REQ 13-5 → PASS — `fileDiffService.ts` + `fileDiffServicePure.ts`; pure tests at `__tests__/fileDiffServicePure.test.ts`.
- REQ 13-6 → PASS — `fileRevertHunkService.ts:21,58` returns `{ reverted: false, reason: 'already_absent' }` for idempotent path; `:70-72` emits `file.edited`.
- REQ 13-7 → PASS — `server/routes/fileRevert.ts:132` mounts `/api/tasks/:taskId/files/:fileId/revert-hunk`.
- REQ 13-8 → PASS — `fileRevert.ts:175-176` 409 `base_version_changed` with `current_version`.
- REQ 13-9 → DIRECTIONAL_GAP — `file.edited` emitted from revert path. **`file.created` is never emitted from any service.** Plan §13: "File / version write path — emit `file.created` / `file.edited` events" — revert-only is partial.

### Chunk 14a — Studio canvas + bottom bar + publish

- REQ 14a-1 → PASS — `client/src/pages/StudioPage.tsx`; routes registered in `App.tsx:426-427`.
- REQ 14a-2 → PASS — `StudioCanvas.tsx`.
- REQ 14a-3 → PASS — `StudioBottomBar.tsx`.
- REQ 14a-4 → PASS — `PublishModal.tsx`.
- REQ 14a-5 → PASS — `studioCanvasPure.ts` + tests.
- REQ 14a-6 → PASS — `server/services/workflowPublishService.ts:22-23,58-59` accepts `publishNotes`, `expectedUpstreamUpdatedAt`.
- REQ 14a-7 → PASS — `workflowTemplateService.ts:377,452` accepts `publishNotes`, persists to `publish_notes` column.
- REQ 14a-8 → PASS — `server/routes/workflowStudio.ts` exposes the publish endpoint with concurrent-edit response shape (verified by service-layer wiring + workflowPublishService.test.ts existing).
- REQ 14a-9 → PASS — `App.tsx:426-427` registers both routes.

### Chunk 14b — Inspectors + Studio chat panel + draft hydration

- REQ 14b-1 through 14b-6 → PASS — `StudioInspector.tsx`, four inspector files under `inspectors/`, `StudioChatPanel.tsx`.
- REQ 14b-7 → PASS — `server/services/workflowDraftService.ts` exposes `create`, `findById`, `markConsumed`, `listUnconsumedOlderThan`. `draftSource` defaults to `'orchestrator'` per migration `:142`.
- REQ 14b-8 → PASS — `server/routes/workflowDrafts.ts:23` `GET`, `:63` `POST .../discard`.
- REQ 14b-9 → PASS — `workflowDrafts.ts:38-42, 79-80` 410 `draft_consumed` with `consumed_at`.
- REQ 14b-10 → PASS — `StudioPage.tsx` reads `?fromDraft=:draftId` query param on mount.
- REQ 14b-extra → DIRECTIONAL_GAP — `server/routes/workflowDrafts.ts` reads/discards drafts only by `(draftId, organisationId)`; **does not verify `subaccount_id = resolvedSubaccount.id`**. Spec §3.3 explicitly: *"every read endpoint MUST verify subaccount_id = resolvedSubaccount.id in the route handler — RLS only enforces org scope, so a same-org cross-subaccount read by ID would otherwise leak."* Security-critical authorisation contract miss.

### Chunk 15 — Orchestrator changes

- REQ 15-1 → PASS — `orchestratorCadenceDetectionPure.ts` + tests at `__tests__/orchestratorCadenceDetectionPure.test.ts`.
- REQ 15-2 → PASS — `orchestratorMilestoneEmitterPure.ts` + tests.
- REQ 15-3 → PASS — `workflowRunStartSkillService.ts` validates template + permission + version + creates task + starts run.
- REQ 15-4 → PASS — `orchestratorFromTaskJob.ts:286,292-299` extends with cadence detection + recommendation card emission via `appendAndEmitTaskEvent`.
- REQ 15-5 → PASS — `skillExecutor.ts:619-620` SKILL_HANDLERS entry for `workflow.run.start`.
- REQ 15-6 → PASS — `actionRegistry.ts:2632-2654` registers `workflow.run.start` with `idempotencyStrategy: 'keyed_write'`.
- REQ 15-7 → DIRECTIONAL_GAP — fail-fast `MissingWorkflowDepthError`/`InvalidWorkflowDepthError` enforced ONLY at `workflowRunStartSkillService.ts:28-29` (the skill boundary, where recursion happens — the most important point). Plan REQ 15-7 wider claim names every orchestrator entry point; other entry points (`orchestratorFromTaskJob`, scheduler, retry) only pass `workflowRunDepth: 1` without the explicit throw.
- REQ 15-8 → DIRECTIONAL_GAP — depth persisted to `workflow_runs.contextJson._meta.workflowRunDepth` (via `workflowRunService.ts:234`) NOT to spec-named `workflow_runs.metadata.workflow_run_depth`. Functionally similar but contract field name differs.
- REQ 15-9 → PASS — `shared/types/workflowRunStartSkill.ts` output union includes `max_workflow_depth_exceeded`; `workflowRunStartSkillService.ts:33` returns it.
- REQ 15-10 → PASS — `server/services/__tests__/workflowRunDepthEntryGuard.test.ts` exists with the four cases.

### Chunk 16 — Naming cleanup + cleanup job

- REQ 16-1 → PASS — `server/jobs/workflowDraftsCleanupJob.ts` performs the daily SQL delete.
- REQ 16-2 → PASS — `server/services/queueService.ts:729` worker, `:1106` cron schedule `'0 3 * * *'`.
- REQ 16-3 → PASS — `client/src/components/Layout.tsx:80,761` "Tasks" label in sidebar; `briefs → 'Tasks'` mapping.
- REQ 16-4 → PASS — `client/src/App.tsx:424` route registered; `:422` `BriefRedirect` for legacy.
- REQ 16-5 → PASS — `GlobalAskBar.tsx:63` navigates to `/admin/tasks/${data.briefId}`; user-facing strings audited.
- REQ 16-6 → PASS — `BriefLabel.ts:31` returns 'Task' fallback.
- REQ 16-7 → PASS — email templates updated where user-facing.
- REQ 16-8 → PASS — `App.tsx:254-258` `BriefRedirect` returns `<Navigate to="/admin/tasks/${briefId}" replace />` (client-side equivalent of 30x; spec accepts either per §15.4).
- REQ 16-9 → PASS — `architecture.md:3343-3350` adds Workflows V1 entries.
- REQ 16-10 → PASS — `docs/capabilities.md:339,341,342,343,947` updated with Workflow Studio + Workflow runs + cost/time ceiling + max nesting depth=3 entries.

### User-preferences gates

- REQ UP-1 → PASS — no emojis in any phase-2 UI file's user-facing strings.
- REQ UP-2 → MECHANICAL_GAP → FIXED — two em-dashes in `client/src/pages/StudioPage.tsx:90,158` toast strings replaced with commas. Other em-dashes in phase-2 files are in JSDoc comments (allowed by the rule).

---

## 3. Mechanical fixes applied

[FIXED] REQ UP-2 — em-dash in user-visible toast strings
  File: `client/src/pages/StudioPage.tsx`
  Lines: 90, 158
  Spec quote: CLAUDE.md §User Preferences: *"No em-dashes (—) in any UI copy, labels, or app-facing text."*
  Change: replaced `'... — ...'` with `'..., ...'` in both toast.info and toast.error messages.

Verified: `npm run lint` returned 0 errors (729 pre-existing warnings unchanged); `npm run typecheck` exited 0.

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

11 items appended to `tasks/todo.md` under section *"Deferred from spec-conformance review — workflows-v1-phase-2 (2026-05-04)"*. Cross-references back to this log via the source-log path.

1. **REQ P1-8** — direct `insert(workflowRuns)` in bulk-fanout + replay paths bypass the `23505 → TaskAlreadyHasActiveRunError` conversion.
2. **REQ 9-9** — `normaliseApproverPoolSnapshot` exported but no service consumes it; back-fill at all snapshot write sites missing.
3. **REQ 9-10** — `WorkflowGateRefreshPoolService` does not emit `approval.pool_refreshed`.
4. **REQ 9-11** — `approval.queued`, `ask.queued` are never emitted; `poolFingerprint` is on the wire spec but never sent. Sub-finding: fingerprint algorithm is FNV-1a not the spec-named SHA-256.
5. **REQ 9-12** — `step.approval_resolved` is never emitted from any path.
6. **REQ 9-14** — observability prom-style counters named in plan (`task_event_invalid_origin_total`, etc.) not implemented.
7. **REQ 11-extra** — server never emits `task.degraded` and never writes `workflow_runs.degradation_reason`; client self-heal trigger has no producer.
8. **REQ 12-11** — sidebar badge for pending Asks not directly verified.
9. **REQ 13-9** — `file.created` task event never emitted (only `file.edited` from revert path).
10. **REQ 14b-extra** — `workflowDrafts` route does not verify `subaccount_id = resolvedSubaccount.id`; spec §3.3 names this as security-critical.
11. **REQ 15-7 + 15-8** — depth fail-fast not enforced at every entry point named in plan; depth metadata persisted to `_meta.workflowRunDepth` not spec-named `workflow_runs.metadata.workflow_run_depth`.

(Three Chunk 9 integration tests named in verification commands — `taskEventStreamLoad.integration.test.ts`, `taskEventStreamReplay.integration.test.ts`, `taskEventStreamGap.integration.test.ts` — are absent. Per the playbook's "do not author tests unless the spec names specific cases with specific assertions" rule, these are NOT autofixed; they are folded into items 4 and 9 above as part of the broader Chunk 9 emission gap that those tests would cover.)

---

## 5. Files modified by this run

- `client/src/pages/StudioPage.tsx` — two toast-string em-dashes replaced with commas.
- `tasks/todo.md` — appended one new section (one item per directional finding).
- `tasks/review-logs/spec-conformance-log-workflows-v1-phase-2-2026-05-04T06-53-23Z.md` — this file.

(The scratch file `tasks/review-logs/spec-conformance-scratch-workflows-v1-phase-2-2026-05-04T06-53-23Z.md` is removed post-final-log per the playbook.)

---

## 6. Next step

**NON_CONFORMANT.** 11 directional gaps must be addressed by the main session before `pr-reviewer`. The most consequential cluster is Chunk 9 event-emission integration (items 3, 4, 5, 7, 9 above) — without them, Chunk 11's UI surface reads an event stream that is structurally incomplete for the approval/file/degraded flows. The security gap on workflow-drafts (item 10) and the pool-snapshot normalisation gap (item 2) should be addressed first because they are the lowest-risk structural fixes that unblock the next layer.

The two CONFORMANT_AFTER_FIXES mechanical-gap mods (em-dash removals in `StudioPage.tsx`) are NOT auto-committed — the user has explicitly NOT given green light to auto-commit/push for this run; fixes are uncommitted and the user will review before committing. After the user commits, re-run `pr-reviewer` on the expanded changed-code set since the StudioPage.tsx file has changed since the last review pass.

See `tasks/todo.md` under "Deferred from spec-conformance review — workflows-v1-phase-2 (2026-05-04)" for the full deferred items list.
