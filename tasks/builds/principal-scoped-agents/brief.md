**Status:** DRAFT (2026-05-12) — awaiting operator sign-off before spec authoring
**Date:** 2026-05-12
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `principal-scoped-agents`
**Successor placeholder:** `tasks/builds/personal-assistant-v1/brief.md` (first consumer)
**Concurrent with:** Spec D `tasks/builds/operator-backend/brief.md` (small predictable conflict surface — see §7)
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §5.1 (agents are organisational entities), §6.6 (Model Access and Identity), §9 (Credential Broker and Identity Boundary), §16.1 (Executive Assistant), §16.3 (Dev Agent)

# Principal-Scoped Agents — Build Brief

## Contents

- [0. Naming decision (read first)](#0-naming-decision-read-first)
- [1. Purpose](#1-purpose)
- [2. What's locked from upstream](#2-whats-locked-from-upstream)
- [3. What this spec must define](#3-what-this-spec-must-define)
  - [3.1 Principal type and id on agents](#31-principal-type-and-id-on-agents)
  - [3.2 Principal on the run record](#32-principal-on-the-run-record)
  - [3.3 Credential Broker principal-aware lookup](#33-credential-broker-principal-aware-lookup)
  - [3.4 Policy Envelope principal context](#34-policy-envelope-principal-context)
  - [3.5 Run Trace virtual-view principal projection](#35-run-trace-virtual-view-principal-projection)
  - [3.6 Memory blocks principal scope](#36-memory-blocks-principal-scope)
  - [3.7 Migration of existing agents and memory to default principal](#37-migration-of-existing-agents-and-memory-to-default-principal)
  - [3.8 Admin visibility and redaction policy](#38-admin-visibility-and-redaction-policy)
  - [3.9 Cross-principal delegation (design note)](#39-cross-principal-delegation-design-note)
  - [3.10 Master brief doc update](#310-master-brief-doc-update)
- [4. Open architectural questions (for operator ratification)](#4-open-architectural-questions-for-operator-ratification)
- [5. Out of scope (explicit non-goals)](#5-out-of-scope-explicit-non-goals)
- [6. What unblocks when this ships](#6-what-unblocks-when-this-ships)
- [7. Sequencing](#7-sequencing)

## 0. Naming decision (read first)

This spec introduces the term **"agent principal"** to SynthetOS. The principal of an agent is the entity it acts on behalf of. Today every agent has an implicit principal of "the subaccount." This spec makes the principal explicit and extends the model with a second principal class: a specific user.

Rename / additive map:

| Concept | Today | After this spec |
|---|---|---|
| What an agent acts on behalf of | Implicit subaccount | Explicit `principal_type` ∈ `{ 'subaccount', 'user' }` (forward-compat slot for `'org'`) |
| How credentials are resolved | `(subaccount_id, provider)` | `(subaccount_id, provider)` for subaccount-principal; `(subaccount_id, user_id, provider)` for user-principal |
| How runs identify whose work this is | `agent_runs.subaccount_id` only | `agent_runs.subaccount_id` + `agent_runs.principal_type` + `agent_runs.principal_id` |

The vocabulary "agent principal" mirrors the existing **operator principal** concept in the auth system (the workspace actor that initiated an action). The two are intentionally analogous — an operator principal is who initiated the request; an agent principal is who the agent is acting for. They are usually the same person but can differ (an operator opens an EA on behalf of a colleague during onboarding).

## 1. Purpose

Today every agent in SynthetOS implicitly acts on behalf of the subaccount it lives in. Credentials, run records, policy envelope, and Run Trace all key off `subaccount_id`. This works for use cases where the agent is doing subaccount-level work (CRM updates, support inbox triage, ad performance summaries, paid-ads optimisation) — the entity is the customer organisation, not any one person.

The Executive Assistant (master brief §16.1) and Dev Agent (§16.3) break that assumption. Both act on behalf of **a specific human** — their email, their calendar, their GitHub, their IDE session, their personal Slack identity. Credentials are "Michael's Gmail," not "Acme Co's mail server." Run history is "what did Michael's EA do this week," not "what happened in the Acme subaccount."

Retrofitting principal scoping after these agents ship means migrating every existing connection, run record, and policy envelope to carry a new key. Designing it now, before the first user-principal agent lands, costs roughly 3–4 dev-days and keeps the foundation clean.

After this lands the platform capability is:

> Agents declare what kind of entity they act for. Credentials, runs, policy, and audit honour that declaration. Adding a "personal" agent — EA, Dev Agent, future personal research / writing / financial agents — costs nothing extra at the foundation layer.

This brief locks scope. The spec is authored next.

## 2. What's locked from upstream

| Capability | Source | Status |
|---|---|---|
| Three-tier agent model (System / Org / Subaccount) + `agents` table + `subaccount_agents` link table | shipped | shipped |
| Hierarchical agent delegation + `DelegationScope` enum + root-agent contract | shipped | shipped |
| `agent_runs` table including `controllerStyle`, `policy_envelope_snapshot` JSONB | Phase 1 foundation #279 | merged |
| `CredentialBrokerService` facade (subaccount-scoped retrieval, `injectIntoEnvironment` returns redacted envelope) | Phase 1 foundation #279 | merged |
| Policy Envelope per-run JSONB snapshot on `agent_runs.policy_envelope_snapshot` | Phase 1 foundation #279 | merged |
| Run Trace virtual view over 7 ledger tables (`agent_execution_events`, `routing_outcomes`, `delegation_outcomes`, `tool_call_security_events`, `reviewAuditRecords`, plus the additions from #279) | Phase 1 foundation #279 | merged |
| Risk Tier annotation + `verify-risk-tier-assigned` CI gate | Phase 1 foundation #279 | merged |
| `users` table + `workspaceActors` (operator principal model) | shipped | shipped |
| Operator-principal pattern (who initiated an action) — used as conceptual sibling to the agent-principal model this spec introduces | shipped | shipped |

Nothing on the foundation needs to change before this spec lands. The work is additive: new columns, extended broker signature, view projection, doc updates.

## 3. What this spec must define

### 3.1 Principal type and id on agents

New columns on `agents` (and mirrored on `subaccount_agents` if per-link override is needed — spec confirms):

- `principal_type` — text, NOT NULL, default `'subaccount'`, CHECK constraint `IN ('subaccount', 'user')`. Forward-compat slot `'org'` reserved but not in V1.
- `principal_id` — uuid, NOT NULL. For `principal_type = 'subaccount'`, equals the agent's `subaccount_id` (redundant denormalisation; intentional — read sites do not need a CASE on principal type). For `principal_type = 'user'`, references `users.id`.

The denormalisation is the deliberate design call. Code that needs "whose work is this" reads two columns and does not branch. The trade-off: `principal_id` for a subaccount-principal agent must stay in sync with `subaccount_id` (DB trigger or check constraint; spec picks).

Indexes:
- `(organisation_id, principal_type, principal_id)` for principal-scoped queries.
- Existing subaccount index retained — no change.

### 3.2 Principal on the run record

New columns on `agent_runs`:

- `principal_type` — text, NOT NULL, default `'subaccount'`, CHECK `IN ('subaccount', 'user')`.
- `principal_id` — uuid, NOT NULL.

Set at run creation from the parent agent's principal. Once set on a run, immutable. Used by Run Trace projection (§3.5), policy envelope (§3.4), and any downstream audit query that needs "what did this user's agents do today."

For runs created by a subaccount-principal agent, the new columns mirror the existing subaccount fields — zero behaviour change for current code paths.

### 3.3 Credential Broker principal-aware lookup

Extends `CredentialBrokerService` lookup signature additively:

```ts
// Current
broker.injectIntoEnvironment({ subaccountId, provider, env }): Promise<...>

// After this spec
broker.injectIntoEnvironment({
  subaccountId,
  provider,
  principalType,   // NEW (defaults to 'subaccount' if omitted)
  principalId,     // NEW (defaults to subaccountId if omitted)
  env,
}): Promise<...>
```

Resolution rules:
- `principalType = 'subaccount'` → look up `integration_connections` by `(organisation_id, subaccount_id, provider)` — current behaviour, no change for existing callers.
- `principalType = 'user'` → look up `integration_connections` by `(organisation_id, subaccount_id, user_id, provider)`. Requires `integration_connections.user_id` column (new, nullable; null for subaccount-principal connections).

Defence-in-depth invariants the spec must enforce (carry-forward from #279 ADV-B closure):

1. Adapter callers MUST pass the principal context from the agent run. Broker MUST assert returned credential matches the requested principal (subaccount + user where applicable) before injection. Mismatch = typed error `PRINCIPAL_MISMATCH`, run fails closed.
2. Broker emits a Run Trace event `credential.resolved` with `principalType`, `principalId`, `provider`, and `connectionId` (raw token never leaves the broker — Spec C invariant carried forward).
3. Revocation is principal-scoped: revoking a user-principal connection does not affect subaccount-principal connections under the same subaccount.

UI implication (out of scope for THIS spec, called out for downstream consumers): connection cards eventually need to distinguish "Acme Co's Gmail" (subaccount) from "Michael's Gmail" (user) on the Connections page. Not shipped here.

### 3.4 Policy Envelope principal context

The Policy Envelope JSONB snapshot on `agent_runs.policy_envelope_snapshot` gains a `principal` clause:

```jsonc
{
  // existing fields
  "controllerStyle": "native",
  "riskTierCeiling": 5,
  "approvalPolicy": { ... },
  // NEW
  "principal": {
    "type": "user",
    "id": "uuid-here",
    "displayHint": "Michael Hazza"  // optional, for log readability — NEVER source of truth
  }
}
```

Spec confirms:
- Whether `displayHint` is captured at all (privacy-vs-debuggability trade-off).
- That the `principal` clause is set at envelope construction, before any policy resolution rules read it (some policy rules may legitimately depend on principal — e.g. "user-principal agents have a lower Tier 6 ceiling because the operator is the only reviewer").
- That envelope is immutable per run (existing invariant) — principal cannot be swapped mid-run.

### 3.5 Run Trace virtual-view principal projection

The Run Trace virtual view (`run_trace_v1`) unions 7+ ledger tables and projects a canonical event-row shape. This spec adds `principal_type` and `principal_id` to the view's projected columns.

**The design call that keeps blast radius small:** principal lives on `agent_runs` (one row per run), NOT on each event ledger. The view JOINs to `agent_runs` to project the principal field through every event automatically.

Consequences:
- **No event-emitter changes anywhere.** Spec D's operator backend emitters, the IEE adapter, the agentic loop middleware, the trust-verification layer — none touch their ledger insert sites. The principal field flows through the view's join.
- **The migration is a single view replacement** (`CREATE OR REPLACE VIEW run_trace_v1 AS ...`). The new view adds two columns to the row shape. Consumers that `SELECT *` get them automatically; consumers that named-column-select continue to work unchanged.
- **The principal index on `agent_runs` (§3.1) makes the view's join cheap.**

Spec also confirms whether the existing Run Trace UI (`client/src/pages/RunTracePage.tsx`) needs to surface principal in the per-event row. Recommendation: NOT in V1 — surface it on the run-summary header instead ("Run for Michael, Personal Assistant agent"). Per-event principal cluttering is reserved for the eventual canonical ledger consolidation (Phase 3+).

### 3.6 Memory blocks principal scope

Memory today is subaccount-scoped via `memory_blocks.subaccount_id`. User-principal agents need user-scoped memory ("Michael's preferences", not "Acme Co's preferences").

Schema change parallel to the agent principal pattern:

- `memory_blocks.scope_type` — text, NOT NULL, default `'subaccount'`, CHECK `IN ('subaccount', 'user', 'org')`.
- `memory_blocks.scope_id` — uuid, NOT NULL. Backfilled from `subaccount_id`.

`runContextLoader` (and any other memory-reading site) queries by the run's principal: `WHERE organisation_id = ? AND scope_type = run.principal_type AND scope_id = run.principal_id`.

Bounded scope — what this spec does NOT add:
- No new memory types beyond the existing `memory_blocks` shape.
- No auto-derivation from inbox / calendar / external sources (Voice Profile in EA V1 is a separate primitive, not memory).
- No cross-user memory sharing.
- No memory-driven knowledge graphs.
- No new admin UI for memory management (existing `update_memory_block` action stays unchanged; users edit their own memory through the agent's normal interaction).

Total cost: one schema migration, one query-path change in `runContextLoader`, one backfill. ~1 dev-day inside this build.

### 3.7 Migration of existing agents and memory to default principal

Every existing row in `agents` and `agent_runs` is set to `principal_type = 'subaccount'`, `principal_id = subaccount_id` by the migration. The CHECK constraint and NOT NULL enforce this for future inserts.

For `agents` where `subaccount_id` is null today (org-scoped agents), spec confirms whether they get `principal_type = 'org'` (the forward-compat slot) or stay subaccount-defaulted with `principal_id = organisation_id`. Recommendation: introduce `'org'` as an active value (not just forward-compat) so org-scoped agents are correctly labelled from day one.

Migration order:
1. Add columns nullable.
2. Backfill from existing `subaccount_id` / org-scope.
3. Set NOT NULL + CHECK.
4. Add indexes.
5. Replace view.

Backfill is idempotent. Reversible down-migration drops columns + view + indexes; spec authors the down-script.

### 3.8 Admin visibility and redaction policy

User-principal agents handle personal data (inbox content, calendar attendees, Slack thread quotes, memory blocks). Default visibility for org admins and subaccount admins MUST honour privacy expectations consistent with industry best practice (Slack admins can't silently read employee DMs; 1Password admins can't read user vaults; Google Workspace audit access is logged and visible).

**Default visibility for user-principal runs:**

| Surface | Owner (the user-principal) | Subaccount admin | Org admin |
|---|---|---|---|
| Run Trace metadata (action, status, duration, cost) | full | full | full |
| Run Trace content payload (inbox snippets, calendar attendees, Slack quotes, prompt text the agent reasoned over) | full | **REDACTED** | **REDACTED** |
| Memory blocks (user-scoped) | full | **REDACTED** | **REDACTED** |
| Voice Profile content (the derived profile_json) | full | **REDACTED** | **REDACTED** |
| Connection presence ("Michael has Gmail connected") | full | full (presence only) | full (presence only) |
| Cost roll-up | full | full | full |
| Spending budget breaches and approvals | full | full | full |

**Break-glass admin override:**

- Org admins can request access to a user-principal agent's redacted content via a documented compliance path.
- The override action requires explicit operator (org-admin) action and writes a typed audit event `principal.content_revealed` to Run Trace.
- The affected user is notified (email + in-app banner) the next time they log in.
- Override grant is time-limited (default 7 days) and scoped to a specific run-id range, not blanket access.

Implementation: redaction happens at the API serialisation layer (Run Trace endpoint, memory-blocks endpoint, voice-profile endpoint). RLS policies enforce row-level access; redaction is the second layer (column-level mask) for rows the admin CAN see but should not have full content of.

V1 build delivers the redaction layer and the typed audit event. The break-glass UI surface (admin clicks "request access") is deferred to a Phase 1.5 follow-on — V1 ships with the redaction enforced and the audit-event types defined, but admins requesting access do so via direct DB / API call until the UI surface lands. This is consistent with single-user dogfood reality (no admin investigation needed before customer adoption).

### 3.9 Cross-principal delegation (design note)

Cross-principal delegation is the case where a user-principal agent calls into a subaccount-principal agent (or vice versa). Example: Michael's EA delegates a research task to Sarah-the-analyst (subaccount-principal).

V1 does not implement cross-principal delegation. Existing hierarchical delegation (`DelegationScope` enum) is assumed to operate within a single principal. This brief flags the future requirement so the design does not get retrofitted into the run-attribution model later:

- When cross-principal delegation lands, the delegated run carries BOTH principals — the initiator's (the EA's user-principal) AND the executor's (Sarah's subaccount-principal).
- Run Trace surfaces the delegation chain with principal at each hop.
- Credential resolution at each hop uses the executor's principal, not the initiator's (the agent uses its OWN connected accounts, not the initiator's).
- Audit attribution shows the chain: "Michael's EA → Sarah-the-Analyst → action".

No schema change required today. The `delegation_outcomes` ledger already has the rows needed; the principal projection from §3.5 carries the field through. Implementing cross-principal delegation later is purely a routing / UI / authorisation rule change, not a foundation change.

This note exists so the brief explicitly forecloses on the "user-principal agents and subaccount-principal agents are siloed" assumption, in case anyone reads §3.1–§3.7 and infers that as a design constraint. They are not siloed; they simply do not delegate to each other yet.

### 3.10 Master brief doc update

The v1.2 master brief §5.1 says:

> Agents are organisational entities. They represent roles, responsibilities, goals, and ownership within an organisation. They belong to the organisation structure.

This spec adds the principal axis as a sub-clause. Recommended doc edit (spec lands it in the same commit):

> Agents act on behalf of a **principal** — the entity whose authority and identity the agent uses. The principal can be the subaccount (most agents — Support Agent, Revenue Ops, Paid Ads Monitoring, Sarah, Johnny, Helena, Patel, Riley, Dana) or a specific user (Executive Assistant, Dev Agent, future personal agents). Principal is orthogonal to role: the agent's role is "who owns this work in the organisation chart"; the principal is "whose credentials, calendar, mail, and audit footprint does this work appear under."

Master brief §9 (Credential Broker) is updated to acknowledge that the broker resolves credentials by principal context, not just by subaccount. `architecture.md` and `KNOWLEDGE.md` get matching short entries per the standard doc-sync sweep.

## 4. Open architectural questions (for operator ratification)

Status legend: **LOCKED** = ratified by operator on 2026-05-12 chat; **OPEN** = none remaining.

1. **`'org'` principal type — active or reserved.** **LOCKED: active.** Org-level agents (orchestrator, head-of-X) act for the org. Tagging them `'org'` from day one is correct attribution.

2. **Denormalise `principal_id = subaccount_id` for subaccount-principal agents.** **LOCKED: yes, denormalise.** Read sites become one-column lookups, no CASE branching. Sync invariant enforced by CHECK constraint + trigger.

3. **`principal_id` foreign-key target.** **LOCKED: no DB FK.** Service-layer validation in the broker. Standard codebase pattern.

4. **Per-link principal override on `subaccount_agents`.** **LOCKED: no override.** Principal lives on the agent row. Multi-user EA pattern is multiple agent rows sharing a `system_agent_id`, not a per-link override.

5. **`displayHint` in policy envelope snapshot.** **LOCKED: omitted entirely.** No config knob, no admin toggle. The `id` is sufficient for audit joins. Less UI optionality is better.

6. **Migration of existing org-scoped agents (orchestrator, heads).** **LOCKED: assign `principal_type: 'org'`, `principal_id: organisation_id`.** Confirms #1's "active" decision in practice.

7. **RLS for user-principal runs.** **LOCKED: yes, restrict to owning user by default.** Each user sees their own user-principal agent's runs; org admins see all VIA the redaction policy in §3.8 (metadata visible, content redacted). Spec implements row-level visibility filter on `agent_runs` for user-principal rows.

8. **CredentialBroker backward-compat.** **LOCKED: yes, additive params with defaults.** Omitted `principalType` defaults to `'subaccount'`; omitted `principalId` defaults to `subaccountId`. Existing call sites work unchanged.

## 5. Out of scope (explicit non-goals)

| Out of scope | Belongs in |
|---|---|
| UI surfacing of principal on Connections page ("Acme Co's Gmail" vs "Michael's Gmail") | EA V1 build, or its own small UI spec |
| Per-user EA dashboard ("see all EA work for Sarah this week") | EA V1.5 follow-on |
| Voice profile / writing-style primitive (the other half of the user's #7+#8 question) | EA V1 build introduces it as generic primitive |
| Operator-session identity (Spec C `auth_type: 'operator_session'`) integration with user-principal credentials | Spec C is already principal-aware via the user binding on the session; this spec aligns the broker lookup; no functional change to Spec C |
| RLS rewrite for principal-scoped queries beyond the natural extension in §4 question 7 | Phase 1.5 hardening if real-world testing reveals gaps |
| Org-principal use cases beyond labelling the existing org-level agents (orchestrator, heads) | Future as those agents earn new capabilities |
| Multi-tenant credential sharing across users in the same subaccount | Not in roadmap; principal isolation is the point |
| Operator-principal vs agent-principal reconciliation (operator may differ from agent principal during onboarding) | Out of V1; spec acknowledges the distinction in §0 naming, defers reconciliation rules to a future spec |

## 6. What unblocks when this ships

- **Executive Assistant V1** can author against `principal_type: 'user'` from day one. The EA brief becomes a use-case build that consumes a primitive, not a use-case that hacks in a new schema concept.
- **Dev Agent (Phase 3)** reuses the same primitive for the developer's GitHub / IDE / cloud-CLI identity. No retrofit.
- **Future personal agents** (financial assistant, research assistant, writing assistant — whichever lands first) plug into the principal model with no foundation work.
- **Multi-user dogfood** of any user-principal agent becomes a UI question, not a data-model question.
- **Audit and observability** gain a sharper attribution: "what work happened for which person" is a join, not a heuristic.
- **The Credential Broker becomes principal-aware** — the named facade shipped in Phase 1 (#279) gets its second axis of resolution, matching the master brief §9's full intent (Credential Broker AND Identity Boundary).

## 7. Sequencing

**Mockups required: no.** This is foundation work — schema, service signatures, view projection, doc updates. No new UI surfaces ship in this build. The UI implications (principal labelling on Connections page, per-user run history) belong in EA V1 or its follow-on.

**Build sequencing:**

1. Operator reviews this brief, locks §4 decisions (ratifies all 8).
2. Operator spawns a new Claude Code session, branch `claude/principal-scoped-agents-{nonce}` off post-#279 main.
3. Session adopts `spec-coordinator`: brief intake (this doc) → spec authoring → `spec-reviewer` (Codex loop) → `chatgpt-spec-review` (manual rounds) → handoff to `feature-coordinator`.
4. Build session ships: migration (columns + indexes + view), `CredentialBrokerService` signature extension, run-record principal columns, policy-envelope clause, doc-sync sweep (master brief §5.1 + §9 + `architecture.md` + `KNOWLEDGE.md`), tests for the broker invariants and view projection.
5. Phase 3 (`finalisation-coordinator`) ships the doc-sync + MERGE_READY transition.

**Concurrency with Spec D (operator-backend):** YES, run concurrent. Conflict surface is small and predictable:

- **No collision on Run Trace event emitters.** Spec D emits new event rows into existing ledger tables. This spec adds principal projection at the VIEW level via a JOIN to `agent_runs`. Spec D's emitters never touch principal — the field flows through the join automatically.
- **`agent_runs` schema overlap.** This spec adds two columns. Spec D writes to existing columns and authors no schema changes on `agent_runs`. Additive columns merge cleanly in drizzle; no rebase pain for either side.
- **`policy_envelope_snapshot` shape overlap.** This spec adds a `principal` clause. Spec D writes the envelope using the same constructor but does not change its shape. Spec D inherits the new field via rebase, no work for Spec D's author. Optional: this spec lands a stub `principal` clause in the envelope as `{ type: 'subaccount', id: subaccountId }` so Spec D's envelope reads see the field whether they cite this spec or not.
- **Migration numbering.** Whoever merges second renumbers (standard concurrent-build pattern in this codebase).
- **CredentialBroker signature.** Additive parameter with default. Existing Spec D credential injection calls in the Operator Backend adapter continue to work; spec D can opt into the principal-aware signature when it adopts user-principal credentials for the EA's operator-mode runs (V2).

**Sequencing relative to EA V1:**

EA V1 references `principal-scoped-agents` as a locked predecessor in its §2 "what's locked from upstream." EA V1 build starts only after `principal-scoped-agents` is merged. If both briefs are ratified in close succession, `principal-scoped-agents` ships first (smaller blast radius, foundation), EA V1 ships second (use case consuming the primitive).

**Relative to Voice Profile primitive:** Voice Profile is a separate generic primitive introduced inside EA V1's build (not its own foundation spec). It honours the principal model from this spec but does not depend on it being merged first — Voice Profile's `scope_type` is parallel-shaped to principal_type but lives on its own resource. The two share vocabulary but no schema.

**Branch:** `claude/principal-scoped-agents-{nonce}` off post-Phase-1-foundation `main` (any commit at or after #279).

## End of brief
