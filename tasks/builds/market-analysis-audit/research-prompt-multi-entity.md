# Market Analysis Research Brief (v2) — Synthetos for Multi-Entity Businesses

You are conducting a deep market analysis for an AI agent operations platform, framed for a **multi-entity business** buyer. This is a parallel research run to a separate brief that frames the same product for agencies — both briefs cover the same capability surface, but the buyer hypothesis is different and the competitor set is expected to be different.

This brief is structured as **two passes in one conversation**.

- **Pass 1** runs immediately when you receive this prompt: identify the competitive landscape and cluster competitors by competitive shape. Stop at the end of Pass 1 and wait for the operator to reply with the literal text **"Proceed to Pass 2"** before continuing.
- **Pass 2** runs after that reply: produce a side-by-side capability comparison, a gap analysis, and a ranked pre-freeze recommendation list.

Do not begin Pass 2 until you receive the "Proceed to Pass 2" trigger.

---

## Section A — What Synthetos / Automation OS is (multi-entity framing)

**Brand:** Synthetos. **Product name:** Automation OS.

**One-sentence positioning (multi-entity framing):**
> Synthetos is the operations system a business uses to run multiple operating entities under one parent — multi-entity isolation, per-entity workflows and approvals, roll-up reporting and P&L, supervised AI agents, and a per-entity self-service surface, on top of any frontier LLM.

**Buyer:** Any business that operates **multiple distinct entities under a single parent organisation** and needs to run them with strict isolation, central oversight, and consistent operating standards. Concrete examples — to ground competitor identification, not to be exhaustive:

- Holding companies with subsidiary operating companies
- Multi-location franchise systems (restaurant, retail, services, fitness, home services)
- Multi-brand groups (consumer goods, retail, hospitality)
- Multi-practice professional services firms (law, accounting, consulting — distinct practice groups, jurisdictions, or sectors)
- Multi-region operations (one company operating across separate legal or operational entities)
- Private equity firms running operational support across portfolio companies
- Multi-fund investment managers
- Multi-product / multi-service-line businesses where each line operates semi-autonomously

**Structural buyer requirement:** the buyer is the parent — the people responsible for running multiple entities with shared infrastructure, central oversight, and roll-up reporting. They are not the buyer of a single-tenant SaaS tool.

**The frame:**

LLM providers and horizontal AI platforms sell **primitives** — a model, an SDK, scheduled prompts, a hosted single-agent surface, a skills format. Synthetos sells the **operations system that happens to run agents**. The pitch is not "we have agents and skills" — those are increasingly commodity. The pitch is the operations layer that sits on top: multi-entity isolation enforced at the database layer, supervised workflows with approval gates, per-entity economics and P&L, per-entity self-service portals, vertical operational capabilities.

**Capability non-goals (do not propose features that compete on these axes):**

- Not a better agent SDK
- Not a better general-purpose chat UI
- Not a standalone IDE / developer platform
- Not a commodity workflow automation tool (stateless trigger/action chains)
- Not a hosted routines / scheduled-prompt product for individuals
- Not a horizontal RPA platform (no screen-scraping / UI-automation focus beyond contained browser sessions)
- Not an ERP (no general ledger, accounts-payable, inventory, or HRIS ambition)
- Not a public skill or playbook marketplace

**What is open to question in this research:**

Unlike the agency-framed brief, the multi-entity positioning **is not locked**. The purpose of this research is to test whether this framing has a credible competitive position. If the analysis surfaces that "multi-entity business" is too broad to defend, or that distinct sub-segments (holding cos vs franchise systems vs professional services) need different framing, flag this in Pass 1 §4 and Pass 2 §4.

---

## Section B — Capability inventory

Group A through G below is the complete capability surface as of 2026-05-15. Treat this as authoritative — if a category seems missing from the list, it is intentionally absent.

