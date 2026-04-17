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

---

## 1. Executive summary & Kel requirements matrix

### 1.1 Bottom line

Roughly 60% of the plumbing ClientPulse needs for a Kel-shaped agency already exists as **generic, canonical infrastructure** (subaccounts + integrations + actions + reviewItems + orgConfig + hierarchyTemplates + pg-boss jobs). The remaining 40% is a pattern-consistent set of additions — new GHL adapter endpoints, new capability slugs, new action types, one new health-snapshot timeseries table, a churn signal evaluator, and a handful of UI widgets.

**There is no meaningful hardcoded "GHL agency" logic required.** Every Kel-specific behaviour maps cleanly onto existing canonical concepts: a GHL agency → `organisations` row, each of its clients → `subaccounts` row, each monitored feature → a capability slug, each signal evaluation → a skill, each intervention → an `actions` row with `gateLevel='review'`, each review → a `reviewItems` row. Nothing about the Kel use case requires a code branch that says "if GHL agency, do X". It all lands as config on canonical rows.

The four real blockers (in severity order) are:

1. **Multi-agency-per-org** — `connector_configs` has a unique constraint on `(organisation_id, connector_type)` that prevents Kel running two separate GHL agency backends under one Productivity Hub org. This is a schema + service change, not a redesign.
2. **GHL data breadth** — we pull contacts / opportunities / conversations / revenue. We do not pull login activity, funnels, calendars, installed integrations (CloseBot detection), tier, or AI feature usage. Six of the eight signals Kel identified as churn-predictive are un-ingested.
3. **Health + churn executors do not exist** — the skills are defined, the config tables are populated, the trajectory test expects them, but no pg-boss job fires them per-sub-account and no table stores health-score timeseries.
4. **Intervention pipeline not wired** — `actions` + `reviewItems` + `interventionOutcomes` are the right substrate, but there is no `actionType: 'client_pulse_intervention'` registered, and no proposer that converts "health score declined" into a proposal row.

### 1.2 Kel requirements matrix

| # | Kel's explicit requirement | Canonical home | Current state | Gap class |
|---|---|---|---|---|
| 1 | See all sub-accounts on one screen ranked by health | `subaccounts` + health snapshot table (new) + `ClientPulseDashboardPage.tsx` | Dashboard page exists; high-risk widget returns `{clients: []}` (TODO in `clientpulseReports.ts:79`) | Wiring + 1 new table |
| 2 | Detect logins per sub-account | GHL adapter + `compute_login_activity` skill (new) | No endpoint, no webhook | Data ingestion |
| 3 | Detect funnel inventory per sub-account | GHL adapter + `compute_funnel_coverage` skill (new) | None | Data ingestion |
| 4 | Detect calendar quality (calendars ÷ users) | GHL adapter + `compute_calendar_quality` skill (new) | None | Data ingestion |
| 5 | Detect installed integrations (e.g. CloseBot) | GHL adapter `/integrations` endpoint + `detect_external_integrations` skill (new) | None | Data ingestion |
| 6 | Detect subscription tier + tier-migration trend | GHL adapter `/businesses` metadata + new `subaccount_tier_history` table | Not surfaced; may exist in `canonical_accounts.externalMetadata` | Data ingestion + 1 new table |
| 7 | Detect AI feature usage (native GHL vs CloseBot) | Composition of #5 + GHL adapter | None | Data ingestion |
| 8 | Weighted composite health score per sub-account | `compute_health_score` skill + `orgConfigService.getHealthScoreFactors()` + new `client_pulse_health_snapshots` table | Skill defined, config configurable per-org, **no executor**, **no timeseries table** | Execution + 1 new table |
| 9 | Churn risk classification with configurable thresholds | `compute_churn_risk` skill + `orgConfigService.getChurnRiskSignals()` | Config exists, skill asserted in trajectory test, **not implemented** | Execution |
| 10 | Monday morning one-screen view with trends | `ClientPulseDashboardPage.tsx` + new drill-down + `portfolioRollupJob` already Mon 08:00 | Job fires, aggregates empty data | Wiring |
| 11 | Propose intervention → Kel approves → execute (HITL) | `actions` + `reviewItems` + `interventionOutcomes` (all exist) + new `actionType: 'client_pulse_intervention'` + proposer | Substrate exists; **no proposer, no registered action type** | Wiring + action registry entry |
| 12 | Intervention cooldowns | `interventionService.checkCooldown` (exists) | Works; needs to be called from the new proposer | Wiring |
| 13 | Trial progress monitoring + stalled-trial nudges | New onboarding-milestone table + reuse of health pipeline | Absent from code and canonical spec | New module |
| 14 | Multi-agency per org (SaaS + DFY backends) | `connector_configs` (schema change) + polling service (scope change) | **Blocked by unique constraint** | Schema change |
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

