# Development Brief: AI Visibility MCP Server (GEO-MCP)

**Date:** 2026-04-20
**Status:** Draft — shovel-ready, awaiting classification + scheduling
**Classification:** Significant (new public-facing surface, new auth mode, cross-cutting)
**Source thinking:** `tasks/mcp-sales-agent-research-brief.md` §2, §4, §7
**Related existing briefs:** `docs/geo-seo-dev-brief.md` (GEO skill cluster — hard dependency; shipped Phase 1)

> **Scope note:** this is a **development brief** — intent, user experience, business model, scope boundaries. It is *not* a technical implementation spec. The architect + spec-reviewer pipeline comes after this document.

---

## Table of Contents

1. Problem / opportunity
2. What we're building
3. Why this is the right first MCP to ship
4. Tool surface (V1)
5. User experience walkthrough
6. How it connects to the rest of the platform
7. Conversion model
8. Scope — V1 / V2 / later
9. Dependencies / preconditions
10. Open questions
11. Success criteria

---

## 1. Problem / opportunity

AI assistants — Claude Desktop, ChatGPT, Perplexity, Cursor, Gemini — are becoming the primary discovery surface. When a marketing operator wonders *"is my site visible to AI search engines?"*, they increasingly ask their AI, not Google. Whatever tool the AI calls to answer that question *wins the category by default*.

Synthetos is unusually well positioned here because two things are already true:

- **The MCP plumbing exists.** `server/mcp/mcpServer.ts` exposes every action + system skill as a typed MCP tool today, streamed over HTTP at `/mcp`. The only missing piece is a **public-facing, unauthenticated mode** that external AI clients can call without a Synthetos seat.
- **The GEO payload is the strongest in the market.** 8 GEO skills, 6-dimension composite score (AI Citability, Brand Authority, E-E-A-T, Technical, Structured Data, Platform-Specific), per-engine readiness for Google AIO / ChatGPT / Perplexity / Gemini / Bing Copilot, `llms.txt` generation, competitive benchmarking. Shipped Phase 1 (April 2026). No competing agency automation platform offers this today.

The opportunity: **combine the two** — ship a public MCP server, branded "AI Visibility by Synthetos", that exposes the GEO cluster as tools any AI assistant can call on a user's behalf. The AI becomes both the distribution surface *and* the lead-qualification layer. Zero paid acquisition.

## 2. What we're building

A public, installable MCP server that surfaces the GEO skill cluster to any MCP-compatible AI client. When a user chats with their AI about AI search visibility, the AI discovers the tool, calls it, returns the audit to the user, and — at the right moment — captures a lead back into Synthetos for the paid tracking upsell.

This is a **distribution bet, not a technology bet**. The underlying skills already work. The new product work is:

- A public-auth mode on top of the existing `/mcp` transport
- A tight, deliberately-chosen tool surface (read-only; no writes to client systems in V1)
- Abuse / rate-limit / cost controls
- Registry listings (Smithery, MCPT, Open Tools)
- A lead-capture path that funnels into a new Synthetos inbound-leads subaccount
- A paid upsell: the GEO Tracker (recurring citation probes — designed as ClientPulse's sibling, see `tasks/mcp-sales-agent-research-brief.md` §5)

## 3. Why this is the right first MCP to ship

- **Zero new skills required.** `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare` all exist and return structured output.
- **Natural freemium gradient.** A one-shot audit is cheap (~$0.50–$2 of LLM spend). Recurring citation tracking over weeks is the paid upsell. The split is obvious and the user understands it instantly.
- **Shareable by default.** Every audit result is a branded 0–100 score card — future-compatible with the Artifact primitive work (Q5 of the source research brief).
- **One skill cluster, two distribution surfaces.** The same skills can later power a browser-based free tool at `synthetos.com/geo-score` — same backend, different front door.
- **Proves the wider thesis.** Once this converts at measurable rates, every agency on Synthetos can fork the pattern to publish their own vertical MCP (a dental-sector agency publishing `DentalAIVisibility`, a real-estate agency publishing `PropertyAIVisibility`, etc.). The product becomes **per-agency publishable MCPs**, which is a structural moat LLM providers cannot match — their buyer is an individual, not an agency running isolated multi-tenant client work.
- **Brand-collision moment** at exact buying intent. Every Claude / ChatGPT response that calls this tool surfaces *"according to Synthetos' AI visibility audit..."* in the AI's own voice. That's distribution we do not pay for.

---

## 4. Tool surface (V1)

Four tools, all read-only. Writes to third-party systems are deliberately out of scope for V1 — they would require per-user OAuth, which defeats the "zero friction for AI users" thesis of this bet.

| Tool | What it does | Role in the funnel |
|---|---|---|
| `check_ai_visibility(domain)` | Runs the `audit_geo` composite → returns 0–100 score, 6-dimension breakdown, top 3 prioritised fixes, per-engine readiness signals | **Sets the hook.** First call delivers a memorable score the user wants to fix |
| `generate_llms_txt(domain)` | Runs `geo_llmstxt` → returns a ready-to-deploy `llms.txt` file | **Immediate value.** Something concrete the user can deploy same day; reinforces the brand |
| `compare_ai_visibility(domain, competitor)` | Runs `geo_compare` → 2-way competitive benchmark across the six GEO dimensions | **Emotional hook.** *"You scored 47; your competitor scored 71"* creates urgency |
| `subscribe_ai_tracking(domain, email)` | Captures email + domain + audit context; creates a lead in a Synthetos inbound-leads subaccount | **Conversion.** The only tool that captures PII; everything else is stateless |

### Why these four, in this order

The sequence is deliberate: **diagnose → fix (something) → compare → convert**. Skipping `generate_llms_txt` would make the first interaction feel like a gated demo. Keeping `compare_ai_visibility` in V1 is a judgement call — it's the strongest emotional trigger, but it surfaces a named competitor in an AI response, so we should design the tool to require explicit user consent for the competitor domain (see §10 Open Questions).

### What's explicitly NOT in V1

- Writes to the user's CMS, search console, or CRM (deferred to logged-in Synthetos flows)
- Tool-assisted remediation ("fix my schema" / "deploy my `llms.txt`") — too many OAuth surfaces
- Recurring tracking from inside the MCP itself — that's the paid product, accessed through the Synthetos app
- Per-agency branded MCPs — V2 bet (see §8)

## 5. User experience walkthrough

**Setting.** A marketing operator at a mid-sized SaaS company, chatting with Claude Desktop. They've installed the "AI Visibility by Synthetos" MCP after seeing it in a Smithery directory or a LinkedIn post.

1. **Prompt.** *"Hey Claude, can you check if acme-crm.com is visible to ChatGPT and Perplexity?"*
2. Claude sees the MCP is installed, calls `check_ai_visibility(domain: "acme-crm.com")`. Synthetos runs the real audit chain (the same eight skills that power the internal agent product).
3. **Claude's response.** *"acme-crm.com scored 47/100 for AI search visibility. The biggest issues: no `llms.txt` file, limited structured-data coverage, and low brand authority signals. ChatGPT and Perplexity rarely surface your content in their answers. Want me to generate a starter `llms.txt` you can deploy today?"*
4. **User.** *"Yes, please."*
5. Claude calls `generate_llms_txt` — returns the file contents. Claude hands them to the user with a short deployment note.
6. **Claude's follow-up prompt (scripted in the tool's own description so Claude naturally offers it).** *"If you'd like to see how your visibility trends over the next few weeks as you ship fixes — and whether ChatGPT / Perplexity / Gemini actually start citing you — Synthetos runs weekly citation tracking. Want me to get you set up? I just need your email."*
7. **User.** *"Sure, it's jane@acme-crm.com"*
8. Claude calls `subscribe_ai_tracking(domain, email)`. Synthetos records the lead with full context (domain, audit result, AI-client fingerprint, which tools they called). The nurture sequence fires from `draft_sequence` + `send_email` (HITL-gated like every Synthetos-sent email).
9. The operator gets a welcome email within minutes. Downstream conversion to the GEO Tracker paid trial is a measurable funnel event.

**The critical moment:** step 3's answer. Claude is *citing Synthetos in its own voice* as the source of the audit. That's brand surfacing we cannot buy any other way — and it happens at the exact moment the user is in buying mode for an AI-visibility product.

---

## 6. How it connects to the rest of the platform

This is a reuse bet — almost no greenfield code path, almost everything leans on infrastructure that's already shipped.

