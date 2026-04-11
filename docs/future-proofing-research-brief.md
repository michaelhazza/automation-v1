# Automation OS — Future-Proofing Research Brief

**Purpose:** Hand this document to a web-capable Claude session (or any external researcher) to produce a strategic assessment of whether Automation OS is positioned correctly against the frontier of AI agent innovation — things like Claude Cowork, Computer Use / Operator / Agent SDK, self-running autonomous agents, and agency-platform competitors. The researcher should return a structured recommendation set covering: keep-doing, pivot-on, kill, and add.

**Audience for the researcher's output:** Founder / CEO. The output drives product strategy for the next 6–12 months. It is not tactical — tactical gaps are already catalogued in `docs/ai-agent-repo-research-report.md`, `docs/improvements-roadmap.md`, and `docs/external-improvements.md`. Read those only as background; do not duplicate their scope.

**Date:** 2026-04-11
**Status:** Draft, ready to hand to researcher.

---

## Table of contents

1. Purpose & how to use this brief
2. Automation OS snapshot (what we've built)
3. The architectural bet we've made
4. The strategic question & testable hypotheses
5. Research areas (with specific prompts)
6. Companies and products to study (watchlist)
7. Deliverable format & what would change our minds

---

## 1. Purpose & how to use this brief

### Why this brief exists

Automation OS is pre-launch and in rapid evolution (see `docs/spec-context.md` for the current framing). We have made a set of architectural bets — multi-tenant agency model, three-tier agent hierarchy, file-based skills, heavy middleware/HITL/policy stack, DAG-based Playbooks, isolated browser/dev execution via IEE. Those bets were made against the AI landscape of ~12 months ago. The landscape has since accelerated:

- **Claude Cowork** / similar "AI coworker" products that automate discrete employee jobs end-to-end.
- **Computer Use / Operator / Agent SDK**: model providers shipping their own general-purpose agent runtimes.
- **MCP and tool ecosystems**: tool discovery shifting from hand-curated registries to published protocol servers.
- **Self-running autonomous agents**: products that set their own goals, manage their own backlog, and coordinate with each other.
- **Frontier model capability jumps**: each new model generation absorbs functionality that used to need external scaffolding (reflection loops, planners, critics).

The founder question driving this brief is simple: **are we building for a world that's about to exist, or for a world that's about to be obsolete?** If the frontier is eating our scaffolding, we want to know before we invest another quarter hardening it.

### How the researcher should use this brief

The researcher has **web access** and should treat this as a live investigation, not a literature review. Specific instructions:

1. **Read sections 2–4 first.** They are the product snapshot, the architectural bet, and the strategic question. You need to internalise the bet before you can evaluate it.
2. **Work the hypotheses in section 4.** Each hypothesis is phrased so it can be confirmed or falsified with concrete evidence from the market. Do not just summarise — commit to a verdict per hypothesis with the evidence attached.
3. **Use section 5 as the research workplan.** Each area has specific prompts. You do not need to cover every prompt — prioritise the ones that most directly affect the verdict on a hypothesis.
4. **Use section 6 as a starting watchlist.** It is not exhaustive. If you find a product or company we missed, add it to your output.
5. **Return the deliverable in the format specified in section 7.** The founder needs a structured decision document, not a narrative.
6. **Be opinionated.** The worst failure mode is a balanced-on-all-sides summary that gives the founder no signal. If the evidence points one way, say so.

### What is in scope vs. out of scope

**In scope:**
- Paradigm-level questions: is structured/governed agency tooling still the right product category, or has the frontier shifted?
- Commercial questions: where is revenue actually flowing in the AI agent space, and for what shape of product?
- Competitive positioning: who is Automation OS actually competing with, and on what axes are they winning?
- Product direction: what new primitive or capability would most meaningfully change our trajectory?

**Out of scope:**
- Tactical library / repo adoption (already covered in `docs/ai-agent-repo-research-report.md`)
- Feature-level gap analysis against named competitors (covered in `docs/external-improvements.md`)
- Implementation detail for any recommended change — this brief produces direction, not specs
- Any critique of the code-level architecture (services, routes, schemas). The brief is about *what* we build, not *how* we build it.

## 2. Automation OS snapshot

### One-line description

Automation OS is a **multi-tenant AI agent platform for agencies and operators who run AI workflows across many end-client accounts**, with a strong emphasis on safe autonomy: policy-gated tool calls, HITL review queues, per-tenant cost ceilings, and deterministic DAG-based multi-step automation.

### Who it's for

- **Primary ICP:** Agencies managing 10+ end-client accounts (first wedge is GoHighLevel agencies, but the model generalises to any agency/MSP — SEO, marketing, property managers, bookkeeping, etc.).
- **Secondary ICP:** Internal operations teams at mid-market companies running AI workflows across business units.
- **Not for:** Solo operators who want one autonomous agent to run their business end-to-end (that's the Polsia / Claude Cowork market). Automation OS requires configuration; it is a platform, not a turnkey agent.

### Core mental model

Three nested tenancy tiers map to a three-tier agent model:

```
Platform (we run this)
  └── System Agents        (platform IP, hidden master prompts, seeded vertical templates)
        ↓ seeds / links
Organisation (an agency)
  └── Org Agents           (agency-owned or system-managed; additionalPrompt layer)
        ↓ linked to
Subaccount (an end client)
  └── Subaccount Agents    (per-client overrides: skills, prompt, schedule, budget)
```

An agency signs up once, configures a set of agents once, then links those agents into every end-client workspace with per-client overrides. The same "Weekly Portfolio Report" agent runs against 40 clients on 40 different schedules with 40 different custom instructions — without 40 copies of the agent.

### Top capabilities that define the product

1. **Three-tier agent model** with per-link overrides for skills, prompt, schedule, budget, and concurrency policy.
2. **File-based skill system** — 91 Markdown-defined skills across task management, code, web, integrations, analytics, reporting, and playbook authoring. Skills flow through a three-phase execution pipeline (`processInput → execute → processOutputStep`) with retry via `TripWire`.
3. **Heartbeat + cron scheduling** with minute-level offset staggering, concurrency policies (`skip_if_active`, `coalesce_if_active`, `always_enqueue`), and catch-up policies for missed runs. Built on pg-boss.
4. **Three-layer fail-closed data isolation**: Postgres RLS + service-layer org-scoped DB + retrieval-boundary scope assertions. Every LLM context is provably tenant-scoped.
5. **Middleware pipeline** (`preCall`, `preTool`, `postTool`) wrapping every agent tool call: context pressure monitoring, budget checks, topic filtering, policy authorisation, confidence-escape-to-HITL, tool restrictions, loop detection, reflection-loop enforcement, decision-time guidance injection.
6. **HITL review gates** — agents can propose actions that route to a human review queue before execution, with configurable policy rules (`auto` / `review` / `block`) and full audit records.
7. **Playbooks** — DAG-based multi-step automation with parallel step dispatch, typed step I/O, side-effect classification (`none` / `idempotent` / `reversible` / `irreversible`), editing mid-run with an output-hash firewall, and four execution modes (planned: `auto` / `supervised` / `background` / `bulk`).
8. **IEE (Integrated Execution Environment)** — a separate Docker worker running Playwright for browser tasks and a sandboxed dev environment for shell/git/code. Database-only integration with the main app. Four exit paths only (`done` / `failed` / `step_limit_reached` / `timeout`).
9. **Run continuity** — every run emits a structured handoff JSON (`accomplished`, `blockers`, `nextRecommendedAction`, `openQuestions`, `artefacts`) that seeds the next run of the same agent. Plus a planning prelude that produces a `planJson` rendered as an execution plan pane.
10. **Regression capture** — rejected HITL decisions are automatically captured as replayable regression cases. The platform learns from corrections.
11. **Workspace health audit** — scheduled detectors that flag configuration drift across an org's subaccounts (broken connections, no recent runs, missing schedules, zero-skill agents).
12. **Portfolio-level reporting** — a seeded Reporting Agent with skills like `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `query_subaccount_cohort`, `generate_portfolio_report`, `trigger_account_intervention`.
13. **Cost tracking & budget ceilings** — per-run, per-agent, per-org, with soft reservations and a unified `runCostBreaker` primitive that every external call goes through.
14. **Integration connectors** — per-subaccount OAuth (Gmail, GitHub, HubSpot, Slack, GoHighLevel), API keys (Stripe, Teamwork), and a web-login primitive for scraping paywalled / auth-gated sources.
15. **Extensive static-gates-over-runtime-tests posture** — 33 `verify-*.sh` scripts enforce architectural invariants at CI time. Pure helper convention (`*Pure.ts`) for testable decision logic.

### Current state

- Pre-production. No live users. No live agencies.
- Framing (`docs/spec-context.md`): `stage: rapid_evolution`, `feature_stability: low`, `breaking_changes_expected: yes`, `rollout_model: commit_and_revert`, `staged_rollout: never_for_this_codebase_yet`.
- Built by a small team with AI assistance. ~92 migrations, ~67 route files, ~117 service files, ~97 schema files, ~74 client pages.
- First wedge target: GoHighLevel agencies (documented addressable market of thousands of agencies with 10+ clients each).
- Flagship vertical seeded: the 42macro Reporting Agent — a macroeconomic research reporting workflow that reads paywalled sources, transcribes audio, and writes weekly insight reports.

## 3. The architectural bet we've made

Every product is a bet on a future. Here are the specific, falsifiable bets baked into Automation OS today. They are load-bearing — if any single one is wrong, significant rework follows. The researcher should evaluate each one against current market signals.

### Bet 1 — "Agencies, not end-operators, are the buyers."

We have built a three-tier multi-tenant hierarchy that only makes sense if the customer is an agency managing many clients. A solo operator running one business does not need subaccount permissioning, per-client skill overrides, portfolio health reporting, or the complexity that tier exists to serve.

**If wrong:** the entire three-tier model is dead weight. Solo operators and internal ops teams want a flatter product (one tenant, many workflows), and the agency tier becomes a defensive moat against a market that doesn't exist.

### Bet 2 — "Safe autonomy is the product."

The HITL review queue, policy engine, cost breaker, reflection loop, confidence-escape, middleware pipeline, and review audit records all exist because we believe the market values **governance** as much as capability. Enterprises and agencies will pay for "AI that won't go rogue on a client."

**If wrong:** governance is table stakes that every frontier-model product will ship natively (OpenAI's Assistants, Claude's Agent SDK, Google's Agentspace already have pieces of this). Our investment in governance primitives becomes commoditised overnight.

### Bet 3 — "Structured orchestration beats emergent planning."

Playbooks are a DAG engine with explicit steps, typed I/O, side-effect classification, and approval gates. They exist because we believe complex business workflows need deterministic orchestration — not a big LLM with "figure it out" as the prompt.

**If wrong:** frontier models are becoming good enough at planning and self-correction that explicit DAGs feel like COBOL — a safety blanket for problems the model no longer has. The market moves to "describe the goal, let the model plan," and DAG builders become the Zapier of 2020 rather than the Cursor of 2026.

### Bet 4 — "File-based, curated skills are the right tool abstraction."

Skills are Markdown files with metadata, maintained in-tree, visibility-gated three tiers deep. We curate them. We version them. We add them deliberately. This is a deliberate contrast to tool ecosystems that discover capabilities at runtime via protocol (MCP) or agent-to-agent handshake.

**If wrong:** the market converges on MCP (or a successor) as the universal tool-discovery protocol, and our curated catalogue becomes a walled garden that competitors route around. Every integration we hand-code is an integration someone else ships for free via a community MCP server.

### Bet 5 — "Vertical seeding is how we differentiate."

The 42macro Reporting Agent is a seeded vertical. The GHL Agency Template is planned. System-managed agents hide their master prompts as platform IP. The assumption is that agencies won't build their own agents — they'll adopt ours, customise the `additionalPrompt`, and charge their clients.

**If wrong:** agencies want full authoring control (they're already differentiating on *their* expertise, not ours), or the buyer is actually the end-client not the agency, or the seeded verticals we pick don't match where the revenue is. Vertical templates become unused demo content.

### Bet 6 — "Reactive scheduling (heartbeat + event) is the agent lifecycle."

Agents wake on schedule or on task events. They do not decide when to run themselves. They do not autonomously re-prioritise their own backlog. The orchestrator pattern is explicit (delegate via handoff), not emergent (agents chat and coordinate).

**If wrong:** the frontier is moving to proactive, self-directed agents that evaluate state, pick their own next move, and coordinate peer-to-peer. Our agents feel like scheduled cron jobs next to that, and the "team of AI workers" pitch collapses.

### Bet 7 — "Browser + dev sandbox (IEE) is enough execution environment."

IEE runs Playwright in a Docker worker for browser tasks and a dev container for shell / git / code. Four exit paths, structured observations, database-only integration. We believe this covers ~80% of useful agent work.

**If wrong:** the frontier moves toward unified Computer Use (full desktop control, arbitrary GUI apps, native OS integration), and Playwright-only browser automation feels limiting. Or conversely, the market moves to model-provider-hosted agent runtimes (Operator, Computer Use API) and we're building a commodity layer on top of what they're giving away.

### Bet 8 — "Multi-tenant isolation at the data layer is worth three layers of enforcement."

We have gone deep on RLS — Postgres policies, service-layer org scoping, retrieval boundary assertions. This only pays off if the failure mode we fear (cross-tenant leak) is a real existential risk and the market values its absence.

**If wrong:** the market accepts "soft isolation" like everyone else and we've over-invested in a trust primitive nobody asks for. Or conversely, we're right but nobody cares until they care, and the investment is pre-paid insurance.

### Bet 9 — "Pre-production rapid-iteration posture is the right trade."

We are deliberately shipping without frontend tests, without API contract tests, without staged rollout, without feature flags — on the bet that speed of iteration matters more than safety rails until we have live users. See `docs/spec-context.md` for the explicit framing.

**If wrong:** we accumulate enough unnoticed regressions during rapid iteration that the first onboarding attempt fails, the prospect walks, and we lose the window.

### Summary of the bets

| # | Bet | Load-bearing assumption |
|---|-----|------------------------|
| 1 | Agencies, not operators, are the buyers | Multi-tenant hierarchy is justified |
| 2 | Safe autonomy is the product | Governance is paid-for, not table stakes |
| 3 | Structured orchestration beats emergent planning | DAGs still matter as model capability grows |
| 4 | File-based curated skills are the right tool abstraction | Curation > discovery protocols |
| 5 | Vertical seeding differentiates | Agencies adopt our templates, not build their own |
| 6 | Reactive scheduling is the agent lifecycle | Heartbeat + event covers the workloads |
| 7 | Browser + dev sandbox is enough | Playwright + shell is 80% of value |
| 8 | Three-layer isolation is worth the cost | Cross-tenant trust is a moat |
| 9 | Speed over safety rails pre-launch | Iteration velocity is the scarcer resource |

The researcher's job is to challenge these bets against the actual market. Each section 4 hypothesis and section 5 research area maps back to one or more of these bets.

## 4. The strategic question & testable hypotheses

### The strategic question

> Given the current pace of AI agent innovation — self-running agents, AI coworkers, model-provider agent runtimes, and MCP-style tool ecosystems — **is Automation OS positioned as a durable, defensible, commercially viable platform**, or are we building scaffolding for problems the frontier is about to solve natively?
>
> And if a reorientation is warranted, **what is the most leveraged pivot** — not a rewrite, but a shift in framing and roadmap — that preserves our existing investment while moving us onto stronger ground?

The researcher should treat this as the top-level question. Every finding should feed into a verdict on that question.

### Testable hypotheses

These are the concrete claims the founder wants tested. Each one is stated as an assertion so the researcher has something specific to confirm or falsify. Phrase your verdict as **Confirmed / Partially Confirmed / Falsified / Insufficient Evidence**, with linked sources.

#### H1 — The "safe autonomy" moat is shrinking fast

**Claim:** Model providers (Anthropic, OpenAI, Google) are shipping governance primitives — policy enforcement, approval flows, cost limits, tool allowlists, audit logs — natively inside their own agent runtimes. Within 12 months, what Automation OS differentiates on (middleware pipeline, HITL gates, policy engine) will be commodity capabilities available from one SDK call.

**What would confirm it:** Concrete, shipped features in Claude Agent SDK / OpenAI Assistants / Google Agentspace that replicate our middleware/HITL/policy stack. Roadmap posts or blog announcements from those providers signalling intent.

**What would falsify it:** Evidence that providers are *not* moving into governance, that enterprises explicitly distrust model-provider-owned governance ("marking their own homework"), and that independent governance platforms are raising money or winning enterprise deals.

#### H2 — The agency model has a short window before it gets disintermediated

**Claim:** The current GHL-agency / MSP wedge works today because end-clients can't configure AI agents themselves. Within 2–3 years, frontier models are competent enough, and onboarding flows clean enough, that the end-client buys directly from a vertical SaaS and the agency middleman is squeezed out of the value chain.

**What would confirm it:** End-client adoption data on products like MindPal, Lindy, Copilot for small business, Zapier Central. Pricing compression in agency-facing tooling. Stories of agencies losing clients to direct-to-operator AI products.

**What would falsify it:** Strong revenue growth in agency-tooling products, evidence that "agency as trusted advisor" persists even as AI capability grows, and that vertical AI-native agencies (e.g. AI-powered bookkeepers, AI SEO shops) are expanding not contracting.

#### H3 — File-based curated skills lose to MCP / protocol-based discovery

**Claim:** The market is converging on MCP (Model Context Protocol) or a successor as the universal tool-discovery layer. Products that curate their own tool catalogues become walled gardens; products that speak MCP natively benefit from a growing community ecosystem and lower integration cost.

**What would confirm it:** MCP server count growing exponentially, frontier products (Claude Desktop, Cursor, Zed) defaulting to MCP for tool integration, meaningful enterprise products shipping without hand-curated skill catalogues.

**What would falsify it:** MCP adoption plateauing, quality / safety concerns with community-published MCP servers, enterprise customers explicitly preferring curated catalogues for trust reasons.

#### H4 — Structured DAG orchestration is niche, not the core

**Claim:** Playbooks (DAG-based multi-step automation) are a niche tool for a small set of workflows where determinism matters. The dominant execution pattern in commercially successful AI products is goal-directed autonomous agents, not DAG execution. We have over-invested in the DAG engine relative to the workloads customers actually want to run.

**What would confirm it:** Adoption data on n8n / Zapier / Make AI steps vs. general-purpose agent products. Revenue concentration in "describe a goal, let the agent figure it out" products. Feedback that DAG authoring is too complex for non-technical users.

**What would falsify it:** DAG / workflow products are a growing category (n8n revenue, Zapier AI usage), enterprise customers explicitly want deterministic execution for compliance reasons, and goal-directed agents have not yet proven reliable enough for production workflows.

#### H5 — Proactive autonomy is the next step-function

**Claim:** The next capability jump in AI agents is not raw reasoning — it's **proactive initiative**. Agents that monitor state, pick their own next move, coordinate with peers, and manage their own backlog will feel like a different product category from agents that wake on cron. Our reactive (heartbeat + event) model is about to feel dated.

**What would confirm it:** Frontier products shipping "agents that decide what to do next" — Devin, Polsia, Cognition, peer-coordination patterns, event-driven meshes. Buyer interest framed as "I want an AI employee, not an AI script".

**What would falsify it:** Proactive agents remain a research demo, unreliable in production, too expensive to run at scale. Reactive / scheduled workflows remain the dominant paying pattern.

#### H6 — Vertical depth beats horizontal platform

**Claim:** The commercially successful AI products of 2026–2027 are vertical-depth (AI for real estate, AI for bookkeeping, AI for legal intake) rather than horizontal agent platforms. A general "build any agent" platform is a developer tool with a small TAM; a vertical product with an AI engine under the hood is a business-software category with a large TAM. Automation OS is currently positioned horizontal with vertical templates — the researcher should evaluate whether that compromise works or whether we should commit harder to a single vertical.

**What would confirm it:** Revenue concentration in vertical-first products (Hebbia, Harvey, Supermaven, Replit). Horizontal agent platforms struggling to monetise at scale. Agencies preferring vertical products over "agent builders".

**What would falsify it:** Horizontal platforms (LangChain, CrewAI, Mastra, Cognition, Replit Agent) generating real revenue. Strong developer pull on general-purpose agent infrastructure.

#### H7 — Claude Cowork is a direct threat, not a tangential one

**Claim:** Claude Cowork (and analogous "AI coworker" products) automate discrete employee jobs end-to-end — sales development, customer support, bookkeeping, etc. If the delivery surface is "hire an AI cowork for $X/month that does the whole job" rather than "here's a platform for building AI workflows," the buyer is completely different and Automation OS is competing for a market that's about to shrink.

**What would confirm it:** Claude Cowork rapid adoption, pricing that undercuts agencies, "just works" experience for end-clients. Explicit positioning as "we replace the agency, not the agency's tools."

**What would falsify it:** Cowork is positioned as a consumer / prosumer product with narrow scope. Enterprise and agency buyers still want platform control. Cowork-like products churn heavily because they can't handle multi-client complexity.

### How to handle contradictory evidence

If two hypotheses appear simultaneously confirmed when they shouldn't be (e.g. H3 and H4 both confirmed would mean "MCP wins *and* DAGs are niche"), flag the contradiction explicitly and propose which one is primary. The founder needs to know the researcher's synthesis, not just a bag of findings.

## 5. Research areas (with specific prompts)

Each area below maps to one or more hypotheses. Pick the prompts that most directly move the verdict. The researcher should produce a short synthesis per area (3–6 paragraphs) plus a hypothesis-verdict mapping at the end of the deliverable.

### Area A — Model-provider agent runtimes (H1, H3, H7)

The central question: are Anthropic, OpenAI, Google and Microsoft building what we're building, inside their own model runtimes?

**Prompts:**
- What is the current state of **Claude Agent SDK** (formerly Claude Tools / Claude Agent API)? What governance, orchestration, HITL, memory, and tool-discovery primitives does it ship natively? What does the roadmap suggest?
- What is **Claude Cowork** — the actual product, not the marketing? What jobs does it replace? Pricing? Positioning (end-user vs. operator vs. enterprise)? What is its delivery surface — web app, Slack, API, embedded? What's the competitive implication for platforms built on top of Claude?
- **OpenAI Assistants / Agents API / Operator** — what is the current feature set? Have they shipped multi-tenancy, cost controls, approval flows? What does their agentic execution environment look like compared to our IEE?
- **Google Agentspace / Gemini Agents** — what is the positioning? Is Google going after enterprise agent orchestration directly?
- **Microsoft Copilot Studio / Autogen** — where does Microsoft think agents belong in their stack, and what does that imply for independent platforms?
- For each: identify one or two primitives where the provider is *ahead* of Automation OS, and one or two where an independent platform could still add value.

**Return:** a table of provider × primitive × "are they doing it natively?" × "does this commoditise an Automation OS bet?"

### Area B — The independent agent platform landscape (H4, H6)

The question: who are the actual commercial competitors, what are they winning on, and where is the revenue concentrated?

**Prompts:**
- **CrewAI, LangGraph, Mastra, LlamaIndex Agents, Haystack**: what is each one's commercial model, positioning, and user base? Which are developer frameworks vs. commercial products? Are any of them successfully productising a "governed agent platform"?
- **Lindy, MindPal, Relevance AI, n8n AI, Zapier Central, Bardeen, Make**: which of these are targeting the same agency / operator / SMB market as Automation OS? What are they pricing at? What is their revenue trajectory where public?
- **Vertical-depth competitors**: Harvey (legal), Hebbia (finance), Decagon (support), Sierra (support), Intercom Fin (support), Pylon, Parabola, Decagon, Mendable, Ema. Which verticals have multiple well-funded competitors, which are still open?
- **Agency-to-agency tools**: is there a category of "AI agency enablement" tools that agencies buy to serve their clients? Who sells to GoHighLevel agencies today? What do they charge?
- Is there a commercial success story in the "build any agent" horizontal platform category, or is revenue concentrated in vertical-depth products?

**Return:** a positioning map (2-axis: horizontal-vertical × developer-operator) with revenue/funding annotations where available. Identify the quadrant Automation OS is in and whether that quadrant is winning.

### Area C — The MCP and tool ecosystem question (H3)

The question: is MCP the universal tool protocol, or one protocol among many?

**Prompts:**
- What is the current state of **MCP adoption**? How many servers? What categories are well covered vs. sparse? What is the growth curve?
- Which products default to MCP for tool integration (Claude Desktop, Cursor, Zed, Cline, ...), and which still curate their own tool catalogues?
- Are there credible alternatives to MCP emerging? (OpenAI function calling as a de facto standard? Something Google is pushing?)
- What is the **enterprise trust story** for community-published MCP servers? Are large customers adopting them or refusing them?
- What does the commercial model look like for MCP? Are any vendors building paid MCP servers, or is it all open-source?
- If MCP wins, what does it imply for a platform that already has 91 curated skills? Do those skills become MCP servers? Does the curation layer become obsolete? Does it become a wrapper around MCP discovery?

**Return:** a 2-year forecast on MCP adoption with a specific recommendation for Automation OS — adopt natively, wrap curated skills as MCP servers, remain curated, or hybrid.

### Area D — Proactive and self-running agents (H5)

The question: is proactive initiative a real capability shift, or a research demo?

**Prompts:**
- **Devin / Cognition** — what is the current state of Devin in production? Is it reliable enough to be paid for in meaningful volume? What does "proactive" mean in their execution model?
- **Polsia** — what is the product, who buys it, and how does its execution model differ from Automation OS? (The founder has referenced Ben Cera's Polsia as a benchmark — the researcher should look closely.)
- **Replit Agent / Replit Cloud** — how does Replit's agent take initiative vs. execute instructions?
- **Multi-agent coordination products**: research any products where agents communicate peer-to-peer without a central orchestrator. What's working, what's broken?
- What specific technical changes would Automation OS need to support proactive autonomy — workspace-scoped agent brainstorming? Priority queues? Internal motivators? Event-driven meshes? What does each change cost architecturally?

**Return:** a binary verdict (proactive autonomy is / is not the next step-function) with a justified timeline, and a prioritised list of architectural changes Automation OS would need.

### Area E — Commercial models and pricing (H2, H6)

The question: where is the money actually flowing, and what shape of product captures it?

**Prompts:**
- What are the **pricing patterns** in the AI agent space right now? Per-seat, per-run, per-output, per-outcome, flat subscription? Which models correlate with growth vs. stall?
- What is the **buyer journey** for AI agent products? Who signs the contract — founder, head of ops, RevOps, CIO? Where are the decision points?
- **Case study:** what is the revenue trajectory of a representative horizontal agent platform (e.g. Relevance AI) vs. a vertical-depth product (e.g. Decagon) vs. a model-provider runtime (e.g. Claude Agent SDK offerings)? Which is growing fastest?
- **Agency economics:** what is a typical GoHighLevel agency's revenue per client? Margin? What do they currently pay for AI tooling? What would make them switch?
- What pricing innovations are emerging — outcome-based (pay per qualified lead), shared savings (pay % of cost savings), performance guarantees? Any of these relevant for a platform like Automation OS?

**Return:** a pricing recommendation range with justification, and an identification of the 2–3 highest-leverage buyers for the first 10 paying customers.

### Area F — The agency / MSP market specifically (H2)

The question: is the agency wedge the right first market, or a trap?

**Prompts:**
- What is the **state of GoHighLevel** specifically — user base, agency population, AI feature roadmap? What is GHL building natively that would compete with Automation OS?
- Are there **adjacent agency categories** (SEO agencies, PPC agencies, bookkeeping firms, virtual assistant agencies, property management companies) where AI automation has a clearer buyer and less competition?
- Is there evidence that **agencies are winning or losing** in the AI shift? Are AI-native agencies displacing traditional ones? Are end-clients going direct?
- What do successful **agency-enablement SaaS products** look like (Gorgias Partners, Klaviyo's agency program, Semrush agency tier, HubSpot Solutions Partners)? What lessons transfer?
- If the agency wedge is the wrong first market, what is a better one — specific internal-ops team, specific vertical, specific company size?

**Return:** a confidence level on the agency wedge, with at least one alternative first market proposed if confidence is below 60%.

### Area G — The frontier model capability curve (H1, H4, H5)

The question: what does a realistic 12–24 month capability forecast imply for Automation OS?

**Prompts:**
- What capabilities are frontier models (Claude 4.x / 5, GPT-5, Gemini 3) projected to absorb natively in 12–24 months? Specifically around: multi-step planning, self-correction, tool discovery, peer coordination, long-horizon autonomy?
- Which Automation OS primitives are **scaffolding** that gets absorbed by model improvements (reflection loops, confidence escape, planning prelude, loop detection)? Which are **substrate** that models will still need around them (multi-tenant data isolation, cost accounting, audit logs, integration connectors, scheduling, cron)?
- What is the **"bitter lesson" test** applied to each piece of Automation OS? If we remove this primitive and the model gets smarter, does the primitive become unnecessary, or does it become more valuable?
- Are there historical analogies — e.g. what happened to the tools that scaffolded around GPT-3 when GPT-4 arrived, and what does that imply for tools scaffolding around Claude 4 when Claude 5 arrives?

**Return:** a "scaffolding vs. substrate" inventory of the top 20 Automation OS primitives, with a recommendation for which to double down on and which to deprioritise.

## 6. Companies and products to study (watchlist)

Not exhaustive. Add to this list as you find relevant ones. For each entry, record: positioning, target buyer, pricing if public, and the specific thing Automation OS can learn (or must react to).

### Model-provider agent runtimes

| Product | Why it matters |
|---------|----------------|
| **Claude Agent SDK** (Anthropic) | Directly competes at the SDK layer for developers building agents. Whatever ships natively here commoditises our primitives. |
| **Claude Cowork** (Anthropic) | The specific product the founder flagged. Automates discrete jobs end-to-end. Changes the buyer conversation. |
| **Computer Use API** (Anthropic) | The successor to "agent uses tools" — the agent uses a full desktop. IEE competitor. |
| **OpenAI Assistants API / Agents** | Longest-running agent SDK from a frontier provider. Thread state, tool use, file search, memory. |
| **OpenAI Operator** | The "agent uses a browser like a human" product. Direct Playwright / IEE competitor. |
| **Google Agentspace / Gemini Agents** | Google's enterprise agent orchestration play. Focus on integrating across Workspace and third-party SaaS. |
| **Microsoft Copilot Studio** | Low-code agent builder inside the Microsoft stack. Reaches a different buyer. |
| **Microsoft Autogen** | Multi-agent coordination research framework. Signals where the research frontier is. |

### Horizontal agent platforms (direct category)

| Product | Why it matters |
|---------|----------------|
| **CrewAI** | The most-starred agent framework. Commercial offering (CrewAI Enterprise). Multi-agent by design. |
| **LangGraph / LangChain** | The reference implementation for checkpointed agent state. Their commercial product (LangSmith / LangGraph Cloud) is a peer. |
| **Mastra** | TypeScript-native, same ecosystem as us. Workflow + agent unified. |
| **Relevance AI** | Horizontal agent platform targeting operators. "Workforce Canvas" visual authoring. Well funded. |
| **Vellum** | Prompt orchestration → agent workflows. Enterprise-focused. |
| **Stack AI** | No-code agent builder. Targets non-developers. |
| **Lindy** | No-code AI agent builder with SMB positioning. Direct agency / operator competitor. |
| **MindPal** | Specifically targets agencies managing multiple clients. Closest direct competitor to Automation OS's wedge. |
| **Bardeen** | Browser-based agent automation. Targets individual operators. |

### Workflow / iPaaS players with AI layers

| Product | Why it matters |
|---------|----------------|
| **Zapier + Zapier Central** | Largest iPaaS; their AI layer is now a major feature. Pricing and adoption are market signals. |
| **n8n** | Self-hostable, AI-native, rapidly growing developer mindshare. Direct inspiration for many Playbooks features. |
| **Make** | Visual workflow + AI steps. Strong with agencies. |
| **Activepieces** | Open-source, MIT, TypeScript. Integration strategy inspiration. |
| **Workato** | Enterprise iPaaS moving into agents. Budget ceilings + governance mirror our posture. |
| **Parabola** | Data workflow builder moving toward agents. Operational ops angle. |

### Vertical-depth AI products (to test H6)

| Product | Vertical | Why it matters |
|---------|----------|----------------|
| **Harvey** | Legal | Fastest-growing vertical AI. Contract model, enterprise sales. |
| **Hebbia** | Finance research | Expensive, deep workflows, enterprise. |
| **Decagon / Sierra / Ada / Intercom Fin** | Customer support | Multiple well-funded competitors — a winner-take-some market. |
| **Pylon** | B2B customer success | AI-native CS platform. |
| **Mendable / Ema** | Internal AI assistants | Enterprise knowledge work. |
| **Copilot.live / Copilot for small business** | SMB ops | Generalist AI for SMB — adjacent to our wedge. |
| **Supermaven / Cursor / Replit Agent / Windsurf** | Developer productivity | Shows what "AI coworker" looks like in the vertical where it's working. |

### Self-running / proactive / autonomous agents

| Product | Why it matters |
|---------|----------------|
| **Devin** (Cognition) | The benchmark for autonomous coding agents. Proactive planning, long-horizon execution. |
| **Polsia** (Ben Cera) | Referenced by the founder. Autonomous company operator. Solo-operator market. |
| **Cognosys** | Autonomous research agent. Early/raw. |
| **Replit Agent / Replit Cloud** | "Tell it what you want and it builds it." Integrated execution + hosting. |
| **Open Interpreter** | Local-first agent with code execution. |
| **GPT Researcher / AutoGPT successors** | The research-agent category. Show what's credible now vs. what was a toy. |

### Agency and GoHighLevel ecosystem

| Product | Why it matters |
|---------|----------------|
| **GoHighLevel** | The platform our first wedge is targeting. What are they shipping natively? Threat or partner? |
| **HighLevel marketplace apps for AI** | What already exists in the GHL agency ecosystem? |
| **Vendasta** | Agency white-label platform. Older pattern; lessons in packaging. |
| **SuiteDash / Copilot for agencies** | Adjacent agency tooling. |
| **Gorgias, Klaviyo, HubSpot partner programs** | Non-AI agency enablement patterns for reference. |

### Infra / tool-ecosystem

| Product | Why it matters |
|---------|----------------|
| **MCP (Model Context Protocol)** | The protocol question for H3. Count servers, evaluate adoption curve. |
| **Composio** | Integration-as-a-service for agents. Competitor to building our own connectors. |
| **Anthropic-published MCP servers** | Signals where Anthropic thinks tool discovery goes. |
| **Letta (formerly MemGPT)** | Agent memory primitives. Our `memory_blocks` is a Letta-pattern port. |
| **Humanlayer** | HITL execution interception library. Tactical study already done; strategic positioning of HITL-as-a-primitive still relevant. |
| **Langfuse** | Agent observability. What does "Langfuse for agents" look like as a standalone business? |

### Research / thought-leadership inputs

| Source | Why it matters |
|--------|----------------|
| **Anthropic research & blog** | Signals on Claude Agent SDK, Cowork, Computer Use roadmap. |
| **Latent Space podcast / newsletter** | Rapid read on what's shipping and what matters. |
| **A16Z Infra + AI posts** | Investor view on where money is flowing. |
| **Sequoia "AI 50"** | Revenue-weighted view of winners. |
| **YC W25/S25 agent startups** | Frontier of what new products are trying. |
| **Reddit r/LocalLLaMA, r/singularity** | Builder-side signal on what's sticky. |
| **Benchmarks: GAIA, SWE-Bench, WebArena** | Capability curve signals. |

### How to prioritise the watchlist

Start with **Claude Cowork, Claude Agent SDK, MCP, Devin, MindPal, Lindy, Harvey, and Relevance AI**. Those eight cover the highest-information diagonal of the grid: the frontier-provider question (H1, H7), the tool-protocol question (H3), the proactive-autonomy question (H5), the direct-competitor question (H2, H6), and the vertical-depth question (H6). If time is constrained, these eight are non-negotiable. Everything else is depth you can add to sharpen the verdict.

## 7. Deliverable format & what would change our minds

### Return this structure, in this order

The researcher's output should be a single markdown document with the following top-level sections. No narrative preamble, no "interesting findings" dumps — commit to the structure.

#### 1. TL;DR verdict (half a page, max)

Start with the founder's answer: **Keep, Pivot, or Rebuild?** One sentence. Then three bullet points: the single strongest reason for that verdict, the single strongest reason it could be wrong, and the one thing the founder should do first if they accept the verdict.

#### 2. Hypothesis verdicts (H1–H7)

For each hypothesis in section 4 of this brief, return:

- **Verdict:** Confirmed / Partially Confirmed / Falsified / Insufficient Evidence
- **Confidence:** Low / Medium / High
- **Evidence:** 3–5 bullet points with linked sources. No source = no claim.
- **Implication for Automation OS:** one paragraph connecting the verdict back to the product decision it informs.

#### 3. Scaffolding vs. substrate inventory

A single table with the top 20 Automation OS primitives (from section 2 of this brief) labelled as **scaffolding** (absorbed by model improvements in 12–24 months) or **substrate** (still needed as models improve). Include a "confidence" and "trigger event" column — e.g. "Scaffolding, high confidence, trigger: Claude 5 native planning prelude". This single table is the most valuable output of the whole exercise.

#### 4. Architectural bets — re-verdict

For each of the nine bets in section 3 of this brief, return a one-line verdict: **Hold, Weaken, or Abandon**. If Weaken or Abandon, one sentence on what replaces it.

#### 5. Competitive positioning map

A 2x2 (or 3x3) positioning map placing Automation OS and its 8–12 closest competitors. Axes of the researcher's choosing — explain why you picked them. Annotate each competitor with: positioning, target buyer, pricing range, funding / revenue where public, and one-line "what they're winning on".

#### 6. The pivot menu

Three concrete directional options for Automation OS. Each option should be a one-page mini-pitch with:

- **Name + one-sentence framing** (the elevator pitch for that direction)
- **Who it's for** (the ICP, specific enough to name the job title)
- **What to keep** from the existing Automation OS codebase
- **What to deprioritise or cut** from the existing roadmap
- **What to add** that doesn't exist yet
- **Why it works when frontier models commoditise X** (explicit answer to "why doesn't this get eaten by Claude 5?")
- **Risk / kill condition** — what evidence would make us abandon this direction

The three options should be **meaningfully different** — not three shades of the same product. If all three converge on the same answer, you're not exploring the space.

#### 7. The one thing

Close with a single recommended action the founder should take **this week** if they accept the overall direction. Not the roadmap, not the quarter — the next concrete move. Could be "run three customer conversations with these specific profiles", "kill this feature branch", "publish the thing we've been holding back", etc.

### What would change our minds

We acknowledge up front that reasonable people could look at the same evidence and reach different conclusions. Here is what we'd need to see to update on specific points:

- **We'd abandon the agency wedge (Bet 1)** if: GoHighLevel ships native AI agent governance that matches our middleware stack, OR if direct-to-operator products (Lindy, MindPal) show rapid revenue growth while agency-tooling products stall.
- **We'd cut the Playbook DAG investment (Bet 3)** if: evidence shows goal-directed agents are reliable enough for production workflows and DAG products are losing users to them, OR if our own customer conversations reveal DAG authoring is too complex for the buyer.
- **We'd migrate skills to MCP-first (Bet 4)** if: MCP adoption crosses a credibility threshold (e.g. major enterprise products defaulting to it), OR if Anthropic ships a Claude-native MCP router that makes curated catalogues redundant.
- **We'd invest in proactive autonomy (Bet 6)** if: at least two commercially successful products ship autonomous self-directed agents at scale, AND our own buyer conversations reveal "I want an AI employee" framing.
- **We'd cut the IEE investment (Bet 7)** if: Anthropic's Computer Use API reaches feature parity with our Playwright worker AND the cost / reliability is comparable.
- **We'd abandon the whole project (no bet survives)** if: all of the above update against us AND the frontier producing an end-to-end "configure your AI team for $X" product that a mid-market operator can adopt without an agency.

### How the founder will use the deliverable

The founder will read the TL;DR and the Pivot Menu first. If either of those raises a question, they will dive into the relevant hypothesis verdict. The other sections are reference material that backs up the decision. **Write the TL;DR and Pivot Menu like they're the only thing that will be read** — because for most of the readership, they will be.

---

## Appendix — Background reading

The researcher does **not** need to read these before starting, but should skim them if a finding touches the relevant area:

- `CLAUDE.md` — project playbook and working conventions
- `architecture.md` — deep architecture reference (~1300 lines; skim the table of contents first)
- `docs/spec-context.md` — current framing statements (pre-production, rapid evolution posture)
- `docs/improvements-roadmap.md` — the current phased improvement plan (Phase 0 through Phase 4)
- `docs/external-improvements.md` — competitive intelligence backlog from a prior 27-platform review
- `docs/ai-agent-repo-research-report.md` — prior tactical research on open-source repos to adopt
- `tasks/strategic-recommendations.md` — an older strategic doc (March 2026) with the plain-English product vision

These documents were the ground from which the brief above was derived. If you find yourself re-deriving something they already say, stop and read them instead.