For the two signals with no native API (login activity, third-party integrations), add derivers that read existing canonical tables rather than adapter calls:

```
deriveStaffActivity({subaccountId}): StaffActivityObservation    // reads contacts/opportunities/conversations mutations attributed to users
readManualIntegrationTags({subaccountId}): IntegrationTag[]       // reads `subaccount_external_integrations` populated manually
```

### 2.3 OAuth scope audit

The current config at `server/config/oauthProviders.ts:52–56` declares only `contacts.readonly`, `contacts.write`, `opportunities.readonly`. The new endpoints require verifying and adding:

- `locations.readonly` — for `listAccounts` + `GET /locations/{id}` (likely already implicitly granted by the choose-location OAuth flow; confirm)
- `users.readonly` — for `/users/search`, `/users/location/{id}`
- `calendars.readonly` — **must be added**
- `funnels.readonly` — **must be added**
- `conversations.readonly` + `conversations/message.readonly` — for the derived staff-activity signal
- `businesses.readonly` — for location metadata details
- SaaS mode subscription scope (name TBC) — for `/saas/location/{id}/subscription`

Action: extend the scope list in `server/config/oauthProviders.ts` before the next `/integrations/ghl/connect` flow is run. Kel offered to facilitate a conversation with GHL to enable dev-tier API access; use that channel to confirm which scopes are available on the $97 agency tier vs $297 vs Agency Pro.

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
| Portfolio Health Agent (system agent, org-execution scope) | `migrations/0068_portfolio_health_agent_seed.sql:1–38` | Seeded in DB; master prompt defines 7-step monitoring loop |
| Trajectory test asserting bulk health computation | `tests/trajectories/portfolio-health-3-subaccounts.json` | Declarative; no executor path satisfies it |
| Report aggregation endpoint | `server/routes/clientpulseReports.ts` + `server/services/reportService.ts` | Reads the most recent `reports` row of type `portfolio_health` |

### 4.2 What is missing

Five discrete gaps, all of which are "wire existing parts together" rather than "invent a new system":

1. **No HealthSnapshot table.** The skill markdown says it writes a `HealthSnapshot`, but there is no table named `health_snapshots` or `client_pulse_health_snapshots` in any migration. Without it, there is nothing to feed the dashboard's trend arrows or the churn-risk evaluator.
2. **No skill executor registration.** `compute_health_score.md` has no handler in `server/services/skillExecutor.ts` and no entry in `server/config/actionRegistry.ts`. Running the skill is a no-op.
3. **No per-sub-account scheduling.** `portfolioRollupJob.ts` runs Monday 08:00 / Friday 18:00 and aggregates *existing* data; it never initiates a health scan. There is no `computeHealthScoresJob` that enqueues one compute per active sub-account per scan window.
4. **No ingestion → scoring handoff.** Even if #2 were fixed, the scoring skill has no observations to read because §2 ingestion does not run.
5. **No heartbeat for the Portfolio Health Agent.** Migration 0068 seeds the agent but does not set `heartbeatEnabled=true` or schedule it; the agent never runs even though it has a master prompt.

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