**Language note:** throughout this brief, "entity" means a subsidiary, location, brand, practice, fund, or other operating unit under a parent business. The product internally calls these *subaccounts*; rebadge mentally as you read. The three-tier hierarchy maps as: **System** (platform), **Organisation** (parent business), **Subaccount / Entity** (the operating unit).

### B.A — Platform foundations

- **Multi-entity three-tier isolation** — System → Parent business → Entity. Strict data, memory, configuration, and billing isolation enforced at the database layer. One platform deployment runs an arbitrary number of entities with no cross-contamination.
- **Authentication & access control** — Five roles, granular permission keys, principal-based data access (user / service / delegated principals), delegation grants with auto-expiry, four-tier visibility scoping (private / shared-team / shared-entity / shared-parent) enforced at the database layer.
- **Execution infrastructure** — 24+ background job types across 10 priority tiers, exactly-once execution guarantees, automatic retry with crash-resume, real-time WebSocket streaming, hard cost ceilings per run, infinite-loop detection, working-time accounting that matches the invoice line.

### B.B — Agent runtime

- **Three-tier agent hierarchy** — Platform agents → parent-business agents → per-entity agents, each level can override scheduling, skills, and budgets without duplicating the agent.
- **Hierarchical roles** — CEO / Orchestrator / Specialist / Worker, with delegation up to 5 levels deep. Scoped delegation (children / subtree / entity) enforced at execution time. Visible per-run delegation graph.
- **Per-entity lead-agent guarantee** — Every entity has exactly one active lead agent at all times. Atomic rotation. Degraded fallback to parent-level Orchestrator if a lead is ever missing, with a health finding fired.
- **Capability-aware Orchestrator** — Deterministic four-path task routing (configured / configurable-narrow / configurable-broad / unsupported). Atomic capability-match: agent capability map AND active integration connection AND granted scopes — all three checked atomically. Auditable decision records per routing call. Loop-prevention guard. Post-handoff verification.
- **Configuration Assistant** — Conversational AI configuration of agents, skills, schedules, data sources, and operational config across 14 entity types. Plan-approve-execute flow with one-click restore.
- **Universal Brief** — Chat-first intake surface. Fast-path classifier for cheap intents. Smart clarification (up to 5 ranked questions). Adversarial assumption challenge for high-stakes actions. Structured approval cards. Learned Rules loop drafts candidate rules from operator approvals.
- **Personal Assistant** — Per-user dedicated assistant for calendar, inbox, Slack drafting, daily briefing, meeting prep. Standing autonomous mode within configured approval thresholds.
- **Inline Run Now testing** — Test runs from the agent/skill authoring page with real-time streamed output, tool-call timeline, token + cost metering. Test runs are flagged and excluded from parent-business P&L.
- **Per-conversation cost meter** — Live cumulative token + cost pill in chat threads.

### B.C — Workflow + supervision

- **Workflow Engine** — 8 step types: Human input, AI prompt, Agent handoff, Platform action, AI decision, Conditional, Approval gate, Invoke Automation. 5 run modes: hands-off, supervised, background, bulk, replay. Parallel execution with templating between steps.
- **Workflow Studio** — Chat-based authoring with validation, simulation, cost estimation, version history, fork-and-customise per entity.
- **Human-in-the-Loop** — 42+ review-gated actions. Approve-with-edits. Three gate levels (Auto / Review / Block). Side-effect classification (irreversible steps never auto-retry). Confidence escape (low-confidence tool calls redirected to clarifying questions). Rejection feedback used as training signal.
- **Pulse — Supervision Home** — Single-screen ops command centre. Three-lane classifier (Entity-facing / Major / Internal) deterministic by impact (irreversibility, scope, cost). Live home dashboard. Bulk-approve with Major-lane safeguards. 409 concurrency guard against double-approval.
- **Task Board & Workspace** — Kanban with configurable columns per parent / entity, agent assignment, deliverables, workflow transitions, board templates.
- **Portfolio-wide scheduled-work calendar** — Single surface showing every scheduled agent run, recurring workflow, and scheduled task across the parent business or per entity for the next 7–30 days. Roll-ups by entity, source, and estimated cost. Exposed in the entity portal as an "Upcoming work" card.
- **No-code workflow migration converter** — One-shot import of no-code workflow JSON exports into draft supervised workflows with approval gates and side-effect classification mapped from source nodes.
### B.D — Memory, knowledge, trust

