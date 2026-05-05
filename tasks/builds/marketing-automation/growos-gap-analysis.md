# GrowOS-style Marketing Automation — Gap Analysis

**Date:** 2026-05-05
**Branch:** `claude/build-marketing-automation-9FwNf`
**Source:** Discussion comparing GrowOS marketing-automation product (newsletters, social, FB ads, landing pages, video editing, carousels, YouTube thumbnails, competitor research, voice profile, scheduled publishing) against current automation-v1 capabilities, post-merge of `origin/main`.

This doc captures: what is built, what is partial, what is not built. Effort estimates assume the existing substrate (workflows engine, agentic commerce, multi-tenant model, approval gates, memory) is reused.

---

## Contents

1. Executive summary
2. Capability matrix
3. What landed since the prior survey
4. What is left to build for a GrowOS clone
5. Strategic options
6. Open questions for the operator

---

## 1. Executive summary

automation-v1 is a substantially stronger substrate for a GrowOS-style product than at the time of the prior survey. The Workflows V1 engine (PRs #258, #262), agentic commerce (PR #255), GHL Module C OAuth (PR #254), F1 sub-account baseline artefacts (PR #263), and pre-launch hardening (PR #261) have all landed.

Net position: the **operational substrate is shipped**. The marketing-domain layer — live ad platform writes, video composition, carousels, YouTube thumbnails, adaptive voice learning, scheduled competitor monitoring — is not.

A GrowOS clone is now a **3–5 month build of marketing-domain features on top of the existing engine**, rather than a full platform build.

---

## 2. Capability matrix

| Capability | Status | Where it lives / what's missing |
|---|---|---|
| Workflow engine | SHIPPED | `server/services/workflowOrchestrator.ts`, `client/src/pages/WorkflowStudioPage.tsx`. Phase 1 + Phase 2 (Open Task View, real-time WebSocket, Ask/Approval runtime, four A's, version pinning, cost ceilings). |
| Scheduling / publish control | SHIPPED | `config_create_scheduled_task`, `config_set_link_schedule`. ISO cron + timezone. Portfolio calendar in Pulse. Webhook triggers deferred to V2. |
| Multi-tenant / sub-account baseline | SHIPPED | Three-tier hierarchy (System → Org → Subaccount) with FORCE RLS. F1 baseline artefacts (PR #263) add reserved-slug artefacts + tier-1 pinned memory blocks. F3 baseline-capture in PLANNING. |
| Approval gates / HITL | SHIPPED | 42+ review-gated skills. `approve_with_edits` on Approval step type. Rejection-as-training signal. pg-boss routing. |
| Persistent memory / lessons | SHIPPED | `memory_blocks` with tier-1 (pinned) + tier-2 (domain-matched). Workspace memory at org/subaccount/agent levels. Memory dedup job. RLS enforced. Citation tracking. |
| Agent autonomy / spending | SHIPPED | Agentic commerce (PR #255). Stripe SPT charge router, per-tx/daily/monthly limits, shadow mode, HITL threshold, three-level kill switch, `agent_charges` ledger, 6 payment skills. |
| Email drafting | SHIPPED | `draft_content` (email_newsletter), `draft_sequence`, `draft_followup`, `classify_email`. |
| Email sending | SHIPPED | Gmail OAuth. `send_email` skill. SendGrid + SMTP fallback. |
| Social drafting | SHIPPED | `draft_post`, `draft_content`, `draft_ad_copy`. Twitter, LinkedIn, Instagram, Facebook variants. |
| Social publishing | PARTIAL | `publish_post` skill exists, approval-gated. Platform API write flows are stubbed — on approval logs `pending_integration` status. Live posting not wired. |
| Landing pages | SHIPPED | `create_page`, `update_page`, `publish_page`. Forms, version history, draft-to-published with approval. `server/routes/pages.ts`, `server/services/pageService.ts`. |
| Competitor research (ad-hoc) | SHIPPED | `generate_competitor_brief` skill. URL list + analysis type → structured intelligence (pricing, positioning, gaps). |
| Brand voice (manual) | PARTIAL | Brand voice + tone accepted as input on `draft_content`, `draft_post`, `draft_ad_copy`. Stored in F1 tier-1 memory. No adaptive learning — no "extract voice from N sample posts." |
| GHL CRM | SHIPPED | Contact / opportunity / conversation / revenue read-write, funnels, calendars, webhooks. Module C agency-level OAuth (PR #254) with two-tier tokens. |
| Slack | SHIPPED | Bidirectional, HITL buttons, @mentions, DMs. |
| Facebook / Meta ads | PARTIAL | `draft_ad_copy` supports `meta_ads` (social_feed_ad, display_ad). `update_bid` and `update_copy` review-gated. Adapter stubs only — no live API writes. |
| LinkedIn ads | PARTIAL | `draft_ad_copy` supports `linkedin_ads` (sponsored_content). Adapter stubs. |
| Google ads | PARTIAL | `draft_ad_copy` supports `google_ads` (responsive_search_ad, display_ad). Adapter stubs. Live reads + write stubs. |
| Video editing | NOT BUILT | `transcribe_audio` exists. No composition, cuts, transitions, subtitles burn-in, B-roll, animations. |
| Carousels | NOT BUILT | No multi-image-sequence skill. `draft_ad_copy` accepts media_urls but no layout / caption-per-image / sequencing. |
| YouTube thumbnails | NOT BUILT | No thumbnail generation, A/B testing, or YouTube-specific publishing. |
| YouTube publishing | NOT BUILT | No script-to-publish package (description, chapters, end cards). |
| TikTok / Reels native publishing | NOT BUILT | `publish_post` does static post variants only. No Reels-format adapter, no TikTok OAuth. |
| Scheduled competitor monitoring | PARTIAL | Ad-hoc brief works. No scheduled URL-change detection, no delta alerts, no monitoring playbook template. |
| Mailgun / Twilio / SMS | NOT BUILT | Email today is Gmail-only. No SMS sending. |

---

## 3. What landed since the prior survey

Concretely shipped on `main` between the prior analysis and this doc:

- **Workflows V1 Phase 2** (PR #258) — full operator surface. `server/services/workflowOrchestrator.ts`, `client/src/pages/WorkflowStudioPage.tsx`. Open Task View (Now / Plan / Files), real-time WebSocket coordination, Ask form runtime with four-way submitter routing, Approval audit + confidence chip + `isCritical` routing, Studio canvas with four A's inspectors, version pinning on schedules, milestone-shaped activity chat.
- **Agentic Commerce** (PR #255) — `server/services/chargeRouter.ts`, `server/db/schema/agentCharges.ts`, migrations 0270–0276. Six payment skills (`pay_invoice`, `subscribe_to_service`, `top_up_balance`, `process_bill`, `issue_refund`, `update_financial_record`). Policy enforcement, shadow mode, HITL threshold, three-level kill switch, charge state machine.
- **GHL Module C agency OAuth** (PR #254) — agency-scoped tokens + per-location caching. Migration 0269 `connector_location_tokens` (FORCE RLS). Webhook lifecycle dispatcher with HMAC + ordering invariant.
- **F1 sub-account baseline artefacts** (PR #263) — `memory_blocks` extended with `tier` and `applies_to_domains`. Migration 0277. `subaccounts.baseline_artefacts_status` versioned JSONB. Capture at onboarding via `baseline-artefacts-capture` workflow.
- **Sub-account Optimiser Stream 2** (PR #262) — `server/services/runOptimiserScan.ts` + 8 query modules + 8 evaluators. Dedicated `optimiser-scan` pg-boss queue. Peer-medians materialized view. Backfill script.
- **Framework Standalone Phase A** (PR #257) — `setup/portable/sync.js` (~1413 lines, 113 tests). Portable sync engine.
- **Pre-launch hardening Phase 1** (PR #261) — 24 of 25 P0 items. OAuth state nonces, DB rate limiter, webhook HMAC boot assert, postMessage origin allowlist, multer 25MB cap, GUC propagation, auto-start onboarding, `task_events` (FORCE RLS), OptimisticLockError, `MAX_WORKFLOW_RUN_DEPTH=10`, soft-delete sweep.

---

## 4. What is left to build for a GrowOS clone

Effort is rough engineer-weeks assuming one experienced engineer plus reviews. Sequencing assumes the existing substrate is reused.

### Tier 1 — high-leverage, unblocks the marketing-team pitch

1. **Live Meta Ads write integration** — medium (2–3 wk). OAuth + token refresh, ad-account selection, campaign/ad-set/ad CRUD, creative upload, bid + copy update via existing review-gated skills. Wire `pending_integration` stub to live calls.
2. **Live Google Ads write integration** — medium (2–3 wk). OAuth, MCC support, responsive search ad + display ad CRUD, keyword + bid management.
3. **Live LinkedIn Ads write integration** — medium (2–3 wk). OAuth, sponsored content CRUD.
4. **Live social posting (Twitter/X, LinkedIn, Instagram, Facebook)** — medium (2–3 wk total). Replace `pending_integration` stub in `publish_post` with live API calls per platform. OAuth per platform. Media upload paths.
5. **Adaptive voice profile** — medium (2–3 wk). "Analyze N sample posts → extract tone/style signature → store in tier-1 memory → prepend to drafting prompts." Hook into existing `memory_blocks` + workflow trigger.
6. **Scheduled competitor monitoring** — small (1 wk). Wrap `generate_competitor_brief` in a scheduled playbook template. Delta detection on prior brief. Alert via existing email/Slack.

### Tier 2 — visual/video, the GrowOS surprise factor

7. **Carousel / multi-image sequence generation** — medium (2–3 wk). New skill that composes a multi-slide carousel from a draft outline + brand-style preset. Per-slide caption, layout templates, preview surface. ffmpeg/sharp server-side or partner API.
8. **YouTube thumbnail generation + A/B variant set** — small/medium (1–2 wk). Skill that generates N thumbnail variants from title + style preset. Likely sharp/canvas server-side, or partner API.
9. **Video editing skill (clips, cuts, subtitles, B-roll, animations)** — large (4–6 wk). Hardest item. ffmpeg-based composition pipeline, subtitle burn-in (`transcribe_audio` already exists for source), template-driven cut sequences, B-roll insertion. Partner API (Mux, Tavus) plausibly faster.
10. **YouTube publishing package** — small (1 wk). Description, chapters from transcript, end cards. YouTube Data API write.
11. **TikTok + Instagram Reels publishing** — medium (2 wk). OAuth per platform, Reels-format adapter, native upload.

### Tier 3 — broader marketing surface

12. **Mailgun adapter (email deliverability)** — small (1–2 wk).
13. **Twilio SMS** — small (1–2 wk).
14. **Pre-built marketing playbook library (30+ templates)** — medium (3–4 wk authoring time, parallel with infra above). Examples: weekly newsletter, daily social calendar, Meta ad campaign launch, landing page sprint, competitor weekly digest, lead-magnet kit.
15. **Reporting Agent month-over-month delta** — medium (1–2 wk after F3). Once F3 baseline-capture lands immutable metric snapshots, build narrative delta reports.
16. **Admin reset + manual baseline entry UI for unsupported integrations** — small (1 wk). Part of F3 follow-up.

### Total order-of-magnitude

- Tier 1 only (sufficient for a credible offering for text/social/ads businesses): ~12–15 engineer-weeks.
- Tier 1 + Tier 2 (full GrowOS parity including video/carousel/YouTube): ~22–28 engineer-weeks.
- Tier 1 + Tier 2 + Tier 3 (full surface + 30+ playbook templates): ~30–35 engineer-weeks.

---

## 5. Strategic options

Two product framings are viable on the existing substrate:

**Option A — GrowOS-as-app (multi-tenant SaaS).** Sell hosted accounts to small businesses or solo operators. Use the existing org/subaccount tiers as account/brand. Stronger fit for agencies, weaker fit for the "runs on my laptop" GrowOS narrative. Requires Tier 1 minimum.

**Option B — GrowOS-as-skillpack (template bundle).** Ship the marketing playbook library + voice-profile capture as a tenant template. No new platform code. Sells into existing automation-v1 customers. Requires only Tier 1 item 5 (voice profile) + item 14 (playbooks). Smallest path to ship.

The substrate makes both viable. The bottleneck is marketing-domain features, not platform capability.

---

## 6. Open questions for the operator

1. Which option (A — SaaS, B — skillpack, or both) is the framing?
2. Is video editing / carousel generation in scope, or deferred? It is the largest single line item.
3. Are live ad platform writes a launch requirement, or can stubs ship with "preview your ad, copy to Ads Manager"?
4. Should the 30+ playbook library be authored in-house or crowdsourced from existing customers?
