# Research Brief — Distribution Strategies on Automation OS

**Date:** 2026-04-20
**Branch:** `claude/mcp-sales-agent-research-AERv0`
**Source stimulus:** Greg Isenberg, *"7 distribution strategies for vibe-coded products"* (YouTube — `YeoGehNsrLc`)
**Purpose:** A briefing pack to hand to Claude (or any researcher) so they can generate product/business ideas that turn Isenberg's seven distribution plays into concrete bets on top of Automation OS. This brief captures (a) what Automation OS actually has today, (b) direct answers to the user's five questions, (c) cross-cutting synthesis, and (d) a structured set of research prompts.

## 1. Framing & Automation OS capability snapshot

### The frame the video misses

Isenberg's seven plays (MCP-as-sales-team, programmatic SEO, free tools, AEO, shareable artifacts, newsletter acquisition, AI repurposing) assume an audience of **individual vibe-coders building one consumer SaaS**. Automation OS is a different animal: it's the **operations system agencies use to run their business on top of LLM providers**, with three-tier isolation (System → Org → Subaccount), 100+ skills, 42+ human-in-the-loop review gates, a client portal, and agency economics baked in.

Two distribution questions therefore branch from each of Isenberg's plays:

- **Inbound for Synthetos itself** — how do we acquire agency operators as customers?
- **A new productised bet agencies run on Automation OS for their clients** — can the play itself become a skill / playbook / surface we sell?

The most interesting answers are almost always the second branch. Agencies already pay us to run their business; if we ship the distribution primitive, they ship it across every one of their clients. Leverage compounds.

### What we already have (verified in code — `docs/capabilities.md`, `server/mcp/*`, `server/skills/*`, `server/routes/pageProjects.ts`)

| Capability | State | Relevance to Isenberg's plays |
|---|---|---|
| **MCP server at `/mcp`** (`server/mcp/mcpServer.ts`, `server/routes/mcp.ts`) exposes every action-registry entry + every system skill as an MCP tool, with tool catalogue resource, per-request tenant binding, Bearer auth, and per-agent tool allowlists | Shipped, authenticated-only | Plumbing for "MCP as sales agent" is literally already live — the missing piece is a **public-facing** mode and a reason for external AI clients to call it |
| **MCP client** (`server/services/mcpClientManager.ts`, `server/config/mcpPresets.ts`) with 30+ curated presets across Comms / CRM / Dev / Data / Finance / Productivity / Google Workspace / Files | Shipped | Agencies can pull external tool surfaces into agent runs today |
| **GEO skill cluster** — `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare` (six-dimension composite score, per-platform readiness for Google AIO / ChatGPT / Perplexity / Gemini / Bing Copilot) | Shipped (Phase 1, `docs/geo-seo-dev-brief.md`) | Directly answers Q4 — we are arguably further along on AEO than the video assumes |
| **Pages & Content Builder** — `create_page`, `update_page`, `publish_page` skills with draft→publish HITL, meta tags, form handling, analytics, subdomain hosting | Shipped | Foundation for programmatic SEO (Q2) and free-tool landing pages (Q3), but **scale-out to thousands of pages is not a first-class pattern yet** |
| **Content drafting cluster** — `draft_content` (blog / landing / case study / whitepaper / newsletter), `draft_post` (per-platform social variants), `draft_ad_copy`, `create_lead_magnet`, `draft_sequence`, `transcribe_audio` | Shipped | Foundation for the Isenberg "1 pillar → N channels" repurposing engine (bonus Q / strategy 7 of the video) |
| **Client Portal + Playbook brief cards** | Shipped | Surface for shareable outputs — today it's client-scoped, not public-web-shareable |
| **Three-tier hierarchy** (System → Org → Subaccount) with RLS, principal context, agency economics, and 42+ review-gated actions | Shipped | Every distribution bet must be expressible at the subaccount level so one agency's bet runs across all of its clients |
| **Scraping engine** — HTTP → stealth Playwright → Scrapling tier escalation; `scrape_url`, `scrape_structured`, `monitor_webpage`, `fetch_paywalled_content` | Shipped | Foundation for programmatic SEO data sourcing and competitor intelligence |
| **CRM & email** — GHL OAuth, HubSpot OAuth, Gmail OAuth, `send_email` (HITL), GHL webhook ingestion (10 event types), canonical data layer | Shipped | Foundation for newsletter acquisition (video strategy 6) and free-tool lead-capture |

### What we don't have (the gaps each play implies)

1. **Public-facing MCP server per agency / per client** — the `/mcp` route is Bearer-authenticated and tenant-scoped; there is no read-only, API-key-gated, rate-limited public surface that external AI clients (Claude, ChatGPT, Perplexity, Cursor) can discover and call without a Synthetos seat.
2. **MCP registry publishing workflow** — no automation for Smithery / MCPT / Open Tools submission, no discovery-metadata schema, no citation / install analytics.
3. **Programmatic SEO scale-out** — `create_page` works one page at a time with HITL on publish. There is no bulk page generator, template system for "best X for Y in Z", dataset-driven fan-out, or indexation-monitoring loop.
4. **Public free-tool surface** — Pages can host forms, but there is no pattern for interactive embeddable widgets (grader, calculator, analyzer) with lead capture → agent run → upsell.
5. **Shareable viral artifacts** — Portal playbook briefs are isolated per client. There is no "shareable card" concept with branded preview images, share-button prefills, public-by-design URLs, or embed-on-Twitter meta tags.
6. **Repurposing pipeline as a first-class playbook** — the primitives (transcribe, draft_post, draft_content) exist but aren't wired into a single "pillar-in, seven-channels-out" playbook with per-channel approval gates.
7. **Newsletter-acquisition workflow** — no tooling for due-diligence-to-migration of an acquired newsletter into a subaccount with audience import, re-permissioning, and branded takeover sequence.

