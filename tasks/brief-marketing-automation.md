# Brief — Marketing Automation inside Synthetos

> **Status:** input brief for a downstream design / spec process. Not a spec. Not a plan. Captures synthesised research + recommended product shape so the next process can move directly to scoping.
>
> **Scope:** marketing automation as a Synthetos capability — social media, SEO blogging, repurposing, engagement feedback, and the integrations / browser-control layer that makes it possible. Sub-account-level surface for end operators (agency clients, in-house operators).
>
> **Last updated:** 2026-05-06.

## Table of contents

1. Purpose
2. Source inputs — distilled
3. The three durable moats
4. What we explicitly do not build
5. Recommended Synthetos-native architecture
6. Skill / playbook decomposition
7. Sub-account UX — how an operator turns this on
8. Design rules
9. Outcome metrics for the capability
10. Open questions for the next process
11. One-line summary
12. References

---

## 1. Purpose

Synthetos already has the orchestration primitives (skills, agents, sub-account-scoped credentials, brand context, HITL, audit) to ship a credible marketing-automation capability. The decision the downstream process must make is **what shape that capability takes** — what we build natively, what we integrate, and what we explicitly do not build.

This brief consolidates three independent inputs gathered in research:

1. **Video walkthrough** — Claude Code + Blotato (social posting) + Arvo (SEO blogging) end-to-end recipe, marketed as "fully automate social media in 5 minutes."
2. **The two prompts attached to that video** — an 8-stage SEO-and-distribution master prompt, and a simpler social-media-manager prompt.
3. **~150-comment practitioner thread** (May 2026, AI-builders Facebook group) — "How are you guys automatically posting social media?" Practitioners describing what's actually working, what's saturated, and what's a trap.

The synthesis below is the input. Recommendations are directional, not decided.

---

## 2. Source inputs — distilled

### 2.1 The video recipe (Blotato + Arvo via Claude Code)

End-to-end loop, run as a Claude Code skill from a local folder:

- Gap analysis on competitors → keyword clusters and ranking opportunities.
- Generate prioritised blog briefs (title + primary/supporting keywords + intent).
- Publish to a CMS via Arvo (handles meta description, alt text, schema, internal links, AI-overview-friendly formatting).
- Read the resulting RSS feed → derive platform-specific captions for IG / FB / LI / X.
- Generate visuals (infographics, slideshows, whiteboard explainers) via Blotato templates.
- Schedule everything via Blotato's API across the operator's connected social accounts.
- Operator approves at gates; the skill logs published URLs.

**What it actually demonstrates:** the recipe is the IP, not the tools. Blotato and Arvo are paid third-party plumbing. The orchestration layer (Claude Code reading prompts, calling APIs, prompting for approval) is what a platform like Synthetos already provides natively, with audit, multi-tenancy and credential storage on top.

### 2.2 The two prompts

Both prompts are doing manually what Synthetos already holds as first-class data:

- "Tell me your business name, URL, industry, audience, brand voice, products, target geographies…" — every one of those fields is sub-account context.
- "Maintain a separate file with a running log of published posts" — append-only audit trail is a platform primitive.
- "If a visual or fact cannot be verified, pause and flag" — native HITL escalation.
- "Create a Claude skill that knows my brand voice" — Synthetos skills are conceptually the same primitive, with the brand voice already attached to the sub-account.

Net: when the same recipe is re-implemented inside Synthetos, the prompts shrink dramatically. Most of their volume is configuration the platform supplies for free.

### 2.3 The practitioner thread

What the operator-builder community is actually shipping and what they're hitting walls on:

- **Reference architecture (Patrick Bullock):** nightly agents scrape top-performing posts → extract insights → apply to operator-owned templates → generate clip + overlay + music → auto-upload → track engagement → compare engagement to the hypothesis applied → keep winners, kill losers, mutate middling. Operator-in-the-loop is light: review, scrap occasionally, minor edits. Voice-call interface for ad-hoc reels.
- **Pure-API pipeline (Matthew Hapgood):** HTML slide templates at exact platform dimensions, Playwright headless screenshots, Supabase as the public-URL host, Meta Graph API for IG/FB/Threads, .env tokens, one Node script. Skipped X (£200/mo API tier), TikTok carousels (low ROI), LinkedIn carousels (PDFs, separate OAuth, deferred).
- **Commerce angle (David Wilson):** Shopify product → platform-tailored copy → Buffer schedule → 6+ posts across 3 platforms with correct aspect ratios from one product shoot.
- **Browser control as the API escape hatch:** multiple builders (Bryant Haines, Eric Neuman) running Claude Code or an agent harness driving native scheduler UIs in a VM, for platforms with bad/expensive APIs (LinkedIn, X, FB groups).
- **MCP as the integration shape:** Blotato MCP, OneUp MCP, Chrome MCP repeatedly surfaced as the way builders are wiring this up.

