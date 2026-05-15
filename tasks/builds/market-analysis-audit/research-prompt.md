# Market Analysis Research Brief — Synthetos (Automation OS)

You are conducting a deep market analysis for an AI agent operations platform. This brief is structured as **two passes in one conversation**.

- **Pass 1** runs immediately when you receive this prompt: identify the competitive landscape and cluster competitors by competitive shape. Stop at the end of Pass 1 and wait for the operator to reply with the literal text **"Proceed to Pass 2"** before continuing.
- **Pass 2** runs after that reply: produce a side-by-side capability comparison, a gap analysis, and a ranked pre-freeze recommendation list.

Do not begin Pass 2 until you receive the "Proceed to Pass 2" trigger. Do not summarise or skip Pass 1 in order to get to Pass 2 faster — the operator needs the competitor list reviewed and confirmed before comparison work begins.

---

## Section A — What Synthetos / Automation OS is

**Brand:** Synthetos. **Product name:** Automation OS.

**One-sentence positioning:**
> Synthetos is the operations system an agency uses to run its business — multi-client isolation, white-label client portals, approval workflows, margin tracking, and vertical skills, on top of any frontier LLM.

**Buyer:** Marketing / digital / professional-services agencies serving multiple end-clients.

**The frame that is locked and non-negotiable:**

LLM providers (foundation-model vendors) sell **primitives** — a model, an SDK, scheduled prompts, hosted single-agent surfaces, a skills format, a team chat. Synthetos sells the **operations system that happens to run agents**. The pitch is **not** "we have agents and skills." The pitch is the operations layer that sits on top: multi-tenant isolation, supervised workflows, agency economics, client-facing surfaces, vertical depth.

**Explicit non-goals (do not propose features that compete on these axes):**

- Not a better agent SDK
- Not a better general-purpose chat UI
- Not a standalone IDE / developer platform
- Not a commodity workflow automation tool (Zapier-style stateless trigger/action chains)
- Not a hosted routines / scheduled-prompt product for individuals
- Not a public skill or playbook marketplace
- Not a bidirectional bridge to no-code workflow tools (we import; we do not export back)

---

## Section B — Capability inventory (current state, v1-freeze-candidate)

Group A through G below is the complete capability surface as of 2026-05-15. Treat this as authoritative — if a category seems missing from the list, it is intentionally absent.

### B.A — Platform foundations

- **Multi-tenant three-tier isolation** — System → Organisation → Subaccount. Strict data, memory, configuration, and billing isolation enforced at the database layer. Agencies manage many clients with no cross-contamination.
- **Authentication & access control** — Five roles, granular permission keys, principal-based data access (user / service / delegated principals), delegation grants with auto-expiry, four-tier visibility scoping (private / shared-team / shared-subaccount / shared-org) enforced at the database layer.
- **Execution infrastructure** — 24+ background job types across 10 priority tiers, exactly-once execution guarantees, automatic retry with crash-resume, real-time WebSocket streaming, hard cost ceilings per run, infinite-loop detection, working-time accounting that matches the invoice line.

### B.B — Agent runtime

- **Three-tier agent hierarchy** — Platform agents → agency agents → per-client agents, each level can override scheduling, skills, and budgets without duplicating the agent.
- **Hierarchical roles** — CEO / Orchestrator / Specialist / Worker, with delegation up to 5 levels deep. Scoped delegation (children / subtree / sub-account) enforced at execution time. Visible per-run delegation graph.
- **Per-client lead-agent guarantee** — Every sub-account has exactly one active lead agent at all times. Atomic rotation. Degraded fallback to agency Orchestrator if a lead is ever missing, with a health finding fired.
- **Capability-aware Orchestrator** — Deterministic four-path task routing (configured / configurable-narrow / configurable-broad / unsupported). Atomic capability-match: agent capability map AND active integration connection AND granted scopes — all three checked atomically. Auditable decision records per routing call. Loop-prevention guard. Post-handoff verification.
- **Configuration Assistant** — Conversational AI configuration of agents, skills, schedules, data sources, and operational config across 14 entity types. Plan-approve-execute flow with one-click restore.
- **Universal Brief** — Chat-first intake surface. Fast-path classifier for cheap intents. Smart clarification (up to 5 ranked questions). Adversarial assumption challenge for high-stakes actions. Structured approval cards. Learned Rules loop drafts candidate rules from operator approvals.
- **Personal Assistant** — Per-user dedicated assistant for calendar, inbox, Slack drafting, daily briefing, meeting prep. Standing autonomous mode within configured approval thresholds.
- **Inline Run Now testing** — Test runs from the agent/skill authoring page with real-time streamed output, tool-call timeline, token + cost metering. Test runs are flagged and excluded from agency P&L.
- **Per-conversation cost meter** — Live cumulative token + cost pill in chat threads.

