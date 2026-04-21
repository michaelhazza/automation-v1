# Existing Event/Trigger Infrastructure — Exploration Report

**Scope:** read-only inventory of every existing event-driven / trigger / automation-rule subsystem in the codebase.
**Purpose:** decide whether a new generic `event_rules` subsystem can be built by extending what exists, or must sit alongside it as a new table and service.
**Branch:** `claude/codebase-research-report-xQQbg`
**Date:** 2026-04-21
**Executor:** Claude Code main session, orchestrating three parallel read-only Explore agents.

This report is the companion to [`operator-as-agency-investigation.md`](./operator-as-agency-investigation.md). That report recommended a new `conversion_rules` table (Q4) for BD-specific email-reply-positive → create-subaccount routing. The question this report answers is broader: **should that new table actually be generic (`event_rules`) across all event types and actions, and if so, is there an existing subsystem it can extend?**

Every finding cites specific files and line numbers so the extend-vs-build decision can be made from the evidence without re-exploring the codebase.

---

## Table of contents

- [How to read this report](#how-to-read-this-report)
- [Area 1 — `agent_triggers` + `triggerService`](#area-1--agent_triggers--triggerservice)
- [Area 2 — `scheduled_tasks` + `scheduledTaskService`](#area-2--scheduled_tasks--scheduledtaskservice)
- [Area 3 — `onboarding_bundle_configs` + `subaccountOnboardingService`](#area-3--onboarding_bundle_configs--subaccountonboardingservice)
- [Area 4 — `policy_rules`](#area-4--policy_rules)
- [Area 5 — Webhook event normalisation](#area-5--webhook-event-normalisation)
- [Area 6 — Action dispatch layer](#area-6--action-dispatch-layer)
- [Area 7 — Other event/automation patterns (broad scan)](#area-7--other-eventautomation-patterns-broad-scan)
- [Synthesis — extend or build new?](#synthesis--extend-or-build-new)

---

## How to read this report

Each area is structured identically:

1. **What exists** — tables, services, enums, caller counts, with `file:line` citations.
2. **Extensibility** — what it would take to extend this subsystem to support generic event-to-action routing.
3. **Coupling risk** — what existing callers or assumptions would break if the subsystem were extended.

The synthesis section at the end answers the three questions the brief requires:

- Is there a single existing subsystem that is the right foundation?
- If not, does a new subsystem belong alongside them?
- What's the minimal mapping onto the target event types (`email_reply_positive`, `form_submitted`, `crm_stage_changed`, `scheduled_trigger`, `webhook_received`, `subaccount_created`) and action types (`start_playbook`, `create_subaccount`, `send_notification`, `update_record`, `start_agent_run`)?

The report does **not** propose a schema. That decision is held until the extend-vs-build question is settled.

---

## Area 1 — `agent_triggers` + `triggerService`

### What exists

**Schema** (`server/db/schema/agentTriggers.ts`, columns at `:15-40`, indexes at `:43-47`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organisationId` | uuid NOT NULL FK | |
| `subaccountId` | uuid nullable FK | |
| `subaccountAgentId` | uuid nullable FK → `subaccountAgents` | |
| `eventType` | text NOT NULL, TS-typed | `'task_created' \| 'task_moved' \| 'agent_completed' \| 'org_task_created' \| 'org_task_moved' \| 'org_agent_completed'` (`:24-25`) |
| `eventFilter` | jsonb nullable, default `{}` | `:28` |
| `cooldownSeconds` | integer NOT NULL default 60 | `:31` |
| `isActive` | boolean default true | `:33` |
| `lastTriggeredAt` | timestamptz nullable | `:35` |
| `triggerCount` | integer NOT NULL default 0 | `:36` |
| `createdAt`, `updatedAt`, `deletedAt` | timestamps | |

Indexes: `agent_triggers_subaccount_idx`, `agent_triggers_org_idx`, partial `agent_triggers_event_type_idx` on `(subaccountId, eventType) WHERE deletedAt IS NULL`.

**Enum declared vs actually handled — `org_*` variants are schema-only stubs.** The `checkAndFire()` signature (`server/services/triggerService.ts:64-68`):

```ts
async checkAndFire(
  subaccountId: string,
  organisationId: string,
  eventType: 'task_created' | 'task_moved' | 'agent_completed',   // ← only 3 of 6
  eventData: Record<string, unknown>
)
```

No firing site exists for `org_task_created`, `org_task_moved`, `org_agent_completed`. The route-layer whitelist at `server/routes/agentTriggers.ts:13` also excludes them:

```ts
const VALID_EVENT_TYPES = ['task_created', 'task_moved', 'agent_completed'] as const;
```

**Can triggers fire PLAYBOOKS? No — agent runs only.** The single dispatch path in `checkAndFire()` (`:130-137`) enqueues to `'agent-triggered-run'` pg-boss queue:

```ts
await triggerJobSender(TRIGGER_RUN_QUEUE, {
  subaccountAgentId: trigger.subaccountAgentId,
  subaccountId,
  organisationId,
  triggerContext: { source: 'trigger', eventType, eventData, triggerId: trigger.id },
});
```

The consumer (`agentScheduleService.ts:139-185`) calls `agentExecutionService.executeRun(...)`. **No branching on `trigger.actionType` — the table has no action-type column.**

**`eventFilter` evaluation — strict exact-match key-value, no expression language** (`triggerService.ts:44-52`):

```ts
function matchesFilter(filter, eventData): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (eventData[key] !== value) return false;   // strict !==, no paths/wildcards
  }
  return true;
}
```

Empty filter `{}` always passes. No JSON-path, boolean expression, range or wildcard support.

**Cooldown** (`checkAndFire()` `:107-111`): `lastTriggeredAt` + `cooldownSeconds * 1000` compared to `Date.now()`. Default 60s. Atomically updated at `:141` after successful fire.

**Callers of `checkAndFire()`:**

| Call site | File:line | Event |
|---|---|---|
| `taskService.createTask()` | `server/services/taskService.ts:179` | `task_created` |
| `taskService.updateTask()` (status path) | `server/services/taskService.ts:346` | `task_moved` |
| `agentExecutionService.executeRun()` (post-complete) | `server/services/agentExecutionService.ts:1359` | `agent_completed` |

CRUD callers go through `agentTriggers.ts` route handlers (`:24, 68, 91, 114, 134`). `setTriggerJobSender()` is called from `agentScheduleService.ts:39`.

### Extensibility

**Adding new event types** (e.g. `email_received`, `webhook_received`, `conversion_event`): the `$type<>` annotation is TypeScript-only; the Postgres column is plain `text`. Concrete call-site count to change = **4**: (1) the `$type<>` union (`agentTriggers.ts:25`), (2) `checkAndFire()` param type (`triggerService.ts:66-67`), (3) `VALID_EVENT_TYPES` route whitelist (`agentTriggers.ts:13`), (4) a new firing site wired into the relevant domain service. Existing callers are unaffected — they pass a literal string; `checkAndFire` silently no-ops if no row matches.

**Adding new action types** (e.g. `start_playbook`, `create_subaccount`, `send_notification`): **zero existing callers handle action types** — the table has no `action_type` column. Adding one requires: (1) new column + enum, (2) dispatch branch in `checkAndFire()` after the current `triggerJobSender`, (3) potentially new pg-boss workers per action type. Callers of `checkAndFire()` don't read trigger rows — unaffected.

### Coupling risk

Adding a `target_type` column (`agent_run | playbook_run | notification | subaccount_create`) would not break any caller that fires events. Only callers reading from the table:

- `triggerService.checkAndFire()` — reads `trigger.subaccountAgentId` (`:132`). Needs branching on `target_type`; agent dispatch becomes one branch.
- `triggerService.dryRun()` — reads `trigger.id`, `saLink.agentId` (`:187`, `:213`). Response shape needs updating.
- `listTriggers` / `createTrigger` / `updateTrigger` / `deleteTrigger` — CRUD; input validation on create/update needs extending.
- `routes/agentTriggers.ts` — returns full rows via Drizzle `select()` — auto-includes new columns.

Total: **2 service files** (`triggerService.ts`, `agentScheduleService.ts` for new worker registration) and **1 route file** (`agentTriggers.ts`). **No callers of `checkAndFire()` break.**

---

## Area 2 — `scheduled_tasks` + `scheduledTaskService`

### What exists

**Two tables** (`server/db/schema/scheduledTasks.ts`):

`scheduled_tasks` (`:14-76`): `id`, `organisationId`, `subaccountId`, `title`, `description`, `brief`, `priority` (`low|normal|high|urgent`), `assignedAgentId` (FK `agents.id` NOT NULL), `createdByUserId`, **`rrule` text NOT NULL**, `timezone`, `scheduleTime` (HH:MM wall-clock), `taskSlug`, `createdByPlaybookSlug`, `firstRunAt`, `firstRunAtTz`, `isActive`, `retryPolicy` jsonb, `tokenBudgetPerRun`, `nextRunAt`, `lastRunAt`, `totalRuns`, `totalFailures`, `consecutiveFailures`, `endsAt`, `endsAfterRuns`, `deliveryChannels` jsonb.

Indexes: `org_idx`, `subaccount_active_idx`, `next_run_idx` on `(nextRunAt, isActive)`, partial unique `subaccount_slug_active_uniq`, `playbook_slug_idx`.

`scheduled_task_runs`: `id`, `scheduledTaskId`, `taskId`, `agentRunId`, `occurrence`, `status` (`pending|running|completed|failed|retrying|skipped`), `attempt`, `errorMessage`, `scheduledFor`, `startedAt`, `completedAt`.

**Purely time-driven.** No `trigger_type`, `event_source` column. Entire service is RRULE-based. `fireOccurrence()` takes `(scheduledTaskId, organisationId)` — no event context.

**Fire path (surprising finding — no background RRULE sweeper):**

```
RRULE string → computeNextOccurrence() → nextRunAt stored
Manual API call / runNow flag → enqueueRunNow() → setImmediate → fireOccurrence()
fireOccurrence():
  1. Load scheduledTask, check isActive + end conditions
  2. INSERT scheduled_task_runs row (status=pending)
  3. taskService.createTask() → board card
  4. agentExecutionService.executeRun({runType:'scheduled', runSource:'scheduler', ...})
  5. handleRunCompletion() → retry or complete
  6. computeNextOccurrence() → update nextRunAt
```

**`nextRunAt` is stored for display (calendar service) but is NOT polled.** `scheduledTaskService.ts:243` comment: *"The current RRULE-based scheduler is in-process"*. Firing happens via the REST run-now endpoint (`routes/scheduledTasks.ts:142`), `enqueueRunNow()` at create time when `runNow: true`, or `retryOccurrence()`. Agent-level recurring scheduling (separate concept) uses pg-boss cron via `agentScheduleService.registerSchedule()`.

The playbook engine is not involved. Dispatch is agent-only (`agentExecutionService.executeRun`).

### Extensibility

A `trigger_type = 'event'` variant could be added without tearing the service apart — RRULE fields are only read in `computeNextOccurrence()`, `computeUpcomingOccurrences()`, `create()`, `update()`. All could short-circuit for event rows. `fireOccurrence()` is already callable from any path.

However the schema is deeply optimised for RRULE (`rrule` is NOT NULL, unique-slug index, retry/counter columns). Adding event-triggering means leaving RRULE columns empty for event rows — awkward. Coupling is structural, not code-level. The NOT NULL constraint on `rrule` would need relaxing or a discriminated-union design.

### Coupling risk

Low for code; high for schema cleanliness. `nextRunAt` display consumers (`scheduleCalendarService`) would need branching to skip event-typed rows. The retry model (`retryPolicy`, `consecutiveFailures`, `retryOccurrence`) is RRULE-aware — event-triggered occurrences would not have a "next occurrence" to compute on failure.

---

## Area 3 — `onboarding_bundle_configs` + `subaccountOnboardingService`

### What exists

**Schema** (`server/db/schema/onboardingBundleConfigs.ts:14-30`):

| Column | Type |
|---|---|
| `id` | uuid PK |
| `organisationId` | uuid NOT NULL FK, **UNIQUE** (one row per org) |
| `playbookSlugs` | jsonb NOT NULL default `['intelligence-briefing', 'weekly-digest']` — `string[]` |
| `ordering` | jsonb NOT NULL default `{}` — `Record<string, number>` |
| `updatedAt` | timestamp |
| `updatedByUserId` | uuid nullable (no FK) |

Indexes: `onboarding_bundle_configs_org_uq` unique on `organisationId`.

**Important finding: `onboarding_bundle_configs` is defined in the schema but is NOT imported or used anywhere in `subaccountOnboardingService.ts`.** The service does not query this table. It appears to be a superseded design replaced by module-driven slug resolution.

**Actual runtime source** — two composed sources:

1. **`modules.onboardingPlaybookSlugs`** — `text[]` column on `modules` table (`server/db/schema/modules.ts:18`). Each module row lists the playbook slugs it contributes to onboarding.
2. **Org's active subscription's `moduleIds`** — resolved via `orgSubscriptions → subscriptions.moduleIds → modules` in `resolveOwedSlugsForOrg()` (`subaccountOnboardingService.ts:51-94`).

**`autoStartOwedOnboardingPlaybooks()` logic** (`:286-335`):
1. `listOwedOnboardingPlaybooks()` → union of `modules.onboardingPlaybookSlugs` across active modules.
2. For each owed slug without an existing run, `templateAutoStartsOnOnboarding()` (`:341-374`) — raw SQL against `playbook_template_versions.definition_json` for `autoStartOnOnboarding: true`.
3. If true → `startOwedOnboardingPlaybook()` resolves org or system template, then calls `playbookRunService.startRun(startInput)` (`:246`) with `{ organisationId, subaccountId, templateId (or systemTemplateSlug), initialInput: params.initialInput ?? {}, startedByUserId, runMode: 'supervised', isOnboardingRun: true }`.

**Sole caller of `autoStartOwedOnboardingPlaybooks()`:** `server/routes/subaccounts.ts:123` — after subaccount creation, fire-and-forget.

**Is the event coupling tight?** No. The service accepts `{ organisationId, subaccountId, startedByUserId }` — no event reference. The only call site passes `subaccount_created` context implicitly, but the service's core logic ("resolve owed playbooks, check for existing runs, start missing ones") is fully decoupled from the triggering event.

### Extensibility

Generic `event_rules` could call `startOwedOnboardingPlaybook()` directly for any event. Duplicate-run guard (partial unique index `playbook_runs_active_per_subaccount_slug`) prevents double-starts regardless of caller.

### Coupling risk

Zero at the service API level — the function is already event-agnostic. The `onboarding_bundle_configs` table is dead schema; retiring or repurposing it risks nothing (no reads, no writes from the service).

---

## Area 4 — `policy_rules`

### What exists

**Schema** (`server/db/schema/policyRules.ts:11-56`):

| Column | Type | Notes |
|---|---|---|
| `id`, `organisationId` (FK), `subaccountId` (nullable FK) | | |
| `toolSlug` | text NOT NULL | exact match or `'*'` wildcard |
| `priority` | integer NOT NULL default 100 | lower = first; 9999 = wildcard fallback |
| `conditions` | jsonb NOT NULL default `{}` | "extensible condition bag" |
| `decision` | text NOT NULL | `'auto' \| 'review' \| 'block'` |
| `evaluationMode` | text NOT NULL default `'first_match'` | |
| `interruptConfig` | jsonb nullable | reviewer UI options |
| `allowedDecisions` | jsonb nullable | `['approve','edit','reject']` |
| `descriptionTemplate` | text nullable | markdown with `{{tool_slug}}`, `{{subaccount_id}}` |
| `timeoutSeconds` | integer nullable | |
| `timeoutPolicy` | text | `'auto_reject' \| 'auto_approve' \| 'escalate'` |
| `confidenceThreshold` | real nullable | per-rule override |
| `guidanceText` | text nullable | injected `<system-reminder>` at tool-call time |
| `isActive`, `createdAt`, `updatedAt` | | |

Indexes: `policy_rules_org_priority_idx` on `(orgId, isActive, priority)`, `policy_rules_tool_idx` on `(orgId, toolSlug)`.

**What it does:** HITL gate configuration — controls whether a tool call goes `auto | review | block`. Scoped per-org, optionally per-subaccount. **Decision surface is only these three values — no other output actions.**

**Conditions evaluator — `matchesRule()` at `server/services/policyEngineService.ts:96-116`:**

```ts
export function matchesRule(rule: PolicyRule, ctx: PolicyContext): boolean {
  if (rule.toolSlug !== '*' && rule.toolSlug !== ctx.toolSlug) return false;
  if (rule.subaccountId && rule.subaccountId !== ctx.subaccountId) return false;

  const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
  if (Object.keys(conditions).length === 0) return true;
  if (!ctx.input || typeof ctx.input !== 'object') return false;
  const inputObj = ctx.input as Record<string, unknown>;

  for (const [key, expected] of Object.entries(conditions)) {
    if (inputObj[key] !== expected) return false;           // strict ===
  }
  return true;
}
```

**Predicate language: flat exact-match key-value on `ctx.input` fields. No JSON-path, no boolean operators, no ranges, no regex.** Despite the column comment suggesting `amount_usd`, `user_role` style conditions, the evaluator only does `!==` comparisons.

**Evaluation order:** `priority ASC`, first match wins. In-memory cache 60s TTL per org (`:58-85`). Invalidated on create/update/delete via `invalidateCache()` (`:203`).

**Callers of `evaluatePolicy()`:** `server/services/actionService.ts`, `middleware/proposeAction.ts`, `middleware/decisionTimeGuidanceMiddleware.ts`, `organisationService.ts` (via `seedFallbackRule` at org creation).

**Decision outputs:** `'auto' | 'review' | 'block'` + metadata (`timeoutSeconds`, `timeoutPolicy`, `interruptConfig`, `allowedDecisions`, `description`, `upgradedByConfidence`). The confidence-upgrade path in `applyConfidenceUpgrade()` (`policyEngineServicePure.ts:76-97`) can upgrade `auto → review` based on `toolIntentConfidence` — but cannot produce new action types.

### Extensibility

`matchesRule` is a pure exported function with no tool-call dependencies, but its context type (`PolicyContext`) is HITL-coupled (`toolSlug`, `subaccountId`, `organisationId`, `input`, `toolIntentConfidence`).

**Notable finding: `triggerService.matchesFilter()` (`:44-52`) and `policyEngineService.matchesRule()` (`:96-116`) implement THE SAME flat exact-match evaluator independently.** Both are already consistent. Either could be the canonical implementation for a new `event_rules` table — extracting into a shared utility is a low-risk refactor.

**Cannot be reused as-is for:** range checks, presence checks, regex, wildcard-beyond-toolSlug, or any predicate beyond strict equality.

### Coupling risk

Low. The evaluator is pure. Reusing it for event-rules matching requires either abstracting `PolicyContext` (accept `eventData` as `input`) or copying the 12-line evaluator. Either path introduces no coupling risk — the existing HITL surface stays untouched.

---

## Area 4 — `policy_rules`

*(section appended below)*

---

## Area 5 — Webhook event normalisation

### What exists

**`NormalisedEvent` type** (`server/adapters/integrationAdapter.ts:252-262`):

```ts
export interface NormalisedEvent {
  eventType: string;
  accountExternalId: string;
  entityType: 'contact' | 'opportunity' | 'conversation' | 'revenue' | 'account' | 'ticket' | 'message';
  entityExternalId: string;
  externalEventId?: string;                 // provider event ID for idempotency
  data: Record<string, unknown>;
  timestamp: Date;
  sourceTimestamp?: Date;
}
```

`IntegrationAdapter.webhook` sub-interface (`integrationAdapter.ts:330-334`):

```ts
webhook?: {
  verifySignature(payload: Buffer, signature: string, secret: string): boolean;
  normaliseEvent(rawEvent: unknown): NormalisedEvent | null;
};
```

**GHL webhook dispatch path — hop by hop** (`server/routes/webhooks/ghlWebhook.ts`):

1. `:23` — `POST /api/webhooks/ghl`, raw body parser.
2. `:44-66` — DB lookup joining `canonical_accounts` + `connector_configs` by `locationId` → resolves org.
3. `:69-85` — HMAC-SHA256 via `adapters.ghl.webhook.verifySignature`.
4. `:88` — HTTP 200 returned immediately (async begins).
5. `:98` — `adapters.ghl.webhook.normaliseEvent(event)` → `NormalisedEvent | null`.
6. `:105` — dedup via `webhookDedupeStore.isDuplicate(externalEventId)`.
7. `:112-157` — switch on `normalised.entityType`:
   - `contact` → `canonicalDataService.upsertContact(...)` (`:114`)
   - `opportunity` → `upsertOpportunity(...)` (`:125`)
   - `conversation` → `upsertConversation(...)` (`:135`)
   - `revenue` → `upsertRevenue(...)` (`:144`)
   - `account` → no canonical upsert; falls through.
8. `:162-175` — `recordGhlMutation(...)` → `canonical_subaccount_mutations`.

Mutation mapping (`server/services/ghlWebhookMutationsPure.ts:78` → `normaliseGhlMutation`) translates GHL event-type strings (`ContactCreate`, `ContactUpdate`, `OpportunityStageUpdate`, `ConversationCreated`, `INSTALL`, `UNINSTALL`, etc.) to `NormalisedMutation` with `mutationType`, `sourceEntity`, `externalUserId`, `externalId`, `occurredAt`, `evidence`. `recordGhlMutation` (`ghlWebhookMutationsService.ts:46`) classifies `externalUserKind` via a volume heuristic, then inserts with `onConflictDoNothing`.

**Slack webhook** (`server/routes/webhooks/slackWebhook.ts`):
- `:104-105` — `adapters.slack.webhook.normaliseEvent(event)`.
- No canonical write.
- `:120-175` — per-event-type ad-hoc dispatch: `app_mention` → `slackConversationService.resolveConversation`; `message` → DM/thread routing; `block_actions` with `hitl:` prefix → inline HITL stub (comment: *"would call `reviewService.processReview()`"*).
- No shared fanout function.

**Teamwork webhook** (`server/routes/webhooks/teamworkWebhook.ts`):
- `:84-85` — `adapters.teamwork.webhook.normaliseEvent(event)`.
- `:87-94` — dedup, log, **stop**.
- `:96-98` — explicit comment: *"Future: publish to event bus / pg-boss queue for agent processing."*
- Teamwork events are currently dropped after normalisation.

**Pattern summary:** each route has its own ad-hoc post-normalisation dispatch. **There is no shared fanout or generic webhook router.** `webhookService.ts` is an outbound callback-URL builder, not a router. `webhookAdapterService.ts` is an outbound agent-trigger-over-HTTP; it does not consume `NormalisedEvent`.

**Downstream consumers of `NormalisedEvent`:**

| Consumer | File:line | Purpose |
|---|---|---|
| `canonicalDataService.upsertContact/Opportunity/Conversation/Revenue` | `ghlWebhook.ts:114-151` | Canonical entity upsert |
| `recordGhlMutation` → `canonical_subaccount_mutations` | `ghlWebhookMutationsService.ts:46` | Staff-activity pulse log |
| `slackConversationService.resolveConversation` | `slackWebhook.ts:128-150` | Slack thread routing |
| HITL review (inline stub) | `slackWebhook.ts:163-173` | `block_actions` → would call `reviewService` |
| (none) | `teamworkWebhook.ts` | Dropped after normalisation |

**Is there anywhere today that looks up rules/config based on a normalised event and dispatches an action? No.** There is no rule-lookup step between `normaliseEvent()` and its consumers anywhere in the codebase. Dispatch is hardcoded per webhook route.

### Extensibility

`NormalisedEvent` has the right skeleton — `eventType`, `entityType`, `entityExternalId`, `accountExternalId` plus an open `data` bag are sufficient for the "IF event matches X on entity Y for account Z" predicate side.

Gaps for a generic engine:
1. **No `orgId` / `subaccountId` on the struct** — webhooks resolve them via DB lookup (`ghlWebhook.ts:44-66`) and never attach to `NormalisedEvent`. A rules engine needs internal IDs.
2. **No provider/integration tag.** `source: 'ghl' | 'slack' | 'resend' | ...` missing — future collisions between providers using the same `eventType` string become hard to resolve.
3. **`data` is `Record<string, unknown>`** — predicate evaluation would be duck-typed. Schemas-per-eventType would help.
4. **No routing hook after normalisation** — adding one is a small change (call per webhook route), but it does not exist today.

### Coupling risk

Adding new optional fields to `NormalisedEvent` is safe — no consumer destructures it exhaustively; all access is named-property. Residual risks:

- `ghlWebhook.ts:112-157` `switch(entityType)` — new literal = silent fall-through (mutation write still runs).
- `webhookDedupeStore` keys off optional `externalEventId` — new event types without one silently skip dedup (existing behaviour).
- **No interface formally consumes the whole `NormalisedEvent` type** — no array, no serialisation, no downstream service takes it as a parameter. Zero compile-time breakage risk from widening.

---

## Area 6 — Action dispatch layer

### What exists

**Lifecycle** (`server/config/actionRegistry.ts:2847-2853`):

```
proposed → pending_approval | approved | blocked | skipped | failed
pending_approval → approved | rejected
approved → executing
executing → completed | failed
(terminal: completed, failed, rejected, blocked, skipped)
```

**Two paths from `proposed`:**
- `auto` gate: `proposed → approved → executing → completed/failed` in-process. Dispatch immediate (same request or background job).
- `review` gate: `proposed → pending_approval`. Suspended until HITL approval via `reviewService`. On approval → `approved → executing`.
- `block` gate: `proposed → blocked` (terminal).

**Gate resolution — multi-source, highest restriction wins** (`server/services/actionService.ts:551-608`):
1. Policy engine (`policy_rules` table, first-match, falls back to `definition.defaultGateLevel`).
2. Explicit `gateOverride` from caller.
3. `task.reviewRequired` escalation.
4. `metadata.needs_human_review` escalation.

**`proposeAction` call sites — every programmatic origin:**

| File:line | Context |
|---|---|
| `actionService.ts:139` | Canonical implementation |
| `middleware/proposeAction.ts:294` | Universal before-tool middleware (agent tool calls) |
| `skillExecutor.ts:1781`, `:1916` | Auto-gated / review-gated skill wrappers |
| `workflowExecutorService.ts:274` | Workflow HITL steps |
| `playbookActionCallExecutor.ts:98` | Playbook action-call steps |
| `clientPulseInterventionContextService.ts:489` | Scenario-detector system-triggered proposals |
| `configUpdateOrganisationService.ts:178` | Config-agent-triggered proposals |

**`executeAction` call sites:**

| File:line | Context |
|---|---|
| `reviewService.ts:168` | After human approval |
| `skillExecutor.ts:1955` | Inline when policy overrides review to auto |
| `executionLayerService.ts:264-265` | `executeAutoAction` alias |

**Action-category inventory** (`actionRegistry.ts`, ~85 named entries + ~30 methodology skills at `:2015-2065`):

| Category | Example types | Notes |
|---|---|---|
| `worker` (~30 entries) | `create_task`, `move_task`, `triage_intake`, `assign_task`, `add_deliverable`, `create_page`, `query_subaccount_cohort`, `compute_health_score`, `detect_anomaly`, `compute_churn_risk`, `scan_integration_fingerprints`, `generate_portfolio_report`, `trigger_account_intervention`, `canonical_dictionary`, `search_agent_history`, all methodology skills, `config_update_organisation_config`, `notify_operator` | Majority `auto`. Review exceptions: `create_lead_magnet` (`:1729`), `deliver_report` (`:1759`), `configure_integration` (`:1791`), `propose_doc_update` (`:1900`), `write_docs` (`:1933`), `trigger_account_intervention` (`:1214`), `update_memory_block` (`:1310`), `request_approval` (`:675`), `assign_task` (`:968`), `create_page` (`:996`), `notify_operator` (`:2746`), `config_update_organisation_config` (`:2721`) |
| `api` (~55 entries) | `send_email`, `read_inbox`, `update_record`, `fetch_url`, `scrape_url`, `web_search`, `read_analytics`, `read_campaigns`, `enrich_contact`, `update_crm`, `read_revenue`, `config_create_subaccount`, `config_create_scheduled_task`, `config_set_link_skills`, `config_weekly_digest_gather`, `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task` | Heavy skew `review`. Auto exceptions: `read_inbox` (`:308`), `fetch_url` (`:573`), `scrape_url` (`:598`), `web_search` (`:1329`), `read_analytics` (`:1408`), `enrich_contact` (`:1587`), `read_crm` (`:1820`), `canonical_dictionary` (`:1848`), `config_weekly_digest_gather` (`:2508`), `config_deliver_playbook_output` (`:2528`) |
| `devops` | `read_codebase`, `search_codebase`, `run_tests`, `write_patch`, `run_command`, `create_pr` | All `auto` |
| `mcp` | (declared in `ActionDefinition` type at `:57`; no registry entries) | — |
| `browser` | (declared; no registry entries) | — |

**Auto-gate path skips review entirely.** `actionService.ts:223-225`: when `proposeAction` resolves gate to `auto`, action transitions `proposed → approved` in the same call. `executeAction` fires immediately. `executionLayerService.executeAutoAction` (`:264`) is an alias with no additional gate check.

**System-triggered (no proposing actor) precedent.** `clientPulseInterventionContextService.enqueueInterventionProposal` (`:489`) is called by the scenario-detector background job with `source: 'scenario_detector'` and a synthetic `agentId`. The action enters the review queue. Closest existing precedent for "system-triggered action proposal."

### Extensibility

Usable as the execution side of an event-rules engine, with these additions:

1. **System actor identity.** Every `proposeAction` requires `agentId`. Rules engine is not an agent. Options: synthetic `system-rules-engine` agent row per org, or add `actorType: 'event_rule'` + nullable `agentId` to `ProposeActionInput`. Audit events and `action_events` currently log `agentId`.
2. **No subaccount requirement for org-level rules.** `subaccountId` is `string | null` already (`actionService.ts:146` sets `actionScope: 'org'` on null). No schema change needed.
3. **`gateOverride` hook already exists.** A rules engine can pre-approve specific action types by passing `gateOverride: 'auto'`. Cleanest programmatic bypass of review for deterministic automations.
4. **`executeAction` is already context-free.** `executionLayerService.executeAction(actionId, orgId)` takes no HTTP context, no user session. Rules-engine jobs can call it directly.
5. **Adapter registry is category-keyed.** New categories plug in via `registerAdapter('automation', myAdapter)` (`executionLayerService.ts:21`). Many outputs fit existing `worker` / `api` categories.

### Coupling risk

1. **`agentRunId` provenance** — audit + review UI assume agent-origin. `agentRunId: null` is legal but renders as "no context" in the review queue.
2. **`pending_approval` items need a reasoning string** — rules engine must generate human-readable reasons (e.g. "Triggered by event rule #42: contact_created matched tag=VIP").
3. **Policy engine scoped to `subaccountId`** — `policyEngineService.evaluatePolicy` passes `subaccountId` as required (`actionService.ts:573`). Org-level rules with `null` subaccount fall through to registry default — may inadvertently bypass per-subaccount policy.
4. **`crm.*` actions all default `review`** (`:2606-2712`). Exactly the actions a generic rules engine wants to auto-fire. Requires either `gateOverride: 'auto'` per call or a policy-rule auto-approval per org. Governance decision, not a code blocker.
5. **`notify_operator` defaults `review`** (`:2739-2767`). For immediate notifications, needs override or a new `send_notification` action with `defaultGateLevel: 'auto'`.

**Mapping to requested action types:**

| Requested | Closest existing | Category | Default gate |
|---|---|---|---|
| `start_playbook` | No direct equivalent. Closest: `trigger_account_intervention` (worker, review) or playbook engine internal `executeActionCall` | — | — |
| `create_subaccount` | `config_create_subaccount` (`:2311`) | `api` | `review` |
| `send_notification` | `notify_operator` (`:2739`) | `worker` | `review` |
| `update_record` | `update_record` (`:541`) | `api` | `review` |
| `start_agent_run` | No action type. Agent runs started via `agentExecutionService`, outside the action-dispatch layer | — | — |

**None of the five requested types exist today as auto-gated programmatically-callable actions.** `start_playbook` and `start_agent_run` are not action types at all — they are internal service calls. A generic event-rules engine needs either: (a) add new action types with `defaultGateLevel: 'auto'` for notification/update cases, and (b) register `start_playbook` / `start_agent_run` as new `worker`-category action types OR direct-call from the rules engine with an action-row written for audit only.

---

## Area 6 — Action dispatch layer

*(section appended below)*

---

## Area 7 — Other event/automation patterns (broad scan)

### What exists — candidates found

- **`workflow_engines` + `processes`** (`server/db/schema/workflowEngines.ts`, `processes.ts:1-73`) — complete external-automation-engine registry. `workflow_engines` stores credentials and base URLs for external platforms (n8n, GHL, Make, Zapier, custom webhooks) scoped system/org/subaccount with HMAC secrets. `processes` is the catalog of named webhook-callable units inside those engines — each has `inputSchema`, `outputSchema`, `configSchema`, `webhookPath`, `requiredConnections[]`. **Verdict: external-engine integration layer, NOT a generic internal event-action system.**

- **`workflow_runs` + `workflowExecutorService` + `types/workflow.ts`** (`server/services/workflowExecutorService.ts:59-160`, `server/types/workflow.ts:9-59`, `server/db/schema/workflowRuns.ts:8-60`) — a fully built internal sequential workflow engine. `WorkflowDefinition` is a list of `WorkflowStep` items, each referencing an `actionType` from `ACTION_REGISTRY`. Executor loops through steps, checkpoints after each, pauses for HITL via `workflow_runs.checkpoint`. Resumption via pg-boss `workflow-resume` queue (`queueService.enqueueWorkflowResume()`). **This is the closest existing sequential event-action sequencer.** But it is invoked only via `skillExecutor` / `actionService` — no org-configurable trigger layer links an external event to a workflow. **Verdict: generic sequential workflow engine (step list → actions with HITL gates), functional but not org-configurable as an event-action rule.**

- **`processConnectionMappings`** (`server/db/schema/processConnectionMappings.ts:1-44`) — join table wiring process `required_connections` slots to `integrationConnections` per subaccount. **Verdict: pure configuration plumbing, false positive.**

- **`processedResources`** (`server/db/schema/processedResources.ts:1-40`) — dedup log for external resource IDs processed. Name is misleading — it's an idempotency seen-set keyed on `(subaccountId, integrationType, resourceType, externalId)`. **Verdict: idempotency guard, false positive.**

- **`processCategories`** — org-scoped taxonomy for UI labelling. **False positive.**

- **`actionEvents`** (`server/db/schema/actionEvents.ts:1-37`) — immutable append-only audit of action state transitions. No routing consumer. **Verdict: audit trail.**

- **`actionResumeEvents`** (`server/db/schema/actionResumeEvents.ts:1-47`) — immutable log of human review decisions. No routing logic. **Verdict: audit trail.**

- **`routingOutcomes`** (`server/db/schema/routingOutcomes.ts:1-43`) — Orchestrator routing decisions paired with downstream outcomes (A/B/C/D paths). Feeds analytics, not a rules engine. **Verdict: analytics feedback table.**

- **`conversionEvents`** — confirmed page-funnel analytics only. Consumers: `formSubmissionService.ts` (inserts), `pageIntegrationWorker.ts` (inserts), `paymentReconciliationJob.ts` (reads `checkout_started`, writes `checkout_completed/abandoned`). **No cross-system routing. Verdict: false positive.**

- **`feedbackVotes`** — thumbs-up/down on agent outputs. **False positive.**

- **`featureRequests`** (`:1-77`) — records Path-D capability gaps and Path-C promotion candidates. `notifiedAt` column triggers a one-shot human notification. **Verdict: signal table, not event-action.**

- **`playbookAgentRunHook` + `reportingAgentRunHook`** (`server/services/playbookAgentRunHook.ts`, `server/lib/reportingAgentRunHook.ts`) — the "hook" mechanism is just **two hard-coded dynamic-import indirections** to break circular module deps. `agentExecutionService` calls `notifyPlaybookEngineOnAgentRunComplete()` after every agent run; dynamically imports `finalizeReportingAgentRun` at `agentExecutionService.ts:1156-1159`. Direct function calls disguised as late imports. **Verdict: two one-off hard-coded hooks, NOT a generic hook registry.**

- **`notifyOperatorFanoutService`** (`:88-145`) — explicitly named a fanout. Called from `skillExecutor` when `notify_operator` executes post-approval. Reads org settings to discover configured channels (in-app, email, Slack), dispatches to three channel-specific functions via hard-coded if-else. **No channel subscription model, no pub/sub. Verdict: domain-specific dispatcher.**

- **`crmFireAutomationServicePure`** — payload validator + provider-call builder for `crm.fire_automation`. Fires an external CRM (e.g. GHL) automation on a contact. **Verdict: skill/action, not platform automation.**

- **`ProcessorHooks` registry inside `skillExecutor`** (`server/types/processor.ts`, `server/processors/budgetGuardrail.ts`, `skillExecutor.ts:259-350`) — in-memory `Map<string, ProcessorHooks>` keyed on tool slug, with `processInput`, `processInputStep`, `processOutputStep` callbacks registerable at module load. Only one processor implemented (`budgetGuardrailProcessor`, currently a no-op stub). `registerProcessor` is exported but not called externally. **Verdict: extensible per-tool processor hook interface exists but underpopulated.**

- **`server/services/middleware/` pipeline** (`middleware/index.ts`, `middleware/types.ts`) — three formal middleware stages (`preCall`, `preTool`, `postTool`) with pluggable `MiddlewarePipeline`. Enforces guardrails (budget, context pressure, loop detection, tool restrictions, HITL proposal, hallucination detection). Runs inside a single agent run's loop. **Verdict: execution-loop guardrail pipeline, not org-level event-action.**

- **`websocket/emitters.ts`** — Socket.IO room-based push (room prefixes: `agent-run:`, `playbook-run:`, `subaccount:`, `org:`, `execution:`, `conversation:`). Server-to-client only; no client-to-server subscription model. **Verdict: WebSocket push, not an event bus.**

- **`jobs/ieeRunCompletedHandler.ts`** (`:72-127`) — pg-boss consumer for `iee-run-completed` queue. Re-reads `iee_runs` row, finalises parent `agent_runs` row. **Verdict: domain-specific pg-boss consumer.**

- **`jobs/connectorPollingTick.ts` + `connectorPollingSync.ts`** — two-level polling fan-out: tick (every minute) selects due connections, dispatches one sync job per connection with singletonKey. **Verdict: data-ingestion polling, domain-specific.**

- **`n8nImportServicePure.ts`** (`:41-60`) — pure functions importing n8n workflow JSON into the platform's intermediate representation. Maps n8n node types to step types `action_call | conditional | prompt | user_input | schedule | trigger`. **No executor implements `conditional` or `trigger` IR step types — they are import-analysis artifacts.** **Verdict: import-mapping utility with aspirational step types, no runtime implementation.**

- **`auditEvents`** — security audit log with free-text `action` and `correlationId`. No consumer routes from it. **False positive.**

### What does NOT exist

- **No in-process `EventEmitter` bus.** The single `EventEmitter` mention (`server/index.ts:529`) is a comment about Node's HTTP server error handling.
- **No `workflow_rules`, `event_rules`, `automation_rules`, `action_rules`, or any trigger-condition-action table.**
- **No publish/subscribe model** outside billing `subscriptions`.
- **No `fanout_rules`, `channel_routing`, `observer`, `reactor`, or `dispatcher` class/table.**
- **No conditional-action / business-rule engine** (no CEP, no Drools-style ruleset, no IFTTT-style config).
- **No generic `hook` registry** — the two "hooks" are one-off direct function calls wrapped in dynamic imports.
- **`workflow_engines` + `processes` are external-engine registries**, not internal rule engines.
- **`n8nImportServicePure`'s `conditional` / `trigger` IR step types have no runtime executor.**

### Verdict summary

There is **no hidden generic event-action dispatcher**. The codebase has three automation-adjacent subsystems that do NOT overlap with a new `event_rules` table:

1. **`workflow_runs` + `workflowExecutorService`** — sequential step executor for internally-defined skill chains, triggered programmatically. No org-configurable trigger layer.
2. **`workflow_engines` + `processes`** — registry for calling EXTERNAL automation platforms (n8n, Make, Zapier, GHL) via webhooks.
3. **pg-boss** — operational jobs (maintenance, polling, HITL timeouts) with no event-condition-action wiring.

Middleware pipeline and processor hooks are **within-run guardrails**, not org-level rules. The closest conceptual ancestor to a new `event_rules` table is `WorkflowDefinition` in `server/types/workflow.ts` — it already has the step-by-step skeleton — but has no org-configurable trigger layer, no condition branching, and no "when event X fires, run this workflow" linkage. **Building a new `event_rules` table would not duplicate any existing system.**

---

## Synthesis — extend or build new?

### Is there a single existing subsystem that is the right foundation?

**No — but two are close enough to inform the design.**

`agent_triggers` is the closest conceptually (event → action routing, per-org, per-subaccount, with `eventFilter` conditional matching and cooldown). But it is hard-wired to a single action type (enqueue an agent run). It has no `action_type` column, no `target_type` discriminator, and its dispatch path (`checkAndFire:130-137`) unconditionally calls `triggerJobSender` to `agent-triggered-run`. Extending it to support `start_playbook`, `create_subaccount`, `send_notification`, and `update_record` as alternative targets is a schema plus service refactor — small (3 files change, 0 callers of `checkAndFire` break) but meaningful.

`workflow_runs` + `workflowExecutorService` is the closest *execution* engine — sequential step chains with HITL gates and checkpoint/resume. But it is start-only programmatic; there is no configurable trigger layer that maps an external event to a workflow run. Wiring an event → workflow linkage is the missing piece.

None of the other subsystems — `scheduled_tasks` (RRULE-optimised schema), `onboarding_bundle_configs` (dead schema, replaced by `modules.onboardingPlaybookSlugs`), `policy_rules` (gate decision only, `auto|review|block`), or the middleware/processor pipelines — are the right foundation. Each is either too specialised or scoped to the wrong lifecycle phase.

### Extend `agent_triggers`, or build a new subsystem alongside?

**Recommend: build a new subsystem alongside `agent_triggers`, but design it to share its patterns deliberately.**

Three arguments for "build new":

1. **Semantic drift risk.** `agent_triggers` has a meaningful name — it triggers *agent runs* on workspace-internal events (`task_created`, `task_moved`, `agent_completed`). Adding `email_received`, `conversion_event`, `webhook_received`, `form_submitted`, `subaccount_created` as new event types, plus `start_playbook`, `create_subaccount`, `send_notification`, `update_record` as new target types, dilutes the table into a general-purpose rules engine — the naming no longer maps to its contents. New callers would reach for it, old callers would keep using it, and over time it becomes a mixed-responsibility table that is painful to evolve.
2. **Different source surface.** `agent_triggers` fires from *internal* state changes (service layer calls `checkAndFire` directly). Email replies, form submissions, webhook events, scheduled triggers, and subaccount-create events all originate from different surfaces — inbound webhooks, pg-boss ticks, other services. A new subsystem can define its own normalised event ingestion surface (likely the `NormalisedEvent` shape from Area 5, widened with `orgId`/`subaccountId`/`source`) and act as the single entry point.
3. **Room for richer predicates.** Both `triggerService.matchesFilter()` and `policyEngineService.matchesRule()` are strict flat-equality evaluators. A generic `event_rules` engine will eventually need richer predicates (range, presence, regex, JSON-path). Building new makes the eventual evaluator upgrade contained; bolting it onto `agent_triggers` forces the richer evaluator into two HITL-critical paths (`triggerService`, `policyEngineService`) that do not need the complexity.

Three arguments for "share, don't duplicate":

1. **Reuse the existing matcher.** `triggerService.matchesFilter()` and `policyEngineService.matchesRule()` are 12-line identical-semantics evaluators today. Extract to a shared `server/lib/ruleMatcher.ts` and have all three (triggers, policy, new event-rules) consume it. Low-risk refactor, future-proofs the predicate upgrade path.
2. **Reuse the adapter-dispatch model.** The `executionLayerService` + `apiAdapter` / `workerAdapter` pattern (Area 6) is the right execution-side plumbing — the new rules engine should dispatch through it, not around it, so audit trail and policy evaluation stay consistent.
3. **Reuse `NormalisedEvent`.** Use it as the input contract, widened minimally (add `orgId`, `subaccountId`, `source`).

### Minimal design that supports the target event + action types

The required scope from the brief:

**Event types:** `email_reply_positive`, `form_submitted`, `crm_stage_changed`, `scheduled_trigger`, `webhook_received`, `subaccount_created`.

**Action types:** `start_playbook`, `create_subaccount`, `send_notification`, `update_record`, `start_agent_run`.

Minimal pieces required for that scope:

| Piece | What's needed | Reuses what? |
|---|---|---|
| **Event ingestion surface** | One entry point `eventBus.publish(event: EventRuleInput)` that webhook routes, pg-boss jobs, and internal services call. `EventRuleInput` is `NormalisedEvent` + `{ orgId, subaccountId?, source }`. | `NormalisedEvent` shape (Area 5). |
| **`event_rules` table** | per-org config with `event_type`, `event_filter jsonb`, `priority`, `is_active`, `target_type`, `target_config jsonb`, `cooldown_seconds`, `last_triggered_at`, `trigger_count`. | Columns cloned from `agent_triggers` — same cooldown + filter pattern. |
| **Rule matcher** | Extract `matchesFilter`/`matchesRule` into a shared `ruleMatcher` utility. Phase 1: strict equality (current semantics). Phase 2 (later): richer predicates. | `triggerService.matchesFilter` (`:44-52`), `policyEngineService.matchesRule` (`:96-116`). |
| **Dispatcher** | Switch on `target_type`: <br>• `start_playbook` → `playbookRunService.startRun(...)` with `triggeredBy: 'job'` (per Q7 of the operator-as-agency report). <br>• `create_subaccount` → call `orgSubaccountService` or `executeConfigCreateSubaccount` with extended prospect-data payload. <br>• `send_notification` → call `notifyOperatorFanoutService` directly OR propose a new `send_notification` action with `defaultGateLevel: 'auto'`. <br>• `update_record` → propose an `update_record` action through `actionService` (runs through adapter + policy engine). <br>• `start_agent_run` → call `agentExecutionService.executeRun(...)`. | `playbookRunService`, `orgSubaccountService`, `notifyOperatorFanoutService`, `actionService`, `agentExecutionService`. |
| **Audit trail** | Every fire writes an `event_rule_fires` row (or `action_events`-style log) with rule ID, event, target dispatch result. | Mirrors `action_events` pattern from Area 6. |
| **Per-event idempotency** | `event_external_id` deduplication (pattern from `webhookDedupeStore` + `externalEventId` in `NormalisedEvent`). | `webhookDedupeStore` (in-memory LRU, already used by GHL webhook). |
| **Scheduler integration for `scheduled_trigger`** | pg-boss cron job publishes a synthetic event; `event_rules` rows with `event_type = 'scheduled_trigger'` fire against it. | pg-boss scheduling (Q2 of operator-as-agency report). |

### Event-type source mapping

| Event type | Source that publishes | Status today |
|---|---|---|
| `email_reply_positive` | Resend webhook → IMAP polling job → intent classifier → `eventBus.publish(...)` | BUILD (Q4 + Q6 of operator-as-agency report) |
| `form_submitted` | Existing `conversionEvents` writer in `pageIntegrationWorker.ts` — extend to also `publish` to event bus | Small extension to existing writer |
| `crm_stage_changed` | GHL webhook (existing) — `ghlWebhook.ts:112-157` already receives `OpportunityStageUpdate` events; add `eventBus.publish(...)` after `canonicalDataService.upsertOpportunity` | Small extension to existing route |
| `scheduled_trigger` | pg-boss cron job publishing synthetic events for rows with `event_type = 'scheduled_trigger'` | BUILD |
| `webhook_received` | Generic inbound webhook handler (new) — or each webhook route publishes a matching event post-normalisation | BUILD / small extension per route |
| `subaccount_created` | `POST /api/subaccounts` after `insert` — add `eventBus.publish(...)` alongside the existing `autoStartOwedOnboardingPlaybooks` call at `subaccounts.ts:121-155` | Small extension to existing route |

### Action-type dispatch mapping

| Action type | Dispatcher | Today status | Needed |
|---|---|---|---|
| `start_playbook` | `playbookRunService.startRun({ templateId, initialInput, triggeredBy: 'job', ... })` | Function exists; needs `triggeredBy` + nullable `startedByUserId` per Q7 of operator-as-agency report | Signature extension |
| `create_subaccount` | `executeConfigCreateSubaccount({ name, slug, settings, prospectData })` or `orgSubaccountService.createClientSubaccount(...)` (new) | `executeConfigCreateSubaccount` exists at `configSkillHandlers.ts:264-307` but takes `{ name, slug }` only | Extend signature |
| `send_notification` | `notifyOperatorFanoutService.dispatch(...)` OR propose new `send_notification` action with `defaultGateLevel: 'auto'` | `notify_operator` exists with `defaultGateLevel: 'review'` (Area 6) | New auto-gated action OR gate override |
| `update_record` | `actionService.proposeAction('update_record', {...}, { gateOverride: 'auto' })` | `update_record` exists at `actionRegistry.ts:541` with `defaultGateLevel: 'review'` | Gate-override usage or policy rule |
| `start_agent_run` | `agentExecutionService.executeRun({ ..., runSource: 'event_rule' })` | Function exists; `agent_runs.runSource` needs a new enum value | Enum extension + system principal handling |

### Compatibility with `conversion_rules` from the operator-as-agency report

The operator-as-agency investigation (Q4) proposed a `conversion_rules` table with `event_type` (`email_reply_positive | email_reply_referral | manual_conversion | crm_stage_changed | form_submitted`), `event_filter jsonb`, `target_playbook_template_id`, `subaccount_defaults jsonb`, and `playbook_run_mode`.

**The generic `event_rules` design subsumes `conversion_rules`.** `conversion_rules` is `event_rules` with `target_type = 'start_playbook'` plus (optionally) a preceding `target_type = 'create_subaccount'` step. If a single rule can only dispatch to one target, chain it via two rules with the second matching on `subaccount_created` from the first. If `event_rules` allows a `target_type: 'sequence'` with a `target_config` step-list (leveraging `WorkflowDefinition` from Area 7), a single rule expresses the full `conversion → create_subaccount → start_playbook` flow.

**Recommendation: do NOT build `conversion_rules` as a separate table.** Build the generic `event_rules` table and model conversion as one specific configuration of it. Single surface for planners, reviewers, and auditors; no divergence risk.

### Summary recommendation

1. **Build a new `event_rules` table and service.** Do not extend `agent_triggers` — semantic drift risk is real.
2. **Share the matcher with `triggerService` and `policyEngineService`** via a new `server/lib/ruleMatcher.ts`. One evaluator, three consumers.
3. **Dispatch via existing execution primitives:** `playbookRunService.startRun`, `agentExecutionService.executeRun`, `notifyOperatorFanoutService`, `actionService.proposeAction` (with `gateOverride: 'auto'` where appropriate), `executeConfigCreateSubaccount` (extended). No new action-dispatch framework required.
4. **Use `NormalisedEvent` (widened with `orgId`/`subaccountId`/`source`) as the input contract.** The webhook routes already produce this shape.
5. **Collapse the proposed `conversion_rules` into `event_rules`** — one rules surface, configured per event type per org.
6. **Ship in phases.** Phase 1: strict-equality matcher + five event types + five action types (direct dispatch). Phase 2: richer predicate evaluator (ranges, regex, JSON-path). Phase 3: rule chaining / sequence targets leveraging `WorkflowDefinition`.

The infrastructure to build this is modest — the heaviest lift is not the table or service but the service-user / system-principal plumbing for programmatic `startRun` and `proposeAction` calls, which the operator-as-agency report already flagged as the blocking design decision (Q4d and Q7 of that report).
