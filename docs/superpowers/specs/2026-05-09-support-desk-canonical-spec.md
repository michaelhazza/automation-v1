**Status:** reviewing — locked at this state pending OQ-1 (Foundry parity) + OQ-2 (Teamwork status inventory). chatgpt-spec-review closed `APPROVED — operator finalised after Round 2`. Spec MAY NOT move to `accepted` and Phase 2 plan generation MAY NOT begin until both OQs close.
**Spec date:** 2026-05-09
**Last updated:** 2026-05-09 (chatgpt-spec-review finalised after 2 rounds — 14 findings closed total: 5 high-severity blockers fixed [source_draft_id FK migration order, split author_id columns, manually_marked_sent state, deletion/redaction tombstone semantics, deletion-by-poll precondition], 1 user-facing rename ["Mark provider send as verified"], 8 medium/low-severity tightenings. Round logs: `ff6e21b6` (R1), `180d0347` (R2).)
**Author:** Claude (spec-coordinator, Opus 4.7)
**Build slug:** support-desk-canonical
**Source brief:** `tasks/builds/support-desk-canonical/brief.md` (LOCKED v5.3, commit `0e04cc0d`)
**Source mockups:** `prototypes/support-desk-canonical/` (5 hi-fi screens, commit `0a768abd`)
**Source branch:** `claude/support-ticket-structure-xMcy8`
**Scope class:** Major

---

# Support Desk Canonical — Specification

Operational layer for agentic support workflows. Canonical entities, adapter contract extensions, ingestion + dispatch flows, skill surface, UI surfaces, and a Teamwork Desk validating implementation that ships in the same body of work.

This spec inherits every invariant in the brief verbatim. Where the brief gives a default (§10) the spec implements that default; deviation is flagged in writing inline with a one-line rationale.

---

## Table of contents

