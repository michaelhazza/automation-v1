# Agents Are Employees — Developer Brief

**Slug:** `agent-as-employee`
**Status:** Refined brief — pre-spec locks resolved 2026-04-29. Open product questions remain (see §7) but do not block spec authoring.
**Class:** Major (cross-cutting — schema, identity, integrations, permissions, UX).
**Predecessor analysis:** Google Cloud Next 2026 transcript review session, 2026-04-29.

---

## Contents

1. What we are doing
2. Why we are doing this
3. What we are trying to achieve
4. What the benefits are
5. Scope decisions
6. Out of scope
7. Open product questions
8. What success looks like
9. Why this brief stops here

---

## 1. What we are doing

We are giving every agent in Automation OS a **real workplace identity** — an email address, a calendar, a mailbox, a document store, and a place on the org chart — so that an agent can be deployed into a client's company the same way a human employee is.

Two backends ship at launch:

- **Synthetos-native** — identities, mail, calendar, and documents all live inside Automation OS. Zero external dependency. Demoable on day one.
- **Google Workspace** — identities are real Google Workspace users on the client's domain (`agent-sarah@clientco.com`), with Gmail, Drive, and Calendar accessed via service-account + domain-wide delegation. The agent acts as itself, not on behalf of a human.

A third backend, **Microsoft 365**, is explicitly out of scope for launch and ships as a fast-follow once the canonical pattern is proven against the Google adapter.

The work is structured around a canonical-first abstraction (mirroring the CRM canonical pattern we already use): provider-agnostic identity / mail / calendar / document tables sit at the centre, with adapters translating Google-specific or native-specific behaviour at the edges. Agents and humans share a single identity space — both point at the same canonical table.

## 2. Why we are doing this

### The competitive context

Google's Gemini Enterprise, which Google demoed at Cloud Next 2026, ships a single-prompt fan-out across a fleet of agents (market research, data insights, product strategy, dev, store-ops) backed by Workspace co-creation surfaces. Their orchestration primitive is real and impressive.

But Google's identity model is fundamentally limited: **every agent acts as the logged-in human.** It uses your permissions, your inbox, your Drive. There is no notion of "the agent has its own seat." This works fine for an individual using Gemini for personal productivity. It falls apart for a real agency operating multiple clients with multiple agents per client:

- You cannot audit what an agent did separately from what the human did.
- You cannot grant the agent narrower permissions than the human has.
- You cannot put the agent on the org chart with its own email signature, calendar, shared inbox.
- When a human leaves the company, every agent they "owned" effectively leaves with them.

Our existing three-principal model (`UserPrincipal`, `ServicePrincipal`, `DelegatedPrincipal`) already separates agents from humans at the identity layer. We are the only platform structurally positioned to take this further: an agent that is a real seat, not a borrowed login.

### The strategic narrative

This is the launch wedge against Gemini Enterprise. The pitch, in one sentence:

> Google's agents borrow your login. Ours show up to work.

That marketing line is only credible if the product backs it. An agent with its own Gmail address, joining its own calendar invites, sending its own email — that is the proof. A native fallback (so clients without Google Workspace still get the agent-as-employee experience) makes the pitch land for every prospect, not just Workspace tenants.

### Why now, not later

The brief + GlobalAskBar + orchestrator stack we shipped recently (the single-prompt fan-out primitive, the persistent debuggable delegation graph, server-side scope re-validation) is parity-or-better with Gemini Enterprise on orchestration. We do not need to chase Google on agent fan-out. We need to leapfrog them on identity. Identity is the moat we can build that they structurally cannot — because their commercial model is "agent uses a human's licence" and ours is "agent is the licence holder."

## 3. What we are trying to achieve

A non-technical operator at one of our agency customers should be able to:

1. Open the agency's view of a client's subaccount.
2. Click "hire an agent" — pick a system agent (e.g. an SDR, a marketing analyst, a support triage agent) and give them a name.
3. Have the system either (a) provision a real Google Workspace user on the client's domain, or (b) create a Synthetos-native identity, depending on which backend the subaccount is configured for.
4. See the new agent appear on the client's org chart, with its email address, profile picture, role, and reporting line.
5. Watch human team members at the client interact with that agent the same way they interact with each other — sending it email, inviting it to meetings, sharing documents with it.
6. Audit everything the agent did under that identity, separately from any human.

For us internally, the success conditions are:

