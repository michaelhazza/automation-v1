# Marketing Automation — Consolidated Feature Roadmap

**Date:** 2026-05-06
**Branch:** `claude/build-marketing-automation-9FwNf`
**Slug:** `marketing-automation`
**Type:** Strategic roadmap — aggregates four input documents into a single prioritised feature set with CEO-level benefit summaries.

This is the **canonical reference** for marketing-automation scope. Read this first; the input briefs below are reference detail.

---

## Contents

1. Inputs consolidated (what fed this roadmap)
2. Feature bucket inventory (the full list)
3. Pre-release roadmap (build now, before paying customers)
4. Post-revenue roadmap (build after paying customers, ordered)
5. Rationale for the order
6. Open questions for the operator

---

## 1. Inputs consolidated

This roadmap aggregates four documents on this branch:

| # | Doc | What it contributed |
|---|---|---|
| A | `growos-gap-analysis.md` (this dir) | Capability matrix of automation-v1 vs GrowOS-style product. Identified the substrate as shipped; named the marketing-domain gaps. |
| B | `growos-gap-analysis.md` §7 + KNOWLEDGE entries 2026-05-06 | Meta Ads MCP analysis. Identified the strategic shift to MCP-as-transport. Named A1 (HTTP/SSE transport) as the unblocker. |
| C | `inputs/brief-1-ayrshare-social-publishing.md` | Organic social posting via Ayrshare aggregator. Per-profile recurring cost. White-label model. The only credible Phase-1 path that ships in 1–2 weeks. |
| D | `inputs/brief-2-marketing-automation-synthesis.md` | Three durable moats (repurpose primitive, engagement feedback loop, browser-control sandbox). Skill decomposition. "Posting is commodity, recipe is the IP." |

**Two angles, one roadmap:**

- **Paid marketing** (run ad campaigns) — Meta Ads MCP is free during beta; future hosted MCPs (Google, LinkedIn) will follow the same pattern. Build once, integrate forever.
- **Organic marketing** (post / repurpose / measure) — Ayrshare is the unlock for *publishing*; the durable IP is repurpose + feedback loop + browser-sandbox. Ayrshare carries an ongoing per-profile cost and is therefore deferred until paying customers justify it.

**Operator's stated constraint:** *"Ayrshare last, because we want to come back to this when we've actually got paid customers — it's an actual expense."* That constraint shapes the entire pre-release vs post-revenue split below.

---

## 2. Feature bucket inventory

Every distinct capability surfaced across the four inputs, grouped into seven buckets. Status reflects what is shipped on `main` as of this date.

### Bucket 1 — MCP transport & governance (the substrate)

| ID | Feature | Status |
|---|---|---|
| F1.1 | HTTP/SSE MCP client transport | NOT BUILT (stdio-only) |
| F1.2 | MCP write-tool approval-gate wrapper | NOT BUILT |
| F1.3 | Per-tenant OAuth → MCP credential injection | PARTIAL (GHL pattern exists, generalise it) |
| F1.4 | MCP marketplace UI for sub-accounts | NOT BUILT |
| F1.5 | Synthetos-as-MCP-server (expose our skills externally) | NOT BUILT |

### Bucket 2 — Paid ads (Meta / Google / LinkedIn)

