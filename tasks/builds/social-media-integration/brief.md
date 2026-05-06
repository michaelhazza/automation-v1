# Social media publishing — integration brief

Status: Draft, awaiting research input
Owner: Michael
Last updated: 2026-05-06
Build slug: `social-media-integration`
Linked research brief: [./research-questions.md](./research-questions.md)

## Contents

- [TL;DR](#tldr)
- [1. Codebase position (audit summary)](#1-codebase-position-audit-summary)
- [2. Options at a glance](#2-options-at-a-glance)
- [3. Ayrshare CEO summary](#3-ayrshare-ceo-summary)
- [4. SaaS abstraction model](#4-saas-abstraction-model)
- [5. Economics — wearing the cost, billing the customer](#5-economics--wearing-the-cost-billing-the-customer)
- [6. The reach question — API vs native posting](#6-the-reach-question--api-vs-native-posting)
- [7. Recommendation](#7-recommendation)
- [8. Open questions (in research brief)](#8-open-questions-in-research-brief)
- [9. Next steps](#9-next-steps)

## TL;DR

Synthetos already ships the agent, the four social-media skills, the human-in-the-loop approval queue, and the analytics surface. The actual posting to Twitter/X, LinkedIn, Instagram, Facebook returns `pending_integration`. Of the credible paths to fix this (OmniSocials, Ayrshare, self-hosted Postiz, direct platform APIs, browser automation), the recommendation is **Ayrshare in Phase 1, fully white-labelled behind Synthetos**. Customers connect their social accounts inside Synthetos, see a Synthetos-branded flow, and are billed as part of their Synthetos subscription. Ayrshare is invisible. Phase 2 (revisit at scale) considers migrating the highest-volume network to a direct platform partnership for unit-cost compression and reach optimisation.

Two open items block final commit and are scoped to the research brief: Ayrshare's current 2026 pricing/white-label terms, and current evidence on API vs native posting reach per platform.

## 1. Codebase position (audit summary)

Detail in prior audit. Headlines:
- Skills `draft_post`, `publish_post`, `read_analytics`, `configure_integration` are provider-agnostic by design and reference platforms (twitter, linkedin, ...) not vendors.
- HITL approval flow is wired end-to-end (`server/services/skillExecutor.ts:2364-2425`).
- Adapter pattern is mature (`server/adapters/`). Need to add a new `social` namespace on the `IntegrationAdapter` interface.
- Connector enums (`connectorConfigs.connectorType`, `integrationConnections.providerType`) need one new value.
- Zero partial work. Stub returns at `skillExecutor.ts:2776-2783` (publish) and `:858-876` (analytics) are the only places real provider calls slot in.

The architectural change is the same across vendors: one adapter file, one new namespace, two enum extensions, two stub returns replaced. **The decision is who to plug in.**

## 2. Options at a glance

| Option | Shape | Phase 1 fit | Why |
|---|---|---|---|
| OmniSocials | Claude-MCP product, end-user-in-Claude.ai | Reject | Wrong shape (MCP-in-user-chat, not server-to-server B2B). Too young. Strategic overlap with our Social Media Agent positioning. |
| Ayrshare | B2B aggregator REST API | **Recommended** | Correct shape. Compliance done. White-label. 10+ networks. Maps cleanly to our adapter. |
| Postiz (self-host) | Open-source product | Reject for Phase 1 | We inherit per-platform partner-program work. Operational weight. Wrong abstraction layer. |
| Direct platform APIs | DIY per network | Reject for Phase 1, Phase 2 candidate | 3-6 months partner-program work before first post. Ongoing per-platform engineering tax. Right answer at scale, not at MVP. |
| Browser automation | Headless browser posting through the human UI | Reject permanently | ToS violation on every platform. Account-ban risk. Brittle. Does not scale multi-tenant. Enterprise-procurement blocker. |

## 3. Ayrshare CEO summary

**What it is.** A US-based B2B SaaS company providing a single REST API for posting and analytics across the major social networks. It is developer infrastructure: no consumer UI of its own. Its customers are other SaaS products and agencies that want social publishing without integrating LinkedIn, Meta, X, TikTok, etc. directly. Founded ~2020, mature product.

**How it works.**
1. Customer signs up to Synthetos and goes to Settings → Connect Social Accounts.
2. Customer clicks "Connect LinkedIn". A Synthetos-branded OAuth flow opens (white-labelled). The customer logs in with their LinkedIn credentials.
3. The OAuth callback hits Ayrshare, which stores the LinkedIn token under a "user profile" associated with the Synthetos subaccount.
4. From this point on, Synthetos calls Ayrshare's API: "post this content to LinkedIn for profile X". Ayrshare handles the LinkedIn API call, rate-limiting, retries, and platform-specific quirks.
5. Analytics work the same way: profile ID + date range, normalised metrics shape returned.

**How Synthetos leverages it.** One `ayrshareAdapter.ts` in `server/adapters/`. Adds a `social` namespace with `publishPost` and `readAnalytics` methods. Skill layer, HITL queue, drafting agent, analytics agent, customer UI: all unchanged. They already work with provider-agnostic shapes.

The customer never sees the word "Ayrshare". They connect "their LinkedIn account to Synthetos", they publish "via Synthetos", they see analytics "in Synthetos". Ayrshare is plumbing the same way Stripe is plumbing for payments and SendGrid is plumbing for email.

## 4. SaaS abstraction model

**Core question (your phrasing): "are we leveraging it as a SaaS platform, abstracted behind the front-end so it just looks like Synthetos?"**

Yes. The model is:
- **Synthetos holds one Ayrshare commercial relationship.** Synthetos pays Ayrshare on a single account.
- **The customer connects social platforms directly to Synthetos** via Synthetos-branded OAuth. They do not have an Ayrshare account, do not see Ayrshare branding, and do not deal with Ayrshare billing.
- **Internally, each Synthetos subaccount maps to one Ayrshare "profile"** that holds the OAuth tokens for that subaccount's connected platforms.

This pattern is identical to: email (SendGrid hidden behind "we send emails for you"), payments (Stripe hidden behind "pay through us"), telephony (Twilio hidden), storage (S3 hidden).

Two requirements:
1. **Ayrshare must support white-label OAuth.** Customer sees "Synthetos wants access to your LinkedIn", not "Ayrshare wants access". Published Ayrshare feature on certain tiers; current tier and pricing flagged for research brief.
2. **Per-profile model maps cleanly to Synthetos subaccounts.** One subaccount → one Ayrshare profile holding all of that subaccount's platform connections. Adapter handles the mapping.

## 5. Economics — wearing the cost, billing the customer

**Ayrshare's pricing shape (placeholder ranges, current 2026 numbers in research brief):**
- Premium ~$149/mo: 1 profile, no white-label
- Business ~$499/mo: multiple profiles, basic white-label
- Enterprise: negotiated, full white-label, higher volume, SLA

100 paying Synthetos customers each with 1 publishing subaccount ≈ 100 Ayrshare profiles = enterprise-tier conversation.

**How we bill for it. Three viable models:**

1. **Bundled in existing Synthetos plan tiers (recommended for launch).** Cost absorbed into COGS. Customer sees value, no surprise bills. Requires modelling expected per-customer profile count and baking into pricing.
2. **Metered usage on top.** Per-post or per-profile-per-month on top of the base Synthetos subscription. Higher revenue ceiling, cost-aligned, but adds billing friction.
3. **Tiered feature gating.** Social publishing is in higher Synthetos tiers only (Pro+). Lower tiers see the agent and drafts but cannot publish without upgrading. Controls cost, creates an upsell.

**Recommendation: Tiered feature gating (model 3) for go-live.** Reason: controls exposure to runaway profile growth on cheap plans, gives sales an upgrade lever, invisible to customers on the right plan. Revisit metered if customer behaviour shows wide volume variance.

**Margin protection.** Per-subaccount monthly post caps in the plan ("Pro includes 100 posts/month per subaccount"). Beyond cap: soft-block with upsell prompt, or hard-bill on high tiers. Protects against a single power-user pushing Ayrshare cost into negative-margin territory.

**Phase 2 economics.** When per-profile Ayrshare cost exceeds the engineering and ongoing cost of a direct platform integration on our highest-volume network, migrate that network. The provider-agnostic skill layer makes this additive: same skill, route by platform, no UI change.

## 6. The reach question — API vs native posting

You're right to flag this. Honest summary:

**The claim.** Posts published via 3rd-party APIs (Buffer, Hootsuite, Ayrshare) are algorithmically suppressed vs posts made directly through the native app or web UI by a logged-in human.

**What's known (knowledge cutoff Jan 2026, current data flagged for research brief):**
- **LinkedIn.** Independent A/B tests 2019-2023 suggested 10-30% reach delta favouring native. LinkedIn has officially denied an algorithmic penalty. Buffer has published counter-data. Honest read: small effect possibly, not dispositive, algorithm changes frequently.
- **Twitter/X.** "Source: Buffer" attribution historically correlated with lower engagement in some user tests. Post-Musk-era changes have made this both more punitive and harder to verify.
- **Instagram.** API limitations are real and explicit (business/creator accounts only, Stories restrictions). Reach penalty less clearly demonstrated.
- **Facebook.** Organic Page reach is suppressed across the board regardless of source. API vs native is largely a non-issue.
- **TikTok.** Content Posting API is new (2023+). Anecdotally lower reach for partner-API posts; confounded with content and timing.

**Crucial point: Ayrshare does not sidestep this.** Ayrshare IS API-based, using the platform-sanctioned APIs. If there's a reach penalty for API posting, Ayrshare carries it. Only two ways to bypass it:
1. **Browser-automation posting** (rejected: ToS, scale, reputation).
2. **Direct platform APIs as a registered partner.** LinkedIn Marketing Developer Platform, Meta Business Partner, etc. On some platforms, official partner status grants elevated API treatment that may close the reach gap. This is the Phase 2 path.

**What this means for Phase 1.** A reach gap, if real, is a Phase 2 trigger to migrate the highest-value network to direct partner-API integration. It is not a Phase 1 reject reason for Ayrshare, because the Phase 1 alternative is "no publishing at all": direct integrations cannot ship in MVP timeframe.

**Mitigation in product.** Two things we can do regardless of vendor: (a) prompt the customer to engage natively with their first comment within 5 minutes of publish (a documented reach-warming tactic), surfaced as a notification in Synthetos; (b) post at platform-optimal times based on the connected account's analytics, not generic best-time-to-post heuristics.

## 7. Recommendation

**Phase 1 (now, ~1-2 weeks engineering):**
- Adopt Ayrshare.
- Build `server/adapters/ayrshareAdapter.ts`, add `social` namespace to `IntegrationAdapter`, extend connector enums, replace stub returns with adapter dispatch.
- Pricing: tiered feature gating (publishing in Pro+), per-subaccount monthly post caps.
- Branding: full white-label. Customer never sees Ayrshare.
- Platforms at launch: the four already in skill enums (LinkedIn, X, Instagram, Facebook). Others added as customer demand surfaces.

**Phase 2 (revisit at ≥50 active publishing subaccounts):**
- Measure per-network volume, Ayrshare cost as % of revenue, customer-reported reach concerns.
- Migrate the highest-volume network (likely LinkedIn) to a direct partner-API integration. Keep Ayrshare for the long tail.

**Reject:** OmniSocials (wrong shape, too young, strategic overlap), Postiz (compliance burden), browser-automation (ToS / scale / reputation), DIY-as-Phase-1 (timeline).

## 8. Open questions (in research brief)

1. Current Ayrshare pricing tiers, white-label minimum tier, enterprise pricing rough range (2026).
2. Ayrshare's partner-program credentials current state (LinkedIn, Meta, TikTok, X).
3. 2024-2026 evidence on API vs native reach delta per platform.
4. Aggregator alternatives we may have missed (Publer API, SocialBee API, Postiz Cloud, others).
5. What B2B agent platforms (Lindy, Cognosys, Manus, GHL) use for social posting, and whether any documented partnership patterns exist.

## 9. Next steps

1. Operator runs research brief (`./research-questions.md`).
2. Findings update §3, §5, §6 of this document.
3. `architect` agent decomposes into a build plan.
4. `feature-coordinator` orchestrates implementation.