- **No `compute_churn_risk` skill implementation.** The trajectory test names it; the skill file does not exist under `server/skills/`.
- **No `client_pulse_churn_assessments` table.** Churn risk has no durable surface; today it could only live inside a report's HTML body.
- **No evaluator job.** Nothing consumes the configured signals and produces a score.
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

- **No `actionType: 'client_pulse_intervention'` registered** in `actionRegistry.ts`. Without this there is no way to create an action row for an intervention.
- **No intervention proposer.** Nothing reads `client_pulse_churn_assessments`, decides which intervention template applies, and writes the action row + review item.
- **No intervention template storage.** Kel's table (login ≥ 14d → check-in email, no funnels → 4-video nurture, calendar broken → setup guide, tier downgrade → retention call alert, CloseBot detected → AI Studio comparison, trial stalled → step-specific nudge) must live somewhere editable per org.
- **No outcome measurement loop.** `interventionOutcomes` exists but nothing schedules a "measure X hours after action.completedAt, write the outcome row".

### 6.4 Proposed canonical shape

**Intervention templates table** (new, org-scoped):

```
client_pulse_intervention_templates(
  id, organisationId, connectorConfigId (nullable),
  slug,                       -- e.g. 'dormant_login_checkin'
  triggerSignalSlug,          -- e.g. 'login_activity'
  triggerCondition JSONB,     -- e.g. {"op":"gte_days_since","field":"last_login","value":14}
  proposedActionType,         -- maps to actionRegistry entry
  proposedActionParamsTemplate JSONB,  -- Handlebars-style, rendered per subaccount
  cooldownHours, cooldownScope,
  measurementWindowHours,     -- for outcome loop
  deletedAt
)
```

Seed Kel's six templates as **system defaults** (visible, editable, org can override).

**Intervention proposer job** (new pg-boss job):

Runs after each churn assessment scan. For each sub-account:

1. Load active templates (system + org overrides, matching `connectorConfigId` or NULL).
2. For each template whose trigger matches current observations + snapshot, check `interventionService.checkCooldown()`.
3. If cooldown clear, render `proposedActionParamsTemplate` → create `actions` row with `gateLevel='review'` → `reviewItems` row appears automatically via existing trigger/service.

**Outcome measurement job** (new pg-boss job):

Enqueued on `action.completed_at + template.measurementWindowHours`. Reads the next health snapshot; writes `interventionOutcomes` row; closes the loop.

### 6.5 Action types to register

All of these live in `actionRegistry.ts` with the generic `actionCategory` they already have — we do not need a ClientPulse-specific registry:

| Action type | Category | Gate | Idempotency | Notes |
|---|---|---|---|---|
| `send_email_campaign` | `api` | `review` | `keyed_write` | Existing email primitive; Kel's check-in emails, nurture sequences, setup guides |
| `send_sms` | `api` | `review` | `keyed_write` | Optional; Kel mentioned SMS nudges in onboarding |
| `create_task_for_operator` | `worker` | `auto` | `keyed_write` | For "tier downgrade detected — call Kel to book retention call" |
| `send_portal_notification` | `api` | `auto` | `keyed_write` | In-dashboard alert only |
| `propose_intervention` | meta | — | — | Not an action; a job that proposes the above actions |

The only **new** action type is `create_task_for_operator` if it does not already exist — and even that is a general-purpose primitive, not ClientPulse-specific.

### 6.6 Why this is non-hardcoded

