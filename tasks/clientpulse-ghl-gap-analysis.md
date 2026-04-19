# ClientPulse GHL Agency Gap Analysis

**Date:** 2026-04-17
**Source interview:** Kel / Productivity Hub (180-client GHL agency, two separate GHL backends: SaaS ~90 + DFY ~90)
**Inputs digested:**
- Kel transcript (17 April 2026)
- Claude follow-up summary + updated brief
- `docs/clientpulse-dev-spec.md` (1899 lines, canonical)
- `docs/clientpulse-ghl-dev-brief.md` (668 lines)
- `tasks/ghl-agency-{development-brief,value-proposition,feasibility-assessment,interview-brief}.md`
- Full code audit of `server/adapters/ghlAdapter.ts`, `server/routes/ghl.ts`, `server/routes/webhooks/ghlWebhook.ts`, `server/services/healthService.ts`, `server/routes/clientpulseReports.ts`, `server/skills/compute_health_score.md`, `server/jobs/portfolioRollupJob.ts`, migrations `0068`, `0087`, `0096`, and the canonical schema under `server/db/schema/*`.

**Purpose:** Identify the gaps between what is in the repo today and what must be true for ClientPulse to ship out-of-the-box for a 180-client GHL agency, using the canonical taxonomy (no hardcoded agency logic).

---

## Contents

1. Executive summary & Kel requirements matrix
2. GHL data ingestion gaps (the eight signals)
3. Multi-agency-per-org blocker
4. Health score execution pipeline gaps
5. Churn risk execution pipeline gaps
6. Intervention workflow gaps (Actions + ReviewItems)
7. Dashboard UI gaps
8. Trial monitoring (absent)
9. Canonical taxonomy proposal (non-hardcoded)
10. Recommended build order
11. Cross-reference to existing specs + open questions
12. Current state of the GHL Agency seed + required template extension
13. Intelligence Briefing + Weekly Digest integration
14. Plain-English delivery summary (read this first)
15. Action-type primitives — the 5 CRM-agnostic intervention actions *(added 2026-04-18)*
16. Canonical merge fields — CRM-agnostic content composition *(added 2026-04-18)*
17. Configuration Agent integration — making ClientPulse config editable via chat *(added 2026-04-18)* — §17.6 guardrail requirements added post-review
18. Template editor + system-admin governance model *(added 2026-04-18)*
19. Onboarding flows — sysadmin create-org + orgadmin first-run *(added 2026-04-18)*
20. UX decisions catalog + mockup index *(added 2026-04-18)*
21. V1 vs V2 scope delineation *(added 2026-04-18)*
22. Ingestion contract — per-signal freshness, path, and backfill *(added 2026-04-18, per external review)*
23. Rate limiting, SLA, and the `measureInterventionOutcomeJob` contract *(added 2026-04-18, per external review)*
24. Pre-build engineering audit — claim-by-claim verification *(added 2026-04-18)*
25. Implementer quick-reference appendix *(added 2026-04-18, per second-pass review)*
26. Outstanding blockers + ship-gate tracker *(added 2026-04-18, per second-pass review)*
27. Third-pass Codex review response *(added 2026-04-18)* — 5 real contradictions fixed (action-slug collision, intervention-table duplication, proposer vocabulary, timezone field, config-audit duplication)

Scoring formula consolidation in §4.6 was also added 2026-04-18 per external review.

> **Reading order for a fresh implementer:** §27 (recent fixes) → §26 (blockers) → §25 (invariants quick-ref) → §1 → §21 → §24 → §15 → §16 → §17 (+ §17.6) → §18 → §20 → §4.6 → §22 → §23 → §10 → §11.3 → deep-dive §§2–9 as needed.

---

## 1. Executive summary & Kel requirements matrix

### 1.1 Bottom line

Roughly 60% of the plumbing ClientPulse needs for a Kel-shaped agency already exists as **generic, canonical infrastructure** (subaccounts + integrations + actions + reviewItems + orgConfig + hierarchyTemplates + pg-boss jobs). The remaining 40% is a pattern-consistent set of additions — new GHL adapter endpoints, new capability slugs, new action types, one new health-snapshot timeseries table, a churn signal evaluator, and a handful of UI widgets.

**There is no meaningful hardcoded "GHL agency" logic required.** Every Kel-specific behaviour maps cleanly onto existing canonical concepts: a GHL agency → `organisations` row, each of its clients → `subaccounts` row, each monitored feature → a capability slug, each signal evaluation → a skill, each intervention → an `actions` row with `gateLevel='review'`, each review → a `reviewItems` row. Nothing about the Kel use case requires a code branch that says "if GHL agency, do X". It all lands as config on canonical rows.

The three real blockers (in severity order) are:

1. **GHL data breadth** — we pull contacts / opportunities / conversations / revenue. We do not pull funnels, calendars, users, or tier metadata. Staff activity and installed-integration detection are derived signals (§§2.0b, 2.0c) and also require new adapter work. Six of the eight signals Kel identified as churn-predictive are un-ingested.
2. **Health + churn executors exist but are not scheduled against ClientPulse-shaped data.** `compute_health_score` / `compute_churn_risk` skill handlers are registered in `server/services/skillExecutor.ts:1269,1279` and delegate to `intelligenceSkillExecutor`, targeting the existing generic `health_snapshots` table (`server/db/schema/canonicalEntities.ts:175`). What's missing is the ClientPulse-specific timeseries tables (`client_pulse_health_snapshots`, `client_pulse_churn_assessments`) and the pg-boss jobs that fan the scoring work out per-sub-account. See §4.2 for the full gap decomposition.
3. **Intervention pipeline not wired** — `actions` + `reviewItems` + `interventionOutcomes` are the right substrate, but the five new action-type primitives (§15) are not registered, and no proposer reads `client_pulse_churn_assessments` to surface a review item.