- **Auth & tenancy.** A new public-auth mode on the existing `/mcp` route (likely mounted at a distinct path like `/mcp/public/geo` or a dedicated subdomain for registry hygiene). Requests are attributed to a system-owned "public-mcp" tenant with hard cost ceilings per IP, per domain, and per 24h window. No per-user Bearer token; tight abuse envelope instead.
- **Skill execution.** Unchanged. Tools route through the existing `skillExecutor` and call real skills — no forked code path, no drift between "internal audit" and "public audit".
- **Lead capture.** `subscribe_ai_tracking` writes a canonical contact into a dedicated **inbound-leads subaccount** (one subaccount in a Synthetos-owned org, not a customer org). The contact carries full provenance: domain, audit score snapshot, tool-call history, AI-client fingerprint if discernible. Nurture runs through `draft_sequence` + `send_email` with the standard HITL gate.
- **Observability.** The existing MCP **outbound** call ledger (every MCP tool call our agents make is logged) gets a mirror for **inbound** public calls. Per tool: call count, success rate, avg duration, LLM spend, lead-capture conversion rate, AI-client distribution.
- **Cost attribution.** Public-MCP spend rolls up into the same cost-aggregate pipeline as internal LLM spend, tagged `channel=public-mcp` so it shows in the CFO view as a marketing line (not a client-delivery line).
- **HITL.** V1 tools produce no writes to third-party systems, so the review queue is untouched except for the nurture-email flow, which already uses the standard `send_email` review model.
- **Rate limiting & caching.** Per-domain rate limits (1 full audit per domain per 24h; subsequent calls return the cached result with a "last refreshed" timestamp) cut both abuse surface and cost. Per-IP throttling on lead capture to stop email-stuffing.
- **No changes needed to:** the three-tier tenancy model, the action registry, the HITL review queue, the canonical data layer, or the skill executor. This is the power of building on a mature operations platform.

## 7. Conversion model

**Free tier (the MCP itself)**
- Unlimited `check_ai_visibility`, `generate_llms_txt`, `compare_ai_visibility` — per-domain and per-IP rate-limited.
- Cost borne by Synthetos: ~$0.50–$2 LLM spend per full audit.
- Treated as a **marketing line item** with a monthly ceiling, not a product P&L line.

**Paid tier (the upsell — GEO Tracker)**
- Recurring weekly citation probes against ChatGPT, Perplexity, Gemini, Google AIO using a canonical prompt set tailored to the domain's vertical.
- Trendline dashboard per domain, per engine, per probe.
- Alerts on citation-rate drops, competitor takeover, new engine readiness gaps.
- Priced per tracked domain × per probe frequency. Initial pricing hypothesis: $49/mo for one domain, $199/mo for five, agency plans start at 25 domains.
- Delivered through the full Synthetos app (not inside the MCP — the MCP is only the funnel top).

**Funnel attribution**
- Every lead carries `source=public-mcp-geo` and an `ai_client_fingerprint` (Claude Desktop / ChatGPT / Perplexity / etc. — captured where discernible from the MCP session headers).
- Cohort conversion tracking from audit → email capture → tracker trial → paid.
- Per-tool conversion attribution: does `compare_ai_visibility` convert meaningfully better than `check_ai_visibility` alone? If so, its weight in the tool surface goes up.

**Why the conversion math looks reasonable**
- Every session that triggers `check_ai_visibility` is by definition someone who is *already in buying mode* for AI-visibility tooling. The qualification bar is the highest top-of-funnel we have access to.
- Conservative estimate: 10% audit→lead conversion, 5% lead→trial, 20% trial→paid. At 500 audits/month that's ~5 paid conversions/month — modest, but the bet compounds because every paid conversion is a per-agency customer who can then *fork the pattern* for their own clients.

---

## 8. Scope — V1 / V2 / later

### V1 — Launch (the bet to validate)

- Public MCP endpoint at a dedicated path (or subdomain) with a hardened public-auth mode.
- 4 tools as specified in §4 — all read-only, all leaning on existing skills.
- Per-IP, per-domain, per-day rate limits; cached audits within a 24h window; daily LLM-spend ceiling for the whole public surface.
- Registry submissions: Smithery, MCPT, Open Tools (each listing is ~1 week of prep).
- Inbound-leads subaccount with nurture sequence (welcome email → day-3 "your score vs. industry" → day-7 "start tracking" → day-14 "last chance trial").
- Extended call-observability ledger to cover inbound public calls (mirrors the existing outbound model).
- Instrumentation dashboard showing: audits/day, unique domains audited, email-capture rate, trial conversions, cost per lead.

### V2 — After signal (2–3 months post-launch, conditional on V1 metrics)