- Templates live in the DB, editable per org, with `connectorConfigId` scope so Kel can run different templates across SaaS vs DFY.
- Trigger conditions are declarative JSONB, not code. Adding a new "if observation X meets predicate Y, propose Z" takes a row insert, not a deploy.
- The proposer job is generic over `client_pulse_intervention_templates` — it does not know about login activity or CloseBot specifically.

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
- **Monday-morning email render** — same report in HTML form, delivered at 08:00 in the agency's configured timezone (`organisations.timezone`; editable in `ClientPulseConfigPage`). Requirements: (a) each sub-account row is clickable and deep-links to its drill-down (`/clientpulse/subaccount/:id`), (b) a top banner surfacing any **band-change deltas** since last week ("3 newly At Risk, 1 recovered to Healthy"), (c) a pending-interventions count with a link to the queue, (d) a "View full dashboard" header link. Without deep links + delta banner the email is a dump; with them it's a launchpad Kel can act from.

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
- Scope selector (apply to All | SaaS only | DFY only — drives `connectorConfigId` filter on the row).

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

- Nudges = `client_pulse_intervention_templates` with trigger condition like `{"op":"milestone_stalled_hours","slug":"first_funnel_built","value":72}`.
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
ghl.read.login_activity
ghl.read.funnels
ghl.read.calendars
ghl.read.users
ghl.read.installed_integrations
ghl.read.subscription_tier
ghl.read.ai_feature_usage
ghl.read.location_metadata      # already partially covered; formalise
```

These plug into the Orchestrator's capability routing (`docs/orchestrator-capability-routing-spec.md`) so when an agent asks "does this org have login-activity data for sub-account X?", Path A / B / C / D resolves correctly.

### 9.2 New skill slugs (registered in `server/skills/` + executor in `server/services/skillExecutor.ts`)

```
compute_login_activity         # per sub-account
compute_funnel_coverage
compute_calendar_quality
detect_external_integrations
compute_subscription_tier
compute_ai_feature_usage

compute_health_score           # already has .md; needs executor
compute_churn_risk             # new

