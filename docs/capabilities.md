# Automation OS — Capabilities Registry

> **Last updated:** 2026-04-12
>
> This is the single source of truth for everything the platform can do.
> Update it in the same commit as any feature or skill change.

---

## How to use this document

| Audience | Start here |
|----------|-----------|
| **Marketing / Sales (platform pitch)** | [Product Capabilities](#product-capabilities) |
| **Marketing / Sales (agency pitch)** | [Agency Capabilities](#agency-capabilities) |
| **Support** | [Skills Reference](#skills-reference) and [Integrations Reference](#integrations-reference) |
| **Engineering** | `architecture.md` remains the technical reference; this doc covers *what*, not *how* |

---

## Table of Contents

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
  - [Ops Dashboard & Analytics](#ops-dashboard--analytics)
  - [Client Portal](#client-portal)
  - [Pages & Content Builder](#pages--content-builder)
  - [Integration Framework](#integration-framework)
  - [Execution Infrastructure](#execution-infrastructure)
  - [Developer Tools (IEE)](#developer-tools-iee)
- [Agency Capabilities](#agency-capabilities)
  - [Performance Reporting & Analytics](#performance-reporting--analytics)
  - [SEO Management](#seo-management)
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

## Product Capabilities

### Multi-Tenant Platform

Three-tier hierarchy that isolates data and configuration at every level.

- **System tier** — Platform-wide defaults, system-managed agents, global skill library, playbook templates
- **Organisation tier** — Agency-level workspace with its own users, agents, skills, memory, branding, and billing
- **Subaccount tier** — Per-client workspace within an org; each subaccount has its own agent links, task board, review queue, data sources, connections, and memory
- **Org scoping** — Every database query filters by `organisationId`; row-level security enforced on protected tables
- **Soft deletes** — Entities are never hard-deleted; `deletedAt` timestamps preserve audit history
- **Subaccount tags** — Tag subaccounts for cohort queries and portfolio-level reporting
- **Onboarding wizard** — Guided setup flow for new organisations including GHL OAuth connection

### Authentication & Access Control

Role-based access control with five built-in roles and a flexible permission system.

- **Roles:** `system_admin`, `org_admin`, `manager`, `user`, `client_user`
- **Permission keys** — Granular capabilities (e.g. `AGENTS_CREATE`, `REVIEW_APPROVE`, `HEALTH_AUDIT_VIEW`) checked at route and UI level
- **Permission sets** — Custom permission bundles assignable to roles (system_admin configurable)
- **JWT authentication** — Access and refresh token flow with secure session management
- **Rate limiting** — Login attempts capped at 10 per 15 minutes
- **Team invitations** — Email-based invite flow with configurable expiry (default 72h)
- **Password reset** — Self-service forgot/reset password flow
- **Permissions-driven UI** — Client-side visibility gated by `/api/my-permissions` responses; buttons, tabs, and pages hidden when the user lacks the required permission

### AI Agent System

Autonomous AI agents organized in a three-tier hierarchy with configurable models, skills, and execution policies.

- **Three-tier agent model:**
  - *System agents* — Platform-managed, immutable master prompts, cascaded to orgs. Only `additionalPrompt` is editable.
  - *Org agents* — Organisation-created agents with full prompt and skill control
  - *Subaccount agents* — Agents linked to a specific client workspace with per-subaccount config overrides
- **Agent roles:** CEO, Orchestrator, Specialist, Worker — enabling hierarchical team structures
- **Agent chat** — Real-time conversational interface with tool result cards, typing indicators, and session history
- **Agent configuration:**
  - Model and provider selection (OpenAI, Anthropic, OpenRouter)
  - Response mode: balanced, precise, expressive, highly creative
  - Output size: standard, extended, maximum
  - Token budget, max tool calls, and timeout per run
  - Max cost per run (cents) and max LLM calls per run
- **Heartbeat scheduling** — Agents can poll on configurable intervals with minute-level precision via `heartbeatOffsetMinutes`
- **Cron scheduling** — Cron expressions with timezone support for scheduled agent runs
- **Event triggers** — Agents fire on events: `task_created`, `task_moved`, `agent_completed`
- **Concurrency policies:** `skip_if_active`, `coalesce_if_active`, `always_enqueue`
- **Catch-up policies:** `skip_missed` or `enqueue_missed_with_cap` for handling gaps
- **Agent handoffs** — Agents can hand off work to other agents, with depth capped at 5 levels
- **Agent templates** — Pre-built team hierarchy templates for rapid deployment
- **Data sources** — Per-agent knowledge files (R2, S3, HTTP, Google Docs, Dropbox, file upload) with token budgets and caching
- **Run history** — Full execution trace with tool calls, LLM interactions, and timing
- **Agent briefings** — Async background briefing updates after each run
- **Idempotency** — All agent run creation paths support deduplication via idempotency keys

### Skill System

Modular capability system with 98 skills across 13 categories, cascading from system to org to subaccount.

- **Skill tiers:**
  - *System skills* — Platform-provided, available to all orgs (opt-in visibility control)
  - *Org skills* — Custom skills created by the organisation
  - *Universal skills* — Always available to every agent regardless of allowlist
- **Skill allowlists** — Each subaccount-agent link specifies exactly which skills the agent can use
- **Skill categories:** Analytics, Content, CRM, Development, QA, Sales, Data, Communication, Tasks, Configuration, Playbooks, Skill Development, Utility
- **Skill Studio** — Authoring environment with JSON definition editor, regression test simulation, version history, and rollback
- **Skill Analyzer** — Automated capability detection across the skill library (system admin)
- **Skill versioning** — Propose, simulate, validate, and atomically update skill definitions
- **Regression fixtures** — Captured from rejected reviews; nightly replay to catch regressions
- **Review gating** — 42+ skills require human approval before execution (HITL)
- **Deterministic skills** — 6 skills execute without LLM involvement (transcription, test runs, shell commands)
- **Topic filtering** — Middleware classifies user intent and reorders/removes skills dynamically per message
- **Skill modules** — Group skills into feature modules for bulk management

### Playbook Engine

Multi-step workflow automation with dependency graphs, parallel execution, and human review gates.

- **Step types:** `user_input` (forms), `agent_call` (run an agent), `approval` (blocking human gate), `prompt` (direct LLM call)
- **DAG execution** — Steps run in parallel when independent; dependencies defined declaratively
- **Templating** — `{{ run.input.X }}` and `{{ steps.Y.output.Z }}` for passing data between steps
- **Human review gates** — Steps marked `humanReviewRequired: true` block until approved
- **Irreversible steps** — Steps with `sideEffectType: 'irreversible'` cannot be auto-retried after upstream edits
- **Per-step retry policy** — Configurable `maxAttempts` per step
- **Convergent event loop** — `playbook-run-tick` fires on step completion; `playbook-watchdog` runs every 60s for self-healing
- **System and org templates** — Fork from system templates with versioning; per-org parameterisation via `paramsJson`
- **Playbook Studio** — Chat-based authoring interface (system admin) with validate, simulate, estimate cost, and save-as-PR tools
- **Cost estimation** — Pessimistic cost estimate before execution
- **Bulk child steps** — Parent completion check after parallel child steps complete

### Human-in-the-Loop

Review queue and approval system ensuring humans stay in control of sensitive agent actions.

- **Review queue** — Per-subaccount and org-level queues for pending approvals
- **Action gating** — Three levels: `auto` (proceed), `review` (pause for approval), `block` (disallow)
- **Review-gated actions:** email sending, CRM updates, code patches, page publishing, budget changes, campaign pauses, and 36+ more
- **Approve with edits** — Reviewers can modify the proposed action before approving
- **Reject with feedback** — Rejection feedback is fed back to the agent for learning
- **Grouped by run** — Review items grouped by agent run for contextual review
- **Action type badges** — Visual indicators for action types (send_email, update_record, create_record, etc.)
- **Confidence escape** — Agent calls below a confidence threshold are automatically redirected to ask a clarifying question instead
- **Request approval skill** — Agents can proactively escalate decisions to human operators with context and options

### Task Board & Workspace

Kanban-style task management with agent assignment, deliverables, and workflow transitions.

- **Configurable columns** — Custom board columns per org or subaccount
- **Task lifecycle:** create, move (status change), reassign, add deliverables, complete
- **Agent assignment** — Tasks assigned to specific agents with handoff context
- **Deliverables** — Attach artifacts, URLs, or files to tasks before moving to review
- **Activity stream** — Per-task activity entries (progress, notes, completed, blocked) for team visibility
- **Priority levels:** low, normal, high, urgent
- **Categories** — Categorise tasks with custom colours for filtering
- **Board templates** — Reusable board configurations from system templates
- **Drag-and-drop** — Visual Kanban board with drag-and-drop support
- **Workflow transitions** — Move operations follow defined column transition rules

### Unified Inbox

Aggregated notification centre across all item types with filtering and prioritisation.

- **Multi-tab interface:** All, Tasks, Reviews, Failed Runs
- **Sort options:** Recent, Oldest, Priority, Type, Subaccount
- **Search and filtering** — Full-text search with advanced filters
- **Unread/archived toggles** — Track read state and archive dismissed items
- **Colour-coded subaccount badges** — Visual identification of which client workspace an item belongs to
- **Priority feed** — Priority-ranked work items with TTL-based claim/release management
- **Scoped views** — Org-level and per-subaccount inbox views

### Memory & Knowledge System

Multi-layered memory architecture enabling agents to learn, share context, and build institutional knowledge.

- **Workspace memory** — Per-subaccount fact store with vector embeddings (1536-dim), quality scoring, and full-text search
- **Hybrid RRF retrieval** — Combines semantic search (cosine distance), full-text search (tsvector), and quality/recency scoring for optimal recall
- **HyDE query expansion** — LLM-generated hypothetical documents for short queries to improve retrieval quality
- **Memory blocks** — Named, shared context blocks (Letta pattern) with read/read-write permissions per agent
- **Org-level insights** — Cross-subaccount patterns and insights stored via `write_org_insight` skill with scope tags
- **Agent briefings** — Rolling summaries generated post-run, combining previous briefing + latest handoff + recent high-quality memories (capped at 1200 tokens)
- **Cross-agent memory search** — Agents can query what other agents have learned via `search_agent_history` (universal skill)
- **Subaccount state summaries** — Live operational snapshots (no LLM) injected into agent context with 4-hour TTL cache
- **Memory decay** — Automated pruning of low-quality entries (score < 0.3) after 90 days
- **Memory deduplication** — Nightly job removes near-duplicate entries (cosine distance < 0.15)
- **Context source cascading** — Four-scope precedence: task instance > scheduled task > subaccount > agent
- **Eager vs lazy loading** — Eager sources load into system prompt (up to 60k tokens); lazy sources fetched on-demand via `read_data_source`

### Workspace Health & Diagnostics

Automated configuration auditing that detects drift, misconfigurations, and operational issues.

- **6 active detectors:**
  - Agents with no runs in 14+ days
  - Agents with empty skill allowlists
  - Agents with no schedules or triggers
  - Processes with broken connection mappings
  - Processes with no execution engine assigned
  - System agents never synced to subaccounts
- **Severity levels:** critical, warning, info
- **Deduplication** — Findings deduplicated by (org, detector, resource kind, resource ID)
- **Manual resolve** — Permission-gated resolution with audit trail
- **On-demand audit** — Trigger a full audit from the UI or via API
- **Ops Dashboard widget** — Compact health summary in the operations view
- **Findings page** — Dedicated admin page grouped by severity with detection reason and recommendations

### Ops Dashboard & Analytics

Unified operational view across all activity types with advanced filtering and real-time updates.

- **Unified activity stream** — Aggregates agent runs, review items, health findings, inbox items, decision logs, playbook runs, task events, and workflow executions
- **Multi-scope views:** system-wide (system admin), org-level, and per-subaccount
- **Filtering** — By type, status, date range, agent, severity, assignee, and free-text search
- **Sorting** — Attention-first (prioritised), recent, or by status
- **Column-header sort and filter** — Google Sheets-style dropdowns on every column
- **LLM usage tracking** — Every LLM call logged with tokens, cost, model, and source type
- **Usage explorer** — Tabs for overview, agents, models, runs, routing, and IEE with date range filtering
- **Cost trends** — Per-run cost breakdown, aggregated cost trends, and margin calculations
- **Dashboard metrics** — Active agents, success rate, total runs, token usage with trend indicators (daily vs yesterday)
- **14-day activity chart** — Completed/failed/timeout breakdown with visual trends
- **WebSocket real-time updates** — Live dashboard updates via Socket.IO rooms with 10-second polling fallback
- **Execution export** — CSV/JSON export of execution logs (admin-only)

### Client Portal

White-label client-facing interface scoped per subaccount, enabling agencies to give clients self-service access.

- **Portal landing** — Subaccount selector showing all client workspaces the user can access
- **Process browser** — Per-subaccount view of available workflows with category filtering and search
- **Self-service execution** — Clients can run workflows assigned to their subaccount
- **Execution history** — Client-scoped view of past runs with status and results
- **Role-gated access** — `client_user` role sees only portal routes; no admin UI exposed
- **Organisation branding** — Per-org brand colour (hex) inherited by portal styling
- **Per-subaccount settings** — Client-level configuration path for subaccount-specific customisation

### Pages & Content Builder

CMS-style page creation and publishing with analytics tracking and form submission handling.

- **Page projects** — Group pages into projects for organisation
- **Page creation** — HTML content, meta tags, and optional form configuration
- **Page publishing** — Draft-to-published workflow with human review gate (HITL approval required)
- **Page versioning** — Update history preserved for audit trail
- **Public serving** — Published pages served at `/pages/:slug`
- **Form submissions** — Public POST endpoint for form data collection
- **Page tracking** — Analytics for page views and engagement
- **Agent skills** — `create_page`, `update_page`, `publish_page` skills for agent-driven page management

### Integration Framework

Extensible connector architecture supporting OAuth, API keys, webhooks, and MCP servers.

- **OAuth providers:** Gmail, Slack, HubSpot, Go High Level (GHL), Teamwork Desk
- **GitHub App** — Fine-grained per-repo access with webhook support for issues, PRs, and pushes
- **Auth types:** `oauth2`, `api_key`, `service_account`, `github_app`, `web_login`
- **Token management** — AES-256-GCM encryption with versioned key rotation; automatic OAuth refresh with 5-minute buffer
- **Connection scoping** — Org-level (shared) or subaccount-level (client-specific); multiple connections per provider via labels
- **Data connectors** — GHL, HubSpot, Stripe, Slack, Teamwork with configurable poll intervals and sync lifecycle (backfill > transition > live)
- **MCP servers** — Model Context Protocol support via `stdio` (subprocess) or `http` transport; credential provider linkage to any OAuth provider; per-tool gate level overrides
- **Webhook adapters** — Outbound webhooks with HMAC-SHA256 signing, configurable timeout/retry, and callback verification
- **Inbound webhooks** — GHL, Slack, Teamwork, GitHub with HMAC verification and idempotent dedup stores
- **Workflow engines** — n8n, Make, GHL Workflows, custom webhook; per-engine HMAC secrets and health monitoring
- **Credential management UI** — MCP server catalogue, tool browser, per-subaccount connection configuration

### Execution Infrastructure

Production-grade job queue, idempotency, and retry system powering all background operations.

- **Job queue** — pg-boss (PostgreSQL-backed) or BullMQ (Redis-backed); 24+ job types across 10 priority tiers
- **Idempotency strategies:** `read_only` (safe re-run), `keyed_write` (caller-supplied dedup key), `locked` (PG advisory lock)
- **Retry policies** — Per-action: exponential backoff, fixed, or none; configurable max retries and conditions
- **Budget enforcement** — Pre-call middleware enforces token budget, max tool calls, timeout, and cost ceilings with graceful summary on exhaustion
- **Loop detection** — Repeated identical tool calls blocked after configurable threshold
- **Dead letter queues** — Failed IEE tasks route to DLQ for manual investigation
- **Stale run cleanup** — Nightly pruning of abandoned runs beyond retention window
- **Scope validation** — Every tool call verified for subaccount/org isolation via `proposeActionMiddleware`
- **Security audit trail** — Every tool call authorisation decision logged to `tool_call_security_events`
- **Row-level security** — Three-layer fail-closed: Postgres RLS policies, service-layer org-scoped DB, and scope assertions at retrieval boundaries
- **Crash-resume** — Checkpoint and message log tables for agent run resumption after failures
- **Correlation IDs** — Request tracing via AsyncLocalStorage for debugging across services

### Developer Tools (IEE)

Integrated Execution Environment for browser automation and development workspace tasks.

- **Two execution modes:** `iee_browser` (Playwright-based) and `iee_dev` (workspace/shell)
- **Stateful agentic loops** — Observe > prompt > LLM call > parse action > execute > log step
- **Browser automation** — Full Playwright capabilities including HLS/DASH video support
- **Worker isolation** — Separate Docker container with heartbeat-based lifecycle management
- **Dead worker detection** — Reconciler detects unresponsive workers after 60 seconds
- **Four exit paths:** `done`, `failed`, `step_limit_reached`, `timeout`
- **Cost attribution** — LLM cost + runtime cost (CPU, memory, flat fee) denormalised on each run
- **Usage explorer** — Filterable views at system, org, and subaccount scopes with cost breakdown
- **Idempotency** — Deterministic key + unique partial index prevents duplicate execution
- **Soft budget reservation** — Created at enqueue, released at finalisation
- **Code review workflow** — `write_patch` requires prior `review_code` approval; enforced by reflection loop middleware
- **Test execution** — `run_tests` and `run_playwright_test` skills for automated testing
- **Shell commands** — `run_command` skill with whitelisted command execution

---

## Agency Capabilities

### Performance Reporting & Analytics

Deliver data-driven performance reports to clients with automated analysis and recommendations.

- Retrieve social media, ad campaign, and pipeline metrics across platforms
- Analyse campaign data to identify underperformers and recommend optimisations
- Draft client-facing performance reports with executive summaries
- Deliver approved reports via email or portal with review gating
- Analyse pipeline velocity, stage conversion rates, and forecast accuracy
- 42 Macro transcript analysis using GRID/KISS framework for research-backed insights
- **Powered by:** `read_analytics`, `analyse_performance`, `draft_report`, `deliver_report`, `analyse_pipeline`, `analyse_42macro_transcript`

### SEO Management

Automated SEO auditing and optimisation for client websites and content.

- Audit pages for on-page SEO issues with prioritised findings
- Provide specific, actionable recommendations per issue
- Track SEO improvements over time through recurring audits
- Integrate with content creation for SEO-optimised output
- **Powered by:** `audit_seo`, `draft_content` (SEO mode), `web_search`

### Content Creation & Publishing

End-to-end content production from brief to publication across multiple formats and channels.

- Draft long-form content: blog posts, landing pages, case studies, whitepapers
- Create lead magnets: checklists, templates, guides, scorecards (with HITL approval)
- Draft social media posts optimised per platform with variants
- Draft ad copy across platforms with format-specific optimisation
- Publish approved social posts immediately or at scheduled times
- Create, update, and publish web pages with meta tags and forms
- Documentation drafting with diff-style proposals and review gating
- **Powered by:** `draft_content`, `create_lead_magnet`, `draft_post`, `publish_post`, `draft_ad_copy`, `create_page`, `update_page`, `publish_page`, `propose_doc_update`, `write_docs`

### CRM & Contact Management

Automated CRM operations with data enrichment and intelligent pipeline management.

- Read and query contact, deal, and pipeline data from connected CRMs
- Update CRM records with HITL gating for data integrity
- Enrich contacts with third-party data and write back to CRM
- Analyse CRM pipeline for velocity metrics and forecast accuracy
- Synthesise voice-of-customer data into structured insight reports
- **Powered by:** `read_crm`, `update_crm`, `enrich_contact`, `analyse_pipeline`, `synthesise_voc`

### Email Marketing & Outreach

Intelligent email automation from classification to sequence execution.

- Classify inbound emails by intent, urgency, and routing category
- Draft contextual follow-up emails for stale deals or at-risk contacts
- Draft multi-step email sequences with personalisation and timing
- Draft customer support replies using classification and knowledge base content
- Send emails via connected provider with HITL approval
- **Powered by:** `classify_email`, `draft_followup`, `draft_sequence`, `draft_reply`, `send_email`

### Campaign Management & Optimization

AI-driven campaign management with budget optimisation and performance-based actions.

- Retrieve campaign data with budget, spend, and performance summaries
- Propose bid adjustments with evidence and HITL approval
- Pause underperforming campaigns with performance justification
- Increase budget for high-performing campaigns with approval workflow
- Update ad copy across platforms with review gating
- **Powered by:** `read_campaigns`, `update_bid`, `pause_campaign`, `increase_budget`, `update_copy`

### Financial Analysis & Reporting

Automated financial analysis with structured summaries and record management.

- Analyse revenue and expense data with financial ratios and insights
- Retrieve revenue and expense records from accounting systems
- Update financial records (budgets, forecasts, expense notes) with HITL approval
- Produce structured financial summaries with key metrics and trends
- **Powered by:** `analyse_financials`, `read_revenue`, `read_expenses`, `update_financial_record`

### Churn Detection & Account Health

Proactive account monitoring with risk scoring and automated intervention triggers.

- Compute composite health scores (0-100) based on normalised metrics
- Evaluate churn risk signals and produce risk scores with intervention recommendations
- Compare current metrics against historical baselines and flag significant deviations
- Trigger account interventions (check-in, pause, alert) with HITL gating
- ClientPulse dashboard: portfolio health summary, high-risk clients, GHL connection status
- **Powered by:** `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `trigger_account_intervention`, `detect_churn_risk`

### Customer Support Automation

Knowledge-driven support with classification, routing, and response drafting.

- Search workspace knowledge base for relevant articles
- Classify inbound queries by intent and urgency
- Draft replies using classification output and knowledge base content
- Triage intake: capture ideas and bugs, process untriaged backlogs with disposition recommendations
- **Powered by:** `search_knowledge_base`, `classify_email`, `draft_reply`, `triage_intake`

### Landing Page Management

Agent-driven landing page creation and management with publishing workflows.

- Create new pages with HTML content, meta tags, and form configuration
- Update existing page content with version history
- Publish pages after human review (irreversible action, HITL required)
- Track page analytics for views and engagement
- **Powered by:** `create_page`, `update_page`, `publish_page`

### Competitor Intelligence

Automated competitor research and intelligence briefing generation.

- Research competitors via web search
- Generate structured intelligence briefs with pricing, features, and news
- Cross-reference competitor data with client positioning
- **Powered by:** `generate_competitor_brief`, `web_search`

### Portfolio Intelligence

Cross-client analytics and portfolio-level reporting for agency leadership.

- Generate cross-subaccount portfolio intelligence briefings
- Query subaccount cohorts filtered by tags for segment analysis
- Read and write org-level insights for cross-client pattern recognition
- Health and priority action summaries across the entire portfolio
- **Powered by:** `generate_portfolio_report`, `query_subaccount_cohort`, `read_org_insights`, `write_org_insight`

---

## Skills Reference

Complete list of all 98 skills. **HITL** = requires human approval before execution. **Universal** = auto-injected on every agent run.

### Analytics & Reporting

| Skill | Description | Gate |
|-------|-------------|------|
| `analyse_42macro_transcript` | Convert 42 Macro video transcripts into three-tier analysis using GRID/KISS framework | — |
| `analyse_financials` | Analyse revenue/expense data to produce structured financial summary with ratios | — |
| `analyse_performance` | Analyse campaign data to identify underperformers and recommend optimisations | — |
| `analyse_pipeline` | Analyse CRM pipeline for velocity metrics, stage conversion, and forecast accuracy | — |
| `deliver_report` | Deliver approved client report via email or portal with review gating | HITL |
| `draft_report` | Draft client-facing performance report with executive summary and recommendations | — |
| `generate_portfolio_report` | Generate cross-subaccount portfolio intelligence briefing | — |
| `read_analytics` | Retrieve social media performance metrics for analysis and reporting | — |
| `read_expenses` | Retrieve expense data from accounting system | — |
| `read_revenue` | Retrieve revenue data from accounting system | — |
| `synthesise_voc` | Convert voice-of-customer data into structured insight report with themes | — |

### Content Creation & Publishing

| Skill | Description | Gate |
|-------|-------------|------|
| `create_lead_magnet` | Produce complete lead magnet asset (checklist, template, guide, scorecard) | HITL |
| `create_page` | Create new page with HTML content, meta tags, and optional form configuration | — |
| `draft_ad_copy` | Draft ad copy variants across platforms with format-specific optimisation | — |
| `draft_content` | Draft long-form content (blog, landing page, case study, whitepaper) with SEO | — |
| `draft_post` | Draft social media post copy for multiple platforms with variants | — |
| `draft_requirements` | Produce structured requirements spec with user stories and Gherkin ACs | — |
| `propose_doc_update` | Propose specific documentation changes as diff-style proposal | HITL |
| `publish_page` | Publish draft page to make it publicly accessible | HITL |
| `publish_post` | Submit approved social post for publishing immediately or scheduled | — |
| `update_copy` | Upload approved ad copy to ads platform | HITL |
| `update_page` | Update existing page HTML, meta tags, or form configuration | — |
| `write_docs` | Apply approved documentation update to system | HITL |
| `write_spec` | Submit requirements spec for human approval before development | HITL |

### CRM & Contact Management

| Skill | Description | Gate |
|-------|-------------|------|
| `compute_churn_risk` | Evaluate churn risk signals and produce risk score with intervention recommendation | — |
| `compute_health_score` | Calculate composite health score (0-100) for account | — |
| `detect_anomaly` | Compare current metrics against historical baseline and flag deviations | — |
| `detect_churn_risk` | Analyse account health signals to identify at-risk accounts | — |
| `draft_followup` | Draft contextual follow-up email for stale deal or at-risk contact | — |
| `enrich_contact` | Retrieve enrichment data for contact and write back to CRM | — |
| `read_crm` | Retrieve contact, deal, and pipeline data from CRM | — |
| `trigger_account_intervention` | Propose intervention action (check-in, pause, alert) | HITL |
| `update_crm` | Write contact/deal updates to CRM | HITL |

### Email & Communication

| Skill | Description | Gate |
|-------|-------------|------|
| `classify_email` | Analyse inbound email to classify by intent, urgency, and routing | — |
| `draft_reply` | Draft customer support reply using classification and knowledge base | — |
| `draft_sequence` | Draft multi-step email sequence with personalisation and timing | — |
| `read_inbox` | Read emails from connected inbox provider | — |
| `send_email` | Send email via connected provider | HITL |
| `send_to_slack` | Post message to Slack channel with optional file attachments | — |

### Campaign & Marketing

| Skill | Description | Gate |
|-------|-------------|------|
| `audit_seo` | Audit page for on-page SEO issues with prioritised findings | — |
| `generate_competitor_brief` | Research competitor via web search and produce intelligence brief | — |
| `increase_budget` | Propose budget increase for high-performing campaign | HITL |
| `pause_campaign` | Propose campaign pause with performance evidence | HITL |
| `query_subaccount_cohort` | Read board health and memory summaries across subaccounts by tags | — |
| `read_campaigns` | Retrieve campaign data with budget, spend, and performance summary | — |
| `update_bid` | Propose bid adjustment for campaign/ad group | HITL |

### Task & Board Management

| Skill | Description | Gate |
|-------|-------------|------|
| `add_deliverable` | Attach deliverable (artifact/url/file) to task before moving to review | — |
| `create_task` | Create new task on workspace board with title and description | — |
| `move_task` | Move task to different board column following workflow transitions | — |
| `reassign_task` | Reassign existing task to another agent with handoff context | — |
| `triage_intake` | Capture ideas/bugs into task board and process untriaged backlog | — |
| `update_task` | Update task title, description, brief, or priority | — |

### Development & Code

| Skill | Description | Gate |
|-------|-------------|------|
| `analyze_endpoint` | Probe API endpoint and verify contract compliance | — |
| `create_pr` | Create GitHub pull request from approved applied patches | — |
| `draft_architecture_plan` | Produce structured architecture plan with implementation chunks | — |
| `draft_tech_spec` | Produce technical specifications (OpenAPI, ERD, sequence diagrams) | — |
| `read_codebase` | Read file from project codebase | — |
| `review_code` | Perform structured self-review on changed files | — |
| `run_command` | Execute approved shell commands (git, npm, build) | — |
| `run_tests` | Execute project test suite with optional filtering | — |
| `search_codebase` | Search codebase for files, symbols, or text patterns | — |
| `write_patch` | Propose code change as unified diff for review | HITL |

### Quality Assurance

| Skill | Description | Gate |
|-------|-------------|------|
| `capture_screenshot` | Launch headless browser to capture screenshot for visual QA | — |
| `derive_test_cases` | Transform Gherkin ACs into structured test case manifest | — |
| `report_bug` | File structured bug report with severity and confidence scoring | — |
| `review_ux` | Perform UX review covering mental models, accessibility, and copy | — |
| `run_playwright_test` | Execute Playwright E2E test file against running application | — |
| `write_tests` | Write or update test files covering unit/integration/e2e scenarios | — |

### Data & Research

| Skill | Description | Gate |
|-------|-------------|------|
| `fetch_paywalled_content` | Log into paywalled site and download artifact | — |
| `fetch_url` | Make HTTP request to URL and return response body | — |
| `read_data_source` | List and read context data sources (agent, subaccount, task scopes) | Universal |
| `web_search` | Search web for current information using Tavily AI search | — |

### Memory & Context

| Skill | Description | Gate |
|-------|-------------|------|
| `read_org_insights` | Query cross-subaccount insights stored in org-level memory | — |
| `read_workspace` | Read tasks and activities from shared board with filtering | — |
| `search_agent_history` | Search memories and learnings across agents via vector search | Universal |
| `update_memory_block` | Update shared memory block content for cross-agent context | Universal |
| `write_org_insight` | Store cross-subaccount pattern or insight in org-level memory | — |
| `write_workspace` | Add activity entry to task for team visibility | — |

### Agent Collaboration

| Skill | Description | Gate |
|-------|-------------|------|
| `ask_clarifying_question` | Pause run and ask user clarifying question | Universal |
| `read_priority_feed` | Read, claim, or release prioritised work feed items | Universal |
| `request_approval` | Escalate decision to human operator for review | — |
| `spawn_sub_agents` | Split work into 2-3 parallel sub-tasks executed simultaneously | — |

### Configuration & Integration

| Skill | Description | Gate |
|-------|-------------|------|
| `configure_integration` | Guide workspace integration setup with review gating | HITL |
| `update_financial_record` | Write financial record update (budget/forecast/expense note) | HITL |

### Playbook Studio

| Skill | Description | Gate |
|-------|-------------|------|
| `playbook_estimate_cost` | Produce pessimistic cost estimate for candidate playbook | — |
| `playbook_propose_save` | Record validated playbook definition for admin to save | — |
| `playbook_read_existing` | Load existing playbook file for reference and pattern matching | — |
| `playbook_simulate` | Static analysis pass returning parallelism and critical path | — |
| `playbook_validate` | Run DAG validator against candidate definition | — |

### Skill Studio

| Skill | Description | Gate |
|-------|-------------|------|
| `skill_propose_save` | Write new skill version and atomically update definition | — |
| `skill_read_existing` | Read current definition and instructions for skill | — |
| `skill_simulate` | Replay proposed skill version against regression fixtures | — |
| `skill_validate` | Validate proposed skill definition against tool schema and Zod rules | — |

### Utility

| Skill | Description | Gate |
|-------|-------------|------|
| `transcribe_audio` | Convert audio/video file to text transcript using OpenAI Whisper | — |

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
| **Anthropic (Claude)** | API key | Default LLM provider | System |
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

---

## Changelog

| Date | Change | Commit |
|------|--------|--------|
| 2026-04-12 | Initial capabilities registry created from full code audit | — |