- **Shareable Artifact card per audit** — a public `synth.to/geo/<slug>` URL with branded OG image so audit results are one-click shareable to LinkedIn / Twitter. Feeds the Q5 Artifact-primitive work from the source research brief.
- **Browser-based free tool** at `synthetos.com/geo-score` using the same skill pipeline — zero incremental skill work, new front door for users not in an AI chat.
- **GEO Tracker** as a standalone paid product inside the Synthetos app (the upsell's own product surface).
- **Per-agency forked MCPs** — a Synthetos agency customer can publish their own branded AI-Visibility MCP for their vertical (DentalAIVisibility, PropertyAIVisibility, etc.) by cloning and re-branding the base MCP. The underlying infra is the same; the brand, the probe set, and the lead destination differ.

### Later — Platform bet

- **Writes.** Once a Synthetos user is authenticated, the MCP can expose write tools that deploy fixes directly (generate + push `llms.txt`, fix schema via an approved playbook, etc.) under the full HITL model.
- **Vertical MCP publishing** as a first-class Synthetos feature (not just GEO): every agency gets a publishable MCP endpoint per subaccount, for any mix of skills they choose. The GEO MCP becomes the reference implementation and internal template.

## 9. Dependencies / preconditions

- **GEO skill cluster** stable and producing reliable scores. **True today** — shipped Phase 1.
- **MCP server able to run in a tenant-less public mode** without compromising existing per-tenant assumptions. Design work required; low but non-zero risk.
- **Cost model that survives abuse.** Rate limits + caching + daily ceilings are the primary defence. Secondary defence: cheap per-call cost (single audit is ~$1, not $20) means even a 10× abuse spike is survivable.
- **Legal / ToS posture on scraping target domains at scale.** `scrape_url` is the underlying fetcher; its existing tier-escalation model already handles Cloudflare / bot detection. Worth a focused legal sanity-check before launch given the scale implied by public audits.
- **Registry listing review times.** Smithery / MCPT / Open Tools each have their own review pipelines — add 1–3 weeks lag between "server built" and "server discoverable in the registry".

## 10. Open questions

These are the decisions that need a human call before the architect starts planning implementation:

1. **Brand wrapper.** Synthetos-forward ("AI Visibility by Synthetos") maximises trial conversion but feels salesy in a registry listing. Tool-forward ("AI Visibility Audit") probably ranks better in registries and feels neutral to AI users. Which does the data support? Consider A/B across registries.
2. **Compete in V1?** `compare_ai_visibility` surfaces a named competitor in the AI's response. Upside: strong emotional hook ("you scored 47, competitor scored 71"). Downside: tone / legal / trademark surface. Gut call: keep in V1, require the user to type the competitor domain explicitly (no inference).
3. **Resource discoverability.** MCP supports "resources" (catalogue-style browsable objects) alongside "tools". Should we expose the tool catalogue as a resource so AI clients can browse without calling? Lean toward *no* for V1 — fewer surface = easier to reason about.
4. **Sub-brand / dedicated domain?** `ai-visibility.synth.to` vs `synthetos.com/ai-visibility`. Sub-brand may lift early growth (feels like a standalone tool); parent domain builds Synthetos direct authority. Default to the parent domain unless marketing has a strong counterargument.
5. **Free-tool parity.** Should the V1 public MCP be gated to domains the caller can prove they control (e.g. DNS TXT or meta-tag verification) to prevent abuse / competitor-surveillance? Simpler if no, but rate limits alone are a weaker defence. Revisit once we have 30 days of abuse data.
6. **Which upsell model is the right default for the GEO Tracker.** Per-domain subscription feels right for small teams; agency multi-domain plan is the ICP fit for our actual customer. Decision needs marketing + pricing input.

## 11. Success criteria (V1)

Measured at 30 and 90 days post-launch. Numbers are working assumptions — revisit once the marketing team has a comparable benchmark set.

| Metric | 30-day target | 90-day target |
|---|---|---|
| Unique domains audited via MCP | 500 | 5,000 |
| Installs tracked across registries | 200 | 2,500 |
| Audit → email-capture conversion | 7%+ | 10%+ |
| Email → trial conversion | 3%+ | 5%+ |
| Trial → paid conversion | 15%+ | 20%+ |
| Cost per lead (LLM spend / lead) | ≤ $25 | ≤ $15 |
| Top-5 registry ranking for "SEO" or "AI visibility" categories | At least one registry | Two+ registries |
| Qualitative: at least one agency customer requests a forked MCP | — | 1+ |

### What "success" unlocks

Hitting the 90-day targets triggers:

- Greenlight on the **Artifact primitive** work (Q5 of the source research brief) — GEO audits become the first Artifact producer.
- Greenlight on **per-agency MCP publishing** as a first-class feature, with the GEO MCP as the reference implementation.
- A real data point supporting the public-skill-execution-surface investment identified in `tasks/mcp-sales-agent-research-brief.md` §7 as the highest-leverage infrastructure bet.

### What "failure" teaches

If the numbers miss:

- Low audit volume → registry discovery is harder than assumed; invest in manual listing promotion or reconsider the free-tool front door.
- High audit volume, low email conversion → the in-conversation ask isn't strong enough; iterate on tool descriptions (the text Claude uses to decide when/how to surface the upsell).
- High email conversion, low trial conversion → the nurture sequence is the bottleneck, not the MCP.
- Low trial→paid conversion → the GEO Tracker product itself needs sharpening before it's ready to be the MCP's paid upsell.

Any of these is a cheap lesson — the V1 build is small enough that a "failure" is still a recoverable investment in the larger publishable-MCP thesis.

---

**End of brief.** Hand to the architect agent for an implementation plan when this is ready to schedule.