### B.C — Workflow + supervision

- **Workflow Engine** — 8 step types: Human input, AI prompt, Agent handoff, Platform action, AI decision, Conditional, Approval gate, Invoke Automation. 5 run modes: hands-off, supervised, background, bulk, replay. Parallel execution with templating between steps.
- **Workflow Studio** — Chat-based authoring with validation, simulation, cost estimation, version history, fork-and-customise per agency.
- **Human-in-the-Loop** — 42+ review-gated actions. Approve-with-edits. Three gate levels (Auto / Review / Block). Side-effect classification (irreversible steps never auto-retry). Confidence escape (low-confidence tool calls redirected to clarifying questions). Rejection feedback used as training signal.
- **Pulse — Supervision Home** — Single-screen ops command centre. Three-lane classifier (Client-facing / Major / Internal) deterministic by impact (irreversibility, scope, cost). Live home dashboard. Bulk-approve with Major-lane safeguards. 409 concurrency guard against double-approval.
- **Task Board & Workspace** — Kanban with configurable columns per org / subaccount, agent assignment, deliverables, workflow transitions, board templates.
- **Portfolio-wide scheduled-work calendar** — Single surface showing every scheduled agent run, recurring workflow, and scheduled task across the org or per client for the next 7–30 days. Roll-ups by subaccount, source, and estimated cost. Exposed in the client portal as an "Upcoming work" card.
- **No-code workflow migration converter** — One-shot import of no-code workflow JSON exports into draft supervised workflows with approval gates and side-effect classification mapped from source nodes.
### B.D — Memory, knowledge, trust

- **Memory & Knowledge System** — Multi-layered: workspace memory (per-client fact store), semantic document retrieval (chunked, ranked at run start), three retrieval modes per document (auto / always-available / reference-only), memory blocks (named shared context with per-agent permissions), agent beliefs (confidence-scored facts per agent per client), org-level insights, cross-agent search, agent briefings (rolling summaries auto-generated post-run), citation tracking, full provenance, automated decay (90 days), nightly dedup.
- **Sub-account baseline** — 6 baseline artefacts captured at onboarding (brand identity, voice/tone, offer positioning, audience profile, operating constraints, proof library). Tier 1 prepended to every client-touching run. Tier 2 injected when role matches. Tier 3 retrieved on demand.
- **Document Bundles & Cached Context** — Reusable document libraries with per-run snapshot isolation, multi-file versioned upload, auto-bundles, budget-aware assembly with operator review gate on budget breach.
- **Trust & Verification Layer** — Skill verification (configurable quality checks), Scorecards (system / org / workspace scope), sampling controls, Bench evaluation against curated test inputs, Operator correction (captured as memory with full provenance), nightly pattern detection across corrections with embedding-based clustering.
- **Live Execution Log** — Per-run timeline streamed live and retained durably. Deep-link to source entity per event. Full prompt replay. Full call payload (permission-gated). Long-term retention with tiered storage. Runaway-loop protection.

### B.E — Agency-specific surface

- **Client Portal** — White-label client-facing surface scoped per subaccount. Agency brand colours. Self-service workflow execution. Workflow brief cards. Per-client isolation enforced.
- **Pages & Content Builder** — CMS-style page creation with analytics tracking and form submission handling. Draft → published workflow with mandatory human approval.
- **LLM Spend Observability & Per-Client P&L** — Cross-client financial dashboard. Per-call attribution with feature tag and source type. Platform overhead surfaced separately. Per-org / per-subaccount / per-source-type / per-provider+model breakdowns. Top-cost call triage with one-click detail drawer. Cancellation-aware billing. Double-bill protection on timeouts. Real-time in-flight call view with pre-dispatch queue-wait visibility. Forensic in-flight archive (7-day default).
- **Agent Spending** — Spending Budgets per sub-account (hard ceiling, daily and monthly caps, kill switch). Spending Policies with shadow-mode rollout, per-transaction limits, merchant allowlists, approval thresholds, category rules. Per-charge approval gates with multi-channel routing. Five payment skills (pay invoice, purchase, subscribe, top-up, refund) routed through one charge router. Immutable spend ledger with database-level lifecycle guards. Refunds preserve the original record. Tenant-isolated.
- **Activity & Analytics** — Unified stream across agent runs, reviews, health findings, workflow runs, task events, executions. Multi-scope filtering, real-time updates, CSV/JSON export.
- **Sub-account Optimiser** — Daily per-subaccount scan across 8 categories: agent over-budget, playbook escalation rate, slow skills vs peer benchmarks, inactive workflows, repeat escalation phrases, low memory citation efficiency, routing uncertainty, poor LLM cache reuse.
- **Workspace Health & Diagnostics** — 10 active detectors: inactive agents, empty skill allowlists, missing schedules, broken connections, stale connectors, missing engines, unsynced system agents, multiple active leads per sub-account, sub-accounts with no active lead, agents holding delegation skills with no team.
- **Memory Injection Utility** — Operators see what % of injected memory context is actually cited by agents. 30-day trend charts. Per-agent breakdown by entry utility. Measured-vs-unmeasured run distinction.
### B.F — Vertical agency capabilities