propose_client_pulse_interventions   # proposer
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
client_pulse_intervention_templates      # per-org, editable
client_pulse_onboarding_milestone_defs   # per-org, editable
```

**Naming rule enforced above:** no `canonical_*` or generic-scope table name references a CRM vendor, and no column name inside those tables uses CRM-vendor terminology. If a future PR adds a column named `ghl_*` or `leadconnector_*` to a canonical or derived table, it's a review blocker.

### 9.5 Existing tables extended (no new table needed)

```
connector_configs.connectorInstanceLabel    # to permit two GHL backends per org
subaccounts.isInTrial, trialStartedAt, trialEndsAt
subaccounts.monthly_revenue_cents           # if not already present
organisations.settings / hierarchyTemplates.operationalConfig  # new keys: churnBands, interventionTemplates
```

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

- *Path A*: "Agent Y has `ghl.read.login_activity` — here's the latest observation."
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

### Phase 1 — Signal ingestion (the six adapter functions)

- Add `fetchLoginActivity`, `fetchFunnels`, `fetchCalendars`, `fetchUsers`, `fetchInstalledIntegrations`, `fetchLocationDetails` in `ghlAdapter.ts`.
- Migration: `client_pulse_signal_observations`, `subaccount_external_integrations`, `subaccount_tier_history`.
- Register new capability slugs in `docs/integration-reference.md`.
- Extend `connectorPollingService` to call new fetches per sub-account and write observations.
- Webhook handler: add `INSTALL`/`UNINSTALL`/`LocationCreate`/`LocationUpdate`.
- OAuth scope audit + update.

**Ship gate:** for a test agency, after a poll cycle, `client_pulse_signal_observations` has rows for all eight signals across every sub-account.

### Phase 2 — Health-score execution

- Migration: `client_pulse_health_snapshots`.
- Implement `computeSubaccountHealthJob` (pg-boss) that consumes observations + `orgConfigService.getHealthScoreFactors()` and writes a snapshot.
- Register `compute_health_score` as a skill handler calling the job.
- Cold-start + confidence logic.

**Ship gate:** trajectory test `portfolio-health-3-subaccounts.json` passes end-to-end.

### Phase 3 — Churn risk evaluation

- Migration: `client_pulse_churn_assessments`.
- Implement `compute_churn_risk` skill + `evaluateChurnRiskJob`.
- Extend `DEFAULT_CHURN_RISK_SIGNALS` with Kel-validated additions (`no_funnel_built`, `feature_breadth_floor`, `tier_downgrade_trend`).
- Default churn bands seeded; configurable per org.

**Ship gate:** every sub-account has a churn assessment row with a band; dashboard high-risk widget no longer returns `[]`.

### Phase 4 — Intervention pipeline

- Register `client_pulse_intervention` action type.
- Migration: `client_pulse_intervention_templates`.
- Seed Kel's six templates as system defaults.
- Implement `proposeClientPulseInterventionsJob` + `measureInterventionOutcomeJob`.
- Wire to `interventionService.checkCooldown` and existing `actions`/`reviewItems`.

**Ship gate:** simulated declining sub-account produces a review-queue item with enough context for approve/reject in under 30 seconds.

### Phase 5 — Dashboard + briefings + configuration UI

- Portfolio grid with ColHeader sort/filter, sticky-three pills (Last Activity / Funnel Count / Calendar Quality), integration chips with usage badges, tier-migration arrow on grid row.
- Per-client drill-down route `/clientpulse/subaccount/:id`.
- Intervention queue widget on dashboard (top-5 pending; overflow → `/clientpulse/interventions`).
- Revenue-at-risk + churn projection headlines.
- Monday-morning email per §7.2: deep-linked per-client rows, band-change delta banner, pending-interventions count, agency-timezone delivery, one email per org.
- **Intelligence Briefing playbook integration (§13.3):** add `render_portfolio_health_section` step reading `reportService.getLatestReport()`.
- **Weekly Digest playbook integration (§13.3):** add matching step with week-over-week emphasis.
- **Portfolio Rollup enrichment (§13.3):** include latest `portfolio_health` report counts in the org-wide digest artefact.
- `ClientPulseConfigPage` for factor weights, signal thresholds, band cutoffs, intervention templates, `staffActivity` config, `integrationFingerprints` seed library + learned fingerprints, Monday-email timezone + suppression rules.

**Ship gate:** Kel can open one screen, see all 180 clients ranked, drill into any one, approve or reject a proposed intervention, and edit the templates driving future proposals — all without touching code. Monday email arrives with deep links. Intelligence Briefing and Weekly Digest include a Portfolio Health section.

### Phase 6 — Trial monitoring (post-launch)

- Migrations + job as described in §8.
- Seed default milestones.
- Reuse `client_pulse_intervention_templates` for milestone-stalled nudges.
- UI: trial-cohort filter on dashboard.

**Ship gate:** Kel reintroduces the 14-day trial knowing stalled users get auto-nudged with his approval.

### Rough sizing (not commitments)

| Phase | Scope | Ballpark |
|---|---|---|
| 0 | Schema relax + polling scope | Small |
| 1 | Six adapter fns + two tables + webhook events | Medium |
| 2 | Scoring job + snapshot table + skill registration | Small–Medium |
| 3 | Churn evaluator + band config + defaults | Small |
| 4 | Proposer + templates + outcome loop | Medium |
| 5 | Dashboard + drill-down + config UI | Medium–Large |
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

### 11.3 Open questions for Kel (follow-up call)

1. **Confirm the "Staff Activity Pulse" framing replaces login-activity tracking.** GHL does not expose login data via API and we are not building UI scraping. Instead we derive a composite "has staff work happened here recently" score from contact / opportunity / conversation mutations attributed to real users (see §2.0b). This is a **stronger** signal than logins — someone logging in and doing nothing looks healthy on a login metric but is dead on a staff-activity metric. Does this map to Kel's actual mental model? Is there any case where he cares about logins specifically, independent of whether anything got done?

2. **Name the integrations we should ship fingerprints for on day one.** The "Integration Fingerprint Scanner" (§2.0c) auto-detects third-party tools from artifacts we can already read (conversation provider IDs, workflow action types, outbound-webhook domains, tag/field prefixes). To ship it with useful defaults, we need Kel to list the third-party apps he sees most often across his 180 sub-accounts — CloseBot and Uphex already named, plus whatever else is common. **Ten-minute ask.** After that, the system learns from data: novel integrations surface as one-click "what is this?" prompts in Kel's inbox, classified once and applied retroactively across his whole portfolio.

3. **Subscription tier endpoint access.** `GET /saas/location/{locationId}/subscription` requires SaaS mode + Agency Pro tier on the GHL side. Kel's SaaS arm has SaaS mode; confirm whether DFY arm does too. If not, tier tracking for DFY clients has to come from Kel's internal billing (not GHL) — which is fine because DFY tier movement isn't predictive of churn.

4. **Calendar quality denominator.** For a DFY client where the VA runs everything and the end-client barely logs in, the "calendars ÷ team members" ratio is probably noise. Does Kel want calendar-quality as a health input on DFY at all, or only on SaaS? This drives whether the two Synthetos orgs (per §3) get different `hierarchyTemplates.operationalConfig` values.

5. **Intervention scope on DFY clients.** DFY clients have near-zero churn and are VA-managed. Proposer-driven intervention queue items on DFY are likely to be noise or redundant. Default recommendation: DFY org computes health scores but the intervention proposer is disabled. Confirm with Kel.

6. **Onboarding milestone library for trial monitoring.** For Phase 6 (reintroducing trials), which specific milestones should count? Working assumption: `first_calendar_created / first_funnel_built / first_contact_imported / first_campaign_sent / first_automation_published`. Confirm with Kel, and whether each milestone should map to a specific nudge email from his existing 25-email sequence.

7. **Starboys replacement threshold.** Kel was explicit on the call that Phase 3-style detection alone would not fully replace Starboys — he also values the DFY-execution arm ($1,200 of the $2,400). Our Phase 4 proposer → HITL approve → execute pipeline is the closest analogue, but requires action types for "email the client on the agency's behalf". Confirm: is the intended replacement scope `$1,200 monitoring half` or `$2,400 full service`, and is Kel willing to have the platform send emails from the agency brand to end clients with his one-click approval?

8. **GHL dev-tier API access.** Kel offered to facilitate a conversation with GHL about enabling dev-tier access. Two asks for that conversation: (a) confirm which scopes are available on the $97 / $297 / Agency Pro tiers (esp. `calendars.readonly`, `funnels.readonly`, SaaS subscription scope); (b) confirm whether a public audit-log / login-activity endpoint is on GHL's roadmap and on what timeline — this materially affects whether we build the derived proxy in Phase 1 or defer it.

9. **Two-orgs onboarding UX (per §3).** Kel's Productivity Hub will connect two Synthetos orgs (SaaS + DFY), each its own OAuth flow. Does Kel want them billed as one customer with a single invoice, or as two separate subscriptions? This affects how we present the onboarding and whether we add any "sibling orgs" linking at the account level.

10. **Philippines government tender (out of band).** Flagged for separate workstream — not in ClientPulse v1 scope. Worth tracking independently: if Productivity Hub wins, the platform becomes the operations layer for a government-scale managed AI delivery. Put on the roadmap watchlist.

### 11.4 Success criteria (how we know we shipped ClientPulse for Kel)

1. Kel has one screen showing all ~180 sub-accounts across both GHL backends, ranked by churn risk, updated daily.
2. At least 80% of the `$2,400/mo` Starboys value is replaced by the monitoring + HITL proposer pipeline, validated by Kel actually cancelling Starboys or renegotiating down.
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

---

## 13. Intelligence Briefing + Weekly Digest integration

### 13.1 What exists

- **Intelligence Briefing** — playbook at `server/playbooks/intelligence-briefing.playbook.ts`, scheduled Monday 07:00 (configurable), per-subaccount. Produces a delivered artefact (email + optional Slack + optional portal).
- **Weekly Digest** — playbook at `server/playbooks/weekly-digest.playbook.ts`, scheduled Friday 17:00 (configurable), per-subaccount.
- **Portfolio Rollup** — pg-boss job `server/jobs/portfolioRollupJob.ts`, Monday 08:00 + Friday 18:00, aggregates org-wide playbook-run status + memory-review queue counts into the org-subaccount inbox. Runs *after* the per-subaccount playbooks so it sees their outputs.
- **`reports` table** — canonical store for generated reports, already supports `reportType='portfolio_health'` (`server/services/reportService.ts:79`).

### 13.2 Is surfacing ClientPulse data in both the dashboard AND the briefings a bad design decision?

No — it is the correct DRY pattern **as long as the data flows through the canonical `reports` row, not through three separate query paths.**

Bad version: dashboard queries `client_pulse_health_snapshots` directly; Intelligence Briefing re-queries `client_pulse_health_snapshots`; Weekly Digest re-queries `client_pulse_health_snapshots`. Three consumers, three query implementations, three places to fix when the schema changes.

Good version (proposed): after each ClientPulse scan, `reportService.completeReport(orgId, {reportType: 'portfolio_health', counts, htmlContent, structuredSummaryJson})` writes a single canonical row. Dashboard reads it. Intelligence Briefing reads it. Weekly Digest reads it. Portfolio Rollup reads it. One source of truth; four renderings.

### 13.3 Concrete wiring

**In the scan pipeline (Phase 2–3):**

- At the end of `computeSubaccountHealthJob` → `evaluateChurnRiskJob` for all active sub-accounts per org, append a final step that calls `reportService.completeReport()` with the org-wide snapshot summary (totals by band, top-N declining, top-N recovering, week-over-week delta). This replaces the current placeholder in `clientpulseReports.ts` which returns `{clients: []}`.

**In `intelligence-briefing.playbook.ts` (add one step):**

```
step slug="render_portfolio_health_section"
  type="prompt"
  inputs: reportService.getLatestReport(orgId, 'portfolio_health')
  renders: section headed "Portfolio Health — [N] healthy / [M] attention / [K] at risk"
  includes: top 3 declining sub-accounts + top 3 recovering + pending intervention count
  link: /clientpulse
