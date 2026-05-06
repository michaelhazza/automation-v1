# Research brief — social media publishing integration

Companion to: [./brief.md](./brief.md)
Owner: Michael (research) → Claude (synthesis on return)
Created: 2026-05-06

## Purpose

The integration brief recommends Ayrshare as the Phase 1 social media publishing backbone for Synthetos, with full white-label so the customer sees only Synthetos. Several inputs are flagged for research before final commit:

1. Current Ayrshare commercial terms (pricing, white-label, partner status).
2. Current evidence on API vs native posting reach per platform.
3. Whether we missed a credible alternative.
4. What comparable B2B agent platforms do.

This brief lists the questions to take to research (Claude with web access, ChatGPT Deep Research, vendor sales, or direct vendor docs) and the format the answers should come back in.

## Section A — Ayrshare specifics

A1. **Pricing tiers as of 2026.** What are the current published tiers? Per tier: monthly cost, included profiles, included post volume, white-label option (yes/no), API rate limits, SLA terms.

A2. **White-label model.** Which tier is the minimum for white-label OAuth (customer sees "Synthetos wants access" not "Ayrshare wants access")? Are there per-platform exceptions where white-label is not possible (e.g. Meta sometimes blocks white-label OAuth)?

A3. **Multi-tenant structure.** How does the "user profile" abstraction work? Is one profile = one human, one subaccount, or one platform-account? What is the per-profile cost beyond the included tier amount? Bulk discounts at 100 / 500 / 1000 profiles?

A4. **Partner-program credentials.** Is Ayrshare a registered LinkedIn Marketing Developer Platform partner? Meta Business Partner? TikTok Content Posting partner? X (Twitter) Enterprise API partner? Find official partner directories or Ayrshare's public claims.

A5. **API capability matrix.** For each platform (X, LinkedIn personal, LinkedIn company, IG, FB, TikTok, YouTube, Pinterest, Bluesky, Reddit, Google Business, Threads if supported), what publishing actions are supported (post, reply, story, reel, video, carousel, schedule, edit, delete) and what analytics are available (impressions, reach, engagement, demographics, link clicks, follower delta, top posts)?

A6. **Reliability and reputation.** Recent customer reviews, G2 / Capterra ratings, status-page incident history (last 12 months), reported outages, support responsiveness. Any signs of vendor distress?

A7. **Contract terms.** Is enterprise tier monthly or annual commit? Termination clauses? Data export on offboarding (can we get customer OAuth tokens out if we leave)?

## Section B — API vs native reach

B1. **2024-2026 published evidence.** Find the most recent A/B tests, vendor counter-claims, and platform official statements for each of LinkedIn, X, Instagram, Facebook, TikTok. Prefer studies with sample sizes >100 posts and matched timing.

B2. **Buffer / Hootsuite / Ayrshare position.** What do the major aggregators publicly say about reach impact? Have any released benchmarks?

B3. **Platform official statements.** Does any platform have a dated official statement on API-vs-native reach? Especially LinkedIn, which has been most vocal denying a penalty.

B4. **Partner-API treatment.** Is there evidence that posts via official partner APIs (LinkedIn Marketing Developer Platform, Meta Business Partner) are treated differently from generic third-party API posts? E.g. does partner-API posting suppress the "Source: X" attribution that historically correlated with reduced engagement?

B5. **Mitigation patterns.** What do experienced social-marketing teams do to close the gap? E.g. "post via API, then engage natively with the first comment in the first 5 minutes" — is this a documented practice with measured effect?

## Section C — Alternative aggregators

C1. **Publer API.** Pricing, multi-tenant model, white-label support, partner credentials, comparison to Ayrshare.

C2. **SocialBee API.** Same questions.

C3. **Postiz Cloud.** Hosted version of the OSS product. Pricing, multi-tenant, white-label.

C4. **Phyllo, Phantombuster, Hookle, Sprinklr API, Sprout Social API.** Are any a credible direct competitor to Ayrshare we missed?

C5. **Anything new in 2025-2026.** New entrants, AI-native social posting APIs, anything launched in the last 12 months that's gaining traction.

## Section D — Competitor benchmarks

D1. **Lindy, Cognosys, Manus, Hyperwrite, Salesforce Agentforce.** Which support social media publishing? What backend do they use? Any partnership announcements with Ayrshare, Buffer, etc.?

D2. **GoHighLevel.** GHL has social posting built in. What's their backend? Relevant since Synthetos already integrates with their CRM.

D3. **Zapier / Make.com / n8n.** What's the prevailing pattern for social posting in workflow-automation tools? Direct platform integrations, aggregator pass-through, or hybrid? Does the prevailing pattern suggest a different architectural approach for Synthetos?

## Output format expected

For each numbered question, return:

- **Answer** (3-5 sentences max)
- **Source** (URL or "vendor sales call" or "direct doc reading")
- **Confidence** (high / medium / low) and why if not high
- **Decision impact** — one of: confirms recommendation / adjusts pricing model / adjusts platform priority / triggers re-evaluation / no impact

## On return

Bring this completed back to the main session. Claude updates §3, §5, §6 of `brief.md` with findings. If Section D surfaces a credible alternative pattern (e.g. everyone in the agent-platform space uses provider X), Claude re-runs the options evaluation with that input before the final architect handoff.