**Saturated tooling** (do-not-rebuild list, surfaced in the thread):

- Schedulers / posters: Buffer, Metricool, Postiz, Blotato, Hootsuite, Vista Social, ContentStudio, late.dev, Repurpose.io, OneUp, Cowork, Lionzay, Predis.ai, Typefully, GHL, Twinfold, Search Atlas.
- Workflow glue: n8n, Make, Zapier, Pabbly.
- Generation: Claude, OpenAI, KIE (image), ElevenLabs + HeyGen, Opus Clip.

**Skeptic signal worth taking seriously:**

- Slop trap — operators pumping content with no idea what's published. Auto-improve loops only work if engagement signal is real, not vanity.
- FB monetisation misalignment — build audience on-platform, monetise off-platform.
- AI-pumped Shorts get demonetised on YouTube.
- Account-ban risk on browser automation at scale and on API abuse.
- "The world isn't asking for more auto-posted content."

**Unmet needs surfaced:** posting to FB groups (not pages), LinkedIn carousels, affordable X posting, TikTok carousels, brand-coherence visibility ("I don't even know what my company is pumping out"), structured learning path.

---

## 3. The three durable moats

Across all three inputs, three capabilities are consistently present in the best descriptions and consistently absent in saturated SaaS:

1. **Repurpose as a primitive.** One source artifact (transcript, blog, podcast, product shoot) → N platform-specific outputs with correct copy, hashtags, dimensions, and tone. Removes the actual content bottleneck.
2. **Engagement feedback loop.** Pull post-level metrics → attribute back to the template / hypothesis the agent applied → keep winners, kill losers, mutate middling. Almost no shipped product does this end-to-end.
3. **Browser-control sandbox.** VM-isolated browser harness for platforms with bad/expensive APIs (FB groups, LinkedIn carousels, X without paying £200/mo). SaaS competitors cannot ship this safely; a multi-tenant orchestrator with isolation primitives can.

Posting is commodity. Scheduling is commodity. The recipe is table stakes. These three are where Synthetos should live.

---

## 4. What we explicitly do not build

- **A scheduler UI / calendar.** Buffer, Metricool, Blotato, GHL, Postiz already saturate this surface.
- **An analytics dashboard page.** Per the platform's frontend-design-principles five hard rules: a status dot beats a utilisation dashboard. Inline state on existing surfaces beats a new analytics page.
- **A first-party multi-platform poster.** Each network's posting API is a moving target with rate limits, content rules, OAuth dances. Blotato / Buffer / Postiz absorb this; we integrate.
- **A CMS for SEO publishing.** WordPress, Wix, Shopify, Webflow already exist. Arvo and similar tools handle the SEO scaffolding. We integrate.
- **Throughput-optimised "post more often" tooling.** Aligns with the slop trap. Optimise for outcomes, not volume.

---

## 5. Recommended Synthetos-native architecture

Layered priority — **build top-down**, defer the lower layers if scope pressures bite:

| # | Layer | Description | Status |
|---|-------|-------------|--------|
| 1 | **Repurpose primitive** | Source artifact → N platform-specific outputs with correct copy / hashtags / aspect ratios per platform. Reads brand context, brand assets, sitemap, internal-link map from the sub-account. | Headliner. Ship first. |
| 2 | **Approval gate** | One-click HITL before publish. Default ON for new operators. Reuses existing HITL infra. | Table stakes. |
| 3 | **Engagement feedback loop** | `engagement_tracker` pulls platform metrics → attributes back to the source artifact + template hypothesis used → `template_evolver` promotes winners, retires losers, mutates middling. | The durable moat. Ship as v1.1 if it can't make v1. |
| 4 | **Browser-control sandbox** | VM-isolated browser harness for platforms without good APIs. v1 scope likely: LinkedIn carousels first, FB groups second, X deferred. | Differentiator. |
| 5 | **Integrations: posting + SEO** | Blotato (or Buffer / Postiz alt) for posting plumbing; Arvo (or equivalent) for SEO publishing. Sub-account credential storage; operators bring their own paid accounts. | Plumbing. |
| 6 | **MCP exposure** | Expose `repurpose`, `schedule`, `publish` as MCP tools so builder workflows can compose Synthetos in. | Cheap; ship with v1. |

### 5.1 Repurpose primitive — design notes

