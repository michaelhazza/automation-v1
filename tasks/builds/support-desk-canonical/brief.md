# Support Desk Canonical: Development Brief

**Status:** DRAFT v4 — incorporates three rounds of review feedback. Locked. Spec-ready pending the eight decisions in §9.
**Author:** Claude (audit-driven), 2026-05-09
**Branch:** `claude/support-ticket-structure-xMcy8`
**Purpose:** Define why we are adding a canonical Support Desk layer, why canonical (vs. alternatives), the benefits, the design invariants, and the entities required. No SQL, no signatures, no chunk plan yet; that comes after this is signed off.

---

## Decision Statement

We are building a canonical Support Desk runtime layer so agentic support workflows can reason, act, evaluate, and improve against one provider-neutral ticket model, while Teamwork Desk, Zendesk, Freshdesk, and future providers remain adapter implementations underneath. This is part of the agent runtime substrate, not just integration plumbing.

---

## Contents

1. The Use Case Driving This
2. Why Build a Support Desk Integration At All
3. Why Canonical (Not Per-Provider)
4. What We Already Have (Don't Re-Build)
5. Design Invariants
6. Proposed Canonical Entities (For Stress-Testing)
7. Adapter Surface (What Each Provider Must Implement)
8. Skills the Canonical Layer Unlocks
9. Open Decisions Before Spec
10. Recommendation
11. Out of Scope (Explicit)

---

## 1. The Use Case Driving This

We are building a **Support Agent** as one of the first agentic workflows on this platform. The agent's job is to:

1. See incoming customer support tickets in real time.
2. Read the conversation history and any attached context (customer record, prior tickets, knowledge base).
3. Draft a reply.
4. Either send the reply directly (autonomous mode) or queue it for a human reviewer (assisted mode).
5. Escalate, tag, reassign, or close the ticket as appropriate.

The first integration target is **Teamwork Desk**, because that is what we use internally and we already have the Teamwork OAuth flow plus a partial adapter in the codebase. Zendesk and Freshdesk are obvious follow-ons; the public APIs are similar in shape.

**Foundry is upstream of this, not a substitute.** Foundry pulls historical Teamwork tickets and turns them into training and evaluation data for the agent. The platform's job is the **runtime**: live ticket monitoring, drafting, sending, status changes. The two systems will share data shape (a ticket is a ticket), but they live in different layers and serve different consumers.

## 2. Why Build a Support Desk Integration At All

The alternative is to skip the helpdesk and read raw email (IMAP, Gmail API) because it is "fewer moving parts." We should not do this. Reasons:

| Issue with raw-email approach | Why it bites us |
|---|---|
| **No ticket identity.** Email gives you a thread; a ticket is a thread plus status, priority, assignee, tags, customer, inbox, SLA, internal notes. | The agent needs to *act* (set status, reassign, tag, internal-note). With raw email it can only reply. Half the workflow is missing. |
| **No state machine.** Email has no concept of open / pending / waiting on customer / closed. | The agent cannot reason about backlog, SLA breach, or what is actionable. |
| **No agent or queue assignment.** | Multi-human teams cannot run alongside the agent without collisions. |
| **No internal notes or collision detection.** | Two agents, or an agent plus a human, reply at once. |
| **Customer-facing operators already use the helpdesk.** | If we monitor email separately we are forking the source of truth from the human team's source of truth. |
| **Helpdesk APIs already do the hard work.** | Threading, deduplication, customer matching, attachment handling, signature stripping. We would rebuild all of it. |

Conclusion: integrate at the helpdesk layer, not the mail layer.

## 3. Why Canonical (Not Per-Provider)

The platform already runs a canonical-first pattern for CRM (`canonical_accounts`, `canonical_contacts`, `canonical_opportunities`, `canonical_conversations`, `canonical_revenue`). We should do the same for support desks. A **canonical Support Desk layer** means: one shape for tickets, threads, messages, agents, and inboxes, populated by per-provider adapters (Teamwork, Zendesk, Freshdesk).

The alternative is per-provider: the support agent calls Teamwork APIs directly, the next customer calls Zendesk APIs directly, and we maintain N variants of the agent.

**Why canonical wins for us specifically:**

1. **One agent, many providers.** The Support Agent's prompt, tools, evals, and skills are written once against the canonical shape. Adding Zendesk later is an adapter, not an agent rewrite.
2. **Clean training and eval boundary with Foundry.** Foundry already standardises tickets for training. If our runtime canonical shape matches Foundry's, we get the same agent behaving the same way in training and in production. Drift between the two is the single biggest risk to quality of an agentic system.
3. **Tenant isolation is solved.** The canonical layer already inherits the three-layer RLS pattern (Postgres RLS, service-layer principal context, explicit `organisation_id` filters). We get tenant isolation for free; raw provider calls do not.
4. **The CRM Query Planner already reads canonical.** A support agent that wants to answer "what is this customer's history?" hits canonical CRM tables today. If support tickets also live in canonical, the same planner answers "what tickets has this customer opened?" with no new infrastructure.
5. **Cost discipline.** Canonical reads are local DB reads. Per-provider reads are rate-limited live API calls. Most agent reasoning loops re-read context many times; doing that against Teamwork's API every turn is slow and expensive.
6. **Cross-customer aggregation.** Reporting like "average first-response time across all our customers' helpdesks" is trivial against canonical and painful against N providers.

**The honest cost of canonical:**

- Adapters carry mapping logic. Some provider fields do not fit cleanly and end up in `external_metadata` JSON.
- Canonical lags slightly behind the provider (poll interval plus webhook latency). For send-reply we go through the adapter to the provider directly, so the user-facing path is not on the polled cycle. For read we accept seconds of staleness.
- Schema migrations are slower than just calling someone's API. We accept this.

The trade is right. The same trade has already paid off for CRM.

## 4. What We Already Have (Don't Re-Build)

The audit found significant existing infrastructure. The brief should *extend*, not duplicate.

| Already in the codebase | What it covers |
|---|---|
| `canonical_conversations` table | Generic conversation shape: `channel`, `status`, `messageCount`, `lastMessageAt`, `lastResponseTimeSeconds`. Designed with support-style metrics in mind. |
| `IntegrationAdapter.ticketing` capability group | Contract for `createTicket`, `updateTicket`, `addReply`, `getTicket`. Already typed. |
| `IntegrationAdapter.webhook` capability group | Contract for `verifySignature` plus `normaliseEvent`. Already typed. |
| `teamworkAdapter.ts` | Implements `ticketing` (create, update, reply, get) and `webhook` (signature plus normalisation for `ticket.created`, `ticket.updated`, `ticket.reopened`). |
| Connector polling service plus ingestion stats | Scheduled polling, sync phase tracking, deduplication, observability. Works for any adapter that implements `ingestion`. |
| Three-layer RLS pattern, `withPrincipalContext`, principal-scoped service methods | Reusable for new tables verbatim. |
| `connectorType` and `providerType` enums | Already include `'teamwork'`. |

**The gaps the audit identified:**

1. **No canonical ticket entity.** `canonical_conversations` is the closest thing but is too generic; it has no priority, no assignee, no inbox, no SLA, no thread structure, no internal-note distinction.
2. **No canonical thread or message split.** A ticket has many messages; messages have direction (inbound or outbound), author (customer, agent, or bot), and visibility (public or internal note). None of that is modelled.
3. **No canonical agent or inbox dimension.** Provider-side concepts that the agent needs to reason about ("who is on this inbox", "is this assigned to a human").
4. **`teamworkAdapter` does not implement `ingestion` yet.** It can act on tickets but does not pull them into canonical on a poll.

So the work is: add the missing canonical entities, extend the existing adapter, and wire ingestion. We are not starting from zero.

## 5. Design Invariants

These are non-negotiable properties of the canonical layer. They constrain the spec and the implementation. Every change to the layer must preserve them.

### 5.1 Training-runtime alignment with Foundry

The runtime ticket shape and the Foundry ticket shape must remain intentionally aligned. Any divergence must be explicit, versioned, and justified in writing. The single biggest risk to an agentic system is a model trained against one shape and then served a different shape at runtime; we will not run that risk by accident. Practically: when the spec is drafted, the Foundry schema is a required reference input, and any field that exists in one and not the other gets a documented reason.

### 5.2 Provider is the source of truth for sent messages

`canonical_ticket_messages` is the **provider-confirmed message ledger**: rows only exist there once the provider has accepted the message. In-flight outbound intent lives in `canonical_ticket_drafts` (§6.5) with its own state machine; it does not enter the message stream while still pending. If the adapter returns a provider message ID synchronously on send, the confirmed message may be inserted immediately as part of the same transaction that marks the draft `sent`. Otherwise, the message is inserted by webhook or poll reconciliation when the provider's record arrives. Duplicate provider events (sync response plus webhook for the same send) collapse on `(connector_config_id, external_id)`. The agent-visible thread read is always the confirmed ledger only — drafts are surfaced through a separate skill.

### 5.3 Webhook and poll are convergent and idempotent

Webhook ingestion and polling ingestion are two delivery paths into the same canonical state. They must be convergent and idempotent. The same provider ticket or message must resolve to the same canonical row regardless of which path arrives first. Dedupe key for tickets is `(connector_config_id, external_id)`; for messages it is `(connector_config_id, ticket_external_id, external_id)`. Re-ingesting the same provider event must be a no-op or a deterministic update, never a duplicate insert.

### 5.4 Collision avoidance with humans

The Support Agent must not send, close, or reassign a ticket when recent human activity or provider-side assignment indicates a human is actively handling it, unless explicitly configured to do so for that inbox. The canonical model carries the primitives the agent needs to make this call (see §6.1: `last_human_activity_at`, `bot_claimed_at`); the policy itself lives in the Support Agent spec, not here.

### 5.5 Read-only by default, write only through adapters

Canonical tables are written by two paths only: the connector polling/webhook ingestion path, and confirmed-action mirror writes from the adapter call path. No skill, agent, or service writes directly into `canonical_tickets` or `canonical_ticket_messages` to express user intent. User intent (drafts, pending sends) lives in its own table (`canonical_ticket_drafts`, see §6.5) and only crosses into the canonical message stream once the adapter confirms the provider accepted it.

### 5.6 Provider cursors live in the polling infrastructure, not on canonical rows

Incremental sync cursors and sync phase state live in the existing connector polling infrastructure (`connector_configs`, `integration_ingestion_stats`), not on the canonical ticket rows. The only sync-related field on a canonical row is `last_synced_at`. This prevents fragile per-table cursor logic and keeps sync state in one place.

### 5.7 Outbound actions are idempotent across retries

Provider-facing actions (sends, internal notes, status changes, assignments, tag mutations) must be idempotent across retries. Each action carries a stable **action idempotency key** derived from `(connector_config_id, ticket_id, action_type, source_id)`, where `source_id` is the draft ID for sends and a deterministic hash of the action payload for in-place mutations. Retrying an approved draft after a timeout, network blip, or process restart must never create a duplicate customer-visible reply. Adapters either pass the idempotency key through to the provider's native idempotency mechanism (where supported) or maintain a local action-attempt ledger keyed by it.

### 5.8 Draft approval is a three-phase dispatch

Approving a draft and sending it is a three-phase operation, in order:

1. **Preflight checks** — collision-window policy (§6.3 `agent_config`), inbox mode, draft validity, ticket status not quarantined, customer identity resolution if required by policy.
2. **Durable transition** — within a single transaction, mark the draft `dispatching` and persist its `action_idempotency_key`. After this point the operation is committed; subsequent attempts re-use the same key.
3. **Adapter call** — the adapter is invoked with the idempotency key. The provider's accepted response, or a subsequent webhook/poll, reconciles the confirmed message into `canonical_ticket_messages` and transitions the draft to `sent`.

A process crash between phases 2 and 3, or after the adapter call but before local confirmation, must resume by re-issuing the same idempotency key, not by creating a second send. This is the single most dangerous path in the system; the invariant is non-negotiable.

### 5.9 Tenant isolation is denormalised, not joined

Every canonical support table is organisation-scoped and protected by the existing three-layer RLS model (Postgres policies, service-layer principal context, explicit `organisation_id` filters). `organisation_id` is denormalised onto every child table (`canonical_ticket_messages`, `canonical_ticket_drafts`, `canonical_inboxes`, `canonical_support_agents`) so RLS never depends on a join back to the parent ticket. This is especially important for `canonical_ticket_drafts`, which carry agent-generated content and customer-identifying data, and for `canonical_ticket_messages`, which carry the customer's own words. Cross-tenant leakage at the message layer is the worst possible outcome; the invariant is structural.

### 5.10 Observability is part of the contract

Every operational anomaly emits a structured log with a stable code, not a free-text message. The required field set on every event: `organisation_id`, `connector_config_id`, `ticket_id` (where applicable), `provider`, `event_type`, `code`, plus event-specific context. Reserved codes for v1:

- `support.status.unknown_provider_status` — quarantined ticket per §6.1.
- `support.ingest.duplicate_collapsed` — webhook + poll convergence collapsed a duplicate per §5.3.
- `support.action.retry_idempotent` — outbound action retried using an existing idempotency key.
- `support.action.provider_conflict` — concurrent human edit detected during adapter write.
- `support.attachment.resolve_failed` — adapter `resolveAttachment` returned an error.
- `support.ticket.human_collision_blocked` — agent action blocked by inbox collision-window policy.
- `support.ingest.contact_unmatched` — inbound ticket has customer email with no canonical contact match.

This list is the floor, not the ceiling. The spec defines the channel (log sink, metrics, optional UI surface); the brief locks in the requirement that "we logged it somewhere" is not acceptable.

## 6. Proposed Canonical Entities (For Stress-Testing)

This is the data model proposal at concept level: names and intent, not column lists.

### 6.1 `canonical_tickets` (new)

The unit of work. One row per support request.

Fields the agent needs to reason about:

- **Identity:** `external_id` (provider's ticket ID), `connector_config_id`, `organisation_id`, `subaccount_id`.
- **Customer identity (resilient):** `customer_email`, `customer_name`, `customer_external_id` (provider's customer/contact ID), and `canonical_contact_id` (nullable FK to `canonical_contacts`). The first three are always populated from the provider; the FK is populated only when a deterministic email match resolves. Tickets are never blocked by an unmatched contact. Optionally link to `canonical_accounts` via the contact's company once matched.
- **Lifecycle:** `status` (see canonical status model below), `priority` (low, medium, high, urgent), `opened_at`, `first_response_at`, `last_customer_message_at`, `last_agent_message_at`, `closed_at`, `resolution_at`.
- **Routing:** `inbox_id` (FK to `canonical_inboxes`), `assignee_agent_id` (FK to `canonical_support_agents`, nullable).
- **Collision-avoidance primitives:** `last_human_activity_at` (most recent message or status change attributed to a human helpdesk agent), `last_bot_activity_at` (most recent action attributed to our Support Agent), `bot_claimed_at` (set when our agent has claimed the ticket and not yet released). The Support Agent reads these before acting; the policy that consumes them lives in the agent spec, not here.
- **Classification:** `subject`, `tags[]`, `category` (optional, normalised), `source_channel` (email, chat, form, api).
- **SLA tracking:** `sla_due_at` (nullable), `sla_breached` (bool), `sla_policy_external_id` (provider SLA reference, nullable).
- **Provider catchall:** `external_metadata` JSONB for provider-specific fields we choose not to canonicalise.
- **Sync metadata:** `last_synced_at`, `source_connection_id`.

**Canonical status model.** Deliberately small. Provider-specific statuses live in `external_metadata`.

| Canonical status | In default actionable queue? | Meaning |
|---|---|---|
| `open` | Yes | Active, agent attention required, no party currently waiting. |
| `pending_internal` | Yes | Waiting on internal action (engineering, finance, another team). Customer is not blocked. |
| `waiting_on_customer` | Yes | Reply has gone out, awaiting customer response. |
| `resolved` | No (opt-in) | Support outcome completed. Excluded from default agent queues; included only when an inbox `agent_config` explicitly enables post-resolution follow-up workflows. Customer reply reopens to `open`. |
| `closed` | No | Terminal/archive state. Not expected to receive normal agent action; reopening is an explicit operation. |
| `unknown_provider_status` | **No (quarantined)** | Provider returned a status the adapter has not mapped. Fail-closed: ticket is excluded from all actionable agent queues until the mapping is resolved. |

The split between `resolved` and `closed` matters: `resolved` is an outcome ("we answered it"), `closed` is a lifecycle terminus ("the ticket is no longer in active circulation"). The reason `resolved` is opt-in actionable is to prevent the agent repeatedly touching tickets that are already done; follow-up automations (CSAT prompts, post-resolution check-ins) must explicitly opt in via inbox policy. Mapping each provider's status vocabulary into the first five canonical values is part of the adapter contract; `unknown_provider_status` is the quarantine bucket for anything else (see §7).

**Relationship to `canonical_conversations`.** `canonical_tickets` is the source of truth for support workflows. Tickets do not flow through `canonical_conversations`. The generic conversations table remains for non-ticket messaging channels (SMS, chat, phone). A future unified-activity-feed concern may link the two; v1 does not. This avoids overloading `canonical_conversations` with ticket semantics.

### 6.2 `canonical_ticket_messages` (new)

The provider-confirmed message ledger. One row per message; a row only exists once the provider has accepted the message (per §5.2). In-flight outbound intent lives in `canonical_ticket_drafts`, not here.

- `ticket_id` FK, `external_id` (provider's message ID, required), `organisation_id` (denormalised for RLS).
- `direction`: `inbound` (from customer), `outbound` (from agent or bot), `internal_note`.
- `author_type`: `customer`, `agent`, `bot`, `system`.
- `author_id`: nullable FK to `canonical_contacts` (for customer) or `canonical_support_agents` (for agent or bot).
- `body_text` and `body_html` (we keep both; the agent reads text, audit and replay use html).
- `attachments` (JSONB array of `{filename, provider_url, mime_type, size}`; see attachment policy below).
- `visibility`: `public` (visible to customer), `internal` (team-only note).
- `created_at_external` (provider's authoritative timestamp).
- `source_draft_id`: nullable FK to `canonical_ticket_drafts` for outbound bot messages, linking the confirmed message back to its originating draft. Null for inbound and human-authored messages.
- `external_metadata` JSONB (includes provider sequence IDs where available).

This split (ticket plus messages) matters. Treating a ticket as a single record with a `messages` JSON column would fight against everything: indexing, partial sync, attachment handling, and per-message agent provenance.

**Thread ordering and replay determinism.** Thread order is `created_at_external ASC`, with the canonical message ID as the final deterministic tiebreaker for messages sharing a timestamp. Provider sequence IDs (where available) are stored in `external_metadata` and may be preferred by adapter-specific reconciliation logic when ambiguity exists, but the canonical ordering rule above is the contract for all agent-facing reads, evals, and prompt assembly.

**Attachment policy (v1).** Store provider attachment metadata and the provider's URL. Do not mirror files into our own object storage in v1. Where provider URLs are short-lived or auth-scoped (Teamwork attachment URLs require auth), the adapter must expose an attachment resolver method (`resolveAttachment(messageId, attachmentId)`) that fetches a fresh URL or stream on demand. Persistently stale URLs in canonical rows are not acceptable. Promotion to mirrored object storage is a v2 concern, gated on a concrete need.

### 6.3 `canonical_inboxes` (new)

A queue or mailbox in the helpdesk. Tickets belong to inboxes; agents belong to inboxes.

- `external_id`, `organisation_id`, `connector_config_id`.
- `name`, `email_address` (the public-facing address that routes here, e.g. `support@customer.com`).
- `is_active`.
- `agent_config` JSONB: per-inbox Support Agent configuration. Includes mode (`autonomous` | `assisted` | `disabled`), **collision window thresholds** (`min_minutes_since_human_activity`, `respect_human_assignee` boolean), draft expiry, model and prompt overrides. Different inboxes can run different policies; for example, Billing in autonomous with a 30-minute human-activity window, Sales in assisted with no autonomous send at all.
- `external_metadata`.

The Support Agent is configured per inbox; the inbox is the unit of policy. The canonical layer carries the collision-avoidance primitives (§6.1: `last_human_activity_at`, `bot_claimed_at`); the thresholds that turn those primitives into a decision live here, in `agent_config`.

### 6.4 `canonical_support_agents` (new)

Human (or bot) operators on the helpdesk side. Distinct from our platform users.

- `external_id`, `organisation_id`, `connector_config_id`.
- `display_name`, `email`.
- `agent_kind`: `human`, `bot` (so the AI agent can recognise its own past replies).
- `is_active`.
- `external_metadata`.

This is the helpdesk's user table, mirrored. Do not conflate with our platform `users`; they are different identity domains. Optionally we add a join row mapping `canonical_support_agents.id` to our `users.id` when the human is also a platform user, but that is later.

### 6.5 `canonical_ticket_drafts` (new)

The home for agent-generated replies that are not yet sent. Required because the use case includes assisted mode (human-in-the-loop review). Without this entity, drafts have nowhere durable to live and the spec would be forced to invent it.

- `id`, `organisation_id`, `subaccount_id`.
- `ticket_id` FK to `canonical_tickets`.
- `proposed_body_text`, `proposed_body_html`.
- `proposed_visibility`: `public` (customer reply) or `internal` (note).
- `proposed_actions` JSONB: optional companion state changes the agent intends to apply alongside the reply (e.g., `{ status: "waiting_on_customer", tags_add: ["billing"] }`).
- `created_by_agent_run_id`: FK to the agent run that produced the draft (provenance for evals).
- `model_version`, `prompt_version` (provenance for replay and regression testing).
- `status`: `draft` | `awaiting_review` | `dispatching` | `sent` | `rejected` | `failed` | `expired` | `superseded`. There is intentionally no durable `approved` resting state — approval is the trigger for the §5.8 three-phase dispatch and transitions immediately into `dispatching`. The `dispatching` state covers the window between adapter call and provider confirmation; this is where pending outbound intent lives, **not** in `canonical_ticket_messages`.
- `action_idempotency_key`: stable key per §5.7, set when the draft is approved and reused on every retry.
- `reviewer_user_id`, `reviewed_at`, `review_notes` (set on approval or rejection).
- `sent_message_id`: FK to `canonical_ticket_messages` once the provider confirms. Null until then.
- `expires_at`: drafts auto-expire so stale suggestions do not sit in the queue forever.

Autonomous-mode flow: agent writes a `draft` row, immediately transitions it to `approved`, then `dispatching` while the adapter calls the provider; on confirmation the row moves to `sent` and a `canonical_ticket_messages` row is reconciled in with `source_draft_id` pointing back. Assisted-mode flow: agent writes `awaiting_review`, a human approves or rejects, then the same approved-to-dispatching-to-sent path runs. Either way, the audit trail and idempotency key flow are identical.

### 6.6 What we explicitly do NOT canonicalise (yet)

Holding the line on scope:

- **Knowledge base articles.** Different domain, different consumer (RAG). Out of scope here.
- **CSAT surveys.** Real concept but not needed for v1 of the agent. Defer.
- **Custom fields per customer.** Push into `external_metadata` JSONB. Do not promote to first-class columns until a skill demands it.
- **Time tracking, billing, productivity reports.** Helpdesk has these; the agent does not reason about them.
- **Provider-specific constructs** (Teamwork projects, Zendesk groups, Freshdesk solutions). External_metadata.
- **Multi-thread per ticket.** v1 is one thread per ticket. Side conversations and merged tickets are deferred until Foundry's schema confirms the need.

Every column we promote into the canonical shape is a maintenance liability across N adapters. Default to "no" until a concrete agent skill requires it.

## 7. Adapter Surface (What Each Provider Must Implement)

Once entities are agreed, the per-provider adapter contract is roughly:

- **Ingestion (pull, scheduled):** `listInboxes`, `listSupportAgents`, `fetchTickets` (incremental, since `last_synced_at`), `fetchTicketMessages` (incremental).
- **Acting (push, on-demand):** `createTicket`, `addReply` (public), `addInternalNote`, `updateTicket` (status, priority, tags, assignee), `getTicket`. Mostly already typed in `IntegrationAdapter.ticketing`.
- **Attachment resolution (on-demand):** `resolveAttachment(messageId, attachmentId)` returns a fresh provider URL or stream when a stored URL has expired (see §6.2 attachment policy).
- **Webhook (push, event-driven):** Verify provider signature; normalise `ticket.created`, `ticket.updated`, `ticket.reply.added`, `ticket.assigned`, `ticket.status_changed` into canonical events. Webhook handlers must be idempotent per §5.3.
- **Status mapping (fail-closed):** Adapter declares the mapping from provider status vocabulary into the canonical five (`open`, `pending_internal`, `waiting_on_customer`, `resolved`, `closed`). Provider statuses the adapter has not mapped become `unknown_provider_status` (§6.1). Unknown statuses must **never** silently become `open` — that would let the agent act on tickets it should not touch. Quarantined tickets are excluded from agent-actionable queues, the original provider value is preserved in `external_metadata`, and a structured ingestion warning is raised so the mapping can be added.

Teamwork already covers the acting and webhook side. We need to add the ingestion methods, the attachment resolver, and the status map.

## 8. Skills the Canonical Layer Unlocks

Tying back to the use case. With the canonical layer in place, the Support Agent gets these as composable skills with no per-provider code:

- `support.list_open_tickets(inbox_id, since)` — reads `canonical_tickets`.
- `support.read_thread(ticket_id)` — joins `canonical_tickets` with `canonical_ticket_messages` (excludes `pending` outbound messages from the agent's view).
- `support.propose_reply(ticket_id, draft)` — writes a `canonical_ticket_drafts` row. In autonomous mode, the same skill auto-approves and dispatches. In assisted mode it stops at `awaiting_review`.
- `support.approve_draft(draft_id)` — human or auto-approval; triggers the adapter send via the action idempotency key (§5.7); on provider confirmation, the confirmed message is mirrored or reconciled into `canonical_ticket_messages` and the draft is linked back via `source_draft_id`. The skill never writes to `canonical_ticket_messages` directly — that path is reserved for ingestion (§5.5).
- `support.add_internal_note(ticket_id, note)` — same draft-then-send path, `visibility=internal`.
- `support.set_status(ticket_id, status)`, `support.assign(ticket_id, agent_id)`, `support.tag(ticket_id, tags)`.
- `support.find_customer_history(contact_id)` — joins `canonical_contacts` with `canonical_tickets` and `canonical_revenue`. This is the killer query: support agent context-loading from one customer record across CRM and support history.

The CRM Query Planner can extend its registry to include these without re-engineering; it already routes between canonical and live executors.

## 9. Open Decisions Before Spec

The brief is not approved until we have a position on each of these. Each one materially affects the spec.

1. **Foundry alignment — which schema version is the reference?** We commit to alignment in §5.1; we still need to name the specific Foundry schema version the spec must reconcile against, and ratify which fields will diverge with documented justification.
2. **Contact resolution policy.** Recommendation: deterministic email match only in v1. Do not auto-create `canonical_contacts` from support tickets — it will pollute CRM with one-off requesters. Unmatched tickets carry raw customer fields (§6.1) and remain queryable as "unmatched". A dedicated reconciliation queue UI is **out of scope for v1**; the canonical primitives are in place so it can be added later without schema change. Confirm.
3. **Conflict policy specifics.** Stated direction: provider wins on read, adapter writes are auditable, conflicts surface in observability rather than auto-resolving. Confirm and define what "surfaces in observability" means concretely (metric? log? UI?).
4. **Outbound message finality.** §5.2 invariant says provider-confirmed only. Confirm we are willing to hold pending outbound messages out of agent-visible thread reads until confirmed (acceptable trade for correctness).
5. **Attachments.** §6.2 policy: provider URL plus adapter-resolved fresh URL on demand, no mirroring in v1. Confirm.
6. **Volume and partitioning.** Expected tickets-per-org-per-day at steady state? Drives polling cadence, webhook reliance, and whether `canonical_ticket_messages` needs partitioning. Needed before sizing.
7. **`canonical_conversations` boundary.** §6.1 states tickets do not flow through `canonical_conversations` in v1. Confirm (the alternative — every ticket also writing a conversation row — is rejected here as overloading the abstraction).
8. **Inbox as the unit of agent configuration.** Confirm `canonical_inboxes` is the right granularity for Support Agent configuration (autonomous vs. assisted, model selection, prompt overrides), not the connector-config level above it.

## 10. Recommendation

Approve the canonical approach. Approve the **five** entities as the v1 surface:

1. `canonical_tickets`
2. `canonical_ticket_messages`
3. `canonical_inboxes`
4. `canonical_support_agents`
5. `canonical_ticket_drafts` (added in v2 of the brief; necessary for assisted mode)

Approve the ten design invariants in §5 (Foundry alignment, provider-confirmed message finality, idempotent dual-path ingestion, collision avoidance, write-only-through-adapters, cursors-in-polling-infra, idempotent outbound actions, three-phase dispatch sequencing, denormalised tenant isolation, structured observability with stable codes) as non-negotiable constraints for the spec.

Park CSAT, KB articles, custom fields, multi-thread per ticket, and attachment mirroring for later.

Resolve the eight decisions in §9, then go to spec. The spec should be drafted via `spec-coordinator` against this brief, with Foundry's existing ticket schema as a required reference input.

## 11. Out of Scope (Explicit)

- Foundry data pipeline changes; that lives in Foundry, not here.
- Knowledge base or help-centre integration; separate brief.
- The Support Agent itself (prompts, tools, eval harness); separate brief, depends on this one.
- Email-only providers (Gmail, IMAP) as a fallback when there is no helpdesk; defer.
- Real-time co-presence ("the bot is typing..."); defer.
- **Provider-side deletion and redaction.** v1 does not hard-delete canonical rows when a provider deletes or redacts a ticket or message, except where existing platform privacy rules require it. The spec must define tombstone or redaction handling (soft-delete column, content nulling, retention semantics) if provider webhooks expose deletion or redaction events; the canonical layer should not silently retain content the provider has removed.
