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

*(section appended below)*

---

## Area 2 — `scheduled_tasks` + `scheduledTaskService`

*(section appended below)*

---

## Area 3 — `onboarding_bundle_configs` + `subaccountOnboardingService`

*(section appended below)*

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

*(section appended below)*

---

## Synthesis — extend or build new?

*(section appended below)*