- **Performance Reporting & Analytics** — Auto-generated reports on schedule across social / ads / CRM pipeline / financial metrics. Human review gate before delivery.
- **SEO Management** — Prioritised SEO audits with actionable fixes on recurring schedule. Integrated with content creation.
- **GEO — AI Search Visibility** — Composite GEO Score (0–100) with per-dimension breakdown, per-engine readiness assessment, prioritised recommendations, 30-day improvement roadmap, llms.txt generation, competitive benchmarking.
- **Content Creation & Publishing** — Long-form content, social posts, ad copy, lead magnets, landing pages from a single brief. Platform-specific social variants. All publishing actions human-approved.
- **CRM & Contact Management** — Contact enrichment from third-party providers, pipeline velocity / conversion / forecast analysis, voice-of-customer reports, all CRM writes human-approved. Includes a deterministic-first CRM Query Planner (canonical query library with AI fallback for the long tail; read-only by construction; per-workspace plan cache).
- **Email Marketing & Outreach** — Inbound classification by intent / urgency, contextual follow-ups when deals go stale, knowledge-base support replies, multi-step sequences. All sends human-approved.
- **Campaign Management & Optimization** — Bid adjustments, budget changes, campaign pauses, copy updates — every change human-approved with supporting evidence.
- **Financial Analysis & Reporting** — Structured financial summaries from connected accounting systems. Approval-gated record updates.
- **Churn Detection & Account Health (ClientPulse)** — Composite health scoring from CRM, engagement, and activity metrics. Anomaly detection vs each account's own baseline. Real CRM-side intervention dispatch (fire automation, send email, send SMS, create task, operator alert) with idempotent retry and per-subaccount concurrency locks. Hourly outcome-measurement job tracks 14-day band change. Outcome-weighted recommendation engine. Per-client drilldown with 90-day band-transition timeline. Live CRM-data pickers in intervention editors. Multi-channel operator alerts.
- **Customer Support Automation** — Per-inbox agent modes (Disabled / Assisted / Autonomous) with collision window, respect-human-assignee, confidence threshold, voice profile, prompt override, escalation categories. Eval harness with classification-accuracy + draft-quality gates. Drift detection. 11 helpdesk skills (read tickets, propose reply, approve+send, reject draft, set status, assign, tag, customer history, internal note, classify).
- **Landing Page Management** — Full lifecycle agent-managed page creation. Publishing irreversible and always human-approved.
- **Competitor Intelligence** — Automated page monitoring with change detection, structured field extraction (zero-AI cost after first extraction), tiered scraping engine (HTTP → stealth Playwright → Scrapling anti-bot bypass).
- **Portfolio Intelligence** — Cross-client briefing with per-client health scores, priority actions, cross-client pattern insights. Cohort queries by subaccount tags.
- **Tier 4 Isolated Code Execution** — Ephemeral per-task isolated compute for customer-derived code and data. Default-deny network posture. Schema-validated output. Redaction pipeline. Cost-ceiling enforcement. Insert-only cost ledger. Credential injection (not embedding). Vendor-adapter architecture.

### B.G — Identity, infrastructure, integrations