- Input: a source artifact reference (URL, transcript ID, blog post ID, product photo set), plus a target platform set and an optional template hint.
- Output: N drafts, each carrying platform-specific copy, hashtag set, and visual reference at the correct aspect ratio (1:1 IG, 16:9 X, 3:4 Pinterest, 1080×1350 IG portrait, etc.).
- Reads sub-account brand context (voice, audience, geographic focus, products) — never re-collects.
- Reads brand assets (logo, palette, photo library, sitemap, internal-link map) — never re-collects.
- Visual rule: pull real images from the operator's library or their published web pages by default. Generated visuals (Blotato templates, KIE, etc.) are opt-in, never auto-invented.
- Hard guardrails: no invented facts, no invented visuals. If a claim or visual cannot be verified, pause and route to HITL with a structured reason.

### 5.2 Engagement feedback loop — design notes

- `engagement_tracker` ingests platform metrics on a schedule (per-post saves, shares, comments, likes, link-clicks, off-platform conversions where attributable).
- Each post carries forward the source artifact ID and the template hypothesis ID it was generated from. Engagement attributes back to both.
- `template_evolver` runs comparative analysis once N posts per template are reached (default N likely 8–12; needs validation). Promotes templates above a quality threshold, retires below, mutates middling via parameterised generation.
- Engagement metric is operator-configurable per playbook. Default ranking: saves > shares > comments > likes > impressions, with off-platform conversion as the override when attribution exists. Hard-coding the metric is a slop trap.
- All decisions audit-logged; operator can override any keep/kill/mutate verdict.

### 5.3 Browser-control sandbox — design notes

- VM-isolated per sub-account or per session (decision for the next process).
- Pacing: human-in-the-loop default cadence; explicit rate limits per platform; fingerprint hygiene; explicit operator-acknowledged disclaimer at integration setup.
- v1 platform priority hypothesis: LinkedIn carousels (highest-value audience, no clean API), FB groups (no other solution exists), X deferred (the £200/mo tier is a money problem, not an engineering one).
- Account-ban risk needs a written policy doc before this skill ships. Non-negotiable.

### 5.4 Integration model — vendor surfacing

Surface Blotato, Arvo (and chosen alternatives) as **first-party integrations at the sub-account level** — not abstracted away, not n8n-wrapped:

- Two integration cards per major capability (posting, SEO publishing). Operator stores their own API key and account IDs in the existing credential vault.
- Skills call vendor APIs directly. No n8n hop. n8n becomes a power-user escape hatch later, not the primary path.
- Vendors are visible in the operator-facing UI. Hiding them creates support pain ("why didn't my post go out?" — opaque) and pretending we built the posting layer is a maintenance trap when LinkedIn changes its API next quarter.
- Synthetos owns strategy + orchestration; vendors own delivery. Same shape as every other integration in the registry.

### 5.5 MCP exposure

- Ship a Synthetos-native MCP surface that exposes the repurpose, schedule and publish skills.
- Auth via the existing sub-account credential model.
- Lets external builders (Claude Code users, cursor users, agent SDK users) compose Synthetos into their own workflows without rebuilding the orchestration layer.

---

## 6. Skill / playbook decomposition

| Primitive | Type | One-line responsibility |
|-----------|------|-------------------------|
| `repurpose_artifact` | Skill | Source → N platform-specific drafts. The headliner. |
| `seo_gap_analysis` | Skill | Competitive scrape + keyword clustering → ranked opportunity list. |
| `blog_brief_generator` | Skill | Opportunity list → prioritised briefs (title + keywords + intent). |
| `arvo_publish` | Skill (integration) | Brief → published blog URL via Arvo. |
| `caption_generator` | Skill | Source or RSS feed → per-platform captions. |
| `blotato_schedule` | Skill (integration) | Drafts + visuals + time slots → scheduled posts. |
| `engagement_tracker` | Skill | Pull platform metrics, attribute to source + template. |
| `template_evolver` | Skill | Compare templates by engagement; keep / kill / mutate. |
| `browser_post` | Skill (sandbox) | VM-isolated browser publish for platforms without good APIs. |
| `published_post_log` | Audit primitive (existing) | Append-only log of URLs, schedules, status. |
| `content_autopilot` | Playbook | Chains the above with HITL gates and the feedback loop wired in. |

---

## 7. Sub-account UX — how an operator turns this on

Target experience for a non-technical operator at the sub-account level. Maps to the platform's "consumer-simple frontend on enterprise-grade backend" stance.

