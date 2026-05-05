# Operator-as-Agency — Status Update After Main Merge

**Date:** 2026-04-21 (after merging origin/main, 1469 commits since branch point)
**Branch:** `claude/codebase-research-report-xQQbg`
**Companion to:** [`operator-as-agency-investigation.md`](./operator-as-agency-investigation.md) and [`existing-event-trigger-infrastructure.md`](./existing-event-trigger-infrastructure.md)

The two earlier reports recommended a set of schema additions, services, skills, jobs, and routes for an operator-as-agency build. Significant work has landed on `main` since — most notably the `workflows-v1` subsystem (30+ service files, new schema migration `0276`) and two prospect-facing skills (`discover_prospects`, `score_lead`).

This report maps each previously-discussed item to its current status: **BUILT**, **PARTIAL**, or **NOT BUILT**. Three parallel investigation agents were run against the merged tree to produce the findings below.

---

## Table of contents

- [Headline status](#headline-status)
- [Schema items](#schema-items)
- [Code-level items](#code-level-items)
- [workflows-v1 deep dive](#workflows-v1-deep-dive)
- [Revised recommendation](#revised-recommendation)
- [What's left to build](#whats-left-to-build)

---

## Headline status

**Three things changed materially during the 1469 commits merged in:**

1. **`workflows-v1` shipped and IS the renamed playbook system.** Migrations 0219 + 0221 renamed `playbook_runs` → `workflow_runs`. `workflowRunService` replaces `playbookRunService`. The old hook (`playbookAgentRunHook.ts`) is replaced by `workflowAgentRunHook.ts`. **Anywhere our earlier reports said "`playbookRunService.startRun(...)`" or "`playbookAgentRunHook`", read "`workflowRunService.startRun(...)`" / "`workflowAgentRunHook`".** The execution model (immutable versioned templates, step-by-step DAG with HITL gates, agent dispatch) is preserved.

2. **An SDR / lead-discovery foundation has been laid but not wired.** Two SKILL.md files (`discover_prospects.md`, `score_lead.md`) and two provider wrappers (`googlePlacesProvider.ts`, `hunterProvider.ts`) plus a stub service (`sdrService.ts`) all exist on disk. None of them are registered in `actionRegistry.ts` or dispatched in `skillExecutor.ts` — they are dead code from a skill-dispatch perspective. The `sdr-agent` system agent is seeded and lists these skills in its YAML, but those skill calls would 404 today.

3. **None of the operator-as-agency-specific schema additions landed.** No `canonical_prospect_profiles`, no `crm_type` on `subaccounts`, no `outreach_sends`, no `org_sending_domains`, no `bd_conversion_events`, no `event_rules`. Highest migration is `0279_task_events.sql`; next free is `0280`.

**Net for the operator-as-agency build:**

- The execution layer is essentially **done** — workflows-v1 covers `start_playbook`, `create_subaccount`, `send_notification`, `update_record`, `start_agent_run`, and CRM primitives as dispatchable steps with HITL gating, approver pools, confidence scoring, and stall notifications.
- The **routing / event-ingestion layer is still completely absent** — no event bus, no `event_rules` table, no webhook-to-workflow wiring. Workflows are still started by direct service calls only (HTTP route, scheduled task, onboarding hook, or `workflow.run.start` skill).
- The **prospect-data layer** (`canonical_prospect_profiles`, conversion event log) and the **outreach tracking layer** (`outreach_sends`, `org_sending_domains`, Resend webhook) are untouched.
- The **SDR skills** are 80% built but unwired — registering them takes <100 lines.

---

## Schema items

| Proposed item | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| `canonical_prospect_profiles` | **NOT BUILT** | Zero hits across `server/db/schema/` and `migrations/` for `prospect`, `canonical_prospect` | Closest landed tables are `canonical_contacts` and `canonical_opportunities` (`server/db/schema/canonicalEntities.ts:12-89`) — sync-sourced from external CRMs, not operator-built prospect lifecycle |
| `crm_type` on `subaccounts` | **NOT BUILT** | `server/db/schema/subaccounts.ts:1-105` — no `crm_type` / `crmType` column | Migration `0268_connector_configs_agency_columns.sql` added `connector_config_id` + `external_id` to `subaccounts` for GHL agency installs — closest adjacent work, but not a `crm_type` discriminator |
| `outreach_sends` | **NOT BUILT** | Zero hits for `outreach_send`, `provider_message_id`, `email_send` | `workspace_identities.email_sending_enabled` toggle exists (`server/db/schema/workspaceIdentities.ts:20`) but no send-tracking table |
| `org_sending_domains` | **NOT BUILT** | Zero hits for `sending_domain`, `warmup`, `warm_up` | Per-subaccount email identity provisioning landed (`migrations/0254_workspace_canonical_layer.sql`) but no per-org domain warmup config |
| `bd_conversion_events` | **NOT BUILT** | Only `conversion_events` is page-funnel only (`server/db/schema/conversionEvents.ts:5-26`, keyed on `page_id`) | No BD-specific conversion log under any name |
| `event_rules` | **NOT BUILT** | Zero hits for `event_rule`, `eventRule` anywhere | Closest is `policy_rules` (gate-decision table, scope: tool-call approval) — not a generic event-to-action dispatch system |

### Adjacent schema work that landed (informational)

- **GHL agency OAuth linkage** — `migrations/0268_connector_configs_agency_columns.sql` extended `connector_configs` with `token_scope`, `company_id`, `access_token`, `refresh_token`, `expires_at`, `scope`. Multi-location GHL agency installs are now first-class, but there is no `crm_type` discriminator yet.
- **Workspace canonical layer** — `migrations/0254_workspace_canonical_layer.sql` added `workspace_identities` + `workspace_actors` for per-subaccount email identity provisioning.
- **Agentic commerce** — `migrations/0271_agentic_commerce_schema.sql` added 7 tables (`spending_budgets`, `spending_policies`, `agent_charges`, etc.) for Stripe-backed agent spending. Unrelated to operator-as-agency BD.
- **Workflows-v1 schema** — `migrations/0276_workflows_v1_additive_schema.sql` added `workflow_step_gates`, `workflow_drafts`, plus columns on existing `workflow_runs`, `tasks`, `agent_execution_events`. See workflows-v1 section below.
- **`task_events`** — `migrations/0279_task_events.sql` added an append-only sequential event log per task. General-purpose lifecycle events, not BD or outreach.
- **`service_principals` table** — `server/db/schema/servicePrincipals.ts:9` exists for non-human identities. Partial groundwork for the system-principal plumbing we flagged.

### Migration range

Highest filename: `0279_task_events.sql`. Notable post-0189 work: 0190–0232 (LLM inflight, orchestrator gates, memory, delegation), 0245 (universal tenant RLS hardening), 0254–0255 (workspace canonical layer), 0268 (GHL agency OAuth), 0271 (agentic commerce), 0276 (workflows-v1), 0279 (task_events). **Next free number is `0280`.**

---

## Code-level items

| Proposed item | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| `CrmAdapter` formal interface | **NOT BUILT** | `server/adapters/` has only `ghlAdapter.ts`, `integrationAdapter.ts`, `slackAdapter.ts`, `stripeAdapter.ts`, `teamworkAdapter.ts`, `workspace/` | Generic `IntegrationAdapter` (`integrationAdapter.ts:286-335`) remains the only adapter base; no CRM-specific layer |
| `eventBus.publish()` | **NOT BUILT** | Zero hits across `server/**/*.ts` | Only unrelated `redisPub.publish()` (`llmInflightRegistry.ts:643`) and `workflowPublishService.publish()` (`routes/workflowStudio.ts:274`) |
| `server/lib/ruleMatcher.ts` | **NOT BUILT** | No file in `server/lib/`; `matchesFilter` still local to `triggerService.ts:44`; `matchesRule` still local to `policyEngineServicePure.ts:106` | Two separate matcher functions remain, no deduplication |
| Extended `playbookRunService.startRun()` with `triggeredBy` | **NOT BUILT** (redirected) | `playbookRunService.ts` no longer exists. The successor is `workflowRunService.startRun()` at `workflowRunService.ts:136` — its signature has nullable `startedByUserId` but no `triggeredBy: 'user'\|'job'\|'system'` field | The proposal needs to be rewritten against `workflowRunService` |
| Extended `executeConfigCreateSubaccount()` (prospectData + idempotencyKey) | **NOT BUILT** | `server/tools/config/configSkillHandlers.ts:266-309` — signature is `(input, context)` only; standard insert | |
| `lead_discover` skill (Google Places) | **PARTIAL — unwired** | `server/skills/discover_prospects.md` (renamed). Provider: `server/services/leadDiscovery/googlePlacesProvider.ts:40`. Handler: `server/services/sdrService.ts:19` | Skill MD + provider + handler all built. **Not registered** in `actionRegistry.ts`, **not dispatched** in `skillExecutor.ts`. Dead code from a dispatch perspective. |
| `lead_score` skill (Hunter.io) | **PARTIAL — diverged** | `server/skills/score_lead.md` (renamed). Hunter provider: `server/services/leadDiscovery/hunterProvider.ts:37,78` | The shipped `score_lead.md` is a pure LLM criteria-scorer (0-100 letter grade), NOT Hunter.io enrichment. Hunter lives separately, intended to back `enrich_contact` but unwired. |
| `classify_prospect_reply` skill | **NOT BUILT** | No `classify_prospect_reply.md`; only existing `classify_email.md` (support-triage taxonomy) | BD intent taxonomy (positive/negative/OOO/not-ready/referral) not built |
| `lead-discover` nightly pg-boss job | **NOT BUILT** | No file matching `lead*discover*` in `server/jobs/`; no queue registration | |
| `POST /api/webhooks/resend` | **NOT BUILT** | `server/routes/webhooks/` has `ghlWebhook.ts`, `slackWebhook.ts`, `stripeAgentWebhook.ts`, `teamworkWebhook.ts` only | New `stripeAgentWebhook` landed; Resend webhook did not |
| `email-inbound-poll` pg-boss job (IMAP) | **NOT BUILT** | No such file in `server/jobs/`; `imapflow` absent from `package.json` | |
| `email-reply-classify` pg-boss job | **NOT BUILT** | No such file; no queue registration | |
| `lead-discover` system agent seed | **NOT BUILT (different shape)** | `scripts/seed.ts` upserts 16+1 system agents from `companies/automation-os/agents/` slugs. The relevant agent is `sdr-agent` (`companies/automation-os/agents/sdr-agent/AGENTS.md`) which lists `discover_prospects` + `score_lead` in its skill list | One unified `sdr-agent` exists instead of the proposed split-out `lead-discover` agent. The agent is seeded, but its skills are unwired (see above). |
| `client-onboarding` playbook template | **NOT BUILT** | `server/workflows/` has `baseline-artefacts-capture`, `event-creation`, `intelligence-briefing`, `weekly-digest` only | `seedOnboardingModules.ts` registers only `intelligence-briefing` + `weekly-digest` |
| `GOOGLE_PLACES_API_KEY` in env | **PARTIAL** | Used via `process.env['GOOGLE_PLACES_API_KEY']` in `sdrService.ts:22` and `googlePlacesProvider.ts:40`. NOT in `server/lib/env.ts` Zod schema. NOT in `.env.example` | Variable used but ungoverned by the typed env wrapper |
| `HUNTER_API_KEY` in env | **PARTIAL** | Used via `process.env['HUNTER_API_KEY']` in `hunterProvider.ts:37,78`. NOT in `env.ts`. NOT in `.env.example` | Same pattern as Places |
| `RESEND_WEBHOOK_SECRET` in env | **NOT BUILT** | No reference anywhere | Only `RESEND_API_KEY` is in `.env.example` |
| Resend message-ID capture in `emailService.ts` | **NOT BUILT** | `emailService.ts:236` — `await resend.emails.send({...})` result discarded; `send()` returns `Promise<void>` | No correlation hook for Resend webhooks |
| Service-user / system-principal plumbing | **PARTIAL** | `workflow_runs.startedByUserId` is nullable (`workflowRuns.ts:75`). `service_principals` table exists (`server/db/schema/servicePrincipals.ts:9`). | FK nullability resolved. No system-user seed in `scripts/seed.ts`. `service_principals` not wired to `workflowRuns.startedByUserId`. |

### Adjacent / equivalent work observed

- **`sdrService.ts`** (`server/services/sdrService.ts:1-90`) — stub handler covering `discover_prospects`, `draft_outbound`, `score_lead`, `book_meeting`. Imported nowhere.
- **`googlePlacesProvider.ts`** + **`hunterProvider.ts`** — production-quality wrappers with LRU caching and graceful `not_configured` returns. Disconnected from skill dispatch.
- **`enrich_contact` skill** (`server/skills/enrich_contact.md`, registry at `actionRegistry.ts:1641`) is the only SDR-adjacent skill wired end-to-end. Stub note suggests `hunterProvider.ts` was meant to back it; wiring missing.
- **`servicePrincipals` table** landed but no seed or FK usage.
- **`sdr-agent` system agent** seeded via `scripts/seed.ts` phase 3. Lists `discover_prospects` + `score_lead`. Skill calls would 404 today.
- **Skill name mapping:** `discover_prospects` ≡ proposed `lead_discover` (concept identical, name changed). `score_lead.md` ≢ proposed `lead_score` (criteria-scorer LLM, not Hunter enrichment — these are effectively two different skills).

---

## workflows-v1 deep dive

### What it is

DAG-based, tick-driven automation engine built on the existing `workflow_runs` / `workflow_step_runs` tables (renamed from "playbooks" in migration 0221). It executes per-subaccount or per-org runs of versioned workflow templates, advancing step by step via pg-boss jobs on the `workflow-run-tick` queue. Steps can be one of four V1 user-facing types (`agent`, `action`, `approval`, `ask`) or a set of legacy engine types. Action steps route through `actionService.proposeAction → skillExecutor.execute` (same pipeline as standalone agents). Agent steps dispatch `agentExecutionService.executeRun` via a separate pg-boss queue (`workflow-agent-step`); the result returns via `workflowAgentRunHook`. Has HITL (step gates, approver pools, quorum, confidence scoring, stall notifications) and a Studio authoring surface backed by GitHub PRs.

**Workflows-v1 IS the renamed playbook system. There is no separate playbook system anymore.**

### Trigger surface

| Trigger | File:line | Notes |
|---|---|---|
| HTTP API (manual / programmatic) | `server/routes/workflowRuns.ts:74` — `POST /api/workflow-runs` → `WorkflowRunService.startRun()` | Any authenticated user/service with org context |
| Portal "Run Now" button | `server/routes/portal.ts:659,679` | Subaccount-portal-authed user re-runs a template |
| Scheduled task | `server/services/scheduledTaskService.ts:602-605` | RRULE-fired; can pin a specific template version (`pinnedTemplateVersionId` added in 0276) |
| Onboarding service | `server/services/subaccountOnboardingService.ts:235-272` | When platform detects an "owed" onboarding slug for a subaccount |
| Agent skill `workflow.run.start` | `server/services/skillExecutor.ts:621-624` → `workflowRunStartSkillService.ts:70` | Agent inside a running workflow can start a child workflow (depth-guarded at 3) |
| Orchestrator from task | `server/jobs/orchestratorFromTaskJob.ts:148-160` | Detects "workflow draft request" intent in tasks; creates a draft (not a run) |

**Critically absent:**
- No webhook receiver that starts a workflow.
- No inbound email handler.
- No CRM stage-change listener.
- `agentTriggers` (`server/db/schema/agentTriggers.ts`) fires *agent runs* on `task_created` / `task_moved` / `agent_completed` — does not start workflow runs.
- `conversionEvents` (`server/db/schema/conversionEvents.ts`) is written but never consumed to trigger a workflow.

### Action types it can dispatch

| Action | Supported | Mechanism |
|---|---|---|
| Start a (nested) playbook/workflow run | Yes (identity — workflows-v1 IS playbooks) | `workflow.run.start` skill; depth-3 cap |
| Create a subaccount | Yes | `action_call` with `actionSlug: 'config_create_subaccount'` → `workflowActionCallExecutor.ts:287` → `executeConfigCreateSubaccount`. HITL-resumable |
| Send a notification | Yes | `action_call` with `notify_operator` (registry `:2829`) or `send_email` (registry `:334`) |
| Update a record | Yes | `action_call` with `update_record` (registry `:604`) or CRM primitives (`crm.send_email`, `crm.send_sms`, `crm.create_task`, `crm.fire_automation`) |
| Start an agent run | Yes | `agent_call` / `agent` step type → `agentExecutionService.executeRun()` (`workflowEngineService.ts:3972`) |
| Execute CRM primitives | Yes | All registered (`skillExecutor.ts:1414-1488`); accessible via `action_call` |

The `RAW_CONFIG_HANDLERS` map (`workflowActionCallExecutor.ts:267-300`) directly wires all `config_*` actions (create_agent, update_agent, link_agent, set_link_skills, create_subaccount, create_scheduled_task) as HITL-resumable `action_call` targets.

### Per-org rules surface

**There is no per-org rules table that maps event → workflow.** Closest existing pieces:
- `agentTriggers` — maps eventType + eventFilter → *agent run* (not workflow run).
- `workflowTemplates` (`server/db/schema/workflowTemplates.ts:75`) — org-owned template definitions, not routing rules.
- `scheduledTasks.pinnedTemplateVersionId` — schedule → specific template version. Time-driven, not event-driven.

### User-facing concept

- **Drafts** (`workflow_drafts`, `server/db/schema/workflowDrafts.ts`) — orchestrator-authored or Studio-in-progress definitions. `consumedAt: null` until promoted.
- **Templates** — two levels: `system_workflow_templates` (platform-shipped, read-only) and `workflow_templates` (org-owned, may fork from system). Each template has immutable **versions** (`workflow_template_versions`). Studio (`workflowStudioService.ts`) opens a GitHub PR to merge a new `.workflow.ts` file.
- **Runs** (`workflow_runs`) — instantiation of a locked template version against a subaccount or org. One active run per task enforced by partial unique index (`workflow_runs_one_active_per_task_idx`, migration 0276).

### HITL and gating

Workflows-v1 has its **own** HITL surface, separate from the standalone `actionService` review queue:

- **`workflow_step_gates`** table — one row per open approval or "ask" gate, keyed by `(workflow_run_id, step_id)`. Carries `gateKind` (`approval | ask`), `seenPayload`, `seenConfidence`, `approverPoolSnapshot`.
- Lifecycle in `WorkflowStepGateService`. Decisions captured in `workflow_step_reviews` (one row per `(gateId, decidedByUserId)`, unique).
- Approve / reject / edit-and-approve via `WorkflowRunService.decideApproval()` (`workflowRunService.ts:722-946`).
- For `action_call` steps that go pending in `actionService`, `reviewItems.ts:163-169` calls `resumeActionCallAfterApproval()` to complete the workflow step. Bridge from old action review queue to workflow gate resumption exists but the primary gate surface is the new table.
- `isCriticalSynthesised` gates: rejection stalls instead of failing; stall-notification cadence escalates.

### Confidence + approver pools + stall notify

- **Confidence model** (`workflowConfidenceService.ts`, `Pure.ts`): `computeForGate()` queries past review counts for `(templateVersionId, stepId)`. Maps approved/rejected counts plus `isCritical`/`sideEffectClass`/upstream confidence into a `SeenConfidence` struct (value + UI copy). **Decorative — never auto-approves or auto-rejects.** Falls back to `few_past_runs_mixed_history` on error.
- **Approver pools** (`workflowApproverPoolService.ts`): each `approval` step declares an `approverGroup` of `kind`: `specific_users | task_requester | team | org_admin`. `resolvePool()` evaluates at gate-open time, snapshots into `approverPoolSnapshot`. `assertCallerInApproverPool()` 403s if caller not in snapshot. Admin `/refresh-pool` endpoint for membership changes.
- **Stall notifications** (`workflowGateStallNotifyService.ts`): three pg-boss jobs scheduled at 24h, 72h, 7d after gate creation. Each job sends plain-text email via `emailService.sendGenericEmail` if gate still unresolved. Stale-fire guard checks before send. `cancelStallNotifications()` cancels pending jobs by querying `pgboss.job` directly on resolution.

### `workflowAgentRunHook`

`server/services/workflowAgentRunHook.ts:31-55` — callback bridge from `agentExecutionService` back to the workflow engine. After any agent run, dynamic-imported `notifyWorkflowEngineOnAgentRunComplete(agentRunId, result)` checks `agentRuns.workflowStepRunId`. If set, calls `WorkflowEngineService.onAgentRunCompleted(stepRunId, result, agentRunId)` → step transitions complete/fail and engine re-ticks. Functionally identical to what `playbookAgentRunHook.ts` did — **it is the replacement.**

### Mapping previous recommendations against workflows-v1

| Recommendation | Satisfied? | How / Gap |
|---|---|---|
| Generic `event_rules` table | **No** | No table exists. `agentTriggers` fires agent runs on a narrow event set; no declarative mapping to workflow starts. |
| Single eventBus.publish surface | **No** | Workflows started only via direct `WorkflowRunService.startRun()` calls. No publish/subscribe layer. |
| Dispatch `start_playbook` | **Yes (identity)** | Workflows-v1 IS the renamed playbook system. `workflow.run.start` skill enables nested invocation up to depth 3. |
| Dispatch `create_subaccount` | **Yes** | `action_call` with `config_create_subaccount` → `executeConfigCreateSubaccount`. HITL-resumable. |
| Dispatch `send_notification` | **Yes** | `action_call` with `notify_operator` or `send_email`. |
| Dispatch `update_record` | **Yes** | `action_call` with `update_record` or CRM primitives. |
| Dispatch `start_agent_run` | **Yes** | `agent_call` step type → `agentExecutionService.executeRun()`. |
| Conversion-event-to-action wiring | **No** | `conversionEvents` written but never consumed to trigger anything. |
| Service-user / system-principal plumbing | **Partial** | `startedByUserId` nullable; onboarding service passes `null` for system-initiated runs. No formal system principal. `service_principals` table exists but unused for this. |

---

## Revised recommendation

**Extended, not dropped.** The earlier recommendation was framed as a single new "event_rules + dispatcher" subsystem. The right framing now is to recognise that workflows-v1 is the **execution layer** ("what to run, how, with which HITL/cost/confidence guardrails"), and the gap that remains is the **routing layer** ("when to start, for whom, with which initial input"). These are orthogonal.

Concretely, the revised recommendation:

1. **Drop the proposal to build the execution primitives.** Workflows-v1 already dispatches `start_playbook` (it IS playbook), `create_subaccount`, `send_notification`, `update_record`, `start_agent_run`, and CRM primitives as `action_call` / `agent_call` step types with HITL gating. Don't reinvent.

2. **Keep the `event_rules` table concept** (or call it `workflow_triggers`) — `{event_type, org_id, filter_json}` → `{workflow_template_id, initial_input_template}`. **The table's only dispatch target is `WorkflowRunService.startRun()`.** No new execution primitives required.

3. **Choose between two implementation paths for routing:**
   - **(a) Extend `agent_triggers`** with a `target_type` column (`agent_run | workflow_run`) and a nullable `workflow_template_id`. Cheaper (3 files change, no callers of `checkAndFire` break per the earlier exploration). Risk: semantic drift — `agent_triggers` was named when only agent dispatch existed.
   - **(b) Build a parallel `workflow_triggers` table.** Cleaner naming; same shape; share the `matchesFilter` evaluator with `agent_triggers` via the still-unbuilt `server/lib/ruleMatcher.ts`. Higher up-front cost.

   Recommendation: **(b)** — the naming clarity is worth the small extra cost, and the ruleMatcher extraction was already on the books anyway.

4. **Build the event ingestion surface alongside `workflow_triggers`.** Single normalised entry point that webhook routes (`ghlWebhook.ts`, new `resendWebhook.ts`, `stripeAgentWebhook.ts`), pg-boss jobs, and internal services call. `EventBusInput` is `NormalisedEvent` + `{ orgId, subaccountId?, source }` (per the earlier exploration). Routes to `workflow_triggers` lookup, then `WorkflowRunService.startRun()`.

5. **Wire `conversionEvents` consumers.** The page-funnel `conversion_events` writer currently inserts and stops. After the event bus exists, the same insert site should call `eventBus.publish(...)`. Same for `crm_stage_changed` events from `ghlWebhook.ts:112-157` (already received and upserted to canonical opportunities; just needs a publish call).

6. **Resolve the system-principal gap.** `service_principals` table exists but unused. Either seed a per-org system user, or wire `service_principals` to `workflow_runs.startedByUserId` via a polymorphic actor reference. Required for clean audit attribution on system-initiated workflow runs.

7. **The prospect / outreach data layers are independent of the routing/execution decisions above.** `canonical_prospect_profiles`, `outreach_sends`, `org_sending_domains`, `bd_conversion_events` (or generalised `event_log`), Resend webhook + IMAP polling — all still need to be built. None block on workflows-v1 or the routing layer.

8. **The SDR skills are 80% built and unwired** — registering `discover_prospects` and `score_lead` in `actionRegistry.ts` + `skillExecutor.ts`, declaring `GOOGLE_PLACES_API_KEY` / `HUNTER_API_KEY` in `env.ts` + `.env.example`, and connecting `hunterProvider` to `enrich_contact` is a half-day of plumbing rather than a green-field skill build.

9. **Clarify the `score_lead` divergence with the user.** The shipped `score_lead.md` is a criteria-based LLM scorer with no Hunter call. The original proposal was a Hunter-enrichment-driven score. Decide whether to keep both as separate skills or fold Hunter into `score_lead` (in which case it must move out of `enrich_contact`).

---

## What's left to build

*(section appended below)*
