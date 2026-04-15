# Automation OS — Onboarding & Daily Intelligence Brief Spec

> **Status:** Draft 1 — pre-review. Do not implement against this document until spec-reviewer has cleanly exited and the human reviewer has signed off in the conversation.
>
> **Scope tier:** Major (cross-cutting; new playbook primitive, new UI surfaces, new data contracts, new system template). Must run through feature-coordinator after sign-off.
>
> **Branch:** `claude/automation-os-onboarding-5r8Ba`

---

## Table of contents

0. [Context & intent](#0-context--intent)
1. [Goals — verifiable assertions](#1-goals--verifiable-assertions)
2. [Non-goals](#2-non-goals)
3. [Architecture overview](#3-architecture-overview)
4. [Primitive — `action_call` playbook step type](#4-primitive--action_call-playbook-step-type)
5. [Primitive — `SchedulePicker` + universal `runNow`](#5-primitive--schedulepicker--universal-runnow)
6. [Primitive — `HelpHint`](#6-primitive--helphint)
7. [Primitive — Unified Knowledge page + auto-attach policy](#7-primitive--unified-knowledge-page--auto-attach-policy)
8. [Primitive — Playbook `knowledgeBinding`](#8-primitive--playbook-knowledgebinding)
9. [Primitive — Playbook run modal + onboarding tab + portal card](#9-primitive--playbook-run-modal--onboarding-tab--portal-card)
10. [Primitive — `modules.onboardingPlaybookSlugs`](#10-primitive--modulesonboardingplaybookslugs)
11. [System template — Daily Intelligence Brief](#11-system-template--daily-intelligence-brief)
12. [Build plan & sequencing](#12-build-plan--sequencing)
13. [Test strategy & gates](#13-test-strategy--gates)
14. [Rollback / backout](#14-rollback--backout)
15. [Open questions](#15-open-questions)

---

## 0. Context & intent

Agencies and sub-account users need a fast path from "I signed up" to "I'm getting daily value out of this." Today we have agents, skills, scheduled tasks, memory, and a playbook engine — but no guided on-ramp that ties them together. The first human signing in has to pick the right agents, configure them, attach the right skills, and wait for the next scheduled run before seeing anything useful. That is too much activation energy for the value on offer.

The concrete wedge we are shipping first is a **Daily Intelligence Brief** — a short, high-agency morning digest produced by existing system agents and delivered via email and the client portal. It is an onboarding anchor, not a one-off: the path that delivers it must be a reusable pattern, not a hard-coded special case. Every future "configure an agent to do X on a schedule and notify me" flow should reuse the same primitives.

The pattern is:

1. The user chooses an **onboarding playbook** — a versioned, templated conversation that knows which questions to ask, which existing agents to configure, and which scheduled tasks to create.
2. The playbook captures answers through `user_input` steps, records the agent-configurable answers to **knowledge** (so future agents see them too), and writes the configuration through deterministic `action_call` steps that reuse the `config_*` skill surface the Configuration Assistant already exposes.
3. When the playbook finishes, the scheduled task runs **immediately** (so the user sees the first brief before closing the tab) and also **on its normal recurrence** from that point forward.
4. Delivery is dual-channel: an email to the configured recipients **and** a card on the client portal dashboard.

We are deliberately not building a bespoke "Daily Brief" system. We are building the pattern that makes a Daily Brief the cheapest possible thing to ship. Everything in this spec is either (a) a reusable primitive that later playbooks will use, or (b) the specific Daily Brief playbook definition that sits on top of those primitives.

### Relationship to existing systems

| Existing system | Relationship |
|---|---|
| Playbook engine (`server/services/playbookEngineService.ts`, 6 step types, 5 run modes) | Host for the new step type and the new knowledge binding field. No changes to run modes, DAG, templating, or replay semantics. |
| Configuration Assistant (28 `config_*` skills) | Canonical source of truth for "how to mutate org config safely." `action_call` reuses those handlers without spinning up an LLM loop. |
| Config history / backups | All mutations written by `action_call` steps flow through the same `actionService.proposeAction` → `configHistoryService.record` path the UI uses. Zero new audit code. |
| Memory blocks (`memory_blocks` / `memory_block_attachments`) | Host for the **Memory Blocks** tab on the Knowledge page. Auto-attach policy is new but the primitive exists. |
| Workspace memory entries (`workspace_memory_entries`) | Host for the **References** tab on the Knowledge page. Already has `taskSlug`, `domain`, `topic`, quality scoring, embeddings. Long-form notes retrieved on demand. |
| Client portal (`/portal`) | Host for the Daily Brief dashboard card. New card type; no new portal infrastructure. |
| `scheduled_tasks` + pg-boss cron | Host for the Daily Brief's recurring execution. New `runNow` parameter on the creation path; cron wiring unchanged. |

### Why not just use the Configuration Assistant for onboarding?

Configuration Assistant is the right tool when a user has a configuration intent and wants to converse about it. An onboarding playbook has a fixed, finite set of questions and a fixed set of resulting mutations. Routing a deterministic 7-step form through a chat LLM:

- Adds latency and cost per step with no reasoning value
- Gives the agent the ability to misinterpret or drift off-script
- Complicates idempotent replay (the agent might phrase the plan differently on re-run)
- Forces users into chat UX when a form would serve them better

`action_call` fixes exactly that gap: deterministic writes inside a playbook DAG, using the same handlers the Configuration Assistant already calls. The conversational assistant stays available for open-ended configuration; the playbook handles the repeatable flows.

---

## 1. Goals — verifiable assertions

Each goal is phrased as something a test, a gate script, or a scripted clickthrough can prove.

### G1. `action_call` step type exists and is validated

- **G1.1** A playbook definition containing an `action_call` step with `actionSlug: 'config_create_scheduled_task'` passes `validateDefinition()` when all required fields are present.
- **G1.2** A playbook definition with `actionSlug: 'send_email'` fails validation with rule `action_slug_not_allowed`.
- **G1.3** A playbook definition with `type: 'action_call'` but no `actionSlug` fails validation with rule `missing_field`.
- **G1.4** The validator collects `{{ ... }}` references from `actionInputs` and enforces the same `dependsOn` rule as `agentInputs`.

### G2. `action_call` executes through the action pipeline

- **G2.1** Running an `action_call` step writes a row to `actions` attributed to the org's Configuration Assistant agent row.
- **G2.2** Running an `action_call` step writes a row to `config_history` with `changeSource: 'config_agent'` when the underlying handler mutates a tracked entity.
- **G2.3** If the action's `defaultGateLevel` is `review`, the engine blocks on HITL before executing.
- **G2.4** Supervised-mode runs pause the step before dispatch, identical to `agent_call`.
- **G2.5** Replay-mode runs short-circuit `action_call` steps to the recorded output — no second mutation.

### G3. Universal run-now

- **G3.1** Every UI surface that creates a recurring scheduled task exposes a "Run now" checkbox.
- **G3.2** When "Run now" is checked, the task runs within 30 seconds of creation **and** the normal cron schedule continues.
- **G3.3** The scheduled-task creation service accepts a `runNow: boolean` argument that enqueues an immediate pg-boss job in addition to registering the cron.
- **G3.4** "Run now" is idempotent — double-clicking the button creates exactly one immediate run.

### G4. `SchedulePicker` component

- **G4.1** The component exposes interval (daily, weekly, monthly, quarterly, half-yearly, annually), first-run date, and optional time-of-day.
- **G4.2** The component emits a canonical `{ interval, firstRunAt, cron }` object that the backend converts to a pg-boss cron string.
- **G4.3** Invalid combinations (first-run-in-the-past, unsupported interval/day-of-week mixes) are blocked client-side with inline messages.

### G5. `HelpHint` primitive

- **G5.1** A `<HelpHint text="..." />` component exists and renders a question-mark-in-a-circle icon.
- **G5.2** The popover opens on hover, on focus, and on click (click pins it open on mobile).
- **G5.3** The popover text is truncated at 280 chars with an ellipsis and accepts no HTML.
- **G5.4** At least the three new surfaces in this spec (Knowledge promote-to-block, SchedulePicker run-now, Playbook run modal portal-visibility toggle) use `HelpHint` on launch.

### G6. Unified Knowledge page

- **G6.1** `/subaccounts/:id/knowledge` renders two tabs: **References** (backed by `workspace_memory_entries`) and **Memory Blocks** (backed by `memory_blocks`).
- **G6.2** Reference notes are created, edited, renamed, archived, and soft-deleted through the page. Tiptap is the editor.
- **G6.3** Insights are filterable by domain, topic, entryType, and taskSlug; each row shows source agent run and quality score.
- **G6.4** A promote-to-reference affordance converts a selected Insight into a new Reference note, preserving a back-link to the originating entry.
- **G6.5** The page respects subaccount permissions — users see only their own subaccount's knowledge unless they hold `org.admin`.

### G7. Subaccount auto-attach policy

- **G7.1** When a new Reference note is created with `autoAttach: true`, every currently-linked agent in that subaccount receives a `memory_block_attachments` row with `permission: 'read'`.
- **G7.2** When a new agent is linked to a subaccount, it inherits attachments for every Reference note in that subaccount that has `autoAttach: true`.
- **G7.3** Attachments created via auto-attach can be individually detached and do not reappear.

### G8. Playbook `knowledgeBinding`

- **G8.1** A `user_input` step may declare `knowledgeBinding: { target: 'reference_note', name: string, autoAttach: boolean }` on a named form field.
- **G8.2** When that step completes, the form value is appended to the named Reference note (creating it if absent) with attribution to the run and timestamp.
- **G8.3** The validator rejects `knowledgeBinding` on any step type other than `user_input`.
- **G8.4** The validator rejects `knowledgeBinding` pointing at a field that is not present in the step's `formSchema`.

### G9. Playbook run modal

- **G9.1** A "Run playbook" button on the Playbook Studio detail page opens a modal that walks through: choose subaccount → fill initial inputs → review plan → run.
- **G9.2** The modal supports supervised-mode toggling.
- **G9.3** The modal streams run progress in-place (step statuses update live via existing WebSocket events).
- **G9.4** Completed runs surface a "View results" link to the run detail page.

### G10. Onboarding tab & portal card

- **G10.1** A subaccount detail page has a new **Onboarding** tab listing the playbooks advertised by `modules.onboardingPlaybookSlugs` for that subaccount's active modules.
- **G10.2** Each item shows status (not started / in progress / completed), last-run timestamp, and a "Start" or "Resume" button.
- **G10.3** Completing an onboarding playbook writes a row to `subaccount_onboarding_state` tracking completion per (subaccount, playbook slug).
- **G10.4** The client portal dashboard shows a "Daily Brief" card for every subaccount that has a completed Daily Intelligence Brief playbook run AND a current scheduled task producing briefs.

### G11. `modules.onboardingPlaybookSlugs`

- **G11.1** The `modules` table gains a `onboarding_playbook_slugs jsonb` column defaulting to `[]`.
- **G11.2** The admin module editor UI exposes the column as a multi-select over system playbook slugs.
- **G11.3** Adding a slug to a module causes every active subaccount subscribed to a subscription containing that module to see the playbook in its Onboarding tab.

### G12. Daily Intelligence Brief playbook ships

- **G12.1** `server/playbooks/daily-intelligence-brief.playbook.ts` is a valid system playbook definition committed to the repo.
- **G12.2** Running it end-to-end on a clean subaccount produces: a Reference note containing the business context, a scheduled task configured to run on the user-chosen cadence, an initial email + portal card within 5 minutes.
- **G12.3** The playbook is registered in a module's `onboarding_playbook_slugs` in a seeded migration.

---

## 2. Non-goals

The following are explicitly out of scope for this spec and must not be added during build without a separate spec round. Adding any of these silently during implementation is a spec violation.

1. **New agent creation for the Daily Brief.** The brief is produced by existing system agents configured for this subaccount. No new agent slug is seeded.
2. **A generic "any action" playbook step.** `action_call` is locked to the 28 `config_*` skills via an explicit allowlist. Expanding the allowlist is a separate spec conversation.
3. **Multi-channel delivery beyond email + portal.** No Slack, no SMS, no webhook. If a later playbook wants Slack, it adds its own delivery step; it does not retrofit the Daily Brief.
4. **Org-level memory surface.** Knowledge is subaccount-scoped in v1. The promote-to-block affordance creates subaccount-scoped Reference notes. An org-scoped tab is an explicit v2 consideration, not part of this build.
5. **Playbook editing inside the run modal.** The run modal only executes published playbooks. Authoring stays in Playbook Studio.
6. **Custom cron expressions in `SchedulePicker`.** The picker exposes a fixed interval menu. Admins who need a raw cron string continue to use the existing advanced scheduled-task form.
7. **Real-time collaborative editing of Reference notes.** Single editor at a time; optimistic-concurrency conflict detection is enough (last-writer-wins with a toast).
8. **Versioning of Reference notes.** `config_history` does not cover `memory_blocks` today. Adding it is future work; v1 relies on Tiptap's client-side undo and soft-delete for recovery.
9. **A "skip onboarding" default.** Onboarding is opt-in via the Onboarding tab. The system does not auto-run any playbook on subaccount creation.
10. **Retrofitting `HelpHint` across every existing surface.** v1 adds it only to the three surfaces this spec creates. Broader adoption is captured as a triage item, not implied work.
11. **Multi-subaccount bulk onboarding.** The run modal runs one playbook against one subaccount. Bulk mode already exists in the engine but is not wired into this UI.
12. **Migrating existing scheduled tasks to emit "run now" behaviour.** Only newly-created tasks get the optional immediate run. Existing tasks' cron remains unchanged.

---

## 3. Architecture overview

### 3.1 System diagram — onboarding flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Subaccount detail page → "Onboarding" tab                               │
│ - Lists playbooks advertised by modules.onboardingPlaybookSlugs          │
│ - Each row: name, status, last run, Start/Resume                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ user clicks Start
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Playbook run modal (new, reusable for Onboarding + Playbook Studio)     │
│  Step 1: subaccount (pre-filled in onboarding context)                   │
│  Step 2: initial input form                                              │
│  Step 3: live-streaming step progress — user_input / approval surfaces   │
│            are rendered inline; action_call / prompt / agent_call run    │
│            asynchronously with live status                               │
│  Step 4: completion + "view results"                                     │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ creates playbookRun; engine takes over
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ playbookEngineService (existing)                                        │
│                                                                          │
│  ┌─────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ user_   │→→│ prompt /      │→→│ action_call  │→→│ approval     │ │
│  │ input   │  │ agent_call    │  │ (NEW)        │  │              │ │
│  └─────────┘  └───────────────┘  └──────────────┘  └──────────────┘ │
│       │                                │                                │
│       │ (fields bound via              │ invokes config_* skill via    │
│       │  knowledgeBinding write        │ skillExecutor → actionService │
│       │  to memory_blocks)             │  → configHistoryService       │
│       ▼                                ▼                                │
│  ┌─────────────────────┐      ┌─────────────────────────┐              │
│  │ memory_blocks +     │      │ actions + config_history │              │
│  │ memory_block_       │      │ (existing pipeline)      │              │
│  │ attachments (NEW)   │      └─────────────────────────┘              │
│  └─────────────────────┘                                                │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ playbook completes
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Outputs                                                                  │
│  - subaccount_onboarding_state row (completion tracking)                 │
│  - scheduled_tasks row (cron-registered)                                 │
│  - pg-boss immediate job if runNow=true → first brief produced           │
│  - Reference notes visible on the Knowledge page                         │
│  - Daily Brief card visible on the client portal dashboard               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data contracts at a glance

| Entity | New? | Change |
|---|---|---|
| `PlaybookStep.type` | modified | Add `'action_call'` literal |
| `PlaybookStep.actionSlug` / `.actionInputs` | new fields | Populated on `action_call` steps |
| `PlaybookStep.knowledgeBinding` | new field | Populated on `user_input` steps that should write to a Reference note |
| `ValidationRule` | extended | Add `action_slug_not_allowed`, `knowledge_binding_on_wrong_step_type`, `knowledge_binding_field_not_in_schema` |
| `modules.onboarding_playbook_slugs` | new column | `jsonb` default `[]`, admin-editable |
| `subaccount_onboarding_state` | new table | `(subaccountId, playbookSlug, status, lastRunId, completedAt)` |
| `memory_blocks.auto_attach` | new column | `boolean` default `false`, drives inheritance on agent-link |
| `memory_block_attachments.source` | new column | `'manual' \| 'auto_attach'` so we can tell inherited attachments from manual ones |
| `scheduled_tasks` | no schema change | New argument `runNow` on creation service; cron unchanged |

### 3.3 Execution pipeline for an `action_call` step

The existing engine already has infrastructure for replay, supervised-mode gating, idempotency, input-hash reuse, and HITL routing. `action_call` reuses all of it. The dispatch path:

```
engine.dispatchStep(step with type='action_call')
    │
    ├── replayMode? → replayDispatch() → done
    │
    ├── runMode === 'supervised' && status === 'pending'
    │       → playbookStepReviewService.requireApproval()
    │       → status: awaiting_approval → return (next tick re-enters)
    │
    ├── resolve actionInputs via templating (existing resolveTemplateInputs)
    ├── compute dispatchInputHash (existing hashValue)
    ├── look up reusable output by (runId, stepId, inputHash) (existing findReusableOutputForStep)
    │       → if found, completeStepRunInternal → done
    │
    ├── resolve configuration-assistant agentId for this org (cached on run._meta)
    │
    └── actionService.proposeAction({
            organisationId, subaccountId, agentId, agentRunId: null,
            actionType: actionSlug, idempotencyKey, payload: resolvedActionInputs
          })
          ├── policy_engine.evaluate → auto | review | block
          │
          ├── status === 'blocked'      → failStepRunInternal('blocked_by_policy')
          ├── status === 'pending'      → reviewService.createReviewItem → awaiting_approval
          └── status === 'approved'     → skillExecutor.execute(actionSlug, payload, context)
                                       → write result to actions.resultJson
                                       → handler internally called configHistoryService.record
                                       → completeStepRunInternal(step, result, outputHash)
```

Key property: **no code path bypasses `proposeAction`.** The same audit, gate, and idempotency guarantees the UI enjoys apply to playbook-driven mutations.

### 3.4 Knowledge architecture

Two stores, one UI.

```
Knowledge page (/subaccounts/:id/knowledge)
│
├── Tab: References            ──→ workspace_memory_entries (subaccount-scoped rows)
│     - Long-form notes, typically Tiptap-edited
│     - Agent-maintained or human-authored; retrieved on demand via memory_search
│     - Select → "Promote to Memory Block" button
│        → creates a new memory_blocks row with content = condensed entry content
│        → writes a back-link in the Memory Block ("Promoted from Reference …")
│
└── Tab: Memory Blocks          ──→ memory_blocks (subaccount-scoped rows)
      - Short, stable facts loaded into every agent run
      - Toggle: autoAttach (default: true for blocks created via knowledgeBinding)
      - Attached to agents via memory_block_attachments (with .source column)
```

Auto-attach policy:

- A Reference note with `autoAttach: true` is attached (`permission: 'read'`, `source: 'auto_attach'`) to every currently-linked agent in that subaccount.
- When a new agent is linked to the subaccount, the link service iterates `autoAttach: true` Reference notes in that subaccount and creates attachments.
- Users can manually detach an auto-attached note; the `source: 'auto_attach'` marker prevents the system from re-creating the attachment.

### 3.5 Universal run-now pattern

`SchedulePicker` emits `{ interval, firstRunAt, runNow: boolean }`. The scheduled-task creation service receives this alongside the normal cron payload:

1. Register the recurring schedule with pg-boss as today.
2. If `runNow === true`, additionally enqueue a one-shot job against the same task worker with an idempotency key of `${taskId}:run-now`. The idempotency key means re-submitting the form does not produce a second immediate run.

The pattern lives in `scheduledTaskService.create()` — every UI surface creating a task passes through the same service, so there is exactly one place to implement and test this behaviour.

### 3.6 File inventory

Files the build will create, modify, or delete. Drift between this list and reality is a spec-review blocker.

| Action | Path | Purpose |
|---|---|---|
| create | `server/lib/playbook/actionCallAllowlist.ts` | Frozen list of the 28 `config_*` slugs callable from `action_call` |
| modify | `server/lib/playbook/types.ts` | Add `'action_call'` to `StepType`; add `actionSlug`, `actionInputs`, `knowledgeBinding` fields; add new `ValidationRule` entries |
| modify | `server/lib/playbook/validator.ts` | New `case 'action_call':` and `knowledgeBinding` validation |
| modify | `server/lib/playbook/renderer.ts` | Emit new fields |
| modify | `server/services/playbookEngineService.ts` | New `case 'action_call':` in `dispatchStep`; knowledge-binding side effect on `user_input` completion |
| create | `server/services/playbookActionCallExecutor.ts` | `executeActionCall()` thin helper — routes through proposeAction, returns status |
| create | `server/services/__tests__/actionCallValidator.pure.test.ts` | Validator rules for `action_call` steps |
| create | `server/services/__tests__/actionCallAllowlist.pure.test.ts` | Snapshot test over frozen allowlist set |
| create | `server/services/__tests__/executeActionCall.pure.test.ts` | Contract tests for executeActionCall (mocks proposeAction) |
| create | `server/services/__tests__/knowledgeBindingValidator.pure.test.ts` | Validator rules for `knowledgeBindings` |
| create | `server/services/__tests__/knowledgeBindingRuntime.pure.test.ts` | finaliseRun() binding-evaluation behaviour |
| modify | `server/services/scheduledTaskService.ts` | Accept `runNow` argument; enqueue immediate job |
| modify | `server/services/subaccountAgentService.ts` | On link creation, inherit `autoAttach: true` Reference notes |
| modify | `server/services/memoryBlocksService.ts` (or create if absent) | CRUD + promote-from-insight + auto-attach semantics |
| create | `migrations/0118_memory_block_source_reference.sql` | `memory_blocks.auto_attach`, `memory_block_attachments.source`, `memory_blocks.sourceReferenceId` FK (see §7.3) |
| create | `migrations/0119_modules_onboarding_playbook_slugs.sql` | `modules.onboarding_playbook_slugs text[] NOT NULL DEFAULT '{}'`, `subaccount_onboarding_state` table (see §10.2) |
| create | `migrations/0120_portal_briefs.sql` | `portal_briefs` table, `playbook_runs.is_portal_visible`, `playbook_runs.is_onboarding_run` (see §11.6) |
| create | `server/playbooks/daily-intelligence-brief.playbook.ts` | System playbook definition |
| create | `server/scripts/seedOnboardingModuleBindings.ts` (or inline migration) | Register the Daily Brief slug in the right module(s) |
| create | `client/src/components/ui/HelpHint.tsx` | Hover help icon primitive |
| create | `client/src/components/SchedulePicker.tsx` | Schedule picker + run-now checkbox |
| create | `client/src/pages/subaccount/SubaccountKnowledgePage.tsx` | Unified Knowledge page (two tabs) |
| create | `client/src/components/PlaybookRunModal.tsx` | Playbook run modal |
| modify | `client/src/pages/AdminSubaccountDetailPage.tsx` | Add "Onboarding" tab |
| modify | `client/src/pages/PortalPage.tsx` | Daily Brief card (route `/portal/:subaccountId`) |
| modify | `client/src/pages/SystemModulesPage.tsx` | `onboardingPlaybookSlugs` multi-select |
| modify | `client/src/App.tsx` | Router entry for `SubaccountKnowledgePage` (route: `/admin/subaccounts/:subaccountId/knowledge`) |
| modify | `architecture.md` | Cross-reference onboarding flow (once shipped) |
| modify | `docs/capabilities.md` | Surface Knowledge page + onboarding in customer-facing capabilities (once shipped) |

If the build adds a file not on this list, the builder must update this list in the same commit.

---

## 4. Primitive — `action_call` playbook step type

### 4.1 Intent

Deterministic, LLM-free invocation of a pre-approved action from inside a playbook DAG. Writes a single tool call through the same pipeline the LLM-driven path uses, so policy, gating, audit, and history are identical to normal tool calls. The payoff is that a playbook can declare `"at this step, create this scheduled task with these templated inputs"` without any agent reasoning in between.

### 4.2 Step shape

```ts
// In server/lib/playbook/types.ts

export type StepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional'
  | 'agent_decision'
  | 'action_call';                    // NEW

export interface PlaybookStep {
  // ... existing fields unchanged ...

  // ── type: action_call ──────────────────────────────────────────────────
  /**
   * Slug of the skill/action invoked directly. Must be on the
   * ACTION_CALL_ALLOWED_SLUGS allowlist (the 28 config_* Configuration
   * Assistant skills). Validator rejects any other slug.
   */
  actionSlug?: string;

  /**
   * Templated inputs resolved against run context and passed as the skill
   * handler's `input` argument. Same templating surface as `agentInputs`:
   *   { cron: '{{ steps.schedule.output.cron }}', subaccountId: '{{ run.subaccount.id }}' }
   */
  actionInputs?: Record<string, string>;
}
```

A narrowed helper type mirrors `AgentDecisionStep`:

```ts
export type ActionCallStep = PlaybookStep & {
  type: 'action_call';
  actionSlug: string;
  actionInputs: Record<string, string>; // {} is allowed; undefined is not after validation
};
```

### 4.3 Allowlist — frozen, enumerated

Kept in a dedicated file so the diff is reviewable whenever it changes:

```ts
// server/lib/playbook/actionCallAllowlist.ts

export const ACTION_CALL_ALLOWED_SLUGS: ReadonlySet<string> = new Set([
  // Mutations — agents & links (9)
  'config_create_agent', 'config_update_agent', 'config_activate_agent',
  'config_link_agent', 'config_update_link', 'config_set_link_skills',
  'config_set_link_instructions', 'config_set_link_schedule',
  'config_set_link_limits',

  // Mutations — subaccounts & tasks (3)
  'config_create_subaccount', 'config_create_scheduled_task',
  'config_update_scheduled_task',

  // Mutations — data sources (3)
  'config_attach_data_source', 'config_update_data_source',
  'config_remove_data_source',

  // Reads (9)
  'config_list_agents', 'config_list_subaccounts', 'config_list_links',
  'config_list_scheduled_tasks', 'config_list_data_sources',
  'config_list_system_skills', 'config_list_org_skills',
  'config_get_agent_detail', 'config_get_link_detail',

  // Plan / validation / history (4)
  'config_preview_plan', 'config_run_health_check',
  'config_view_history', 'config_restore_version',
]);

export function isActionCallSlugAllowed(slug: string): boolean {
  return ACTION_CALL_ALLOWED_SLUGS.has(slug);
}
```

Expansions require editing this file, writing down why, and passing spec-review — not a silent runtime override.

### 4.4 Validation rules

Added to `server/lib/playbook/validator.ts`:

| Rule key | Trigger | Message |
|---|---|---|
| `missing_field` (existing) | `type='action_call'` && `!actionSlug` | `action_call step '<id>' must declare actionSlug` |
| `action_slug_not_allowed` (new) | `actionSlug` not in `ACTION_CALL_ALLOWED_SLUGS` | `action_call step '<id>' references action '<slug>', which is not on the action_call allowlist. See server/lib/playbook/actionCallAllowlist.ts.` |

Template reference collection: `actionInputs` values are scanned with `extractReferences()` and subject to the same `transitive_dep` and `unresolved_template_ref` rules as `agentInputs`.

`sideEffectType` cross-check: if `actionSlug` is a read (`config_list_*`, `config_get_*`, `config_view_history`), `sideEffectType` must be `'none'` or `'idempotent'`. If `actionSlug` is a mutation, `sideEffectType` must be `'reversible'` or `'irreversible'`. This mismatch is surfaced as `missing_side_effect_type` for the read case (mismatched tightness) and as a new `action_side_effect_mismatch` rule for write-typed-as-none. **Open question:** is this cross-check worth the complexity or should we trust the author? See §15.

Definition-time validation does NOT check `actionInputs` values against the action's `parameterSchema` because resolved values are only known at run time. Runtime validation happens when `skillExecutor.execute()` runs — the skill handlers already validate their inputs with Zod and return `{ success: false, error: ... }` on shape violations, which the engine turns into step failure.

### 4.5 Engine dispatch

New `case 'action_call':` in `playbookEngineService.dispatchStep`. Pseudocode:

```ts
case 'action_call': {
  if (run.replayMode) {
    await this.replayDispatch(run, sr, step);
    return;
  }

  // Supervised-mode gate (mirrors agent_call)
  if (run.runMode === 'supervised' && sr.status === 'pending') {
    await playbookStepReviewService.requireApproval(sr, {
      reviewKind: 'supervised_mode',
    });
    return;
  }

  const actionStep = step as ActionCallStep;
  const ctx = run.contextJson as RunContext;

  // Resolve templated inputs (reuse existing helper)
  let resolvedActionInputs: Record<string, unknown>;
  try {
    resolvedActionInputs = resolveTemplateInputs(actionStep.actionInputs, ctx);
  } catch (err) {
    if (err instanceof TemplatingError) {
      await this.failStepRunInternal(sr, `templating_error: ${err.reason} ('${err.expression}')`);
      return;
    }
    throw err;
  }

  const dispatchInputHash = hashValue({ actionSlug: actionStep.actionSlug, actionInputs: resolvedActionInputs });

  // Input-hash reuse path (reuse existing helper) — only when not irreversible
  if (step.sideEffectType !== 'irreversible') {
    const reuse = await this.findReusableOutputForStep(run.id, step.id, dispatchInputHash);
    if (reuse) {
      await this.completeStepRunInternal(sr, reuse.output, reuse.outputHash, `input_hash_reuse:from_attempt_${reuse.attempt}`);
      return;
    }
  }

  // Resolve Configuration Assistant agentId for this org (cached on _meta)
  const configAssistantAgentId = await this.resolveConfigAssistantAgentId(run);
  if (!configAssistantAgentId) {
    await this.failStepRunInternal(sr, 'config_assistant_agent_not_found');
    return;
  }

  // Mark step running
  await db.update(playbookStepRuns)
    .set({ status: 'running', inputJson: { actionSlug: actionStep.actionSlug, actionInputs: resolvedActionInputs } as Record<string, unknown>, inputHash: dispatchInputHash, startedAt: new Date(), version: sr.version + 1, updatedAt: new Date() })
    .where(eq(playbookStepRuns.id, sr.id));

  // Execute synchronously via action pipeline
  try {
    const result = await executeActionCall({
      organisationId: run.organisationId,
      subaccountId: run.subaccountId,
      agentId: configAssistantAgentId,
      playbookStepRunId: sr.id,
      actionSlug: actionStep.actionSlug,
      actionInputs: resolvedActionInputs,
      idempotencyKey: `playbook:${run.id}:${step.id}:${sr.attempt}`,
    });
    // result: { success: true, output } | { success: false, error, reason }
    if (result.status === 'blocked') {
      await this.failStepRunInternal(sr, `blocked_by_policy: ${result.reason ?? ''}`);
      return;
    }
    if (result.status === 'pending_approval') {
      // HITL review item has been created; wait for reviewer
      await db.update(playbookStepRuns)
        .set({ status: 'awaiting_approval', updatedAt: new Date() })
        .where(eq(playbookStepRuns.id, sr.id));
      return;
    }
    if (result.status === 'failed') {
      await this.failStepRunInternal(sr, `action_failed: ${result.error}`);
      return;
    }
    // approved + executed
    await this.completeStepRunInternal(sr, result.output, hashValue(result.output), 'action_call');
  } catch (err) {
    await this.failStepRunInternal(sr, `action_call_error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return;
}
```

### 4.6 `executeActionCall()` — new thin helper

Lives in `server/services/playbookActionCallExecutor.ts`. Single purpose: route through `actionService.proposeAction`, wait for the approve-or-reject decision, then either fire the skill handler via `skillExecutor.execute()` or return the pending/blocked status to the engine. Approximately 80 LOC — it mirrors `executeWithActionAudit` in `skillExecutor.ts` but without the LLM-callback shape.

Input contract:
```ts
interface ActionCallExecuteArgs {
  organisationId: string;
  subaccountId: string;
  agentId: string;              // Configuration Assistant's org agent row
  playbookStepRunId: string;    // threaded into metadata for audit
  actionSlug: string;
  actionInputs: Record<string, unknown>;
  idempotencyKey: string;
}

type ActionCallExecuteResult =
  | { status: 'approved_and_executed'; actionId: string; output: unknown }
  | { status: 'pending_approval'; actionId: string }
  | { status: 'blocked'; actionId: string; reason?: string }
  | { status: 'failed'; actionId: string; error: string };
```

### 4.7 HITL resumption

When `executeActionCall` returns `pending_approval`, the step sits in `awaiting_approval` until the reviewer approves. A new branch in the existing review-decision handler (wherever approved-action webhooks land) checks for a linked `playbook_step_run_id` on the action row and, when found:

1. Invokes `skillExecutor.execute()` to perform the mutation.
2. Writes `result` to the action row.
3. Calls `playbookEngineService.completeStepRunFromReview(stepRunId, result)` which wraps `completeStepRunInternal` and fires the usual event.

This path must exist anyway for LLM-driven tool calls with `pending_approval` resolution — we verify during implementation whether the existing code can be reused as-is or needs a small branch for playbook-originated actions. If a branch is needed, it is named and accounted for in §12.

### 4.8 Configuration Assistant agent resolution

At run start, `playbookRunService.startRun` resolves the slug `configuration-assistant` to the org's installed agent row (same lookup `configSkillHandlers.getConfigAgentId()` does) and caches the id on `run._meta.resolvedActionAgents.configuration_assistant`. Subsequent `action_call` dispatches read from the cache; on cache miss (e.g. the cache is empty because this is a resumed run from before the column existed), the engine falls back to a live lookup.

If the Configuration Assistant agent is not installed in the org at run start, `startRun` fails with `configuration_assistant_not_installed` before any step dispatches — the playbook cannot partially succeed without the agent. Installation of the Configuration Assistant is already part of the operator module, so orgs on `automation_os`, `agency_suite`, or `internal` subscriptions always have it. Orgs outside those subscriptions cannot run onboarding playbooks that use `action_call` — this is a fine constraint for v1.

### 4.9 Rendering

`server/lib/playbook/renderer.ts` emits `actionSlug` and `actionInputs` on `action_call` steps. Mirrors the existing `agentInputs` emission pattern — no new techniques. `outputSchema` continues to be emitted as `z.any()` because studio-authored playbooks don't round-trip real Zod instances; hand-authored playbook files keep their real schemas.

### 4.10 Side-effect classification — guidance for playbook authors

Guidance baked into the validator's error messages and the spec:

| `actionSlug` starts with | Use `sideEffectType` |
|---|---|
| `config_list_*`, `config_get_*`, `config_view_history` | `none` or `idempotent` |
| `config_create_*`, `config_attach_*` | `reversible` — the created entity can be deleted |
| `config_update_*`, `config_set_*`, `config_activate_*`, `config_remove_*`, `config_restore_*` | `reversible` — previous state recoverable via history |
| `config_preview_plan`, `config_run_health_check` | `none` |

None of the 28 slugs are strictly `irreversible`. If a future allowlisted slug is (e.g. a hypothetical `config_delete_organisation`), the author must set `irreversible` and `retryPolicy.maxAttempts: 1` or the existing `irreversible_with_retries` rule blocks publish.

---

## 5. Primitive — `SchedulePicker` + universal `runNow`

### 5.1 Component — `client/src/components/SchedulePicker.tsx`

A single React component used everywhere a human picks a recurrence. It deliberately does not accept a raw cron string: it forces the caller to pick from a fixed menu and converts the result to a cron expression at the boundary.

```ts
interface SchedulePickerValue {
  interval: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'annually';
  firstRunAt: string;       // ISO date-time, always in subaccount timezone
  timeOfDay?: string;       // HH:mm, 24h. Required for daily/weekly/monthly.
  dayOfWeek?: number;       // 0-6 Sun-Sat. Required for weekly.
  dayOfMonth?: number;      // 1-31. Required for monthly.
  runNow: boolean;          // NEW — universal
}

interface SchedulePickerProps {
  value: SchedulePickerValue | null;
  onChange: (v: SchedulePickerValue) => void;
  subaccountTimezone: string;    // drives timezone-correct firstRunAt computation
  allowRunNow?: boolean;         // default true
  helpText?: string;             // optional caption above the picker
  disabled?: boolean;
}
```

UI layout (top-to-bottom):

1. **Interval** — select: Daily, Weekly, Monthly, Quarterly, Every 6 months, Yearly.
2. **Frequency modifiers** — rendered conditionally:
    - Daily → time of day input.
    - Weekly → day-of-week chips + time of day.
    - Monthly → day-of-month number + time of day (max 28; higher values fall back to "last day of month" with a note).
    - Quarterly / half-yearly / annually → first-run date picker only.
3. **First run** — date picker. Default is the earliest valid date given the frequency modifiers.
4. **Run now checkbox** — label "Run now and keep the schedule" + `HelpHint` explaining it. Default: unchecked. Hidden when `allowRunNow === false`.
5. **Summary line** — human-readable preview: "Every Monday at 9:00 AM, starting Monday Jan 26. Will run immediately on save."

### 5.2 Emitted canonical shape

The component never emits a cron string. Callers receive a `SchedulePickerValue` and are responsible for calling a server endpoint that translates to cron. This keeps cron construction server-side where the timezone + DST rules live.

### 5.3 Server — schedule normalisation

New helper `server/lib/schedule/schedulePickerToCron.ts`:

```ts
export function schedulePickerValueToCron(
  v: SchedulePickerValue,
  subaccountTimezone: string,
): { cron: string; firstRunAt: Date } {
  // pure translation — no I/O.
  // emits cron expressions compatible with pg-boss's node-cron parser.
}
```

Unit-tested exhaustively (every interval × DST boundary × end-of-month edge case). Pure function → file pattern `*.pure.ts` and `*.pure.test.ts`.

### 5.4 Scheduled-task creation service change

`server/services/scheduledTaskService.ts` exposes `create()` today. We extend it:

```ts
interface CreateScheduledTaskArgs {
  // ... existing fields
  runNow?: boolean;     // NEW — optional, defaults false
}

async create(args: CreateScheduledTaskArgs) {
  const task = await /* existing insert + pg-boss cron registration */;
  if (args.runNow) {
    await pgBoss.send(`scheduled-task-run`, { taskId: task.id }, {
      singletonKey: `scheduled-task-run-now:${task.id}`,
      useSingletonQueue: true,
    });
  }
  return task;
}
```

The singleton key guarantees idempotency — re-submitting the form or re-running the playbook's `action_call` with the same idempotency key cannot produce a second immediate run.

### 5.5 `config_create_scheduled_task` pass-through

The Configuration Assistant skill handler receives a new optional `runNow` field in its input schema. The handler forwards it to `scheduledTaskService.create()`. When `action_call` invokes the skill with `runNow: true`, the immediate job fires as part of the action's execution — no separate playbook step needed.

This is the pattern: **`runNow` is a scheduled-task flag, not a playbook-engine flag.** Every path that creates a scheduled task (UI form, Configuration Assistant chat, `action_call` step, future `/api/scheduled-tasks` endpoint) accepts it uniformly.

### 5.6 UI surfaces adopting `SchedulePicker` on initial build

Explicitly scoped for v1:

1. The Daily Intelligence Brief playbook's schedule `user_input` step (rendered inside the playbook run modal's form renderer).
2. The existing scheduled-task creation form on `AdminSubaccountDetailPage` — replace the current bespoke picker so the universal pattern is proven on an existing surface.
3. The Configuration Assistant plan preview — when the assistant proposes `config_create_scheduled_task`, the plan's schedule row is rendered as a read-only `SchedulePicker` (so the admin can sanity-check before approving).

**Out of scope for v1:** every other legacy scheduled-task form. We adopt gradually.

### 5.7 Empty-state behaviour

`SchedulePicker` never renders as completely empty. When `value` is `null`, it seeds a default (interval: daily, time: 09:00, first run: today or next valid slot, runNow: false) and emits it via `onChange` on mount. This keeps forms predictable — callers never have to implement their own default seeding.

### 5.8 Failure isolation for `runNow`

If the recurring cron registers successfully but the `runNow` pg-boss send fails:

- The task is created (user sees it in the list).
- The immediate run is absent.
- The UI surfaces a non-blocking toast: "Your brief is scheduled — the first run didn't start automatically. Click Run now to retry."
- Every task row has a persistent "Run now" button (triggers the same idempotent enqueue) so the recovery path is obvious.

We do NOT roll back the task creation if the immediate enqueue fails. The recurring schedule is the contract; the immediate run is a convenience.

---

## 6. Primitive — `HelpHint`

### 6.1 Why we need this

The app does not currently have a reusable hover-help primitive. Help text is scattered across three inconsistent patterns today:

1. Native `title=""` attributes on `<button>` / `<a>` elements (no styling, no mobile, no keyboard focus).
2. Static descriptive sentences rendered inline beneath labels (permanent real-estate cost; can't be dismissed).
3. Ad-hoc `<span className="text-xs text-slate-500">…</span>` blurbs next to inputs (same problem, plus no affordance that there's more to read).

This is fine for a small product but becomes noise as the UI grows. Onboarding is the wrong moment to expect the user to RTFM — but it is also the moment most dense with novel concepts (Memory Blocks vs References, scheduled task vs playbook run, Onboarding tab vs Configure tab). We need a single primitive that:

- Sits next to a label without visual weight.
- Reveals short explanatory text on hover / focus / tap.
- Is keyboard-accessible.
- Works on touch devices (click-to-pin, tap-elsewhere-to-dismiss).
- Can be adopted incrementally without rewriting existing forms.

### 6.2 Component API

File: `client/src/components/ui/HelpHint.tsx` (new).

```tsx
export interface HelpHintProps {
  /** Plain-text content. HTML and markdown are rejected (see §6.4). */
  text: string;
  /**
   * Optional label for screen readers when the surrounding text does
   * not already describe the hint target. Defaults to "More information".
   */
  ariaLabel?: string;
  /**
   * Placement hint — the popover layer may flip to the opposite side
   * if it would clip the viewport. Default: 'top'.
   */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * When true, the hint opens on click instead of hover. Useful when the
   * hint sits inside a scrolling container where hover is unreliable.
   */
  clickOnly?: boolean;
}

export function HelpHint(props: HelpHintProps): JSX.Element;
```

Usage:

```tsx
<label className="block">
  <span className="flex items-center gap-1">
    First run
    <HelpHint text="When the playbook runs for the first time. Defaults to the next valid slot after the current time." />
  </span>
  <SchedulePicker value={value} onChange={onChange} />
</label>
```

### 6.3 Behaviour

| Surface               | Behaviour                                                                                              |
|-----------------------|--------------------------------------------------------------------------------------------------------|
| Mouse hover           | Popover opens after 150 ms dwell; closes 100 ms after pointer leaves both the icon and the popover.    |
| Keyboard focus        | Popover opens immediately on focus; closes on blur or `Escape`.                                        |
| Touch tap             | Popover opens on tap (click-to-pin). Subsequent tap anywhere outside the popover closes it.            |
| `clickOnly: true`     | Hover is disabled; popover only opens on click / tap / `Enter` / `Space`.                              |
| Popover overflow      | Auto-flips placement to stay in viewport. Falls back to bottom-center if no side fits.                 |
| Popover width         | Max-width `22rem` (~280px). Text wraps; long copy scrolls internally (max-height `10rem`).             |
| Dismissal             | `Escape` always closes; clicking outside always closes; `Tab` moves focus out and closes.              |

Implementation notes:

- The icon is a hand-rolled inline SVG (info circle, 14×14, `currentColor`), matching the project's convention of not pulling in an icon library. Takes `text-slate-400 hover:text-slate-600` to keep visual weight near zero.
- The popover layer uses a small portal rooted at `#help-hint-portal` injected once in `client/src/App.tsx`. Portal avoids z-index fights with modals and dropdowns.
- Positioning uses `@floating-ui/react-dom` (already transitively available via Radix deps — verify in `package.json` before adopting; if missing, a bespoke 60-line positioner is acceptable rather than adding a new dep for this).
- Keyboard trigger element is a `<button type="button" aria-label={ariaLabel}>` so it is naturally focusable and does not submit enclosing forms.

### 6.4 Content constraints

- **Plain text only.** No markdown, no HTML. The component escapes its input and renders via `{props.text}` — callers that want formatting are using the wrong primitive (use a dedicated help panel or long-form docs surface).
- **280 character soft cap.** At author-time, tests lint all `HelpHint` usages in the repo and warn if any `text` prop exceeds 280 chars. This keeps hints scannable and forces the author to link to deeper docs instead of inlining a paragraph.
- **No agent / LLM copy.** Hints are for UI concepts ("what does 'First run' mean"), not product positioning or marketing. They must be editable by an engineer in 10 seconds.
- **No interpolation.** The prop is a string literal or a `t()` lookup — never a templated mix of user data and copy. This prevents accidental XSS surface growth.

### 6.5 When to add a `HelpHint` (authoring guidance)

We are not going on a hint-decoration spree. The bar for adding a hint is:

1. The label alone is ambiguous AND
2. A first-time user would plausibly make a wrong decision without the hint AND
3. The explanation fits in ≤ 280 characters.

If any of those fail, the answer is not a hint — it's a better label, an inline example, or a link to the docs page.

### 6.6 v1 adoption surfaces

We ship `HelpHint` alongside three concrete placements, chosen because they gate onboarding decisions:

| Surface                                              | Hint target                        | Example copy                                                                                                           |
|------------------------------------------------------|------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Unified Knowledge page (§7) — "Promote to Block"     | The Promote action                 | "Promoting copies this reference into a Memory Block. Blocks are loaded into every agent run — use for stable facts."  |
| `SchedulePicker` (§5) — "Run now" checkbox           | The Run-now toggle                 | "Kicks off the first run immediately after saving. The recurring schedule continues as configured."                    |
| Playbook run modal (§9) — "Show in portal" toggle    | Portal visibility                  | "When enabled, the sub-account owner sees this run in their portal. Leave off for internal-only playbooks."            |

Any surface beyond these three is out of scope for v1 and can be added later without a spec update — `HelpHint` is a plain primitive.

### 6.7 Accessibility

- `role="tooltip"` on the popover element.
- The trigger button carries `aria-describedby` pointing at the popover's id while the popover is open; removed when closed (otherwise screen readers announce hidden content).
- Focus management: opening via keyboard does NOT move focus into the popover (it would trap the user); `Escape` closes and returns focus to the trigger.
- Contrast: popover uses `bg-slate-900 text-slate-50` (WCAG AA against its own background and against all page backgrounds we support).

### 6.8 Testing

- Unit test (`HelpHint.test.tsx`): renders icon, toggles on click, closes on `Escape`, escapes HTML in `text`, respects `clickOnly`.
- Lint rule (`scripts/verify-help-hint-length.mjs`): scans `client/src/**/*.tsx` for `<HelpHint text="…" />` literals and fails if any exceeds 280 chars. Wired into `scripts/run-all-gates.sh`.
- No E2E test — popover behaviour is standard and covered by the unit test; E2E would be flaky for hover timing.

### 6.9 Out of scope for v1

- Rich content (images, code blocks, links with click-through).
- Per-user dismissal memory ("don't show this again").
- Analytics on hint engagement.
- Translation / i18n infrastructure (string is passed through; a future i18n pass will wrap callers in `t()`).

---

## 7. Primitive — Unified Knowledge page + auto-attach policy

### 7.1 Problem this primitive solves

The two-store knowledge model (Memory Blocks — hot path, loaded into every agent run; Workspace Memory Entries — cold path, retrieved on demand) is correct but invisible to users. Today they are exposed on two separate pages with different mental models, different CRUD ergonomics, and no clear guidance on which to use when. Onboarding depends on users populating both stores — first-run playbooks need a place to write facts into, and later runs need a place to read from.

The unified Knowledge page collapses both stores into one surface with two tabs, plus a single write-in path that defaults to the right store and allows promotion/demotion between them.

### 7.2 Scope — two tabs, one page

File: `client/src/pages/subaccount/SubaccountKnowledgePage.tsx` (new). Route: `/sub/:subaccountId/knowledge`.

**Tab 1 — References (default)** — backed by `workspaceMemoryEntries` table. Long-form notes, typically authored via the Tiptap editor. Used for: meeting notes, brand docs, SOPs, anything agents retrieve on demand via `memory_search`.

**Tab 2 — Memory Blocks** — backed by `memoryBlocks` table. Short, stable facts loaded into every agent run for this sub-account. Used for: company name, timezone, tone rules, key people, constraints ("never book before 9am local").

Both tabs share:

- Search box (full-text across title + body).
- Tag filter chip row.
- Create button (routes to tab-specific creator).
- Sort (recently updated / A-Z).

Only References ship Tiptap editing. Memory Blocks are small enough that a plain `<textarea>` with a character counter is correct — blocks that need a rich editor are usually misfiled References.

### 7.3 Promotion / demotion flow

The key UX affordance is the ability to promote a Reference into a Memory Block without losing provenance.

- Every Reference row has a `…` overflow menu with **Promote to Memory Block**.
- Clicking opens a modal that shows: (a) the Reference title/body, (b) a required "Block label" field (max 80 chars), (c) a required "Condensed content" textarea pre-filled with the Reference body truncated to 500 chars and editable.
- On confirm, the server:
  1. Inserts a new row in `memoryBlocks` with `sourceReferenceId = reference.id`.
  2. Appends a Config History entry (§architecture.md) for entity type `memory_block`.
  3. Does NOT delete the Reference — promotion is non-destructive.
- Demotion is the inverse, via the Memory Blocks tab's overflow menu: **Demote to Reference**. Creates a Reference, deletes the Block, Config-History-logged on both entities.

The `sourceReferenceId` column (nullable FK to `workspaceMemoryEntries`) is added in migration `0118_memory_block_source_reference.sql`. The FK uses `ON DELETE SET NULL` so deleting a Reference does not cascade.

A `HelpHint` (§6) on the Promote action explains what promotion means in-context.

### 7.4 Auto-attach policy for onboarding playbooks

A core goal of onboarding is populating Memory Blocks without asking the user to author them by hand. Two auto-attach mechanisms land with this spec:

**Mechanism A — Playbook outputs write to Memory Blocks.**

Playbooks can declare a `knowledgeBinding` (§8) that maps a named step output to a specific block label. On run completion, the engine calls `memoryBlockService.upsertFromPlaybook({ subaccountId, label, content, sourceRunId })` for each bound output. Upsert semantics:

- If a block with that label exists for the sub-account, its content is replaced and `updatedAt` is bumped.
- If no such block exists, it is created.
- Config History logs the mutation with `actorAgentId = resolved Configuration Assistant` and `playbookRunId = run.id` (new optional column on the config history row; see §3.4 data contracts).

**Mechanism B — References created from playbook steps are tagged `playbook:<slug>`.**

Any Reference created via `action_call → config_create_workspace_memory_entry` inside a playbook run is tagged automatically with `playbook:${playbook.slug}` and `run:${runId}`. This makes the Unified Knowledge page's filter chip row useful for debugging ("show me everything the Daily Brief has ever written"). Tagging is done server-side in the action_call dispatcher (§4) — the playbook author does not have to remember to add tags.

### 7.5 Safeguards

- **Auto-attach rate limit.** A single playbook run may upsert at most 10 Memory Blocks. The 11th attempt fails the step with `blockedByPolicy: memory_block_quota_per_run`. Prevents a runaway step from nuking the block store.
- **Block label uniqueness.** Labels are unique per sub-account (DB unique index on `(subaccountId, label)`). Upserts match by label; creates that collide fail with a validator error surfaced back to the step.
- **Size cap.** Block content is capped at 2,000 characters (enforced both at the Zod schema and the DB `CHECK` constraint). Longer content belongs in References.
- **HITL for irreversible overwrites.** If a playbook step's auto-attach would replace a Memory Block that was last edited by a human (i.e. `lastEditedByAgentId` is null), the dispatcher pauses the step with `reviewKind: 'memory_block_overwrite'` and surfaces a diff in the run modal. The user can approve, edit-then-approve, or reject. This rule does NOT fire for blocks previously written by the same playbook slug (those are safe to rewrite).

### 7.6 Out of scope for v1

- Cross-subaccount knowledge sharing (org-level blocks).
- Vector search over Memory Blocks (they are loaded wholesale into every run).
- Versioned block history with rollback UI (Config History captures the changelog; we do not build a dedicated "block timeline" view yet).
- Bulk import (CSV / JSON upload). Power users will ask for it; defer until we see the shape of real demand.
- Block templates ("clone this from a system library"). Playbooks fill that niche already.

---

## 8. Primitive — Playbook `knowledgeBinding`

### 8.1 Why this is a primitive, not just a playbook field

A playbook is only as useful as what it leaves behind. The Daily Intelligence Brief is the clearest case: the first run captures facts about the sub-account (brand voice, key products, competitors) that every subsequent run — and every unrelated agent run — benefits from reading. Without a declarative binding, the author would have to either (a) hand-write an `action_call` step per block, doubling step counts, or (b) fake it by writing to Workspace Memory Entries and relying on vector retrieval, which undermines the whole point of the hot-path block store.

`knowledgeBinding` is the declarative shortcut: the author says "the output of this step should land in this block", the engine does the upsert.

### 8.2 Definition shape

New optional top-level field on `PlaybookDefinition` (`server/lib/playbook/types.ts`):

```ts
export interface PlaybookKnowledgeBinding {
  /** The step id whose output we read from. Must exist in steps[]. */
  stepId: string;
  /** JSON path within the step output to extract (dot notation, array indices allowed). */
  outputPath: string;
  /** The Memory Block label to upsert. 1–80 chars, [a-zA-Z0-9 _-]. */
  blockLabel: string;
  /**
   * How to combine this output with existing block content:
   *   - 'replace' — overwrite the block with the new content (default).
   *   - 'append'  — append with a newline delimiter, trimming to 2000 chars.
   *   - 'merge'   — JSON-aware merge; requires both sides to be JSON objects.
   */
  mergeStrategy?: 'replace' | 'append' | 'merge';
  /**
   * When true, the binding only fires on the first successful run for this
   * sub-account + playbook slug. Subsequent runs skip the upsert.
   * Use for baseline facts captured once during onboarding.
   */
  firstRunOnly?: boolean;
}

export interface PlaybookDefinition {
  // … existing fields
  knowledgeBindings?: PlaybookKnowledgeBinding[];
}
```

Exactly mirrored on the `playbookTemplateVersions` row (stored inside the JSONB `definition` column; no new column needed). The renderer (`server/lib/playbook/renderer.ts`) emits `knowledgeBindings` as a plain-JSON array — no Zod placeholders needed because every field is primitive-typed.

### 8.3 Validator rules

Added to `server/lib/playbook/validator.ts` and to the `ValidationRule` union in `server/lib/playbook/types.ts`:

| Rule id                                   | Meaning                                                                           |
|-------------------------------------------|-----------------------------------------------------------------------------------|
| `knowledge_binding_step_not_found`        | `stepId` references a step that does not exist in `steps[]`.                      |
| `knowledge_binding_duplicate_label`       | Two bindings target the same `blockLabel` within one definition.                  |
| `knowledge_binding_invalid_label`         | `blockLabel` fails the length / charset regex.                                    |
| `knowledge_binding_invalid_output_path`   | `outputPath` is empty, starts with `.`, or contains invalid tokens.               |
| `knowledge_binding_merge_requires_object` | `mergeStrategy: 'merge'` on a step whose `outputSchema` top type isn't an object. |

Validator fires at the same three checkpoints as every other rule (seeder, `publishOrgTemplate()`, `startRun()`).

### 8.4 Engine integration

At run completion (inside `playbookRunService.finaliseRun()`), after the terminal-state transition but before the run row is marked `completed` / `completed_with_errors`:

```ts
for (const binding of def.knowledgeBindings ?? []) {
  const stepRun = stepRunsByStepId.get(binding.stepId);
  if (!stepRun || stepRun.status !== 'completed') continue;

  if (binding.firstRunOnly) {
    const prior = await playbookRunRepo.findPriorSuccessfulRun({
      subaccountId: run.subaccountId,
      playbookSlug: def.slug,
      beforeRunId: run.id,
    });
    if (prior) continue;
  }

  const value = getByPath(stepRun.output, binding.outputPath);
  if (value === undefined) {
    await runEventService.warn(run, {
      code: 'knowledge_binding_missing_output',
      bindingStepId: binding.stepId,
      outputPath: binding.outputPath,
    });
    continue;
  }

  await memoryBlockService.upsertFromPlaybook({
    subaccountId: run.subaccountId,
    label: binding.blockLabel,
    content: serialiseForBlock(value, binding.mergeStrategy ?? 'replace'),
    mergeStrategy: binding.mergeStrategy ?? 'replace',
    sourceRunId: run.id,
    actorAgentId: run._meta.resolvedAgents?.configurationAssistant ?? null,
  });
}
```

Key properties:

- Bindings are evaluated **after** the run has reached a terminal state — so a mid-run failure never partially-writes blocks.
- A missing output path emits a warning event (visible in the run modal timeline) but does NOT fail the run. The author can see and fix it on the next version bump.
- The rate limit (§7.5, 10 blocks per run) is shared with `action_call → config_create_memory_block` — bindings count toward the same budget, enforced inside `memoryBlockService.upsertFromPlaybook`.
- HITL overwrite rule (§7.5) applies equally to bindings. A binding that would overwrite a human-edited block surfaces as `reviewKind: 'memory_block_overwrite'` and parks the run in `awaiting_review` state even after all steps are complete. This is the only case where a "completed all steps" run can be pending — called out explicitly because it crosses the usual step-centric HITL boundary.

### 8.5 Replay semantics

When a run is replayed (see spec §4.6), `knowledgeBindings` do NOT fire. Replay is for observability, not for re-upserting facts we already wrote. The run timeline renders a grey "(binding skipped — replay mode)" line per binding so the behaviour is visible.

### 8.6 Out of scope for v1

- Binding to Reference outputs (Workspace Memory Entries). If the output is long-form, write it via `action_call` instead — bindings are for the hot-path block store.
- Conditional bindings (fire only if output matches a predicate). Use a `conditional` step to gate the producing step instead.
- Cross-step bindings (combine outputs from multiple steps). The author can do this with an intermediate `prompt` step that assembles the combined output.
- Emitting events to external systems (webhooks, email). Belongs in an `action_call` step, not a binding.

---

## 9. Primitive — Playbook run modal + onboarding tab + portal card

### 9.1 The three surfaces, one run object

A single `playbookRuns` row is visible across three surfaces with different framing:

| Surface                                              | Who sees it        | Framing                                                                            |
|------------------------------------------------------|--------------------|------------------------------------------------------------------------------------|
| **Run modal** (`/sub/:subaccountId/runs/:runId`)     | Admin + sub-account| The authoritative timeline — every step, every event, every HITL review. Deep.     |
| **Onboarding tab** (sub-account detail page)         | Admin only         | Progress view — "which onboarding playbooks have been run, which are still owed?"  |
| **Portal card** (sub-account portal)                 | Sub-account user   | Output view — "here is your brief / report, with a single Run now button."         |

All three read from the same data; the spec below defines the contract each surface depends on.

### 9.2 Run modal

Route: `/sub/:subaccountId/runs/:runId` — new file `client/src/pages/subaccount/PlaybookRunPage.tsx`. Rendered inside the existing subaccount shell.

Layout:

```
┌─ Header: playbook name, version, status pill, kebab menu (Replay, Cancel, Edit template) ─┐
│                                                                                             │
│  ┌─ Left rail: step DAG (read-only visualisation) ─┐   ┌─ Right: selected step detail ──┐  │
│  │  ● event_basics      (completed)                │   │  Step name, type, timing       │  │
│  │  ● research          (running)     ← selected   │   │  Input (templated, resolved)   │  │
│  │  ○ draft             (pending)                  │   │  Output (if complete)          │  │
│  │  ○ publish           (pending)                  │   │  Events timeline (scrollable)  │  │
│  └─────────────────────────────────────────────────┘   └────────────────────────────────┘  │
│                                                                                             │
│  ┌─ Footer: HITL action bar (only when awaiting_review) ────────────────────────────────┐  │
│  │  [Approve]  [Approve & edit]  [Reject]    ← sticky when step type needs review       │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

New contract pieces the modal depends on:

1. **`GET /api/subaccounts/:id/playbook-runs/:runId/envelope`** — single round-trip fetch returning: run row, ordered step-run rows, per-step event timeline (last 100 per step, paginated on scroll), resolved template definition, resolved agent slugs, and the viewer's permission set for this run. Authored in `server/routes/playbookRuns.ts`.
2. **`PATCH /api/subaccounts/:id/playbook-runs/:runId/portal-visibility`** — toggles the `isPortalVisible` boolean (see §9.4). Admin-only.
3. **WebSocket room `playbook-run:${runId}`** — emits `step_updated`, `event_appended`, `run_status_changed` messages. Client listens via existing `useSocket` hook. No polling fallback — the envelope fetch on mount is the fallback.

Behaviour rules:

- The step DAG visual is NOT the editor. It is a read-only projection of the compiled template. Editing routes through the Studio (existing).
- Selecting a step updates the right pane but does not change the URL — the URL identifies the run, not the step.
- HITL action bar is sticky at the bottom of the right pane when the selected step's status is `awaiting_review` AND the viewer has `playbook_run.review` permission for this sub-account.
- Events timeline uses the existing `RunEventsList` component (factored out of the current Configuration Assistant session page if needed — this is a refactor-in-place, not a fork).
- Cancel button on the header kebab is hidden unless run status is `running` or `awaiting_review`. Cancel transitions to `cancelled` and short-circuits pending steps.

### 9.3 Onboarding tab (admin)

New tab on `AdminSubaccountDetailPage.tsx` between the existing `Overview` and `Configure` tabs. Content:

```
Onboarding

  Status: 2 of 3 playbooks complete

  ● Welcome & brand voice        Completed 2 days ago           [Open run]
  ● Daily Intelligence Brief     Running — step 3 of 6          [Open run]
  ○ Competitive landscape        Not started                    [Start now]

  ┌─ About onboarding playbooks ───────────────────────────────────────────────┐
  │  Onboarding playbooks are the templates the agency runs the first time     │
  │  a sub-account is set up. They capture baseline facts, configure recurring  │
  │  schedules, and leave behind Memory Blocks the rest of the system reads.   │
  │  Edit the set per sub-account via the Modules drawer.                       │
  └─────────────────────────────────────────────────────────────────────────────┘
```

Data source:

- `modules.onboardingPlaybookSlugs` (see §10) — the ordered list of slugs owed for this sub-account's module set.
- `playbookRuns` filtered by `{ subaccountId, playbookSlug IN (...), isOnboardingRun: true }` — new boolean column on `playbookRuns`, defaulted to `false`, set to `true` when the run is started via the Onboarding tab's "Start now" button or via auto-start on sub-account creation (see §11).

Each row has:

- **Not started** → "Start now" button. Opens a pre-filled run creation modal; default inputs come from `playbookDefaults` on the sub-account (existing table).
- **Running / awaiting_review** → "Open run" button → routes to the run modal (§9.2).
- **Completed / failed / completed_with_errors** → "Open run" button (so the admin can audit) + a small status pill.

The tab is admin-only (gated by `subaccount.playbooks.manage` permission). Sub-account users do not see it; their framing is the portal card (§9.4).

### 9.4 Portal card (sub-account user)

New card on the existing sub-account portal page (`client/src/pages/PortalPage.tsx`, route `/portal/:subaccountId`). The card renders once per `playbookRun` where `isPortalVisible = true`.

```
┌─ Daily Intelligence Brief ──────────────────────────────────────────────────┐
│                                                                              │
│  Your latest brief — 14 April 2026                                [Run now]  │
│                                                                              │
│  ● Three competitors moved prices this week.                                 │
│  ● New regulation in your sector — summary below.                            │
│  ● Two of your campaigns are pacing under target.                            │
│                                                                              │
│                                                        [Open full brief →]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Contract:

- Each sub-account-facing playbook declares a `portalPresentation` block in its definition (new optional field, JSON). Shape:
  ```ts
  portalPresentation?: {
    cardTitle: string;                // "Daily Intelligence Brief"
    headlineStepId: string;           // Output of this step renders as the preview
    headlineOutputPath: string;       // Path within that output (same grammar as knowledgeBinding)
    detailRoute?: string;             // Deep link within the portal; default is the run modal
  };
  ```
- Run modal renders in portal-scoped mode (route: `/portal/runs/:runId`) when the viewer is a sub-account user — same component, reduced chrome (no kebab menu, no template version header, no step-level events), feature-flagged by viewer role.
- **Run now** button on the card hits the universal `runNow` enqueue (§5) for the associated scheduled task. Idempotent. Disabled with tooltip "Already running" while a run is in flight.
- **Portal visibility defaults:** `false` for all playbooks except those whose template's `portalPresentation` is set. Admin can override per-run via the run modal toggle (§9.2).
- **Security:** the portal route resolver calls `resolveSubaccount(subaccountId, orgId)` with the portal user's `orgId`, then filters runs by `subaccountId` AND `isPortalVisible = true`. No cross-sub-account leakage.

### 9.5 `HelpHint` placements on these surfaces

- Run modal HITL action bar: a `HelpHint` next to "Approve & edit" explaining the difference ("Edit the step's output before approving — useful when the agent is 90% right but needs a small correction").
- Onboarding tab "About" card: no hint needed (the card itself is the explanation).
- Portal card "Run now" button: `HelpHint` — "Kicks off the brief immediately. Your next scheduled run still happens on time."

### 9.6 Out of scope for v1

- Step-level permissions (different users can approve different step types). v1 is binary: either you have `playbook_run.review` for the sub-account or you don't.
- Live in-modal re-ordering of steps. Use the Studio.
- Inline editing of a step's output for non-HITL steps (only HITL approve-and-edit can mutate outputs).
- Portal card customisation per sub-account (logo, colour, bespoke copy). v1 uses a single card design.
- Email digest of run events. If the user cares about updates, they subscribe via the existing webhook/email route — we don't rebuild it here.

---

## 10. Primitive — `modules.onboardingPlaybookSlugs`

### 10.1 Purpose

A sub-account is configured by its module set — each module represents a bundle of capabilities the agency turned on for that sub-account (e.g. "social", "content", "reporting"). Different modules imply different onboarding needs. Hard-coding "run the Daily Brief playbook for every sub-account" collapses the moment a second playbook ships.

`onboardingPlaybookSlugs` declares — on a per-module basis — which playbook templates should be run during onboarding for any sub-account that enables that module. The Onboarding tab (§9.3) reads the union of slugs across the sub-account's enabled modules and renders progress against that union.

### 10.2 Schema change

New column on `modules` table (migration `0119_modules_onboarding_playbook_slugs.sql`):

```sql
ALTER TABLE modules
  ADD COLUMN onboarding_playbook_slugs text[] NOT NULL DEFAULT '{}';
```

Notes:

- Stored as a Postgres text array, not JSON. Slugs are short identifiers; array semantics (contains, overlap) are natural-fit for the query below.
- `NOT NULL DEFAULT '{}'` so existing rows get an empty set without a backfill migration.
- No FK — slugs reference `playbookTemplates.slug` which is itself a string key, not a stable FK target (templates are versioned; slug is the identifier across versions).
- Validator runs on save: every slug must resolve to at least one published `playbookTemplates` row. If not, the save fails with `invalid_slug: <slug>`.

### 10.3 Drizzle + service layer

`server/db/schema/modules.ts` — add the column to the TS schema, typed as `string[]`.

`server/services/moduleService.ts` — extend `updateModule()` to accept `onboardingPlaybookSlugs?: string[]` and validate each slug before writing. Config History logs the change (entity type `module`).

`server/services/subaccountOnboardingService.ts` (new) — exposes:

```ts
listOwedOnboardingPlaybooks(subaccountId: string): Promise<{
  slug: string;
  moduleIds: string[];             // Which enabled modules contributed this slug
  latestRun: { id: string; status: string; startedAt: string } | null;
}[]>;

startOwedOnboardingPlaybook(params: {
  subaccountId: string;
  slug: string;
  startedByUserId: string;
  runMode: 'auto' | 'supervised';
}): Promise<{ runId: string }>;
```

`listOwedOnboardingPlaybooks` drives the Onboarding tab. It computes the union of slugs from enabled modules, dedups, joins to the latest matching `playbookRuns` row per slug (filtered by `isOnboardingRun: true`), and returns the composite list.

`startOwedOnboardingPlaybook` wraps `playbookRunService.startRun()` with `isOnboardingRun: true` and default inputs loaded from the sub-account's stored `playbookDefaults` (existing table, existing pattern).

### 10.4 UI adoption

- **Module admin page** (`client/src/pages/SystemModulesPage.tsx`, existing, route `/system/modules`): each module row gains a "Onboarding playbooks" multi-select. Options are the published system + org playbook slugs visible to the org. `HelpHint`: "Sub-accounts that enable this module will be prompted to run these playbooks during setup."
- **Subaccount Onboarding tab** (§9.3): reads `listOwedOnboardingPlaybooks()`.

### 10.5 Auto-start on sub-account creation

When a sub-account is created (or a new module is enabled on an existing sub-account), the owed list is computed. For each owed slug:

- If the slug's template has `autoStartOnOnboarding: true`, a run is enqueued automatically with `runMode: 'supervised'` (the admin still approves, but the run object exists so the progress view is immediately accurate).
- Otherwise the slug appears as "Not started" in the tab; the admin starts it manually.

`autoStartOnOnboarding` is a new optional boolean on `PlaybookDefinition` (default `false`). Daily Intelligence Brief (§11) ships with `autoStartOnOnboarding: true`.

Rate-limit safety: the auto-start dispatcher runs inside a sub-account creation transaction but enqueues via pg-boss (outside the transaction, on commit) so failure to enqueue does not roll back sub-account creation. A failed enqueue logs a warning and leaves the slug as "Not started" — the admin can Start now manually. Same pattern as §5.8 failure isolation.

### 10.6 Migration / backfill

No backfill. Existing modules start with `onboarding_playbook_slugs = '{}'` and the agency fills them in as they adopt onboarding playbooks.

For the Daily Intelligence Brief rollout specifically, the seeder script (`server/scripts/seedOnboardingModules.ts`, new) sets `onboardingPlaybookSlugs = ['daily-intelligence-brief']` on the default "reporting" module — scoped per org, idempotent, safe to re-run. Orgs that have customised their module set skip the update.

### 10.7 Out of scope for v1

- Per-sub-account overrides ("I want to skip this one playbook for this one sub-account"). Reasonable ask; wait for the second real example before designing the override model. In the meantime, an admin can start-then-cancel.
- Required vs optional slugs (some must complete before the sub-account is "ready"). Every owed slug is optional in v1; completion is informational, not gating.
- Ordering constraints ("must run playbook A before playbook B"). Authors can compose via `dependsOn` within a single playbook; cross-playbook ordering isn't needed yet.

---

## 11. System template — Daily Intelligence Brief

### 11.1 Why this playbook is the wedge

It is deliberately the **first** template we ship that exercises every primitive this spec introduces:

- `action_call` (§4) — to create a recurring scheduled task and to write the brief to the portal.
- `SchedulePicker` + `runNow` (§5) — the first run happens immediately; subsequent runs on cron.
- `HelpHint` (§6) — onboarding form walks an admin through setup.
- Unified Knowledge (§7) — the brief reads Memory Blocks as context.
- `knowledgeBinding` (§8) — baseline facts captured in the first run are written back as blocks.
- Run modal + portal card (§9) — admin watches progress, sub-account user sees the output.
- `modules.onboardingPlaybookSlugs` (§10) — the "reporting" module auto-offers this playbook on sub-account creation.

If this playbook ships end-to-end, every primitive has a proof point. If it doesn't, something structural is wrong. That is the value of picking this as the first concrete template.

### 11.2 File + slug

File: `server/playbooks/daily-intelligence-brief.playbook.ts` (new). Slug: `daily-intelligence-brief`. Hand-authored (not Studio-generated) so we can use real Zod schemas and exercise the full code path.

### 11.3 Inputs

```ts
initialInputSchema: z.object({
  focusAreas: z.array(z.enum([
    'competitive', 'regulatory', 'campaigns', 'industry_news',
  ])).min(1),
  schedule: SchedulePickerValue,       // §5.2 canonical shape
  deliveryEmails: z.array(z.string().email()).max(5),
  portalVisible: z.boolean().default(true),
})
```

The initial-input form is rendered by the existing Playbook start modal with the schema-driven form renderer. `SchedulePicker` is wired via the `schedule` field's type annotation (picked up by the renderer's custom-field registry, extended in this change to register the `SchedulePickerValue` shape).

### 11.4 Step DAG (v1)

```
setup_schedule (action_call, idempotent)
  └─► research (agent_call, idempotent)
        └─► draft (prompt, none)
              ├─► publish_portal (action_call, reversible, humanReviewRequired)
              └─► send_email (action_call, irreversible)
```

Step-by-step:

1. **`setup_schedule`** — `action_call` → `config_create_scheduled_task`. Inputs: the resolved `schedule` value. Output: `{ taskId: string, scheduleId: string }`. `sideEffectType: idempotent` (§4.8 — idempotent actions may auto-execute; pg-boss singletonKey dedupes). Only fires on the first successful run for this sub-account + slug (gated by `firstRunOnly` check inside the step's `dependsOn` using the Config History lookup — if a task with the canonical slug already exists, skip with a `no-op` output).
2. **`research`** — `agent_call` on the existing "research assistant" system agent (slug `research-assistant`). Inputs: `focusAreas`, sub-account context, Memory Blocks via auto-load. `outputSchema`: `{ findings: Array<{ topic, summary, sources }>, rawNotes: string }`. `sideEffectType: idempotent`. `retryPolicy.maxAttempts: 3`.
3. **`draft`** — `prompt` step using Haiku (model override). Renders the findings into a portal-ready brief. `outputSchema`: `{ title: string, bullets: string[], detailMarkdown: string }`. `sideEffectType: none`. No retries beyond default.
4. **`publish_portal`** — `action_call` → `config_publish_playbook_output_to_portal` (new skill — see §11.6). `sideEffectType: reversible`, `humanReviewRequired: true` on supervised runs only (auto mode skips review per §4.6). Writes the `draft` output to a portal-visible presentation linked to this run.
5. **`send_email`** — `action_call` → `config_send_playbook_email_digest` (new skill — see §11.6). `sideEffectType: irreversible`. Sends to `deliveryEmails`. Fails loud — no auto-retry (invariant 4.8).

`knowledgeBindings` declared at the playbook level:

```ts
knowledgeBindings: [
  {
    stepId: 'research',
    outputPath: 'baselineFacts',     // populated on first run only; empty object otherwise
    blockLabel: 'Sub-account intelligence baseline',
    mergeStrategy: 'merge',
    firstRunOnly: true,
  },
]
```

### 11.5 `portalPresentation`

```ts
portalPresentation: {
  cardTitle: 'Daily Intelligence Brief',
  headlineStepId: 'draft',
  headlineOutputPath: 'bullets',
  detailRoute: '/portal/briefs/:runId',   // Future: nicer deep-link; falls back to run modal
},
autoStartOnOnboarding: true,
```

### 11.6 New skills required

Two new actions ship with this playbook. Both are added to the `config_*` allowlist (§4.2) because they are Configuration Assistant surface-area actions:

- **`config_publish_playbook_output_to_portal`** — inputs: `{ runId, title, bullets, detailMarkdown }`. Creates a row in `portalBriefs` (new table, migration `0120_portal_briefs.sql`) and sets the associated `playbookRuns.isPortalVisible = true`. Idempotency strategy: `upsert_by_run_id`. Gate level: `auto` (reversible — can be retracted by setting the portal row `retractedAt`).
- **`config_send_playbook_email_digest`** — inputs: `{ runId, to: string[], subject, bodyMarkdown }`. Sends via the existing email provider adapter. Idempotency strategy: `dedupe_by_composite_key` over `(runId, to.sort().join(','))`. Gate level: `review` on first send, `auto` on subsequent re-enqueues of the same composite key. Audited through the same `proposeAction` pipeline (§4.7).

Both skills live under `server/skills/playbookPortal.ts` and `server/skills/playbookEmail.ts` respectively and register in `server/config/actionRegistry.ts`. They are not callable from human-initiated Configuration Assistant sessions directly (add to `ACTIONS_NOT_AGENT_DIRECTLY_CALLABLE` set); only reachable via `action_call` from playbook steps. This narrows blast radius.

### 11.7 Seeder

`server/scripts/seedPlaybooks.ts` picks up the new file automatically (seeder walks `server/playbooks/*.playbook.ts`). Verify in the implementation phase that the seeder's validator runs cleanly with `knowledgeBindings` and `autoStartOnOnboarding` present.

`server/scripts/seedOnboardingModules.ts` (new, §10.6) sets `onboardingPlaybookSlugs = ['daily-intelligence-brief']` on the default "reporting" module per org.

### 11.8 Acceptance walk

Given a fresh sub-account with the "reporting" module enabled:

1. Sub-account creation commits. A supervised run of `daily-intelligence-brief` is enqueued (auto-start).
2. Admin opens Onboarding tab → sees the run awaiting review on step 1.
3. Admin reviews + approves `setup_schedule` → a scheduled task is created with `runNow: true`, so a second run of the same playbook is enqueued one tick later (the "real" first brief).
4. That second run executes in `auto` mode (it wasn't started from the onboarding tab — only the auto-start run is supervised). Research + draft complete.
5. `publish_portal` runs in auto mode (irreversible=false, review not required in auto mode). Sub-account user opens the portal and sees the new card with headline bullets.
6. `send_email` sends. Email arrives.
7. Next day at the scheduled time, the cron fires again. Steps 2–5 re-run (step 1 is a no-op since the scheduled task already exists).
8. Memory Block "Sub-account intelligence baseline" is visible on the Unified Knowledge page (Memory Blocks tab), with `sourceRunId` pointing at the first run. Subsequent runs do not overwrite it (firstRunOnly).

If every bullet above holds, the playbook ships.

### 11.9 Out of scope for v1 (this playbook)

- Per-bullet "dig deeper" actions on the portal card.
- Historical brief archive UI (briefs are stored but only the latest is surfaced; an archive page is deferred).
- Bespoke prompt tuning per sub-account industry (the `research-assistant` agent's `additionalPrompt` covers this, but the playbook doesn't surface a tuning UI — admins use the existing agent configure page).
- A/B testing of brief formats.

---

## 12. Build plan & sequencing

### 12.1 Sequencing principle

Build primitives bottom-up. Each phase ships behind a feature flag and is independently reviewable. We do NOT mix primitive work with template authoring — the Daily Brief template is the last thing that lands, on top of finished primitives.

### 12.2 Phases

**Phase A — `action_call` step type (§4).**

1. Schema: add `'action_call'` to `StepType`, add `actionSlug` / `actionInputs` fields, new `ValidationRule` entries. Update `server/lib/playbook/types.ts`, `validator.ts`, `renderer.ts`.
2. Allowlist file `server/lib/playbook/actionCallAllowlist.ts` with frozen 28-slug set (config_* only) + the two new skills from §11.6 (brings the set to 30 at the point §11 lands, not now).
3. Engine dispatch case in `playbookRunService` — resolves Configuration Assistant agentId, calls `executeActionCall()` helper, routes through `proposeAction` → `skillExecutor.execute`.
4. `executeActionCall()` helper in `server/services/playbookActionCallExecutor.ts`.
5. HITL resumption path wired into existing `playbookStepReviewService`.
6. Tests: pure validator tests, dispatch unit tests (mock `actionService.proposeAction`), replay tests.

**Phase B — `SchedulePicker` + universal `runNow` (§5).**

1. `SchedulePicker` component + `SchedulePickerValue` type + `schedulePickerValueToCron()` server helper.
2. `scheduledTaskService.create()` extended with `runNow?: boolean`; pg-boss singletonKey wiring.
3. Adopt on the existing scheduled-task admin form (swap in the new picker; verify cron output matches legacy behaviour).
4. "Run now" button on existing scheduled-task row list (hits the same idempotent enqueue).
5. Tests: picker unit tests, cron normaliser unit tests, idempotency integration test.

**Phase C — `HelpHint` (§6).**

1. Component file + portal mount in `App.tsx`.
2. Unit tests.
3. Lint rule `scripts/verify-help-hint-length.mjs`, wired into `run-all-gates.sh`.

**Phase D — Unified Knowledge page (§7) + `knowledgeBinding` (§8).**

1. Route + page shell with two tabs; read-only first (no mutations).
2. Reference CRUD (mostly wiring to existing `workspaceMemoryEntries` service).
3. Memory Block CRUD + `sourceReferenceId` migration.
4. Promote / demote flow.
5. `knowledgeBinding` type, validator rules, engine integration in `finaliseRun()`.
6. `memoryBlockService.upsertFromPlaybook()` with rate limit + HITL overwrite rule.
7. Tests: promotion idempotency, bindings fire on success, bindings skip on replay, overwrite HITL.

**Phase E — Run modal + onboarding tab + portal card (§9).**

1. Envelope endpoint + WebSocket room.
2. Run modal page.
3. Onboarding tab on `AdminSubaccountDetailPage` with `subaccountOnboardingService.listOwedOnboardingPlaybooks()`.
4. Portal card component + portal-scoped run modal route.
5. Tests: envelope shape, WebSocket broadcast, portal visibility isolation.

**Phase F — `modules.onboardingPlaybookSlugs` (§10).**

1. Migration + schema + service.
2. Module admin page multi-select UI.
3. Auto-start hook on sub-account creation (and on module enable for existing sub-accounts).
4. `seedOnboardingModules.ts` seeder.
5. Tests: owed list computation, auto-start failure isolation.

**Phase G — Daily Intelligence Brief template (§11).**

1. New skills: `config_publish_playbook_output_to_portal`, `config_send_playbook_email_digest`.
2. `portalBriefs` table migration.
3. `daily-intelligence-brief.playbook.ts` file.
4. Add slugs to `ACTIONS_NOT_AGENT_DIRECTLY_CALLABLE`.
5. Seeder hook to set module slug.
6. End-to-end acceptance walk (§11.8) executed manually + automated happy-path integration test.

### 12.3 Feature flags

Every phase is gated by a Growthbook flag rather than a code flag (flags live in env per the existing pattern):

- `feature.playbook_action_call` — guards engine dispatch case in Phase A.
- `feature.schedule_picker_v2` — guards the new picker; legacy picker remains until flip.
- `feature.unified_knowledge_page` — guards the new route; existing pages stay visible until flip.
- `feature.playbook_run_modal_v2` — guards the new modal; legacy run detail page stays as fallback.
- `feature.onboarding_tab` — guards the Onboarding tab on the subaccount detail page.
- `feature.daily_brief_template` — guards the seeder from installing the new template.

Flags are removed phase-by-phase once each ships and bakes for at least one release cycle.

### 12.4 Ordering constraints

- Phase A must land before Phase G (template depends on `action_call`).
- Phase B must land before Phase G (template depends on `SchedulePicker`).
- Phase C is independent — can land in parallel with any phase.
- Phase D must land before Phase G (template depends on `knowledgeBinding`).
- Phase E must land before Phase G (template needs portal card + run modal to be useful).
- Phase F can land in parallel with E; depends only on Phase G being imminent (the seeder references the `daily-intelligence-brief` slug).

Recommended merge order for single-reviewer bandwidth: A → B → C → D → E → F → G. Phases A–F are reviewable standalone; G is the acceptance-walk gate.

### 12.5 PR granularity

Each phase splits into ~2–4 PRs max. No single PR contains more than one primitive. Phase G ships as a single PR with the skill file + playbook file + migration + seeder hook — it's small because the primitives did the heavy lifting.

---

## 13. Test strategy & gates

### 13.1 Pure unit tests (the majority of coverage)

Following the existing `*Pure.test.ts` convention under `server/services/__tests__/` — pure functions, zero DB, zero network. Every new primitive ships pure tests:

- `actionCallValidator.pure.test.ts` — validator rules for `action_call` steps.
- `actionCallAllowlist.pure.test.ts` — snapshot test over the frozen allowlist set; fails if a slug is added without updating the snapshot (forces intentional review).
- `executeActionCall.pure.test.ts` — contract test; mocks `actionService.proposeAction` and asserts input resolution, idempotency-key hashing, and state transitions for each `proposeAction` return type.
- `schedulePickerValueToCron.pure.test.ts` — table-driven cron normalisation over every picker shape.
- `knowledgeBindingValidator.pure.test.ts` — validator rules for bindings.
- `knowledgeBindingRuntime.pure.test.ts` — `finaliseRun()` binding-evaluation behaviour (firstRunOnly, missing output paths, rate limit, replay skip).
- `memoryBlockUpsert.pure.test.ts` — upsert semantics, rate limit, HITL overwrite trigger.
- `onboardingOwedList.pure.test.ts` — owed slug computation from module sets.

### 13.2 Integration tests

Where DB state + cross-service interactions matter. Use the existing harness (`server/testUtils/integrationHarness.ts` — verify exact path at implementation time). Target set:

- **`playbookRun.actionCall.integration.test.ts`** — full run of a toy playbook with one `action_call` step. Asserts Config History entry exists, idempotency dedupe works across retry, blocked actions halt the run correctly.
- **`scheduledTaskRunNow.integration.test.ts`** — create + runNow + assert a run exists within 5 seconds; repeat create with same inputs and assert no duplicate run (idempotency).
- **`knowledgeBinding.integration.test.ts`** — run a playbook that writes a binding, verify block exists; run again and verify firstRunOnly prevents overwrite; human-edit the block, run again, verify HITL review fires.
- **`onboardingAutoStart.integration.test.ts`** — create sub-account with "reporting" module enabled, assert daily-brief run is enqueued in supervised mode; simulate pg-boss failure, assert sub-account creation still succeeds with a warning logged.
- **`portalVisibility.integration.test.ts`** — assert RLS isolates portal briefs per sub-account, and that toggling `isPortalVisible` propagates.

### 13.3 Client tests

- `HelpHint.test.tsx` — open/close, Escape, click-outside, HTML escaping, `clickOnly` mode.
- `SchedulePicker.test.tsx` — emits canonical shape for every interval, runNow toggle, empty-state seeding, first-run-before-now validation.
- `SubaccountKnowledgePage.test.tsx` — tab switching, promote flow, filter chips, search.
- `PlaybookRunPage.test.tsx` — DAG rendering, HITL action bar visibility, WebSocket message handling (mock socket).
- `OnboardingTab.test.tsx` — renders owed list, start-now flow, progress counts.

### 13.4 Static gates

New gates, all wired into `scripts/run-all-gates.sh`:

- `scripts/verify-action-call-allowlist.sh` — fails if `actionCallAllowlist.ts` references a mutation slug not in `actionRegistry.ts`, or a read slug not in `skillExecutor.ts`. (Read-only slugs live only in `skillExecutor.ts`; mutation slugs live only in `actionRegistry.ts` — both surfaces must be checked.)
- `scripts/verify-help-hint-length.mjs` — fails if any `<HelpHint text="…" />` literal exceeds 280 chars (§6.8).
- `scripts/verify-playbook-portal-presentation.mjs` — fails if a playbook declares `portalPresentation.headlineStepId` that doesn't exist in its `steps[]`.
- `scripts/verify-onboarding-slugs.mjs` — fails if any `modules.onboarding_playbook_slugs` array contains a slug with no published template (data gate; runs against a seeded test DB).

### 13.5 Gates out of scope for v1

- End-to-end Playwright run of the full Daily Brief flow. We assert correctness via integration tests on each primitive + a manual acceptance walk (§11.8) on the template itself. An E2E happens once the portal rendering stabilises.
- Load testing of pg-boss runNow enqueue under concurrent sub-account creation. Existing pg-boss behaviour is already exercised by scheduledTasks; we trust it.

### 13.6 Acceptance criteria (what "done" means for this spec)

Every goal in §1 has a verifiable assertion. At spec-complete, each assertion must have at least one test from §13.1–§13.3 that proves it. The `tasks/todo.md` entry for this work closes with a table mapping G1–G12 → test name. Any goal without a test fails the task.

---

## 14. Rollback / backout

### 14.1 Posture

Every phase is independently reversible because every phase ships behind a feature flag (§12.3) and every schema change is additive (no drops, no renames of existing columns). Rollback means flipping flags off and, if necessary, reverting the seeder — never rolling back migrations.

### 14.2 Per-phase backout

**Phase A — `action_call`.** Flip `feature.playbook_action_call` off. Existing `action_call` step rows fail fast with "action_call disabled" — runs in flight pause as `awaiting_review` with a rejection, or we cancel them via the kebab menu. Since no system templates use `action_call` until Phase G ships, the realistic impact in A through F is zero in-flight runs.

**Phase B — `SchedulePicker` + `runNow`.** Flip `feature.schedule_picker_v2` off. Legacy scheduled-task form resurfaces. Tasks created with `runNow` are already in pg-boss; they finish on their own. The new column (`lastRunNowEnqueuedAt`, if any) stays but is unread.

**Phase C — `HelpHint`.** No runtime dependency anywhere. Revert the component file; every caller's usage becomes a type error and is removed in the same revert PR. No data implications.

**Phase D — Unified Knowledge + `knowledgeBinding`.** Flip `feature.unified_knowledge_page` off — the legacy pages remain. Bindings are additive on `playbookDefinition` — old definitions without `knowledgeBindings` keep working. New definitions with bindings silently skip the bindings when the flag is off (engine guard inside `finaliseRun()`). `sourceReferenceId` column stays NULL; no cleanup needed.

**Phase E — Run modal + onboarding tab + portal card.** Flip `feature.playbook_run_modal_v2` off → existing run detail page serves. Flip `feature.onboarding_tab` off → tab disappears; no data deleted. Portal card is rendered only when the template has `portalPresentation` — removing the template removes the card.

**Phase F — `modules.onboardingPlaybookSlugs`.** Column is NOT NULL DEFAULT '{}' so removing references to it is free. The auto-start hook is feature-flagged via the Onboarding tab flag. Seeded slug values are harmless until a template with that slug exists.

**Phase G — Daily Intelligence Brief.** Flip `feature.daily_brief_template` off in the seeder path. Existing template version in DB stays (versioned; not deleted). Existing runs continue. To fully retire: set the template's `isActive = false`, cancel in-flight runs, leave rows in place for audit.

### 14.3 Data migrations reversal

| Migration                                        | Reversal plan                                                                  |
|--------------------------------------------------|---------------------------------------------------------------------------------|
| `0118_memory_block_source_reference.sql` (§7.3) | Column stays; nullable; ignored by old code. No reversal needed.                |
| `0119_modules_onboarding_playbook_slugs.sql`    | Column stays; default `'{}'`; ignored by old code. No reversal needed.          |
| `0120_portal_briefs.sql` (§11.6)                | Table stays; unread when `feature.daily_brief_template` is off.                 |

We do not ship `DROP COLUMN` / `DROP TABLE` backout migrations because:

1. Destructive migrations are the highest-risk class in our migration history.
2. Every new column is nullable or defaulted, so it is never required by old code paths.
3. The cost of an unused column is negligible (bytes per row); the cost of a wrong-direction DROP is catastrophic.

### 14.4 Failure containment for the Daily Brief specifically

If the Daily Brief template misbehaves in production (bad output, email spam, portal card renders broken):

1. **Immediate:** flip `feature.daily_brief_template` off in the seeder (stops new sub-accounts from picking it up) AND set `isActive = false` on the current template version (stops new runs from starting for existing sub-accounts).
2. **In-flight runs:** run modal kebab → cancel on each. Scripted path: a one-off `scripts/cancel-active-runs-for-slug.ts` is acceptable scaffolding; write it only if we hit this case.
3. **Scheduled cron entries:** the `setup_schedule` step created pg-boss cron rows; they continue firing until removed. A separate one-off `scripts/remove-scheduled-tasks-for-playbook.ts` deletes scheduled tasks whose `createdByPlaybookSlug = 'daily-intelligence-brief'` (this is the reason for the `createdByPlaybookSlug` column on `scheduledTasks` — add it in Phase B's migration rather than retrofit).
4. **Email digests:** use the existing audit trail (`actionProposalsAudit` or similar — verify name) to identify what was sent; no outbound retraction is possible, so post-mortem is communications, not data.
5. **Portal briefs:** set `retractedAt = now()` on affected rows; the portal card hides retracted briefs.

### 14.5 Forward-compatible field additions

When adding a field to `PlaybookDefinition` (like `knowledgeBindings`, `portalPresentation`, `autoStartOnOnboarding`), the definePlaybook helper must accept the extra field as optional. Old hand-authored playbook files that don't use the new field keep working unchanged — that is the whole value of making fields optional and giving them sensible defaults. We never do breaking changes to `PlaybookDefinition`; if a breaking shape change is ever required, we bump a version discriminant on the definition itself and run both shapes in parallel.

---

## 15. Open questions

These are explicitly left unresolved in this spec. Each is either (a) a legitimate design decision that depends on information we do not yet have, (b) a scope call we think is out of v1 but should be revisited once the primitives ship, or (c) an implementation detail that a reasonable engineer will resolve while building without changing the shape.

### Q1 — Should `action_call` inputs be separately validated against the target skill's input schema?

Currently the `action_call` dispatcher resolves `actionInputs` templates, passes them to `proposeAction`, and relies on `skillExecutor` to reject malformed inputs at execute-time. An alternative is to validate at **template publish** time by cross-referencing the skill's declared input schema from `actionRegistry.ts`. Publish-time validation catches author mistakes earlier; runtime validation is simpler and already exists. **Recommendation:** start with runtime-only; add publish-time validation once we have 3+ playbooks using `action_call` and have a real error taxonomy.

### Q2 — Memory Block rate limit: 10 per run is a guess.

We chose 10 in §7.5 because the Daily Brief plausibly writes 3–5 blocks and 10 gives headroom. No research backs the number. If we start seeing blocked steps in production with a legitimate reason to write more, bump the cap or add a per-template override. Not worth over-engineering pre-v1.

### Q3 — `portalPresentation` is templated, but portal-card layout is fixed.

The card renders title + headline bullets + "open full brief" link. Different playbooks might want different shapes (a single KPI, a trend chart, a CTA button). We are deliberately NOT solving that in v1 — one card shape, one playbook that uses it. Revisit once a second sub-account-facing playbook ships with a need for a different card.

### Q4 — Auto-start supervised vs auto mode.

§10.5 says auto-start enqueues in `supervised` mode. Argument for auto: the agency admin already curated which playbooks run during onboarding, so auto-approval is reasonable. Argument for supervised: onboarding is the highest-stakes moment — the admin should eyeball the first run before approving. We pick supervised for v1; a future per-module override (`autoRunOnOnboarding: boolean`) is trivial to add later.

### Q5 — Emailing from playbooks vs existing notifier.

`config_send_playbook_email_digest` (§11.6) is a new path for outbound email. The existing notifier infrastructure (`server/services/emailService.ts` or similar — verify) already handles transactional email. We are adding the new skill rather than reusing the notifier because: the notifier routes via templates, the playbook output is the template. An alternative is to register the playbook's output as a one-shot notifier template per run. **Open:** which direction to settle on. For v1, new skill is simpler; revisit when we have a second playbook that emails.

### Q6 — Portal authentication for sub-account users.

§9.4 assumes the existing portal auth flow gates the route. We have not verified that `portalBriefs` is correctly covered by the existing RLS policies — it needs a review during Phase G implementation. This is an implementation-phase question, not a spec question, but it's worth a pre-merge security review.

### Q7 — How does `isOnboardingRun` interact with run filters on existing pages?

The existing admin runs list does not filter by `isOnboardingRun`. We could: (a) show onboarding runs in the main list and in the Onboarding tab (visible twice), (b) hide onboarding runs from the main list (sole entry point = tab), (c) add a chip filter. **Recommendation:** (a) — the main list is the audit log, the Onboarding tab is the progress view; both are valid. But open for change.

### Q8 — Should `HelpHint` content live in a central translation catalog from day one?

No i18n infrastructure exists in the app yet. Ripping one in for `HelpHint` alone is overkill. But every hint we ship now is a future translation task. **Recommendation:** plain strings for v1; when i18n lands broadly, the `HelpHint` callers are easy to find via the lint rule's parse pass.

### Q9 — What happens if a sub-account's module set changes mid-onboarding?

Admin removes the "reporting" module before the Daily Brief run completes. Today, the running run is not cancelled — it completes and writes its outputs. On the next Onboarding tab render, the `reporting`-module-contributed slug drops out of the owed list, so the run disappears from the tab. **Behaviour:** the run still exists; the portal card still renders if the template has `portalPresentation`. This is fine but should be called out in the Onboarding tab's empty-state: "Runs from previously-enabled modules remain visible in the full runs list."

### Q10 — Lifetime of a scheduled task created by `setup_schedule`.

The `config_create_scheduled_task` skill creates a pg-boss cron entry. If the admin later disables the Daily Brief (e.g. deletes the template), the cron entry persists until explicitly removed. We rely on the backout script in §14.4 rather than a template-version-aware cleanup. **Open:** do we want a "cascading delete" where retiring a template automatically retires scheduled tasks it created? Probably yes, eventually; not in v1.

### Q11 — Knowledge auto-attach quality gate.

Playbooks can write to Memory Blocks (§8). There is no automated check on the *quality* of what gets written — a hallucinated fact becomes a permanent block loaded into every future run until someone notices and fixes it. We mitigate with: HITL overwrite rule (§7.5), config history provenance (§architecture.md), and the `sourceRunId` backlink on each block. We do NOT add: quality heuristics, confidence thresholds, or a "suggested block" queue. **Open:** should the first run's auto-attached blocks default to pending-human-approval state rather than live-immediately? Conservative case: yes. Aggressive case: approval friction kills the whole point. Flag for the human reviewer to weigh.

### Q12 — Spec coverage of the `agent_decision` step type in onboarding.

The Daily Brief v1 DAG does not use `agent_decision`. We explicitly left it out because adding agent-chosen branching on top of every other new primitive is too much novelty in one template. A follow-up playbook (e.g. a "triage what to report on this week" flow) will exercise it. **Open:** do we want to reserve the `agent_decision` shape now (e.g. confirm `action_call` steps can be entry-steps of a decision branch) or defer until we build the template? §4.10 says `action_call` CAN be a decision-branch entry step; implementers should verify that via a validator unit test even though no production playbook uses it yet.

---

End of spec.
