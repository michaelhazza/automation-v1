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

*(section appended below)*

---

## Revised recommendation

*(section appended below)*

---

## What's left to build

*(section appended below)*
