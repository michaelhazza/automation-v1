# Automation OS — Capabilities Registry

> **Last updated:** 2026-04-14 (Editorial rules applied — customer-facing sections scrubbed of named LLM providers; generic, vendor-neutral positioning language throughout)
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

---

## Table of Contents

- [Core Value Proposition](#core-value-proposition)
- [Positioning & Competitive Differentiation](#positioning--competitive-differentiation)
- [Product Capabilities](#product-capabilities)
  - [Multi-Tenant Platform](#multi-tenant-platform)
  - [Authentication & Access Control](#authentication--access-control)
  - [AI Agent System](#ai-agent-system)
  - [Skill System](#skill-system)
  - [Playbook Engine](#playbook-engine)
  - [Human-in-the-Loop](#human-in-the-loop)
  - [Task Board & Workspace](#task-board--workspace)
  - [Unified Inbox](#unified-inbox)
  - [Memory & Knowledge System](#memory--knowledge-system)
  - [Workspace Health & Diagnostics](#workspace-health--diagnostics)
  - [Activity & Analytics](#activity--analytics)
  - [Client Portal](#client-portal)
  - [Pages & Content Builder](#pages--content-builder)
  - [Integration Framework](#integration-framework)
  - [Execution Infrastructure](#execution-infrastructure)
  - [Sandboxed Runtime (IEE)](#sandboxed-runtime-iee)
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

Automation OS enables organisations to:

- **Deploy AI agents as a structured workforce** — not chat toys, but role-based agents with defined skills, budgets, and accountability
- **Automate multi-step operations with human oversight** — playbooks, approval gates, and review queues keep humans in control of every sensitive action
- **Operate across multiple clients with strict isolation** — multi-tenant from the ground up, so agencies can scale without cross-contamination
- **Build institutional knowledge that compounds** — every agent run feeds memory, briefings, and cross-agent learning back into the system

---

## Positioning & Competitive Differentiation

> **Read this before writing any marketing or sales content.** LLM providers and horizontal agent platforms are increasingly shipping overlapping primitives — agents, skills, scheduled runs, memory, team chat. The Synthetos pitch is **not** about having those. It is about what sits on top of them.
>
> **Editorial reminder:** never name a specific LLM or AI provider (or their products) in this section. Use generic category language — *"LLM providers," "foundation model vendors," "hosted agent platforms," "shared team chat products," "scheduled-prompt tools," "agent SDKs."* See the Editorial Rules at the top of this document and `CLAUDE.md` for the full rule set.

### The frame

LLM providers sell **primitives**: a model, an SDK, scheduled runs, hosted agents, a skills format, a team chat surface. They are capability providers.

**Synthetos sells an operations system that happens to run agents.** That distinction is the whole commercial argument. If the pitch drifts toward "we have agents and skills and scheduling," the pitch loses — those are becoming commodities faster than anyone expected. Keep the pitch on the operations layer: multi-tenant isolation, approval workflows, agency economics, client-facing surfaces, vertical depth.

### The one-sentence answer

> LLM providers give you a model. Shared team chat products give you group conversations. Scheduled-prompt tools run one prompt on a cadence. Hosted agent platforms give you a single agent at a time. **Synthetos is the operations system an agency uses to run its business on top of all of that** — with multi-client isolation, white-label portals, approval workflows, playbooks, margin tracking, and vertical skills.

### Messaging north star

> **"LLM providers sell capability. Synthetos sells the business."**

Every feature brief, positioning slide, and marketing asset should pass this test: does it reinforce that Synthetos is the system of record for agency operations, with LLM providers as supply underneath? If the asset only describes agents, skills, or automation in the abstract, it is indistinguishable from a capability provider — rewrite it.

### Structural differentiators

These are the moats LLM providers and horizontal agent platforms structurally cannot ship, because their buyer is an individual or an internal team — not an agency serving many clients with strict isolation and service-provider economics.

| Differentiator | Why it's structural |
|---|---|
| **Multi-tenant three-tier isolation** (System → Org → Subaccount) | LLM provider platforms assume a single buyer. Synthetos is built for agencies managing many clients with strict data, memory, skill, and billing isolation enforced at every layer. |
| **Human-in-the-loop as a system** | 42+ review-gated actions, approve-with-edits, side-effect classification (irreversible steps never auto-retry), rejection as training signal, per-action gate overrides. Agencies cannot deploy unsupervised agents on client accounts. The review system **is** the product. |
| **Playbook engine with multi-step approval gates** | Scheduled-prompt tools run one prompt on a cadence. Hosted agent platforms are single-agent. Synthetos runs multi-step workflows with parallel execution, templating between steps, cost simulation, versioning, and save-as-PR authoring. |
| **Client portal and white-label surface** | LLM providers will not build this — their buyer is the producer, not the consumer of the producer's work. A permanent wedge for agencies serving end-clients. |
| **Agency economics** | LLM usage ledger with full org → subaccount → run → skill cost attribution, org-level margin configuration, pre-reserved budgets, and cost circuit breakers. Agency P&L (revenue, per-client pricing, per-client margin reporting) is on the roadmap as a first-class surface. LLM providers sell tokens; they do not care what agencies bill. |
| **Integration framework with managed connectors** | Generic integration protocols are just protocols. Synthetos is a managed integration product with pre-built OAuth flows for the tools agencies already use (CRM, ads, accounting, communication, support desks) — plus connection scoping (org-shared vs subaccount-specific), sync lifecycle (backfill → transition → live), credential rotation, and webhook verification. |
| **Execution infrastructure maturity** | Idempotency on every run path, pre-reserved budgets with advisory locks, dead-letter queues, loop detection, crash-resume checkpoints, correlation IDs for tracing, workspace health detectors surfacing configuration drift. Table stakes for production agent fleets — absent from every "quickstart" agent platform. |
| **Vertical depth** | GEO (AI search visibility), Churn Detection with composite health scoring, Portfolio Intelligence across clients, Campaign bid adjustments, financial transcript analysis. LLM providers ship primitives; Synthetos ships solutions. Verticals compound into pricing power. |
| **Model-agnostic routing** | Per-skill routing across every frontier and open-source LLM. Building on any one provider's managed stack locks agencies to that provider's pricing and roadmap. Synthetos routes to the best model per task and insulates agencies from provider shifts. |

### Objection handling — "Why Synthetos when I can just use the tools from my LLM provider?"

| Objection | Response |
|---|---|
| *"I'll manage my clients in a shared team chat product."* | Shared team chat is built for internal teams sharing context — your clients would see each other's data. Synthetos enforces strict isolation at every layer so per-client data, memory, and configuration never cross. |
| *"I'll use a scheduled-prompt tool for scheduling."* | Scheduled-prompt tools run one prompt on a cadence. Synthetos runs multi-step playbooks with human approvals, cost ceilings, retry policies, idempotent execution, and parallel step execution. Different product category. |
| *"Hosted agents are autonomous — perfect."* | Which is exactly why agencies can't put them on a client's CRM, ad account, or accounting system. 42+ review gates, approve-with-edits, and side-effect classification are not optional for regulated client work — they **are** the trust product agencies need. |
| *"I'll build on an agent SDK directly."* | Great — Synthetos uses LLM-provider primitives under the hood. But agencies still need multi-tenant isolation, approvals, client portals, playbooks, managed integrations, margin tracking, health monitoring, and a unified inbox. That is 18+ months of engineering not spent on client work. |
| *"What if an LLM provider ships multi-tenant?"* | They won't — their buyer is not agencies. Even if one did, vertical skills, managed integrations, the client portal, and model-agnostic routing remain. The moat isn't any one feature; it's the operations system. |
| *"What if a better model ships?"* | Synthetos routes to it per skill. No migration. Build on a single provider's managed stack and that question becomes a year-long project. |
| *"We already use a commodity workflow automation tool."* | Those are stateless trigger-action chains. Synthetos is stateful, agent-driven, and designed around human approval gates for high-stakes actions (publishing, CRM writes, budget changes). |

### What Synthetos is NOT trying to be

These are **explicit non-goals**. Competing on them is a losing fight against vendors with more capital and a different buyer.

- **Not a better agent SDK.** LLM providers build the models and the SDKs; consuming them under the hood is cheaper than competing with them.
- **Not a better general-purpose chat UI.** LLM-provider chat surfaces are excellent at what they do. The Synthetos chat surface exists for agent supervision and task context — not as a general-purpose LLM interface.
- **Not a standalone IDE or developer platform.** The sandboxed dev mode inside IEE exists for organisation-level extensibility (custom apps or scripts that support bespoke processes) — not as a competitor to general-purpose coding assistants.
- **Not a commodity workflow automation tool.** Commodity workflow tools compete on "connect X to Y." Synthetos competes on "run agents responsibly across many clients with approval workflows."

### How to apply this in GTM content

- **Lead with the operations system, not the agents.** The phrase "Synthetos is an agent platform" is a downgrade. "Synthetos is the operations system agencies run their business on" is the right frame.
- **Show the client-facing surface early.** Screenshots of the client portal, review queue, and per-client P&L convert better than agent-chat screenshots — they look like a product competitors can't match.
- **Use "agency" explicitly in headlines.** Horizontal positioning invites horizontal comparisons. "For agencies serving multiple clients" pre-filters for ICP and pre-loads the isolation / approval / portal story.
- **Position LLM providers as supply, not threats.** *"Model-agnostic across every frontier and open-source LLM — we route to the best one per task."* This inoculates against "why not just use [provider]?" before it's asked, without naming any individual provider.
- **Avoid autonomous-agent language.** "Autonomous" is the wrong promise for agencies on client accounts. Prefer "supervised," "approved," "reviewed," "accountable."

---

## Product Capabilities

### Multi-Tenant Platform

Three-tier hierarchy that isolates data and configuration at every level — so agencies never mix client data, and clients never see each other.

- **System tier** — Platform-wide defaults, system-managed agents, global skill library, playbook templates
- **Organisation tier** — Agency-level workspace with its own users, agents, skills, memory, branding, and billing
- **Subaccount tier** — Per-client workspace with its own agent links, task board, review queue, data sources, and memory
- Strict data isolation enforced at every layer (database, service, and API) with full audit history preserved
- Subaccount tags for cohort queries; guided onboarding wizard for new orgs

### Authentication & Access Control

Five roles, granular permission keys, and a flexible permission-set system — so every user sees exactly what they need and nothing more.

- **Roles:** `system_admin`, `org_admin`, `manager`, `user`, `client_user`
- Custom permission sets assignable to roles; access enforced at both API and UI level
- Secure auth with rate-limited login, email invitations, and self-service password reset
- Permissions-driven UI — buttons, tabs, and pages hidden when the user lacks the required key

### AI Agent System

Autonomous AI agents organised in a three-tier hierarchy (system > org > subaccount) with configurable models, skills, and execution policies.

- **Three-tier model:** System agents (platform-managed, immutable prompts) cascade to Org agents (full control) and Subaccount agents (per-client overrides)
- **Hierarchical roles:** CEO, Orchestrator, Specialist, Worker — agents can hand off work up to 5 levels deep
- **Real-time chat** — Conversational interface with tool result cards, typing indicators, and session history
- **Flexible scheduling:** Heartbeat polling (minute-level precision), cron expressions with timezone, or event triggers (`task_created`, `task_moved`, `agent_completed`)
- **Execution control:** Per-run token budgets, cost ceilings, tool call limits, concurrency policies, and catch-up policies
- **Knowledge sources:** Per-agent data files (R2, S3, HTTP, Google Docs, Dropbox, uploads) with token budgets and caching
- Agent templates for rapid team deployment; full run history with execution traces; idempotent deduplication on all run paths

### Configuration Assistant

AI-powered conversational configuration for agents, skills, schedules, and data sources. Helps org admins set up and manage their platform through natural language.

- **Org-scoped system agent** — runs at org level with read/write access to all subaccounts
- **28 dedicated tools** — 15 mutation (review-gated), 9 read-only, 4 validation/history
- **Plan-approve-execute flow** — agent proposes a structured plan; user reviews and approves; server executes deterministically
- **Config history** — generic JSONB changelog tracking 14 entity types with version restore
- **Knowledge architecture** — three-layer knowledge (platform docs, skill descriptions, existing org config) enables cold-start and pattern replication
- **Safety guards** — self-modification prevention, org subaccount restriction, four-layer scope enforcement
- **Module-gated** — available in automation_os, agency_suite, and internal subscriptions

### Skill System

100 modular skills across 13 categories, cascading from system to org to subaccount.

- **Four-tier resolution:** System skills (system_skills table) -> Built-in skills (skills table, org=null) -> Org skills (custom) -> Subaccount skills (custom, workspace-scoped)
- **Subaccount-level skills** — Workspaces can create custom skills that shadow org/system skills by slug. Managed via dedicated API routes and SubaccountSkillsPage
- **Per-agent allowlists** — Each subaccount-agent link specifies exactly which skills are available
- **Skill Studio** — Authoring environment with definition editor, regression simulation, version history, and rollback. Supports system, org, and subaccount scopes
- **Comprehensive version history** — Every skill mutation (create, update, merge, restore, deactivate) writes an immutable `skill_versions` row via `skillVersioningHelper`. Parent-row locking prevents version number races. Idempotency keys on retry-prone paths (analyzer, restore)
- **Batch resolution** — `resolveSkillsForAgent` resolves all slugs in a single query with in-memory precedence, replacing N+1 per-slug queries
- **Instruction payload guard** — Total skill instructions capped at 100K chars to prevent LLM context blowout
- **Config backup/restore** — Skill analyzer jobs produce point-in-time backups; restore writes version history with `changeType: 'restore'` / `'deactivate'`
- **Review gating** — 42+ skills require human approval; 6 deterministic skills run without LLM
- Topic filtering dynamically reorders skills per message; skill modules enable bulk management
- See [Skills Reference](#skills-reference) for the full catalogue

### Playbook Engine

Multi-step workflow automation with dependency graphs, parallel execution, branching logic, and human review gates.

- **Six step types:**
    - `user_input` — structured form captured from a human operator or client
    - `prompt` — direct one-shot LLM generation
    - `agent_call` — hand the step off to a full agent with its skill surface
    - `agent_decision` — small, schema-bound agent call that returns a structured choice (e.g. routing, classification, approve/edit/reject) the engine uses to branch
    - `conditional` — deterministic branching on expressions over prior step outputs
    - `approval` — blocking human review gate before downstream steps run
- **Five run modes:** `auto` (hands-off), `supervised` (pauses at every approval), `background` (silent batch), `bulk` (one run per item in a list), `replay` (re-execute a prior run with the same inputs)
- **DAG execution** — Steps declare dependencies; independent branches run in parallel; templating passes outputs between steps
- **Safety controls** — Irreversible steps cannot be auto-retried; per-step retry policy; every step declares a side-effect class; concurrency guards prevent double execution
- **Run-now + schedule** — Any recurring playbook can be launched immediately on setup; the normal schedule continues afterward
- **Playbook Studio** — Chat-based authoring with validation, simulation, and cost estimation; system and org templates with versioning; fork-and-parameterise per org; self-healing watchdog sweeps stuck runs

### Human-in-the-Loop

Review queue and approval system ensuring humans stay in control of sensitive agent actions.

- **Three gate levels:** `auto` (proceed), `review` (pause for approval), `block` (disallow)
- **42+ review-gated actions:** email, CRM updates, code patches, page publishing, budget changes, campaign pauses, and more
- **Approve with edits** — Reviewers can modify proposals before approving; rejection feedback trains the agent
- **Confidence escape** — Low-confidence tool calls automatically redirected to ask a clarifying question
- Agents can proactively escalate via the `request_approval` skill; review items grouped by run for context

### Task Board & Workspace

Kanban-style task management with agent assignment, deliverables, and workflow transitions.

- Configurable columns per org/subaccount with drag-and-drop; reusable board templates
- Full task lifecycle: create, move, reassign, add deliverables, complete — with priority levels and categories
- Per-task activity stream for team visibility; workflow transitions follow defined column rules

### Unified Inbox

Aggregated notification centre across all item types with filtering and prioritisation.

- **Tabs:** All, Tasks, Reviews, Failed Runs — with sort, search, and subaccount filtering
- Priority feed with TTL-based claim/release; org-level and per-subaccount scoped views
- Unread/archived tracking with colour-coded subaccount badges

### Memory & Knowledge System

Multi-layered memory architecture enabling agents to learn, share context, and build institutional knowledge.

- **Workspace memory** — Per-subaccount fact store with vector embeddings, quality scoring, hybrid retrieval (semantic + full-text + recency)
- **Memory blocks** — Named shared context (Letta pattern) with per-agent read/write permissions
- **Cross-agent search** — Agents query what other agents have learned across the org
- **Agent briefings** — Rolling summaries generated post-run, injected into next run's context
- **Agent beliefs** — Discrete, confidence-scored facts per agent-subaccount, auto-extracted from run outcomes. Individually addressable (add/update/reinforce/remove), user-correctable, with key normalization and oscillation guards. Injected into prompt alongside briefings. Designed for Phase 2 state evolution (supersession chains).
- **Org-level insights** — Cross-subaccount patterns stored with scope tags for portfolio intelligence
- Automated memory decay (90 days) and nightly deduplication; four-scope context cascading with eager/lazy loading

### Workspace Health & Diagnostics

Automated configuration auditing that detects drift, misconfigurations, and operational issues.

- **6 active detectors:** inactive agents, empty skill allowlists, missing schedules, broken connections, missing engines, unsynced system agents
- Severity levels (critical/warning/info) with deduplicated findings and permission-gated manual resolve
- On-demand audit via UI or API; findings page grouped by severity with recommendations

### Activity & Analytics

Unified operational view across all activity types with advanced filtering and real-time updates.

- **Unified activity stream** — Agent runs, reviews, health findings, playbook runs, task events, and executions in one view
- **Multi-scope:** system-wide, org-level, and per-subaccount with filtering by type, status, date, agent, severity
- **LLM usage tracking** — Every call logged with tokens, cost, model; usage explorer with cost trends and margin calculations
- **Dashboard metrics** — Active agents, success rate, total runs, token usage with daily trend indicators
- Real-time WebSocket updates; CSV/JSON execution export; column-header sort and filter on every table

### Client Portal

White-label client-facing interface scoped per subaccount, enabling agencies to give clients self-service access.

- Subaccount selector, workflow browser with category filtering, self-service execution, and run history
- `client_user` role sees only portal routes; per-org brand colour inherited by portal styling

### Pages & Content Builder

CMS-style page creation and publishing with analytics tracking and form submission handling.

- Page projects, HTML content with meta tags and forms, draft-to-published workflow with HITL approval
- Public serving at `/pages/:slug` with view analytics and form submission handling
- Agents can create, update, and publish pages via dedicated skills

### Integration Framework

Extensible connector architecture supporting OAuth, API keys, webhooks, and MCP servers.

- **OAuth providers:** Gmail, Slack, HubSpot, Go High Level (GHL), Teamwork Desk, GitHub App
- **Connection scoping** — Org-level (shared) or subaccount-level (client-specific); multiple connections per provider
- **Data connectors:** GHL, HubSpot, Stripe, Slack, Teamwork with configurable sync lifecycle (backfill > transition > live)
- **MCP servers** — Model Context Protocol via stdio or HTTP; credential binding to any OAuth provider; per-tool gate overrides
- **Webhooks** — HMAC-SHA256 signed outbound and verified inbound; third-party workflow engines and custom endpoints supported
- Token encryption with versioned key rotation; credential management UI with tool browser
- See [Integrations Reference](#integrations-reference) for the full list

### Execution Infrastructure

Production-grade reliability — agents run consistently, recover from failures, and never double-execute.

- **Job queue:** pg-boss or BullMQ; 24+ job types across 10 priority tiers with DLQ and nightly cleanup
- **Idempotency:** every action is deduplicated — safe to retry without side effects
- **Budget enforcement:** hard ceilings on tokens, cost, tool calls, and timeouts per run
- **Security:** data isolation enforced at three independent layers; every tool call authorisation logged
- Loop detection, crash-resume checkpoints, correlation IDs for cross-service tracing

### Sandboxed Runtime (IEE)

Integrated Execution Environment for running agent work in isolated Docker containers — primarily for browser automation on client systems, with a secondary mode for organisation-level extensibility.

- **Primary mode — `iee_browser`** (Playwright): agents execute multi-step browser automation (logins, form submissions, structured scrapes, artefact downloads, paywalled content fetches) inside a fully sandboxed container with per-run cost attribution and budget reservations. This is how agents "do work on systems that don't have APIs."
- **Secondary mode — `iee_dev`** (workspace/shell): organisation-level extensibility for building custom apps, scripts, or connectors that support bespoke processes. Guarded by a code review workflow enforced in middleware, with whitelisted shell commands and test execution. Not positioned as a standalone IDE.
- Stateful agentic loops with **dual cost attribution** (LLM tokens + runtime seconds) surfaced in the usage explorer, so agency economics reflect full COGS — not just model spend.
- All executions run in isolation with enforced gating; no agent touches host state.

---

## Replaces / Consolidates

Automation OS replaces a fragmented stack of point tools with a single, orchestrated system of agents and workflows.

| Replaced | With | Why it's better |
|----------|------|-----------------|
| Commodity workflow automation tools | Playbook Engine | Stateful, agent-driven, with structured human review gates — not brittle trigger/action chains |
| Standalone LLM chat products | Deployed agents | Defined skills, budgets, memory, and accountability — not ephemeral conversations |
| Manual monthly reporting | Scheduled reporting agents | Drafted, reviewed, and delivered automatically on cadence — not assembled by hand each month |
| Ad-hoc CRM hygiene sprints | Continuous enrichment pipeline | Always-on enrichment and pipeline analysis — not a quarterly cleanup |
| Siloed marketing, CRM, and analytics tools | Unified skill system | One system connects data, decisions, and actions across platforms — no context switching |
| Fragmented client management across orgs | Multi-tenant subaccount hierarchy | Strict per-client data isolation built in — not enforced by process |
| Manual churn reviews | Always-on health scoring | Anomaly detection and intervention triggers fire automatically — not discovered on a renewal call |
| Shared team chat products used for agent work | Multi-tenant org + subaccount hierarchy with Client Portal | Strict per-client isolation and white-label portals — shared chat products are built for internal teams sharing context, not agencies serving many isolated clients |
| Scheduled-prompt tools | Playbook Engine with scheduling | Multi-step workflows with approval gates, cost ceilings, templating, retry policies, and idempotent execution — scheduled-prompt tools run one prompt on a cadence |
| Hosted single-agent platforms | Three-tier agent hierarchy with role-based handoffs | Fleet management with role hierarchy, handoffs up to 5 levels, workspace health monitoring, and per-client skill cascades — hosted single-agent platforms have no operations layer |
| Self-build on an agent SDK | The operations system on top of any agent SDK | All the non-agent layer already built — isolation, approvals, portals, playbooks, managed integrations, margin tracking, unified inbox |
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
- ClientPulse dashboard for portfolio-wide health visibility at a glance

### Customer Support Automation

| | |
|---|---|
| **Outcome** | Faster support responses with consistent quality — drawn from a shared knowledge base, not individual memory |
| **Trigger** | Inbound query received or untriaged backlog accumulates |
| **Deliverable** | Classified queries with routing, drafted replies using knowledge base context, and triaged backlogs with disposition recommendations |

- Knowledge base search surfaces relevant articles before drafting
- Intent classification and urgency routing ensures the right priority
- Backlog triage processes accumulations systematically, not ad hoc

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

- **Automated page monitoring** — `monitor_webpage` watches competitor pricing pages, feature lists, or job boards; agent is triggered immediately when content changes
- **Structured field extraction** — `scrape_structured` extracts specific fields (e.g. pricing tiers, plan names) on every run without re-paying LLM costs after the first scrape
- **Tiered scraping engine** — HTTP fetch → stealth Playwright browser → Scrapling anti-bot bypass; automatically escalates through tiers when a site blocks simpler methods

### Portfolio Intelligence

| | |
|---|---|
| **Outcome** | Agency leadership gets a cross-client view in minutes — not assembled from individual account reports |
| **Trigger** | Scheduled portfolio review or leadership briefing cadence |
| **Deliverable** | Portfolio intelligence briefing with per-client health scores, priority actions, and cross-client pattern insights |

- Cohort queries filtered by subaccount tags for segment-level analysis
- Org-level insight storage compounds pattern recognition across clients over time

---

## Skills Reference

Complete list of all 108 skills.

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
| `read_analytics` | Retrieve social media performance metrics for analysis and reporting | Deterministic | — |
| `read_expenses` | Retrieve expense data from accounting system | Deterministic | — |
| `read_revenue` | Retrieve revenue data from accounting system | Deterministic | — |
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
| `compute_churn_risk` | Evaluate churn risk signals and produce risk score with intervention recommendation | LLM | — |
| `compute_health_score` | Calculate composite health score (0-100) for account | LLM | — |
| `detect_anomaly` | Compare current metrics against historical baseline and flag deviations | LLM | — |
| `detect_churn_risk` | Analyse account health signals to identify at-risk accounts | LLM | — |
| `draft_followup` | Draft contextual follow-up email for stale deal or at-risk contact | LLM | — |
| `enrich_contact` | Retrieve enrichment data for contact and write back to CRM | Deterministic | — |
| `read_crm` | Retrieve contact, deal, and pipeline data from CRM | Deterministic | — |
| `trigger_account_intervention` | Propose intervention action (check-in, pause, alert) | LLM | HITL |
| `update_crm` | Write contact/deal updates to CRM | Deterministic | HITL |

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
| `ask_clarifying_question` | Pause run and ask user clarifying question | LLM | Universal |
| `read_priority_feed` | Read, claim, or release prioritised work feed items | Deterministic | Universal |
| `request_approval` | Escalate decision to human operator for review | LLM | — |
| `spawn_sub_agents` | Split work into 2-3 parallel sub-tasks executed simultaneously | LLM | — |

### Configuration & Integration

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `configure_integration` | Guide workspace integration setup with review gating | LLM | HITL |
| `update_financial_record` | Write financial record update (budget/forecast/expense note) | Deterministic | HITL |

### Playbook Studio

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `playbook_estimate_cost` | Produce pessimistic cost estimate for candidate playbook | LLM | — |
| `playbook_propose_save` | Record validated playbook definition for admin to save | Deterministic | — |
| `playbook_read_existing` | Load existing playbook file for reference and pattern matching | Deterministic | — |
| `playbook_simulate` | Static analysis pass returning parallelism and critical path | Deterministic | — |
| `playbook_validate` | Run DAG validator against candidate definition | Deterministic | — |

### Skill Studio

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

### External Services

| Service | Auth Type | Capabilities | Scoping |
|---------|-----------|-------------|---------|
| **Gmail** | OAuth2 | Send email, read inbox | Org or subaccount |
| **Slack** | OAuth2 | Post messages, file uploads, thread conversations, HITL buttons (Block Kit), @mention agent dispatch, DM conversations | Org or subaccount |
| **HubSpot** | OAuth2 | Contacts, deals, content; full CRM read/write | Org or subaccount |
| **Go High Level (GHL)** | OAuth2 | Contacts, opportunities, conversations, revenue, location data; webhook ingestion (HMAC-SHA256) | Org (with concurrency cap) |
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
| **Google Docs** | Auto-detected | OAuth-authenticated |
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

---

## Changelog

| Date | Change | Commit |
|------|--------|--------|
| 2026-04-14 | Apply Editorial Rules across customer-facing sections — scrub all named LLM / AI providers and their products from Positioning, Replaces / Consolidates, and Product Capabilities; rewrite in generic, vendor-neutral, marketing-appropriate language. Add Editorial Rules section and neutralise "default provider" language in Integrations Reference. Persist editorial rules in `CLAUDE.md`. | — |
| 2026-04-14 | Add Positioning & Competitive Differentiation section (framing, structural differentiators, objection handling, GTM guidance, messaging north star); reframe Developer Tools (IEE) as Sandboxed Runtime with browser automation as the primary mode; extend Replaces / Consolidates table with rows covering shared team chat, scheduled-prompt tools, hosted single-agent platforms, self-build agent SDKs, and single-provider lock-in | — |
| 2026-04-13 | Fix skill count: 100 skills (not 101); add 4 missing route entries (ClientPulse, GHL, Modules, Onboarding) to architecture.md; update migration list to 0109; fix project structure job list | — |
| 2026-04-13 | Add scrape_url, scrape_structured, monitor_webpage skills; add Scrapling MCP preset; expand Competitor Intelligence with automated monitoring capabilities | — |
| 2026-04-13 | Tighten Replaces table with "why it's better" column | — |
| 2026-04-13 | Tighten Product language to benefit-oriented; sharpen Agency with constraints; fix Hybrid type on create_page/update_page; add Replaces / Consolidates section | — |
| 2026-04-13 | Add Core Value Proposition; compress Product Capabilities; reframe Agency to outcomes; add Type column to Skills | — |
| 2026-04-12 | Initial capabilities registry created from full code audit | — |
