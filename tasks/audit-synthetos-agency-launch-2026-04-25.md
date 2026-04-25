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