- **Memory & Knowledge System** — Multi-layered: entity memory (per-entity fact store), semantic document retrieval (chunked, ranked at run start), three retrieval modes per document (auto / always-available / reference-only), memory blocks (named shared context with per-agent permissions), agent beliefs (confidence-scored facts per agent per entity), parent-level insights, cross-agent search, agent briefings (rolling summaries auto-generated post-run), citation tracking, full provenance, automated decay (90 days), nightly dedup.
- **Per-entity baseline** — 6 baseline artefacts captured at entity onboarding (identity, voice/tone, offer positioning, audience profile, operating constraints, proof library). Tier 1 prepended to every entity-touching run. Tier 2 injected when role matches. Tier 3 retrieved on demand.
- **Document Bundles & Cached Context** — Reusable document libraries with per-run snapshot isolation, multi-file versioned upload, auto-bundles, budget-aware assembly with operator review gate on budget breach.
- **Trust & Verification Layer** — Skill verification (configurable quality checks), Scorecards (system / parent / entity scope), sampling controls, Bench evaluation against curated test inputs, Operator correction (captured as memory with full provenance), nightly pattern detection across corrections with embedding-based clustering.
- **Live Execution Log** — Per-run timeline streamed live and retained durably. Deep-link to source entity per event. Full prompt replay. Full call payload (permission-gated). Long-term retention with tiered storage. Runaway-loop protection.

### B.E — Per-entity operations surface

- **Entity Portal** — Self-service surface scoped per entity. Branding configurable per entity (different brands, locations, or subsidiaries can carry their own visual identity). Self-service workflow execution. Workflow brief cards. Per-entity isolation enforced.
- **Pages & Content Builder** — CMS-style page creation with analytics tracking and form submission handling. Draft → published workflow with mandatory human approval.
- **LLM Spend Observability & Per-Entity P&L** — Cross-entity financial dashboard. Per-call attribution with feature tag and source type. Platform overhead surfaced separately. Per-parent / per-entity / per-source-type / per-provider+model breakdowns. Top-cost call triage with one-click detail drawer. Cancellation-aware billing. Double-bill protection on timeouts. Real-time in-flight call view with pre-dispatch queue-wait visibility. Forensic in-flight archive (7-day default).
- **Agent Spending** — Spending Budgets per entity (hard ceiling, daily and monthly caps, kill switch). Spending Policies with shadow-mode rollout, per-transaction limits, merchant allowlists, approval thresholds, category rules. Per-charge approval gates with multi-channel routing. Five payment skills (pay invoice, purchase, subscribe, top-up, refund) routed through one charge router. Immutable spend ledger with database-level lifecycle guards. Refunds preserve the original record. Tenant-isolated.
- **Activity & Analytics** — Unified stream across agent runs, reviews, health findings, workflow runs, task events, executions. Multi-scope filtering, real-time updates, CSV/JSON export.
- **Per-entity Optimiser** — Daily per-entity scan across 8 categories: agent over-budget, playbook escalation rate, slow skills vs peer benchmarks, inactive workflows, repeat escalation phrases, low memory citation efficiency, routing uncertainty, poor LLM cache reuse.
- **Workspace Health & Diagnostics** — 10 active detectors: inactive agents, empty skill allowlists, missing schedules, broken connections, stale connectors, missing engines, unsynced system agents, multiple active leads per entity, entities with no active lead, agents holding delegation skills with no team.
- **Memory Injection Utility** — Operators see what % of injected memory context is actually cited by agents. 30-day trend charts. Per-agent breakdown by entry utility. Measured-vs-unmeasured run distinction.
### B.F — Operational capabilities (universal + services-oriented)