- Adding Microsoft 365 later is purely an adapter — no canonical schema changes, no UI changes, no permission-system changes.
- Switching a subaccount from Synthetos-native to Google Workspace (or vice-versa) is a defined operation with a defined data-history policy, not an ad-hoc migration.
- An agent's access to its own inbox, calendar, and documents is enforced by the existing `ServicePrincipal` predicate for Automation-OS-internal records and by the provider's own ACLs for provider-hosted resources (see §5 boundary rule). No new internal permission surface to maintain.

## 4. What the benefits are

### For our customers (agencies and their clients)

**Real auditability.** Every email, every calendar accept, every document edit by the agent is attributable to the agent — not to a human who happens to own the credentials. Compliance teams can answer "what did this agent do last quarter" without untangling shared accounts.

**Real permissions.** An agent only sees what is shared with its identity. The agent does not inherit the founder's Drive just because it was provisioned by the founder. Permissions are explicit, narrow, and revocable in one click (revoke the identity, agent loses access).

**Real org structure.** The agent appears on the org chart. Humans on the team can `@mention` it, invite it to meetings, send it briefs by email. Onboarding an agent feels the same as onboarding a contractor — a real workflow, not a configuration spreadsheet.

**Continuity across human departures.** Sarah the marketing analyst leaves the agency. Her work continues. The agents she "managed" don't disappear with her, because they were never running on her credentials in the first place.

**No vendor lock-in to Google.** A client on Microsoft (post-launch), or a client who wants to keep their email inside Synthetos, gets the same agent-as-employee experience. The canonical layer means the product story does not depend on which workspace the customer happens to run.

### For us as a platform

**A defensible wedge against the hyperscalers.** Google and Microsoft will not build "agent has its own seat" because it cannibalises their per-seat licensing model. We can.

**A consistent identity model that scales.** One canonical workspace identity table is the source of truth for both agents and humans. The org chart, agent provisioning, agent revocation, audit logs, and permission gating all read from one place.

**A pattern we can extend.** Once the connector-config registry carries `google_workspace`, `synthetos_native`, and (later) `microsoft_365`, adding new providers is purely adapter work. Slack-as-workplace, Notion-as-workplace, custom enterprise stacks — all become future adapters, not redesigns.

**Proof that the canonical-first philosophy is the right one.** This is the second major canonical abstraction (after CRM). Two coherent applications of the same pattern is what turns a pattern into a platform principle.

## 5. Scope decisions

These are decided. The spec will encode them; we are not re-opening them at spec time without strong cause.

### Decided: canonical-first, mirror the CRM pattern

The Workspace abstraction sits behind the same canonical-first pattern we already use for CRM. Provider-agnostic tables in the centre. Provider-specific adapters at the edges. Provenance carried via the connector-config FK edge, not duplicated columns. Native Synthetos is a first-class adapter, not an afterthought.

This is non-negotiable. Hardcoding Google fields onto the agents table would be a step backwards from the architecture we already operate.

### Decided: workspace tenant is per-subaccount, not per-agent

A single subaccount picks one workspace backend (Google, Microsoft, or native). Every agent and every human inside that subaccount live in that one tenant. Different subaccounts within the same agency-organisation can pick differently — that is the realistic variation, because different clients run different workspaces.

Per-agent workspace switching is overkill and was rejected. Reasons:

- A company's identity domain is single-tenant by definition. `@clientco.com` exists in one place.
- Inter-agent collaboration breaks across workspace tenants. Agents need to share documents, mention each other, sit on shared calendars.
- It mirrors the same logic that made the CRM pattern subaccount-scoped: one company has one CRM, one company has one workspace.
- Doubles licensing and admin overhead for every subaccount. No upside.

### Decided: launch backends are native + Google. Microsoft is fast-follow.

The user (Michael) will be using Google Workspace personally, so the Google adapter is launch-blocking. Native is launch-blocking because it removes the demo dependency on third-party admin work and gives every prospect a working agent-as-employee experience even without Workspace. Microsoft 365 is structurally identical adapter work and ships once the canonical layer has proven itself against one external provider.

### Decided: agents and humans share one identity table

A single canonical workspace-identity table. An agent has a foreign key into it. A human has a foreign key into it. The org chart is a query against this one table. This is what makes "agents are real employees" literal rather than metaphorical.

### Decided: actor vs identity — distinct concepts

Two layers, separated by design:

- **Actor** — the persistent logical entity (a specific agent or a specific human), identified by a canonical `actor_id`. Stable across backend migrations and identity changes.
- **Identity** — a provider-scoped representation of an actor at a moment in time. Each backend (native, Google, Microsoft later) holds its own identity row, FK'd to the actor.

Lifecycle states (next decision) apply to *identities*. Audit attribution, billing, and cross-backend continuity reference the *actor*. Business logic that needs "who did this" should query against `actor_id`, not against a backend-specific identity row.