1. [Goals, non-goals, framing](#1-goals-non-goals-framing)
2. [Existing primitives reused](#2-existing-primitives-reused)
3. [Phase plan](#3-phase-plan)
4. [Domain model](#4-domain-model)
5. [Data model — canonical entities](#5-data-model--canonical-entities)
6. [Adapter contract extensions](#6-adapter-contract-extensions)
7. [Ingestion flow — poll and webhook convergence](#7-ingestion-flow--poll-and-webhook-convergence)
8. [Outbound dispatch — three-phase send and reconciliation](#8-outbound-dispatch--three-phase-send-and-reconciliation)
9. [Skill surface](#9-skill-surface)
10. [UI surfaces](#10-ui-surfaces)
11. [Contracts](#11-contracts)
12. [Permissions and RLS checklist](#12-permissions-and-rls-checklist)
13. [Execution model](#13-execution-model)
14. [Execution-safety contracts](#14-execution-safety-contracts)
15. [Observability](#15-observability)
16. [Phase sequencing — dependency graph](#16-phase-sequencing--dependency-graph)
17. [Teamwork v1 acceptance bar + capability matrix](#17-teamwork-v1-acceptance-bar--capability-matrix)
18. [File inventory](#18-file-inventory)
19. [Deferred items](#19-deferred-items)
20. [Testing posture](#20-testing-posture)
21. [Self-consistency pass result](#21-self-consistency-pass-result)
22. [Open questions](#22-open-questions)

---

## 1. Goals, non-goals, framing

### Goals

1. Ship a canonical Support Desk runtime layer (5 entities) that exposes one provider-neutral shape for tickets, threads, messages, inboxes, and helpdesk agents.
2. Extend the existing `teamworkAdapter` so one Teamwork Desk connection can ingest, dispatch, and reconcile against the canonical layer end-to-end.
3. Expose a provider-neutral skill set (`support.list_open_tickets`, `support.read_thread`, `support.propose_reply`, `support.approve_draft`, `support.reject_draft`, `support.add_internal_note`, `support.set_status`, `support.assign`, `support.tag`, `support.find_customer_history`) the Support Agent will consume.
4. Surface operational state on existing screens per brief §5.12 (connection setup, tickets list, inbox config, draft review queue) without introducing a new monitoring dashboard.
5. Preserve runtime-training alignment with Foundry's Teamwork loader (brief §5.1) — every divergence enumerated and justified in this spec, not discovered post-merge.

### Non-goals

Inherited verbatim from brief §6.6 + §8.7 + §12. Listing here for spec-reviewer cross-reference; this spec must not introduce work in any of these areas:

- Knowledge base / help-centre articles.
- CSAT surveys.
- Custom-field promotion to canonical columns (everything provider-specific stays in `external_metadata`).
- Time tracking, billable-hours, productivity reports.
- Provider-specific constructs (Teamwork projects/milestones/tasks, Zendesk groups, Freshdesk solutions).
- Multi-thread per ticket (v1 is one thread per ticket).
- Native Synthetos Support Desk (the `synthetos_native` ticketing analogue — separate brief if a no-helpdesk customer cohort emerges).
- Email-only providers (Gmail/IMAP) as helpdesk substitutes.
- Real-time co-presence ("the bot is typing…").
- Bulk historical backfill — runtime backfill is limited to currently-open tickets plus a configured recent-message window. Foundry remains the historical training/eval loader.
- Attachment mirroring to Synthetos object storage (provider URL + on-demand `resolveAttachment` only in v1).
- The Support Agent itself (prompts, tools, eval harness) — separate brief, depends on this one.

### Framing assumptions

Inherited from `docs/spec-context.md` (last reviewed 2026-05-05):

- `pre_production: yes`. No live agency clients yet. `commit_and_revert` rollout posture, no feature flags for new migrations, no staged rollout.
- `testing_posture: static_gates_primary`. `runtime_tests: pure_function_only`. The spec proposes pure-function Vitest tests at the decision boundaries enumerated in §20 (status mapping, draft transition guard, ticket transition guard, reconciliation decision module, customer-identity resolution; idempotency-key derivation rolls into the draft-transition test). **No** non-pure Vitest/E2E/API-contract/frontend tests are added.
- The Support Agent itself is not in scope; the spec ships the substrate and the Teamwork validation. Skill registration declares the contract the agent will consume.

**Foundry-runtime drift guard.** Per brief §5.1 + §8.1, any field that exists in one and not the other is enumerated below in §22 Open questions, with a documented reason. Default is parity. The spec author has not verified Foundry's current ticket schema against this spec — that confirmation is enumerated as open question OQ-1 and is closed by the operator before this spec moves to `accepted`.

## 2. Existing primitives reused

Per spec-authoring-checklist §1: every new structure below is justified by either (a) reusing an existing primitive verbatim, (b) extending an existing primitive with a documented reason, or (c) introducing a genuinely new primitive with a "why not reuse" paragraph.

| Capability | Existing primitive | Use in this spec |
|---|---|---|
| Adapter contract | [`server/adapters/integrationAdapter.ts`](../../../server/adapters/integrationAdapter.ts) — `IntegrationAdapter` interface, `ticketing` and `webhook` capability groups, `AdapterError` + `classifyAdapterError()` | **Extended** — add `addInternalNote`, `resolveAttachment`, an `ingestion` shape for support entities, broaden the `ticketing` `getTicket` shape to expose internal-note distinction. New canonical types added inline with the existing `CanonicalContactData` family. |
| Teamwork adapter | [`server/adapters/teamworkAdapter.ts`](../../../server/adapters/teamworkAdapter.ts) — ticketing CRUD + webhook signature verification + `normaliseEvent` for `ticket.created/updated/reopened/completed/deleted/reply.created/note.created` | **Extended** — implement `ingestion` (`listInboxes`, `listSupportAgents`, `fetchTickets`, `fetchTicketMessages`), implement `addInternalNote`, implement `resolveAttachment`, broaden `mapTicketStatus` to the canonical six-value model, add status-mapping fail-closed quarantine path, add action idempotency mechanism (§14.1). |
| Connector polling infrastructure | [`server/services/connectorPollingService.ts`](../../../server/services/connectorPollingService.ts) — scheduled poll loop, sync phase tracking via `connector_configs`, ingestion stats via `integration_ingestion_stats`, `getOrgScopedDb` integration | **Reused verbatim** — Teamwork's new `ingestion` methods plug in. No new polling infrastructure. Sync cursors live here per brief §5.6. |
| Three-layer RLS isolation | [`server/lib/orgScopedDb.ts`](../../../server/lib/orgScopedDb.ts) — `getOrgScopedDb()`; [`server/instrumentation.ts`](../../../server/instrumentation.ts) — `withOrgTx` and `withAdminConnection`; manifest at [`server/config/rlsProtectedTables.ts`](../../../server/config/rlsProtectedTables.ts) (`RLS_PROTECTED_TABLES`); `withPrincipalContext` from [`server/db/withPrincipalContext.ts`](../../../server/db/withPrincipalContext.ts); CI gates `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` | **Reused verbatim** — every new canonical table is added to `RLS_PROTECTED_TABLES` in the same migration that creates it, with FORCE-RLS policy on `current_setting('app.organisation_id', true)`. The brief §5.9 denormalised-`organisation_id` invariant means policies never join back to parent tickets. |
| Existing canonical schema pattern | [`server/db/schema/canonicalAccounts.ts`](../../../server/db/schema/canonicalAccounts.ts) — single-file schema, `(connector_config_id, external_id)` unique index, `organisation_id` + `connector_config_id` + `subaccount_id` indexes, `external_metadata jsonb`, `last_sync_at`, `source_connection_id`, P3A ownership/visibility columns | **Reused as template** — all five new tables follow this shape. Owner/visibility scope columns are NOT added to support tables in v1 (visibility is inbox-driven, not row-owner-driven, per brief §6.3); add only if a future skill needs row-level ownership. |
| Generic conversation table | [`server/db/schema/canonicalConversations.ts`](../../../server/db/schema/canonicalConversations.ts) — generic conversation shape (`channel`, `status`, `messageCount`, `lastMessageAt`, `lastResponseTimeSeconds`) | **Hard boundary, NOT reused.** Per brief §6.1 + §10 #7, tickets do **not** flow through `canonical_conversations` in v1. The two layers stay separate; a future unified-activity-feed concern may bridge them. |
| Provider rate-limiter | [`server/lib/rateLimiter.ts`](../../../server/lib/rateLimiter.ts) — `getProviderRateLimiter('teamwork').acquire(connectionId)` (already used in `teamworkAdapter`) | **Reused verbatim.** New ingestion calls go through the same per-connection rate limiter. |
| Connection token decryption | [`server/services/connectionTokenService.ts`](../../../server/services/connectionTokenService.ts) — `decryptToken()` for OAuth bearer or API-key basic-auth | **Reused verbatim.** OAuth + API-key paths already implemented in `teamworkAdapter.getAuthHeaders()`. |
| pg-boss worker pattern | `server/lib/createWorker.ts` (per `accepted_primitives` block in `docs/spec-context.md`) | **Reused** for asynchronous reconciliation worker (§8.4) and for inbox/support-agent backfill if extracted from the polling cycle. |
| Backoff helper | `server/lib/withBackoff.ts` (per `accepted_primitives` block) | **Reused** for adapter ingestion retry on `retryable: true` errors (per `classifyAdapterError`). |
| Webhook idempotency / dispatch | [`server/services/webhookService.ts`](../../../server/services/webhookService.ts) + [`server/services/webhookAdapterService.ts`](../../../server/services/webhookAdapterService.ts) — `recordIncident` 5xx coverage, dispatcher-level dedup | **Reused** for the new Teamwork webhook events (`ticket.assigned`, `ticket.status_changed`) added in this spec. |
| Connector type / provider type enums | `server/db/schema/connectorConfigs.ts` (and the type registry that already includes `'teamwork'`) | **Reused verbatim.** No new provider-type values; Zendesk/Freshdesk are deferred. |

### What is genuinely new

Five primitives that have no existing analogue and are introduced by this spec:

1. **Five canonical support entities** (§5). Justified because `canonical_conversations` is too generic per brief §4 (no priority, assignee, inbox, SLA, thread structure, internal-note distinction).
2. **Six-state canonical ticket status model** (§5.1). Justified because the existing 4-state TypeScript union in `IntegrationAdapter.TicketData.status` (`'active' | 'waiting' | 'closed' | 'resolved'`) is a provider-shaped abstraction insufficient for the Support Agent's reasoning needs (no `pending_internal`, no `unknown_provider_status` quarantine bucket).
3. **Three-phase dispatch state machine** for `canonical_ticket_drafts.status` (§8). Justified because existing review/audit primitives (`reviewItems`, `reviewAuditRecords`) are scoped to HITL action approval generally, not to the specific provider-side ambiguity that demands `dispatching` and `needs_reconciliation` resting states.
4. **Action-idempotency-key + action-attempt ledger** (§14.1). Justified because no existing primitive solves provider-write-with-network-ambiguity for ticketing. The closest neighbour is `oauth_state_nonces` (durable single-use, post-launch hardening) but is auth-scoped; the contract is different.
5. **Status-mapping fail-closed quarantine** (`unknown_provider_status`, §6 + §15). Justified because no existing primitive handles "unknown provider state must not silently become open" — the brief §7 invariant is non-negotiable and there is no currently-used pattern that achieves this for a multi-state mapping.

The Support Agent itself, prompts, eval harness, and bot policy resolver are all out of scope per brief §12 — those depend on this spec but are written elsewhere.

## 3. Phase plan

This spec ships in **one body of work** (single PR, single merge). Per the brief §11 recommendation, the canonical layer ships together with its first validating provider implementation — there is no canonical-layer-only intermediate state.

The PR is broken into ordered build chunks for the implementer (`feature-coordinator` → `builder` per chunk). Chunk granularity is locked here so plan generation in Phase 2 inherits the dependency order.

| Chunk | Subject | Touches |
|---|---|---|
| C1 | Schema + RLS for `canonical_inboxes` and `canonical_support_agents` (the dimensional tables tickets and drafts depend on) | migration `0307`, `0308`; schema files; `rlsProtectedTables.ts` manifest; basic Drizzle types |
| C2 | Schema + RLS for `canonical_tickets` | migration `0309`; schema file; manifest update; canonical status enum (TypeScript union) |
| C3 | Schema + RLS for `canonical_ticket_messages` | migration `0310`; schema file; manifest update; thread-ordering index. **`source_draft_id` is created as a plain nullable UUID without FK** because `canonical_ticket_drafts` does not exist yet; the FK + partial index are added in C4 / 0311. |
| C4 | Schema + RLS for `canonical_ticket_drafts` (state machine, idempotency-key column, reconciliation bookkeeping) + add deferred FK from `canonical_ticket_messages.source_draft_id` to `canonical_ticket_drafts.id` | migration `0311`; schema file; manifest update; UNIQUE constraint on `action_idempotency_key`; partial index on draft `status` for the review queue; soft-uniqueness guard partial UNIQUE on `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility)` per §14.1; **ALTER TABLE on `canonical_ticket_messages` to add the deferred FK + partial index `(organisation_id, source_draft_id) WHERE source_draft_id IS NOT NULL`**. |
| C5 | Adapter contract extensions (interface only — `addInternalNote`, `resolveAttachment`, `ingestion` for support entities, broadened `getTicket`) | `server/adapters/integrationAdapter.ts`; new canonical types (`CanonicalTicketData`, `CanonicalTicketMessageData`, `CanonicalSupportAgentData`, `CanonicalInboxData`); webhook entity-type extension if needed |
| C6 | Teamwork adapter — ingestion implementation (`listInboxes`, `listSupportAgents`, `fetchTickets`, `fetchTicketMessages`, status-mapping fail-closed) | `server/adapters/teamworkAdapter.ts`; pure status-mapping module + tests; webhook event-type extension (`ticket.assigned`, `ticket.status_changed`); fixture-based unit tests for the mapping table |
| C7 | Teamwork adapter — `addInternalNote` + `resolveAttachment` + idempotency-key plumbing for `addReply` and `addInternalNote` | `server/adapters/teamworkAdapter.ts`; new `action_attempts` ledger if §14.1 lands native-idempotency-not-supported |
| C8 | Connector polling integration — ingestion phase split (inboxes → agents → tickets → messages), per-org sync ledger, sync-health classification | `server/services/connectorPollingService.ts` (extension only — no new infra); poll-phase enum extension |
| C9 | Webhook ingestion — convergent dual-path with `(connector_config_id, external_id)` dedupe and `(connector_config_id, ticket_external_id, external_id)` for messages; dispatcher updates | `server/services/webhookAdapterService.ts` extension; new dispatcher case for ticket events; manual smoke test against real Teamwork sandbox for duplicate-event collapse (per §17.1 + §20) |
| C10 | `supportTicketService` (read-only canonical reads + thread assembly) and `supportInboxService` (config CRUD with `agent_config` JSONB) | new service files; principal-scoped methods; pure thread-ordering helper + test |
| C11 | Three-phase dispatch service (`supportDraftDispatchService`) — preflight → durable transition → adapter call — with `needs_reconciliation` reconciler worker | new service file + pg-boss worker (`createWorker`); pure state-machine transition guard + test; reconciliation policy module + test |
| C12 | Skill registrations (`support.list_open_tickets`, `support.read_thread`, `support.propose_reply`, `support.approve_draft`, `support.reject_draft`, `support.add_internal_note`, `support.set_status`, `support.assign`, `support.tag`, `support.find_customer_history`) | `server/skills/support/` directory; one markdown skill definition per skill; `actionRegistry` updates |
| C13 | UI surfaces — connection setup screen integration, tickets list, ticket detail (thread + draft overlay), draft review queue, inbox config | `client/src/pages/support/`; reuses primitives from `consolidation-foundation` (PageShell, SortableTable, FormFooter, etc.); references `prototypes/support-desk-canonical/` as design source of truth |
| C14 | Operational state surfaces — sync-health pill on tickets list, connection-health on connection setup success page, `needs_reconciliation` callout in draft review queue, status pills on inbox config | extends C13 surfaces; reuses existing health/sync state from `connector_configs` |
| C15 | Documentation, ADR, and `architecture.md` doc-sync — adds canonical Support Desk section, updates "Key files per domain", adds ADR for the canonical-not-conversations boundary decision | `architecture.md`; `docs/decisions/`; `docs/capabilities.md` (new capabilities); `KNOWLEDGE.md` patterns once the build settles |

The chunk boundaries respect three constraints:
- **Schema before consumers.** All five tables exist (C1–C4) before any service reads them.
- **Adapter contract before adapter implementation.** C5 lands the typed interface before C6 fills it.
- **Inbound ingestion before outbound dispatch.** Polling (C8) and webhook (C9) feed canonical state; dispatch (C11) writes through it. UI (C13–C14) consumes it last.

The single-PR shape means partial merge produces a partially populated canonical layer with no end-to-end flow. The acceptance bar in §17 is the criteria for merge readiness; per the brief this is "minimum viable provider, production-correct on covered paths" — not "everything Teamwork can do".

## 4. Domain model

### Entities and relationships

```
                  organisations
                       |
                  (org-scoped)
                       |
                  connector_configs (existing, type='teamwork')
                       |
                       |── canonical_inboxes (1..n per connector)
                       |       |
                       |       |── canonical_support_agents (1..n per inbox via assignment, n..n logical)
                       |       |
                       |       |── agent_config JSONB (per-inbox Support Agent policy)
                       |
                       |── canonical_tickets (1..n per inbox)
                       |       |
                       |       |── canonical_ticket_messages (1..n per ticket; provider-confirmed only)
                       |       |
                       |       |── canonical_ticket_drafts (0..n per ticket; agent-generated outbound intent)
                       |               |
                       |               |── source_draft_id link from a confirmed message back to its originating draft
                       |
                       |── (cross-domain) canonical_contacts (existing) — nullable FK from canonical_tickets
                       |── (cross-domain) canonical_accounts  (existing) — accessible via the contact's company
```

### Identity model

- **Provider identity** is the source of truth for entity uniqueness. Every canonical row carries `(connector_config_id, external_id)` as its dedupe key. `canonical_ticket_messages` extends this to `(connector_config_id, ticket_external_id, external_id)` because a message ID is only unique within its ticket on most provider APIs.
- **Tenant identity** is denormalised onto every child table per brief §5.9. `organisation_id` is present on `canonical_tickets`, `canonical_ticket_messages`, `canonical_inboxes`, `canonical_support_agents`, and `canonical_ticket_drafts`. RLS policies key on `current_setting('app.organisation_id', true)` and never join to a parent table.
- **Customer identity** is resilient (brief §6.1, §10 #2). Every ticket carries `customer_email` and `customer_name` populated from the provider unconditionally. The optional `canonical_contact_id` FK is set only when a deterministic email match resolves against `canonical_contacts`. Tickets are never blocked by an unmatched contact, and we never auto-create contacts from support ingestion in v1.
- **Helpdesk-agent identity** is distinct from platform-user identity. `canonical_support_agents` is the helpdesk's user table mirrored. Mapping a canonical support agent to a platform user is deferred (brief §6.4 last paragraph) — no join row in v1.

### Lifecycle

- **Read paths.** Canonical reads are local DB reads via `getOrgScopedDb` (RLS-enforced). The Support Agent queue assembly, thread assembly, and customer-history skills all hit canonical, never the provider API. Brief §3 cost-discipline bullet.
- **Write paths.** Two and only two paths write into canonical (brief §5.5): (a) ingestion (poll + webhook), (b) confirmed-action mirror writes from the dispatch service after provider confirmation. No skill, agent, or service writes user intent directly into `canonical_tickets` or `canonical_ticket_messages`. User intent lives in `canonical_ticket_drafts`.
- **Cross-domain link to CRM.** `canonical_tickets.canonical_contact_id` is the join point for the "find customer history" skill. The skill assembles `canonical_tickets` + `canonical_revenue` + `canonical_accounts` via `canonical_contacts`, all under one tenant context.

### What is deliberately NOT modelled

Reiterated from §1 non-goals so the domain model is unambiguous about what the layer does and does not represent:

- No KB articles, no CSAT records, no time-tracking, no productivity metrics, no SLA-policy table (we carry `sla_due_at` + `sla_breached` on the ticket; we do not model the policy that produced them).
- No multi-thread per ticket. v1 ticket has one logical thread; messages are ordered linearly per §5.2 thread-ordering rule.
- No conversation overlay. `canonical_conversations` is for non-ticket channels; tickets do not dual-write to conversations.

## 5. Data model — canonical entities

This is concept-level. Drizzle schema files, exact Postgres column types, and migration DDL are produced in Phase 2 (plan + builder). The spec locks (a) the columns the agent and the dispatch service depend on, (b) the dedupe keys, (c) the indexes load-bearing for read patterns, (d) the RLS posture, and (e) the closed enums.

All five tables follow the canonical pattern from `canonicalAccounts` (§2): UUID PK, `organisation_id`, `connector_config_id`, `subaccount_id` (nullable), `external_metadata` JSONB, `last_synced_at`, `source_connection_id`, `created_at`, `updated_at`. RLS-protected on the org column. Owner/visibility scope columns are NOT added in v1.

**Provider-mirrored tables also carry `external_id`** (`canonical_inboxes`, `canonical_support_agents`, `canonical_tickets`, `canonical_ticket_messages`). `canonical_ticket_drafts` is the only exception: it represents user-intent state generated locally, not a provider entity, so it has no `external_id` — its identity is the local UUID PK plus the FK chain through `ticket_id`.

### 5.1 `canonical_tickets`

Migration: `0309_canonical_tickets.sql`. Schema: `server/db/schema/canonicalTickets.ts`.

**Identity columns**

- `id` (UUID PK), `organisation_id`, `connector_config_id`, `subaccount_id`, `external_id` (provider's ticket ID).
- Unique index: `(connector_config_id, external_id)` — the dedupe key per brief §5.3.

**Customer identity** (brief §6.1, resilient)

- `customer_email`, `customer_name`, `customer_external_id` (provider's contact ID) — always populated from the provider.
- `canonical_contact_id` UUID, nullable FK to `canonical_contacts.id`. Set only when deterministic email match resolves at ingestion time. Never blocking.
- Index on `customer_email` for the unmatched-tickets query.

**Lifecycle columns**

- `status` text — closed enum, declared in TypeScript as the canonical six-state union (§5.1.A below). Stored as text + check constraint in Postgres.
- `priority` text — closed enum: `low | medium | high | urgent`.
- `opened_at`, `first_response_at`, `last_customer_message_at`, `last_agent_message_at`, `closed_at`, `resolution_at` — timestamps with timezone. Nullable except `opened_at`.

**Routing**

- `inbox_id` UUID FK to `canonical_inboxes.id`. NOT NULL — every ticket belongs to an inbox.
- `assignee_agent_id` UUID FK to `canonical_support_agents.id`, nullable.

**Collision-avoidance primitives** (brief §6.1)

- `last_human_activity_at` — timestamp of the most recent message or status change attributable to a human helpdesk agent. Updated by ingestion when a `canonical_ticket_messages` row with `author_type='agent'` AND `author_support_agent_id` references a `canonical_support_agents` with `agent_kind='human'` lands, OR when a status change is observed without a corresponding bot draft transition.
- `last_bot_activity_at` — timestamp of the most recent action attributable to our Support Agent (bot draft `sent` transition, bot status change, etc.).
- `bot_claimed_at`, `bot_claimed_by_run_id` — set when our agent claims the ticket (typically when it begins drafting), cleared when it releases (sent or rejected).

The collision-window policy that consumes these primitives lives in `canonical_inboxes.agent_config` (§5.3) and is evaluated by `supportDraftDispatchService` at preflight (§8.1). The Support Agent's policy spec (separate brief) is the consumer; this spec ships only the columns and the read.

**Classification**

- `subject` text, `tags` text[], `category` text (nullable), `source_channel` text — closed enum: `email | chat | form | api`.

**SLA tracking**

- `sla_due_at` (nullable), `sla_breached` boolean (default false), `sla_policy_external_id` text (nullable). v1 reads these fields from the provider where exposed; we do NOT model an SLA-policy table.

**Tombstone (provider-side deletion, brief §12)**

Teamwork's existing `mapTeamworkEventType` already normalises `ticket.deleted` events, so deletion handling cannot be deferred to a future spec amendment — it is in scope for v1.

- `provider_deleted` boolean NOT NULL DEFAULT false — set true only when a provider deletion event is observed (webhook `ticket.deleted`) **or** when a strict full-reconciliation poll pass proves the ticket is gone (see deletion-by-poll precondition below).
- `deleted_at_external` timestamp with timezone, nullable — provider's deletion timestamp where exposed; otherwise NULL.
- `deleted_at_canonical` timestamp with timezone, nullable — the canonical layer's first observation of the deletion.
- `deletion_source` text — closed enum: `provider_webhook | provider_poll_observation | manual_admin`. NULL when `provider_deleted=false`.

**Deletion-by-poll precondition (load-bearing).** Polling may set `provider_deleted=true` with `deletion_source='provider_poll_observation'` **only** during an explicit **full-reconciliation pass** for the relevant inbox. All of the following must hold for the pass to qualify:

1. Every page of the relevant provider endpoint has completed successfully (no partial pagination state).
2. No `support.provider.poll_page_failed` was emitted during the pass for that inbox.
3. No rate-limit truncation occurred (`support.provider.rate_limited` did not interrupt the pass).
4. The provider endpoint used has semantics where absence proves deletion or removal (i.e. an unfiltered "all tickets in this inbox" endpoint, not a filtered or windowed search).

**Incremental polls must NEVER infer deletion from absence.** A ticket missing from an incremental window or a paginated cursor read is "not in this slice", not "deleted". The day-to-day `connectorPollingService` cycle (Phase C in §7) is incremental and is therefore explicitly forbidden from setting `provider_deleted` via the poll path. The full-reconciliation pass is a distinct cadence — Phase 2 names it explicitly when wiring `connectorPollingService` (e.g. nightly per inbox, or operator-triggered) — and is the only poll-driven path allowed to tombstone a ticket.

If the precondition is not met during a given attempt, deletion remains webhook-only for the affected inbox until the next qualifying full-reconciliation pass succeeds. False tombstones would silently hide live tickets from the agent queue, which is the worst-case correctness failure for this layer; the precondition exists to make that failure mode structurally impossible.

Read-filter rules — every read path applies these consistently:

| Audience | Reads `provider_deleted=true` rows? |
|---|---|
| Agent prompt + `support.read_thread` + `support.list_open_tickets` | **No** — filtered out at the service-layer boundary |
| Human ticket UI list + detail | yes, with a tombstone treatment ("Deleted in provider · {date}") and confirmed-message visibility hidden behind a "show archived content" toggle |
| Audit / replay | yes, with explicit deletion-source label |

Restoring a previously-deleted ticket (provider re-creates a ticket with the same external ID after deletion — rare but possible on some providers) clears `provider_deleted` + tombstone columns and re-enables agent visibility. Logged via `support.ticket.restored_after_deletion` (§15).

**Provider catchall**

- `external_metadata` JSONB. Provider-specific fields not promoted to columns live here per brief §5.11. Includes the original provider status string when `status='unknown_provider_status'` (per §6 status-mapping rule).

**Sync metadata**

- `last_synced_at` timestamp, `source_connection_id` UUID FK to `integration_connections`.

**Indexes**

- `(connector_config_id, external_id)` UNIQUE.
- `(organisation_id, inbox_id, status)` — supports the actionable-queue list query.
- `(organisation_id, customer_email)` — supports unmatched-customer lookups + customer-history skill.
- `(organisation_id, last_human_activity_at)` — collision-window evaluation.
- Partial index `(organisation_id, status)` WHERE `status = 'unknown_provider_status'` — supports the quarantine surface.
- `(organisation_id, sla_due_at)` WHERE `sla_due_at IS NOT NULL AND sla_breached = false` — surfaces SLA breach risk.

**RLS**

- FORCE-RLS, USING `organisation_id = current_setting('app.organisation_id', true)::uuid`. Same shape as `canonical_accounts`.
- `RLS_PROTECTED_TABLES` entry added in migration 0309.

#### 5.1.A Canonical status state machine

Closed enum, locked at brief level (§6.1):

| Value | Visible in agent queues? | Eligible for autonomous reply? | Meaning |
|---|---|---|---|
| `open` | yes | yes | Active, agent attention required, no party currently waiting. |
| `pending_internal` | yes | no (status-change / internal-note only) | Waiting on internal action. |
| `waiting_on_customer` | yes | no by default; opt-in for follow-up | Reply has gone out, awaiting customer response. |
| `resolved` | no by default; opt-in for post-resolution | no by default | Support outcome completed. Customer reply reopens to `open`. |
| `closed` | no | no | Terminal/archive state. Reopening is an explicit operation. |
| `unknown_provider_status` | **no (quarantined)** | **no** | Adapter could not map provider's status. Excluded from all agent queues + actions until mapping is added. |

**Adding a status value requires a spec amendment** — this is a closed enum.

**Provider-specific statuses live in `external_metadata`.** The original provider status string is preserved on quarantined tickets so the operator (or Phase 2 mapping editor) can see what was unmappable.

**Transitions.** Concept-level (the spec does not enforce a transition matrix at the DB layer; the adapter and dispatch service enforce):
- `open → pending_internal | waiting_on_customer | resolved | closed` — via provider state change observed by ingestion, OR via skill (`support.set_status`) routing through the adapter.
- `pending_internal → open | waiting_on_customer | resolved | closed`.
- `waiting_on_customer → open` — automatically when the customer replies (a new `canonical_ticket_messages` row with `direction='inbound'` reopens the ticket if `status` was `waiting_on_customer`, mirroring provider behaviour).
- `resolved → open` — automatically when the customer replies (same rule).
- `closed → open` — only via explicit reopen action, not via inbound message.
- `unknown_provider_status → any` — only when an ingestion run sees the provider use a status the adapter has subsequently learned to map. The transition is one-way out of quarantine.

The DB enforces the closed enum via a CHECK constraint; the application enforces transition validity in `supportTicketService.applyStatusChange()` (§9 / Phase 2).

### 5.2 `canonical_ticket_messages`

Migration: `0310_canonical_ticket_messages.sql`. Schema: `server/db/schema/canonicalTicketMessages.ts`.

**The provider-confirmed message ledger.** Per brief §5.2, rows only exist here once the provider has accepted the message. In-flight outbound intent lives in `canonical_ticket_drafts`. This separation is the most-checked invariant in the spec.

**Identity**

- `id` UUID PK, `organisation_id` (denormalised for RLS, brief §5.9), `ticket_id` UUID FK, `external_id` text (provider's message ID, NOT NULL — never empty for a confirmed row), `connector_config_id`.
- Unique index: `(connector_config_id, ticket_external_id, external_id)`. The redundant `ticket_external_id` is denormalised onto the message for adapters whose message IDs are only unique within a ticket. We carry it both as the FK to the ticket and as a text column for the dedupe index.

**Direction + visibility + author**

- `direction` text — closed enum: `inbound | outbound | internal_note`.
- `visibility` text — closed enum: `public | internal`.
- `author_type` text — closed enum: `customer | agent | bot | system`.
- `author_contact_id` UUID, nullable. FK → `canonical_contacts.id`. Set when `author_type='customer'` and a deterministic contact match exists (per §11.6 resolution); NULL otherwise.
- `author_support_agent_id` UUID, nullable. FK → `canonical_support_agents.id`. Set when `author_type IN ('agent','bot')`; NULL otherwise.
- CHECK constraint enforces exactly the right column is populated per `author_type`:
  - `author_type='customer'` → `author_support_agent_id IS NULL` (`author_contact_id` may be NULL when no canonical-contact match resolves; the customer is still identified by `customer_email` on the parent ticket).
  - `author_type IN ('agent','bot')` → `author_contact_id IS NULL` AND `author_support_agent_id IS NOT NULL`.
  - `author_type='system'` → both columns NULL.

The split replaces a single polymorphic `author_id` because a single Postgres column cannot have conditional FKs to two different parent tables. This shape preserves the brief §5.9 denormalisation invariant (no FK joins back to the parent ticket for RLS) while giving the read layer a clean join target per author type.

**Content**

- `body_text` text NOT NULL, `body_html` text (nullable; falls back to text if not provided).
- `attachments` JSONB array — `[{filename, provider_url, mime_type, size, external_id}]`. URLs may be auth-scoped + short-lived; the adapter `resolveAttachment` method (§6) is the on-demand refresh path. v1 does not mirror to object storage.

**Redaction (provider-side message-level redaction, brief §12)**

Some providers expose message-level redaction (the message remains in the thread but its content is removed for compliance / privacy). v1 supports the read-side handling because Teamwork's existing event normalisation may surface redaction events even though `mapTeamworkEventType` does not yet recognise them (§22 OQ-5 closed by this section).

- `redacted` boolean NOT NULL DEFAULT false — set true when the provider notifies the layer that the content has been redacted.
- `redacted_at_external` timestamp with timezone, nullable.
- `redacted_at_canonical` timestamp with timezone, nullable.
- When `redacted=true`, the upsert path **must null out the content**: `body_text='[redacted]'`, `body_html=NULL`, `attachments='[]'`. The metadata fields (timestamps, author, direction, visibility, source_draft_id) are preserved so the thread structure remains intact.
- `external_metadata.redaction_reason` (optional) carries the provider-supplied reason where exposed.

Read-filter rules:

| Audience | Sees redacted message metadata? | Sees redacted content? |
|---|---|---|
| Agent prompt + `support.read_thread` | yes (the message exists with author/timestamp/direction) | no — `body_text='[redacted]'` is what the agent sees |
| Human ticket UI | yes | shows tombstone "[content redacted on {date}]" |
| Audit / replay | yes | shows `'[redacted]'` only — the original content is not retained anywhere in canonical (it was overwritten on redact) |

Per brief §12, the canonical layer does NOT silently retain content the provider has removed. The redact-overwrite happens in the same transaction as the redaction-event ingestion.

**Timestamps**

- `created_at_external` timestamp with timezone NOT NULL — the provider's authoritative creation timestamp. **Used for thread ordering** (§5.2.A below).
- `created_at` timestamp NOT NULL DEFAULT NOW() — when canonical first observed the row.

**Provenance link**

- `source_draft_id` UUID, nullable. Links a confirmed bot message back to its originating draft.
- **Migration sequencing.** The column is created in C3 / migration 0310 as a plain nullable UUID **without** an FK constraint, because `canonical_ticket_drafts` does not exist yet at that point. The FK constraint (`FOREIGN KEY (source_draft_id) REFERENCES canonical_ticket_drafts(id)`) is added in C4 / migration 0311 via `ALTER TABLE` after the drafts table lands. The C4 migration also adds the partial index `(organisation_id, source_draft_id) WHERE source_draft_id IS NOT NULL`. NULL for inbound + human-authored messages, and for any pre-C4 row (no such rows exist in production at v1 ship time, but the migration is safe regardless).

**Provider catchall**

- `external_metadata` JSONB. Includes provider sequence IDs where exposed (used for adapter-specific reconciliation when `created_at_external` is ambiguous, but never the canonical ordering rule).

**Indexes**

- `(connector_config_id, ticket_external_id, external_id)` UNIQUE — added in C3 / 0310.
- `(organisation_id, ticket_id, created_at_external, id)` — supports ordered thread reads with deterministic tiebreaker (§5.2.A). Added in C3 / 0310.
- `(organisation_id, source_draft_id)` WHERE `source_draft_id IS NOT NULL` — supports the draft → confirmed-message reverse lookup. **Added in C4 / 0311** alongside the `source_draft_id` FK constraint, because the FK + partial index are only meaningful once `canonical_ticket_drafts` exists.

**RLS**

- FORCE-RLS on `organisation_id`. Manifest entry added in 0310.

#### 5.2.A Thread ordering rule (load-bearing)

Per brief §6.2 thread-ordering paragraph: thread order is `created_at_external ASC`, with the canonical message `id` (UUID) as the **deterministic tiebreaker for messages sharing a timestamp**. Provider sequence IDs in `external_metadata` may be preferred by adapter-specific reconciliation logic when ambiguity exists, but the canonical ordering rule above is the contract for all agent-facing reads, evals, and prompt assembly.

The `support.read_thread` skill orders by `(created_at_external ASC, id ASC)`. This is the read contract every consumer must follow. Phase 2 includes a pure helper module + test fixture asserting the ordering on tied timestamps.

#### 5.2.B Audience-tier read separation (brief §5.2)

Three audience tiers; read paths and what they see:

| Audience | Reads from | Sees `dispatching` drafts? | Sees `needs_reconciliation` drafts? | Sees `provider_deleted` tickets? | Sees `redacted` message content? |
|---|---|---|---|---|---|
| Agent prompt + `support.read_thread` | `canonical_ticket_messages` only | **No** (hard boundary, enforced in service layer) | **No** | **No** (filtered at service-layer boundary) | message metadata only — content is `'[redacted]'` |
| Human ticket UI | `canonical_ticket_messages` + `canonical_ticket_drafts` overlay (visually distinct) | yes (labelled "pending send") | yes (labelled "reconciling") | yes — tombstoned with "Deleted in provider · {date}" + "show archived content" toggle | yes — tombstoned with "[content redacted on {date}]" |
| Audit / replay | both, with explicit labels | yes | yes | yes — labelled with `deletion_source` | yes — content is `'[redacted]'` (original was overwritten on redact, never retained) |

The agent-thread skill is the boundary that must enforce the separation. Phase 2 names a single read function (`supportTicketService.readThreadForAgent(ticketId, principalCtx)`) as the only path for agent prompt assembly. The separate human-UI read uses `supportTicketService.readThreadForHumanUi()` which composes the confirmed thread with a draft overlay. Both functions apply the `provider_deleted` and `redacted` filters per the table above.

`support.list_open_tickets` similarly filters `provider_deleted=true` rows out at the service-layer boundary; the agent never sees a deleted ticket.

### 5.3 `canonical_inboxes`

Migration: `0307_canonical_inboxes.sql`. Schema: `server/db/schema/canonicalInboxes.ts`.

**Identity + provider link**

- `id` UUID PK, `organisation_id`, `connector_config_id`, `external_id` (provider's inbox ID), `subaccount_id` nullable.
- Unique index: `(connector_config_id, external_id)`.

**Provider-shape columns**

- `name` text NOT NULL, `email_address` text (the public-facing helpdesk address that routes here), `is_active` boolean DEFAULT true.

**`agent_config` JSONB** (the policy unit, brief §10 #8)

A typed JSONB column carrying per-inbox Support Agent configuration. v1 schema (TypeScript-typed via `$type` cast):

```ts
{
  // Schema version anchor (§11.5). Adding a field bumps the version and triggers a Phase 2 migration step.
  version: 1;

  mode: 'autonomous' | 'assisted' | 'disabled';

  // Collision-window (brief §5.4 + §6.1 collision primitives)
  collisionWindow: {
    minMinutesSinceHumanActivity: number;       // default 30
    respectHumanAssignee: boolean;              // default true
  };

  // Draft expiry (queue-state expiry, NOT dispatching/reconciliation)
  draftExpiry: {
    awaitingReviewHours: number;                // default 72
    draftHours: number;                         // default 24
  };

  // Optional per-inbox model + prompt overrides (used when set; falls back to platform defaults)
  modelOverride?: string;                       // null = platform default
  promptOverride?: string;                      // null = platform default

  // Opt-in per-inbox extension flags
  optIns: {
    autonomousReplyOnWaitingOnCustomer: boolean;  // default false
    postResolutionFollowUp: boolean;              // default false
  };
}
```

The shape is locked by a Zod schema in `shared/types/supportInboxAgentConfig.ts` so reads can validate and so spec-conformance can verify the schema matches this section. Adding a field requires a spec amendment.

**Provider catchall + sync metadata**

- `external_metadata` JSONB, `last_synced_at`, `source_connection_id`.

**Indexes**

- `(connector_config_id, external_id)` UNIQUE.
- `(organisation_id, is_active)`.

**RLS**

- FORCE-RLS on `organisation_id`. Manifest entry added in 0307.

### 5.4 `canonical_support_agents`

Migration: `0308_canonical_support_agents.sql`. Schema: `server/db/schema/canonicalSupportAgents.ts`.

**Identity**

- `id` UUID PK, `organisation_id`, `connector_config_id`, `external_id` (provider's user ID), `subaccount_id` nullable.
- Unique index: `(connector_config_id, external_id)`.

**Provider-shape columns**

- `display_name` text NOT NULL, `email` text (nullable for system / bot agents), `is_active` boolean DEFAULT true.
- `agent_kind` text — closed enum: `human | bot`. The Support Agent reads this to recognise its own past replies (brief §6.4).

**Provider catchall + sync metadata**

- `external_metadata` JSONB, `last_synced_at`, `source_connection_id`.

**Platform-user join (deferred, brief §6.4)**

NOT modelled in v1. A future `support_agent_to_platform_user` join row may be introduced when an agent skill needs the link; do not add until a concrete consumer exists.

**Indexes**

- `(connector_config_id, external_id)` UNIQUE.
- `(organisation_id, agent_kind, is_active)`.

**RLS**

- FORCE-RLS on `organisation_id`. Manifest entry added in 0308.

### 5.5 `canonical_ticket_drafts`

Migration: `0311_canonical_ticket_drafts.sql`. Schema: `server/db/schema/canonicalTicketDrafts.ts`.

**The home for agent-generated outbound intent.** Brief §6.5. The state machine here is the highest-stakes part of the data model — it implements the three-phase dispatch invariant (brief §5.8) and the `needs_reconciliation` reconciler-routes-not-silently-expires invariant (brief §5.8 second paragraph).

**Identity**

- `id` UUID PK (also the ID surfaced in the human review UI on hover; see brief §10 / mockup invariant).
- `organisation_id`, `subaccount_id` (nullable), `connector_config_id` (denormalised for adapter calls; not strictly needed since `ticket_id` resolves it, but cheaper for the dispatch worker).
- `ticket_id` UUID FK to `canonical_tickets.id` NOT NULL.

**Proposed content**

- `proposed_body_text` text NOT NULL, `proposed_body_html` text nullable.
- `proposed_visibility` text — closed enum: `public | internal`.
- `proposed_actions` JSONB — companion state-change intent (status, tags add/remove, assignee). Optional. Shape locked by Zod schema.

**State machine** (closed enum)

`status` text — closed enum:

`draft | awaiting_review | dispatching | needs_reconciliation | manually_marked_sent | sent | rejected | failed | expired | superseded`

There is intentionally no durable `approved` resting state. Approval is the trigger that transitions `awaiting_review → dispatching` (or `draft → dispatching` for autonomous mode). See §8 for the full transition diagram.

`manually_marked_sent` is a **non-terminal** state introduced for the manual-resolution surface in §8.5. It represents "operator confirmed the provider accepted this send, but no provider message has been observed in canonical yet." The state resolves to terminal `sent` automatically when ingestion subsequently lands the provider's confirmed message and the §8.5 back-link routine sets `sent_message_id`. **Invariant: `sent` always has `sent_message_id IS NOT NULL`.** `manually_marked_sent` always has `sent_message_id IS NULL`.

**Three-phase dispatch columns** (brief §5.8 + §5.7)

- `action_idempotency_key` text — set when the draft transitions out of a queue state (`draft` or `awaiting_review`) into `dispatching`. Stable across retries. Never reused. Per §14.1, derived from `(connector_config_id, ticket_id, action_type, draft_id)` where `action_type ∈ {'reply','internal_note'}`.
- UNIQUE constraint on `(connector_config_id, action_idempotency_key)` WHERE `action_idempotency_key IS NOT NULL` — prevents duplicate-key reuse and lets a retry collide deterministically with the in-flight attempt.
- `dispatching_started_at` timestamp — when phase 2 commit landed.
- `last_reconciliation_at` timestamp, `reconciliation_attempt_count` integer DEFAULT 0 — bookkeeping for the `needs_reconciliation` path. Reset to NULL/0 on transition to `sent`/`failed`.

**Provenance** (brief §6.5)

- `created_by_agent_run_id` UUID FK to `agent_runs.id` (nullable; null only for the rare manual-draft path if that ever lands — out of scope v1, write a NOT NULL constraint after Phase 2 confirms there is no manual path).
- `model_version` text, `prompt_version` text — copy of the model + prompt the draft was generated under, for replay + regression eval.

**Review trail**

- `reviewer_user_id` UUID FK to `users.id`, nullable. Set when a human approves or rejects.
- `reviewed_at` timestamp.
- `review_notes` text — operator's optional note.

**Outbound link**

- `sent_message_id` UUID FK to `canonical_ticket_messages.id`, nullable. Set when the dispatch completes and the confirmed message is reconciled in. The reverse link `canonical_ticket_messages.source_draft_id` mirrors this (set at the same write).

**Lifecycle**

- `expires_at` timestamp — applies to **queue states only** (`draft`, `awaiting_review`). NOT applied to `dispatching` or `needs_reconciliation` per brief §6.5 (those have provider-side ambiguity and must reconcile, not silently expire).
- `created_at`, `updated_at`.

**Indexes**

- `(organisation_id, ticket_id, status)` — supports per-ticket draft overlay for human UI.
- `(organisation_id, status, created_at)` partial WHERE `status IN ('awaiting_review','needs_reconciliation','manually_marked_sent')` — supports the review queue + reconciliation queue + manually-marked-sent back-link queue.
- `(connector_config_id, action_idempotency_key)` UNIQUE WHERE `action_idempotency_key IS NOT NULL`.
- `(organisation_id, expires_at)` WHERE `status IN ('draft','awaiting_review')` — supports the queue-expiry sweeper.
- **Soft-uniqueness guard for `support.propose_reply` retry-noise** (per §14.1): UNIQUE partial index `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')`. This converts a same-run double-proposal from "two queue rows the operator must reconcile" into a deterministic supersede-then-insert flow.

  **Same-run supersession transaction order is load-bearing** (the partial UNIQUE will fire if the order is wrong). Within one transaction, in this exact sequence: (a) `UPDATE canonical_ticket_drafts SET status='superseded', updated_at=NOW() WHERE organisation_id=$1 AND ticket_id=$2 AND created_by_agent_run_id=$3 AND proposed_visibility=$4 AND status IN ('draft','awaiting_review')` — moves any matching prior draft out of the partial-UNIQUE-protected status set; (b) `INSERT INTO canonical_ticket_drafts (...) VALUES (...)` — writes the new draft. If the INSERT fails, the transaction rolls back and the prior draft is preserved in its original state. **Inserting before superseding is forbidden** — the partial UNIQUE will reject the insert and the supersede branch will not run.

  This bounds review-queue noise from agent retries while preserving the user-visible duplicate-draft path for cross-run double-proposals (different `agent_run_id` → distinct partial-UNIQUE keys → both rows coexist).

**RLS**

- FORCE-RLS on `organisation_id`. Manifest entry added in 0311.

## 6. Adapter contract extensions

The brief §7 names the per-provider adapter contract conceptually. This section locks the TypeScript-level extensions to `server/adapters/integrationAdapter.ts` so every adapter (Teamwork v1, Zendesk + Freshdesk later) implements an identical shape.

### New canonical types in `integrationAdapter.ts`

Adding alongside the existing `CanonicalContactData`, `CanonicalConversationData`, etc. family:

```ts
export interface CanonicalInboxData {
  externalId: string;
  name: string;
  emailAddress?: string;
  isActive: boolean;
  externalMetadata?: Record<string, unknown>;
}

export interface CanonicalSupportAgentData {
  externalId: string;
  displayName: string;
  email?: string;
  agentKind: 'human' | 'bot';
  isActive: boolean;
  externalMetadata?: Record<string, unknown>;
}

export interface CanonicalTicketData {
  externalId: string;
  inboxExternalId: string;                   // FK lookup, not direct id
  customerEmail?: string;
  customerName?: string;
  customerExternalId?: string;
  subject: string;
  status: SupportCanonicalStatus;            // see below
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeAgentExternalId?: string;
  tags?: string[];
  category?: string;
  sourceChannel: 'email' | 'chat' | 'form' | 'api';
  openedAt: Date;
  firstResponseAt?: Date;
  lastCustomerMessageAt?: Date;
  lastAgentMessageAt?: Date;
  closedAt?: Date;
  resolutionAt?: Date;
  slaDueAt?: Date;
  slaBreached?: boolean;
  slaPolicyExternalId?: string;
  externalMetadata?: Record<string, unknown>;
}

export interface CanonicalTicketMessageData {
  externalId: string;
  ticketExternalId: string;                  // ingestion path uses this for FK lookup
  direction: 'inbound' | 'outbound' | 'internal_note';
  visibility: 'public' | 'internal';
  authorType: 'customer' | 'agent' | 'bot' | 'system';
  authorExternalId?: string;                 // contact ID (customer) or support-agent ID (agent/bot)
  bodyText: string;
  bodyHtml?: string;
  attachments?: Array<{
    externalId: string;
    filename: string;
    providerUrl: string;
    mimeType?: string;
    size?: number;
  }>;
  createdAtExternal: Date;
  externalMetadata?: Record<string, unknown>;
}

export type SupportCanonicalStatus =
  | 'open'
  | 'pending_internal'
  | 'waiting_on_customer'
  | 'resolved'
  | 'closed'
  | 'unknown_provider_status';

export type SupportStatusMap = Record<string, Exclude<SupportCanonicalStatus, 'unknown_provider_status'>>;
```

### `IntegrationAdapter.ticketing` — extensions

Extend the existing typed group:

```ts
ticketing?: {
  // existing methods retained verbatim
  createTicket(...): Promise<TicketCreateResult>;
  updateTicket(...): Promise<TicketUpdateResult>;
  addReply(...): Promise<TicketReplyResult>;
  getTicket(...): Promise<TicketData>;

  // NEW
  addInternalNote(
    connection: IntegrationConnection,
    ticketId: string,
    body: string,
    options?: { idempotencyKey?: string }
  ): Promise<TicketReplyResult>;

  // NEW — attachment auth refresh path (brief §6.2 attachment policy)
  resolveAttachment(
    connection: IntegrationConnection,
    ticketId: string,
    messageId: string,
    attachmentExternalId: string
  ): Promise<{ url?: string; stream?: NodeJS.ReadableStream; mimeType?: string; success: boolean; error?: AdapterError }>;
};
```

The existing `addReply` is broadened to accept `options?: { idempotencyKey?: string; status?: string }` — the idempotency key is the §14.1 stable key. Adapters that support a native idempotency header forward it; adapters that don't are wrapped at a higher layer by the `action_attempts` ledger (§14.1).

### `IntegrationAdapter.ingestion` — new typed shape for support entities

Extend the existing optional `ingestion` group with the four new methods. v1 adapter declares the methods optional via the existing `?` shape; the canonical layer decides per-adapter what to call based on the §17 capability matrix.

```ts
ingestion?: {
  // ... existing CRM methods retained ...

  // NEW
  listInboxes(
    connection: IntegrationConnection
  ): Promise<CanonicalInboxData[]>;

  listSupportAgents(
    connection: IntegrationConnection
  ): Promise<CanonicalSupportAgentData[]>;

  fetchTickets(
    connection: IntegrationConnection,
    inboxExternalId: string,
    opts?: FetchOptions
  ): Promise<CanonicalTicketData[]>;

  fetchTicketMessages(
    connection: IntegrationConnection,
    ticketExternalId: string,
    opts?: FetchOptions
  ): Promise<CanonicalTicketMessageData[]>;
};
```

`FetchOptions` is the existing primitive (`since`, `limit`). Per brief §5.6, sync cursors live in `connector_configs` / `integration_ingestion_stats`; the adapter receives `since` and returns rows; the polling service maintains the cursor.

### Status-mapping fail-closed contract

Every adapter must declare its provider-status → canonical-status map. The mapping is a pure data structure colocated with the adapter:

```ts
// In server/adapters/teamwork/teamworkSupportStatusMap.ts (NEW)
export const TEAMWORK_SUPPORT_STATUS_MAP: SupportStatusMap = {
  'active': 'open',
  'new': 'open',
  'open': 'open',
  'pending': 'pending_internal',
  'on_hold': 'pending_internal',
  'waiting_on_customer': 'waiting_on_customer',
  'waiting on customer': 'waiting_on_customer',
  'awaiting_customer': 'waiting_on_customer',
  'solved': 'resolved',
  'resolved': 'resolved',
  'closed': 'closed',
  // ... full inventory determined during C6 and locked as a spec-conformance artifact ...
};

export function mapTeamworkStatus(provider: string | null | undefined): SupportCanonicalStatus {
  if (!provider) return 'unknown_provider_status';
  const normalised = provider.toLowerCase().trim();
  return TEAMWORK_SUPPORT_STATUS_MAP[normalised] ?? 'unknown_provider_status';
}
```

The mapping function is **pure** — exported separately, tested with a fixture matrix that includes (a) every known provider value, (b) NULL, (c) unknown. The Teamwork inventory is closed as part of brief §10 #12 — the spec cannot be approved until the inventory is complete (see OQ-2 in §22).

### Webhook event-type extension

The existing `mapTeamworkEventType` already handles `ticket.created/updated/completed/reopened/deleted` and `ticket.reply.created/note.created`. Brief §10 #11 adds:

- `ticket.assigned` — entity type `ticket`, drives `assignee_agent_id` update.
- `ticket.status_changed` — entity type `ticket`, drives status update.

Where Teamwork does not expose these as discrete events, the polling fallback covers them by re-fetching the ticket header on every poll cycle. The §17 capability matrix locks the per-event yes/no.

### What does NOT change in the contract

Per brief §6.6 + §5.11:

- No new `IntegrationAdapter` capability group. Support is part of the existing `ticketing`, `webhook`, and `ingestion` groups.
- No SLA-policy ingestion method. Adapters expose `slaDueAt`, `slaBreached`, `slaPolicyExternalId` on the ticket; the policy itself is provider-side.
- No bulk historical backfill methods. `fetchTickets(since=…)` is the only path; the polling service decides the cursor.

## 7. Ingestion flow — poll and webhook convergence

Two delivery paths, one canonical state. Per brief §5.3, the same provider event must resolve to the same canonical row regardless of which path arrives first.

### Sync phase order

The polling cycle for a Teamwork connection runs in this order (extension to `connectorPollingService` poll loop):

1. **Phase A — `listInboxes`.** Upserts `canonical_inboxes` keyed on `(connector_config_id, external_id)`. Bookkeeping: `inboxes.lastSyncedAt`. Inboxes are dimensional; new tickets cannot reference an inbox we haven't observed.
2. **Phase B — `listSupportAgents`.** Upserts `canonical_support_agents` keyed on `(connector_config_id, external_id)`. Same dimensional rationale.
3. **Phase C — `fetchTickets(inboxExternalId, since=lastTicketSyncAt)`** for each active inbox. Upserts `canonical_tickets` keyed on `(connector_config_id, external_id)`.
4. **Phase D — `fetchTicketMessages(ticketExternalId, since=lastMessageSyncAt)`** for each ticket touched in Phase C plus any ticket whose poll-window pulled it in. Upserts `canonical_ticket_messages` keyed on `(connector_config_id, ticket_external_id, external_id)`.

Per brief §5.6, sync cursors (`lastTicketSyncAt`, `lastMessageSyncAt`) live in `connector_configs.configJson` / `integration_ingestion_stats`. Canonical rows carry only `last_synced_at`.

### Convergence rule

Webhook ingestion enters via the existing `webhookAdapterService` dispatcher. For each `ticket.*` event:

- The dispatcher resolves `(connector_config_id, external_id)` → ticket row.
- If the row exists, it applies a **deterministic update** (set columns from `data`; never overwrite `created_at`; advance `last_human_activity_at` / `last_bot_activity_at` per author rules).
- If the row does not exist, it inserts a new row.

The same logic runs in poll Phase C. The result is identical regardless of which path arrives first. Re-ingesting the same event must be a no-op or a deterministic update — never a duplicate insert. **Dedupe key is the unique index in §5.1 / §5.2.**

For `ticket.reply.created` / `ticket.note.created`:

- Dedupe key is `(connector_config_id, ticket_external_id, external_id)`.
- If the message has a `source_draft_id` linkable via `(connector_config_id, action_idempotency_key)` (the dispatch service tagged the outbound action), the reconciliation path in §8.4 sets `source_draft_id` on insert and transitions the draft to `sent`.

### Duplicate webhook + sync-response collapse (brief §5.2 second paragraph)

When the adapter returns a provider message ID synchronously on send, the confirmed message may be inserted immediately as part of the same transaction that marks the draft `sent`. A subsequent webhook for the same send finds the row already inserted and is a deterministic no-op update.

The collision-detection path emits `support.ingest.duplicate_collapsed` (§15) with `event_type=ticket.reply.created` and the canonical message ID for observability.

### Customer-identity resolution (brief §10 #2)

On every ticket upsert, the ingestion path attempts deterministic `customer_email` match against `canonical_contacts`:

- If a single `canonical_contacts` row in the same `organisation_id` matches `email = customer_email`, set `canonical_contact_id` to that row's id.
- If zero or multiple rows match, leave `canonical_contact_id` NULL and emit `support.ingest.contact_unmatched` (§15) with the email + ticket id.
- **We never auto-create `canonical_contacts` rows from support ingestion in v1.** Brief §10 #2.

### Status-mapping fail-closed application (brief §7)

When `fetchTickets` returns a `CanonicalTicketData` whose `status='unknown_provider_status'` (because `mapTeamworkStatus` returned the quarantine value), the polling service:

1. Upserts the ticket with `status='unknown_provider_status'`.
2. Preserves the original provider status string in `external_metadata.provider_status_raw`.
3. Emits `support.status.unknown_provider_status` (§15) with the raw value + the ticket id.

The `unknown_provider_status` value never silently becomes `open`. The brief §7 invariant is structurally enforced by the adapter (mapping function returns the quarantine value) plus the DB CHECK constraint (the quarantine value is in the closed enum).

### Backfill scope (brief §8.7)

Runtime backfill is limited to the minimum window required for live operation:

- All open tickets (`status NOT IN ('closed','resolved')` per provider).
- For each open ticket, the most recent N messages (default 50, configurable per connector_config).
- A configurable `lookback_days` for tickets closed within the window (default 30 — covers reopens).

Anything older lives in Foundry's historical loader, not here.

### Webhook idempotency surface

The existing `webhookAdapterService` dispatcher already provides per-event dedupe keyed on `external_event_id` (`NormalisedEvent.externalEventId`). Re-delivery of the same provider event collapses at the dispatcher level. The convergence rule above ensures sync-vs-webhook-vs-replay all converge on identical canonical state.

The `webhook_unmapped_event` log code (§15) emits when the dispatcher receives a Teamwork event type the adapter does not yet recognise — a signal to extend `mapTeamworkEventType`.

## 8. Outbound dispatch — three-phase send and reconciliation

This section operationalises brief §5.7 + §5.8. The dispatch path is the most dangerous in the system: a duplicate customer-visible reply is the worst-case failure mode. The state machine and the idempotency-key contract together prevent it.

### State machine

```
                  ┌──────────────┐  reject (assisted)
                  │              │ ────────────────► rejected
                  │  draft       │                       (terminal)
                  └──────┬───────┘
                         │
         (assisted)      │ (autonomous: skip awaiting_review)
        approve_required │
                         ▼
                  ┌──────────────┐  reject (operator)
                  │              │ ────────────────► rejected
                  │ awaiting_    │                       (terminal)
                  │ review       │
                  │              │  expires_at passes
                  │              │ ────────────────► expired
                  │              │  (queue-state expiry only)
                  └──────┬───────┘
                         │
                approve  │ (sets action_idempotency_key, transitions atomically)
                         ▼
                  ┌──────────────┐  adapter accepts (sync confirm)
                  │              │ ────────────────► sent
                  │ dispatching  │                       (terminal — sent_message_id linked)
                  │              │
                  │              │  adapter timeout / network err / ambiguous
                  │              │ ────────────────► needs_reconciliation
                  │              │                       (recoverable; not terminal)
                  │              │
                  │              │  adapter rejects (definitive: 422 / 4xx non-auth)
                  │              │ ────────────────► failed
                  │              │                       (terminal — provider-rejected only)
                  └──────────────┘
                         ▲
                         │ reconciler proves provider accepted
                         │
                         ▼
                  ┌──────────────┐  reconciler proves provider accepted (back-link sets sent_message_id)
                  │              │ ────────────────► sent
                  │ needs_       │  reconciler proves provider rejected
                  │ reconciliation│ ────────────────► failed
                  │              │  reconciler exhausts budget (still ambiguous)
                  │              │ ────────────────► (surface to manual review; no auto-transition)
                  │              │  operator confirms send via §8.5 manual surface
                  │              │ ────────────────► manually_marked_sent
                  └──────────────┘

                  ┌──────────────────────┐  later ingestion lands the provider message
                  │                      │  AND back-link routine sets sent_message_id
                  │ manually_marked_sent │ ────────────────────────────────────────────► sent
                  │ (non-terminal)       │                                                 (terminal — sent_message_id NOT NULL)
                  │                      │  no provider message ever lands
                  │                      │ ────────────────────────────────► (stays in manually_marked_sent indefinitely; operator's confirmed answer)
                  └──────────────────────┘

       superseded — written when a newer draft for the same ticket replaces this one. Transition: `draft | awaiting_review → superseded` only — and only when the agent (or a follow-up agent run) writes a fresh draft over an existing pre-dispatch draft for the same ticket. The supersede write is a single-statement update guarded by `WHERE status IN ('draft','awaiting_review')` so a draft already in `dispatching` or beyond cannot be superseded out from under the dispatch path. `superseded` is terminal — once a draft is in this state no further transitions occur.
```

Forbidden transitions:
- `dispatching → expired` — never. `dispatching` does not silently expire (brief §5.8).
- `dispatching → failed` directly on timeout — never. Timeout routes through `needs_reconciliation` first.
- `needs_reconciliation → expired` — never. Same reason.
- `manually_marked_sent → expired | failed | rejected` — never. Manual confirmation is the operator's terminal answer on the dispatch decision; it can only resolve to `sent` (via back-link) or remain in `manually_marked_sent` indefinitely.
- `dispatching | needs_reconciliation | manually_marked_sent | sent | failed | rejected | expired → superseded` — never. Supersede only applies to pre-dispatch states (`draft`, `awaiting_review`).
- `sent → manually_marked_sent` — never. The transition runs the other direction.
- Any transition out of `sent`, `failed`, `rejected`, `expired`, or `superseded` — terminal.
- `unknown_provider_status` ticket → any draft transition — preflight refuses (§8.1).

`manually_marked_sent` is **non-terminal** — it can transition to `sent` when the back-link routine succeeds. The post-terminal prohibition therefore does NOT apply to `manually_marked_sent` rows.

The transition guard is a pure function in `server/services/supportDraftDispatchServicePure.ts` with a fixture matrix asserting every valid + every forbidden transition, including the post-terminal prohibition (Section 10.4 of the spec authoring checklist).

### 8.1 Phase 1 — Preflight checks

Runs in the request handler when the operator presses Approve (assisted), or in the agent execution path when the agent emits a fully-prepared draft (autonomous).

Inputs: draft ID, principal context.

Checks (all must pass before phase 2 starts):

1. Draft is in a valid pre-state (`draft` for autonomous, `awaiting_review` for assisted).
2. Inbox `agent_config.mode` is not `disabled`.
3. Ticket `status` is not `unknown_provider_status` (quarantined tickets cannot be acted on).
4. Ticket `status` is eligible for the proposed action — `support.add_internal_note` is permitted on `pending_internal`; `support.propose_reply` is not (§5.1.A column 3).
5. Collision-window check: `now - last_human_activity_at >= agent_config.collisionWindow.minMinutesSinceHumanActivity` AND (if `respectHumanAssignee=true`) `assignee_agent_id` is null OR points to a `canonical_support_agents` with `agent_kind='bot'`.
6. Customer identity resolved when policy requires it (per inbox config flag — currently unused in v1; reserved for the future opt-in `requireCustomerMatch` flag).
7. Draft has not been superseded (no newer draft for the same ticket in `awaiting_review` or later state).

If any check fails, the dispatch returns a typed reason without entering phase 2. The reason set is:
- `inbox_disabled`
- `ticket_quarantined`
- `ticket_status_ineligible`
- `human_collision_blocked` (emit `support.ticket.human_collision_blocked` per §15)
- `superseded_by_newer_draft`
- `customer_match_required`

### 8.2 Phase 2 — Durable transition (atomic)

Single transaction:

```sql
UPDATE canonical_ticket_drafts
SET
  status = 'dispatching',
  action_idempotency_key = $key,                  -- §14.1 derivation, deterministic per draft id
  dispatching_started_at = NOW(),
  reviewer_user_id = $userId,                     -- if assisted
  reviewed_at = NOW(),                            -- if assisted
  updated_at = NOW()
WHERE id = $draftId
  AND status IN ('draft', 'awaiting_review')
  AND organisation_id = current_setting('app.organisation_id', true)::uuid
RETURNING *;
```

If 0 rows updated, the draft has already been dispatched or moved to a terminal state. The caller treats this as a deterministic no-op and may safely return the current state. **First-commit-wins** — the second concurrent approve attempt sees 0 rows and either returns the in-flight `dispatching` draft state (if found) or the terminal state (if reached). No second adapter call is made (Section 10.3 of the spec authoring checklist — this is the concurrency guard).

The UNIQUE constraint on `(connector_config_id, action_idempotency_key)` (where non-null) is the second guard: if some pathological retry path fabricates a colliding key, the constraint fires and the operation maps to HTTP 409 (§14.6).

### 8.3 Phase 3 — Adapter call

After phase 2 commits, the dispatch service calls the adapter. The action depends on `proposed_visibility`:

- `public` → `adapter.ticketing.addReply(connection, ticketId, body, { idempotencyKey, status })`
- `internal` → `adapter.ticketing.addInternalNote(connection, ticketId, body, { idempotencyKey })`

Adapter response paths:

| Adapter result | Draft transition | Canonical message inserted? |
|---|---|---|
| `success: true`, returned `replyId` (sync confirm) | `sent` (in same tx as message insert) | yes — `(external_id=replyId, source_draft_id=draftId)` |
| `success: false`, `error.retryable=false` and `error.code IN ('validation_error','not_found','auth_error')` | `failed` | no |
| `success: false`, `error.retryable=true` (timeout, rate_limited, provider_error 5xx) | `needs_reconciliation` | no — reconciler decides |
| Network exception (no adapter response at all — `axios` throws before response) | `needs_reconciliation` | no — reconciler decides |
| Process crash between phase 2 commit and the adapter call lands successfully | resume on restart: dispatch worker sees `dispatching` draft with no terminal state, transitions to `needs_reconciliation` | reconciler decides |

The companion `proposed_actions` (status / tags / assignee mutations) are applied via separate adapter calls AFTER the message insert succeeds. Each is idempotent per §14.1 (the in-place-mutation key derivation includes a hash of the mutation payload). If a mutation fails, the message has already landed (correct customer-visible behaviour); the operator + audit trail show the partial success and an alert is raised via §5.10 codes.

### 8.4 Reconciliation worker (handles `needs_reconciliation`)

A dedicated pg-boss worker (`supportDraftReconciliationWorker`, registered via `createWorker`) processes drafts in `needs_reconciliation`. Brief §5.8 second paragraph + brief §6.5 `needs_reconciliation` semantics.

Reconciliation algorithm per attempt:

1. Increment `reconciliation_attempt_count`. Set `last_reconciliation_at = NOW()`.
2. Reconciliation primary signal: a `canonical_ticket_messages` row exists with `source_draft_id = draft.id` (a webhook or poll already landed the confirmed message). If yes, transition to `sent` and return.
3. Reconciliation secondary signal: call `adapter.ticketing.getTicket(ticketId)` and inspect the message list — does the provider's recent message list contain a row whose body matches `proposed_body_text` and whose `created_at` is after `dispatching_started_at`? If yes, insert `canonical_ticket_messages` (with `source_draft_id=draft.id`) and transition the draft to `sent`. Emit `support.action.retry_idempotent` (§15).
4. Reconciliation tertiary signal: if the adapter returns a definitive "no such reply / not found" for the idempotency key (only adapters with native idempotency support this path), transition to `failed`.
5. Otherwise: bounded retry budget. Default `max_attempts = 5` with exponential backoff via `withBackoff`. If exhausted, surface the draft for manual review (§8.5) — never auto-transition to `failed`.

The reconciler reads provider state with the same connection token + `getOrgScopedDb` as the polling service. The reconciliation policy is a pure decision module (`supportDraftReconciliationPure.ts`) accepting (a) the draft state, (b) the latest provider message list, (c) the attempt count, and returning one of `{ resolve_sent, resolve_failed, retry_after_ms, surface_manual }`. Pure-tested with a fixture matrix covering each branch.

### 8.5 Manual-review surface for exhausted reconciliation

Drafts whose reconciliation budget is exhausted appear in the draft review queue (existing prototype `prototypes/support-desk-canonical/draft-review.html`) with a distinct visual treatment. Brief §5.12 + §6.5 + §10 #3.

The surface offers three operator actions. **UI labels matter** — they communicate to the operator that they are confirming provider state, not synthesising canonical state:

- **"Mark provider send as verified"** (button label) — operator has checked Teamwork directly and confirmed the message landed. Transitions draft to **`manually_marked_sent`** (non-terminal — see §5.5 + §14.7). **Does NOT insert a row into `canonical_ticket_messages`** — the provider-confirmed message ledger only accepts rows that carry the provider's message ID (§5.2 `external_id` NOT NULL invariant). The confirmed message will land via webhook or the next poll cycle, at which point the §8.5 back-link routine sets `sent_message_id` and the draft transitions to terminal `sent`. Emits `support.draft.manually_marked_sent` (§14.4) for operator/audit visibility — distinct from the `support.draft.sent` terminal event, which fires only when `sent_message_id IS NOT NULL`. Audit-event written to `auditEvents` recording the operator's manual confirmation.
- **"Mark as failed in provider"** — operator has checked Teamwork directly and confirmed the provider rejected the send (or never received it and is not going to). Transitions to terminal `failed`. No canonical message inserted. Emits `support.draft.failed`. Audit-event written.
- **"Retry reconciliation"** — resets the reconciliation budget and re-enqueues the draft for the §8.4 worker. Useful when the operator suspects a transient provider issue has resolved. The `action_idempotency_key` is reused, so the retry is safe.

**Late linking of the provider-confirmed message after manual confirmation.** When ingestion subsequently lands the provider's confirmed message via webhook or poll, the message-upsert path (§7 convergence) runs a "back-link" check after a successful insert/update: for every newly-landed `canonical_ticket_messages` row with `direction IN ('outbound', 'internal_note')` and `source_draft_id IS NULL`, look up drafts on the same ticket in `manually_marked_sent` state (or in terminal `sent` with `sent_message_id IS NULL`, for any pre-`manually_marked_sent` rows that may exist) whose `proposed_visibility` matches the message direction (public reply ↔ outbound, internal note ↔ internal_note). Then attempt a body + timestamp match (same proposed_body_text and the message's `created_at_external` near `dispatching_started_at`). If a unique match is found, set `source_draft_id` on the message row, set `sent_message_id` on the draft, **and transition the draft from `manually_marked_sent` to terminal `sent`** — all in the same transaction. The terminal `support.draft.sent` event fires at this point with the now-non-null `message_id`, satisfying the §14.4 contract. Match logic and disambiguation rules are colocated in `supportDraftReconciliationPure.ts` (the same module that drives §8.4) and pure-tested across both reply and internal-note paths. The back-link routine is the third allowed writer of `source_draft_id` per §11.4 — alongside the dispatch service (sync-confirm) and the reconciliation worker (`needs_reconciliation` resolution) — and the bounded writer set means raw ingestion still never sets the column on its own.

If the provider ultimately did not accept the message (no provider message ever lands), the draft stays in `manually_marked_sent` indefinitely. There is no automatic switch back to `failed` after the manual confirmation — the operator's confirmation is their answer for the dispatch decision. The operator is responsible for choosing "Mark provider send as verified" vs "Mark as failed in provider" correctly when they exhaust reconciliation; the surface is built specifically so they verify provider state in the helpdesk UI before deciding.

This surface never causes a duplicate reply: phase 3 already used `action_idempotency_key`, so a future webhook for the same send finds the row dedupe-collapsed by the UNIQUE index. Operator-triggered "Retry reconciliation" reuses the same key.

**Why the surface keeps `manually_marked_sent` non-terminal.** The alternative — capturing a synthetic provider message ID at manual-confirmation time, or transitioning straight to terminal `sent` with `sent_message_id IS NULL` — would either fabricate an ID (violates §5.2 provider-confirmed-only invariant) or break the `sent ⇒ sent_message_id IS NOT NULL` invariant (which the §14.4 `support.draft.sent` event contract depends on for its `message_id` field). The current shape preserves both invariants: `manually_marked_sent` is the operator's confirmed answer on the dispatch decision; `sent` always has a confirmed canonical message linked back; the `support.draft.sent` event always has a non-null `message_id`.

### 8.6 Manual collision override (brief §5.4)

A platform user with the appropriate permission may override an `human_collision_blocked` preflight failure from the human review UI. Override:

1. Requires `assertScope(principal, 'support.draft.override_collision')` (new permission key, registered in `actionRegistry` per existing pattern).
2. Writes an audit-event row (`auditEvents` table, action `support.draft.collision_override`) recording: who, when, draft ID, the original collision-window state at preflight, and the operator's optional note.
3. Re-runs phase 1 with the collision check skipped, then proceeds to phase 2 → phase 3 normally.
4. The original `support.ticket.human_collision_blocked` log code from the original preflight remains queryable in audit history.

Override is **never available to autonomous agent execution** — it is a UX path on the human review surface only. The dispatch service refuses `override_collision=true` if the caller is an agent run (the agent's principal context has no human user ID).

### 8.7 Mid-build crash recovery

Two crash-recovery paths exist:

1. **Crash between phase 2 commit and phase 3 launch.** On boot, the reconciliation worker scans drafts in `dispatching` whose `dispatching_started_at < NOW() - boot_delay` (default 60s). Each is transitioned to `needs_reconciliation` and enqueued. The reconciler's primary signal (does a confirmed message with this `source_draft_id` exist?) handles the case where the adapter call DID land before crash; the secondary signal handles the case where it did not.
2. **Crash mid phase 3.** Same path. The dispatch service sets `dispatching_started_at` in phase 2 specifically so a stale `dispatching` row is detectable.

The boot scan is implemented as a one-shot job at server start; it runs idempotently regardless of how many app processes restart.

## 9. Skill surface

The Support Agent (separate brief) consumes the canonical layer through these skills. Each skill is registered in `actionRegistry`, has a markdown definition under `server/skills/support/`, and operates entirely against canonical reads + the dispatch service. **No skill calls a provider adapter directly**; the adapter is a downstream of `support.approve_draft` only.

| Skill | Returns / does | Read or write |
|---|---|---|
| `support.list_open_tickets` | Tickets in the inbox(es) the agent is configured for, filtered by status visibility per §5.1.A | Read only — `canonical_tickets` |
| `support.read_thread` | Confirmed messages for one ticket, ordered by `(created_at_external ASC, id ASC)` per §5.2.A | Read only — `canonical_ticket_messages` (NEVER `canonical_ticket_drafts`; §5.2.B audience boundary) |
| `support.propose_reply` | Writes a `canonical_ticket_drafts` row with `proposed_visibility='public'`. In autonomous mode auto-approves and triggers the §8 dispatch pipeline; in assisted mode stops at `awaiting_review`. | Write — `canonical_ticket_drafts` |
| `support.add_internal_note` | Same draft-then-send path with `proposed_visibility='internal'`. Internal notes are eligible on `pending_internal` even when public reply is not. | Write — `canonical_ticket_drafts` |
| `support.approve_draft` | Operator (or autonomous) approval. Triggers §8 phase 1 → 2 → 3. Never writes `canonical_ticket_messages` directly — that path is reserved for ingestion (brief §5.5). | Write — transitions draft + (post-confirmation) inserts `canonical_ticket_messages` |
| `support.reject_draft` | Marks the draft `rejected` with reviewer + reason. | Write — `canonical_ticket_drafts` |
| `support.set_status` | Issues a status change via the adapter (`updateTicket`). Idempotent per §14.1 (the in-place-mutation idempotency-key derivation includes the target status). | Write through adapter |
| `support.assign` | Issues an assignment change via the adapter. Same idempotency posture. | Write through adapter |
| `support.tag` | Issues a tag mutation (add/remove) via the adapter. Same idempotency posture. | Write through adapter |
| `support.find_customer_history` | Joins `canonical_contacts` → `canonical_tickets` + `canonical_revenue` + `canonical_accounts` (existing canonical CRM tables). Returns the customer's full surface across CRM and support. | Read only — multi-table join under one tenant context |

Each skill is a markdown file in `server/skills/support/` following the existing convention. The markdown defines:

- Trigger predicate (when the agent should call this skill).
- Inputs (typed shape).
- Outputs (typed shape).
- Side-effect contract (what state changes, what events emit).
- Pre-conditions (what the agent must have already done).

Skill registration adds a typed entry to `actionRegistry` with the new `'support.*'` action group. Per the `accepted_primitives` block in `docs/spec-context.md`, skills do not get new service layers when existing primitives fit — the dispatch service (§8) is the single new service, and it is only one because the three-phase + reconciliation invariant is genuinely new.

### Permission keys introduced

- `support.draft.approve` — can press Approve on a draft. **Also gates the Edit action** on the draft review queue (`POST /api/support/drafts/:id/edit`): editing the proposed body before approving is a mutation toward approve and shares the approve key. **Also gates the manual-resolve `mark_sent` and `retry_reconciliation` sub-actions** on `POST /api/support/drafts/:id/manual-resolve` (§8.5) — both are operator confirmations on the dispatch path. Inbox-scoped via `canonical_inboxes.agent_config` (an inbox in `mode='disabled'` blocks even admins from approving).
- `support.draft.reject` — can press Reject. **Also gates the manual-resolve `mark_failed` sub-action** on `POST /api/support/drafts/:id/manual-resolve` (§8.5).
- `support.draft.override_collision` — can override `human_collision_blocked` (§8.6). Strictly stronger than `support.draft.approve`.
- `support.inbox.configure` — can edit `canonical_inboxes.agent_config`.

Permissions register in the existing `permission_sets` system (not a new system). Defaults: org admins get all four; sub-account admins get the three operator keys; regular users get none.

## 10. UI surfaces

The five hi-fi prototypes at `prototypes/support-desk-canonical/` are the **design source of truth** for this spec. Phase 2 implementation re-uses primitives from the `consolidation-foundation` build (PR #270): `PageShell`, `Drawer`, `Modal`, `SortableTable`, `FormFooter`, `SearchBox`, `EmptyState`, `ErrorState`. Layout, chrome, badges, and pill systems already exist; this spec adds support-domain content inside that frame.

| Prototype | Implements as | Notes |
|---|---|---|
| `prototypes/support-desk-canonical/integration-setup.html` | `client/src/pages/integrations/SupportDeskSetupPage.tsx` (or extension to existing connection-setup wizard) | Three-step wizard: connect (OAuth tab + API-key tab), choose inboxes (multi-select with toggle-all), confirm (backfill window radio + summary). Success state shows `running | degraded | failed` sync-health pill (brief §5.12). |
| `prototypes/support-desk-canonical/tickets-list.html` | `client/src/pages/support/TicketsListPage.tsx` | Five default-visible status filters (`open`, `pending_internal`, `waiting_on_customer`, `resolved`, `closed`) plus a distinct `quarantined` filter for `unknown_provider_status` (brief §6.1 UI filter semantics — never folded into "Actionable"). Inbox filter pills. Inline quarantine banner if any quarantined tickets exist. Sync-health indicator at top when underlying connector is degraded. |
| `prototypes/support-desk-canonical/ticket-detail.html` | `client/src/pages/support/TicketDetailPage.tsx` | Three-panel layout. Thread reads via `supportTicketService.readThreadForHumanUi()` — confirmed messages + `dispatching` / `needs_reconciliation` draft overlay (visually distinct, labelled "pending send" / "reconciling" per §5.2.B). Right rail surfaces customer identity (name, CRM contact link if matched, account if matched), recent tickets, and CRM revenue summary via `support.find_customer_history`. |
| `prototypes/support-desk-canonical/draft-review.html` | `client/src/pages/support/DraftReviewQueue.tsx` | Split-pane: list of `awaiting_review` and `needs_reconciliation` drafts; right detail shows proposed reply, provenance block, pre-send policy checks, and the action set (Approve / Edit / Reject / Override-collision when blocked). Per brief §5.12, `needs_reconciliation` drafts are explicitly surfaced (NOT silently retried in the background); reconciliation status visible inline. |
| `prototypes/support-desk-canonical/inbox-config.html` | `client/src/pages/support/InboxConfigPage.tsx` | Per-inbox config: mode radio (autonomous / assisted / disabled), collision-window controls, draft-expiry inputs, advanced collapsed section for model + prompt overrides. Save bar with dirty state. Provider connection-health status inline alongside each inbox row (brief §5.12). |

### Ticket-list UI filter semantics (brief §6.1, locked)

Per the brief lock, the UI does not invent a combined "Actionable" label that aggregates `open` + `pending_internal`. v1 ships **option B** from the brief: "Needs attention" filter spans `open` + `pending_internal` (a human-attention queue, NOT an autonomous-eligibility queue). `pending_internal` is also accessible as a discrete filter pill alongside.

Quarantined tickets (`unknown_provider_status`) are always a distinct filter and a distinct pill, never folded into "Needs attention" or any aggregate count.

### Draft review queue — surfacing rules

- `awaiting_review` — the standard queue. Approve / Edit / Reject visible.
- `needs_reconciliation` — same list, distinct visual treatment ("Reconciling" badge + reconciliation status + last-reconciliation timestamp). Approve / Reject NOT visible (the dispatch is in flight); only "Mark provider send as verified" / "Mark as failed in provider" / "Retry reconciliation" visible per §8.5.
- `manually_marked_sent` — surfaced separately with a "Verified by operator, awaiting back-link" label until the back-link routine resolves to terminal `sent`. Operator can re-open the ticket in Teamwork to confirm; no further actions visible (the operator already made their decision).
- Drafts in `dispatching` for less than 30 seconds are NOT shown (avoids flashing). Once they cross the threshold without resolving, they appear under the same `needs_reconciliation` treatment with a "still dispatching…" sub-label.

### Operational state surfaces (brief §5.12)

The structured-log codes from §5.10 are the signal; the UI surfaces map per the brief:

| Code | UI surface | Treatment |
|---|---|---|
| `support.status.unknown_provider_status` | Tickets list inline banner (top of list) + quarantined filter pill count | Action: "Show quarantined tickets" / "Map this status" (admin only — out of scope v1, links to ops surface) |
| `support.ingest.duplicate_collapsed` | Logs only | Operator does not see |
| `support.action.retry_idempotent` | Logs only | Operator does not see |
| `support.action.provider_conflict` | Draft review queue — surfaces the affected draft with "Conflict detected, refresh ticket" | Operator action: refresh ticket, decide whether to re-issue |
| `support.attachment.resolve_failed` | Ticket detail — message attachment shows "Couldn't load — retry" | Inline retry button |
| `support.ticket.human_collision_blocked` | Draft review queue — affected draft shows red collision callout with override action (if permission held) | Per §8.6 |
| `support.ingest.contact_unmatched` | Ticket detail right rail — shows "Customer not in CRM" | Surface: link to "Match to existing contact" (out of scope v1 — Phase 2 deferred) |
| `support.provider.rate_limited` | Connection setup success page sync-health pill turns yellow / "degraded" | Tooltip explains rate limit |
| `support.provider.poll_page_failed` | Same — sync-health pill yellow / red | Detail shown in connection setup |
| `support.provider.webhook_unmapped_event` | Logs only (engineering signal) | Operator does not see |

### Frontend design principles re-check

The design checklist in `docs/frontend-design-principles.md` is the bar. The mockups already passed a Round 1 design review (mockup-log.md) including:

- Start with task, not data model — yes (each screen is task-focused).
- Default to hidden — yes (no KPI dashboards, no aggregate charts, raw IDs only on hover).
- One primary action per screen — yes (Setup: Start sync. Tickets list: browse-only. Ticket detail: action bar. Draft review: Approve. Inbox config: Save changes).
- Inline state — yes (status dots on tickets, SLA inline, dispatching spinner, collision callout inline).
- Re-check pass — yes per mockup log.

Phase 2 build retains these properties. The provenance block on the draft review screen surfaces internal IDs (model version, prompt version, agent run ID, idempotency key) — this is the documented "safety-critical information-dense screens" exception (HITL review gate), not a default monitoring view.

### Access control on UI

- Tickets list, ticket detail, draft review queue: gated by org membership + sub-account scope. Read access does not require a permission key.
- Approve / Reject / Edit on the draft review queue: requires `support.draft.approve` / `support.draft.reject`.
- Manual-resolve actions on `needs_reconciliation` drafts: "Mark provider send as verified" and "Retry reconciliation" require `support.draft.approve`; "Mark as failed in provider" requires `support.draft.reject` (per §9).
- Override-collision: requires `support.draft.override_collision`. Visually hidden (NOT disabled) for users without it (per `docs/frontend-design-principles.md` § Admin-only controls).
- Inbox config edit: requires `support.inbox.configure`. Read-only for everyone else.

## 11. Contracts

Per spec-authoring-checklist §3, every data shape that crosses a service boundary or is consumed by a parser is pinned here with a worked example.

### 11.1 `SupportCanonicalStatus` — closed enum (TypeScript union)

- **Type**: TypeScript union, also stored as `text` with CHECK constraint at the DB layer.
- **Values**: `'open' | 'pending_internal' | 'waiting_on_customer' | 'resolved' | 'closed' | 'unknown_provider_status'`.
- **Producer**: every adapter (via its status-map function), the dispatch service (when it observes provider state), and ingestion paths.
- **Consumer**: `support.list_open_tickets` filter, `supportTicketService.applyStatusChange`, every UI that renders a status badge.
- **Source-of-truth precedence** (per spec-authoring-checklist §3): provider observation wins on ingestion. The dispatch service may issue a status change but the canonical row is updated only after the adapter confirms (i.e. the next ingestion cycle observes the change and reconciles). If the application optimistically updates and the next observation contradicts, the observation wins.
- **Example**: `'open'`, `'unknown_provider_status'` (paired with `external_metadata.provider_status_raw = 'OnHoldByEngineering'`).

### 11.2 `SupportStatusMap` — adapter status-mapping data structure

- **Type**: `Record<string, Exclude<SupportCanonicalStatus, 'unknown_provider_status'>>`.
- **Producer**: each adapter (one per provider). Teamwork's lives at `server/adapters/teamwork/teamworkSupportStatusMap.ts`.
- **Consumer**: `mapTeamworkStatus()` and similar pure mapping functions. Tested with a fixture matrix.
- **Nullability**: keys are case-insensitive (the mapping function lowercases input). NULL or empty input → `'unknown_provider_status'`.
- **Example** (Teamwork v1, partial — full inventory in OQ-2):
  ```ts
  {
    'active': 'open',
    'open': 'open',
    'pending': 'pending_internal',
    'waiting_on_customer': 'waiting_on_customer',
    'solved': 'resolved',
    'closed': 'closed',
  }
  ```

### 11.3 `CanonicalTicketData` — adapter ingestion → canonical write

- **Type**: TypeScript interface (declared in §6).
- **Producer**: adapter `fetchTickets()` and webhook `normaliseEvent()`.
- **Consumer**: `connectorPollingService` Phase C upserter, `webhookAdapterService` ticket-event handler.
- **Source-of-truth precedence**: provider data wins on every field except `canonical_contact_id`, which is computed at the canonical layer (see §11.6).
- **Example** (one Teamwork ticket landing via webhook):
  ```json
  {
    "externalId": "147823",
    "inboxExternalId": "9",
    "customerEmail": "ops@acme.com",
    "customerName": "Sarah Park",
    "customerExternalId": "1023",
    "subject": "API rate limits — clarification needed",
    "status": "open",
    "priority": "high",
    "assigneeAgentExternalId": "47",
    "tags": ["billing", "rate-limit"],
    "category": null,
    "sourceChannel": "email",
    "openedAt": "2026-05-09T08:14:22Z",
    "firstResponseAt": null,
    "lastCustomerMessageAt": "2026-05-09T08:14:22Z",
    "lastAgentMessageAt": null,
    "closedAt": null,
    "resolutionAt": null,
    "slaDueAt": "2026-05-09T16:14:22Z",
    "slaBreached": false,
    "slaPolicyExternalId": "sla-billing-2h",
    "externalMetadata": { "department": "billing", "thread_count": 1 }
  }
  ```

### 11.4 `CanonicalTicketMessageData` — adapter ingestion → canonical write

- **Type**: TypeScript interface (declared in §6).
- **Producer**: adapter `fetchTicketMessages()`, webhook `normaliseEvent()` for `ticket.reply.*` / `ticket.note.*` events, dispatch service post-confirmation insert.
- **Consumer**: `canonical_ticket_messages` upserter; `support.read_thread`; ticket detail UI.
- **Source-of-truth precedence**: provider observation wins for body, attachments, and timestamps. `source_draft_id` is set only by (a) the dispatch service at sync-confirm insert, (b) the reconciliation worker after a `needs_reconciliation` resolution, or (c) the post-upsert back-link routine described in §8.5 (invoked by the message-upsert path but executing the same pure decision module as the reconciliation worker, with no draft state transition). Raw ingestion never sets `source_draft_id` on its own — every back-link goes through the same pure module so the writer set is bounded. Webhook delivery for a message we already inserted via dispatch confirmation is a deterministic no-op.
- **Example** (a confirmed bot reply, inserted via dispatch):
  ```json
  {
    "externalId": "thread-9821",
    "ticketExternalId": "147823",
    "direction": "outbound",
    "visibility": "public",
    "authorType": "bot",
    "authorExternalId": "47",
    "bodyText": "Thanks for reaching out. Our current rate limit is 60 req/min...",
    "bodyHtml": "<p>Thanks for reaching out...</p>",
    "attachments": [],
    "createdAtExternal": "2026-05-09T08:18:31Z",
    "externalMetadata": { "thread_seq": 4 }
  }
  ```

### 11.5 `SupportInboxAgentConfig` — JSONB shape on `canonical_inboxes.agent_config`

- **Type**: TypeScript interface, validated by Zod at every read+write boundary. Defined in `shared/types/supportInboxAgentConfig.ts`.
- **Producer**: `supportInboxService.updateAgentConfig()` — the inbox config UI.
- **Consumer**: `supportDraftDispatchService` (preflight check), `support.list_open_tickets` (mode filter), Support Agent execution path.
- **Versioned**: a `version: 1` field anchors the shape. Any field addition bumps the version + introduces a migration step (Phase 2).
- **Example**:
  ```json
  {
    "version": 1,
    "mode": "assisted",
    "collisionWindow": {
      "minMinutesSinceHumanActivity": 30,
      "respectHumanAssignee": true
    },
    "draftExpiry": {
      "awaitingReviewHours": 72,
      "draftHours": 24
    },
    "modelOverride": null,
    "promptOverride": null,
    "optIns": {
      "autonomousReplyOnWaitingOnCustomer": false,
      "postResolutionFollowUp": false
    }
  }
  ```

### 11.6 Customer-identity resolution result — internal contract

- **Type**: `{ canonicalContactId: string | null; emailMatchCount: 0 | 1 | 'multiple' }`.
- **Producer**: `supportContactResolutionPure.ts` (pure helper).
- **Consumer**: `connectorPollingService` Phase C ticket upsert, webhook ticket-event handler.
- **Rule**: `canonicalContactId` is set only when `emailMatchCount === 1`. The `multiple` case is logged via `support.ingest.contact_unmatched` (with a `reason: 'ambiguous_match'` field) and `canonicalContactId` is left null. **No auto-create path.**

### 11.7 `proposed_actions` JSONB on `canonical_ticket_drafts`

- **Type**: typed Zod schema.
- **Producer**: `support.propose_reply` skill (when the agent declares companion state changes).
- **Consumer**: `supportDraftDispatchService` after the message lands.
- **Shape**:
  ```ts
  {
    setStatus?: SupportCanonicalStatus;
    addTags?: string[];
    removeTags?: string[];
    setAssignee?: { agentExternalId: string } | null;  // null means unassign
  }
  ```
- **Example**:
  ```json
  { "setStatus": "waiting_on_customer", "addTags": ["billing"] }
  ```
- **Constraint**: `setStatus` must be one of `{ 'open', 'pending_internal', 'waiting_on_customer', 'resolved' }` only. Companion actions cannot transition a ticket to `closed` or to `unknown_provider_status` — the closure path requires explicit operator action.

### 11.8 Reconciliation decision contract

- **Type**: `type ReconciliationDecision = { kind: 'resolve_sent'; messageData: CanonicalTicketMessageData } | { kind: 'resolve_failed'; reason: string } | { kind: 'retry_after_ms'; ms: number } | { kind: 'surface_manual'; reason: string }`.
- **Producer**: `supportDraftReconciliationPure.decideOutcome(state)`.
- **Consumer**: `supportDraftReconciliationWorker`.
- **Pure-tested** with a fixture matrix.

### 11.9 `NormalisedEvent` extensions (existing primitive, brief §7)

The existing `NormalisedEvent` type already declares `entityType: 'ticket' | 'message'`. The dispatch service maps incoming Teamwork events using this primitive verbatim. New `eventType` values added by this spec:

- `ticket.assigned`
- `ticket.status_changed`

Both inherit `entityType: 'ticket'`. Brief §10 #11 plus §17 capability matrix.

### Source-of-truth precedence summary

When the same fact has multiple representations, this is the read order:

| Fact | Authoritative source | Caches that mirror it |
|---|---|---|
| Ticket status | provider (via ingestion) | `canonical_tickets.status` |
| Confirmed message text | provider (via ingestion or sync confirm) | `canonical_ticket_messages.body_text` |
| Pending outbound intent | `canonical_ticket_drafts` | (none — drafts are not mirrored anywhere) |
| Idempotency state for a draft | `canonical_ticket_drafts.action_idempotency_key` + UNIQUE index | (none) |
| Customer identity match | computed at ingestion; persisted in `canonical_tickets.canonical_contact_id` | `canonical_contacts.email` is the keying source |
| Inbox agent config | `canonical_inboxes.agent_config` JSONB | (none — not cached anywhere; read fresh per dispatch) |

## 12. Permissions and RLS checklist

Per `docs/spec-authoring-checklist.md` §4, every new tenant-scoped table needs all four of: RLS policy in the same migration, manifest entry, route-level guard, and principal-scoped context for agent-execution-path reads. Each table here satisfies all four.

### `canonical_tickets` (migration 0309)

| Requirement | Implementation |
|---|---|
| RLS policy | `0309_canonical_tickets.sql` includes `ALTER TABLE canonical_tickets ENABLE ROW LEVEL SECURITY; ALTER TABLE canonical_tickets FORCE ROW LEVEL SECURITY;` plus `CREATE POLICY canonical_tickets_org_isolation ON canonical_tickets USING (organisation_id::text = current_setting('app.organisation_id', true))` |
| Manifest entry | Added to `RLS_PROTECTED_TABLES` in `server/config/rlsProtectedTables.ts` in the same commit |
| Route-level guard | `authenticate` + org-scoped reads on all `/api/support/tickets/*` routes. Read access does not require a permission key (per §10 access control); the org membership check plus RLS is the boundary. Mutating routes inherit the §9 permission keys. |
| Principal-scoped context | Agent reads go through `withPrincipalContext` + `getOrgScopedDb` in `supportTicketService` |

### `canonical_ticket_messages` (migration 0310)

| Requirement | Implementation |
|---|---|
| RLS policy | `0310_canonical_ticket_messages.sql` — same shape on the denormalised `organisation_id`; FORCE RLS |
| Manifest entry | `RLS_PROTECTED_TABLES` updated in same commit |
| Route-level guard | Same as tickets — reads only via `/api/support/tickets/:id/thread` |
| Principal-scoped context | `supportTicketService.readThreadForAgent` / `readThreadForHumanUi` both run under principal context |

### `canonical_inboxes` (migration 0307)

| Requirement | Implementation |
|---|---|
| RLS policy | `0307_canonical_inboxes.sql` — FORCE RLS on `organisation_id` |
| Manifest entry | `RLS_PROTECTED_TABLES` updated |
| Route-level guard | `requirePermission('support.inbox.configure')` on PATCH; read accessible to org members |
| Principal-scoped context | `supportInboxService` runs under principal context for both reads and writes |

### `canonical_support_agents` (migration 0308)

| Requirement | Implementation |
|---|---|
| RLS policy | `0308_canonical_support_agents.sql` — FORCE RLS on `organisation_id` |
| Manifest entry | `RLS_PROTECTED_TABLES` updated |
| Route-level guard | Read-only — no public mutation API in v1; the table is populated by ingestion only |
| Principal-scoped context | Read in service-layer joins under principal context |

### `canonical_ticket_drafts` (migration 0311)

| Requirement | Implementation |
|---|---|
| RLS policy | `0311_canonical_ticket_drafts.sql` — FORCE RLS on `organisation_id` |
| Manifest entry | `RLS_PROTECTED_TABLES` updated |
| Route-level guard | `authenticate` plus per-route permission keys per §9 + §18 (approve/edit/manual-resolve `mark_sent`/`retry_reconciliation` → `support.draft.approve`; reject/manual-resolve `mark_failed` → `support.draft.reject`; override-collision body field → `support.draft.override_collision`). The `/manual-resolve` route additionally performs sub-action-level permission enforcement after authentication so that the wrong key cannot pass through into a privileged sub-action. Read access for ticket viewers (the draft overlay path) requires only `authenticate` + org-scoped membership. |
| Principal-scoped context | `supportDraftDispatchService` runs under principal context for the human-triggered path; runs under agent-run principal for the autonomous path |

### Cross-tenant invariant — denormalised `organisation_id`

Every child table (`canonical_ticket_messages`, `canonical_ticket_drafts`) carries `organisation_id` as a column, not as a join. This means:

- The RLS policy filters at the table level without needing a JOIN to `canonical_tickets`.
- A planner mistake that forgets the join cannot leak rows because the row itself is hidden.
- The denormalisation is enforced by an FK-coupled trigger or by the upsert-path code (the polling service + dispatch service both already hold `organisation_id` from the connector context). Phase 2 chooses one; the spec mandates either is acceptable.

The CI gate `verify-rls-coverage.sh` fails if any of the five new tables is missing from `RLS_PROTECTED_TABLES`. The CI gate `verify-rls-contract-compliance.sh` fails if any new code under `server/services/` reads from these tables outside `getOrgScopedDb` / `withOrgTx`.

## 13. Execution model

Per spec-authoring-checklist §5, every behaviour that crosses a transactional or latency boundary picks one model explicitly.

### Ingestion path (poll)

- **Model**: Queued / asynchronous (existing `connectorPollingService` runs scheduled jobs).
- **Idempotency table**: existing `connector_configs` carries the cursor; existing dedupe via unique indexes.
- **Why**: ingestion is decoupled from end-user requests. The polling cycle runs on the scheduler regardless of UI activity.
- **No new infrastructure**: brief §8.3 — Teamwork's new `ingestion` methods plug into the existing service.

### Ingestion path (webhook)

- **Model**: Inline within the webhook request handler, with the dispatcher providing per-event dedupe.
- **Why**: webhooks are externally triggered; the response status is the provider's signal that we received it. Asynchronous handoff is a `webhookAdapterService` internal detail; the request handler is synchronous from the caller's perspective.
- **Idempotency**: existing `webhook_events` dedupe on `external_event_id`.

### Read paths (canonical reads from skills + UI)

- **Model**: Inline / synchronous via `getOrgScopedDb`.
- **Why**: every read is principal-scoped and the result must be available before the caller returns.
- **No caching layer**: canonical is the cache for the provider. Phase 2 may add memoisation per-request if profiling shows hot paths, but no inter-request cache.

### Outbound dispatch — three-phase

- **Phase 1 (preflight)**: inline / synchronous in the dispatch service.
- **Phase 2 (durable transition)**: inline / synchronous, single Postgres transaction.
- **Phase 3 (adapter call)**: inline / synchronous from the dispatch service's perspective. The adapter call itself is an HTTP request with a 12-second timeout (existing `TIMEOUT_MS` in `teamworkAdapter`).
- **Why inline?**: phase 2 + phase 3 must share a stable idempotency key, and the operator UI expects a result within seconds. Long retries delegate to the reconciliation worker (next).

### Reconciliation worker

- **Model**: Queued / asynchronous via pg-boss + `createWorker`.
- **Idempotency table**: `canonical_ticket_drafts.action_idempotency_key` UNIQUE constraint guards against duplicate dispatch attempts. Worker retries are idempotent because the key is already locked at the row level (the draft is in `needs_reconciliation`; only this worker transitions it).
- **Why**: reconciliation is decoupled from the operator request. The dispatch service returns to the caller once the draft is in `dispatching` or `needs_reconciliation`; the worker drives the resolution.
- **Queue name**: `support-draft-reconciliation` (a new queue; ensures no cross-queue scheduling collisions per the `subaccount-optimiser` lesson).

### Boot recovery

- **Model**: One-shot job at server start (synchronous startup task).
- **Job**: scan `canonical_ticket_drafts` for `dispatching` rows whose `dispatching_started_at < NOW() - 60s`; transition each to `needs_reconciliation` and enqueue the reconciliation worker.
- **Why**: a process restart between phase 2 and phase 3 leaves the draft in `dispatching` indefinitely without this. Brief §8.7.

### Sync-health classification job

- **Model**: Queued (extension to existing polling cycle, not a separate job).
- **Output**: `connector_configs.sync_status` (existing column or new — Phase 2 confirms) + `last_successful_sync_at`. Read by the UI sync-health pill.
- **Why**: piggybacks on the existing poll cycle; no new schedule.

### Cache discipline

- **No prompt-cache partitions added** by this spec. Skill registrations follow the existing `actionRegistry` shape; the agent's prompt assembly is the consumer's concern.
- **No memoisation** of canonical reads except per-request (Phase 2 may add).
- **External_metadata JSONB** is read in full where needed. v1 does not project a partial JSONB shape.

### Consistency check (per spec-authoring-checklist §5)

- All adapter ingestion methods are part of an asynchronous polling cycle; the spec does NOT describe them as "synchronous service calls".
- Dispatch is synchronous within phase 1+2+3; reconciliation is the asynchronous fallback. The spec does NOT claim phase 3 is "fire-and-forget".
- Webhook handling is inline at the request boundary but enqueues no separate jobs; the dispatcher invokes ingestion handlers in-process.
- No non-functional claims (cache efficiency, latency budget) contradict any of the above.

## 14. Execution-safety contracts

Per spec-authoring-checklist §10. The dispatch path is the highest-stakes write in this spec; the safety contracts here are non-negotiable.

### 14.1 Idempotency posture

| Write path | Posture | Mechanism |
|---|---|---|
| `canonical_tickets` upsert from ingestion | **key-based** | UNIQUE index on `(connector_config_id, external_id)`. Re-ingestion is a deterministic update. |
| `canonical_ticket_messages` upsert from ingestion | **key-based** | UNIQUE index on `(connector_config_id, ticket_external_id, external_id)`. |
| `canonical_inboxes` / `canonical_support_agents` upsert from ingestion | **key-based** | UNIQUE index on `(connector_config_id, external_id)` per table. |
| `canonical_ticket_drafts` insert (skill `support.propose_reply`) | **state-based (bounded by partial UNIQUE)** | A same-run double-proposal — same `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility)` while the prior draft is still in `draft` or `awaiting_review` — is bounded by the partial UNIQUE index on those columns (§5.5 indexes). The dispatch service writes the new draft and supersedes the prior pre-dispatch draft to `superseded` in the same transaction, which keeps the review queue free of agent-retry-induced sibling drafts. Cross-run double-proposals (different agent run IDs) remain operator-visible — the operator acts on one and rejects the other; this is rare and intended (different reasoning passes deserve operator judgement). |
| Dispatch transition from `awaiting_review`/`draft` → `dispatching` | **state-based** | `UPDATE … WHERE status IN ('draft','awaiting_review')` — 0 rows affected = already dispatched (concurrency guard). |
| Adapter `addReply` / `addInternalNote` call | **key-based** | `action_idempotency_key` derived deterministically from `(connector_config_id, ticket_id, action_type, draft_id)` for sends. For native-idempotent providers (Teamwork — TBD per OQ-3), the key is forwarded as a header. For non-native providers, a local `action_attempts` ledger keyed on `(connector_config_id, action_idempotency_key)` provides the same guarantee. |
| Adapter in-place mutation (`updateTicket` for status / assignment / tag changes via `support.set_status`/`assign`/`tag`) | **key-based** | Idempotency key derived from `(connector_config_id, ticket_id, action_type, deterministic_payload_hash)`. Same payload + same target = same key. Repeating the call is a no-op or deterministic update. |

The `action_attempts` local ledger (introduced in Phase 2 chunk C7 if needed):

| Column | Purpose |
|---|---|
| `id` | PK |
| `organisation_id`, `connector_config_id` | scoping |
| `idempotency_key` | the §14.1 derived key (UNIQUE within `connector_config_id`) |
| `action_type` | `'reply' | 'internal_note' | 'status_change' | 'assignment_change' | 'tag_change'` |
| `attempt_status` | `'in_flight' | 'succeeded' | 'failed'` |
| `attempted_at`, `succeeded_at`, `provider_response_id` | timestamps + provider's reply ID once known |

The ledger is RLS-protected on `organisation_id` and added to `RLS_PROTECTED_TABLES` if it lands. **Open question OQ-3** confirms whether Teamwork supports a native idempotency mechanism; the answer determines whether this ledger ships.

### 14.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| Adapter HTTP call (any) | **guarded** | The `action_idempotency_key` + `withBackoff` provide the boundary. Retryable codes (`429`, `5xx`, timeout) are retried up to `maxAttempts=3` within a single dispatch attempt; further failures route the draft to `needs_reconciliation`. |
| Dispatch service phase 2 | **safe** (DB transaction is atomic) | The `UPDATE … WHERE status IN (...)` form is naturally idempotent. |
| Reconciliation worker per attempt | **guarded** | The worker reads provider state before deciding; the decision module is pure. |
| Webhook event handler | **safe** | The `external_event_id` dedupe at the dispatcher is the boundary. |
| Polling cycle phase A/B/C/D | **safe** | UNIQUE indexes + upsert form ensure replay safety. |
| `support.list_open_tickets` etc. | **safe** | Read-only. |
| `support.propose_reply` | **guarded / state-based** | Same-run duplicate proposals are bounded by the partial UNIQUE index on `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')` plus the §5.5 + §14.1 same-transaction supersede-then-insert order. A retry within the same agent run produces a deterministic supersession of the prior pre-dispatch draft, not a sibling row. Cross-run duplicate proposals (different `agent_run_id`) remain operator-visible by design — different reasoning passes deserve operator judgement. |

### 14.3 Concurrency guards

| Race | Guard |
|---|---|
| Two operators approve the same draft simultaneously | Phase 2 `UPDATE … WHERE status IN ('draft','awaiting_review')` — first commit wins; second sees 0 rows and reads back the in-flight `dispatching` state. **Returns the winning state to the losing caller** per spec-authoring-checklist §10.3. |
| Operator approves while reconciliation worker is processing | Reconciliation worker only operates on `needs_reconciliation`; operator approval only operates on `awaiting_review`/`draft`. They cannot collide on the same draft because the row has only one status at a time. |
| Two reconciliation workers process the same draft | `UPDATE canonical_ticket_drafts SET reconciliation_attempt_count=reconciliation_attempt_count+1, last_reconciliation_at=NOW() WHERE id=$1 AND status='needs_reconciliation' RETURNING *` — first worker locks; second sees stale state on the next read. The pg-boss queue itself prevents double-processing of the same job. |
| Webhook + sync-confirm both insert the same message | UNIQUE constraint on `(connector_config_id, ticket_external_id, external_id)` fires; the second insert maps to a no-op via `ON CONFLICT DO NOTHING` or a deterministic update. Per §15 we emit `support.ingest.duplicate_collapsed`. |
| Ingestion cycle Phase C and webhook event for the same ticket | Same UNIQUE constraint; deterministic update. |
| Duplicate `action_idempotency_key` (pathological retry) | UNIQUE index on `(connector_config_id, action_idempotency_key)` fires; mapped to HTTP 409 (§14.6). |

### 14.4 Terminal event guarantees

The dispatch path emits exactly one terminal event per draft lifecycle. Mutually exclusive paths:

| Path | Event emitted | `status` field | Terminal? |
|---|---|---|---|
| Sync-confirm success | `support.draft.sent` with `draft_id`, `message_id` (NOT NULL), `idempotency_key` | `success` | yes — terminal |
| Reconciliation resolves to sent | `support.draft.sent` (same shape; `message_id` NOT NULL) | `success` | yes — terminal |
| Back-link from `manually_marked_sent` resolves to sent | `support.draft.sent` (same shape; `message_id` NOT NULL — provided by the back-linked canonical message) | `success` | yes — terminal |
| Reconciliation resolves to failed | `support.draft.failed` with `reason` | `failed` | yes — terminal |
| Operator chooses "Mark as failed in provider" on §8.5 surface | `support.draft.failed` (same shape; `reason='operator_marked_failed'`) | `failed` | yes — terminal |
| Operator chooses "Mark provider send as verified" on §8.5 surface | `support.draft.manually_marked_sent` with `draft_id`, `idempotency_key`, `reviewer_user_id`, `reviewed_at` | `manually_marked_sent` | **no — non-terminal**; resolves to terminal `sent` when the back-link routine succeeds, at which point `support.draft.sent` fires |
| Operator rejects in queue | `support.draft.rejected` with reviewer | `rejected` | yes — terminal |
| Queue expiry | `support.draft.expired` | `expired` | yes — terminal |
| Newer draft for the same ticket replaces this one in a pre-dispatch state (including the §14.1 same-run soft-uniqueness path) | `support.draft.superseded` with `draft_id`, `superseded_by_draft_id` | `superseded` | yes — terminal |
| Reconciliation budget exhausted, surfaced for manual review | NO event emitted yet — operator action emits one. The operator's "Mark provider send as verified" / "Mark as failed in provider" / "Retry reconciliation" path emits the corresponding event. **No silent expiry of `needs_reconciliation`** — brief §5.8 second paragraph. | — | — |

The `support.draft.*` event codes above are dispatch-lifecycle events, distinct from the §15 operational observability codes. Both namespaces are pinned in `shared/types/supportObservability.ts` (the `SUPPORT_LOG_CODES` const is extended in §15 to cover both groups; see §15 emitter pattern).

**`support.draft.sent` invariant.** This event always carries a non-null `message_id`. The post-terminal prohibition for `sent` therefore guarantees a 1:1 mapping from terminal `sent` event to confirmed canonical message — consumers (audit replay, Foundry alignment loaders, KPI rollups) rely on this.

Post-terminal prohibition: once a draft is in `sent`, `failed`, `rejected`, `expired`, or `superseded`, **no further events with the same `draft_id` are emitted**. `manually_marked_sent` is non-terminal, so a draft in that state may still emit `support.draft.sent` later when the back-link succeeds (this is the only legitimate transition from a non-pre-dispatch state into a terminal state). Phase 2 includes a pure-tested invariant module asserting both rules.

### 14.5 No-silent-partial-success

The `proposed_actions` companion-mutations path (status/tags/assignee) can partially succeed: the message lands but the status change fails. This is treated as a `partial` outcome:

- A `partial` flag is added to the `support.draft.sent` event when companion mutations failed.
- Operator UI surfaces "Reply sent but status change failed" inline on the draft + on the ticket detail.
- `support.action.provider_conflict` log code (§15) emits with the failed mutation.
- No automatic retry of the companion mutation; the operator decides whether to re-issue.

Per spec-authoring-checklist §10.5, this is documented as a `partial` terminal — not a silent success. The conditions:
- `partial` fires when the message landed but at least one companion mutation failed.
- `failed` fires when the message itself failed to land.
- `success` fires only when the message AND every companion mutation succeeded.

### 14.6 Unique-constraint-to-HTTP mapping

| Constraint violated | HTTP status | Reason |
|---|---|---|
| `canonical_ticket_drafts (connector_config_id, action_idempotency_key)` | 409 Conflict — body includes the existing draft id and its current state | Caller pathologically reused an idempotency key; we return the in-flight draft |
| `canonical_ticket_messages (connector_config_id, ticket_external_id, external_id)` | Internal — `ON CONFLICT DO NOTHING` (no HTTP exposure; ingestion code handles it) | Webhook + sync convergence; this is expected |
| `canonical_tickets (connector_config_id, external_id)` | Internal — `ON CONFLICT DO UPDATE` (deterministic update) | Webhook + sync convergence |

No `23505` ever bubbles to the API consumer as a 500. Phase 2 tests confirm the mapping.

### 14.7 State machine closure (per spec-authoring-checklist §10.7)

`canonical_ticket_drafts.status` is a closed enum (§5.5). Valid transitions, forbidden transitions, and post-terminal prohibition are all asserted by the pure transition-guard module (`supportDraftDispatchServicePure.ts`) with a fixture matrix in Phase 2. Closed-enum invariants the guard enforces:

- `sent ⇒ sent_message_id IS NOT NULL` (always).
- `manually_marked_sent ⇒ sent_message_id IS NULL` (always — until the back-link transitions to `sent`).
- `manually_marked_sent` is the only non-terminal state that may transition into a terminal state without going back through a queue / dispatching cycle (it transitions to `sent` via the back-link routine in §8.5).
- Terminal states (`sent`, `failed`, `rejected`, `expired`, `superseded`) admit no further transitions.

`canonical_tickets.status` is a closed enum (§5.1.A). Valid transitions are asserted by `supportTicketServicePure.ts`. The transition matrix has one provider-driven escape valve: `unknown_provider_status → any_other` is permitted only when the inbound row contains a status value that does map. This handles the case where the operator (or Phase 2 mapping editor) added a new entry to the status map and the next ingestion cycle resolves the quarantined ticket.

`canonical_tickets.provider_deleted` is a separate boolean column (§5.1) that gates read visibility but does not participate in the status state machine. A deleted ticket retains its last-known `status` value; `provider_deleted=true` is the read-side filter, not a status transition.

Adding a status value to either enum requires a spec amendment (this spec) plus a coordinated DB CHECK constraint update.

## 15. Observability

Brief §5.10 reserves the v1 code list. Each code maps to an emitter and a (per §10) UI surface.

| Code | Emitted by | When | Required fields | UI surface (§10) |
|---|---|---|---|---|
| `support.status.unknown_provider_status` | ingestion path (poll + webhook) | adapter status-map returns `unknown_provider_status` | `organisation_id`, `connector_config_id`, `ticket_id`, `provider`, `provider_status_raw` | tickets list inline banner + quarantined filter pill |
| `support.ingest.duplicate_collapsed` | upsert path | UNIQUE constraint collapsed a webhook + sync-confirm or webhook + poll for the same row | `organisation_id`, `connector_config_id`, `ticket_id`, `event_type`, `external_id` | logs only |
| `support.action.retry_idempotent` | dispatch service / reconciliation worker | adapter retry executed using an existing `action_idempotency_key` (the message either landed or is pending) | `organisation_id`, `connector_config_id`, `ticket_id`, `draft_id`, `action_type`, `attempt_number` | logs only |
| `support.action.provider_conflict` | dispatch service | adapter returned `validation_error` on a write that suggests concurrent human edit (e.g. `409` from provider, or "ticket has changed since you read it") | `organisation_id`, `connector_config_id`, `ticket_id`, `draft_id`, `action_type`, `provider_response` | draft review queue inline conflict callout |
| `support.attachment.resolve_failed` | adapter `resolveAttachment` path | the resolver returned an error or an unusable URL | `organisation_id`, `connector_config_id`, `ticket_id`, `message_id`, `attachment_external_id`, `error_code` | ticket detail message inline retry chip |
| `support.ticket.human_collision_blocked` | dispatch preflight | collision-window check failed | `organisation_id`, `connector_config_id`, `ticket_id`, `draft_id`, `inbox_id`, `last_human_activity_at`, `min_minutes_required` | draft review queue red collision callout |
| `support.ingest.contact_unmatched` | ingestion path | inbound ticket has email with zero or ambiguous canonical-contact match | `organisation_id`, `connector_config_id`, `ticket_id`, `customer_email`, `match_count` | ticket detail right rail "Customer not in CRM" |
| `support.provider.rate_limited` | adapter call (any) | adapter received `429` | `organisation_id`, `connector_config_id`, `provider`, `endpoint`, `retry_after_ms` | sync-health pill on connection setup + tickets list |
| `support.provider.poll_page_failed` | polling cycle | a poll page errored | `organisation_id`, `connector_config_id`, `phase` (A/B/C/D), `inbox_external_id`, `error_code`, `partial` (boolean) | sync-health pill |
| `support.provider.webhook_unmapped_event` | webhook dispatcher | `mapTeamworkEventType` returned null | `organisation_id`, `connector_config_id`, `provider`, `raw_event_type` | logs only |
| `support.ticket.provider_deleted` | ingestion path (poll + webhook) | `ticket.deleted` webhook observed, OR a poll cycle proves a previously-known ticket is no longer returned | `organisation_id`, `connector_config_id`, `ticket_id`, `provider`, `deletion_source`, `deleted_at_external` | tickets list (deleted ticket disappears from agent queues; tombstone shown in human UI) |
| `support.ticket.restored_after_deletion` | ingestion path | a previously `provider_deleted=true` ticket reappears in provider state with the same `external_id` | `organisation_id`, `connector_config_id`, `ticket_id`, `provider` | tickets list (re-appears in agent queues; tombstone removed from human UI) |
| `support.message.redacted` | ingestion path | provider redaction event observed; canonical row's body content is overwritten in the same transaction | `organisation_id`, `connector_config_id`, `ticket_id`, `message_id`, `provider`, `redaction_reason` (where exposed) | ticket detail (redacted message shows tombstone "[content redacted on {date}]") |

### Emitter pattern

Each emit is a structured `logger.warn` call (or `logger.info` for non-warning codes like `duplicate_collapsed`) using a stable code constant. Codes are exported as a TypeScript const object from `shared/types/supportObservability.ts`:

```ts
export const SUPPORT_LOG_CODES = {
  // Operational observability (§15 emitters)
  STATUS_UNKNOWN_PROVIDER_STATUS: 'support.status.unknown_provider_status',
  INGEST_DUPLICATE_COLLAPSED: 'support.ingest.duplicate_collapsed',
  ACTION_RETRY_IDEMPOTENT: 'support.action.retry_idempotent',
  ACTION_PROVIDER_CONFLICT: 'support.action.provider_conflict',
  ATTACHMENT_RESOLVE_FAILED: 'support.attachment.resolve_failed',
  TICKET_HUMAN_COLLISION_BLOCKED: 'support.ticket.human_collision_blocked',
  INGEST_CONTACT_UNMATCHED: 'support.ingest.contact_unmatched',
  PROVIDER_RATE_LIMITED: 'support.provider.rate_limited',
  PROVIDER_POLL_PAGE_FAILED: 'support.provider.poll_page_failed',
  PROVIDER_WEBHOOK_UNMAPPED_EVENT: 'support.provider.webhook_unmapped_event',

  // Dispatch lifecycle events (§14.4 emitters)
  DRAFT_SENT: 'support.draft.sent',
  DRAFT_FAILED: 'support.draft.failed',
  DRAFT_REJECTED: 'support.draft.rejected',
  DRAFT_EXPIRED: 'support.draft.expired',
  DRAFT_SUPERSEDED: 'support.draft.superseded',
  DRAFT_MANUALLY_MARKED_SENT: 'support.draft.manually_marked_sent',  // non-terminal; resolves to DRAFT_SENT via back-link

  // Tombstone events (§5.1 + §5.2)
  TICKET_PROVIDER_DELETED: 'support.ticket.provider_deleted',
  TICKET_RESTORED_AFTER_DELETION: 'support.ticket.restored_after_deletion',
  MESSAGE_REDACTED: 'support.message.redacted',
} as const;
```

The CI gate `verify-audit-event-namespace.sh` (already enforces `auth.*`, `oauth.*`, etc.) is extended to require any new `support.*` code to be in this constant. Phase 2 task: extend the gate or document the existing gate covers it.

Brief §5.10 closing line: "This list is the floor, not the ceiling." Adding new codes is straightforward (extend the constant + extend the audit-namespace gate). Adding codes that change UI behaviour requires a spec amendment.

## 16. Phase sequencing — dependency graph

Single-PR build (no multi-phase release). Chunk-level dependency graph for `feature-coordinator`'s plan generation:

```
C1 (inboxes + agents schema) ──┐
                                │
C2 (tickets schema) ────────────┼─► C5 (adapter contract types)
                                │       │
C3 (messages schema) ───────────┘       │
                                        │
C4 (drafts schema) ─────────────────────┘
       │                                 │
       │                                 ▼
       │                     C6 (Teamwork ingestion impl + status map)
       │                                 │
       │                     C7 (Teamwork addInternalNote + resolveAttachment + idempotency)
       │                                 │
       │                                 ▼
       │             C8 (connectorPollingService extension — uses C6)
       │                                 │
       │                                 ▼
       │             C9 (webhook dispatcher extension — uses C5+C6)
       │                                 │
       │                                 ▼
       └────────►  C10 (read services — uses C1..C4 + C8 ingested data)
                                         │
                                         ▼
                          C11 (dispatch service — uses C7 + C10)
                                         │
                                         ▼
                          C12 (skill registrations — uses C10 + C11)
                                         │
                                         ▼
                          C13 (UI surfaces — uses C10 + C11 + C12)
                                         │
                                         ▼
                          C14 (operational state UI — extends C13)
                                         │
                                         ▼
                          C15 (docs + ADR + architecture.md doc-sync)
```

Every chunk's dependencies are at-or-earlier in the chunk order. No backward references. Per spec-authoring-checklist §6 the consistency check:

| Chunk | Schema introduced | Schema referenced from code | Verified |
|---|---|---|---|
| C1 | 0307, 0308 (inboxes, agents) | (uses orgs, connector_configs, subaccounts — all existing) | ✓ |
| C2 | 0309 (tickets — refs inboxes from C1, agents from C1, contacts existing) | C1 schema available | ✓ |
| C3 | 0310 (messages — refs tickets from C2, agents from C1, contacts existing) | C1+C2 schema available | ✓ |
| C4 | 0311 (drafts — refs tickets from C2, messages from C3, agent_runs existing) | C1..C3 schema available | ✓ |
| C5 | (no schema) | new types in `integrationAdapter.ts` reference SupportCanonicalStatus enum | self-contained |
| C6 | (no schema) | uses C5 types + C2 column shapes | ✓ |
| C7 | optional `action_attempts` table (subject to OQ-3) | uses C5 types + C4 column shapes | ✓ |
| C8 | (no schema, extension only) | reads C6 ingestion methods, writes C2/C3/C1 | ✓ |
| C9 | (no schema, extension only) | reads C6 webhook + dispatcher; writes C2/C3 | ✓ |
| C10 | (no schema, services only) | reads C1..C4 | ✓ |
| C11 | (no schema, services + worker) | reads/writes C4, calls C7 adapter, writes C3 on confirmation | ✓ |
| C12 | (no schema, skills only) | calls C10 + C11 | ✓ |
| C13 | (no schema, UI) | calls C10 + C11 via routes; reuses prototypes | ✓ |
| C14 | (no schema, UI) | extends C13 with state surfaces | ✓ |
| C15 | (no schema, docs) | references everything | ✓ |

No backward dependencies. No orphaned deferrals (every prose mention of a deferred item is in §19). No phase-boundary contradictions (all schema additions are in C1–C4 + optional C7; consumer chunks are at or after).

## 17. Teamwork v1 acceptance bar + capability matrix

### 17.1 Acceptance bar (brief §8.5, inherited verbatim)

Each is a binary, testable criterion. The PR is not merge-ready until all are demonstrated:

- [ ] One Teamwork connection ingests inboxes, support agents, tickets, and ticket messages into the canonical layer end-to-end on a real account.
- [ ] Webhook and polling paths converge on the same canonical rows, verified by manual smoke against a real Teamwork sandbox (replay the same event via webhook + poll cycle and confirm no duplicate-row insert) AND by the static gate `verify-rls-coverage.sh` plus the UNIQUE-index migrations from §5.1/§5.2 fixing the dedupe contract structurally. No vitest test of `connectorPollingService` or `webhookAdapterService` is required (per §20 testing posture).
- [ ] One draft can be dispatched safely through the §8 three-phase flow end-to-end, with the confirmed message reconciled into `canonical_ticket_messages` and linked back to the draft via `source_draft_id`.
- [ ] Attachment resolver returns a usable URL (or stream) for at least one real Teamwork attachment.
- [ ] An unmapped Teamwork status quarantines the ticket as `unknown_provider_status` and excludes it from agent-actionable queues; the original provider value is preserved in `external_metadata.provider_status_raw`; the `support.status.unknown_provider_status` log code fires.
- [ ] Action idempotency retry path is tested: simulated post-dispatch failure resumes via the same key without producing a duplicate customer-visible reply (the `(connector_config_id, action_idempotency_key)` UNIQUE constraint plus the reconciliation worker prevents duplicate insertion).
- [ ] All thirteen operational observability codes from §15 fire in their respective conditions (the ten original plus `support.ticket.provider_deleted`, `support.ticket.restored_after_deletion`, `support.message.redacted`), plus the six draft-lifecycle events from §14.4 (`support.draft.sent`, `support.draft.failed`, `support.draft.rejected`, `support.draft.expired`, `support.draft.superseded`, `support.draft.manually_marked_sent`).
- [ ] Manual collision override (§8.6) emits an audit event, requires `support.draft.override_collision`, and is unavailable to autonomous agent execution.
- [ ] Provider-side deletion: a Teamwork `ticket.deleted` event sets `provider_deleted=true`, hides the ticket from agent queues, and surfaces the tombstone in the human UI; subsequent ticket recreation with the same `external_id` clears the tombstone.
- [ ] Provider-side redaction (if Teamwork exposes a redaction surface — confirmed during C9): a redaction event nulls the canonical message body in the same transaction; agent reads see `'[redacted]'`; human UI surfaces the tombstone.

The acceptance bar is verified by **three named verification methods**, applied per code:

| Acceptance criterion | Verification method |
|---|---|
| End-to-end ingestion (inboxes / agents / tickets / messages) | Manual sandbox smoke against a real Teamwork connection (operator-driven). |
| Webhook + poll convergence (no duplicate-row insert) | Pure-function fixture for the upsert-decision boundary + manual smoke replaying the same event via both paths. |
| Three-phase dispatch end-to-end | Pure-function tests on transition guard + idempotency-key derivation + manual sandbox dispatch of one draft. |
| Attachment resolver returns usable URL/stream | Manual sandbox call with one real Teamwork attachment. |
| Status fail-closed quarantine + `unknown_provider_status` log code | Pure-function fixture covering the mapping function (every known value, NULL, unknown), plus pure-function test of the emit call site asserting the code constant + required fields fire. |
| Action idempotency retry path | Pure-function test on key derivation + manual sandbox simulated post-dispatch failure. |
| Operational observability codes fire | Per code: pure-function test on the emit call site (asserting code constant + required fields) + manual sandbox action where the trigger condition is reachable from the UI (e.g. collision-blocked is reachable from inbox config + draft approval). Codes only reachable via fixture injection (e.g. `webhook_unmapped_event`) are verified by fixture injection in the pure test. |
| Draft-lifecycle terminal events fire | Pure-function test on the emit call site for each terminal transition (`sent`, `failed`, `rejected`, `expired`, `superseded`, `manually_marked_sent`) asserting code constant + required fields. The `support.draft.sent` event is additionally asserted to always carry a non-null `message_id` per §14.4 invariant. |
| Manual collision override | Pure-function test on permission check + audit-event write; manual sandbox confirmation. |
| Tombstone (deletion + redaction) | Pure-function fixture for the deletion-upsert + read-filter decision boundaries + manual sandbox where reachable. |

No non-pure vitest tests of `connectorPollingService` / `webhookAdapterService` / route files are added (per §20 testing posture). Where a code's trigger requires non-pure plumbing (real provider webhook, polling cycle), the verification is manual smoke against the real Teamwork sandbox.

### 17.2 Capability matrix (brief §8.6, binary + testable)

Per the brief lock — every `yes` cell names the specific endpoint or webhook event; every `no` cell names the explicit fallback path. **Every named fallback must be exercised by either (a) a pure-function test or fixture for the decision boundary, or (b) the §17.1 manual smoke against a real Teamwork sandbox; a fallback with no exercising path is a spec gap and counts as `no` with no fallback.** Per §20 the project's testing posture rules out vitest tests of `connectorPollingService` / `webhookAdapterService` / route files, so "exercising" means pure-function fixture coverage where the fallback has a clean decision boundary and manual smoke otherwise.

The matrix below is provisional pending audit of Teamwork's current API surface (OQ-2 + OQ-4). Phase 2 confirms each row before C7 / C8 / C9 close. The cells marked `?` must resolve to either `yes:<endpoint>` or `no:<fallback>` before merge.

| Capability | Teamwork v1 | Canonical fallback when absent |
|---|---|---|
| Incremental ticket fetch (since cursor) | ?  (Teamwork Desk supports `?since=` on ticket endpoints — Phase 2 confirms exact param) | poll full window per inbox (default 7-day rolling) |
| Reply / message webhook event | yes — `ticket.reply.created` + `ticket.note.created` (existing) | poll messages for active tickets every poll cycle |
| Native action idempotency mechanism | ? (OQ-3) | local `action_attempts` ledger keyed by `(connector_config_id, action_idempotency_key)` UNIQUE |
| Fresh attachment URL on demand | ? (Teamwork attachment URLs are auth-scoped per audit) | adapter `resolveAttachment` streams bytes through our backend |
| Assignment change webhook | ? (Teamwork's webhook catalogue confirms during C9) | poll ticket header on cadence (every poll cycle in Phase C) |
| Status change webhook | ? | poll ticket header on cadence |
| Internal note distinct from public reply | yes — `tickets/{id}/threads.json` accepts `body` + a `note: true` flag (or separate notes endpoint — confirmed in C7) | adapter `addInternalNote` declined; UI hides internal-note action |

Every `?` row resolves to a concrete cell during Phase 2 spec-conformance: `yes:<endpoint>` (and fallback row stays as a defensive code path), or `no:<fallback>` (and the named fallback ships in the same chunk).

**`?` rows are acceptable at spec acceptance time** — only OQ-2 (status vocabulary inventory) is required to close before the spec moves to `Status: accepted` (per §22). The remaining matrix `?` rows are gated by OQ-3 (idempotency mechanism) and OQ-4 (attachment auth model), both of which legitimately close inside Phase 2 chunks (C7 in particular). A future reviewer should NOT block the spec on every `?` — the OQs are the closure path.

The capability matrix is the contract Zendesk + Freshdesk inherit when those adapters are written. Adding a new column requires evidence that the canonical layer can hide the difference behind a defensive read.

## 18. File inventory

Per spec-authoring-checklist §2 — every file/column/migration/service/route mentioned in prose appears here. This is the single source of truth.

### Migrations (new)

- `migrations/0307_canonical_inboxes.sql` — table + indexes + FORCE-RLS policy + manifest entry.
- `migrations/0307_canonical_inboxes.down.sql` — drop policy + drop table + idempotent.
- `migrations/0308_canonical_support_agents.sql` + down.
- `migrations/0309_canonical_tickets.sql` + down — includes CHECK constraint on `status` enum + tombstone columns (`provider_deleted`, `deleted_at_external`, `deleted_at_canonical`, `deletion_source` with CHECK on enum).
- `migrations/0310_canonical_ticket_messages.sql` + down — includes thread-ordering index, split author columns (`author_contact_id`, `author_support_agent_id`) with CHECK enforcing exactly-one-non-null per `author_type`, redaction columns (`redacted`, `redacted_at_external`, `redacted_at_canonical`), and `source_draft_id` as a plain nullable UUID **without** FK constraint (FK + partial index added in 0311).
- `migrations/0311_canonical_ticket_drafts.sql` + down — includes UNIQUE on `(connector_config_id, action_idempotency_key)` (partial WHERE not null), partial UNIQUE soft-uniqueness guard on `(organisation_id, ticket_id, created_by_agent_run_id, proposed_visibility) WHERE status IN ('draft','awaiting_review')`, CHECK enforcing `sent ⇒ sent_message_id IS NOT NULL` and `manually_marked_sent ⇒ sent_message_id IS NULL`. **Includes ALTER TABLE on `canonical_ticket_messages` adding the deferred FK from `source_draft_id` → `canonical_ticket_drafts.id` plus the partial index `(organisation_id, source_draft_id) WHERE source_draft_id IS NOT NULL`.**
- (conditional, OQ-3) `migrations/0312_action_attempts.sql` + down — IF native idempotency is unavailable.

### Schema files (new)

- `server/db/schema/canonicalInboxes.ts`
- `server/db/schema/canonicalSupportAgents.ts`
- `server/db/schema/canonicalTickets.ts`
- `server/db/schema/canonicalTicketMessages.ts`
- `server/db/schema/canonicalTicketDrafts.ts`
- (conditional) `server/db/schema/actionAttempts.ts`

### Manifest update

- `server/config/rlsProtectedTables.ts` — add 5 entries (or 6 if `action_attempts` lands), each citing its policy migration.

### Adapter layer

- `server/adapters/integrationAdapter.ts` — extend interface (new types: `CanonicalInboxData`, `CanonicalSupportAgentData`, `CanonicalTicketData`, `CanonicalTicketMessageData`, `SupportCanonicalStatus`, `SupportStatusMap`; extend `ticketing` group: `addInternalNote`, `resolveAttachment`; extend `ingestion` group: `listInboxes`, `listSupportAgents`, `fetchTickets`, `fetchTicketMessages`).
- `server/adapters/teamworkAdapter.ts` — extend with all the above for the Teamwork provider; broaden `mapTicketStatus` (or replace with `mapTeamworkStatus` from the new module).
- `server/adapters/teamwork/teamworkSupportStatusMap.ts` (new) — pure mapping data + function.
- `server/adapters/teamwork/teamworkSupportStatusMap.test.ts` (new) — fixture matrix.
- `server/adapters/teamworkAdapter.ts` — extend `mapTeamworkEventType` to handle `ticket.assigned`, `ticket.status_changed`.

### Services (new)

- `server/services/supportTicketService.ts` — read-only canonical reads + thread assembly (`readThreadForAgent`, `readThreadForHumanUi`, `getTicket`, `listOpenTickets`, `applyStatusChange`).
- `server/services/supportTicketServicePure.ts` — pure transition-guard for `canonical_tickets.status`.
- `server/services/supportInboxService.ts` — config CRUD with Zod-validated `agent_config` writes; `listInboxes`, `getInbox`, `updateAgentConfig`.
- `server/services/supportDraftDispatchService.ts` — three-phase dispatch + boot recovery scan + manual collision override.
- `server/services/supportDraftDispatchServicePure.ts` — pure transition guard for `canonical_ticket_drafts.status` + idempotency-key derivation.
- `server/services/supportDraftReconciliationPure.ts` — pure decision module for `needs_reconciliation` outcome.
- `server/services/supportContactResolutionPure.ts` — pure email-match resolver.
- `server/services/__tests__/supportDraftDispatchService.test.ts` — pure transition-guard tests + idempotency-key derivation tests + same-run supersession transaction-order test (per §14.1 the UPDATE-then-INSERT order is load-bearing).
- `server/services/__tests__/supportDraftReconciliation.test.ts` — pure-function tests for the reconciliation decision module + the §8.5 back-link match logic (reply path + internal-note path + ambiguous match path).
- `server/services/__tests__/supportTicketServicePure.test.ts` — pure transition tests + **deletion read-filter tests** (agent reads exclude `provider_deleted=true`; human UI sees tombstone) + **redaction read-filter tests** (agent sees `'[redacted]'`; human UI sees tombstone) + **deletion-by-poll precondition tests** (incremental poll never sets `provider_deleted`; full-reconciliation pass with all conditions met sets it; pass with any condition unmet does not).
- `server/services/__tests__/supportContactResolutionPure.test.ts` — pure-function tests.
- `server/services/__tests__/teamworkSupportStatusMap.test.ts` — pure-function tests.

### Worker

- `server/jobs/supportDraftReconciliationWorker.ts` — pg-boss worker on `support-draft-reconciliation` queue.
- `server/jobs/index.ts` — register the worker at boot.
- `server/lib/supportDispatchBootRecovery.ts` — one-shot startup scan.

### Polling integration

- `server/services/connectorPollingService.ts` — extend with the four-phase support ingestion (no new file; extension only).

### Webhook integration

- `server/services/webhookAdapterService.ts` — extend dispatcher cases for `ticket.assigned` + `ticket.status_changed`.

### Skills

- `server/skills/support/list-open-tickets.md`
- `server/skills/support/read-thread.md`
- `server/skills/support/propose-reply.md`
- `server/skills/support/add-internal-note.md`
- `server/skills/support/approve-draft.md`
- `server/skills/support/reject-draft.md`
- `server/skills/support/set-status.md`
- `server/skills/support/assign.md`
- `server/skills/support/tag.md`
- `server/skills/support/find-customer-history.md`
- `server/config/actionRegistry.ts` — register the `support.*` action group with the new permission keys.

### Routes (new)

- `server/routes/support.ts` (new) — under 200 lines per architecture rule. Endpoints:
  - `GET  /api/support/tickets` — list (filterable by inbox + status group, includes quarantined filter)
  - `GET  /api/support/tickets/:id` — detail (header + thread)
  - `GET  /api/support/inboxes` — list
  - `PATCH /api/support/inboxes/:id` — update `agent_config` (`support.inbox.configure`)
  - `GET  /api/support/drafts` — review queue (filter: `awaiting_review` + `needs_reconciliation`)
  - `GET  /api/support/drafts/:id` — detail
  - `POST /api/support/drafts/:id/approve` — `support.draft.approve` (optional `override_collision: true` body field requires `support.draft.override_collision`)
  - `POST /api/support/drafts/:id/reject` — `support.draft.reject`
  - `POST /api/support/drafts/:id/edit` — operator edits proposed body before approving (`support.draft.approve` per §9)
  - `POST /api/support/drafts/:id/manual-resolve` — for `needs_reconciliation` exhausted-budget surface; sub-actions `mark_sent` and `retry_reconciliation` require `support.draft.approve`, `mark_failed` requires `support.draft.reject` (per §9)

### Access controls

**Read access** to `/api/support/tickets/*`, `/api/support/inboxes` (GET), and `/api/support/drafts/*` (GET) is gated by `authenticate` plus org-scoped reads via `getOrgScopedDb`. There is **no `support.tickets.read` permission key** — read-pathway authorisation is implicit in org membership + sub-account scoping.

**New permission keys** (registered in `permissionSetService` per existing pattern):

- `support.draft.approve` — gates POST /approve, the manual-resolve `mark_sent` and `retry_reconciliation` sub-actions, and the POST /edit path (per §9).
- `support.draft.reject` — gates POST /reject and the manual-resolve `mark_failed` sub-action.
- `support.draft.override_collision` — gates the `override_collision: true` body field on POST /approve. Strictly stronger than `support.draft.approve`.
- `support.inbox.configure` — gates PATCH /inboxes/:id.

Permission key registration follows the existing `permissionSetService` pattern.

### Shared types

- `shared/types/supportInboxAgentConfig.ts` — Zod schema + TypeScript type for `canonical_inboxes.agent_config`.
- `shared/types/supportObservability.ts` — `SUPPORT_LOG_CODES` const object (§15).
- `shared/types/supportProposedActions.ts` — Zod schema for `canonical_ticket_drafts.proposed_actions`.

### Client (UI)

- `client/src/pages/integrations/SupportDeskSetupPage.tsx` (new) — or extension to existing connection-setup wizard.
- `client/src/pages/support/TicketsListPage.tsx` (new)
- `client/src/pages/support/TicketDetailPage.tsx` (new)
- `client/src/pages/support/DraftReviewQueue.tsx` (new)
- `client/src/pages/support/InboxConfigPage.tsx` (new)
- `client/src/components/support/` directory with reusable bits (StatusPill, PriorityPill, ThreadMessage, DraftOverlayMessage, CollisionCallout, etc.).
- `client/src/config/routes.ts` — register `/support/tickets`, `/support/tickets/:id`, `/support/drafts`, `/support/drafts/:id`, `/support/inboxes`.
- `client/src/config/sidebar.ts` — add Support Desk nav group (or rely on existing nav patterns from consolidation work).

### Documentation

- `architecture.md` — new "Canonical Support Desk" subsection under "Service layer" + entry in "Key files per domain".
- `docs/decisions/0009-support-desk-canonical-not-conversations.md` (new ADR per spec-authoring-checklist + brief §10 #7 hard boundary) — locks the decision that tickets do not flow through `canonical_conversations` in v1.
- `docs/capabilities.md` — add Support Desk capabilities (Editorial Rules apply: vendor-neutral phrasing, no model names, no infrastructure language).
- `tasks/builds/support-desk-canonical/handoff.md` (new — written at Phase 1 close).
- `tasks/builds/support-desk-canonical/plan.md` (new — written by `architect` in Phase 2).

### Tests inventory (pure only — per `docs/spec-context.md` testing posture)

Already listed under Services. Total: 5 pure test files. No vitest/E2E/API-contract/frontend tests added (per `convention_rejections` in `docs/spec-context.md`).

## 19. Deferred items

Per spec-authoring-checklist §7, every prose mention of "deferred" / "later" / "future" / "Phase N+1" appears here. Empty is fine; this list is non-empty.

- **Native Synthetos Support Desk (`synthetos_native` adapter).** Brief §12. v1 stays adapter-only. Triggered by emergence of a no-helpdesk customer cohort; gets its own brief.
- **CSAT surveys.** Brief §6.6. Defer until an agent skill needs the data.
- **Knowledge base / help-centre articles.** Brief §6.6. Separate brief; different consumer (RAG).
- **Custom-field promotion to canonical columns.** Brief §6.6 + §5.11. Stays in `external_metadata` until a portable agent skill or a second helpdesk needs it.
- **Time tracking / billable hours / productivity reports.** Brief §6.6 + §8.7. Out of agent reasoning scope.
- **Multi-thread per ticket.** Brief §6.6. v1 is one thread per ticket; merged tickets and side conversations deferred until Foundry's schema confirms the need.
- **Email-only providers (Gmail / IMAP) as helpdesk substitute.** Brief §12.
- **Real-time co-presence ("the bot is typing…").** Brief §12.
- **Bulk historical backfill.** Brief §8.7. Runtime backfill is limited; Foundry remains historical loader.
- **Attachment mirroring to Synthetos object storage.** Brief §10 #5. v1 is provider URL + on-demand `resolveAttachment`. Mirroring promotes when a concrete need emerges (e.g. retention compliance, deleted-from-provider preservation).
- ~~**Provider-side deletion / redaction handling.**~~ **CLOSED — now in v1 scope.** Brief §12 final bullet mandated tombstone definition once provider webhooks expose deletion. Teamwork's existing `mapTeamworkEventType` already normalises `ticket.deleted`, so the canonical layer ships v1 tombstone semantics: `canonical_tickets.provider_deleted` + deletion timestamps + `deletion_source` (§5.1); `canonical_ticket_messages.redacted` + content nulling rule (§5.2); read filtering per §5.2.B; new log codes `support.ticket.provider_deleted`, `support.ticket.restored_after_deletion`, `support.message.redacted` (§15). OQ-5 closes with this design.
- **Reconciliation queue UI for unmatched contacts.** Brief §10 #2 — "Reconciliation queue UI deferred." v1 surfaces unmatched at row level (right rail "Customer not in CRM"); a dedicated reconciliation surface lands later.
- **Cost rollups, KPI dashboards, observability explorers for support volume.** Per `docs/frontend-design-principles.md`, these are deferred-by-default. v1 ships zero such surfaces.
- **Foundry schema parity verification.** OQ-1. The spec author has not verified Foundry's current ticket schema against this spec. Resolved by operator before Phase 2 plan generation.
- **Cross-provider reporting** ("average first-response time across all customers' helpdesks"). Brief §3 motivation — the canonical layer enables it; v1 ships no such report.
- **Mapping-editor admin surface.** Brief §10 + mockup index page note. The status-mapping table is locked at the adapter source level in v1; an admin UI to edit it (without code change) is deferred.
- **Platform-user ↔ canonical-support-agent join row.** Brief §6.4. Add when an agent skill needs the link.
- **Cost-gate for autonomous outbound sends.** v1 dispatches without a per-send cost guard beyond the existing run-cost breaker. A draft-level cost guard (e.g. "do not send if recent run cost > $X") is deferred until production observation.
- **Pure / integration test boundary tightening for `canonical_*` tables.** Per `docs/spec-context.md` `runtime_tests: pure_function_only`, this spec ships no DB-level integration tests for the new tables. When testing posture changes (live agency client), an integration pass over RLS, status-mapping, and dispatch becomes Phase N work.

## 20. Testing posture

Per `docs/spec-context.md` (last reviewed 2026-05-05):

- `testing_posture: static_gates_primary` — lint, typecheck, build are the primary gates.
- `runtime_tests: pure_function_only` — vitest pure-function tests only.
- `frontend_tests: none_for_now`, `api_contract_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`, `performance_baselines: defer_until_production`, `composition_tests: defer_until_stabilisation`.

This spec proposes pure-function tests at five decision boundaries:

1. **Status mapping** — `teamworkSupportStatusMap.test.ts`. Fixture matrix: every known Teamwork value, NULL, empty, unknown, mixed-case. Asserts mapping function is total and fail-closed.
2. **Draft transition guard** — `supportDraftDispatchServicePure.test.ts`. Fixture matrix: every valid transition, every forbidden transition, post-terminal prohibition. Asserts the guard rejects every forbidden transition and accepts every valid one.
3. **Ticket transition guard** — `supportTicketServicePure.test.ts`. Same shape for `canonical_tickets.status` transitions.
4. **Reconciliation decision module** — `supportDraftReconciliation.test.ts`. Inputs: draft state, latest provider message list, attempt count. Outputs: `resolve_sent | resolve_failed | retry_after_ms | surface_manual`. Fixture matrix covers each branch.
5. **Customer-identity resolution** — `supportContactResolutionPure.test.ts`. Inputs: email + canonical-contacts query result. Outputs: `{ canonicalContactId, emailMatchCount }`. Cases: zero match, single match, ambiguous match, NULL email.

**Idempotency-key derivation** is asserted as a pure-function test in `supportDraftDispatchServicePure.test.ts` — same inputs always produce the same key; different inputs always produce different keys.

**No vitest tests** for `connectorPollingService.ts`, `webhookAdapterService.ts`, route files, services that wrap database calls, or UI components. The CI gate `verify-test-quality.sh` rejects handwritten test harnesses; all tests are Vitest with `expect()` per `docs/testing-conventions.md`.

**Static gates** that apply to this body of work:

- `lint`, `typecheck`, `build:server`, `build:client` — must pass.
- `verify-rls-coverage.sh` — every new canonical table is in `RLS_PROTECTED_TABLES`.
- `verify-rls-contract-compliance.sh` — service-layer reads use `getOrgScopedDb` / `withOrgTx` / `withAdminConnection`; no direct `db` import in routes (closed enum reproducible from Hermes lessons).
- `verify-test-quality.sh` — pure tests use Vitest, not handwritten harnesses.
- `verify-pure-helper-convention.sh` — `*ServicePure.ts` modules export pure helpers used by tests.
- `verify-audit-event-namespace.sh` — extended (or confirmed-covering) for the new `support.*` log code namespace.

**Acceptance bar verification** (§17.1) is operator-driven manual smoke against a real Teamwork sandbox. Not test-suite-automated in v1 (testing posture defers integration testing).

### Framing-deviation acknowledgement

This spec proposes nothing in the `defer_until_*` or `none_for_now` categories — i.e. there are no E2E tests, no API-contract tests, no frontend unit tests, no performance baselines, no composition tests. The `static_gates_primary` posture is preserved end-to-end.

If, post-Phase 2, the operator decides to add an integration-level test for the dispatch path (e.g. a `support-dispatch-end-to-end` test that exercises the full draft → message lifecycle against a stub adapter), that is a separate decision and lives in a Phase-2 amendment, not here.

## 21. Self-consistency pass result

Per spec-authoring-checklist §8 — final read-through focused on contradictions between sections.

| Question | Answer |
|---|---|
| Goals (§1) ↔ Implementation (§4–§9) match? | Yes. The five entities + adapter contract + skill registrations are exactly the canonical layer + first validating implementation called for in §1. |
| Every phase item has an explicit verdict (BUILD / DEFER / WON'T DO)? | Yes. All chunks C1–C15 are BUILD (§3 + §16). Deferred items are in §19. WON'T DO items are listed in §1 non-goals + §19. |
| Single-source-of-truth claims survive? | Yes. The four-row precedence table in §11 (Source-of-truth precedence summary) and the per-contract precedence in §11.3 / §11.4 are consistent with the brief §5.5 (writes only via two paths) and §5.2 (provider is the source of truth for sent messages). |
| Non-functional claims match the execution model (§13)? | Yes. No claim of cache hit rate; no claim of latency budget; the dispatch is described as inline within phase 1+2+3 with reconciliation as the asynchronous fallback. |
| Every load-bearing claim has a named mechanism? | Yes. "Idempotent" → §14.1 mechanism table. "Convergent" → §7 dedupe keys. "Three-phase dispatch" → §8 state machine + transition guard. "Source of truth" → §11. "Quarantine never silently becomes open" → adapter mapping function returns the quarantine value AND the closed-enum DB CHECK constraint. |
| File inventory ↔ prose consistency? | Yes. Every prose mention of a new file/column/migration appears in §18. Spot-check: `action_attempts` table mentioned in §14.1 → present in §18 as conditional. `SUPPORT_LOG_CODES` mentioned in §15 → present in §18 under shared types. |
| Phase dependencies forward-only? | Yes per §16. No backward references. |
| `## Deferred Items` exists with correct content? | Yes — §19. |

### Cross-checks against brief §5 invariants

- §5.1 Foundry alignment → enforced by OQ-1 (must close before `accepted`); spec reconciles against Foundry's schema.
- §5.2 provider-confirmed message ledger → enforced by §5.5 state machine + §11.4 contract + §10 read separation.
- §5.3 webhook + poll convergence → enforced by §7 dedupe keys + §14.1 ingestion idempotency.
- §5.4 collision avoidance + manual override → §8.1 preflight + §8.6 override + §15 codes.
- §5.5 write-only-through-adapters → §4 lifecycle + §9 (skills never write `canonical_ticket_messages` directly).
- §5.6 cursors in polling infra → §13 read paths + §7 phase order; no per-row cursor.
- §5.7 idempotency across retries → §14.1 mechanism table.
- §5.8 three-phase dispatch + reconciliation → §8 state machine + §14.7 closure.
- §5.9 denormalised tenant isolation → §12 RLS checklist.
- §5.10 observability codes → §15.
- §5.11 provider-neutral canonical model → §1 non-goals + §19 custom-field deferral.
- §5.12 operational state UI surface → §10 surfacing rules + log-code-to-UI mapping.

### Cross-checks against brief §10 locked decision defaults

- #1 Foundry alignment reference → OQ-1 (§22).
- #2 deterministic email match only, never auto-create contacts → §11.6 + §7 customer-identity resolution.
- #3 conflict policy + UI → §15 codes + §10 surface mapping.
- #4 outbound message finality → §5.2 + §5.5.
- #5 attachments URL+resolver → §6 `resolveAttachment` + §19 mirroring deferred.
- #6 sized for low-thousands tickets per org/day → §5.1 indexes (single-org partial indexes; no partitioning); revisit at scale.
- #7 canonical_conversations boundary → §4 + ADR (§18).
- #8 inbox as policy unit → §5.3 `agent_config` + §11.5.
- #9 Teamwork API version → OQ-2 + §17 capability matrix `?` rows.
- #10 OAuth + optional API-key → existing `teamworkAdapter` already supports both via `getAuthHeaders`. Confirmed.
- #11 webhook event scope → §6 + §17 capability matrix.
- #12 status vocabulary mapping → OQ-2 + §6 + §11.2 + acceptance bar.
- #13 idempotency mechanism → OQ-3 + §14.1 + §17 capability matrix.
- #14 attachment auth model → OQ-4 + §6 `resolveAttachment` + §17 capability matrix.

All fourteen brief-locked decisions are either (a) implemented in this spec or (b) named as an open question whose closure is required before merge.

## 22. Open questions

Four open questions block the move to `Status: accepted`. Each has a defined closer. (OQ-5 closed in this revision — see §19 deferred-items entry and §5.1 / §5.2 tombstone definitions.)

### OQ-1 — Foundry ticket-schema parity verification

**Question:** Does the runtime `CanonicalTicketData` shape (§6 + §11.3) match Foundry's current Teamwork ticket schema field-for-field? Brief §5.1 + §10 #1.

**Why it matters:** the single biggest risk to an agentic system is a model trained against one shape and served a different shape at runtime.

**Closer:** operator runs a side-by-side comparison of `CanonicalTicketData` against Foundry's schema, enumerates every divergence in this section as an explicit list with one of: (a) "match — identical", (b) "divergence — Foundry has X, runtime intentionally omits / renames because Y", (c) "divergence — runtime has X, Foundry intentionally omits because Y". Resolution: spec amendment with the divergence list inlined into §11.3. **Required before Phase 2 plan generation.**

### OQ-2 — Teamwork status vocabulary inventory

**Question:** What is the complete set of values Teamwork Desk's API returns for ticket status? Brief §10 #12.

**Why it matters:** the canonical status map (§6 + §11.2) is fail-closed; any provider value not in the map quarantines the ticket. An incomplete map produces unnecessary quarantine; a wrong map produces silent misclassification. Brief §10 #12 explicitly says "the spec cannot be approved until the inventory is complete" — this OQ is the reason this spec stays at `Status: reviewing` rather than `Status: accepted`.

**Closer:** the operator inventories Teamwork's status values (from Teamwork API docs + a real Teamwork account's reported values) and the spec is amended with the full mapping table inlined into §11.2 (replacing the partial example) before the Phase 1 → Phase 2 handoff completes. The locked Phase 2 implementation in `server/adapters/teamwork/teamworkSupportStatusMap.ts` is then a direct transcription of the spec table. **Required before spec acceptance — i.e. before Phase 2 plan generation.** This is the only accepted pre-build discovery task the spec defers; every other open question may close inside Phase 2 chunks.

### OQ-3 — Teamwork native action-idempotency mechanism

**Question:** Does Teamwork's `addReply` / `addInternalNote` API support a native idempotency-key header (or equivalent)? Brief §10 #13.

**Why it matters:** if yes, the adapter forwards the §14.1 `action_idempotency_key` as a header and the provider deduplicates on its side. If no, the local `action_attempts` ledger ships in C7 + migration `0312`.

**Closer:** Phase 2 chunk C7 audits Teamwork's API surface and locks one of the two paths. Spec amendment: §6 + §17 capability matrix `?` row + §18 conditional migration list become concrete `yes:<header>` or `no:<ledger>`. **Required before C7 closes.**

### OQ-4 — Teamwork attachment auth + URL lifecycle

**Question:** What is Teamwork's attachment auth model — short-lived signed URLs, persistent auth-required URLs, or other? Brief §10 #14 + §6.2 attachment policy.

**Why it matters:** drives whether `resolveAttachment` returns a fresh URL (cheap; provider does the auth) or streams bytes through our backend (expensive; we proxy).

**Closer:** Phase 2 chunk C7 audits the auth model and Teamwork attachment URL behaviour. Spec amendment: §6 `resolveAttachment` return type may narrow to one of `{url}` or `{stream}`. **Required before C7 closes.**

### ~~OQ-5~~ — CLOSED in this revision (chatgpt-spec-review Round 1)

OQ-5 originally asked whether Teamwork exposes deletion/redaction events and what canonical schema change was required. ChatGPT's Round 1 review noted that Teamwork's existing `mapTeamworkEventType` already normalises `ticket.deleted`, so the question was no longer theoretical — deletion handling had to ship in v1.

**Resolution (now in v1 scope):**
- `canonical_tickets`: new tombstone columns `provider_deleted`, `deleted_at_external`, `deleted_at_canonical`, `deletion_source` (§5.1).
- `canonical_ticket_messages`: new redaction columns `redacted`, `redacted_at_external`, `redacted_at_canonical` plus content-nulling rule on redact (§5.2).
- §5.2.B audience-tier table extended with deletion + redaction visibility per audience (agent / human UI / audit).
- §15: three new log codes — `support.ticket.provider_deleted`, `support.ticket.restored_after_deletion`, `support.message.redacted`.
- §17.1 acceptance bar: tombstone test added.
- §19: provider-side deletion entry moved from "deferred" to "now in v1 scope".

If Teamwork does not in fact expose a message-level redaction event, the redaction columns ship anyway as defensive coverage for future Zendesk / Freshdesk adapters; the redaction schema is provider-neutral.

### Notes for the spec-reviewer

- This spec is being reviewed before any of OQ-1..OQ-4 close (OQ-5 closed in this revision). Per `docs/spec-context.md`'s spec-reviewer policy, OQs are valid framing — the reviewer should not classify "incomplete status inventory" as a directional finding because the inventory is OQ-2.
- Any reviewer finding that proposes work in a `convention_rejections` category (vitest for non-pure code, supertest, frontend tests, feature flags for migrations, staged rollout) is rejected by the framing per `docs/spec-context.md`.
- The Foundry-alignment finding (if Codex raises one) is OQ-1 and is operator-owned, not auto-fixable.