1. **Connect** — operator visits the sub-account Integrations panel, clicks Blotato (and optionally Arvo). Pastes API key, selects accounts to publish to. Same shape as every other Synthetos integration.
2. **Confirm brand context** — system shows what it already knows (voice, audience, products, geographies, sitemap, brand assets). Operator confirms or edits. No re-collection.
3. **Pick a playbook** — `content_autopilot` (full SEO + social loop), or `social_only`, or `repurpose_one_artifact`. Pre-built; operator does not author from scratch.
4. **Run** — operator hits run. System produces drafts. Approval gate appears as an inline review surface, not a separate dashboard.
5. **Approve** — one click per draft, or batch approve. Posts schedule via the integration.
6. **See outcomes inline** — status dot + last-post line on the existing sub-account home. No new analytics page.
7. **Iterate** — feedback loop runs in the background. Operator gets a weekly "templates promoted / retired / mutated" digest, not a dashboard.

---

## 8. Design rules

Durable, baked into every skill / playbook in this capability:

1. **Optimise for brand outcome, not throughput.** Success metric = engagement quality + off-platform conversion, never posts/day. Antidote to the slop trap.
2. **Default to hidden dashboards.** Inline status beats a new page. Per the five hard rules.
3. **Brand context is read, not re-collected.** Sub-account holds it; skills consume it; the playbook never asks the operator to paste it.
4. **Repurpose is the unit of work, not "a post."** Operator brings a source → system produces a campaign.
5. **No invented facts, no invented visuals.** Verifiable provenance for every claim and image; HITL on uncertainty.
6. **Vendors are visible.** Operators know their Blotato / Arvo / Buffer / KIE accounts are doing the delivery. We orchestrate; we do not impersonate.
7. **Browser automation is opt-in and policy-bound.** Account-ban risk is real; ship the policy doc before the skill.

---

## 9. Outcome metrics for the capability

The metrics the capability is itself measured by — separate from per-post engagement metrics:

- **Time-to-first-published-artifact** for a new sub-account from clean install (target: < 10 minutes).
- **Operator approval rate** on generated drafts (target: > 70%; below that means the brand context isn't being read or the templates are wrong).
- **Template promotion rate** in the feedback loop (signal that the loop is real, not vanity).
- **Sub-account retention** at 30 / 60 / 90 days post-activation.
- **Off-platform conversion attribution rate** where the operator has the wiring in place.

Vanity metrics to explicitly not optimise: posts/day, posts/week, total impressions.

---

## 10. Open questions for the next process

These need decisions before scoping turns into spec.

1. **v1 vendor selection.** Blotato vs Buffer vs Postiz for posting; Arvo vs SurferSEO vs direct WordPress for SEO. Decision matrix needed.
2. **Browser sandbox v1 platform scope.** LinkedIn carousels + FB groups in v1; X deferred. Confirm or revise.
3. **Engagement quality signal default.** Saves > shares > comments > likes > impressions, with off-platform conversion as override. Confirm operator-configurable per playbook.
4. **Feedback loop activation threshold.** Default N posts per template before evolver runs (8–12 hypothesis). Needs data validation.
5. **MCP surface naming and auth model.** Single Synthetos MCP server vs per-skill MCP tools.
6. **Browser automation policy doc owner and content.** Who writes it; what it commits to (rate limits, fingerprint, disclaimers, operator acknowledgement).
7. **Slop-trap guardrails.** Hard ceiling on posts/day per sub-account by default? Operator override?
8. **Pricing / cost-pass-through model.** Operators pay vendors directly (Blotato, Arvo, KIE) — confirm; or do we offer a wrapped tier for simplicity?
9. **n8n posture.** Power-user escape hatch later — at what trigger does it get added?
10. **Repurpose source set for v1.** Blog URL, transcript, product photo set — what's the minimum viable source-type list?

---

## 11. One-line summary

Buffer / Blotato / Arvo are plumbing. The Synthetos product is **repurpose → approve → publish → measure → improve**, with a browser sandbox as the escape hatch for platforms the API economy has abandoned. We do not compete with the schedulers — we orchestrate them, we close the loop they can't close, and we expose the result as MCP.

---

## 12. References

- `tasks/brief-marketing-automation.md` — this brief.
- `docs/capabilities.md` — capabilities registry; integrations + skills get registered here on landing.
- `docs/frontend-design-principles.md` — five hard rules (default to hidden, one primary action per screen, inline state beats dashboards).
- `architecture.md` — three-tier agent model, skill system, integration credential vault, HITL.
- `DEVELOPMENT_GUIDELINES.md` — §8 development discipline (idempotency, deferred-enforcement logging, sort tiebreakers — all relevant to the feedback loop).

---

*End of brief. Next process: scope decisions on §10 open questions, then architect breakdown into chunks.*
