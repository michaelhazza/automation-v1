# Workflows — Development Spec (v1)

_Date: 2026-05-02_
_Status: pre-implementation. Implements `docs/workflows-dev-brief.md` v2._
_Branch: `claude/workflows-brainstorm-LSdMm`_
_Mockups: [`prototypes/workflows/`](../prototypes/workflows/index.html)_

---

## How this spec is organised

This spec implements the design intent captured in [`docs/workflows-dev-brief.md` v2](./workflows-dev-brief.md). The brief is the *what and why*; this spec is the *how*. Every section below lists concrete schema changes, engine rules, API surfaces, and UI components, with the relevant brief section and mockup file cross-referenced.

The 11 spec-level decisions resolved on 2026-05-02 (mobile scope, timeout behaviour, non-requester visibility, runaway protection, version pinning on schedules, default tab, concurrent editing, approver picker scoping, auto-fill behaviour, empty states, effort re-estimate) are folded into the relevant sections below.

This spec assumes:
- The engine, schema, and three system templates already exist (per brief §2).
- The brief is the source of truth on framing; the spec extends it but does not contradict it. If a conflict arises, the brief's design intent wins and this spec is corrected.
- Implementation chunks are decomposed by `architect` after spec-review lands; this document is the input to that step.

---

## Contents