- **Agent Workplace Identity** — Each agent gets a real workplace seat: dedicated email address, calendar, mailbox, org-chart row. Two backends in parallel (built-in native + cloud business-workspace provider). Actor / identity model survives backend migration. Per-agent mailbox + calendar inside the platform. Send-mail toggle, three-window rate limiting, central email pipeline (audit → rate-limit → signing → dispatch). Lifecycle management (activate / suspend / revoke / migrate). Seat tracking derived from active agent identities.
- **Sandboxed Runtime (IEE)** — On-demand isolated environment for browser automation (multi-step browser tasks, paywalled / login-protected content) and dev-mode (custom apps and scripts at the agency level). Live progress on long-running browser tasks. Connection-health validation for stored credentials. Full cost visibility (AI tokens + runtime).
- **Persistent Agent Workspace** — Always-on per-agent workspace surface showing current state, recent observations, knowledge sources, files produced, working time. Named presence states (Running / Waiting on you / Scheduled / Failing / Idle). Fleet view on Home page sectioned by what each agent is doing.
- **Subscription-Driven Long-Task Execution** — Subscription-mediated session management for multi-hour / multi-day tasks. Automatic session continuity (chain-resume) with per-task persistent browser context. Graceful fallback to direct billing when a session becomes unavailable. Per-subaccount concurrency caps and session budgets.
- **Skill System** — 100+ modular skills across 13 categories. Four-tier resolution (platform → built-in → agency-custom → per-client workspace). Per-agent allowlists. Skill authoring (definition editor, regression simulation, version history, rollback). Skill Analyzer (bulk import + automated comparison + tightening pass + transactional execution + one-click rollback). Review gating: 42+ skills HITL, 6 deterministic skills auto-execute.
- **Integration Framework** — OAuth providers (Gmail, Slack, HubSpot, Go High Level, Teamwork Desk, GitHub App). Connection ownership: user-owned / per-client / agency-wide. Scheduled ingestion with sync phases (initial → transition → live). Cost observability per connection. Canonical data layer normalising provider-specific records into a shared schema. MCP servers (stdio + http transport, credential binding to any OAuth provider, per-tool gate overrides, call observability, MCP cost attribution into the LLM cost pipeline). AI Subscriptions (connect a subscription as an alternative to managed model providers, per-agent availability controls). Webhooks (signed outbound, verified inbound).
- **Pluggable workflow engines** — n8n (self-hosted with HMAC-signed callbacks), Make (cloud), GHL Workflows (native), custom webhook (generic).

## Section C — What success of this research looks like

The deliverable answers exactly one question:

> **"Is there anything obvious Synthetos should build into v1 because shipping without it would be a credibility hit on day one in front of the agency buyer?"**

We are about to enter a development freeze and a full QA + deployment cycle. We are looking for the rare must-have that would be embarrassing to ship without — not a long roadmap.

We are NOT looking for:
- Long lists of nice-to-have polish (the operator can run that triage post-freeze)
- Recommendations to compete on any of the explicit non-goals in Section A
- Feature parity with horizontal agent platforms (parity is not the strategy)
- Suggestions to change positioning (the operations-layer-for-agencies frame is locked)

---

## PASS 1 — Identify competitors

Run this pass immediately upon receiving this brief. Do not begin Pass 2 until the operator replies "Proceed to Pass 2".

### Pass 1 deliverable

Produce a single response with these sections:

#### 1. Competitor map (clustered by competitive shape)

Group every relevant competitor into one of four clusters:

- **Direct competitors** — products that pitch themselves to agencies as the operating layer for AI agents managing multiple clients. These are the products an agency buyer might evaluate alongside Synthetos in the same RFP.
- **Adjacent competitors** — products built for a different buyer (individual operator, internal team, in-house ops) but that agencies are currently using as a stand-in because nothing better exists in their workflow.
- **Partial overlap** — products that solve one slice of the Synthetos surface well (e.g. AI-search auditing only, churn detection only, hosted single-agent only). Each competes only on a sub-feature, never on the whole.
- **Infrastructure layer** — LLM providers, agent SDKs, hosted-routine surfaces, and managed-agent platforms that the agency buyer might consider building on directly instead of buying Synthetos.

For each competitor in each cluster, capture:
- Name + URL
- One-sentence positioning (in their own marketing language)
- Stated buyer (agency / individual / internal team / developer)
- Pricing model (if public): SaaS, usage-based, per-seat, marketplace, etc.
- Funding stage / scale (if known): bootstrapped / seed / Series A+ / public
- Why placed in this cluster

Aim for completeness over conservatism — list every plausible competitor in scope. The operator will trim.

#### 2. Cluster summary

For each cluster, in 2–3 sentences:
- What kind of buyer is choosing products in this cluster, and why
- Where this cluster is likely to evolve over the next 12 months
- Whether the cluster is consolidating, fragmenting, or stable

#### 3. Direct-competitor shortlist