**North-star reading of the gaps:** every one of them is a **new product surface** Synthetos can ship as agency-economics-aware infrastructure. LLM providers cannot ship these — their buyer is an individual, not an agency serving many isolated clients.

---

## 2. Q1 — MCP server as your sales agent

### Simple translation of the video claim

An MCP server is a thin, standards-compliant adapter that exposes your data or actions as "tools" an AI assistant (Claude, ChatGPT, Cursor, Perplexity) can call on a user's behalf. When a user asks their AI *"find me the best CRM for dentists in Miami"*, if your MCP server is installed (or discoverable via an MCP registry), the AI calls *your* tool, gets structured data back, and surfaces your product inside the answer. The AI does the selling. CAC approaches zero. Isenberg's claim is that in 2026, MCP is what app-store publishing was in 2010 — a new distribution rail.

**What makes it "a sales team":** your MCP server is the thing AI assistants reach for when a user is in buying mode. You don't run ads. You don't rank on Google. You ship a tool the AI picks up on its own.

### How this relates to Automation OS (what's already true)

We have already shipped the server side of this. `server/mcp/mcpServer.ts` builds a fresh `McpServer` per request, exposes every action-registry entry and every system skill as a typed MCP tool with annotations, and streams responses over HTTP transport at `/mcp`. The tool catalogue is introspectable. Per-agent allowlists already restrict which tools are visible. The architecture decision log confirms this was intentional: *"exposes the action registry AND system skills as MCP tools"*.

What's **missing** is the go-to-market shape:

1. **Auth model** — today `/mcp` requires a Bearer token bound to a Synthetos user. To be a "sales agent", it has to be callable by an external AI that doesn't have a Synthetos seat.
2. **Public-read skill subset** — we need a deliberately-curated set of read-only tools (search CRM, query pipeline, surface recommendations, return a lead-capture form URL) that is safe to expose without a logged-in user.
3. **Per-agency branded MCP servers** — an agency running Synthetos should be able to publish an MCP server scoped to *their* clients' data (e.g. a real-estate agency publishes an MCP that answers "what's available in Fitzroy under $900k?" and hands the inbound lead back to the agency's CRM).
4. **Discovery + attribution** — registry submission, install analytics, citation tracking, per-install lead attribution back to an org / subaccount.

### Product bets this unlocks

- **Agency-branded MCP as a Synthetos feature.** Every agency on Synthetos gets a publishable MCP endpoint per subaccount (or one org-level MCP spanning all subaccounts). The agency picks which skills are public, what read scopes the tools have, and what upsell action the AI should surface (e.g. "book a 15-min consult" returns a calendar URL). The artifact is an installable MCP URL plus a Smithery / MCPT / Open Tools listing. **Structural moat:** LLM providers and single-tenant agent platforms can ship their *own* MCP servers, but not a multi-tenant MCP-publishing product with approval gates, per-client isolation, and lead attribution.
- **Vertical MCP servers as a wedge business.** Build the directory-MCP for a vertical (dentists + CRM, roofers + insurance, boutique law + case management), run it on Automation OS, and bundle it into the free tier as the top-of-funnel for Synthetos itself. Each vertical MCP doubles as a distribution surface *and* a paid product for agencies in that vertical.
- **Lead-capture-as-a-tool.** The simplest MCP tool — *"request a quote from `<agency>`"* — becomes a direct inbound channel. The AI collects structured details; Synthetos routes them into the right subaccount's CRM via the existing canonical data layer and the HITL review queue. Agencies get AI-originated leads attributed cleanly.

### Feasibility snapshot

- **Core transport + server**: shipped.
- **Public / unauthenticated mode**: ~2–4 week build (new auth mode, per-tool scope filter, rate limits, abuse controls).
- **Registry publishing flow**: ~1 week per registry (Smithery / MCPT / Open Tools manifests).
- **Per-agency MCP branding + custom domain**: ~3–4 weeks (domain binding, per-server limits, OAuth dance for installs).
- **Install / citation analytics**: ~2 weeks (we already track MCP *outbound* call observability; mirror the ledger for inbound).

**Blocker to think about upfront:** exposing skill outputs to a third-party AI means those outputs are citation-public. We need an editorial layer (skills flagged "safe for external MCP" at the action-registry level) to prevent leakage of internal reasoning or client-specific data. This dovetails with our existing sensitive-path gating pattern.

---

## 3. Q2 — Programmatic SEO: 10k pages in a weekend

### Is it feasible?

