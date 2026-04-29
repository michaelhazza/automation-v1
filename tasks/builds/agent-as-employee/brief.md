# Agents Are Employees — Developer Brief

**Slug:** `agent-as-employee`
**Status:** Draft brief — for review and iteration before spec authoring.
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
- An agent's read access to its own inbox, calendar, and documents is enforced by the same `ServicePrincipal` visibility predicate that already gates everything else — no new permission surface to maintain.

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

Two questions need a call from the user before the spec lands.

### Q1. Workspace migration policy mid-flight

A subaccount that initially adopts the native backend later upgrades to Google Workspace. What happens to the historical canonical rows tied to the native identities?

- **Option A — keep history, archive identities.** Existing native identities are marked archived. New Google identities are minted. Historical mail, calendar, and document rows stay queryable but are tagged to the archived identity.
- **Option B — fresh start.** New tenant, new identities, no historical bridge. Cleaner data, but loses historical search continuity for the agent's prior work.

**Working recommendation:** Option A. Customers who upgrade workspace backends are usually customers who care about continuity. Cleaner-data is a developer concern, not a customer concern.

### Q2. Native-backend agent email — what domain?

An agent on the native backend is created with what email address?

- **Option A — Synthetos-controlled subdomain per tenant.** `agent-sarah@<subaccount-slug>.automationos.io`. Predictable, billable to the agency, no domain-handoff complexity.
- **Option B — customer-supplied subdomain via DNS.** `agent-sarah@ai.clientco.com`, where the client points a DNS record at us. Feels native, but adds a setup step.
- **Option C — both, with B being optional polish.** Default to A; allow B as a vanity upgrade.

**Working recommendation:** Option C. Ship A. Make B available as a self-serve setup step for customers who want it.

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
- Permission and visibility for an agent's mail, calendar, and documents is enforced through the same `ServicePrincipal` predicate that already gates everything else in the system.

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
