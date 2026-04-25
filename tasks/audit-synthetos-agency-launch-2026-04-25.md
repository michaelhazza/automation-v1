# Synthetos Agency Launch — Codebase Audit & Recommendations

**Date:** 2026-04-25
**Branch:** `claude/codebase-audit-recommendations-IUSxg`
**Inputs:** Synthetos Agency Services Business Plan v2.0 + Operator-as-Agency Development Brief v1.0
**Codebase HEAD:** `032b89d` (migration ceiling 0226)

---

## Contents

1. TL;DR
2. Capability inventory (READY / PARTIAL / MISSING)
3. Stale references in the dev brief — rebase mapping
4. Recommendations — the next 4 weeks
5. Recommendations beyond the dev brief
6. Risks the audit surfaced
7. Concrete first commit
8. What each workstream gap means — plain English
9. Fix-and-benefit summary
10. Does this close the loop on the business plan?

---

## 1. TL;DR

Strong fundamentals — the platform can deliver the **first 1–3 paid audits manually today** without any of the dev brief's automation work. Workstreams A, B, C, D, E in the brief are about **scaling** the agency from 0 to 8 clients; they are not blockers for launching.

Critical caveat: **the dev brief is built on a stale snapshot** (migration 0189). The codebase has since:

- renamed `playbooks` → `workflows` (PR #186)
- renamed `playbook_runs` → `workflow_runs`, plus a new separate `flow_runs` table exists
- renamed `processes` → `automations`
- moved `server/lib/playbook/` → `server/lib/workflow/`
- shipped 37 additional migrations (0189 → 0226)

The brief must be rebased before implementation. All `playbookRunService`, `playbook_runs`, `playbookEngineService` references are stale.

---

## 2. Capability inventory

### READY (use today)

| Capability | Evidence |
|---|---|
| GEO audit skills (9 total: `audit_geo`, `geo_citability`, `geo_compare`, `geo_brand_authority`, `geo_schema`, `geo_llmstxt`, `geo_platform_optimizer`, `geo_crawlers`, `draft_post`) | `server/skills/*.md` + `skillExecutor.ts:821–1214` + `actionRegistry.ts:2028–2049` |
| Composite GEO scoring + persistence | `geoAuditService.ts` + `geoAudits` table — 6-dimension weighted scoring |
| HITL gate architecture | `actionService.ts:572–613` multi-source resolution; `policyEngineService.ts` rule matching; `CONFIDENCE_GATE_THRESHOLD = 0.7` at `limits.ts:572` |
| Approval UX | `ApprovalCard.tsx`, `ReviewQueuePage.tsx` (bulk approve, inline-edit-and-approve, agent reasoning expansion) |
| `publish_post` action review-gated by default | `actionRegistry.ts:2366` (twitter / linkedin / instagram / facebook only) |
| Multi-tenant subaccount + portal | `subaccounts.ts` schema, `PortalPage.tsx`, RLS via `0168_p3b_canonical_rls.sql` |
| canonical_contacts + RLS + dictionary registry | `canonicalEntities.ts:12–47`, `canonicalDictionaryRegistry.ts:54–85` |
| Scheduled tasks + agent-inbox | `scheduledTasks.ts`, `agentInbox.ts` |
| send_email + draft_sequence skills | `actionRegistry.ts:273–299`, `server/skills/draft_sequence.md` |
| classify_email skill (support-focused) | `server/skills/classify_email.md`, registered at `actionRegistry.ts:2026` |
| GHL CRM adapter — comprehensive | `ghlAdapter.ts` (626 lines), `ghlReadHelpers.ts`, `ghlWebhook.ts` |

### PARTIAL

| Item | Gap |
|---|---|
| `connector_configs` exists, **`integration_configs` does not** (different semantics — connector_configs is org-level, narrower scope) | Workstream A core blocker |
| `crmLiveDataService` 100% GHL-hardwired | Imports only `ghlReadHelpers`; no adapter abstraction |
| `clientPulseIngestionService.connectorType: 'ghl'` (narrow literal at line 62) | Not a union type |
| `executionLayerService.ts:193–233` routes by `actionCategory` + provider in payload | Not by per-subaccount CRM type |
| `emailService.ts:228–273` hardcoded to `env.EMAIL_FROM` for all 3 providers | No per-org/per-subaccount from-address resolution |
| `draft_sequence` skill exists | No execution loop (no pg-boss job to dispatch chained sends with delays) |
| `reportService.ts` stores HTML reports | No PDF, no templating, no "AI Answer Coverage Review" branding |
| llms.txt | Analysis only — no generation/hosting |
| GBP "Autopilot" | `publish_post` action exists but `google_business_profile` is NOT in the platform enum |
| `integration_connections` supports gmail OAuth2 | No outlook; XOAUTH2 IMAP polling glue does not exist |
| Recurring GEO audits | No pg-boss schedule wired — manual trigger only |

### MISSING (full Workstream gaps)

**Workstream A — CRM adapter polymorphism:** `integration_configs` table; `nativeCrmAdapter`; `resolveCrmAdapter(orgId, subaccountId)`; subaccount `crm_type`/`primary_crm` selection.

**Workstream B — Prospect lifecycle:** `canonical_prospect_profiles` extension table (no `lead_score`, `outreach_stage`, `conversion_status` anywhere); `findContactByEmail(orgId, email)` in `canonicalDataService`; index on `canonical_contacts(organisation_id, email)`; prospect entity in dictionary registry.

**Workstream C — Event-rule routing:** `event_rules` + `event_rule_fires` tables; `server/lib/ruleMatcher.ts` (still inline at `triggerService.ts:44–52`); `eventRulesService.publish(event)`; `triggered_by` column on `workflow_runs`; **no event publishing** in `subaccounts.ts:73–157` (no `subaccount_created`), `ghlWebhook.ts:112–157` (no `crm_stage_changed`), `pageIntegrationWorker.ts` (no `form_submitted`).

**Workstream D — Email infra:** `outreach_sends` table; `RESEND_WEBHOOK_SECRET` env var; `POST /api/webhooks/resend`; HMAC verification via svix; `imapflow` dependency; `email-inbound-poll` pg-boss job; `classify_prospect_reply` skill (only support-focused `classify_email` exists); `webhookDedupeStore` for Resend.

**Workstream E — Lead gen:** `lead_discover` + `lead_score` skills (entirely absent); `GOOGLE_PLACES_API_KEY` + `HUNTER_API_KEY` env vars; `leadDiscoverJob.ts`; `lead-discover` system agent seed; "Sales Pipeline" subaccount pattern.

---

## 3. Stale references in the dev brief — rebase mapping

| Brief reference | Current name |
|---|---|
| `playbookRunService` | `workflowRunService` (`server/services/workflowRunService.ts`) |
| `playbook_runs` table | `workflow_runs` (and a separate `flow_runs` table also exists — decide which is the `start_playbook` target) |
| `playbook_templates` | `workflowTemplates` |
| `playbookEngineService` | `workflowEngineService` |
| `server/lib/playbook/` | `server/lib/workflow/` |
| `server/lib/playbook/agentDecisionPure.ts` | `server/lib/workflow/agentDecisionPure.ts` |
| `server/lib/playbook/actionCallAllowlist.ts` | `server/lib/workflow/actionCallAllowlist.ts` |
| `onboarding_playbook_slugs` | `onboarding_workflow_slugs` (column on `modules.ts:18`) |
| `autoStartOwedOnboardingPlaybooks` | `autoStartOwedOnboardingWorkflows` (`subaccountOnboardingService.ts:286`) |
| `start_playbook` target_type | `start_workflow` (and `invoke_automation` step type now exists) |
| Migration 0190 (next safe per brief) | **0227** is next safe |

`subaccountOnboardingService` itself was NOT renamed.

---

## 4. Recommendations — the next 4 weeks

### Phase 0 — This week (ship the case study, don't build infra)

The business plan's #1 dependency is the **Breakout Solutions case study** (the primary sales artefact for every outreach channel). The GEO skills are production-ready; nothing in the dev brief blocks running the POC manually.

1. **Run the Breakout Solutions POC NOW** with manual orchestration. Trigger the existing 9 GEO skills against their domain. HITL-review the outputs. Hand-compile the Delta Report.
2. **Brand the report surface** (~2 days). Extend `reportService.ts` + `reports` schema with a `report_type = 'ai_answer_coverage_review'` template; add PDF generation (puppeteer is the lowest-friction option). This produces the artefact referenced everywhere in the GTM plan.
3. **Begin Lemwarm domain warm-up + LinkedIn comment-seeding immediately** (per business plan §14 — both are independent of platform work).

### Phase 1 — Weeks 2–3 (foundation; rebase + the two unblocking tables)

4. **Rebase the dev brief**. Update all stale references (table 3 above), bump migrations to 0227+, decide `workflow_runs` vs `flow_runs` for the `start_playbook`/`start_workflow` target.
5. **Workstream A** in parallel with **Workstream B**:
   - A: `integration_configs` table + `resolveIntegrationConfig` + `CrmAdapter` interface + `nativeCrmAdapter` + `resolveCrmAdapter` + backfill GHL rows.
   - B: `canonical_prospect_profiles` + index on `canonical_contacts(organisation_id, email)` + `findContactByEmail` + RLS + dictionary entry.
6. **Add `triggered_by` column to `workflow_runs`** and make `started_by_user_id` nullable (Decision 8). Tiny migration; unblocks Workstream C.

### Phase 2 — Weeks 3–4 (event rules + outbound + inbound)

7. **Workstream C — event rules**:
   - Extract shared matcher to `server/lib/ruleMatcher.ts` (pull from `triggerService.ts:44–52` AND reconcile with `policyEngineService.matchesRule` at `:96–116` — note their semantics differ: triggers do flat exact-match; policy does conditional logic).
   - Build `event_rules` + `event_rule_fires` + `eventRulesService.publish`.
   - Wire `publish()` calls in `subaccounts.ts`, `ghlWebhook.ts`, `pageIntegrationWorker.ts`.
8. **Workstream D1 + D2 — outbound + Resend webhook**:
   - `outreach_sends` table; `emailService` per-org/per-subaccount from-address fallback chain via `integration_configs` (depends on A).
   - `POST /api/webhooks/resend` with HMAC svix verification + status mapping + dedupe.
   - `RESEND_WEBHOOK_SECRET` to `env.ts` + `.env.example`.
9. **Workstream D3 — inbound classification**: install `imapflow`; `email-inbound-poll` job; `classify_prospect_reply` skill (DIFFERENT taxonomy from existing `classify_email`); on `positive_intent`, publish `email_reply_positive` → event_rules → conversion playbook.

### Phase 3 — Post-launch (defer if launch metrics are met)

10. **Workstream E — lead discovery automation**. The business plan calls for 50 LinkedIn DMs/week + 50–75 cold emails/week. The operator can sustain this manually for the first 2–3 months. Hunter + Google Places integration is a path-to-scale lever, not a launch lever — defer until volume hits operator ceiling.
11. **Workstream F — domain health monitor**. Nice-to-have; bounce/complaint visibility can ride on Resend dashboard initially.

---

## 5. Recommendations beyond the dev brief

12. **Schedule weekly GEO audits per subaccount** (~1 day). Per-subaccount pg-boss singleton key (`audit-geo:${subaccountId}:${week}`) + HITL anomaly review on score drops. Without this, "weekly AI citation tracking" requires manual triggers — undermines the retainer narrative.
13. **Add `google_business_profile` to `publish_post` platform enum + GBP API caller in `executionLayerService`** (~3 days). Without it, "GBP Autopilot" can DRAFT but cannot PUBLISH. This is a hidden gap the dev brief doesn't call out.
14. **Tune confidence thresholds for 80/20 auto-approve target**. Infrastructure is ready; the gap is **agent-side `tool_intent_confidence` emission** (already deferred as `LAEL-P1-1` in `tasks/todo.md`). Prioritise it before scaling client count past 3.
15. **Deeper GHL polymorphism**. The brief covers `crmLiveDataService` + `clientPulseIngestionService`, but `ghlClientPulseFetchers`, `ghlEndpoints`, `ghlWebhookMutationsService` are also hardwired. Worth adding to Workstream A scope explicitly.
16. **Reconcile `workflow_runs` vs `flow_runs`**. PR #186 introduced `flow_runs` as a separate table. The dev brief assumes one runs table. Pick one as the `start_workflow` event-rule target before implementing Workstream C.

---

## 6. Risks the audit surfaced

- **Three rule systems converging.** `agent_triggers` (flat exact-match) + `policy_rules` (conditional) + new `event_rules`. The brief's shared `ruleMatcher.ts` extraction needs to handle both filter shapes, or the new table will silently fail on copy-paste from policy rule semantics.
- **No XOAUTH2 IMAP path today.** `integration_connections` supports `gmail` provider with oauth2, but the IMAP polling code does not exist. Plan to ship Outlook later; Gmail-first reduces D3 scope.
- **`publish_post` platform enum is closed.** Hardcoded to twitter / linkedin / instagram / facebook. Adding GBP requires a schema/registry change, not just a config row.
- **Dual-reviewer is local-only**, per CLAUDE.md. ChatGPT review pass on this branch is fine; Codex pass requires a local session.
- **`canonical_prospect_profiles` GHL round-trip is non-trivial.** Decision 1 in the brief calls for round-tripping prospect lifecycle to GHL's pipeline/opportunity model when CRM = GHL. The brief flags this as Phase 2; do not let it block initial Synthetos-Native delivery.

---

## 7. Concrete first commit

Run the Breakout Solutions POC manually using existing skills, capture the data, and ship the branded report surface (item 2 above) — **before** touching the dev brief implementation. The case study is the gating asset for every channel in §6 of the business plan.

After that, rebase the dev brief and proceed with Phase 1 (Workstreams A + B in parallel).

---

## 8. What each workstream gap means — plain English

The dev brief uses internal terminology. Here's what each gap actually means in business terms.

**Workstream A — CRM adapter polymorphism.** The platform was built assuming one CRM (GoHighLevel). Today, every "look up a contact" or "list opportunities" call is hardwired to GHL. To run a service business where each client might have a different CRM — or none at all (Synthetos as the CRM) — we need a way to ask "for this client, what CRM do they use?" and route the call accordingly. Without it, every client must use GHL, which limits which SMBs we can serve and creates a single-vendor dependency.

**Workstream B — Prospect lifecycle.** We can store contacts (clients, leads). What we can't store is the lifecycle of a prospect — what stage of outreach they're in, what their lead score is, whether they've converted. The agency model needs this to track "200 LinkedIn DMs sent → 30 replies → 7 audits booked → 2 retainers won." Without it, the BD pipeline lives in spreadsheets and is invisible to the platform's automation.

**Workstream C — Event-rule routing.** Today the system reacts to events in hardcoded ways: a webhook arrives, code runs. We need a database-driven rules table that says "when X happens, do Y" — configurable per agency, per subaccount. The headline use case: "when a positive email reply lands, create a subaccount and kick off onboarding." Without it, the conversion flow has to be re-coded for every variation, and a second agency tenant cannot adopt the same model without engineer time.

**Workstream D — Email infrastructure.** We can send a one-shot email. We can't:
- Send from per-client domains (every email looks like it's coming from Synthetos)
- Track delivery / opens / bounces (no audit trail of what landed)
- Run multi-step sequences with delays (single sends only)
- Detect inbound replies and classify them (the conversion trigger is dark)

This is the operational backbone of cold outreach. Without it, the 50 DMs/week + 50–75 cold emails/week target cannot be measured or automated.

**Workstream E — Lead discovery.** Today, finding 200 target prospects per vertical is manual. The `lead_discover` skill calls Google Places to find candidate businesses; `lead_score` uses Hunter.io + GBP completeness + GEO gap to rank them. Without it, the operator is the bottleneck for prospect sourcing — fine for the first 2–3 months, ceiling at the 5-hour/week budget.

**Workstream F — Domain health monitoring.** Watches Resend bounce rate, spam complaint rate, and blacklist status. Alerts the operator if metrics degrade. Without it, a deliverability problem can persist undetected long enough to burn the sending domain. Not a launch blocker — a safety net for ongoing outreach.

---

## 9. Fix-and-benefit summary

Every issue, what it takes to fix, and what changes when it's done.

| Issue | What we do | What we get |
|---|---|---|
| All CRM calls assume GoHighLevel | Build the adapter layer (Workstream A) — one switch point picks GHL or "Synthetos Native" per client | We can serve clients who don't use GHL. Reduces vendor risk if GHL changes terms. |
| No prospect pipeline data | Add the prospect profile extension table (Workstream B) | Outreach → reply → audit → retainer is tracked in the platform, not in a spreadsheet. Powers the §12 sales funnel metrics. |
| Hardcoded event reactions | Build the event-rules engine (Workstream C) | When a positive reply lands, the platform automatically creates the client subaccount and starts onboarding. No engineer needed for variations. |
| Single sender, no tracking | Build `outreach_sends` + Resend webhook (Workstream D1+D2) | We send from each client's own domain. We see what was delivered, opened, bounced. Required both for the agency's own outreach and for retainer service delivery. |
| No reply detection | Build IMAP polling + reply classification (Workstream D3) | Inbound replies get auto-classified. Positive replies trigger conversion. Out-of-office and bad-fit replies suppress further outreach automatically. |
| Manual prospecting | Build lead discovery skills (Workstream E) | Operator stops sourcing prospects by hand. Pipeline scales past the 5-hour/week ceiling. |
| No deliverability watch | Build domain-health monitor (Workstream F) | Catch sending-reputation problems before they kill the channel. |
| No recurring GEO audits | Schedule weekly audits (~1 day) | "Weekly AI citation tracking" — the headline retainer feature — actually runs without manual triggers. |
| GBP "Autopilot" can draft but not publish | Add `google_business_profile` to `publish_post` enum + GBP API caller (~3 days) | We deliver the GBP service we sell. Currently we can only generate drafts. |
| 80/20 auto-approve target needs confidence emission | Wire `tool_intent_confidence` emission (LAEL-P1-1, already in backlog) | Operator review queue stays at 20% of agent outputs. Without it, every output hits the queue and the 5-hr/week budget breaks at 4+ clients. |
| Branded report does not exist | Extend `reportService` with PDF + AI Answer Coverage Review template (~2 days) | The named monthly deliverable referenced throughout the business plan exists. Primary sales artefact is real. |
| Two run tables (`workflow_runs` + `flow_runs`) after PR #186 | Pick one as the canonical event-rule target | One-time engineering decision — without it, Workstream C cannot ship cleanly. |
| Dev brief references stale names (playbook → workflow rename) | Rebase the brief against current schema | New session reading the brief doesn't waste time on dead references. Migration numbering stays correct. |

---

## 10. Does this close the loop on the business plan?

**Mostly yes. The dev brief plus the audit's three add-ons (items 12–14) cover the platform side end-to-end. Seven smaller items in the business plan are NOT in the brief and need to be added as follow-ups — none of them block launch.**

### What this roadmap covers vs. what the business plan requires

**✅ Delivery model (audits + retainers)**
- 9 GEO skills are production-ready today → audit + monitoring service can run
- HITL gate + approval UX is ready → operator's 5-hr/week budget is achievable once confidence emission lands
- Branded report (item 12) + GBP publishing (item 13) close the two visible service gaps
- 12 months of accumulated citation history (the retainer stickiness mechanism) is already supported by the existing `geoAudits` table

**✅ Sales pipeline + automation**
- Workstreams B + C + D together produce: prospect tracking → outbound → reply detection → auto-conversion → onboarding
- This is the agency-of-one delivery loop the business plan describes
- Lead-gen automation (E) is the only piece that's deferred, and the plan explicitly tolerates manual prospecting for the first 2–3 months

**✅ Multi-tenant generalisation (§13 architecture summary)**
- Workstream A makes a second agency tenant possible with zero code changes
- Combined with C (configurable event rules) and D (per-subaccount sending domains), the platform-as-product transition signal in §7 of the plan becomes reachable

### Things this audit does NOT close the loop on

These are in the business plan but not in the dev brief. They need to be added as follow-up work — none are launch blockers, but they should be tracked so they don't fall through.

1. **Free Snapshot landing page (Layer 0).** Public single-input domain submission page that runs 3 GEO skills and emails a 2-page PDF in under 10 minutes. The skills exist; the public landing page + email-the-PDF flow does not. ~3–5 days of frontend + delivery wiring. Should be added as a Phase 2.5 workstream.

2. **Anti-abuse for the snapshot.** Email verification, IP rate limiting (3/24h), domain dedup with 30-day cache. ~2 days. Pairs with item 1.

3. **Async report walkthrough video.** 5-minute pre-recorded walkthrough embedded in the portal. Not platform work — content production. Flagged so it doesn't fall through.

4. **Vertical prompt library.** 20 prompts × initial vertical (B2B professional services), expanding to 3 verticals = 60 prompts hand-tuned. Not platform work — methodology. Operator deliverable; can be stored as canonical reference docs.

5. **Subcontract VA scaling path (§7 Path A).** Hire a part-time VA at month 6+. Platform requirements: (a) per-user permissions on the review queue (likely already supported via existing role system — verify), (b) a QA playbook codified during launch months 1–3 (operator deliverable, not platform work).

6. **Partnership revenue share tracking (§7 Channel 3).** 15% revenue share on referrals for first 6 months. Not in any workstream. Either a spreadsheet for v1, or extend Stripe integration with referral attribution. Flag as deferred.

7. **Ethics policy enforcement (§3 content and ethics policy).** The policy is binding per the plan, but no platform-side enforcement exists today. Examples: blocking fake-persona content, requiring affiliation disclosure on Reddit/LinkedIn posts, factual-accuracy review on AI-generated claims. Some of this is HITL discipline (already enforced); some needs additional rules in `policy_rules`. Worth a small spec.

### Bottom line

Phase 0–3 of this roadmap closes the loop on **everything in the dev brief plus the business plan's core delivery, sales, and operator-economics targets.** The seven items above are tier-2 polish that can ship in months 1–3 of active operation without affecting the launch path.

If the operator-as-agency goal is "be in market with paid clients within 90 days of launch," this audit's recommendations are sufficient. If the goal also includes the public Free Snapshot funnel (which the business plan §3 Layer 0 strongly implies), add items 1 + 2 to the Phase 2 schedule.