**Technically yes; strategically worth it only as an agency-side product, not as Synthetos's own top-of-funnel.** The math Isenberg quotes (10k pages × 30 visits/mo × 2% conversion) is directionally right but ages badly: Google's 2024 Helpful Content updates have been hostile to unreviewed AI-generated page farms, and AI search is eating the long tail from the other side. Raw template-swap pSEO is a closing arbitrage. What still works is pSEO **with a real dataset** (Nomad List's city data, G2's review corpus, Crunchbase's company data) — something competitors can't replicate page-by-page.

For Automation OS, the honest read is: **agencies should do this for their clients at scale; Synthetos itself should do it sparingly and only where we have proprietary data** (e.g. a "GEO score for `<domain>`" page per domain we audit — see Q4).

### What we already have

- `create_page`, `update_page`, `publish_page` skills + page projects (subdomain hosting, meta tags, forms, analytics).
- `draft_content` with full SEO-optimised long-form output.
- `audit_seo` + `audit_geo` to QA the resulting pages before publish.
- Scraping engine (`scrape_url`, `scrape_structured`, `monitor_webpage`) for dataset harvesting.
- Canonical data layer + context data sources — datasets can be loaded from R2 / S3 / HTTP / Google Docs.
- Review-gated publishing (publishing is HITL by design — which is the friction for 10k-scale publishing and must be addressed deliberately).

### What's missing to make pSEO a first-class surface

1. **Bulk page generator** — a playbook that takes a template + dataset row → N page drafts, with cost simulation before fan-out and parallel execution already supported by the playbook engine.
2. **Template system for pSEO patterns** — keyword pattern DSL ("best {service} in {city}", "{product} alternatives for {persona}") with slot binding to a dataset.
3. **Scalable approval workflow** — bulk-approve in Pulse already exists; extend it to "batch-approve page group" so the HITL gate doesn't collapse under the weight of 10k items.
4. **Indexation monitoring loop** — a recurring job that watches Google Search Console (or equivalent) and retires underperforming pages; ties into the existing workspace-health detector pattern.
5. **Quality floor** — we should not ship bulk page generation without an automatic `audit_seo` + `audit_geo` pass and a human-written seed example per template. Without this we become part of the slop that Google is actively demoting.

### Product bets this unlocks

- **"Publish-at-scale" as an agency skill bundle.** One playbook: `pseo_fanout` — takes a dataset, a template, and a brand voice; produces N drafted pages, QA'd with `audit_seo` + `audit_geo`, bulk-reviewed, then published. Sold to agencies that produce programmatic content for directory, real-estate, travel, and local-services clients.
- **Directory-as-a-service vertical.** Pair `scrape_structured` + canonical data + bulk page gen to productise vertical directories (like Nomad List for *X*). Agency packages each directory as a subaccount; the directory itself becomes the lead-gen surface for the underlying service (insurance broker, tax advisor, etc.). **This is the pSEO-plus-MCP combo play** — the directory ranks in Google; the MCP version of the same directory gets discovered by ChatGPT and Perplexity.
- **pSEO for Synthetos's own top of funnel, narrowly.** One page per audited domain: `synthetos.com/geo/<domain>` showing the six-dimension GEO score, trend, and top three fixes. We already *generate* this data via `audit_geo`. The slice-N-publish is cheap. It lets us run a "check your AI visibility" free tool (see Q3) and get indexed on the long tail of branded SEO / GEO queries.

### Feasibility snapshot

- Bulk page generator playbook: ~3–5 weeks (new `pseo_fanout` playbook + template DSL + bulk-approve extension).
- Indexation monitoring loop: ~2 weeks (GSC integration + detector).
- Quality floor (mandatory `audit_seo` + `audit_geo` on every generated page): ~1 week.
- GEO-score-per-domain public page surface: ~2 weeks (leverages `audit_geo`, `create_page`, `publish_page`).

**Blocker to think about upfront:** unreviewed 10k-page drops damage domain authority. Every bet here should assume a cost-bounded human QA sampling layer (statistical review gate: approve all in a batch if a random sample of N passes an automated + human QA bar) — a new pattern we don't have today but which maps cleanly onto our existing HITL review queue.

---

## 4. Q3 — Free tool as top of funnel (top 5 ideas)

### The shape of this play

A free tool does three things at once: (1) delivers instant, legible value to a cold visitor; (2) captures a lead (email / domain / social handle); (3) creates a shareable artifact that produces a viral loop back into discovery. The video's examples — Ahrefs backlink checker, site grader, age calculator — are specific applications of the same pattern.

The pattern fits Automation OS precisely. Every LLM-backed skill is, definitionally, a free tool wrapped in an agent run. The missing piece is the **public-facing surface**: today, skills run inside the agency's workspace; the free-tool play requires an unauthenticated, lead-gated, embed-friendly surface that fires a constrained agent run and returns a branded artifact.

### Criteria for picking the top 5

- Runs on **skills we already have** — no new skill development.
- Produces an artifact that **naturally leads back to the paid product** (either Synthetos-the-platform or an agency-client engagement).
- **Shareable** by default (connects directly to Q5).
- Low-cost to run per invocation (no runaway LLM spend from a viral loop).

### Top 5 free tools, ranked

#### 1. "Is your site AI-search-visible?" — GEO scorer

- **Skills used:** `audit_geo` (composite) + `geo_citability` + `geo_crawlers` + `geo_schema` + `geo_brand_authority` + `geo_llmstxt`.
- **User flow:** paste a URL → show the composite 0–100 GEO score + six-dimension radar + top three actionable fixes + downloadable `llms.txt`.
- **Lead hook:** "Get the full 30-day improvement roadmap emailed to you" → email capture → upsell into "have your agency run this recurring" (Synthetos sells to the agency; agency sells to its client).
- **Shareable:** "MyDomain scored 47/100 on AI visibility — here's why" + branded card image.
- **Why it's the #1 pick:** we already built the skill cluster. Shipping is primarily a public-surface + render problem, not a modelling problem. Also — and critically — running this tool on thousands of domains creates the dataset that powers the pSEO play in Q2 (one indexed page per domain with its GEO score).
- **Competitive angle:** first mover in agency-grade AEO — no competing agency automation platform ships this today.

#### 2. "Grade my agency's ops" — agency health scorecard

- **Skills used:** new `audit_agency_ops` (thin wrapper — composes existing `compute_health_score`, workspace-health detectors, `audit_seo`, `audit_geo`) + a 10-question self-report form.
- **User flow:** agency operator answers 10 questions (how many clients, how they report, how they handle approvals, what tools, how they track margin) → gets a 0–100 ops score + a ranked list of what's killing their margin + a downloadable PDF.
- **Lead hook:** *"Your approval workflow is costing you ~11 hours/week. See how Synthetos handles it."* Direct product demo link with prefilled ICP fields.
- **Shareable:** perfect for LinkedIn — agency owners love sharing "I scored 72/100, here's what we learned". Exact target audience.
- **Why:** **this is Synthetos's own highest-leverage top-of-funnel.** It's a qualification tool disguised as a free assessment. Everyone who fills it out is a pre-qualified ICP. The "replaces / consolidates" table in `docs/capabilities.md` is the scoring rubric, inverted.

#### 3. "Client churn risk x-ray" — single-contact churn scorer

- **Skills used:** `compute_health_score`, `detect_churn_risk`, `detect_anomaly`, `scan_integration_fingerprints`.
- **User flow:** paste a CSV of client logins-per-week + last-invoice-date (or connect GHL / HubSpot with read-only OAuth) → returns per-client churn band (red / amber / green) + top three recommended interventions per red-band client.
- **Lead hook:** "Run this on your full book every hour with automatic operator alerts" → upsell into ClientPulse.
- **Shareable:** private by default (it's client data), but the aggregate report — *"23% of my book is at churn risk — here's how I triage"* — is shareable without client identities. Could be branded "ClientPulse Snapshot".
- **Why:** ClientPulse is our strongest existing vertical product. This tool is the unfair marketing top of funnel for it, aimed squarely at agency owners who already suspect they have a retention problem.

#### 4. "Your playbook in 60 seconds" — no-code workflow migrator

- **Skills used:** existing no-code workflow JSON import (supervised-migration wedge in `docs/capabilities.md`) + `playbook_estimate_cost` + `playbook_simulate` + `playbook_validate`.
- **User flow:** paste an n8n / Make / Zapier export → get a one-page visual of what it does, a cost estimate if run 1,000 times, approval gates it *should* have had, and a "convert to supervised playbook" CTA.
- **Lead hook:** the converted playbook is a paid Synthetos artifact. The free version shows the plan and the risk assessment only.
- **Shareable:** "my Make workflow runs $47/month cheaper and has 3 human-approval steps now" — exact hook for no-code Twitter.
- **Why:** our positioning doc explicitly calls this out as a migration wedge against commodity workflow automation. We've already documented the capability; this tool makes it a *self-serve* wedge.

#### 5. "MCP-ify my API" — MCP server preview tool

- **Skills used:** new thin skill `preview_mcp_server` (takes an OpenAPI spec URL → produces a preview MCP server definition with tool catalogue + installation instructions, runs it in a sandboxed ephemeral container).
- **User flow:** paste an OpenAPI URL → get a preview Claude Desktop / ChatGPT installation command + sample tool invocations + "how would an AI actually call this?" transcript.
- **Lead hook:** "Host this permanently with approval gates, per-tenant isolation, and call observability" → direct upsell into per-agency branded MCP (Q1 bet).
- **Shareable:** extremely — every developer in our target dev-savvy-agency segment wants to install something they can show off on Twitter.
- **Why:** direct funnel into the Q1 bet. Feels like a genuinely useful dev tool; the upsell is natural.

### Product shape required across all five

None of these work without a **new public-facing skill-execution surface**: an embeddable, rate-limited, lead-gated page that runs a single constrained agent run, renders a branded artifact, and captures the lead back into a subaccount (for agency-run tools) or a Synthetos lead table (for our own tools). Build the surface *once*, ship 5+ tools on top. That's the actual investment — each individual tool is then a 1–3 day skill-composition job.

### Feasibility snapshot

- Public-facing free-tool surface: ~4–6 weeks (new auth mode, cost cap per invocation, lead-capture, rate limits, branded templating, share-card generator — see Q5).
- Individual tools 1–5 on top of the surface: 1–3 days each once the surface exists.

---

## 5. Q4 — Answer engine optimisation vs. our existing GEO skills

### The short answer

Isenberg's "AEO" is the same category as our "GEO" — **we're already there, and arguably further along than any competing agency automation platform**. The vocabulary varies (AEO, GEO, AIO, SGE-readiness, LLM-readiness) and will converge on "GEO" because that's what the academic literature (see `geo-seo-dev-brief.md` provenance trail) uses. We should treat the video's AEO advice as a validation of the roadmap we shipped in Phase 1.

### What we already ship vs. what Isenberg suggests

| Isenberg's AEO recommendation | Our existing coverage | Gap |
|---|---|---|
| "Google the top 20 questions your customer asks" | Not a skill — but trivial via `web_search` + a new wrapper skill | Thin: 1–2 days |
| "Write structured, citation-worthy direct answers" | `draft_content` already does this; `geo_citability` scores whether the content is extractable (134–167 word passages, claim density) | Covered |
| "Add schema markup and FAQ blocks" | `geo_schema` evaluates JSON-LD coverage (Organisation, Article, FAQ, HowTo, Product); pairs with `create_page` / `update_page` which accept meta + structured data | Covered |
| "Publish on a domain with authority or build authority" | `geo_brand_authority` scores brand entity recognition, Wikipedia / Wikidata / Knowledge-Panel presence, citation density vs. backlinks | Covered for diagnosis; building authority remains an ongoing service |
| "Monitor your Perplexity and ChatGPT citations" | `geo_platform_optimizer` scores per-platform readiness (Google AIO, ChatGPT, Perplexity, Gemini, Bing Copilot). **Longitudinal citation tracking over time is not yet shipped** — we audit visibility at a moment, not track citations over time | **Gap:** active citation monitoring |
| "Generate `llms.txt`" | `geo_llmstxt` analyses or generates llms.txt | Covered |
| "Competitive benchmarking" | `geo_compare` benchmarks vs. 2–3 competitors across GEO dimensions | Covered |

### The actual gap the video exposes

The video's line that matters is: *"Peter Lovell's AI referrals jumped from 4% to 20% in one month."* The implication is that the key metric is not the audit score — it's **AI-referral traffic share over time**. Our current GEO suite is an **audit product**. The next layer is a **tracking product**: a recurring agent that (a) audits on cadence, (b) probes ChatGPT / Perplexity / Gemini with a canonical question set per client, (c) tracks citation / mention rate over time, (d) alerts when traffic share drops.

This is the AEO equivalent of Ahrefs' rank-tracking — an ongoing monitoring product on top of the one-shot audit product.

### Product bets this unlocks

- **GEO Tracker as ClientPulse's sibling product.** Recurring audits already exist. Add a **citation probe loop**: the system fires canonical prompts at major AI answer engines via MCP / API, records whether the client's domain is cited, and stores the score over time. Becomes a dashboard: *"Your AI visibility dropped 12 points this week — the change: Perplexity stopped citing your pricing page after their crawler ran last Thursday."*
- **GEO free-tool top-of-funnel** (see Q3 #1) — one-shot audit; upsells to recurring tracker.
- **Citation arbitrage data.** The GEO Tracker gives us longitudinal data on *which content formats get cited most often by which AI engines* per vertical. That's a proprietary dataset that powers (a) our own thought leadership, (b) a premium agency-intelligence product, and (c) content-generation heuristics fed back into `draft_content`.
- **"AI Search Audit" as a productised service** packaged for agencies — standard deliverable + branded PDF + client portal card.

### Feasibility snapshot

- Citation probe loop: ~3 weeks (new recurring job + prompt-set templating + engine adapters for ChatGPT / Perplexity / Gemini / Google AIO).
- Historical GEO score trendline (per-subaccount, per-dimension, per-engine): already supported by the existing historical-tracking mention in `geo-seo-dev-brief.md` §4.4; the UI surface is the gap (~2 weeks).
- Alert on citation drop: ~1 week (ride on existing workspace-health detector pattern).

**Non-goal to resist:** don't try to beat dedicated SEO platforms (Ahrefs, Semrush) at traditional SEO. We have `audit_seo` for completeness, but our structural moat is GEO × agency multi-tenancy — that's the lane.

---

## 6. Q5 — Shareable artifacts and outputs

### What makes an output shareable

Isenberg's test: *"what does my user want to brag about?"* The archetypes — Spotify Wrapped, GitHub contribution graph, Stripe Atlas incorporation certificate, Duolingo streak — share four traits:

1. **Identity-signalling** — the artifact says something about the sharer (productivity, success, discipline, taste).
2. **Legible at a glance** — one image, one number, one silhouette. No scrolling.
3. **Branded subtly, present clearly** — the logo is there, but the hero is the user's achievement.
4. **Prefilled share action** — one tap → prefilled tweet / LinkedIn post / story with the image already embedded.

Our current outputs fail on trait 3 and 4. Playbook briefs are portal-scoped and client-private. Pages are public but not shaped as identity artifacts. Reports are downloadable but not shaped for social.

### What we have today

- Client portal playbook brief cards (internal only).
- Public pages via `publish_page` (static content, not dynamic artifact).
- Reports delivered via `deliver_report`.
- Memory + belief system that captures *what happened* in a run — the raw material for an artifact.

### The gap: a first-class "Artifact" primitive

A new primitive — `Artifact` — with:

- A versioned, public-by-default (or public-with-token) URL (`synth.to/<slug>` or agency custom domain).
- A server-rendered Open Graph image (the "card" that shows in every Twitter / LinkedIn / Slack preview).
- Prefilled share intents per platform.
- Click / impression / share attribution back to the subaccount that produced it.
- A declarative schema: `{ artifactType, brandOverride, data, layoutKey }` so any skill can emit one without building a new UI per skill.

Every skill that currently produces a meaningful output (`audit_geo`, `compute_health_score`, `detect_churn_risk`, `generate_portfolio_report`, `draft_content`, `playbook_simulate`) should be able to optionally emit an Artifact. Composition becomes trivial.

### Product bets this unlocks

- **"GEO Scorecard" artifact** (ties into Q3 #1 and Q4). One card per domain: six-dimension radar, 0–100 score, three action items, "How does yours compare? Check for free at `synthetos.com/geo`". Every share is a pre-qualified visit to a top-of-funnel tool.
- **"ClientPulse Portfolio Weekly" artifact for agency owners.** Aggregated, anonymised: *"This week Acme Agency retained 94% of their book, moved 3 clients from amber to green."* The agency owner is the sharer; the target audience is other agency owners (ideal ICP). Opt-in per agency.
- **"Agency Ops Score" artifact** (ties into Q3 #2) — the self-report assessment emits a shareable score card. LinkedIn gold.
- **Portal-card upgrade: "Share with stakeholder" button** — an existing portal brief can be promoted to a public Artifact with one click (HITL-gated). Becomes the unlock mechanism for agencies to market themselves using their actual client work (with client approval).
- **"Built with Synthetos" badge on every public Artifact** — low-key brand distribution on every share. Spotify Wrapped pattern.

### Shape of the actual build

One new `artifacts` table (id, slug, subaccount_id, artifact_type, data_json, brand_override, visibility, expires_at, view_count, share_count). One new OG-image renderer (headless browser + branded template per artifact_type). One skill family (`publish_artifact`, `revoke_artifact`) to give agents the ability to promote run outputs to Artifacts, HITL-gated like every other public-surface action. One share-intent helper.

### Feasibility snapshot

- Artifact primitive + schema + rendering + OG images: ~4–6 weeks.
- Skill hooks to promote run outputs: ~1 week.
- Per-agency branded templates: ~2 weeks (ties into existing brand colour + white-label work).
- Share-intent + analytics: ~1 week.

**Blocker to think about upfront:** Artifacts sit on top of client data. Public visibility by default would violate our three-tier isolation model — so the contract is *private by default, public only via explicit HITL approval*, mirrored from `publish_page`. The value is not in *default* public output; it's in making the *promote-to-public* action cheap and safe.

---

## 7. Cross-cutting synthesis — product bets that compound

Reading all five answers together, four infrastructure investments make every individual play cheaper and compounding:

### A. "Public skill-execution surface" — the missing primitive

Q1, Q3, and Q5 all depend on the same thing: a way to run a constrained agent skill execution for a user who does not have a Synthetos seat, with rate limits, cost caps, abuse controls, lead capture, and branded rendering. Build this once and:

- Free tools (Q3) ship as 1–3 day skill compositions.
- MCP public mode (Q1) is the same surface with a different transport (MCP over HTTP instead of browser).
- Artifacts (Q5) are the persisted output of those runs.

**This is the highest-leverage single investment on the list.** It unlocks three distribution plays with one build.

### B. "Artifact primitive" — the shareability layer

Q3 and Q5 both need branded, shareable output. Q2 (public GEO-per-domain pages) and Q4 (GEO tracker dashboards) are strengthened by it. Build it as a standalone primitive, hook every meaningful skill into it.

### C. "Public-MCP mode + registry publishing" — the MCP rail

Direct execution of Q1. Small standalone investment (~2–4 weeks on top of the existing `/mcp` implementation).

### D. "Bulk approval with statistical QA" — the scale-out pattern

Q2 (pSEO) and the content-repurposing engine (strategy 7 from the video, not a user question but adjacent) both need to publish dozens to thousands of items at a time without drowning operators in the review queue. A new "approve-by-sample" pattern (pass if N of sample M clears an automated + human QA bar) extends the HITL system cleanly and unlocks volume.

### Ranked product bets (what to ship first)

Ordering by leverage × time-to-value × how many of the five plays it unlocks:

| Rank | Bet | Unlocks | Approx. build |
|---|---|---|---|
| 1 | Public skill-execution surface (A) | Q1, Q3, Q5 | 4–6 wks |
| 2 | Artifact primitive (B) | Q3, Q4, Q5 | 4–6 wks |
| 3 | GEO Scorer free tool (Q3 #1) — first tool on top of A + B | Q3, Q4, Q2 dataset | 1–2 wks |
| 4 | Agency Ops Score free tool (Q3 #2) — Synthetos's own TOFU | Synthetos inbound directly | 1–2 wks |
| 5 | Public-MCP mode + Smithery / MCPT listing (Q1) | Q1 | 2–4 wks |
| 6 | Per-agency branded MCP endpoint (Q1) | Q1 (agency layer) | 3–4 wks |
| 7 | GEO Tracker citation probe loop (Q4) | Q4 | 3 wks |
| 8 | pSEO fanout playbook + statistical QA gate (Q2 / D) | Q2 | 4–6 wks |

**A single agency running Synthetos with bets 1+2+3+4 live would have a strictly better top-of-funnel than almost any of its own competitors.** That's the case for shipping this as platform infrastructure.

### Non-goals to resist

Because the video reads like a menu, it's tempting to ship all seven plays. Some don't fit the Synthetos non-goals list (`docs/capabilities.md` §non-goals):

- **Buying newsletters to acquire audience** (video strategy 6): outside the product surface. It's a founder growth tactic, not a product investment. Capture as a GTM motion for the Synthetos team, not as a feature.
- **AI content repurposing engine** (video strategy 7): the primitives exist (`transcribe_audio`, `draft_content`, `draft_post`). Wiring them into a single "pillar-in, N-channels-out" playbook is worth ~2 weeks; productising the *repurposing engine itself* as a standalone feature fights the positioning of Synthetos as an ops platform, not a social-media content tool. Keep it as a playbook template, not a marketed product.
- **Buying an agent SDK story.** MCP-as-sales-agent is adjacent to "build your own agent SDK," and we should stay on the *operations* side. Publishing MCP servers ≠ being an agent platform.

---

## 8. Research prompts for Claude + appendix

### How to use this section

Copy each prompt block below into a fresh Claude conversation (or route through the `architect` agent in this repo for ones tied to a specific spec). They are written to be **self-contained** — Claude does not need the rest of this brief in context because each prompt pastes the minimum framing required.

The prompts are grouped by the distribution play they address, then ranked by expected output-quality-per-token (market research first, then product shape, then deep-dive).

### Prompt set 1 — MCP as sales agent (Q1)

**1a — Market scan**

> I am evaluating a new feature for an agency operations platform (Synthetos / Automation OS). The platform already runs an MCP server that exposes 100+ skills to authenticated tenants. I want to ship a public-facing MCP mode so external AI clients (Claude Desktop, ChatGPT Plus, Cursor, Perplexity) can discover and call a subset of the platform's tools on a user's behalf.
>
> Research and report on:
> 1. The three biggest public MCP directories as of mid-2026 (Smithery, MCPT, Open Tools — or the actual state if that's changed). Audience, listing process, ranking / discovery signals, install analytics available to publishers, any moderation rules.
> 2. Examples of MCP servers that have been successful as distribution channels — traffic volumes, install counts, what the server actually does, how the operator monetises.
> 3. What patterns work for MCP-as-sales (read-only tools that surface products, lead-capture tools, scheduling tools) vs. patterns that flop.
> 4. Known abuse / safety failure modes for public MCP servers and the standard mitigations.
>
> Return a structured brief, ≤1,500 words, with sources.

**1b — Product shape**

> I want to design "publishable MCP servers" as a feature of a multi-tenant agency ops platform. Each of our agency customers should be able to publish an MCP server scoped to one of their client workspaces, pick which tools are exposed, choose read-only vs. limited-write, and see analytics on how external AI clients are calling it.
>
> Design:
> 1. The publish workflow from the agency operator's point of view (screens, approvals, preview).
> 2. The tool-filtering model — which of our existing tool types (read CRM, audit SEO, publish page, send email) should be safe to expose publicly, and which must always be locked?
> 3. The external-AI installation flow — URL, auth, registry listing, discovery.
> 4. The analytics loop — which tools are called, from which AI client, with what success rate, leading to which upsells.
> 5. Five riskiest failure modes and their mitigations.
>
> Constraint: every public-exposed tool must be declarable as safe at the action-registry level; nothing goes public without an explicit flag. Return an implementation-ready design doc.

**1c — Vertical MCP wedges**

> I want 10 proposals for "vertical MCP servers" — public MCP endpoints targeted at a specific vertical's audience, hosted on an agency ops platform. Each should (a) answer a natural-language query an AI user would ask their assistant, (b) return structured data the AI can surface in its answer, (c) create a lead-capture path back to an agency, (d) be runnable on top of ~5–10 platform skills we already have (scraping, CRM read, content lookup, page publishing).
>
> For each proposal include: the target AI-user question, the vertical, the tool surface (2–4 MCP tools), the lead hook, defensibility (why this is hard to copy), and revenue model.

### Prompt set 2 — Programmatic SEO (Q2)

**2a — State of pSEO in 2026**

> Summarise the state of programmatic SEO as of mid-2026 given Google's recent Helpful Content / AI-content crackdowns and the rise of AI answer engines. What page patterns still rank? What kills a domain? What volume is realistic from a cold domain in its first 12 months? What's the typical conversion rate for directory-style pSEO in B2B services? Include three specific case studies with numbers from publicly known operators (Nomad List, Glassdoor, Zapier, PartnerStack, Wise, etc. if applicable).

**2b — Which verticals work today**

> I can build a "programmatic SEO fanout" feature on top of a platform that already has page-publishing, scraping, and content-generation skills. I want to pick 3 verticals where pSEO still wins in 2026 and 3 verticals where it's a trap. Evaluate each using: dataset availability, intent-match of the long-tail query, competition density, Google AI Overview cannibalisation risk, LLM-citation worthiness, conversion rate benchmarks. Recommend the 3 best verticals with a go-to-market sketch.

**2c — Quality-bar design**

> Design a "statistical QA gate" for AI-generated page batches — an approval pattern where an operator approves a batch of N pages by reviewing a random sample of size M, with the batch passing if the sample hits a quality floor. What sample sizes give good coverage? What quality dimensions should the rubric score? How do you prevent adversarial drafting (the generator producing high-quality samples but lower-quality tails)? Include a worked example with N=1,000, M=50.

### Prompt set 3 — Free tools (Q3)

**3a — Free-tool archetype research**

> Do a systematic teardown of the top 20 B2B SaaS free tools used as top-of-funnel in 2024–2026 (Ahrefs backlink checker, HubSpot website grader, Stripe Atlas tools, Clearbit's enrichment tools, etc.). For each include: what it does, which data input it asks for, what artifact it returns, what lead data it captures, what paid product it upsells into, and (if public) rough volume / lead-conversion metrics. Identify the three most repeated patterns.

**3b — Agency-operator-specific free tools**

> Brainstorm 20 free tools targeted at **agency owners running 10+ client accounts**. They must be tools the agency operator personally uses (not tools for their clients). Each should input 3–5 fields or a CSV / URL, return a score or a diagnostic, and lead naturally into a paid multi-client ops platform. Score each on: install friction, time to value, viral / shareable potential, ICP precision.

**3c — Free-tool surface architecture**

> Design a "public skill-execution surface" for a multi-tenant agent platform. A visitor (no account) can run a single constrained agent run against a curated skill. Requirements: per-IP rate limits, per-skill cost cap, lead capture (email), share-card generation, full audit log tied back to the org that owns the tool. Produce: data model, request flow, abuse-control heuristics, and the integration points with an existing HITL review queue when the tool execution produces output that needs review before publish.

### Prompt set 4 — AEO / GEO tracking (Q4)

**4a — AI-referral measurement state of the art**

> As of mid-2026, what are the production-grade ways to measure AI-referral traffic to a domain? ChatGPT citation tracking, Perplexity citation tracking, Google AI Overview appearance tracking, Gemini, Bing Copilot. For each: what APIs / scraping approaches exist, what's their reliability, and what are the leading commercial tools already in this space (Otterly, Profound, Peec, anything new). Report gaps and the edges where a new tracker could win on agency multi-tenant economics.

**4b — GEO Tracker product spec**

> Design a "GEO tracker" feature that runs inside a multi-tenant agency ops platform. It performs recurring citation probes against major AI engines for each client using a canonical prompt set, records citation / mention / non-mention per engine per probe, stores longitudinal data per subaccount, alerts on drops. Spec: probe-set authoring, scheduling, engine adapters, storage schema, alerting rules, operator UI, client-portal surface.

### Prompt set 5 — Shareable artifacts (Q5)

**5a — Artifact primitive design**

> Design a reusable "Artifact" primitive for an agent platform. Input: any structured run output from a skill (audit result, health score, competitor brief, portfolio summary). Output: a branded public URL + Open Graph card + prefilled share intents. Requirements: HITL approval before going public, per-agency brand override, analytics (view / share / click-through), revocation, expiry. Produce: database schema, rendering pipeline, skill integration contract, approval workflow, abuse controls.

**5b — Viral-loop archetypes for B2B**

> Catalogue the viral / shareable-artifact patterns that actually work for B2B (not consumer) products. Spotify Wrapped is consumer; GitHub contribution graph is B2B-adjacent. Find 15 real examples across dev-tools, marketing tech, finance tech, HR tech, agency tech. For each: what the artifact shows, why the B2B user shares it, and the measurable distribution result if public.

### Prompt set 6 — Cross-cutting

**6a — The integrated "distribution OS" pitch**

> I run a multi-tenant agency operations platform with 100+ skills, a three-tier tenant hierarchy, an MCP server exposing skills as tools, a GEO audit suite, page-publishing, and an HITL review system. I want to add: (1) a public MCP mode for agency-published endpoints; (2) a public skill-execution surface for free tools; (3) an Artifact primitive for shareable branded outputs; (4) a programmatic SEO fanout playbook. Taken together, what is the sharpest one-paragraph positioning statement that explains this as a coherent "distribution OS for agencies"? Draft three variants with different audiences (agency owner, agency marketer, end-client).

**6b — Competitive positioning**

> Compared to (a) Zapier Interfaces / Tables / Chatbots, (b) Lindy, (c) Relay, (d) Gumloop, (e) n8n Cloud, (f) HubSpot AI, (g) Claude-for-Work / ChatGPT Enterprise, what is uniquely defensible about a multi-tenant agency ops platform that ships public MCP endpoints, free-tool surfaces, shareable artifacts, and programmatic SEO fanout? Write the two-page competitive-positioning doc, strict on what we *don't* compete on.

### Appendix — file pointers for the reader

| Concern | Start file |
|---|---|
| MCP server | `server/mcp/mcpServer.ts`, `server/routes/mcp.ts`, `server/config/mcpPresets.ts` |
| MCP client | `server/services/mcpClientManager.ts`, `server/services/mcpAggregateService.ts` |
| GEO skills | `server/skills/audit_geo*`, `server/skills/geo_*`, `docs/geo-seo-dev-brief.md`, `docs/geo-seo-spec.md` |
| Pages | `server/routes/pageProjects.ts`, `server/routes/pageRoutes.ts`, `server/services/pageProjectService.ts`, `server/services/pageService.ts`, skills `create_page` / `update_page` / `publish_page` |
| Content cluster | `draft_content`, `draft_post`, `draft_ad_copy`, `create_lead_magnet`, `draft_sequence`, `transcribe_audio` |
| Portal + artifacts | `docs/capabilities.md` §Client Portal, §Pages & Content Builder |
| HITL | `docs/capabilities.md` §Human-in-the-Loop (42+ review-gated actions) |
| Positioning & non-goals | `docs/capabilities.md` §Positioning & Competitive Differentiation, §What Synthetos is NOT trying to be |
| Three-tier model | `CLAUDE.md` §Architecture Rules, `architecture.md` (project deep reference), `server/lib/resolveSubaccount.ts` |

### Appendix — seven plays summary table

| Video play | Our state today | Highest-leverage next move |
|---|---|---|
| 1. MCP as sales agent | Server shipped, auth-only | Public mode + registry + per-agency branding |
| 2. Programmatic SEO (10k pages) | Individual page publish + content drafting shipped; no bulk fanout | pSEO fanout playbook with statistical QA gate; start narrow (one vertical, one data set) |
| 3. Free tool as TOFU | All skills exist; no public-exec surface | Build public skill-execution surface; GEO Scorer + Agency Ops Score are highest-ROI first tools |
| 4. Answer engine optimisation | GEO audit suite fully shipped; tracking over time is the gap | GEO Tracker (citation probe loop) |
| 5. Viral shareable artifacts | Portal-scoped briefs only | Artifact primitive + OG image renderer + promote-to-public workflow |
| 6. Buy a newsletter | — | Treat as a founder-level GTM motion, not a product investment |
| 7. AI repurposing engine | Primitives exist (transcribe, draft_content, draft_post); not wired together | Ship as a playbook template, not a marketed feature |

---

**End of brief.** Hand this file to Claude. The research-prompt blocks in §8 are designed to be pasted as-is.


1. Framing & Automation OS capability snapshot
2. Q1 — MCP server as your sales agent
3. Q2 — Programmatic SEO: 10k pages in a weekend
4. Q3 — Free tool as top of funnel (top 5 ideas)
5. Q4 — Answer engine optimisation vs. our existing GEO skills
6. Q5 — Shareable artifacts and outputs
7. Cross-cutting synthesis — product bets that compound
8. Research prompts for Claude + appendix

---
