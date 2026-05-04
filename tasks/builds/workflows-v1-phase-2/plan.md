# Workflows V1 Phase 2 — Routing fix-up, Real-Time, UI, Studio, Orchestrator

_Build slug: `workflows-v1-phase-2`_
_Predecessor: [`tasks/builds/workflows-v1/plan.md`](../workflows-v1/plan.md) (Chunks 1–8 merged into main)_
_Spec: [`docs/workflows-dev-spec.md`](../../../docs/workflows-dev-spec.md) (continuation; Chunks 1–8 already covered)_
_Branch: TBD — see [Branch strategy](#branch-strategy) below_
_Classification: MAJOR — UI surfaces, real-time WebSocket coordination, Studio, orchestrator changes, naming cleanup_
_Effort estimate: ~23 engineer-days (pre-chunk ~1.5 days + Chunks 9–16 ~22 days)_

---

## Contents

1. [Background and scope](#background-and-scope)
2. [Branch strategy](#branch-strategy)
3. [Pre-chunk phase — adjustments to Chunks 1–8 work](#pre-chunk-phase--adjustments-to-chunks-18-work)
   - [P0 — Verify already-applied hardening (A1, A2, A4)](#p0--verify-already-applied-hardening-a1-a2-a4)
   - [P1 — Renumber + modify the workflows-v1 additive migration — add `workflow_runs.task_id` FK](#p1--renumber--modify-the-workflows-v1-additive-migration-in-place--add-workflow_runstask_id-fk)
   - [P2 — Update `workflowApproverPoolService` `task_requester` resolver](#p2--update-workflowapproverpoolservice-task_requester-resolver)
   - [P3 — Replace run-scoped pause/resume/stop routes with task-scoped variants](#p3--replace-run-scoped-pauseresumestop-routes-with-task-scoped-variants)
   - [P4 — Update `workflowStepGateService` to use `workflow_runs.task_id` directly](#p4--update-workflowstepgateservice-to-use-workflow_runstask_id-directly)
   - [P5 — Architect decision on W1-spec19 confidence cut-points](#p5--architect-decision-on-w1-spec19-confidence-cut-points)
   - [P6 — Static gates pass on the integrated pre-chunk state](#p6--static-gates-pass-on-the-integrated-pre-chunk-state)
4. [Chunk overview](#chunk-overview)
5. [Per-chunk detail](#per-chunk-detail)
   - [Chunk 9 — Real-time WebSocket coordination](#chunk-9--real-time-websocket-coordination)
   - [Chunk 10 — Permissions API (assignable users) + Teams CRUD UI](#chunk-10--permissions-api--teams-crud-ui)
   - [Chunk 11 — Open task view UI](#chunk-11--open-task-view-ui)
   - [Chunk 12 — Ask form runtime](#chunk-12--ask-form-runtime)
   - [Chunk 13 — Files tab + diff renderer + per-hunk revert](#chunk-13--files-tab--diff-renderer--per-hunk-revert)
   - [Chunk 14a — Studio canvas + bottom bar + publish](#chunk-14a--studio-canvas--bottom-bar--publish)
   - [Chunk 14b — Inspectors + Studio chat panel + draft hydration](#chunk-14b--inspectors--studio-chat-panel--draft-hydration)
   - [Chunk 15 — Orchestrator changes](#chunk-15--orchestrator-changes)
   - [Chunk 16 — Naming cleanup + cleanup job](#chunk-16--naming-cleanup--cleanup-job)
6. [Risks and mitigations](#risks-and-mitigations)
7. [Spec coverage map (continuation)](#spec-coverage-map-continuation)

---

## Background and scope

This plan is the continuation of the Workflows V1 build started in [`tasks/builds/workflows-v1/plan.md`](../workflows-v1/plan.md). Chunks 1–8 of that plan have been merged into `main`:

| # | Chunk | Status | Source commit(s) |
|---|---|---|---|
| 1 | Schema migration + RLS + pre-existing violation fix | merged | migration `0270_workflows_v1_additive_schema.sql` |
| 2 | Engine validator (four A's, branching, loops, nesting, isCritical) | merged | — |
| 3 | Per-task event log (sequence allocation + replay contract) | merged | `b71dfb16` |
| 4 | Gate primitive (`workflow_step_gates` write path) + state machine | merged | `b71dfb16` |
| 5 | Approval routing, pool resolution, isCritical synthesis, decision API hardening | merged | `b71dfb16` |
| 6 | Confidence chip + audit field write paths | merged | `b71dfb16` |
| 7 | Cost / wall-clock runaway protection (pause/resume/stop) | merged with route-shape divergence (see P3) | `b71dfb16` |
| 8 | Stall-and-notify (24h / 72h / 7d) + schedule version pinning | merged | `b71dfb16` + `04fafa27` |

**Review pipeline outcome on Chunks 3–8** (logged for traceability):

- `spec-conformance` → NON_CONFORMANT (2 directional gaps: REQ 6.4 inlined-vs-wrapped seenPayload service; REQ 7.9 route shape divergence). Log: `tasks/review-logs/spec-conformance-log-workflows-v1-chunks-3-8-2026-05-03T20-29-16Z.md`.
- `pr-reviewer` → CHANGES_REQUESTED (1 blocking + 5 strong + 4 non-blocking; B1 + S1–S5 fixed in-branch via `9e25dc26`; non-blocking deferred). Log: `tasks/review-logs/pr-review-log-workflows-v1-chunks-3-8-2026-05-03T20-55-00Z.md`.
- `dual-reviewer` → SKIPPED (Codex CLI unavailable). Log: `tasks/review-logs/dual-review-skipped-workflows-v1-chunks-3-8-2026-05-03T21-00-00Z.md`.
- `chatgpt-pr-review` hardening pass → applied in `acac4ef8` (drop unused `superseded_by_gate_id`; add three CHECK constraints).
- Late surgical fix → `edb8145f` (scope tasks UPDATE by `organisationId` in event service).

**What this plan covers:**

1. **Pre-chunk phase (P0–P6)** — surgical adjustments to Chunks 1–8 work. The workflows-v1 additive migration is renamed `0270 → 0276` (post-`agentic-commerce` merge — see [Reconciliation with main](#reconciliation-with-main-after-agentic-commerce-pr-255-merge-round-4--post-merge-audit) and P1) AND modified in-place (no new migration; the user has not applied this migration to any environment yet, so the file is still effectively a draft on the local branch). Two small code refactors close the spec-conformance directional gaps. One architect-led decision unblocks the confidence chip surface that lands in Chunk 11.
2. **Chunks 9–16** — the remaining work from the original plan, with the A8 / A9 amendments from the post-Chunk-3-8 review cycle folded inline. New Chunk numbering is unchanged from the original plan (no Chunk 8.5 — its work is folded into pre-chunk P1–P4).

**What this plan does NOT cover:**

- Re-execution of Chunks 1–8. Those are merged; they are referenced for context only.
- Spec amendments. The spec stands as-is. The pre-chunk phase aligns implementation with the existing spec; it does not change the spec.
- New features beyond the original Workflows V1 spec. V2 items (audit drawer, restricted-view, mid-step interruption, file-upload Ask field, conditional fields, side-by-side diff, etc.) remain deferred per the original plan's deferred-items section.

**Authoritative references** for context this plan does not duplicate:

- System invariants, model-collapse check, primitives-reuse search, pre-existing violations, plan-gate decisions, architecture notes — see [predecessor plan](../workflows-v1/plan.md). All still binding on Chunks 9–16.
- Spec sections owned per chunk — this plan's [Spec coverage map (continuation)](#spec-coverage-map-continuation) covers only Chunks 9–16 plus the pre-chunk amendments. For Chunks 1–8 spec mapping, see the predecessor plan.

**Reconciliation with `main` after `agentic-commerce` PR #255 merge (round-4 — post-merge audit):**

The `agentic-commerce` build (Stripe SPT-backed agent spending) merged into `main` in commit `faa0166f` between this plan's first authoring round and the start of build. It introduced a parallel approval system, 5 new migrations (0270 rename + 0271–0275), the `compute_*` rename of the LLM cost-budget tables, a new `SPEND_APPROVER` permission, and a `reviewKind` discriminator inside `workflowEngineService`'s pending-approval branch. The build pulled main into the workflows-v1 branch and audited every interaction surface; conclusions:

- **Migration numbering collision** → resolved in P1 by renaming the workflows-v1 additive migration to `0276` (see P1 below). No SQL changes; the file just slots after the agentic-commerce migrations.
- **Cost-tracking** → no impact on the workflows-v1 cost-cap path. The agentic-commerce rename (`budget_reservations` → `compute_reservations`, `org_budgets` → `org_compute_budgets`) does not affect Workflows V1, because Chunk 7's design uses a denormalised `workflow_runs.cost_accumulator_cents` column (Decision 12 in the predecessor plan), not the renamed ledger tables. `WorkflowRunCostLedgerService.incrementAccumulator` is the chokepoint and reads/writes the column directly. Spec §7.4's "cost-reservation ledger" language is now slightly stale but does not block this build.
- **Approval-channels primitive** (`org_approval_channels` + `subaccount_approval_channels` + `org_subaccount_channel_grants` + `approvalChannelService` + `InAppApprovalChannel`) → **NO reuse in V1.** The agentic-commerce primitive is per-charge (`chargeId`-keyed, `SpendApprovalPayload` shape). Workflows V1 approval gates are per-step (`gateId`-keyed, gate-snapshot shape). Reusing would require generalisation of the channel adapter contract — V2 work. V1 ships workflow approvals via the existing `workflow_step_gates` + chat-panel render path planned in Chunk 11.
- **Engine `reviewKind` discriminator** → folded into Chunk 9. The agentic-commerce build added `SPEND_ACTION_ALLOWED_SLUGS`-based branching at [server/services/workflowEngineService.ts:1588](../../../server/services/workflowEngineService.ts#L1588) such that the `Workflow:step:awaiting_approval` event now carries `reviewKind: 'spend_approval' | 'action_call_approval'`. This is the existing per-run event log, NOT the new task event stream. Chunk 9 adds a **new task-event kind `step.awaiting_approval`** that mirrors the workflow-engine emit point so the open task view can surface "step is awaiting an approval (spend or action_call)" in real time. See Chunk 9 below.
- **`SPEND_APPROVER` permission** → distinct from any workflows V1 permission key. `SPEND_APPROVER` (`'spend_approver'`) is auto-granted to org/subaccount admins on SpendingBudget creation. Chunk 10's planned `TEAMS_MANAGE` key is independent. No conflicts.
- **"Waiting on you" UI surface** → workflows V1 ships its own card mix on this page (Approvals from `workflow_step_gates` + Asks from Chunk 12). Spend approvals from agentic-commerce surface separately in their own UI. Cross-surface unification (single page lists all human-pending items across both systems) is **deferred to V2** — captured in `tasks/todo.md` as a polish item ("V2: unify Waiting-on-you across workflow approvals + spend approvals + Asks").

This subsection is the durable record of the post-merge audit. If a later session asks "what changed when agentic-commerce merged in?" → start here.

**Authoritative model — what owns what (round-3 clarification):**

V1 is a hybrid event-sourced + state-driven system, not pure event-sourcing. The boundary is:

- **State tables are the source of truth for state.** `workflow_runs` (status, cost accumulator, depth, degradation reason), `workflow_step_gates` (open/resolved + reason), `tasks` (next_event_seq, requester), `files` / `file_versions`. Reads that drive control flow (engine dispatch, gate state-machine transitions, RLS, FK invariants, CHECK constraints) consult these tables directly. State-table writes are transactional and authoritative; events are emitted from inside the same transaction or immediately after.
- **`agent_execution_events` is the source of truth for the audit / replay history.** Every meaningful state change writes an event in addition to the state-table write. The event log is append-only, ordered by `(task_sequence, event_subsequence)`, retained 7d hot.
- **The `useTaskProjection` reducer (Chunk 11) is a derived read-model for the UI.** It is rebuildable from `agent_execution_events + state-table snapshot`. On any disagreement between projection and state tables, **state tables win** — the projection rebuilds (full snapshot fetch + reducer replay).

This boundary is intentional, not transitional. We are not migrating to pure event-sourcing in V2. Adding a new piece of state? Default to a state-table column (with FK / RLS / CHECK) plus an event for audit. Don't put state ONLY in events — replay is too slow for hot reads.

**Server-side guardrail (round-4 addition):** No write-path server logic may read from `useTaskProjection`. The projection is a client-side read-model; it does not exist on the server. Server write paths (engine dispatch, gate transitions, route handlers, job workers) must derive state from the state tables directly. Reading from the projection on the write path would mean a server module importing a client hook — a hard module-boundary violation that TypeScript would catch, but naming the invariant explicitly prevents architecturally equivalent server-side projections being introduced as "helpers". Grep-based acceptance criterion: `grep -rn "useTaskProjection" server/ | grep -vE "\.test\."` must return zero matches at chunk-time for Chunk 11 and every subsequent chunk. If any match appears, treat it as a spec violation, not a lint warning.

---

---

## Branch strategy

The current branch `claude/workflows-brainstorm-LSdMm` carries Chunks 3–8 plus the workflows-v1 review-pipeline fixes. Two branching options for this plan, operator picks at kickoff:

**Option A — Continue on the current branch.** Pre-chunk phase + Chunks 9–16 land as additional commits on `claude/workflows-brainstorm-LSdMm`. The PR for this branch grows; merge happens once everything is shipped (or in two passes — a pre-chunk merge, then a Chunks-9–16 merge).

**Option B — Branch off `main` per chunk group.** Pre-chunk phase lands on its own branch (e.g. `workflows-v1-phase-2-prechunk`), reviewed and merged independently. Then Chunks 9–16 land on a fresh branch (e.g. `workflows-v1-phase-2-chunks-9-16`) cut from the post-prechunk `main`.

**Recommendation: Option B.** The pre-chunk phase touches already-shipped code paths (the workflows-v1 additive migration — renamed in P1 from `0270_workflows_v1_additive_schema.sql` to `0276_*`; `workflowApproverPoolService`; `workflowRuns.ts` routes); a tight independent review pass on those changes is lower risk than bundling them into a 22-day UI-heavy PR. The pre-chunk PR is small (~1.5 days of work) and reviewable in a single pass; Chunks 9–16 follow standard `feature-coordinator` chunk-by-chunk discipline.

If Option B is chosen, the pre-chunk PR is ALSO an opportunity to merge any pending workflows-v1 review-pipeline fixes from `claude/workflows-brainstorm-LSdMm` into `main` first, so this plan starts from a clean baseline.

---

---

## Pre-chunk phase — adjustments to Chunks 1–8 work

Six items, ordered by dependency. P0 is verification only (no code change). P1 renames the workflows-v1 additive migration `0270 → 0276` AND modifies it in-place (post-`agentic-commerce` reconciliation). P2 / P3 / P4 are code refactors that depend on P1's schema delta. P5 is an architect-led decision that runs in parallel with P1–P4 (it has no code dependency on them; it gates Chunk 11). P6 is the integrated static-gates pass at the end.

**Why a pre-chunk phase rather than a Chunk 8.5:** the original plan-amendment changelog (see [predecessor plan](../workflows-v1/plan.md) "Plan-amendment changelog" section) introduced a Chunk 8.5 for `workflow_runs.task_id` FK + route migration. Splitting at Chunk 9 makes Chunk 8.5 redundant — the FK addition is a single ALTER inside the still-unrun migration 0270 (no new migration needed), and the route migration becomes a clean replace rather than an alias-then-cleanup. Net effort drops from ~1 day (Chunk 8.5 with migration + alias + cleanup) to ~0.5 day plus three small refactors.

**Effort summary:**

| # | Item | Type | Effort | Parallel? |
|---|---|---|---|---|
| P0 | Verify already-applied hardening | verification only | ~15 min | — |
| P1 | Rename `0270 → 0276` workflows-v1 additive migration + add `workflow_runs.task_id` FK | schema | ~2 hours | — |
| P2 | Update `workflowApproverPoolService.task_requester` | service refactor | ~1 hour | after P1 |
| P3 | Replace pause/resume/stop routes with task-scoped variants | route + service | ~3 hours | after P1 |
| P4 | Update `workflowStepGateService` to read `workflow_runs.task_id` directly | service optimisation | ~1 hour | after P1 |
| P5 | Architect decision on confidence cut-points | architect pass | ~half day | parallel with P1–P4 |
| P6 | Integrated static-gates pass (lint / typecheck / build:server) | gates | ~30 min | after P1–P4 |

Total: ~1.5 engineer-days (P1–P4 + P6) plus ~half day of parallel architect work (P5). Pre-chunk PR ships when P0–P4 + P6 pass; P5 ships separately if needed (it's a doc + cut-point-map change).

### P0 — Verify already-applied hardening (A1, A2, A4)

Three of the post-Chunk-3-8 amendments (A1, A2, A4 from the predecessor plan's changelog) were applied to code via the `chatgpt-pr-review` hardening pass commit `acac4ef8` and the inlined-design choice in Chunk 6. P0 is the verification step that confirms each is actually present, before the rest of the pre-chunk phase assumes them.

**Checks (~15 min, no code change):**

Each grep below uses a glob pattern (`migrations/*workflows_v1_additive_schema.sql`) so it survives the P1 rename without edit — the file is at `0270_workflows_v1_additive_schema.sql` before P1 and `0276_workflows_v1_additive_schema.sql` after, but the suffix is stable.

1. **A1 — `superseded_by_gate_id` removed.** Grep: `grep -n "superseded_by_gate_id\|supersededByGateId" migrations/*workflows_v1_additive_schema.sql server/db/schema/workflowStepGates.ts shared/types/workflowStepGate.ts`. Expected: zero matches. If any match, delete the column and its references; the unique-resolution invariant in `workflow_step_gates_run_step_uniq_idx` is the lifecycle source of truth.
2. **A2 — Three CHECK constraints present.** Grep: `grep -n "CHECK\|check(" migrations/*workflows_v1_additive_schema.sql server/db/schema/workflowRuns.ts server/db/schema/tasks.ts server/db/schema/agentExecutionEvents.ts`. Expected: `cost_accumulator_cents >= 0` (workflowRuns), `next_event_seq >= 0` (tasks), `event_origin IS NULL OR event_origin IN ('engine','gate','user','orchestrator')` (agentExecutionEvents). If any missing, add them in both the migration and the Drizzle schema.
3. **A4 — `workflowSeenPayloadService.ts` impure wrapper does NOT exist.** Check: `ls server/services/workflowSeenPayloadService.ts 2>&1` should return "No such file or directory". The pure builder (`workflowSeenPayloadServicePure.ts`) exists and is consumed via `workflowStepGateServicePure.buildGateSnapshot`. If the impure wrapper exists, delete it and route any callers through the pure module.

**Acceptance:** all three checks pass. No code change emitted from P0; if a check fails, the fix is mechanical and lands as a separate commit before P1 starts.

**Out of scope for P0:** refactoring the existing pure / impure boundaries beyond what the three checks name. P0 is strictly verification.

### P1 — Renumber + modify the workflows-v1 additive migration in-place — add `workflow_runs.task_id` FK

**Why this lands in pre-chunk, not Chunk 9.** The spec consistently uses `/api/tasks/:taskId/...` route patterns (§7, §11, §12) and explicitly references `workflow_runs WHERE task_id = :taskId` at [docs/workflows-dev-spec.md:1406](../../../docs/workflows-dev-spec.md#L1406). Chunk 1 only added `agent_execution_events.task_id` — not `workflow_runs.task_id`. Without this FK, every downstream UI / API chunk (9, 11, 12, 13, 15) invents its own `taskId → runId` translation, and Chunk 5's `task_requester` resolver can't be cleaned up. Adding the column to the workflows-v1 migration (which has not yet been applied to any environment) is cheaper and safer than a follow-on migration with backfill complexity.

**Renumbering required (post-merge of `agentic-commerce` PR #255).** When this plan was first written, the workflows-v1 migration filename was `migrations/0270_workflows_v1_additive_schema.sql`. The `agentic-commerce` build (merged into `main` in commit `faa0166f`) shipped its own `migrations/0270_compute_budget_rename.sql` plus `0271`–`0275`. The runner (`scripts/migrate.ts`) sorts files by `String.localeCompare` on filename — both `0270_*` files would coexist (compute_budget_rename runs first because `c` < `w`), but the numbering convention is broken. Pre-chunk renames the workflows-v1 migration to `migrations/0276_workflows_v1_additive_schema.sql` so it slots in cleanly after the agentic-commerce migrations. **Critically: this is still safe as an in-place rename rather than a new migration**, because the workflows-v1 migration has not been applied to any environment yet (verified at plan-authoring time). The 0270 → 0276 rename is invisible at runtime.

**Why a single in-place edit is safe:** the user has not run the workflows-v1 migration against any environment yet — verified at plan-authoring time. The file is effectively a draft on the local branch. Renaming it (0270 → 0276) AND modifying its contents (adding the FK + partial unique index) produces the same end-state as a separate follow-up migration, with one fewer migration file in the history and zero backfill complexity (no rows exist).

**Files to rename + modify:**

- `migrations/0270_workflows_v1_additive_schema.sql` → **rename to** `migrations/0276_workflows_v1_additive_schema.sql`. Then add the column + index in the `workflow_runs` ALTER block.
- `server/db/schema/workflowRuns.ts` — add `taskId: uuid('task_id').notNull().references(() => tasks.id)` plus the index entry.
- `shared/types/` (or wherever `WorkflowRun` TS type is exported) — add `taskId: string` to the type. (Drizzle infers this; explicit type pin only needed if a `WorkflowRun` interface lives elsewhere.)
- `server/services/workflowRunService.startRun` (or whatever the run-creation path is named) — accept a `taskId: string` parameter and pass it into the INSERT. Existing callers (orchestrator, scheduler, manual run-start route) already create a task before starting a run; this just plumbs the id through.

**Migration delta to add inside the existing `-- ── workflow_runs ──` block of the renamed file (`migrations/0276_workflows_v1_additive_schema.sql` after the rename in this same chunk):**

```sql
ALTER TABLE workflow_runs
  ADD COLUMN task_id uuid NOT NULL REFERENCES tasks(id);

CREATE INDEX workflow_runs_task_id_idx
  ON workflow_runs (task_id);

-- One active run per task — DB-level invariant. Replaces the application-layer
-- "pick most recent active run" + 409 anomaly branch that earlier drafts of P3
-- relied on. The terminal-status set matches the actual `WorkflowRunStatus`
-- enum in `server/db/schema/workflowRuns.ts`: terminal = completed |
-- completed_with_errors | failed | cancelled | partial. `cancelling` is NOT
-- terminal — cleanup is in flight and the task slot must remain reserved
-- until the run lands in `cancelled`, otherwise a new run could race the
-- cleanup state.
CREATE UNIQUE INDEX workflow_runs_one_active_per_task_idx
  ON workflow_runs (task_id)
  WHERE status NOT IN ('completed', 'completed_with_errors', 'failed', 'cancelled', 'partial');
```

The column is `NOT NULL` from the start because (a) no rows exist yet, and (b) every code path that creates a workflow_run already creates the parent task in the same logical operation. P3 enforces "no run without a task" at the service layer in the same pre-chunk commit.

**Drizzle schema delta in `server/db/schema/workflowRuns.ts`:**

```typescript
// Inside the table definition:
taskId: uuid('task_id').notNull().references(() => tasks.id),

// Inside the indexes definition:
taskIdIdx: index('workflow_runs_task_id_idx').on(table.taskId),
oneActivePerTaskIdx: uniqueIndex('workflow_runs_one_active_per_task_idx')
  .on(table.taskId)
  .where(sql`${table.status} NOT IN ('completed', 'completed_with_errors', 'failed', 'cancelled', 'partial')`),
```

**Why DB-enforced rather than application-checked.** The earlier P3 draft used `ORDER BY created_at DESC LIMIT 1` plus a 409 anomaly path keyed on `multiple_active_runs` and a metric counter. That made "one active run per task" a soft guarantee and required every consumer (Chunks 9–15) to handle the anomaly shape. Lifting it to a partial unique index makes the invariant DB-enforced: a duplicate-active-run insert fails with a constraint violation at write-time; the resolver reduces to a single-row lookup with no anomaly path. Run-creation paths catch the constraint violation and surface a structured `task_already_has_active_run` error to the caller.

**Decision: NOT NULL from the start vs. nullable-then-backfill.**

NOT NULL chosen because:
- No production data exists for this column anywhere — verified.
- Every code path that creates a workflow_run goes through `WorkflowRunService.startRun` (or equivalent); P3 wires `taskId` in at every call site.
- A nullable column adds runtime ambiguity ("can this be NULL?") for every consumer in Chunks 9–16. NOT NULL eliminates the ambiguity at the type level.

If the assumption "no rows exist" is wrong (e.g., a developer ran the workflows-v1 additive migration — at its old `0270_workflows_v1_additive_schema.sql` filename — against a local DB with hand-crafted seed data), the migration will fail at the `ALTER TABLE … ADD COLUMN … NOT NULL` step with `column "task_id" contains null values`. Fix in dev: drop the affected `workflow_runs` rows AND remove the stale row from `schema_migrations` (since the file is being renamed); the renamed `0276_*` file will then re-apply cleanly. The migration should NOT be edited to accept the null state — that breaks every downstream consumer's typing.

**Test considerations:**

- Targeted unit test: `server/db/schema/__tests__/workflowsV1Schema.test.ts` (or equivalent) — add an assertion that `workflow_runs.taskId` is present on the inferred type and is non-nullable.
- Manual: `npm run db:generate` and inspect the regenerated artefacts — confirm the FK appears in the generated SQL block.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify regenerated artefacts match the manual edit.
- `npm run build:server`

**Acceptance criteria:**

- The workflows-v1 additive migration is renamed from `migrations/0270_workflows_v1_additive_schema.sql` to `migrations/0276_workflows_v1_additive_schema.sql` (slot after agentic-commerce's 0271–0275). `git mv` preferred so history follows.
- The renamed migration contains the new `task_id` column + plain-task-id index + partial unique index inside the `workflow_runs` block.
- Drizzle schema mirrors the migration; `db:generate` produces no diff against the manual edit.
- `WorkflowRun` TS type exposes `taskId: string` (non-nullable); every consumer typechecks.
- `WorkflowRunService.startRun` (and any sibling create paths) require `taskId` at the function signature — typecheck-enforced.
- **Direct-INSERT audit** — `grep -rn "insert.*workflow_runs\|INSERT INTO workflow_runs" server/` returns zero matches OUTSIDE `WorkflowRunService.startRun`. Every direct INSERT path (orchestrator job, scheduler, manual run-start route, any other async caller) routes through the service so the SQLSTATE `23505` → `TaskAlreadyHasActiveRunError` conversion fires uniformly. Lift this from the Risks table into a P1 acceptance criterion so the audit happens at chunk-time, not as an afterthought.
- **Terminal-status invariant test** — new unit test `workflowRunOneActivePerTaskPredicate.test.ts` asserts that the partial-unique-index predicate (`status NOT IN (...)`) covers exactly the same set as the canonical terminal-status helper. Concrete shape: extract a `WORKFLOW_RUN_TERMINAL_STATUSES: ReadonlySet<WorkflowRunStatus>` constant in `shared/types/workflowRunStatus.ts` (derived from / aligned with the `WorkflowRunStatus` discriminated union); the partial index predicate is generated from this constant in the Drizzle schema (interpolated into the `sql` template); the unit test asserts `WORKFLOW_RUN_TERMINAL_STATUSES === new Set(['completed', 'completed_with_errors', 'failed', 'cancelled', 'partial'])`. If a future change adds a new status (e.g., `archived`), this test fails until the constant + index are updated together. Without this, the index predicate and the resolver predicate can silently desync from the enum.
- Confirm at chunk-time (`ls migrations/ | grep -E "^027[0-9]"`): `0270_compute_budget_rename.sql`, `0271_…`, `0272_…`, `0273_…`, `0274_…`, `0275_…`, `0276_workflows_v1_additive_schema.sql`. No two files share the `0270_` prefix.

**Out of scope for P1:** the actual route migration (P3) and the `task_requester` resolver rebind (P2). P1 is strictly schema + type plumbing.

### P2 — Update `workflowApproverPoolService` `task_requester` resolver

**Source:** spec-conformance review and the predecessor plan's A3 amendment. Chunk 5 shipped a V1 fallback that reads `workflowRuns.startedByUserId` because `tasks.workflow_run_id` (or `workflow_runs.task_id`) didn't exist. P1 lands the FK; P2 cleans up the fallback.

**Spec semantics:** the `task_requester` group is "the user who created the task" — distinct from "the user who started the run" for system-initiated runs (scheduler-fired, orchestrator-spawned). Until P2 lands, those system-initiated runs route Approval gates to the wrong user (the system principal that started the run, not the human task requester).

**Files to modify:**

- `server/services/workflowApproverPoolService.ts` — `task_requester` branch of `resolvePool`:
  - Replace the V1 fallback (read `workflowRuns.startedByUserId`) with: `SELECT created_by_user_id FROM tasks WHERE id = (SELECT task_id FROM workflow_runs WHERE id = $runId)`. The query runs inside the existing `withOrgTx` transaction.
  - Remove the inline `// V1 → V2: rebind to tasks.created_by_user_id once workflow_runs.task_id FK lands` comment introduced in Chunk 5.
- `server/services/__tests__/workflowApproverPoolServicePure.test.ts` — extend the existing test file with a `task_requester` resolution case where `tasks.created_by_user_id !== workflow_runs.started_by_user_id` (the system-initiated case). Assert the resolver returns `[tasks.created_by_user_id]`. The pure version of this test mocks the lookup; the impure / integration variant uses real fixtures.

**Optional integration test (recommended, not strictly required):** `server/services/__tests__/workflowApproverPoolTaskRequester.integration.test.ts` — boot a clean DB, insert a task with `created_by_user_id = 'user-A'`, insert a workflow_run with `task_id = task.id` and `started_by_user_id = 'system-principal-id'`, resolve the pool, assert `['user-A']`.

**Error handling:**

- `task_id` resolution miss (run row missing or task row missing): rare but possible if the run row was deleted out from under us. Throw `WorkflowApproverPoolResolutionError` with structured payload `{ runId, taskId, reason: 'task_not_found' }`. The caller (gate-open path) treats this as a hard failure — the gate can't open because the approver group can't be resolved. Logged via `workflowLog.error`.

**Test considerations (per CLAUDE.md test posture):** unit test for the pure case lands; integration test is optional. Targeted execution via `npx tsx server/services/__tests__/workflowApproverPoolServicePure.test.ts`.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowApproverPoolServicePure.test.ts`

**Acceptance criteria:**

- `task_requester` resolver reads `tasks.created_by_user_id` (joined via `workflow_runs.task_id`); the V1 fallback is removed.
- Inline V1/V2 comment is removed.
- New unit test asserts the system-initiated-run case (requester ≠ started-by) routes to the correct user.

**Dependencies:** P1 (the FK).

### P3 — Replace run-scoped pause/resume/stop routes with task-scoped variants

**Source:** spec-conformance review REQ 7.9 (directional gap). Spec §7 mandates `POST /api/tasks/:taskId/run/{pause,resume,stop}`; implementation shipped at `POST /api/workflow-runs/:runId/{pause,resume,stop}`. Now that P1 lands the FK, the route migration is straightforward.

**Why a clean replace, not aliases:** the original Chunk 8.5 design called for keeping run-scoped routes alive as aliases through the migration window because Chunk 11 (UI consumer) was in flight. In this phase-2 plan, Chunk 11 hasn't been built yet — there are no consumers of the run-scoped routes. Clean replace; no aliases; no Chunk 16 cleanup item.

**Files to modify:**

- `server/routes/workflowRuns.ts` — three route changes:
  - `POST /api/workflow-runs/:runId/pause` → `POST /api/tasks/:taskId/run/pause` (body `{}`).
  - `POST /api/workflow-runs/:runId/resume` → `POST /api/tasks/:taskId/run/resume` (body `{ extendCostCents?, extendSeconds? }`).
  - `POST /api/workflow-runs/:runId/stop` → `POST /api/tasks/:taskId/run/stop` (body `{}`).
  - Each handler resolves `:taskId → :runId` via the partial unique index from P1 (one active row max — index is the DB-level guarantee):
    ```sql
    SELECT id FROM workflow_runs
    WHERE task_id = :taskId
      AND status NOT IN ('completed', 'completed_with_errors', 'failed', 'cancelled', 'partial')
    ```
  - If no row: `404 { error: 'no_active_run_for_task' }`.
  - The "multiple active runs" branch from earlier drafts is removed: P1's `workflow_runs_one_active_per_task_idx` makes that state structurally impossible. The earlier `workflow_run_task_id_anomaly_total` metric is replaced by a simpler `workflow_run_create_blocked_by_active_total` counter incremented when a run-creation INSERT hits the constraint violation (caught by `WorkflowRunService.startRun`).
  - Body / response shapes are identical to the run-scoped versions — only the path moves.
- `server/services/workflowRunService.ts` — pass-through methods stay; only the route layer changes. (Service methods still take `runId`; the route does the `taskId → runId` translation.)
- Permission guard stays as-is (caller in §14.5 visibility set), but is now evaluated against the resolved run, not the URL `runId` parameter.

**Files to delete:** none. The route file shrinks; no file removed.

**Decision: should a single helper extract the `:taskId → :runId` resolution?** Yes — the same lookup will appear in Chunks 12 (Ask submit/skip) and 13 (file revert). Extract `resolveActiveRunForTask(taskId, organisationId): Promise<string | null>` into `server/services/workflowRunResolverService.ts` (or fold into `WorkflowRunService` as a static method). The function returns the `runId` if found, `null` otherwise; the route layer maps `null` to 404 `no_active_run_for_task`. No `MultipleActiveRunsError` exists — P1's partial unique index makes it impossible.

**Run-creation constraint-violation handling (new in this revision):** `WorkflowRunService.startRun` wraps its INSERT in a try/catch; on PostgreSQL `unique_violation` (SQLSTATE `23505`) for `workflow_runs_one_active_per_task_idx`, it converts to a structured `TaskAlreadyHasActiveRunError` and returns 409 to the caller (orchestrator job, scheduler, manual run-start route). The metric counter `workflow_run_create_blocked_by_active_total{organisation_id, template_id}` increments. Callers that legitimately need to start a new run (e.g., scheduler firing on a task whose previous run is still draining cleanup) are expected to wait or surface the conflict to the operator — they MUST NOT delete or terminate the existing active run as a side effect of starting a new one.

**Test considerations:**

- Targeted unit test: `server/services/__tests__/workflowRunResolverServicePure.test.ts` — mocks the lookup; tests the two cases (one row, zero rows) and asserts the right error / value.
- Integration test (optional): `server/routes/__tests__/workflowRunPauseStopTaskScopedRoute.integration.test.ts` — full HTTP flow against a live test DB; asserts the new URL shape works end-to-end.
- Targeted integration test for the constraint: `server/services/__tests__/workflowRunStartUniqueIndex.integration.test.ts` — start a run for a task; attempt to start a second run on the same task; assert `TaskAlreadyHasActiveRunError` (and 409). Resolve the first run; start a second; assert success.
- **Concurrent race integration test** (round-4 addition): `server/services/__tests__/workflowRunStartConcurrent.integration.test.ts` — fire two `WorkflowRunService.startRun()` calls for the same `task_id` in parallel (via `Promise.all`). Assert exactly one call succeeds (returns the new run id) and the other fails with `TaskAlreadyHasActiveRunError`. This tests the partial-unique-index constraint under true concurrent write pressure, not just sequential-second-call. The `workflowRunStartUniqueIndex` test above handles the sequential case; this test handles the concurrent (race) case.

**Error handling:**

- `no_active_run_for_task` (404): the task exists but has no run in flight. UI surfaces "no active workflow on this task" — distinct from "task not found" (which would be a different upstream check).
- `task_already_has_active_run` (409, run-creation only): the partial unique index rejected the INSERT. Caller surfaces the conflict — never silent.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx server/services/__tests__/workflowRunResolverServicePure.test.ts`

**Acceptance criteria:**

- Three routes are at the spec-mandated path shape.
- Body / response shapes are byte-identical to what the run-scoped routes returned (no consumer-facing behaviour change).
- Resolver helper exists and is consumed by all three route handlers.
- Run-scoped route handlers deleted; `grep -r "POST.*workflow-runs.*pause\|POST.*workflow-runs.*resume\|POST.*workflow-runs.*stop" server/` returns zero matches.

**Dependencies:** P1 (the FK).

### P4 — Update `workflowStepGateService` to use `workflow_runs.task_id` directly

**Source:** optimisation surfaced during the pre-Chunk-9 gap analysis. Chunk 4 / 5 code currently walks the `agent_execution_events` table to derive a `taskId` for events emitted from gate-service paths. Now that `workflow_runs.task_id` exists (P1), the lookup is a single column read.

**Why this matters:** Chunk 9's event-emission paths from gate-service write `taskId` into the WebSocket envelope. Walking `agent_execution_events` for every emit is a (small but unnecessary) extra query. Reading `workflow_runs.task_id` is one column from the row already loaded for the gate's run-context.

**Files to modify:**

- `server/services/workflowStepGateService.ts` — wherever the code reads or derives `taskId`:
  - If the gate-service load path already loads the `WorkflowRun` row (likely yes — it loads run context to validate gate-open preconditions), surface `run.taskId` directly.
  - If a new read is needed, prefer `SELECT task_id FROM workflow_runs WHERE id = $runId LIMIT 1` over any join to `agent_execution_events`.
- `server/services/workflowGateRefreshPoolService.ts` — same shape change if it derives `taskId`.

**Decision: load `WorkflowRun` once per gate operation and pass it through.** Currently the gate-service may re-fetch the run row at multiple call sites in the same operation. Extract `loadWorkflowRunContext(runId, organisationId): Promise<WorkflowRun>` and have every gate-service entry point call it once at the top, then pass the `WorkflowRun` value down. This is a small refactor (3-5 call sites) but yields a single-source-of-truth inside one operation. Do NOT cache across operations.

**Test considerations:** existing gate-service tests should continue to pass after the refactor. No new test required unless a `WorkflowRun` is loaded at a path that didn't previously load it (in which case add a focused test for that path).

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- (Existing gate-service tests run as part of the broader suite — CI will catch regressions; locally, only re-run the targeted gate-service test files if they exist.)

**Acceptance criteria:**

- `workflowStepGateService.ts` reads `taskId` from `workflow_runs.task_id` (via the loaded `WorkflowRun` value), not via a walk of `agent_execution_events`.
- `loadWorkflowRunContext` (or equivalent) is the single load path inside one gate-service operation.
- Existing gate-service behaviour is unchanged at the edge — only the internal lookup pattern changes.

**Dependencies:** P1 (the FK). P4 can run after or in parallel with P2 / P3 — they touch different files.

**Out of scope for P4:** broader refactoring of gate-service into a more layered structure. P4 is the surgical change to consume the new column.

### P5 — Architect decision on W1-spec19 confidence cut-points

**Source:** spec §19.1 #A (open spec-time decision deferred to architect post-Chunk-6 in the original plan); adversarial-reviewer additional observation (W1-spec19 in `tasks/todo.md`); predecessor plan amendment A5.

**Status today:** `server/services/workflowConfidenceCopyMap.ts` and the heuristic predicates in `workflowConfidenceServicePure.ts` ship with **placeholder values**. The map's keys (`high`, `medium`, `low`) are pinned by the spec; the BOOLEAN PREDICATES that decide which key fires (e.g., "many similar past runs, no clamps" — what does "many" mean? 3? 10? 50?) are educated guesses from the original Chunk 6 author.

**Why this gates Chunk 11:** Chunk 11 renders the confidence chip in the Plan tab of the Open Task view. Without architect-tuned cut-points, every operator-facing chip in production renders a possibly-misleading "high / medium / low" judgment. The spec's own §19 guidance is "decide before launch."

**P5 deliverables (~half a day of architect time, parallel with P1–P4 since no code dependency):**

1. **Sample collection.** Pull ~100 representative gate-open events from the dev branch's recent run history (or synthesise from the three system templates if real history is too thin). Each sample carries: template id, step type, `is_critical` flag, side-effect class, past-reviews-count buckets, subaccount-first-use flag, upstream-confidence value.
2. **Engineer labelling pass.** Architect (or engineer + architect) labels each sample with the desired chip (`high` / `medium` / `low`) based on "would I want a careful look here?" judgment. Captured in `tasks/builds/workflows-v1-phase-2/confidence-cut-points-decision.md`.
3. **Cut-point inference.** From the labelled samples, derive predicate thresholds that minimise label disagreement. Examples: "many past runs" = `pastReviews.approved >= 5 AND rejected/total < 0.1`. "Few past runs" = `pastReviews.approved + rejected < 3`. Captured as TS constants in `workflowConfidenceServicePure.ts` with inline comments citing the cut-points-decision file.
4. **Reason-copy pass.** Update `workflowConfidenceCopyMap.ts` reason strings if the labelling pass surfaces operator-language gaps (e.g., "high" might split into "high — clean run history" vs "high — first try at this template was clean"). Editorial rules per `docs/capabilities.md § Editorial Rules`.

**Files to modify** (all in the same PR as P1–P4 if P5 lands in time; otherwise a follow-on PR before Chunk 11):

- `server/services/workflowConfidenceServicePure.ts` — predicate thresholds and the `// architect-tuned 2026-MM-DD` comment.
- `server/services/workflowConfidenceCopyMap.ts` — revised reason strings (if any).
- `tasks/builds/workflows-v1-phase-2/confidence-cut-points-decision.md` — new file documenting the sample, the labelling, the inferred thresholds, and the rationale.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowConfidenceServicePure.test.ts` — extend tests with the new threshold values.

**Acceptance criteria:**

- `confidence-cut-points-decision.md` exists and lists at least 50 labelled samples (lower bound; 100 preferred).
- Predicate thresholds in `workflowConfidenceServicePure.ts` are no longer marked "placeholder" — they have inline rationale comments.
- Updated unit tests cover the new threshold values.
- Architect signs off in the PR description.

**Dependencies:** none (parallel with P1–P4). **Gates:** Chunk 11 cannot ship the confidence-chip surface without P5 complete. If P5 slips, Chunk 11 ships with the chip hidden behind a feature flag (`SHOW_CONFIDENCE_CHIP=false` in the relevant client-side env reader); other Plan-tab content proceeds.

**Out of scope for P5:** building a calibration model for V2 (continuous-value confidence with calibration loss tracking). P5 is the V1 categorical-chip tuning pass; V2 calibrated confidence stays deferred.

### P6 — Static gates pass on the integrated pre-chunk state

After P0–P4 land (P5 is independent), run the standard static gates against the integrated state. This is the equivalent of the per-chunk G1 gate from `feature-coordinator`'s pipeline, applied to the pre-chunk batch.

**Commands:**

- `npm run lint` — must exit 0.
- `npm run typecheck` — must exit 0. P1's `taskId: string` non-nullable type forces every `WorkflowRun` consumer to compile; any miss surfaces here.
- `npm run db:generate` — must produce no diff. If a diff appears, either the migration was edited but the schema wasn't (or vice versa); fix and re-run.
- `npm run build:server` — must exit 0.
- Targeted unit-test execution for the new pure modules (P2 resolver test, P3 resolver test).

**Forbidden locally per `CLAUDE.md` "Test gates are CI-only" rule:** `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `bash scripts/run-all-*.sh`, any `scripts/verify-*.sh` invocation. Those run in CI on the pre-chunk PR.

**Acceptance criteria:**

- All commands above exit 0.
- The integrated pre-chunk state is committable and pushable; CI gate suite passes on the pre-chunk PR.

If any gate fails, fix the underlying cause (do NOT suppress warnings or skip checks). The `CLAUDE.md` "max 3 fix attempts on the same check" rule applies — if a check is still failing after three attempts, stop and ask.

---

---

## Chunk overview

| # | Chunk title | Spec sections owned | Depends on | Effort estimate |
|---|---|---|---|---|
| 9 | Real-time WebSocket coordination (task rooms, replay, gap-detection, run.paused/resumed/stopped event taxonomy, A8 hardening) | §8 (full); A8: `approval.pool_refreshed` emission, W1-F4 `ApproverPoolSnapshot` normalisation, W1-F11 hash+count broadcast, validator fail-fast on bad `eventOrigin` | pre-chunk (P1, P2, P3, P4) | ~3 days |
| 10 | Permissions API (assignable users) + Teams CRUD UI (with A9 email-enumeration mitigation decision) | §14 (full), §16.2 #31; A9 W1-F3 mitigation | pre-chunk | ~2 days |
| 11 | Open task view UI (three-pane layout, Now/Plan/Files tabs, header) | §9 (full), §15 (Brief → Task UI) | 9, 10, P5 (confidence cut-points — gates the chip surface) | ~5 days |
| 12 | Ask form runtime (form card primitive, submit/skip, autofill) | §3.2 (Ask params shape), §11 (full) | 9, 11 | ~3 days |
| 13 | Files tab + diff renderer + per-hunk revert | §12 (full) | 9, 11 | ~3 days |
| 14a | Studio canvas + bottom bar + publish flow | §10.1, §10.2, §10.4, §10.5 (publish + concurrent-edit) | 10 | ~3.5 days |
| 14b | Four A's inspectors + Studio chat panel + draft hydration | §3.3 (`workflow_drafts`), §10.3 (inspectors), §10.6 (Studio chat), §10.7 (draft hydration) | 14a | ~3.5 days |
| 15 | Orchestrator changes (suggest-don't-decide, draft creation, milestone events, `workflow.run.start` skill) | §13 (full), §16.3 (full) | 9, 14b | ~3 days |
| 16 | Naming cleanup (Brief → Task) + `workflow_drafts` cleanup job | §15 (full), §16.3 #35a, §18 (final migration polish + telemetry registry entries) | 11, 14b | ~1 day |

**Total Chunks 9–16: ~22 engineer-days.** Combined with pre-chunk (~1.5 days), phase 2 total is ~23.5 engineer-days.

**Chunk dependency graph (forward-only, no cycles):**

```
pre-chunk (P0–P6)
└── 9 (websocket — event taxonomy + transport)
    ├── 11 (open task UI)
    │   ├── 12 (Ask runtime)
    │   ├── 13 (Files + diff)
    │   └── 16 (naming cleanup)
    └── 15 (orchestrator)
        └── (depends on 14b too)
10 (permissions + teams CRUD)
├── 11 (open task UI)
└── 14a (Studio canvas + publish)
    └── 14b (inspectors + draft hydration)
        └── 15 (orchestrator)

P5 (confidence cut-points) ──gates──> 11's confidence-chip surface
```

**Parallelisation hints (for `feature-coordinator` if multi-engineer):**

- After pre-chunk lands: chunks 9 and 10 can ship in parallel.
- Chunk 14a starts as soon as 10 lands (does NOT need 9).
- Chunks 11 needs both 9 and 10. Chunk 14b needs 14a.
- Chunks 12 and 13 each need 11. They can ship in parallel after 11.
- Chunk 15 needs 9 AND 14b.
- Chunk 16 is post-everything.

**Single-engineer ordering recommendation:** pre-chunk → 9 → 10 → 11 → 12 → 13 → 14a → 14b → 15 → 16. Total elapsed time matches the engineer-day estimate (~23.5 days) since there's no concurrency win.

---

---

## Per-chunk detail

### Chunk 9 — Real-time WebSocket coordination

**Spec sections owned:** §8 (full): connection model, event taxonomy, per-pane subscription, optimistic rendering, latency budget, gap-detection invariant, client ordering invariant.

**Scope.** New `task` room scope on the server. New `emitTaskEvent` wrapper. Event taxonomy — every kind in §8.2 lands in a discriminated union with the validator allow-list. Replay-on-reconnect protocol with gap detection. Client-side hook `useTaskEventStream(taskId)` for the open task view (Chunk 11 consumes). Plus the post-Chunks-1-8 hardening additions: `approval.pool_refreshed` emission (deferred from Chunk 5 to here); `ApproverPoolSnapshot` UUID-normalisation contract; reduced-broadcast (size + fingerprint) for events that previously carried full pool ID lists; validator fail-fast on unknown `event_origin` values.

**Out of scope.** Pane-specific filtering (Chunk 11). Optimistic rendering hookup (Chunk 11 — uses the existing primitive). Mockup-driven UI states (Chunks 11, 12, 13).

**Files to create:**

- `shared/types/taskEvent.ts` — discriminated union of every event kind from spec §8.2. One type per kind with literal `kind` discriminator + payload fields. `TaskEventKind` enum exported. Source of truth for the event allow-list (per `DEVELOPMENT_GUIDELINES.md` §8.13).
- `shared/types/taskEventValidator.ts` — pure runtime validator: `validateTaskEvent(payload: unknown): { ok: true, event: TaskEvent } | { ok: false, reason: string }`. Used at write-time before persisting. Validator MUST also fail-fast on `event_origin` values outside `'engine' | 'gate' | 'user' | 'orchestrator'` — the DB CHECK constraint added in Chunk 1 (verified via P0) is the durable safety, but app-layer rejection produces a structured error before the write attempt and surfaces in metrics rather than a Postgres exception.
- `shared/types/approverPoolSnapshot.ts` — pin the canonical normalisation contract for the `ApproverPoolSnapshot` JSON shape. Branded type `ApproverPoolSnapshot = Brand<readonly LowercaseUuid[], 'ApproverPoolSnapshot'>`. Constructor `normaliseApproverPoolSnapshot(raw: unknown): ApproverPoolSnapshot` lowercases every UUID, strips duplicates (last-wins), validates each is a syntactically valid UUID, throws `InvalidApproverPoolSnapshotError` otherwise. **Back-fill:** every existing snapshot write site in Chunk 5 (`WorkflowApproverPoolService.resolvePool`, refresh-pool, gate creation) is updated in this chunk to call `normaliseApproverPoolSnapshot` before persisting. Every read site that performs a `userInPool` check is fed a normalised snapshot. Without this, a `userInPool(snapshot, callerUuid)` equality check can false-negative for a legitimate approver if the snapshot captured uppercase UUIDs (Postgres returns UUIDs lowercase, but `specific_users` arrays from the validator preserve author input).
- `server/services/taskEventService.ts` — write path. Wraps `agentExecutionEventService.appendEvent` with `taskId` and the per-task sequence. Emits via `emitTaskEvent`.
- `server/websocket/taskRoom.ts` — `join:task` / `leave:task` handlers. Validates the user has visibility into the task (per Chunk 10 permission helpers; for now, calls a stub that allows owner / org admin / subaccount admin). Joins `task:${taskId}` room.
- `server/websocket/emitters.ts` (modify) — add `emitTaskEvent(taskId, envelope)` mirroring `emitAgentExecutionEvent`. Envelope shape:
  ```typescript
  {
    eventId: `task:${taskId}:${taskSequence}:${eventSubsequence}:${kind}`,
    type: 'task:execution-event',
    entityId: taskId,
    timestamp: ISO8601,
    eventOrigin: 'engine' | 'gate' | 'user' | 'orchestrator',                // Decision 11
    taskSequence: number,
    eventSubsequence: number,                                                // Decision 11
    payload: TaskEvent
  }
  ```
- `client/src/hooks/useTaskEventStream.ts` — React hook. Joins `task` room, subscribes to `task:execution-event`, dedups via the existing LRU, applies events in `taskSequence` order with the gap-detection buffer per spec §8.1 client ordering invariant.
  - On reconnect: re-fetch a REST snapshot via `GET /api/tasks/:taskId/event-stream/replay?fromSeq=N` and reconcile.
  - Client buffer for out-of-order events (max ~1s recovery window per spec); if gap doesn't fill, trigger a replay from the last contiguous `taskSequence`.
- `server/routes/taskEventStream.ts` — `GET /api/tasks/:taskId/event-stream/replay?fromSeq=N` returns events with `taskSequence > fromSeq`. Returns `{ events: TaskEvent[], hasGap: boolean, oldestRetainedSeq: number }`. `hasGap: true` when `fromSeq < oldestRetainedSeq` — client must do a full reload (spec §8.1 "gap-detection invariant").

**Files to modify:**

- `server/websocket/rooms.ts` — wire `join:task` / `leave:task` listeners (calling `taskRoom.handleJoinTask`).
- `server/websocket/emitters.ts` — add the `emitTaskEvent` export.
- `server/services/workflowEngineService.ts` — every step transition calls `taskEventService.appendAndEmit(...)` with the relevant kind. Replace any direct `emitWorkflowRunUpdate` call that should now be a task-scoped event (the per-run scope continues to coexist for legacy consumers). **Specific addition for round-4 (post-agentic-commerce merge):** at the existing `pending_approval` branch around [server/services/workflowEngineService.ts:1588](../../../server/services/workflowEngineService.ts#L1588), where `reviewKind` is already computed from `SPEND_ACTION_ALLOWED_SLUGS`, also emit `taskEventService.appendAndEmit('step.awaiting_approval', { stepId, reviewKind, actionId })`.

**Ownership of `step.approval_resolved` (round-4 clarification — keep cross-system coupling thin):**

`workflowEngineService` is the single emitter of `step.approval_resolved` for both `reviewKind` values. The agentic-commerce code (`chargeRouterService.resolveApproval`, `approvalChannelService`, the Stripe webhook handler) has zero knowledge of task events — clean separation. The chain:

- **For `action_call_approval` (workflow-internal action approvals):** decision lands via the existing action-resolution path; the workflow engine resumes the step from the in-process resume path; emit `step.approval_resolved` immediately before re-dispatching the step.
- **For `spend_approval` (agentic-commerce):** decision lands via `chargeRouterService.resolveApproval` (the SOLE writer for `agent_charges.pending_approval → approved/denied` per [server/services/chargeRouterService.ts:788](../../../server/services/chargeRouterService.ts#L788)). That call updates `agent_charges` + the `actions` row, NOT `workflow_step_runs`. The workflow engine learns about the resolution via its existing pg-boss resume job that polls / subscribes to the `actions` row state for the `workflow_step_runs.action_id` it's blocked on. When that job picks up the resolved state, it transitions the step run out of `pending_approval` AND emits `step.approval_resolved` with the decision pulled from the `actions` row. **The emit MUST land before the next step is dispatched** so the timeline shows resolved-then-next-started in order.

**What `chargeRouterService` and `approvalChannelService` MUST NOT do:** they MUST NOT call `taskEventService` directly. Cross-system event emission is forbidden — it would couple the spend system to the task event taxonomy and the per-task sequence allocator. The seam is the workflow engine's resume path; everything else flows through it.

**Failure mode if the resume job lags:** the timeline shows `step.awaiting_approval` for an extended period even after the spend decision lands. The 60s periodic reconcile (Chunk 11) and the 5-minute full rebuild already bound the staleness; no additional mitigation needed in V1. If lag becomes user-visible at scale, V2 can add a NOTIFY-based wake-up signal from `chargeRouterService` to the resume job — captured in `tasks/todo.md` as deferred.
- `server/services/workflowStepGateService.ts` — `openGate` / `resolveGate` emit `approval.queued` / `approval.decided` / `ask.queued` / `ask.submitted` / `ask.skipped` events.
- `server/services/workflowGateRefreshPoolService.ts` — emit `approval.pool_refreshed` after a successful pool re-resolution (deferred from Chunk 5 because Chunk 9 owns the event taxonomy and transport). Payload follows the reduced-broadcast contract below.
- `server/services/workflowRunPauseStopService.ts` — emit `run.paused.cost_ceiling` / `run.paused.wall_clock` / `run.paused.by_user` / `run.resumed` / `run.stopped.by_user`. Note: this service consumed by P3's task-scoped routes; the emission is route-shape-agnostic (it operates on `runId`).
- `server/services/workflowApproverPoolService.ts` — back-fill all snapshot-producing call sites to call `normaliseApproverPoolSnapshot` before persisting. (Surgical change in concert with Chunk 9's new contract; lands in the same chunk to avoid drift.)

**Contracts pinned in this chunk (the V1-canonical event taxonomy):**

```typescript
// shared/types/taskEvent.ts (excerpt — full enumeration in the file)
export type TaskEvent =
  | { kind: 'task.created'; payload: { requesterId: string; initialPrompt: string } }
  | { kind: 'task.routed'; payload: { targetAgentId?: string; targetWorkflowTemplateId?: string } }
  | { kind: 'agent.delegation.opened'; payload: { parentAgentId: string; childAgentId: string; scope: string } }
  | { kind: 'agent.delegation.closed'; payload: { childAgentId: string; summary: string } }
  | { kind: 'step.queued'; payload: { stepId: string; stepType: string; params: Record<string, unknown> } }
  | { kind: 'step.started'; payload: { stepId: string } }
  | { kind: 'step.completed'; payload: { stepId: string; outputs: unknown; fileRefs: string[] } }
  | { kind: 'step.failed'; payload: { stepId: string; errorClass: string; errorMessage: string } }
  | { kind: 'step.branch_decided'; payload: { stepId: string; field: string; resolvedValue: unknown; targetStep: string } }
  // step.awaiting_approval — emitted when an action_call step returns 'pending_approval'
  // from the action executor (existing engine path at workflowEngineService.ts:1588).
  // reviewKind discriminates workflow-internal action approvals from agentic-commerce
  // spend approvals (the latter routes through actions table + chargeRouterService).
  // The open task view surfaces both with a single inline state pill; the spend-approval
  // resolution itself is handled outside this event stream (agentic-commerce surface).
  // Round-4 addition (post-agentic-commerce merge reconciliation).
  | { kind: 'step.awaiting_approval'; payload: { stepId: string; reviewKind: 'spend_approval' | 'action_call_approval'; actionId: string } }
  | { kind: 'step.approval_resolved'; payload: { stepId: string; reviewKind: 'spend_approval' | 'action_call_approval'; actionId: string; decision: 'approved' | 'rejected' } }
  // approval.queued and ask.queued payloads do NOT ship the full approver/submitter pool ID list
  // to every WebSocket subscriber. Each carries `poolSize` plus a stable `poolFingerprint`
  // (sha256(sortedJoinedIds).slice(0, 16) — 64 bits of entropy; collision probability is
  // negligible at the per-task pool-membership scale, and 16 chars costs four extra bytes
  // on the wire vs. the earlier 12-char draft) so the client can detect pool-membership
  // changes without enumerating the IDs to non-pool subscribers. Pool-member clients fetch
  // the full snapshot via the gate-detail REST endpoint when they render the Approval /
  // Ask card. Prevents pool-ID enumeration via WebSocket sniffing.
  | { kind: 'approval.queued'; payload: { gateId: string; stepId: string; poolSize: number; poolFingerprint: string; seenPayload: SeenPayload; seenConfidence: SeenConfidence } }
  | { kind: 'approval.decided'; payload: { gateId: string; decidedBy: string; decision: 'approved' | 'rejected'; decisionReason?: string } }
  | { kind: 'approval.pool_refreshed'; payload: { gateId: string; actorId: string; newPoolSize: number; newPoolFingerprint: string; stillBelowQuorum: boolean } }
  | { kind: 'ask.queued'; payload: { gateId: string; stepId: string; poolSize: number; poolFingerprint: string; schema: AskFormSchema; prompt: string } }
  | { kind: 'ask.submitted'; payload: { gateId: string; submittedBy: string; values: Record<string, unknown> } }
  | { kind: 'ask.skipped'; payload: { gateId: string; submittedBy: string; stepId: string } }
  | { kind: 'file.created'; payload: { fileId: string; version: number; producerAgentId: string } }
  | { kind: 'file.edited'; payload: { fileId: string; priorVersion: number; newVersion: number; editRequest: string } }
  | { kind: 'chat.message'; payload: { authorKind: 'user' | 'agent'; authorId: string; body: string; attachments?: unknown[] } }
  | { kind: 'agent.milestone'; payload: { agentId: string; summary: string; linkRef?: { kind: string; id: string; label: string } } }
  | { kind: 'thinking.changed'; payload: { newText: string } }
  | { kind: 'run.paused.cost_ceiling'; payload: { capValue: number; currentCost: number } }
  | { kind: 'run.paused.wall_clock'; payload: { capValue: number; currentElapsed: number } }
  | { kind: 'run.paused.by_user'; payload: { actorId: string } }
  | { kind: 'run.resumed'; payload: { actorId: string; extensionCostCents?: number; extensionSeconds?: number } }
  | { kind: 'run.stopped.by_user'; payload: { actorId: string } }
  | { kind: 'task.degraded'; payload: { reason: 'consumer_gap_detected' | 'replay_cursor_expired'; gapRange?: [number, number]; degradationReason: string } };
```

`task.degraded` is the round-2 non-fatal signal. The server emits it when a consumer-side gap is detected (live stream or replay) AND simultaneously sets `workflow_runs.degradation_reason` (one-shot — first-write wins). The run does NOT fail; execution continues. UI surfaces a warning chip and triggers an immediate REST-replay reconcile.

Adding a new kind requires updating the union AND the validator allow-list in the same commit (`DEVELOPMENT_GUIDELINES.md` §8.13). When a kind's payload shape changes (field added, type widened, semantics evolve), the kind's `eventSchemaVersion` increments and the replay logic branches on `(kind, version)` to re-shape old payloads to the current type. V1 ships every kind at `eventSchemaVersion = 1`.

**Replay protocol pinned:**

- Cursor: `(taskSequence, eventSubsequence)` (composite — round-1 invariant).
- Server: `GET /api/tasks/:taskId/event-stream/replay?fromSeq=N&fromSubseq=M` returns `{ events, hasGap, oldestRetainedSeq }`. Each event row includes `eventSchemaVersion` so the client can branch when shapes evolved.
- Client: applies events with `(taskSequence, eventSubsequence) > (N, M)`. If `hasGap === true` (cursor pre-dates oldest retained event), client re-fetches the full task state from the REST snapshot endpoint and rebuilds.
- Retention: 7 days for `agent_execution_events` rows (Open Question 4 default).
- **Schema-version branching:** the client's pure decoder maps `(kind, eventSchemaVersion) → CurrentTaskEvent`. V2 evolutions add a new branch; older events in the retention window decode through the back-compat branch. Without `eventSchemaVersion`, V2 either breaks replay or forces a one-shot mass-rewrite of all retained events. (Round-2 hardening invariant.)
- **UI reconciliation contract.** WebSocket is the low-latency push; REST replay is authoritative. Clients reconcile in four cases: (a) on every reconnect (full snapshot rebuild), (b) every 60 seconds while the page is visible (delta-only — replay is cheap), (c) every 5th periodic reconcile does a full snapshot rebuild instead of delta (round-3: catches silent reducer drift the delta path cannot), (d) immediately on `task.degraded` event arrival (full rebuild). (Round-2 + round-3 hardening invariant; consumed by Chunk 11.)

**Latency budget verification (pinned at plan-gate review):**

- **Synthetic test:** 1000 events / second sustained for 60 seconds, single-node dev DB, single Node process. Measure `event_emit → client_render` end-to-end latency for a representative subset (10% sample) of emitted events.
- **Acceptance:** p95 < 200 ms, p99 < 500 ms.
- **Test harness lives at:** `server/services/__tests__/taskEventStreamLoad.integration.test.ts`. Generates events from a fake engine, captures emit timestamp at the server, captures render timestamp at a single test client, computes percentiles.
- **Failure mode:** if budget is missed at chunk-time, the chunk does not merge. Fixes (in order of preference): batch the WebSocket emit (combine multiple events per envelope), drop non-critical events from the emit path (downgrade to log-only), shard the per-task counter (defer to V2).

**Observability metrics counters (round-1 feedback):**

Counter metrics emitted from existing `metrics.ts` infrastructure (or equivalent prom-client wrapper). Surfaces telemetry for ops dashboards from day one — without them, anomalies are blind until a customer reports.

```
workflow_run_paused_total{reason="cost_ceiling"|"wall_clock"|"by_user", template_id, organisation_id}
workflow_gate_open_total{gate_kind="approval"|"ask", is_critical_synthesised, organisation_id}
workflow_gate_resolved_total{resolution_reason, gate_kind, organisation_id}
workflow_gate_stalled_total{cadence="24h"|"72h"|"7d", organisation_id}
workflow_gate_orphaned_cascade_total{organisation_id}
task_event_gap_detected_total{organisation_id}
task_event_subsequence_collision_total{organisation_id}
task_event_invalid_origin_total{organisation_id}                            // NEW: ticks when validator rejects bad event_origin
task_event_invalid_payload_total{organisation_id}
workflow_cost_accumulator_skew_total{organisation_id}                       // accumulator vs ledger SUM mismatch (probe)
```

Counters incremented from the relevant emitter / handler. Cardinality bounded: `organisation_id` and `template_id` are the only high-cardinality labels and the dashboard aggregates in queries. Probe `workflow_cost_accumulator_skew_total` runs daily against a sample of recently completed runs and increments the counter on any mismatch — non-zero is the signal to investigate.

**Retention scalability checkpoint (round-1 feedback):**

The 7-day hot retention (Open Q4) is the V1 baseline. Long-running workflows and audit investigations will quickly exceed this. Routed to `tasks/todo.md`:

- **Cold archival pipeline** — archive `agent_execution_events` rows older than the hot window to a dedicated archive table OR S3 object storage. Replay from archive is best-effort (slow, separate code path). Triggers at chunk-time visibility into retention pressure.
- **Per-org retention overrides** — once one customer needs longer hot retention, expose as an org-level setting; default stays at 7d.

**Error handling:**

- Malformed event payload (validator rejects): log `task_event_invalid_payload`; do not write the row; do not emit; metric counter ticks.
- Unknown `event_origin` value (validator rejects): log `task_event_invalid_origin`; do not write; do not emit; metric counter ticks.
- Replay of a `fromSeq` older than retention: 200 with `hasGap: true`; client recovers by full reload.
- WebSocket emission failure (no listeners, broken pipe): log; the event row is still in the DB and replays on reconnect.
- Client gap detection (out-of-order arrival): buffer up to 1 second; if gap not filled, trigger replay from last contiguous `taskSequence`.
- **Consumer-side gap that survives the buffer and replay** (round-2): emit `task.degraded` with `reason: 'consumer_gap_detected'` + the missing range; set `workflow_runs.degradation_reason = 'consumer_gap_detected: <range>'` if currently null (one-shot — never overwrite a prior degradation reason; the metric counter still ticks for repeat detections). Run continues. Distinct from the spec §8.1 server-side allocation gap which fails the run with `event_log_corrupted` — that is a corrupted log; this is a missed-by-consumer signal.

**Test considerations:**

- `taskEventValidator.test.ts` — every kind validates correctly; malformed payloads rejected; bad `eventOrigin` rejected.
- `approverPoolSnapshotPure.test.ts` — `normaliseApproverPoolSnapshot` lowercases, dedups, validates UUID syntax; throws on bad input; round-trip (uppercase in → lowercase out → `userInPool` check passes for the equivalent uuid).
- `taskEventStreamReplay.integration.test.ts` — write 20 events, replay from `fromSeq=10`, get exactly 10 events in order.
- `taskEventStreamGap.integration.test.ts` — request replay with `fromSeq` older than retention; receive `hasGap: true`.
- `useTaskEventStreamPure.test.ts` — pure logic of the client-side ordering buffer (extract pure logic per `KNOWLEDGE.md` 2026-04-21 RTL-absent pattern).

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx shared/types/__tests__/taskEventValidator.test.ts`
- `npx tsx shared/types/__tests__/approverPoolSnapshotPure.test.ts`
- `npx tsx server/services/__tests__/taskEventStreamReplay.integration.test.ts`

**Acceptance criteria:**

- Per-task room joins are permission-validated.
- Every event kind in §8.2 has a typed entry in the union and a validator entry.
- Replay-on-reconnect resumes from `lastEventId` cursor; no events lost; no replay from start.
- Gap detection signals to the client when retention has expired the cursor.
- Out-of-order arrival is buffered and reconciled.
- **`ApproverPoolSnapshot` normalisation contract is enforced**: every snapshot write goes through `normaliseApproverPoolSnapshot`; `userInPool` checks never false-negative on UUID case mismatch (regression test asserts uppercase-input snapshot resolves correctly).
- **Pool-ID broadcast is reduced**: `approval.queued` / `ask.queued` / `approval.pool_refreshed` events ship `poolSize + poolFingerprint`, not the full ID list. Pool-member clients fetch the full snapshot via the gate-detail REST endpoint when they render the card. WebSocket sniffing cannot enumerate pool membership.
- **`approval.pool_refreshed` is emitted by `WorkflowGateRefreshPoolService` after a successful re-resolution**: the deferred Chunk 5 emission lands here.
- **`taskEventValidator` rejects unknown `event_origin` values before the DB write**: structured error returned to the caller; metric counter `task_event_invalid_origin_total` increments.
- **`step.awaiting_approval` and `step.approval_resolved` event kinds are emitted from the engine's pending_approval / resume path**: both kinds carry `reviewKind: 'spend_approval' | 'action_call_approval'` so the open task view (Chunk 11) can render a single inline-state pill regardless of which approval system is in flight. Targeted unit test asserts the `reviewKind` value is correctly derived from `SPEND_ACTION_ALLOWED_SLUGS.includes(actionStep.actionSlug)` (mirroring [server/services/workflowEngineService.ts:1588](../../../server/services/workflowEngineService.ts#L1588) — single source of truth, do not re-derive).

**Dependencies:** pre-chunk phase (P1's `workflow_runs.task_id` FK is consumed by event envelopes; P3's task-scoped routes coexist with this chunk's REST replay endpoint at the same `/api/tasks/:taskId/...` path shape).

### Chunk 10 — Permissions API + Teams CRUD UI

**Spec sections owned:** §14 (full): roles, the assignable-users endpoint, picker UI behaviour, visibility for non-requester submitters, Pause / Stop button visibility, cross-team / cross-subaccount Asks. §16.2 #31 (Teams CRUD UI in Org settings).

**Scope.** New endpoint for the role-aware picker pool. Two pickers (User picker, Team picker) consumed by Studio inspectors. Teams + Members CRUD UI page (`teams` and `team_members` tables already exist, no schema changes). Visibility rules for non-requester submitters. Pause / Stop server-side permission guard already lives in Chunk 7; this chunk pins the role-set list. Plus an operator decision on the email-enumeration mitigation surfaced by adversarial-reviewer (W1-F3) — see "Email enumeration mitigation" below.

**Out of scope.** Studio inspector usage of the pickers (Chunk 14). Picker rendering inside the Studio Approval / Ask inspectors (Chunk 14). Restricted-view mode for sensitive workflows (V2 per spec §14.4).

**Files to create:**

- `server/services/assignableUsersService.ts` — `resolvePool({ caller: { id, role }, organisationId, subaccountId, intent: 'pick_approver' | 'pick_submitter' }) → Promise<{ users: AssignableUser[], teams: AssignableTeam[] }>` per spec §14.2 shape and Decision 13. Org admin/manager: org users + subaccount members. Subaccount admin: subaccount members only. Subaccount member: 403. **The `intent` parameter is carried through but does not branch in V1** — both `pick_approver` and `pick_submitter` resolve identically. The seam exists so future intents (`pick_external_reviewer`, `pick_partner_user`, restricted-view) extend the resolver, not call sites. Call sites pass `intent` literally — never construct it from caller role. **Email enumeration mitigation:** the resolver applies the operator-chosen mitigation (see decision section below) before returning user rows.
- `server/routes/assignableUsers.ts` — `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users`. Mounted in `server/index.ts`.
- `server/services/teamsService.ts` — Teams CRUD (create, list, update, soft-delete). `team_members` add/remove. Already-implicitly-existing schema; this is the missing service layer.
- `server/routes/teams.ts` — Teams CRUD endpoints. Mounted under `/api/orgs/:orgId/teams` (org-level) and `/api/subaccounts/:subaccountId/teams` (subaccount-scoped, optional in V1).
- `client/src/pages/TeamsAdminPage.tsx` — Teams CRUD UI in Org settings. List view, Create button, Edit modal, Members management.
- `client/src/components/UserPicker.tsx` — generic picker component. Search-and-select against `users[]`; chip render on selection.
- `client/src/components/TeamPicker.tsx` — generic picker for `teams[]`.

**Files to modify:**

- `server/lib/permissions.ts` — add `TEAMS_MANAGE` permission key; gate the Teams CRUD routes on it.
- `server/index.ts` — mount the new routes.
- `client/src/components/sidebar/*` — add a "Teams" entry in Org settings nav.

**Contracts pinned in this chunk:**

```typescript
// GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users?intent=pick_approver|pick_submitter
// 200:
{
  users: Array<{
    id: string;
    name: string;
    email: string | null;                                                   // null when redaction mitigation applied (option 2)
    role: 'org_admin' | 'org_manager' | 'subaccount_admin' | 'subaccount_member';
    is_org_user: boolean;                                                   // true if visible to all subaccounts in org
    is_subaccount_member: boolean;                                          // true if a member of THIS subaccount
  }>,
  teams: Array<{ id: string; name: string; member_count: number }>;
}
// 403: { error: 'forbidden' }                                              // subaccount member or wrong subaccount admin
// 400: { error: 'invalid_intent' }                                         // intent missing or not in V1 set
// 429: { error: 'too_many_lookups', retry_after_seconds: number }          // when rate-limit mitigation applied (option 3)

// Intent values pinned in shared/types/assignableUsers.ts:
//   type AssignableUsersIntent = 'pick_approver' | 'pick_submitter';
// Future intents extend this union AND the resolver in assignableUsersService.ts
// in the same commit (DEVELOPMENT_GUIDELINES §8.13 discriminated-union rule).
```

```typescript
// Teams CRUD
// POST /api/orgs/:orgId/teams { name, subaccountId? } → 201 { id, name, ... }
// GET /api/orgs/:orgId/teams → 200 { teams: [...] }
// PATCH /api/orgs/:orgId/teams/:teamId { name? } → 200 { team }
// DELETE /api/orgs/:orgId/teams/:teamId → 200 (soft-delete, sets deletedAt)
// POST /api/orgs/:orgId/teams/:teamId/members { userIds: string[] } → 200 { added: number }
// DELETE /api/orgs/:orgId/teams/:teamId/members/:userId → 200
```

**Email enumeration mitigation — default option 2 (redaction); operator override allowed.**

Source: adversarial-reviewer F3 (MEDIUM) in `tasks/review-logs/adversarial-review-log-workflows-v1-2026-05-03T00-00-00Z.md`. The `assignable-users` endpoint returns user emails for everyone in the resolved pool. For an org admin authoring an Approval gate's `specific_users` group, this exposes the email of every user across every subaccount the admin can route into. Threat model: a compromised org-admin session enumerates the org's user base by iterating subaccount IDs.

**Default for V1 implementation: option 2 (redact cross-subaccount emails).** Earlier draft of this plan left this as an open operator decision; round-4 revision pre-selects option 2 so the chunk does not block on a decision that already has an obvious security-favouring default. Operator override is explicit (PR description names the alternative + rationale); without an override, build to option 2.

Three options retained for the override case:

1. **Ship as-is.** Org admins are inside the trust boundary; the endpoint already requires authentication + admin role. Acceptable trade-off only if the org-admin role is treated as effectively-staff. Risk: if the admin role is delegated to a less-trusted operator (e.g. an agency-managed sub-account admin), the surface widens. Operator confirms the policy explicitly in the PR description.
2. **Redact email** for users who are NOT members of the caller's own subaccounts. Returns `{ id, name, email: null, role, ... }` for cross-subaccount entries. Picker UX still works (name + role visible); the bulk-enumeration data leak is closed. **← default for V1.**
3. **Rate-limit + audit-log.** Add `assignable_users_lookups_per_minute` counter scoped to `(orgAdminUserId)`; allow up to 10 distinct subaccount IDs per minute; 429 above. Log every cross-subaccount lookup to `audit_logs` for after-the-fact review. Useful when the org-admin role is highly trusted but operators want forensic visibility.

**Decision capture:** the chunk PR description names the chosen option. If option 2 (default), a one-line "default per plan" reference suffices. If option 1 or 3 is selected as an override, the operator writes the rationale + risk acknowledgement in the PR description and links to this section. Implementation lands in `server/services/assignableUsersService.ts` (mitigation logic) and `server/routes/assignableUsers.ts` (response-shape branching for option 2; rate-limit middleware for option 3).

**Structured WARN log when option 2 is overridden (round-4 addition).** If the chunk ships with option 1 (no redaction) or option 3 (rate-limit) instead of the default option 2, `assignableUsersService.ts` emits a structured WARN on every startup:
```
WARN [assignable-users] email-enumeration-mitigation override active: option=<1|3>, rationale="<PR description text>", reviewer="<engineer>", date="<YYYY-MM-DD>"
```
This surfaces the deviation in ops logs so it is not silently forgotten. The log is emitted once at module initialisation (not per-request) to avoid noise. It is absent entirely when option 2 (default) is active — no log = default. The rationale field is populated from a `ASSIGNABLE_USERS_MITIGATION_RATIONALE` env var set at deploy time; if the env var is absent but a non-default option is in use, the WARN includes `rationale="unset — see plan §Chunk10"` to prompt follow-up.

**Error handling:**

- 403 `forbidden` from picker: caller is not authorised to author for this subaccount.
- 404 `subaccount_not_found` from `resolveSubaccount`.
- 409 `team_name_conflict`: team name already exists in the org/subaccount scope.
- 429 `too_many_lookups`: rate-limit mitigation (option 3) only; carries `retry_after_seconds` for client back-off.

**Test considerations:**

- `assignableUsersService.test.ts` — three role variants produce correct shapes.
- `assignableUsersServiceCrossSubaccount.test.ts` — org admin can route to another subaccount's users; subaccount admin cannot.
- `assignableUsersMitigation.test.ts` — chosen mitigation works as advertised. (Skip cases for the un-chosen options; only test the actual implementation.)
- `teamsServicePure.test.ts` — pure CRUD validation rules.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/assignableUsersService.test.ts`
- `npm run build:client` (Teams admin page)

**Acceptance criteria:**

- Picker endpoint returns correctly scoped pools per role.
- Teams CRUD page allows org admin to create / edit / delete teams and add / remove members.
- Cross-subaccount routing works for org admin; blocked for subaccount admin.
- Email-enumeration mitigation is implemented per the chosen option (default option 2 — redact cross-subaccount emails; operator override allowed). PR description either confirms "default per plan" or names the override + rationale.

**Dependencies:** pre-chunk phase (no schema changes from pre-chunk are consumed; the existing `teams` / `team_members` schemas + RLS are required and exist on `main`).

### Chunk 11 — Open task view UI

**Spec sections owned:** §9 (full — three-pane layout, Chat panel, Activity panel, Right pane Now/Plan/Files tabs, header, empty states), §15 (Brief → Task UI rename — sidebar, breadcrumb, page title; the route redirect lands in Chunk 16).

**Scope.** The most important UI surface in the product. Three-pane layout with mockup-faithful styling. Chat panel with milestone cards, thinking box, composer. Activity panel with newest-at-bottom + auto-scroll + "↓ N new events" pill. Right pane with Now / Plan / Files tabs (Plan default per spec-time decision #7). Header with task name + status badge + Pause/Stop buttons (visibility per Chunk 10). Empty states per spec §9.6.

**Out of scope.** Files tab content — strip + reader + diff (Chunk 13). Ask form card runtime (Chunk 12). Studio (Chunk 14).

**Files to create:**

- `client/src/pages/OpenTaskView.tsx` — page-level component. Subscribes to `useTaskEventStream(taskId)` (Chunk 9 hook).
- `client/src/components/openTask/ChatPane.tsx` — chat scroll area, milestone-vs-narration filter, composer, thinking box.
- `client/src/components/openTask/ActivityPane.tsx` — collapsible (36px collapsed, 22% expanded). Auto-scroll-to-bottom on new events; pause-on-manual-scroll; "↓ N new events" pill.
- `client/src/components/openTask/RightPaneTabs.tsx` — tab switcher (Now / Plan / Files), default Plan.
- `client/src/components/openTask/NowTab.tsx` — agent org-chart with status dots + edges.
- `client/src/components/openTask/PlanTab.tsx` — content adapts per task type (trivial / multi-step / workflow-fired); branch labels + "Why?" link; Critical pill; confidence chip preview; empty state. **Confidence chip surface depends on pre-chunk P5** (cut-points decision); if P5 has not landed, render the chip behind a feature flag (`SHOW_CONFIDENCE_CHIP=false`) and ship the rest of the Plan tab. The flag is removed when P5 ships.
- `client/src/components/openTask/FilesTab.tsx` — placeholder for Chunk 13's full implementation.
- `client/src/components/openTask/ThinkingBox.tsx` — single-line italic, pulsing dot, plain language.
- `client/src/components/openTask/MilestoneCard.tsx` — per-agent attribution + link affordance.
- `client/src/components/openTask/ApprovalCard.tsx` — refactor of existing pattern; renders `seenConfidence` chip + audit caption ("Approved by X · view what they saw"). Same P5 dependency on the chip surface.
- `client/src/components/openTask/PauseCard.tsx` — pause card primitive (Stop / Continue with extension buttons). Calls the task-scoped pause/resume routes shipped in pre-chunk P3.
- `client/src/components/openTask/TaskHeader.tsx` — task name, status badge, Pause/Stop buttons (visibility per role).
- `client/src/components/openTask/openTaskViewPure.ts` — pure helpers: classify task type from event stream (trivial / multi-step / workflow-fired); pick the latest thinking text from `thinking.changed` events; compute milestone-vs-narration filter set; activity-pane auto-scroll decision logic per `KNOWLEDGE.md` 2026-05-02 correction.
- `client/src/hooks/useTaskProjection.ts` — round-3 read-model projection. Pure deterministic reducer `(prevState: TaskProjection, event: TaskEvent) → TaskProjection`. Idempotent (applying the same event twice produces the same state — the dedup LRU is the safety). Inputs: a snapshot from REST replay (initial) plus the WebSocket event stream (incremental). UI components (`ChatPane`, `ActivityPane`, `NowTab`, `PlanTab`, `TaskHeader`) read the projection via `useTaskProjection(taskId) → TaskProjection`. **Forbidden:** UI components reading raw `useTaskEventStream` events directly. The projection is rebuildable from `agent_execution_events + workflow_runs + workflow_step_runs + workflow_step_gates`; reconcile-on-reconnect rebuilds it from scratch.
- `client/src/hooks/useTaskProjectionPure.ts` — the reducer extracted as a pure function. Tested via `npx tsx` per the project's pure-function-only test posture.

**Files to modify:**

- `client/src/App.tsx` — register the new route `/admin/tasks/:taskId` (preserving the `/admin/` prefix used by the existing `/admin/briefs/:briefId` route at line 361). The redirect from `/admin/briefs/:briefId` to `/admin/tasks/:taskId` lands in Chunk 16.
- `client/src/components/sidebar/*` — change "Briefs" to "Tasks" (rename in Chunk 16, but the tasks-list page lives here).

**Contracts pinned in this chunk:**

- Layout widths from spec §9.1 (Chat 26%, Activity 22% expanded / 36px minimised, Right pane 52% / ~74%).
- Default tab on open: **Plan** (decision #7).
- Activity flows top-down newest-at-bottom (`KNOWLEDGE.md` 2026-05-02 correction).
- Plain-language thinking text (no engineering jargon).
- Empty states per spec §9.6.
- **Pause / resume / stop calls go to the task-scoped routes from pre-chunk P3** (`POST /api/tasks/:taskId/run/pause | resume | stop`). No run-scoped fallback exists post-pre-chunk.
- **Pool-fingerprint reconciliation:** when an `approval.queued` / `approval.pool_refreshed` event arrives carrying `poolFingerprint`, the Approval card detects the change and fetches the full snapshot via `GET /api/tasks/:taskId/gates/:gateId` (existing endpoint from Chunk 5). The full ID list is never inferred from the WebSocket payload (per the Chunk 9 reduced-broadcast contract).
- **UI reconciliation rule (round-2 + round-3 + round-4 hardening):** `useTaskEventStream` reconciles against the REST replay endpoint in five cases: (a) on reconnect (full rebuild from snapshot), (b) every 60s while the page is visible (delta-only by default), (c) every 5th periodic reconcile (i.e. every ~5 minutes for a continuously-visible page) does a **full snapshot fetch + projection rebuild from scratch instead of delta**, (d) immediately on `task.degraded` arrival (full rebuild), and (e) **time-based full rebuild (round-4 addition):** if the time since the last full rebuild (`last_full_rebuild_at`) exceeds 20 minutes, trigger a full rebuild regardless of whether the 5th-tick has been reached. This self-healing trigger catches low-throughput tasks where ticks are sparse — a task receiving one event every 30 minutes would otherwise wait hours between full rebuilds; the 20-minute cap bounds worst-case staleness. `last_full_rebuild_at` is a ref tracked inside the hook, updated on every full rebuild (reconnect, 5th-tick, time-based, or `task.degraded`). The hook exposes a `reconcileNow()` callback the page can also invoke (Files-tab open, manual refresh button). Delta reconciliation uses the existing dedup LRU to absorb duplicates. A degraded run renders a small warning chip in the task header.
  - **Why the periodic full-rebuild matters.** Delta reconciliation feeds events through the `useTaskProjection` reducer; if the reducer has a latent bug that desyncs the projection from the source-of-truth state tables, delta reconciliation cannot detect it (it just keeps applying events through the same buggy reducer). The 5-minute full rebuild is a low-cost safety net: at most one rebuild every five minutes per visible page, the snapshot endpoint is already cheap, and a desync window of five minutes is acceptable for a non-safety-critical UI surface. A heavier-weight projection-integrity protocol (server-side projection hash + client compare) is deferred to V2; capture the deferral in `tasks/todo.md` ("V2: server-computed projection hash for divergence detection — convert silent reducer drift into detectable state").
  - **Full-rebuild must reset to the empty initial state, not merge into the existing reducer state.** Acceptance criterion in Chunk 11: when a full rebuild fires (reconnect / 5th-tick / time-based / `task.degraded`), `useTaskProjection` MUST replace its internal state with `INITIAL_TASK_PROJECTION` BEFORE replaying the snapshot. If the rebuild merged into the existing state (e.g., by re-running the reducer on top of the previously-mutated projection), stale UI fragments from a buggy reducer would survive the rebuild — defeating the entire safety-net purpose. Unit test: seed the projection with deliberately-stale data, trigger a rebuild from a clean snapshot, assert the post-rebuild state contains exactly the snapshot-derived data with no carry-over fields.
- **Read-model projection rule (round-3):** UI components consume `useTaskProjection(taskId)`, NOT raw events. The projection's reducer is pure + idempotent; applying the same event twice produces the same state. This defines the "step completed in DB but event not yet processed" boundary: projection lags DB by at most one reconcile interval; UI shows the projection state, never a contradictory mix. Authoritative model: state tables win on disagreement (see [Authoritative model](#background-and-scope) at the top of this plan).

**Error handling:**

- WebSocket disconnect: surface a banner "Reconnecting…" while the hook reconnects; existing `useSocketRoom` reconnect path drives the recovery.
- Missing task (404 from REST snapshot): redirect to Tasks list with toast "Task not found".
- `no_active_run_for_task` from pause/resume/stop call: surface "no active workflow on this task" inline (don't toast — task may have legitimately completed); refresh the page state.

**Test considerations:**

- Per `CLAUDE.md` / spec §17.5, frontend unit tests are deferred at the framing level. Instead:
  - Pure logic in `openTaskViewPure.ts` is unit-tested via `npx tsx`.
  - Pure logic in `useTaskProjectionPure.ts` is unit-tested via `npx tsx`.
  - Visual / interaction states are validated against mockups manually at integration time.
  - Static gates (lint, typecheck) catch regressions in component contracts.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx client/src/components/openTask/__tests__/openTaskViewPure.test.ts`
- `npx tsx client/src/hooks/__tests__/useTaskProjectionPure.test.ts`

**Acceptance criteria:**

- Three-pane layout matches mock 07.
- Plan tab is the default tab on open.
- Activity is newest-at-bottom with auto-scroll + manual-scroll-pause + "↓ N new events" pill.
- Thinking box renders the latest `thinking.changed` event in plain language.
- Pause / Stop buttons visible only to users in the §14.5 visibility set.
- Pause / Stop / Continue actions hit the task-scoped routes from pre-chunk P3.
- Approval card consumes `poolFingerprint` from WebSocket events and fetches the full snapshot via REST when rendering pool members.
- Empty states render per §9.6.
- Brief → Task labels in the page title and breadcrumb (full rename in Chunk 16).
- Confidence chip surface either renders P5-tuned values OR is hidden behind `SHOW_CONFIDENCE_CHIP=false` if P5 has not landed.

**Dependencies:** pre-chunk (P3 routes, P5 if confidence chip ships), Chunk 9 (`useTaskEventStream` hook + REST replay endpoint), Chunk 10 (visibility role check for Pause/Stop). Chunks 12 (Ask card placeholder consumed), 13 (Files tab placeholder consumed) are downstream — Chunk 11 lands placeholders for both that the later chunks fill in.

### Chunk 12 — Ask form runtime

**Spec sections owned:** §3.2 (Ask `params` canonical shape), §11 (full): form-card primitive, V1 field renderer, validation, submission and state transitions, skip endpoint, autofill on re-run, routing UX.

**Scope.** Form card lives in chat panel (alongside Approval cards). Seven field types render. Client-side required + type validation. Submit / Skip endpoints. Auto-fill from last completed run. Routing surfaces (sidebar badge, "Waiting on you" page extended for Asks).

**Out of scope.** Studio Ask inspector (Chunk 14). File-upload field type (V2). Conditional fields (V2). Server-side custom regex validation (V2 per spec §11.3).

**Files to create:**

- `client/src/components/openTask/AskFormCard.tsx` — form card primitive. Amber-tinted, header + prompt + form fields + Submit / Skip buttons.
- `client/src/components/openTask/FormFieldRenderer.tsx` — maps field type → input component. Seven types per §11.2.
- `client/src/components/openTask/askFormValidationPure.ts` — pure validation: required-field check + type-specific check. Returns `{ valid: boolean, errors: Record<fieldKey, string> }`.
- `server/services/askFormSubmissionService.ts` — handler for submit and skip.
- `server/services/askFormAutoFillService.ts` — queries last successful run of the template-version; returns pre-fill values for keys whose key+type match.
- `server/routes/asks.ts` — route file owning Ask submit / skip. Mounted under `/api/tasks/:taskId/ask/:stepId/...` (the spec-mandated path shape — no run-scoped variant; the resolver helper from pre-chunk P3 is consumed for `taskId → runId` translation).

**Files to modify:**

- `server/services/workflowRunService.ts` — `submitStepInput` already extended in Chunk 4 to honour the gate-aware shape. Chunk 12 adds the Ask-specific outputs shape (`{ submittedBy, submittedAt, values, skipped }` per §11.4 step 3).
- `client/src/pages/WaitingOnYouPage.tsx` (existing review-queue page or new file) — extend to include Ask items alongside Approvals.
- `client/src/components/sidebar/*` — sidebar badge counts pending Asks alongside pending Approvals.

**Contracts pinned in this chunk:**

```typescript
// Ask params shape (from spec §3.2 — pinned in Chunk 1, restated for Chunk 12 reference)
// (full shape elided — see spec §3.2 line 200–222)

// POST /api/tasks/:taskId/ask/:stepId/submit
// Body: { values: Record<string, unknown> }
// 200: { ok: true } | 409 { error: 'already_submitted', submitted_by, submitted_at }
// 403: { error: 'not_in_submitter_pool' }
// 404: { error: 'no_active_run_for_task' }    // pre-chunk P3 resolver

// POST /api/tasks/:taskId/ask/:stepId/skip
// Body: {}
// 200: { ok: true } | 409 { error: 'already_resolved', current_status, submitted_by, submitted_at }
// 403: { error: 'not_in_submitter_pool' }
// 404: { error: 'no_active_run_for_task' }    // pre-chunk P3 resolver

// Outputs JSON for an Ask step (persisted on workflow_step_runs.outputJson):
{
  submitted_by: string,
  submitted_at: string,
  values: Record<string, unknown>,
  skipped: boolean
}
```

Auto-fill rule per spec §11.5 step 3: pre-fill where BOTH key AND type match. Type change = treat as new field, no pre-fill, no coercion.

**Error handling:**

- 403 `not_in_submitter_pool`: caller not in `gate.approver_pool_snapshot` for the Ask gate.
- 409 `already_submitted`: another submitter raced ahead.
- 400 client-side validation failures: per-field error inline; submit stays enabled.
- 404 `no_active_run_for_task`: from pre-chunk P3's resolver — surfaces if the task has no in-flight run.

**Test considerations:**

- `askFormValidationPure.test.ts` — every field type's required + type validation.
- `askFormSubmissionConcurrent.integration.test.ts` — two submitters race; one wins with 200; other gets 409.
- `askFormAutoFillSchemaChanged.test.ts` — field key matches but type changed → no pre-fill.
- `askFormSkipEndpoint.integration.test.ts` — skip honoured only when `params.allowSkip === true`.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/askFormSubmissionConcurrent.integration.test.ts`

**Acceptance criteria:**

- Form card renders all seven field types.
- Required-field validation runs client-side; submit disabled until valid (or stays enabled and re-runs validation, per spec §11.3).
- Submission persists outputs and emits `ask.submitted` event.
- Skip persists `skipped: true` and emits `ask.skipped`; downstream bindings to skipped fields resolve to `null`.
- Auto-fill respects key+type match invariant.
- Cross-subaccount routing works for org admin.

**Dependencies:** pre-chunk (P3 resolver helper consumed by Ask routes), Chunks 9 (event taxonomy includes `ask.queued/submitted/skipped`), 11 (open task view consumes the form card).

### Chunk 13 — Files tab + diff renderer + per-hunk revert

**Spec sections owned:** §12 (full): Files tab strip + reader, files-at-scale grouping, conversational editing flow, diff view + per-hunk revert, no inline editing.

**Scope.** Files tab UI. Document toolbar. Group switcher (Outputs / References / Versions). Latest-only toggle, search, sort. Conversational editing flow (chat-triage classifier extension already exists; this chunk wires up the file-edit detection + version creation). Inline diff renderer with per-hunk revert. Diff endpoint.

**Out of scope.** Side-by-side full-page diff (V2). Structured spreadsheet diff (V2 — V1 fallback is row-level counts). Diff against non-adjacent versions (V1 always diffs against immediately prior).

**Files to create:**

- `client/src/components/openTask/FilesTab.tsx` — strip + reader + group switcher + toggle + search + sort.
- `client/src/components/openTask/FileReader.tsx` — reader pane with document toolbar (Download + Open in new window) + version dropdown + diff toggle.
- `client/src/components/openTask/DiffRenderer.tsx` — inline strikethrough / highlight; per-hunk revert button.
- `client/src/components/openTask/filesTabPure.ts` — pure logic: group classification (Outputs vs References vs Versions), latest-only filter, sort comparators.
- `server/services/fileDiffService.ts` — diff computation (line-level for documents, row-level for spreadsheets). Deterministic output (same `(from_version, hunk_index)` resolves to the same change set).
- `server/services/fileDiffServicePure.ts` — pure diff algorithm + hunk identification.
- `server/services/fileRevertHunkService.ts` — `revertHunk(taskId, fileId, fromVersion, hunkIndex, organisationId, userId)`. Concurrency guard: verify current version is exactly `fromVersion + 1`; 409 if not. Idempotent: if hunk no longer present, 200 `already_absent`.
- `server/routes/fileRevert.ts` — `POST /api/tasks/:taskId/files/:fileId/revert-hunk`. Mounted at the spec-mandated task-scoped path; consumes the pre-chunk P3 resolver helper for `taskId → runId`.

**Files to modify:**

- Existing chat-triage classifier — extend to detect file-edit intent (new heuristic added; agent then reads, edits, and commits the new version).
- File / version write path — emit `file.created` / `file.edited` events (Chunk 9 taxonomy).

**Contracts pinned in this chunk:**

```typescript
// POST /api/tasks/:taskId/files/:fileId/revert-hunk
// Body: { from_version: number, hunk_index: number }
// 200: { reverted: true, new_version: number }
// 200: { reverted: false, reason: 'already_absent' }
// 409: { error: 'base_version_changed', current_version: number }
// 403: { error: 'forbidden' }
// 404: { error: 'no_active_run_for_task' | 'file_not_found' }
```

Hunk identity invariant: `(file_id, from_version, hunk_index)` deterministically resolves to one change set. Diff algorithm is pinned (line-level for `text/*`, row-level for `text/csv` and `application/vnd.ms-excel`).

**Error handling:**

- 409 `base_version_changed`: current version > `from_version + 1`. Client surfaces "this draft has been edited again".
- 200 `already_absent`: hunk already reverted; idempotent.
- Diff computation failure (corrupt content): log + render "Diff unavailable" in the UI.

**Test considerations:**

- `fileDiffServicePure.test.ts` — diff determinism on a fixed pair of versions.
- `fileRevertHunkConcurrency.integration.test.ts` — concurrent revert attempts; one wins with 200, other gets 409 / `already_absent`.
- `filesTabPure.test.ts` — group classification logic.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/fileDiffServicePure.test.ts`

**Acceptance criteria:**

- Strip + reader render per mock 07.
- Group switcher works (Outputs / References / Versions).
- Diff toggle on the reader shows inline strikethrough + highlight.
- Per-hunk revert creates a new version atomically.
- Concurrency guard prevents stale-base reverts.

**Dependencies:** pre-chunk (P3 resolver helper consumed by file-revert route), Chunks 9 (event emission for `file.created/edited`), 11 (Files tab placeholder).

### Chunk 14a — Studio canvas + bottom bar + publish

**Spec sections owned:** §10.1 (canvas layout, vertical step cards), §10.2 (validation status + cost estimate strip), §10.4 (publish flow), §10.5 (last-write-wins concurrent-edit handling). Plus the publish-notes column write path (column added in Chunk 1).

**Scope.** Studio is admin / power-user only — not in operator nav. The canvas itself: vertical step-card list, branching forks, parallel side-by-side, Approval-on-reject dashed back-arrow. Bottom action bar with validation status + estimated cost + Publish button. Publish modal with optional notes. Last-write-wins concurrent-edit handling.

**Out of scope.** Inspectors (Chunk 14b — slide-out + four step types). Studio chat panel (Chunk 14b). Draft hydration UI (Chunk 14b). Visual node-graph editor (permanently out per brief §3). Inline file editing (out per brief §9.3). "Explain this workflow" inline explanations (V2). Visual diff between published versions (V2).

**Files to create:**

- `client/src/pages/StudioPage.tsx` — admin route at `/admin/workflows/:id/edit` and `/admin/workflows/new`. (The `?fromDraft=:draftId` query param is read but its hydration logic lands in Chunk 14b.)
- `client/src/components/studio/StudioCanvas.tsx` — vertical step-card list, branching forks, parallel side-by-side, Approval-on-reject dashed back-arrow. Empty inspector mount-point — Chunk 14b fills.
- `client/src/components/studio/StudioBottomBar.tsx` — validation status + cost estimate + Publish button.
- `client/src/components/studio/PublishModal.tsx` — single optional textarea + Skip / Publish buttons. Concurrent-edit warning banner if upstream `updated_at` changed.
- `client/src/components/studio/studioCanvasPure.ts` — pure layout logic: branch fork rendering, parallel layout, validate-then-publish gating.
- `server/services/workflowPublishService.ts` — wraps the existing `WorkflowTemplateService.publish` with publish-notes capture and concurrent-edit detection (compares `workflow_template_versions.updated_at` of the latest version against the user's snapshot).

**Files to modify:**

- `server/services/workflowTemplateService.ts` — `publish` accepts `publishNotes?: string` and persists to `workflow_template_versions.publish_notes` in the same transaction.
- `server/routes/workflowStudio.ts` (existing) — extend with the publish-notes-capable endpoint and concurrent-edit response shape.
- `client/src/App.tsx` — register `/admin/workflows/:id/edit` and `/admin/workflows/new`.

**Contracts pinned in this chunk:**

```typescript
// POST /api/admin/workflows/:id/publish (extended)
// Body: { steps: WorkflowStep[], publishNotes?: string, expectedUpstreamUpdatedAt?: string }
// 200: { version_id: uuid, version_number: integer }
// 422: { error: 'validation_failed', errors: ValidatorError[] }
// 409: { error: 'concurrent_publish', upstream_updated_at: string, upstream_user_id: string }
//   (When expectedUpstreamUpdatedAt is provided and the latest version was published since.)
```

Concurrent-edit handling: optimistic UX. The Studio reads the latest version's `updated_at` on canvas open. On publish, the request includes `expectedUpstreamUpdatedAt`. If mismatch → 409 with the new upstream info; modal banner shown; user can Publish-anyway (omits the expected field on retry) or Cancel.

**Error handling:**

- 422 validation errors from Chunk 2 validator: render inline error pills next to the offending steps.
- 409 concurrent publish: render banner; user choice.

**Test considerations:**

- `studioCanvasPure.test.ts` — layout calculation logic.
- `workflowPublishConcurrentEdit.integration.test.ts` — two users editing the same template; second-to-publish gets 409.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/workflowPublishConcurrentEdit.integration.test.ts`

**Acceptance criteria:**

- Studio canvas matches mock 05 (without inspectors — placeholder mount-point).
- Publish modal matches mock 05 publish-notes inset.
- Concurrent-edit warning banner appears when upstream changed.
- Validation pills render inline on offending steps.

**Dependencies:** Chunk 10 (User / Team pickers — already exist; consumed by 14b). (No pre-chunk dependency: Chunk 14a operates on `workflow_templates` / `workflow_template_versions` — not on `workflow_runs`.)

### Chunk 14b — Inspectors + Studio chat panel + draft hydration

**Spec sections owned:** §3.3 (`workflow_drafts` lifecycle), §10.3 (four A's inspectors, Ask inspector deep-dive), §10.6 (Studio chat panel), §10.7 (Studio handoff with draft hydration via `?fromDraft=:draftId`).

**Scope.** Slide-out inspectors per step type (Agent, Action, Approval, Ask). Studio chat panel docked bottom-left, expand to side panel for big restructures via diff card. Draft hydration on canvas open via `?fromDraft=:draftId`. Discard endpoint for the operator-side dismiss flow.

**Out of scope.** Canvas + bottom bar + publish flow (Chunk 14a). Visual node-graph editor (out). "Explain this workflow" inline explanations (V2).

**Files to create:**

- `client/src/components/studio/StudioInspector.tsx` — slide-out container, mount inside the canvas placeholder from 14a.
- `client/src/components/studio/inspectors/AgentInspector.tsx` — Agent step inspector (per mock 04).
- `client/src/components/studio/inspectors/ActionInspector.tsx` — Action step inspector.
- `client/src/components/studio/inspectors/AskInspector.tsx` — Ask inspector with five sub-states (per mock 09): default, Who-can-submit dropdown, Auto-fill dropdown, Add-a-field picker, edit-field-detail.
- `client/src/components/studio/inspectors/ApprovalInspector.tsx` — Approval inspector with confidence preview + audit-on-decision footnote (read-only).
- `client/src/components/studio/StudioChatPanel.tsx` — docked pill bottom-left; expands to left side-panel; agent diff cards with Apply / Discard.
- `server/services/workflowDraftService.ts` — `workflow_drafts` CRUD: `create({ payload, sessionId, subaccountId, organisationId, draftSource })`, `findById`, `markConsumed`, `listUnconsumedOlderThan` (for the cleanup job in Chunk 16). Decision 14: `draftSource` is required; V1 callers always pass `'orchestrator'`.
- `server/routes/workflowDrafts.ts` — `GET /api/workflow-drafts/:draftId` (Studio reads on `?fromDraft` open), `POST /api/workflow-drafts/:draftId/discard` (operator discard from chat).

**Files to modify:**

- `client/src/pages/StudioPage.tsx` (from 14a) — add the `?fromDraft=:draftId` hydration on mount; calls `GET /api/workflow-drafts/:draftId` and seeds canvas state.
- `client/src/components/studio/StudioCanvas.tsx` (from 14a) — wire the inspector slide-out mount-point to the new components.

**Contracts pinned in this chunk:**

```typescript
// GET /api/workflow-drafts/:draftId
// 200: { id, payload, sessionId, subaccountId, draftSource, createdAt, updatedAt, consumedAt }
// 404: { error: 'draft_not_found' }
// 410: { error: 'draft_consumed', consumed_at }                          // already published / discarded

// POST /api/workflow-drafts/:draftId/discard
// 200: { discarded: true }
// 410: { error: 'draft_consumed', consumed_at }
// 404: { error: 'draft_not_found' }
```

**Error handling:**

- 410 draft consumed: render "This draft was already used or discarded. Start fresh?".
- Inspector validation errors: per-field inline (mirrors the Chunk 2 validator output shape).

**Test considerations:**

- `workflowDraftServicePure.test.ts` — pure draft hydration + provenance handling (`draftSource` round-trips correctly).
- Inspector behaviour: visual / interaction states validated against mockups manually (per `CLAUDE.md` / spec §17.5 frontend-tests-deferred posture).

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/workflowDraftServicePure.test.ts`

**Acceptance criteria:**

- Four A's inspectors match mock 04 + mock 09 (Ask sub-states).
- Studio chat panel docks bottom-left; expand-to-side works; diff card Apply / Discard wired.
- Draft hydration on `?fromDraft=:draftId` populates the canvas; `draft_source = 'orchestrator'` round-trips.
- Discarding a draft sets `consumed_at`; subsequent reads return 410.

**Dependencies:** Chunk 14a (canvas + publish). Chunk 10 (User / Team pickers consumed by AskInspector / ApprovalInspector).

### Chunk 15 — Orchestrator changes

**Spec sections owned:** §13 (full): suggest-don't-decide pattern, draft hydration into Studio (server side; Chunk 14 owns the hydration UI), milestone reporting in chat, `workflow.run.start` skill.

**Scope.** Extend the existing orchestrator (`orchestratorFromTaskJob.ts` + chat-triage classifier) with:
1. Cadence-signal detection on the operator's prompt.
2. Recommendation card emission after task completion if signals score high.
3. Draft creation into `workflow_drafts` when intent looks workflow-shaped or when operator explicitly says "make this a workflow".
4. Per-agent `agent.milestone` event emission with attribution + link.
5. New `workflow.run.start` skill registered in `actionRegistry.ts` AND `SKILL_HANDLERS` (`DEVELOPMENT_GUIDELINES.md` §8.23 — both in the same commit).

**Out of scope.** Studio-side hydration UI (Chunk 14). Sub-agent reasoning trace surfacing in milestones (existing primitive). V2 workflow promotion ("promote agent run to workflow" — V2).

**Files to create:**

- `server/services/orchestratorCadenceDetectionPure.ts` — pure cadence detection. Inputs: prompt text + run history aggregates. Output: `{ score: number, signals: Array<{ name, weight }> }`. NLP heuristics per spec §13.1 (cadence cues like "every Monday", "weekly"; calendar phrasing; prior-run lookups).
- `server/services/orchestratorMilestoneEmitterPure.ts` — pure helper deciding whether a state change is a milestone (file produced, decision made, hand-off complete, plan changed materially) vs narration.
- `server/services/workflowRunStartSkillService.ts` — handler for the new skill. Validates `workflow_template_id` exists + caller has run-permission on its subaccount; resolves version (latest published unless pinned via `template_version_id`); creates a `tasks` row; starts the workflow run (passing the new `taskId` per pre-chunk P1 enforcement); returns `{ ok: true, task_id }` or structured error.

**Files to modify:**

- `server/jobs/orchestratorFromTaskJob.ts` — extend with:
  - Cadence-signal detection on the task's prompt.
  - Recommendation card emission via `taskEventService.appendAndEmit` with kind `chat.message` + a structured payload that the open task view's chat panel renders as a recommendation card (front-end logic in Chunk 11).
  - Draft creation: when intent classifier returns "workflow-shaped", call `workflowDraftService.upsertBySession` with the chat session_id + a payload (the orchestrator's draft step list).
- `server/services/skillExecutor.ts` — add `workflow.run.start` to `SKILL_HANDLERS`.
- `server/config/actionRegistry.ts` — register `workflow.run.start` (idempotency strategy: `keyed_write` with key on `(workflow_template_id, principal.userId, normalised_initial_inputs)`).
- Chat-triage classifier (existing) — extend to detect (a) "make this a workflow" intent, (b) file-edit intent (Chunk 13 also touches this).
- Per-agent skill / scope code — every sub-agent that completes a milestone-class action calls `emitMilestone(summary, linkRef)` helper. This is a fan-out across many existing skills; identify the call sites at chunk-time.

**Contracts pinned in this chunk:**

```typescript
// workflow.run.start skill input/output (spec §13.4)
{
  name: 'workflow.run.start',
  input: {
    workflow_template_id: string;
    template_version_id?: string;
    initial_inputs: Record<string, unknown>;
  },
  output:
    | { ok: true; task_id: string }
    | { ok: false; error: 'permission_denied' | 'template_not_found' | 'template_not_published' | 'inputs_invalid' | 'max_workflow_depth_exceeded'; message: string };
}

// Workflow-depth guard (spec §13.4)
// MAX_WORKFLOW_DEPTH = 3 (configurable per-org via existing limits-config).
// Depth is a hard safety boundary, not a business rule. It exists to prevent
// unbounded recursive workflow fan-out — runaway orchestration, not policy
// enforcement. Per-org limits-config can lower the cap, never raise it above 3.
// Depth carried via principal context's workflow_run_depth integer; persisted on
// workflow_runs.metadata.workflow_run_depth so the cap propagates transitively.
// Top-level runs have depth = 1; child_depth = parent_depth + 1.
//
// MANDATORY: every orchestrator entry point — orchestratorFromTaskJob,
// workflow.run.start skill handler, every async pg-boss job that spawns or
// continues a workflow run, every WebSocket-triggered run dispatch, every
// retry path — MUST validate that `context.workflowRunDepth != null` at the
// top of the function and throw `MissingWorkflowDepthError` if absent. The
// throw is a deliberate fail-fast, not a fallback to depth=1, because a
// missing depth signals a propagation bug that would otherwise silently
// bypass MAX_WORKFLOW_DEPTH (the cap relies on every spawn site reading +
// incrementing depth from the parent context). The principal context's
// TS type makes `workflowRunDepth: number` non-nullable at construction;
// the runtime check defends against any historic call site that
// constructed the context with a Partial<> shape.

// Recommendation card payload (rendered in the open task view's chat panel as a structured card)
{
  kind: 'chat.message',
  payload: {
    authorKind: 'agent',
    authorId: '<orchestrator-id>',
    body: 'This looks like something you'd want every Monday. Save it as a scheduled Workflow?',
    cardKind: 'workflow_recommendation',
    cardActions: [
      { id: 'accept', label: 'Yes, set up' },
      { id: 'decline', label: 'No thanks' }
    ]
  }
}
```

**Error handling:**

- `workflow.run.start` permission denial: structured error per output union.
- `workflow.run.start` depth-cap exceeded: structured error `max_workflow_depth_exceeded`; emit `workflow.run_depth_exceeded` to agent execution log.
- Cadence-detection failure: log; do not surface a recommendation. Fail-quiet.
- Draft creation fails (RLS, FK, etc.): log; orchestrator continues without offering Studio handoff.

**Test considerations:**

- `orchestratorCadenceDetectionPure.test.ts` — every signal in §13.1; threshold tuning.
- `orchestratorMilestoneEmitterPure.test.ts` — every milestone-vs-narration boundary.
- `workflowRunStartSkillPure.test.ts` — inputs validation, version resolution.
- `workflowRunStartDepthGuardPure.test.ts` — depth=1 → child=2 ok; depth=2 → child=3 ok; depth=3 → child=4 rejected with `max_workflow_depth_exceeded`; depth-cap configurable per-org. (Top-level runs start at depth=1 per the depth contract above; depth=0 is invalid at orchestrator entry — that case is covered by the entry-guard test, not this depth-cap test.)

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/orchestratorCadenceDetectionPure.test.ts`
- `npx tsx server/services/__tests__/orchestratorMilestoneEmitterPure.test.ts`
- `npx tsx server/services/__tests__/workflowRunStartSkillPure.test.ts`

**Acceptance criteria:**

- Cadence-signal recommendation surfaces only after task completion (not mid-flight).
- Drafts persist with `(subaccount_id, session_id)` UNIQUE.
- Milestone events emit per-agent; narration stays in activity (does not leak to chat).
- `workflow.run.start` skill is reachable from any agent with run-permission on the target subaccount; both ACTION_REGISTRY and SKILL_HANDLERS registered.
- `workflow.run.start` enforces `MAX_WORKFLOW_DEPTH` (default 3); depth-guard test passes; depth propagates via `workflow_runs.metadata.workflow_run_depth` and the principal context.
- **Depth fail-fast at orchestrator entry:** every orchestrator entry point validates `context.workflowRunDepth != null && context.workflowRunDepth >= 1` and throws `MissingWorkflowDepthError` if absent or `InvalidWorkflowDepthError` if < 1. New unit test `workflowRunDepthEntryGuard.test.ts` asserts: (a) entry with depth in `[1, MAX_WORKFLOW_DEPTH]` proceeds, (b) entry with `null`/`undefined` depth throws `MissingWorkflowDepthError`, (c) entry with depth < 1 throws `InvalidWorkflowDepthError`, (d) entry with depth > MAX is rejected by the existing depth-cap path (separate test). Covers all entry points named in the depth contract above (orchestratorFromTaskJob, workflow.run.start, every async pg-boss job that spawns/continues a run, every WebSocket-triggered dispatch, every retry path).
- Workflow-run creation in this chunk passes `taskId` into `WorkflowRunService.startRun` (per pre-chunk P1 enforcement); typecheck catches any caller that omits it.

**Dependencies:** pre-chunk (P1's `taskId` enforcement at `WorkflowRunService.startRun`), Chunks 9 (`agent.milestone` + `chat.message` event kinds), 14b (`workflow_drafts` table + service).

### Chunk 16 — Naming cleanup + cleanup job

**Spec sections owned:** §15 (full): Brief → Task UI rename. §16.3 #35a: `workflow_drafts` cleanup job. §18 (final migration polish + telemetry registry entries).

**Scope.** Smallest item in the build punch list. UI string + nav + route + redirect. Cleanup job for unconsumed `workflow_drafts` rows older than 7 days. Final telemetry-registry entries for the new event kinds. **Telemetry/analytics alias pass for the Brief→Task rename** (see "Telemetry continuity" below). Final pass on docs (`architecture.md` Key files per domain, etc.) per `docs/doc-sync.md`. **Does NOT include the run-scoped pause/resume/stop alias removal** — pre-chunk P3 did a clean replace (no aliases), so there is nothing to clean up here.

**Telemetry continuity (round-3 addition).** Renaming "brief" to "task" in user-visible copy is safe; renaming or breaking analytics event names that downstream dashboards / funnels depend on is not. At chunk-time, audit the telemetry / analytics surface (`server/services/analyticsService.ts`, `client/src/lib/analytics/*`, any prom-client metric labels referencing `brief_*`) and decide per-event:

- **Keep the legacy event name as-is** — easiest; downstream dashboards continue working; add a one-line code comment noting the legacy name predates the Task rename. Default for high-traffic events with active dashboards.
- **Rename and add an alias mapping in the telemetry layer** — emits both names for a deprecation window (e.g., 90 days), then drops the legacy name. Use only when a stakeholder has already asked for the new name in dashboards. Requires a follow-up calendar reminder routed to `tasks/todo.md`.

Decision per-event captured in the chunk PR description. The audit plus the per-event decision is the deliverable; the actual rename (where chosen) lands in the same PR.

**Files to create:**

- `server/jobs/workflowDraftsCleanupJob.ts` — pg-boss cleanup. Runs daily. SQL: `DELETE FROM workflow_drafts WHERE consumed_at IS NULL AND created_at < now() - interval '7 days'`. Mirrors `priorityFeedCleanupJob.ts` shape.

**Files to modify** (verified against `client/src/` at plan-gate time; see §15.4 of the spec for the full ground-truth list):

- `client/src/components/sidebar/*` — "Briefs" → "Tasks" in the nav entry label.
- `client/src/pages/BriefDetailPage.tsx` → rename to `TaskDetailPage.tsx`, OR merge into `OpenTaskView.tsx` from Chunk 11 (architect picks). Note: `BriefsPage.tsx` does NOT exist — earlier plan revisions listed it in error.
- `client/src/components/global-ask-bar/GlobalAskBar.tsx` + `GlobalAskBarPure.ts` — update operator-visible strings ("brief" → "task"). The "new task" entry-point lives in this global bar; there is no `NewBriefModal.tsx` (earlier plan revisions listed it in error).
- `client/src/components/brief-artefacts/*` — internal directory name stays. Update user-visible strings inside ApprovalCard / StructuredResultCard / ErrorCard where they say "brief".
- `client/src/components/TaskModal.tsx` — audit user-visible strings.
- `client/src/App.tsx` line 361 — actual existing route is `<Route path="/admin/briefs/:briefId" element={<BriefDetailPage ... />} />`. Add `/admin/tasks/:taskId` as the new canonical route, keep `/admin/briefs/:briefId` as a 301 redirect. The `/admin/` prefix is preserved (earlier plan revisions wrote `/briefs/:id` → `/tasks/:id` which would not match the actual route).
- `server/templates/email/*` — string-replace "brief" → "task" where user-facing. Internal column references (e.g., `tasks.brief` content column) stay.
- i18n / translation files (if any) — update keys + values.
- `server/index.ts` — register the cleanup job worker.
- `architecture.md` § Key files per domain — add Workflows V1 entries (open task view page, Studio page, gate service, task event service, etc.). Per `docs/doc-sync.md`.
- `docs/capabilities.md` — extend the Workflows entry with V1 capabilities (vendor-neutral, per editorial rules — no engineering jargon).

**Contracts pinned in this chunk:**

- Redirect: `GET /admin/briefs/:briefId` → 301 to `/admin/tasks/:taskId` (`/admin/` prefix preserved per actual existing route at `App.tsx` line 361). Server-side route or client-side React Router redirect — architect picks at chunk-time. Both work.
- Cleanup job: runs daily at 03:00 UTC (mirroring existing cleanup-job pattern). Reaps drafts older than 7 days with `consumed_at IS NULL`.

**Error handling:**

- Cleanup job failure: log + retry per pg-boss policy. Drafts accumulate one extra day; non-critical.
- Redirect failure (route not registered): existing fallback `/tasks` route renders an empty state — graceful.

**Test considerations:**

- `workflowDraftsCleanupJobPure.test.ts` — pure SQL query construction.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/jobs/__tests__/workflowDraftsCleanupJobPure.test.ts`

**Acceptance criteria:**

- Sidebar / breadcrumb / page titles all say "Tasks" not "Briefs".
- `/admin/briefs/:briefId` redirects to `/admin/tasks/:taskId`.
- Email templates use "task" in user-facing copy.
- Cleanup job reaps unconsumed drafts after 7 days.
- `architecture.md` and `docs/capabilities.md` updated.
- Telemetry continuity audit completed; per-event decisions (keep-as-is vs alias-and-rename) captured in the PR description; any chosen renames land in this chunk with the alias mapping in place.

**Dependencies:** Chunks 11 (Tasks page lives in OpenTaskView), 14b (drafts service exists). (No dependency on pre-chunk: pre-chunk's route migration was a clean replace, not an alias-then-cleanup.)

---

## Risks and mitigations

Risks specific to this phase. The Chunk 1–8 risks from the predecessor plan ([`tasks/builds/workflows-v1/plan.md` § Risks](../workflows-v1/plan.md)) still apply where the relevant code paths are touched in Chunks 9–16 — review them when beginning each chunk.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Pre-chunk migration rename + edit collides with a developer's local DB.** Someone may have run the original `0270_workflows_v1_additive_schema.sql` against a local dev DB before this plan starts. | Medium (depends on team-size + dev habits) | Local: low (drop the row from `schema_migrations` + drop affected tables + re-run; or drop entire local DB and re-migrate). Shared/staging: high (would require coordinated schema-migrations cleanup). | Communicate "do not run the workflows-v1 additive migration anywhere yet" before pre-chunk starts. The pre-chunk PR description explicitly states the rename + content amendment ("0270_workflows_v1_additive_schema.sql renamed to 0276_; if you've already applied the 0270-named version locally, drop the row from `schema_migrations` and the affected tables, then re-run `npm run migrate`"). Verified at plan-authoring: the user confirmed no migrations have run. |
| **Renaming the workflows-v1 migration from 0270 to 0276 breaks any reference doc / build script that hard-codes the old filename.** | Low (search across `docs/`, `scripts/`, agent definitions, KNOWLEDGE.md) | Low (cosmetic; broken link). | At rename time, run `grep -rn "0270_workflows_v1_additive_schema" --include="*.md" --include="*.sh" --include="*.ts" .` and update each match. Skip matches inside `tasks/review-logs/` and `tasks/builds/workflows-v1/` — those are point-in-time records and should NOT be retroactively edited (per the "never edit existing review logs" convention). The renamed plan-of-record is `tasks/builds/workflows-v1-phase-2/plan.md` (this file). |
| **`step.awaiting_approval` event kind drifts from the engine's `reviewKind` derivation.** Engine code at [workflowEngineService.ts:1588](../../../server/services/workflowEngineService.ts#L1588) derives `reviewKind` from `SPEND_ACTION_ALLOWED_SLUGS.includes(actionSlug)`. Chunk 9's task event reuses the same derivation. If a future change moves the slug check, the two paths could diverge. | Low | Medium (UI shows wrong pill kind). | Chunk 9 emits the task event from inside the same code block where `reviewKind` is computed (single source of truth), passing the already-derived value. Do NOT re-compute it in `taskEventService` — accept it as a parameter. The unit test asserts the engine call site passes `reviewKind` directly from the in-scope variable, not from a re-derivation. |
| **`workflow_runs_one_active_per_task_idx` rejects a run-creation INSERT from an existing scheduler / orchestrator path that previously assumed it could create a second active run on the same task.** Pre-existing code may not handle the constraint violation. | Low (no current path is known to create concurrent runs on the same task; the spec treats one-task-one-active-run as an invariant) | Medium (caller surfaces 5xx instead of structured 409 if not caught). | `WorkflowRunService.startRun` is the single chokepoint that wraps the INSERT in try/catch and converts SQLSTATE `23505` → `TaskAlreadyHasActiveRunError` → 409. **The direct-INSERT audit is now a P1 acceptance criterion** (not a soft mitigation here): `grep -rn "insert.*workflow_runs\|INSERT INTO workflow_runs" server/` must return zero matches outside the service. New integration test `workflowRunStartUniqueIndex.integration.test.ts` (in P3) is the regression guard. |
| **Pre-chunk P3 route replace breaks a dev-mode UI prototype that hits the run-scoped routes.** Devs who've prototyped against the V1-shipped routes will see 404s. | Low (no consumer code committed; only ad-hoc dev experiments at risk) | Low (404 surfaces immediately). | The pre-chunk PR description names the route shape change explicitly. CI surfaces any committed reference via lint / typecheck. |
| **P5 confidence cut-points slip past Chunk 11 start.** Architect doesn't get to it in time. | Medium | Medium (Chunk 11 ships with chip hidden behind feature flag — usable but reduced product surface). | Built-in mitigation: feature flag `SHOW_CONFIDENCE_CHIP=false`. Chunk 11 detail names this explicitly. Backstop: ship Chunk 11 without the chip; flip the flag in a separate small PR once P5 lands. |
| **Chunk 9 latency budget (p95 < 200ms) misses on the synthetic 1000ev/s test.** | Medium | High (chunk does not merge if budget missed). | Pinned mitigation order: batch WebSocket emit, drop non-critical events, shard per-task counter (V2). All three are codified in Chunk 9's "Failure mode" subsection. |
| **WebSocket pool-fingerprint mismatch loops cause duplicate REST fetches.** Chunk 11 fetches the full snapshot on every `pool_refreshed` arrival; if the fingerprint doesn't stabilise (e.g., sort order non-deterministic), the client fetches in a loop. | Low | Medium (extra REST traffic; not a correctness bug). | The fingerprint algorithm is specified deterministically: `sha256(sortedJoinedIds).slice(0, 16)` (64-bit truncation; collision probability negligible). UUIDs are normalised to lowercase + sorted before joining, both at write-time (per the new `approverPoolSnapshot.ts` constructor) and at fingerprint-time. Unit test in `approverPoolSnapshotPure.test.ts` asserts fingerprint stability across input permutations. |
| **Chunk 11's `useTaskProjection` reducer correctness regressions.** A non-idempotent reducer corrupts UI state when events replay. | Medium (reducer logic is non-trivial) | High (silent UI bugs across all task-view consumers). | Reducer is pure + extracted to `useTaskProjectionPure.ts`. Targeted unit tests cover idempotency: applying the same event twice produces the same state. Reconcile-on-reconnect rebuilds the projection from scratch. **Plus the periodic 5-minute full rebuild AND the 20-minute time-based full rebuild** (Chunk 11 reconciliation rule) bound silent reducer drift — the tick-based rebuild catches high-throughput tasks; the time-based rebuild self-heals low-throughput tasks where ticks are sparse. Without these, delta reconciliation alone would feed events through the same buggy reducer indefinitely. V2 deferred: server-computed projection hash for active divergence detection. |
| **Studio canvas concurrent-edit produces "lost update" pattern.** Two admins edit the same template simultaneously; second-to-publish overwrites the first. | Medium | Medium (operator-recoverable: admin reviews diff via the existing version-history surface). | Optimistic concurrency check at publish-time using `expectedUpstreamUpdatedAt`; mismatch → 409 with banner. Admin can choose Publish-anyway or Cancel. Spec §10.5 explicitly accepts last-write-wins as the V1 model. |
| **Orchestrator depth cap wraps to 4 if a child workflow's `workflow.run.start` skill is called from inside a sub-agent skill (not directly).** | Low | High (uncapped fan-out). | Depth carried via principal context AND persisted on `workflow_runs.metadata.workflow_run_depth`. Chunk 15 acceptance criterion includes a depth-guard test that asserts depth=3 → child=4 is rejected. The principal-context propagation is covered by the existing principal-context test suite. |
| **Brief → Task naming cleanup misses a user-visible string.** | High (rename is fan-out across many files) | Low (cosmetic; trivial follow-up). | `client/src/components/sidebar/*` + `server/templates/email/*` are the high-traffic surfaces — focused review. Lower-traffic surfaces (less-used pages, internal directory names) explicitly stay as "brief" per Chunk 16 spec. |

---

---

## Spec coverage map (continuation)

This map covers spec sections owned by the pre-chunk phase + Chunks 9–16. For Chunks 1–8 spec mapping, see the predecessor plan's [Spec coverage map](../workflows-v1/plan.md).

| Spec section | Chunk(s) | Notes |
|---|---|---|
| §3.1 (`workflow_runs.task_id` FK) | pre-chunk P1 | Implicit in spec line 1406; not enumerated in §3.1 table; closed in pre-chunk via the workflows-v1 additive migration (renamed `0270 → 0276` in P1, then modified) |
| §5.1 Approver pool resolution (`task_requester` rebind) | pre-chunk P2 | Cleans up Chunk 5 V1 fallback once `workflow_runs.task_id` exists |
| §5.1.2 `/refresh-pool` → `approval.pool_refreshed` event | Chunk 9 | Emission deferred from Chunk 5; Chunk 9 owns the event taxonomy and transport |
| §6.1–§6.5 Confidence cut-points decision | pre-chunk P5 | `workflowConfidenceCopyMap.ts` + `workflowConfidenceServicePure.ts` thresholds; gates Chunk 11's chip surface |
| §7 Pause / Resume / Stop route shape | pre-chunk P3 | Replace run-scoped routes with task-scoped variants; clean replace, no aliases |
| §8.1 Connection model + replay + ordering invariants | Chunk 9 | |
| §8.2 Event taxonomy | Chunk 9 (taxonomy + validator + W1-F11 reduced-broadcast for pool IDs + W1-F4 snapshot normalisation + validator fail-fast on bad `event_origin` + round-4 `step.awaiting_approval` / `step.approval_resolved` for engine pending_approval branch) | `approval.queued`/`ask.queued`/`pool_refreshed` ship `poolSize + poolFingerprint`, not full ID list. New `step.awaiting_approval` carries `reviewKind` to surface spend-vs-action-call approvals on the task timeline. |
| §8.3 Per-pane subscription | Chunk 11 | |
| §8.4 Optimistic rendering | Chunk 11 | |
| §8.5 Latency budget | Chunk 9 (synthetic load test in verification) | |
| §9 Open task view UI | Chunk 11 | Mobile fallback V2 → deferred (see predecessor plan) |
| §10 Studio UI | Chunks 14a (canvas + publish), 14b (inspectors + chat panel + draft hydration) | |
| §11 Ask form runtime | Chunk 12 (route shape ships natively at `/api/tasks/:taskId/ask/...`) | File-upload + conditional fields V2 → deferred |
| §12 Files and conversational editing | Chunk 13 (route shape ships natively at `/api/tasks/:taskId/files/...`) | Side-by-side diff + non-adjacent-version diff V2 → deferred |
| §13 Orchestrator changes | Chunk 15 | |
| §14 Permissions model | Chunk 10 (incl. W1-F3 email enumeration mitigation operator decision) | Restricted-view V2 → deferred |
| §15 Naming cleanup | Chunk 11 (page-title + breadcrumb), Chunk 16 (full sweep + redirect + email) | |
| §16 Build punch list | Per chunk; effort estimates in [Chunk overview](#chunk-overview) | |
| §17 Test plan | Per chunk's "Test considerations" + "Verification commands" sections | Frontend tests V2 → deferred per `spec-context.md` |
| §18 Migration plan and telemetry | pre-chunk P1 (rename `0270 → 0276` + in-place edit of the workflows-v1 additive migration), Chunk 16 (final telemetry registry entries + doc sync) | |
| §19 Open spec-time decisions | pre-chunk P5 (confidence cut-points) + chunk-level architect calls | |

**Deferred items (carry-over from Chunks 1–8 review pipeline):** items in `tasks/todo.md` under sections "Deferred from pr-reviewer + adversarial-reviewer (workflows-v1) — 2026-05-03", "Deferred from spec-conformance review — workflows-v1 (2026-05-03)", and "Deferred from Workflows V1 Chunks 5–6 (2026-05-03)". Items folded into this plan are removed from the deferred-items list when their respective chunk merges:

- W1-F3 (email enumeration) → folded into Chunk 10 / A9.
- W1-F4 (UUID normalisation) → folded into Chunk 9 / A8.
- W1-F11 (pool-ID broadcast) → folded into Chunk 9 / A8.
- W1-spec19 (confidence cut-points) → folded into pre-chunk P5 / A5.
- REQ 6.4 (inlined seenPayload) → verified in pre-chunk P0 / A4.
- REQ 7.9 (route shape) → folded into pre-chunk P3 / A6.
- "Chunk 5 task_requester V1 fallback" → folded into pre-chunk P2 / A3.
- "Chunk 5 approval.pool_refreshed event" → folded into Chunk 9 / A8.
- "Chunk 6 minor quality cleanup" → remains deferred (cosmetic; not folded).

Polish-only items (W1-N1 spec §3.1 redundancy with §8.1, W1-N2 Chunk 0 spike effort accounting, W1-N3 spec §16.5 stale ~59d estimate, W1-N4 Risks markdown anchors, W1-pre-existing-1 docs note for `verify-rls-coverage.sh` authz gap) remain in `tasks/todo.md` and fold into the doc-sync sweep at finalisation.
