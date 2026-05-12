**Status:** DRAFT (2026-05-12) — supersedes the earlier `principal-scoped-agents` brief; awaiting operator sign-off before spec authoring
**Date:** 2026-05-12 (rewritten after design pushback challenged the abstraction overhead of the textbook principal model)
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `user-owned-agents` (was `principal-scoped-agents`)
**Successor placeholder:** `tasks/builds/personal-assistant-v1/brief.md` (first consumer)
**Concurrent with:** Spec D `tasks/builds/operator-backend/brief.md` (small predictable conflict surface — see §7)
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §5.1 (agents are organisational entities), §6.6 (Model Access and Identity), §9 (Credential Broker and Identity Boundary), §16.1 (Executive Assistant), §16.3 (Dev Agent)

# User-Owned Agents — Build Brief

## Contents

- [0. Naming + decision rationale (read first)](#0-naming--decision-rationale-read-first)
- [1. Purpose](#1-purpose)
- [2. What's locked from upstream](#2-whats-locked-from-upstream)
- [3. What this spec must define](#3-what-this-spec-must-define)
  - [3.1 `owner_user_id` on the agents table](#31-owner_user_id-on-the-agents-table)
  - [3.2 `owner_user_id` on agent runs](#32-owner_user_id-on-agent-runs)
  - [3.3 Credential broker scoping rule](#33-credential-broker-scoping-rule)
  - [3.4 Memory remains per-agent (no scope abstraction)](#34-memory-remains-per-agent-no-scope-abstraction)
  - [3.5 RLS clause for user-owned agent runs](#35-rls-clause-for-user-owned-agent-runs)
  - [3.6 Admin visibility and redaction policy](#36-admin-visibility-and-redaction-policy)
  - [3.7 Migration of existing agents](#37-migration-of-existing-agents)
  - [3.8 Cross-ownership delegation (design note)](#38-cross-ownership-delegation-design-note)
  - [3.9 Master brief doc update](#39-master-brief-doc-update)
- [4. Open architectural questions](#4-open-architectural-questions)
- [5. Out of scope (explicit non-goals)](#5-out-of-scope-explicit-non-goals)
- [6. What unblocks when this ships](#6-what-unblocks-when-this-ships)
- [7. Sequencing](#7-sequencing)

## 0. Naming + decision rationale (read first)

This brief replaces the earlier `principal-scoped-agents` brief after a design challenge round (2026-05-12) examined whether the textbook "principal" abstraction was the right shape for this work. It was not. The simpler shape is a single `owner_user_id` column.

### 0.1 The naming change

| Was | Now |
|---|---|
| `principal-scoped-agents` | `user-owned-agents` |
| `principal_type` enum (`subaccount` / `user` / `org`) | omitted — null `owner_user_id` = subaccount-owned (current behaviour) |
| `principal_id` denormalised column | omitted |
| `memory_blocks.scope_type` + `scope_id` | omitted — memory stays per-agent (already the model) |
| Run Trace virtual-view "principal" projection | becomes a simple `owner_user_id` column on `agent_runs` |
| "Principal-aware credential broker" | "Owner-scoped credential resolution when `owner_user_id` is set" |

The name "principal" carried baggage: it implied a polymorphic abstraction with multiple classes (subaccount / user / org / future) that needed to be unified into one model. The simpler truth is that **today every agent is owned by a subaccount, and we are introducing exactly one new ownership shape: an agent owned by a specific user**. Naming it `user-owned-agents` matches what the schema actually does.

### 0.2 Three options were considered

| Option | What it does | Verdict |
|---|---|---|
| **A. Don't build it.** Tell users to use Claude / ChatGPT / Codex for personal productivity. | Saves engineering. Loses the SynthetOS-shaped use case (agents acting as a specific human inside the org's audit / policy / orchestration boundary). | **Rejected.** SynthetOS positioning as the governed agentic OS requires this capability; Phase 3 Dev Agent needs it; future personal agents need it. Skipping just defers the inevitable. |
| **B. Duplicate agent rows + `owner_user_id` column.** 5 employees → 5 EA agent rows. Each links to a user via a single nullable column. Memory and credentials live per-agent. | Simple, concrete, easy to explain. ~40% of the schema work of Option C. | **Chosen.** Achieves the strategic outcome with minimum abstraction overhead. |
| **C. Full principal abstraction.** `principal_type` + `principal_id` + `scope_type` + `scope_id` across agents, runs, memory, RLS, credential broker, view projection. | The textbook design — optimised for many future principal classes (team, project, etc.) sharing complex memory and policy patterns. | **Rejected.** Over-engineered for V1 reality. Complexity tax on every cross-cutting concern (RLS, audit, billing, retention) without a near-term consumer needing the extra abstraction. |

### 0.3 Why the simpler shape works

Trade-off accepted by Option B: **memory does not auto-share across multiple user-owned agents for the same user**. If Michael has both an EA and a Dev Agent (Phase 3), each agent has its own memory row set. They don't read each other's memory.

Why this is fine:
- Most users will have one user-owned agent, not many. The "shared memory across my personal agents" use case is hypothetical.
- If shared memory becomes a real need later, it's an additive change (introduce `user_memory_blocks` keyed by user_id, agents opt-in to consuming it). No retrofit of the per-agent model.
- The RLS, audit, billing, and retention complexity of Option C is real today regardless of whether shared memory ever materialises.

### 0.4 Strategic framing — this build is foundation, not product

The strategic asset this build creates is **the ability to deploy an agent that acts under a specific user's identity inside SynthetOS governance**. The Executive Assistant (EA V1) is the first consumer; Dev Agent (Phase 3) is the second; future personal agents are subsequent.

This build is NOT framed as an Executive Assistant product. The brief, schema, naming, and acceptance criteria are deliberately agent-template-neutral. EA-specific behaviour lives in the EA V1 brief, not here.

### 0.5 Decision provenance

The challenge round that produced this rewrite is recorded in the chat transcript on branch `claude/synthetos-personal-assistant-0kaIM` (operator pushback on abstraction overhead, ChatGPT analysis on competitive positioning vs Claude / ChatGPT / Codex, synthesis into Option B). Three decisions were ratified:

1. Schema simplification — `owner_user_id` only, no principal abstraction.
2. Strategic framing — user-owned agents primitive, not personal-assistant product.
3. Tightened V1 scope on the EA side (autonomous calendar writes deferred, all third-party sends review-gated). Lives in EA V1 brief; flagged here only because it informs the foundation.

The reviewer should read this section first to understand what was rejected and why before evaluating the spec.

## 1. Purpose

Today every agent in SynthetOS is implicitly owned by a subaccount. Credentials, memory, and run records all key off `subaccount_id`. This works for the existing agent set (Sarah, Riley, Helena, Patel, Johnny, Dana, Support Agent, etc.) — they do work for the customer organisation.

The Executive Assistant (master brief §16.1) and Dev Agent (§16.3) break that assumption. Both act on behalf of **a specific human** — that human's email, calendar, GitHub, IDE session, personal Slack identity. Credentials are "Michael's Gmail," not "Acme Co's mail server." Run history is "what did Michael's EA do this week," not "what happened in the Acme subaccount."

This build adds a single mechanism to support that: agents can have an explicit human owner via `agents.owner_user_id`. When set, credentials resolve to that user's connections; runs are scoped to that user; admin visibility is redacted by default; the user's home and sidebar surface the agent.

After this lands the platform capability is:

> SynthetOS supports agents that act under a specific user's identity inside the org's governance boundary. The Executive Assistant is the first consumer; Dev Agent is the second.

This brief locks scope. The spec is authored next.

## 2. What's locked from upstream

| Capability | Source | Status |
|---|---|---|
| Three-tier agent model (System / Org / Subaccount) + `agents` table + `subaccount_agents` link table | shipped | shipped |
| Hierarchical agent delegation + `DelegationScope` enum + root-agent contract | shipped | shipped |
| `agent_runs` table including `controllerStyle`, `policy_envelope_snapshot` JSONB | Phase 1 foundation #279 | merged |
| `CredentialBrokerService` facade (subaccount-scoped retrieval, `injectIntoEnvironment` returns redacted envelope) | Phase 1 foundation #279 | merged |
| Policy Envelope per-run JSONB snapshot on `agent_runs.policy_envelope_snapshot` | Phase 1 foundation #279 | merged |
| Run Trace virtual view over 7 ledger tables | Phase 1 foundation #279 | merged |
| Risk Tier annotation + `verify-risk-tier-assigned` CI gate | Phase 1 foundation #279 | merged |
| `users` table + `workspaceActors` (operator identity model) | shipped | shipped |
| Existing per-agent memory model (`memory_blocks` keyed by `agent_id`) | shipped | shipped |

Nothing on the foundation needs to change before this build. The work is purely additive: one nullable column on `agents`, one nullable column on `agent_runs`, an additive parameter on the credential broker, one RLS clause, one redaction-policy layer, one doc update.

## 3. What this spec must define

### 3.1 `owner_user_id` on the agents table

One new column on `agents`:

- `owner_user_id` — uuid, NULLABLE, references `users.id` ON DELETE RESTRICT.
- NULL = subaccount-owned (current behaviour, no change for any existing agent).
- Non-NULL = owned by a specific user. The agent acts under that user's identity for credential resolution, RLS scoping, run-history attribution.

Index: `(organisation_id, owner_user_id)` partial index `WHERE owner_user_id IS NOT NULL`. Used by the home-page Personal zone, sidebar Personal nav group, and admin metadata views.

The agent's `subaccount_id` continues to indicate the organisational context the agent operates in (which subaccount is paying, which subaccount its work counts against). `owner_user_id` is orthogonal — a user-owned agent still lives in a subaccount; it just additionally has a human owner.

`ON DELETE RESTRICT`: if a user is deleted, deletion is blocked until their owned agents are explicitly archived/deleted. This prevents silent agent orphaning. Lifecycle handling for user offboarding (transfer / archive / hard-delete) is documented in §5 as out of V1 scope; the FK behaviour just enforces the rule.

### 3.2 `owner_user_id` on agent runs

One new column on `agent_runs`:

- `owner_user_id` — uuid, NULLABLE.
- Set at run creation by copying from the parent agent's `owner_user_id`.
- Once set on a run, immutable.

Index: `(organisation_id, owner_user_id, started_at DESC)` partial index `WHERE owner_user_id IS NOT NULL`. Used by Personal-zone activity views and per-user Run Trace filtering.

For runs created by subaccount-owned agents (the existing 99%), `owner_user_id` stays NULL. Zero behaviour change for current code paths.

### 3.3 Credential broker scoping rule

The `CredentialBrokerService` lookup signature gains an optional parameter:

```ts
broker.injectIntoEnvironment({
  subaccountId,
  provider,
  ownerUserId,    // NEW — optional. If provided, broker scopes lookup to this user's connections.
  env,
}): Promise<...>
```

Resolution rules:

- `ownerUserId` omitted → look up `integration_connections` by `(organisation_id, subaccount_id, provider)` — current behaviour, no change.
- `ownerUserId` provided → look up `integration_connections` by `(organisation_id, subaccount_id, owner_user_id, provider)`. Requires `integration_connections.owner_user_id` column (new, nullable; NULL for existing subaccount-level connections).

Defence-in-depth invariants the spec enforces:

1. Adapter callers MUST pass `ownerUserId` when the agent has `owner_user_id` set on its row. Broker MUST assert the returned credential's `owner_user_id` matches the requested value. Mismatch = typed error `OWNER_MISMATCH`, run fails closed.
2. Broker emits a Run Trace event `credential.resolved` with `subaccountId`, `ownerUserId` (or null), `provider`, and `connectionId`. Raw token never leaves the broker — Spec C invariant carried forward.
3. Revocation is owner-scoped: revoking Michael's Gmail connection does not affect any other user's Gmail or the subaccount's Gmail.

UI implication (out of scope for THIS spec, called out for downstream consumers): the Connections page eventually distinguishes "Acme Co's Gmail" (subaccount connection, `owner_user_id IS NULL`) from "Michael's Gmail" (user connection). EA V1's brief carries that change.

### 3.4 Memory remains per-agent (no scope abstraction)

This is the deliberate simplification vs the rejected Option C (`scope_type` + `scope_id` on memory_blocks).

`memory_blocks` is unchanged. Memory continues to be linked to a specific `agent_id`. Each user-owned agent has its own memory rows by virtue of being a separate agent row. The principle: when an EA agent is provisioned for Michael, that agent's `memory_blocks` rows belong to that agent — nobody else's agent can read them, by existing per-agent RLS.

Trade-off: memory is not auto-shared between Michael's EA and (future) Michael's Dev Agent. If shared user-scoped memory becomes a real need later, it lands as an additive primitive (`user_memory_blocks` keyed by user_id, agents opt-in to consuming it). No retrofit of the per-agent model.

Why this is the right call for V1: shared memory across multiple personal agents is a hypothetical need. The complexity of building scoped memory now (additional column, index, query path, RLS, consistency rules) is real and pays off only when the hypothetical materialises. Defer.

### 3.5 RLS clause for user-owned agent runs

Existing FORCE RLS on `agent_runs` keys off `organisation_id` and `subaccount_id`. This build adds one clause for `owner_user_id`:

```sql
-- Pseudo-policy. Spec writes the canonical form.
CREATE POLICY agent_runs_user_owned_visibility ON agent_runs
  USING (
    owner_user_id IS NULL  -- subaccount-owned runs follow existing visibility
    OR owner_user_id = current_setting('app.current_user_id')::uuid  -- you see your own
    OR current_setting('app.current_role')::text IN ('org_admin', 'system_admin')  -- admins see (subject to redaction at API layer per §3.6)
  );
```

Existing visibility rules for subaccount-owned runs are unchanged. The new clause adds:

- A user can read their own user-owned runs.
- An admin can read all user-owned runs as rows, but content fields are redacted at the API serialisation layer (§3.6).
- Other users in the org cannot read someone else's user-owned runs.

Spec defines analogous policies for any other table that gains `owner_user_id` (notably `integration_connections`).

### 3.6 Admin visibility and redaction policy

User-owned agents handle personal data (inbox content, calendar attendees, Slack thread quotes, memory blocks, voice profile inputs). Default visibility for org admins and subaccount admins MUST honour privacy expectations consistent with industry best practice (Slack admins can't silently read employee DMs; 1Password admins can't read user vaults; Google Workspace audit access is logged and visible).

**Default visibility for user-owned agent runs:**

| Surface | Owning user | Subaccount admin | Org admin |
|---|---|---|---|
| Run trace metadata (action, status, duration, cost) | full | full | full |
| Run trace content payload (inbox snippets, calendar attendees, Slack quotes, prompt text the agent reasoned over) | full | **REDACTED** | **REDACTED** |
| Memory blocks (user-owned agents) | full | **REDACTED** | **REDACTED** |
| Voice Profile content (the derived `profile_json`) | full | **REDACTED** | **REDACTED** |
| Connection presence ("Michael has Gmail connected") | full | full (presence only) | full (presence only) |
| Cost roll-up | full | full | full |
| Spending budget breaches and approvals | full | full | full |

**Break-glass admin override:**

- Org admins can request access to a user-owned agent's redacted content via a documented compliance path.
- The override action requires explicit org-admin action and writes a typed audit event `owner.content_revealed` to Run Trace.
- The affected user is notified (email + in-app banner) the next time they log in.
- Override grant is time-limited (default 7 days) and scoped to a specific run-id range, not blanket access.

Implementation: redaction happens at the API serialisation layer (Run Trace endpoint, memory-blocks endpoint, voice-profile endpoint). RLS policies enforce row-level access; redaction is the second layer (column-level mask) for rows the admin CAN see but should not have full content of.

V1 build delivers the redaction layer and the typed audit event. The break-glass UI surface (admin clicks "request access") is deferred to a Phase 1.5 follow-on — V1 ships with the redaction enforced and the audit-event types defined, but admins requesting access do so via direct DB / API call until the UI surface lands. Acceptable because V1 dogfood is single-user (no admin investigation needed before customer adoption).

### 3.7 Migration of existing agents

Trivial. The migration:

1. Adds `agents.owner_user_id` column nullable.
2. Adds `agent_runs.owner_user_id` column nullable.
3. Adds `integration_connections.owner_user_id` column nullable.
4. Creates the partial indexes from §3.1, §3.2.
5. Adds the RLS clauses from §3.5.

No backfill needed — every existing row stays at `owner_user_id IS NULL` and behaves exactly as it does today. Down-migration drops the columns + indexes + policies.

This is the headline simplification vs the rejected Option C, which required schema changes to multiple tables, denormalisation triggers, and a virtual-view rewrite.

### 3.8 Cross-ownership delegation (design note)

A user-owned agent might call into a subaccount-owned agent (or vice versa). Example: Michael's EA delegates a research task to Sarah-the-analyst (subaccount-owned).

V1 does not implement cross-ownership delegation. Existing hierarchical delegation (`DelegationScope` enum) is assumed to operate within a single ownership context. This brief flags the future requirement so the design is not retrofitted into the run-attribution model later:

- When cross-ownership delegation lands, the delegated run carries BOTH the initiator's owner context AND the executor's. In the run-trace, the chain shows: `Michael's EA (owner_user_id = michael) → Sarah-the-Analyst (owner_user_id = NULL, subaccount-owned) → action`.
- Credential resolution at each hop uses the executor's ownership, not the initiator's. The subaccount agent uses its own connected accounts; the user-owned agent uses its user's accounts.
- Audit attribution shows both. Privacy: when an admin reads the trace, content from the user-owned hop is still redacted per §3.6.

No schema change required today. The `delegation_outcomes` ledger already has the rows needed; the existing `subaccount_id` and the new `owner_user_id` together describe each hop. Implementing cross-ownership delegation later is purely a routing / UI / authorisation rule change, not a foundation change.

This note exists so future readers do not assume "user-owned agents and subaccount-owned agents are siloed" as a design constraint. They are not siloed; they simply do not delegate to each other yet.

### 3.9 Master brief doc update

The v1.2 master brief §5.1 says:

> Agents are organisational entities. They represent roles, responsibilities, goals, and ownership within an organisation.

This spec adds a sentence (in the same commit as the build):

> Agents may additionally be owned by a specific user. User-owned agents act under that user's identity for credential resolution, run attribution, and privacy boundary. Today's example is the Executive Assistant (master brief §16.1); Phase 3 adds the Dev Agent (§16.3). Subaccount-owned agents (the existing default) cover the remaining use cases.

Master brief §9 (Credential Broker) adds: "Broker resolves credentials by `(subaccount_id, provider)` for subaccount-owned agents and by `(subaccount_id, owner_user_id, provider)` for user-owned agents."

`architecture.md` and `KNOWLEDGE.md` get matching short entries per the standard doc-sync sweep.

## 4. Open architectural questions

The challenge round (§0.5) resolved most of the open questions from the earlier `principal-scoped-agents` brief by rejecting the principal abstraction. Remaining items for spec-time decision:

1. **`integration_connections.owner_user_id` indexing.** Recommendation: partial unique index on `(organisation_id, subaccount_id, owner_user_id, provider) WHERE owner_user_id IS NOT NULL` so a single user cannot have two active connections of the same provider type. Confirm at spec time.

2. **`ON DELETE` behaviour for `agents.owner_user_id`.** Recommendation: `ON DELETE RESTRICT`. Prevents silent orphaning when a user is deleted; forces explicit lifecycle handling. Spec confirms.

3. **Display surface for `owner_user_id` in audit logs.** Recommendation: include `owner_user_id` (raw UUID) in audit-event payloads for cross-reference, but never embed display name (privacy-vs-debuggability trade-off; user identifier is enough for joins). Spec confirms.

4. **Reuse acceptance criterion for the foundation primitive.** The primitive is only worth building if it earns its keep with at least one second consumer beyond EA. Recommendation: spec includes a stub or placeholder Dev Agent system-agent template that demonstrates the same primitive resolves credentials, scopes runs, and surfaces in the Personal zone (the Personal zone visual lives in EA V1 build, not here — but the data path must work for the stub). Spec confirms whether the stub ships in this build or only the test/contract.

## 5. Out of scope (explicit non-goals)

| Out of scope | Belongs in |
|---|---|
| User-owned agent UI surfaces (Personal nav group, home Personal zone, per-agent tabbed detail page) | EA V1 build (ships these as the first consumer) |
| Voice Profile primitive | EA V1 build (introduced as separate generic primitive) |
| First-run setup wizard for user-owned agents | EA V1 build |
| Capability grouping layer for the connection UI | EA V1 build |
| Shared user-scoped memory across multiple user-owned agents | Future additive primitive (`user_memory_blocks` if a real need emerges) |
| `principal_type` enum / `principal_id` denormalisation / `scope_type` on memory_blocks | Rejected per §0 — Option C |
| Polymorphic FK for owner identity | Rejected — Option C variation, same engineering reasons |
| Per-link override on `subaccount_agents` (different owner per link) | Not needed — multi-user EA pattern is multiple agent rows sharing a `system_agent_id`, each with its own `owner_user_id` |
| Cross-ownership delegation (user-owned agent calls into subaccount-owned agent or vice versa) | Future spec — schema supports it; runtime routing rules deferred |
| Org-owned agents as a distinct ownership class | Not needed in V1 — existing org-scope agents (orchestrator, head-of-X) stay subaccount-NULL-owned via the existing pattern |
| Operator impersonation (Sarah running Michael's EA while he's on holiday) | Future work; V1 explicitly forbids cross-user impersonation |
| Customer-facing productisation of user-owned agents | Not in roadmap |

## 6. What unblocks when this ships

- **Executive Assistant V1** can author against `agents.owner_user_id` from day one. EA V1 becomes a use-case build that consumes a primitive, not a use-case that hacks in a new schema concept.
- **Dev Agent (Phase 3)** reuses the same column for the developer's GitHub / IDE / cloud-CLI identity. No retrofit.
- **Future personal agents** (financial assistant, research assistant, writing assistant) plug into the ownership model with no foundation work.
- **Multi-user dogfood** of any user-owned agent becomes a UI question, not a data-model question.
- **The Credential Broker becomes owner-aware** — the Phase 1 named facade gets its second axis of resolution (subaccount + optional user), matching master brief §9's full intent (Credential Broker AND Identity Boundary).

## 7. Sequencing

**Mockups required: no.** This build is foundation work — schema, service signatures, RLS clauses, doc updates. No new UI surfaces ship from this build. The UI work (Personal zone, sidebar group, per-agent detail tabs, "Personal" connection chip) lives in EA V1 build.

**Build sequencing:**

1. Operator reviews this brief, locks §4 decisions (4 sanity-check items remain).
2. Operator spawns a new Claude Code session, branch `claude/user-owned-agents-{nonce}` off post-#279 main.
3. Session adopts `spec-coordinator`: brief intake (this doc) → spec authoring → `spec-reviewer` (Codex loop) → `chatgpt-spec-review` (manual rounds) → handoff to `feature-coordinator`.
4. Build session ships: migration (3 columns + 3 partial indexes + 2 RLS clauses), `CredentialBrokerService` signature extension, redaction layer at API serialisation, doc-sync sweep (master brief §5.1 + §9 + `architecture.md` + `KNOWLEDGE.md`), tests for the broker invariants and the redaction layer, optional Dev Agent stub per §4 q4.
5. Phase 3 (`finalisation-coordinator`) ships the canonical doc-sync + MERGE_READY transition.

Rough estimate: 1.5–2 dev-days for the build session (down from the 3–4 day estimate for the rejected Option C). The headline saving is the absence of memory-scoping work, view-projection work, denormalisation triggers, and the cross-cutting RLS rewrite.

**Concurrency with Spec D (operator-backend):** YES, run concurrent. Conflict surface is small and predictable:

- **No collision on Run Trace event emitters.** Spec D emits new event rows into existing ledger tables. This build adds `owner_user_id` to `agent_runs` (one row per run); admins reading the trace via existing endpoints get the new column for free.
- **`agent_runs` schema overlap.** This build adds one column. Spec D writes to existing columns and authors no schema changes on `agent_runs`. Additive columns merge cleanly in drizzle.
- **`policy_envelope_snapshot` shape overlap.** Neither build mutates the existing shape. If future work adds `owner_user_id` to the envelope payload, that's a separate spec; today the envelope is unchanged.
- **Migration numbering.** Whoever merges second renumbers (standard concurrent-build pattern).
- **CredentialBroker signature.** Additive parameter with default. Existing Spec D credential-injection calls in the Operator Backend adapter continue to work; Spec D opts into the owner-aware signature when it adopts user-owned credentials for the EA's operator-mode runs (V2).

**Sequencing relative to EA V1:**

EA V1 references `user-owned-agents` as a locked predecessor in its §2. EA V1 build starts only after `user-owned-agents` is merged. If both briefs are ratified in close succession, `user-owned-agents` ships first (smaller blast radius, foundation), EA V1 ships second (use case consuming the primitive).

**Branch:** `claude/user-owned-agents-{nonce}` off post-Phase-1-foundation `main` (any commit at or after #279).

## End of brief


## End of brief