The capabilities below ship today. Some are **universal** — relevant to any multi-entity business. Others are **services-oriented** — most valuable when entities perform marketing, sales, or client-facing work. For non-services multi-entity buyers (e.g. a holding company with industrial subsidiaries), the services-oriented capabilities are still functional but less differentiating. Mark cells accordingly in Pass 2.

**Universal:**

- **Performance Reporting & Analytics** — Auto-generated reports on schedule across operational and financial metrics. Human review gate before delivery.
- **Financial Analysis & Reporting** — Structured financial summaries from connected accounting systems. Approval-gated record updates.
- **Account / Customer Health (ClientPulse)** — Composite health scoring from CRM, engagement, and activity metrics. Anomaly detection vs each account's own baseline. Real CRM-side intervention dispatch (fire automation, send email, send SMS, create task, operator alert) with idempotent retry and per-entity concurrency locks. Hourly outcome-measurement job tracks 14-day band change. Outcome-weighted recommendation engine. Per-account drilldown with 90-day band-transition timeline. Live CRM-data pickers in intervention editors. Multi-channel operator alerts.
- **Customer Support Automation** — Per-inbox agent modes (Disabled / Assisted / Autonomous) with collision window, respect-human-assignee, confidence threshold, voice profile, prompt override, escalation categories. Eval harness with classification-accuracy + draft-quality gates. Drift detection. 11 helpdesk skills (read tickets, propose reply, approve+send, reject draft, set status, assign, tag, customer history, internal note, classify).
- **Competitor / Market Intelligence** — Automated page monitoring with change detection, structured field extraction (zero-AI cost after first extraction), tiered scraping engine (HTTP → stealth Playwright → Scrapling anti-bot bypass).
- **Portfolio Intelligence** — Cross-entity briefing with per-entity health scores, priority actions, cross-entity pattern insights. Cohort queries by entity tags.
- **Tier 4 Isolated Code Execution** — Ephemeral per-task isolated compute for customer-derived code and data. Default-deny network posture. Schema-validated output. Redaction pipeline. Cost-ceiling enforcement. Insert-only cost ledger. Credential injection (not embedding). Vendor-adapter architecture.

**Services-oriented (most valuable when entities perform marketing or sales work):**

- **SEO Management** — Prioritised SEO audits with actionable fixes on recurring schedule. Integrated with content creation.
- **GEO — AI Search Visibility** — Composite GEO Score (0–100) with per-dimension breakdown, per-engine readiness assessment, prioritised recommendations, 30-day improvement roadmap, llms.txt generation, competitive benchmarking.
- **Content Creation & Publishing** — Long-form content, social posts, ad copy, lead magnets, landing pages from a single brief. Platform-specific social variants. All publishing actions human-approved.
- **CRM & Contact Management** — Contact enrichment from third-party providers, pipeline velocity / conversion / forecast analysis, voice-of-customer reports, all CRM writes human-approved. Includes a deterministic-first CRM Query Planner (canonical query library with AI fallback for the long tail; read-only by construction; per-workspace plan cache).
- **Email Marketing & Outreach** — Inbound classification by intent / urgency, contextual follow-ups when deals go stale, knowledge-base support replies, multi-step sequences. All sends human-approved.
- **Campaign Management & Optimization** — Bid adjustments, budget changes, campaign pauses, copy updates — every change human-approved with supporting evidence.
- **Landing Page Management** — Full lifecycle agent-managed page creation. Publishing irreversible and always human-approved.

### B.G — Identity, infrastructure, integrations