This separation is what makes migration, audit continuity, and future multi-backend work clean rather than a special case.

### Decided: identity lifecycle states

Every workspace identity — agent or human — passes through a fixed lifecycle:

- **Provisioned** — record exists, no access yet.
- **Active** — access granted, identity in use.
- **Suspended** — access paused, identity preserved.
- **Revoked** — access removed, identity preserved as audit anchor.
- **Archived** — post-migration or end-of-life; queryable, no active access.

Identities are immutable audit anchors. Deletion never removes historical linkage; revocation removes access while preserving the row and every reference to it. The Google adapter reconciles this against Workspace's hard-vs-soft-delete semantics — the canonical layer's contract takes priority. Without an explicit lifecycle model the spec drifts into inconsistent delete behaviour across adapters.

### Decided: workspace migration creates a new identity, linked by canonical `actor_id`

When a subaccount switches workspace backend (e.g. native → Google), no identity is moved or rewritten. A new identity row is provisioned in the new backend; the prior identity is archived. A persistent canonical `actor_id` links pre- and post-migration identities so audit history, message threads, and document references remain queryable as a single actor's record.

Historical rows stay tagged to the archived identity. New rows tag to the new identity. The `actor_id` is the join key. This lifts the previous draft Q1 from open to decided and supplies the identity-continuity mechanism that was otherwise missing.

### Decided: adapter contract invariant — identical observable behaviour

Every workspace adapter — native, Google, Microsoft (later) — must produce identical observable behaviour for:

- Identity provisioning and deprovisioning.
- Email send and receive (including audit, rate-limit, and policy outcomes).
- Calendar participation (invite, accept, decline).
- Document access (read, write, share).

A canonical-layer test suite exercises every adapter against the same scenarios. Behavioural divergence is a bug in the adapter, not a feature. This is what makes "adding Microsoft later is purely adapter work" a true claim at spec time rather than an aspiration.

### Decided: agent email is routed through a platform-controlled pipeline — both directions

All agent email — native or Google, inbound or outbound — passes through a single platform-controlled pipeline. Adapters call the pipeline; the pipeline calls providers. Adapters never bypass it.

- **Outbound** egresses through the pipeline, which enforces audit logging, rate limiting, signing, and policy checks before provider dispatch.
- **Inbound** is normalised through the pipeline before being surfaced to agents or workflows. Threading, attachments, and audit metadata are written canonically regardless of backend (Google push/watch + polling vs. native direct ingestion).

This keeps deliverability, abuse controls, threading, and audit trails consistent across backends. Without the lock, Gmail's push/watch model and the native ingestion path diverge on every cross-cutting concern that customers experience as "the agent's behaviour."

### Decided: provider permissions are the source of truth for provider-hosted resources

Automation OS enforces access at the identity level — who is this principal, what is its lifecycle state, what scoped capabilities does it carry. It does **not** re-implement provider ACLs. If a Google Drive document is shared with `agent-sarah@clientco.com`, Google governs that access; we ask Google. Drive ACLs, Gmail thread visibility, and Calendar event visibility on the Google adapter are owned by Google.

For native-backend resources we are the provider, so provider-permission rules apply to ourselves. This rule prevents the "split-brain permissions" failure mode where Automation OS and Google disagree about whether the agent can see a document.

### Decided: org chart is representational only in v1

The org chart visualises identity, role, and reporting line. It does **not** grant permissions, route messages, or affect orchestration. Reporting lines are display metadata. Any future change that makes them load-bearing for permissions or routing is a separate decision, recorded explicitly. We do not want a hidden permission system riding on the org chart.

### Decided: native backend stays minimum viable

The native backend implements the minimum capability needed for an agent to act as an employee — receive email, send email, hold a calendar identity, accept a meeting, hold a document reference. It does **not** chase feature parity with Gmail, Calendar, or Drive.

Any feature proposed for native must answer: "does an agent need this to act like an employee?" If not, it does not ship in v1. The risk we are guarding against is overbuilding native into a workspace product while the Google and Microsoft adapters lag.

### Decided: provisioning is confirmation-gated, idempotent, and reversible

"Hire an agent" is a real provisioning action — on the Google backend it creates a real Google Workspace user on the customer's domain.

- **Confirmation-gated.** Every provisioning action requires explicit operator confirmation before dispatch.
- **Idempotent.** Provisioning is keyed by a request id; duplicate submissions (double-click, retry-after-timeout, network-glitch replay) must not create duplicate identities.
- **Reversible.** Every provisioning action has a matching deprovision counterpart. Deprovision is itself idempotent and safe to retry.

