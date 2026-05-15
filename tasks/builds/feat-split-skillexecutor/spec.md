---
status: DRAFT
date: 2026-05-14
author: spec-coordinator (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: feat-split-skillexecutor
output_location: tasks/builds/feat-split-skillexecutor/spec.md
---

# feat/split-skillexecutor — Module Decomposition Spec

Split `server/services/skillExecutor.ts` (6,133 LOC) into cohesive sub-modules along real concerns. Preserve the public API. No behaviour change. This spec is the pattern-setter — it lands the module-decomposition conventions that `feat/split-agentexecutionservice` adopts.

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime |
| Capability owner | platform |
| Lifecycle state on launch | Mature |
| Risk surface | agent runtime |
| Review cadence | on-incident-only |

Note: the launch-state restriction in `spec-coordinator §7.2` admits only `Inception` or `Growth` at first registration. The capability "Agent Runtime / skillExecutor" is already in `Mature` on the Asset Register — this build does not register a new capability; it refactors an existing one. The `Lifecycle state on launch` field reflects the pre-existing state, not a new registration.

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | No new capability acquired; reorganises code that already exists |
| Build | L | 6,133 LOC redistributed across many files; chunked migration with one PR per cohesive cohort |
| Carry | S | Once split, each sub-module is smaller and cheaper to read, test, and modify than the monolith |
| decommission | S | The single file is decommissioned as a unit by deleting it at the end of the migration; the sub-modules are the new carry surface |

## 1. Goals

1. Reduce `server/services/skillExecutor.ts` from 6,133 LOC to a thin barrel (target < 400 LOC) that re-exports the public surface and composes the sub-modules.
2. Identify cohesive sub-modules along real concerns: execution context, gate/audit pipeline, processor hooks, handler registry, individual handler families. NOT arbitrary LOC cuts.
3. Where business logic can be separated from infrastructure, follow the `*Pure.ts` convention already established by `skillAnalyzerServicePure.ts`, `skillExecutorPure.ts`, and `skillExecutorDelegationPure.ts`.
4. Preserve the public API. Every caller named in §4 below must compile without source edits beyond following re-exports.
5. Preserve test coverage. No existing test loses an assertion; new test files added only as a side effect of test-collocation moves.
6. Land the module-decomposition conventions in §5 so `feat/split-agentexecutionservice` and future splits adopt them.

## 2. Non-Goals

- No behaviour change. The same skill calls produce the same side effects, events, action records, idempotency keys, and observability.
- No new features, no new skills, no new gates, no new processor hooks.
- No public-surface changes — `skillExecutor.execute`, `SKILL_HANDLERS`, `SkillExecutionContext`, `SkillExecutionParams`, `SkillHandler`, `registerProcessor`, `setHandoffJobSender` retain identical types and call signatures.
- No changes to `server/skills/*.md` markdown definitions.
- No changes to `actionRegistry`, `actionService`, `reviewService`, `hitlService`, `executionLayerService`, `llmRouter`, or any downstream service.
- No commingling with unrelated refactors (no drive-by lint cleanup, no schema changes, no doc updates beyond the doc-sync rule).
- No deprecation of any existing module: the existing `skillExecutorPure.ts` and `skillExecutorDelegationPure.ts` files remain.

## 3. Framing Assumptions

- Repo is pre-production per `docs/spec-context.md`; testing posture is `static_gates_primary` — CI gates are the success signal, not local test runs.
- `skillExecutor.ts` is the single dispatch site for autonomous-run tool calls. Every agent run (api / headless / claude-code / iee_*) eventually hits `skillExecutor.execute()` directly or transitively.
- Caller imports use the codebase's `.js` import-extension convention; re-exports must preserve this.
- `SKILL_HANDLERS` is enumerated by external consumers (notably `skillAnalyzerService` and `systemSkillHandlerValidator`). Its export shape (`Record<string, SkillHandler>`) is load-bearing — the registry must remain a single value reachable from one import path at the end of the migration.
- Worker-adapter `registerAdapter('worker', …)` runs as a module-load side effect today. It MUST run exactly once at module load and MUST run before any caller dispatches a worker-routed action. The barrel preserves this by importing the worker-adapter module for its side effect at the top of the barrel.
- Handler implementations are async functions with the signature `(input, context) => Promise<unknown>`. Most are stateless w.r.t. module scope. The few that hold module-level state (`processorRegistry: Map`, `pgBossSend: function | null`) must move to a single location, not duplicate.
- TypeScript strict mode is on. `noImplicitAny`, `strictNullChecks`, and the existing tsconfig path mapping (`server/*`) are immutable for this build.
- Dynamic-import sites (`await import('./mcpClientManager.js')`, etc.) inside handlers are NOT optimised in this build. They stay where they are; they are not part of the module boundary contract.

## 4. Public-Surface Lock

These exports of `server/services/skillExecutor.ts` MUST remain importable from `server/services/skillExecutor.js` at the end of the migration with identical types and runtime semantics. The barrel re-exports them.

| Export | Kind | Consumers (representative — full caller list in §10) |
|---|---|---|
| `skillExecutor` | object — `{ execute(params): Promise<unknown> }` | `agentExecutionLoop.ts`, `flowExecutorService.ts`, `workflowActionCallExecutor.ts`, `optimiser/runOptimiserScan.ts`, `mcp/mcpServer.ts` |
| `SKILL_HANDLERS` | const `Record<string, SkillHandler>` | `skillAnalyzerService.ts`, `systemSkillHandlerValidator.ts`, `systemSkillService.ts`, `systemMonitor/triage/triageHandler.ts`, `__tests__/skillHandlerRegistryEquivalence.test.ts` (dynamic import) |
| `SkillExecutionContext` | exported interface | wide — every skill handler implementation; capability handlers; system-monitor skills; spendSkillHandlers; tool handlers under `server/tools/**` |
| `SkillHandler` | exported type alias | No current external consumer; exported because `SKILL_HANDLERS` is typed as `Record<string, SkillHandler>` and the alias is part of that public type. Reserved for future handler modules. |
| `registerProcessor` | exported function | middleware-pattern registrants (post-Phase-1 expansion) |
| `setHandoffJobSender` | exported function | `agentScheduleService.ts` |

`SkillExecutionParams` is NOT in this list — it is a private `interface SkillExecutionParams` inside `skillExecutor.ts` (the type of the only argument to `skillExecutor.execute`). It is not exported today and is not exported by the post-split barrel. It stays private to its post-split home (`registry.ts` per §5.7, alongside the `skillExecutor` object that closes over it). If a consumer later needs to construct an `execute()` params object, that is a public-surface expansion and requires its own spec amendment.

If a consumer imports any other symbol from `skillExecutor.ts` not in this table, that import path is locked too — find it in the caller sweep (§10) and either preserve it via the barrel or move the consumer to the new canonical path in the same chunk.

## 5. Module-Decomposition Conventions (Pattern-Setter)

These conventions govern this build AND every subsequent split (the agentExecutionService spec adopts them by reference).

### 5.1. Naming conventions

| Suffix / shape | Meaning | Example |
|---|---|---|
| `*Pure.ts` | Zero DB, zero env, zero service imports. Accepts data, returns data. Fully testable in isolation. Co-located `*Pure.test.ts` is the unit-test target. | `skillExecutorPure.ts`, `skillExecutorDelegationPure.ts`, `agentExecutionServicePure.ts` |
| `*Handlers.ts` | A family of related skill handler implementations sharing a topic (e.g. all task-board handlers, all DEC/dev-context handlers). One module per handler family. Each handler is an async function `(input, context) => Promise<unknown>`. May import `db`, services, and other handlers — but may NOT import the barrel (`skillExecutor.ts`). | `taskBoardHandlers.ts`, `devContextHandlers.ts`, `scrapingHandlers.ts` |
| `*Pipeline.ts` | Cross-cutting orchestration: per-tool processor hooks, gate/audit wrappers, denial-message builders, on-failure dispatch dispatchers. Holds module-level state when state is genuinely module-scoped (e.g. the processor registry). | `skillExecutorPipeline.ts` |
| `*Registry.ts` | A single exported constant that maps slug → handler reference. NO logic — only the assembled `Record<>` and its type. Imports from every `*Handlers.ts` module. | `skillHandlerRegistry.ts` |
| `*Adapter.ts` | A side-effect-only module that calls `registerAdapter(...)` at module load. Imported by the barrel for its side effect. | `workerAdapterRegistration.ts` |

### 5.2. Directory layout convention

The barrel (`skillExecutor.ts`) stays at `server/services/skillExecutor.ts`. The split contents live in a sibling directory at `server/services/skillExecutor/`.

```
server/services/
  skillExecutor.ts                ← barrel only (target < 400 LOC)
  skillExecutorPure.ts            ← pre-existing, untouched
  skillExecutorDelegationPure.ts  ← pre-existing, untouched
  skillExecutor/
    context.ts                    ← SkillExecutionContext + SkillHandler + requireSubaccountContext (SkillExecutionParams stays private in registry.ts — see §5.7)
    pipeline.ts                   ← processorRegistry, runWithProcessors, registerProcessor, applyOnFailure*, handoff-sender plumbing
    gating.ts                     ← executeWithActionAudit, proposeReviewGatedAction, awaitReviewDecision, buildDenialMessage
    registry.ts                   ← SKILL_HANDLERS constant — imports from every handlers/* module and assembles
    adapter-registration.ts       ← module-load registerAdapter('worker', ...) side effect, side-effect-only
    handlers/
      web.ts                      ← web_search, fetch_url, scrape_url, scrape_structured, monitor_webpage, capture_screenshot, run_playwright_test, analyze_endpoint
      workspace.ts                ← read_workspace, write_workspace
      tasks.ts                    ← create_task, move_task, update_task, add_deliverable, reassign_task, read_inbox, triage_intake, report_bug
      handoff.ts                  ← spawn_sub_agents, trigger_process (delegation paths)
      devContext.ts               ← read_codebase, search_codebase, run_tests, proposeDevopsAction
      pages.ts                    ← create_page, update_page, publish_page (page-specific handlers only — methodology slugs live in methodologyStubs.ts per §5.2.1)
      workflowStudio.ts           ← workflow_read_existing, workflow_validate, workflow_simulate, workflow_estimate_cost, workflow_propose_save, workflow.run.start, importN8nWorkflow
      skillStudio.ts              ← skill_read_existing, skill_read_regressions, skill_validate, skill_simulate, skill_propose_save
      capabilities.ts             ← capability discovery skills (re-export thin shells calling existing capability handlers)
      delegation.ts               ← reviewGated worker-action approved executors: executeWriteSpecApproved, executePublishPostApproved, executeAdsActionApproved, executeCrmUpdateApproved, executeFinancialRecordUpdateApproved, executeLeadMagnetApproved, executeDeliverReportApproved, executeConfigureIntegrationApproved, executeDocProposalApproved, executeWriteDocsApproved (+ redactSensitiveFields helper)
      memory.ts                   ← search_agent_history, read_priority_feed, read_data_source (thin re-export of `tools/readDataSource.ts`)
      slack.ts                    ← slack.list_channels, slack.read_channel, slack.search_messages, slack.summarise_thread, slack.post_message, slack.post_dm (6 thin shells over slackActionService)
      calendar.ts                 ← calendar.list_events, calendar.get_event, calendar.find_free_slot, calendar.create_event, calendar.update_event, calendar.respond_to_invite (thin shells over calendarActionService)
      support.ts                  ← support.list_open_tickets, support.read_thread, support.propose_reply, support.add_internal_note, support.approve_draft, support.reject_draft, support.set_status, support.assign, support.tag, support.find_customer_history, support.classify_ticket (11 slugs; + buildSupportPrincipal helper)
      meta.ts                     ← search_tools, load_tool — BM25 tool discovery
      userOwnedAgentOwner.ts      ← resolveAgentOwner helper (no slugs — leaf utility imported by calendar.ts and slack.ts)
      methodologyStubs.ts         ← all executeMethodologySkill consumers (template-only skills) — see §5.2.1
      autoGatedStubs.ts           ← all executeWithActionAudit stub consumers (auto-gated read placeholders) — see §5.2.1
      reviewGatedProposers.ts     ← all proposeReviewGatedAction inline thin-wrap consumers (gates that ONLY call proposeReviewGatedAction) — see §5.2.1
      thinDispatchers.ts          ← thin dispatch slugs that `await import('...')` a sibling service and forward — see §5.2.1
      systemMonitorShells.ts      ← thin shells over server/services/systemMonitor/skills/*.ts (11 slugs: read_agent_run, read_baseline, read_connector_state, read_dlq_recent, read_heuristic_fires, read_incident, read_logs_for_correlation_id, read_recent_runs_for_agent, read_skill_execution, write_diagnosis, write_event)
      optimiserShells.ts          ← thin shells over server/services/optimiser/* (8 slugs: optimiser.scan_agent_budget, optimiser.scan_workflow_escalations, optimiser.scan_skill_latency, optimiser.scan_inactive_workflows, optimiser.scan_escalation_phrases, optimiser.scan_memory_citation, optimiser.scan_routing_uncertainty, optimiser.scan_cache_efficiency)
      spendShells.ts              ← thin shells over server/services/spendSkillHandlers.ts (5 slugs: pay_invoice, purchase_resource, subscribe_to_service, top_up_balance, issue_refund)
      configShells.ts             ← thin shells over server/tools/config/configSkillHandlers.ts + workflowSkillHandlers.ts (~30 slugs: config_create_agent, config_update_agent, config_activate_agent, config_link_agent, config_update_link, config_set_link_skills, config_set_link_instructions, config_set_link_schedule, config_set_link_limits, config_create_subaccount, config_create_scheduled_task, config_update_scheduled_task, config_attach_data_source, config_update_data_source, config_remove_data_source, config_restore_version, config_list_*, config_get_*, config_run_health_check, config_preview_plan, config_view_history, config_publish_workflow_output_to_portal, config_send_workflow_email_digest, config_update_organisation_config, config_deliver_workflow_output, config_weekly_digest_gather)
      crm.ts                      ← crm.fire_automation, crm.send_email, crm.send_sms, crm.create_task, crm.query, read_crm, update_crm (methodology slugs `analyse_pipeline`, `draft_followup`, `detect_churn_risk` belong to `methodologyStubs.ts` per §5.2.1, not here — they happen to be CRM-domain methodology but they share the methodology dispatch shape and live with their sibling stubs)
      orgInsights.ts              ← read_org_insights, write_org_insight, compute_health_score, detect_anomaly, compute_churn_risk, compute_staff_activity_pulse, scan_integration_fingerprints, generate_portfolio_report, trigger_account_intervention, assign_task, query_subaccount_cohort
      output.ts                   ← output.recommend
      threadContext.ts            ← update_thread_context
      notifyOperator.ts           ← notify_operator (thin shell over notifyOperatorFanoutService.ts)
      mediaTranscription.ts       ← transcribe_audio, fetch_paywalled_content, send_to_slack
      capabilityDiscovery.ts      ← list_platform_capabilities, list_connections, check_capability_gap, request_feature, ask_clarifying_questions, ask_clarifying_question, challenge_assumptions, request_clarification (thin shells over server/tools/capabilities/*)
      digest.ts                   ← weekly_digest_gather, smart_skip_from_website, canonical_dictionary
      memoryBlock.ts              ← update_memory_block, read_docs (memory.ts already covers search_agent_history / read_priority_feed / read_data_source — split this off if memory.ts grows too wide)
      financialReporting.ts       ← read_revenue, read_expenses (auto-gated stubs that pair with the analyse_financials methodology; placed here even though they are technically stubs because they share the financial-reporting domain with reviewGated proposers like update_financial_record)
```

### 5.2.1. The "stub / thin-dispatcher" placement rule

Approximately 70 of the 214 source slugs are NOT bespoke handlers — they are one-line stubs of three shapes. Each shape gets its own handlers/* module so the registry's spread-pattern assembly stays clean:

| Shape | Module | Examples |
|---|---|---|
| `executeMethodologySkill(slug, input, { template, guidance })` — template-only skills that the LLM fills in | `handlers/methodologyStubs.ts` | `draft_post`, `analyse_performance`, `draft_ad_copy`, `analyse_financials`, `draft_content`, `audit_seo`, `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`, `draft_report`, `synthesise_voc`, `generate_competitor_brief`, `draft_followup`, `detect_churn_risk`, `draft_sequence`, `generic_methodology`, `analyse_pipeline`, `draft_architecture_plan`, `draft_tech_spec`, `review_ux`, `review_code`, `write_tests`, `draft_requirements`, `derive_test_cases`, `classify_email`, `draft_reply` — full list assembled at chunk authoring time |
| `executeWithActionAudit(slug, input, context, async () => stubBody)` — auto-gated stub returning `{status: 'stub'}` placeholders for unwired integrations | `handlers/autoGatedStubs.ts` | Only `search_knowledge_base`, `read_analytics`, `read_campaigns`, `enrich_contact`. Other slugs that pass through `executeWithActionAudit` (e.g. `read_crm`, `read_revenue`, `read_expenses`, `read_docs`, `update_crm`, `notify_operator`, `trigger_account_intervention`, `update_thread_context`) have a domain home and live there, NOT here. The §5.2 mapping wins. |
| `proposeReviewGatedAction(slug, input, context)` — single-line gate dispatch where the actual work happens in the worker adapter or downstream service | `handlers/reviewGatedProposers.ts` | Only slugs whose ONLY implementation in the source is a single line returning `proposeReviewGatedAction(slug, input, context)` AND which are NOT already domain-assigned in §5.2. After §5.2 assignments are applied: `publish_post`, `update_financial_record`, `create_lead_magnet`, `deliver_report`, `configure_integration`, `propose_doc_update`, `write_docs`, `write_spec`, `update_bid`, `update_copy`, `pause_campaign`, `increase_budget`, `send_email`, `update_record`, `request_approval`. Other slugs that pass through `proposeReviewGatedAction` (e.g. `update_crm`, `create_page`, `update_page`, `publish_page`) have a domain home — they live there, NOT here. NOTE: `write_patch`, `run_command`, `create_pr` look similar but route through `proposeDevopsAction` (a devContext-specific gate helper) — they live with `handlers/devContext.ts` per Chunk 8. |

**Slug-placement precedence rule:** when a slug appears to fit both a domain module from §5.2 and a stub module from §5.2.1, the §5.2 domain module wins. The §5.2.1 stub modules are the catch-all for slugs that have NO better domain home. This rule prevents double-claiming.

A slug that calls `await import('./otherService.js')` and forwards lives in `handlers/thinDispatchers.ts` unless its sibling service has a natural family home (then it goes in that family's module instead — e.g. spend dispatchers go to `spendShells.ts`, config dispatchers to `configShells.ts`, system-monitor dispatchers to `systemMonitorShells.ts`, optimiser dispatchers to `optimiserShells.ts`).

This rule ensures every one of the 214 slugs maps to exactly one `handlers/<family>.ts` module, no slug stays inline in `registry.ts` after Chunk 14. If a future audit finds a slug not covered, it goes into the closest-fit module from the list above OR a new family module is added with a follow-up chunk; the spec's invariant is "no inline handlers in `registry.ts` post-split", not "exactly these modules forever".

### 5.3. Dependency direction (DAG, no cycles)

```
                        ┌──────────────────┐
                        │ skillExecutor.ts │  (barrel — public surface)
                        └────────┬─────────┘
                                 │ re-exports
       ┌─────────────────────────┼─────────────────────────────┐
       ▼                         ▼                             ▼
  context.ts             registry.ts                  adapter-registration.ts
  (types only)           (assembles handler map)      (side-effect import)
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
         pipeline.ts         gating.ts        handlers/*.ts (one per family)
              │                  │                  │
              └──────────┬───────┘                  │
                         │                          │
                         ▼                          ▼
                  *Pure.ts modules            services, db, other handlers/*
                  (skillExecutorPure,         (handlers/* MAY import other
                   delegationPure,            services and other handlers,
                   future Pure helpers)       but NEVER the barrel)
```

Concrete rules:
- The barrel `skillExecutor.ts` imports from `skillExecutor/registry`, `skillExecutor/context`, `skillExecutor/pipeline`, `skillExecutor/gating`, and `skillExecutor/adapter-registration` (last one for side effect only). NOTHING else.
- `context.ts` is a leaf — imports types only from `../../shared/types/**` and external libs. NO imports from `db`, `services`, or sibling sub-modules.
- `pipeline.ts` imports `context.ts`, `skillExecutorPure.ts`, `actionRegistry`, `tracing` (for `createEvent`), `tripwire`, `incidentIngestor`, and the imports `enqueueHandoff` needs today — `db`, drizzle helpers (`eq`, `and`), `lib/queryHelpers` (`isActive`), the schema tables `subaccountAgents` / `agents` / `agentRuns`, and `config/limits` (`MAX_HANDOFF_DEPTH`). The `AGENT_HANDOFF_QUEUE` constant lives in `pipeline.ts` alongside `enqueueHandoff`. It does NOT import from `gating.ts` or any `handlers/*` (the gating module is a consumer of pipeline, not a peer).
- `gating.ts` imports `context.ts`, `pipeline.ts`, `actionService`, `reviewService`, `hitlService`, `executionLayerService`, `actionRegistry`, `tracing`. It does NOT import any `handlers/*`.
- Every `handlers/*.ts` imports `context.ts` (for the type), `gating.ts` (for `executeWithActionAudit` / `proposeReviewGatedAction`), and whatever services it dispatches to. It does NOT import any other `handlers/*` module, with two narrow exceptions: (a) `handlers/calendar.ts` and `handlers/slack.ts` may import `handlers/userOwnedAgentOwner.ts` for the shared `resolveAgentOwner` helper, and (b) `handlers/tasks.ts` and `handlers/handoff.ts` both import `enqueueHandoff` from `pipeline.ts` (per §5.5, not from each other). Record the cross-edges explicitly in each chunk PR.
- `registry.ts` imports `context.ts` and every `handlers/*`. It exports `SKILL_HANDLERS` and the `skillExecutor` object (the `{ execute }` closure that dispatches by slug, handles the `mcp.*` prefix branch, and stashes `toolCallId` on the context — exactly the body of `skillExecutor.execute` today). The private `SkillExecutionParams` interface stays here, next to `execute`. No other logic — the §5.3 rule is "assembly + execute closure only".
- `adapter-registration.ts` imports `context.ts` (for `SkillExecutionContext`), `executionLayerService` (`registerAdapter`), `adapters/workerAdapter` (`createWorkerAdapter`), `config/actionRegistry` (`resolveActionSlug`), the per-action approved executors from `handlers/delegation.ts`, and the page executors from `handlers/pages.ts` (`executeCreatePage`/`executeUpdatePage`/`executePublishPage` — the worker dispatch routes these three slugs to non-`*Approved` handlers in the page family). Two slugs use dynamic `await import(...)` inside the dispatch and stay as such: `config_update_organisation_config` (imports `configUpdateOrganisationService.executeApprovedOrganisationConfigUpdate`) and `notify_operator` (imports `notifyOperatorFanoutService.fanoutOperatorAlert`). Adapter-registration MAY NOT import the barrel `skillExecutor.ts` and MAY NOT import any other `handlers/*` module beyond the two named above.
- The barrel imports `adapter-registration.ts` for its side effect (worker adapter registration MUST happen exactly once at barrel load).
- No file under `skillExecutor/` may import the barrel `skillExecutor.ts`. If it needs the public `skillExecutor` object, it imports `skillExecutor/registry.ts` and constructs `{ execute }` itself — which is exactly what the barrel does.

### 5.4. Pure / impure separation rules

Per `DEVELOPMENT_GUIDELINES.md §2`: pure helpers live in `lib/`, not `services/`. The existing `skillExecutorPure.ts` and `skillExecutorDelegationPure.ts` are tolerated exceptions because they were extracted from a service and stay co-located for grepability.

Convention going forward: when a chunk of a `handlers/*` module is pure (no DB, no env, no service imports, no I/O), extract it to a `<topic>Pure.ts` sibling under `skillExecutor/` and import it from the handler. Examples that already exist:
- `skillExecutorPure.ts` — `applyOnFailurePure`, `applyOnFailureForStructuredFailurePure`, `OnFailureDirective`
- `skillExecutorDelegationPure.ts` — `resolveWriteSkillScope`, `classifySpawnTargets`, `computeReassignDirection`, etc.

This build does NOT proactively hunt for new Pure extractions. It only acknowledges the rule so future audits and edits know where to put new pure helpers.

### 5.5. Module-level state rules

Two module-level state sites exist today in `skillExecutor.ts`:
1. `processorRegistry: Map<string, ProcessorHooks>` — lives in `pipeline.ts` after the split. `registerProcessor` and `runWithProcessors` are the only readers/writers.
2. `pgBossSend: ((name, data) => Promise<string | null>) | null` — set by `setHandoffJobSender`, read by `enqueueHandoff`. Both live in `pipeline.ts`. Handlers that need to enqueue a handoff (currently `executeReassignTask` and `executeSpawnSubAgents`) import `enqueueHandoff` from `pipeline.ts`.

NO new module-level state introduced. NO existing module-level state duplicated across sub-modules.

### 5.6. Test-collocation rule

For every handler family that has a co-located test (`__tests__/<topic>.test.ts`), the test stays at its current path. Imports inside the test file may be updated to point at the new handler location, but the test file's location is NOT changed in this build.

`__tests__/skillHandlerRegistryEquivalence.test.ts` is the registry contract test — it enumerates `SKILL_HANDLERS` and asserts the slug set matches the registered action types (or whatever invariant it pins). Its assertions stay identical; only the import path of `SKILL_HANDLERS` may change (and even that stays the same if the barrel preserves the export, which is the default).

### 5.7. Barrel re-export shape

```typescript
// server/services/skillExecutor.ts (target shape)
import './skillExecutor/adapter-registration.js';  // side-effect import
export { skillExecutor, SKILL_HANDLERS } from './skillExecutor/registry.js';
export type { SkillExecutionContext, SkillHandler } from './skillExecutor/context.js';
export { registerProcessor, setHandoffJobSender } from './skillExecutor/pipeline.js';
```

The `skillExecutor` constant `{ execute }` lives in `registry.ts` so it closes over `SKILL_HANDLERS` in the same module. The private `SkillExecutionParams` interface (the argument shape of `execute`) stays in `registry.ts` next to its only consumer. The architect plan may revisit if there's a strong reason to put `skillExecutor` in the barrel; default is `registry.ts`.

## 6. Current State (Brief)

`server/services/skillExecutor.ts` is 6,133 LOC. It conflates seven concerns:

1. **Public-surface declarations**: the `SkillExecutionContext` interface (exported, lines 137-229), the private `SkillExecutionParams` interface (declared but not exported, lines 231-243 — argument shape of `skillExecutor.execute`), and the `SkillHandler` type alias (exported, lines 426-429).
2. **Module-load side effects** (lines 60-131): `registerAdapter('worker', ...)` dispatch switch — the review-gated worker handler. The switch covers ~20 action-type cases, mostly delegating to in-file `*Approved` executors, but also routes `create_page`/`update_page`/`publish_page` to in-file (non-`*Approved`) page executors, and dispatches `config_update_organisation_config` + `notify_operator` via inline `await import(...)` of sibling services.
3. **Pipeline orchestration** (lines 257-414): `applyOnFailure`, `runWithProcessors`, `processorRegistry`, `registerProcessor`, `setHandoffJobSender`, on-failure dispatch.
4. **Handler registry** (lines 439-2493): the `SKILL_HANDLERS` constant — built in THREE pieces, not one: the main literal at line 439 (~1,700 lines, most slugs), an `Object.assign(SKILL_HANDLERS, {...})` block at line 2210 (10 `support.*` slugs), and another `Object.assign(SKILL_HANDLERS, {...})` block at line 2374 (12 slugs: 6 `calendar.*` + 6 `slack.*`). Total ~214 slugs (verified by grep against the source). The §7 Chunk 14 (registry assembly) consolidates these three pieces into a single assembled map via the spread pattern.
5. **Gate / audit wrappers** (lines 2547-2823): `executeWithActionAudit`, `proposeReviewGatedAction`, `awaitReviewDecision`, `buildDenialMessage`.
6. **Per-handler implementations** (lines 2825-6133): ~50 individual async functions — `executeWebSearch`, `executeReadWorkspace`, `executeWriteWorkspace`, `executeCreateTask`, `executeMoveTask`, `executeReassignTask`, `executeSpawnSubAgents`, `executeFetchUrl`, `executeScrapeUrl`, `executeScrapeStructured`, `executeMonitorWebpage`, `executeReadCodebase`, `executeSearchCodebase`, `executeRunTests`, `executeAnalyzeEndpoint`, `executeReportBug`, `executeCaptureScreenshot`, `executeRunPlaywrightTest`, `executeCreatePage` / `executeUpdatePage` / `executePublishPage`, the methodology skills, the Workflow Studio executors, `executeImportN8nWorkflow`, the worker-approved-execute stubs for 10+ action types.
7. **One-off helpers** (locations in source): `requireSubaccountContext` (line 250), `buildSupportPrincipal` (line 2197 — used by all support.* handlers), `resolveAgentOwner` (line 2356 — used by all calendar.* and slack.* handlers), `serializeTask` (line 2965), `redactSensitiveFields` (line 3312 — used by `executeDocProposalApproved`/`executeWriteDocsApproved`), `buildIdeaDescription`/`buildBugDescription`/`buildChoreDescription`/`inferTypeFromDescription`/`suggestDisposition` (lines 3617-3736 — used by `executeTriageIntake`), `deriveSelectorGroup` (line 4790 — used by `executeScrapeUrl`), `proposeDevopsAction` (line 5210 — used by devContext handlers).

The seven concerns map cleanly to the §5.2 module tree. No two concerns are entangled at runtime — the only shared mutable state is the processor registry and pg-boss sender, both of which move to `pipeline.ts`.

## 7. Chunked Migration Plan

Each chunk is a complete, independently-mergeable PR (squashable into the integration branch). Builders execute one chunk at a time; G1 runs after each. The order is dependency-driven — early chunks land foundation pieces that later chunks consume.

**Sequencing rule for the worker-adapter `registerAdapter('worker', ...)` call.** The dispatch switch (lines 69-131 of the current file) is a module-load side effect that references several handler functions by name. While those handler functions are still private to the barrel (chunks 1-12 in this plan), the `registerAdapter(...)` call STAYS at the top of the barrel — extracting it earlier would require either (a) re-exporting private handlers from the barrel transitionally, or (b) having `adapter-registration.ts` import the barrel itself, both of which violate §5.3. The adapter-registration module is therefore extracted in Chunk 13, after `handlers/pages.ts` (Chunk 9) and `handlers/delegation.ts` (Chunk 12) both exist and export the named handlers it needs.

### Chunk 1 — Scaffold + types (foundation)

- Create the `server/services/skillExecutor/` directory.
- Create `skillExecutor/context.ts` and move `SkillExecutionContext`, `SkillHandler`, `requireSubaccountContext` from the barrel.
- `SkillExecutionParams` does NOT move here — it stays in the barrel for now and migrates to `registry.ts` in Chunk 14 alongside the `skillExecutor` object that consumes it (private symbol, no public-surface impact).
- Update `skillExecutor.ts` to re-export the moved types from `context.ts`. Public surface preserved.
- Update one canonical importer (`agentExecutionLoop.ts`) to import the type from the new path as a smoke test. All other importers keep using the barrel re-export.
- G1 success criteria: lint, typecheck, build:server pass. No behaviour change.

### Chunk 2 — Pipeline module

- Create `skillExecutor/pipeline.ts` containing: `processorRegistry`, `runWithProcessors`, `registerProcessor`, `applyOnFailure`, `applyOnFailureForStructuredFailure`, `setHandoffJobSender`, `pgBossSend` private state, `enqueueHandoff`, `AGENT_HANDOFF_QUEUE` constant.
- Pipeline imports per §5.3 — including the DB/schema imports `enqueueHandoff` needs (`db`, `subaccountAgents`, `agents`, `agentRuns`, `eq`, `and`, `isActive`, `MAX_HANDOFF_DEPTH`, `createEvent`).
- Update barrel to re-export `registerProcessor` and `setHandoffJobSender` from `pipeline.ts`.
- G1: lint, typecheck, build:server, targeted run of any `processorRegistry`/`enqueueHandoff` unit test.

### Chunk 3 — Gating module

- Create `skillExecutor/gating.ts` containing: `executeWithActionAudit`, `proposeReviewGatedAction`, `awaitReviewDecision`, `buildDenialMessage`.
- Gating imports `pipeline.ts` for `runWithProcessors`.
- No public surface change — these were already internal.
- G1: lint, typecheck, build:server.

### Chunks 4-10 — Handler families (one chunk per family)

Each chunk moves one `handlers/<family>.ts` worth of code out of the barrel:

| Chunk | Family | Skills / functions moved |
|---|---|---|
| 4 | `handlers/web.ts` | `web_search`/`executeWebSearch` + `logSearchUsage`, `fetch_url`/`executeFetchUrl`, `scrape_url`/`executeScrapeUrl` + `deriveSelectorGroup`, `scrape_structured`/`executeScrapeStructured`, `monitor_webpage`/`executeMonitorWebpage`, `capture_screenshot`/`executeCaptureScreenshot`, `run_playwright_test`/`executeRunPlaywrightTest`, `analyze_endpoint`/`executeAnalyzeEndpoint` |
| 5 | `handlers/workspace.ts` | `read_workspace`/`executeReadWorkspace`, `write_workspace`/`executeWriteWorkspace`, `serializeTask` |
| 6 | `handlers/tasks.ts` | `create_task`/`executeCreateTask`, `move_task`/`executeMoveTask`, `update_task`/`executeUpdateTask`, `add_deliverable`/`executeAddDeliverable`, `reassign_task`/`executeReassignTask`, `read_inbox`/`executeReadInbox`, `triage_intake`/`executeTriageIntake` + `buildIdeaDescription`/`buildBugDescription`/`buildChoreDescription`/`inferTypeFromDescription`/`suggestDisposition`, `report_bug`/`executeReportBug` |
| 7 | `handlers/handoff.ts` | `spawn_sub_agents`/`executeSpawnSubAgents`, `trigger_process`/`executeTriggerProcess` |
| 8 | `handlers/devContext.ts` | `read_codebase`/`executeReadCodebase`, `search_codebase`/`executeSearchCodebase`, `run_tests`/`executeRunTests`, `proposeDevopsAction` helper, plus the three slugs that call `proposeDevopsAction`: `write_patch`, `run_command`, `create_pr`. (`report_bug`/`executeReportBug` lives in `handlers/tasks.ts` per Chunk 6 — it creates a board task and uses task-service primitives, even though the source happens to place it near the dev-context family at line 5569.) |
| 9 | `handlers/pages.ts` | `create_page`/`executeCreatePage`, `update_page`/`executeUpdatePage`, `publish_page`/`executePublishPage`. The `executeMethodologySkill` helper function itself moves with `methodologyStubs.ts` in Chunk 10a — NOT with this chunk; `pages.ts` is page-specific only. After this chunk, the barrel's still-inline `registerAdapter(...)` dispatch updates its three page-slug imports from "in-barrel" to "imported from `handlers/pages.ts`" — the registerAdapter call itself stays in the barrel until Chunk 13. |
| 10 | `handlers/workflowStudio.ts` + `handlers/skillStudio.ts` | `workflow_*` executors (`executeWorkflowReadExisting`, `executeWorkflowValidate`, `executeWorkflowSimulate`, `executeWorkflowEstimateCost`, `executeWorkflowProposeSave`), `workflow.run.start`, `import_n8n_workflow`/`executeImportN8nWorkflow` (slug is snake_case `import_n8n_workflow`; function name is camelCase `executeImportN8nWorkflow`), skill_* (already thin shells — minimal motion) |

Per-chunk procedure:
1. Move the named functions and any helpers used only by them into the new file.
2. Update the slot in the in-barrel `SKILL_HANDLERS` literal to import from the new file (still in the barrel at this point).
3. Builder runs G1 (lint + typecheck + build:server). No targeted tests required unless a handler-specific test exists.
4. PR description names every moved function and every consumer updated.

### Chunks 10a–10e — Stub-family and thin-shell modules

These chunks land the high-volume "everything else" slugs identified in §5.2.1. The numbering uses `10a` … `10e` (decimal sub-chunks) to keep downstream chunk numbers stable; the operator may also collapse adjacent ones into a single PR if the diff is small.

| Chunk | Module | Approx slug count |
|---|---|---|
| 10a | `handlers/methodologyStubs.ts` | ~30 (every `executeMethodologySkill` consumer) |
| 10b | `handlers/autoGatedStubs.ts` + `handlers/reviewGatedProposers.ts` | ~25 combined (every inline `executeWithActionAudit` stub and every inline `proposeReviewGatedAction` gate) |
| 10c | `handlers/systemMonitorShells.ts` + `handlers/optimiserShells.ts` + `handlers/spendShells.ts` + `handlers/configShells.ts` + `handlers/capabilityDiscovery.ts` | ~55 combined (thin shells over already-extracted sibling services) |
| 10d | `handlers/crm.ts` + `handlers/orgInsights.ts` + `handlers/output.ts` + `handlers/threadContext.ts` + `handlers/notifyOperator.ts` + `handlers/memoryBlock.ts` + `handlers/financialReporting.ts` | ~25 combined |
| 10e | `handlers/mediaTranscription.ts` + `handlers/digest.ts` + `handlers/thinDispatchers.ts` (catch-all for any leftover thin dispatchers) | ~10 combined |

Per-sub-chunk procedure is the same as Chunks 4-10 above: move the slugs to the new file, update the in-barrel `SKILL_HANDLERS` literal slot, G1 the chunk. Each sub-chunk PR description enumerates the exact slug set moved.

After Chunk 10e lands, the in-barrel `SKILL_HANDLERS` literal is empty (every slug has moved to a `handlers/*` module). The next chunks (11, 12, 13, 14, 15) operate on the now-emptied registry.

### Chunk 11 — Remaining handler shells (small)

- `handlers/memory.ts`, `handlers/slack.ts`, `handlers/calendar.ts`, `handlers/support.ts`, `handlers/meta.ts`, `handlers/capabilities.ts`. These are largely thin re-exports / dynamic-import sites today; the chunk consolidates them.
- The `buildSupportPrincipal` helper moves to `handlers/support.ts` next to its consumers. The 10 support.* slugs in the `Object.assign(SKILL_HANDLERS, {...})` block at lines 2210-2349 (`support.list_open_tickets`, `support.read_thread`, `support.propose_reply`, `support.add_internal_note`, `support.approve_draft`, `support.reject_draft`, `support.set_status`, `support.assign`, `support.tag`, `support.find_customer_history`) plus the inline `support.classify_ticket` slug at line 840 (a thin dispatcher to `skillHandlers/supportClassifyTicket.ts`) all land in `handlers/support.ts` (11 slugs total).
- The `resolveAgentOwner` helper (used by all calendar.* and slack.* handlers) lands in a small shared module `skillExecutor/handlers/userOwnedAgentOwner.ts`. Both `handlers/calendar.ts` and `handlers/slack.ts` import it. This is the same one-way edge pattern §5.3 allows (e.g. `tasks.ts → handoff.ts` for `enqueueHandoff`).
- The line-2374 `Object.assign(SKILL_HANDLERS, {...})` block contains the calendar.* and slack.* slugs — naming for clarity: `calendar.list_events`, `calendar.get_event`, `calendar.find_free_slot`, `calendar.create_event`, `calendar.update_event`, `calendar.respond_to_invite` (6 calendar slugs), `slack.list_channels`, `slack.read_channel`, `slack.search_messages`, `slack.summarise_thread`, `slack.post_message`, `slack.post_dm` (6 slack slugs). Move all 12 into `handlers/calendar.ts` / `handlers/slack.ts` as part of this chunk.
- G1: lint, typecheck, build:server.

### Chunk 12 — Worker-approved-execute family (delegation handlers)

- Create `skillExecutor/handlers/delegation.ts` containing: `executeWriteSpecApproved`, `executePublishPostApproved`, `executeAdsActionApproved`, `executeCrmUpdateApproved`, `executeFinancialRecordUpdateApproved`, `executeLeadMagnetApproved`, `executeDeliverReportApproved`, `executeConfigureIntegrationApproved`, `executeDocProposalApproved`, `executeWriteDocsApproved`, plus `redactSensitiveFields`.
- The barrel's `registerAdapter('worker', ...)` call now references these from `handlers/delegation.ts` directly (still inline at the top of the barrel; the dispatch switch updates its imports but stays in `skillExecutor.ts` for now). This is the last "in-barrel" mutation before the adapter call is extracted in Chunk 13.
- G1: lint, typecheck, build:server. Functional: confirm worker dispatch still fires through `registerAdapter('worker', ...)`.

### Chunk 13 — Extract adapter-registration

- Now that `handlers/pages.ts` (Chunk 9) and `handlers/delegation.ts` (Chunk 12) both exist, the `registerAdapter('worker', ...)` call moves out of the barrel into `skillExecutor/adapter-registration.ts`.
- `adapter-registration.ts` imports per §5.3: `executionLayerService.registerAdapter`, `adapters/workerAdapter.createWorkerAdapter`, `config/actionRegistry.resolveActionSlug`, `context.ts` (for `SkillExecutionContext`), the three page executors from `handlers/pages.ts`, and the worker-approved executors from `handlers/delegation.ts`. The two dynamic-import dispatch arms (`config_update_organisation_config`, `notify_operator`) stay as inline `await import(...)`.
- The barrel adds `import './skillExecutor/adapter-registration.js';` at the top (side-effect import — preserves the load-time `registerAdapter` invariant).
- G1: lint, typecheck, build:server. Functional: emit a synthetic worker action in a test environment to confirm the adapter still fires. (CI gates cover the contract assertion.)

### Chunk 14 — Registry assembly + barrel thinning

- Create `skillExecutor/registry.ts` exporting `SKILL_HANDLERS` assembled from `handlers/*` imports. The three-piece source-file shape (one literal + two `Object.assign(SKILL_HANDLERS, {...})` blocks at lines 2210 and 2374) consolidates into a single assembled `Record<string, SkillHandler>` — the spread pattern (`{ ...webHandlers, ...workspaceHandlers, ...taskHandlers, ... }`) replaces the in-place `Object.assign`.
- Move the `skillExecutor` object constant (`{ execute }`) AND the private `SkillExecutionParams` interface to `registry.ts` so the closure stays in the same module.
- Update the barrel `skillExecutor.ts` to its final shape per §5.7.
- G1: lint, typecheck, build:server. Targeted run of `__tests__/skillHandlerRegistryEquivalence.test.ts` to confirm `SKILL_HANDLERS` slug set is unchanged.
- G2 (integrated): full lint + typecheck + build:server + build:client (no client changes expected; this is the "did we break a transitive import" check).

### Chunk 15 — Caller sweep + doc sync

- Sweep callers (§10 / §4 list). Where a caller imports a type that has moved, optionally update the caller to point at the new canonical path; otherwise leave the caller on the barrel re-export.
- Update `architecture.md § Skill executor & processor hooks` to describe the new module tree (one short paragraph and a pointer to the directory).
- Update `docs/doc-sync.md` if needed (likely not — the rule already covers this).
- G2 final: lint, typecheck, build:server, build:client.

### Anti-chunks (explicitly NOT in scope)

- No renames of any public-surface symbol.
- No changes to `actionRegistry`, `actionService`, `reviewService`, `hitlService`, `executionLayerService`.
- No changes to the worker-adapter contract.
- No changes to the `*Pure.ts` files.
- No changes to `server/skills/*.md`.
- No new `*Pure.ts` extractions beyond what already exists. (Adding new pure helpers is a separate, future build.)

## 8. Verification Strategy

### 8.1. Per-chunk (G1)

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build:server` — clean
- Targeted unit tests added/changed in this chunk: `npx vitest run <path>` — green

### 8.2. End-of-build (G2)

- `npm run lint` + `npm run typecheck` + `npm run build:server` + `npm run build:client` — all green
- CI runs the full gate suite. CI is the success signal per `DEVELOPMENT_GUIDELINES §5` and `references/test-gate-policy.md`.

### 8.3. Behaviour-preservation evidence

This refactor MUST be a no-op functionally. Evidence:
- The `__tests__/skillHandlerRegistryEquivalence.test.ts` assertion on the slug set passes before and after.
- The `systemSkillHandlerValidator` boot-time check (`validateSystemSkillHandlers()` per `architecture.md § Skill executor & processor hooks`) passes before and after.
- The `__tests__/agentRecommendations.skillExecutor.test.ts` and other handler-specific tests pass without modification (beyond import-path updates).
- No `agent_runs.action_records`-shape or `agent_execution_events`-shape changes.
- No new module-level state.
- No new `registerAdapter` calls.

### 8.4. Bisect-friendly chunking

Each chunk is independently revertible. If a regression is detected in CI on chunk N+1, reverting chunk N+1 puts the codebase back into a working state with chunks 1..N preserved. The barrel guarantees public-surface stability at every chunk boundary.

## 9. Deferred Items

These items surfaced during scoping but are explicitly OUT of this build's scope. Routed to `tasks/todo.md` under tag `SKILLEXEC-SPLIT-DEF-*`:

- `SKILLEXEC-SPLIT-DEF-1`: Investigate whether `processorRegistry` should be DI-friendly (passed in to `runWithProcessors`) rather than module-level. Today it is module-level — fine for now, but DI would unlock test isolation.
- `SKILLEXEC-SPLIT-DEF-2`: Audit the worker-adapter dispatch switch (currently ~30 cases) for whether it should be data-driven (map literal) instead of a `switch`. Same shape applies to `proposeReviewGatedAction` and `executeWithActionAudit` for symmetry.
- `SKILLEXEC-SPLIT-DEF-3`: New `*Pure.ts` extraction opportunities — `buildIdeaDescription` / `buildBugDescription` / `buildChoreDescription` / `inferTypeFromDescription` / `suggestDisposition` (triage skill helpers, currently in `handlers/tasks.ts`), `redactSensitiveFields` (currently in `handlers/delegation.ts`), `deriveSelectorGroup` (currently in `handlers/web.ts`). These are mechanically extractable but the unit-test value-add is moderate; defer until next pass.
- `SKILLEXEC-SPLIT-DEF-4`: `executeReportBug` shares structure with `executeCreateTask` — consider extracting a shared `createBoardTaskCore(input, kind)` helper after the split is stable.
- `SKILLEXEC-SPLIT-DEF-5`: Dynamic-import sites inside handlers (`await import('./mcpClientManager.js')`, etc.) are NOT modernised in this build. A separate audit can decide whether to hoist any of them to module-load.

## 10. Caller Sweep

The following files import from `server/services/skillExecutor` (verified by `grep -rn "from.*skillExecutor"` under `server/`). The migration MUST NOT break any of these imports — the barrel preserves all current public exports.

**Service-tier consumers (preserve via barrel):**

- `server/services/agentExecutionLoop.ts` — `skillExecutor` (value); also uses `SkillExecutionContext` transitively but its only `from './skillExecutor.js'` is the value import.
- `server/services/agentScheduleService.ts` — `setHandoffJobSender`
- `server/services/flowExecutorService.ts` — `skillExecutor`
- `server/services/intelligenceSkillExecutor.ts` — `SkillExecutionContext` (type-only)
- `server/services/workflowActionCallExecutor.ts` — `skillExecutor`, `SkillExecutionContext`
- `server/services/workflowRunStartSkillService.ts` — `SkillExecutionContext` (type-only)
- `server/services/systemSkillService.ts` — `SKILL_HANDLERS`
- `server/services/systemSkillHandlerValidator.ts` — `SKILL_HANDLERS`
- `server/services/spendSkillHandlers.ts` — `SkillExecutionContext` (type-only)
- `server/services/skillAnalyzerService.ts` — `SKILL_HANDLERS`
- `server/services/optimiser/runOptimiserScan.ts` — `skillExecutor` (value)
- `server/services/systemMonitor/triage/triageHandler.ts` — `SKILL_HANDLERS`, `SkillExecutionContext`
- `server/services/systemMonitor/skills/*.ts` (11 files: `readAgentRun`, `readBaseline`, `readConnectorState`, `readDlqRecent`, `readHeuristicFires`, `readIncident`, `readLogsForCorrelationId`, `readRecentRunsForAgent`, `readSkillExecution`, `writeDiagnosis`, `writeEvent`) — each imports `SkillExecutionContext` (type-only)
- `server/tools/capabilities/capabilityDiscoveryHandlers.ts` — `SkillExecutionContext` (type-only)
- `server/tools/capabilities/{requestFeatureHandler,challengeAssumptionsHandler,askClarifyingQuestionsHandler}.ts` — `SkillExecutionContext` (type-only)
- `server/tools/readDataSource.ts` — `SkillExecutionContext` (type-only)
- `server/tools/config/{workflowSkillHandlers,configSkillHandlers}.ts` — `SkillExecutionContext` (type-only)
- `server/tools/meta/types.ts` — re-exports `SkillExecutionContext` as a type
- `server/mcp/mcpServer.ts` — `skillExecutor` (value)

**Test consumers (preserve via barrel; one targeted re-import in chunk 1 as a smoke):**

- `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts` — `SKILL_HANDLERS` via dynamic `await import('../skillExecutor.js')`
- `server/services/__tests__/agentRecommendations.skillExecutor.test.ts` — `SKILL_HANDLERS` via dynamic `await import('../skillExecutor.js')` (six call sites — decision-flow integration tests for `output.recommend`)
- `server/services/__tests__/spendSkillHandlers.test.ts` — `SkillExecutionContext` (type-only)
- `server/services/__tests__/workflowRunDepthEntryGuard.test.ts` — `SkillExecutionContext` (type-only)
- `server/services/__tests__/workflowRunStartSkillPure.test.ts` — `SkillExecutionContext` (type-only)
- `server/services/optimiser/__tests__/runOptimiserScanPure.test.ts` — `skillExecutor` (value)

**Test files that `vi.mock` the barrel (the path must keep resolving; nothing is imported at runtime):**

- `server/services/__tests__/registerOptimiserSchedulePure.test.ts` — `vi.mock('../skillExecutor.js', ...)` — the barrel path is the mock target. The split must keep `server/services/skillExecutor.ts` resolvable so the mock continues to work.
- `server/services/optimiser/__tests__/verificationMatrix.test.ts` — `vi.mock('../../skillExecutor.js', ...)` — same shape.
- `server/services/optimiser/__tests__/runOptimiserScanPure.test.ts` — `vi.mock('../../skillExecutor.js', ...)` AT line 109 (in addition to its value-import at line 144 — listed in the test-consumers subsection above; this file is both a real importer and a mocker).

**NOT importers (textual references only — these files mention "skillExecutor" as a string literal, comment, log label, or filename but do NOT have a `from './skillExecutor.js'` import):**

- `server/services/agentExecutionEventServicePure.ts` — no skillExecutor import at all (previous spec text was wrong)
- `server/services/chargeRouterService.ts` — uses the string `'skillExecutor'` in a `sourceService` field only
- `server/services/crmQueryPlanner/plannerEvents.ts` — uses the string `'skillExecutor'` in a `sourceService` field only
- `server/services/notifyOperatorFanoutService.ts`, `server/services/reviewService.ts`, `server/middleware/errorHandling.ts`, `server/services/skillExecutorPure.ts`, `server/services/__tests__/skillExecutorPure.test.ts`, `server/tools/config/configSkillHandlers.ts` — these files mention "skillExecutor" in comments, log fields, or string literals but do NOT have a `from './skillExecutor.js'` import. Listed here so a textual `grep` against the next sweep does not surprise the reviewer.
- `server/services/__tests__/skillExecutor.reassignTask.test.ts` — imports `skillExecutorDelegationPure` only (the filename uses the prefix but the test exercises the pure sibling)
- `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts` — same shape: `skillExecutorDelegationPure` only

When running the Chunk 15 sweep, use this command to filter to real imports only and avoid the textual-reference noise:
```bash
grep -rnE "^import.*from\s+['\"]([^'\"]*)skillExecutor(\.js)?['\"]" server/
```

Any caller not in this list, surfaced during the Chunk 15 sweep, MUST be added to this section and re-validated. A missed caller is a spec gap, not a tolerable surprise.

## 11. Open Questions

1. **Adapter-registration extraction sequencing — RESOLVED.** Earlier draft proposed extracting `adapter-registration.ts` in Chunk 4 with a transitional barrel-import of private handlers. Spec-review iteration 1 (codex finding #6) rejected this as cyclic and impossible — private handlers can't be imported from outside the barrel, and the barrel cannot side-effect-import a module that imports the barrel. **Resolution:** the `registerAdapter('worker', ...)` call stays inline in the barrel during Chunks 1-12. The dispatch switch updates its target imports as each handler family lands (`handlers/pages.ts` in Chunk 9 covers the three page slugs; `handlers/delegation.ts` in Chunk 12 covers the worker-approved executors). Adapter extraction into `skillExecutor/adapter-registration.ts` is then Chunk 13, after both target modules exist. See §7 sequencing rule and Chunk 13 detail.
2. **Worker-adapter dispatch for un-listed action types — RESOLVED.** Today the switch ends with `default: return { success: false, error: 'No worker handler for: ${actionType}' };`. The split preserves this exact behaviour. The two dynamic-import dispatch arms (`config_update_organisation_config`, `notify_operator`) preserve their inline `await import(...)` pattern; they are NOT moved into `handlers/delegation.ts`.
3. **`buildSupportPrincipal` placement — RESOLVED.** It is a small private helper used only by the support desk handlers. It lives in `handlers/support.ts` per §7 Chunk 11.
4. **`resolveAgentOwner` placement — RESOLVED.** It is shared by calendar.* and slack.* handlers. It lives in `skillExecutor/handlers/userOwnedAgentOwner.ts` per §7 Chunk 11 (single-edge import from both `handlers/calendar.ts` and `handlers/slack.ts`).

## 12. Self-Consistency Pass Result

- §4 public-surface table matches §5.7 barrel-re-export shape: ✓ (post iter-1 reconciliation — `SkillExecutionParams` is private and not in either)
- §5.2 directory layout matches §5.3 DAG: ✓
- §7 chunked plan covers every concern enumerated in §6: ✓ — including the three-piece `SKILL_HANDLERS` shape (Chunk 14), `resolveAgentOwner` and `buildSupportPrincipal` helpers (Chunk 11), and adapter-extraction-last sequencing (Chunk 13).
- §10 caller sweep matches a fresh `grep -rn "from.*skillExecutor"` under `server/`: ✓ (iter-1 reconciliation removed three falsely-listed non-importers and added one missed test consumer)
- Public surface preserved at every chunk boundary: ✓
- No new module-level state introduced: ✓
- No new external API call: ✓
- No new test file required (collocation rule, §5.6): ✓
- Anti-chunks list excludes drive-by cleanup: ✓

## 13. Testing Posture Statement

Per `docs/spec-context.md`: testing posture is `static_gates_primary`. Verification is CI gates + lint + typecheck + build. No new runtime test files added by this build. Existing tests stay; their import paths may shift but their assertions do not.

## 14. Execution-Safety Contracts

This build modifies no write paths. Existing contracts (idempotency-key construction, action-state transitions, processor-hook ordering, worker-adapter dispatch) are preserved exactly.

If a chunk would introduce or modify a write path, that chunk is out of scope and the spec must be revised before it lands.

## 15. References

- Source file: `server/services/skillExecutor.ts`
- Existing pure siblings: `server/services/skillExecutorPure.ts`, `server/services/skillExecutorDelegationPure.ts`
- Reference pattern: `server/services/skillAnalyzerServicePure.ts` (pure-helper organisation)
- Public-surface contracts: `architecture.md § Skill executor & processor hooks`
- Service-layer rules: `DEVELOPMENT_GUIDELINES.md §2`
- Testing posture: `DEVELOPMENT_GUIDELINES.md §7` and `docs/testing-conventions.md`
- Companion build: `tasks/builds/feat-split-agentexecutionservice/spec.md` (adopts §5 conventions)