From the Direct cluster, name **the 3–5 strongest competitors** — the ones an agency buyer is most likely to evaluate alongside Synthetos in 2026. Be specific about who, and one-line each on why they made the shortlist.

#### 4. Open questions for the operator before Pass 2

If anything in Section B is ambiguous or seems to overlap with multiple clusters, list it now. The operator can clarify before Pass 2 begins.

#### 5. Stop signal

End Pass 1 with the literal text:

> **"Pass 1 complete. Reply 'Proceed to Pass 2' to continue with comparison + gap analysis + recommendations."**

Do not begin Pass 2 in this turn. Wait for the trigger.

## PASS 2 — Comparison, gap analysis, pre-freeze recommendations

Run this pass only after the operator replies "Proceed to Pass 2". Use the Direct shortlist from Pass 1 as the comparison set.

### Pass 2 deliverable

Produce a single response with these sections:

#### 1. Capability comparison matrix

A side-by-side matrix. Rows are capability categories (drawn from Sections B.A through B.G of this brief — use the same group labels). Columns are: **Synthetos** plus each Direct shortlist competitor from Pass 1, plus 1–2 of the most relevant Adjacent competitors.

For each cell, mark one of:
- **Yes (mature)** — capability exists and is production-ready
- **Yes (basic)** — capability exists but is shallow vs the rest of the row
- **Partial** — capability exists for a slice of the use case
- **No** — capability does not exist
- **Unknown** — could not confirm from public sources

Cite sources for every "Yes" / "Partial" claim about a competitor (URL, dated docs page, pricing page, public changelog). Do not infer capabilities from marketing copy alone — flag inferred items as "Unknown" rather than "Yes".

#### 2. Gap analysis

Walk the matrix and produce three gap lists:

**Parity gaps** — table-stakes capabilities most direct competitors have that Synthetos does not. For each: what it is, who has it, why agencies expect it.

**Differentiation gaps** — capabilities a single competitor has built that genuinely act as a wedge against Synthetos in a competitive deal. For each: what the wedge is, which competitor, and what an agency buyer would say in the room.

**Non-issues** — gaps that exist but are explicit non-goals from Section A. Acknowledge them and move on; do not propose closing them.

#### 3. Pre-freeze recommendation list

This is the most important output. Produce a ranked list of features to consider building before the v1 freeze.

For each item:
- **Name** — short feature name
- **Tier** — `Must`, `Should`, or `Defer`
  - `Must` — shipping v1 without this is a day-one credibility hit in front of an agency buyer evaluating Synthetos against the Direct shortlist
  - `Should` — improves competitive position but Synthetos can credibly ship without it
  - `Defer` — proposed only because it might be raised; route to backlog post-freeze
- **One-line rationale** — why it matters, citing the gap from §2
- **Rough scope** — small / medium / large (relative effort), with a one-line implementation sketch
- **Over-engineering risk** — explicitly flag if this is a feature where doing it badly is worse than not doing it; or where the Synthetos opinionated answer differs from the competitor's answer and copying would be a mistake

Cap the `Must` list at **5 items**. If you can't keep it under 5, you have not been ruthless enough — re-rank. The operator wants the rare must-have, not a long list.

#### 4. Final read

Two paragraphs, max:

- **Today.** If an agency buyer evaluated Synthetos against the Direct shortlist tomorrow, would they pick Synthetos? If not, what is the single biggest reason?
- **Post-freeze.** If Synthetos shipped v1 with the `Must` items above and nothing else, does the answer to the first question change?

#### 5. Sources cited

A consolidated reference list with every URL referenced in §1 and §2. Date-tag each (when the page was last updated, or when you accessed it).

---

## Constraints on both passes

- **Do not propose features that conflict with Section A non-goals.** If you are tempted to, add it to a "Considered and rejected" appendix at the end of Pass 2 with a one-line reason.
- **Do not rewrite Synthetos's positioning.** The operations-layer-for-agencies frame is locked.
- **Be specific.** "Improve onboarding" is not a recommendation — "Add a guided tour overlay on first-run that introduces the supervision home, calendar, and approval queue" is.
- **Cite sources.** Every claim about a competitor's capability must link to a public source. Marketing copy is not evidence of capability — flag inferred items honestly.
- **Match the operator's frame.** The agency buyer is non-technical: they care about whether they can run their book of client work on Synthetos with confidence. They do not care about agent SDK ergonomics, model benchmarks, or developer-platform polish.
- **Consider the freeze deadline.** Recommendations must be plausibly buildable before a development freeze. Anything that requires a multi-month build is automatically `Defer`.

---

## Begin Pass 1 now.
