# Support Desk Canonical: Development Brief

**Status:** DRAFT — for stress-testing before we go to spec.
**Author:** Claude (audit-driven), 2026-05-09
**Branch:** `claude/support-ticket-structure-xMcy8`
**Purpose:** Define why we are adding a canonical Support Desk layer, why canonical (vs. alternatives), the benefits, and the entities required. No SQL, no signatures, no chunk plan yet — that comes after this is signed off.

---

## Contents

1. The Use Case Driving This
2. Why Build a Support Desk Integration At All
3. Why Canonical (Not Per-Provider)
4. What We Already Have (Don't Re-Build)
5. Proposed Canonical Entities (For Stress-Testing)
6. Adapter Surface (What Each Provider Must Implement)
7. Skills the Canonical Layer Unlocks
8. Open Questions for Stress-Test
9. Recommendation
10. Out of Scope (Explicit)

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

## 5. Proposed Canonical Entities (For Stress-Testing)

This is the data model proposal at concept level: names and intent, not column lists.

### 5.1 `canonical_tickets` (new)

The unit of work. One row per support request.

Fields the agent needs to reason about:

- **Identity:** `external_id` (provider's ticket ID), `connector_config_id`, `organisation_id`, `subaccount_id`.
- **Ownership and customer side:** link to `canonical_contacts` (via email match or provider customer ID), and optionally to `canonical_accounts` (the contact's company).
- **Lifecycle:** `status` (open, pending, waiting_on_customer, closed, resolved), `priority` (low, medium, high, urgent), `opened_at`, `first_response_at`, `last_customer_message_at`, `last_agent_message_at`, `closed_at`, `resolution_at`.
- **Routing:** `inbox_id` (FK to `canonical_inboxes`), `assignee_agent_id` (FK to `canonical_support_agents`, nullable).
- **Classification:** `subject`, `tags[]`, `category` (optional, normalised), `source_channel` (email, chat, form, api).
- **SLA tracking:** `sla_due_at` (nullable), `sla_breached` (bool), `sla_policy_external_id` (provider SLA reference, nullable).
- **Provider catchall:** `external_metadata` JSONB for provider-specific fields we choose not to canonicalise.
- **Sync metadata:** `last_synced_at`, `source_connection_id`.

### 5.2 `canonical_ticket_messages` (new)

The conversation inside a ticket. One row per message.

- `ticket_id` FK, `external_id`, `organisation_id` (denormalised for RLS).
- `direction`: `inbound` (from customer), `outbound` (from agent or bot), `internal_note`.
- `author_type`: `customer`, `agent`, `bot`, `system`.
- `author_id`: nullable FK to `canonical_contacts` (for customer) or `canonical_support_agents` (for agent or bot).
- `body_text` and `body_html` (we keep both; the agent reads text, audit and replay use html).
- `attachments` (JSONB array of `{filename, url, mime_type, size}`).
- `visibility`: `public` (visible to customer), `internal` (team-only note).
- `created_at_external` (provider's authoritative timestamp).
- `external_metadata` JSONB.

This split (ticket plus messages) matters. Treating a ticket as a single record with a `messages` JSON column would fight against everything: indexing, partial sync, attachment handling, and per-message agent provenance.

### 5.3 `canonical_inboxes` (new)

A queue or mailbox in the helpdesk. Tickets belong to inboxes; agents belong to inboxes.

- `external_id`, `organisation_id`, `connector_config_id`.
- `name`, `email_address` (the public-facing address that routes here, e.g. `support@customer.com`).
- `is_active`.
- `external_metadata`.

The Support Agent is configured per inbox: "this agent operates on the Billing inbox in autonomous mode and on the Sales inbox in draft-only mode." Without an inbox dimension, that scoping has nowhere to live.

### 5.4 `canonical_support_agents` (new)

Human (or bot) operators on the helpdesk side. Distinct from our platform users.

- `external_id`, `organisation_id`, `connector_config_id`.
- `display_name`, `email`.
- `agent_kind`: `human`, `bot` (so the AI agent can recognise its own past replies).
- `is_active`.
- `external_metadata`.

This is the helpdesk's user table, mirrored. Do not conflate with our platform `users`; they are different identity domains. Optionally we add a join row mapping `canonical_support_agents.id` to our `users.id` when the human is also a platform user, but that is later.

### 5.5 What we explicitly do NOT canonicalise (yet)

Holding the line on scope:

- **Knowledge base articles.** Different domain, different consumer (RAG). Out of scope here.
- **CSAT surveys.** Real concept but not needed for v1 of the agent. Defer.
- **Custom fields per customer.** Push into `external_metadata` JSONB. Do not promote to first-class columns until a skill demands it.
- **Time tracking, billing, productivity reports.** Helpdesk has these; the agent does not reason about them.
- **Provider-specific constructs** (Teamwork projects, Zendesk groups, Freshdesk solutions). External_metadata.

Every column we promote into the canonical shape is a maintenance liability across N adapters. Default to "no" until a concrete agent skill requires it.

## 6. Adapter Surface (What Each Provider Must Implement)

Once entities are agreed, the per-provider adapter contract is roughly:

- **Ingestion (pull, scheduled):** `listInboxes`, `listSupportAgents`, `fetchTickets` (incremental, since `last_synced_at`), `fetchTicketMessages` (incremental).
- **Acting (push, on-demand):** `createTicket`, `addReply` (public), `addInternalNote`, `updateTicket` (status, priority, tags, assignee), `getTicket`. Mostly already typed in `IntegrationAdapter.ticketing`.
- **Webhook (push, event-driven):** Verify provider signature; normalise `ticket.created`, `ticket.updated`, `ticket.reply.added`, `ticket.assigned`, `ticket.status_changed` into canonical events.

Teamwork already covers the acting and webhook side. We need to add the ingestion methods.

## 7. Skills the Canonical Layer Unlocks

Tying back to the use case. With the canonical layer in place, the Support Agent gets these as composable skills with no per-provider code:

- `support.list_open_tickets(inbox_id, since)` — reads `canonical_tickets`.
- `support.read_thread(ticket_id)` — joins `canonical_tickets` with `canonical_ticket_messages`.
- `support.draft_reply(ticket_id, draft_text)` — writes a `direction=outbound, visibility=public, author_type=bot` message via the adapter to the provider, mirrors into canonical on webhook.
- `support.add_internal_note(ticket_id, note)` — same path, `visibility=internal`.
- `support.set_status(ticket_id, status)`, `support.assign(ticket_id, agent_id)`, `support.tag(ticket_id, tags)`.
- `support.find_customer_history(contact_id)` — joins `canonical_contacts` with `canonical_tickets` and `canonical_revenue`. This is the killer query: support agent context-loading from one customer record across CRM and support history.

The CRM Query Planner can extend its registry to include these without re-engineering; it already routes between canonical and live executors.

## 8. Open Questions for Stress-Test

These are the assumptions I am least sure about. The brief should not be approved until we have a position on each.

1. **Do we need a `canonical_ticket_thread` between ticket and messages?** Some helpdesks (and Foundry's existing model) support multiple threads per ticket (merged tickets, side conversations). v1 says no: one thread per ticket, model the rest as messages. Confirm Foundry agrees.
2. **How do we resolve customer identity?** Inbound email matched against an existing `canonical_contact` by email is the obvious play. But what if the contact does not exist in the CRM? Do we auto-create a stub `canonical_contact` from the support ticket, or leave the ticket dangling with `customer_email` only and reconcile later?
3. **Bidirectional sync conflict policy.** If a human agent and our bot edit the same ticket within the polling window, who wins? Suggest: provider always wins on read, last-writer-wins on write, surface conflicts in observability rather than auto-resolving.
4. **Volume sizing.** How many tickets per day are we expecting at steady state across all customers? Drives polling cadence, webhook reliance, and whether `canonical_ticket_messages` needs partitioning. We should size before we build.
5. **Foundry alignment.** Foundry already has a ticket schema for training data. Should we adopt Foundry's shape verbatim, or treat them as cousins? Strong vote for verbatim where possible; drift between training data and runtime data is the worst kind of bug in an agentic system.
6. **Autonomous-vs-assisted gating.** Does the agent get to send replies without a human, or does v1 only draft? This is a product decision that affects the data model only mildly (we may need a `draft_reply` table or a `pending_review` status), but it affects the workflow significantly.
7. **Multi-inbox per organisation.** Customers will have multiple inboxes per Teamwork instance. Confirm `canonical_inboxes` is the right granularity for Support Agent configuration, not a higher level (like "Teamwork Desk account").
8. **Attachments.** We store URLs in messages; do we mirror attachment files into our own object store, or hot-link to provider URLs? Hot-link is cheaper and simpler; provider URLs may expire or change auth model. Decision needed.

## 9. Recommendation

Approve the canonical approach. Approve the four entities (`canonical_tickets`, `canonical_ticket_messages`, `canonical_inboxes`, `canonical_support_agents`) as the v1 surface. Park CSAT, KB articles, custom fields, and threading-beyond-one-thread for later.

Resolve the eight open questions above, then go to spec. The spec should be drafted via `spec-coordinator` against this brief, with Foundry's existing ticket schema as a reference input so we get drift-free training-to-runtime alignment from day one.

## 10. Out of Scope (Explicit)

- Foundry data pipeline changes; that lives in Foundry, not here.
- Knowledge base or help-centre integration; separate brief.
- The Support Agent itself (prompts, tools, eval harness); separate brief, depends on this one.
- Email-only providers (Gmail, IMAP) as a fallback when there is no helpdesk; defer.
- Real-time co-presence ("the bot is typing..."); defer.
