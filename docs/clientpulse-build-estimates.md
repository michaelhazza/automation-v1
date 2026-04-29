---
title: ClientPulse Release — Build Estimates
date: 2026-04-29
status: draft
input: docs/clientpulse-dev-spec.md, docs/clientpulse-soft-launch-blockers-brief.md, docs/automation-os-system-agents-master-brief-v7.1.md, docs/iee-development-spec.md
revision: 1
---

# ClientPulse Release — Build Estimates

A grounded build estimate for the ClientPulse release: three Tier-1 core-loop features and two Tier-2 supporting features. Each estimate is anchored in actual file paths, table names, and existing service surfaces in this codebase. Estimates assume one senior engineer working alone, full-time, without a parallel reviewer (review pipeline budget is folded into each chunk).

## Table of contents

1. [Methodology & shared inventory grounding](#1-methodology--shared-inventory-grounding)
2. [Feature 1.1 — Portfolio Health Agent (production-grade)](#2-feature-11--portfolio-health-agent-production-grade)
3. [Feature 1.2 — White-Labeled Client ROI Dashboards with Baseline Capture](#3-feature-12--white-labeled-client-roi-dashboards-with-baseline-capture)
4. [Feature 1.3 — HITL Outreach Drafting on Churn Signals](#4-feature-13--hitl-outreach-drafting-on-churn-signals)
5. [Feature 2.1 — HITL-Gated Snapshot Rollback with Semantic Diff](#5-feature-21--hitl-gated-snapshot-rollback-with-semantic-diff)
6. [Feature 2.2 — Compliance-Messaging Portfolio Monitor](#6-feature-22--compliance-messaging-portfolio-monitor)
7. [Summary — totals, critical path, sequencing](#7-summary--totals-critical-path-sequencing)

---

<!-- Sections follow below. Each feature uses the format defined in the brief: existing capability inventory, build breakdown, risks, open questions, total estimate. -->

## 1. Methodology & shared inventory grounding

### 1.1 Sources consulted

The brief asked me to read a strategic recommendations doc on Google Drive (Drive ID `1t6SddfH-n0c1jbQSZWIJBlj3NIzDq60t8n7DTjANoVU`). That URL is not reachable from this environment. The in-tree equivalents cover the same surface and were used as primary current-state references:

- `docs/automation-os-system-agents-master-brief-v7.1.md` — full system-agents roster, including the Portfolio Health Agent.
- `docs/clientpulse-dev-spec.md` (rev 1, 2026-04-12, 1899 lines) — the existing ClientPulse implementation spec covering Modules A–G.
- `docs/clientpulse-ghl-dev-brief.md` — the upstream brief that produced the dev spec.
- `docs/clientpulse-soft-launch-blockers-brief.md` (2026-04-25) — the three soft-launch blockers (baseline capture, agency-level OAuth, rate-limiter durability).
- `docs/iee-development-spec.md` (rev 7) — Integrated Execution Environment with Playwright-based browser worker on a separate VPS, communicating with the main app via pg-boss.
- `docs/hitl-platform-dev-brief-v3.md` and `docs/agent-orchestration-hitl-reference.md` — HITL gate model and interrupt/resume reference.
- `docs/memory-and-briefings-spec.md` and `docs/memory-and-briefings-build-plan.md` — workspace memory shape, retrieval, decay.

If the Drive doc contradicts material-state findings here, the in-tree spec set takes precedence — those are the documents the implementation is being graded against.

### 1.2 Existing capability inventory shared across all five features

These primitives are already shipped or near-shipped; every estimate below reuses them rather than rebuilding.

**Portfolio Health Agent skeleton — substantially built, not stubbed.**

- `companies/automation-os/agents/portfolio-health-agent/AGENTS.md` (42 lines) — agent definition. Slug `portfolio-health-agent`, `executionScope: org`, `reportsTo: null`, eight skills allow-listed.
- `server/db/schema/systemAgents.ts` — system agent registration schema.
- `server/services/intelligenceSkillExecutor.ts` (765 lines) — config-driven signal evaluation: `metric_trend`, `metric_threshold`, `staleness`, `anomaly_count`. Health, churn, anomaly classification logic implemented.
- Skill markdown definitions all present: `compute_health_score.md`, `compute_churn_risk.md`, `detect_anomaly.md`, `generate_portfolio_report.md`, `query_subaccount_cohort.md`, `read_org_insights.md`, `write_org_insight.md`, `trigger_account_intervention.md`.
- Jobs already wired: `server/jobs/portfolioRollupJob.ts` (Mon 08:00 + Fri 18:00), `server/jobs/proposeClientPulseInterventionsJob.ts` (event-driven, gateLevel=review), `server/jobs/measureInterventionOutcomeJob.ts` (every 7 minutes).
- `server/services/alertFatigueGuard.ts` (49 lines) — severity-aware alert suppression keyed off `anomaly_events` per-account-per-day.

**Canonical signal schema — generic enough for v1, time-series-ready.**

- `client_pulse_signal_observations` (migration 0172) — `(organisation_id, subaccount_id, signal_slug, observed_at, numeric_value, json_payload, availability)`. Append-only. Indexed on `(subaccount_id, signal_slug, observed_at)`. Already populated for eight signal slugs: `staff_activity_pulse`, `funnel_count`, `calendar_quality`, `contact_activity`, `integration_fingerprint`, `subscription_tier`, `ai_feature_usage`, `opportunity_pipeline`.
- `client_pulse_health_snapshots` (migration 0173) — score, factor breakdown, trend, config_version, algorithm_version.
- `client_pulse_churn_assessments` (migration 0174) — risk score, band (`healthy|watch|atRisk|critical`), drivers, intervention_type.
- `intervention_outcomes` — pre/post snapshots, band attribution.
- `subaccount_tier_history` — append-only tier/plan history.

**HITL primitive — production-ready, all gate models implemented.**

- `actions` table with `gate_level` (auto|review|block), `status` lifecycle (proposed → pending_approval → approved → executing → completed/failed/rejected/blocked), `wac_checkpoint`, `input_hash`, `replay_of_action_id`.
- `review_items` with `human_edit_json` (inline edits supported).
- `action_resume_events` — immutable audit log of approved/rejected/timeout/edited.
- `server/services/actionService.ts` — propose/validate/transition.
- `server/services/reviewService.ts` — approve/reject/bulk, `SELECT FOR UPDATE` locking.
- `server/services/hitlService.ts` — `awaitDecision()` blocking pattern with race-safe `preResolvedDecisions` map.
- `client/src/pages/ReviewQueuePage.tsx` — review UI with grouping, bulk select, inline edit.
- `client/src/components/brief-artefacts/ApprovalCard.tsx` — reusable approval card.
- `server/config/actionRegistry.ts` — 102 actions registered. `crm.send_email`, `crm.send_sms`, `crm.fire_automation` are gate-locked to `review` by default.

**Workspace memory + embeddings — Phase 1 in production.**

- `workspace_memory_entries` with pgvector `embedding(1536)`, HNSW index, retention metadata (`lastAccessedAt`, `qualityScore`, `embeddingComputedAt`, `decayComputedAt`).
- `memory_blocks` (Letta-pattern named contexts) with `status`, `priority`, `isAuthoritative`, version history via `memory_block_versions`.
- `memory_review_queue` for HITL-gated belief conflicts and block proposals.
- Lifecycle jobs: `memoryDecayJob`, `memoryDedupJob`, `memoryEntryQualityAdjustJob`, `memoryHnswReindexJob`, `memoryBlocksEmbeddingBackfillJob`, `memoryBlockSynthesisJob`.
- `agentEmbeddingService` — OpenAI `text-embedding-3-small`, content-addressed cache.

**GoHighLevel adapter — Phase 1 read coverage shipped, Phase 2 fetchers added for ClientPulse.**

- `server/adapters/ghlAdapter.ts` (627 lines). Read methods for accounts, contacts, opportunities, conversations, revenue. Write: `createContact`. ClientPulse Phase 1 fetchers added (lines 522–626): funnels, funnel pages, calendars, users, location details, subscription tier. Tier-gated `GhlFetchResult` union (`available | unavailable_missing_scope | unavailable_tier_gated | unavailable_other`).
- `server/routes/webhooks/ghlWebhook.ts` (200 lines) — HMAC-SHA256 verification, 14 event types normalised.
- `server/services/canonicalDataService.ts` (856 lines) — unified read interface, principal-context gating.
- `server/services/connectorPollingService.ts` — lease-based per-connection sync, 1-minute cron tick, sync-phase state machine (backfill → transition → live).
- Per-location token-bucket rate limiter at `server/lib/rateLimiter.ts` — **in-memory only** (Item 3 of soft-launch blockers).

**Scheduling — pg-boss singleton, idempotent enqueue, DLQ pattern.**

- `server/lib/pgBossInstance.ts`, `server/config/jobConfig.ts`, `server/lib/createWorker.ts`. Forty-plus job types declared with idempotency strategy and DLQ siblings.
- `server/services/agentScheduleService.ts` — three workers (`agent-scheduled-run`, `agent-handoff-run`, `agent-triggered-run`).
- IEE browser worker (Playwright-based) runs on a separate VPS and communicates via pg-boss only — relevant for any external scraping (GMB rank, Search Console). Documented in `docs/iee-development-spec.md` Parts 4–6, lifecycle clarification in `docs/iee-delegation-lifecycle-spec.md`. Migration 0176 adds `agent_runs.iee_run_id`.

**Outbound messaging.**

- CRM-routed sends through GHL: `crm.send_email`, `crm.send_sms`, `crm.fire_automation` — all `gateLevel=review`, keyed-write idempotency, exponential backoff with no-retry on validation/auth/recipient errors. Implemented at `server/skills/crmSendEmailServicePure.ts`, `crmFireAutomationServicePure.ts`, etc.
- Generic `send_email` via SendGrid (`server/services/emailService.ts`) — branded HTML wrapper hardcoded to "Automation OS".
- `send_to_slack` skill present.
- Twilio is reachable via MCP preset (`server/config/mcpPresets.ts:104` — `@anthropic/twilio-mcp-server`); no native Twilio adapter.
- **No native voice/call skill.** No MJML / Mailgun-template renderer. No PDF export.

**What is NOT built.**

- No `org_branding` / `agency_branding` / white-label theme table. Email templates hardcode "Automation OS".
- No GMB, GA4, or Search Console adapters.
- No native Mailgun, Twilio, or A2P data adapter (deliverability stats path exists conceptually via GHL conversations, but the structured deliverability data is not surfaced).
- No GHL adapter methods for **workflow definitions, pipeline configurations, custom-field schemas, or trigger configurations** (the configuration surface, as opposed to the data inside them).
- No dedicated baseline-snapshot table for ROI delta (`system_monitor_baselines` exists for system metrics, not for ClientPulse ROI baselines).
- No semantic-diff engine for snapshot comparison.

### 1.3 Architectural constraints honoured by every estimate

The brief enumerates these as non-negotiable; each estimate complies:

- **Configuration over code.** Per-org thresholds, gate models, signal class definitions, and white-label parameters live in DB rows, not code branches. The signal schema (`client_pulse_signal_observations`) is already config-driven; new signal classes are configuration, not migration.
- **Multi-tenancy is fail-closed.** Every new table inherits the three-layer pattern: `organisation_id`, `subaccount_id`, RLS three-layer per `docs/architecture.md`. New writes funnel through canonical adapters with subaccount-field validation in the action registry.
- **HITL as the default for boundary actions.** Every outbound CRM mutation, snapshot push, and rollback uses `gateLevel=review` and routes through the existing `actions` + `review_items` infrastructure. No new gate primitive is built.
- **Canonical schema is v1, deliberate.** The brief stipulates the refactor trigger is the second connector. None of the five features force a schema refactor. Feature 2.1 adds a snapshot-state table additively; Feature 2.2 adds signal slugs additively.

### 1.4 Sizing convention

Sizes are **engineer-weeks** assuming one senior engineer full-time, single-threaded across the listed chunks. A week includes lint/typecheck/test gates and one round of independent review per CLAUDE.md (§ Review pipeline). Time for product-side decisions, design partner coordination, and external GHL test-account procurement is **excluded** — those are pre-build dependencies, not engineer hours.

Confidence levels:

- **High** — the surface area is well-understood, primitives exist, scope is bounded.
- **Medium** — one or two integration points are unverified or one design call could move the estimate by ±25%.
- **Low** — the spec is genuinely ambiguous and the variance could be ±50% or more. I flag the specific ambiguities in the open-questions section.

---

## 2. Feature 1.1 — Portfolio Health Agent (production-grade)

### 2.1 Existing capability inventory

**Already built and wired.**

- `companies/automation-os/agents/portfolio-health-agent/AGENTS.md` (42 lines) — agent definition, slug `portfolio-health-agent`, `executionScope: org`, eight skills allow-listed.
- `server/services/intelligenceSkillExecutor.ts` (765 lines) — config-driven signal evaluators (`metric_trend`, `metric_threshold`, `staleness`, `anomaly_count`); health/churn/anomaly classification with `NormalisationConfig` (linear, inverse_linear, threshold, percentile).
- `server/services/canonicalDataService.ts` (856 lines) — read interface for accounts, contacts, opportunities, conversations, revenue, metrics, anomalies.
- `server/services/alertFatigueGuard.ts` (49 lines) — severity-aware alert suppression keyed off per-account daily counts.
- `server/jobs/portfolioRollupJob.ts` (78 lines) — Mon 08:00 + Fri 18:00 cron; sweeps all orgs and calls `runPortfolioRollup()`.
- `server/jobs/proposeClientPulseInterventionsJob.ts` (318 lines) — loads churn assessment + health snapshot + templates, applies cooldown/quota, enqueues action proposals with `gateLevel=review`.
- `server/jobs/measureInterventionOutcomeJob.ts` (295 lines) — race-free `ON CONFLICT` outcome writes, pre/post snapshots, band attribution (migration 0244).
- Skill markdowns: `compute_health_score.md`, `compute_churn_risk.md`, `detect_anomaly.md`, `generate_portfolio_report.md`, `query_subaccount_cohort.md`, `read_org_insights.md`, `write_org_insight.md`, `trigger_account_intervention.md`.

**Data model already in place.**

- `client_pulse_signal_observations` (migration 0172) — append-only time-series, eight signal slugs already populated.
- `client_pulse_health_snapshots` (migration 0173).
- `client_pulse_churn_assessments` (migration 0174).
- `intervention_outcomes` (migration 0244) — race-free outcome attribution.
- `subaccount_tier_history` — tier/plan changes over time.
- `canonical_subaccount_mutations`, `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`, `canonical_conversation_providers` — feeder canonicals.

**Stubbed or partial.**

- Module B template provisioning is broken: `system_hierarchy_templates` lacks the `slug` column; `systemTemplateService.loadToOrg()` doesn't yet handle `executionScope: 'org'` cleanly. Spec'd in `docs/clientpulse-dev-spec.md` §6.3 (migration 0104). This is the gating item for "every org gets a Portfolio Health Agent automatically on subscription".
- GHL adapter Phase 1 fetchers shipped (funnels, calendars, users, location details, subscription tier) but the production data feed into `client_pulse_signal_observations` is not yet end-to-end verified against a live agency — `connectorPollingSync.ts` returns the stub `{ apiCallsApprox: 0, rowsIngested: 0 }` shape pending the Phase 2 wiring.
- Webhook normalisation incomplete for opportunity stage *transitions* — current `stageEnteredAt` capture is per-event; multi-stage history is captured in `stageHistory` JSONB but stage-dwell metrics aren't yet aggregated into a signal slug.
- Deterministic-rule vs LLM split for signal generation is config-driven but no LLM-reasoning signal class exists yet — every shipped signal class is rule-based today (cheap, deterministic).

**Does not exist yet.**

- Production-grade per-org threshold customisation UI. Org config exists in JSONB; the editing surface is API-only, no admin UI for thresholds.
- Per-signal-class enable/disable switches surfaced to the operator (the config supports it; the UI doesn't).
- LLM-reasoning signal evaluator (e.g. "summarise the last 30 days of conversations and flag tone shift").
- "Missed-call auto-text failure" signal — not yet a defined signal class.

### 2.2 Build breakdown

The label here is **Portfolio Health Agent — production-grade**. The agent skeleton, skills, schema, scheduling, fatigue guard, and intervention proposal pipeline are already shipped. What "production-grade" actually means in this estimate is: GHL data feed is live for a real agency, all eight signal slugs produce calibrated values, thresholds are tunable per org, a missing signal class (auto-text failure) is added, and the LLM-reasoning evaluator is a real path with a cost ceiling.

| # | Chunk | Description | Effort | Sequencing |
|---|---|---|---|---|
| A | GHL data-feed wiring (read side) | Wire `connectorPollingSync` adapters to actually populate `canonical_*` tables and `client_pulse_signal_observations` from GHL fetchers; verify end-to-end against a real agency test account. Includes pagination cursor handling, `unavailable_*` availability state propagation. | 1.5 | Blocking on Item 2 of soft-launch blockers (agency-level OAuth) |
| B | Signal-class calibration | Calibrate the eight existing signal classes against design-partner data; tune thresholds in `org_config` JSONB; add per-org override surface (admin route only, no UI in v1). | 1.0 | Parallel with C, D after A |
| C | Add "missed-call auto-text failure" signal | New signal slug `missed_call_auto_text`. Reads conversation events for inbound voice with no auto-text response within window. Adds rule-based evaluator to `intelligenceSkillExecutor`. | 0.5 | Parallel with B, D after A |
| D | LLM-reasoning evaluator path | Add a fifth evaluator type (`llm_reasoning`) that runs a bounded LLM call per subaccount per cycle, with cost ceiling enforcement via `budgetService` and reservation pattern. Single signal class wired (tone-shift detection on conversations). | 0.75 | After A; cost-budget gating must be wired before merge |
| E | Module B template-provisioning fix | Migration 0104: add `slug` column to `system_hierarchy_templates`, backfill, drop dup row, add unique constraint. Refactor `systemTemplateService.loadToOrg()` to handle `executionScope: 'org'` (creates `org_agent_configs` instead of subaccount links). | 0.5 | Independent; can ship before A |
| F | Per-org threshold UI | Minimal admin UI for editing signal thresholds — single page in `client/src/pages/`. JSON-schema-driven editor. | 0.5 | After B |
| G | Operational hardening | Trace coverage on every signal write, alert fatigue guard expanded to per-class quotas, dashboards for signal volume, dead-letter for evaluator failures. | 0.5 | After C, D |

**Total: 5.25 engineer-weeks.**

Parallelism: A is the keystone — once it's done, B, C, D run in parallel, then F and G land. With strict serial work, 5.25 weeks. With light parallelism via async test cycles against the design-partner account, realistically 4 weeks of focused effort.

### 2.3 Risks

- **Technical — GHL rate ceiling under live load.** Eight signal classes evaluated per subaccount on the polling cadence multiplies API calls fast. If a design-partner agency has 200 sub-accounts and the portfolio sweep evaluates each weekly, that's 200 × N read calls weekly. The in-memory rate limiter (`server/lib/rateLimiter.ts`) is single-instance; soft-launch blocker Item 3 addresses this. **If Item 3 ships Option A (single-instance)** the risk is contained for the first agency. **If Option B is required** add 0.5w to this estimate.
- **Technical — LLM cost on continuous mode.** Chunk D (LLM-reasoning evaluator) needs explicit cost ceilings and a circuit breaker tied to `budgetService`. Without that, a single broken prompt or a spike in conversation volume can blow the cost budget for the agency. The pattern exists (`budgetService` and `costBreaker` are referenced in the system) but Chunk D inherits the responsibility to wire it.
- **Integration — webhook event coverage.** Stage-transition history is captured but not aggregated into a dwell-time signal. If churn-prediction quality at calibration time depends on dwell-time metrics, expect a 0.5w extension to add a stage-transition aggregator.
- **Schema risk — signal classes vs Feature 2.2.** The brief asks whether `client_pulse_signal_observations` is generic enough to absorb compliance-messaging signals (Feature 2.2). **It is.** The schema is `(signal_slug, observed_at, numeric_value, json_payload, availability)`. Adding compliance signals is configuration plus evaluator wiring, not a schema refactor. No risk unless compliance signals require multi-dimensional time-series with separate facets — they don't.
- **Scope — the brief says "production-grade".** That term is doing a lot of work. If "production-grade" includes a richer signal-tuning UI, audit logs of threshold changes, A/B'd threshold evaluation, or an SLA on signal latency, the estimate grows by 1–2 weeks. I have estimated to "operational stability with the eight signal classes calibrated against one design partner".

### 2.4 Open questions for the architect

1. **Module B template provisioning vs Module A allowlist.** Chunk E (template provisioning fix) lives at the seam between Module A (`modules` table allowlist) and Module B (template wiring). Confirm Chunk E should land in the ClientPulse v1 release or whether it's already on a separate spec deadline. If already specced elsewhere, this estimate drops 0.5w.
2. **LLM-reasoning evaluator scope.** Is one wired class (tone-shift) sufficient for v1, or are there N target classes? Each additional class costs ~0.25w plus its own cost-budget calibration.
3. **Per-org threshold editing UI.** Is admin-route-only acceptable for v1, or does the agency owner need to edit thresholds themselves? Self-serve threshold editing adds permissions, audit logging, and a UI that survives role changes — about 0.5w more.
4. **Calibration partner cadence.** How quickly can a design-partner account return labelled true-positive / false-positive signal feedback? Calibration is gated on data availability; if labelled feedback takes >1 week, Chunk B serialises against that and the calendar timeline (not the engineer-week count) extends.

### 2.5 Total estimate

**5.25 engineer-weeks. Confidence: medium.**

The medium rating is because Chunk A (live data feed) is gated on Item 2 of the soft-launch blockers brief, and that blocker has open questions of its own (agency-token vs location-token exchange, install-webhook handling). If those resolve cleanly the estimate holds; if the agency-token exchange requires a per-location token mint per call, add 0.5–1w to Chunk A.

---

## 3. Feature 1.2 — White-Labeled Client ROI Dashboards with Baseline Capture

### 3.1 Existing capability inventory

**Already built or near-built.**

- Soft-launch blockers brief Item 1 (`docs/clientpulse-soft-launch-blockers-brief.md`) **already specs** baseline capture in detail: write-once snapshot, Tier 1 vs Tier 2 metrics, 5-day coverage requirement, retry policy, manual-entry validation, ROI delta arithmetic, reporting fallback rules. The build is approved-and-pending, not exploratory.
- Reports infrastructure: `server/db/schema/reports.ts` (34 lines) — portfolio reports table with status, delivery_method, report_data JSONB.
- `server/skills/generate_portfolio_report.md` skill defined — five-section structure (overview, attention, signals, patterns, actions).
- ClientPulse dashboard pages exist client-side: `client/src/pages/ClientPulseDashboardPage.tsx`, `ClientPulseClientsListPage.tsx`, `ClientPulseDrilldownPage.tsx`, `ClientPulseSettingsPage.tsx`, `ReportsListPage.tsx`, `ReportDetailPage.tsx`.
- Onboarding wizard pages exist: `OnboardingWizardPage.tsx`, `SubaccountOnboardingPage.tsx`, `OnboardingCelebrationPage.tsx`.
- `briefConversationService` + `briefConversationWriter` + `briefArtefactValidator` — the conversation primitive that can host a baseline-capture interview.
- IEE browser worker (Playwright on a separate VPS) is shippable per `docs/iee-development-spec.md` — the right primitive for scraping GMB, GA4, Search Console where official APIs are gated or insufficient.
- `system_monitor_baselines` table exists for system-monitoring percentile baselines — different domain, different retention semantics, **not the right home** for ClientPulse engagement baselines.
- `client_pulse_signal_observations` already stores time-series for the eight Phase 1 signals — the right home for "current value" reads when computing the delta.
- `emailService.ts` — branded HTML email wrapper with SendGrid backend; suitable for monthly delta narration delivery.

**Stubbed or partial.**

- `reports` table exists; the rendering pipeline (markdown → HTML email → in-app view) is partly wired through `generate_portfolio_report` but the white-label-aware rendering path is not built.
- `OnboardingWizardPage.tsx` exists but the baseline-capture conversational flow (the agent-led interview about what metrics matter for *this* client) is not wired.

**Does not exist yet.**

- **No `client_pulse_baselines` table.** Soft-launch blockers brief specs the schema in prose; the migration has not been written. Required columns per the brief: `(organisation_id, subaccount_id, metric_slug, value, source, confidence_level, captured_at, captured_by_user_id, reset_by_user_id, reset_reason, baseline_status)` plus indexes and unique constraints.
- **No white-label / agency-branding primitive.** Code-search confirms zero matches for `whiteLabel`, `org_branding`, `agency_branding`, theme.color across `server/`, `shared/`, `client/`. Email wrapper hardcodes "Automation OS" in `emailService.ts`. Dashboard pages render without a per-org theme layer.
- **No GMB, GA4, or Search Console adapters.** No code matches for `googleMyBusiness`, `searchConsole`, `googleAnalytics`, `ga4`, `gmbApi`. The brief lists these as required external sources for the baseline of certain engagement types (review velocity, organic visibility, page-level traffic).
- **No PDF export pipeline.** No Puppeteer, no headless browser used for export (the IEE worker uses Playwright but its purpose is agent task execution, not document rendering — different worker, different lifecycle). The brief does not commit to PDF; it asks whether the dashboard is hosted, PDF, or both.
- **No "metric definitions per client" data model.** Each client needs a configurable set of metric definitions tied to the baseline capture conversation; that model does not exist.
- **No baseline-capture agent.** The brief describes an "onboarding agent that interviews the agency operator about what metrics matter". No such skill or conversation flow is wired today.

### 3.2 Build breakdown

This feature has two distinct sub-builds (per the brief): baseline capture (one-time, conversational, partly automated, partly manual) and monthly delta narration (recurring, scheduled, white-labeled rendering).

| # | Chunk | Description | Effort | Sequencing |
|---|---|---|---|---|
| A | Baseline schema + write-once invariant | Migration: `client_pulse_baselines` table per the soft-launch blockers brief. Write-once trigger or row-level constraint. `baseline_status` lifecycle (`pending → complete → failed`). Manual-entry validation (numeric range checks against subaccount all-time recorded high). Admin-only reset path with audit log entry. | 0.75 | First. Independent. |
| B | Baseline readiness + automated capture | Listener that fires on first completed sync. Verifies Tier 1 metrics present, ≥5-day coverage OR Tier 1 stable across two consecutive cycles. Three-retry policy with `baseline_status='failed'` terminal state. Notifications to agency owner on failure. | 0.5 | After A. |
| C | Manual-entry form (existing-client backfill) | Admin UI page for entering historical baselines. Tier 1 fields required, Tier 2 optional. `source='manual'`, `confidence_level='confirmed'\|'estimated'`. Validation surface and audit trail. | 0.5 | After A. Parallel with B. |
| D | "Metric definitions per client" data model | New table `subaccount_metric_definitions` — per-subaccount list of which metrics matter for *this* engagement. Generic enough that ROI delta computation looks up applicable metrics from this table rather than a hardcoded list. | 0.5 | After A. Parallel with B and C. |
| E | Baseline-capture conversational agent (skill) | New skill `capture_client_baseline.md`. Uses `briefConversationService` to host the interview. Reads `subaccount_metric_definitions` (or proposes them) and writes `client_pulse_baselines` rows. Reuses the existing brief artefact + approval pattern so the agency operator confirms each captured value. | 1.0 | After D. |
| F | ROI delta computation + report integration | Service that for any (subaccount, metric) returns `(baseline_value, current_value, absolute_delta, percent_delta)`. Wired into `generate_portfolio_report` for the "since day one" section. Honours the reporting fallback rules (Tier 1 missing → suppress section, Tier 2 missing → "not yet available"). | 0.75 | After A, B. |
| G | White-label / agency-branding primitive | New `agency_branding` table per organisation: `(logo_url, primary_color, secondary_color, brand_name, footer_text, contact_email, custom_domain?)`. Server-side branding resolver service. Refactor `emailService.ts` to read branding from this table per `(organisation_id)` instead of hardcoding "Automation OS". Sane default fallback. | 1.0 | Independent, can run parallel with A–F. |
| H | White-labeled dashboard rendering | Apply the agency-branding context to `ClientPulseDashboardPage` and `ReportDetailPage`. Tenant-scoped CSS variables, logo and footer slots, brand-name interpolation. Public sharable client-facing URL token (signed JWT) gated to a single subaccount. | 1.0 | After G. |
| I | Monthly delta narration job | New scheduled job (cron: monthly, per-org) that for each subaccount computes deltas, calls `generate_portfolio_report` with white-label context, renders email + in-app artefact. Uses existing `pg-boss` cron pattern. | 0.5 | After F, G, H. |
| J | External-source baseline capture (GMB / GA4 / Search Console) | Add at least one external connector. **Recommended path**: route through IEE browser worker for GMB rank scraping (no clean API, official Business Profile API is rate-limited and limited to verified properties). GA4 and Search Console can use OAuth + REST. Pick one for v1, defer the other two. | 1.5 | After A. Independent of B–I. |

**Total: 8.0 engineer-weeks.** Without external-source baseline capture (Chunk J): 6.5 weeks. Without white-label dashboard rendering (Chunks G + H): 6.0 weeks.

### 3.3 Risks

- **Technical — white-label scope creep.** A "branded as the agency, not as ClientPulse" promise spans email templates, in-app dashboard, public client view, PDF (if specced), invoice copy, support footers, login screen. The estimate covers email + in-app dashboard + public client view. Anything beyond that compounds linearly.
- **Technical — public-shareable client URL.** A signed-token-gated URL per subaccount is straightforward; making it survive token refresh, agency rebranding, and revocation is harder. Currently no token-revocation primitive on shareable links exists in the codebase. Adding one is folded into Chunk H but at the optimistic end of estimation.
- **Integration — GMB API.** Google Business Profile API requires verified business ownership and is gated for marketing-tool use. If the agency owner can't grant the OAuth grant, the IEE browser scraper is the fallback; if Google rate-limits the scraper, the entire baseline path for review-velocity engagements becomes unreliable. **This is the highest-variance chunk.**
- **Integration — GA4 OAuth.** Google's `analyticsdata.readonly` scope is granted per Google account, not per agency. Multi-client agencies need a separate OAuth flow per client property. Estimate (Chunk J) assumes a single Google-OAuth flow; if N-property OAuth is needed, double Chunk J.
- **Schema risk — metric definitions per client.** Chunk D (per-client metric definitions) is the seam between "what we already track" and "what this client cares about". If the spec evolves to allow custom-formula metrics (e.g. "weighted average of pipeline value × close probability"), Chunk D balloons. Estimated at "menu of pre-defined metric slugs the agency picks from".
- **Scope — PDF export.** The brief asks "Is the dashboard a hosted web view, a PDF export, both?". Estimate excludes PDF. If PDF is required, add 0.5w (Puppeteer + a renderer skeleton) to 1.5w (full design parity with the web view).
- **Dependency — Item 1 of soft-launch blockers brief.** Items A and B of this estimate are the same scope as Item 1 of the soft-launch blockers brief. If that ships first, **2.25w drop from this estimate**. Coordinate sequencing.

### 3.4 Open questions for the architect

1. **Public client portal vs agency-internal-only?** The soft-launch blockers brief specs the baseline as agency-internal in v1 (open question 3 of Item 1). The brief I'm estimating against says "client-facing, white-labeled". These are in tension. If public client portal is in scope for v1, Chunk H grows by ~0.5w (token revocation, audit log, view-only role).
2. **Which external source for v1?** GMB, GA4, or Search Console? Recommend **GA4 first** — cleanest OAuth surface and the highest-leverage signal for most agencies' "engagement is up" narrative. GMB is high-leverage but high-risk because the API path is uncertain and the IEE-scraper path is brittle. Search Console is medium-leverage and medium-cost.
3. **PDF export in v1?** If yes, add ≥0.5w. If no, the dashboard URL is the only delivery surface beyond the email summary.
4. **White-label scope.** Email + in-app + public URL only, or also: invoices, login, support footers, custom domain? My estimate covers the first three. Confirm the rest are out of v1.
5. **"What metrics matter" interview vs preset menu.** Chunk D and E together implement a hybrid: agency picks from a menu, can override per client. If the brief requires a fully open-ended LLM-led interview that produces *novel* metric definitions, expect a +1w extension to D and E.

### 3.5 Total estimate

**8.0 engineer-weeks. Confidence: medium-low.**

Three of the largest variance drivers — external-source choice, white-label scope, public-vs-internal client portal — are genuinely product calls, not engineering calls. The feature is buildable but the spec has more open questions per chunk than Feature 1.1. If product locks the answers in (single external source, internal-only baseline, web + email white-label), confidence rises to medium and the estimate holds. If the answers expand v1 scope, the estimate goes to 10–12w.

---

## 4. Feature 1.3 — HITL Outreach Drafting on Churn Signals

### 4.1 Existing capability inventory

This is the smallest of the three Tier-1 features. Most of the surface already exists.

**Already built and wired.**

- `proposeClientPulseInterventionsJob.ts` (318 lines) — already triggers on churn signals from the Portfolio Health Agent, loads the relevant churn assessment + health snapshot + per-org templates, applies cooldown/quota policies, and enqueues action proposals with `gateLevel='review'`. **The trigger half of this feature already runs.**
- HITL primitive complete: `actions` table with `gate_level=review`, `review_items` with `human_edit_json` (inline edit supported), `action_resume_events` (immutable audit log), `hitlService.awaitDecision()` (race-safe blocking), `reviewService` with `SELECT FOR UPDATE`.
- Review UI complete: `client/src/pages/ReviewQueuePage.tsx` (per-run grouping, bulk select, filtering, inline edit). `client/src/components/brief-artefacts/ApprovalCard.tsx` (reusable per-action-type approval card). `client/src/components/pulse/MajorApprovalModal.tsx` (larger multi-field approvals). `client/src/components/dashboard/PendingApprovalCard.tsx` (dashboard widget).
- Outbound CRM actions registered in `actionRegistry.ts` with `defaultGateLevel='review'`: `crm.send_email`, `crm.send_sms`, `crm.fire_automation`. Implementations: `server/skills/crmSendEmailServicePure.ts`, `crmFireAutomationServicePure.ts`. Idempotency: keyed_write. Retry: 2× exponential, no-retry on validation/auth/recipient errors.
- Workspace memory has subaccount-scoped retrieval: `workspaceMemoryService.getMemoryForPrompt(taskContext, subaccountId, orgId)` returns hybrid-retrieved (vector + keyword + HyDE + RRF) per-subaccount memory entries. The right primitive for "per-client tone, history, prior conversations" context.
- Brief artefact pipeline: `briefApprovalService`, `briefArtefactValidator`, `briefConversationService`, `briefConversationWriter`. Approval cards already render proposed email content with approve / edit / reject buttons.

**Stubbed or partial.**

- `proposeClientPulseInterventionsJob.ts` enqueues action proposals but the **draft generation step** — actually composing the email/SMS body using subaccount-scoped memory and per-org templates — is partial. It loads templates and applies cooldown but the LLM-driven composition with per-client context retrieval is not yet wired end-to-end.
- Per-client tone/persona configuration: workspace memory holds the data, but there is no curated "client persona" memory block populated automatically from prior conversation history.

**Does not exist yet.**

- Voice/call-script outbound channel. The brief lists "email, SMS, call script" — only email and SMS reach the CRM today. Call-script generation is conceptually a `crm.create_call_task` or similar; no skill registered. Twilio is reachable via MCP preset (`server/config/mcpPresets.ts`) but no native voice action.
- Reject-and-regenerate UX. Current `ReviewQueuePage` supports approve / edit / reject. Reject deletes the proposal; there is no "reject and regenerate with this guidance" loop.
- Per-channel preview before send (rendering an email in operator's preview, an SMS as a phone-style mock).

### 4.2 Build breakdown

| # | Chunk | Description | Effort | Sequencing |
|---|---|---|---|---|
| A | Wire draft generation into `proposeClientPulseInterventionsJob` | LLM composition step pulling per-org template + per-subaccount memory snippets via `getMemoryForPrompt`. Outputs draft body to the action's `payload.body`. Idempotent on `(churn_assessment_id, intervention_type)`. | 1.0 | First. |
| B | Per-channel preview rendering | Email preview component (HTML iframe sandbox), SMS preview (phone-style mock), call-script preview (script + suggested talk-track). Reused approval card pattern. | 0.5 | After A. |
| C | Reject-and-regenerate loop | Reject button optionally captures freeform "what's wrong" text; re-enqueues a regeneration with the rejection reason as additional context. New `action_resume_events` row type `regenerated`. | 0.5 | After A. |
| D | Per-client persona memory block | Auto-synthesise a `client_persona` memory block per subaccount (using `memoryBlockSynthesisJob` pattern) from recent conversations + GHL contact tags. Block surfaces tone, communication preferences, recent topics. | 0.75 | Parallel with A–C. |
| E | Voice / call-script action | New `crm.create_call_task` action (or similar) that creates a follow-up task in the CRM with a generated talk-track. Routed through HITL like other channels. | 0.75 | After A. Optional for v1. |
| F | Channel selection logic | Lightweight policy: based on intervention_type and churn band, select email / SMS / call-task. Per-org override. Lives in `org_config` JSONB. | 0.25 | After A. |
| G | Operational hardening | Trace coverage, alert-fatigue guard for outreach (don't propose more than N drafts per subaccount per week — already partly enforced via cooldown but extend), end-to-end test via existing test fixtures. | 0.5 | After A–F. |

**Total: 4.25 engineer-weeks.** Without voice/call channel (Chunk E): 3.5 weeks.

### 4.3 Risks

- **Technical — LLM cost on draft generation.** Each churn signal triggers a draft composition. At a 200-subaccount agency with weekly sweeps, that is 200 draft calls per week best case. Cost ceiling and `budgetService` reservation must be wired into Chunk A; the pattern exists, the wiring is part of the chunk effort.
- **Quality — per-client tone retrieval.** `getMemoryForPrompt` returns hybrid-retrieved snippets. Quality of the per-client tone signal depends on having enough conversation history in `workspace_memory_entries` for the subaccount. Cold-start subaccounts (new clients) will produce generic-sounding drafts. Mitigation in Chunk D (auto-synthesised persona block) is partial; full mitigation requires conversation history backfill, which is not in scope.
- **Integration — voice/call-script via CRM task.** GHL's `create_task` API is registered, but creating a "call task with talk-track" is a stylistic convention (the talk-track lives in the task's body or notes). It is not a native GHL primitive. If product expects an automated dialler integration, Chunk E balloons (out of scope today).
- **Scope — reject-and-regenerate vs full multi-turn refinement.** The brief asks "Inline edit-and-approve, separate edit screen, full reject-and-regenerate?". My estimate covers the first and the third. A multi-turn "iterate the draft with the operator until happy" interaction is closer to the brief artefact conversation pattern and would add ~1w.

### 4.4 Open questions for the architect

1. **Voice / call-script in v1 scope?** If yes, +0.75w (Chunk E). If no, Chunk E drops and the feature ships in 3.5w.
2. **Per-client tone via auto-synthesised memory block vs per-Org prompt context only.** The brief explicitly asks. Auto-synthesised block (Chunk D) is +0.75w. Per-Org prompt context only — drop Chunk D, save 0.75w but lose per-client tone fidelity. Recommendation: **ship Chunk D**; it's the difference between "looks generic" and "sounds right" for the design partner demo.
3. **Edit UX — inline only, or also a separate edit screen for long emails?** Inline edit exists today via `human_edit_json`. A separate edit screen (richer composer, attachment support) is +0.5w and not estimated.
4. **What approves a "draft" action — a single review or a structured workflow (draft → manager review → operator approval)?** Estimate assumes single review by the operator. Multi-stage approval is +0.5w to reuse the gate primitive in series.

### 4.5 Total estimate

**4.25 engineer-weeks. Confidence: high.**

The high rating reflects that ~80% of the surface area (HITL primitive, action registry, review UI, intervention proposer, CRM send actions) is already shipped and stable. The remaining work is composition logic, per-channel preview, and the optional voice channel. Few unknowns; few external integrations.

---

## 5. Feature 2.1 — HITL-Gated Snapshot Rollback with Semantic Diff

### 5.1 Existing capability inventory

This is the largest single chunk in the release and the one most likely to push back on the spec assumptions. The CEO brief estimated 6–10 weeks for it. My estimate is at the upper end of that band, with reasons.

**Already built and reusable.**

- HITL primitive — same set described in Feature 1.3. Approval queue, inline edit, audit log, race-safe blocking — all reusable.
- `agent_run_snapshots` table — stores per-iteration `checkpoint` JSONB and full system-prompt snapshot. Wrong domain (agent execution state, not CRM configuration state) but the *pattern* of versioned, immutable snapshots tied to a run is reusable.
- `bundle_resolution_snapshots` — immutable per-run captures with prefix-hash dedup. Wrong domain again, but the pattern is established.
- `memory_block_versions` — content version history per block, monotonic version numbers, change source enum. Closest existing analogue to per-entity versioned configuration capture.
- `client_pulse_signal_observations` — append-only time-series, indexed on `(subaccount_id, signal_slug, observed_at)`. Suitable for storing "snapshot taken at T" *markers* but not the snapshot *bodies*.
- GHL adapter ClientPulse Phase 1 fetchers (lines 522–626): `fetchFunnels()`, `fetchFunnelPages()`, `fetchCalendars()`, `fetchUsers()`, `fetchLocationDetails()`. **These cover funnels and calendars only.**
- Canonical configuration tables exist as schema even if population is incomplete: `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`. The destination tables for state reads are partially in place.

**Stubbed or partial.**

- `canonical_workflow_definitions` and friends have schema but the population source is not yet wired — the GHL adapter does not currently call workflow-fetching endpoints.
- Webhook normalisation does not capture configuration mutations (workflow updates, pipeline structural changes, custom-field additions). Configuration drift detection between snapshots would have to come from poll-based comparison, not webhook-driven.

**Does not exist yet.**

- **GHL adapter methods for workflow definitions, pipeline configurations, custom-field schemas, trigger configurations.** These are the read primitives the entire feature depends on. No code matches `fetchWorkflows`, `fetchPipelines`, `fetchTriggers`, `fetchCustomFieldDefinitions` in `ghlAdapter.ts`. Before this feature can read state, the adapter must grow these methods. Each non-trivial: paginated, sometimes nested (workflow steps, trigger conditions), and GHL's API surface for some of these is documented as "limited" or undocumented for advanced configuration.
- Pre-push state capture table. Nothing exists. Need a new table — proposed `subaccount_state_snapshots` with `(organisation_id, subaccount_id, capture_id, entity_kind, entity_external_id, body_jsonb, body_hash, captured_at, retention_until)`.
- Semantic diff engine. Nothing exists. The classifier — agency update vs likely client customisation — has no analogue in the codebase.
- Snapshot push interception. The current GHL adapter has no "intercept a push, capture pre-state, then proceed" flow because pushes today are field-level (e.g. update a contact), not configuration-level. Snapshot pushes are an entirely new concept against this codebase.
- Rollback execution path. No existing primitive. GHL's API does not (per the brief's open question) clearly support workflow-restore-to-prior-state — restoring may require delete-and-recreate semantics, which is not idempotent in the same way a state restore would be.
- Per-sub-account rollback status tracking UI. Conceptually a derivative of `actions` table state, but the screens are new.

### 5.2 Build breakdown

The brief proposes a four-chunk structure (A, B, C, D). I think the breakdown is broadly right but will recommend splitting Chunk A and adding a Chunk 0 for the GHL state-read API expansion that the brief tucks inside Chunk A. My breakdown:

| # | Chunk | Description | Effort | Sequencing |
|---|---|---|---|---|
| A0 | GHL adapter expansion — configuration reads | Add `fetchWorkflows()`, `fetchPipelines()`, `fetchCustomFieldDefinitions()`, `fetchTriggers()`. Tier-gated `GhlFetchResult` union. Pagination handling. Reverse-engineer GHL's undocumented surface where needed. **The largest unknown in the entire feature.** | 2.0 | First. Independent. |
| A1 | Canonical configuration table population | Wire A0 outputs into `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, plus new tables for pipelines and triggers (~2 new tables). Polling cadence: nightly per subaccount. | 1.0 | After A0. |
| B | Semantic diff engine | Compare incoming snapshot to current state, classify deltas as agency-update vs client-customisation. Heuristics: last-modified-by, last-modified-when, structural similarity. Two-stage classifier: rule-based first cut, optional LLM second pass for ambiguous cases. Cost-budgeted LLM. Returns structured diff with confidence per delta. | 2.0 | After A0/A1 (needs both sides of the diff in canonical form). |
| C | Pre-push snapshot capture table + service | New `subaccount_state_snapshots` table. Capture service called on snapshot push intercept; serialises every relevant entity to JSONB blob, computes hash for retrieval. Retention policy: 30 days default, per-org configurable, GDPR-aware deletion. | 1.0 | Parallel with B after A0/A1. |
| D | Snapshot push intercept + HITL approval flow | New action type `snapshot_push` with `gateLevel=block` (always requires approval). Pre-push: capture state per Chunk C, run diff per Chunk B, render approval payload. Post-approval: execute the push with per-entity exclusion controls (operator can deselect specific deltas before approving). | 1.5 | After B, C. |
| E | Rollback execution | Per-entity restore. For each entity kind, decide: restore-in-place (where API supports it) vs delete-and-recreate (where it doesn't). Per-sub-account restore status tracking. Idempotent retries on partial failure. | 1.5 | After D. **Highest-risk chunk because GHL API may not support clean restore for some entity kinds.** |
| F | Approval & rollback UI | New page in `client/src/pages/` — snapshot diff approval (per-delta exclusion checkboxes, classifier confidence display), rollback initiation page, per-sub-account rollback status board. | 1.5 | After D. Parallel with E. |
| G | Operational hardening + tests | Trace coverage, end-to-end integration test against a sandbox agency account, dead-letter handling for partial-failure rollbacks, audit-log review per sub-account. | 0.75 | After E, F. |

**Total: 10.25 engineer-weeks.** Within the brief's 6–10w envelope only if Chunks E (rollback execution) and B (semantic diff) compress, which they shouldn't without scope cuts.

### 5.3 Risks

- **Technical — GHL configuration-read API surface (Chunk A0).** This is the dominant risk. GHL's documented API surface focuses on data inside containers (contacts, opportunities, conversations) more than on the containers themselves (workflows, pipelines, custom-field schemas). Some endpoints may be undocumented, others rate-limited differently, others may require scopes we don't have. **If A0 takes 3 weeks instead of 2** (because the API surface needs reverse-engineering), the whole feature pushes to 11.25w.
- **Technical — rollback semantics (Chunk E).** GHL's API for "restore a workflow to its prior state" is uncertain. If restore requires delete-and-recreate, every rollback breaks any external reference (workflow IDs change). The brief acknowledges this as an open question. Worst case: rollback for some entity kinds is *best-effort*, advertised explicitly to the operator at approval time. This is a product decision, not just an engineering one.
- **Technical — semantic diff classifier accuracy (Chunk B).** Rule-based first cut catches the easy cases (timestamp recently updated by client user → likely client customisation). LLM second pass for ambiguous cases costs money and adds latency. Calibration against real agency-vs-client edits requires a labelled dataset that doesn't exist yet.
- **Schema risk — none.** `subaccount_state_snapshots` is additive. Per the architectural-constraints rule (refactor trigger is the second connector), this fits within v1.
- **Cost risk — LLM classification.** A snapshot push with hundreds of deltas, half ambiguous, can cost real money on an Opus-class model. Budget reservation must be wired (pattern exists). Default to a Haiku-class model for the second pass with Opus reserved as opt-in for high-stakes pushes.
- **Scope — "intercept a snapshot push" is a new mental model.** The current adapter writes happen field-by-field (update a contact, fire a workflow, create an opportunity). Snapshot pushes — moving an entire workflow or pipeline configuration in bulk — happen via the GHL UI today, not via our API path. There is no "snapshot push" code path to intercept. The intercept primitive must be built.
- **Dependency — operator UX.** The approval screen is dense (potentially hundreds of deltas, classifier confidence per delta, exclusion controls). UX choice between summary-first (group by classifier verdict) vs entity-first (group by entity kind) is the difference between a 1.5w UI and a 3w UI. Estimated at 1.5w because v1 doesn't need polish.

### 5.4 Open questions for the architect

1. **What is "a snapshot push" in this product?** The brief assumes the agency pushes a snapshot via ClientPulse, but today snapshots are pushed in GHL's UI. Are we building a new "push snapshot from ClientPulse" affordance (large), or are we monitoring GHL-side pushes via webhook and capturing pre-state retroactively (different and probably impossible — GHL doesn't fire pre-mutation webhooks)?
2. **Rollback fidelity.** Is best-effort acceptable (some entity kinds restore cleanly, others approximately)? Or must rollback be byte-identical for v1? The first is buildable; the second requires GHL to provide configuration-versioning APIs that may not exist.
3. **Semantic diff confidence threshold.** What classifier confidence triggers auto-pass-through vs operator review? This is a product call; it materially changes the operator's perceived workload.
4. **Retention.** Default 30 days, per-org configurable. Confirm the lower and upper bounds. GDPR / data-subject-deletion intersect here.
5. **Scope of "every target sub-account".** A push to 100 sub-accounts produces 100 snapshots, 100 diffs, 100 approval rows. The UX must handle that scale; my estimate's UI chunk (F) assumes per-sub-account approval is feasible but not necessarily polished. If the UX must collapse N sub-accounts into a "approve for all" path with delta-level overrides, expect +0.5w on F.

### 5.5 Total estimate

**10.25 engineer-weeks. Confidence: low.**

Confidence is low because the dominant chunk (A0, GHL configuration-read API) has fundamental unknowns: whether the GHL API exposes the relevant surfaces at all. If product can confirm that workflow / pipeline / trigger / custom-field reads are achievable with the current scope set (or are achievable with one additional scope grant), confidence rises to medium. If they're not achievable without IEE-browser scraping the GHL admin UI, the feature compounds: the IEE worker is the right tool but the maintenance cost on a scraper that breaks every GHL UI release is real.

This estimate exceeds the CEO brief's directional figure (6–10w) by approximately 0.25–4w, depending on which end of the brief's range you anchor to. The driver is Chunk A0 (GHL configuration reads), which the brief implicitly assumes is in place but actually isn't. **Recommendation: spend the first half-week on a targeted GHL API spike before committing to the full 10w estimate** — the spike could collapse the estimate significantly if those endpoints turn out to be straightforward, or expand it if they don't.

---

## 6. Feature 2.2 — Compliance-Messaging Portfolio Monitor

### 6.1 Existing capability inventory

This feature is the smallest of the five and is mostly additive to Feature 1.1. The brief is explicit about its narrow scope: **monitor only**, not full compliance orchestration.

**Already built and reusable.**

- `client_pulse_signal_observations` schema is already generic — `(signal_slug, observed_at, numeric_value, json_payload, availability)`. Adding compliance signals is configuration plus evaluator wiring, **not a schema migration**.
- `intelligenceSkillExecutor` (765 lines) supports four evaluator types — `metric_threshold` (the obvious match for "complaint rate >0.05%"), `metric_trend`, `staleness`, `anomaly_count`. New compliance signals are configuration entries, not new evaluators in most cases.
- `alertFatigueGuard` already in production — applies severity-aware suppression keyed off per-account daily counts. Compliance alerts inherit it.
- `proposeClientPulseInterventionsJob` already routes signals to `gateLevel='review'` action proposals. Compliance signals can route through the same path (e.g. propose a "review high-complaint sub-account" task).
- ClientPulse dashboard pages exist (`ClientPulseDashboardPage`, `ClientPulseDrilldownPage`) and can be extended with a compliance lane without new pages.
- GHL adapter Phase 1 fetchers already touch the relevant data: `fetchSubscription` returns plan tier and active status; conversation reads include channel and message count.

**Stubbed or partial.**

- The conversation-channel data on `canonical_conversations` (`channel`, `messageCount`, `lastMessageAt`) is captured per conversation but not aggregated to per-day per-channel sending rate per subaccount. Adding a daily aggregator is part of the build (see Chunk B below).
- Twilio is reachable as MCP server (preset registered), but no native adapter pulls structured Twilio billing / error-code data.

**Does not exist yet.**

- Mailgun deliverability stats. No native adapter. GHL surfaces some sending statistics indirectly via conversation reads but not Mailgun's complaint-rate, bounce-rate, spam-rate fields. **A native Mailgun adapter does not exist** in `server/adapters/`.
- Twilio billing / error-code data adapter. Same situation. Available via MCP but not natively surfaced into canonical schema.
- A2P (10DLC) registration status. No adapter, no canonical field. GHL exposes some of this via the locations API but it's not currently captured.
- Any compliance-specific signal class. The eight existing slugs are engagement/health-oriented, not compliance-oriented.
- Any compliance-specific dashboard surface (per the brief, this is fine — the feature plugs into the existing dashboard).

### 6.2 Build breakdown

| # | Chunk | Description | Effort | Sequencing |
|---|---|---|---|---|
| A | New compliance signal classes (config) | Define five new signal slugs in `client_pulse_signal_observations` config: `mailgun_complaint_rate`, `sending_rate_spike`, `a2p_registration_status`, `twilio_balance_risk`, `bounce_rate`. Each declares evaluator type and threshold. Pure config in `org_config` JSONB; no schema migration. | 0.25 | First. |
| B | Sending-rate aggregator (uses existing data) | Daily aggregator job that reads `canonical_conversations` and writes per-subaccount per-channel daily volume to `client_pulse_signal_observations`. Detects spikes via `metric_trend` evaluator. **Doesn't require new external data** — uses what we already pull from GHL. | 0.5 | After A. |
| C | Mailgun adapter (read-only) | New `server/adapters/mailgunAdapter.ts`. OAuth via API key per sub-account (or per-org if Mailgun is shared). Pulls deliverability stats: complaint rate, bounce rate, spam rate. Writes to `client_pulse_signal_observations`. Per-sub-account rate-limited. | 1.0 | Parallel with B. |
| D | Twilio adapter (read-only) | New `server/adapters/twilioAdapter.ts`. Pulls account balance, error-code summary, A2P registration status. Writes to `client_pulse_signal_observations`. Or use the existing MCP path and read into canonical via a lightweight skill (cheaper, less robust). | 1.0 | Parallel with B, C. |
| E | Compliance dashboard lane | Add a "compliance" tab to `ClientPulseDashboardPage` showing the five signal classes per sub-account, with the existing severity / fatigue UI. No new page. | 0.5 | After A–D. |
| F | Operational hardening + tests | Adapter test fixtures, threshold calibration, alert routing through existing intervention proposer (e.g. high-complaint sub-account → "review for compliance issues" task). | 0.5 | After E. |

**Total: 3.75 engineer-weeks.** Without Twilio adapter (Chunk D, MCP-only path): 2.75 weeks. Without Mailgun adapter (Chunk C, GHL-only data path): 2.75 weeks. Cheapest version (no new external adapters, just sending-rate spikes from existing data): **1.75 weeks**.

### 6.3 Risks

- **Technical — Mailgun and Twilio scope.** Most agencies use Mailgun and Twilio via GHL itself, where the agency does not directly hold the API credentials. If the credentials live with GHL and the agency cannot grant ClientPulse direct access to Mailgun/Twilio, Chunks C and D are blocked. The fallback is to read whatever GHL exposes about deliverability and A2P status — which is partial. **This risk is meaningful: it may force the cheapest version (1.75w) by default.**
- **Technical — schema strain.** The brief asks whether the signal schema needs new classes. **It doesn't.** `signal_slug` is text and `json_payload` is JSONB. Confirmed: zero schema risk. This is a notable finding because it confirms Feature 1.1's schema design choice was correct.
- **Scope — "monitor only" vs "alert + remediate".** The brief is firm: monitor only. If product later asks for "auto-suspend a sub-account at 0.05% complaint rate" or "auto-pause sends until A2P registration completes", scope expands materially (those are remediation actions; they touch the action registry and HITL gates). My estimate assumes the spec holds.
- **Threshold calibration.** Industry-standard thresholds (Mailgun's 0.05% complaint cutoff, Twilio's typical balance buffers) are well-known but not consistent across agencies. v1 ships with sensible defaults; per-org override comes via existing `org_config` JSONB. No additional UI work in this estimate.
- **Anomaly detection level.** The brief asks: thresholds vs statistical vs ML. Estimate uses threshold + simple `metric_trend` (existing evaluator). That is the right level for v1; statistical and ML approaches are over-engineered for this use case until data shows otherwise.

### 6.4 Open questions for the architect

1. **Are agency-owned Mailgun and Twilio credentials accessible?** If the credentials live in GHL only, native adapters (Chunks C and D) are not buildable in v1. Confirm before committing to the full 3.75w estimate.
2. **Is the cheapest-version (1.75w, no new external adapters) acceptable as v1?** Sending-rate spikes from existing canonical_conversations data plus subscription tier already-pulled cover ~40% of the brief's signal list. The other 60% (Mailgun complaint rate, Twilio balance, A2P status) require new adapters or remain unobservable.
3. **Twilio: native adapter or MCP-only?** MCP path is cheaper (~0.5w of glue code) but less robust (depends on the Twilio MCP server's reliability). Native adapter is more code but more durable. Recommendation: **MCP-only for v1**, promote to native if usage proves it out.

### 6.5 Total estimate

**3.75 engineer-weeks. Confidence: medium.**

The medium rating reflects the open question about credential access. If agency-owned Mailgun/Twilio credentials are not available, drop to the cheapest version (1.75w) and accept partial coverage. Within either scope, the build itself is bounded and confidence is high — the risk is product-shape, not engineering.

---

## 7. Summary — totals, critical path, sequencing

### 7.1 Aggregate engineer-weeks

| Tier | Feature | Estimate | Confidence |
|---|---|---|---|
| 1 | 1.1 Portfolio Health Agent (production-grade) | 5.25w | medium |
| 1 | 1.2 White-Labeled ROI Dashboards with Baseline Capture | 8.0w | medium-low |
| 1 | 1.3 HITL Outreach Drafting on Churn Signals | 4.25w | high |
| **Tier 1 subtotal** | | **17.5w** | |
| 2 | 2.1 HITL-Gated Snapshot Rollback with Semantic Diff | 10.25w | low |
| 2 | 2.2 Compliance-Messaging Portfolio Monitor | 3.75w | medium |
| **Tier 2 subtotal** | | **14.0w** | |
| **Release total** | | **31.5w** | |

These totals are nominal — they assume single-engineer single-thread linear progress and exclude product decisions, design partner coordination, external account procurement, and the soft-launch blockers brief items (those are pre-build dependencies). With realistic scheduling friction (review cycles, design partner feedback wait times, parallel work where safe), expect calendar duration of **5–7 months for a single senior engineer** to ship the full release; **3–4 months for a small team of 2–3** assuming the parallelism is workable.

### 7.2 Critical path

The dependency chain that determines the minimum release timeline:

1. **Soft-launch blockers brief Item 2 — Agency-level OAuth.** Prerequisite for everything else. Verifying the agency OAuth flow against a real external GHL agency account is cheap in engineer-time but expensive in calendar time (procurement of a test account + iteration cycle with GHL). Estimated independently in the soft-launch blockers brief; not included in the 31.5w total because it predates this release.
2. **Soft-launch blockers brief Item 3 — Rate limiter (Option A or B).** Must land before any production agency onboarding regardless of which feature is in flight. Independent track.
3. **Feature 1.1 Chunk A — GHL data-feed wiring.** Gates Features 1.1, 1.2, and 1.3. Without live data feeding `client_pulse_signal_observations`, none of the Tier-1 features have data to operate on.
4. **Feature 1.1 Chunk E — Module B template provisioning fix (migration 0104).** Gates the ability for a new agency to be onboarded with a Portfolio Health Agent automatically. Pre-requisite for the self-serve onboarding flow but parallelisable with the rest of Feature 1.1.
5. **Feature 1.2 Chunks A–B — Baseline schema and capture.** Gates Feature 1.2 Chunks F (ROI delta computation) and I (monthly delta narration). Same scope as Item 1 of the soft-launch blockers brief — if that ships first, 2.25w drop from Feature 1.2 (final Feature 1.2 = 5.75w).
6. **Feature 2.1 Chunk A0 — GHL configuration-read API expansion.** Sole gate for the entire Feature 2.1 chain. **A targeted spike in week 1 of Feature 2.1 work is the recommended de-risking step** — outcomes of the spike could collapse Feature 2.1 to 7w or expand it to 12w+.

The minimum-time release path is dominated by Feature 2.1's 10.25w. Tier 1 alone (without Feature 2.1) ships in 17.5w nominal, ~13–14w real-time with sensible parallelism.

### 7.3 Estimates that diverge from the CEO brief v3 directional figures

The brief I'm estimating against gave one directional figure: **Feature 2.1 was estimated at 6–10 weeks**. My estimate is **10.25w**.

- **Feature 2.1 (Snapshot Rollback): 10.25w vs 6–10w directional.** My estimate sits at the upper bound of the brief's range, +0.25w over the high end. The driver is Chunk A0 (GHL configuration-read API expansion), which the directional figure appears to have assumed in place. This codebase's GHL adapter currently reads funnels and calendars only — workflow / pipeline / trigger / custom-field reads need to be added. If the spike confirms a path through those endpoints, my estimate aligns with the upper bound. If the spike reveals scope is needed beyond what's currently registered, my estimate becomes 11–13w.

The other four features had no directional figures. Two notable findings:

- **Feature 1.1 ships substantially less work than a "build the Portfolio Health Agent from scratch" framing suggests.** The agent skeleton, schema, fatigue guard, intervention proposer, and four signal evaluators are already in production. The 5.25w estimate is for hardening and calibration, not foundational construction. If the audience reads the feature title as "build it" they will overestimate; the right framing is "make it production-grade against a live design partner".
- **Feature 1.2 has the highest variance** (8w nominal, 6–12w realistic range) because three of the largest design questions — which external sources to integrate, white-label scope, public client portal — are open. A single product call locking those down reduces variance significantly.

### 7.4 Recommended sequencing for a single engineer optimising for earliest credible v1 release

The earliest credible ClientPulse v1 release is the smallest set that closes the agency demo loop: live portfolio scan, ROI delta visible, churn signal triggers a draftable outreach. That set is **Tier 1 only** (Features 1.1, 1.2, 1.3), and within Tier 1, the cheapest possible version of each.

**Recommended sequence (single engineer, optimising for shippable demo):**

| Week | Work | Notes |
|---|---|---|
| -1 to 0 | **Pre-build dependencies (parallel to other work).** Procure GHL agency test account; resolve agency-token vs location-token exchange; ship Items 1–3 of soft-launch blockers brief. | Per the brief, these are "approved-and-pending"; engineer time is small but calendar time is bounded by external coordination. |
| 1 | **Feature 1.1 Chunk E (template provisioning fix, 0.5w) + start Chunk A (GHL data feed, 1.5w).** | Foundation: every org gets a Portfolio Health Agent on subscription. Live data feed begins. |
| 2 | **Finish Chunk A. Start Chunks B, C in parallel** (signal calibration, missed-call signal). | Calibration with design partner happens in parallel — calendar time absorbs but engineer-weeks count is contained. |
| 3 | **Finish 1.1 Chunks B, C. Skip Chunk D (LLM evaluator) for v1; skip Chunk F (per-org threshold UI) — admin route only suffices for design partner.** Total Feature 1.1 effective: ~3.5w. | Cuts 1.75w from nominal Feature 1.1. Acceptable if LLM-reasoning and self-serve threshold editing are post-v1. |
| 4 | **Feature 1.2 Chunks A–B (baseline schema + automated capture, 1.25w).** Already specced in soft-launch blockers brief Item 1 — if that landed in pre-build, this is already done. | Skip Chunk J (external sources) for v1. Acceptable if v1 baseline covers GHL-derived metrics only. |
| 5 | **Feature 1.2 Chunks C, D, F (manual entry, metric definitions, ROI delta, 1.75w).** | ROI delta wired into existing portfolio report. Demo loop ROI section now real. |
| 6 | **Feature 1.2 Chunks G–I (white-label primitive + dashboard rendering + monthly job, 2.5w).** | Brand-as-the-agency promise delivered for email + in-app dashboard. Skip public client portal (Chunk H beyond agency-internal); skip PDF export. |
| 7 | **Feature 1.3 Chunks A, B, F (draft generation, preview, channel selection, 1.75w).** Drop Chunks C (regenerate loop), D (persona block), E (voice). | Demo loop closes: signal → draft → review queue → approved → CRM send. |
| 8 | **Buffer / hardening / design partner end-to-end test cycle.** | Calibration friction, partner feedback, fixing the things that break in the live demo. |

**v1 demo-loop release: ~8 calendar weeks for a single senior engineer**, working a stripped-down version of Tier 1 (ship 1.1 + 1.2 + 1.3 at ~70% of nominal scope each).

**Full Tier 1 release: ~17.5w nominal / ~14w with parallelism.**

**Tier 2 follow-on:**

- Feature 2.2 first (3.75w). Smaller, lower-risk, immediate value-add for compliance-conscious agencies.
- Feature 2.1 second (10.25w). Begin with the GHL configuration-read spike. After the spike, re-estimate the full feature. Snapshot rollback is the highest-risk, highest-cost, and highest-variance item in the release; it's also the highest-leverage differentiator. It earns its place but must be staged after the demo loop is operating cleanly with at least one design partner.

**Recommended team shape if scope expands:**

- One senior engineer can ship the full release in 5–7 calendar months.
- Two senior engineers can ship in 3.5–4.5 months — the natural split is one on Tier 1 + Feature 2.2 (the data and outreach lane), one on Feature 2.1 (the GHL configuration-state lane). Coordination overhead is low because the two lanes share little code surface.
- Three engineers compresses the calendar further but adds coordination cost; below the cost-benefit break-even unless calendar is the dominant constraint.

### 7.5 Recommended next actions

1. **Run the Feature 2.1 GHL configuration-read API spike (0.5w)** before committing to the full Feature 2.1 estimate. Outcome materially shifts both the estimate and the sequencing.
2. **Resolve the open product questions for Feature 1.2** (external source choice, white-label scope, public-vs-internal client portal). Each unanswered question contributes ±0.5–2w of estimate variance.
3. **Confirm soft-launch blockers brief items 1, 2, 3 ship before this release begins.** They are prerequisites for several chunks here. If they slip, this estimate's sequencing slips with them.
4. **Confirm whether agency-owned Mailgun and Twilio credentials are accessible** before scoping Feature 2.2. If not, Feature 2.2 ships at the cheapest version (1.75w) by default.