(Multi-agency-per-org was previously listed as a blocker but is now resolved by design — per §3, one GHL agency backend maps to one Synthetos org, so `connector_configs`'s existing unique constraint on `(organisation_id, connector_type)` is correct as-is.)

### 1.2 Kel requirements matrix

| # | Kel's explicit requirement | Canonical home | Current state | Gap class |
|---|---|---|---|---|
| 1 | See all sub-accounts on one screen ranked by health | `subaccounts` + health snapshot table (new) + `ClientPulseDashboardPage.tsx` | Dashboard page exists; high-risk widget returns `{clients: []}` (TODO in `clientpulseReports.ts:79`) | Wiring + 1 new table |
| 2 | Detect staff activity per sub-account (derived replacement for "login activity") | Adapter populates `canonical_subaccount_mutations` (new) + `compute_staff_activity_pulse` skill (new) — see §2.0b | No adapter write path, no webhook normalisation | Data ingestion |
| 3 | Detect funnel inventory per sub-account | GHL adapter + `compute_funnel_coverage` skill (new) | None | Data ingestion |
| 4 | Detect calendar quality (calendars ÷ users) | GHL adapter + `compute_calendar_quality` skill (new) | None | Data ingestion |
| 5 | Detect installed third-party integrations (e.g. CloseBot) | Adapter populates `canonical_conversation_providers` / `canonical_workflow_definitions` / `canonical_tag_definitions` / `canonical_custom_field_definitions` / `canonical_contact_sources` (new) + `scan_integration_fingerprints` skill (new) — see §2.0c | None | Data ingestion |
| 6 | Detect subscription tier + tier-migration trend | GHL adapter `/businesses` metadata + new `subaccount_tier_history` table | Not surfaced; may exist in `canonical_accounts.externalMetadata` | Data ingestion + 1 new table |
| 7 | Detect AI feature usage (native GHL vs CloseBot) | Composition of #5 + GHL adapter | None | Data ingestion |
| 8 | Weighted composite health score per sub-account | `compute_health_score` skill + `orgConfigService.getHealthScoreFactors()` + new `client_pulse_health_snapshots` table | Skill handler registered (`server/services/skillExecutor.ts:1269`), delegates to `intelligenceSkillExecutor` and writes the existing generic `health_snapshots`. Config configurable per-org. **No per-sub-account scheduler**, **no ClientPulse-shaped timeseries table**. | Execution + 1 new table |
| 9 | Churn risk classification with configurable thresholds | `compute_churn_risk` skill + `orgConfigService.getChurnRiskSignals()` | Skill handler registered (`server/services/skillExecutor.ts:1279`). Config exists. **No per-sub-account scheduler**, **no `client_pulse_churn_assessments` timeseries table**. | Execution + 1 new table |
| 10 | Monday morning one-screen view with trends | `ClientPulseDashboardPage.tsx` + new drill-down + `portfolioRollupJob` already Mon 08:00 | Job fires, aggregates empty data | Wiring |
| 11 | Propose intervention → Kel approves → execute (HITL) | `actions` + `reviewItems` + `interventionOutcomes` (all exist) + 5 new namespaced action types (`crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert` — §15.1) + scenario-detector job | Substrate exists; **no scenario detector, no registered primitives** | Wiring + action registry entries (per §15 / §27 C5) |
| 12 | Intervention cooldowns | `interventionService.checkCooldown` (exists) | Works; needs to be called from the new proposer | Wiring |
| 13 | Trial progress monitoring + stalled-trial nudges | New onboarding-milestone table + reuse of health pipeline | Absent from code and canonical spec | New module |
| 14 | Multi-agency per org (SaaS + DFY backends) | Resolved by design: one GHL agency backend = one Synthetos org (§3). `connector_configs` unique constraint on `(organisation_id, connector_type)` stays as-is. | Kel connects Productivity Hub — SaaS and Productivity Hub — DFY as two separate orgs. | **No change required** |
| 15 | Per-org configuration of every weight, threshold, template | `hierarchyTemplates.operationalConfig` (JSONB) + new admin UI | Backend config path works; **no UI** | UI |

### 1.3 Taxonomy principle

Every Kel-specific requirement above resolves to one of five canonical primitives:

1. **A capability slug** registered in the taxonomy registry (`docs/integration-reference.md` + capability registry) — describes *what* can be measured / done.
2. **A skill** (`server/skills/*.md` + executor in `server/services/skillExecutor.ts`) — describes *how* to measure / do it.
3. **A canonical data table** — either reuse (`canonical_accounts`, `integration_connections`) or extend with timeseries (`client_pulse_health_snapshots`, `subaccount_tier_history`).
4. **A configurable weight / threshold / template** stored in `hierarchyTemplates.operationalConfig` JSONB, surfaced through `orgConfigService`, editable per org.
5. **A generic platform primitive** — `actions`, `reviewItems`, `interventionOutcomes`, `pg-boss job`, `websocket room` — reused without modification.

Nothing in Kel's brief requires a sixth primitive.

### 1.4 Three-layer abstraction (code vs canonical vs config)

Supporting a new CRM (HubSpot, Pipedrive, Salesforce) should **never** require writing new ClientPulse code. Everything that is "how to monitor a sub-account for churn risk" is already CRM-agnostic. The only thing that changes per CRM is the *adapter* and the *configuration template values*.

| Layer | What lives here | CRM-specific? | Example |
|---|---|---|---|
| **Adapter** (`server/adapters/<crm>Adapter.ts`) | How to normalise this CRM's raw API/webhook data into canonical tables | **Yes** — by definition; one adapter per CRM | `ghlAdapter.ts` maps `OpportunityStageUpdate` webhooks to `canonical_subaccount_mutations` rows |
| **Canonical tables** (`canonical_*`) | The generic shape of CRM data. No CRM-specific column names or semantics. | **No** | `canonical_subaccount_mutations`, `canonical_conversation_providers`, `canonical_workflow_definitions` |
| **Skills** (`server/skills/*.md` + executors) | Business logic: compute score, evaluate churn, scan fingerprints, propose intervention. Reads canonical, writes derived. | **No** | `compute_staff_activity_pulse`, `scan_integration_fingerprints`, `compute_health_score` |
| **Derived tables** (`subaccount_*_snapshots`, `integration_detections`, etc.) | Output of skills. Also CRM-agnostic. | **No** | `subaccount_staff_activity_snapshots` |
| **Configuration template** (`hierarchyTemplates.operationalConfig` per org, seeded per CRM) | CRM-specific *values*: mutation types worth counting, fingerprint library, weights, thresholds. | **Yes** — carries the CRM-specific knowledge | "GHL Agency" template seeds CloseBot / Uphex fingerprints, configures which mutation types to track in GHL's vocabulary |
| **Platform primitives** (`actions`, `reviewItems`, `interventionOutcomes`, pg-boss, websockets) | Reused without modification. | **No** | `actions` table carries a `client_pulse_intervention` regardless of upstream CRM |

**Concrete consequence for this build:** when we ship ClientPulse, the code runs against any CRM we already have an adapter for. To onboard HubSpot later, the work is (a) write a `hubspotAdapter` that populates the same canonical tables, (b) write a "HubSpot Agency" configuration template with HubSpot-world values. No ClientPulse skill or table change needed.

---

## 2. GHL data ingestion gaps — the eight signals

Kel's brief identifies eight churn-predictive signals. The table below maps each to the GHL API surface, the canonical home in our schema, the current adapter state, and the proposed capability slug.

Verified against the official GHL v2 developer docs at `https://marketplace.gohighlevel.com/docs/` and the public source repo at `https://github.com/GoHighLevel/highlevel-api-docs`.

| # | Signal (Kel) | Proposed capability slug | GHL API / source | Feasibility | Current adapter state |
|---|---|---|---|---|---|
| 1 | Staff activity per sub-account (replaces "login activity") | `ghl.read.staff_activity` (composite) | **GHL does not expose login data via API.** But GHL *does* expose user attribution on every meaningful mutation: contacts (`createdBy`/`updatedBy`), opportunities (`updatedBy` + stage-change events), conversation messages (`userId` + `direction`), notes (`createdBy`), tasks, workflow edits (`updatedAt`), funnel/calendar edits (`updatedAt`). Any of these happening = someone logged in. | **Better than login data.** What Kel actually wants to know is "is someone getting value out of this sub-account," not "did they visit." Login ≠ work. Record mutations ≠ ambiguous — they prove work happened. See §2.0b for the derived "Staff Activity Pulse" composite. | Missing; design is new |
| 2 | Funnel inventory | `ghl.read.funnels` | `GET /funnels/funnel?locationId={id}` + `GET /funnels/funnel/{funnelId}/page` for per-funnel step counts. Confirmed in docs: "Fetch List of Funnels" + "Fetch list of funnel pages". | **Feasible.** | Missing |
| 3 | Calendar configuration quality | `ghl.read.calendars` | `GET /calendars/?locationId={id}` (confirmed "Get Calendars" endpoint) + `GET /users/search?locationId={id}` for team-member denominator. | **Feasible.** | Missing |
| 4 | Contact volume + activity | `ghl.read.contacts` | Already implemented — `ghlAdapter.fetchContacts` (line 114). | **Shipped.** | **Implemented** |
| 5 | Third-party integrations in use per sub-account (CloseBot, Uphex, etc.) | `ghl.read.integration_fingerprints` (composite) | **GHL does not expose an "installed apps" endpoint for third parties.** But third-party apps leave **fingerprints** in the data we can already query: conversation messages carry `conversationProviderId`; workflows expose action types (incl. marketplace-registered third-party actions); outbound-webhook actions have explicit URL targets; tags + custom fields often use vendor prefixes. | **Fingerprint scanner with self-learning.** Ship a seed fingerprint library for known big integrations (CloseBot, Uphex, etc.). Scan every sub-account's artifacts on each poll. Novel / unclassified signals (e.g. an unknown conversationProviderId seen 50+ times) get surfaced to Kel once as a single question "what is this?"; his answer classifies it retroactively across his entire 180-client portfolio. See §2.0c. | Missing; design is new |
| 6 | Subscription tier + tier migration | `ghl.read.subscription_tier` | `GET /saas/location/{locationId}/subscription` — returns plan ID, active status, next billing date. **Requires SaaS mode enabled + Agency Pro tier** on the GHL side. Kel's SaaS arm qualifies. Also check `GET /locations/{locationId}` response for tier-ish fields. | **Feasible for Kel's SaaS org**; may not work for agencies without SaaS mode. Record a tier observation only when the endpoint is available; otherwise mark `tier='unknown'`. | Partial — metadata likely present on `canonical_accounts.externalMetadata` but unparsed |
| 7 | AI feature usage (native GHL) | `ghl.read.ai_feature_usage` | No first-class endpoint. Conversation AI and Voice AI are configured inside the sub-account — their **active usage** can be inferred from `GET /conversations/search` filtered by message-sender type or by checking `/workflows` for AI-action steps. Install-status of GHL's own AI modules is not returned as a flag. | **Partial.** Can tell if there's AI-generated conversation traffic; cannot tell cleanly whether AI features are "configured but not used" vs "not installed". | Missing |
| 8 | Opportunities / pipeline | `ghl.read.opportunities` | Already implemented — `ghlAdapter.fetchOpportunities` (line 138). | **Shipped.** | **Implemented** |
| — | Conversations metadata | `ghl.read.conversations` | Already implemented — `ghlAdapter.fetchConversations` (line 161). | **Shipped.** | **Implemented** |
| — | Revenue | `ghl.read.revenue` | Already implemented — `ghlAdapter.fetchRevenue` (line 182). | **Shipped.** | **Implemented** |
| — | Users / team members (denominator for #3, attribution for #1) | `ghl.read.users` | `GET /users/search?locationId={id}` + `GET /users/location/{locationId}`. | **Feasible.** | Missing |
| — | Location metadata (for #6 + general) | `ghl.read.location_metadata` | `GET /locations/{locationId}` — already partially hit by `listAccounts`; read the full payload. | **Feasible.** | Partial |

### 2.0a Principle: derive signals from data, do not ask the user to tag

Two of Kel's eight signals — login activity and third-party integration detection — have no dedicated GHL endpoint. The wrong answer is "ask Kel to tag 180 sub-accounts." The right answer is **derive the signal from the data the API does expose**, because the platform's job is to remove that kind of labour, not re-impose it.

Both signals resolve to the same architectural move: **run a scanner that reads what's already there, composes it into a canonical observation, and learns from corrections instead of demanding setup.**

### 2.0b Staff Activity Pulse (replaces "login activity") — abstracted

**Principle:** the core *insight* (staff mutations predict embedment) is CRM-agnostic. The core *pipeline* (adapter normalises raw mutations → canonical event stream → generic skill composes pulse → config template maps the ambiguous bits) is CRM-agnostic. Only the *adapter-specific ingestion* and the *GHL-specific values in the configuration template* are GHL-specific.

**Three-layer split:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  GENERIC (code, agnostic, reused across every CRM we ever onboard) │
│                                                                     │
│  canonical_subaccount_mutations (new canonical table)               │
│    subaccountId, occurredAt, mutationType, externalUserId,          │
│    externalUserKind ('staff'|'automation'|'contact'|'unknown'),     │
│    sourceEntity ('contact'|'opportunity'|'message'|'note'|'task'|   │
│                  'workflow_definition'|'funnel_definition'|etc),    │
│    evidence JSONB                                                   │
│                                                                     │
│  compute_staff_activity_pulse skill                                 │
│    reads canonical_subaccount_mutations +                           │
│    orgConfigService.getStaffActivityDefinition(orgId)               │
│    writes subaccount_staff_activity_snapshots                       │
└─────────────────────────────────────────────────────────────────────┘
            ▲                                          ▲
            │  (ingestion)                  (config)   │
            │                                          │
┌───────────┴──────────┐                  ┌───────────┴───────────────┐
│  ADAPTER (per CRM)   │                  │  CONFIGURATION TEMPLATE   │
│  ghlAdapter.ts       │                  │  "GHL Agency" template in │
│    - normalise       │                  │  hierarchyTemplates.      │
│      contacts +      │                  │  operationalConfig JSONB  │
│      opportunities + │                  │                           │
│      messages +      │                  │  staffActivity: {         │
│      workflows +     │                  │    countedMutationTypes,  │
│      funnels +       │                  │    automationUserHeuristic│
│      calendars       │                  │    weights,               │
│      into canonical_ │                  │    lookbackWindowsDays    │
│      subaccount_     │                  │  }                        │
│      mutations       │                  └───────────────────────────┘
│                      │
│  hubspotAdapter.ts   │  (same contract, different source API)
│  pipedriveAdapter.ts │
└──────────────────────┘
```

**What each layer owns:**

| Layer | Owns | Example |
|---|---|---|
| **Canonical table** `canonical_subaccount_mutations` | The *shape* of a "someone did something in this sub-account" event, CRM-agnostic | `mutationType='opportunity_updated'`, `externalUserId='abc-123'`, `externalUserKind='staff'` |
| **Adapter** `ghlAdapter.ts` | Mapping *this CRM's* webhooks + poll responses into canonical mutation rows | "When the GHL `OpportunityStageUpdate` webhook fires, write a canonical mutation with `sourceEntity='opportunity'`, `externalUserId=event.updatedBy`, and resolve `externalUserKind` via the configured heuristic" |
| **Skill** `compute_staff_activity_pulse` | Reading the canonical stream + config + writing rollup snapshots | CRM-agnostic; same code runs against GHL, HubSpot, Pipedrive |
| **Config template** "GHL Agency" | The *values* that define what "staff activity" means in this CRM's universe | `countedMutationTypes: ['contact_created','contact_updated','opportunity_stage_changed','message_sent_outbound','note_added','workflow_edited','funnel_edited','calendar_configured']`, `automationUserHeuristic: 'outlier_by_volume_threshold_0.6'`, per-mutation-type weights |

**Config template shape (lives in `hierarchyTemplates.operationalConfig.staffActivity`):**

```jsonc
{
  "staffActivity": {
    "countedMutationTypes": [
      { "type": "contact_created",           "weight": 1.0 },
      { "type": "contact_updated",           "weight": 0.5 },
      { "type": "opportunity_stage_changed", "weight": 2.0 },
      { "type": "message_sent_outbound",     "weight": 1.5 },
      { "type": "note_added",                "weight": 1.0 },
      { "type": "task_completed",            "weight": 1.0 },
      { "type": "workflow_edited",           "weight": 3.0 },
      { "type": "funnel_edited",             "weight": 3.0 },
      { "type": "calendar_configured",       "weight": 2.0 }
    ],
    "excludedUserKinds": ["automation", "contact", "unknown"],
    "automationUserResolution": {
      "strategy": "outlier_by_volume",
      "threshold": 0.6,            // user's share of total mutations > 0.6 = probably automation
      "cacheMonths": 1
    },
    "lookbackWindowsDays": [7, 30, 90],
    "churnFlagThresholds": {
      "zeroActivityDays": 14,
      "weekOverWeekDropPct": 50
    }
  }
}
```

Every number above is editable per org through the config UI (§7.5). The skill that computes the pulse does not know what CRM is upstream — it just reads `canonical_subaccount_mutations` and applies the config.

**Adapter contract (new, applies to every CRM adapter, not just GHL):**

Every CRM adapter MUST populate `canonical_subaccount_mutations` for every attribution-bearing write it observes. The adapter is the only code that knows the CRM's field names. For the GHL adapter specifically:

| GHL source | Canonical write |
|---|---|
| `ContactCreate` webhook → `event.contact.createdBy` | `mutationType='contact_created'`, `externalUserId=createdBy`, `sourceEntity='contact'` |
| `ContactUpdate` webhook → `event.contact.updatedBy` | `mutationType='contact_updated'`, … |
| `OpportunityStageUpdate` webhook | `mutationType='opportunity_stage_changed'`, … |
| `OpportunityStatusUpdate` webhook | `mutationType='opportunity_status_changed'`, … |
| `ConversationCreated`/`ConversationUpdated` webhook with outbound user-authored message (`direction='outbound' AND userId IS NOT NULL AND conversationProviderId IS NULL`) | `mutationType='message_sent_outbound'`, … |
| Polling delta on `workflow.updatedAt` | `mutationType='workflow_edited'`, `externalUserId=null` (GHL doesn't attribute workflow edits), `externalUserKind='staff'` (assumed; workflows don't edit themselves) |
| Polling delta on `funnel.updatedAt` | `mutationType='funnel_edited'`, same attribution fallback |
| Polling delta on `calendar.updatedAt` / new calendar | `mutationType='calendar_configured'`, … |

The `externalUserKind` resolution is also GHL-specific (uses the outlier-volume heuristic above); it is applied inside the adapter using the config template's strategy, but the strategy name + threshold come from config.

**Why this is strictly better than login tracking:** unchanged from the prior version — a client whose staff touched 500 contacts last week is healthy even if nobody "logged in"; a client with 12 logins but zero mutations is dead. Kel's mental model maps to mutation volume, not auth events.

**Near-real-time via webhooks:** every GHL webhook we already receive carries the user attribution. The adapter writes canonical mutations in the webhook handler; the skill reads them in the next scoring window. Poll cycle fills the gap for entities that don't fire webhooks (workflows, funnels, calendars).

**Churn-signal contribution:** `zero_activity_14d` and `activity_drop_50pct_wow` become configurable churn signals (§5). Defaults land in `DEFAULT_CHURN_RISK_SIGNALS`; values editable per org.

### 2.0c Integration Fingerprint Scanner — abstracted

**Principle:** same three-layer split as §2.0b. The scanner + fingerprint schema are CRM-agnostic code. The adapter populates generic canonical "fingerprint-bearing artifact" tables. The configuration template carries the CRM-specific fingerprint library values.

**Three-layer split:**

```
┌────────────────────────────────────────────────────────────────────────┐
│  GENERIC (code, agnostic)                                              │
│                                                                        │
│  Canonical fingerprint-bearing artifact tables:                        │
│    canonical_conversation_providers(subaccountId, externalProviderId,  │
│                                     displayName, observedAt, lastSeen) │
│    canonical_workflow_definitions(subaccountId, externalWorkflowId,    │
│                                   actionTypes JSONB [array of strings],│
│                                   outboundWebhookTargets JSONB,        │
│                                   updatedAt)                           │
│    canonical_tag_definitions(subaccountId, tagName, observedAt)        │
│    canonical_custom_field_definitions(subaccountId, fieldKey,          │
│                                       fieldType, observedAt)           │
│    canonical_contact_sources(subaccountId, sourceValue, observedAt,    │
│                              occurrenceCount)                          │
│                                                                        │
│  integration_fingerprints table (generic, library of patterns)         │
│  integration_detections table (generic, per-subaccount matches)        │
│  integration_unclassified_signals table (generic, novel patterns)      │
│                                                                        │
│  scan_integration_fingerprints skill (CRM-agnostic matcher)            │
└────────────────────────────────────────────────────────────────────────┘
            ▲                                             ▲
            │                                             │
┌───────────┴──────────┐                   ┌──────────────┴───────────────┐
│  ADAPTER (per CRM)   │                   │  CONFIGURATION TEMPLATE      │
│                      │                   │  "GHL Agency" template       │
│  ghlAdapter          │                   │                              │
│    populates         │                   │  integrationFingerprints: [  │
│    canonical_*       │                   │    { integrationSlug: "closebot",
│    tables from       │                   │      fingerprints: [         │
│    GHL-specific      │                   │        { type: "conversation_provider_id",
│    endpoints/        │                   │          value: "prov_..."}, │
│    webhooks          │                   │        { type: "workflow_action_type",
│                      │                   │          valuePattern: "^closebot\\." },
│                      │                   │        { type: "outbound_webhook_domain",
│                      │                   │          value: "api.closebot.ai" }
│                      │                   │      ]                       │
│                      │                   │    },                        │
│                      │                   │    { integrationSlug: "uphex", … }
│                      │                   │  ]                           │
│                      │                   │                              │
│                      │                   │  scanFingerprintTypes: [     │
│                      │                   │    "conversation_provider_id",
│                      │                   │    "workflow_action_type",   │
│                      │                   │    "outbound_webhook_domain",│
│                      │                   │    "custom_field_prefix",    │
│                      │                   │    "tag_prefix",             │
│                      │                   │    "contact_source"          │
│                      │                   │  ]                           │
│                      │                   └──────────────────────────────┘
└──────────────────────┘
```

**Generic tables (CRM-agnostic):**

```
integration_fingerprints(
  id,
  scope                 ENUM('system','org'),      -- system = seeded library, org = agency-specific learnings
  organisationId        nullable,
  integrationSlug,                                 -- e.g. 'closebot' (CRM-agnostic identifier)
  displayName,
  vendorUrl             nullable,
  fingerprintType       ENUM('conversation_provider_id','workflow_action_type',
                             'outbound_webhook_domain','custom_field_prefix',
                             'tag_prefix','contact_source'),
  fingerprintValue      nullable,                  -- exact-match value
  fingerprintPattern    nullable,                  -- regex pattern, alternative to exact match
  confidence            numeric(3,2),
  createdBy, createdAt, deletedAt
)

integration_detections(
  id, organisationId, subaccountId, connectorConfigId,
  integrationSlug,
  matchedFingerprintId  FK,
  firstSeenAt, lastSeenAt,
  usageIndicatorJson,                              -- CRM-agnostic usage proxy; e.g. {"messages_30d":450}
  deletedAt
)

integration_unclassified_signals(
  id, organisationId, subaccountId, connectorConfigId,
  signalType            ENUM(same as fingerprintType above, with 'unknown_' prefix),
  signalValue,
  firstSeenAt, lastSeenAt,
  occurrenceCount,
  importanceScore,                                 -- cross-subaccount occurrence weight
  resolvedToIntegrationSlug  nullable,
  resolvedBy, resolvedAt     nullable,
  dismissedAsIrrelevant      boolean default false
)
```

**What each layer owns:**

| Layer | Owns |
|---|---|
| **Canonical artifact tables** | Generic shape of "fingerprint-bearing thing observed in a sub-account" (a conversation provider, a workflow definition with its action types, a tag, a custom field key). No GHL references. |
| **Adapter** (`ghlAdapter`) | Populating canonical artifact tables from CRM-specific endpoints. E.g. "every conversation message's `conversationProviderId` goes into `canonical_conversation_providers`"; "workflow list endpoint's action-type array goes into `canonical_workflow_definitions.actionTypes`". |
| **Skill** `scan_integration_fingerprints` | CRM-agnostic matcher: reads canonical artifacts + `integration_fingerprints` library + `scanFingerprintTypes` config, writes `integration_detections` and `integration_unclassified_signals`. |
| **Config template** "GHL Agency" | The *values* in the fingerprint library: the specific conversationProviderId strings CloseBot uses, the specific workflow action type name patterns, the specific webhook domains. Also which fingerprint types are worth scanning for this CRM (all of them, for GHL). |

**Adapter contract (generalises across every CRM):**

| Canonical target | Populated by adapter from |
|---|---|
| `canonical_conversation_providers` | Distinct `message.providerId` values per sub-account, from the CRM's conversations API |
| `canonical_workflow_definitions` | CRM's workflow list endpoint, with action-type array flattened |
| `canonical_outbound_webhooks` (or inside `canonical_workflow_definitions.outboundWebhookTargets`) | Outbound-webhook action targets inside workflows |
| `canonical_tag_definitions` | CRM's tags listing per sub-account |
| `canonical_custom_field_definitions` | CRM's custom-field listing per sub-account |
| `canonical_contact_sources` | Distinct `contact.source` values per sub-account |

The ghlAdapter's job is to normalise GHL-shape data into these canonical shapes. A future hubspotAdapter or pipedriveAdapter does the same for its CRM with different endpoints.

**Configuration template shape (`hierarchyTemplates.operationalConfig.integrationFingerprints`):**

```jsonc
{
  "integrationFingerprints": {
    "seedLibrary": [
      {
        "integrationSlug": "closebot",
        "displayName": "CloseBot",
        "vendorUrl": "https://closebot.ai",
        "fingerprints": [
          { "type": "conversation_provider_id",  "valuePattern": "^closebot:"  },
          { "type": "workflow_action_type",      "valuePattern": "^closebot\\." },
          { "type": "outbound_webhook_domain",   "value":        "api.closebot.ai" },
          { "type": "custom_field_prefix",       "valuePattern": "^closebot_"   },
          { "type": "tag_prefix",                "valuePattern": "^closebot:"   }
        ],
        "confidence": 0.95
      },
      { "integrationSlug": "uphex", "displayName": "Uphex", "fingerprints": [ … ] }
    ],
    "scanFingerprintTypes": [
      "conversation_provider_id","workflow_action_type","outbound_webhook_domain",
      "custom_field_prefix","tag_prefix","contact_source"
    ],
    "unclassifiedSignalPromotion": {
      "surfaceAfterOccurrenceCount": 50,
      "surfaceAfterSubaccountCount": 3
    }
  }
}
```

**Flywheel (unchanged, now config-driven):**

1. Seed library lives in config — the "GHL Agency" template ships with CloseBot / Uphex / etc. rows, promoted to system scope at `integration_fingerprints` seed time.
2. Scanner job runs on every poll cycle. Matches against `integration_fingerprints` library (system + org scope).
3. Unmatched observations accumulate in `integration_unclassified_signals` with `occurrenceCount` and `importanceScore`. When a signal crosses `unclassifiedSignalPromotion` thresholds (both configurable), it surfaces as a single review-queue item.
4. Kel resolves once → row becomes an org-scope `integration_fingerprints` entry → retroactively classifies every sub-account.
5. Kel can optionally flag a resolution as "broadly applicable" → promoted to system scope → benefits every future customer.

**What we ask Kel for on the call:** the list of third-party apps he typically sees across his 180-client portfolio. That list seeds the "GHL Agency" configuration template's `seedLibrary`. Ten-minute ask; the data we need is just names + websites — we find the fingerprints by inspecting how those vendors register themselves in GHL (via their marketplace docs + by looking at a couple of his sub-accounts during the design partner engagement).

### 2.0d What we don't build

No IEE UI scraping of GHL's Audit Logs panel or installed-apps panel. The `docs/non-goals` stance rejects scraping for core product telemetry — fragile, ToS-risky, and unnecessary given §2.0b and §2.0c cover the same ground using legitimate API data.

### 2.1 Webhook gaps (distinct from polling gaps)

The current webhook handler in `server/routes/webhooks/ghlWebhook.ts` subscribes to nine entity-mutation events (contact / opportunity / conversation / revenue CRUD). The canonical ClientPulse spec additionally names three lifecycle events we do not currently handle:

- `INSTALL` / `UNINSTALL` — app install state. Without this we cannot detect when a sub-account revokes access.
- `LocationCreate` / `LocationUpdate` — so a new sub-account appears in the dashboard within minutes, not on next poll.

These map onto existing `canonical_accounts` + `integration_connections` rows — no new tables needed. Action: extend `ghlAdapter.normaliseEvent` (line 245) and `ghlWebhook.ts` handler.

### 2.2 Adapter work required

Five new functions in `server/adapters/ghlAdapter.ts`, each registered as a skill handler in `server/services/skillExecutor.ts`, each declared as a capability in `docs/integration-reference.md`:

```
fetchFunnels(connection, {locationId}): FunnelSummary[]            // GET /funnels/funnel?locationId=
fetchFunnelPages(connection, {funnelId}): FunnelPageSummary[]      // GET /funnels/funnel/{funnelId}/page
fetchCalendars(connection, {locationId}): CalendarSummary[]        // GET /calendars/?locationId=
fetchUsers(connection, {locationId}): UserSummary[]                // GET /users/search?locationId=
fetchLocationDetails(connection, {locationId}): LocationDetails    // GET /locations/{locationId}
fetchSubscription(connection, {locationId}): SubscriptionInfo|null // GET /saas/location/{locationId}/subscription (SaaS-mode only)
```

All follow the existing pattern (rate-limited via `rateLimiter` at `ghl` key, org concurrency cap respected via `organisations.ghlConcurrencyCap`, retried via the existing retry policy, OAuth refreshed via `integrationConnectionService`). Zero new infrastructure; only new endpoints.

For the two signals with no native API (staff activity, third-party integrations), the adapter does not expose dedicated "fetch" functions — it normalises GHL webhooks + polling deltas into the canonical tables defined in §§2.0b (`canonical_subaccount_mutations`) and 2.0c (`canonical_conversation_providers`, `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`). The skills `compute_staff_activity_pulse` and `scan_integration_fingerprints` then derive the observable signals from those canonical rows. No manual tagging path; no `subaccount_external_integrations` table.

### 2.3 OAuth scope audit

**Single source of truth:** `server/config/oauthProviders.ts` is the only place GHL scopes are declared. `server/routes/ghl.ts` currently hardcodes its own scope list (line 34) — this duplication is a bug: the `/api/ghl/oauth-url` endpoint must build its `scope=` query-string from `OAUTH_PROVIDERS.ghl.scopes` so any scope addition here takes effect in the live redirect without a second edit. Part of the Phase 1 OAuth update below is fixing that route to consume the config.

The current config at `server/config/oauthProviders.ts:52–56` declares only `contacts.readonly`, `contacts.write`, `opportunities.readonly`. The new endpoints require verifying and adding:

- `locations.readonly` — for `listAccounts` + `GET /locations/{id}` (likely already implicitly granted by the choose-location OAuth flow; confirm)
- `users.readonly` — for `/users/search`, `/users/location/{id}`
- `calendars.readonly` — **must be added**
- `funnels.readonly` — **must be added**
- `conversations.readonly` + `conversations/message.readonly` — for the derived staff-activity signal
- `businesses.readonly` — for location metadata details
- SaaS mode subscription scope (name TBC) — for `/saas/location/{id}/subscription`

Action: (a) refactor `server/routes/ghl.ts` to build its `scope=` query-string from `OAUTH_PROVIDERS.ghl.scopes`; (b) extend the scope list in `server/config/oauthProviders.ts` before the next `/integrations/ghl/connect` flow is run. Kel offered to facilitate a conversation with GHL to enable dev-tier API access; use that channel to confirm which scopes are available on the $97 agency tier vs $297 vs Agency Pro.

---

## 3. Multi-agency — one Synthetos org per GHL agency backend

### 3.1 Decision (reversed from prior draft)

Kel runs two completely separate GHL agency backends (SaaS ~90 clients + DFY ~90 clients), each with its own agency-level OAuth credential, each invisible to the other on the GHL side.

**We will NOT attempt to combine two GHL agency backends under a single Synthetos organisation.** Each GHL agency backend becomes a separate Synthetos org. This is the canonical shape — it matches how GHL itself models the boundary, avoids convoluted cross-agency data mixing, keeps RLS/tenancy boundaries clean, and preserves the existing `connector_configs` unique constraint on `(organisation_id, connector_type)`.

### 3.2 Implications for Kel

Productivity Hub would connect two Synthetos orgs:

- **Productivity Hub — SaaS** (its own org) → one GHL connector → ~90 sub-accounts
- **Productivity Hub — DFY** (its own org) → one GHL connector → ~90 sub-accounts

Kel would log into each org to triage each book of business separately. The SaaS org is where 100% of the churn-risk attention is focused anyway (DFY has near-zero churn). The DFY org is effectively a reporting surface for Kel's internal team.

### 3.3 Implications for the codebase

- **No schema change required.** Keep `connector_configs` unique on `(organisation_id, connector_type)`.
- **No `connectorInstanceLabel` column.**
- **No cross-agency filter chip on the dashboard.**
- `orgConfigService.getHealthScoreFactors()` / `getChurnRiskSignals()` stay keyed on `orgId` only — different weighting for SaaS vs DFY is achieved by the two orgs having different `hierarchyTemplates.operationalConfig` values, which is already how per-org configuration works.

### 3.4 Cross-org view (future, out of scope)

If Kel later wants a single "Productivity Hub Global" dashboard that rolls up both orgs, the canonical answer is an **agency-of-orgs** construct — a layer *above* the org. That is a much bigger product decision (affects billing, permissions, user model) and is explicitly deferred. For the ClientPulse build, one GHL agency = one Synthetos org.

### 3.5 Onboarding UX note

Kel's initial setup becomes two OAuth flows (one per GHL agency). This should be made obvious during the ClientPulse onboarding — e.g. copy that says "Each GHL agency backend becomes its own ClientPulse workspace. If you run multiple agency backends, connect each one separately."

---

## 4. Health score execution pipeline gaps

### 4.1 What exists

| Component | File | State |
|---|---|---|
| Health-score factors config (per-org, configurable) | `server/services/orgConfigService.ts:88–115, 185` | **Works.** `getHealthScoreFactors(orgId)` merges system defaults with org overrides via `hierarchyTemplates.operationalConfig` JSONB |
| Default factor weights (pipeline 0.30, engagement 0.25, contact growth 0.20, revenue 0.15, activity 0.10) | `DEFAULT_HEALTH_SCORE_FACTORS` in `orgConfigService.ts` | Seeded |
| `compute_health_score` skill (markdown) | `server/skills/compute_health_score.md` | Exists; takes `account_id`; declares output as HealthSnapshot |
| `compute_health_score` + `compute_churn_risk` handlers | `server/services/skillExecutor.ts:1269,1279` | Registered; delegate to `intelligenceSkillExecutor`; currently write to the generic `health_snapshots` / `anomaly_events` / `canonical_metrics` surfaces rather than a ClientPulse-shaped per-sub-account timeseries |
| Generic `health_snapshots` table | `server/db/schema/canonicalEntities.ts:175` (migration 0044) | Exists; keyed on `accountId`, not `subaccountId`; lacks `factorBreakdown` / `confidence` / `inputObservationIds` columns |
| Portfolio Health Agent (system agent, org-execution scope) | `migrations/0068_portfolio_health_agent_seed.sql:1–38` | Seeded in DB; master prompt defines 7-step monitoring loop; heartbeat enabled (4h) |
| Trajectory test asserting bulk health computation | `tests/trajectories/portfolio-health-3-subaccounts.json` | Declarative; asserts `compute_health_score` is invoked per-sub-account but the current handler does not execute in a per-sub-account fan-out job |
| Report aggregation endpoint | `server/routes/clientpulseReports.ts` + `server/services/reportService.ts` | Reads the most recent `reports` row of type `portfolio_health` |

### 4.2 What is missing

Five discrete gaps, all of which are "wire existing parts together" rather than "invent a new system":

1. **`health_snapshots` exists but is not a ClientPulse-shaped store.** `server/db/schema/canonicalEntities.ts:175` defines a generic `health_snapshots` table (migration 0044) keyed on `accountId`, not `subaccountId`, with no `factorBreakdown` / `confidence` / `inputObservationIds` columns. Decision to make: extend this table with ClientPulse columns, or add a dedicated `client_pulse_health_snapshots` timeseries. The rest of this doc assumes the latter (see §4.3, §9.4) — see R2 in §11.2 for the explicit source-of-truth statement.
2. **`compute_health_score` + `compute_churn_risk` handlers exist but are orphaned.** `server/services/skillExecutor.ts:1269,1279` registers handlers for both, delegating to `intelligenceSkillExecutor`. Nothing schedules them, and they target the existing `health_snapshots` (not the `client_pulse_*` tables proposed below). The gap is the scheduling + target-table alignment, not a missing handler.
3. **No per-sub-account scheduling.** `portfolioRollupJob.ts` runs Monday 08:00 / Friday 18:00 and aggregates *existing* data; it never initiates a health scan. There is no `computeHealthScoresJob` that enqueues one compute per active sub-account per scan window.
4. **No ingestion → scoring handoff.** Even if the scheduler fires, the scoring skill has no observations to read because §2 ingestion does not run.
5. **Portfolio Health Agent is heartbeat-enabled but has no real work path.** `migrations/0068_portfolio_health_agent_seed.sql` sets `heartbeat_enabled=true, heartbeat_interval_hours=4` (confirmed in §12.1). The remaining gap is that even when the heartbeat fires, there is no entitled-org → agent-instance instantiation path that hands the agent a concrete scan target (see gap #3 above).

### 4.3 Proposed canonical shape

Treat the health score as a deterministic composition over **signal observations**:

```
Signal observations       (timeseries, per subaccount, per signal slug)
      │
      ▼
compute_health_score      (skill; pulls N most-recent observations per factor;
                           applies orgConfigService weights; writes snapshot)
      │
      ▼
client_pulse_health_snapshots  (timeseries; one row per subaccount per scan)
      │
      ▼
Dashboard + churn evaluator + report generator read from here
```

Concretely:

- **Reuse** `orgConfigService.getHealthScoreFactors(orgId, connectorConfigId?)` — it already gives us the right abstraction.
- **Add** `client_pulse_signal_observations` table: `(organisationId, subaccountId, connectorConfigId, signalSlug, observedAt, numericValue, jsonPayload, sourceRunId)` — one row per (signal × sub-account × scan).
- **Add** `client_pulse_health_snapshots` table: `(organisationId, subaccountId, connectorConfigId, computedAt, overallScore, factorBreakdown JSONB, confidence, inputObservationIds JSONB)` — one row per scan per sub-account.
- **Add** `computeSubaccountHealthJob` (pg-boss) that fans out per `canonical_accounts` row after a successful connector poll. Retry policy + dedupe via `idempotencyKey = hash(subaccountId + connectorPollRunId)`.
- **Register** `compute_health_score` as a skill handler in `server/services/skillExecutor.ts` calling the new job's inner function.

### 4.4 Confidence / cold-start handling

The spec calls for "null / baseline-building until 14 data points accumulated". That is a property of the composite score, not each factor. Implement as: `overallScore = null, confidence = 'cold_start'` until `count(observations WHERE subaccountId=? AND observedAt > now() - interval '14 days') >= 14`. Store the boolean on the snapshot so the dashboard can show a muted-grey pill instead of a red/amber/green dot.

### 4.5 Why this shape is non-hardcoded

- Factor definition lives in `hierarchyTemplates.operationalConfig`, editable per org.
- New signals get a slug + a skill + an entry in `getHealthScoreFactors()` default config — no code branches.
- The scoring skill is generic over `HealthScoreFactor[]`; it does not know about "GHL" or "funnels" — it only knows `signalSlug`, `weight`, `normalisation`.
- Adding Kel's DFY-specific threshold is a per-connector-instance override on the same JSONB path, not a `if (agency === 'DFY')` branch.

### 4.6 Consolidated scoring formula (added 2026-04-18, per external review)

An external reviewer flagged that the formula is not consolidated in one place. This subsection is that consolidation — the algorithm is already implemented in code, this is the canonical reference.

#### 4.6.1 Data contract

**Input:** `HealthScoreFactor[]` from `getHealthScoreFactors(orgId)` (`server/services/orgConfigService.ts:28–34`) — array of `{ metricSlug, weight, label, periodType, normalisation: { type, minValue, maxValue, invertDirection } }`.

**Per-factor observations:** read from `canonical_metrics` / `canonical_metric_history` (filtered by `accountId` + `metricSlug` + `periodType`).

**Output:** `HealthSnapshot` row with `{ accountId, computedAt, overallScore: 0–100 | null, confidence: 'cold_start' | 'ok', factorBreakdown: [{ factor, score, weight }], inputObservationIds }`.

#### 4.6.2 Per-factor normalisation (four types, implemented at `server/services/intelligenceSkillExecutor.ts:19–44`)

Each factor's raw value is normalised to `score ∈ [0, 100]` via one of:

| Type | Formula | Use case |
|------|---------|----------|
| `linear` | `clamp((value - min) / (max - min), 0, 1) * 100` | Values where higher = healthier (e.g. pipeline velocity) |
| `inverse_linear` | `(1 - clamp((value - min) / (max - min), 0, 1)) * 100` | Values where lower = healthier (e.g. days-since-last-activity) |
| `threshold` | `value >= threshold ? 100 : 0` | Binary signals (e.g. calendar configured yes/no) |
| `percentile` | `rank(value, populationBucket) * 100` | Values compared against portfolio distribution (e.g. contact-growth rate vs peers) |

`invertDirection: true` applied on any type flips the output (`100 - score`).

#### 4.6.3 Composite formula + missing-data re-weighting

Implemented at `intelligenceSkillExecutor.ts:300–310`:

```
factorResults = [...only factors with observations present]
totalWeight   = sum(f.weight for f in factorResults)
overallScore  = round(sum(f.score * (f.weight / totalWeight) for f in factorResults))
```

**Rationale:** if a factor is missing (e.g. revenue signal absent because the client hasn't connected Stripe), the remaining factors re-normalise to still sum to 1.00. This means **two sub-accounts with the same data produce the same score deterministically**, and a sub-account with partial data produces a score that's still bounded `[0, 100]` and interpretable — it's the weighted average of the factors that *did* score.

#### 4.6.4 Cold-start cutover

Implemented at `intelligenceSkillExecutor.ts:281–293`:

```
if count(observations in last 14d) < minimumDataPoints (default 14):
   overallScore = null
   confidence = 'cold_start'
else:
   confidence = 'ok'
```

`minimumDataPoints` is configurable per factor via `ColdStartConfig` (`orgConfigService.ts:72–76`).

#### 4.6.5 Weight sum constraint

- **At rest (config):** `getHealthScoreFactors()` enforces sum-to-1.00 via validation on write (settings UI + Configuration Agent both reject non-conforming writes — §17.2.3 validation rules).
- **At runtime:** §4.6.3 re-weighting preserves the 1.00 sum over available factors, so the output is always on the same `[0, 100]` scale regardless of how many factors have data.

#### 4.6.6 Determinism guarantee

Given identical input observations + identical factor config, two scoring runs produce **byte-identical** snapshots:
- Normalisation is pure arithmetic on immutable observations.
- Weight re-normalisation is deterministic over the set of factors-with-data.
- Rounding is stable (`Math.round` → integer 0–100).

This satisfies the reviewer's "two identical clients score identically" concern. The formula is not probabilistic, not ML-trained, not path-dependent.

#### 4.6.7 Band mapping (see §5.4)

`overallScore → band` via configurable thresholds (`operational_config.churnBands`). Default: `Critical [0–19] · At Risk [20–39] · Watch [40–69] · Healthy [70–100]`. Band is recorded on the snapshot so drift in the band config doesn't retroactively reclassify history.

#### 4.6.8 Where the formula lives in code

| Component | File:line |
|-----------|-----------|
| Factor config loader | `server/services/orgConfigService.ts:28–34, 88–115` |
| Normalisation implementations | `server/services/intelligenceSkillExecutor.ts:19–44` |
| Missing-data re-weighting | `server/services/intelligenceSkillExecutor.ts:300–310` |
| Cold-start gate | `server/services/intelligenceSkillExecutor.ts:281–293` |
| Snapshot schema | `server/db/schema/canonicalEntities.ts:175–184` (`factorBreakdown` column) |

Any future change to scoring logic **must** update all five files plus this subsection in lock-step. Per CLAUDE.md rule "Docs Stay In Sync With Code."

---

## 5. Churn risk execution pipeline gaps

### 5.1 What exists

- `orgConfigService.getChurnRiskSignals(orgId)` (`orgConfigService.ts:195`) returns a per-org-configurable list of churn signals with weights + thresholds.
- Default signals hardcoded in `orgConfigService.ts:126–131`:
  - `health_trajectory_decline` (weight 0.30, 3-period trend)
  - `pipeline_stagnation` (weight 0.25, threshold 60 days)
  - `engagement_decline` (weight 0.25, threshold 30 days)
  - `low_health` (weight 0.20, threshold 40)
- `interventionOutcomes` table (`server/db/schema/interventionOutcomes.ts:9–36`) — stores `healthScoreBefore`, `healthScoreAfter`, `measuredAfterHours`, `outcome`.
- `interventionService.checkCooldown()` — enforces `cooldownHours` + `cooldownScope` ∈ {proposed, executed, any_outcome}.

### 5.2 What is missing

- **`compute_churn_risk` skill handler is registered but orphaned.** `server/services/skillExecutor.ts:1279` delegates to `intelligenceSkillExecutor`. The gap is that no ClientPulse-shaped durable surface exists for the output and no job schedules the evaluation per-sub-account.
- **No `client_pulse_churn_assessments` table.** Churn risk has no ClientPulse-shaped durable surface; today the intelligence executor writes into the generic canonical surfaces (`anomaly_events`, `canonical_metrics`) rather than a per-sub-account timeseries keyed on `subaccountId`.
- **No evaluator job.** Nothing consumes the configured signals and produces a per-sub-account score on a schedule.
- **Kel-specific signals not in the default set.** The four defaults focus on pipeline / engagement / health trajectory. Kel's brief adds at least three signals we do not model today:
  - `no_funnel_built` — binary
  - `contacts_and_email_only` — feature-breadth floor
  - `tier_downgrade_trend` — requires §2 signal #6 (tier history)
- **No band labels.** Spec leaves band labels/values undefined. Kel's brief proposes Healthy / Watch / At Risk / Critical with thresholds `70–100 / 40–69 / 20–39 / 0–19`. These are reasonable **defaults**, must be configurable per org.

### 5.3 Proposed canonical shape

Mirror the health-score pipeline one level downstream:

```
client_pulse_health_snapshots  +  client_pulse_signal_observations
                │
                ▼
compute_churn_risk   (skill; pulls signals per getChurnRiskSignals(org);
                      produces churn risk 0-100 + band label + driver list)
                │
                ▼
client_pulse_churn_assessments  (timeseries; one row per scan per subaccount)
                │
                ▼
Intervention proposer (§6) reads latest assessment per subaccount
```

New table: `client_pulse_churn_assessments(organisationId, subaccountId, connectorConfigId, assessedAt, riskScore, band, triggeringSignals JSONB, driverSummary TEXT, snapshotId FK)`.

Extend `DEFAULT_CHURN_RISK_SIGNALS` in `orgConfigService.ts` with the Kel-validated signals:

- `no_funnel_built` (weight 0.15, evaluator: `funnel_count == 0`)
- `feature_breadth_floor` (weight 0.10, evaluator: active feature count ≤ 3 of {contacts, email, calendar})
- `tier_downgrade_trend` (weight 0.15, evaluator: tier decreased in last 90 days)
- rebalance existing four signals accordingly

Defaults seeded via migration; each org can override via the per-org template UI (see §7).

### 5.4 Band definitions (default, configurable)

| Band | Score range | Visual | Dashboard behaviour |
|---|---|---|---|
| Healthy | 70–100 | Green | No surfacing |
| Watch | 40–69 | Amber | Appears in "watch list" widget |
| At Risk | 20–39 | Orange | Appears at top of dashboard; intervention proposer triggered |
| Critical | 0–19 | Red | Pinned top of dashboard; intervention proposer triggered + operator push notification |

Bands live in `hierarchyTemplates.operationalConfig.churnBands`. The classifier is a pure function over the numeric score and the configured bands — no hardcoded label anywhere.

### 5.5 Cold-start + null handling

If health-snapshot confidence is `cold_start`, skip churn scoring for that sub-account and record `assessment.band = 'insufficient_data'`. Dashboard renders a neutral icon.

---

## 6. Intervention workflow gaps

### 6.1 What the Starboys service does today (human analogue)

Kel pays $1,200/mo for monitoring + $1,200/mo DFY. The DFY workflow is:

1. Detect the problem in a client's GHL account.
2. Reach out to the client ("how are you going?").
3. Come back to Kel with the fix proposal.
4. Get Kel's approval.
5. Execute inside the client's GHL account.

This is exactly `Detect → Propose → Approve → Execute` — our HITL primitives already model this.

### 6.2 What exists

- `actions` table (`server/db/schema/actions.ts`) — fields: `actionType`, `actionCategory`, `gateLevel`, `status`, `idempotencyKey`, `suspendCount`, `suspendUntil`, `approvedBy`, `approvedAt`, `rejectionComment`. Supports the full proposed → pending_approval → approved → executing → completed lifecycle.
- `reviewItems` table — projects pending `actions` into a queue with `reviewPayloadJson` + `humanEditJson` + `reviewedBy` + `reviewedAt`.
- Action Registry (`server/config/actionRegistry.ts`) — registry pattern with `parameterSchema`, `idempotencyStrategy`, `scopeRequirements`, `topics`.
- `interventionOutcomes` table — outcome tracking (`healthScoreBefore/After`, `measuredAfterHours`, `outcome`).
- `interventionService.checkCooldown()` — deduplication by cooldown window.
- `memoryReviewQueue` — separate queue for belief conflicts / block proposals / clarification pending (**not** the same as intervention approvals; do not conflate).

### 6.3 What is missing

- **None of the 5 namespaced intervention primitives (§15.1) are registered** in `actionRegistry.ts`: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`. Without these there is no way to create an action row for an intervention. (Earlier drafts proposed a single `actionType: 'client_pulse_intervention'`; superseded by §15 + §27 C5.)
- **No scenario detector (proposer).** Nothing reads `client_pulse_churn_assessments`, picks a primitive, and writes the action row + review item. "Proposer" here means the automated scenario detector — it still writes HITL-gated `reviewItems`; operator approval remains the only execution path (§21.1, §27 I6).
- **No intervention template storage.** Kel's table (login ≥ 14d → check-in email, no funnels → 4-video nurture, calendar broken → setup guide, tier downgrade → retention call alert, CloseBot detected → AI Studio comparison, trial stalled → step-specific nudge) must live somewhere editable per org.
- **No outcome measurement loop.** `interventionOutcomes` exists but nothing schedules a "measure X hours after action.completedAt, write the outcome row".

### 6.4 Proposed canonical shape

> **Revised 2026-04-18 per Codex pass (C4).** Earlier drafts proposed a dedicated `client_pulse_intervention_templates` table and a single catch-all `actionType: 'client_pulse_intervention'`. Both are superseded:
> - **Intervention templates** (detection-pattern → suggested primitive mappings) fold into `operational_config.interventionTemplates[]` JSONB (editable per org via settings UI or Configuration Agent; no new table). Consistent with the "config-as-JSONB unless cardinality or relational needs demand a table" principle used elsewhere in this spec.
> - **Intervention rows** are `actions` rows with one of the 5 namespaced primitive `actionType`s from §15.1 — no parallel table, no parallel lifecycle.

**Intervention templates — `operational_config.interventionTemplates[]` shape:**

```jsonc
{
  "interventionTemplates": [
    {
      "slug": "dormant_staff_activity_checkin",
      "triggerSignalSlug": "staff_activity_pulse",
      "triggerCondition": { "op": "zero_activity_days_gte", "value": 14 },
      "suggestedPrimitive": "crm.send_email",
      "defaultParams": { "templateRef": "synthetos:check-in-v1" },
      "cooldownHours": 168,
      "cooldownScope": "any_outcome",
      "measurementWindowHours": 336
    }
    /* ... */
  ]
}
```

Seed Kel's six templates as **template-library defaults** on the `GHL Agency Intelligence` configuration template (§12.2); orgs can edit, disable, or add new ones via the settings UI or the Configuration Agent chat (both write to `operational_config` via the same skill — §17.3).

**Scenario-detector job** (new pg-boss job — `proposeClientPulseInterventionsJob`):

Runs after each churn assessment scan. For each sub-account:

1. Load `operational_config.interventionTemplates[]` (merged from template + org overrides).
2. For each template whose `triggerCondition` matches current observations + snapshot, check `interventionService.checkCooldown()`.
3. If cooldown clear, render `defaultParams` + canonical merge fields (§16) → create `actions` row with `actionType=suggestedPrimitive`, `gateLevel='review'`, and `metadataJson={ triggerTemplateSlug, triggerReason, bandAtProposal, healthScoreAtProposal, configVersion, recommendedBy: 'scenario_detector' }` → `reviewItems` row appears automatically via existing trigger/service.

**Outcome measurement job** (`measureInterventionOutcomeJob`, §23.3):

Runs hourly; for each action with `actionType IN (5 primitives)`, `status='executed'`, `executed_at > now() - 14d`, `outcome IS NULL` where `14d ≥ template.measurementWindowHours`: reads current health snapshot, compares to `metadataJson.healthScoreAtProposal`, writes `interventionOutcomes` row.

### 6.5 Action types to register (superseded)

The original list of 7 action types in this subsection is **superseded by §15.1** — the 5 namespaced primitives (`crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`). See §15.3 for the rationale and §27 C5 for the slug-collision avoidance. No ClientPulse-specific registry needed; all 5 land in `actionRegistry.ts` alongside existing primitives.

### 6.6 Why this is non-hardcoded

- Templates live in `operational_config` JSONB, editable per org via settings UI or Configuration Agent chat — one write path, one audit trail (§17.3).
- Trigger conditions are declarative JSONB, not code. Adding a new "if observation X meets predicate Y, propose Z" takes an array-append to `operational_config.interventionTemplates[]`, not a deploy.
- The scenario-detector job is generic over the template array — it does not know about login activity or CloseBot specifically.
- Per-org tuning is a straight `operational_config` override at the org level; per-template-family tuning is an edit on the master configuration template (sysadmin-only, §18).

---

## 7. Dashboard UI gaps

### 7.1 What exists

`client/src/pages/ClientPulseDashboardPage.tsx:41–72` — page is in the router, renders three widgets:

- Health summary card (totals: healthy / attention / at-risk).
- High-risk clients widget — **fetches `/api/clientpulse/high-risk` which returns `{clients: []}` with a TODO** (`clientpulseReports.ts:79`).
- Latest report card — shows the most recent `reports` row.
- Live updates wired via WebSocket `dashboard:update` room.

### 7.2 What is missing (against Kel's brief)

- **Full portfolio grid** ranked by churn risk, with sort + filter per column (per the project-wide ColHeader convention in `architecture.md`).
- **Per-client drill-down** — a route like `/clientpulse/subaccount/:id` showing the latest snapshot, the factor breakdown, the last 30 days of trend, recent anomalies, intervention history.
- **Tier-migration history chart** — requires `subaccount_tier_history` (see §2, signal #6).
- **"Sticky three" traffic-light** — *Last Activity / Funnel Count / Calendar Quality* rendered as three distinct pills per sub-account so Kel can scan. (Replaces the older "login recency" idea — §2.0b's Staff Activity Pulse is stronger. Pill thresholds: green ≤7 days, amber 7–14, red >14.)
- **Integration chips with usage intensity** — shows detected third-party integrations per sub-account; each chip renders `{integrationName · usageIndicator}` sourced from `integration_detections.usageIndicatorJson` (e.g. `CloseBot · 450 msgs/30d`, `Uphex · 3 active`). CloseBot / AI-category chips get a distinct colour. This captures Kel's "installed vs actually using" distinction without separate widgets.
- **Tier-migration arrow on the grid row** — if a sub-account's tier decreased in the last 90 days, render a red ↓ next to its current tier value on the portfolio grid row. Full tier-migration chart stays in the drill-down. Kel's strongest leading indicator (`$647 → $347 → $147`) is then visible at a glance without scrolling into drill-down.
- **Intervention queue widget** — embeds the relevant `reviewItems` (filtered by `action.actionType='client_pulse_intervention'`) directly on the dashboard with approve/reject inline. Kel's brief says "appear in the review queue with enough context to approve/reject in under 30 seconds".
- **Revenue-at-risk headline** — sum of MRR across Watch/At-Risk/Critical bands. Requires `subaccounts.monthly_revenue_cents` or equivalent.
- **Churn projection** — at current trajectory, projected lost clients this month. Requires the `interventionOutcomes` table to be populated so we can build a base rate.
- **Monday-morning email render** — same report in HTML form, delivered at 08:00 in the schedule's configured timezone (`scheduledTasks.timezone`; editable per schedule in settings). Note: there is no `organisations.timezone` column in V1 — delivery timezone is a per-schedule property. If multi-schedule orgs later need a canonical agency-level default, add `organisations.timezone` with an explicit migration (out-of-scope for V1 per Codex I10, see §27). Requirements: (a) each sub-account row is clickable and deep-links to its drill-down (`/clientpulse/subaccount/:id`), (b) a top banner surfacing any **band-change deltas** since last week ("3 newly At Risk, 1 recovered to Healthy"), (c) a pending-interventions count with a link to the queue, (d) a "View full dashboard" header link. Without deep links + delta banner the email is a dump; with them it's a launchpad Kel can act from.

Kel runs two Synthetos orgs per §3 (SaaS + DFY). Each org sends its own Monday email — no combining. If an org has zero attention-worthy accounts, suppress the email entirely (no "everything's fine" noise; the dashboard is always available if Kel wants to check proactively).

Per §3 we do **not** add an "Agency filter chip" — that was a vestige of the reverted multi-agency-per-org idea. Each GHL agency backend = its own Synthetos org, so the filter is implicit (pick the org; everything in view belongs to that agency backend).

### 7.3 Proposed canonical shape

Every widget is a pure view on canonical tables:

| Widget | Reads from |
|---|---|
| Portfolio grid | `client_pulse_health_snapshots` (latest per sub) + `client_pulse_churn_assessments` (latest per sub) + `subaccounts` |
| Drill-down | `client_pulse_signal_observations` + `client_pulse_health_snapshots` + `canonical_subaccount_mutations` + `actions` + `interventionOutcomes` |
| Tier-migration history (drill-down chart + grid arrow) | `subaccount_tier_history` |
| Sticky three — Last Activity | `subaccount_staff_activity_snapshots.last_activity_at` |
| Sticky three — Funnel count | `client_pulse_signal_observations` (signal='funnel_count') |
| Sticky three — Calendar quality | `client_pulse_signal_observations` (signal='calendar_quality') |
| Integration chips + usage badges | `integration_detections` (joined to `integration_fingerprints` for display name / icon; `usageIndicatorJson` for the badge text) |
| Intervention queue | `reviewItems` filtered by `actions.actionType = 'client_pulse_intervention'` |
| Revenue at risk | `subaccounts.monthly_revenue_cents` × churn bands |
| Churn projection | Historical outcomes from `interventionOutcomes` |
| Monday email | Same query as the grid + week-over-week band-change diff from `client_pulse_churn_assessments` history |

No ClientPulse-specific API endpoints beyond the ones already in `clientpulseReports.ts`. All data flows through existing services.

### 7.4 Table UX convention compliance

Per `architecture.md` client rules, every data table must use the `ColHeader` + `NameColHeader` components from `SystemSkillsPage.tsx`: sort + exclusion-set filter + indigo dot for active filters + "Clear all" button. The portfolio grid in §7.3 must comply.

### 7.5 Configuration UI gaps

No UI exists to edit health-factor weights, churn-signal thresholds, intervention templates, or churn bands. These live in `hierarchyTemplates.operationalConfig` JSONB; the plumbing works, but a Kel-usable editor does not. Scope a `ClientPulseConfigPage` for:

- Factor weights (sliders summing to 100%).
- Signal thresholds (numeric inputs with validation).
- Churn band cutoffs (four ranges, contiguous).
- Intervention templates (CRUD with trigger condition builder + action template editor + cooldown / measurement window inputs).
- (No cross-agency scope selector — per §3, each GHL agency backend is its own Synthetos org, so config edits apply to the whole org by definition. If an org later grows multiple connector instances under one org for an orthogonal reason, a `connectorConfigId`-scoped override selector can be added then.)

### 7.6 Intervention queue — overflow + quick-context discipline

Kel's "one-screen Monday morning" frame only works if the queue is short. Two affordances protect against runaway queue noise:

- **Dashboard widget caps at top-5 pending.** Any additional items surface behind a "+N more" link to a dedicated `/clientpulse/interventions` page. Sort by churn-risk band first, then age.
- **Proposer quotas enforced backend.** `hierarchyTemplates.operationalConfig.interventionDefaults.maxProposalsPerDayPerSubaccount` (default 1) and `maxProposalsPerDayPerOrg` (default 20) keep proposer output bounded. Already in §9.6 as a configurable.
- **Review-item render discipline.** Each queue card must include a single-sentence trigger summary ("No staff activity for 18 days; propose check-in email"), the three sticky-three pills for the sub-account, and approve/reject buttons — nothing else. If the payload is so large Kel has to scroll to decide, the proposer template is wrong. Enforce via a minimum-viable schema on `reviewItems.reviewPayloadJson` (`summary`, `evidence[]`, `proposedActionSummary`).

### 7.7 Cold-start rendering

During Phase 1–2 rollout, the dashboard loads but snapshots are sparse. Render skeleton placeholders on sticky-three pills and tier arrows until the relevant signal's `cold_start` flag clears (Phase 2 adds the flag per §4.4). Avoid the "empty dashboard" failure mode in the first week of data collection.

---

## 8. Trial monitoring (absent)

### 8.1 What Kel said

Kel stopped offering 14/30-day trials because ~99% of trial users churned — not because the trial concept is wrong but because there was no way to see whether onboarding milestones were being completed. He has:

- 4 one-on-one onboarding calls (mostly unbooked).
- A 25-email nurture sequence (largely ignored).
- SMS nudges (no visibility into whether the underlying steps got done).

Kel was explicit: with trial-progress monitoring + proactive nudges, he would **reintroduce trials**. This is a revenue-unlock feature, not just churn prevention.

### 8.2 What exists

Nothing in-code targets trial / onboarding progress. `onboardingBundleConfigs` exists (the canonical spec references Module D self-serve onboarding for the agency itself setting up ClientPulse), but it has no per-end-client onboarding milestone concept — nor should it conflate the two.

### 8.3 Proposed canonical shape

Model trial users as sub-accounts in a `trial` state, then track milestones as a first-class entity:

```
subaccount_onboarding_milestones(
  id,
  organisationId,
  subaccountId,
  connectorConfigId,
  milestoneSlug,         -- e.g. 'first_calendar_created', 'first_funnel_built',
                         --      'first_contact_imported', 'first_campaign_sent'
  completedAt,           -- nullable; NULL = pending
  evidence JSONB,        -- which observation confirmed it
  createdAt, deletedAt
)
```

Add a boolean on `subaccounts`: `isInTrial`, plus `trialStartedAt`, `trialEndsAt`.

Milestones are defined per org (so Kel's "first funnel" can be different from another agency's "first SMS campaign") via:

```
client_pulse_onboarding_milestone_defs(
  id, organisationId, connectorConfigId,
  slug, displayName,
  evaluatorSignalSlug,        -- e.g. 'funnel_count'
  evaluatorCondition JSONB,   -- e.g. {"op":">=","value":1}
  order,                      -- sort order in UI
  deletedAt
)
```

A new pg-boss job `evaluateOnboardingMilestonesJob` runs after each signal-observation scan, checks each trial sub-account against each milestone def, and upserts the milestone row.

### 8.4 Reuse of existing primitives

- Nudges = entries in `operational_config.interventionTemplates[]` (§6.4) with trigger condition like `{"op":"milestone_stalled_hours","slug":"first_funnel_built","value":72}`.
- Nudge actions = existing email / SMS / portal notification action types.
- HITL review = same `reviewItems` queue. Trial nudges may default to `gateLevel='auto'` to reduce Kel's review burden for low-risk nudges (decide per-org).
- Conversion event = milestone `trial_converted` satisfied when subscription moves off trial tier.

### 8.5 Why this is not a separate subsystem

Trial monitoring is a special case of the same signal-observation → rule → proposal → HITL pattern. No new queues, jobs, or action types — just a small schema addition and a few template rows. This is why §1.3 claims there is no sixth primitive.

---

## 9. Canonical taxonomy proposal (non-hardcoded)

This section consolidates every new canonical entity proposed above into a single taxonomy so Claude Code and future sessions can reason about ClientPulse as configuration over generic infrastructure.

### 9.1 New capability slugs (for `docs/integration-reference.md` + capability registry)

Each slug is declarative — it names a *read capability* of the GHL integration. Adding a new signal later = adding a slug + adapter function + skill row, no code branches.

```
ghl.read.staff_activity          # composite, derived (§2.0b)
ghl.read.funnels
ghl.read.calendars
ghl.read.users
ghl.read.integration_fingerprints  # composite, derived (§2.0c)
ghl.read.subscription_tier
ghl.read.ai_feature_usage
ghl.read.location_metadata         # already partially covered; formalise
```

These plug into the Orchestrator's capability routing (`docs/orchestrator-capability-routing-spec.md`) so when an agent asks "does this org have staff-activity data for sub-account X?", Path A / B / C / D resolves correctly.

### 9.2 New skill slugs (registered in `server/skills/` + executor in `server/services/skillExecutor.ts`)

```
compute_staff_activity_pulse   # per sub-account (§2.0b)
compute_funnel_coverage
compute_calendar_quality
scan_integration_fingerprints  # per sub-account (§2.0c)
compute_subscription_tier
compute_ai_feature_usage

compute_health_score           # handler already registered; needs ClientPulse-shaped target table
compute_churn_risk             # handler already registered; needs ClientPulse-shaped target table

propose_client_pulse_interventions   # scenario detector (writes HITL review items; never auto-executes — §21.1 / §27 I6)
measure_intervention_outcome          # outcome loop
evaluate_onboarding_milestones        # trial monitoring
```

### 9.3 New action types (registered in `server/config/actionRegistry.ts`)

```
client_pulse_intervention          # generic wrapper; payload references a template + target sub-account
create_task_for_operator           # general-purpose (if not present)
```

Existing action types reused without modification: `send_email_campaign`, `send_sms`, `send_portal_notification`.

### 9.4 New database tables

All tables below are **CRM-agnostic**. No column names reference GHL-specific field names or semantics. Adapters are responsible for populating canonical tables from CRM-specific data; skills read from canonical tables without knowing which CRM is upstream.

```
# ── CANONICAL artifact tables (populated by adapters; read by skills) ──
canonical_subaccount_mutations          # §2.0b: attribution-bearing mutation events,
                                        # normalised across all CRMs
canonical_conversation_providers        # §2.0c: distinct provider IDs observed per sub-account
canonical_workflow_definitions          # §2.0c: workflow definitions with action types + webhook targets
canonical_tag_definitions               # §2.0c: distinct tag names per sub-account
canonical_custom_field_definitions      # §2.0c: distinct custom field keys per sub-account
canonical_contact_sources               # §2.0c: distinct contact-source values

# ── DERIVED tables (written by skills; read by dashboard + churn evaluator) ──
client_pulse_signal_observations         # timeseries of raw signal values per subaccount
client_pulse_health_snapshots            # timeseries of composite scores per subaccount
client_pulse_churn_assessments           # timeseries of churn risk scores + bands per subaccount
subaccount_staff_activity_snapshots      # rollup of canonical_subaccount_mutations per scan
integration_detections                   # per-subaccount matched integrations + usage indicators
integration_unclassified_signals         # surfaced-once items for novel fingerprints
subaccount_tier_history                  # tier-migration timeseries
subaccount_onboarding_milestones         # per-subaccount completion state

# ── CONFIGURATION-LIBRARY tables (seeded per-CRM, extendable per-org) ──
integration_fingerprints                 # system + org scope; fingerprint library
# intervention-template library NOT a separate table: lives in
#   operational_config.interventionTemplates[]  (JSONB, per §6.4 / §27 C4)
client_pulse_onboarding_milestone_defs   # per-org, editable
```

**Naming rule enforced above:** no `canonical_*` or generic-scope table name references a CRM vendor, and no column name inside those tables uses CRM-vendor terminology. If a future PR adds a column named `ghl_*` or `leadconnector_*` to a canonical or derived table, it's a review blocker.

### 9.5 Existing tables extended (no new table needed)

```
subaccounts.isInTrial, trialStartedAt, trialEndsAt
subaccounts.monthly_revenue_cents           # if not already present
organisations.settings / hierarchyTemplates.operationalConfig  # new keys: churnBands, interventionTemplates
```

(Previously listed: `connector_configs.connectorInstanceLabel`. Removed — per §3, each GHL agency backend becomes its own Synthetos org, so the existing unique constraint on `(organisation_id, connector_type)` stays in place.)

### 9.6 Per-org configuration keys (all live in `hierarchyTemplates.operationalConfig` JSONB)

Generic keys — same shape across every CRM:

```
healthScoreFactors: HealthScoreFactor[]        # already exists
churnRiskSignals:   ChurnRiskSignal[]          # already exists
churnBands:         { healthy: [70,100], watch: [40,69], atRisk: [20,39], critical: [0,19] }
interventionDefaults: {
  cooldownHours, cooldownScope, defaultGateLevel, maxProposalsPerDayPerSubaccount
}
scanSchedule: { healthScanEveryMinutes, reportDeliveryCron }
onboardingMilestones: OnboardingMilestoneDef[]
```

CRM-specific keys — **values differ per CRM, key shape is constant:**

```
staffActivity: {                              # §2.0b — generic schema, values seeded per CRM
  countedMutationTypes: { type, weight }[]
  excludedUserKinds: UserKind[]
  automationUserResolution: { strategy, threshold, cacheMonths }
  lookbackWindowsDays: number[]
  churnFlagThresholds: { zeroActivityDays, weekOverWeekDropPct }
}

integrationFingerprints: {                    # §2.0c — generic schema, seedLibrary populated per CRM
  seedLibrary: {
    integrationSlug, displayName, vendorUrl,
    fingerprints: { type, value?, valuePattern? }[],
    confidence
  }[]
  scanFingerprintTypes: FingerprintType[]
  unclassifiedSignalPromotion: {
    surfaceAfterOccurrenceCount, surfaceAfterSubaccountCount
  }
}
```

All surfaced through `orgConfigService` with a new accessor per key (`getStaffActivityDefinition(orgId)`, `getIntegrationFingerprintConfig(orgId)`), following the existing `getHealthScoreFactors()` / `getChurnRiskSignals()` pattern.

### 9.7 Configuration templates per CRM type

The "GHL Agency" template is one row in `systemHierarchyTemplates`. When a new org onboards as a GHL agency, this template's `operationalDefaults` JSONB is copied into their `hierarchyTemplates.operationalConfig`, giving them the GHL-world defaults out of the box. They can override any key.

When HubSpot support ships, add a "HubSpot Agency" template with its own seedLibrary values, its own mutation-type list (HubSpot's event vocabulary), and its own automation-user heuristic. Zero code changes elsewhere.

### 9.8 New pg-boss jobs

```
ingestGhlSubaccountJob                  # per subaccount per poll window; fans out signal-specific sub-jobs
computeSubaccountHealthJob              # per subaccount per scan; writes snapshot
evaluateChurnRiskJob                    # per subaccount per scan; writes assessment
proposeClientPulseInterventionsJob      # per subaccount after each assessment
measureInterventionOutcomeJob           # scheduled for action.completedAt + measurementWindow
evaluateOnboardingMilestonesJob         # per trial subaccount per scan
```

Scheduling hooks into the existing `portfolioRollupJob` pattern — same pg-boss queue, same retry/idempotency conventions, registered in `server/jobs/index.ts`.

### 9.9 Orchestrator routing integration

When an operator asks "why is client X at risk?" in chat, the Orchestrator looks up capabilities via `list_platform_capabilities`. Because every signal we expose is a capability slug, the Orchestrator can answer:

- *Path A*: "Agent Y has `ghl.read.staff_activity` — here's the latest observation."
- *Path B*: "Platform supports `ghl.read.funnels` but this org hasn't configured it — Configuration Assistant can enable it."
- *Path C*: "Same as B but mark as system-promotion candidate because three other orgs have asked for it this week."
- *Path D*: "Platform does not yet support GHL call-recording sentiment. Logged as feature request."

This is the single most important reason to go non-hardcoded: every capability becomes a first-class object the Orchestrator can reason about.

---

## 10. Recommended build order

Six phases, each a discrete shippable slice. Every phase leaves the system in a working state and each later phase is unblocked by the one before it.

### Phase 0 — Template extension migration + OAuth scope update

(Replaces the prior "multi-agency unblock" phase — reverted per §3. Kel's two GHL agency backends become two Synthetos orgs; no schema change needed.)

- Migration: merge §12.2 Gap A JSONB into `system_hierarchy_templates` where `slug = 'ghl-agency-intelligence'` — adds `staffActivity`, `integrationFingerprints`, `interventionDefaults`, `churnBands`, `onboardingMilestones` keys.
- Extend `oauthProviders.ts` scope list per §12.2 Gap E.
- Add the five new `orgConfigService` accessors per §12.2 Gap B.

**Ship gate:** new/existing GHL Agency orgs load the extended template on onboarding; `orgConfigService.getStaffActivityDefinition(orgId)` returns the seeded JSONB without the caller providing defaults.

### Phase 0.5 — Playbook engine refactor for explicit org scope (per §13.3)

Runs in parallel with Phase 0, or immediately after it — independent of Phase 1 ingestion. Unblocks Phase 5 org-level playbooks.

- Schema migration: add `scope` enum column to `playbook_runs` and `system_playbook_templates` (default `'subaccount'`); make `playbook_runs.subaccount_id` nullable; add CHECK constraint enforcing `(scope='subaccount' AND subaccount_id IS NOT NULL) OR (scope='org' AND organisation_id IS NOT NULL AND subaccount_id IS NULL)`.
- Engine: `playbookEngine.startRun(definition, context)` accepts either scope; templating context resolves `run.entity` polymorphically; scheduler enqueues runs at the correct scope per `defaultSchedules.ts`.
- Permissions: add `playbook_runs.start@org` alongside existing `@subaccount`. RLS on `playbook_runs` updated to handle nullable subaccount_id.
- Step library small-scope updates: `publish_portal`, `send_email`, `aggregate_*` resolve targets from scope.
- Query helpers centralised: `listRuns({ scope, organisationId, subaccountId })`, `listClientRuns(orgId)` — callers never write the scope filter by hand.
- Backfill: no data change needed — every existing run defaults correctly to `scope='subaccount'`.

**Ship gate:** all existing sub-account playbooks continue to work unchanged; engine accepts `scope='org'` registrations; no org-level playbook yet exists but the substrate is ready. Estimated ~3.5 engineer-days.

### Phase 1 — Signal ingestion (adapter fetches + canonical mutation/fingerprint writes)

- Add the six adapter fetch functions from §2.2 in `ghlAdapter.ts`: `fetchFunnels`, `fetchFunnelPages`, `fetchCalendars`, `fetchUsers`, `fetchLocationDetails`, `fetchSubscription`.
- Extend webhook + polling normalisation to populate the canonical tables defined in §§2.0b–2.0c: `canonical_subaccount_mutations`, `canonical_conversation_providers`, `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`.
- Migration: `client_pulse_signal_observations`, `subaccount_tier_history`, plus the canonical tables above. No `subaccount_external_integrations` table — third-party detection is derived from the canonical fingerprint-bearing tables (§2.0c).
- Register new capability slugs (`ghl.read.staff_activity`, `ghl.read.funnels`, `ghl.read.calendars`, `ghl.read.users`, `ghl.read.integration_fingerprints`, `ghl.read.subscription_tier`, `ghl.read.ai_feature_usage`, `ghl.read.location_metadata`) in `docs/integration-reference.md`.
- Extend `connectorPollingService` to call new fetches per sub-account and write observations + canonical mutation/fingerprint rows.
- Webhook handler: add `INSTALL`/`UNINSTALL`/`LocationCreate`/`LocationUpdate`. Existing `ContactCreate` / `ContactUpdate` / `OpportunityStageUpdate` / `OpportunityStatusUpdate` / `ConversationCreated` / `ConversationUpdated` handlers extended to write `canonical_subaccount_mutations` rows per the adapter contract in §2.0b.
- OAuth scope audit + update (including the `server/routes/ghl.ts` SSoT fix per §2.3).

**Ship gate:** for a test agency, after a poll cycle, `client_pulse_signal_observations` has rows for all eight signals across every sub-account.

### Phase 2 — Health-score execution

- Migration: `client_pulse_health_snapshots`.
- Implement `computeSubaccountHealthJob` (pg-boss) that consumes observations + `orgConfigService.getHealthScoreFactors()` and writes a snapshot.
- Re-target the existing `compute_health_score` handler (`server/services/skillExecutor.ts:1269`) so it writes to `client_pulse_health_snapshots` instead of (or in addition to) the generic `health_snapshots` — see R2 in §11.2 for the source-of-truth statement.
- Cold-start + confidence logic.

**Ship gate:** trajectory test `portfolio-health-3-subaccounts.json` passes end-to-end.

### Phase 3 — Churn risk evaluation

- Migration: `client_pulse_churn_assessments`.
- Re-target the existing `compute_churn_risk` handler (`server/services/skillExecutor.ts:1279`) so it writes to `client_pulse_churn_assessments` keyed on `subaccountId`, and implement `evaluateChurnRiskJob` to schedule it per sub-account per scan window.
- Extend `DEFAULT_CHURN_RISK_SIGNALS` with Kel-validated additions (`no_funnel_built`, `feature_breadth_floor`, `tier_downgrade_trend`).
- Default churn bands seeded; configurable per org.

**Ship gate:** every sub-account has a churn assessment row with a band; dashboard high-risk widget no longer returns `[]`.

### Phase 4 — Intervention pipeline (action primitives + merge fields)

**Supersedes the earlier "six hardcoded intervention templates" plan** (see §15, decision D7).

- Register the **5 namespaced action-type primitives** (§15.1) in `actionRegistry.ts`: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`. These do **not** collide with the existing unprefixed `send_email` / `create_task` primitives, which retain their current direct-send / Synthetos-native-task semantics.
- **No parallel `client_pulse_interventions` table** (revised 2026-04-18 per Codex pass). ClientPulse interventions are **projections over the existing `actions` + `reviewItems` + `interventionOutcomes` substrate**, not a parallel lifecycle. A proposal lands as a row in `actions` with `actionType IN (5 namespaced primitives)`, `gateLevel='review'`, and a ClientPulse-specific `metadataJson` payload capturing: `{ triggerEventId, triggerReason, bandAtProposal, healthScoreAtProposal, configVersion, recommendedBy: 'scenario_detector' | 'operator' | 'chat' }`. Approval flows through `reviewItems`; execution through the skill executor; outcome measurement writes to `interventionOutcomes` (which already exists). No table duplication, no split source of truth.
- Build the **canonical merge field resolver** (§16): dot-path namespace resolver, JSON Schema for the namespace surface, `resolveMergeFields(template, context) → string`.
- Build the **5 action-primitive editors** in the client (one React component per primitive, routed from the propose-intervention modal):
  - `FireAutomationEditor` — live CRM automation dropdown (adapter-backed) + category filters.
  - `EmailAuthoringEditor` — subject/body compose, merge-field chip picker, stacked preview, "Send test to me".
  - `SmsAuthoringEditor` — 160-char body, merge-field chips, phone-bubble preview, test-send.
  - `CreateTaskEditor` — title/notes/assignee/priority/due, CRM-task-card preview.
  - `OperatorAlertEditor` — severity/recipients/channels/CTA, in-app preview, recipient tray integration.
- **Skill: `crm.fire_automation`** — calls adapter's `enrolInAutomation(contactId, automationId)` for whichever CRM the sub-account uses.
- **Skill: `crm.send_email`** — resolves merge fields, calls adapter's `sendEmail(contactId, subject, body)` (CRM-dispatched, preserves sending domain). Distinct from the existing unprefixed `send_email` which sends via a connected Synthetos email provider directly.
- **Skill: `crm.send_sms`** — resolves merge fields, calls adapter's `sendSms(contactId, body)`.
- **Skill: `crm.create_task`** — calls adapter's `createTask(contactId, title, notes, assignee, priority, dueAt)`. Distinct from the existing unprefixed `create_task` which creates a Synthetos-native task on the agent task board.
- **Skill: `clientpulse.operator_alert`** — writes to `operator_alerts` table + emits in-app notification + optional email + Slack via existing integration.
- Wire all 5 primitives to `interventionService.checkCooldown` and existing `actions`/`reviewItems` (HITL gate).
- Outcome signal: **band-change only in v1** (§21.2). A fired intervention that sees a band improvement within 14 days is counted as "worked"; no webhook attribution.
- Implement `proposeClientPulseInterventionsJob` (detects scenarios → creates proposal review-items) and `measureInterventionOutcomeJob` (14-day band-change watcher).
- Build the **propose-intervention modal** (step 1: pick primitive; step 2: "Configure [action] ↗" button opens the relevant editor).
- Seed a small set of template-level "detection-pattern → suggested primitive" hints (configurable per template) so the proposer can default the primitive choice but the operator always picks.

**Ship gate:** simulated declining sub-account produces a review-queue item; operator picks primitive 2 (send email), composes with canonical merge fields, hits "Send test to me" (arrives correctly rendered), approves the real send, adapter dispatches via client CRM, audit row recorded. Band-change observed 14 days later is correctly attributed as the intervention outcome.

### Phase 4.5 — Configuration Agent extension (NEW — §17)

Runs in parallel with Phase 5 UI work once the operational_config JSON Schema from Phase 0 is locked.

- **Capability slugs** in `docs/capabilities.md` (Support-facing catalogue): `clientpulse.config.read|update|reset|history`.
- **Pseudo-integration entry** in `docs/integration-reference.md`: `clientpulse_configuration` block (§17.2.2).
- **Skill:** `server/skills/config_update_hierarchy_template.md` + registration in `actionRegistry.ts` + `skillExecutor.ts`. JSON-Schema-validated merge-update on `operational_config`; writes audit rows to **existing** `config_history` table (no new audit table — revised 2026-04-18 per Codex pass, see §17.2.6).
- **Migration:** none needed for the audit log — `config_history` already exists.
- **Orchestrator routing:** add row to `docs/orchestrator-capability-routing-spec.md` for `clientpulse.config.*`. Keywords + context signals + structural signals.
- **Configuration Assistant spec update:** add mutation tool #16 (`update_clientpulse_config`), move ClientPulse from out-of-scope to in-scope v2, add conversation examples matching the chat popup mockup.
- **UI:** chat popup component (global, opens from settings callouts / global nav / ⌘K). Confirm-before-write card pattern matching existing Configuration Agent.

**Ship gate:** sysadmin (seeded with test prompt) types "bump pipeline velocity weight to 0.35" in chat; Orchestrator routes to Configuration Agent; agent presents confirm card with before/after diff; operator confirms; skill writes to operational_config; `config_history` row recorded (entity_type='clientpulse_operational_config'); next-scan banner shown; settings page reflects the new value on refresh.

### Phase 5 — Dashboard + briefings + configuration UI + admin surfaces

- **Portfolio grid** (`dashboard.html`) with Google-Sheets-style ColHeader sort/filter, interactive filter chips, band column as first-class sortable, aggregate trend chart, intervention-queue widget.
- **Per-client drilldown** (`drilldown.html`) route `/clientpulse/subaccount/:id` with humanised signal names (no technical slugs, per U17).
- **Propose-intervention modal** (`propose-intervention.html`) with 5 primitive cards + "Configure [action] ↗" routing to editors.
- **Inline-edit one-click override** (`inline-edit.html`) from blind-spot patterns — dropdown menu + toast, routes through Configuration Agent skill for the actual write.
- **Settings page** (`settings.html`) with section editors + Configuration Assistant callout + saved email templates section.
- **Operator alert recipient tray** (`operator-alert-received.html`) — in-app notification tray with expand/take-action/acknowledge/snooze/dismiss.
- **Monday Intelligence Briefing** (org-level `intelligence-briefing.html` + per-client `briefing-per-client.html`) — forward-looking (§13.5). Add `render_portfolio_health_section_briefing` step to both playbooks with `skipWhen` gating.
- **Friday Weekly Digest** (org-level `weekly-digest.html` + per-client `digest-per-client.html`) — backward-looking (§13.5). Add `render_portfolio_health_section_digest` step to both playbooks.
- **Build org-level playbooks (NEW — §13.3):** create `server/playbooks/intelligence-briefing-org.playbook.ts` and `server/playbooks/weekly-digest-org.playbook.ts`. Both declare `scope: 'org'` (requires Phase 0.5 engine refactor). Both ship with ClientPulse render step (`skipWhen` guarded).
- **Seed all four playbooks** into `system_playbook_templates` (new seed migration).
- **Portfolio Rollup deprecation path (§13.3):** `portfolioRollupJob.ts` continues during transition; deprecate once org-level playbooks are stable.

**Ship gate:** Kel can open the dashboard, see all 180 clients ranked, drill into any one, approve or reject a proposed intervention (via any of the 5 primitives), and configure via either the settings UI or chat — all without touching code. Monday briefing + Friday digest arrive org-level AND per-client with Portfolio Health sections populated.

### Phase 5.5 — System-admin surfaces + onboarding (NEW — §§18, 19)

- **Template editor modal** (`template-editor.html`) — full 10-section left-nav editor with per-section dirty-state badges, staged-edits banner, atomic save-across-sections, change-log view.
- **Sysadmin create-org flow** (`onboarding-sysadmin.html`) — org metadata + template picker with Edit ↗ integration + required operator inputs + invite admins + atomic provision.
- **Orgadmin first-run flow** (`onboarding-orgadmin.html`) — 4-screen guide: welcome → connect CRM → map pilot clients → set.
- **Config Templates admin page** (list view for sysadmins) — linked from sysadmin nav; routes to template editor modal on row click.
- **Audit log view over `config_history` filtered to `entity_type='clientpulse_operational_config'`** — filters by path, change_source (ui/api/config_agent/system_sync/restore); clickable rows route to template editor with the relevant section pre-selected.

**Ship gate:** sysadmin can create a new org from scratch picking a template (with optional in-flight edits), org admin receives invite, completes first-run, connects CRM, selects pilot sub-accounts, and lands on a populated dashboard within 24 hours.

### Phase 6 — Trial monitoring (post-launch)

- Migrations + job as described in §8.
- Seed default milestones.
- Reuse `operational_config.interventionTemplates[]` (§6.4) for milestone-stalled nudges — no new table.
- UI: trial-cohort filter on dashboard.

**Ship gate:** Kel reintroduces the 14-day trial knowing stalled users get auto-nudged with his approval.

### Rough sizing (not commitments)

| Phase | Scope | Ballpark |
|---|---|---|
| 0 | Schema relax + polling scope | Small |
| 0.5 | Playbook engine refactor for explicit org scope (§13.3) | Small–Medium |
| 1 | Six adapter fns + two tables + webhook events | Medium |
| 2 | Scoring job + snapshot table + skill registration | Small–Medium |
| 3 | Churn evaluator + band config + defaults | Small |
| 4 | 5 action primitives + 5 editor components + merge-field resolver + outcome loop | Medium–Large |
| 4.5 | Configuration Agent extension (5 concrete additions, §17) | Small–Medium |
| 5 | Dashboard + drilldown + briefings/digests + settings + alert tray | Medium–Large |
| 5.5 | Template editor + create-org + first-run + audit log view | Medium |
| 6 | Trial monitoring | Small–Medium |

---

## 11. Cross-reference to existing specs + open questions

### 11.1 How this doc relates to existing specs

- `docs/clientpulse-dev-spec.md` — canonical, 1899 lines, seven modules A–G. This gap-analysis **does not replace** it; it identifies where that spec's assumptions miss Kel-validated pain and where implementation has not caught up. Specifically: the dev spec's Module C ("GHL data connector completion") needs the §2 signal expansion; Module B ("ClientPulse agent") needs the §4+§5 executor wiring; Module E ("Dashboard") needs the §7 widgets.
- `docs/clientpulse-ghl-dev-brief.md` — older 668-line brief, largely superseded by the dev spec. Still useful for the customer-facing framing.
- `tasks/ghl-agency-{development-brief, value-proposition, feasibility-assessment, interview-brief}.md` — pre-Kel framing work. Feasibility assessment claims "~85% of platform already built" for the ClientPulse-adjacent infrastructure; this audit confirms that for the *substrate* (subaccounts, actions, reviewItems, orgConfig, hierarchy templates, pg-boss) but finds the *pipeline* (ingestion → scoring → proposal → approval → outcome) is <25% wired.
- `docs/orchestrator-capability-routing-spec.md` — ClientPulse capability slugs plug directly into its four-path routing model. This doc's §9 taxonomy is a direct contribution to the Orchestrator's capability registry.
- `docs/capabilities.md` — will need updates in the same commit as any Phase 1 / Phase 2 / Phase 4 change, per the global playbook rule ("Docs Stay In Sync With Code"). Customer-facing sections must remain vendor-neutral.

### 11.2 Conflicts / contradictions found

- **Agent count drift.** `tasks/ghl-agency-development-brief.md` proposes a three-agent model (Orchestrator + BA Agent + Portfolio Health Agent). The dev spec uses a one-agent model (Reporting Agent, org-scoped). The seeded Portfolio Health Agent in migration 0068 is org-execution-scope, matching the one-agent model. **Pick one and make it canonical.** Recommendation: keep the one-agent model; the Orchestrator is already the system-level agent, the Portfolio Health Agent is the org-level executor.
- **HITL queue confusion.** `memoryReviewQueue` is for belief conflicts / block proposals / clarification pending. `reviewItems` is the projection of pending `actions`. ClientPulse interventions go through `reviewItems`, not `memoryReviewQueue`. The current dev spec is ambiguous on this; clarify in Module B.
- **Spec status on shipped phases.** The dev spec has no phase marked "shipped". Migrations (0068, 0087, 0096), the `clientpulseReports.ts` routes, and `ClientPulseDashboardPage.tsx` are partial implementations of the spec's ambitions — but none of them is end-to-end useful. Update the spec's phase tracker with honest status.

### 11.3 Decisions recorded from Kel's follow-up (2026-04-17)

These are baked-in design commitments from Kel's response to the first round of open questions. Reflected throughout §§1–10 and §12 where relevant.

| # | Decision | Consequence |
|---|---|---|
| **D1** | **Replacement scope = full Starboys service (~$2,400/mo equivalent), not just the $1,200 monitoring half.** ClientPulse must replace both the monitoring arm *and* the done-for-you execution arm. | Phase 4 intervention pipeline must include agency-branded outbound email/SMS actions with Kel's one-click approval (not just operator-facing tasks). Full intervention template library in §6 is in scope, not optional. |
| **D2** | **Calendar quality signal = enabled for all GHL Agency configurations (SaaS and DFY).** | No per-org conditional in the default `staffActivity`/health-factor config; the GHL Agency Intelligence template enables calendar-quality across the board. |
| **D3** | **Intervention proposer = enabled by default for every GHL Agency configuration, including DFY.** The VAs managing DFY clients will use the proposer queue as a work surface. | DFY orgs are not a special case in the default template. Proposer output per sub-account per day governed by `maxProposalsPerDayPerSubaccount` (configurable). |
| **D4** | **Trial onboarding milestone library (Phase 6 default):** `first_calendar_created` / `first_funnel_built` / `first_contact_imported` / `first_campaign_sent` / `first_automation_published` — accepted as the default set, start here. | Phase 6 seed migration populates these five as the default `client_pulse_onboarding_milestone_defs` rows; orgs can add/remove per org. |
| **D5** | **Billing: cost per Synthetos org.** An agency owner running multiple GHL agency backends (Kel: SaaS + DFY) will have two separate Synthetos orgs and receive two separate invoices. No "sibling orgs" billing-level linking. | §3 stance reinforced. No composite-invoice or cross-org discount logic. Onboarding UX copy remains: "Each GHL agency backend becomes its own ClientPulse workspace." |
| **D6** | **ClientPulse will be sold in two subscription tiers, anchored to Starboys pricing:** a **Monitor tier** (read-only portfolio monitoring + briefings/digests, anchored ~$1,200/mo) and an **Operate tier** (everything in Monitor + intervention proposer + HITL execution + outcome measurement, anchored ~$2,400/mo). See §12.4 for the tier feature split. | The existing `modules` + `subscriptions` schema (migration 0104) already supports per-module subscription rows; we extend with tier-level entitlements rather than adding a new entitlement system. |

#### Additional decisions from 2026-04-18 mockup review (D7–D14)

| # | Decision | Consequence |
|---|---|---|
| **D7** | **Intervention = pick one of 5 CRM-agnostic action primitives, not a hardcoded playbook template.** Primitives: `fire_automation`, `send_email`, `send_sms`, `create_task`, `operator_alert`. See §15. | Replaces the earlier Phase 4 plan to seed "Kel's six templates". `actionRegistry.ts` registers 5 primitives; CRM-specific logic lives in adapter layer. The proposer surfaces detection patterns + suggested primitive, operator picks + configures. No "4-video funnel-setup nurture"-style content shipped in Synthetos. |
| **D8** | **Email + SMS composed in Synthetos, dispatched via client's CRM.** Preserves the agency's sending-domain authentication + SMS provider contracts. | Adapter functions `sendEmail(contactId, subject, body)` and `sendSms(contactId, body)` become CRM-specific primitives with identical signatures across adapters. Synthetos never runs its own SMTP or SMS gateway for outbound. |
| **D9** | **Canonical merge fields (`{{contact.firstName}}`, `{{signals.healthScore}}`, etc.) for all authored content.** Resolved in Synthetos before CRM dispatch — the CRM receives a fully-rendered string. See §16. | Merge-field resolver service built in Phase 4; JSON Schema for the namespace surface. V1 grammar is strict (no fallback syntax, no conditionals). |
| **D10** | **Outcome signal = band-change only in V1.** No webhook-based attribution (open rate, reply rate, booked-call rate) until V2. See §21. | `measureInterventionOutcomeJob` watches for a band improvement within 14 days of intervention dispatch and attributes it. Keeps V1 scope tight. |
| **D11** | **Configuration Agent extended to cover ClientPulse config (site-wide chat surface).** Same chat popup handles agents, schedules, skills, ClientPulse config, integrations. See §17. | Five concrete additions (§17.2): `clientpulse.config.*` capability slugs, `clientpulse_configuration` pseudo-integration, `config_update_hierarchy_template` skill, orchestrator routing row, Configuration Assistant spec update. Audit reuses **existing** `config_history` table with `entity_type='clientpulse_operational_config'` — no new audit table. |
| **D12** | **Template editor stages edits across all tabs until Save is pressed; Save is atomic; Cancel discards all.** See §18.3. | Template editor component uses local state + dirty-state tracking per section. One transaction writes all changed paths on save, producing a grouped batch of `config_history` rows sharing the same `session_id`. |
| **D13** | **Org admins cannot create or fork templates in V1 — only override at the org level.** Templates are a sysadmin-vetted asset. See §18.6. | No "fork template" UI in V1. Template creation API is sysadmin-only. V2 may introduce forking if demand emerges. |
| **D14** | **All user-facing copy uses humanised labels, never canonical slugs.** Comprehensive snake_case audit performed across all 20 mockups. See U17. | UI layer applies a `humanise(slug)` helper for any label derived from a canonical identifier. New UI features must pass a no-snake-case regex check in code review. |
| **D15** | **Google-Sheets-style column headers on all data tables** (click-to-sort, filter dropdown on categorical columns). See U1 + architecture rule for Tables. | Matches the existing `SystemSkillsPage.tsx` pattern (`ColHeader` + `NameColHeader`). Extend the pattern to the portfolio grid, intervention queue, and audit log view. |
| **D16** | **Config Assistant chat is site-wide, not ClientPulse-specific.** Opens from any settings callout, global nav, or ⌘K hotkey. | Chat popup component lives at the app-shell level, not under `/clientpulse/`. Initial context is scoped from the page that launched it but the conversation can span any configurable surface. |
| **D17** | **Tasks from Primitive 4 live in the client's CRM, not a Synthetos task board.** Synthetos task board is for AI-agent work. | `create_task` adapter function writes to CRM task object (GHL task, HubSpot task, etc.). No Synthetos-side task record for operator work. |

### 11.4 Open questions for Kel (second round)

Three questions carried over from the first round, plus two new questions derived from D1 and D6.

**🛑 Still blocking Phase 1 implementation:**

1. **Does the "Staff Activity Pulse" framing map to your mental model?** GHL doesn't expose login data via its public API and we're not building UI scraping. Instead we'd derive a "has real work happened in this sub-account recently" score from staff-attributed mutations (contact edits, opportunity stage changes, outbound messages sent by team users, notes, task completions, workflow/funnel/calendar edits). See §2.0b for the full derivation. Is this aligned with how you triage "is this account alive?", or is there a case where raw logins matter independent of whether anything got done?

2. **Name the third-party integrations we should ship fingerprints for on day one.** You already named CloseBot and Uphex. We want 5–10 more common integrations so the scanner auto-detects them across your portfolio from day one. After that the system learns from data (novel integrations surface as one-click "what is this?" prompts, classified once, applied retroactively). Ten-minute ask.

3. **GHL dev-tier API access — two sub-asks for your GHL contact:**
   (a) Which OAuth scopes are available on the $97 / $297 / Agency Pro tiers? We specifically need `calendars.readonly`, `funnels.readonly`, `users.readonly`, plus the SaaS subscription scope (`GET /saas/location/{id}/subscription`).
   (b) Is a public audit-log / login-activity endpoint on GHL's roadmap, and on what timeline? This determines whether our Staff Activity Pulse is permanent architecture or a bridge.

**🟡 New questions derived from your decisions:**

4. **Tier feature split (derived from D6).** Proposed default tier definitions below — confirm or tweak:
   - **Monitor tier (~$1,200 anchor):** portfolio dashboard, per-client drill-down, health score computation, Staff Activity Pulse, Integration Fingerprint Scanner, churn risk assessment, Intelligence Briefing + Weekly Digest (both org and per-client), anomaly alerts. **Read-only — no intervention proposer.**
   - **Operate tier (~$2,400 anchor):** everything in Monitor plus the intervention proposer, HITL approval queue, action execution (agency-branded email / SMS / tasks), intervention outcome measurement loop, and the full editable intervention template library.
   Does that split match your framing? Any specific feature you'd move from one tier to the other?

5. **Intervention template library (derived from D1).** For full Starboys replacement, Phase 4 ships a default library of six intervention templates that can send on behalf of the agency brand with your one-click approval:
   - `dormant_staff_activity_checkin` — staff activity ≥14 days silent → email check-in to client
   - `no_funnel_nurture` — 0 funnels built → 4-video funnel-setup nurture sequence
   - `calendar_setup_guide` — calendar quality below threshold → setup guide + optional VA-help offer
   - `tier_downgrade_retention_alert` — tier decreased in last 90 days → operator task (retention call)
   - `third_party_ai_upsell` — CloseBot or similar detected → comparison info for native GHL AI + upsell
   - `trial_milestone_nudge` — trial user stalled on a milestone → specific nudge per incomplete step
   Are these the right six to ship by default? Any you'd add or cut? Any specific copy constraints we should respect (tone, signoff, format)?

**⏳ Tracking only — no answer needed:**

6. **Philippines government tender.** Separate workstream. If Productivity Hub wins, the platform becomes the operations layer at government scale. No action required here; just flagging that we're tracking it.

### 11.5 Success criteria (how we know we shipped ClientPulse for Kel)

1. Kel has one screen showing all ~180 sub-accounts across both GHL backends (via two Synthetos orgs), ranked by churn risk, updated daily.
2. At least 80% of the `$2,400/mo` Starboys value is replaced by the Monitor + Operate-tier pipeline, validated by Kel actually cancelling Starboys or renegotiating down.
3. Churn rate drops by ≥25% within 90 days of ClientPulse going live, vs the 6-month trailing average.
4. Kel reintroduces trials (Phase 6 success).
5. All configuration (weights, thresholds, templates) is editable via UI with zero engineering intervention.

---

---

## 12. Current state of the GHL Agency seed + required template extension

### 12.1 What exists today (confirmed by audit)

**System agent — `portfolio-health-agent`** (`migrations/0068_portfolio_health_agent_seed.sql:1–38`):

- `execution_scope = 'org'`, `execution_mode = 'api'`, `agent_role = 'analyst'`, `agent_title = 'Portfolio Health Analyst'`
- `heartbeat_enabled = true`, `heartbeat_interval_hours = 4`
- `default_token_budget = 50000`, `default_max_tool_calls = 30`, `is_published = true`
- Master prompt outlines the 7-step monitoring loop (read metrics → compute scores → detect anomalies → evaluate churn → generate alerts → propose interventions → write org insights) — consistent with the rest of this doc.

**System hierarchy template — `GHL Agency Intelligence`** (same migration, lines 41–95):

- `required_connector_type = 'ghl'`, `is_published = true`, slug `ghl-agency-intelligence` (backfilled by migration 0104)
- `operational_defaults` JSONB includes: `healthScoreFactors` (5 factors, 1.00 total), `anomalyConfig`, `churnRiskSignals` (4 signals, 1.00 total), `interventionTypes` (4 types with gate levels + cooldowns), `alertLimits`, `coldStartConfig`, `scanFrequencyHours: 4`, `reportSchedule: {dayOfWeek: 1, hour: 8}` (Monday 08:00), `dataRetention`, plus execution-scaling knobs.
- `memory_seeds_json` pre-loads one belief: "This organisation manages a portfolio of client accounts…"
- `required_operator_inputs` declares three inputs: `ghl_oauth` (required), `alert_email` (required), `slack_webhook` (optional).

**Module entitlement — `client_pulse`** (`migrations/0104_*`):

- `modules` table row for `client_pulse`
- `subscriptions` + `orgSubscriptions` tables for per-org entitlement state
- `moduleService.getAllowedAgentSlugs(orgId)` returns `portfolio-health-agent` when the module is active

### 12.2 What is missing to make ClientPulse work out-of-the-box

Every gap is either a single migration (config extension or new tables) or code (accessors, executors, job wiring). Nothing requires schema redesign.

**Gap A — Template operationalDefaults missing two new config blocks (§2.0b + §2.0c).**

Required migration: `UPDATE system_hierarchy_templates SET operational_defaults = operational_defaults || '{...}'::jsonb WHERE slug = 'ghl-agency-intelligence';` — merge in:

```jsonc
{
  "staffActivity": {
    "countedMutationTypes": [
      { "type": "contact_created",           "weight": 1.0 },
      { "type": "contact_updated",           "weight": 0.5 },
      { "type": "opportunity_stage_changed", "weight": 2.0 },
      { "type": "opportunity_status_changed","weight": 1.5 },
      { "type": "message_sent_outbound",     "weight": 1.5 },
      { "type": "note_added",                "weight": 1.0 },
      { "type": "task_completed",            "weight": 1.0 },
      { "type": "workflow_edited",           "weight": 3.0 },
      { "type": "funnel_edited",             "weight": 3.0 },
      { "type": "calendar_configured",       "weight": 2.0 }
    ],
    "excludedUserKinds": ["automation", "contact", "unknown"],
    "automationUserResolution": {
      "strategy": "outlier_by_volume",
      "threshold": 0.6,
      "cacheMonths": 1
    },
    "lookbackWindowsDays": [7, 30, 90],
    "churnFlagThresholds": { "zeroActivityDays": 14, "weekOverWeekDropPct": 50 }
  },
  "integrationFingerprints": {
    "seedLibrary": [
      { "integrationSlug": "closebot", "displayName": "CloseBot", "vendorUrl": "https://closebot.ai",
        "fingerprints": [
          { "type": "conversation_provider_id",  "valuePattern": "^closebot:"  },
          { "type": "workflow_action_type",      "valuePattern": "^closebot\\." },
          { "type": "outbound_webhook_domain",   "value":        "api.closebot.ai" },
          { "type": "custom_field_prefix",       "valuePattern": "^closebot_"   },
          { "type": "tag_prefix",                "valuePattern": "^closebot:"   }
        ],
        "confidence": 0.95 }
      // Add more (Uphex, etc.) once Kel names them on the follow-up call.
    ],
    "scanFingerprintTypes": [
      "conversation_provider_id","workflow_action_type","outbound_webhook_domain",
      "custom_field_prefix","tag_prefix","contact_source"
    ],
    "unclassifiedSignalPromotion": { "surfaceAfterOccurrenceCount": 50, "surfaceAfterSubaccountCount": 3 }
  },
  "interventionDefaults": {
    "cooldownHours": 48,
    "cooldownScope": "executed",
    "defaultGateLevel": "review",
    "maxProposalsPerDayPerSubaccount": 1,
    "maxProposalsPerDayPerOrg": 20
  },
  "churnBands": { "healthy": [70,100], "watch": [40,69], "atRisk": [20,39], "critical": [0,19] },
  "onboardingMilestones": []   // seeded empty; Phase 6 populates
}
```

**Gap B — `orgConfigService.ts` accessor gaps.**

Existing: `getHealthScoreFactors`, `getAnomalyConfig`, `getChurnRiskSignals`, `getInterventionTypes`, `getAlertLimits`, `getColdStartConfig`, `getDataRetention`, `getExecutionScalingConfig`.

Required additions:

```ts
getStaffActivityDefinition(orgId): StaffActivityDefinition
getIntegrationFingerprintConfig(orgId): IntegrationFingerprintConfig
getChurnBands(orgId): ChurnBands
getInterventionDefaults(orgId): InterventionDefaults
getOnboardingMilestoneDefs(orgId): OnboardingMilestoneDef[]
```

Each follows the existing pattern: system default → template override → org override.

**Gap C — Canonical + derived tables (listed in §9.4).** No existing migration creates them. One migration creates all six.

**Gap D — Skill executors + action registry entry + pg-boss jobs.** See §9.2, §9.3, §9.8. All already enumerated; no architectural novelty.

**Gap E — OAuth scopes.** `server/config/oauthProviders.ts:52–56` only declares three scopes. Missing: `locations.readonly`, `users.readonly`, `calendars.readonly`, `funnels.readonly`, `conversations.readonly`, `conversations/message.readonly`, `businesses.readonly`, SaaS-subscription scope. Code change, not migration.

### 12.3 Verdict

The ClientPulse module is about **65% scaffolded** out of the box for a GHL agency today. The agent is seeded, the hierarchy template is seeded with the foundational health / churn / intervention config, the module entitlement system gates the right agent, and the dashboard page exists in the router. What is missing is surgical: one config-extension migration, one tables migration, five new accessors, the skill executors, and the adapter endpoint additions.

**When an org enables the `client_pulse` module and gets the "GHL Agency Intelligence" template applied**, they get the foundational config automatically. After Gaps A–E land, they also get Staff Activity Pulse + Integration Fingerprint Scanner + the full dashboard / intervention pipeline out of the box with zero hand-config.

### 12.4 Subscription tiering (per decision D6)

ClientPulse is sold in two tiers, each anchored to one of Kel's existing Starboys price points. The tier gates which features are active per org. Confirmation of the exact feature split is an open question for Kel (§11.4 Q4).

| Feature | Monitor tier (~$1,200/mo anchor) | Operate tier (~$2,400/mo anchor) |
|---|---|---|
| Portfolio dashboard (grid + drill-down) | ✓ | ✓ |
| Health score + Staff Activity Pulse + Integration Fingerprint Scanner | ✓ | ✓ |
| Churn risk bands + anomaly alerts | ✓ | ✓ |
| Intelligence Briefing + Weekly Digest (org + per-client playbooks) | ✓ | ✓ |
| Intervention proposer (continuous) | ✗ | ✓ |
| HITL approval queue + review items | ✗ | ✓ |
| Action execution (agency-branded email / SMS / tasks) | ✗ | ✓ |
| Intervention outcome measurement loop | ✗ | ✓ |
| Editable intervention template library | ✗ | ✓ |

**Schema impact:** the existing `modules` + `subscriptions` + `orgSubscriptions` schema (migration 0104) already models per-org per-module entitlements. We extend it with a `tier` column on `orgSubscriptions` (enum: `'monitor'` | `'operate'`) rather than introducing a parallel tiering system. Skill executors and the intervention proposer check the tier via a new accessor `getClientPulseTier(orgId)` in `orgConfigService` before activating tier-gated behaviour.

**No proposer for Monitor-tier orgs:** if an org subscribes at Monitor tier, the `proposeClientPulseInterventionsJob` no-ops (no review items written). Upgrading to Operate immediately enables the proposer on the next scan cycle; no migration or re-ingestion required.

---

## 13. Intelligence Briefing + Weekly Digest integration

### 13.1 What exists

- **Intelligence Briefing** — playbook at `server/playbooks/intelligence-briefing.playbook.ts`, scheduled Monday 07:00 (configurable). 5-step DAG: setup_schedule → research → draft → publish_portal → send_email. Schema in `intelligence-briefing.schema.ts`. Default schedule in `server/config/defaultSchedules.ts`.
- **Weekly Digest** — playbook at `server/playbooks/weekly-digest.playbook.ts`, scheduled Friday 17:00 (configurable). 4-step DAG: setup_schedule → gather → draft → deliver.
- **Portfolio Rollup** — pg-boss job `server/jobs/portfolioRollupJob.ts`, Monday 08:00 + Friday 18:00 (intentional one-hour offset *after* the sub-account playbooks fire). Aggregates org-wide playbook-run status + memory-review queue counts into the org-subaccount inbox. **NOT** a playbook — a job that calls `portfolioRollupService.runPortfolioRollup(orgId, kind)`.
- **`reports` table** — canonical store for generated reports, already supports `reportType='portfolio_health'` (`server/services/reportService.ts:79`).

### 13.2 Four-quadrant playbook coverage (briefing × digest × org × sub-account)

| Quadrant | Status | Owner / file | Gap |
|---|---|---|---|
| Sub-account Intelligence Briefing | **Built** as `.playbook.ts` | `server/playbooks/intelligence-briefing.playbook.ts` | Not yet INSERT-seeded; `system_playbook_templates` table empty for this slug |
| Sub-account Weekly Digest | **Built** as `.playbook.ts` | `server/playbooks/weekly-digest.playbook.ts` | Same — no seed row |
| Org-level Intelligence Briefing | **Missing** | — | Needs new file `intelligence-briefing-org.playbook.ts` declaring `scope: 'org'` per §13.3 (requires the Phase 0.5 engine refactor). **The Monday-morning Intelligence Briefing mockup at `tasks/clientpulse-mockup-intelligence-briefing.html` IS this missing playbook's output** — the mockup describes the design target. |
| Org-level Weekly Digest | **Partial as a job, not a playbook** | `server/jobs/portfolioRollupJob.ts` + `portfolioRollupService.runPortfolioRollup()` | Should be promoted to a real playbook (`weekly-digest-org.playbook.ts`) declaring `scope: 'org'` per §13.3 (requires the Phase 0.5 engine refactor). **The Friday-afternoon Weekly Digest mockup at `tasks/clientpulse-mockup-weekly-digest.html` IS this playbook's output.** Until the playbook ships, `portfolioRollupJob.ts` covers the core rollup but needs extending to render the look-back content shown in the mockup. |

### 13.3 Architectural recommendation: Pattern C (engine refactor for explicit org scope)

**Chosen pattern** (reversed from earlier drafts after honest evaluation). The earlier recommendation to use the org-subaccount as the playbook run target (Pattern A) worked without engine changes but had real concerns: conceptual debt, discoverability risk, first instance of the pattern, edge cases around portal semantics. For a product that will accumulate many playbooks and be touched by many engineers over time, those concerns compound. Pattern C is a one-time refactor that produces a clean long-term model.

**What Pattern C changes:**

Schema:

```sql
-- playbook_runs.subaccount_id becomes nullable
ALTER TABLE playbook_runs ALTER COLUMN subaccount_id DROP NOT NULL;

-- new scope discriminator on runs + templates
ALTER TABLE playbook_runs         ADD COLUMN scope playbook_scope_enum NOT NULL DEFAULT 'subaccount';
ALTER TABLE system_playbook_templates ADD COLUMN scope playbook_scope_enum NOT NULL DEFAULT 'subaccount';

-- CHECK constraint enforces valid combinations
ALTER TABLE playbook_runs ADD CONSTRAINT scope_entity_consistent CHECK (
  (scope = 'subaccount' AND subaccount_id IS NOT NULL) OR
  (scope = 'org'        AND organisation_id IS NOT NULL AND subaccount_id IS NULL)
);
```

Engine:

- `playbookEngine.startRun(definition, context)` accepts either scope. Context must carry an `entity` that is a subaccount (for `scope='subaccount'`) or an org (for `scope='org'`).
- Templating context resolves `run.entity.name` / `run.entity.id` polymorphically; `run.scope` is available for the rare step that needs to branch.
- `defaultSchedules.ts` declares scope per playbook; scheduler enqueues each run at the correct scope.

Permissions + RLS:

- New permission key `playbook_runs.start@org` alongside the existing `playbook_runs.start@subaccount`. Org-scoped runs default to agency-owner permissions.
- RLS on `playbook_runs` already filters by `organisation_id` (denormalised); add a `subaccount_id IS NULL OR subaccount_has_access(user, subaccount_id)` branch.

Step library updates (small):

- `publish_portal` resolves target portal from scope (client portal for sub-account runs; org-subaccount portal for org runs).
- `send_email` recipient resolution handles both scopes (agency owner + operators for org runs; client-scoped recipient list for sub-account runs).
- `aggregate_*` steps for org-scoped runs take `organisationId` directly from `run.entity.id`.

Query helpers centralised:

- `listRuns({ scope, organisationId, subaccountId })` — scoped filtering in one place; callers never write the scope filter by hand.
- `listClientRuns(orgId)` — explicitly `scope='subaccount'` only.

Migration (one-way, backfill-safe):

1. Add columns with safe defaults (`scope='subaccount'`, all existing runs are sub-account-scoped).
2. Backfill: no data change needed — every existing run is correctly `scope='subaccount'` by default.
3. Drop old NOT NULL on `subaccount_id`.
4. Add CHECK constraint.
5. Wire engine + step library to the new scope field.
6. New migration seeds `scope='org'` on the two new org-level playbook templates (`intelligence-briefing-org`, `weekly-digest-org`).

**Estimated effort:** ~3.5 engineer-days end-to-end (schema 0.5d, engine 1.5d, templating + steps 1d, permissions + RLS 0.5d, tests + migration plan baked in).

**Why this is worth it over Pattern A:**

- `playbook_runs.subaccount_id` always means "a client sub-account" after the refactor. No exceptions, no silent filtering rules for the org-subaccount case.
- Queries like "list all playbook runs for this org's clients" are natural: `WHERE scope='subaccount'`. No mental footnote required.
- Metrics dashboards don't accidentally include org-level runs in per-client aggregates.
- Future playbooks at org or sub-account scope use the same explicit scope declaration — no pattern-matching by convention.
- When the next tier emerges (e.g. "agency-network-scope" for a holding company managing multiple agencies), we extend the enum rather than invent another hack.

**Pattern A remains a valid v1 fallback** if the engine refactor has to be deferred, but we're not choosing it.

### 13.4 Module-agnostic graceful skipping

The playbook engine already supports `{ skipped: true }` for empty optional inputs and `skipWhen` conditions on `action_call` steps (per `tasks/playbooks-spec.md` §5.2). The proposed ClientPulse step in §13.5 must use this pattern so orgs without ClientPulse enabled still get a useful briefing/digest:

```ts
// pseudocode for the new step in either playbook
{
  slug: 'render_portfolio_health_section',
  type: 'action_call',
  skipWhen: '!modules.client_pulse.enabled || !reports.latest("portfolio_health")',
  action: 'render_portfolio_health_section',
  inputs: { latestReport: 'reports.latest("portfolio_health")' }
}
```

If the org lacks the module, or the module is enabled but no scan has produced a report yet, the section is omitted and the rest of the briefing renders unchanged. The other sections (research findings, memory-block synthesis, weekly work summary, KPI movement, pending HITL items) keep producing useful output regardless of which modules are enabled.

This is the abstraction guarantee: **the briefing and digest are useful for every org; ClientPulse is one optional contributor among several.**

### 13.5 Briefing vs Digest — different roles, different ClientPulse content

The two playbooks are intentionally split in time and frame:

| | **Intelligence Briefing** (Mon 07:00) | **Weekly Digest** (Fri 17:00) |
|---|---|---|
| **Frame** | **Forward-looking.** "Here's the week ahead — what to focus on, decide, or watch." | **Backward-looking.** "Here's the week behind — what happened, what worked, what we learned." |
| **Audience job-to-be-done** | Drive Monday-morning action. Kel scans → "I have to do these 3 things today." | Drive Friday-afternoon reflection + proposer-template iteration. |

The **ClientPulse section in each playbook must respect this split.** Same canonical `reports.portfolio_health` row; different rendering emphasis.

**Briefing — Portfolio Health section (forward content only):**

| Sub-section | Source |
|---|---|
| **Predictive risk forecast** — clients projected to enter Watch / At Risk / Critical this week if trajectory continues | Trend extrapolation on `client_pulse_health_snapshots` timeseries |
| **Tier-downgrade window warnings** — clients in the typical N-day window before a follow-on downgrade based on historical patterns | `subaccount_tier_history` + cohort pattern matching |
| **Pending interventions awaiting your approval** | `reviewItems` filtered by `actions.actionType='client_pulse_intervention'`, `status='pending'` |
| **Intervention cooldowns ending this week** — proposer will surface fresh interventions; act first if you want a different play | `interventionService.checkCooldown` lookahead |
| **Onboarding milestones at risk this week** | `subaccount_onboarding_milestones` + `client_pulse_onboarding_milestone_defs` deadlines |
| **Novel integration fingerprints to classify** | `integration_unclassified_signals` over the promotion threshold |

**Digest — Portfolio Health section (backward content only):**

| Sub-section | Source |
|---|---|
| **Net portfolio movement** — band counts WoW, MRR-at-risk delta | `client_pulse_health_snapshots` + `client_pulse_churn_assessments` history |
| **Intervention outcomes** — what was proposed, approved, executed, measured; correlations with band movement | `actions` + `interventionOutcomes` (per §5.3) |
| **Pattern learnings** — which intervention templates correlated with band improvement, which didn't ("check-in 2/2 worked, funnel-nurture 0/1 — iterate template") | Aggregation over `interventionOutcomes` joined to `actions.metadataJson.triggerTemplateSlug` (templates live in `operational_config.interventionTemplates[]` per §6.4) |
| **Top movers** — health-score gainers + losers this week with attribution | `client_pulse_health_snapshots` deltas |
| **Forecast accuracy check** — how many of last Monday's predictions came true | Retrospective on Briefing forecasts (stored as a `reports` row of subtype `portfolio_health_forecast`) |
| **Monday watchlist handoff** — bridge into next week's briefing | Composed from current top-N at-risk |

**What does NOT belong in each:**

- Briefing **MUST NOT** carry retrospective "what happened last week" content — that's the digest's job. Wins, outcome attribution, WoW deltas all belong in the digest.
- Digest **MAY** carry a small forward bridge ("Monday watchlist") but its centre of gravity is reflection, not action.

### 13.6 Concrete wiring (per playbook, module-conditional)

**In the scan pipeline (Phase 2–3):**

After each ClientPulse scan, write two `reports` rows:

- `reportType='portfolio_health'` — current snapshot (read by both playbooks)
- `reportType='portfolio_health_forecast'` — forward extrapolation (predicted band entries this week, tier-downgrade windows, milestone risks). Briefing reads this. Digest reads it next Friday for the forecast-accuracy check.

**In `intelligence-briefing.playbook.ts` (sub-account-level)** — add one step:

```
slug: 'render_portfolio_health_section_briefing'
type: 'action_call'
skipWhen: '!modules.client_pulse.enabled'
action: 'render_portfolio_health_briefing_section'
inputs: { forecast: reports.latest("portfolio_health_forecast"),
          subaccountFocus: run.subaccount.id }
emphasis: forward (forecast + pending decisions for THIS sub-account)
```

**In `weekly-digest.playbook.ts` (sub-account-level)** — add one step:

```
slug: 'render_portfolio_health_section_digest'
type: 'action_call'
skipWhen: '!modules.client_pulse.enabled'
action: 'render_portfolio_health_digest_section'
inputs: { current: reports.latest("portfolio_health"),
          weekAgo: reports.latestBefore("portfolio_health", "now() - 7d"),
          forecast: reports.latestBefore("portfolio_health_forecast", "now() - 7d"),
          subaccountFocus: run.subaccount.id }
emphasis: backward (outcomes + pattern learnings for THIS sub-account)
```

**In the new `intelligence-briefing-org.playbook.ts` + `weekly-digest-org.playbook.ts`** (both declare `scope: 'org'` per §13.3 Pattern C):

Same two steps, different scope (`run.entity.id` resolves to the organisation instead of a subaccount). The action's render template adapts: org-level briefings show portfolio-wide forecasts and pending interventions across all sub-accounts; org-level digests show portfolio-wide WoW and pattern learnings.

**In `portfolioRollupService.runPortfolioRollup()` (existing org-level job, until promoted to a real playbook):**

Extend the per-sub rollup loop to include `reportService.getLatestReport(subaccount.id, 'portfolio_health')` counts in the org-wide summary. Continues to deliver via existing `deliveryService` wiring. Eventually replaced by the org-level playbooks above.

### 13.7 What *not* to do

- Do **not** create a third or fourth playbook for "ClientPulse briefing" specifically. ClientPulse is a section, not a playbook.
- Do **not** duplicate ClientPulse query logic across the dashboard, briefings, and rollup — all four read the same canonical `reports` row(s).
- Do **not** make the briefing carry retrospective content — that violates the look-forward role and creates content-overlap fatigue with Friday's digest.
- Do **not** unconditionally render the ClientPulse section if the module isn't enabled or hasn't produced a report yet — use `skipWhen`.

### 13.8 Dedicated ClientPulse page is still the primary surface

The dashboard stays the primary Monday-morning surface (one screen, drill-down, intervention queue, real-time WebSocket updates). The briefings are async companions — they arrive in Kel's inbox, hit him with the headline, and deep-link into the dashboard for action. The two surfaces reinforce each other rather than compete.

---

## 14. Plain-English delivery summary (read this first)

This section is the architectural TL;DR for any future session reading this doc. The full detail is in §1–§13; this is the simple picture.

### 14.1 The four mockups

There are four mockup HTML files in `tasks/`:

1. `clientpulse-mockup-dashboard.html` — the org-level portfolio grid that Kel opens on Monday morning
2. `clientpulse-mockup-drilldown.html` — per-client deep dive (one row in the grid → click → this view)
3. `clientpulse-mockup-intelligence-briefing.html` — Monday 07:00 email (forward-looking)
4. `clientpulse-mockup-weekly-digest.html` — Friday 17:00 email (backward-looking)

### 14.2 How each one is delivered

| Mockup | Delivery mechanism | Build cost |
|---|---|---|
| Dashboard | **React page** at `/clientpulse`. Already exists in router (`ClientPulseDashboardPage.tsx`); main query returns `[]`. Wire queries against canonical tables. | Edit existing |
| Drill-down | **React page** at new route `/clientpulse/subaccount/:id`. Doesn't exist. | New page |
| Monday Briefing email | **NEW org-level playbook** `intelligence-briefing-org.playbook.ts`. Declares `scope: 'org'` (one playbook run per org per Monday; `playbook_runs.subaccount_id IS NULL`, `organisation_id` is the execution target). | New playbook file |
| Friday Digest email | **NEW org-level playbook** `weekly-digest-org.playbook.ts`. Same shape, Friday cadence. | New playbook file |

### 14.3 Why org-level playbooks need an explicit scope (Pattern C)

Earlier drafts of this doc proposed running org-level playbooks on the **org-subaccount** (`isOrgSubaccount = true`) to avoid engine changes. That approach works but carries conceptual debt: `playbook_runs.subaccount_id` would sometimes point to a real client and sometimes to an internal workspace, which silently breaks queries, metrics, and the mental model.

**We chose Pattern C instead** — a one-time engine refactor that adds an explicit `scope` enum (`'subaccount'` | `'org'`) to playbook definitions and runs, makes `playbook_runs.subaccount_id` nullable when `scope='org'`, and populates `organisation_id` instead. See §13.3 for the full refactor spec.

After the refactor:

- `playbook_runs.subaccount_id` always means a client sub-account, no exceptions.
- Org-level briefings declare `scope: 'org'` in their definition; the engine invokes them with `run.entity = organisation`.
- Permissions, RLS, templating context all branch cleanly on `scope`.
- The engine is a one-time 3.5-day refactor; every future org-scoped playbook reuses it for free.

No more "this is a sub-account that isn't really a sub-account" footnote anywhere in the code.

### 14.4 Where the work happens (sub-account level, per your preference)

All real computation happens at the per-client sub-account level:

- `canonical_subaccount_mutations` — one row per staff-attributed mutation per client
- `client_pulse_health_snapshots` — one row per client per scan
- `client_pulse_churn_assessments` — one row per client per scan
- `integration_detections` — one row per client per detected integration
- `subaccount_staff_activity_snapshots` — one row per client per scan

The org-level playbooks don't compute anything new. They aggregate and project the per-client data into one organisation-wide view. The "org-level" framing is a rendering scope, not a separate computation layer. The dashboard, drill-down, briefing, and digest are all four different views over the same per-sub-account substrate.

### 14.5 What `portfolioRollupService.ts` is, and what happens to it

Today, `portfolioRollupService.ts` does both aggregation AND delivery for an org-wide weekly rollup, triggered by `portfolioRollupJob.ts` (a pg-boss job). It's effectively a half-finished org-level digest implemented as a service-with-job rather than a playbook.

**Refactor path (clean, no big-bang):**

1. **Extract the aggregation logic** into pure functions: `aggregateForBriefing(orgId): BriefingData` and `aggregateForDigest(orgId): DigestData`. No side effects, no delivery calls.
2. **Two new org-level playbooks** call those aggregator functions in their `aggregate_org_data` step, then deliver via the standard `publish_portal` + `send_email` step types that every existing playbook already uses.
3. **`portfolioRollupJob.ts` keeps running during the transition**, then gets deleted once the org-level playbooks are seeded and stable. No parallel code path long-term.

### 14.6 Briefing vs Digest — the role split

Both org-level playbooks use the same engine, but their content respects different roles:

- **Briefing (Monday 07:00) = forward-looking.** Drives Monday-morning action. ClientPulse contribution: predictive forecasts (which clients will enter a worse band this week), interventions awaiting approval, tier-downgrade windows closing, trial milestone deadlines, intervention cooldown windows ending.
- **Digest (Friday 17:00) = backward-looking.** Drives Friday-afternoon reflection + proposer-template iteration. ClientPulse contribution: WoW band movement, intervention outcome attribution, pattern learnings ("check-in 2/2; funnel-nurture 0/1"), top movers, forecast-accuracy retrospective, Monday watchlist handoff.

Same playbook engine, same step library, same delivery primitives — different rendering emphasis. The forward/backward split is enforced in the rendering steps, not in the engine.

### 14.7 Module-agnostic guarantee

All four playbooks (per-client briefing, per-client digest, org briefing, org digest) work for any organisation regardless of which modules are enabled. ClientPulse contributes one optional section to each, gated by `skipWhen: !modules.client_pulse.enabled`. Without ClientPulse, the playbooks still produce useful output from other content sources (research findings, memory blocks, weekly work summary, KPI movement, pending HITL items).

The same guarantee applies CRM-wide. The playbook engine and step library are CRM-agnostic. A future HubSpot Agency template would seed the same playbook templates with HubSpot-specific configuration values; same code, different config.

### 14.8 Total net-new code to ship the four mockups

Assuming Phases 0–4 from §10 are in place (canonical tables, signal ingestion, scoring, churn assessment, intervention pipeline), plus the Phase 0.5 engine refactor per §13.3:

| Item | Type |
|---|---|
| Playbook engine refactor for explicit org scope | Edit engine + schema migration (Phase 0.5) |
| `intelligence-briefing-org.playbook.ts` (declares `scope: 'org'`) | New playbook file |
| `weekly-digest-org.playbook.ts` (declares `scope: 'org'`) | New playbook file |
| `ClientPulseSubaccountDrilldownPage.tsx` (or similar) | New React page |
| Wire `clientpulseReports.ts` queries (replace the `[]` stub) | Edit existing |
| Refactor `portfolioRollupService.ts` to pure aggregator | Edit existing |
| Seed migration for all four playbook templates (two `scope='subaccount'`, two `scope='org'`) | New migration |

Engine refactor is a one-time cost of ~3.5 engineer-days; every future scoped playbook benefits.

### 14.9 The architectural win

Adding a fifth playbook later (Monthly Board Report, Quarterly Business Review, Daily Critical Alert, etc.) is **just another `.playbook.ts` file**. No new infrastructure. The shape established by these four — per-client + org variants, shared step library, `skipWhen` module gating, explicit `scope='subaccount' | 'org'` declared on each playbook — is the template for everything that comes after.

---

## 15. Action-type primitives — the 5 CRM-agnostic intervention actions

The pivot away from hardcoded intervention templates (per the 2026-04-18 design review) re-frames an intervention as **"pick one of five action primitives, configure it, send"**. Everything else in the intervention queue — severity, cadence, cooldown, approval gate — is metadata around the action.

### 15.1 The five primitives

> **Slug-collision note (added 2026-04-18 per Codex pass):** the existing `actionRegistry.ts` already defines `send_email` (`server/config/actionRegistry.ts:274`) and `create_task` (`actionRegistry.ts:325`) with direct-send / Synthetos-native task semantics. To avoid silently changing behaviour for existing callers, the ClientPulse primitives are **namespaced** — the CRM-dispatched variants use the `crm.` prefix, the internal alert variant uses the `clientpulse.` prefix. Old unprefixed references below are preserved in the contract column only to show shape; the registered slug is the namespaced one.

| # | Primitive | Registered slug | Runs where | Composed where | V1 config contract |
|---|-----------|-----------------|-----------|----------------|--------------------|
| 1 | **Fire automation** | `crm.fire_automation` | Client's CRM (GHL workflow, HubSpot automation, etc.) | Operator picks an existing CRM automation from a live dropdown | `{ action: 'crm.fire_automation', provider_type: 'ghl', external_automation_id: '...', contact_id: '...' }` |
| 2 | **Send email** | `crm.send_email` | Client's CRM (uses client's authenticated sending domain) | Synthetos — subject + body + canonical merge fields | `{ action: 'crm.send_email', template_ref: 'synthetos:uuid', to_contact_id: '...' }` |
| 3 | **Send SMS** | `crm.send_sms` | Client's CRM (uses client's SMS provider via CRM) | Synthetos — 160-char body + canonical merge fields | `{ action: 'crm.send_sms', template_ref: 'synthetos:uuid', to_contact_id: '...' }` |
| 4 | **Create task** | `crm.create_task` | Client's CRM (task lives on CRM contact record) | Synthetos — title, notes, assignee, priority, due | `{ action: 'crm.create_task', title, notes, assignee_user_id, priority, due_at }` |
| 5 | **Operator alert** | `clientpulse.operator_alert` | Internal (Synthetos in-app + email + Slack) | Synthetos — severity, recipients, channels, CTA | `{ action: 'clientpulse.operator_alert', severity, recipient_user_ids, channels[], cta_action }` |

### 15.2 Why these five

- **Covers 100% of Kel's intervention patterns** from the interview — every example ("reactivate dormant client", "onboarding nudge", "tier-downgrade check-in", "silent-channel warning") decomposes into one or more of these five.
- **Zero hardcoded playbook logic.** "4-video funnel-setup nurture" is not a Synthetos concept — it's a GHL workflow the client already has, and the operator points at it via Primitive 1.
- **CRM-agnostic.** Primitives 1–4 execute via the canonical-adapter layer. Same API surface for GHL, HubSpot, Salesforce, Pipedrive. The word "workflow" is replaced with "automation" in user copy to remain neutral.
- **Preserves the client's sending reputation.** Primitives 2 + 3 compose the content in Synthetos but dispatch through the client's CRM so existing domain authentication, SMS provider contracts, and unsubscribe logic are preserved. Synthetos never sends email/SMS on the client's behalf itself.
- **No slug collision.** The `crm.` + `clientpulse.` prefixes ensure zero conflict with the existing `send_email` / `create_task` action types, whose semantics remain unchanged.

### 15.3 Replaces what in the old gap analysis

The old § 6.5 ("Action types to register") listed 7 action types, several of which were CRM-specific (`ghl.workflow.enrol`, `ghl.task.create`, `ghl.contact.tag`). This is superseded by the 5 primitives above. CRM-specific logic moves into the adapter layer; the registered action-type enum adds the five namespaced values `{ crm.fire_automation, crm.send_email, crm.send_sms, crm.create_task, clientpulse.operator_alert }` alongside the existing unprefixed primitives (which retain their current semantics).

### 15.4 Contact-tag operations

Previously called out as its own action type. Folded into Primitive 1 in v1 — most CRMs expose tag operations via their native automation system. If a v2 need emerges for direct tag writes outside an automation, add a sixth primitive then. Do not pre-build.

### 15.5 Mockup references

- Selector: `tasks/clientpulse-mockup-propose-intervention.html` (5 primitive cards in step 1 with "Runs in" badges)
- Primitive 1 editor: `tasks/clientpulse-mockup-fire-automation.html`
- Primitive 2 editor: `tasks/clientpulse-mockup-email-authoring.html`
- Primitive 3 editor: `tasks/clientpulse-mockup-send-sms.html`
- Primitive 4 editor: `tasks/clientpulse-mockup-create-task.html`
- Primitive 5 editor: `tasks/clientpulse-mockup-operator-alert.html`
- Primitive 5 recipient view: `tasks/clientpulse-mockup-operator-alert-received.html`

---

## 16. Canonical merge fields — CRM-agnostic content composition

Primitives 2 (email), 3 (SMS), and 4 (task) all compose content in Synthetos using **canonical merge fields**. The substitution happens in Synthetos immediately before dispatch, so the content that lands in the client's CRM is a fully-resolved string — the CRM never sees a Synthetos merge token.

### 16.1 Namespace shape

| Namespace | Example fields | Source |
|-----------|----------------|--------|
| `contact` | `{{contact.firstName}}`, `{{contact.lastName}}`, `{{contact.email}}`, `{{contact.phone}}`, `{{contact.company}}`, `{{contact.owner.firstName}}` | `canonical_contacts` (populated by adapter) |
| `subaccount` | `{{subaccount.name}}`, `{{subaccount.tier}}`, `{{subaccount.trialEndsOn}}` | `canonical_subaccount_mutations` / subaccount metadata |
| `signals` | `{{signals.healthScore}}`, `{{signals.band}}`, `{{signals.lastActivityDays}}`, `{{signals.pipelineVelocity30d}}` | Derived from ClientPulse signal tables |
| `org` | `{{org.name}}`, `{{org.operatorFirstName}}`, `{{org.supportEmail}}` | Agency-level settings |
| `intervention` | `{{intervention.reason}}`, `{{intervention.triggerDate}}`, `{{intervention.band}}` | The intervention record itself |

### 16.2 Why canonical (not CRM-native merge tokens)

- **Same syntax across every CRM.** Operator doesn't need to know whether the client is on GHL (`{{contact.first_name}}` with snake_case) or HubSpot (`{{contact.firstname}}` lowercase-compressed) or Salesforce (`{!Contact.FirstName}` bang-syntax). One vocabulary, resolved in Synthetos.
- **Works across clients on the same template.** A saved email template (§16.5) composed with `{{contact.firstName}}` works unchanged whether the client is on GHL, HubSpot, or a CRM added next quarter.
- **Resolves to a fully-materialised string before CRM dispatch.** The CRM API receives e.g. `"Hi Sarah — we noticed…"`, not a merge token. No CRM-side merge logic required. No dependency on CRM merge-token documentation staying current.

### 16.3 Resolution pipeline

1. Operator composes content in the Synthetos authoring popup using canonical tokens.
2. "Send test" button resolves tokens against the operator's own record (for primitive 2 and 3) — verifies the template renders.
3. On real send, Synthetos resolves tokens against the target contact + signal snapshot + subaccount + org context, producing a rendered string.
4. Adapter dispatches the rendered string via the CRM API (e.g. GHL messaging endpoint, HubSpot email send, etc.).

### 16.4 Missing-value policy

If a token resolves to null/empty (e.g. contact has no company name):

- **Email/task:** render as empty string. Operator preview shows `⚠ empty` next to any token that would render blank so they can adjust before sending.
- **SMS:** same rule, but with tighter character budget — the preview strips the blank cleanly (no double spaces).
- **No v1 fallback syntax.** No `{{contact.firstName || "there"}}` — keep the grammar tight for v1; add default-value syntax only if authoring data shows a real demand pattern.

### 16.5 Saved templates

Canonical merge fields power the "Saved email templates" section on the settings page (and the equivalent for SMS in v2). Saved templates live at the **org level** (every operator in the agency shares them) and are versioned with `templateVersionId` on the `operational_config.savedTemplates[]` array. Referenced by primitive 2's `template_ref` as `synthetos:{uuid}`.

### 16.6 Mockup references

- Merge-field picker in compose: `tasks/clientpulse-mockup-email-authoring.html` (top toolbar chips)
- Merge-field usage in SMS: `tasks/clientpulse-mockup-send-sms.html`
- Task title/notes merge fields: `tasks/clientpulse-mockup-create-task.html`
- Saved template list in settings: `tasks/clientpulse-mockup-settings.html` ("Saved email templates" section)

---

## 17. Configuration Agent integration — making ClientPulse config editable via chat

The existing Configuration Agent (`docs/configuration-assistant-spec.md`) can adjust agent definitions, schedules, and skill bindings via natural language. It **cannot today adjust ClientPulse settings** — its mutation toolset does not include ClientPulse config, and the Orchestrator's routing model has no capability slug that would route a ClientPulse-config request to it. This section closes that gap so the same chat popup (mockup: `tasks/clientpulse-mockup-config-assistant-chat.html`) can rewrite health-score weights, disable blind-spot alerts, shift band thresholds, etc.

### 17.1 Why this path (not a bespoke ClientPulse chat agent)

- **One assistant, one vocabulary, one audit trail.** Operators already use the Configuration Assistant for agent/schedule edits; adding ClientPulse to its scope means they don't learn two chat surfaces.
- **Settings UI stays primary.** The chat is a second UI over the same primitive (a merge-update on `operational_config`); the form is a third. Both paths write through the same skill so behaviour is identical no matter which surface the operator picks.
- **Future-proof.** Any new ClientPulse configurable (a new blind-spot detector, a new intervention action-type, a new onboarding milestone) automatically becomes chat-addressable because the skill reads the JSON Schema of `operational_config` at runtime — no per-setting tool additions.

### 17.2 The five concrete additions

Five files (one new, four edits) land the natural-language path end-to-end.

#### 17.2.1 `docs/capabilities.md` — new capability slugs

Add to the agency-capabilities catalogue (Support-facing section, since capability slugs are for routing, not marketing copy):

| Slug | Description | Gate level |
|------|-------------|------------|
| `clientpulse.config.read` | Read current ClientPulse configuration (effective values after template + overrides merge) | `auto` |
| `clientpulse.config.update` | Apply a merge-update to the org's ClientPulse `operational_config` | `review` (HITL confirm step in chat) |
| `clientpulse.config.reset` | Reset one or more keys back to template defaults | `review` |
| `clientpulse.config.history` | Read the audit log of configuration changes for ClientPulse keys | `auto` |

Slugs are namespaced under `clientpulse.config.*` so future modules (e.g. `workspacehealth.config.*`) can follow the same pattern without collision.

#### 17.2.2 `docs/integration-reference.md` — new pseudo-integration entry

ClientPulse config is conceptually an integration the Orchestrator can read/write against. Add a `clientpulse_configuration` block in the integration reference (structured YAML consistent with the existing pattern):

```yaml
- id: clientpulse_configuration
  category: platform
  scope: org
  capabilities:
    - clientpulse.config.read
    - clientpulse.config.update
    - clientpulse.config.reset
    - clientpulse.config.history
  auth: none  # reads + writes against org's own operational_config
  notes: |
    Pseudo-integration. Not a third-party system — represents the org's own
    ClientPulse configuration store. Exposed so the Orchestrator can route
    natural-language config requests to it.
```

The CI gate `scripts/verify-integration-reference.mjs` will pick up the new entry automatically. No new OAuth provider or MCP preset needed.

#### 17.2.3 `server/skills/config_update_hierarchy_template.md` — new skill

New skill file (one file under `server/skills/`, plus registration in `server/config/actionRegistry.ts` and `server/services/skillExecutor.ts`). Does a schema-validated merge-update on `hierarchyTemplates.operationalConfig` at the org level.

**Skill contract:**

```
input:
  orgId: uuid (required; derived from auth context, not passed by LLM)
  path: string (dot-path into operational_config, e.g. "healthScoreFactors.pipeline_velocity.weight")
  operation: 'set' | 'delete' | 'reset_to_default'
  newValue: any (required for 'set', ignored otherwise)
  reason: string (required — free-text; shown in audit log + change history UI)

output:
  previousValue: any
  newValue: any
  templateDefault: any
  auditLogId: uuid
  nextScanAt: timestamp (informational — when the change takes effect)

validation:
  - path must resolve to a leaf in the operational_config JSON Schema
  - newValue must conform to the schema type for that path
  - for weight fields (factors, blind-spot scoring): sum-constraint check (must still total 1.00)
  - write wrapped in withPrincipalContext so RLS applies
  - cross-check: org's template_id must match a template that declares this path

audit:
  - row written to EXISTING config_history table (see §17.2.6 — revised 2026-04-18 per Codex pass)
  - entity_type: 'clientpulse_operational_config'
  - entity_id: sha256(orgId + path) — stable hash so "all history for this path" queries work
  - snapshot: full path + before + after + reason in the jsonb payload
  - changed_by: userId (or NULL if agent-initiated)
  - change_source: 'config_agent' (for chat) | 'ui' (for settings page) | 'api'
  - change_summary: human-readable one-liner (e.g. "Pipeline velocity weight 0.30 → 0.35")
  - version: auto-incremented per (organisation_id, entity_type, entity_id)
```

The same skill is called by:

- Chat popup confirm button → source `'chat'`
- Settings page Save button → source `'settings_ui'`
- Future programmatic API → source `'api'`

One skill, one validation path, one audit trail.

#### 17.2.4 `docs/orchestrator-capability-routing-spec.md` — document ClientPulse config as routable

Add a new row to the Orchestrator's capability routing table so when the user says "bump pipeline velocity weight to 0.35" in any chat surface, the Orchestrator recognises this as a `clientpulse.config.update` request and routes to the Configuration Agent.

**Routing hints (examples; non-exhaustive):**

- keywords: `weight`, `threshold`, `band`, `silent channel`, `tier downgrade`, `blind spot`, `scan cycle`, `health factor`, `churn band`
- context signals: user is currently viewing any `/clientpulse/*` page OR the chat was launched from a ClientPulse settings callout
- structural signals: phrase refers to a known path in `operational_config` JSON Schema (confirmed by a tool call from Orchestrator to the schema)

Routing a request into `clientpulse.config.*` implies the Configuration Agent handles the turn (with its existing confirm-before-write UX), not a ClientPulse-specific agent.

#### 17.2.5 `docs/configuration-assistant-spec.md` — add mutation tool + update scope

In the Configuration Assistant's spec document:

- **Add mutation tool #16:** `update_clientpulse_config`. Wraps the `config_update_hierarchy_template` skill. Same confirm-before-write contract as the other 15 tools.
- **Move ClientPulse config from "out of scope" to "in scope v2".** Update the scope section that currently lists it as excluded.
- **Extend the prompt examples** to show a ClientPulse config-change conversation end-to-end (matching the `clientpulse-mockup-config-assistant-chat.html` flow).

#### 17.2.6 Audit log — reuse existing `config_history` (revised 2026-04-18 per Codex pass)

**Earlier drafts of this section proposed a new `config_changes` table. That has been rejected.** The existing `server/db/schema/configHistory.ts` already provides version-aware, org-scoped, source-tagged audit rows for configuration mutations with exactly the columns we need:

```
config_history  (EXISTING — /server/db/schema/configHistory.ts)
  id              uuid pk
  organisation_id uuid fk
  entity_type     text          ← 'clientpulse_operational_config' for ClientPulse writes
  entity_id       uuid          ← sha256-derived UUID from (orgId + dot-path)
  version         integer       ← auto-increment per (org, entity_type, entity_id)
  snapshot        jsonb         ← { path, before, after, reason } payload
  changed_by      uuid fk       ← user or NULL for agent-initiated
  change_source   text enum     ← 'ui' | 'api' | 'config_agent' | 'system_sync' | 'restore'
  session_id      uuid          ← for grouping atomic multi-path saves (§18.3)
  change_summary  text          ← one-liner for change-log UI
  changed_at      timestamptz
```

**ClientPulse contract against the existing table:**

- **entity_type** = `'clientpulse_operational_config'` (new enum value; already text-typed so no schema change)
- **entity_id** = deterministic UUID derived from `(organisation_id, dot_path)` so "all history for `healthScoreFactors.pipeline_velocity.weight`" queries work via a single `WHERE` clause
- **session_id** = present when multiple paths are saved together from the template editor (§18.3) — groups them as an atomic edit
- **snapshot** = `{ path: string, before: any, after: any, reason: string, operation: 'set' | 'delete' | 'reset_to_default' }`
- **change_source** = `'config_agent'` (chat) / `'ui'` (settings page) / `'api'`
- **changed_by** = user when operator confirmed; NULL when applied by a system agent

**No new migration needed for the audit log itself.** Existing indexes (`config_history_org_idx`, `config_history_entity_idx`, `config_history_changed_at_idx`) already support the UI query patterns. If a later enhancement needs ClientPulse-specific indexing, add it as a targeted partial index on `entity_type='clientpulse_operational_config'`.

**Powers:**
- "View change log" button on the template editor (§18) — filter `WHERE entity_type='clientpulse_operational_config' AND organisation_id=?`
- "See history" button in the chat popup — same filter, scoped to the current org
- "Undo" button after an applied change — reads the last `config_history` row for the path, calls the skill with `operation: 'reset_to_default'` (or with `snapshot.before` as `newValue`)
- Sysadmin cross-org audit view — same table, no org filter (bypass via sysadmin permissions, §25.4)

RLS: **already enforced** on `config_history` per `server/config/rlsProtectedTables.ts`. No additional policies required.

### 17.3 Bidirectional flow guarantee

With these five additions, the three UIs converge on one write path:

```
  chat popup  ──┐
                │
  settings UI ──┼──► config_update_hierarchy_template skill ──► operational_config JSONB
                │                                            ──► config_history (existing audit table; §17.2.6)
  briefing    ──┘
  action btn
```

The "action button on the briefing" path (e.g. a briefing says "one-click: reset blind-spot thresholds to defaults" and the operator clicks it) calls the same skill with a pre-filled `path` + `operation` + `reason`. Every path produces the same audit row, the same effective config, and the same next-scan behaviour. No parallel code paths.

### 17.4 Mockup references

- Chat popup (generic, site-wide): `tasks/clientpulse-mockup-config-assistant-chat.html`
- Chat entry point on settings page: `tasks/clientpulse-mockup-settings.html` (callout at top)
- Settings UI (form-based path): `tasks/clientpulse-mockup-settings.html`

### 17.5 V1 scope boundary for the Configuration Agent extension

- **In v1:** path-level `set` + `reset_to_default` on scalar + single-level-object keys.
- **Deferred to v2:** array-append/remove operations (adding a new saved email template via chat, adding a new blind-spot detector via chat), bulk operations (reset an entire section), conditional edits ("if my portfolio has > 100 clients then ..."). The chat can suggest these and hand off to the settings UI; it does not execute them in v1.

This keeps the v1 surface tight enough to ship without getting dragged into schema-evolution-via-chat corner cases.

### 17.6 Guardrail requirements (added 2026-04-18, per external review)

An external reviewer flagged that the chat is powerful and dangerous without explicit guardrails. This subsection locks in the guardrail contract. **None of these are optional for v1 — they are ship-gate requirements.**

#### 17.6.1 Required guardrails (all must be wired before v1 release)

| Guardrail | Shape | Existing building block | Gap to close |
|-----------|-------|-------------------------|--------------|
| **Schema validation** | Every `clientpulse.config.update` validated against `operational_config` JSON Schema before write | Skill contract in §17.2.3 declares validation rules | Author the JSON Schema file (`server/config/operationalConfigSchema.ts`) as part of Phase 0 |
| **Sum-constraint validation** | Weight-sum checks (factors sum to 1.00), band-overlap checks (no band range overlaps another) | Referenced in §17.2.3 | Implement as Zod refinements on the schema |
| **Dry-run / preview** | Every chat-initiated mutation surfaces a before/after diff card in-bubble; operator clicks Apply to commit | Existing Configuration Assistant confirm-before-write pattern | Extend pattern to ClientPulse path; re-use `clientpulse.config.read` to compute preview without writing |
| **Approval gate (for sensitive paths)** | Changes to certain paths require the action→review→approve pipeline, not inline commit | `actions.gateLevel='review'` + `reviewItems` table (exists) | Wire `config_update_hierarchy_template` skill to create an `actions` row with `gateLevel='review'` for paths flagged `sensitive: true` in the schema |
| **Audit log** | Every mutation writes a `config_history` row (entity_type='clientpulse_operational_config') with before/after/source/user/reason | Existing `config_history` table (`server/db/schema/configHistory.ts`); `configBackups` infra also exists | **No new audit table** (revised 2026-04-18 per Codex pass). Extension = new `entity_type` enum value + writer in the skill handler |
| **Rollback** | Every applied change can be reverted via `operation: 'reset_to_default'` or by re-applying `snapshot.before` from the audit row | `configBackups` table supports scope='config_agent' with lifecycle tracking | No new infra; add "Undo" button wired to `config_update_hierarchy_template` with `snapshot.before` from the last `config_history` row |
| **Versioning** | `config_history.version` auto-increments per (org, entity_type, entity_id) giving the full mutation trail per org per path | `configHistory.version`, `changeSummary`, `changeSource`, `sessionId` already present | Use existing columns; ClientPulse writes emit `session_id` to group atomic multi-path saves from template editor |

#### 17.6.2 Which paths are "sensitive" (need approval gate)

Not every config change needs review — bumping a weight by 0.05 on a pilot org is low-risk. The JSON Schema declares `sensitive: boolean` on each leaf; initial sensitivity flags:

| Path pattern | Sensitive? | Reason |
|--------------|-----------|--------|
| `healthScoreFactors.*.weight` | No (auto-commit) | Reversible, bounded, frequent tuning |
| `churnBands.*.threshold` | **Yes** | Band re-classifies every client in the portfolio; worth a second look |
| `blindSpotDetection.*.enabled` | No | Toggle, reversible |
| `blindSpotDetection.*.threshold` | No | Tuneable |
| `savedTemplates[*]` | **Yes** | Shared across all operators; content is sent to clients |
| `scanSchedule.*` | **Yes** | Affects every agent run cadence — easy to misconfigure and hard to notice |
| `dataRetention.*` | **Yes** | Destructive; longer retention costs money, shorter deletes history |
| `integrationFingerprints[*]` | No | Learned + tuneable |

Sensitivity is a per-org override: an org admin can mark any path `sensitive: true` in their own operational_config to force approval for themselves.

#### 17.6.3 Schema-validation failure UX

When the schema rejects a mutation (e.g. operator asks for "set pipeline velocity weight to 2.0"):

1. Skill returns `{ ok: false, error: 'schema_validation_failed', details: [...] }`.
2. Chat surface renders an error card: "Can't apply — pipeline_velocity.weight must be ≤ 1.0 (you asked for 2.0). Want me to use 0.5 instead?" with suggested-fix chips.
3. No `config_history` row written (validation is a pre-condition; failed writes leave no audit row).
4. No retry loop — operator must explicitly re-issue a valid request.

#### 17.6.4 Audit-log visibility

Every org admin can see their own org's `config_history` rows (filtered to `entity_type='clientpulse_operational_config'`) in the "View change log" button on the settings page (§18) and the template editor (§18). Filters: by path (via `snapshot.path`), by change_source (ui / api / config_agent / system_sync / restore), by user, by date range. Row click → routes to the relevant editor with the path pre-selected.

Sysadmins see all orgs' config_history in the admin audit-log view (bypass via sysadmin permissions, §25.4).

#### 17.6.5 Ship-gate addition

Phase 4.5 ship-gate (§10) is amended to require:
- `config_history` writer for `entity_type='clientpulse_operational_config'` wired (no new table migration needed)
- JSON Schema for `operational_config` authored with `sensitive` flags
- At least one sensitive-path mutation successfully gated through action→review→approve
- Undo button functional end-to-end
- Schema-validation failure renders helpful error (not a stack trace)

---

## 18. Template editor + system-admin governance model

System admins (Synthetos staff) own the master configuration templates that power every org's default ClientPulse behaviour. Org admins (agency owners like Kel) inherit a template at org-creation time and can override individual values per-org; they cannot edit the template itself.

### 18.1 Three roles, three surfaces

| Role | Surface | Can edit |
|------|---------|---------|
| System admin | Template editor (`tasks/clientpulse-mockup-template-editor.html`) | The master template — health factors, band thresholds, saved email templates, blind-spot detectors, fingerprints, milestones, memory seeds, schedules, retention |
| Org admin (agency owner) | Org settings page (`tasks/clientpulse-mockup-settings.html`) + Config Assistant chat | Any value — but every change becomes an **override** recorded against the org; the template is untouched |
| Sub-account admin (client employee, future) | Sub-account view only | Nothing config-wise in v1. v2 may allow tuning cadences for their own workspace |

### 18.2 Inheritance + override semantics

```
  (system master template)  operationalConfig_template
                               ↓ copy-on-read at org creation
  (org's operational_config)   operationalConfig_org
                               ↓ effective merge
  (runtime resolved value)     template.merge(org_overrides)
```

Rules:

1. **Copy-on-read at org creation.** When a sysadmin creates a new org and picks a template, the template's `operationalConfig_template` is snapshotted into the org's `operational_config` as the baseline. The org now has a complete config, no lookup-chains.
2. **Edits at the org level are overrides.** An org admin editing health-score weights mutates the org's own `operational_config`. The master template is not touched.
3. **Template edits affect future orgs only.** When a sysadmin edits the master template, existing orgs are not retroactively updated. New orgs picking that template from then on inherit the updated defaults.
4. **Exception: unmodified-value re-inheritance.** If an org has a value that exactly matches the template default at the time they were created (i.e. they never overrode it), the next scan cycle will pick up the new template default. This is tracked by comparing a change-log flag `isOverride: boolean` on each leaf, not by value-equality (which would break if an org happens to override to the same value).

### 18.3 Template editor UX contract (from the mockup)

- **All edits across every left-nav section are staged locally.** Switching tabs does not commit.
- **Dirty-state indicator** on each left-nav item that has unsaved edits (amber dot + "edited" label).
- **Staged-edits banner** at the top of the modal summarising all sections with unsaved edits.
- **Save is atomic:** pressing "Save changes" commits the full staged diff in one transaction, producing one `config_history` row per path changed, all sharing the same `session_id` so they can be grouped in the audit UI (via the existing `config_history_session_idx` index).
- **Cancel discards everything** (including staged edits from sections the operator never visited — they never applied).
- **"View change log" button** in the footer routes to the audit-log view filtered to this template's changes.

### 18.4 Left-nav sections (v1 scope)

The template covers 10 configurable domains (matching the mockup left nav):

1. **Template metadata** — slug, name, description, applicable CRM types
2. **Health score factors** — list of weighted factors (sum-to-1.00 constraint)
3. **Churn bands** — 4-band threshold ranges (Critical / At Risk / Watch / Healthy)
4. **Saved email templates** — org-shared canonical-merge-field templates
5. **Blind-spot detection** — the 8 detector definitions + thresholds
6. **Integration fingerprints** — seed fingerprints for the fingerprint scanner (§2.0c)
7. **Onboarding milestones** — the 5 default milestones for trial monitoring (§8)
8. **Required operator inputs** — fields the Ops team must collect at onboarding
9. **Memory seeds** — initial knowledge base entries for agents on this template
10. **Scan + report schedule** — heartbeat offsets, briefing send times, digest cutoff
11. **Data retention** — signal history retention, audit-log retention

Each section has a dedicated editor component but all share the same staging-then-atomic-save behaviour.

### 18.5 Entry points

System admin reaches the template editor via:

1. **Config Templates admin page** (list view → click a template → editor opens as a modal).
2. **Create-org modal** (sysadmin picks a template for a new org and clicks the "Edit ↗" button on the template card — mockup: `tasks/clientpulse-mockup-onboarding-sysadmin.html`). Clicking Edit opens the same template editor modal in-place.
3. **Audit log drill-down** (clicking a config-change row routes to the editor with the relevant section pre-selected).

### 18.6 Vetting model

Org admins cannot create their own templates in v1 — templates are a sysadmin-vetted asset. Rationale:

- **Templates encode health-scoring defaults** that directly affect the product's signal quality. A badly-configured template (e.g. weights that don't sum, bands that overlap) would silently break every org that picks it.
- **Saved email templates shipped in a template** become the defaults every operator on that template can use. Vetting prevents spammy/off-brand language from shipping at scale.
- **Integration fingerprints** seed the Integration Fingerprint Scanner. Seed quality matters.
- **Org admins get full override power at their own org's level** — that's where their editing surface lives. If a template is genuinely wrong for them, the right path is override-everything, not fork-the-template.

v2 may introduce a "fork this template into your own" flow for orgs that want a persistent deviation, but that is an explicit escalation, not a default.

### 18.7 Mockup references

- Template editor modal: `tasks/clientpulse-mockup-template-editor.html`
- Sysadmin create-org with template picker + Edit buttons: `tasks/clientpulse-mockup-onboarding-sysadmin.html`

---

## 19. Onboarding flows — sysadmin create-org + orgadmin first-run

Two distinct onboarding surfaces, two distinct audiences. Keep them separate because the tasks and mental models differ.

### 19.1 Sysadmin create-org flow

**Audience:** Synthetos staff provisioning a new agency customer.

**Surface:** `tasks/clientpulse-mockup-onboarding-sysadmin.html` (modal).

**Steps:**

1. **Org metadata** — name, slug, primary contact, billing contact, tier (Monitor / Operate — see § 12.4).
2. **Pick a template** — cards for each available template (GHL Agency Intelligence, HubSpot Agency Intelligence, Internal Team, Multi-Location Retail). Each card shows:
   - Short description
   - Applicable CRM types
   - How many existing orgs use it
   - **"Edit ↗" button** → opens template editor modal (§18) in-place for last-minute tweaks before provisioning
3. **Configure required operator inputs** — a template may declare fields the sysadmin must fill before org provisioning (e.g. "primary agency phone number" for the SMS-send scenario). Surface any unsatisfied required inputs as blocking form errors.
4. **Invite org admins** — email addresses + role assignment; provisioning sends invite emails on create.
5. **Provision** — atomic transaction:
   - Create `organisations` row
   - Snapshot the picked template's `operationalConfig_template` into the org's `operational_config`
   - Seed the default system-managed agents (via existing three-tier agent model)
   - Create the org-subaccount (retained for portal/inbox concerns only — per §13.3 Pattern C, org-scoped playbook runs use `scope='org'` and do not target the org-subaccount as their execution entity)
   - Queue welcome emails to invited admins

**Exit:** sysadmin sees confirmation + link to jump to the new org's dashboard as that org.

### 19.2 Orgadmin first-run flow

**Audience:** The agency owner (Kel) logging in for the first time after their invitation.

**Surface:** `tasks/clientpulse-mockup-onboarding-orgadmin.html` (4-screen first-run guide).

**Steps (each screen):**

1. **"Welcome, your workspace is ready"** — high-level orientation. What ClientPulse does, what the operator will see on the dashboard in ~24 hours once the first scan completes.
2. **"Connect your CRM"** — OAuth flow to the agency's GHL/HubSpot/etc. account. Explains scope (read-only v1.0 → extend to write on Operate-tier upgrade).
3. **"Map your pilot clients"** — after OAuth, operator picks which sub-accounts to import. v1 recommends starting with 5–10 pilot clients rather than all 180 to keep the first-pass review manageable.
4. **"You're set"** — summary of what happens next: first scan runs within the hour; dashboard populates as signals accumulate; Intelligence Briefing arrives Monday 07:00; Weekly Digest Friday 17:00.

### 19.3 Post-onboarding state

Immediately after orgadmin first-run completes:

- Org has: CRM connected, sub-accounts imported (or import queued), default operational_config from template, default agents seeded.
- Dashboard shows a **cold-start rendering** (§7.7) for 24h until signals accumulate — explicit "gathering data" state rather than misleading zero-scores.
- First briefing + digest are suppressed in the first week (org_subaccount exists but hasn't yet accumulated enough signal to say anything useful) — set `first_briefing_after` on the subscription row.

### 19.4 Resumability

Both flows must be resumable:

- **Sysadmin flow:** navigating away mid-flow persists a draft org record (`status: 'pending_provisioning'`). Coming back resumes at the last-unfilled step.
- **Orgadmin flow:** navigating away leaves the org in first-run state; next login drops them back into whichever step is incomplete. No hard blocking — they can browse the dashboard (which will be mostly empty) but a persistent banner urges completion.

### 19.5 Mockup references

- Sysadmin create-org modal: `tasks/clientpulse-mockup-onboarding-sysadmin.html`
- Orgadmin 4-screen first-run: `tasks/clientpulse-mockup-onboarding-orgadmin.html`

---

## 20. UX decisions catalog + mockup index

Living register of UX decisions made across the 2026-04-17/18 design sessions. Every non-trivial decision is captured here so future iterations don't regress on the reasoning.

### 20.1 Complete mockup index

20 mockup files cover the full ClientPulse surface area end-to-end:

| # | Mockup file | Surface | Audience |
|---|-------------|---------|----------|
| 1 | `clientpulse-mockup-dashboard.html` | Main portfolio grid (home view) | Org admin (Kel) |
| 2 | `clientpulse-mockup-drilldown.html` | Per-client deep-dive page | Org admin |
| 3 | `clientpulse-mockup-propose-intervention.html` | Modal: pick an action-type primitive | Org admin |
| 4 | `clientpulse-mockup-fire-automation.html` | Primitive 1 editor (pick a CRM automation) | Org admin |
| 5 | `clientpulse-mockup-email-authoring.html` | Primitive 2 editor (compose email) | Org admin |
| 6 | `clientpulse-mockup-send-sms.html` | Primitive 3 editor (compose SMS) | Org admin |
| 7 | `clientpulse-mockup-create-task.html` | Primitive 4 editor (create CRM task) | Org admin |
| 8 | `clientpulse-mockup-operator-alert.html` | Primitive 5 editor (internal alert authoring) | Org admin |
| 9 | `clientpulse-mockup-operator-alert-received.html` | Primitive 5 recipient view (in-app tray) | Org admin (alert recipient) |
| 10 | `clientpulse-mockup-inline-edit.html` | One-click override from a blind-spot pattern | Org admin |
| 11 | `clientpulse-mockup-settings.html` | Org-admin settings page | Org admin |
| 12 | `clientpulse-mockup-config-assistant-chat.html` | Site-wide Configuration Agent chat popup | Org admin |
| 13 | `clientpulse-mockup-template-editor.html` | System-admin template editor modal | Sysadmin |
| 14 | `clientpulse-mockup-onboarding-sysadmin.html` | Create-org modal w/ template picker | Sysadmin |
| 15 | `clientpulse-mockup-onboarding-orgadmin.html` | 4-screen first-run guide | Org admin |
| 16 | `clientpulse-mockup-intelligence-briefing.html` | Monday 07:00 org-level forward briefing | Org admin |
| 17 | `clientpulse-mockup-weekly-digest.html` | Friday 17:00 org-level backward digest | Org admin |
| 18 | `clientpulse-mockup-briefing-per-client.html` | Monday 07:00 per-client briefing | Org admin / client-facing |
| 19 | `clientpulse-mockup-digest-per-client.html` | Friday 17:00 per-client digest | Org admin / client-facing |
| 20 | `clientpulse-mockup-capability-showcase.html` | Exhaustive detection-pattern reference | Internal / sales collateral |

### 20.2 UX decisions catalog (U1–U20)

Each decision: short name, what, why.

**U1 — Portfolio grid uses Google-Sheets-style column headers.** Click-to-sort on any column (A→Z / Z→A toggles), with filter dropdown on categorical columns. Replaces an earlier "Sort pill + static chips" approach. Why: operator mental model matches Sheets; discoverability is higher; fewer UI chrome elements. Mockup: `dashboard.html`.

**U2 — Band column is a first-class sortable column, not an incidental color bar.** Why: band is the primary grouping mechanism and needed to be directly actionable. Mockup: `dashboard.html`.

**U3 — Filter chips are interactive, not static summary.** Clicking a chip (e.g. "At Risk · 12") toggles the filter. "+ Add filter" popover lets operator pick any column and values. Why: reading-as-filtering conflates state with controls; separating them was confusing. Mockup: `dashboard.html`.

**U4 — Trend chart on dashboard shows aggregate portfolio motion only.** No per-client annotations. Why: client-specific events on an org-aggregate chart misled operators into thinking the chart was client-filtered. Mockup: `dashboard.html`.

**U5 — 5 action-type primitives, not hardcoded playbook templates.** Why: supersedes templates like "4-video funnel-setup nurture" that presumed a specific client setup. See §15. Mockup: `propose-intervention.html`.

**U6 — Each primitive has its own dedicated editor popup,** routed to via "Configure [action] ↗" button in the proposer step. Why: editors have very different affordances (CRM automation picker vs email compose vs SMS bubble preview) — one universal editor would be a mess. Mockups: `fire-automation.html`, `email-authoring.html`, `send-sms.html`, `create-task.html`, `operator-alert.html`.

**U7 — Email + SMS authoring: compose on top, preview below (stacked).** Why: operator feedback that side-by-side forced too-narrow editors on laptop screens; stacked is natural top-to-bottom flow. Mockups: `email-authoring.html`, `send-sms.html`.

**U8 — "Send test to me" button on email + SMS compose.** Why: deliverability verification catches domain-authentication + formatting issues before the operator sends to a real client.

**U9 — Operator alert recipient can action the intervention from the in-app tray.** "Take action" button on an urgent alert routes to the propose-intervention modal with context pre-filled. Why: operators get alerts when they're mid-task; forcing them to navigate to the dashboard first adds friction. Mockup: `operator-alert-received.html`.

**U10 — Config Assistant chat is site-wide, not ClientPulse-specific.** Opens from any settings callout, global nav, or ⌘K. Why: one assistant surface for all config, one vocabulary. Mockup: `config-assistant-chat.html`.

**U11 — Config Assistant confirms before writing.** Every mutation goes through a structured confirmation card in-bubble with apply/cancel. Why: prevents "I meant 0.35 not 3.5" typos; matches the existing Configuration Assistant pattern. Mockup: `config-assistant-chat.html`.

**U12 — Template editor stages all edits locally; Save is atomic across tabs.** Dirty-state badges on left-nav items; staged-edits banner summarises all pending changes. Why: sysadmin often needs to coordinate changes across multiple sections (e.g. raise a weight AND shift a band AND update a saved template) and losing work when clicking a tab is unacceptable. Mockup: `template-editor.html`.

**U13 — Sysadmin can edit a template in-place from the create-org flow** via "Edit ↗" on the template card. Why: sysadmin is the same person vetting templates; roundtrip-to-admin-page breaks flow. Mockup: `onboarding-sysadmin.html`.

**U14 — Org admins cannot create or fork templates in v1.** Only override at the org level. Why: template quality is signal quality; vetting belongs with sysadmins. See §18.6.

**U15 — Intelligence Briefing (Mon 07:00) is forward-looking; Weekly Digest (Fri 17:00) is backward-looking.** Different roles. Briefing: "what to focus on this week." Digest: "what happened this week." Mockups: `intelligence-briefing.html`, `weekly-digest.html`. See §13.5.

**U16 — Briefings + digests have org-level AND per-client variants.** Both coexist. Org variant is the agency-owner summary; per-client variant is optionally forwarded to the client as a status update. Mockups: `briefing-per-client.html`, `digest-per-client.html`.

**U17 — No technical jargon in user-facing copy.** All canonical slugs humanised at the UI layer (e.g. `staff_activity_pulse` → "Staff activity"). Comprehensive snake_case audit performed. Why: operators are not engineers; leaking internal identifiers reads as unfinished. Affected mockups: `drilldown.html`, `dashboard.html`, `inline-edit.html`.

**U18 — Tasks created by Primitive 4 live in the client's CRM, not a Synthetos task board.** Why: the Synthetos task board is for AI-agent work, not human work. Human tasks belong where the human does their CRM work. Mockup: `create-task.html`.

**U19 — Synthetos composes, CRM dispatches (for email + SMS).** Preserves the agency's domain authentication and SMS provider contracts. Why: Synthetos is not an email/SMS provider and should not try to be one. See §15.1 row 2/3. Mockups: `email-authoring.html`, `send-sms.html`.

**U20 — Cold-start state shown explicitly, not as zero-scores.** First 24h (and any sub-account with insufficient signal) renders a "gathering data" state rather than displaying 0 for health score. Why: zeros-as-unknowns mislead operators. See §7.7.

### 20.3 Cross-reference

- §15 Action primitives ← U5, U6, U7, U8, U18, U19
- §17 Configuration Agent ← U10, U11
- §18 Template editor ← U12, U13, U14
- §13 Briefings/digests ← U15, U16
- §7 Dashboard ← U1, U2, U3, U4, U17, U20

---

## 21. V1 vs V2 scope delineation

The temptation throughout this design has been to build the "complete" product in one release. This section hard-draws the line. **V1 ships the proposer loop + outcome signal + intervention execution. V2 adds learning.**

### 21.1 In-scope for V1

**Signal ingestion**
- 8 signals (§2) with adapter parity for GHL (other CRMs deferred to v1.1+).
- Nightly + heartbeat polling cadence, no real-time webhook coverage except the critical 3 from §2.1.

**Health + churn scoring**
- Weighted composite health score (§4) with 5 default factors + template-driven customisation.
- 4-band churn model (§5) with template-driven thresholds.
- Confidence / cold-start handling (§4.4, §7.7).

**Intervention execution**
- All 5 action-type primitives (§15) — full editor UX for each.
- Canonical merge fields (§16) with v1 grammar (namespace.field, no fallback syntax).
- **Automated scenario detection, manual action trigger.** The `proposeClientPulseInterventionsJob` scans signals and writes **review-queue items** (`reviewItems` rows) when a scenario fires; every action still requires an operator approval click before execution. There is no auto-execution path in V1. "Proposer" throughout this spec means "scenario detector that creates HITL-gated proposals," never "system that fires interventions without a human in the loop." Truly autonomous / auto-execution proposers are V2 only (see §21.2).
- HITL gate (gateLevel: 'review') on every action.
- Outcome signal: **band-change only** (a proposed-and-fired intervention that lands in a visible band improvement is counted as "worked"). No webhook-based outcome attribution.

**Portfolio surfaces**
- Dashboard (§7) with Google-Sheets-style column UX.
- Per-client drilldown.
- Intelligence Briefing (Mon 07:00) + Weekly Digest (Fri 17:00) — both org-level and per-client variants.
- In-app operator alerts + recipient tray.

**Configuration**
- Settings page with per-section editors.
- Configuration Agent chat (§17) with v1-scope mutation contract (path-level set + reset_to_default).
- Template editor (§18) for sysadmins.

**Onboarding**
- Sysadmin create-org flow with template picker + Edit integration.
- Orgadmin 4-screen first-run.

**Trial monitoring**
- Milestone + nudge schema (§8).
- Integrates as a special case of the intervention pipeline, not a separate subsystem.

### 21.2 Deferred to V2

**Learning / optimisation**
- Auto-proposer (suggests interventions without operator trigger).
- Per-template outcome analytics (which templates' configurations actually improve band transition rates).
- Back-test runner (referenced by the Config Assistant's follow-up suggestion but not built — v2 introduces the execution engine).
- Intervention effectiveness scoring beyond band-change (open rate, reply rate, booked-call rate via webhook attribution).

**Configuration Agent v2**
- Array-append/remove via chat (e.g. "add a new saved email template").
- Bulk operations (e.g. "reset all blind-spot thresholds").
- Conditional edits (e.g. "if my portfolio has >100 clients then ...").
- Cross-org comparison queries (for agencies with multiple Synthetos orgs).

**Multi-CRM**
- HubSpot adapter (capability parity with GHL).
- Pipedrive adapter.
- Salesforce adapter (far future — scope discussion needed).

**Template management**
- Org-level fork of a system template.
- Template versioning + migration (what happens when a sysadmin wants to ship a breaking change to an existing template).
- Template marketplace / sharing between Synthetos orgs (explicitly a non-goal, per CLAUDE.md non-goals).

**Client-facing surfaces**
- Client portal where the client sees their own health score + intervention history.
- Client-initiated acknowledgement of nudges ("I saw this; here's what I did").

**Sub-account admin surfaces**
- Per-sub-account tuning (v1 only sysadmin + orgadmin can configure).

**Cross-org portfolio view**
- For agency-of-agencies scenarios (§3.4). Not in V2 either — parked until real demand.

### 21.3 Explicitly not doing (any version)

Reaffirming the non-goals at a module level:

- **No Synthetos-hosted email/SMS sending.** Always dispatch via client's CRM.
- **No Synthetos-side CRM workflow authoring.** Operator points at existing CRM automations; we don't build a workflow designer.
- **No workflow auto-install into client CRMs.** 522+ workflow installs × versioning = nightmare. Operators map existing workflows.
- **No playbook marketplace for ClientPulse-specific content.** Templates stay sysadmin-vetted.
- **No side-channel email/SMS send outside an intervention.** Every outbound is an intervention with audit + rollback + attribution. No "just send this" escape hatch.

### 21.4 V1 ship criteria

V1 ships when:

1. One pilot agency (Kel / Productivity Hub) has the full loop working against their real GHL accounts.
2. At least one complete intervention has been proposed, approved, executed via primitive 1 (fire automation), with band-change observed.
3. Weekly Digest delivered for two consecutive Fridays with no operator-reported errors in content.
4. Configuration Agent chat has applied at least one successful config change end-to-end (sysadmin-seeded pilot change counts).
5. All 20 mockup surfaces are implemented with no placeholder states.

Anything short of this is v1-alpha.

---

## 22. Ingestion contract — per-signal freshness, path, and backfill (added 2026-04-18, per external review)

An external reviewer flagged that polling, webhook, and backfill exist as independent components but no single contract specifies per-signal freshness. This section is that contract. It cross-references `docs/canonical-data-platform-roadmap.md` (which covers the platform-level ingestion model) and narrows it to the ClientPulse-specific signals from §2.

### 22.1 Per-signal ingestion table

For each of the 8 ClientPulse signals, declare: primary ingest path, fallback path, freshness SLA, backfill window, canonical destination.

| # | Signal | Primary | Fallback | Freshness SLA | Backfill on connect | Canonical destination |
|---|--------|---------|----------|---------------|---------------------|----------------------|
| 1 | Last Activity (contact events) | Webhook (`ContactUpdate`, `OpportunityUpdate`) | Polling (hourly) | ≤ 5 min via webhook; ≤ 60 min via poll | 90 days | `canonical_contacts.last_activity_at` + `canonical_subaccount_mutations` |
| 2 | Pipeline velocity | Polling (hourly) | — | ≤ 60 min | 90 days | `canonical_opportunities` → derived into `canonical_metrics` |
| 3 | Funnel count + last-updated | Polling (daily 03:00 UTC) | Ad-hoc skill fetch | ≤ 24h | 30 days | `canonical_metrics` (metric_slug: `funnel_count`, `funnel_last_updated_days`) |
| 4 | Calendar quality | Polling (daily 03:00 UTC) | Ad-hoc skill fetch | ≤ 24h | Current state only (no historical calendars) | `canonical_metrics` (metric_slug: `calendar_quality_score`) |
| 5 | Conversation engagement | Webhook (`InboundMessage`, `OutboundMessage`) | Polling (hourly) | ≤ 5 min via webhook; ≤ 60 min via poll | 90 days | `canonical_conversations` |
| 6 | Contact growth | Polling (hourly) | — | ≤ 60 min | 180 days | `canonical_contacts` → derived into `canonical_metrics` (metric_slug: `contact_growth_30d`) |
| 7 | Revenue trend | Polling (daily 04:00 UTC, agency-billing or Stripe) | Ad-hoc skill fetch | ≤ 24h | 180 days | `canonical_revenue` → derived into `canonical_metrics` |
| 8 | Staff activity (derived, §2.0b) | Polling (hourly) — derived from mutations stream | — | ≤ 60 min | 90 days | `canonical_subaccount_mutations` → derived into `canonical_metrics` (metric_slug: `staff_activity_score`) |
| + | Integration fingerprint (§2.0c) | On-demand scan (fingerprint scanner job) | — | ≤ 24h (opportunistic) | Current state only | `client_pulse_integrations_detected` |
| + | Onboarding milestone progress (§8) | Derived from signals 1, 3, 4, 7 | — | Same as source signals | Same as source | `client_pulse_milestone_progress` |

**Note:** "Ad-hoc skill fetch" = a skill can trigger a fresh pull outside the poll cadence when the operator explicitly asks (e.g. "re-check calendar config for Smith Dental now"). This goes through the same adapter layer with full idempotency.

### 22.2 Freshness SLA policy

- **Green SLA (within spec):** signal observation timestamp is within the SLA column above.
- **Amber SLA:** signal is 1×–2× the SLA window. Surface a warning indicator on dashboard tile + drill-down.
- **Red SLA:** signal is > 2× the SLA window. Surface a blocking indicator; exclude the signal from composite health-score computation (it becomes a missing factor, which triggers the §4.6.3 re-weighting).

SLA thresholds are evaluated by existing `STALE_THRESHOLDS` in `server/config/connectorPollingConfig.ts` (already has `warningMultiplier` + `errorMultiplier`). No new code; just per-signal configuration.

### 22.3 Backfill lifecycle

Every new connector connection goes through three phases on `integration_connections.sync_phase` (per `docs/canonical-data-platform-roadmap.md` §P1):

1. **`backfill`** — pulls the historical window listed in §22.1 (up to 180 days). Health scoring is suppressed (`confidence: 'backfill'`) during this phase. Dashboard shows "importing history…"
2. **`transition`** — backfill complete; waiting for first fresh poll to confirm live ingestion is working. Scoring begins in cold-start mode.
3. **`live`** — steady state. Full SLA enforcement applied.

Cutover between phases is idempotent + resumable — a crash during backfill resumes from the last-ingested observation.

### 22.4 Webhook vs polling discipline

- **If a webhook is configured and delivering**, webhook is the source of truth; the corresponding poll runs at a longer cadence (every 6h, as a consistency check + backfill for missed events).
- **If webhook delivery falls behind** (no events received in 2× expected interval for that signal), poll cadence shortens back to the primary rate and an `operator_alert` is raised ("GHL webhook stopped delivering for Smith Dental — falling back to polling").
- **Dedup:** webhook events are deduped via `canonical_webhook_events` + in-memory TTL store (`server/lib/webhookDedupe.ts`) on arrival. Same event id arriving twice is a no-op.

### 22.5 Rate-limit interaction (see §23)

Polling cadence from §22.1 is **per sub-account**. With 180 sub-accounts × 8 signals × various cadences, the aggregate call rate against GHL can exceed GHL's per-token rate limits. Rate-limit infrastructure (§23) is a hard dependency on these cadences being safely achievable.

### 22.6 What this section does NOT cover

- Webhook handler implementations per provider (lives in `server/routes/webhooks/`)
- Adapter-specific polling logic (lives in `server/services/connectorPollingService.ts`)
- Canonical dictionary field-level definitions (lives in `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`)
- Principal-context / RLS for canonical tables (lives in migration 0168 + `server/config/rlsProtectedTables.ts`)

All of the above already exist. This section is the **ClientPulse-signal-level** contract that pins each of the 8 signals to a concrete ingest path + SLA so the scoring pipeline can declare "stale" / "missing" vs "fresh" deterministically.

---

## 23. Rate limiting, SLA, and the measureInterventionOutcomeJob contract (added 2026-04-18, per external review)

Three concerns the reviewer raised that land in a single section because they share root causes.

### 23.1 Rate limiting — close the GHL adapter gap

**Audit finding:** `server/lib/rateLimiter.ts` implements a token-bucket `RateLimiter` and `connectorPollingService.ts:87` calls `getProviderRateLimiter(config.connectorType).acquire(config.id)` before ingestion. However, the GHL adapter (`server/adapters/ghlAdapter.ts`) makes direct HTTP calls outside the polling service and **does not invoke the rate limiter**. This is the gap.

**Fix (Phase 1 blocker):**

1. Every GHL adapter HTTP call routes through a new `server/adapters/ghlRateLimitedFetch.ts` wrapper that calls `getProviderRateLimiter('ghl').acquire(connectionId)` before `fetch()`.
2. Rate-limit budget is configured per GHL tier (dev / Pro / Agency Pro) from `operational_config.integrationRateLimits.ghl.{tier}.{requestsPerSecond, burstTokens}`.
3. When the bucket is empty, the wrapper **queues** the call (backpressure) rather than dropping or failing. Queued-call telemetry goes to `integration_health_metrics` so operators see when GHL is being throttled.
4. Every call emits a `pollingCallCount` + `pollingLatencyMs` datum; Kel's GHL OAuth contact provides quota numbers to seed the config.

**Ship gate:** simulated burst of 100 GHL calls in 1 second against a 10 req/s bucket is correctly throttled, queued, and drained without error.

### 23.2 Published SLA table

No single SLA doc exists today. Consolidated here:

| Surface | SLA |
|---------|-----|
| Dashboard signal freshness (realtime signals: activity, messages) | ≤ 5 min via webhook; ≤ 60 min via poll fallback (see §22.1) |
| Dashboard signal freshness (batch signals: funnels, calendars, revenue) | ≤ 24h |
| Health-score recompute after new observation | ≤ 15 min (per-sub-account `computeSubaccountHealthJob` debounce) |
| Intervention proposal surfaces after band change | ≤ 15 min (triggered from `computeSubaccountHealthJob` completion event) |
| Intervention approve → execute (via CRM adapter) | ≤ 30s for p95 |
| Outcome measurement after intervention | 14-day band-change window (see §23.3) |
| Intelligence Briefing delivery | Monday 07:00 in the schedule's timezone ±5 min (`scheduledTasks.timezone`; there is no `organisations.timezone` column in V1, see I10 in §27) |
| Weekly Digest delivery | Friday 17:00 in the schedule's timezone ±5 min (same source) |
| Configuration change (chat or settings) → effective | Next scan cycle (≤ 15 min for per-sub-account settings; immediate for agent-run-level settings) |

All SLAs are enforced via existing `STALE_THRESHOLDS` in `server/config/connectorPollingConfig.ts` (polling layer) and pg-boss `retryLimit` + `retryDelay` (job layer). No new SLA-enforcement infrastructure needed; this table is the contract the implementation is measured against.

### 23.3 measureInterventionOutcomeJob — close the feedback loop

**Audit finding:** `interventionOutcomes` table exists (`server/db/schema/interventionOutcomes.ts`) with `healthScoreBefore`, `healthScoreAfter`, `deltaHealthScore`, outcome classification. `recordOutcome()` function exists in `interventionService.ts:53–90`. However, **no background job actually triggers outcome measurement** — the spec (§10 Phase 4) calls for `measureInterventionOutcomeJob` but it does not exist in `server/jobs/`.

Without this job, the feedback loop is incomplete: interventions can be recorded, but nothing measures whether they worked.

**Contract for the missing job (Phase 4 blocker):**

```
measureInterventionOutcomeJob
  trigger:       cron (hourly) — checks all interventions with status='executed'
                 AND executed_at > now() - interval '14 days'
                 AND outcome IS NULL
  action:        for each candidate:
                   - fetch current health_snapshot for the account
                   - compare to healthScoreBefore stored on the intervention row
                   - if days_since_execution >= 14:
                       compute delta = currentScore - healthScoreBefore
                       classify: delta > 5 = 'improved'
                                 delta < -5 = 'worsened'
                                 else      = 'unchanged'
                       write intervention_outcomes row via recordOutcome()
                   - if days_since_execution < 14:
                       no-op (wait; will re-check next hour)
  idempotency:   idempotencyKey = `measure_outcome:${interventionId}`
                 (ensures the job can run every hour safely; recordOutcome() returns
                  existing row if already measured)
  retry:         retryLimit: 3, retryBackoff: true (standard pg-boss config)
```

**Signal for "band change" vs "score delta":** §21.1 defines v1 outcome as **band-change-only**. The job records both `deltaHealthScore` (numeric) and `bandChange` (`critical → at_risk`, etc.) on the outcome row. Band-change is the primary V1 signal; numeric delta is stored for V2 analytics (effectiveness scoring beyond band change).

**Causal linkage:** the outcome row's `interventionId` + `actionId` + `configVersionAtDecision` fields give full traceability: intervention X (fired under config version Y) produced outcome Z. This powers V2 effectiveness analytics ("does tuning weight W from 0.3 → 0.4 improve intervention success rate?").

**Ship gate (Phase 4):** simulated intervention fired against a cold-start sub-account, followed by synthetic observations that improve the health score past the band threshold; `measureInterventionOutcomeJob` runs, writes an outcome row with `bandChange: 'at_risk → watch'`, visible in the drilldown's intervention history.

### 23.4 What this section does NOT cover

- The existing rate-limiter implementation (`server/lib/rateLimiter.ts`) — no changes needed, only adapter wiring
- The existing `interventionOutcomes` table — no schema changes needed, only the job
- V2 effectiveness analytics — deferred (§21.2)

---

## 24. Pre-build engineering audit — claim-by-claim verification (added 2026-04-18)

An external reviewer submitted a spec review with 7 critical gaps + 4 secondary gaps. A codebase audit was run against each claim (see `tasks/clientpulse-ghl-gap-analysis.md` session transcript 2026-04-18). This section records the findings so future reviewers (human or agent) can see what was verified vs what was genuinely missing.

### 24.1 Claims-vs-reality table

| # | Reviewer claim | Verdict | Evidence | Spec action taken |
|---|----------------|---------|----------|-------------------|
| 1 | "Missing canonical data model" | **FALSE** | 9 canonical tables (`canonical_accounts`, `canonical_contacts`, `canonical_opportunities`, `canonical_conversations`, `canonical_revenue`, `canonical_metrics`, `canonical_metric_history`, `health_snapshots`, `anomaly_events`); `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` (300+ lines); `docs/canonical-data-platform-roadmap.md`; RLS via migration 0168 | Cross-ref added to §22.6 |
| 2 | "Scoring not formally defined" | **PARTIALLY TRUE** | Implementation is rigorous (`intelligenceSkillExecutor.ts:19–310`: 4 normalisation types, cold-start, missing-data re-weighting) but spec doc did not consolidate the formula | §4.6 added (formula consolidation) |
| 3 | "Orchestrator responsibilities blurred → monolith risk" | **PARTIALLY VALID** | `docs/orchestrator-capability-routing-spec.md` defines four-path routing; layers separated at service level (`hitlService`, `executionLayerService`, `skillExecutor`); BUT routing classification lives in LLM prompt, not in a dedicated code service | V2 concern — no spec change; noted for future extraction to a dedicated `orchestratorRoutingService.ts` |
| 4 | "No idempotency / retry model" | **FALSE** | `actions.idempotency_key` with unique constraint (`server/db/schema/actions.ts:42, 87`); agent-run dedup (`agentExecutionService.ts:166–175, 305–341`); `JOB_CONFIG` idempotency strategies (`server/config/jobConfig.ts:7–34`); `scripts/verify-job-idempotency-keys.sh` CI gate; `webhookDedupe.ts` | Cross-ref added to §23.3 (idempotencyKey in job contract) |
| 5 | "Weak feedback loop — no causal linkage" | **SUBSTANTIALLY TRUE** | `interventionOutcomes` schema exists with `healthScoreBefore/After`, `deltaHealthScore`, `outcome`, `interventionId`, `configVersion`; `recordOutcome()` implemented; BUT `measureInterventionOutcomeJob` does not exist in `server/jobs/` | §23.3 added (job contract locked as Phase 4 blocker) |
| 6 | "Multi-tenant isolation not addressed" | **FALSE** | 41 RLS-protected tables (`server/config/rlsProtectedTables.ts:43–328`); `withPrincipalContext.ts` sets 4 session vars per txn; migration 0168 protects canonical tables with dual-layer policies; `portfolioRollupService.ts:68` explicit invariant | Cross-ref added to §22.6 |
| 7 | "Config assistant guardrails missing" | **PARTIALLY VALID** | Validation specced in §17.2.3; `configHistory` + `configBackups` infrastructure exists; `actions.gateLevel='review'` + `reviewItems` infrastructure exists; audit reuses existing `config_history` with new entity_type — no migration needed; ClientPulse config edits still need wiring to action→review gate | §17.6 added (7 required guardrails made ship-gate mandatory); §17.2.6 revised 2026-04-18 to reuse `config_history` |
| S1 | "No clear ingestion model" | **PARTIALLY VALID** | Polling config (`connectorPollingConfig.ts`), webhook handlers (`server/routes/webhooks/`), backfill design (`canonical-data-platform-roadmap.md:481–505`) all exist separately; BUT no single per-signal contract | §22 added (per-signal ingestion table) |
| S2 | "No rate limiting / API quotas" | **VALID** | `RateLimiter` class exists (`server/lib/rateLimiter.ts`) + called from `connectorPollingService:87`; BUT GHL adapter (`server/adapters/ghlAdapter.ts`) does not invoke the rate limiter | §23.1 added (Phase 1 wiring blocker) |
| S3 | "No latency / SLA expectations" | **PARTIALLY VALID** | `STALE_THRESHOLDS` in `connectorPollingConfig.ts` with warning/error multipliers; BUT no published SLA per surface | §23.2 added (published SLA table) |
| S4 | "No security / permission model" | **FALSE** | `server/lib/permissions.ts:1–340` fully defined with atomic keys, role templates (Org Admin / Manager / Viewer, Subaccount Admin / Manager / User), RLS-enforced via `org_user_roles` and `subaccount_user_assignments` | Cross-ref added to §17.6.2 (sensitive-path approval gate uses existing `gateLevel='review'`) |

### 24.2 Net-new spec additions from this review

Five sections added / strengthened:

- **§4.6** — Consolidated scoring formula (where the formula lives in code; determinism guarantee; missing-data re-weighting)
- **§17.6** — Configuration Agent guardrail requirements (7 mandatory guardrails; sensitive-path definitions; validation-failure UX; ship-gate amendment)
- **§22** — Per-signal ingestion contract (webhook vs polling, freshness SLA, backfill phases)
- **§23** — Rate limiting + SLA table + `measureInterventionOutcomeJob` contract
- **§24** — This verification audit itself

### 24.3 No-op responses (reviewer was wrong)

Five claims were wrong in fact; the spec was updated to cross-reference the existing infrastructure so future reviewers find it:

- Canonical data model (claim 1) — point to `docs/canonical-data-platform-roadmap.md` + `canonicalDictionaryRegistry.ts`
- Idempotency (claim 4) — point to `JOB_CONFIG` + `actions.idempotency_key`
- Multi-tenant isolation (claim 6) — point to migration 0168 + `rlsProtectedTables.ts`
- Security/permissions (S4) — point to `permissions.ts`
- Orchestrator monolith risk (claim 3) — acknowledged as real v2 concern but not a v1 blocker

### 24.4 Why this matters

Reviewer feedback is valuable **precisely because** each claim forces us to point at real evidence. Five of eleven claims turned out to be wrong about the codebase but right about the spec — the spec didn't cross-reference enough existing infrastructure, so a smart external reader assumed it was missing. Six of eleven claims were genuinely actionable (partially or fully) and have concrete spec additions. Net: the spec is materially tighter, and the paper trail ensures future reviews don't re-litigate the same ground.

---

## 25. Implementer quick-reference appendix (added 2026-04-18, per second-pass reviewer)

A compact reference so builders don't need to context-switch across `architecture.md`, `docs/canonical-data-platform-roadmap.md`, `server/config/*.ts`, or `server/lib/permissions.ts` to pick up the invariants this spec depends on. **Every table in this section is a pointer to authoritative infrastructure that already exists.** If the spec contradicts the pointer, the pointer is source-of-truth.

### 25.1 Canonical tables

All tables have: `organisation_id` (FK), `connector_config_id` (FK, where applicable), `external_id` (provider's ID), `UNIQUE(organisation_id, provider_type, external_id)`, RLS-protected via migration 0168, adapter writes via `canonicalDataService` methods.

| Table | Purpose | Adapter write path | Schema file |
|-------|---------|---------------------|-------------|
| `canonical_accounts` | Sub-account / tenant record from provider | `adapter.ingestion.listAccounts()` → `upsertAccount()` | `server/db/schema/canonicalEntities.ts` |
| `canonical_contacts` | Contact / lead record | `adapter.ingestion.fetchContacts()` → `upsertContact()` | `canonicalEntities.ts` |
| `canonical_opportunities` | Deal / opportunity / pipeline record | `adapter.ingestion.fetchOpportunities()` → `upsertOpportunity()` | `canonicalEntities.ts` |
| `canonical_conversations` | Message thread / conversation | `adapter.ingestion.fetchConversations()` → `upsertConversation()` | `canonicalEntities.ts` |
| `canonical_revenue` | Financial transactions + MRR/ARR | `adapter.ingestion.fetchRevenue()` → `upsertRevenue()` | `canonicalEntities.ts` |
| `canonical_metrics` | Current value of a named metric (e.g. `pipeline_velocity_30d`) | `adapter.ingestion.computeMetrics()` → `upsertMetric()` | `canonicalEntities.ts` |
| `canonical_metric_history` | Append-only historical metric values (timeseries) | Same as above, with period slice | `canonicalEntities.ts` |
| `canonical_subaccount_mutations` | Event log of staff-attributed writes (for Staff Activity Pulse §2.0b) | Adapter mutation webhook handlers | `server/db/schema/canonicalEntities.ts` |
| `canonical_webhook_events` | Inbound webhook event dedup log | Webhook routers (`server/routes/webhooks/*`) | `canonicalEntities.ts` |
| `health_snapshots` | Point-in-time health-score snapshot (with `factorBreakdown`) | `intelligenceSkillExecutor` on `compute_health_score` | `canonicalEntities.ts` |
| `anomaly_events` | Detected deviation from baseline | `intelligenceSkillExecutor` on metric thresholds | `canonicalEntities.ts` |

**Dictionary:** `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` — 300+ lines describing purpose, columns, constraints, skill references, anti-patterns per table.

**Roadmap:** `docs/canonical-data-platform-roadmap.md` covers program-level phases (P1–P6) including backfill lifecycle, RLS policies, principal-context migration.

**ClientPulse-only additions** (not yet migrated; specified in §9.4 + §22):
- `client_pulse_signal_observations` (timeseries, per-subaccount, per-signal)
- `client_pulse_health_snapshots` (ClientPulse-shaped; supersedes generic `health_snapshots` for ClientPulse flows)
- `client_pulse_integrations_detected` (fingerprint scanner output)
- `client_pulse_milestone_progress` (trial monitoring)

**Explicitly NOT a new table** (corrected 2026-04-18 per Codex pass):
- **Interventions** reuse existing `actions` + `reviewItems` + `interventionOutcomes` — ClientPulse metadata lives in `actions.metadataJson`. See §10 Phase 4 for the metadata shape.
- **Config changes audit** reuses existing `config_history` — ClientPulse writes use `entity_type='clientpulse_operational_config'` with the dot-path as `entity_id_hash`. See §17.2.6 (revised) for the extension contract.

### 25.2 Idempotency + retry contract

**Location of source-of-truth:** `server/config/jobConfig.ts:7–34` (strategy enum) + `scripts/verify-job-idempotency-keys.sh` (CI gate).

| Layer | Mechanism | Column / key | Enforcement |
|-------|-----------|--------------|-------------|
| **Actions** | `actions.idempotency_key` + `UNIQUE(subaccountId, idempotencyKey)` | `server/db/schema/actions.ts:42, 87` | Schema-level — duplicate insert fails |
| **Agent runs** | `agentRuns.idempotencyKey` returned from `agentExecutionService` if duplicate key submitted | `agentExecutionService.ts:166–175, 305–341` | Service-level — returns existing result |
| **pg-boss jobs** | `idempotencyStrategy` per queue: `payload-key`, `singleton-key`, `one-shot`, `fifo` | `server/config/jobConfig.ts` — declared per queue | CI gate `verify-job-idempotency-keys.sh` fails if a queue lacks strategy |
| **Webhooks** | In-memory TTL dedup store (10 min) | `server/lib/webhookDedupe.ts` | Handler-level — duplicate event id no-ops |
| **Interventions** | `interventionService.checkCooldown(orgId, accountId, scope, windowHours)` | `server/services/interventionService.ts:13–49` | Service-level — returns early if within cooldown |

**Retry policy:** every pg-boss queue declares `retryLimit` (2–5), `retryDelay` (seconds), `retryBackoff: true` (exponential). Dead-letter queues configured per tier.

**ClientPulse contract:**
- `idempotencyKey = hash(subaccountId + connectorPollRunId)` for signal-ingestion jobs (§4.3)
- `idempotencyKey = measure_outcome:${interventionId}` for outcome-measurement job (§23.3)
- `idempotencyKey = config_change:${orgId}:${path}:${timestamp}` for Configuration Agent mutations (§17.2)

### 25.3 Multi-tenant enforcement

**Location of source-of-truth:** `server/config/rlsProtectedTables.ts:43–328` (manifest), `server/db/withPrincipalContext.ts` (runtime), migration 0168 (canonical RLS policies).

| Layer | Mechanism | Enforcement |
|-------|-----------|-------------|
| **Database** | PostgreSQL RLS policies on 41 tables | Every query filtered by `current_setting('app.organisation_id')` unless principal has bypass role |
| **Session context** | `withPrincipalContext()` sets 4 session vars per txn: `app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids` | Required wrapper for every RLS-protected query |
| **Route handler** | `req.orgId` extracted from auth token; `resolveSubaccount(subaccountId, orgId)` on every `:subaccountId` route | Middleware — `architecture.md` rule |
| **Service** | Queries filter by `organisationId = req.orgId` (never `req.user.organisationId`) | Convention — code-review rule, CLAUDE.md |
| **Job** | pg-boss job handlers re-validate `organisationId` before acting | Handler-level (`orchestratorFromTaskJob.ts:159–162` pattern) |
| **Canonical writer** | Bypass role `canonical_writer` scoped to org-level writes only | Migration 0168 dual-layer policies |

### 25.4 Permission layers

**Location of source-of-truth:** `server/lib/permissions.ts:1–340`.

**Role model:**
- System admin — Synthetos staff (cross-org visibility via bypass role)
- Org admin / Org manager / Org viewer — agency owners and staff (scoped to their organisation_id)
- Subaccount admin / Subaccount manager / Subaccount user — (v2; not in v1 scope)

**Atomic permission keys** (selected — full list in `permissions.ts`):

| Key | Held by | Gates |
|-----|---------|-------|
| `ORG_PERMISSIONS.REVIEW_VIEW` | Org Admin, Manager, Viewer | See review queue |
| `ORG_PERMISSIONS.REVIEW_APPROVE` | Org Admin, Manager | Approve items (including Config Agent sensitive-path changes, §17.6.2) |
| `ORG_PERMISSIONS.CLIENTPULSE_CONFIG_EDIT` | Org Admin | Write to `operational_config` via settings UI or chat |
| `ORG_PERMISSIONS.TEMPLATE_EDIT` | System admin only | Edit master templates (§18.6) |
| `SUBACCOUNT_PERMISSIONS.INTERVENTION_CREATE` | Org Manager (for any subaccount they manage) | Propose interventions |
| `SUBACCOUNT_PERMISSIONS.INTERVENTION_APPROVE` | Org Admin, Manager | Approve/execute interventions |

**Enforcement pattern:** Express middleware stack — `authenticate` → permission guard → route handler. Guard rejects with 403 before handler runs. UI gates surface visibility via `/api/my-permissions` and `/api/subaccounts/:id/my-permissions` (CLAUDE.md rule).

**ClientPulse-specific gates:**
- Config Agent sensitive-path writes require `REVIEW_APPROVE` on the resulting action row (§17.6).
- Template editor is sysadmin-only (§18.6).
- Saved email/SMS template edits are org-admin only and sensitive (§17.6.2).

### 25.5 Key files per domain (ClientPulse-specific addendum to architecture.md)

| Task | Start here |
|------|------------|
| Add a new ClientPulse signal | `server/services/connectorPollingService.ts` adapter wiring + `canonicalDictionaryRegistry.ts` dictionary entry + §22.1 ingestion contract row |
| Add a health-score factor | `server/services/orgConfigService.ts:DEFAULT_HEALTH_SCORE_FACTORS` + `intelligenceSkillExecutor.ts` normalisation type + §4.6.2 table |
| Add a blind-spot detector | Template editor §18 left-nav + detector definition in `operational_config.blindSpotDetection[]` |
| Add an intervention primitive (beyond the 5) | `server/config/actionRegistry.ts` + adapter method + editor component + §15 primitive table |
| Add a canonical merge field namespace | `server/services/mergeFieldResolver.ts` (Phase 4) + JSON Schema + §16.1 namespace table |
| Wire a new sensitive config path | §17.6.2 sensitivity policy table + JSON Schema `sensitive: true` flag |
| Add a new ClientPulse playbook (briefing / digest) | `server/playbooks/*.playbook.ts` + `system_playbook_templates` seed + §13.6 |

---

## 26. Outstanding blockers + ship-gate tracker (added 2026-04-18)

Explicit tracker for items that were flagged as still-open in the second-pass review. These are not spec gaps — the spec calls them out — but they are **implementation items that must clear before rollout**.

### 26.1 Ship-gate blockers (hard)

| # | Item | Phase | Source | Owner check |
|---|------|-------|--------|-------------|
| B1 | **Wire `RateLimiter` into GHL adapter** — infra exists (`server/lib/rateLimiter.ts`), adapter makes direct HTTP calls without acquiring tokens. | Phase 1 | §23.1 + external review 2026-04-18 | Ship-gate for Phase 1. No production rollout against real GHL accounts without this. |
| B2 | **Implement `measureInterventionOutcomeJob`** — schema + `recordOutcome()` exist, no job runs. Without it, the feedback loop is write-only. | Phase 4 | §23.3 + external review 2026-04-18 | Ship-gate for Phase 4. Outcome recording without measurement is a false-bottom claim. |
| B3 | **Wire Configuration Agent to write ClientPulse edits to existing `config_history`** (entity_type='clientpulse_operational_config'). No new audit table — revised 2026-04-18 per Codex pass. | Phase 4.5 | §17.6 + §17.2.6 (revised) | Ship-gate for Phase 4.5. Audit log is non-negotiable for config-via-chat. |
| B4 | **Author `operational_config` JSON Schema with `sensitive` flags** — needed for schema validation, sum-constraint checks, sensitive-path routing. | Phase 0 | §17.6.1, §17.6.2 | Ship-gate for Phase 0 (unblocks Phase 4.5 parallel work). |
| B5 | **Implement sensitive-path routing through action→review queue** — Configuration Agent must create `actions` row with `gateLevel='review'` for paths flagged sensitive. | Phase 4.5 | §17.6.1 | Ship-gate for Phase 4.5. |
| B6 | **Update Configuration Assistant chat UX copy to reflect dual-path governance** — greeting + banner + message templates must show "most changes apply instantly; sensitive changes route through review queue." | Phase 5 | §17.6 + external review 2026-04-18 + `clientpulse-mockup-config-assistant-chat.html` (updated 2026-04-18) | Ship-gate for Phase 5. Mockup updated; implementation must match. |

### 26.2 Non-blocking technical debt (track, don't gate)

| # | Item | Deferred to | Source |
|---|------|-------------|--------|
| D1 | **Extract orchestrator routing logic into a dedicated `orchestratorRoutingService.ts`** — currently lives in the Orchestrator's system prompt. Maintainability risk as intervention types expand. | V2 | §24.1 row 3 + external review 2026-04-18 |
| D2 | **Move webhook dedup store from in-memory TTL to Redis** — current implementation works for single-instance; noted in comments. | V2 / when horizontal scaling | `server/lib/webhookDedupe.ts` comments |
| D3 | **Per-GHL-tier rate-limit quota config** — `operational_config.integrationRateLimits.ghl.{tier}.{rps, burst}` needs seeded values from Kel's GHL contact. | Phase 1 (needs Kel) | §23.1 |
| D4 | **Back-test runner for scoring-config changes** — Configuration Agent surfaces "want to run a back-test?" CTA but the execution engine is V2. | V2 | §21.2 |
| D5 | **V2 Config Agent mutations:** array-append/remove, bulk operations, conditional edits. | V2 | §17.5 |

### 26.3 Why this section exists

Second-pass external reviewer called out that "approved with blocker list" is the right framing — not "needs major rethink." This section makes the blocker list explicit and separable from the design work so implementation can track them as discrete items rather than buried references inside longer sections.

**Before marking v1 "shipped":** every B-row in §26.1 must be `done`. D-rows are technical debt to backlog, not gates.

---

## 27. Third-pass Codex review response (added 2026-04-18)

A third-pass reviewer (Codex automated spec-review loop) surfaced 11 new concerns — 5 classified as CRITICAL (will break the build if shipped as-is), 6 as IMPORTANT (real technical-debt risks). Each was audited against spec + codebase. Result: 5 real contradictions fixed, 4 were pre-existing or reviewer-misread, 2 were valid clarifications.

### 27.1 Per-claim verdict table

| # | Claim | Verdict | Action taken |
|---|-------|---------|--------------|
| **C1** | Multi-agency / connector model contradiction (1 connector = 1 org vs multi-connector container) | **NOT A BUG** — §3 already takes the "1 GHL agency backend = 1 Synthetos org" stance explicitly. `connectorInstanceLabel` and multi-connector filters were already removed (§3, lines 488, 1029, 1110). Kel's SaaS and DFY orgs are two separate Synthetos orgs, not a multi-connector container. The `connectorConfigId` reference on line 795 is about the existing single-connector `connector_configs` table, not a multi-connector shim. | No spec change; clarification added here for future reviewers. |
| **C2** | Non-existent GHL APIs reintroduced (`fetchLoginActivity`, `fetchInstalledIntegrations`, `ghl.read.login_activity`) | **NOT A BUG** — searched spec for all three literal strings; zero matches. §2 correctly says "GHL does not expose login data" + "GHL does not expose an installed-apps endpoint" and routes both to derived approaches (Staff Activity Pulse §2.0b + Integration Fingerprint Scanner §2.0c). The phrase "replaces login activity" appears in a bridge sentence, not as a phantom API call. | No spec change. |
| **C3** | "Current state" wrong — spec claims `health_snapshots` / scoring executors / anomaly tracking don't exist but they do | **NOT A BUG (restate)** — §4.1 explicitly calls out these existing assets ("Health-score factors config — Works", "compute_health_score handler — Registered; delegates to intelligenceSkillExecutor", "Generic health_snapshots table — Exists"). §4.2 is explicit that the gap is **wiring**, not the substrate. §4.6 (scoring formula consolidation) now cross-references the exact code paths. | Strengthened wording in §4.1 is already present; no change needed. |
| **C4** | Intervention system duplication — proposed `client_pulse_interventions` table overlaps existing `actions` + `reviewItems` + `interventionOutcomes` | **REAL CONTRADICTION — FIXED** | §10 Phase 4 rewritten: no parallel table; proposals land as `actions` rows with `actionType IN (5 namespaced primitives)`, `gateLevel='review'`, and ClientPulse-specific `metadataJson` shape `{ triggerEventId, triggerReason, bandAtProposal, healthScoreAtProposal, configVersion, recommendedBy }`. §25.1 updated to explicitly list "NOT a new table." |
| **C5** | Action slug collision — `send_email` and `create_task` already exist in `actionRegistry.ts` with different semantics | **REAL CONTRADICTION — FIXED** | §15.1 rewritten: 5 primitives namespaced as `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`. Existing unprefixed primitives retain their direct-send / Synthetos-native semantics unchanged. §10 Phase 4 + §15.3 updated. |
| **I6** | Auto-proposer scope conflict (V1 manual only vs Phase 4 proposer) | **VOCABULARY FIX** | §21.1 revised: "Automated scenario detection, manual action trigger." The `proposeClientPulseInterventionsJob` detects scenarios and writes HITL-gated review items; it never auto-executes. V2 = auto-execution proposers, explicitly deferred. |
| **I7** | OAuth scope source-of-truth drift (config vs route hardcode) | **ALREADY ADDRESSED** — §2.3 + Phase 0 already specify: (a) refactor `server/routes/ghl.ts` to build `scope=` from `OAUTH_PROVIDERS.ghl.scopes`; (b) extend config. This is a known Phase 0 action item, not a new gap. | No spec change; cross-referenced here. |
| **I8** | Subscription vs tier duplication (`org_subscriptions.tier` vs existing `subscriptions` + `modules`) | **NOT A BUG (reviewer misread)** — §12.4 explicitly says "the existing `modules` + `subscriptions` + `orgSubscriptions` schema (migration 0104) already models per-org per-module entitlements. We extend it with a `tier` column on `orgSubscriptions` (enum: `'monitor'` \| `'operate'`) rather than introducing a parallel tiering system." The new column is a single extension, not a parallel table. | No spec change; clarification here. |
| **I9** | Pattern C still leaking Pattern A (org-subaccount as execution layer) | **NOT A BUG (reviewer misread)** — §13.3 explicitly chose Pattern C and §13.3/§14.3 say `playbook_runs.subaccount_id` always means "a real client sub-account" post-refactor. Remaining references to the org-subaccount are portal/inbox concerns only (`publish_portal` target resolution), never execution-scoping. Line 2197 says this explicitly: "org-subaccount retained for portal/inbox concerns only." | No spec change; clarification here. |
| **I10** | Timezone field undefined (`organisations.timezone` doesn't exist) | **REAL CONTRADICTION — FIXED** | §7.2 + §23.2 revised to use `scheduledTasks.timezone` (which does exist per `server/db/schema/scheduledTasks.ts:35`). Adding `organisations.timezone` is explicitly deferred — if multi-schedule orgs later need a canonical default, a migration is straightforward but not required for V1. |
| **I11** | Config audit duplication — proposed new `config_changes` table overlaps existing `config_history` | **REAL CONTRADICTION — FIXED** | §17.2.6 rewritten: no new table. ClientPulse writes land in existing `config_history` with `entity_type='clientpulse_operational_config'`, `entity_id=sha256(orgId+path)`, atomic multi-path saves grouped by `session_id`. Every section that referenced `config_changes` (9 places) updated to `config_history`. §26 B3 blocker updated accordingly. |

### 27.2 Net changes from this review

**5 real bugs fixed:**
- C4: no parallel interventions table; use `actions.metadataJson`
- C5: 5 primitives namespaced as `crm.*` + `clientpulse.operator_alert`
- I6: "proposer" clarified as "scenario detector with HITL gate"
- I10: timezone resolved to `scheduledTasks.timezone`; `organisations.timezone` explicitly deferred
- I11: audit log reuses existing `config_history` table, no migration

**4 reviewer misreads clarified in this section:**
- C1: §3 already resolves multi-agency via "two separate Synthetos orgs"
- C2: phantom API endpoints do not appear in spec
- C3: §4.1 already correctly describes existing substrate
- I8: §12.4 already extends existing `orgSubscriptions.tier`, not a parallel table
- I9: §13.3 already resolved Pattern C; remaining org-subaccount refs are portal/inbox only

**2 cross-reference strengthens:**
- I7: OAuth scope drift is a known Phase 0 action
- (orchestrator routing extraction) — V2 concern, noted in §26.2 D1

### 27.3 Impact on blockers (§26)

| Before | After |
|--------|-------|
| B3: Migrate `config_changes` audit table | B3: **Wire existing `config_history` writer for `entity_type='clientpulse_operational_config'`** (no migration) |
| B4: Author `operational_config` JSON Schema with `sensitive` flags | Unchanged |
| B5: Sensitive-path routing through action→review | Unchanged — action rows use namespaced `crm.*` / `clientpulse.*` types, so no collision |

Net: scope of B3 shrinks (no new table), no new blockers added.

### 27.4 Meta-observation

Third-pass reviews naturally surface more "consistency with existing system" issues than first-pass reviews, because the spec has gotten specific enough to collide with real code. The pattern this review surfaced — "spec proposes new X, reality already has X" — is an expected sign of convergence, not regression. Each of the 11 claims forced a re-audit of actual code; 5 forced real fixes, 4 forced clarifications, 2 were fully already addressed.

The spec is now **substantially subordinate to existing infrastructure** in the right way: it names what already exists and describes the minimum new work to make it do the ClientPulse thing. That's the correct posture.

---

**End of document.**

**Next step:** feed this gap analysis (especially §§15–24 added 2026-04-18) into the architect agent to produce an implementation plan starting with Phase 0 + Phase 0.5 + Phase 1, since those are the unblocking items with no dependencies on decisions still pending from Kel. Phase 4.5 (Configuration Agent extension) can run in parallel with Phase 5 once the `operational_config` JSON Schema is locked.
