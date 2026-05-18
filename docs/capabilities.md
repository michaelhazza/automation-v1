# Automation OS — Capabilities Registry

> **Last updated:** 2026-05-18 (Task Intake: rename Universal Brief capability to Task Intake, update route to `/api/task-intake`, add assignedAgentId / dueDate / priority fields; Memory Tiered Consolidation: four-tier lifecycle with Ebbinghaus decay, multi-signal promotion, operator-approved procedural tier, behaviour-flag gating, versioned configuration)
>
> This is the single source of truth for everything the platform can do.
> Update it in the same commit as any feature or skill change.

---

## How to use this document

| Audience | Start here |
|----------|-----------|
| **Marketing / Sales (positioning & objection handling)** | [Positioning & Competitive Differentiation](#positioning--competitive-differentiation) |
| **Marketing / Sales (platform pitch)** | [Product Capabilities](#product-capabilities) |
| **Marketing / Sales (agency pitch)** | [Agency Capabilities](#agency-capabilities) |
| **Support** | [Skills Reference](#skills-reference) and [Integrations Reference](#integrations-reference) |
| **Engineering** | `architecture.md` remains the technical reference; this doc covers *what*, not *how* |

---

## Editorial Rules

This document is written for external-ready, marketing- and sales-appropriate language. Every edit must follow these rules — the full version lives in `CLAUDE.md`:

1. **No specific LLM / AI provider or product names** in customer-facing sections (Core Value Proposition, Positioning & Competitive Differentiation, Product Capabilities, Agency Capabilities, Replaces / Consolidates). Use generic category language — *"LLM providers," "foundation model vendors," "hosted agent platforms," "shared team chat products," "scheduled-prompt tools," "agent SDKs."*
2. **Named providers are permitted only in the Integrations Reference and Skills Reference** — factual product documentation for support, not marketing.
3. **Marketing- and sales-ready terminology throughout customer-facing sections.** Write for end-users and agency owners, not engineers. Avoid internal service or library names.
4. **Vendor-neutral positioning even under objection.** Generic category language holds in written collateral regardless of which provider is named in the question.
5. **Model-agnostic is the north star.** Frame Synthetos as routing to the best model per task across every frontier and open-source LLM. Never imply a preferred provider in customer-facing copy.

#### Always-OK industry terms

These terms are vendor-neutral standards and pass editorial review without modification:

- Protocol / format: OAuth, HTTP, REST, GraphQL, SAML, SSO, OIDC, JWT, JSON, XML, CSV
- Tooling categories: webhook, container, browser automation
- Vendor-neutral product categories: SMTP, IMAP, calendar, CRM

#### Provider names allowed only in factual sections

Provider-specific names (Google, Microsoft, Stripe, HubSpot, Salesforce, Slack, etc.) appear ONLY in:

- `## Skills Reference` — when a skill explicitly integrates with that provider
- `## Integrations Reference` — when listing supported connectors

Anywhere else (capability descriptions, agency narrative, marketing prose) a provider name is an editorial violation. Use the vendor-neutral category instead.

#### Borderline cases requiring human judgement

When unsure whether a partner-name mention is factual or marketing, route to the editor:

- "Google Docs as a knowledge source", borderline; if Google Docs is the only supported source, factual; if it's one of many, replace with "document stores"
- "Slack as a notification channel", borderline; same rule

The default is vendor-neutral. Provider names are the exception, not the rule.

---

## Cluster list (closed — see `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.4.5` for mutation procedure)

1. Workflow Engine
2. Approvals
3. Identity & Auth
4. Reporting
5. Integrations
6. Agent Runtime
7. Admin & Ops
8. Billing
9. Memory & Knowledge
10. Audit & Governance

To add a cluster: follow `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.4.5` — extend this list, author an ADR under `docs/decisions/`, and update `docs/spec-authoring-checklist.md` Appendix in the same PR.

---

## Asset Register

| Capability ID / slug | Name | Description | Owner | Cluster | Lifecycle state | Launch source | Risk surface | Last review date | Carry notes | Decommission notes | Related docs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| multi-tenant-platform | Multi-Tenant Platform | Three-tier hierarchy (System / Organisation / Subaccount) that isolates data and configuration at every level so agencies never mix client data. | platform | Admin & Ops | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: RLS policies and tenant-scope assertions must hold for every new table or route; integration tests guard against cross-tenant leakage. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-multi-tenant-platform |
| authentication-access-control | Authentication & Access Control | Five roles, granular permission keys, principal-based data isolation, and a flexible permission-set system so every user sees exactly what they need and nothing more. | platform | Identity & Auth | Mature | unknown — historical | auth/permission services | 2026-05-14 | Ongoing maintenance: Role and permission-key catalogues evolve when new surfaces ship; permission tests run on every PR touching auth middleware. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-authentication-access-control |
| ai-agent-system | AI Agent System | Autonomous AI agents organised in a three-tier hierarchy (system > org > subaccount) with configurable models, skills, and execution policies. | ai-agent | Agent Runtime | Mature | unknown — historical | agent runtime | 2026-05-14 | Ongoing maintenance: Three-tier hierarchy invariants verified on every agent-config migration; model and skill catalogues kept in sync with vendor support. Review cadence: on-incident-only. Operational cost: high. | None planned | spec: not applicable — historical capability; architecture.md; owner-task: tasks/todo.md#owner-resolution-ai-agent-system |
| agent-workplace-identity | Agent Workplace Identity | Each agent gets a real workplace seat with their own email address, calendar, and org-chart row — attributable and revocable independently of any human. | ai-agent | Identity & Auth | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Identity-backend connectors require provider-side credentials refresh; suspension and revocation flows verified on each provider update. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-agent-workplace-identity |
| capability-aware-orchestrator | Capability-Aware Orchestrator | Automatic task routing that understands what the platform can do, what the agency has configured, and where the request belongs — without hand-maintained rules. | ai-agent | Agent Runtime | Growth | unknown — historical | agent runtime | 2026-05-14 | Ongoing maintenance: Capability catalogue stays in sync with the registry; routing accuracy reviewed quarterly with sample traces. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-capability-aware-orchestrator |
| platform-feature-request-pipeline | Platform Feature Request Pipeline | Every user request for something the platform does not support today becomes structured product signal automatically. | platform | Admin & Ops | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Intake schema versioned alongside the universal brief; backlog grooming keeps the pipeline triaged. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-platform-feature-request-pipeline |
| task-intake | Task Intake | A conversational intake surface that lets agency operators and clients describe what they want in natural language; the platform turns the request into structured, tracked work with optional agent assignment, due date, and priority. | ai-agent | Agent Runtime | Growth | new-task-modal-overhaul — PR #352 (2026-05-18) | server/routes/taskIntake.ts (`POST /api/task-intake`) | 2026-05-18 | Ongoing maintenance: Intake prompts iterated as new client request shapes appear; hardening regressions guarded by route-level tests. Review cadence: quarterly. Operational cost: medium. | None planned | spec: docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md; owner-task: tasks/todo.md#owner-resolution-task-intake |
| configuration-assistant | Configuration Assistant | AI-powered conversational configuration for agents, skills, schedules, and data sources via natural language. | ai-agent | Admin & Ops | Growth | unknown — historical | agent runtime | 2026-05-14 | Ongoing maintenance: Conversational flows updated as agent and skill configuration shape evolves; LLM model version pinned with eval harness. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-configuration-assistant |
| skill-system | Skill System | 100+ modular skills across 13 categories cascading from platform to agency to per-client workspace. | ai-agent | Agent Runtime | Mature | unknown — historical | agent runtime | 2026-05-14 | Ongoing maintenance: Cascading skill catalogue maintained per-tier; new skill submissions go through editorial review and integration tests. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; architecture.md; owner-task: tasks/todo.md#owner-resolution-skill-system |
| crm-query-planner | CRM Query Planner | Natural-language CRM reads that stay cheap and deterministic by default; deterministic-first with AI fallback for the long tail; read-only by construction. | ai-agent | Integrations | Growth | unknown — historical | server/routes | 2026-05-14 | Ongoing maintenance: Deterministic planners updated as CRM schemas evolve; LLM fallback path costed and capped per query. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-crm-query-planner |
| workflow-engine | Workflow Engine | Multi-step workflow automation with dependency graphs, parallel execution, branching logic, and human review gates. | platform | Workflow Engine | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Dependency-graph invariants and approval-gate semantics guarded by integration tests; new node types require schema migration review. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; architecture.md; owner-task: tasks/todo.md#owner-resolution-workflow-engine |
| human-in-the-loop | Human-in-the-Loop | Review queue and approval system ensuring humans stay in control of sensitive agent actions; 42+ review-gated actions with approve-with-edits. | platform | Approvals | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Review-gated action catalogue extends with each new sensitive surface; queue performance monitored under load. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; architecture.md; owner-task: tasks/todo.md#owner-resolution-human-in-the-loop |
| task-board-workspace | Task Board & Workspace | Kanban-style task management with agent assignment, deliverables, and workflow transitions; configurable columns per org/subaccount. | frontend | Agent Runtime | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Column and transition configuration migrates per-org; client-side filters tested against large boards. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-task-board-workspace |
| pulse-supervision-home | Pulse -- Supervision Home | Single-screen operational command centre with three-lane classifier (Client-facing / Major / Internal) replacing the legacy inbox, dashboard, and activity pages. | frontend | Approvals, Admin & Ops | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Three-lane classifier rules updated as new approval surfaces ship; live updates require sustained websocket reliability. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-pulse-supervision-home |
| agent-spending | Agent Spending | Framework for agents to move real money on a client's behalf with operator-defined limits, per-charge approval gates, and an immutable ledger. | platform | Billing, Approvals | Growth | unknown — historical | billing surfaces, approvals | 2026-05-14 | Ongoing maintenance: Approval gate catalogue and ledger schema versioned together; per-charge limits validated on every billing route. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-agent-spending |
| live-execution-log | Live Execution Log -- Per-Run Timeline | Every material agent decision streamed live and retained as a durable, replayable record for mid-run visibility and months-later forensics. | ai-agent | Agent Runtime, Audit & Governance | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Streaming retention policy reviewed against storage budget; durable index protects replay against schema drift. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-live-execution-log |
| memory-knowledge-system | Memory & Knowledge System | Multi-layered memory architecture enabling agents to learn, share context, and build institutional knowledge with provenance and drift detection. | ai-agent | Memory & Knowledge | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Layer schemas and provenance shape locked by tests; drift detection thresholds reviewed on each model upgrade. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; architecture.md; owner-task: tasks/todo.md#owner-resolution-memory-knowledge-system |
| trust-verification-layer | Trust & Verification Layer | Three-stage quality framework (skill verification, scorecards, operator correction) making agent output verifiable, correctable, and continuously improving. | ai-agent | Audit & Governance, Agent Runtime | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Scorecard rubric and verification policies updated with each new skill family; eval harness rerun on model upgrades. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-trust-verification-layer |
| workspace-health-diagnostics | Workspace Health & Diagnostics | Automated configuration auditing that detects drift, misconfigurations, and operational issues; 10 active detectors with severity levels. | platform | Admin & Ops | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Detector catalogue extended as new failure modes surface; severity thresholds tuned on each finding wave. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-workspace-health-diagnostics |
| sub-account-optimiser | Sub-account Optimiser | Daily per-subaccount scan surfacing findings across eight categories (agent over-budget, playbook escalation rate, slow skills, inactive workflows, and more). | platform | Admin & Ops | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Eight finding categories tuned as agency usage patterns shift; daily scan window reviewed for cost. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-sub-account-optimiser |
| sub-account-baseline | Sub-account Baseline | Quantitative starting numbers captured at sub-account onboarding (five core metrics) so progress is measurable from day one. | platform | Admin & Ops | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Five core metrics captured at onboarding; metric definitions migrate alongside reporting schema. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-sub-account-baseline |
| activity-analytics | Activity & Analytics | Unified operational view across all activity types with advanced filtering, real-time updates, LLM usage tracking, and CSV/JSON export. | platform | Reporting, Admin & Ops | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Activity feed contract and filter shape stable; export formats updated as new activity types ship. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-activity-analytics |
| client-portal | Client Portal | White-label client-facing interface scoped per subaccount enabling agencies to give clients self-service access to workflows and run history. | frontend | Admin & Ops | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: White-label theming and per-subaccount scope tested on every portal route change; SSO entry points covered by integration tests. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-client-portal |
| pages-content-builder | Pages & Content Builder | CMS-style page creation and publishing with analytics tracking and form submission handling; draft-to-published workflow with mandatory human approval. | frontend | Workflow Engine | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Draft-to-published lifecycle guarded by approval routes; form submission handlers validated against schema changes. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-pages-content-builder |
| integration-framework | Integration Framework | Pre-built connectors for the tools agencies already use; connect once, use across every agent and workflow; OAuth providers, MCP, webhooks, data connectors. | platform | Integrations | Mature | unknown — historical | webhook handlers | 2026-05-14 | Ongoing maintenance: OAuth, webhook, and MCP connector catalogues kept current with provider API changes; credential rotation flow tested per connector. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-integration-framework |
| document-bundles-cached-context | Document Bundles & Cached Context | Reusable document libraries assembled once and served instantly at every execution; per-run snapshot isolation and budget-aware assembly. | ai-agent | Memory & Knowledge | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Snapshot isolation and budget-aware assembly tested on every bundle schema change; cache lifecycle monitored. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-document-bundles-cached-context |
| execution-infrastructure | Execution Infrastructure | Production-grade reliability with exactly-once execution, 24+ background job types across 10 priority tiers, automatic retry, and real-time streaming. | platform | Agent Runtime | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Exactly-once semantics and priority-tier behaviour verified on every job-type addition; retry budgets tuned per failure profile. Review cadence: on-incident-only. Operational cost: high. | None planned | spec: not applicable — historical capability; architecture.md; owner-task: tasks/todo.md#owner-resolution-execution-infrastructure |
| personal-assistant | Personal Assistant | A dedicated AI assistant for individual users monitoring calendar and inbox, handling scheduling, drafting Slack messages for review, and providing daily briefings. | ai-agent | Agent Runtime | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Calendar and inbox connectors track provider API revisions; daily briefing prompt iterated with eval harness. Review cadence: quarterly. Operational cost: high. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-personal-assistant |
| sandboxed-runtime-iee | Sandboxed Runtime (IEE) | On-demand isolated environment for agents doing real work on systems without APIs (browser automation, dev mode, vision-based browser grounding); nothing persists between runs. | ai-agent | Agent Runtime | Growth | unknown — historical | None. | 2026-05-19 | Ongoing maintenance: Sandbox isolation invariants reverified on each runtime upgrade; ephemeral-storage budget monitored. Vision-grounding decision loop in V1 preview pending e2b SDK harness wiring (spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md). Review cadence: quarterly. Operational cost: high. | None planned | spec: not applicable — historical capability; vision-grounding preview spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md; owner-task: tasks/todo.md#owner-resolution-sandboxed-runtime-iee |
| persistent-agent-workspace | Persistent Agent Workspace | Every agent has a named, persistent workspace showing current state, recent observations, knowledge sources, files produced, and working time between runs. | ai-agent | Agent Runtime | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Workspace state schema versioned with agent runtime; observation retention reviewed against storage budget. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-persistent-agent-workspace |
| subscription-driven-long-task-execution | Subscription-Driven Long-Task Execution | Subscription-mediated session management for multi-hour or multi-day tasks; automatic chain-resume, persistent browser context, and graceful fallback to direct billing. | ai-agent | Agent Runtime | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Session-resume and persistent-browser-context flows tested across provider quota changes; fallback-to-direct-billing path validated. Review cadence: quarterly. Operational cost: high. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-subscription-driven-long-task-execution |
| performance-reporting-analytics | Performance Reporting & Analytics | Clients receive data-driven performance reports automatically generated on schedule; covers social, ads, CRM pipeline, and financial metrics. | growth | Reporting | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Report templates updated as new metric sources land; scheduled delivery monitored for failure. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-performance-reporting-analytics |
| seo-management | SEO Management | Clients receive prioritised SEO audits with specific actionable fixes on a recurring schedule; integrated with content creation for SEO-optimised output. | growth | Reporting | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Audit rule catalogue tracked against search engine guidance; integration with content creation kept in sync. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-seo-management |
| geo-ai-search-visibility | GEO -- AI Search Visibility | Composite GEO Score (0-100) with per-dimension breakdown and 30-day improvement roadmap for AI search visibility across six dimensions. | growth | Reporting | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Six-dimension scoring rubric reviewed as AI search behaviours shift; improvement roadmap templates updated quarterly. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-geo-ai-search-visibility |
| content-creation-publishing | Content Creation & Publishing | Publish-ready content across formats and channels from a single brief; all publishing actions gated by human approval. | growth | Workflow Engine, Approvals | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Channel-specific formatters tracked against platform API changes; approval gates on every publish action. Review cadence: on-incident-only. Operational cost: high. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-content-creation-publishing |
| crm-contact-management | CRM & Contact Management | Clean, enriched CRM data maintained on an ongoing basis with contact enrichment, pipeline analysis, and human-gated write-back. | growth | Integrations, Approvals | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Enrichment providers kept in rotation; write-back approval flows validated on schema migrations. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-crm-contact-management |
| email-marketing-outreach | Email Marketing & Outreach | Intelligent email operations responding to signals in real time; classified inbox, drafted follow-ups, multi-step sequences, all sent with human approval. | growth | Integrations, Workflow Engine | Mature | unknown — historical | external messaging | 2026-05-14 | Ongoing maintenance: Inbox classifier prompts updated with eval harness; deliverability and sender reputation monitored. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-email-marketing-outreach |
| campaign-management-optimization | Campaign Management & Optimization | Campaign spend optimised continuously by data; every budget and bid change requires human sign-off before execution. | growth | Workflow Engine, Approvals | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Optimization policies tuned per channel; approval gates required on every budget or bid change. Review cadence: on-incident-only. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-campaign-management-optimization |
| financial-analysis-reporting | Financial Analysis & Reporting | Structured financial summaries on demand; revenue/expense data from accounting systems with approval-gated write-back. | growth | Reporting, Approvals | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Accounting connectors tracked against provider schema; approval gates on every write-back path. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-financial-analysis-reporting |
| churn-detection-account-health | Churn Detection & Account Health | At-risk accounts identified and flagged before they churn via composite health scoring, anomaly detection, and intervention pipeline. | growth | Reporting, Agent Runtime | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Composite score weights tuned per cohort; anomaly thresholds reviewed against false-positive rate. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-churn-detection-account-health |
| customer-support-automation | Customer Support Automation | Faster support responses with consistent quality drawn from a shared knowledge base; per-inbox agent modes with eval harness and drift detection. | ai-agent | Agent Runtime, Integrations | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Eval harness rerun on each model upgrade; per-inbox prompts iterated as drift detection flags variance. Review cadence: quarterly. Operational cost: high. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-customer-support-automation |
| landing-page-management | Landing Page Management | Agents build and manage landing pages end-to-end; full lifecycle create/update/publish with irreversible publishing always requiring human approval. | growth | Workflow Engine, Approvals | Mature | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Page lifecycle and approval flows tested with each schema migration; publish action remains irreversible. Review cadence: on-incident-only. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-landing-page-management |
| competitor-intelligence | Competitor Intelligence | Structured competitor intelligence on a repeatable schedule; automated page monitoring, structured field extraction, tiered scraping engine. | growth | Reporting | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Scraper tier catalogue maintained against target site changes; structured field extractors iterated with sample monitoring. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-competitor-intelligence |
| portfolio-intelligence | Portfolio Intelligence | Cross-client portfolio intelligence briefing with per-client health scores, priority actions, and cross-client pattern insights. | growth | Reporting | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Per-client health scoring tracks the underlying capability metric shapes; cross-client pattern aggregation reviewed for drift. Review cadence: quarterly. Operational cost: medium. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-portfolio-intelligence |
| llm-spend-observability | LLM Spend Observability & Per-Client P&L | Cross-client financial dashboard with per-call attribution, platform overhead surfacing, per-org/subaccount/model breakdowns, and top-cost call triage. | platform | Billing, Reporting | Growth | unknown — historical | billing surfaces | 2026-05-14 | Ongoing maintenance: Attribution mapping kept current with new pricing and model tiers; dashboard breakdowns aligned with billing schema. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-llm-spend-observability |
| memory-injection-utility | Memory Injection Utility | Operators see what percentage of injected memory context is actually cited by agents; 30-day trend charts and per-agent breakdown sorted by entry utility. | ai-agent | Memory & Knowledge | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Citation tracking aligned with memory schema; trend windows reviewed for analytical relevance. Review cadence: quarterly. Operational cost: low. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-memory-injection-utility |
| tier-4-isolated-code-execution | Tier 4 Isolated Code Execution | Agents safely process customer-provided data files and LLM-generated scripts in an ephemeral, per-task isolated compute environment with default-deny network posture. | ai-agent | Agent Runtime | Growth | unknown — historical | None. | 2026-05-14 | Ongoing maintenance: Default-deny network posture and per-task isolation verified on each runtime upgrade; allowed-package catalogue audited. Review cadence: quarterly. Operational cost: high. | None planned | spec: not applicable — historical capability; owner-task: tasks/todo.md#owner-resolution-tier-4-isolated-code-execution |
| dev-lifecycle-governance | Development Lifecycle Governance | A structured build lifecycle that turns every change brief into a duplication-checked specification, a sized work plan, and a single capability ledger entry, preventing duplicate work and silent specification drift across engineering. | platform | Audit & Governance | Growth | development-lifecycle-governance-upgrade — PR #304 (2026-05-14) | doc-only governance; coordinator instructions | 2026-05-14 | Acquire S (10-cluster seed list, 12-column Asset Register schema); Build M (8 markdown files, 7 chunks); Carry S (markdown only, no runtime); Decommission n/a | None planned | spec: tasks/builds/development-lifecycle-governance-upgrade/spec.md; agents: .claude/agents/spec-coordinator.md, .claude/agents/finalisation-coordinator.md; owner-task: tasks/todo.md#owner-resolution-dev-lifecycle-governance |
| browser-hardening-primitives | Browser Hardening Primitives | Platform safeguards that keep automated browser sessions realistic and proxy-aware: a regression harness that watches detection scores against reference sites, locale and timezone alignment to the proxy egress point, and input timing humanisation within deterministic bounds. | ai-agent | Agent Runtime | Inception | browser-hardening-primitives — PR #349 (2026-05-18) | sandbox launch path; proxy credential injection; CI baseline-weakening gate | 2026-05-18 | Acquire S (5 reference sites + 2 small migrations); Build M (11 chunks across 3 phases); Carry S (cached-fixture CI only in V1, live-e2b nightly lands with BHP-2); Decommission n/a | None planned | spec: tasks/builds/browser-hardening-primitives/spec.md; PR #349; owner-task: tasks/todo.md#owner-resolution-browser-hardening-primitives |
| closed-loop-skill-improvement | Closed-Loop Skill Improvement | When an agent run is judged as a failure by a quality scorecard, the platform automatically performs a root-cause analysis, proposes a targeted skill instruction amendment, and routes it through peer review before placing it in the operator review queue. Accepted amendments enter regression replay to detect regressions, automatically retire when stale, and accumulate effectiveness metrics over time. Operators can freeze the amendment pipeline at the workspace or skill level and review the composition of each run through an inline trace panel. | ai-agent | Agent Runtime, Audit & Governance, Approvals | Inception | closed-loop-skill-improvement — PR #353 (2026-05-18) | server/db/schema, server/routes, agent runtime, approvals | 2026-05-18 | Acquire L (8 new tables, 5 jobs, 10 routes, 4 client surfaces); Build L (9 chunks, full pipeline end-to-end); Carry M (daily effectiveness + stale-retire jobs; regression replay per accept); Decommission M (8 tables, 5 jobs, 15 schema gaps tracked in tasks/todo.md) | Note: 15 directional schema gaps (§7 Data Model) accepted post-merge; corrective migration or spec amendment tracked in tasks/todo.md. Surface B (cross-subaccount org-admin roll-up) deferred to Phase 2 per spec §22. | spec: docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md; PR #353; owner-task: tasks/todo.md#owner-resolution-closed-loop-skill-improvement |

---

## Table of Contents

- [Core Value Proposition](#core-value-proposition)
- [Positioning & Competitive Differentiation](#positioning--competitive-differentiation)
- [Product Capabilities](#product-capabilities)
  - [Multi-Tenant Platform](#multi-tenant-platform)
  - [Authentication & Access Control](#authentication--access-control)
  - [AI Agent System](#ai-agent-system)
  - [Agent Workplace Identity](#agent-workplace-identity)
  - [Capability-Aware Orchestrator](#capability-aware-orchestrator)
  - [Platform Feature Request Pipeline](#platform-feature-request-pipeline)
  - [Configuration Assistant](#configuration-assistant)
  - [Skill System](#skill-system)
  - [CRM Query Planner](#crm-query-planner)
  - [Workflow Engine](#workflow-engine)
  - [Human-in-the-Loop](#human-in-the-loop)
  - [Task Board & Workspace](#task-board--workspace)
  - [Pulse — Supervision Home](#pulse--supervision-home)
  - [Agent Spending](#agent-spending)
  - [Live Execution Log — Per-Run Timeline](#live-execution-log--per-run-timeline)
  - [Memory & Knowledge System](#memory--knowledge-system)
  - [Workspace Health & Diagnostics](#workspace-health--diagnostics)
  - [Activity & Analytics](#activity--analytics)
  - [Client Portal](#client-portal)
  - [Pages & Content Builder](#pages--content-builder)
  - [Integration Framework](#integration-framework)
  - [Execution Infrastructure](#execution-infrastructure)
  - [Personal Assistant](#personal-assistant)
  - [Sandboxed Runtime (IEE)](#sandboxed-runtime-iee)
  - [Persistent Agent Workspace](#persistent-agent-workspace)
  - [Subscription-Driven Long-Task Execution](#subscription-driven-long-task-execution)
- [Replaces / Consolidates](#replaces--consolidates)
- [Agency Capabilities](#agency-capabilities)
  - [Performance Reporting & Analytics](#performance-reporting--analytics)
  - [SEO Management](#seo-management)
  - [GEO — AI Search Visibility](#geo--ai-search-visibility)
  - [Content Creation & Publishing](#content-creation--publishing)
  - [CRM & Contact Management](#crm--contact-management)
  - [Email Marketing & Outreach](#email-marketing--outreach)
  - [Campaign Management & Optimization](#campaign-management--optimization)
  - [Financial Analysis & Reporting](#financial-analysis--reporting)
  - [Churn Detection & Account Health](#churn-detection--account-health)
  - [Customer Support Automation](#customer-support-automation)
  - [Landing Page Management](#landing-page-management)
  - [Competitor Intelligence](#competitor-intelligence)
  - [Portfolio Intelligence](#portfolio-intelligence)
- [Skills Reference](#skills-reference)
- [Integrations Reference](#integrations-reference)
- [Changelog](#changelog)

---

## Core Value Proposition

**Synthetos is the governed operating system for AI-run business operations.**

Businesses use Synthetos to:

- **Deploy AI agents as a structured workforce** — not chat toys, but role-based agents with defined skills, budgets, and accountability
- **Run agents on production systems without losing control** — workflows, approval gates, side-effect classification, and review queues keep humans in command of every sensitive action
- **Operate across multiple business units, brands, regions, or client books with strict isolation** — multi-tenant from the ground up, so subsidiaries, departments, franchises, or agency-served clients never bleed into each other
- **Build institutional knowledge that compounds** — every agent run feeds memory, briefings, and cross-agent learning back into the system
- **Stay independent of any one agent runtime or model provider** — execution runtimes and foundation models are interchangeable supply underneath the operations layer

---

## Positioning & Competitive Differentiation

> **Read this before writing any marketing or sales content.** LLM providers, horizontal agent platforms, and agent-runtime ecosystems are increasingly shipping overlapping primitives — agents, skills, scheduled runs, memory, team chat, hosted execution sandboxes. The Synthetos pitch is **not** about having those. It is about what sits on top of them.
>
> **Editorial reminder:** never name a specific LLM, AI provider, or agent-runtime project (or their products) in this section. Use generic category language — *"LLM providers," "foundation model vendors," "hosted agent platforms," "shared team chat products," "scheduled-prompt tools," "agent SDKs," "agent runtimes," "execution sandboxes," "browser-automation runtimes," "agent-protocol systems."* See the Editorial Rules at the top of this document and `CLAUDE.md` for the full rule set.

### The frame

LLM providers, agent-runtime projects, and hosted agent platforms sell **primitives**: a model, an SDK, a scheduled run, a hosted agent, an execution sandbox, a skills format, a team chat surface. They are capability and runtime providers.

**Synthetos sells the governed operating system businesses use to run AI operations on top of those primitives.** That distinction is the whole commercial argument. If the pitch drifts toward "we have agents and skills and a sandbox," the pitch loses — those are commoditising faster than anyone expected, and the runtime layer is consolidating around a small number of open ecosystems. Keep the pitch on the operations layer: multi-tenant isolation, approval workflows, audit and lineage, operational cost governance, runtime pluralism, vertical depth.

### The one-sentence answer

> LLM providers give you a model. Agent SDKs and agent-runtime projects give you the parts. Hosted agent platforms give you a single agent at a time. Scheduled-prompt tools run one prompt on a cadence. Execution sandboxes give you a place to run code. **Synthetos is the governed operating system businesses run AI operations on top of all of that** — with multi-tenant isolation, approval workflows, audit lineage, operational cost attribution, runtime pluralism, and vertical depth.

### Messaging north star

> **"LLM providers sell capability. Agent runtimes sell execution. Synthetos sells operational control."**

Every feature brief, positioning slide, and marketing asset should pass this test: does it reinforce that Synthetos is the system of record for AI-run business operations, with LLM providers and agent runtimes as interchangeable supply underneath? If the asset only describes agents, skills, sandboxes, or automation in the abstract, it is indistinguishable from a capability or runtime provider — rewrite it.

### Structural differentiators

These are the moats LLM providers, agent-runtime projects, and horizontal agent platforms structurally cannot ship, because their buyer is an individual or an internal engineering team — not an operations function running production systems across multiple business units, brands, regions, or client books.

| Differentiator | Why it's structural |
|---|---|
| **Runtime pluralism** | Synthetos abstracts execution behind a runtime-agnostic interface. Agent runtimes, execution sandboxes, browser-automation runtimes, code-execution sandboxes, MCP tool servers, and agent-protocol systems are interchangeable supply underneath the operations layer. Businesses are not locked to any one runtime ecosystem; when the runtime landscape consolidates, Synthetos absorbs the shift rather than re-platforming. The competing pitch of "we are the easiest way to run [runtime X]" structurally cannot make this claim — the operations layer is identical regardless of which runtime is in use today. |
| **Multi-tenant three-tier isolation** (System → Org → Subaccount) | LLM-provider and runtime-vendor platforms assume a single buyer. Synthetos is built for businesses running multiple subsidiaries, business units, brands, regions, franchise networks, or agency-served client books, with strict data, memory, skill, and cost isolation enforced at every layer. |
| **Human-in-the-loop as a system** | 42+ review-gated actions, approve-with-edits, side-effect classification (irreversible steps never auto-retry), rejection as training signal, per-action gate overrides. No business can deploy unsupervised agents on production systems, CRM, finance, or customer records. The review system **is** the product. |
| **Workflow engine with multi-step approval gates** | Scheduled-prompt tools run one prompt on a cadence. Hosted agent platforms are single-agent. Synthetos runs multi-step workflows with parallel execution, templating between steps, cost simulation, versioning, and save-as-PR authoring. |
| **Stakeholder and client-facing surfaces** | Capability and runtime providers will not build this — their buyer is the producer of agent work, not the consumer of it. Synthetos ships portals, scheduled-work calendars, and published-output surfaces that business units expose to their executives, customers, or end-clients. A permanent wedge for any operation that needs to show what the agents are doing to people outside the engineering team. |
| **Operational cost governance** | LLM usage ledger with full org → subaccount → run → skill cost attribution, org-level margin configuration, pre-reserved budgets, and cost circuit breakers. Per-business-unit P&L (revenue, internal recharge, per-client pricing, per-client margin) is on the roadmap as a first-class surface. LLM providers sell tokens; runtime vendors sell compute; neither cares how a business apportions cost across its own operations. |
| **Integration framework with managed connectors** | Generic integration protocols are just protocols. Synthetos is a managed integration product with pre-built OAuth flows for the tools businesses already use (CRM, ads, accounting, communication, support desks) — plus connection scoping (org-shared vs subaccount-specific), sync lifecycle (backfill → transition → live), credential rotation, and webhook verification. |
| **Execution infrastructure maturity** | Every agent action is guaranteed to run exactly once — even on retries, network hiccups, or rapid clicks. Real-time execution streaming delivers instant feedback as agents work, not delayed polling. Pre-reserved budgets with hard cost ceilings, automatic failure recovery, crash-resume, and proactive configuration health monitoring. Table stakes for production agent fleets — absent from every "quickstart" agent platform and runtime sandbox. |
| **Vertical depth** | GEO (AI search visibility), Churn Detection with composite health scoring, Portfolio Intelligence across business units, Campaign bid adjustments, financial transcript analysis. LLM providers and runtime vendors ship primitives; Synthetos ships solutions. Verticals compound into pricing power. |
| **Model-agnostic and runtime-agnostic routing** | Per-skill routing across every frontier and open-source LLM. Per-task routing across execution runtimes. Building on any one provider's managed stack or any one runtime ecosystem locks the business to that vendor's pricing, roadmap, and obsolescence risk. Synthetos routes to the best model and runtime per task and insulates the business from any single vendor's shifts. |
| **Portfolio-wide scheduled-work visibility** | A single calendar surface shows every scheduled agent run, recurring workflow, and scheduled task across every business unit or client for the next 7–30 days — roll up org-wide, drill down per unit, and expose a "here's what we're doing for you next week" card inside any stakeholder portal. Hosted-routine and scheduled-prompt products show a calendar for *one user's* automations; Synthetos shows an organisation's entire book of scheduled work on one screen. |
| **Supervised migration from no-code workflow tools** | One-shot converter that ingests a no-code workflow export (node graph JSON) and produces a draft supervised workflow with approval gates, side-effect classification, cost simulation, and retry policies mapped from the source nodes. Not a transliteration — an *upgrade* from stateless trigger/action chains to a supervised, multi-tenant operations layer. Businesses migrate their existing workflow library in hours, not weeks, and inherit approval gates for free. |
| **Audit and lineage as a system** | Every routing decision, agent action, approval, rejection, cost line, and side effect emits a structured record with idempotent writes. The audit log is the compliance product: who approved what, what ran, what changed, what cost money, what can be rolled back. Operations functions cannot deploy agents into regulated or revenue-bearing workflows without this; LLM providers and runtime vendors do not build it. |

### Objection handling — "Why Synthetos when I can just use my LLM provider's or agent runtime's tools?"

| Objection | Response |
|---|---|
| *"We'll just use a productivity-suite copilot or hosted assistant."* | Productivity copilots and hosted assistants are built for individual user productivity inside one tenant's perimeter. The moment you're running agents on production systems across multiple business units, brands, or client books, you need multi-tenant isolation, approval gates on CRM, finance, and customer-record writes, audit lineage, operational cost attribution, and runtime independence. Different product category. |
| *"Our IT team will roll out the LLM provider's hosted agent product internally."* | That is a reasonable choice for individual productivity. It is not an operations system. The moment any agent action touches a production system, you need approval gates, side-effect classification, audit lineage, rollback, and cost governance the hosted product structurally does not ship — their buyer is the individual employee, not the operations function. Synthetos uses provider primitives as supply and adds the operations layer on top, model-agnostic and runtime-agnostic across every vendor. |
| *"I'll manage clients or business units in a shared team chat product."* | Shared team chat is built for internal teams sharing context — clients or business units would see each other's data. Synthetos enforces strict isolation at every layer so per-tenant data, memory, and configuration never cross. |
| *"I'll use a scheduled-prompt tool for scheduling."* | Scheduled-prompt tools run one prompt on a cadence. Synthetos runs multi-step workflows with human approvals, cost ceilings, retry policies, exactly-once execution guarantees, parallel step execution, **and a portfolio-wide calendar that shows an organisation's entire book of scheduled work on one screen**. Different product category — and one of them is demoable inside a stakeholder or client portal. |
| *"Hosted agents are autonomous — perfect."* | Which is exactly why no business can put them on production CRM, finance, or customer-data systems. 42+ review gates, approve-with-edits, and side-effect classification are not optional for regulated or revenue-bearing work — they **are** the trust product the operations function needs. |
| *"We'll build on an agent SDK or agent-runtime project directly."* | Great — Synthetos uses LLM-provider and agent-runtime primitives under the hood. But the business still needs multi-tenant isolation, approvals, stakeholder portals, workflows, managed integrations, cost governance, health monitoring, audit lineage, and a supervision home. That is 18+ months of engineering not spent on the business. |
| *"What if our agent-runtime ecosystem grows upward into governance and orchestration?"* | Runtime ecosystems consolidate around execution, not operations. Even if one shipped multi-tenant governance, vertical skills, managed integrations, stakeholder surfaces, operational cost attribution, and model-agnostic routing remain. The moat is not any one feature; it is the operations system, and the operations system is deliberately decoupled from any single runtime. |
| *"What if an LLM provider ships multi-tenant?"* | They will not — their buyer is not operations functions. Even if one did, vertical skills, managed integrations, stakeholder portals, runtime pluralism, and model-agnostic routing remain. The moat is not any one feature; it is the operations system. |
| *"What if a better model ships?"* | Synthetos routes to it per skill. No migration. Build on a single provider's managed stack and that question becomes a year-long project. |
| *"What if a better agent runtime ships?"* | Synthetos adds it as another execution provider behind the same operations interface. Nothing above the runtime layer changes. Build on a single runtime ecosystem directly and the same question becomes a re-platforming project. |
| *"We already use a commodity workflow automation tool."* | Those are stateless trigger-action chains. Synthetos is stateful, agent-driven, and designed around human approval gates for high-stakes actions (publishing, CRM writes, finance changes, customer-record updates). |
| *"We're an agency, this all sounds like enterprise-speak."* | Agencies are a first-class ICP. Every structural differentiator applies directly: per-client isolation, white-label portals, per-client margin tracking, supervised migration from existing no-code workflows. The product is the same; the buyer language changes. |

### What Synthetos is NOT trying to be

These are **explicit non-goals**. Competing on them is a losing fight against vendors with more capital and a different buyer.

- **Not a better agent SDK.** LLM providers and agent-runtime projects build the models, the SDKs, and the execution sandboxes; consuming them under the hood is cheaper than competing with them.
- **Not a better agent runtime or execution sandbox.** Agent-runtime ecosystems are consolidating around a small number of open projects with serious capital behind them. Synthetos integrates with the leading runtimes as interchangeable supply; it never competes with them as a runtime.
- **Not a better general-purpose chat UI.** LLM-provider chat surfaces are excellent at what they do. The Synthetos chat surface exists for agent supervision and task context — not as a general-purpose LLM interface.
- **Not a standalone IDE or developer platform.** The sandboxed dev mode inside IEE exists for organisation-level extensibility (custom apps or scripts that support bespoke processes) — not as a competitor to general-purpose coding assistants.
- **Not a commodity workflow automation tool.** Commodity workflow tools compete on "connect X to Y." Synthetos competes on "run agents responsibly across multi-tenant business operations with approval workflows."

### How to apply this in GTM content

- **Lead with the operations system, not the agents.** The phrase "Synthetos is an agent platform" is a downgrade. "Synthetos is the governed operating system businesses run AI operations on" is the right frame.
- **Show the operations surface early.** Screenshots of the approval queue, portfolio-wide scheduled-work calendar, audit log, per-unit cost attribution, and stakeholder portal convert better than agent-chat screenshots — they look like a product competitors can't match.
- **Lead with "business operations" in headlines; treat agencies as a first-class ICP under that umbrella.** Horizontal positioning invites horizontal comparisons. "For operations leaders running AI agents on production systems" pre-filters for buyer persona and pre-loads the isolation / approval / audit story. Agency-specific landing pages add the per-client and white-label framing without changing the underlying product narrative.
- **Position LLM providers and agent runtimes as supply, not threats.** *"Model-agnostic and runtime-agnostic — we route to the best model and runtime per task."* This inoculates against "why not just use [provider or runtime]?" before it's asked, without naming any individual vendor.
- **Avoid autonomous-agent language.** "Autonomous" is the wrong promise for any business with production systems on the line. Prefer "supervised," "approved," "reviewed," "accountable," "governed."
- **Demo the portfolio calendar on discovery calls.** The single most converting moment is showing a prospect their organisation's hypothetical book of scheduled work on one screen — "here's every scheduled piece of work across all of your business units or clients for next week" — and then drilling into the stakeholder-side view. Hosted-routine and runtime-vendor products cannot build this surface; it is structurally the operations-system pitch.
- **Lead the "why not hosted routines or runtimes" conversation with the operations layer, not the features.** When a prospect says "we already use a hosted routine product from an LLM provider" or "we already run the leading agent runtime in-house," the response is not "our routine-equivalent or our runtime is better." It is: *"Those run agents. They do not govern them. The moment your agents touch production systems across multiple business units, you need isolation, approvals, audit lineage, cost governance, and runtime independence — that is a different product category, and it is what we sell."*

---

## Product Capabilities

### Multi-Tenant Platform

Three-tier hierarchy that isolates data and configuration at every level — so agencies never mix client data, and clients never see each other.

- **System tier** — Platform-wide defaults, system-managed agents, global skill library, workflow templates
- **Organisation tier** — Agency-level workspace with its own users, agents, skills, memory, branding, and billing
- **Subaccount tier** — Per-client workspace with its own agent links, task board, review queue, data sources, and memory
- Strict data isolation enforced at every layer with full audit history preserved
- Client tags for portfolio segmentation and cohort analysis; guided onboarding wizard for new agencies

### Authentication & Access Control

Five roles, granular permission keys, principal-based data isolation, and a flexible permission-set system — so every user sees exactly what they need and nothing more.

- **Five roles** from platform administrator to client viewer — each sees exactly the right level of access
- Custom permission sets assignable to any role; access enforced across the entire platform
- **Principal-based data access** — three principal types (user, service, delegated) control what agents and users can see. Personal connections and private data are invisible to service processes and other users unless explicitly shared
- **Delegation grants** — temporary, scoped access for agents acting on behalf of a user, with automatic expiry and revocation
- **Visibility scoping** — data classified as private, shared-team, shared-subaccount, or shared-org; enforced at the database layer so no application bug can leak across boundaries
- Secure authentication with rate-limited login, email invitations, and self-service password reset
- Permissions-driven interface — buttons, tabs, and pages automatically hidden when a user lacks access

### AI Agent System

Autonomous AI agents organised in a three-tier hierarchy (system > org > subaccount) with configurable models, skills, and execution policies.

- **Three-tier model:** Platform agents cascade to agency agents and per-client agents — each level can override scheduling, skills, and budgets without duplicating the agent
- **Hierarchical roles:** CEO, Orchestrator, Specialist, Worker — agents can hand off work up to 5 levels deep
- **Guaranteed per-client leadership:** Every sub-account has exactly one active lead agent at all times — the one the Orchestrator routes briefs to by default. Lead rotations happen atomically (old lead and new lead swap in the same transaction); no "no one's in charge" gap, no duplicate leads. If a sub-account ever loses its lead (e.g. during manual reconfiguration), briefs fall back to the agency-level Orchestrator with a clear "degraded" signal rather than failing outright, and a health finding fires
- **Scoped delegation across the team:** Agents can only delegate to the subset of the team they have authority over — direct reports, their full subtree, or the whole sub-account — enforced at execution time, not by convention. An agent can never accidentally pull in a peer or a sibling's team
- **Visible delegation graph per run:** Every multi-agent workflow is recoverable as a visual graph showing which agent spawned or handed off to which, up to 5 levels deep. Status, direction (down / up / lateral), and scope render inline so operators can see exactly how a decision propagated
- **Starter team templates:** Pre-configured hierarchies ("Marketing Agency", "Sales Operations", etc.) apply to a new sub-account in one step — lead agent + full team land together in an atomic swap. Templates are managed at the agency level, reusable across every client
- **Observable delegation decisions:** Every delegation attempt — who to whom, under what scope, accepted or rejected, and why — is recorded on a structured ledger with idempotent writes. Retries and duplicate attempts collapse automatically; the ledger is audit-ready and driftless across any time window
- **Real-time chat** — Conversational interface with tool result cards, typing indicators, and session history
- **Flexible scheduling:** Recurring intervals (minute-level precision), cron expressions with timezone, or event triggers (task created, task moved, agent completed)
- **Execution control:** Per-run token budgets, cost ceilings, tool call limits, concurrency policies, and catch-up policies
- **Per-run cost transparency:** Every run-detail surface (history card, trace viewer, agent admin page) shows the exact LLM spend for that run — total cost, call count, input/output token totals, and an app-vs-worker call-site breakdown. Operators see the bill, not just the ceiling
- **Knowledge sources:** Per-agent data files from cloud storage, HTTP, document stores, or direct uploads — with token budgets and caching
- Agent templates for rapid team deployment; full run history with execution traces; exactly-once deduplication on all run paths
- **Portfolio-wide scheduled-work calendar** — A single surface showing every scheduled agent run, recurring workflow, and scheduled task across the org or a single client for the next 7–30 days, with roll-ups by subaccount, source, and estimated cost. Exposed in the client portal as an "Upcoming work" card so clients see what the agency is doing for them next week.
- **Inline Run Now testing on the authoring page** — Agent and skill edits are tested in a collapsible side panel with real-time streamed run output, tool-call timeline, and token/cost metering — no page switch, no save-and-navigate. Test runs are flagged and excluded from agency P&L and LLM usage aggregates by default. Re-usable test-input fixture library per agent and skill. Rapid clicks and retries are automatically deduplicated; per-user rate limits prevent runaway test costs.
- **Per-conversation cost meter** — A live token and cost pill in the chat thread shows cumulative spend for the current conversation as it builds up — giving operators a running total without leaving the conversation or opening a separate analytics view.
- **Suggested next actions** — After each agent response, contextually relevant follow-up actions appear as one-tap chips below the message. Chips are generated by the agent based on its active skills and the current task state — selecting one dispatches the action immediately.
- **Thread context panel** — Operators can anchor the conversation with a task description, preferred approach, and key decisions using a persistent right-pane editor. The agent reads this context at the start of every run in the thread, reducing repeated instructions and keeping multi-turn conversations coherent.
- **Run artifact panel** — Every run that produces files (reports, transcripts, media, attachments, or logs) lists them in the run-trace view with three delivery options: Preview (opens PDFs inline in the browser without triggering a download), Download (saves to disk), and Copy link (mints a short-lived signed URL for sharing). All three routes flow through the platform's download proxy so every file delivery is attributable to the run that produced it.

### Agent Workplace Identity

Each agent gets a real workplace seat — not an alias or a borrowed login. Agents have their own email address, calendar, and org-chart row, attributable and revocable independently of any human. Agencies can run two backends in parallel: a built-in native backend (no external account required) and a direct integration with a cloud business-workspace provider (agents appear as real accounts on the agency's or client's domain).

- **Real identities, not aliases** — Each agent owns a dedicated email address (e.g. `sarah@clientco.com`), a calendar, and a mailbox. Outbound mail is signed, policy-enforced, and audit-attributed to the specific agent — external recipients see a professional business identity, not a system address
- **Actor / identity model** — Every agent and every human is a stable actor with a persistent identity. Backends can be migrated (native → cloud provider, or cloud → native) without losing the actor record, audit history, or continuity of work
- **Onboard in four clicks** — Existing agents onboard to the workplace from the Agents tab: select the agent → set email and send-mail toggle → confirm. The agent's email, photo, and lifecycle state are visible immediately
- **Org chart with humans and agents** — A single org-chart canvas shows every team member — human and agent — with reporting lines and hierarchy. An agency operator can see the full team structure at a glance, including which agents report to which humans
- **Per-agent mailbox and calendar** — Each onboarded agent has a read-only mailbox and calendar view inside the platform, with compose and new-event actions always routed through Automation OS so policy, signing, and audit run regardless of backend
- **Activity feed with workplace events** — The subaccount Activity page includes email, calendar, and identity lifecycle events (sent, received, accepted, suspended, migrated) alongside task and workflow runs — a single audit-ready view of everything an agent did
- **Lifecycle management** — Operators can activate, suspend, revoke, and migrate agent identities from the Identity tab. Suspension is instant and reversible; revocation removes the identity from the backend. Migration moves the agent's identity from one backend to another in a tracked, failure-tolerant background job
- **Seat tracking** — Consumed seats are derived from active agent identities and displayed inline on the subaccount header; no separate billing dashboard
- **Email governance built in** — A send-mail toggle per agent, three-window rate limiting, and a central email pipeline (audit → rate-limit → signing → dispatch) apply to every outbound message regardless of which backend delivers it

### Capability-Aware Orchestrator

Automatic task routing that understands what the platform can do, what the agency has configured, and where the request belongs — without hand-maintained rules.

- **Task board is the intake** — an agency operator or client writes a task describing what they want; the Orchestrator picks it up automatically the moment it lands in the inbox
- **Deterministic four-path decision** — every inbound task is classified into one of four routes: (A) already configured — run existing agent, (B) configurable and client-specific — hand off to the Configuration Assistant, (C) configurable and broadly useful — hand off AND flag the pattern as a platform-wide improvement candidate, (D) unsupported — file a structured feature request
- **Decomposition pipeline, not free-form reasoning** — requests are broken into a canonical capability list (integrations, read/write capabilities, skills, primitives), normalised against a published taxonomy, and validated against the live integration catalogue before any routing decision is made
- **Explicit capability matching** — routing to an existing agent requires the agent's capability map to cover every required capability AND the underlying integrations to have active connections AND granted scopes that cover the request — three conditions, checked atomically, never fuzzy
- **Graceful degradation** — when the integration catalogue is temporarily unavailable, the platform falls back to a safe routing posture and files an internal alert rather than blocking every inbound task
- **Auditable decisions** — every routing decision emits a structured record (path taken, required capabilities, missing slugs, candidate agents, reasoning, reference state) for operator review and product-quality tuning
- **Per-run budget + timeout** — capability discovery is bounded; runaway loops or unresolvable requests surface as distinct `routing_timeout` states rather than burning tokens
- **Post-handoff verification** — when the Orchestrator hands off to the Configuration Assistant, it independently re-verifies the configuration afterward and escalates on mismatch, so "claimed complete" and "actually complete" can't drift
- **Loop prevention** — a handoff-depth guard prevents Orchestrator → Configuration Assistant → Orchestrator cycles on partial configurations

### Platform Feature Request Pipeline

Every user request for something the platform doesn't support today becomes structured product signal, automatically.

- **Captured in the flow** — when a task asks for a capability the platform doesn't yet support, the Orchestrator files a structured feature request with full attribution (user, org, subaccount, originating task, verbatim intent, required capabilities, Orchestrator reasoning)
- **System-promotion detection** — when a configurable request matches a broadly-useful pattern (not client-specific), the platform flags it as a candidate for promotion to a system-level agent or skill — turning agency-level customisation into roadmap signal for everyone
- **Durable + deduplicated** — requests land in a queryable internal table with 30-day rolling dedupe on canonical capability slugs, so repeated demand is counted, not spammed
- **Multi-channel delivery** — each new request fires a notification into the platform team's support channel, support mailbox, and an internal subaccount task for human-in-the-loop triage before any analysis fires
- **Dogfood-ready** — the same task board the platform offers to end-users carries the request queue, so the platform team triages feature signal in the same UI they ship to customers
- **Auditable lifecycle** — open → triaged → accepted/rejected/shipped/duplicate states with resolution notes, so every piece of user intent has a traceable outcome

### Task Intake

A conversational intake surface that lets agency operators and clients describe what they want in natural language. The platform turns the request into structured, tracked work — clarifying before acting, challenging where needed, and presenting proposed actions for explicit approval.

- **Chat-first entry point** — Operators open a new task from the global sidebar; the AI starts the conversation, not a form
- **Fast path for simple asks** — A deterministic classifier resolves chatter and cheap-answer intents without running the full Orchestrator, so low-stakes questions return in a single turn
- **Smart clarification** — Before acting on ambiguous requests, the AI asks up to five ranked clarifying questions; simple requests bypass this and proceed immediately
- **Assumption challenge** — For high-stakes actions, an adversarial analysis pass surfaces the weakest assumptions as concern cards before the operator approves
- **Structured approvals** — Actions that write data, send messages, or modify records surface as explicit approval cards with risk level (low / medium / high), affected record count, and a deterministic "Thinking…" indicator so the interface never goes silent after send
- **Artefact trail** — Every task produces a typed output artefact (structured result, approval card, or error) that persists in the conversation for audit and replay, with client-side lifecycle resolution so superseded results, out-of-order arrivals, and orphan references all render correctly
- **Scope-bound chat panes** — The same conversational surface embeds inside the task board (per-task chat) and inside agent-run detail pages (per-run Q&A), so context never leaks across surfaces
- **Learned Rules loop** — When an operator approves an action, the platform drafts candidate rules that would make similar decisions automatic next time; auto-drafted rules start paused for human review before going live

#### Hardening

- Write-time integrity guard — the same parent result cannot be superseded twice, so concurrent edits from different agents can never corrupt a chain
- Per-conversation emission cap — any single write is bounded at 25 artefacts; runaway output fails loud, not silent
- Deterministic pending-assistant state — the UI shows "Thinking…" the moment a user message lands, with an auto-clearing fallback so a dropped websocket never leaves the interface mute
- Double-send protection — rapid repeat submissions in the chat pane are deduped synchronously before the server sees them
- Quality-gated rule capture — rules born from low-confidence signals or approval-suggestion loops start in a pending-review state instead of going live immediately, so the learning system cannot flood itself with noise
- Operational counters — write-guard rejections, over-limit truncations, and validation failures each increment a scraped counter so dashboards can track drift without re-parsing logs

### Configuration Assistant

AI-powered conversational configuration for agents, skills, schedules, and data sources. Helps org admins set up and manage their platform through natural language.

- **Agency-wide scope** — one assistant that can configure any client workspace from a single conversation
- **28 dedicated actions** — 15 require human approval, 9 read-only, 4 for validation and history
- **Plan-approve-execute flow** — the assistant proposes a structured plan; you review and approve; the platform executes exactly what was agreed
- **Full change history** — every configuration change tracked across 14 entity types with one-click restore to any previous version
- **Works from day one** — built-in knowledge of the platform, your existing configuration, and available skills means no setup learning curve
- **Safety guards** — cannot modify itself, respects client isolation, multi-layer scope enforcement
- **Module-gated** — available on qualifying subscription tiers

### Skill System

100+ modular skills across 13 categories, cascading from platform to agency to per-client workspace.

- **Four-tier resolution:** Platform skills → built-in skills → agency-custom skills → per-client workspace skills — each level can override or extend the one above
- **Per-client skill customisation** — Workspaces can create custom skills that replace platform defaults, so each client gets exactly the behaviour they need
- **Per-agent allowlists** — Each agent link specifies exactly which skills are available — no accidental access to capabilities a client shouldn't use
- **Skill authoring** — Definition editor, regression simulation, version history, and rollback across all scopes; accessible from the agent edit surface under the Skills tab
- **Skill Analyzer** — Bulk import skill libraries from uploaded files, pasted JSON, or a GitHub repo; the platform compares every incoming skill against the existing catalogue, produces a recommended merge for near-duplicates, flags scope creep, name collisions, capability overlap, missing review gates, and required-field regressions, and routes each candidate to a reviewer with structured accept / restore / rename / acknowledge decisions. When a recommended merge expands too far beyond the source skill, the platform automatically runs a second tightening pass before showing it to the reviewer; the tightened recommendation is the one used downstream, and the pre-tightening draft is retained for audit. Approval is locked once granted — edits require explicit unapprove — and every run captures a snapshot of the approval state for audit. When the comparison engine is offline, a deterministic rule-based merger still produces a proposal flagged as low-confidence so the library never stalls. Execution is transactional across skills and suggested new agents, with a pre-mutation backup for one-click rollback.
- **Full version history** — Every skill change is tracked with immutable versions; restore any previous version with one click
- **Built-in safeguards** — Total skill instructions are capped to prevent runaway costs; backup/restore built in for safe experimentation
- **Review gating** — 42+ skills require human approval before execution; 6 deterministic skills run instantly without AI involvement
- Smart skill selection dynamically prioritises relevant skills per conversation; skill modules enable bulk management
- See [Skills Reference](#skills-reference) for the full catalogue

### CRM Query Planner

Natural-language CRM reads that stay cheap and deterministic by default. Agents and operators ask in plain English — the planner answers from pre-approved queries first, falls back to live CRM reads only when needed, and bills nothing for the common path.

- **Deterministic-first** — A curated library of canonical CRM queries (inactive contacts, stale opportunities, upcoming appointments, etc.) matches common phrasings directly, with zero AI cost and sub-second latency
- **Structured plan cache** — Repeat intents within a short window reuse the prior plan across users in the same workspace, keyed per workspace so clients never see each other's queries
- **AI fallback for the long tail** — When a question doesn't match the library, a focused AI step produces a validated query plan; an elevated tier only engages on low confidence or complex hybrid intents
- **Hybrid execution** — The planner can combine a canonical base with a live-read filter for hard-to-canonicalise fields (city, country, custom tags) without forcing a full live scan
- **Read-only by construction** — The planner cannot write to the CRM. Enforced structurally via import restrictions and a CI guard script; the failure mode for a misconfigured query is "no data", never "wrong data"
- **Row-level tenant isolation** — Every query executes inside a per-caller security context; cross-workspace leakage is structurally impossible
- **Cost-bounded** — Per-query cost ceiling with a router-level budget breaker; rate-limited calls are treated as transient and never mapped to a cost-exceeded surface
- **Per-query trace** — Every response carries a full execution trace (which stage resolved the query, whether the cache was hit, which plan mutations fired, final executor used) so operators can debug "why did this return X?" without replaying the request
- **Dual surface** — Exposed as an HTTP endpoint for users/Briefs and as an agent skill (`crm.query`) governed by the normal capability-gate and review system
- **Observability built in** — Dashboard surfaces stage-hit rate, escalation rate, live-call rate, and cost-per-resolved-query so agencies can tune the deterministic library against real usage

### Workflow Engine

Multi-step workflow automation with dependency graphs, parallel execution, branching logic, and human review gates.

- **Eight step types:**
    - **Human input** — structured form captured from a human operator or client
    - **AI prompt** — direct one-shot AI generation
    - **Agent handoff** — delegate the step to a full agent with its complete skill set
    - **Platform action** — invoke a built-in action directly (e.g. publish to client portal, send email digest, create a scheduled task) with safety classification enforced automatically
    - **AI decision** — a focused AI call that returns a structured choice (e.g. routing, classification, approve/edit/reject) the workflow uses to branch
    - **Conditional** — deterministic branching on results from prior steps
    - **Approval gate** — pauses the workflow for human review before downstream steps run
    - **Invoke Automation** — execute a registered external automation as a workflow step, with input/output mapping and HITL gate resolution driven by the automation's declared side-effect classification
- **Five run modes:** hands-off, supervised (pauses at every approval gate), background (silent batch), bulk (one run per item in a list), and replay (re-execute a prior run with the same inputs)
- **Parallel execution** — Independent branches run simultaneously; results flow between steps automatically
- **Safety controls** — Irreversible steps cannot be auto-retried; per-step retry policy; every step declares its risk level; concurrent execution guards prevent double actions
- **Run-now + schedule** — Any recurring workflow can be launched immediately on setup; the normal schedule continues afterward
- **Portal publishing** — Workflows can publish their output directly to the client portal as a summary card; the portal always displays the most recent published brief per client
- **Email digest delivery** — Workflows can send markdown email digests to configured recipients with deduplication (no double-sends on retry)
- **Knowledge bindings** — Steps can write their output back to shared memory on completion; optional "first run only" mode captures baseline facts once without overwriting on subsequent runs
- **Onboarding auto-start** — Designated workflows launch automatically in supervised mode when a new client workspace is created — the Onboarding tab tracks progress so nothing falls through the cracks
- **Workflow Studio** — Chat-based authoring with validation, simulation, and cost estimation; platform and agency templates with versioning; fork and customise per agency; automatic recovery sweeps for stuck runs
- **No-code workflow migration wedge** — One-shot converter that ingests a no-code workflow JSON export and produces a draft supervised workflow, mapping each source node to a step with appropriate side-effect classification, approval gates, and a mapping report flagging anything the admin needs to review or rewrite. Credentials are never migrated; the admin re-authenticates via managed OAuth flows. Net effect: an agency's existing workflow library becomes multi-tenant, supervised, and cost-attributed in hours rather than a re-platforming project.
- **Visual Workflow Studio** — Org admins can author multi-step automated workflows in a visual canvas. Steps can involve agents, actions, human approvals, and user input forms. Workflows support branching, parallel execution, and loops.
- **Workflow runs** — Workflows execute against a subaccount context, with built-in cost and time ceilings, approval gates, and a real-time status feed for operators.
- **Scheduled workflows** — Workflows can be triggered on a schedule or by agent actions, with a maximum nesting depth of 3 to prevent runaway automated fan-out.

### Human-in-the-Loop

Review queue and approval system ensuring humans stay in control of sensitive agent actions.

- **Three gate levels:** Auto (proceed immediately), Review (pause for human approval), Block (disallow entirely)
- **42+ review-gated actions:** email, CRM updates, code patches, page publishing, budget changes, campaign pauses, and more
- **Approve with edits** — Reviewers can modify proposals before approving; rejection feedback trains the agent
- **Confidence escape** — Low-confidence tool calls automatically redirected to ask a clarifying question
- Agents can proactively escalate decisions to humans; review items are grouped by run for full context

### Task Board & Workspace

Kanban-style task management with agent assignment, deliverables, and workflow transitions.

- Configurable columns per org/subaccount with drag-and-drop; reusable board templates
- Full task lifecycle: create, move, reassign, add deliverables, complete — with priority levels and categories
- Per-task activity stream for team visibility; workflow transitions follow defined column rules

### Pulse — Supervision Home

Single-screen operational command centre that replaces the legacy inbox, dashboard, and activity pages. Everything that needs human attention surfaces here automatically.

- **Three-lane classifier** — Actions are deterministically sorted into Client-facing, Major, and Internal lanes based on impact: irreversibility, cross-subaccount scope, per-action cost, and per-run cost
- **Major-lane safeguards** — High-cost or irreversible actions require explicit acknowledgment before approval, with configurable cost thresholds per organisation
- **Live home dashboard** — Approvals, activity, client-health, and queue tiles refresh in place as events occur, with a "last updated" freshness indicator on every group. Operators see new state without manual refresh, and ordering is preserved under bursts so the dashboard never drifts behind reality.
- **Attention tab** — Live feed of pending review items, failed runs, health findings, and tasks needing decisions, with optimistic UI updates and real-time WebSocket push
- **History tab** — Full activity timeline with column-header sort, type/status/severity filters, search, and date-range filtering — delegates to the unified activity service
- **Bulk approve** — Select and approve multiple items at once; Major-lane items are automatically held back with a split response showing what was approved vs. blocked
- **Scoped views** — Organisation-wide and per-subaccount views with the same lane structure
- **Threshold editor** — Organisation admins configure per-action and per-run cost thresholds that control Major-lane routing, with currency selection
- **Per-subaccount retention** — Override the default run data retention period on a per-client basis
- **409 concurrency guard** — Prevents double-approval of already-resolved items with graceful UI recovery

### Agent Spending

A primitive for letting agents move real money on a client's behalf, with operator-defined limits, per-charge approval gates, and an immutable ledger of every attempt. Distinct from compute budgets (LLM and runtime cost caps) — agent spending is the framework that authorises external transactions: paying vendor invoices, completing a hosted checkout, topping up a balance, activating a subscription, issuing a refund.

- **Spending Budgets per sub-account** — Each client workspace has its own spending budget with a hard ceiling, daily and monthly caps, and a kill switch. Budgets are independent of compute spend so an agent's LLM cost never erodes its purchasing authority, and a payment failure never affects an agent's ability to think.
- **Spending Policies with shadow-mode rollout** — Every budget carries a policy that defines per-transaction limits, merchant allowlists, approval thresholds, and category rules. Policies start in shadow mode where the agent runs the full decision logic but no money moves; operators review the would-have-charged ledger before promoting to live. Promotion is itself an approval gate — no policy ships to production without an explicit human decision.
- **Per-charge approval gates** — Charges above a configurable threshold pause for human approval before execution. Operators see the full proposed payment — vendor, amount, currency, agent, originating run, idempotency key — and approve, reject, or edit before any external call fires. An approval window enforces freshness; expired approvals re-queue rather than silently executing later.
- **Multi-channel approval routing** — Approval channels can be configured per sub-account or shared at the agency level and granted to specific clients. The framework supports in-app routing today; additional notification channels (email, Slack, SMS, Telegram) plug into the same primitive without code changes per channel.
- **Real money-movement primitive** — Five payment skills cover the common shapes: pay invoices, complete one-shot purchases on hosted checkouts, activate vendor subscriptions, top up prepaid balances, and issue refunds. All five route through the same charge router so policy decisions, approval gates, idempotency, and ledger writes are uniform.
- **Immutable spend ledger** — Every charge attempt — approved, declined, expired, executed, refunded — lands as an append-only row with the full policy decision trace, idempotency fingerprint, and lifecycle timestamps. Past entries cannot be edited; lifecycle transitions are guarded at the database level, not just in application code. The ledger is the single audit-ready answer to "what did the agent spend last quarter".
- **Settled-vs-in-flight visibility** — The spend ledger view distinguishes money already moved from money currently reserved against open charges, so operators can see real cash flow and committed exposure without conflating the two.
- **Kill switch with double-check at execute time** — Operators can pause all spending on a sub-account from one toggle. The pause takes effect immediately for new charges, and any in-flight pre-approved charge is re-checked at execute time against the kill-switch state before the external call fires — no race window between approval and execution.
- **Refund preserves the original record** — Issuing a refund creates a new inbound-refund ledger entry; the original charge record is never modified. The full transaction history reads forward through time, audit-clean by construction.
- **Tenant-isolated by construction** — Spending budgets, policies, channels, and ledger rows are scoped per organisation and per sub-account at the database level. Cross-client spend leakage is structurally impossible.

### Live Execution Log — Per-Run Timeline

Every material agent decision — prompt composition, memory retrieval, rule matching, skill invocation, call start/end, handoff — streamed live and retained as a durable, replayable record. Operators get mid-run visibility and months-later forensics on the same surface.

- **Live timeline** — Watch a run unfold as it happens: which memories the agent pulled, which policies matched, which skills fired, and what the model saw at each step. Refreshes sub-second; buffers on reconnect so nothing is missed.
- **Deep-link to the source** — Every event in the timeline links to the entity that caused it. Stale memory? Click through to edit it. Wrong rule firing? Open the rule editor in place. Edits affect future runs only — the live run keeps its original state.
- **Prompt replay** — The fully-assembled prompt for every run (and every re-assembly after a handoff) is persisted in full. Click any prompt event to see exactly what the model was reading — no more guesswork about "what did the agent actually see".
- **Full call payload** — Request and response bodies per model call, stored with automatic secret redaction. Gated by a stricter permission than the timeline itself so only agent editors see raw payloads.
- **Long-term retention** — Timelines persist indefinitely with tiered storage: full fidelity for recent runs, summarised for older ones, archived for long-term audit. Compliance teams can answer "what did the agent do on April 3?" years after the fact.
- **Per-tenant isolation** — Every event row is tenant-scoped at the database level; cross-client leakage is structurally impossible.
- **Runaway-loop protection** — Hard cap on events per run with a one-shot "limit reached" signal, so an infinite-loop agent is still observable but never exhausts storage.
- **Edit attribution on past run pages** — When a memory block or workspace summary is edited after a run completed, that run's timeline shows a banner listing what changed, who changed it, and when. Operators reviewing past decisions always see the state of knowledge at the time the run executed alongside any subsequent edits.

### Memory & Knowledge System

Multi-layered memory architecture enabling agents to learn, share context, and build institutional knowledge — with provenance, quality controls, and drift detection so memory stays trustworthy as it accumulates.

- **Workspace memory** — Per-client fact store with intelligent retrieval that combines meaning, keywords, and recency for accurate recall
- **Semantic document retrieval** — Reference documents are chunked at semantic boundaries and ranked at run start by relevance to the active task. Only the most relevant chunks load into context, even when an agent has dozens of attached documents. Tiered scope: a single document can be attached at the organisation, sub-account, agent, recurring task, or single-run level, and the highest-precedence scope wins on conflicts so client-specific context overrides org-wide defaults automatically.
- **Three retrieval modes per document** — Auto (the default, ranked against every other candidate), Always available (loaded on every run, useful for brand or voice anchors), and Reference only (excluded from auto-load but reachable on demand via tool call when the agent needs it). Switching modes does not require re-uploading the document.
- **Add to Knowledge** — One-click promotion of any execution-produced file into a durable Knowledge document with full provenance back to the source run. Promoted files are marked durable immediately; chunking and embedding finish in the background without blocking the operator.
- **Always-available budget guidance** — When the volume of always-available documents starts crowding out the rest of the prompt, operators see a soft warning in the Knowledge tab before runs degrade, with clear before-the-fact guidance instead of mid-run truncation.
- **Memory blocks** — Named shared context with per-agent read/write permissions and governance controls
- **Baseline artefacts** — Sub-accounts capture six baseline artefacts at onboarding: brand identity, voice and tone, offer positioning, audience profile, operating constraints, and proof library. The first two are included in every client-touching agent run; the next two are included when the agent role matches the artefact domain; the last two are retrieved on demand via workspace memory search.
- **Cross-agent search** — Agents query what other agents have learned across the org
- **Agent briefings** — Rolling summaries generated post-run, injected into next run's context
- **Agent beliefs** — Confidence-scored facts per agent per client, automatically extracted from run outcomes. Each belief can be individually added, updated, reinforced, or removed — and corrected by users when agents get something wrong. Built-in guards prevent belief flip-flopping.
- **Org-level insights** — Cross-subaccount patterns stored with scope tags for portfolio intelligence
- **Knowledge drop zone** — Upload documents and reference material directly into a workspace; the system extracts, classifies, and stores entries with full provenance back to the original upload
- **Config documents** — Persistent reference material that informs every agent run in a workspace, editable in-place from the Knowledge page
- **References** — Manually-authored or promoted insights surfaced as durable, citable knowledge separate from auto-captured run output
- **Weekly digest** — Automated rollup that surfaces what the workspace learned in the last seven days
- **Citation tracking** — Each memory entry tracks how often it was injected into a run and how often it was actually cited in the agent's output, creating a feedback loop that improves retrieval relevance over time
- **Full provenance** — Every memory entry records its source (agent run, manual entry, workflow, upload, or synthesis) and a confidence score; high-trust paths automatically filter out unverified entries
- **Automatic accuracy maintenance** — When content changes, the system detects stale data and refreshes it in the background — search always returns matches against current information, not outdated text
- **Quality safeguards** — Memory quality scores are managed by the platform, not individual agents — preventing any single run from corrupting the knowledge base
- Automated memory decay (90 days), nightly deduplication, and multi-scope context cascading so agents always have the right context at the right level

### Memory Tiered Consolidation

| | |
|---|---|
| **Lifecycle state** | Growth |
| **Capability cluster** | Memory & Knowledge |

Structured consolidation lifecycle for workspace memory, so the most durable knowledge is always distinguished from transient context and surfaced with appropriate weight at retrieval time.

- **Four-tier lifecycle** — every memory entry moves through working, episodic, semantic, and procedural tiers based on how often it is reinforced and recalled. Tiers reflect how durable the knowledge has proven to be, not just how recently it was written.
- **Ebbinghaus-based decay** — each tier applies an independent decay curve so short-lived working context fades quickly while procedural knowledge persists indefinitely. Retrieval scores are weighted by current decay, so stale entries surface less prominently over time.
- **Multi-signal promotion** — entries are promoted automatically when reinforcement count, cross-session recurrence, and recency signals pass a configurable threshold. The promotion history is a durable, auditable trail, not a log line.
- **Operator-approved procedural tier** — promoting knowledge to the permanent procedural tier requires a human decision. Candidates queue in the operator review interface; approved promotions take effect on the next agent run.
- **Behaviour-flag gated** — the consolidation behaviour ships in an OFF state and must be explicitly enabled per environment after four consecutive weekly audit-script passes against staging. Existing memory data and retrieval behaviour are unaffected until the flag is flipped.
- **Versioned configuration** — decay weights, promotion thresholds, and retrieval multipliers are versioned. Operators tune behaviour by adding a new config version rather than editing live settings; every audit run records which version was active.

### Trust & Verification Layer

Three-stage quality framework that makes agent output verifiable, correctable, and continuously improving — without requiring model changes or prompt re-engineering.

- **Skill verification** — Before any agent output leaves the platform, a set of named quality checks evaluates it against configurable criteria. Every check produces a pass, fail, or inconclusive verdict with the exact text that was evaluated, so operators can see precisely why a check fired.
- **Scorecards** — Groups of quality checks packaged as a reusable scorecard. Attach a scorecard to any agent and every skill output the agent produces is automatically evaluated against it. System-managed scorecards apply platform-wide; org-managed scorecards apply across all client workspaces; workspace-managed scorecards apply to a single client.
- **Sampling controls** — Scorecards run on a configurable fraction of outputs (every run, every fourth run, etc.) so quality gates fit any volume without inflating costs. Mandatory checks always run; sampled checks apply the configured rate.
- **Bench evaluation** — Run any scorecard against a curated set of test inputs to measure quality before and after a change. Results are retained per run so operators can compare quality across model upgrades, prompt edits, or rule changes.
- **Operator correction** — When an operator corrects an agent output in the Run-trace timeline, the corrected version is captured as a memory block with full provenance: the original output, the corrected version, the skill that produced it, and the source run. Corrections feed directly into the agent's knowledge base.
- **Pattern detection** — A nightly sweep clusters similar corrections using embedding similarity. When three or more corrections align on the same skill, a pattern-inferred memory block is promoted for human review and a tightening recommendation is surfaced in the Govern page.
- **Provenance-filtered Knowledge page** — The Knowledge page shows a source filter so operators can isolate correction-sourced entries from manually authored entries and auto-synthesised entries. Every row shows its provenance pill and links back to the source run.

### Workspace Health & Diagnostics

Automated configuration auditing that detects drift, misconfigurations, and operational issues.

- **10 active detectors:** inactive agents, empty skill allowlists, missing schedules, broken connections, stale connectors (ingestion overdue or recent errors), missing engines, unsynced system agents, multiple active leads per sub-account (impossible post-migration but flagged instantly if ever introduced), sub-accounts with no active lead, and agents holding delegation skills with no team to delegate to
- Severity levels (critical/warning/info) with deduplicated findings and permission-gated manual resolve
- On-demand audit via UI or API; findings page grouped by severity with recommendations

### Sub-account Optimiser

The Sub-account Optimiser is the first consumer of the agent recommendations primitive. It runs a daily scan per subaccount at 06:00 local time (staggered by hash to distribute load) and surfaces findings across eight categories: agent over-budget, playbook escalation rate, slow skills compared to peer benchmarks, inactive workflows, repeat escalation phrases, low memory citation efficiency, routing uncertainty, and poor LLM cache reuse. Operator-facing copy is plain English; no internal category slugs appear in the dashboard.

### Sub-account Baseline

Quantitative starting numbers captured at sub-account onboarding so progress is measurable from day one.

- **Five core metrics** — lead count, open opportunities, pipeline value, last 30 days revenue, conversation engagement. Captured automatically once a CRM is connected and has settled enough data to be representative.
- **Manual entry override** — operators can enter values directly when CRM data is incomplete or when starting from a non-CRM source of truth. A historical-maximum cap on lead count guards against order-of-magnitude data-entry mistakes.
- **Confidence flag** — every baseline is tagged confirmed (all opted-in metrics captured), partial (some metrics unavailable), or estimated (manual entry). Reporting surfaces show the flag so operators can interpret deltas accurately.
- **Admin reset** — sysadmins can reset a sub-account's baseline when the operator legitimately starts over (post-migration, scope change). Prior baselines stay on file with the reset reason and timestamp.

### Activity & Analytics

Unified operational view across all activity types with advanced filtering and real-time updates.

- **Unified activity stream** — Agent runs, reviews, health findings, workflow runs, task events, and executions in one view
- **Multi-scope:** system-wide, org-level, and per-subaccount with filtering by type, status, date, agent, severity
- **LLM usage tracking** — Every call logged with tokens, cost, model; usage explorer with cost trends and margin calculations
- **Dashboard metrics** — Active agents, success rate, total runs, token usage with daily trend indicators
- Real-time live updates; CSV/JSON execution export; column-header sort and filter on every table

### Client Portal

White-label client-facing interface scoped per subaccount, enabling agencies to give clients self-service access.

- Subaccount selector, workflow browser with category filtering, self-service execution, and run history
- Client users see only their own portal; agency brand colours carry through to the portal styling
- **Workflow brief cards** — Published workflow outputs appear on the portal as rich summary cards (headline bullets, full brief in modal); each card shows status and last-run timestamp; "Run now" triggers a fresh run and navigates to results
- Portal briefs are isolated per client; retracted briefs disappear automatically; clients always see the most recent published version

### Pages & Content Builder

CMS-style page creation and publishing with analytics tracking and form submission handling.

- Page projects with rich content, meta tags, and forms — draft-to-published workflow with mandatory human approval
- Public pages with built-in view analytics and form submission handling
- Agents can create, update, and publish pages via dedicated skills

### Integration Framework

Pre-built connectors for the tools agencies already use — connect once, use across every agent and workflow.

- **OAuth providers:** Gmail, Slack, HubSpot, Go High Level (GHL), Teamwork Desk, GitHub App
- **Connection ownership** — Connections can be user-owned (personal Gmail, Calendar), per-client (isolated), or agency-wide (shared). Personal connections default to private visibility with explicit sharing controls
- **Scheduled ingestion** — Every connector polls on a configurable schedule without operator intervention. Sync phases (initial import → transition → live) track maturity automatically
- **Cost observability** — Per-connection API call counts, row throughput, and sync duration recorded for cost attribution and tier economics tuning
- **Canonical data layer** — Provider-specific records normalised into a shared schema. Agents query consolidated data via the data dictionary skill rather than making live API calls for every question
- **Data connectors:** GHL, HubSpot, Stripe, Slack, Teamwork with managed ingestion and deduplication
- **Inline integration setup** — When an agent run reaches a step that requires a connected integration, it pauses and presents an OAuth connect card inline in the conversation thread — no page switch, no separate settings flow, no lost context. The agent continues automatically the moment the connection is established, picking up exactly where it left off.
- **MCP servers** — Model Context Protocol for extending agent capabilities with any external tool; credential binding to any OAuth provider; per-tool approval overrides
- **Webhooks** — Signed outbound and verified inbound; third-party workflow engines and custom endpoints supported
- Enterprise-grade credential management with encryption, key rotation, and a visual tool browser
- **AI Subscriptions** — Connect a subscription that your autonomous agents can use to run model-mediated work, in addition to the platform's managed model providers. Per-agent availability controls let you scope which agents can use which subscriptions.
- See [Integrations Reference](#integrations-reference) for the full list

### Document Bundles & Cached Context

Reusable document libraries that let agents carry stable reference knowledge across runs — assembled once, served instantly at every execution.

- **Document bundles** — Named collections of versioned reference documents. Attach a bundle to an agent, task, or scheduled task; every run in that scope receives the full bundle as context without re-uploading or re-prompting.
- **Multi-file upload** — Upload multiple documents in a single operation; each file is stored as an immutable, versioned content record. Uploading new content creates a new version; prior versions are never deleted, preserving full reproducibility.
- **Auto-bundles** — When documents are uploaded and immediately attached without naming a bundle, an unnamed bundle is created automatically and reused whenever the same document set recurs. Operators can promote any auto-bundle to a named bundle with a single action.
- **Bundle suggestion** — After attaching a set of documents, the platform detects whether the set forms a useful named bundle and surfaces a one-click save prompt. Operators can permanently dismiss the suggestion per document set.
- **Per-run snapshot isolation** — At run start, the platform captures an immutable snapshot of every attached bundle — the exact document versions, content hashes, and token counts in effect at that moment. Subsequent bundle edits or document updates never affect a run already in flight.
- **Budget-aware assembly** — The platform resolves a per-run execution budget (model tier policy → org ceiling → task override) before assembling the prefix. Assembly validates token usage against the budget before calling the model; if the prefix exceeds the budget, the run is paused for operator review rather than silently truncating.
- **Operator review gate** — Budget breaches surface as structured review items: which threshold was exceeded, the top document contributors, and suggested remediations (trim bundle, split task, upgrade model tier). Operators approve or reject; an approved retry re-resolves from current state exactly once.
- **Utilisation labels** — Each bundle displays a utilisation indicator (low / medium / high / over-budget) showing how much of the typical model's context window the bundle occupies — so operators know before attaching whether a bundle will fit.
- **Reproducible audit trail** — Every run records the snapshot IDs, variable-input hash, and run outcome (completed / degraded / failed). Degraded runs record the specific reason (soft warning threshold, token drift, or unexpected cache miss) for post-run observability.

### Execution Infrastructure

Production-grade reliability — agents run consistently, recover from failures, and never double-execute.

- **Reliable job processing:** 24+ background job types across 10 priority tiers with automatic retry, failure recovery, and nightly cleanup
- **Exactly-once execution:** every action is deduplicated — safe to retry without side effects, even on network hiccups or rapid clicks
- **Usage guardrails:** per-user rate limits on test runs prevent runaway costs during development and QA
- **Real-time execution streaming:** live progress updates as agents work — instant feedback without page refreshes or manual polling
- **Budget enforcement:** hard ceilings on tokens, cost, tool calls, and timeouts per run
- **Security:** data isolation enforced at three independent layers; every tool call authorisation logged
- Infinite loop detection, automatic crash recovery, and full execution tracing for debugging
- **Working time accounting:** billable compute time tracked per run and surfaced in the Usage Explorer — the working-time chart in each agent's workspace is the same number on the invoice.

### Personal Assistant

A dedicated AI assistant for individual users — monitors your calendar and inbox, handles scheduling, drafts Slack messages for your review, and keeps you briefed on what matters today.

- **Calendar management** — reads your calendar to find free slots, creates and updates events, responds to invitations, and surfaces scheduling conflicts before they become problems. All calendar writes require your explicit approval before they take effect.
- **Slack communication** — reads channel history, summarises threads, and drafts messages or DMs for your review. Nothing is posted to Slack without your sign-off — every outbound message routes through an approval step.
- **Daily briefing** — surfaces what needs attention today: upcoming meetings, unread threads flagged as high-priority, and outstanding requests the assistant identified in your inbox.
- **Inbox triage** — scans incoming email for action items, deadlines, and follow-up requests; surfaces them as a prioritised review queue rather than leaving you to excavate each message yourself.
- **Meeting prep** — compiles relevant context for upcoming meetings: prior notes, related tasks, and open items from previous conversations with the same attendees.
- **Voice and tone** — learns your communication style and applies it when drafting replies and messages, so output sounds like you rather than a generic assistant.
- **Personal connection privacy** — the assistant uses your personal connected accounts (calendar, email, Slack) exclusively. No other user or agent can access these credentials.
- **One-time setup** — connects to your accounts in a guided first-run wizard; your personal assistant is available immediately once connections are established.
- **Standing autonomous operator** — when configured in autonomous mode, your personal assistant operates continuously on your behalf: monitoring your accounts, taking actions within your approval settings, and reporting back when tasks are complete. All autonomous actions respect your configured approval policies; actions above your approval threshold pause for your review before executing.

### Sandboxed Runtime (IEE)

Agents that need to do real work on systems without APIs — filling forms, navigating websites, downloading files, scraping paywalled content — get an on-demand isolated environment provisioned just for that task. When the task completes, the environment is released; nothing persists between runs.

- **Browser automation mode:** Agents execute multi-step browser tasks (logins, form submissions, structured scrapes, file downloads, paywalled content access) inside fully sandboxed containers with per-run cost tracking and budget controls. This is how agents do work on systems that don't have APIs.
- **Vision-based browser grounding (preview):** For sites where selector-based automation breaks — heavy JavaScript apps, dynamic layouts, custom rendering — agents can opt in to a vision decision mode that interprets the page directly from a screenshot. Skill authors declare `iee_decision_mode: vision` or `hybrid` (DOM-first with vision fallback). Per-call inference cost is tracked alongside other runtime costs in the usage explorer. Available in preview; the underlying decision loop is being wired in stages.
- **Development mode:** Agency-level extensibility for building custom apps, scripts, or connectors that support bespoke processes. Guarded by a mandatory code review workflow with approved command lists and test execution. Not positioned as a standalone IDE.
- **Live progress on long-running browser tasks:** delegated browser tasks surface real-time step count and worker heartbeat in the run-trace view while the agent is still working — operators see the work happening rather than a silent "in progress" spinner.
- **Connection health validation:** stored credentials for paywalled and login-protected sites can be tested on demand — runs a real login attempt in a sandboxed browser and reports back, so credentials are verified before the agent depends on them.
- **Full cost visibility** — both AI token costs and runtime costs are tracked per execution in the usage explorer, so agencies see their true cost of delivery — not just model spend.
- All executions run in isolation with enforced gating; no agent touches host state.

### Persistent Agent Workspace

Every agent has a named, persistent workspace that operators can open at any time — not just during a run. The workspace shows what the agent is doing right now, what it learned in its last run, and what it produced — no waiting for a report or digging through logs.

- **Always-on visibility** — the workspace stays open between runs. Operators check in at any moment to see current state, recent observations the agent has logged, knowledge sources it drew on, files it delivered, and the tools it reaches for most often.
- **Named presence states** — agents surface in plain terms: Running, Waiting on you, Scheduled, Failing, or Idle. No abstract status codes — operators immediately know where every agent stands.
- **Knowledge in use** — the workspace shows which sources the agent drew on in its last run, so operators can see exactly what informed the agent's decisions.
- **Files produced** — every file the agent delivered appears in the workspace with a direct link. No hunting through run logs to find what the agent generated.
- **Working time** — billable compute time is tracked automatically and shown as a working-time chart inside the workspace. The chart is the invoice line — what the agent was actively running, not idle time.
- **Fleet view at a glance** — the Home page shows all agents at a glance, sectioned by what they're doing: Waiting on you, Working now, Failing, Scheduled next, Idle. One screen replaces the need to check each agent individually.

### Subscription-Driven Long-Task Execution

Agents that need to run multi-hour or multi-day tasks — where per-token API spend would be prohibitive — can instead run inside a subscription-mediated session that dramatically reduces cost. The platform handles the full lifecycle: session credential management, session-to-session continuity, fallback to direct billing if the session becomes unavailable, and per-task cost tracking in the usage explorer.

- **Long-form tasks without a time ceiling** — a single task can span multiple automated sessions, each picking up exactly where the last left off. The user sees one task progressing, not a series of separate attempts.
- **Automatic session continuity** — when a session approaches its limit, the agent self-checkpoints and the platform automatically starts the next session with the agent's state fully restored. No user action required.
- **Persistent browser context** — each task maintains its own browser identity across sessions, so authenticated sites and in-progress workflows stay live for the duration of the task.
- **Graceful fallback** — if a subscription session becomes unavailable mid-task, the platform detects it, optionally continues on direct billing, and pauses the task with a clear notification rather than failing silently.
- **Subscription-mediated cost attribution** — the usage explorer tracks both subscription and direct-billing costs separately per task, so agencies see the true cost of delivery for each execution mode.
- **Per-subaccount limits** — operators set concurrency caps, per-task session budgets, and retry policies per subaccount from the Connections page settings. Changes take effect on the next session.

---

## Replaces / Consolidates

Automation OS replaces a fragmented stack of point tools with a single, orchestrated system of agents and workflows.

| Replaced | With | Why it's better |
|----------|------|-----------------|
| Commodity workflow automation tools | Workflow Engine | Stateful, agent-driven, with structured human review gates — not brittle trigger/action chains |
| Standalone LLM chat products | Deployed agents | Defined skills, budgets, memory, and accountability — not ephemeral conversations |
| Manual monthly reporting | Scheduled reporting agents | Drafted, reviewed, and delivered automatically on cadence — not assembled by hand each month |
| Ad-hoc CRM hygiene sprints | Continuous enrichment pipeline | Always-on enrichment and pipeline analysis — not a quarterly cleanup |
| Siloed marketing, CRM, and analytics tools | Unified skill system | One system connects data, decisions, and actions across platforms — no context switching |
| Fragmented client management across orgs | Multi-tenant subaccount hierarchy | Strict per-client data isolation built in — not enforced by process |
| Manual churn reviews | Always-on health scoring | Anomaly detection and intervention triggers fire automatically — not discovered on a renewal call |
| Shared team chat products used for agent work | Multi-tenant org + subaccount hierarchy with Client Portal | Strict per-client isolation and white-label portals — shared chat products are built for internal teams sharing context, not agencies serving many isolated clients |
| Scheduled-prompt and hosted-routine tools | Workflow Engine + portfolio-wide scheduled-work calendar | Multi-step workflows with approval gates, cost ceilings, templating, retry policies, and idempotent execution — plus a single calendar that shows every scheduled agent run, workflow, and scheduled task across every client, rolled up org-wide and exposed inside the client portal. Scheduled-prompt and hosted-routine tools run one prompt on a cadence for one user; Synthetos runs an agency's entire book of client work on one supervised surface. |
| Hosted single-agent platforms and hosted-agent products | Three-tier agent hierarchy with role-based handoffs | Fleet management with role hierarchy, handoffs up to 5 levels, workspace health monitoring, and per-client skill cascades — hosted single-agent and hosted-agent products have no multi-client operations layer because their buyer is an individual or an internal team, not an agency |
| Hosted VM-per-agent platforms | Persistent Agent Workspace + on-demand compute | Agents get a named, persistent workspace that survives between runs — plus on-demand isolated compute when needed for browser or dev tasks. A dedicated VM per agent is expensive and idle most of the time; Automation OS provisions compute only when the agent is actively running a task, then releases it. |
| Hand-maintained no-code workflow libraries | Supervised-migration converter + Workflow Engine | One-shot import of no-code workflow JSON into a draft supervised workflow with approval gates and cost simulation mapped from the source nodes — not a transliteration, an upgrade from stateless trigger/action chains to a multi-client operations system |
| Self-build on an agent SDK | The operations system on top of any agent SDK | All the non-agent layer already built — isolation, approvals, portals, workflows, managed integrations, margin tracking, supervision home |
| Single-provider LLM lock-in | Model-agnostic per-skill routing | Route across every frontier and open-source LLM per skill; insulated from any one provider's pricing or roadmap shifts |

---

## Agency Capabilities

### Performance Reporting & Analytics

| | |
|---|---|
| **Outcome** | Clients receive data-driven performance reports — automatically generated on schedule, not assembled manually each month |
| **Trigger** | Scheduled agent run, manual request, or pipeline health threshold breach |
| **Deliverable** | Formatted report delivered via email or portal with executive summary, metric breakdowns, and prioritised next steps |

- Covers social media, ad campaigns, CRM pipeline velocity, and financial metrics in a single standardised workflow
- 42 Macro transcript analysis using GRID/KISS framework for research-backed insights
- All reports pass through human review before delivery

### SEO Management

| | |
|---|---|
| **Outcome** | Clients receive prioritised SEO audits with specific, actionable fixes — not a raw crawl dump |
| **Trigger** | Recurring schedule or on-demand audit request |
| **Deliverable** | Prioritised findings report with issue severity, fix recommendation, and tracking against previous audits |

- On-page SEO auditing with per-issue recommendations
- Integrated with content creation for SEO-optimised output from the same workflow

### GEO — AI Search Visibility

| | |
|---|---|
| **Outcome** | Clients know exactly why they're invisible in AI-generated answers — and have a ranked action plan to fix it — not a vague "improve your content" report |
| **Trigger** | Recurring schedule, on-demand audit request, or competitive analysis |
| **Deliverable** | Composite GEO Score (0-100) with per-dimension breakdown, per-engine readiness assessment, prioritised recommendations, and a 30-day improvement roadmap — delivered as a task deliverable through the existing review pipeline |

- Agencies can offer a genuinely new service vertical — automated AI search auditing — that no competing agency automation platform currently provides
- Unified GEO + SEO report from a single agent run: clients get one coherent picture of their search visibility, not two separate tools to reconcile
- Scores track over time per client, so agencies can show measurable improvement and tie GEO work to outcomes
- Competitive benchmarking shows clients exactly where they trail competitors in AI visibility and what specific changes close the gap
- llms.txt generation gives clients an immediate, concrete deliverable — a file they can deploy the same day that signals AI-readiness to every major engine

### Content Creation & Publishing

| | |
|---|---|
| **Outcome** | Publish-ready content across formats and channels, generated from a single brief through a standardised workflow |
| **Trigger** | Content brief submission, scheduled cadence, or campaign launch |
| **Deliverable** | Long-form content, social posts, ad copy, lead magnets, landing pages — each with a mandatory approval step before publishing |

- One brief → blog post, social variants, ad copy, and lead magnet — no repeated briefing per format
- Platform-specific social variants optimised per channel
- All publishing actions gated by human approval; nothing goes live autonomously

### CRM & Contact Management

| | |
|---|---|
| **Outcome** | Clean, enriched CRM data maintained on an ongoing basis — not reconciled in a quarterly cleanup sprint |
| **Trigger** | Scheduled sync, new contact event, or pipeline review cadence |
| **Deliverable** | Updated CRM records, third-party enrichment data, pipeline analysis, and voice-of-customer insight reports |

- Contact enrichment from third-party providers written back automatically
- Pipeline velocity, conversion, and forecast analysis on a recurring cadence
- All CRM writes gated by human approval

### Email Marketing & Outreach

| | |
|---|---|
| **Outcome** | Intelligent email operations that respond to signals in real time — not batch-processed at the end of the week |
| **Trigger** | Inbound email received, deal goes stale, or outreach sequence cadence hit |
| **Deliverable** | Classified inbox, drafted follow-ups, multi-step sequences, and support replies — all sent with human approval |

- Inbound classification by intent, urgency, and routing category
- Contextual follow-ups triggered automatically when deals go stale
- Knowledge-base-powered support replies that improve as the knowledge base grows

### Campaign Management & Optimization

| | |
|---|---|
| **Outcome** | Campaign spend optimised continuously by data, not reviewed manually once a week |
| **Trigger** | Performance threshold breach, scheduled review, or manual request |
| **Deliverable** | Bid adjustments, budget increases, campaign pauses, and copy updates — each presented with supporting evidence and requiring explicit approval |

- Every recommendation backed by performance data, not instinct
- Every budget and bid change requires human sign-off before execution

### Financial Analysis & Reporting

| | |
|---|---|
| **Outcome** | Structured financial summaries available on demand — not a multi-hour manual consolidation |
| **Trigger** | Scheduled reporting cadence or ad-hoc analysis request |
| **Deliverable** | Financial summary with revenue/expense ratios, trend analysis, and budget/forecast updates requiring approval |

- Revenue and expense data retrieved from connected accounting systems
- Record updates (budgets, forecasts, expense notes) gated by approval before write-back

### Churn Detection & Account Health

| | |
|---|---|
| **Outcome** | At-risk accounts identified and flagged before they churn — not discovered after the fact on a renewal call |
| **Trigger** | Health score drop below threshold, anomaly detected, or scheduled monitoring cadence |
| **Deliverable** | Health scores (0-100), risk assessments with contributing factors, anomaly alerts, and intervention recommendations |

- Composite health scoring based on normalised CRM, engagement, and activity metrics
- Anomaly detection compared against each account's own historical baseline
- Intervention triggers (check-in, pause, escalation alert) proposed with human gating
- ClientPulse dashboard for portfolio-wide health visibility at a glance, powered by Staff Activity Pulse (weighted-sum activity scoring from CRM mutation events, with automation-user exclusion) and Integration Fingerprint Scanner (detects third-party tools installed in each sub-account from canonical artifact patterns)
- **Intervention pipeline** (Phase 4): scenario-detector proposes CRM-side actions (fire automation, send email, send SMS, create task) plus internal operator alerts — every proposal queued for operator approval before execution. Hourly outcome-measurement job tracks post-intervention band change (improved / unchanged / worsened) over a 14-day measurement window so operators see which interventions actually move the needle.
- **Real CRM dispatch + outcome-weighted recommendations** (Session 2): approved interventions now cross the wire to the connected CRM with idempotent retry semantics and per-subaccount concurrency locks — not stubs. As outcome data accumulates, the recommended intervention for any risk band promotes the option that historically produced the best band improvement, falling back to configured priority when trial data is thin. Operators see the recommendation rationale inline (outcome-weighted vs priority fallback).
- **Per-client drilldown** (Session 2): one-click into any client surfaces current health score with 7-day delta, top contributing risk signals, 90-day band-transition timeline, full intervention history with outcome badges, and a contextual "Open Configuration Assistant" trigger seeded with that client's situation.
- **Live CRM-data pickers** (Session 2): every intervention editor ships searchable dropdowns backed by the connected CRM — choose the real workflow, contact, assignee user, from-address, or from-number from live data instead of copy-pasting IDs. Rate-limit aware with graceful backoff.
- **Multi-channel operator alerts** (Session 2): internal operator alerts fan out across email and configured chat webhooks based on per-channel availability — one alert, reaching the operator wherever they are. The in-app surface is the review queue itself (where the alert row is written at proposal time). A dedicated per-user in-app notification record is on the roadmap for an upcoming release.
- **Configuration Assistant for account-health knobs** (Phase 4.5): operators change scoring weights, churn band thresholds, intervention cooldown hours, and alert limits via a guided confirm-before-write surface. Every change is audit-logged; changes to governance-critical knobs (weights, cooldowns, alert caps) route through the review queue for a second pair of eyes.

**ClientPulse configuration capabilities (for capability-aware routing):**

- `organisation.config.read` — inspect current operational_config values for the org.
- `organisation.config.update` — propose a single dot-path change; routes through the sensitive-path gate when required.
- `organisation.config.reset` — revert to the hierarchy template's defaults (factory reset semantic).
- `organisation.config.history` — browse the audit trail of past changes with snapshot diffs.

### Customer Support Automation

| | |
|---|---|
| **Outcome** | Faster support responses with consistent quality — drawn from a shared knowledge base, not individual memory |
| **Trigger** | Inbound query received or untriaged backlog accumulates |
| **Deliverable** | Classified queries with routing, drafted replies using knowledge base context, and triaged backlogs with disposition recommendations |

- Knowledge base search surfaces relevant articles before drafting
- Intent classification and urgency routing ensures the right priority
- Backlog triage processes accumulations systematically, not ad hoc

#### Per-Inbox Agent Modes

Each connected inbox runs in one of three modes, switchable instantly from the Support Agent dashboard without a page reload:

- **Disabled** — the agent reads tickets but takes no action
- **Assisted** — the agent proposes draft replies; a human approves before anything is sent
- **Autonomous** — the agent classifies, drafts, and dispatches replies without requiring approval, subject to the collision window and confidence gate below

Inline mode toggles on the dashboard update immediately — one click switches an inbox from assisted to autonomous or back, with an error recovery path if the save fails.

#### Agent Configuration

Per-inbox agent behaviour is configurable without touching code:

- **Collision window** — minimum idle time (5, 15, 30, or 60 minutes) since the last human action before the agent is permitted to intervene. Prevents the agent from drafting a reply seconds after a human has already started one.
- **Respect human assignee** — when enabled, the agent skips any ticket that has a human assignee, regardless of the collision window.
- **Confidence threshold** — replies below a configurable minimum confidence score (permissive 0.7 / default 0.8 / conservative 0.9) are blocked and routed to the human queue instead of being sent or proposed.
- **Voice profile** — Casual, Neutral, Formal, or Custom. Controls the tone of agent-authored replies.
- **Prompt override** — up to 500 characters of free-text instructions that are appended to the agent's base prompt, allowing per-inbox style or topic customisation without editing the underlying skill.
- **Escalation categories** — one or more intent categories (cancellation request, complaint, sales inquiry, other) that trigger automatic escalation to the human queue regardless of confidence score.

#### Eval Harness and Drift Detection

Every inbox agent run is scored automatically. When a scheduled eval run completes:

- **Classification accuracy** is measured per intent against a curated test set. If any intent category drops below threshold (default 85%) on two consecutive non-partial runs, the gate fails.
- **Draft quality** is judged against a 0–5 scale rubric. If the average judge score falls below 4.0 on two consecutive non-partial runs, the gate fails.
- **Fail-open** — if the regression set has fewer than two completed (non-partial) runs, the gate passes with a warning rather than blocking. The same applies when the most recent run is still marked partial.
- **Drift detection** — when classification accuracy or judge score regresses from the previous run, a structured drift event is emitted so operators are alerted before quality degrades in production.

The eval gate is a CI check that blocks deployment when both signals decline simultaneously; a single metric dip does not block.

#### Support Desk Skills

Structured access to connected helpdesk inboxes. All read skills are non-destructive; write skills require human approval before any reply reaches the customer.

- **Read open support tickets** — retrieve the current list of open, pending, or quarantined tickets from a connected inbox. Supports filtering by status, assignee, and tags.
- **Read a support ticket thread** — retrieve the full message history and internal notes for a specific ticket, including any pending draft replies.
- **Propose a support reply** — draft a reply to an open ticket using context from the conversation thread and the knowledge base. The draft enters a review queue; nothing is sent to the customer until approved.
- **Approve and send a support reply** — approve a pending draft and dispatch it to the customer through the connected helpdesk. A three-step gate ensures no duplicate replies are sent even under retry conditions.
- **Reject a draft reply** — discard a pending draft and return the ticket to open status for re-drafting or manual handling.
- **Set support ticket status** — update the status of a ticket (open, pending, solved, or closed) directly through the connected helpdesk.
- **Assign a support ticket** — reassign a ticket to a specific helpdesk agent.
- **Tag a support ticket** — add or remove labels on a ticket for routing, reporting, or workflow purposes.
- **Find customer history across support and CRM** — surface the full interaction history for a customer, spanning support tickets and CRM contact records, without switching between tools.
- **Add internal note to a support ticket** — post a note visible only to the support team, not the customer. Used for handoff context, escalation detail, or coordination.
- **Classify a support ticket** — determine the intent category, urgency level, and recommended routing action for a ticket without drafting a reply. Returns structured classification data for downstream triage or reporting.

### Landing Page Management

| | |
|---|---|
| **Outcome** | Agents build and manage landing pages end-to-end, reducing turnaround from days to minutes |
| **Trigger** | Campaign launch, content brief, or manual request |
| **Deliverable** | Published landing pages with meta tags, forms, view analytics, and full version history |

- Full lifecycle managed in one place: create, update, publish
- Publishing is irreversible and always requires human approval — nothing deploys autonomously

### Competitor Intelligence

| | |
|---|---|
| **Outcome** | Structured competitor intelligence delivered on a repeatable schedule — not assembled ad hoc before a pitch |
| **Trigger** | Scheduled cadence, ad-hoc research request, or automated change detection on competitor URLs |
| **Deliverable** | Intelligence brief covering pricing, features, recent news, and positioning analysis in a consistent format |

- **Automated page monitoring** — Watch competitor pricing pages, feature lists, or job boards; agents are triggered immediately when content changes
- **Structured field extraction** — Extract specific fields (e.g. pricing tiers, plan names) automatically on every run without re-paying AI costs after the first extraction
- **Tiered scraping engine** — HTTP fetch → stealth Playwright browser → Scrapling anti-bot bypass; automatically escalates through tiers when a site blocks simpler methods

### Portfolio Intelligence

| | |
|---|---|
| **Outcome** | Agency leadership gets a cross-client view in minutes — not assembled from individual account reports |
| **Trigger** | Scheduled portfolio review or leadership briefing cadence |
| **Deliverable** | Portfolio intelligence briefing with per-client health scores, priority actions, and cross-client pattern insights |

- Cohort queries filtered by subaccount tags for segment-level analysis
- Org-level insight storage compounds pattern recognition across clients over time

### LLM Spend Observability & Per-Client P&L

| | |
|---|---|
| **Outcome** | Agency leadership sees, in near-real-time, exactly how LLM spend is tracking per client, per subaccount, per model, and per feature — and what margin is left after platform overhead |
| **Trigger** | Live dashboard access, ad-hoc P&L review, or monthly billing reconciliation |
| **Deliverable** | Cross-client financial dashboard with revenue, cost, gross profit, platform overhead, and net profit — sliced by organisation, subaccount, source of work, and provider/model — with a top-cost call inspector for runaway-cost triage |

- **Every LLM call is attributed** — no "black box" usage. Each call carries the work that triggered it (agent run, scheduled process, automated workflow, platform background work) plus a feature tag so agencies can answer "how much did the weekly reporting agent actually cost this month?" without a log-scraping exercise.
- **Platform overhead is surfaced, not hidden** — background work the platform performs on its own behalf (memory compilation, skill classification, orchestration hints) is cost-attributed separately and subtracted from gross profit to show true net margin. No surprise "platform tax" eating margin silently.
- **Per-client P&L rolls up automatically** — revenue (what the client is billed after margin), cost (raw LLM spend), profit, and margin percentage for every organisation and every subaccount. 30-day trend sparkline per client. Exportable to CSV for invoicing workflows.
- **Sort and total every view** — every column in every P&L table supports ascending/descending sort; each table footer shows live totals across the current view. Makes "who's eating my margin this month?" a one-click question.
- **Per-source-type breakdown** — see which kinds of work drive spend (conversational agents vs scheduled processes vs automated workflows vs platform background) so agencies can price packaging decisions against real cost shapes.
- **Per-provider + per-model breakdown** — with average latency — supports model-routing decisions on hard evidence, not vendor marketing.
- **Cost-runaway triage** — top-cost calls list with one-click detail drawer surfaces the exact prompt context, token counts, provider response metadata, and abort reason for any call that looks anomalous. Continues to work for historical calls via a retention-safe archive.
- **Structured parse-failure capture** — when an LLM returns output that fails schema validation, the failure is recorded with a safe truncated excerpt rather than silently retried or lost. Supports root-cause analysis and prompt-quality improvements.
- **Cancellation-aware billing** — client disconnects and deadline timeouts are distinguished in the ledger, so cost attribution stays honest when a user navigates away mid-response.
- **Double-bill protection on timeouts** — when a provider call exceeds the per-call timeout, the platform genuinely cancels the in-flight network request (rather than abandoning it silently) and refuses to auto-retry under the same logical attempt. Combined with a generous per-call window tuned above every documented provider ceiling, this eliminates the class of "retry storms" where a slow-but-valid generation would previously be abandoned mid-response and re-issued — incurring a second charge at the LLM provider for the same piece of work. Agencies see one billable attempt per logical call.
- **Every terminal attempt produces a ledger row** — timeouts, provider-unavailable, provider-not-configured, auth failures, parse failures, and unrecognised errors all land on the P&L surface as a typed ledger row. No failure mode silently disappears from the cost view; "what just happened to this call?" is always answerable from the ledger, not the logs.
- **Retention-safe historical access** — ledger rows older than the configured retention window (default 12 months) move to a historical archive with the same structure and access controls. Detail lookups continue to work seamlessly; the archive is indexed for year-over-year trend analysis.
- **Real-time in-flight visibility** — every LLM call currently dispatched but not yet resolved shows up in an admin-only live view within milliseconds of dispatch, with provider/model, feature, source attribution, attempt number, and live-ticking elapsed time. Supports long-running reasoning-model calls (up to 10 minutes) without admins having to guess whether a call is stuck. Updates via WebSocket — no polling — and auto-reconciles against the ledger the moment the call lands.
- **Pre-dispatch queue-wait visibility** — the in-flight view surfaces the gap between the moment a call is requested and the moment it actually hits the provider. When a call appears slow, agencies can distinguish "the provider is slow" from "we spent 43 seconds waiting for a budget lock" at a glance — the two look identical on elapsed-time alone but demand completely different responses.
- **Logical-attempt sequencing across fallback providers** — when a call fails over from a primary provider to a fallback, the in-flight view shows the cumulative attempt number across the whole call rather than restarting the counter at 1 for every provider. "This is actually the third attempt of the logical call" is legible at a glance during debugging.
- **Partial-external-success double-bill protection** — a provisional audit record is written before every LLM call. If the provider accepts and bills for a call but the durable cost record fails to write (rare — DB hiccup, constraint violation, crash), a retry under the same logical identity sees the provisional record and raises a typed reconciliation signal instead of re-dispatching. No auto-retry inside the platform — callers own the reconciliation decision. A background sweep reaps provisional records if a crash stops them from resolving so the retry window eventually self-heals. Closes the one class of silent double-bill that request-level idempotency headers (unsupported by every current LLM vendor) would otherwise be the only fix for.
- **Single-terminal-transition invariant** — every terminal status (success, error, timeout, budget-block, etc.) is guarded against silent overwrite. Late-arriving results that race with the provisional-record sweep are detected as ghost arrivals and logged for operator reconciliation rather than silently rewriting the earlier signal. Sweep-classified "expired" outcomes stay authoritative even if the late provider response eventually arrives.
- **Deterministic idempotency-key versioning** — every cost-attribution key carries an explicit version prefix. Changing the key derivation is a deliberate bump rather than a silent drift that would break deduplication across a deploy boundary. A load-time assertion guards the prefix shape.
- **Click-through live payload inspection** — admins can click any in-flight call to see the exact prompt context the platform dispatched, right alongside live elapsed time. Short-TTL in-memory capture bounded to protect platform memory; once the call lands the full detail is preserved on the historical record. Removes the "we'll have to wait until the call finishes to debug it" delay.
- **Forensic in-flight archive** — every dispatch and terminal transition is captured to a short-retention audit log (default 7 days). When an operator asks "what was running at 3:17am last Tuesday during the outage?", the answer no longer requires a server-log grep. Writes are fire-and-forget and gated by a self-disabling soft circuit so a degraded audit path never slows the real-time view.
- **Mobile-responsive operations view** — the in-flight tab renders as a card layout on phones and tablets so on-call response doesn't require a desktop. Same data, same real-time updates.
- **Token-level streaming progress (infrastructure ready)** — the platform supports token-by-token progress events from LLM providers that expose streaming. Admins see a live tokens-so-far indicator alongside elapsed time during multi-minute reasoning generations. Adapter-level wiring to specific providers rolls out as each vendor's streaming API is adopted.

### Memory Injection Utility

| | |
|---|---|
| **Outcome** | Operators see what percentage of injected memory context is actually cited by agents, and which agents have the most and least effective memory — so they can tune memory configuration against evidence rather than intuition |
| **Trigger** | Reviewing agent effectiveness, preparing for a memory-configuration audit, or investigating why an agent keeps repeating information it was already given |
| **Deliverable** | 30-day trend charts (entry citation rate, block citation rate) and a per-agent breakdown table with measured run counts and utility percentages |

- **Entry utility and block utility tracked separately** — workspace memory entries (discrete captured facts) and memory blocks (synthesised summaries) have different citation patterns. Tracking them separately lets operators distinguish "the synthesis is good but the blocks are too long for the agent to use" from "the synthesis is poor and the raw entries are what actually helps."
- **Measured vs. unmeasured run count** — runs before the measurement substrate was added are counted as unmeasured, not as zero-utility. The dashboard never misrepresents old runs as evidence of poor memory injection.
- **30-day rolling window with daily granularity** — the chart shows trend direction, not just a current snapshot. A falling utility score after a memory-configuration change is legible immediately.
- **Per-agent breakdown sorted by entry utility** — agents with fewer than 10 measured runs show "Insufficient data" rather than a misleading low percentage based on one run.
- **Line-chart gaps for missing data** — days with no measured runs render as gaps in the chart line, not as drops to zero. The visual accurately represents data availability.
- **Nightly refresh, live daily series** — the per-agent table refreshes nightly (slight lag expected); the daily-series charts reflect live run data.

### Tier 4 Isolated Code Execution

| | |
|---|---|
| **Outcome** | Agents safely process customer-provided data files, run LLM-generated data transformation scripts, and return structured, validated results — without exposing host infrastructure to untrusted code |
| **Trigger** | Any agent task that requires executing code derived from customer input or generated by an agent over customer data (CSV parsing, document extraction, data normalisation, custom transforms) |
| **Deliverable** | Validated, redacted, schema-confirmed output from an isolated execution environment; structured artefacts stored in object storage; per-execution cost and audit trail |

- **Fully isolated execution environment** — customer-derived code and data run inside an ephemeral, per-task isolated compute environment provisioned on demand. Nothing persists between runs; the environment is released at task completion.
- **Default-deny network posture** — outbound network access is off by default. Tasks that need specific external access declare an explicit allow-list in their policy; all egress is audited.
- **Schema-validated output** — every execution result is validated against a declared output schema before any downstream consumer sees it. Schema failure is a terminal state, never silently passed through.
- **Redaction pipeline** — all outputs (structured result, stdout/stderr logs, artefact filenames) pass through a redaction pipeline before persistence. Credential patterns are scrubbed from every output channel.
- **Cost-ceiling enforcement** — every execution runs with a declared wall-clock ceiling and cost ceiling. The platform terminates executions that exceed either limit and surfaces the terminal reason with full audit detail.
- **Insert-only cost ledger** — compute cost for each execution is recorded as an immutable cost row. Corrections append new rows; existing records are never rewritten. Provides a tamper-evident billing trail.
- **Credential injection, not embedding** — task inputs that require authentication credentials receive them via a secure broker-managed injection into the isolated environment at execution time. Credentials are never embedded in task payloads.
- **Full observability** — each execution emits a structured telemetry event stream (start, terminal, timeout, harvest outcome, artefact uploads, egress decisions) to an RLS-protected table, keyed by run and subaccount for per-client audit access.
- **Local-dev parity** — developers run the same template image locally against the same task inputs, giving identical behaviour between development and production (sans network-policy and cost enforcement, which are provider-specific).
- **Vendor-adapter architecture** — the external compute provider is resolved from a single env-var at service startup. Swapping providers requires only a config change; no adapter code is exposed outside the service boundary.

---

## Skills Reference

Complete list of all 117 skills.

| Column | Meaning |
|--------|---------|
| **Type** | `LLM` = requires LLM to execute, `Deterministic` = no LLM involved, `Hybrid` = may use LLM depending on operation |
| **Gate** | `HITL` = requires human approval before execution, `Universal` = auto-injected on every agent run, `—` = auto-approved |

### Analytics & Reporting

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `analyse_42macro_transcript` | Convert 42 Macro video transcripts into three-tier analysis using GRID/KISS framework | LLM | — |
| `analyse_financials` | Analyse revenue/expense data to produce structured financial summary with ratios | LLM | — |
| `analyse_performance` | Analyse campaign data to identify underperformers and recommend optimisations | LLM | — |
| `analyse_pipeline` | Analyse CRM pipeline for velocity metrics, stage conversion, and forecast accuracy | LLM | — |
| `deliver_report` | Deliver approved client report via email or portal with review gating | Hybrid | HITL |
| `draft_report` | Draft client-facing performance report with executive summary and recommendations | LLM | — |
| `generate_portfolio_report` | Generate cross-subaccount portfolio intelligence briefing | LLM | — |
| `prepare_renewal_brief` | Produce renewal readiness briefing with NPS/CSAT signals, health history, and recommended next steps | LLM | — |
| `read_analytics` | Retrieve social media performance metrics for analysis and reporting | Deterministic | — |
| `read_expenses` | Retrieve expense data from accounting system | Deterministic | — |
| `read_revenue` | Retrieve revenue data from accounting system | Deterministic | — |
| `score_nps_csat` | Analyse NPS/CSAT survey responses to compute segment scores and flag at-risk accounts | LLM | — |
| `synthesise_voc` | Convert voice-of-customer data into structured insight report with themes | LLM | — |

### Content Creation & Publishing

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `create_lead_magnet` | Produce complete lead magnet asset (checklist, template, guide, scorecard) | LLM | HITL |
| `create_page` | Create new page with HTML content, meta tags, and optional form configuration | Hybrid | — |
| `draft_ad_copy` | Draft ad copy variants across platforms with format-specific optimisation | LLM | — |
| `draft_content` | Draft long-form content (blog, landing page, case study, whitepaper) with SEO | LLM | — |
| `draft_post` | Draft social media post copy for multiple platforms with variants | LLM | — |
| `draft_requirements` | Produce structured requirements spec with user stories and Gherkin ACs | LLM | — |
| `propose_doc_update` | Propose specific documentation changes as diff-style proposal | LLM | HITL |
| `publish_page` | Publish draft page to make it publicly accessible | Deterministic | HITL |
| `publish_post` | Submit approved social post for publishing immediately or scheduled | Deterministic | — |
| `update_copy` | Upload approved ad copy to ads platform | Hybrid | HITL |
| `update_page` | Update existing page HTML, meta tags, or form configuration | Hybrid | — |
| `write_docs` | Apply approved documentation update to system | LLM | HITL |
| `write_spec` | Submit requirements spec for human approval before development | LLM | HITL |

### CRM & Contact Management

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `book_meeting` | Propose and schedule a meeting with a prospect or contact via calendar integration | Deterministic | HITL |
| `compute_churn_risk` | Evaluate churn risk signals and produce risk score with intervention recommendation | LLM | — |
| `compute_health_score` | Calculate composite health score (0-100) for account | LLM | — |
| `compute_staff_activity_pulse` | Calculate weighted activity score from canonical CRM mutations; excludes automation users via outlier-volume classifier | Deterministic | — |
| `detect_anomaly` | Compare current metrics against historical baseline and flag deviations | LLM | — |
| `detect_churn_risk` | Analyse account health signals to identify at-risk accounts | LLM | — |
| `discover_prospects` | Find SMB prospects matching geo, vertical, and size criteria via location and business data APIs | Deterministic | — |
| `draft_outbound` | Draft personalised 1:1 outbound prospecting email for a specific lead | LLM | — |
| `scan_integration_fingerprints` | Match canonical artifacts against a seed fingerprint library; emit per-subaccount detections and queue novel observations for operator triage | Deterministic | — |
| `draft_followup` | Draft contextual follow-up email for stale deal or at-risk contact | LLM | — |
| `enrich_contact` | Retrieve enrichment data for contact and write back to CRM | Deterministic | — |
| `read_crm` | Retrieve contact, deal, and pipeline data from CRM | Deterministic | — |
| `crm.query` | Natural-language CRM read via the CRM Query Planner (canonical-first, AI fallback, read-only) | Hybrid | — |
| `score_lead` | Score an inbound or outbound lead against configured qualification criteria | LLM | — |
| `trigger_account_intervention` | Propose intervention action (check-in, pause, alert) | LLM | HITL |
| `update_crm` | Write contact/deal updates to CRM | Deterministic | HITL |

### Calendar & Personal Productivity

User-scoped calendar and Slack skills available to the Personal Assistant. All write operations route through the review queue — nothing executes without the owner's approval.

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `calendar.list_events` | List calendar events in a date range for the connected user | Deterministic | — |
| `calendar.get_event` | Retrieve full detail for a specific calendar event | Deterministic | — |
| `calendar.find_free_slot` | Find available meeting slots across a date range, respecting existing commitments | Deterministic | — |
| `calendar.create_event` | Propose a new calendar event for review before it is created | LLM | HITL |
| `calendar.update_event` | Propose changes to an existing calendar event for review before they are applied | LLM | HITL |
| `calendar.respond_to_invite` | Draft an accept, decline, or tentative response to a calendar invitation for review | LLM | HITL |
| `slack.list_channels` | List Slack channels the connected user is a member of | Deterministic | — |
| `slack.read_channel` | Read recent messages from a Slack channel | Deterministic | — |
| `slack.search_messages` | Search across Slack workspace messages (requires paid Slack plan) | Deterministic | — |
| `slack.summarise_thread` | Summarise a Slack thread into key points and action items | LLM | — |
| `slack.post_message` | Draft a message to a Slack channel for review before posting | LLM | HITL |
| `slack.post_dm` | Draft a Slack direct message for review before sending | LLM | HITL |

### Email & Communication

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `classify_email` | Analyse inbound email to classify by intent, urgency, and routing | LLM | — |
| `draft_reply` | Draft customer support reply using classification and knowledge base | LLM | — |
| `draft_sequence` | Draft multi-step email sequence with personalisation and timing | LLM | — |
| `read_inbox` | Read emails from connected inbox provider | Deterministic | — |
| `send_email` | Send email via connected provider | Deterministic | HITL |
| `send_to_slack` | Post message to Slack channel with optional file attachments | Deterministic | — |

### Campaign & Marketing

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `audit_seo` | Audit page for on-page SEO issues with prioritised findings | LLM | — |
| `audit_geo` | Composite GEO audit — AI search visibility across six dimensions, produces 0-100 GEO Score | LLM | — |
| `geo_citability` | Analyse content extraction quality for AI citation (passage structure, claim density) | LLM | — |
| `geo_crawlers` | Check robots.txt and HTTP headers for 14+ AI crawlers | LLM | — |
| `geo_schema` | Evaluate JSON-LD structured data coverage for AI search consumption | LLM | — |
| `geo_platform_optimizer` | Platform-specific readiness scores for Google AIO, ChatGPT, Perplexity, Gemini, Bing Copilot | LLM | — |
| `geo_brand_authority` | Brand entity recognition, mention density, citation analysis for AI visibility | LLM | — |
| `geo_llmstxt` | Analyse or generate llms.txt — AI-readable site summaries | LLM | — |
| `geo_compare` | Competitive GEO analysis — benchmark against 2-3 competitors across GEO dimensions | LLM | — |
| `generate_competitor_brief` | Research competitor via web search and produce intelligence brief | LLM | — |
| `increase_budget` | Propose budget increase for high-performing campaign | LLM | HITL |
| `pause_campaign` | Propose campaign pause with performance evidence | LLM | HITL |
| `query_subaccount_cohort` | Read board health and memory summaries across subaccounts by tags | Deterministic | — |
| `read_campaigns` | Retrieve campaign data with budget, spend, and performance summary | Deterministic | — |
| `update_bid` | Propose bid adjustment for campaign/ad group | LLM | HITL |

### Admin Operations & Finance

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `chase_overdue` | Draft and send overdue-payment follow-up communications to clients | LLM | HITL |
| `generate_invoice` | Generate a client invoice from engagement records and billing configuration | LLM | HITL |
| `prepare_month_end` | Compile month-end close pack: outstanding invoices, reconciliation exceptions, budget vs actual | LLM | — |
| `process_bill` | Review and propose approval for incoming vendor bills | LLM | HITL |
| `reconcile_transactions` | Match transactions against expected records and flag discrepancies for review | Deterministic | HITL |
| `send_invoice` | Deliver a generated invoice to the client via email with payment link | Deterministic | HITL |
| `track_subscriptions` | Audit SaaS subscription inventory against approved vendor list and flag unexpected charges | Deterministic | — |

### Payment & Financial Operations

Skills that complete transactions autonomously on behalf of agents. All payment operations run through the charge policy engine — each charge is gated against operator-defined spending policies, allowlists, and approval thresholds before execution. A kill switch revokes authorisation at any time.

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `pay_invoice` | Pay an outstanding invoice via the configured payment integration. Feeder for `process_bill`. All payments gated by spending policy. | Deterministic | HITL |
| `purchase_resource` | Complete a one-shot purchase against a vendor's hosted checkout flow. Policy-gated; worker fills the merchant form after authorisation. | Deterministic | HITL |
| `subscribe_to_service` | Activate a vendor subscription via a hosted signup flow. Read mirror: `track_subscriptions`. Policy-gated; worker fills the vendor form after authorisation. | Deterministic | HITL |
| `top_up_balance` | Top up a prepaid balance or credits account via a vendor's hosted top-up flow. Distinct from ad-platform budget operations. Policy-gated. | Deterministic | HITL |
| `issue_refund` | Issue a refund against a prior charge via the payment integration. Creates a new inbound-refund ledger entry; the original charge record is preserved. Policy-gated. | Deterministic | HITL |

### Task & Board Management

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `add_deliverable` | Attach deliverable (artifact/url/file) to task before moving to review | Deterministic | — |
| `create_task` | Create new task on workspace board with title and description | LLM | — |
| `move_task` | Move task to different board column following workflow transitions | Deterministic | — |
| `reassign_task` | Reassign existing task to another agent with handoff context | LLM | — |
| `triage_intake` | Capture ideas/bugs into task board and process untriaged backlog | LLM | — |
| `update_task` | Update task title, description, brief, or priority | LLM | — |

### Development & Code

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `analyze_endpoint` | Probe API endpoint and verify contract compliance | Hybrid | — |
| `create_pr` | Create GitHub pull request from approved applied patches | Deterministic | — |
| `draft_architecture_plan` | Produce structured architecture plan with implementation chunks | LLM | — |
| `draft_tech_spec` | Produce technical specifications (OpenAPI, ERD, sequence diagrams) | LLM | — |
| `read_codebase` | Read file from project codebase | Deterministic | — |
| `review_code` | Perform structured self-review on changed files | LLM | — |
| `run_command` | Execute approved shell commands (git, npm, build) | Deterministic | — |
| `run_tests` | Execute project test suite with optional filtering | Deterministic | — |
| `search_codebase` | Search codebase for files, symbols, or text patterns | Deterministic | — |
| `write_patch` | Propose code change as unified diff for review | LLM | HITL |

### Quality Assurance

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `capture_screenshot` | Launch headless browser to capture screenshot for visual QA | Deterministic | — |
| `derive_test_cases` | Transform Gherkin ACs into structured test case manifest | LLM | — |
| `report_bug` | File structured bug report with severity and confidence scoring | LLM | — |
| `review_ux` | Perform UX review covering mental models, accessibility, and copy | LLM | — |
| `run_playwright_test` | Execute Playwright E2E test file against running application | Deterministic | — |
| `write_tests` | Write or update test files covering unit/integration/e2e scenarios | LLM | — |

### Data & Research

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `fetch_paywalled_content` | Log into paywalled site and download artifact | Deterministic | — |
| `fetch_url` | Make HTTP request to URL and return response body | Deterministic | — |
| `monitor_webpage` | Set up recurring change detection on a URL — fires an agent run each time content changes | Hybrid | HITL |
| `canonical_dictionary` | Query the canonical data dictionary for table metadata, columns, relationships, and freshness expectations | Deterministic | — |
| `read_data_source` | List and read context data sources (agent, subaccount, task scopes) | Deterministic | Universal |
| `scrape_structured` | Extract structured fields from any URL with LLM-assisted first run and adaptive selector healing on subsequent runs | Hybrid | — |
| `scrape_url` | Scrape a URL with automatic tier escalation (HTTP → stealth browser → anti-bot bypass) | Deterministic | — |
| `web_search` | Search web for current information using Tavily AI search | Hybrid | — |

### Memory & Context

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `read_org_insights` | Query cross-subaccount insights stored in org-level memory | Deterministic | — |
| `read_workspace` | Read tasks and activities from shared board with filtering | Deterministic | — |
| `search_agent_history` | Search memories and learnings across agents via vector search | Deterministic | Universal |
| `update_memory_block` | Update shared memory block content for cross-agent context | Deterministic | Universal |
| `write_org_insight` | Store cross-subaccount pattern or insight in org-level memory | LLM | — |
| `write_workspace` | Add activity entry to task for team visibility | Deterministic | — |

### Agent Collaboration

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `ask_clarifying_question` | Pause run and ask user clarifying question — surfaces a `ClarifyingQuestionsCard` artefact in the Brief conversation; run transitions to `awaiting_clarification` until the user replies | LLM | Universal |
| `ask_clarifying_questions` | Structured multi-question clarification skill for complex Briefs — generates a scored question set ranked by informational value; rendered as a collapsible `ClarifyingQuestionsCard` in the Brief UI | LLM | Universal |
| `challenge_assumptions` | Reviews a proposed action or plan and produces a `ChallengeOutput` listing potential concerns by severity (low/medium/high); surfaced on the `ApprovalCard` before the user approves | LLM | Universal |
| `read_priority_feed` | Read, claim, or release prioritised work feed items | Deterministic | Universal |
| `request_approval` | Escalate decision to human operator for review | LLM | — |
| `spawn_sub_agents` | Split work into 2-3 parallel sub-tasks executed simultaneously | LLM | — |
| `list_my_subordinates` | Query direct reports and subtree agents available for delegation (scope-aware) | Deterministic | — |

### Configuration & Integration

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `configure_integration` | Guide workspace integration setup with review gating | LLM | HITL |
| `config_publish_workflow_output_to_portal` | Publish a workflow step's output to the sub-account portal card; upserts the portal brief and marks the run portal-visible (workflow `action_call` steps only) | Deterministic | — |
| `config_send_workflow_email_digest` | Send a markdown email digest to configured recipients with per-run deduplication; irreversible (workflow `action_call` steps only) | Deterministic | HITL |

### Output (operator-facing)

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `output.recommend` | Surface a prioritised recommendation to the operator with automatic de-duplication, cooldowns, and severity-aware display | Deterministic | — |

### Workflow Studio

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `workflow_estimate_cost` | Produce pessimistic cost estimate for candidate workflow | LLM | — |
| `workflow_propose_save` | Record validated workflow definition for admin to save | Deterministic | — |
| `workflow_read_existing` | Load existing workflow file for reference and pattern matching | Deterministic | — |
| `workflow_simulate` | Static analysis pass returning parallelism and critical path | Deterministic | — |
| `workflow_validate` | Run DAG validator against candidate definition | Deterministic | — |

### Skill Authoring

_Skill authoring is now accessed via the agent edit surface (Skills tab). The `skill-author` system agent uses the skills below._

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `skill_propose_save` | Write new skill version and atomically update definition | Deterministic | — |
| `skill_read_existing` | Read current definition and instructions for skill | Deterministic | — |
| `skill_simulate` | Replay proposed skill version against regression fixtures | Deterministic | — |
| `skill_validate` | Validate proposed skill definition against tool schema and Zod rules | Deterministic | — |

### Utility

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `transcribe_audio` | Convert audio/video file to text transcript using OpenAI Whisper | Deterministic | — |

---

## Integrations Reference

> **Machine-readable source of truth:** the same catalogue below is also published as structured YAML at `docs/integration-reference.md` and consumed at runtime by the Capability-Aware Orchestrator. Every integration listed here has a corresponding YAML block declaring its provider type, read/write capabilities, enabled skills, required OAuth scopes, setup contract, status, and `last_verified` date. A static gate (`scripts/verify-integration-reference.mjs`) keeps the YAML in sync with the code-level OAuth providers and MCP presets and blocks drift at CI time.

### External Services

| Service | Auth Type | Capabilities | Scoping |
|---------|-----------|-------------|---------|
| **Gmail** | OAuth2 | Send email, read inbox | Org or subaccount |
| **Slack** | OAuth2 | Post messages, file uploads, thread conversations, HITL buttons (Block Kit), @mention agent dispatch, DM conversations | Org or subaccount |
| **HubSpot** | OAuth2 | Contacts, deals, content; full CRM read/write | Org or subaccount |
| **Go High Level (GHL)** | OAuth2 | Contacts, opportunities, conversations, revenue, funnels, calendars, users, location and business metadata; webhook ingestion (HMAC-SHA256) covering 10 event types — contact / opportunity / conversation create + update, plus INSTALL / UNINSTALL / LocationCreate / LocationUpdate for sub-account lifecycle tracking; agency-level OAuth (one token per org + GHL company, location tokens minted on demand per sub-account) — pending Stage 6b sign-off | Org (agency-scoped) or sub-account (location-scoped) |
| **GitHub** | GitHub App | Fine-grained per-repo access, webhook events (issues, PRs, pushes), task creation from events | Org or subaccount |
| **Teamwork Desk** | OAuth2 | Project and task management | Org or subaccount |
| **Stripe** | API adapter | Payment transactions and subscription data | Org |
| **OpenAI** | API key | LLM provider, Whisper transcription | System |
| **Anthropic (Claude)** | API key | LLM provider | System |
| **OpenRouter** | API key | LLM cost-optimised routing | System |
| **Tavily** | API key | Web search | System |

### Workflow Engines

| Engine | Type | Features |
|--------|------|----------|
| **n8n** | Self-hosted | Workflow execution with HMAC-signed callbacks |
| **Make** | Cloud | Workflow execution with webhook integration |
| **GHL Workflows** | Cloud | Native GHL automation flows |
| **Custom Webhook** | Any | Generic webhook adapter with configurable auth |

### Data Sources

| Source Type | Formats | Loading |
|------------|---------|---------|
| **Cloudflare R2** | JSON, CSV, Markdown, Text | Eager or lazy |
| **AWS S3** | JSON, CSV, Markdown, Text | Eager or lazy |
| **HTTP URL** | Auto-detected | Eager or lazy, with encrypted headers |
| **Google Drive (live)** | Google Docs (text), Google Sheets (CSV), PDF | OAuth-authenticated, live — fetched at run time, cached, always current |
| **Dropbox** | Auto-detected | OAuth-authenticated |
| **File Upload** | Any supported format | Direct upload to R2/S3 |

### Communication Channels

| Channel | Direction | Features |
|---------|-----------|----------|
| **Email (SendGrid)** | Outbound | Transactional + agent-sent, HITL approval |
| **Email (SMTP)** | Outbound | Fallback provider |
| **Slack** | Bidirectional | Agent conversations, HITL buttons, file attachments |
| **Webhooks** | Bidirectional | HMAC-signed outbound, verified inbound |
| **Client Portal** | Outbound | Self-service access for clients |
| **Pages** | Outbound | Published content with form submissions |

### MCP (Model Context Protocol)

| Feature | Detail |
|---------|--------|
| **Transport** | `stdio` (subprocess) or `http` (remote server) |
| **Credential binding** | Any OAuth provider can supply credentials to MCP servers |
| **Tool filtering** | Per-server allowed/blocked tool lists |
| **Gate overrides** | Per-tool gate level (auto/review/block) |
| **Connection modes** | Eager (connect at startup) or lazy (connect on first use) |
| **Scrapling preset** | Anti-bot web scraping sidecar (`uvx scrapling mcp`) — Cloudflare bypass, stealth browsing; used as Tier 3 of the scraping engine |
| **Call observability** | Every MCP tool call attempt (including retries) is logged to an append-only ledger with status, duration, response size, and gate level — per-server and per-run summaries available on run detail |
| **MCP cost attribution** | MCP call counts roll up into the same cost-aggregate pipeline as LLM spend — org, subaccount, run, and per-server monthly breakdowns; test-run calls excluded from P&L |

---

## Changelog

| Date | Change | Commit |
|------|--------|--------|
| 2026-05-18 | Task Intake (new-task-modal-overhaul PR): rename Universal Brief capability to Task Intake. Route family updated from `/api/briefs/*` to `/api/task-intake`. New intake fields: `assignedAgentId`, `dueDate` (YYYY-MM-DD with subaccount-tz conversion), `priority`. Capability registry row ID changed from `universal-brief` to `task-intake`. | — |
| 2026-05-17 | Reposition Core Value Proposition, Frame, One-sentence answer, Messaging north star, Structural differentiators, Objection handling, GTM application guidance, "What Synthetos is NOT trying to be", and "Non-goals" around the business-operations buyer rather than the agency-only buyer. Adopt headline tagline: **"the governed operating system for AI-run business operations."** Add **Runtime pluralism** as the first structural differentiator and **Audit and lineage as a system** as the last. Add objection rows covering productivity-suite copilots, the LLM provider's hosted agent product rolled out by internal IT, an agent-runtime ecosystem growing upward into governance, and a better agent runtime shipping. Add **Not a better agent runtime or execution sandbox** non-goal. Reframe Client portal → Stakeholder and client-facing surfaces; Agency economics → Operational cost governance; agency-portfolio language → org-portfolio language with agencies retained as a first-class ICP. Extend the editorial reminder to include agent-runtime category vocabulary. | — |
| 2026-05-12 | Subscription-Driven Long-Task Execution: add product capability section covering subscription-mediated long-form tasks, automatic session continuity (chain-resume), persistent browser context per task, graceful session-unavailability fallback to direct billing, subscription-mediated cost attribution, and per-subaccount session limits. Vendor-neutral; reflects the Operator Backend build (operator-backend branch). | — |
| 2026-05-07 | Consolidation Build: retire 9 legacy admin pages (AdminAgentsPage, AdminAgentEditPage, AdminSkillsPage, AdminSkillEditPage, SkillStudioPage, SkillAnalyzerPage, SystemAgentsPage, ScheduledTasksPage, GoalsPage) into 4 consolidated Build-stream pages (AgentsListPage, AgentEditPage, RecurringTasksPage, ProjectEditPage). Skill authoring now accessed via AgentEditPage > Skills tab. Goals migrated to ProjectEditPage. Skills Reference section "Skill Studio" renamed "Skill Authoring" to reflect consolidated entry point. See ADR 0007. | — |
| 2026-05-04 | F1 Sub-Account Baseline Artefacts (migration 0277): sub-accounts now capture six baseline artefacts at onboarding via the baseline-artefacts-capture workflow. Brand identity and voice/tone (tier 1) are prepended to every client-touching agent run system prompt in hash-stable order for prefix caching. Offer positioning and audience profile (tier 2) are injected when the agent role matches the artefact domain. Operating constraints and proof library (tier 3) are stored in workspace memory and retrieved on demand. Artefact capture status is tracked per sub-account in a versioned JSONB field. The onboarding wizard includes a dedicated capture step; captured artefacts are editable from the sub-account Knowledge page. | — |
| 2026-05-04 | Agent Spending: ship the agent spending primitive — operator-defined Spending Budgets per sub-account with hard ceiling, daily and monthly caps, and a kill switch that pauses all charges immediately and is re-checked at execute time. Each budget carries a Spending Policy with per-transaction limits, merchant allowlists, approval thresholds, and category rules; policies start in shadow mode (full decision logic, no money moved) and require an explicit approval to promote to live. Per-charge approval gates pause high-risk charges before execution; expired approvals re-queue rather than executing late. Multi-channel approval routing supports per-sub-account and shared agency-level channels. Five payment skills (`pay_invoice`, `purchase_resource`, `subscribe_to_service`, `top_up_balance`, `issue_refund`) all route through one charge router for uniform policy decisions, idempotency, and ledger writes. Immutable spend ledger as append-only audit trail with database-level lifecycle guards; settled-vs-in-flight visibility distinguishes money moved from money committed. Refunds preserve the original charge record by writing a new inbound-refund ledger entry. Tenant-isolated at the database level for budgets, policies, channels, and ledger rows. Compute Budget rename (formerly "Budget") clears the namespace for the new spending primitive — vocabulary lock: no bare "Budget" in the product. | — |
| 2026-05-03 | GHL agency-level OAuth: agency token stored per org + GHL company (`connector_configs.token_scope='agency'`), location tokens minted on demand per sub-account and cached in `connector_location_tokens`. Nine adapter methods use location-scoped tokens; two (list-locations, get-location) use the agency token. Pending Stage 6b sign-off. | — |
| 2026-05-01 | Skills Reference: add invoke_automation as the eighth Workflow step type (PR #186); add 14 new system-agent v7.1 skills across Admin Operations & Finance, CRM & Contact Management, and Analytics & Reporting categories; remove retired update_financial_record skill (PR #212/#216). | — |
| 2026-04-24 | System Monitor (Phase 0 + 0.5): fingerprint-deduplicating incident pipeline that surfaces production failures — route errors, job DLQ landings, agent run failures, connector sync failures, skill terminal failures, LLM provider exhaustion — as actionable incidents on a sysadmin dashboard. Incidents deduplicate by SHA-256 fingerprint, auto-escalate severity on repeated occurrence, and support ack / resolve / suppress / escalate-to-agent lifecycle. Resolution links back to the agent task so operators see the full remediation chain. AlertFatigueGuard refactored to a shared base class so push-notification rate-limiting (Phase 0.75) uses the same per-run + per-day cap logic. Live nav badge + WebSocket push via a dedicated sysadmin room. Self-check job surfaces ingest pipeline degradation as a self-referential incident. | — |
| 2026-04-23 | Paperclip Hierarchy: per-sub-account lead-agent guarantee (exactly one active lead at all times, atomic rotation, degraded-fallback + health signal if ever missing), scoped delegation enforcement (children / subtree / sub-account) at execution time, visible delegation graph per run (DAG view with direction + scope inline, up to 5 levels), starter team templates for one-step sub-account setup, and observable delegation ledger with idempotent writes. Three new workspace-health detectors (multiple leads, no lead, orphaned delegation skills) bring the detector total to 10. | — |
| 2026-04-22 | Universal Brief v1: ship the chat-first entry point. Polymorphic conversation model spans Briefs, tasks, agent runs, and agent configuration on a single transport-only table. Fast-path classifier short-circuits chatter and low-stakes intents before the Orchestrator runs. Typed artefact contract (structured result / approval card / error) persists per turn with client-side lifecycle resolution (chains / superseded / orphans / out-of-order arrival). Backend write-time integrity guard enforces "a parent result cannot be superseded twice" with idempotent re-writes. Per-write artefact cap with explicit rejection so runaway capability emission fails loud. Deterministic "Thinking…" pending-assistant state with 15-second fallback. Synchronous double-send protection via the shared conversation hook. Quality-gated rule capture — approval-suggested or low-confidence rules start paused for human review. Structured per-turn signal in the write response plus scraped operational counters (conflict total / over-limit total / validation-rejected total). Task-board and agent-run detail pages both embed the same conversation surface. | — |
| 2026-04-22 | CRM Query Planner (P1–P3): add deterministic-first natural-language CRM query layer with canonical registry (Stage 1), in-process plan cache (Stage 2), AI fallback with single-escalation retry (Stage 3), and hybrid execution for canonical-base-plus-live-filter intents. Read-only by construction (CI guard + structural import restriction). Per-query trace, per-workspace cache isolation, per-query cost ceiling, router-level budget breaker, subaccount-level capability gate, row-level tenant isolation via principal session context. Dual surface: HTTP endpoint + `crm.query` agent skill. Observability dashboard surfaces stage-hit rate, escalation rate, live-call rate, cost-per-resolved-query. | — |
| 2026-04-21 | LLM Spend Observability follow-ups — 8 deferred items from the in-flight tracker brief land as one release. Partial-external-success double-bill protection: a provisional audit record is written before every LLM call, a retry under the same logical identity sees the provisional record and surfaces a typed reconciliation signal instead of re-dispatching, and a background sweep reaps orphaned provisional records after the provider timeout ceiling. Single-terminal-transition invariant: every terminal status is guarded against silent overwrite; late-arriving results are detected and logged as ghost arrivals. Pre-dispatch queue-wait visibility surfaces the gap between call request and provider dispatch. Logical-attempt sequencing shows the cumulative attempt number across fallback providers. Click-through live payload inspection lets admins see the exact prompt context before the call completes. Forensic in-flight archive captures every dispatch + terminal transition for 7-day incident reconstruction, gated by a self-disabling soft circuit on write degradation. Mobile-responsive operations view. Token-level streaming progress infrastructure (adapter wiring rolls out per-vendor). Deterministic idempotency-key versioning with load-time shape assertion. | — |
| 2026-04-20 | LLM cost protection — provider-call timeout hardening. The internal per-call timeout guard now genuinely aborts the underlying network request on timer fire (previously the outer promise rejected while the fetch kept running, so the retry loop fired a second concurrent call and the platform was double-billed upstream). The cap was raised from 30 s to 600 s — above every documented provider ceiling including reasoning models — so legitimate long generations (skill analyzer, long-form outputs, reasoning-mode responses) stop tripping false-positive timeouts. Ambiguous-state failures (timeouts, network resets) are now classified non-retryable, so a second billable provider call is never issued under the same logical attempt. Together these close the root cause behind the skill-analyzer timeout bug that triggered the LLM observability work. | — |
| 2026-05-09 | Agent Workspace (Chunk 13): add Persistent Agent Workspace product capabilities section (always-on visibility, named presence states, knowledge in use, files produced, working time accounting, home page live widget); add Hosted VM-per-agent platforms row to Replaces / Consolidates; reframe Sandboxed Runtime (IEE) intro to operator-benefit language; add working time accounting bullet to Execution Infrastructure. Create `docs/sales-conversation-vm-question.md` internal sales reference. | — |
| 2026-05-08 | Memory & Knowledge System: add semantic document retrieval (chunked, ranked at run start), three retrieval modes (auto, always-available, reference-only), Add to Knowledge promotion flow, and always-available budget guidance. Vendor-neutral; reflects auto-knowledge-retrieval build (PR #274). | — |
| 2026-04-20 | LLM Spend Observability & Per-Client P&L: add new Agency Capability section covering cross-client financial dashboard, attribution-per-call (source type + feature tag), platform overhead surfacing, per-org / per-subaccount / per-source-type / per-provider+model breakdowns with sort + totals, top-cost call triage with detail drawer, structured parse-failure capture, cancellation-aware billing, and retention-safe historical access (12-month default retention with on-demand archive lookup). | — |
| 2026-04-19 | ClientPulse Phases 4 + 4.5 — intervention pipeline + Configuration Agent extension. Adds 5 namespaced CRM-side action primitives (`crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`), all review-gated; an event-driven scenario detector (`proposeClientPulseInterventionsJob`) that fires after every churn assessment and quotas proposals at the org + subaccount layer; an hourly outcome-measurement job that closes B2 with band-change attribution within 14 days; a strict V1 merge-field resolver (5 namespaces, no fallback / no conditionals) with editor live-preview; the Configuration Assistant tool #29 `config_update_organisation_config` that closes B3 (config_history audit on every write) + B5 (sensitive paths route through the action→review queue); and operator-facing UI for both the Propose Intervention modal (5 editors + wrapper) and the Configuration Assistant chat popup. Lifecycle event `clientpulse.intervention.enqueued` is the single observability anchor for both scenario-detector and operator-driven proposals. | — |
| 2026-04-19 | Sandboxed Runtime (IEE): add live-progress-on-long-running-browser-tasks bullet (real-time step count + heartbeat surfacing during delegated browser execution) and connection-health-validation bullet (on-demand login test for stored credentials before depending on them in a workflow). Reflects the IEE Phase 0 delegation lifecycle and Web Login Connection "Test Connection" UI. | — |
| 2026-04-17 | Capability-aware Orchestrator + Platform Feature Request Pipeline: add two new customer-facing Product Capabilities sections covering deterministic four-path task routing (A configured / B narrow-configurable / C broad-configurable / D unsupported), atomic capability matching (capability map + active connection + granted scopes), graceful reference-degradation, auditable decision records, per-run budget, post-handoff verification, and the structured feature-request pipeline with system-promotion detection, 30-day dedupe, multi-channel delivery, and dogfooded task-board triage. Add machine-readable-source callout on Integrations Reference pointing to `docs/integration-reference.md` as the structured YAML backing the runtime capability catalogue. | — |
| 2026-04-17 | MCP call observability and cost attribution: add call observability and MCP cost attribution rows to MCP integrations table | — |
| 2026-04-16 | Execution infrastructure hardening: exactly-once execution guarantees, real-time streaming, usage guardrails, test fixture integrity. Sharpen Execution Infrastructure differentiator and product section language. Update Inline Run Now bullet with live streaming and deduplication detail. | — |
| 2026-04-16 | Hosted-routine / scheduled-prompt product-category positioning refresh: add Portfolio-wide scheduled-work visibility and Supervised migration from no-code workflow tools to Structural Differentiators; add "I'll use a hosted routines product from an LLM provider" objection row; sharpen existing scheduled-prompt objection row with portfolio-calendar and client-portal proof points; expand Replaces / Consolidates with hosted-routine and no-code migration rows; add portfolio calendar + inline Run Now test bullets to AI Agent System; add no-code migration wedge bullet to Playbook Engine; add discovery-call demo and "why not hosted routines" conversation bullets to GTM guidance. Ships in the same commit as `docs/routines-response-dev-spec.md`. | — |
| 2026-04-15 | Phase G onboarding-playbooks: add `action_call` step type + portal publishing + email digest + knowledge bindings + onboarding auto-start to Playbook Engine; add portal brief cards to Client Portal; add `config_publish_workflow_output_to_portal` and `config_send_workflow_email_digest` to Configuration & Integration skills; update skill count 108→110 | — |
| 2026-04-14 | Apply Editorial Rules across customer-facing sections — scrub all named LLM / AI providers and their products from Positioning, Replaces / Consolidates, and Product Capabilities; rewrite in generic, vendor-neutral, marketing-appropriate language. Add Editorial Rules section and neutralise "default provider" language in Integrations Reference. Persist editorial rules in `CLAUDE.md`. | — |
| 2026-04-14 | Add Positioning & Competitive Differentiation section (framing, structural differentiators, objection handling, GTM guidance, messaging north star); reframe Developer Tools (IEE) as Sandboxed Runtime with browser automation as the primary mode; extend Replaces / Consolidates table with rows covering shared team chat, scheduled-prompt tools, hosted single-agent platforms, self-build agent SDKs, and single-provider lock-in | — |
| 2026-04-13 | Fix skill count: 100 skills (not 101); add 4 missing route entries (ClientPulse, GHL, Modules, Onboarding) to architecture.md; update migration list to 0109; fix project structure job list | — |
| 2026-04-13 | Add scrape_url, scrape_structured, monitor_webpage skills; add Scrapling MCP preset; expand Competitor Intelligence with automated monitoring capabilities | — |
| 2026-04-13 | Tighten Replaces table with "why it's better" column | — |
| 2026-04-13 | Tighten Product language to benefit-oriented; sharpen Agency with constraints; fix Hybrid type on create_page/update_page; add Replaces / Consolidates section | — |
| 2026-04-13 | Add Core Value Proposition; compress Product Capabilities; reframe Agency to outcomes; add Type column to Skills | — |
| 2026-04-12 | Initial capabilities registry created from full code audit | — |

---

## Non-goals: what Automation OS is NOT

These are durable product stances. When an LLM provider, agent-runtime project, or horizontal agent platform ships a new primitive (routines, agent SDKs, skills, memory, hosted managed agents, execution sandboxes, team chat), the reflex should be to **absorb the category into this capabilities registry's positioning, ship any UX polish that closes a demo gap, and never drift the pitch toward parity with the provider's primitive.** The moat is the governed operations layer, not any one feature.

- **Not a better agent SDK.** Consume LLM-provider primitives under the hood rather than competing with them.
- **Not a better agent runtime or execution sandbox.** Agent-runtime ecosystems are consolidating with serious capital behind them. We integrate with the leading runtimes as interchangeable supply; we do not compete with them.
- **Not a hosted routines / scheduled-prompt product.** We build the governed operations layer on top of supply from every provider and runtime — multi-tenant isolation, approval workflows, stakeholder portals, operational cost attribution, audit lineage, model-agnostic and runtime-agnostic routing — surfaces a provider's or runtime's hosted product structurally cannot ship, because their buyer is an individual or an internal engineering team, not the operations function running production systems across multiple business units or client books.
- **Not a general-purpose chat UI.** LLM-provider chat surfaces are excellent at what they do. The Synthetos chat surface exists for agent supervision and task context — not as a general-purpose LLM interface.
- **Not a standalone IDE or developer platform.** The sandboxed dev mode inside IEE exists for org-level extensibility — not as a competitor to general-purpose coding assistants.
- **Not a commodity workflow automation tool.** Commodity workflow tools compete on "connect X to Y." Synthetos competes on "run agents responsibly across multi-tenant business operations with approval workflows."
- **Not a public skill or playbook marketplace.** Hyperscaler-scale distribution is not the business-operations play.
- **Not a bidirectional bridge to no-code workflow tools.** We import from them (supervised-migration wedge); we do not export back.

If a PR, marketing asset, or sales deck drifts toward a non-goal, push back. The right response to a provider or runtime shipping a new primitive is never "we have that too" — it is "we are the governed operating system you use on top of that."