- **Agent Workplace Identity** — Each agent gets a real workplace seat: dedicated email address, calendar, mailbox, org-chart row. Two backends in parallel (built-in native + cloud business-workspace provider). Actor / identity model survives backend migration. Per-agent mailbox + calendar inside the platform. Send-mail toggle, three-window rate limiting, central email pipeline (audit → rate-limit → signing → dispatch). Lifecycle management (activate / suspend / revoke / migrate). Seat tracking derived from active agent identities.
- **Sandboxed Runtime (IEE)** — On-demand isolated environment for browser automation (multi-step browser tasks, paywalled / login-protected content) and dev-mode (custom apps and scripts at the parent level). Live progress on long-running browser tasks. Connection-health validation for stored credentials. Full cost visibility (AI tokens + runtime).
- **Persistent Agent Workspace** — Always-on per-agent workspace surface showing current state, recent observations, knowledge sources, files produced, working time. Named presence states (Running / Waiting on you / Scheduled / Failing / Idle). Fleet view on Home page sectioned by what each agent is doing.
- **Subscription-Driven Long-Task Execution** — Subscription-mediated session management for multi-hour / multi-day tasks. Automatic session continuity (chain-resume) with per-task persistent browser context. Graceful fallback to direct billing when a session becomes unavailable. Per-entity concurrency caps and session budgets.
- **Skill System** — 100+ modular skills across 13 categories. Four-tier resolution (platform → built-in → parent-custom → per-entity workspace). Per-agent allowlists. Skill authoring (definition editor, regression simulation, version history, rollback). Skill Analyzer (bulk import + automated comparison + tightening pass + transactional execution + one-click rollback). Review gating: 42+ skills HITL, 6 deterministic skills auto-execute.
- **Integration Framework** — OAuth providers (Gmail, Slack, HubSpot, Go High Level, Teamwork Desk, GitHub App). Connection ownership: user-owned / per-entity / parent-wide. Scheduled ingestion with sync phases (initial → transition → live). Cost observability per connection. Canonical data layer normalising provider-specific records into a shared schema. MCP servers (stdio + http transport, credential binding to any OAuth provider, per-tool gate overrides, call observability, MCP cost attribution into the LLM cost pipeline). AI Subscriptions (connect a subscription as an alternative to managed model providers, per-agent availability controls). Webhooks (signed outbound, verified inbound).
- **Pluggable workflow engines** — n8n (self-hosted with HMAC-signed callbacks), Make (cloud), GHL Workflows (native), custom webhook (generic).

## Section C — What success of this research looks like

The deliverable answers two questions:

> **Question 1 (positioning fit):** Is "operations system for multi-entity businesses" a defensible competitive position, or does the market punish that breadth by forcing a choice between sub-segments (holding cos / franchises / multi-practice services / portfolio operators)?
>
> **Question 2 (pre-freeze gaps):** Within the most defensible sub-segment from Question 1, is there anything obvious Synthetos should build into v1 because shipping without it would be a credibility hit on day one?

We are about to enter a development freeze and a full QA + deployment cycle. Look for the rare must-have that would be embarrassing to ship without — not a long roadmap.

We are NOT looking for:
- Long lists of nice-to-have polish (the operator can run that triage post-freeze)
- Recommendations to compete on the capability non-goals in Section A
- Feature parity with horizontal agent platforms (parity is not the strategy)
- Recommendations to become an ERP, an RPA platform, or a generic BPM tool

---

## PASS 1 — Identify competitors

Run this pass immediately upon receiving this brief. Do not begin Pass 2 until the operator replies "Proceed to Pass 2".

### Pass 1 deliverable

Produce a single response with these sections:

#### 1. Sub-segment analysis

Before identifying competitors, decompose "multi-entity business" into the sub-segments that actually buy differently. For each sub-segment that is plausibly a Synthetos buyer, capture:

- **Sub-segment name** (e.g. holding company / multi-location franchise / multi-brand retail / multi-practice professional services / portfolio operations / multi-region operations / multi-fund investment management)
- **Buyer profile** — who signs the contract, what title, how big the business typically is
- **Core operational pain Synthetos addresses** for this sub-segment, in their words
- **Whether the sub-segment is a credible Synthetos buyer** — yes / probable / weak — with one-line rationale
- **What distinct positioning Synthetos would need for this sub-segment** vs the generic "multi-entity" frame