1. [Summary, scope, related docs](#1-summary-scope-related-docs)
2. [Concepts and cross-references](#2-concepts-and-cross-references)
3. [Schema deltas](#3-schema-deltas)
4. [Engine — validator rules](#4-engine--validator-rules)
5. [Engine — approval routing, `isCritical`, state machine](#5-engine--approval-routing-iscritical-state-machine)
6. [Engine — confidence chip and audit fields](#6-engine--confidence-chip-and-audit-fields)
7. [Engine — cost and time runaway protection](#7-engine--cost-and-time-runaway-protection)
8. [Real-time coordination — WebSocket and event taxonomy](#8-real-time-coordination--websocket-and-event-taxonomy)
9. [Open task view UI](#9-open-task-view-ui)
10. [Studio UI](#10-studio-ui)
11. [Ask form runtime](#11-ask-form-runtime)
12. [Files and conversational editing](#12-files-and-conversational-editing)
13. [Orchestrator changes](#13-orchestrator-changes)
14. [Permissions model](#14-permissions-model)
15. [Naming cleanup — Brief → Task](#15-naming-cleanup--brief--task)
16. [Build punch list and effort estimates](#16-build-punch-list-and-effort-estimates)
17. [Test plan](#17-test-plan)
18. [Migration plan and telemetry](#18-migration-plan-and-telemetry)
19. [Open spec-time decisions](#19-open-spec-time-decisions)

---

## 1. Summary, scope, related docs

### 1.1 What this spec covers

The implementation contract for the Workflows V1 build defined in [`docs/workflows-dev-brief.md`](./workflows-dev-brief.md) v2. Concretely:

- The **operator surface** for tasks in flight (open task view, three-pane layout with Now / Plan / Files tabs, real-time multi-pane coordination, milestone-shaped chat).
- The **authoring surface** (Studio canvas, four A's inspectors, publish notes, Studio handoff with preview, version pinning on schedules).
- The **runtime surfaces** for the four A's, with particular depth on Approval (audit fields, confidence chip, `isCritical` routing) and Ask (form-card primitive in the chat panel, plus the four-way submitter routing).
- A small set of **schema additions** (approver routing, teams, `isCritical`, `publish_notes`, audit fields, `seen_payload`, schedule version pinning).
- **Orchestrator changes** that close the brief's strategic test (suggest-don't-decide for "do once vs repeat", draft hydration into Studio, milestone reporting in chat).
- **Permissions model** for approver and Ask-submitter pickers, scoped to sub-account and the calling user's role.
- The **naming cleanup** (Brief → Task as a UI noun; schema unchanged).
- A **test plan, migration plan, and telemetry plan**.

### 1.2 What this spec does NOT cover

- Mobile / phone-responsive layouts. V1 is desktop-first (default per spec-time decision #1, brief §15). A read-only single-pane fallback for tablet/phone is V2.
- Visual node-graph drag-and-drop authoring (permanently out of scope, brief §3).
- Inline human editing of files (V2; conversational editing is the V1 path, brief §9.3).
- Workflow → workflow direct nesting (permanently disallowed; agent-layer indirection allowed, brief §4.3).
- Webhook triggers (V2, brief §12).
- General `while` / `do-until` loops (permanently disallowed; Approval-on-reject covers the legitimate cases, brief §5.3).
- Cost dashboards across workflows / templates (V2, brief §12).
- Run-history search across sub-accounts (admin tooling, V2, brief §12).
- Timeout escalation policies (only stall-and-notify-requester at 24h / 72h / 7d in V1, per spec-time decision #2).

### 1.3 Related documents

| Document | Purpose | Relationship to this spec |
|---|---|---|
| [`docs/workflows-dev-brief.md`](./workflows-dev-brief.md) | Design intent (v2) | This spec implements every committed item in the brief. |
| [`prototypes/workflows/`](../prototypes/workflows/index.html) | Mockup index | Each UI section below references the relevant mockup file. |
| [`docs/frontend-design-principles.md`](./frontend-design-principles.md) | Consumer-simple UI principles | All UI surfaces in this spec must conform; copy passes apply (no em-dashes in app-facing text, plain-language labels, no engineering jargon in operator-visible strings). |
| [`docs/spec-authoring-checklist.md`](./spec-authoring-checklist.md) | Spec authoring rigour | This spec is reviewed against the checklist before `architect` decomposes. |
| [`KNOWLEDGE.md`](../KNOWLEDGE.md) | Project corrections + patterns | Two recent corrections apply directly: activity-ordering is "events flow top-down with auto-scroll" (not `flex-col justify-end`); timestamps use `Xs ago` format. |

### 1.4 Spec-time decisions resolved (2026-05-02)

These resolve the brief's open questions and the spec-finalisation pass:

| # | Decision | Default applied | Drives |
|---|---|---|---|
| 1 | Mobile / tablet scope | Desktop-first V1; read-only single-pane fallback in V2 | UI scope |
| 2 | Approval / Ask timeout | Stall (no auto-fail), with notification to requester at 24h / 72h / 7d | Engine state machine + notification cadence |
| 3 | Non-requester submitter visibility | Full task view (chat, activity, files); workflow-author can opt into "restricted" mode in V2 | Permissions model |
| 4 | Cost / time runaway protection | Visible Pause / Stop buttons; engine auto-pause at $5 per-run cost ceiling and 1h wall-clock cap (both configurable per workflow) | Engine + UI |
| 5 | Workflow template versioning on schedules | Default "next run uses new"; opt-in "Pin to version vN" toggle on the schedule | Engine + Studio + schedule editor |
| 6 | Empty states | "Task created" event in activity at second zero; Plan tab shows "Drafting…" placeholder; Files tab shows "Nothing produced yet" | UI |
| 7 | Default right-pane tab on task open | Plan, always (content adapts to task complexity per §9) | UI |
| 8 | Concurrent editing in Studio | Last-write-wins with "this template was updated by [user] while you were editing" warning before publish | Engine + Studio |
| 9 | Approver / Ask-submitter picker scoping | Permission-aware: org admin/manager sees org users + sub-account users; sub-account admin sees only their sub-account users | API + UI per §14 |
| 10 | Auto-fill on schema-changed workflow | Pre-fill matching fields, leave new ones blank, no warning | UI per §11 |
| 11 | Effort re-estimate after v2 additions | ~12-16 weeks for V1 (sanity-check by architect on decomposition) | Build planning |

---

## 2. Concepts and cross-references

### 2.1 The four user-visible primitives (brief §4.1)

| Primitive | What it is | Surface |
|---|---|---|
| **Task** | A unit of work in flight. Has agents, status, activity log, files. | Open task view (mock 07, 08) |
| **Workflow** | A reusable task template. Fired manually, by schedule, or by an agent. Each firing creates a Task. | Studio for authoring (mocks 04, 05, 09); Workflow library for browsing |
| **Schedule** | A cron rule. Fires either an agent (one-off task) or a workflow (templated task) on cadence. | Schedule editor (deferred mockup) |
| **Agent** | An entity with persona, skills, and memory. Runs inside a task or as a step inside a workflow. | Existing AdminAgentEditPage / SubaccountAgentEditPage |

Engine vocabulary that does NOT surface to the operator: skills, step runs, template versions, side-effect classes, idempotency keys, bulk run modes, briefs.

### 2.2 The four A's — step types (brief §4.2)

| User-facing | Engine type | Author picks a skill? |
|---|---|---|
| **Agent** | `agent_call` (or `prompt` for inline ad-hoc agent) | No (the agent picks skills at runtime) |
| **Action** | `action_call` (skill) or `invoke_automation` (external) | Yes |
| **Ask** | `user_input` | No (author writes form schema) |
| **Approval** | `approval` | No (author picks approvers; humans only) |

Branching is **not** a step type. It's an output property of any step that produces a value (brief §5.1).

### 2.3 Mockup index (the spec's reference set)

| Mockup | Spec sections that reference it |
|---|---|
| [`prototypes/workflows/04-four-as-step-types.html`](../prototypes/workflows/04-four-as-step-types.html) | §10 (Studio four A's inspectors), §5 (`isCritical` author toggle), §6 (confidence preview, audit fields) |
| [`prototypes/workflows/05-studio-route-editor.html`](../prototypes/workflows/05-studio-route-editor.html) | §10 (Studio canvas), §5 (Critical pill on a step), §10 (publish-notes modal) |
| [`prototypes/workflows/07-open-task-three-panel.html`](../prototypes/workflows/07-open-task-three-panel.html) | §9 (open task view layout), §8 (real-time coordination), §11 (form-card placement) |
| [`prototypes/workflows/08-task-progression-states.html`](../prototypes/workflows/08-task-progression-states.html) | §9 (5 progression states), §13 (orchestrator narrative milestones) |
| [`prototypes/workflows/09-ask-step-authoring.html`](../prototypes/workflows/09-ask-step-authoring.html) | §10 (Ask inspector), §11 (form schema), §14 (submitter picker) |
| [`prototypes/workflows/10-ask-step-runtime.html`](../prototypes/workflows/10-ask-step-runtime.html) | §11 (form-card runtime, validation, submitted receipt, routing) |

### 2.4 Cross-references to brief sections

| Brief section | Spec section that implements it |
|---|---|
| §3.0 Strategic test | Implicit; every UI decision in this spec passes the "describe intent, don't build systems" test. |
| §4 Concepts and vocabulary | §2 (this section) |
| §5 Branching, parallel, loops | §4 (validator rules) + §9 (Plan-tab branch labels + "why this path") |
| §6 Operator surface | §9 (open task view) + §8 (real-time coordination) |
| §7 Studio | §10 |
| §7.5 Studio handoff with preview | §10.5 + §13 |
| §8 Approvals (incl. §8.5 isCritical, §8.6 confidence, §8.7 audit) | §5, §6 |
| §9 Files + conversational editing (incl. §9.4 diff, §9.5 files-at-scale) | §12 |
| §10 Integration story | Out of scope for this spec (reference-only) |
| §11 Build punch list | §16 (extended with v2 additions) |
| §12 Out of scope | §1.2 |
| §15 Open questions | §19 (carried-forward + spec-time additions) |

---

## 3. Schema deltas

All deltas are **additive**. No existing column is dropped. Existing system templates and runs continue to work unchanged. The migration is a single Drizzle migration file (one PR, one merge) plus the corresponding schema updates in `shared/schema/`.

### 3.1 New columns on existing tables

| Table | Column | Type | Default | Purpose |
|---|---|---|---|---|
| step-definition (the `params` JSON inside `workflow_template_steps` or equivalent — exact target table named at architect-time) | `is_critical` | `boolean` | `false` | Author-marked. When `true`, the step is auto-routed to Approval regardless of its declared side-effect class. Drives §5 routing + alert hooks. (brief §8.5) |
| `workflow_step_reviews` | `seen_payload` | `jsonb` | `null` | Snapshot of the parameters and rendered preview the approver actually saw at decision time. Snapshot-at-decision-time semantics are the contract; engine MUST NOT regenerate this from current state. (brief §8.7) |
| `workflow_step_reviews` | `seen_confidence` | `jsonb` | `null` | The confidence chip value (`high` / `medium` / `low`) and reason as rendered on the card at decision time. (brief §8.6) |
| `workflow_step_reviews` | `decision_reason` | `text` | `null` | Optional free-text from the approver. (brief §8.7) |
| `workflow_template_versions` | `publish_notes` | `text` | `null` | Optional one-line "what changed in this version?" captured by the Studio Publish modal. Surfaces in version history + Plan tab caption. (brief §7.4) |
| `workflows` (the workflow-template table) | `cost_ceiling_cents` | `integer` | `500` | Per-run cost cap (default $5). When breached, engine auto-pauses the run and surfaces a Pause card in chat. (spec-time decision #4) |
| `workflows` | `wall_clock_cap_seconds` | `integer` | `3600` | Per-run wall-clock cap (default 1h). Same pause behaviour as cost cap. (spec-time decision #4) |
| `schedules` (existing) | `pinned_template_version_id` | `uuid` | `null` | When non-null, scheduled runs use this exact version regardless of newer published versions. When null, "next run uses newest" (brief §7.4). (spec-time decision #5) |

### 3.2 New `approval` step `params` shape

The existing `approval` step type carries `approvalPrompt` and `approvalSchema`. The new fields land inside the same `params` JSON (no schema change to the step row itself):

```typescript
{
  approvalPrompt: string,            // existing
  approvalSchema: object,            // existing
  approverGroup: {                   // NEW
    kind: 'specific_users' | 'team' | 'task_requester' | 'org_admin',
    userIds?: string[],              // when kind === 'specific_users'
    teamId?: string                  // when kind === 'team'
  },
  quorum: number                     // NEW; default 1; engine validates at publish that quorum ≤ pool size
}
```

Same shape applies to **Ask** step `params` (the `user_input` engine type) — submitter routing reuses the same `approverGroup` structure under a `submitterGroup` key. One picker primitive, two step types using it. (brief §7.3, spec §14)

### 3.3 New tables

**None for V1.** The `teams` and `team_members` tables already exist in schema (brief §8.4); the build adds the missing CRUD UI page in Org settings. No new tables for `isCritical`, audit fields, confidence — all fit on existing tables.

### 3.4 Indexes

| Table | Index | Reason |
|---|---|---|
| `workflow_step_reviews` | composite `(workflow_run_id, step_id, created_at)` if not already present | Frequent lookup pattern: "all reviews for this step in this run, in order." |
| `schedules` | `pinned_template_version_id` | Cheap; admin queries for "all schedules pinned to v3 of template X". |

Verify both at architect-time; if either already exists, no-op.

### 3.5 What does NOT change in schema

- **No new tables** for tasks, workflows, runs, or any V1 surface.
- **No rename** of any existing column. The `tasks.brief` column stays (V1 nav cleanup is UI-only — see §15).
- **No new step types.** The four A's collapse is validator + Studio vocabulary only (brief §11.1 #2). `prompt`, `agent_call`, `user_input`, `approval`, `conditional`, `agent_decision`, `action_call`, `invoke_automation` all remain in the engine; the validator rejects publishes that use the deprecated user-facing names but accepts the underlying engine types from existing templates.
- **No migration** of existing system template rows. They continue to use their current `params` shapes; the new fields default to safe values (`is_critical: false`, `cost_ceiling_cents: 500`, etc.).

---

## 4. Engine — validator rules

The validator runs at template publish time. All rules below reject the publish (with a clear error) if violated. Rules apply in addition to whatever the engine validates today.

### 4.1 Four A's vocabulary (brief §4.2, §11.1 #2)

The validator accepts the user-facing names `Agent`, `Action`, `Ask`, `Approval` from the Studio. Internally, each maps to one or more engine step types:

| Studio user-facing | Engine step type(s) accepted |
|---|---|
| Agent | `agent_call`, `prompt` |
| Action | `action_call`, `invoke_automation` |
| Ask | `user_input` |
| Approval | `approval` |

The deprecated user-facing names `conditional`, `agent_decision`, `prompt` (as a top-level type) are rejected at publish — they're either folded into the four A's (e.g., a decision step is now an Agent step with branching as an output property) or replaced by Action.

**Existing system templates remain valid.** The validator accepts the legacy engine type names when they appear in templates that pre-date the four A's enforcement. New publishes through the Studio go through the four A's gate.

### 4.2 Branching as an output property (brief §5.1)

- Branching is **not** a step type. It's a property declared on any step that produces a value.
- The validator rejects any step typed as `conditional` or `agent_decision` (legacy types) when authored fresh through the Studio. Existing templates using these types remain valid; they should migrate to the new shape opportunistically (Studio "edit" upgrades them on save).
- Each branch has a label (e.g., `tier = "hot"`) and a target step. The validator confirms every branch's target step exists in the same template.
- Default is linear (continue to the next step). At least one path must exist after a branched step (the validator rejects "branched but no path defined").

### 4.3 Parallel: fan-out and fan-in only (brief §5.2)

- Fan-out: a step has multiple `next` arrows; engine dispatches in parallel.
- Fan-in: multiple steps converge into one `next`; engine waits for all upstream to complete.
- The validator rejects deeply-nested parallel sub-graphs. The shape stays flat enough to read on the canvas. Specifically: a fan-out target may not itself be a fan-out source on the same canvas level (architect to define "level" precisely; rule of thumb is "no more than one nesting depth").

### 4.4 Loops: only Approval-on-reject (brief §5.3)

- The validator rejects any backward edge that does not originate from an Approval step's `onReject` routing.
- The reject target must be a step that comes earlier in the linear order of the template (validator computes a topological ordering ignoring the reject edges; reject targets must have a lower order index than the Approval source).
- Action retries (`retryPolicy`) are engine-level and not validated as a "loop."

### 4.5 No workflow → workflow nesting (brief §4.3, §11.1 #5)

- The validator rejects any step that targets another `workflow.run.start` directly (i.e., a workflow step calling another workflow as the next step).
- Allowed: workflow → agent → workflow (the agent layer breaks the depth count). The validator confirms the agent step is a true `agent_call` with no inline workflow invocation.
- This rule is already enforced today; the spec is to confirm and add a regression test (§17).

### 4.6 Approval-step quorum check (brief §8.2, §8.3)

- Validator rejects publish if `approverGroup.kind === 'specific_users'` and `quorum > approverGroup.userIds.length`.
- For `kind === 'team'`, validator validates at runtime (team membership can change after publish) — if at run time `quorum > activeTeamMembers`, the engine surfaces an error in the Approval card and the run stalls until either quorum is achievable or the workflow is edited.
- For `kind === 'task_requester'`, quorum is forced to `1` at validate time (a single user; quorum > 1 is meaningless). Validator warns if author tried to set quorum > 1.
- For `kind === 'org_admin'`, no validation at publish (admin pool is large enough).

### 4.7 `isCritical` semantics (brief §8.5)

- Validator accepts `isCritical: true` on Agent and Action steps only. (Ask is already a human gate; Approval is already a human gate. Setting `isCritical` on those is meaningless and the validator rejects it with a hint.)
- No validator rule on which steps SHOULD be critical — author's call. The Studio inspector help text guides the author (irreversible side effects, high-cost ops, regulated actions).

### 4.8 Ask-step submitter group (brief §7.3, spec §14)

- Same shape as `approverGroup`. Same validator rules apply (quorum check, type-specific validation).
- Ask steps with `kind === 'task_requester'` are the most common; `kind === 'team'` and `kind === 'specific_users'` route via notification (§11).

---

## 5. Engine — approval routing, `isCritical`, state machine

### 5.1 Approver pool resolution (brief §8.2, §8.3)

When an Approval step queues, the engine resolves the eligible-approvers pool from `approverGroup.kind`:

| `kind` | Pool resolution |
|---|---|
| `specific_users` | The exact `userIds` array from the step. Validator confirms quorum ≤ length at publish (§4.6). |
| `team` | All members of `teams.id = teamId` who are not soft-deleted (`deletedAt IS NULL`). Resolved at gate-creation time (snapshotted into the review record so later membership changes don't invalidate an in-flight approval). |
| `task_requester` | `tasks.created_by_user_id`. Single user. |
| `org_admin` | All users in the org with `org_admin` role. Resolved at gate-creation time. |

When a user submits an approval decision, the engine:

1. Verifies the deciding user is in the snapshotted pool. **403 with a clear error message if not** (this fixes a real bug where today any authenticated user can decide on any approval).
2. Increments the decision count. If `approve` count ≥ `quorum`, the step transitions to `approved` and the workflow continues per `onApprove` routing.
3. If any single `reject` arrives, the step transitions to `rejected` immediately (a single rejection trumps multiple approvals — V1 simplification; V2 may add "rejection requires N rejecters").

### 5.2 `isCritical` routing (brief §8.5)

When the engine encounters a step (Agent or Action) with `is_critical: true`:

1. Before executing the step, the engine **synthesises an Approval gate** with these defaults:
   - `approverGroup.kind = 'task_requester'` (the operator who started the task is the default approver for critical steps).
   - `quorum = 1`.
   - The Approval card content shows the upcoming step's parameters and a confidence chip (§6).
2. The synthesised gate is recorded in `workflow_step_reviews` with a flag indicating it was `isCritical`-induced (so audit can distinguish author-placed Approvals from synthesised ones).
3. On approval, the original step executes. On rejection, the workflow stalls (no `onReject` route — author didn't define one for an implicit gate). The operator can edit the workflow or kill the run; spec-time decision #2 default applies.
4. If the author has explicitly placed an Approval before a critical step, the engine does NOT double-gate (one approval is sufficient). The validator warns the author at publish: "Step N is marked critical; the explicit Approval before it is redundant. Continue?"

### 5.3 State machine — stall-and-notify on Approval / Ask (spec-time decision #2)

When an Approval or Ask step queues and a human gate is open:

- **No timeout.** The task does not auto-fail.
- Engine schedules notification jobs to the task requester (per `tasks.created_by_user_id`):
  - **24 hours** after gate-open: *"Task X has been waiting on [approval / input] for 24 hours."*
  - **72 hours** after gate-open: same template, escalated subject line.
  - **7 days** after gate-open: same template, with a "Cancel this task?" affordance in the email.
- Each notification fires through the existing notification surface (review-queue / sidebar count + opt-in email per user prefs).
- Notification jobs are cancelled when the gate resolves (approved / rejected / submitted).
- **No auto-escalation in V1.** A future V2 may add per-step `escalateAfterHours` config; explicitly out of scope.

### 5.4 Engine entry-points modified

| File / function | Change |
|---|---|
| `agentExecutionService.ts` (gate resolution) | Add `isCritical` check; if true, synthesise an Approval gate before step execution. |
| Approval-decision endpoint (existing) | Add pool-membership check (5.1.1). Return 403 with structured error if user not in pool. |
| `workflow_step_reviews` insert path | Capture `seen_payload`, `seen_confidence`, `decision_reason`, `is_critical_synthesised` flag. |
| pg-boss schedule registration | Add stall-and-notify job scheduling (5.3) when a gate opens. Cancel jobs when gate resolves. |
| Schedule-fired run dispatch | Honour `schedules.pinned_template_version_id` if non-null (load that exact version instead of the latest published). |

Architect to verify exact file paths during decomposition; the brief and existing audit refer to `agentExecutionService.ts` as the gate-resolution site.

---

## 6. Engine — confidence chip and audit fields

### 6.1 Confidence score computation (brief §8.6)

Computed at gate-creation time (when an Approval queues), snapshotted with the gate, never re-computed. V1 is heuristic; V2 swaps in a calibrated model once `workflow_step_reviews` data accumulates.

**V1 inputs** (each contributes a numeric weight; final value is clamped to `low` / `medium` / `high`):

| Signal | Source | Weight |
|---|---|---|
| Count of similar past runs of this template that were approved without modification | `workflow_step_reviews` lookup by `template_version_id` + `step_id` | + (more = higher confidence) |
| Count of similar past runs that were rejected or required modification | same | − (more = lower confidence) |
| Step has `is_critical: true` | step definition | clamps to `medium` ceiling |
| Step's side-effect class is `irreversible` | step definition | clamps to `medium` ceiling |
| Branch decision was made on a low-confidence agent output (cascade) | upstream step's confidence | clamps to `low` |
| Skill / Action being used for the first time in this subaccount | subaccount run history | clamps to `low` |

The final classification mapping (high / medium / low cut-points) is **out of scope for this spec** and is an open spec-time decision (§19). Architect to pick after seeing 100+ Approval cards on internal data.

### 6.2 Confidence reason copy (brief §8.6, plain-language rule)

The confidence chip renders with a one-line reason. The reason copy is **plain operator language**, not the algorithm description. Engineering terms (`clamped`, `heuristic`, `threshold`, `score`) never reach the operator surface.

The render mapping (V1):

| Heuristic state | Chip + reason rendered on the card |
|---|---|
| Many similar past runs, no clamps | `High` · matches recent successful runs |
| `is_critical: true` on next step | `Medium` · the next step can't be undone, worth a careful look |
| `irreversible` side-effect class | `Medium` · this can't be undone once it runs |
| Cascade from low-confidence upstream | `Low` · the agent isn't sure about this one |
| First use in this subaccount | `Low` · first time running this here |
| Few past runs, mixed history | `Medium` · still learning what's normal here |

The full mapping is also stored in a copy table (data file or hard-coded constant); architect to pick the storage shape. The reason string is computed at gate-creation, snapshotted into `seen_confidence.reason`, and not regenerated.

### 6.3 The `seen_payload` snapshot (brief §8.7)

When an Approval gate queues, the engine snapshots the parameters and rendered preview the approver will see:

```typescript
seen_payload: {
  step_id: string,
  step_type: 'agent' | 'action' | 'approval',
  step_name: string,
  rendered_inputs: object,        // resolved bindings, e.g., { audience: "Tier A", tone: "Professional warm" }
  rendered_preview: string | null, // optional human-readable preview (e.g., the email body if this is a "send email" Action)
  agent_reasoning: string | null,  // for Agent steps with branching: the reasoning trace summary
  branch_decision: { ... } | null  // if upstream was a branched step, the resolved branch
}
```

This snapshot is **immutable**. If the engine queues an approval and then re-derives parameters later (e.g., the data shifted between approval and execution), the audit trail must reflect what the human authorised, not what later ran. The Plan tab caption and the audit drawer (Phase 2) render from `seen_payload`, never from current state.

### 6.4 Failsafe: confidence is decoration, not authority (brief §8.6)

`high` confidence does NOT skip the Approval. The human still clicks Approve. If we ever want auto-approval on `high`, that's a deliberate, separate design discussion — not a side effect of confidence shipping.

The engine does NOT short-circuit any gate based on the confidence value. It's purely a render hint on the card.

### 6.5 Where the audit fields surface

| Surface | What renders |
|---|---|
| Plan tab in the open task view, under the approved step | One-line caption: *"Approved by Daisy · 2:32 pm · view what she saw"* (link to `seen_payload` modal) |
| Run-history audit drawer (Phase 2) | Full audit record with snapshot, decision_reason, seen_confidence |
| Audit export (Phase 2) | All fields in CSV / JSON |

V1 ships the schema and the Plan-tab caption only. The audit drawer and export are Phase 2.

---

## 7. Engine — cost and time runaway protection

(Spec-time decision #4. Brief §1 mentions cost reservation but does not define operator-facing protection.)

### 7.1 Per-run caps

Two soft caps per workflow template, both stored on `workflows` (the template table):

| Column | Default | Range | Effect when reached |
|---|---|---|---|
| `cost_ceiling_cents` | `500` ($5) | `100`..`10000` ($1..$100) | Engine pauses the run; surfaces a Pause card in chat asking the operator to extend or stop. |
| `wall_clock_cap_seconds` | `3600` (1h) | `60`..`86400` (1m..24h) | Same pause behaviour. |

Both caps are configurable per template at publish time (Studio inspector "Run limits" section, deferred mockup). Operators cannot raise caps mid-run — the operator-facing pause card has only "Stop" and "Extend by Y minutes / $Y" with capped extensions (architect picks specific extension granularity).

### 7.2 Pause card surface

When the engine reaches a cap, it inserts a **Pause card** into the chat panel of the open task view (same primitive as Approval / Ask cards):

- Card content: *"This run has been going for 1h 12m and used $4.80. Continue?"*
- Buttons: `Stop run` (red, primary) · `Continue for another 30 minutes / $2.50` (secondary, capped extension).
- Activity log records the pause as a structured event (`run.paused.cost_ceiling` or `run.paused.wall_clock`).
- Plan tab marks the current step as paused (amber pill, distinct from the queued / working / done states).

The Pause card waits indefinitely (no auto-continue). If the operator never responds, the run stays paused. Notification cadence per §5.3 (24h / 72h / 7d to the requester).

### 7.3 Operator-initiated Pause / Stop

Two affordances live in the open task view header (mock 07 reference; not currently in the mockup but added per spec-time decision #4):

| Button | Behaviour |
|---|---|
| **Pause** | Same effect as a cap-triggered pause. Card lands in chat; operator (or another approver if routing is configured for resume) can resume / stop. |
| **Stop** | Immediate termination. Engine writes a `run.stopped.by_user` event with the actor's user id. Cleanup runs for any outstanding skill / Action calls (best-effort cancel; some external calls may have already fired and are not reversible). The task transitions to `failed` with reason `stopped_by_user`. |

Both buttons are visible to anyone with edit-access to the task (per §14 permissions). Read-only viewers don't see them.

### 7.4 Engine-level mechanics

- Cost is tracked per-run in an existing cost-reservation table (architect verifies; brief §1 mentions cost reservation as already-built infrastructure).
- On every step completion, the engine sums the run's accumulated cost; if `>= cost_ceiling_cents`, queue the Pause card and stop dispatching the next step.
- Wall-clock is checked on every step completion plus a periodic (e.g., 30-second) heartbeat job.
- Pause is **between-step**, not mid-step. A step in flight finishes (or errors out via its retry policy) before the cap takes effect. This avoids inconsistent partial state on irreversible side effects.

### 7.5 Telemetry

- `run.paused.cost_ceiling`, `run.paused.wall_clock`, `run.paused.by_user`, `run.stopped.by_user` events emit through the existing tracing registry (per brief §2.5).
- Cost-ceiling and wall-clock-cap incidents per workflow template are aggregated in the existing run telemetry; an admin can spot a template that pauses too often and tune its cap.

---

## 8. Real-time coordination — WebSocket and event taxonomy

(Brief §6.2. This is the feature that sells the product — sub-200ms event-to-render latency end-to-end across all three panes.)

### 8.1 Connection model

- **One WebSocket per open task**, not per pane. The client opens a single connection when the task page mounts and closes it on unmount.
- Connection authentication: existing session cookie / token. The server scopes events to tasks the user has visibility into (per §14 permissions).
- Reconnect-with-replay: if the WebSocket drops, the client resumes from the last seen `event_id`. Server replays missed events. **Does not** replay from task start; does not lose events.
- Backpressure: if the engine emits 50+ events in a burst (rare, but possible during a fan-out), the client batches the render to keep the frame rate smooth (architect picks specific batching window; rule of thumb: 60 fps cap on render).

### 8.2 Event taxonomy

All events share a common envelope:

```typescript
{
  event_id: string,             // monotonically increasing per task; used for replay cursor
  task_id: string,
  kind: string,                 // see table below
  timestamp: ISO8601,
  actor: { kind: 'user' | 'agent' | 'system', id: string, label: string },
  payload: object,              // kind-specific
  entity_refs: Array<{ kind: string, id: string, label: string }> // for activity-log linked chips
}
```

**Event kinds (V1):**

| Kind | When emitted | Payload notable fields | Where it renders |
|---|---|---|---|
| `task.created` | At task creation | requester, initial prompt | Activity (oldest event) |
| `task.routed` | Orchestrator routing decision | target agent / workflow | Activity |
| `agent.delegation.opened` | Agent delegated work to a sub-agent | parent_agent, child_agent, scope | Activity, Now (org-chart edge appears) |
| `agent.delegation.closed` | Sub-agent returned to parent | child_agent, summary | Activity, Now (status dot transitions) |
| `step.queued` | Workflow step queued for execution | step_id, step_type, params | Plan (step border activates) |
| `step.started` | Step began executing | step_id | Plan, Activity, Now |
| `step.completed` | Step finished successfully | step_id, outputs, file_refs[] | Plan (✓ done), Activity, Files (if file_refs non-empty), Now |
| `step.failed` | Step errored | step_id, error_class, error_message | Plan (red), Activity |
| `step.branch_decided` | A producing step's output resolved a branch | step_id, field, resolved_value, target_step | Plan (resolved label appears), Activity |
| `approval.queued` | Approval gate opened | step_id, approver_pool, seen_payload, seen_confidence | Chat (Approval card), Plan (current step indigo + confidence chip), Activity |
| `approval.decided` | Approval resolved | decided_by, decision, decision_reason | Chat (card collapses to receipt), Plan (✓ or red), Activity |
| `ask.queued` | Ask form gate opened | step_id, submitter_pool, schema, prompt | Chat (form card), Plan (current step indigo), Activity |
| `ask.submitted` | Ask form submitted | submitted_by, values | Chat (card collapses to receipt), Plan (✓), Activity |
| `file.created` | A new file or version landed | file_id, version, producer_agent | Files (thumbnail appears, optionally auto-selects), Activity (with chip), Chat (if milestone-shaped) |
| `file.edited` | Conversational edit produced a new version | file_id, prior_version, new_version, edit_request | Files (reader updates, version dropdown updates), Activity, Chat (if requested via chat) |
| `chat.message` | Operator or orchestrator posted a chat message | author, body, attachments | Chat |
| `agent.milestone` | Sub-agent reports a milestone in chat (per brief §6.1 milestone-vs-narration rule) | agent, summary, link_ref | Chat |
| `thinking.changed` | Current micro-task changed | new_text | Thinking box (overwrites previous) |
| `run.paused.cost_ceiling` / `run.paused.wall_clock` / `run.paused.by_user` | Run paused (§7) | reason, cap_value, current_cost / current_elapsed | Chat (Pause card), Plan, Activity |
| `run.stopped.by_user` | Run stopped (§7) | actor | Activity, task transitions to `failed` |

Architect to lock the precise field names during decomposition. The above is the V1-canonical list.

### 8.3 Per-pane subscription / filter

Each pane subscribes to the same event stream and filters to what it cares about:

| Pane | Filters to |
|---|---|
| Chat | `chat.message`, `agent.milestone`, `approval.queued` / `approval.decided`, `ask.queued` / `ask.submitted`, `run.paused.*` |
| Activity | All events (the full chronological log) |
| Now (when the active right-tab) | `agent.delegation.*`, `step.started` / `step.completed`, `step.failed` |
| Plan (when the active right-tab) | `step.queued` / `step.started` / `step.completed` / `step.failed`, `step.branch_decided`, `approval.queued` / `approval.decided`, `ask.queued` / `ask.submitted` |
| Files (when the active right-tab) | `file.created`, `file.edited` |
| Thinking box | `thinking.changed` (overwrite-only) |

Inactive tabs still process events into a local cache so switching tabs is instant (no re-fetch).

### 8.4 Optimistic rendering on operator actions

When the operator performs an action that produces an event (sending a chat message, clicking Approve, submitting an Ask form, clicking Pause / Stop):

- The pane updates **immediately** with the optimistic state.
- The action POSTs to the server.
- When the server's authoritative event lands on the WebSocket, the client reconciles (typically a no-op if the optimistic prediction was accurate).
- If the server rejects (e.g., the user is no longer in the approver pool because team membership changed), the client rolls back the optimistic update and surfaces an error toast.

### 8.5 Latency budget

End-to-end target: **sub-200ms from engine event emit to all three panes rendered**. Architect to verify with synthetic load tests; brief §6.2 names this as the demo-quality bar.

---

## 9. Open task view UI

(Mockups: [`prototypes/workflows/07-open-task-three-panel.html`](../prototypes/workflows/07-open-task-three-panel.html), [`prototypes/workflows/08-task-progression-states.html`](../prototypes/workflows/08-task-progression-states.html). Brief §6.)

### 9.1 Layout

Three columns, full-width. Widths per brief §6.1:

| Column | Width | Min-width |
|---|---|---|
| Chat | 26% | 320px |
| Activity (collapsible) | 22% expanded · 36px minimised | 240px when expanded |
| Right pane (Now / Plan / Files) | 52% expanded · ~74% minimised | — |

Activity collapses to a 36px vertical strip on a chevron click. Restore by clicking the strip.

### 9.2 Chat panel

Carries the operator-orchestrator conversation, per-agent **milestone** updates, and a thinking box at the bottom (brief §6.1 milestone-vs-narration rule).

**What goes IN chat:**

- The operator's prompts.
- The orchestrator's setup, milestone summaries, and questions (with inline action buttons for Approve / Open files / etc.).
- Per-agent milestone cards: a sub-agent finishing a deliverable (file produced, decision made, hand-off complete) appears with attribution + a link to the deliverable. Mock 8 state 5 shows the full milestone arc.
- Approval cards (the existing Approval primitive) and Ask form cards (§11).
- Pause cards (§7.2).
- Composer at the bottom (above the thinking box) for the operator to send messages.

**What does NOT go IN chat:**

- Per-agent in-progress narration (*"scanning rate cards…"*, *"drafting annex…"*). Lives in activity + Now-tab status dots.
- Every step.started / step.completed event. Lives in activity.

**Thinking box** (above the composer, below the chat scroll area):

- Single line, italic, with a pulsing indigo dot.
- Renders the latest `thinking.changed` event payload.
- Plain language; no engineering jargon (rule from `docs/frontend-design-principles.md`).

### 9.3 Activity panel

Chronological event log, **newest at the bottom** (per brief §6.1 + KNOWLEDGE.md correction 2026-05-02).

- Events flow top-down in natural document order. The container has `overflow-y-auto`; events stack from the top.
- Auto-scrolls to the bottom on new events.
- If the operator scrolls up to read history, auto-scroll pauses and a small floating **"↓ N new events"** pill appears at the bottom of the panel; clicking it scrolls to the latest and resumes auto-scroll.
- Each event renders with: relative timestamp (`Xs ago` / `Xm ago` format per KNOWLEDGE.md correction), actor + label, body text, optional linked-entity chips with a "View" affordance.

### 9.4 Right pane — tabs

Three tabs: **Now / Plan / Files**. Default tab on task open: **Plan** (per spec-time decision #7).

#### 9.4.1 Now tab

- Org chart of agents involved in the task (mock 07).
- Status dots per agent: `done` (green), `working` (blue, pulsing), `idle` (grey).
- Edges between parent and child agents indicate delegation.
- Updates on `agent.delegation.*` and `step.started` / `step.completed` events.

#### 9.4.2 Plan tab

**Always present, content adapts to task complexity** (per Q7 resolution).

| Task type | Plan tab content |
|---|---|
| Trivial (single skill call, no sub-agents) | One row: the skill the orchestrator is calling, e.g., *"Looking up Acme's churn rate."* |
| Multi-step ad-hoc | Orchestrator's plan as it evolves. Each step appears as the orchestrator commits to it. Steps show `queued` / `working` / `done` states. |
| Workflow-fired | The full step DAG up front. The four A's pills decorate each step. |

**Branch decisions render inline** (brief §5.1): when a producing step's branch resolves, the chosen path's label appears in indigo (e.g., **`tier = "hot"`**); other paths render muted with their labels. A "Why?" link next to the resolved label opens a card sourced from the agent's reasoning trace.

**Critical pill** on any step marked `is_critical: true` (mock 5, 7, 8 show the visual treatment).

**Confidence chip** appears below the current Approval step when one is queued (mock 8 state 5).

**Empty state** (per spec-time decision #6): when a task has just been created and the orchestrator hasn't drafted a plan yet, the Plan tab shows a "Drafting…" placeholder.

#### 9.4.3 Files tab

(Detail in §12.) Top thumbnail strip + reader pane. Auto-selects the latest file when a `file.created` event lands.

### 9.5 Header

Above the three panes, a thin header with:

- Task name (editable inline).
- Task status badge.
- **Pause** / **Stop** buttons (per spec-time decision #4 + §7.3). Visible only to users with edit-access (per §14).
- Breadcrumb: `Tasks › [task name]` (the v2 brief retired "Brief" as a noun — see §15).

### 9.6 Empty states (per spec-time decision #6)

| State | Activity panel | Plan tab | Files tab | Chat panel |
|---|---|---|---|---|
| Task just created (second 0) | One event: *"Task created · just now"* | "Drafting…" placeholder | "Nothing produced yet" | Operator's prompt + thinking box: *"Routing to the orchestrator"* |
| Task done, no files produced | Full event log | Final step ✓ | "Nothing produced yet" | Final orchestrator message |

### 9.7 Files referenced

| File | Change |
|---|---|
| `client/src/pages/AgentChatPage.tsx` (existing) | Refactored into the three-pane layout. Existing chat patterns preserved (operator turn, agent reply, system messages, approval card). |
| New components: `OpenTaskView.tsx`, `ChatPane.tsx`, `ActivityPane.tsx`, `RightPaneTabs.tsx`, `NowTab.tsx`, `PlanTab.tsx`, `FilesTab.tsx`, `ThinkingBox.tsx`, `MilestoneCard.tsx`, `ApprovalCard.tsx` (refactor existing), `AskFormCard.tsx` (§11), `PauseCard.tsx` (§7) | Architect picks final names + co-location. |
| WebSocket client hook: `useTaskEventStream(taskId)` | One subscription per task; panes consume via context. |

---

## 10. Studio UI

(Mockups: [`prototypes/workflows/04-four-as-step-types.html`](../prototypes/workflows/04-four-as-step-types.html), [`prototypes/workflows/05-studio-route-editor.html`](../prototypes/workflows/05-studio-route-editor.html), [`prototypes/workflows/09-ask-step-authoring.html`](../prototypes/workflows/09-ask-step-authoring.html). Brief §7.)

### 10.1 Where it lives

Admin / power-user nav. Not in the operator's primary nav. Routes:

| Route | Purpose |
|---|---|
| `/admin/workflows` | Workflow library (admin browsing) |
| `/admin/workflows/:id/edit` | Studio canvas for editing a template |
| `/admin/workflows/:id/edit?fromDraft=:draftId` | Studio with the canvas hydrated from an orchestrator draft (per §10.5 + §13) |

Operators reach the Studio via:

- A "Edit workflow" link from a task that fired from a workflow.
- A "Browse workflows" link from the admin nav.
- An "Open in Studio" button from an orchestrator chat draft (§13.2).

If the Studio becomes the operator's primary entry point, we've drifted (brief §3.0 strategic test).

### 10.2 Canvas layout (mock 05)

| Element | Behaviour |
|---|---|
| Canvas | Vertical step-card list. Branching as forks. Parallel as side-by-side. Approval-on-reject as a dashed back-arrow. |
| Inspector (slide-out, right) | Opens on click of a step. Closes on click of empty canvas. One slide-out at a time — no permanent multi-pane chrome. |
| Chat (Studio agent) | Docked pill bottom-left of the canvas. `⌘K` or click to expand into a left side-panel. Used for big restructures. Agent proposes a diff card; user clicks Apply or Discard. No silent edits. |
| Bottom action bar | Floating pill, centred. Validation status (`1 issue` / `All checks pass`), estimated cost per run, single primary action `Publish vN`. |
| Title bar | Template name (editable inline), forked-from indicator (`Forked from system / lead-reengagement v3 · saved 14s ago`). |

### 10.3 Four A's inspectors (mock 04)

Each step type's inspector content per brief §7.3:

| Step | Inspector fields |
|---|---|
| **Agent** | Name, agent reference (system / org agents), free-form instruction textarea, optional branching on output (e.g., `tier → hot/cold`), side-effect class, **Mark as critical** toggle (per §5.2). |
| **Action** | Name, type radio (Skill / External automation), picked skill or automation, input fields (templated from previous step outputs), on-failure routing, side-effect class, **Mark as critical** toggle. |
| **Ask** | (Detailed in §10.4 — also mock 09) Name, prompt, form schema editor, **Who can submit** dropdown (4-way routing per §14), **Auto-fill from** dropdown. |
| **Approval** | Name, what approvers see (which step outputs to render), approver routing (humans-only, 4-way per §14), quorum, if-approved routing, if-rejected routing (with loop-back option), **Confidence preview** (read-only, shows what runtime will render — per mock 04), **Audit on decision** footnote (read-only, lists what gets snapshotted — per mock 04). |

### 10.4 Ask inspector deep-dive (mock 09)

Five inspector states demonstrated:

- **Default** — name, prompt, form fields list (each row: key + type + required), Add-a-field button, Who-can-submit dropdown (closed), Auto-fill dropdown (closed).
- **Who-can-submit dropdown open** — four options visible (Specific people, A team, Task requester, Org admin) with help text.
- **Auto-fill dropdown open** — V1 options (Don't auto-fill, Last completed run) + V2-deferred options (Pick a specific run, Saved preset).
- **Add-a-field picker open** — 7 V1 field types in a tile picker (text, textarea, select, multi-select, number, date, checkbox). V2 deferrals (file upload, conditional fields, custom validation, no-code forms-builder UI) named in the footer.
- **Editing a select field** — label, field key (read-only, auto-derived), help text, options list with drag-handles, required toggle.

Field-key auto-derivation: lowercase, replace spaces with `_`, strip non-alphanumeric. Author can manually edit if needed (validator confirms uniqueness within the schema and rejects reserved words).

### 10.5 Publishing (mock 05 publish-notes modal)

- Click "Publish vN" → modal opens.
- Modal: single optional textarea labeled "What changed in this version?", with placeholder copy. Skip / Publish buttons.
- Empty notes accepted; the prompt is always shown.
- Stored on `workflow_template_versions.publish_notes`.
- Renders in the Workflow library's version history and in the open task view's Plan tab caption (one line under the version label of the run that used that version).

**Concurrent editing handling** (per spec-time decision #8):

- Studio uses last-write-wins.
- Before submit-to-publish, Studio fetches the current published version's `updated_at`. If it has changed since the user started editing (i.e., another user published in the interim), the Publish modal shows a warning: *"This template was updated by [user] [Xm ago]. You're publishing your version on top of theirs. Review changes?"* with a link to a quick diff (Phase 2) and Publish-anyway / Cancel buttons.
- No soft-locking, no presence indicators in V1.

### 10.6 Studio handoff with preview loaded (brief §7.5)

When the orchestrator drafts a workflow from chat intent and the operator clicks **"Open in Studio"** on the draft card:

1. Orchestrator persists the draft as a draft row keyed by the chat session (architect picks the table; could be a new `workflow_drafts` table with `session_id`, `payload jsonb`, `created_at`).
2. The "Open in Studio" link is `/admin/workflows/new?fromDraft=<draftId>`.
3. Studio reads the draft, hydrates the canvas with the steps the orchestrator drafted, and clears the draft once the operator publishes (creating v1 of a new template) or discards (back to chat with the draft intact for further iteration).
4. **No interstitial preview screen** — the canvas itself is the preview.

Without this, "describe intent → see plan → tweak in Studio" becomes "describe intent → see plan → recreate manually" — fails the §3.0 strategic test.

### 10.7 Files referenced

| File | Change |
|---|---|
| New: `client/src/pages/StudioPage.tsx` | Replaces / extends current Playbook Studio (the rename pass — separate effort, not in this spec). |
| New: `StudioCanvas.tsx`, `StudioInspector.tsx` (with per-step-type variants), `StudioChatPanel.tsx`, `StudioBottomBar.tsx`, `PublishModal.tsx` | Architect picks naming + co-location. |
| New: `WorkflowDraftService.ts` (server) | Drafts table CRUD; cleanup on publish or discard. |
| Studio handoff URL handling | Existing routing layer (Wouter / React Router — architect verifies). |

---

## 11. Ask form runtime

(Mockup: [`prototypes/workflows/10-ask-step-runtime.html`](../prototypes/workflows/10-ask-step-runtime.html). Brief §7.3.)

### 11.1 The form-card primitive

When the engine reaches an Ask step, it emits an `ask.queued` event (§8.2). The chat panel renders a **form card**, the same primitive shape as Approval cards:

- Amber-tinted card (`background: #fffbeb; border: 1px solid #fde68a`) to distinguish from regular chat bubbles.
- Header: `Ask` pill + step name.
- Prompt-to-user as the first line.
- Form fields rendered inline using the V1 field-type renderer (§11.2).
- Required fields marked with a red asterisk.
- Submit button (primary, indigo) + Skip-this-step button (secondary, only enabled if the workflow author allowed skipping — V1 flag on the step, defaults to `false`).

### 11.2 V1 field renderer

Seven field types (per brief §7.3):

| Type | Render |
|---|---|
| `text` | Single-line `<input>` with placeholder |
| `textarea` | Multi-line `<textarea>` with placeholder |
| `select` | Native `<select>` with the author-defined options |
| `multi-select` | Checkbox list (or Combobox-with-tags if the option count is large; architect picks threshold) |
| `number` | `<input type="number">` with optional min/max from the schema |
| `date` | Native date picker (or `react-datepicker` if browser support insufficient) |
| `checkbox` | Single boolean checkbox with the field's label |

Each field has: label, help-text (optional, renders below the input), error (renders in red below the input on validation failure).

### 11.3 Validation

Client-side, runs on Submit click:

- Required-field check: each field with `required: true` in schema must have a non-empty value.
- Type-specific check: `number` must be numeric; `date` must be a valid date.

If validation fails:

- Each invalid field gets a red border + an inline error message ("Pick a segment to continue", "Enter a valid number", etc. — author-customisable in the schema's `error_message` field; falls back to a generic message).
- Submit stays enabled (clicking again re-runs validation).
- No modal, no toast, no extra surface.

V2 (deferred): server-side validation, custom regex patterns, conditional fields.

### 11.4 Submission and state transitions

On valid Submit:

1. Client POSTs to `/api/tasks/:taskId/ask/:stepId/submit` with the form values + the user's id.
2. Server validates the user is in the `submitter_pool` (similar to Approval pool check — §5.1, §14). 403 if not.
3. Server persists the values on the step run record's `outputs` JSON (so they're available as bindings: `${steps.confirm_campaign_target.outputs.audience}`).
4. Server emits `ask.submitted` event.
5. Client receives the event, collapses the form card to a green-tinted **receipt** showing what was submitted, by whom, when:

```
✓ Submitted · Confirm campaign target
Submitted by Mike H. · 2:14 pm

Audience segment: High-fit accounts (Tier A)
Tone:            Professional warm
```

6. Engine resumes the workflow (next step starts).

### 11.5 Auto-fill on re-run (per spec-time decision #10)

When an Ask step queues and the workflow has `autoFillFrom: 'last_completed_run'`:

1. Server queries the most recent successful run of this template-version.
2. If found, retrieves the values submitted for this Ask step.
3. Pre-fills matching field keys; leaves new fields blank.
4. **No warning** if the schema has changed (added/removed/renamed fields). Pre-fill matching keys silently; author's responsibility to know the schema changed.
5. Submitter can edit any pre-filled value before submitting.

If no prior successful run exists (first run), no pre-fill — fields start blank.

### 11.6 Routing UX (mock 10 state D)

When an Ask is routed to a non-requester (`submitterGroup.kind` is `specific_users`, `team`, or `org_admin`):

The form card lands in the task view as usual. The submitter reaches it via one of three paths:

| Path | Shape |
|---|---|
| Sidebar nav badge | "Waiting on you" sidebar entry with a count. Click → "Waiting on you" page. |
| "Waiting on you" page | List of pending Asks + Approvals across all tasks the user has visibility into. Each row click → opens that task with the form card prominent. Same surface as the existing review queue. |
| Email notification (opt-in per user prefs) | Email with task name + form prompt + "Open task" button → opens the task view. |

**The key invariant** (per brief §7.3, mock 10 footnote): all three paths land on the **same task view with the same form card**. There is no separate forms surface. The card content adapts slightly when the submitter is not the requester (*"Mike H. asked you (you're in the Marketing team)"* prefix) so the team member has context.

### 11.7 Files referenced

| File | Change |
|---|---|
| New: `AskFormCard.tsx` | The form card primitive; renders inside ChatPane. |
| New: `FormFieldRenderer.tsx` | Maps field type → input component. |
| New endpoint: `POST /api/tasks/:taskId/ask/:stepId/submit` | Server handler for submission. |
| Existing review-queue UI / "Waiting on you" page | Extended to include Ask items alongside Approvals. |

---

## 12. Files and conversational editing

(Brief §9. Mock 07 for layout; mock 08 state 3 for fetched references and state 4 for created files.)

### 12.1 Files tab — top thumbnail strip + reader pane

| Element | Behaviour |
|---|---|
| Thumbnail strip (top, horizontally scrollable) | One card per file with icon (color-coded by type / author), document orientation (portrait or landscape), file extension badge (`DOC` / `CSV` / `XLS` / `PDF` / `PPT`), and the file name. |
| Reader pane (below) | Full panel width. A4-like proportions for portrait files, 16:9-like for landscape. Click any thumbnail to swap reader content. |
| Document toolbar (sticky at the top of the reader pane) | File name + meta (`DOC · 2 pages · Head of Sales · 28s ago`). Two icon actions: **Download** + **Open in new window**. |
| Version dropdown (per-file) | Surfaces all prior versions of files that have been edited via chat (§12.3). Renders only when the file has > 1 version. |

### 12.2 Files-at-scale grouping (per brief §9.5)

For tasks with many files (long-running campaigns, multi-deliverable proposals), the strip alone becomes unusable. V1 ships lightweight structure on the strip itself:

| Affordance | Behaviour |
|---|---|
| Group switcher above the strip | Three taps: `Outputs · References · Versions`. Default tap is `Outputs`. The vertical divider currently in mock 07 becomes the group boundary. |
| Latest-only toggle | When on (default), the Versions group hides files that have a newer version. Off shows full version history inline. |
| Search box | Above the strip. Filters by file name as the operator types. Cleared on tab switch. |
| Sort dropdown | `Recent first` (default) · `Oldest first` · `Type` · `Author`. |

The reader pane stays unchanged. Document toolbar (download, open in new window, version dropdown) is per-file and doesn't change with grouping/search.

### 12.3 Conversational editing

The operator can ask the agent to refine a file via the chat panel:

> *"Make the proposal body more concise — cut the section on competitor positioning by half."*

Engine flow:

1. Operator sends a chat message that the agent classifies as a file-edit request (existing chat-triage classifier infrastructure, brief §2.2).
2. Agent reads the current file (`referenceDocuments` / `executionFiles` table — architect verifies which holds the file content).
3. Agent applies the requested change.
4. Agent commits the new version (file's version table `version_number = N+1`).
5. Reader pane updates to show the latest version.
6. Activity log records `file.edited` event with `prior_version` and `new_version` ids.
7. Chat gets a milestone confirmation: *"Updated the proposal body. Cut the pricing section to one paragraph."* (with a "View changes" link that opens the diff view per §12.4).

### 12.4 Diff view on conversational edits (per brief §9.4)

After any agent-driven file edit, the reader pane offers a small toggle:

| Toggle state | What renders |
|---|---|
| `Latest` (default) | The new version, plain. |
| `Show changes` | Inline strikethrough on removed text, indigo highlight on added text. Section-anchored (no full-document reflow). |

A one-line caption above the diff: *"Edits requested by Mike at 2:14 pm — 'cut the pricing section to one paragraph' — applied as v3 by Head of Sales."*

**Per-hunk revert** affordance: each highlighted change has a small ↶ button that reverts that specific change (creates a new version, doesn't edit history). One click; no confirmation modal (the action creates a new version and is itself reversible).

**Out of scope for V1:**

- Side-by-side full-page diff (the inline approach is simpler and reads better in the reader pane).
- Structured diffs for spreadsheets / slides (text only in V1; spreadsheets show row-level "added/removed/modified" counts as a fallback — open spec-time decision §19).
- Diff between non-adjacent versions (V1 always diffs against the immediately prior version; the version dropdown lets the operator load any earlier version as the new base if they need to compare further back).

### 12.5 No new schema for diff

The version table already preserves prior versions. Diff is computed at render time from `versionN` vs `versionN-1`. The "Edits requested by X — '...' — applied as vN" caption pulls from the existing chat message log + version metadata.

### 12.6 Inline human editing — out of scope (V1, per brief §9.3)

The operator cannot click into the reader paper and type directly. Reasons (preserved from brief):

- Inline editing breaks the "produced by agents, audited end-to-end" story unless every keystroke is logged.
- Download is the escape hatch.
- Most editing requests are conceptual — a single chat message accomplishes more than ten minutes of inline editing.
- If demand emerges in production, we can add it later.

### 12.7 Files referenced

| File | Change |
|---|---|
| New: `FilesTab.tsx` (within the open task view) | Strip + reader pane + group switcher + search + sort. |
| New: `FileReader.tsx` | Reader pane + document toolbar + version dropdown + diff toggle. |
| New: `DiffRenderer.tsx` | Inline strikethrough / indigo-highlight + per-hunk revert. |
| Existing file/version system | Reused; no schema change. |
| Existing chat-triage classifier | Extended to detect file-edit intent. |
| New endpoint: `POST /api/tasks/:taskId/files/:fileId/revert-hunk` | Per-hunk revert. |

---

## 13. Orchestrator changes

(Brief §11.3, §3.0 strategic test. The orchestrator is the operator's primary creator of workflows; this section locks the changes that keep it that way.)

### 13.1 Suggest-don't-decide for "do once vs repeat" (brief §11.3 #14)

When the operator's chat looks like a request that could naturally repeat (cadence cues in the prompt, prior similar one-off runs, calendar-aligned phrasing), the orchestrator surfaces a **recommendation card** in chat AFTER the run completes — not a forced binary mid-flight.

**Detection signals (V1):**

| Signal | Source | Weight |
|---|---|---|
| Cadence cues in the prompt | NLP on the operator's prompt: "every Monday", "weekly", "each month", "this week", "every quarter" | high |
| Prior similar one-off runs by the same user against the same subaccount | run history lookup | medium |
| Calendar-aligned phrasing | "before Friday", "by end of month" | low (suggests one-off, not recurring) |
| Workflow has Approval steps that recurred to the same approvers | run history | medium |

If signals score above threshold, the orchestrator emits a `chat.message` event after `task.completed` (or after the operator's last action if the task is still ad-hoc) with a recommendation card:

> *"This looks like something you'd want every Monday. Save it as a scheduled Workflow?"*
> 
> [Yes, set up · No thanks]

Default: confirm the suggestion (creates a Workflow draft + a schedule, opens Studio with both pre-filled). Decline: dismiss the card.

**Pattern-detection threshold values are an open spec-time decision** (§19) — architect to pick after seeing 100+ ad-hoc runs and tuning to acceptable false-positive rate.

### 13.2 Draft hydration into Studio (brief §7.5, §10.5)

When the orchestrator drafts a workflow from chat intent (either through the suggest-don't-decide flow or through an explicit "make this a workflow" request), it:

1. Persists the draft as a `workflow_drafts` row with `session_id` (the chat session) + `payload jsonb` (the draft steps + bindings + branches).
2. Emits a `chat.message` event with a draft card:

   > *"I drafted a workflow for this. Open in Studio to review and publish?"*
   > 
   > [Open in Studio · Discard]

3. "Open in Studio" navigates to `/admin/workflows/new?fromDraft=<draftId>`. Studio reads the draft, hydrates the canvas, clears the draft on publish or discard.
4. The draft is per-session, not per-user. If the operator closes the tab, the draft persists (architect picks retention; recommend 7 days).

### 13.3 Milestone reporting in chat (brief §6.1, mock 8 state 4 + 5)

When a sub-agent completes a deliverable that the operator should know about (file produced, decision made, hand-off complete), the sub-agent **directly emits an `agent.milestone` event** with attribution:

```typescript
{
  kind: 'agent.milestone',
  actor: { kind: 'agent', id: 'head_of_sales', label: 'Head of Sales' },
  payload: {
    summary: 'Body drafted ✓ Pulled SDR-1 for last quarter MRR + terms.',
    link_ref: { kind: 'file', id: '<file_id>', label: 'Open draft' }
  }
}
```

The chat panel renders this as a per-agent card with the link as an inline action (mock 8 state 4 + 5).

**What's a milestone (criteria for emitting `agent.milestone`):**

- A new file or version was produced (`file.created` or `file.edited` event always pairs with a milestone for the producing agent).
- A branch decision was resolved (`step.branch_decided` pairs with a milestone for the deciding agent).
- A multi-agent hand-off completed (sub-agent finished its scope and returned to parent).
- The orchestrator's plan changed materially (added/removed steps based on intermediate findings).

**What's NOT a milestone (stays in activity, not chat):**

- Skill calls, memory retrievals, intermediate tool invocations.
- Status updates ("still scanning…", "still drafting…").
- Step.started / step.completed at the engine level (those are activity events, not chat events).

### 13.4 Files referenced

| File | Change |
|---|---|
| Existing orchestrator (`server/jobs/orchestratorFromTaskJob.ts` per brief §2.1) | Extended with: (a) cadence-signal detection on the operator's prompt; (b) draft creation when intent looks workflow-shaped; (c) milestone-event emission per agent. |
| Chat-triage classifier (existing) | Extended to recognise the suggest-don't-decide and "make this a workflow" intents. |
| New: `WorkflowDraftService.ts` (server) | Drafts CRUD + cleanup. |
| New: `RecommendationCard.tsx` | Renders in the chat panel after task completion. |
| Per-agent skill / scope code | Each sub-agent reports its own milestones via a new `emitMilestone(summary, link_ref)` helper. |

---

## 14. Permissions model

(Spec-time decision #9. Tasks live at the **sub-account** level; pickers must be scoped to the calling user's role and the resource's sub-account.)

### 14.1 Roles relevant to V1

| Role | Scope | Sees |
|---|---|---|
| **Org admin / org manager** | Whole org | All sub-accounts; can pick org users + sub-account users (across the entire org) |
| **Sub-account admin** | One or more specific sub-accounts | Only sub-account members for sub-accounts they have admin rights on |
| **Sub-account member** | One specific sub-account | Their own profile only (cannot author workflows; cannot configure pickers) |

Role names + checks reuse existing identity infrastructure. Architect verifies exact role enum at decomposition.

### 14.2 The "users I'm allowed to assign" API

A new endpoint returns the pool of users the calling user is allowed to put into an `approverGroup` or `submitterGroup` (used by both the Approval and Ask inspectors in the Studio):

```
GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users
```

Response (V1 shape):

```typescript
{
  users: Array<{
    id: string,
    name: string,
    email: string,
    role: 'org_admin' | 'org_manager' | 'subaccount_admin' | 'subaccount_member',
    is_org_user: boolean,           // true if the user is at the org level (visible to all sub-accounts in the org)
    is_subaccount_member: boolean   // true if the user belongs to this specific sub-account
  }>,
  teams: Array<{
    id: string,
    name: string,
    member_count: number
  }>
}
```

Server-side scoping logic:

| Calling user's role | Returns |
|---|---|
| `org_admin` or `org_manager` | All org users + all members of the specified sub-account, with role labels. The picker UI can show two grouped sections: "Org users" and "[Sub-account name] members". |
| `subaccount_admin` (with rights on this sub-account) | Only members of the specified sub-account. The picker UI shows one ungrouped list. |
| `subaccount_admin` (without rights on this sub-account) | 403. Architect picks specific error code; the UI surfaces "You don't have permission to configure this workflow". |
| `subaccount_member` | 403. Members can't author. |

`teams` array filtered to teams the calling user has visibility into (org admin sees all org teams; sub-account admin sees only sub-account-scoped teams).

### 14.3 Picker UI behaviour (per spec-time decision #9)

For the **Approval / Ask "Specific people"** picker:

- Search-and-select against `users[]` with typeahead.
- Selected users render as removable chips.
- If the calling user is org admin/manager, the dropdown groups results: **Org users** (with role icon) above **[Sub-account name] members** (no icon).
- If the calling user is sub-account admin, no grouping — single flat list.
- Search matches name + email (case-insensitive).

For the **"A team"** picker:

- Same `teams[]` payload.
- Single dropdown, no grouping (teams aren't org vs sub-account in V1; teams scope is set at team creation per existing infrastructure).

### 14.4 Visibility for non-requester submitters (per spec-time decision #3)

When a non-requester submitter (specific person, team member, org admin) clicks through a notification to land on the task view:

- **They see the whole task by default** (chat history, all files, activity log). They need context to answer the form correctly.
- The task's existing visibility rules apply (which sub-account the task belongs to, who has read access). If the submitter doesn't have base task-read permission, they don't see the form either.
- A future V2 may add a "restricted view" mode for sensitive workflows (HR, billing, legal) — workflow author opts in at publish; submitter sees only the form card and the prompt. **Out of scope for V1.**

### 14.5 Pause / Stop button visibility (§7.3)

The Pause / Stop buttons in the open task view header (§9.5) are visible to:

- The task requester (always).
- Org admins / managers.
- Sub-account admins on the task's sub-account.

Read-only viewers (other sub-account members, users invited to a single Approval / Ask only) do not see the buttons.

### 14.6 Cross-team / cross-subaccount Asks

If a workflow author (org admin) configures an Ask step routed to a team in **another** sub-account:

- The validator allows it at publish (org admins can route across the org).
- At runtime, the team members in that other sub-account get the notification and can submit.
- They land on the task view with full visibility (per §14.4) — even though the task is in a sub-account they don't normally have access to. This is intentional: the workflow author authorised them.
- Audit captures their cross-sub-account access in `workflow_step_reviews.seen_payload` for compliance review.

Sub-account admins **cannot** route across sub-account boundaries (the picker doesn't surface other sub-accounts' users / teams to them).

### 14.7 Files referenced

| File | Change |
|---|---|
| New: `assignableUsersService.ts` (server) | Implements the role-scoped pool resolution. |
| New endpoint: `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users` | Picker data source. |
| New: `UserPicker.tsx`, `TeamPicker.tsx` | Generic pickers used by both Approval and Ask inspectors. |
| Existing role middleware | Reused; no schema change. |

---

## 15. Naming cleanup — Brief → Task

(Brief §11.5. UI-only; schema unchanged.)

### 15.1 Scope

Retire **Brief** as a UI noun. Every user-visible string that refers to a "brief" becomes "Task" (or contextually appropriate variant). The schema is unchanged — `tasks` table stays, `tasks.brief` text column stays.

### 15.2 String / nav / route changes

| Surface | Before | After |
|---|---|---|
| Sidebar nav entry | "Briefs" | "Tasks" |
| Page title | "Briefs" | "Tasks" |
| Breadcrumb | `Briefs › [task name]` | `Tasks › [task name]` |
| New-item modal | `NewBriefModal` (component name + title) | `NewTaskModal` (component renamed; title "New Task") |
| Empty-state copy | "No briefs yet" | "No tasks yet" |
| Email templates referencing the term | "Your brief is waiting" | "Your task is waiting" |
| Search index labels | "brief" type | "task" type |

### 15.3 What does NOT change

- The `tasks` table.
- The `tasks.brief` text column (it's a content column, not a noun for the surface).
- Engine-internal references to brief content (the column name + its content).
- Existing routes (`/briefs/:id` redirects to `/tasks/:id` for backward compat; new route is canonical).

### 15.4 Files referenced

| File | Change |
|---|---|
| `client/src/components/sidebar/*` | Update nav entry label + icon (if changing). |
| `client/src/pages/BriefsPage.tsx` | Rename to `TasksPage.tsx`; update internal references. |
| `client/src/pages/BriefDetailPage.tsx` (or equivalent) | Rename to `OpenTaskView.tsx` (also the new three-pane layout from §9 — the rename and refactor land in the same PR). |
| `client/src/components/NewBriefModal.tsx` | Rename to `NewTaskModal.tsx`; update strings. |
| `App.tsx` route definitions | Add `/tasks` routes; add redirect from `/briefs` to `/tasks` (preserve any existing :id). |
| Server email templates | String-replace "brief" → "task" where user-facing. |
| i18n / translation files (if any) | Update keys + values. |

### 15.5 Effort

~½ day for the find-and-replace + nav update + one redirect rule. Smallest item in the build punch list.

---

## 16. Build punch list and effort estimates

(Brief §11, extended with v2 additions. Architect re-decomposes into implementation chunks during plan-gate.)

### 16.1 Engine and schema

| # | Item | Brief / spec ref | Effort |
|---|---|---|---|
| 1 | Schema migration: `is_critical` on step definition, `seen_payload` / `seen_confidence` / `decision_reason` on `workflow_step_reviews`, `publish_notes` on `workflow_template_versions`, `cost_ceiling_cents` / `wall_clock_cap_seconds` on workflows, `pinned_template_version_id` on schedules | §3 | 1 day (one Drizzle migration + Drizzle schema updates + tests) |
| 2 | Approver routing: `approverGroup` + `quorum` on Approval step, pool resolution + 403 enforcement | §5.1, brief §11.1 #1 | 1.5 days (engine enforcement + tests) |
| 3 | Submitter routing on Ask: same `approverGroup` shape under `submitterGroup` | §3.2, §11 | 0.5 day (mostly reuses #2) |
| 4 | Step-type validator: collapse user-visible vocabulary to four A's, accept legacy types from existing templates | §4.1, brief §11.1 #2 | 1 day |
| 5 | Branching as output property validator | §4.2, brief §11.1 #3 | 0.5 day |
| 6 | Loop validator: only Approval-on-reject backward edges | §4.4, brief §11.1 #4 | 0.5 day |
| 7 | Workflow → workflow nesting validator | §4.5, brief §11.1 #5 | 0.25 day (regression test mostly) |
| 8 | `isCritical` synthesised Approval gate | §5.2 | 1 day |
| 9 | Stall-and-notify scheduling on Approval / Ask gates (24h / 72h / 7d) | §5.3 | 1 day |
| 10 | Cost / wall-clock cap monitoring + Pause card emission | §7 | 1.5 days |
| 11 | Confidence chip heuristic + reason copy mapping | §6.1, §6.2 | 1.5 days |
| 12 | Audit fields write path (`seen_payload`, `seen_confidence`) on gate creation | §6.3 | 0.5 day |
| 13 | Schedule version pinning honour | §3.1, §5.4 | 0.5 day |
| 14 | WebSocket event stream + reconnect-with-replay | §8 | 3 days |

**Engine subtotal: ~13 days** (~2.5 weeks for one engineer; some items parallelise).

### 16.2 New UI

| # | Item | Mockup ref | Effort |
|---|---|---|---|
| 15 | Open task view three-pane layout: Chat / Activity / Right-pane (Now/Plan/Files) | mock 07 | 5 days |
| 16 | Plan tab content: workflow DAG render, branch labels, "why this path" reasoning card, current-step indigo, `isCritical` pill, confidence chip preview, empty state | mocks 07, 08 | 3 days |
| 17 | Now tab: org-chart with status dots + edges | mock 07, 08 | 1.5 days |
| 18 | Files tab: thumbnail strip + reader pane + document toolbar + group switcher (Outputs / References / Versions) + latest-only toggle + search + sort | mock 07 + brief §9.5 | 3 days |
| 19 | Diff renderer: inline strikethrough + highlight + per-hunk revert + version dropdown | brief §9.4, §12.4 | 2 days |
| 20 | Chat panel: conversation + per-agent milestone cards + thinking box + composer | mocks 07, 08 (states 4 + 5) | 2 days |
| 21 | Approval card (refactor existing) with confidence chip render + audit-aware Plan-tab caption | mock 04 (Approval state) | 1 day |
| 22 | Ask form card primitive + 7-field-type renderer + validation + receipt | mock 10 | 2 days |
| 23 | Pause card + operator-initiated Pause / Stop buttons in task header | §7.2, §7.3 | 1 day |
| 24 | Studio canvas + per-step-type inspectors (four A's) | mocks 04, 05 | 7 days |
| 25 | Studio chat panel (docked, agent diff cards) | mock 03 (legacy) for diff-card pattern + mock 05 | 3 days |
| 26 | Studio publish modal with version notes | mock 05 (publish-notes inset) | 0.5 day |
| 27 | Studio concurrent-edit handling (last-write-wins + warning banner) | §10.5 | 1 day |
| 28 | Studio handoff with draft hydration | §10.6, §13.2 | 1.5 days |
| 29 | Ask inspector deep-dive (5 sub-states: default, Who-can-submit, Auto-fill, Add-a-field picker, Edit field) | mock 09 | 2 days |
| 30 | Approver / Submitter user picker + team picker (permission-aware) | §14.3 | 2 days |
| 31 | Team management page in Org settings | brief §8.4 (small CRUD) | 0.5 day |
| 32 | Workflow library page (admin-only) | needs refresh from earlier mocks | 2 days |
| 33 | "Waiting on you" page (extended for Asks alongside Approvals) | mock 10 state D | 1 day |

**UI subtotal: ~40 days** (~8 weeks for one engineer; significantly parallelisable across 2–3).

### 16.3 Orchestrator

| # | Item | Spec ref | Effort |
|---|---|---|---|
| 34 | Suggest-don't-decide pattern detection + recommendation card | §13.1 | 2 days |
| 35 | Draft hydration into Studio (drafts table + endpoint + Studio integration) | §13.2 | 1.5 days |
| 36 | Per-agent milestone emission + chat-panel routing | §13.3 | 1 day |
| 37 | Workflow-as-tool for agents (`workflow.run.start` skill) | brief §11.3 #16 | 1 day |

**Orchestrator subtotal: ~5.5 days.**

### 16.4 Naming cleanup

| # | Item | Spec ref | Effort |
|---|---|---|---|
| 38 | Brief → Task UI rename (sidebar, page titles, breadcrumbs, modals, email templates) | §15 | 0.5 day |

### 16.5 Total

| Workstream | Days | Weeks (1 engineer) |
|---|---|---|
| Engine + schema | ~13 | ~2.5 |
| New UI | ~40 | ~8 |
| Orchestrator | ~5.5 | ~1 |
| Naming cleanup | ~0.5 | ~0.1 |
| **Total** | **~59 days** | **~12 weeks** |

Parallelisable across UI / engine / orchestrator workstreams. With 2–3 engineers in parallel: **~12–16 weeks calendar**. This matches the spec-time decision #11 re-estimate.

Architect to re-decompose during plan-gate; some items are likely to absorb other tasks (e.g., #20 chat panel may share scaffolding with #15 layout).

---

## 17. Test plan

Tests author-time (per CLAUDE.md, full test gates run in CI; locally only targeted unit tests for new code).

### 17.1 Engine validator (§4)

| Test | Asserts |
|---|---|
| `four-as-vocabulary.test.ts` | Validator rejects publish using deprecated user-facing names; accepts existing engine types from legacy templates. |
| `branching-as-output-property.test.ts` | Validator rejects `conditional` / `agent_decision` step types in fresh templates; accepts when migrating an existing one. |
| `branching-target-step-exists.test.ts` | Validator rejects branches whose target step ID doesn't exist. |
| `loop-only-on-approval-reject.test.ts` | Validator accepts backward edges from Approval `onReject`; rejects all other backward edges. |
| `no-workflow-to-workflow-nesting.test.ts` | Validator rejects direct workflow→workflow chains; accepts workflow→agent→workflow. |
| `quorum-validator.test.ts` | Validator rejects publish when `quorum > userIds.length` for `kind: 'specific_users'`. |
| `iscritical-only-on-agent-action.test.ts` | Validator rejects `is_critical: true` on Ask or Approval steps. |

### 17.2 Engine state machine (§5, §7)

| Test | Asserts |
|---|---|
| `approval-pool-membership.test.ts` | Submitting an approval decision as a user not in the snapshotted pool returns 403. |
| `approval-quorum-counting.test.ts` | Step transitions to `approved` only when `approve` count ≥ quorum; single rejection trumps. |
| `iscritical-synthesises-approval.test.ts` | Agent / Action step with `is_critical: true` has an Approval gate inserted before execution. |
| `iscritical-no-double-gate.test.ts` | If author placed an Approval before a critical step, no second synthesised gate is created. |
| `stall-notify-cadence.test.ts` | Notification jobs scheduled at 24h / 72h / 7d on gate-open; cancelled on gate-resolve. |
| `cost-ceiling-pause.test.ts` | Run pauses when cumulative cost crosses ceiling between steps; emits `run.paused.cost_ceiling`. |
| `wall-clock-cap-pause.test.ts` | Run pauses when elapsed time crosses cap; emits `run.paused.wall_clock`. |
| `pause-between-steps-only.test.ts` | A step in flight finishes before pause takes effect; no mid-step interruption. |
| `schedule-version-pinning.test.ts` | Scheduled run with `pinned_template_version_id` uses that version even when newer is published. |

### 17.3 Confidence + audit (§6)

| Test | Asserts |
|---|---|
| `confidence-heuristic-clamping.test.ts` | `is_critical: true` clamps confidence to `medium` ceiling. |
| `confidence-heuristic-cascade.test.ts` | Low-confidence upstream cascades to `low` downstream. |
| `confidence-snapshot-immutable.test.ts` | `seen_confidence` snapshotted at gate-creation; not regenerated on later read. |
| `seen-payload-immutable.test.ts` | `seen_payload` snapshotted at gate-creation; reflects what the human authorised, not what later ran. |
| `confidence-failsafe.test.ts` | `high` confidence does NOT auto-approve; gate still requires explicit operator action. |

### 17.4 Real-time coordination (§8)

| Test | Asserts |
|---|---|
| `websocket-replay-on-reconnect.test.ts` | Client resumes from last seen `event_id` after disconnect; no missed events; no replay from start. |
| `event-fan-out-to-panes.test.ts` | One event reaches all subscribed panes within 200ms. |
| `optimistic-rollback.test.ts` | Optimistic update rolls back when server rejects (e.g., out-of-pool approver). |

### 17.5 UI surfaces (§9, §10, §11, §12)

| Test | Asserts |
|---|---|
| `plan-tab-empty-state.test.tsx` | "Drafting…" placeholder renders for a brand-new task with no plan yet. |
| `plan-tab-default-on-open.test.tsx` | Plan is the default selected tab when a task page mounts. |
| `activity-newest-at-bottom.test.tsx` | Events render top-down chronologically; auto-scroll keeps newest at viewport bottom. |
| `activity-scroll-up-pauses-autoscroll.test.tsx` | Scrolling up halts auto-scroll and shows the "↓ N new events" pill. |
| `chat-milestone-vs-narration.test.tsx` | Per-agent milestone events render as cards in chat; in-progress narration events do not. |
| `ask-form-validation.test.tsx` | Required-field errors surface inline; Submit stays enabled. |
| `ask-form-submit.test.tsx` | Successful submission collapses card to receipt; emits `ask.submitted`. |
| `studio-publish-notes-modal.test.tsx` | Publish button opens modal; empty notes are accepted. |
| `studio-concurrent-edit-warning.test.tsx` | Stale-template warning surfaces if another user published while editing. |
| `diff-renderer-revert-hunk.test.tsx` | Per-hunk revert creates a new version; doesn't edit history. |
| `files-at-scale-search.test.tsx` | Search filters thumbnails by file name; cleared on tab switch. |

### 17.6 Permissions (§14)

| Test | Asserts |
|---|---|
| `assignable-users-org-admin.test.ts` | Org admin sees org users + sub-account members in the response. |
| `assignable-users-subaccount-admin.test.ts` | Sub-account admin sees only sub-account members. |
| `assignable-users-403-non-admin.test.ts` | Sub-account member gets 403 (cannot author). |
| `cross-subaccount-routing.test.ts` | Org admin can route an Ask to another sub-account's team; sub-account admin cannot. |
| `pause-stop-button-visibility.test.tsx` | Buttons render for requester / org admin / sub-account admin; hidden for other viewers. |

### 17.7 Test posture rules

- Per CLAUDE.md, full test-gate suites run in CI. Locally, only targeted unit tests for the file authored for THIS change (`npx tsx <path-to-test>`).
- No mocking the database for tests covering migrations or engine state-machine transitions; use the real test database (per CLAUDE.md test posture).
- Each test names the brief / spec section it validates so traceability is auditable.

---

## 18. Migration plan and telemetry

### 18.1 Migration plan

**No runtime data migration is required.** All schema deltas (§3) are additive and default-safe:

- `is_critical` defaults to `false` — existing steps behave as today.
- `seen_payload`, `seen_confidence`, `decision_reason` default to `null` — existing approval records are unaffected.
- `publish_notes` defaults to `null` — existing template versions have no notes (rendering treats `null` as "no notes").
- `cost_ceiling_cents` defaults to `500`, `wall_clock_cap_seconds` defaults to `3600` — existing workflows get the safe defaults; admins can raise them per template if needed.
- `pinned_template_version_id` defaults to `null` — existing schedules behave as today (next run uses newest published).

**Existing system templates** (`event-creation.workflow.ts`, `weekly-digest.workflow.ts`, `intelligence-briefing.workflow.ts`) continue to work without modification. The four A's validator accepts their legacy engine type names.

**Migration steps (one PR):**

1. Drizzle migration file with all column additions.
2. Schema files in `shared/schema/` updated to match.
3. New endpoints, services, components, validators per §3 – §15.
4. Test gate (CI runs the full battery; we do not run gates locally).
5. Deploy to staging; smoke-test the three system templates run successfully end-to-end.
6. Deploy to production; no operator-visible disruption (UI gets the new surfaces but every existing path continues to work).

**Rollback plan:**

- The migration is purely additive; no destructive changes.
- If a critical bug surfaces, revert the deploy without rolling back the schema. The new columns sit unused.
- The schema migration itself stays applied (rolling back additive migrations is risky and unnecessary).

### 18.2 Telemetry and observability

All events emit via the existing tracing registry (per brief §2.5). The engine adds the following named events on top of what's already emitted:

| Event | Where | Purpose |
|---|---|---|
| `workflow.published` | Studio publish path | Track publish frequency per template. Existing? Architect verifies. |
| `workflow.publish_blocked.validator` | Validator rejection on publish | Track which rules fire most (informs validator UX). |
| `approval.queued` | Gate creation | Already in §8.2 event stream; also written as a tracing event for cross-run aggregation. |
| `approval.decided` | Gate resolution | Same. Includes confidence chip value + reason for retrospective analysis. |
| `approval.pool_403` | Out-of-pool decision attempt | Surfaces the bug fix where any user could decide on any approval. Should drop to zero after V1 ships. |
| `ask.queued` / `ask.submitted` | Ask gate lifecycle | Tracks form usage, abandonment rate. |
| `iscritical.synthesised_gate` | When `is_critical: true` triggers an Approval | Tracks how often authors mark steps critical and how often those approvals are actually needed (informs whether `isCritical` is being over- or under-used). |
| `confidence.computed` | Heuristic computation | Tracks the distribution of confidence values; informs the V1→V2 calibration model when `workflow_step_reviews` data accumulates. |
| `run.paused.cost_ceiling` / `run.paused.wall_clock` / `run.paused.by_user` | Pause events | Tracks how often runs hit caps (informs cap tuning per template). |
| `run.stopped.by_user` | Operator stop | Tracks operator interventions. |
| `chat.message_sent` | Operator sent a chat message | Existing? Architect verifies. |
| `agent.milestone_emitted` | Sub-agent milestone in chat | Tracks per-agent milestone frequency; helps identify under-reporting agents. |
| `file.created` / `file.edited` | File lifecycle | Existing. Extended to include `edit_request` text for conversational edits. |
| `orchestrator.suggestion_offered` | Suggest-don't-decide card surfaces | Tracks recommendation rate; informs threshold tuning. |
| `orchestrator.suggestion_accepted` / `orchestrator.suggestion_dismissed` | Operator action on the card | Tracks acceptance rate; informs whether the pattern detection is calibrated. |
| `studio.draft_hydrated` | Studio opened with `?fromDraft=` | Tracks the Studio handoff path. |
| `websocket.reconnect` | Client reconnected to event stream | Tracks connection stability. |

**Cost / latency guardrails:**

- Each event emit is async fire-and-forget (per existing tracing pattern, brief §2.5).
- Target overhead: <5ms per event on the hot path.
- Architect adds a synthetic load test that fires 1000 events in a burst and confirms p95 latency stays under target.

### 18.3 Logs vs events

- **Tracing events** (above) are structured, queryable, persisted to the events sink.
- **Application logs** (existing logger) capture context for unstructured debugging — engine errors, validator rejections, exceptional state. Not extended in this spec; uses existing patterns.

### 18.4 Dashboards and alerts

- A small admin dashboard (V2) aggregates the per-template metrics: pause rate, approval-403 rate, suggestion-acceptance rate. Not in V1 scope.
- One alert in V1: `approval.pool_403` rate > 0 in production after the first month — indicates a regression in the pool-membership check.

### 18.5 KNOWLEDGE.md additions on completion

After V1 ships, append KNOWLEDGE.md entries for:

- Any non-obvious validator rules (e.g., the `quorum > activeTeamMembers` runtime check, vs the publish-time check).
- The exact confidence-chip threshold values picked.
- Any orchestrator pattern-detection signals that turned out to be noise.

---

## 19. Open spec-time decisions

These remain open after this spec; architect / spec-reviewer settles each at decomposition. None are blockers for starting build — each can be picked with a sensible default and refined.

### 19.1 Carried forward from brief §15

| # | Decision | Default if not picked | Settled by |
|---|---|---|---|
| A | Confidence-chip threshold cut-points (high / medium / low boundaries) | Hand-tuned on 100+ internal Approval cards before public launch | Architect + product |
| B | `isCritical` opt-in vs auto-on-irreversible | Opt-in (current default — author marks). Re-evaluate after V1 if too many irreversible steps slip through. | Product call |
| C | Diff view scope: structured spreadsheet diff in V1 or V2? | V1 ships text-only diff for documents; spreadsheets show row-level "added / removed / modified" counts as a fallback. Full structured spreadsheet diff is V2. | Architect (visual budget call) |
| D | Orchestrator pattern-detection signals for "do once vs repeat" | List in §13.1 is the V1 starting set. Threshold values picked after seeing 100+ ad-hoc runs. | Architect |
| E | Document toolbar version dropdown depth | All prior versions shown; "Show more" if > 10 versions. | Settle in §12.1 build. |

### 19.2 New from this spec pass

| # | Decision | Default applied | Architect verifies |
|---|---|---|---|
| F | Exact target table for `is_critical` column | Step-definition-level (likely `workflow_template_steps` or the `params` JSON inside it) | Architect picks based on existing Drizzle schema layout. |
| G | Cost-cap extension granularity (Pause card "Continue for another Y minutes / $Z" buttons) | One option: 30 minutes / $2.50. Cap on number of extensions per run: 2. | Architect refines if existing cost-reservation infrastructure has different granularity. |
| H | Workflow drafts retention (when an orchestrator-drafted workflow is unclaimed in Studio) | 7 days | Architect picks based on existing cleanup-job infrastructure. |
| I | Multi-select field renderer threshold (checkbox list vs Combobox-with-tags) | Checkbox list for ≤ 7 options; Combobox above. | Architect or designer picks at component-build time. |
| J | WebSocket batching window for burst events | 1 frame (~16ms) at 60fps cap | Architect picks based on existing real-time infrastructure. |
| K | Plan-tab "trivial task" detection (when content collapses to a single row) | Trivial = exactly one Action step + no agent decisions | Architect refines. |
| L | Empty-state copy for Plan / Files / Activity tabs | Per §9.6 | Designer pass on copy at component-build. |

### 19.3 Out-of-scope for V1 (re-stated, for completeness)

These are intentionally not in this spec; revisit when real V1 usage data justifies:

- Mobile / phone-responsive layouts (V2; spec-time decision #1).
- "Restricted view" mode for non-requester submitters on sensitive workflows (V2; spec-time decision #3).
- Auto-escalation policies beyond stall-and-notify (V2; spec-time decision #2).
- Full structured spreadsheet diff (V2; decision §19.1 #C).
- Audit drawer + audit export UIs (V2; spec §6.5).
- Cost dashboards across templates (V2; brief §12).
- Run-history search across sub-accounts (V2; brief §12).
- Calibrated confidence model (V2; replaces V1 heuristic once `workflow_step_reviews` data accumulates).
- Per-step `escalateAfterHours` config on Approvals (V2; spec §5.3).
- Conditional fields on Ask forms ("show field B if field A = X") (V2; brief §7.3 V2 deferrals).
- File upload field type on Ask (V2; brief §7.3 V2 deferrals).

### 19.4 Spec-review pass

This spec goes through `spec-reviewer` before `architect` decomposes:

1. `spec-reviewer` reviews this document, classifies findings as mechanical / directional / ambiguous.
2. Mechanical fixes auto-applied.
3. Directional findings either auto-decided per the agent's framing assumptions, or routed to `tasks/todo.md`.
4. Up to 5 iterations max per spec-reviewer's lifetime cap.

After spec-review settles, `architect` decomposes into implementation chunks, then `feature-coordinator` orchestrates the build per chunk.

---

_End of spec. Brief: [`docs/workflows-dev-brief.md`](./workflows-dev-brief.md). Mockups: [`prototypes/workflows/index.html`](../prototypes/workflows/index.html)._

---