**Deprovision semantics.** Deprovision revokes access but does not delete or transfer the agent's owned resources — inbox, calendar events, documents — unless explicitly configured to. Ownership and retention policies are adapter-defined but must preserve audit continuity. After deprovision, the agent's history remains queryable via `actor_id`.

This is the guardrail against accidental over-provisioning (domain pollution, unintended seat consumption, fat-fingered hires), against the irreversibility risk of "the agent went into Google before the operator meant to confirm," and against the data-loss risk of "deprovision silently wiped the inbox we needed for compliance."

### Decided: an agent identity is a billable seat

Each agent identity is a billable seat, distinct from human user seats. This is the commercial mirror of the structural decision that agents have their own identity, and it is the leverage point against bring-your-own-Claude/ChatGPT setups where the agent is a tool that consumes no licence.

**Billing state is derived from identity lifecycle.** Only **Active** identities consume seats. Provisioned-but-not-yet-Active identities (mid-creation), Suspended identities, and Revoked / Archived identities do not. This lets operators temporarily suspend an agent without paying for it, and it removes ambiguity from seat-usage automation.

Pricing details — per-seat amount, tiering, agency-bundled rates — are out of scope here. The lock is that *this* is the unit of monetisation, gated on lifecycle state.

## 6. Out of scope

### Explicitly deferred to a fast-follow

- **Microsoft 365 adapter.** Same surface, different backend. Adds without changing the canonical layer.
- **Slack / Teams as a workplace identity provider.** Possible future adapter; not on the launch path.

### Explicitly deferred to v2

- **Cross-subaccount agents.** An agent that operates across multiple clients of the same agency. Interesting case, but a different identity model — defer until there is a real customer asking for it.
- **Agent-to-agent messaging across subaccounts.** Same constraint.
- **Marketplace of pre-built agent identities** ("hire from a catalogue"). Adjacent product surface; not in scope here.

### Explicitly out

- **Building our own email/calendar/document client UI.** The native adapter writes to canonical tables, which existing UI surfaces will read. We are not building a Gmail-clone web client.
- **Replicating Workspace canvas-mode-style co-creation in Slides / Docs.** Real but separate. Belongs on a "content surface" roadmap, not the identity roadmap.

## 7. Open product questions

One core question and a handful of minor clarifications remain before the spec lands. None of these block the brief — they belong in spec — but settling them now avoids backtracking at schema and adapter time.

### Q1. Native-backend agent email — what domain?

An agent on the native backend is created with what email address?

- **Option A — Synthetos-controlled subdomain per tenant.** `agent-sarah@<subaccount-slug>.automationos.io`. Predictable, billable to the agency, no domain-handoff complexity.
- **Option B — customer-supplied subdomain via DNS.** `agent-sarah@ai.clientco.com`, where the client points a DNS record at us. Feels native, but adds a setup step.
- **Option C — both, with B being optional polish.** Default to A; allow B as a vanity upgrade.

**Working recommendation:** Option C. Ship A. Make B available as a self-serve setup step for customers who want it.

### Q2. Profile photos — auto-generated or required?

Does provisioning auto-generate a profile photo (deterministic, derived from agent name and role) or require a photo at hire time?

**Working recommendation:** Auto-generate by default; allow operator override later. Lower friction at hire time. Photos are display metadata; nothing structural depends on them.

### Q3. Email signatures — default or per-agent configurable?

Does every agent ship with a default signature (e.g. "Sent by Sarah, AI agent at ClientCo, on behalf of Acme Agency"), or is the signature configurable per-agent at hire time?

**Working recommendation:** Default signature with a single agency-level override. Per-agent configurability is v2 polish. Agents must always be visibly identified as agents in outbound communication — that part is non-negotiable for trust and disclosure; only the wording is flexible.

### Q4. Document ownership — can agents own, or only access?

Can an agent **own** documents (creator-of-record), or only access documents shared with it by a human?

**Working recommendation:** Agents can own documents. A document an agent creates lives under the agent's identity, not under the human who triggered the creation. Consistent with the audit-attribution principle: "what did this agent do" must include "what did this agent create."

### Q5. Meeting invitations — outbound or inbound only?

Can an agent invite humans (or other agents) to meetings, or only respond to invitations sent to it?

**Working recommendation:** Both. Outbound invites are consistent with the agent-as-employee framing. Restrictive defaults — "this agent can only respond, not initiate" — should come from policy or scope grants, not from the capability layer being missing.

## 8. What success looks like