This section answers Question 1 from Section C. Be honest if a sub-segment is too thin or too well-served by an existing category to be worth Synthetos pursuing.

#### 2. Competitor map (clustered by competitive shape)

Group every relevant competitor into one of four clusters. Tag each competitor with the sub-segment(s) from §1 they most strongly target.

- **Direct competitors** — products that pitch themselves to multi-entity businesses as an operating layer with AI agents, supervised workflows, and per-entity isolation. An RFP would consider Synthetos alongside these.
- **Adjacent competitors** — products built for a different buyer (single-tenant SaaS, in-house enterprise teams, individual operators) but that multi-entity businesses are currently using as a stand-in because nothing better exists in their workflow.
- **Partial overlap** — products that solve one slice of the Synthetos surface well (multi-location reporting only, multi-subsidiary financial consolidation only, AI ops for one function only, franchise management platforms with no AI layer, etc.).
- **Infrastructure layer** — LLM providers, agent SDKs, hosted-routine surfaces, and managed-agent platforms that a multi-entity buyer might consider building on directly instead of buying Synthetos.

For each competitor, capture:
- Name + URL
- One-sentence positioning (in their own marketing language)
- Stated buyer
- Pricing model (if public): SaaS, usage-based, per-seat, marketplace, enterprise contract
- Funding stage / scale (if known)
- Sub-segments targeted (from §1)
- Why placed in this cluster

Aim for completeness — list every plausible competitor in scope. The operator will trim.

#### 3. Cluster + sub-segment summary

For each cluster, in 2–3 sentences:
- Which sub-segments this cluster serves best
- Where this cluster is likely to evolve over the next 12 months
- Whether the cluster is consolidating, fragmenting, or stable

#### 4. Direct-competitor shortlist + recommended sub-segment

Two outputs in this section:

**(a) Recommended sub-segment to lead with.** From §1, name the single sub-segment Synthetos should lead positioning with — the one where the buyer profile is largest, the gap vs existing competition is widest, and Synthetos's structural strengths (multi-entity isolation, supervised workflows, per-entity P&L, agent ops) map most cleanly to the buyer's pain. One paragraph of rationale.

**(b) Direct-competitor shortlist.** From the Direct cluster, name **the 3–5 strongest competitors in the recommended sub-segment** — the ones a buyer in that sub-segment is most likely to evaluate alongside Synthetos in 2026. One-line each on why they made the shortlist.

#### 5. Open questions for the operator before Pass 2

If anything in Section B is ambiguous or seems to overlap with multiple clusters or sub-segments, list it now.

#### 6. Stop signal

End Pass 1 with the literal text:

> **"Pass 1 complete. Reply 'Proceed to Pass 2' to continue with comparison + gap analysis + recommendations."**

Do not begin Pass 2 in this turn. Wait for the trigger.

## PASS 2 — Comparison, gap analysis, pre-freeze recommendations

Run this pass only after the operator replies "Proceed to Pass 2". Use the recommended sub-segment and Direct shortlist from Pass 1 §4 as the comparison set.

### Pass 2 deliverable

Produce a single response with these sections:

#### 1. Capability comparison matrix

A side-by-side matrix scoped to the recommended sub-segment. Rows are capability categories (drawn from Sections B.A through B.G of this brief — use the same group labels). For B.F, treat universal and services-oriented as separate row groups so non-services buyers can read the matrix cleanly.

Columns: **Synthetos** plus each Direct shortlist competitor from Pass 1 §4(b), plus 1–2 of the most relevant Adjacent competitors.

For each cell, mark one of:
- **Yes (mature)** — capability exists and is production-ready
- **Yes (basic)** — capability exists but is shallow vs the rest of the row
- **Partial** — capability exists for a slice of the use case
- **No** — capability does not exist
- **Unknown** — could not confirm from public sources

Cite sources for every "Yes" / "Partial" claim about a competitor (URL, dated docs page, pricing page, public changelog). Do not infer capabilities from marketing copy alone — flag inferred items as "Unknown" rather than "Yes".