| ID | Feature | Status |
|---|---|---|
| F2.1 | Meta Ads MCP integration | NOT BUILT (blocked on F1.1; Meta MCP free during beta) |
| F2.2 | Google Ads MCP integration | NOT BUILT (no hosted MCP yet) |
| F2.3 | LinkedIn Ads MCP integration | NOT BUILT (no hosted MCP yet) |
| F2.4 | Agentic-commerce policies for ad spend | SHIPPED (PR #255 — bind to MCP write-call) |
| F2.5 | Direct Marketing API fallback adapters | NOT BUILT (only if hosted MCP fails) |

### Bucket 3 — Repurpose primitive (the marketing IP)

| ID | Feature | Status |
|---|---|---|
| F3.1 | `repurpose_artifact` skill — source → N platform-specific drafts | NOT BUILT |
| F3.2 | Brand context + voice profile reads (sub-account) | SHIPPED (F1 baseline-capture, PR #263 + F3 PR #265) |
| F3.3 | Adaptive voice profile capture from sample posts | NOT BUILT (extends F1 baseline) |
| F3.4 | Aspect-ratio + caption + hashtag generation per platform | NOT BUILT |
| F3.5 | Visual provenance rule (pull real, never auto-invent) | POLICY (skill design rule) |

### Bucket 4 — Engagement feedback loop (the durable moat)

| ID | Feature | Status |
|---|---|---|
| F4.1 | `engagement_tracker` skill — pull metrics, attribute to source + template | NOT BUILT |
| F4.2 | `template_evolver` skill — keep / kill / mutate by engagement | NOT BUILT |
| F4.3 | Operator-configurable engagement quality signal | NOT BUILT |
| F4.4 | Weekly digest (templates promoted / retired / mutated) | NOT BUILT |

### Bucket 5 — Browser-control sandbox (escape hatch)

| ID | Feature | Status |
|---|---|---|
| F5.1 | VM-isolated browser harness per sub-account / session | NOT BUILT |
| F5.2 | `browser_post` skill — LinkedIn carousels first, FB groups second | NOT BUILT |
| F5.3 | Account-ban-risk policy doc + operator acknowledgement gate | NOT BUILT |
| F5.4 | Pacing / rate-limit / fingerprint-hygiene primitives | NOT BUILT |

### Bucket 6 — SEO blogging

| ID | Feature | Status |
|---|---|---|
| F6.1 | `seo_gap_analysis` skill — keyword opportunity ranking | NOT BUILT |
| F6.2 | `blog_brief_generator` skill — opportunity → brief | NOT BUILT |
| F6.3 | `arvo_publish` skill (or alt) — brief → published blog URL | NOT BUILT (recurring vendor cost) |
| F6.4 | RSS feed read → caption generation handoff | NOT BUILT |

### Bucket 7 — Organic social publishing (Ayrshare and equivalents)

| ID | Feature | Status |
|---|---|---|
| F7.1 | Ayrshare adapter — `social` namespace on `IntegrationAdapter` | NOT BUILT (recurring vendor cost) |
| F7.2 | Replace `pending_integration` stub at `skillExecutor.ts:2776-2783` | NOT BUILT |
| F7.3 | White-label OAuth flow per sub-account | NOT BUILT |
| F7.4 | Per-subaccount monthly post caps (margin protection) | NOT BUILT |
| F7.5 | Tiered feature gating (publishing in Pro+) | NOT BUILT |
| F7.6 | Native-engagement-warming notification (5-min first-comment prompt) | NOT BUILT |
| F7.7 | Phase-2: direct platform partnership for highest-volume network | NOT BUILT (post-50-active-subaccount trigger) |

### Bucket 8 — Marketing playbook library

| ID | Feature | Status |
|---|---|---|
| F8.1 | `content_autopilot` playbook (full SEO + social loop) | NOT BUILT |
| F8.2 | `social_only` playbook | NOT BUILT |
| F8.3 | `repurpose_one_artifact` playbook | NOT BUILT |
| F8.4 | Weekly newsletter playbook | NOT BUILT |
| F8.5 | Meta ad campaign launch playbook | NOT BUILT |
| F8.6 | Landing page sprint playbook | NOT BUILT |
| F8.7 | Competitor weekly digest playbook (extends `generate_competitor_brief`) | NOT BUILT |
| F8.8 | Lead-magnet kit playbook | NOT BUILT |

---

## 3. Pre-release roadmap (build now, before paying customers)

These features either (a) carry no recurring third-party cost, or (b) build the durable moat that justifies the price tag once we have customers. Ordered by leverage — earlier items unblock later items.

### P1 — HTTP/SSE MCP transport (F1.1)

**CEO benefit.** Lets Synthetos talk to any modern SaaS that ships its own MCP — Meta, Stripe, GitHub, Linear, Notion, and the wave coming through 2026. Without this, every "we integrate with X" claim costs us 2–3 weeks of bespoke adapter work. With this, it costs hours.

**Effort:** 2–4 days. **Cost:** none (open-source SDK).

**Why first.** Unconditional unblocker. Every other pre-release item that touches a hosted service depends on it.

### P2 — MCP write-tool approval-gate wrapper (F1.2)

**CEO benefit.** Stops an agent from launching a $5k Meta ad campaign or sending an unreviewed newsletter without a human check. This is the single feature that turns "AI marketing automation" from a liability into a product an agency would pay for.

**Effort:** 3–5 days. **Cost:** none.

**Why next.** Ships in lockstep with P3. Shipping P3 without P2 is a brand-blowup risk we won't survive.

### P3 — Meta Ads MCP integration (F2.1, F2.4)

**CEO benefit.** "Run paid ads from inside Synthetos." Free during Meta's beta. Lets a customer say "spend $200/day on a Florida-targeted lead campaign for our new offer" and have the system do it under our governance — approvals, daily/monthly limits, kill switch. Replaces the $3–5k/month agency the GrowOS pitch cites.

**Effort:** 3–5 days (preset entry + per-tenant Facebook OAuth + bind to F2.4 agentic-commerce policies). **Cost:** none until Meta exits beta; customer's ad spend routes via existing agentic commerce.

**Why now.** Free integration cost + fully-formed substrate (agentic commerce + approval gates + audit ledger already shipped). The ROI dollar-for-dollar is the strongest of any item on the roadmap.

### P4 — Adaptive voice profile capture (F3.3)

**CEO benefit.** "The system learns to write like you." Operator pastes 10 sample posts; the system extracts tone, voice, vocabulary, do-not-say list, and stores it as tier-1 memory that prepends to every drafting prompt. Compounds with every later feature — newsletters, social drafts, ads, repurpose all draft in the operator's voice without re-training.

**Effort:** 1–2 weeks. **Cost:** our own LLM tokens; no recurring third-party cost.

**Why now.** Built on top of the F1 baseline-capture infrastructure shipped in PR #263 + F3 PR #265. The plumbing is there; this is the missing analyser. Every later feature is more valuable once this exists.

### P5 — Repurpose primitive (F3.1, F3.4)

**CEO benefit.** *"One asset, six channels, zero retyping."* Operator brings a blog post, a podcast transcript, or a product photo set; the system produces platform-specific captions and aspect-ratios for IG / X / LinkedIn / Facebook / etc. The "30+ workflows" GrowOS pitch is mostly this primitive applied differently.

**Effort:** 2–3 weeks. **Cost:** our own LLM tokens.

**Why now.** This is one of the three durable moats from Brief 2. Building it before publishing means the *output* is ready when publishing comes online — not the other way around.

### P6 — Marketing playbook library (F8.1, F8.2, F8.3, plus F8.4–F8.8 incrementally)

**CEO benefit.** Ten pre-built workflows the customer runs without configuration — weekly newsletter, daily social calendar, Meta ad campaign launch, landing page sprint, competitor weekly digest, lead-magnet kit, etc. Turns the platform from "you can build anything" into "click to launch your week's marketing."

**Effort:** 2–3 weeks authoring (markdown + playbook YAML, not code). **Cost:** none.

**Why now.** Once P1–P5 are in, this is documentation work. It's also the *visible product* — what a sales demo shows. Without it, we have a powerful platform with no obvious entry point.

### P7 — Browser-control sandbox (F5.1–F5.4) — *defer to post-revenue if scope bites*

**CEO benefit.** Lets us post to LinkedIn carousels and Facebook groups (no clean API exists for either). SaaS competitors cannot ship this safely; multi-tenant orchestrators with isolation primitives can.

**Effort:** 3–4 weeks (largest pre-release item). **Cost:** infrastructure only.

**Why this position.** It's a moat (Brief 2 named it as one of three), but it's also the riskiest item — account-ban risk, policy doc required, ToS-adjacent. Defensible position: include if scope allows; defer to post-revenue if not. Customers can ship without it.

### P8 — Competitor monitoring playbook + Synthetos-as-MCP-server (F8.7, F1.5) — *cheap parallel work*

**CEO benefit.** (a) Customers get an automatic "what your competitors did this week" digest. (b) External Claude Code / Cursor users can compose Synthetos skills into their own workflows, which seeds organic adoption.

**Effort:** ~1 week each. **Cost:** none.

**Why this position.** Cheap; can run in parallel with the harder items above. F8.7 wraps an already-shipped skill (`generate_competitor_brief`); F1.5 is the same MCP SDK that F1.1 introduces, just on the server side.

---

**Pre-release total:** ~9–11 engineer-weeks for P1–P6 + P8. P7 adds ~3–4 wk if included. The full pre-release scope is 12–15 weeks for a single experienced engineer.

**At the end of pre-release, the demo is:**
1. Operator pastes 10 sample posts → voice profile captured (P4).
2. Operator picks "weekly content cycle" playbook (P6).
3. System reads sub-account context (already shipped) + voice profile + competitor digest (P8).
4. Drafts week's content + ad campaign (P5 + P3 + P4).
5. Approval gate (P2) before any publish or spend.
6. Publish: ad campaign → live via Meta MCP (P3); social posts → *queued, awaiting publishing rail* (gates revenue trigger for P9 below).

That last step is the lever: the customer sees end-to-end value but cannot post organically until they upgrade to a paid tier that bundles publishing.

---

## 4. Post-revenue roadmap (build after paying customers, ordered)

These features carry recurring vendor cost or are higher-effort lower-leverage relative to the pre-release items. Ordered by what the first cohort of customers will most likely demand.

### P9 — Ayrshare integration for organic social publishing (F7.1–F7.6)

**CEO benefit.** *"Click approve, your post is live on LinkedIn / X / Instagram / Facebook."* Closes the loop on the pre-release demo. Until this lands, the platform drafts and schedules but cannot push to a network — which is fine for selling on the recipe and the moat, not fine for retention past month two.

**Effort:** 1–2 weeks engineering (per Brief 1 §1, all the platform plumbing already exists; just an adapter + enum extension + stub replacement). **Cost:** Ayrshare Business tier (~$499/mo) → Enterprise once we cross 100 active publishing sub-accounts. Margin-protected by per-sub-account monthly post caps and tiered feature gating (publishing in Pro+).

**Why this position.** The operator's explicit constraint puts this here. Defensible: the recurring cost only makes sense once we have revenue running through plans that include it.

**Activation trigger:** first paying customer who asks for organic publishing. Earlier than that, every $499 we spend is unrecouped.

### P10 — Engagement feedback loop (F4.1–F4.4)

**CEO benefit.** *"The system gets better the more you use it."* Templates that drive saves, shares, and conversions get promoted; templates that don't get retired. Almost no shipped product does this end-to-end. It's the second of the three durable moats.

**Effort:** 3–4 weeks. **Cost:** our own LLM tokens for analysis; no recurring vendor cost.

**Why this position.** Needs publishing live (P9) to source the engagement data. Without P9, there's nothing to measure. Wired in immediately after P9 to compound retention.

### P11 — SEO blogging integration (F6.1–F6.4)

**CEO benefit.** *"Rank for the keywords your competitors miss."* Closes the SEO half of the GrowOS recipe. Customers who care about long-form / blog distribution get the full loop: gap analysis → brief → published blog → social repurpose.

**Effort:** 2–3 weeks engineering. **Cost:** Arvo or alternative (~$50–200/mo per sub-account, vendor TBD). Same tiered gating model as P9.

**Why this position.** Lower-priority for many marketing customers than social; explicit cost (Arvo subscription) makes it wait its turn behind P9.

### P12 — Browser-control sandbox (F5.1–F5.4) — *if deferred from pre-release*

**CEO benefit.** *"Post to LinkedIn carousels and Facebook groups without an API."* Closes the gap that aggregators (including Ayrshare) cannot close. The third durable moat from Brief 2.

**Effort:** 3–4 weeks engineering + policy doc. **Cost:** infrastructure only.

**Why this position.** Optional; only build if customers ask for LinkedIn carousels or FB groups specifically. If pre-release scope was tight enough that P7 was deferred, this is where it lands.

### P13 — Direct platform partnership for highest-volume network (F2.5, F7.7)

**CEO benefit.** *"Reach parity with native posting + unit-cost compression at scale."* Migrates whichever network costs us the most through Ayrshare (likely LinkedIn) onto a direct partner-API integration. Keeps Ayrshare for the long tail. Per Brief 1 §7, trigger is ≥50 active publishing sub-accounts.

**Effort:** 6–12 weeks (LinkedIn Marketing Developer Platform partner application + integration). **Cost:** application time + ongoing engineering tax per platform.

**Why this position.** Only justified by volume. A direct partnership for one network is right at scale, wrong at MVP. Defer until we can name the network and justify the unit-cost compression.

### P14 — Google Ads / LinkedIn Ads MCP integrations (F2.2, F2.3)

**CEO benefit.** *"All major ad platforms, one approval queue."* As Google and LinkedIn ship hosted MCPs (expected 2026), wire them in the same way as Meta (P3). Customer can run multi-platform ad campaigns under one governance layer.

**Effort:** Hours per platform once their hosted MCP exists; days if we have to build direct adapters. **Cost:** none until they exit beta.

**Why this position.** Reactive — landing depends on the platforms shipping the MCPs. Until they do, our differentiation against competitors who only hand-coded Meta is "we'll integrate the day Google ships theirs." Don't pre-build direct adapters speculatively.

### P15 — Video editing / carousels / YouTube thumbnails (deferred indefinitely)

**CEO benefit.** *"AI edits your reel."* Hardest single category in the GrowOS demo. ffmpeg pipeline or partner API (Mux, Tavus). Largest single line item.

**Effort:** 4–6 weeks for an MVP. **Cost:** partner API ($200–500/mo per sub-account at moderate volume) or ffmpeg infrastructure.

**Why this position.** Strong recommendation: defer entirely until customers ask for it. The GrowOS demo videos are doing a lot of visual lifting; revealed customer demand for "AI edits my reel" inside our own audience is unproven. Build only if 3+ paying customers request it.

### P16 — Mailgun / Twilio / SMS adapters

**CEO benefit.** *"Email and SMS delivered, not just drafted."* Today email is Gmail-only; no SMS at all.

**Effort:** 1–2 weeks per platform. **Cost:** per-message metered (cheap at low volume, scales with usage).

**Why this position.** Lowest-leverage item. Existing customers who already have email/SMS infra route through it; only matters if a customer cohort genuinely wants Synthetos to own deliverability.

---

**Post-revenue total:** ~6–10 engineer-weeks for P9 + P10 (the "core retention" pair). Everything beyond is demand-driven, not roadmap-driven.

---

## 5. Rationale for the order

Three principles drove the ordering:

**1. No recurring third-party cost before paying customers.** The operator's explicit constraint. Ayrshare ($499–enterprise/mo), Arvo ($50–200/mo per sub-account), partner APIs for video editing — all post-revenue. Meta MCP is free during beta and the customer's ad spend routes through agentic commerce, so the platform itself has no marginal cost on it.

**2. Substrate before surface.** P1 (HTTP/SSE transport) and P2 (approval-gate wrapper) are unsexy plumbing, but they unblock everything else. Skipping them means re-doing them later when the cost of change is higher. The substrate work is also the moat — anyone can connect Meta MCP to Claude Desktop themselves; only we wrap it in approvals + budgets + multi-tenant + audit.

**3. Drafting before publishing.** Voice profile (P4), repurpose primitive (P5), and playbook library (P6) all produce *drafts*. Publishing rails (P9 Ayrshare) come after. This is deliberate — it lets us run a credible end-to-end demo using Meta Ads (P3, free) for the paid side while keeping organic publishing as the upgrade lever to a paid plan.

**The shape of the strategy.** Pre-release builds the moat-bearing capabilities (governance, repurpose, voice, feedback-ready data shapes) and one revenue-generating integration (Meta Ads). Post-revenue layers on the recurring-cost capabilities only when revenue justifies the spend. Engagement feedback loop (P10) lands immediately after Ayrshare to compound retention from the moment posting goes live.

**What this is NOT.** It is not a Phase-1-then-Phase-2 split where everything in Phase 2 is "later." Pre-release is a hard gate; post-revenue is a queue ordered by demand signal, not time. P11 (SEO) might never ship if no customer asks. P15 (video) probably won't ship at all unless a specific cohort makes noise.

---

## 6. Open questions for the operator

These need decisions before P1 begins. Some override priorities above; flag if any are decisive.

1. **What constitutes "paying customer" trigger for P9 (Ayrshare)?** Is it 1, 5, 10, or 25 active paying sub-accounts? The trigger determines when we accept the recurring vendor cost and which Ayrshare tier we sign for ($149 / $499 / enterprise).
2. **Pricing model for organic publishing.** Brief 1 recommended tiered feature gating (publishing in Pro+) over bundled or metered. Confirm or counter.
3. **Browser-control sandbox (P7) — pre-release or post-revenue?** Strong moat; large effort; ToS-adjacent. The roadmap above treats it as "include if scope allows; otherwise P12." Operator call.
4. **Adaptive voice profile (P4) — minimum-viable input.** 10 sample posts, or do we need to ingest a full content history (sitemap crawl, Drive folder, etc.)? Smaller input = faster ship; larger input = better signal.
5. **Marketing playbook authoring (P6) — who writes them?** Engineer time, content marketer, or operator personally? They're the visible product; voice and tone matter.
6. **Default spending policy for marketing agents (Meta Ads via P3).** Per-tx, daily, monthly limits — what numbers? Agentic commerce enforces; the values are a product decision.
7. **Synthetos branding decision for the marketing surface.** Brief 2 references "Synthetos" repeatedly. Confirm this is the customer-facing brand for marketing-automation specifically (vs automation-v1 / GrowOS-equivalent / etc.).
8. **Phase-2 partnership target (P13).** When we hit the volume trigger, which network do we apply to first — LinkedIn Marketing Developer Platform, or Meta Business Partner? Affects 6-month-out posture.
9. **The "Ayrshare last" position — confirm against this risk.** Without P9 from day one of public launch, the demo is "drafts and ad campaigns, but you can't actually post." Some operators will bounce. Acceptable trade-off, or revisit?
10. **Repurpose primitive (P5) — initial source-type list.** Brief 2 §10 names blog URL / transcript / product photo set as the v1 set. Confirm or extend.

---

## Suggested next step for a fresh session

1. Read this roadmap end-to-end.
2. Walk Open Questions §6 with the operator. Items 1, 3, 9 are decisive; the rest can be answered alongside spec authoring.
3. Once §6 is resolved, run `spec-coordinator` against this roadmap (slug: `marketing-automation`). The pre-release scope (P1–P6 + P8) is one cohesive build; spec-coordinator should treat the rest as deferred.
4. P1 (HTTP/SSE transport) is unconditional — start there even if §6 is unresolved on lower-priority items.

---

## Related artefacts (read order)

1. `tasks/builds/marketing-automation/consolidated-roadmap.md` — this doc, the canonical reference.
2. `tasks/builds/marketing-automation/dev-brief.md` — earlier handoff brief; superseded by this roadmap but useful for context.
3. `tasks/builds/marketing-automation/growos-gap-analysis.md` — capability matrix + Meta MCP §7 addendum.
4. `tasks/builds/marketing-automation/inputs/brief-1-ayrshare-social-publishing.md` — Brief 1 source (organic publishing).
5. `tasks/builds/marketing-automation/inputs/brief-2-marketing-automation-synthesis.md` — Brief 2 source (broader marketing automation synthesis).
6. `KNOWLEDGE.md` — entries dated 2026-05-06 (MCP runtime stdio-only, integration-moat shift).
7. `architecture.md`, `docs/capabilities.md` — re-read MCP, skill system, agentic commerce, sub-account tier sections.
8. `server/services/mcpClientManager.ts:579`, `server/config/mcpPresets.ts` — current MCP runtime + preset registry.

---

*End of roadmap.*