By launch, a non-technical operator at a pilot agency can:

1. Inside any subaccount, click "Hire an agent" and pick from a list of system agents.
2. Watch the system provision the agent's identity in the subaccount's chosen backend (native or Google).
3. See the new agent appear on the subaccount's org chart with email, role, reporting line.
4. Send the agent an email and have it process the email under its own identity.
5. Add the agent to a meeting and have it accept under its own calendar.
6. Audit, in one place, every action the agent has taken since being hired.

By the same launch, internally we can demonstrate:

- The same flow working against the native backend (no Google) and the Google backend, with identical user-facing UX.
- Adding the Microsoft adapter post-launch is purely adapter work — no canonical or UX change.
- Permission and visibility for an agent's mail, calendar, and documents is enforced through the existing `ServicePrincipal` predicate for internal records and through the provider's own ACLs for provider-hosted resources, per the §5 boundary rule.

## 9. Why this brief stops here

This document is the rationale, not the recipe. It states what we are building, why, and what we are deliberately not building. The spec will translate this into:

- A concrete schema delta (canonical tables, connector-config enum extension, identity FKs).
- A concrete adapter contract (what every workspace adapter must implement).
- A concrete provisioning and migration runbook.
- A concrete permission predicate extension.
- Concrete acceptance tests.

That work happens after this brief is reviewed and signed off. The pipeline from here:

1. **Brief review (this document).** Iterate with the user until the framing, scope decisions, and open product questions are settled.
2. **Spec authoring.** A formal dev spec, on Opus, with `architect` consulted on the schema-delta shape and the adapter contract.
3. **`spec-reviewer` pass.** Codex review loop on the spec before any code is written.
4. **Architect plan breakdown.** Decomposes the spec into implementation chunks.
5. **Implementation.** On Sonnet, via `superpowers:subagent-driven-development`.
6. **`spec-conformance` + `pr-reviewer`** before merge.

---

## Decision log

- **2026-04-29** — Microsoft 365 explicitly excluded from launch scope; native + Google only. Decided by user.
- **2026-04-29** — Canonical-first, mirroring CRM pattern, is non-negotiable. Hardcoding Google-specific fields on the `agents` table is rejected. Decided by user.
- **2026-04-29** — Workspace tenant is per-subaccount, not per-agent. Decided jointly; user instinct confirmed by analysis.
- **2026-04-29** — Agents and humans share one canonical identity table. Decided in original analysis; carried through.
- **2026-04-29** — Identity lifecycle locked: provisioned → active → suspended → revoked → archived. Identities are immutable audit anchors. Decided by user.
- **2026-04-29** — Workspace migration policy locked: new identity per backend, persistent canonical `actor_id` links pre- and post-migration identities. Lifts previous-draft Q1 from open to decided. Decided by user.
- **2026-04-29** — Adapter contract invariant locked: identical observable behaviour across all adapters for identity / email / calendar / documents. Decided by user.
- **2026-04-29** — Outbound email egresses through a single platform-controlled send pipeline (audit, rate-limit, policy). Decided by user.
- **2026-04-29** — Provider permissions are the source of truth for provider-hosted resources; Automation OS does not re-implement provider ACLs. Decided by user.
- **2026-04-29** — Org chart is representational only in v1; reporting lines do not grant permissions or affect orchestration. Decided by user.
- **2026-04-29** — Native backend stays minimum viable; no Gmail/Drive feature parity. Decided by user.
- **2026-04-29** — Provisioning is confirmation-gated and reversible via a matching deprovision flow. Decided by user.
- **2026-04-29** — Agent identity is a billable seat, distinct from human user seats. Pricing details deferred. Decided by user.
- **2026-04-29** — Actor vs identity vocabulary locked: actor is the persistent logical entity (canonical `actor_id`); identity is the provider-scoped representation. Lifecycle applies to identities; audit / billing / continuity reference the actor. Decided by user.
- **2026-04-29** — Inbound email also routes through the platform-controlled pipeline; outbound + inbound symmetry. Decided by user.
- **2026-04-29** — Provisioning is idempotent per request key; duplicate submissions must not create duplicate identities. Decided by user.
- **2026-04-29** — Deprovision revokes access but preserves owned resources by default; retention policies are adapter-defined and must preserve audit continuity via `actor_id`. Decided by user.
- **2026-04-29** — Seat consumption is derived from identity lifecycle: only Active identities consume seats. Decided by user.
- **2026-04-29** — §3 and §8 wording tightened to align with the §5 provider-permission boundary rule (internal records via `ServicePrincipal`; provider-hosted resources via provider ACLs).