#### 2. Gap analysis

Walk the matrix and produce three gap lists, scoped to the recommended sub-segment:

**Parity gaps** — table-stakes capabilities most direct competitors have that Synthetos does not. For each: what it is, who has it, why buyers in this sub-segment expect it.

**Differentiation gaps** — capabilities a single competitor has built that genuinely act as a wedge against Synthetos in a competitive deal. For each: what the wedge is, which competitor, and what a buyer in this sub-segment would say in the room.

**Non-issues** — gaps that exist but are explicit capability non-goals from Section A, or services-oriented capabilities that don't matter to the recommended sub-segment. Acknowledge them and move on; do not propose closing them.

#### 3. Pre-freeze recommendation list

This is the most important output. Produce a ranked list of features to consider building before the v1 freeze, scoped to the recommended sub-segment.

For each item:
- **Name** — short feature name
- **Tier** — `Must`, `Should`, or `Defer`
  - `Must` — shipping v1 without this is a day-one credibility hit in front of a buyer in the recommended sub-segment evaluating Synthetos against the Direct shortlist
  - `Should` — improves competitive position but Synthetos can credibly ship without it
  - `Defer` — proposed only because it might be raised; route to backlog post-freeze
- **One-line rationale** — why it matters, citing the gap from §2
- **Rough scope** — small / medium / large (relative effort), with a one-line implementation sketch
- **Over-engineering risk** — explicitly flag if this is a feature where doing it badly is worse than not doing it; or where the Synthetos opinionated answer differs from the competitor's answer and copying would be a mistake
- **Sub-segment fit** — does this feature only matter for the recommended sub-segment, or does it generalise across multi-entity buyers? If single-sub-segment, name it.

Cap the `Must` list at **5 items**. If you can't keep it under 5, you have not been ruthless enough — re-rank. The operator wants the rare must-have, not a long list.

#### 4. Final read

Three paragraphs, max:

- **Today (positioning).** Is "operations system for multi-entity businesses" a defensible position, or does the recommended sub-segment from Pass 1 demand a tighter framing? If tighter, what is it?
- **Today (competition).** If a buyer in the recommended sub-segment evaluated Synthetos against the Direct shortlist tomorrow, would they pick Synthetos? If not, what is the single biggest reason?
- **Post-freeze.** If Synthetos shipped v1 with the `Must` items above and nothing else, does the answer to the competition question change?

#### 5. Sources cited

A consolidated reference list with every URL referenced in §1 and §2. Date-tag each (when the page was last updated, or when you accessed it).

---

## Constraints on both passes

- **Do not propose features that conflict with Section A non-goals.** If you are tempted to, add it to a "Considered and rejected" appendix at the end of Pass 2 with a one-line reason.
- **The multi-entity positioning is open to challenge.** Unlike the agency-framed brief, the framing here is being tested. If you believe the multi-entity frame is too broad and a tighter sub-segment is the right wedge, say so explicitly in Pass 1 §1 and Pass 2 §4 — don't smuggle it into the recommendations.
- **Be specific.** "Improve onboarding" is not a recommendation — "Add a per-entity onboarding wizard that captures legal entity name, registered address, financial-system account ID, and primary operator, then auto-creates the entity with default workflows pre-attached" is.
- **Cite sources.** Every claim about a competitor's capability must link to a public source. Marketing copy is not evidence of capability — flag inferred items honestly.
- **Match the operator's frame.** The multi-entity buyer is typically operations leadership at the parent — COO, Head of Operations, GM of Operating Companies, Head of Portfolio Operations. They care about consistency, oversight, roll-up reporting, and not having to redo onboarding on every new entity. They do not care about agent SDK ergonomics, model benchmarks, or developer-platform polish.
- **Consider the freeze deadline.** Recommendations must be plausibly buildable before a development freeze. Anything that requires a multi-month build is automatically `Defer`.

---

## Begin Pass 1 now.