```

**In `weekly-digest.playbook.ts` (add one step):**

Same pattern, different emphasis: week-over-week deltas, churn projection, top intervention outcomes (accounts where an intervention correlated with a band improvement).

**In `portfolioRollupService.runPortfolioRollup()` (`server/services/portfolioRollupService.ts:57–217`, line 93–129 is the aggregation loop):**

Extend the per-sub rollup to include `reportService.getLatestReport(subaccount.id, 'portfolio_health')` counts in the org-wide summary. The existing delivery-service wiring (line 189–203) propagates the enriched artefact through email / portal / Slack unchanged.

### 13.4 What *not* to do

- Do **not** create a third playbook for "ClientPulse briefing". The two existing playbooks already cover the same cadence Kel wants. Adding a third creates a triple-delivery email-fatigue problem.
- Do **not** push ClientPulse-specific data directly into `playbook_step_runs` context at run time — keep it in `reports`. The playbooks should be consumers, not owners, of this data.
- Do **not** conditionally skip the playbook step if the report is empty — render a neutral "Portfolio is healthy; no attention items this week" line instead. Regular rhythm is more valuable than noise suppression here.

### 13.5 Dedicated ClientPulse page is still the primary surface

The dashboard stays the primary Monday-morning surface (one screen, drill-down, intervention queue). The briefings are async companions — they arrive in Kel's inbox, hit him with the headline, and deep-link into the dashboard for action. The two surfaces reinforce each other: the email catches Kel's attention when he isn't already at the dashboard; the dashboard provides the interactive workflow once he's engaged.

---

**End of document.** Next step: feed this gap analysis into the architect agent to produce an implementation plan for Phase 0 + Phase 1, since those are the two unblocking items with no dependencies on decisions still pending from Kel.
