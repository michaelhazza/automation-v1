# Agents Are Employees — Implementation Spec

**Status:** Draft v2 (pre `spec-reviewer`) — incorporates UX walkthrough sign-off
**Date:** 2026-04-29
**Author:** Main session (Opus 4.7)
**Source brief:** `tasks/builds/agent-as-employee/brief.md`
**UI mockups (canonical):** [`prototypes/agent-as-employee/`](../../../prototypes/agent-as-employee/index.html) — 16 HTML mockups, source of truth for visual design
**Build slug:** `agent-as-employee`
**Class:** Major (cross-cutting — schema, identity, integrations, permissions, UX)

---

## Table of contents

1. Framing & philosophy
2. Scope & non-goals
3. UX walkthrough — see HTML prototypes
4. Existing primitives — reuse / extend / invent
5. File inventory (single source of truth)
6. Schema delta
7. Adapter contract — what every workspace adapter must implement
8. Email / calendar / document pipeline
9. Provisioning, migration, deprovisioning runbook
10. Permissions / RLS / multi-tenant safety / billing
11. *(merged into §10.6)*
12. Contracts (data shapes crossing service boundaries)
13. Execution model (sync / async / inline / queued)
14. Execution-safety contracts (idempotency / retry / concurrency / state machine)
15. Phase sequencing — dependency graph
16. Acceptance criteria
17. Open product questions (carried from brief §7)
18. Deferred items
19. Out of scope
20. Testing posture
21. Cross-references

---

## 1. Framing & philosophy

This spec turns the brief's "agents are employees" thesis into concrete schema, adapters, UX, and runbooks. The brief is the rationale; this is the recipe. Anything that disagrees with the brief loses.

**The single load-bearing claim.** An agent has its own seat. Not a borrowed login. Not an alias. A real workplace identity — email address, calendar, mailbox, document store, org-chart row — owned by the agent, attributable to the agent, revocable independently of any human. Two backends ship at launch: Synthetos-native (in-house) and Google Workspace (real Workspace users on the customer's domain).

**The actor / identity split.** Every agent and every human is an **actor** — a stable canonical entity (`actor_id`). Each backend (native, Google, future Microsoft) holds an **identity** row tied to the actor. Lifecycle states apply to identities. Audit, billing, continuity, and "who did this" reference the actor. Migration creates a new identity in the new backend; the actor persists.

**Canonical-first, mirroring CRM.** The CRM canonical pattern is the model. Provider-agnostic tables in the centre (`workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events` — note: documents are deferred from v1, see §18). Adapters at the edges (`nativeWorkspaceAdapter`, `googleWorkspaceAdapter`). Provenance via the connector-config FK edge — never duplicated columns. Native is a first-class adapter, not a fallback.

**Provider permissions are authoritative for provider-hosted resources.** Automation OS gates access at the identity layer (who is this principal, what is its lifecycle state, what scoped capabilities does it carry). It does **not** re-implement Drive / Gmail / Calendar ACLs. For native-backend resources we are the provider — provider permissions apply to ourselves, enforced via existing `ServicePrincipal` predicates and per-table RLS.

**Org chart is representational only in v1.** Reporting lines visualise structure. They do not gate permissions or routing. Anything that would make them load-bearing is a separate decision in a later spec.

**Framing assumptions** (consistent with `docs/spec-context.md` 2026-04-16):

- Pre-production. No live agencies. Wiping workspace state in dev is acceptable.
- No staged rollout, no feature flags, no migration-safety tests until live data exists.
- Static gates and tsx pure-function tests only. No new vitest / supertest / E2E suites.
- Rapid evolution: prefer extending existing primitives (`integrationConnections`, `connectorConfigs`, `agents`, `subaccountAgents`, `agentExecutionEvents`, `auditEvents`) over inventing new ones.
- This spec sets the contract; the migration is the only rollout vehicle.

**Why this is one spec, not several.** Schema (canonical tables), identity (actor / identity split), provisioning (Google + native adapters), UX (onboard flow, org chart, profile), permissions (RLS + provider-permission boundary), and billing (seat derivation) are tightly coupled. The actor / identity split is meaningless without the canonical tables; the provisioning runbook is meaningless without the adapter contract; the seat-billing rule depends on lifecycle state. Splitting yields merge ordering hazards with no benefit.

**Disclosure stance change from brief.** The brief Q3 working recommendation said agents must be visibly identified in outbound communication via the email prefix and signature. After review, this is reversed: external recipients do not want to know they are emailing an agent for routine work. Email handles look human (`sarah@clientco.com`, not `agent-sarah@…`). Default subaccount-level signatures are flexible — disclosure can be opted into per-subaccount for compliance contexts (finance, legal, health) but is not mandatory. The brief's decision log is amended.

---

## 2. Scope & non-goals

### In scope (v1, launch)

- **Canonical schema delta.** Four new tables: `workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events`. Two enum extensions: `connector_configs.connector_type` adds `synthetos_native` and `google_workspace`; new identity-lifecycle enum `workspace_identity_status`. New columns: `workspace_actors.parent_actor_id` (replaces agent-only `subaccountAgents.parentSubaccountAgentId` for org-chart hierarchy spanning humans + agents), `workspace_identities.email_sending_enabled` (per-agent send-mail toggle). FK columns: `agents.workspace_actor_id`, `users.workspace_actor_id`, `agent_runs.actor_id`. New `audit_events.actor_id` join column with backfill rule.
- **Two adapters.** `nativeWorkspaceAdapter` (writes to canonical tables; outbound mail via SMTP through a transactional email provider; calendar via RFC 5546 iCalendar-over-email) and `googleWorkspaceAdapter` (calls Admin SDK + Gmail + Calendar via service-account + domain-wide delegation; Drive scope granted at the account level for future use, no canonical document-store wiring in v1).
- **Adapter contract.** Identity provisioning / deprovisioning, email send + receive, calendar invite + accept + decline. **Documents are out of v1 — adapter does not require document methods.** One canonical-layer test suite exercises every adapter against the same scenarios.
- **Workspace tenant config per subaccount.** A subaccount picks one workspace backend at config time. Agents and humans inside that subaccount share the tenant.
- **"Onboard to workplace" flow.** A confirmation-gated, idempotent, reversible provisioning UI on the subaccount Agents tab. **Operates on existing subaccount agents — no template picker, no "create agent" step.** The agent already exists in the subaccount (inherited from system templates); onboarding adds an email address, calendar, and lifecycle state. Renames the existing "+ Hire an agent" CTA to a per-row "Onboard to workplace" action on agents that aren't yet onboarded.
- **Org chart with humans + agents on one canvas.** Extends `OrgChartPage` to render both `agents` and `users` joined via `workspace_actors`. Reporting lines come from the new `parent_actor_id` (so a human can be a parent of an agent, or vice-versa). Existing `subaccountAgents.parentSubaccountAgentId` is migrated to populate `parent_actor_id` then deprecated.
- **Agent profile — Identity tab.** New tab on `SubaccountAgentEditPage` that shows the agent's email, photo, lifecycle state, send-mail toggle state, and the buttons to suspend / revoke / migrate. **No internal IDs (actor / identity / connector) shown on user-facing screens.**
- **Agent profile — Activity tab.** New tab on `SubaccountAgentEditPage`. Renders a focused inline view of that agent's activity. Hits the existing `GET /api/subaccounts/:saId/activity` endpoint (with `actorId` locked) — does **not** reuse the full `ActivityPage` component or its scope-related chrome. Shares only a small `<ActivityFeedTable>` primitive with the subaccount-wide page.
- **Subaccount-wide Activity page extension.** Reuses the existing `ActivityPage` (`client/src/pages/ActivityPage.tsx`) at the subaccount scope. Adds: (a) actor filter UI (agents + humans), (b) extended `ActivityType` union covering new event types (`email.sent`, `email.received`, `calendar.event_accept`, `identity.activated`, `identity.suspended`, etc.), (c) `activityService` reads from `audit_events` for the new event types and merges. The frontend SPA route `/admin/subaccounts/:subaccountId/activity` is un-redirected. **No standalone audit page.**
- **Mailbox + Calendar surfaces.** Per-agent read-only views over `workspace_messages` and `workspace_calendar_events` filtered by `actor_id`. Same UI shell on both backends; on Google the view is a thin recent-activity preview with deep-links to Gmail / Calendar; on native it is the only inbox/calendar client. Compose / new-event always goes through Automation OS so policy / signing / audit run regardless of backend.
- **Email pipeline.** A single `workspaceEmailPipeline` service for outbound (audit + rate-limit + signing + policy → adapter dispatch) and inbound (adapter ingest → canonical normalisation → agent surface / workflow trigger). Both backends call through it. The send-mail toggle is enforced inside the pipeline.
- **System-agent rename + role assignment.** All system agents intended for subaccount-level use (the templates) get human-style names (Sarah, Johnny, Helena, Patel, Riley, Dana — final list TBD by product) and an explicit `agent_role` (Specialist / Worker / etc.) in both the seed migration and `server/config/c.ts` (or wherever the canonical agent registry lives). Internal/system-only agents (Orchestrator, Heads, etc.) keep their existing technical names.
- **Permission predicate extension.** No new permission surface. The `ServicePrincipal` predicate already enforces `actor_id` scoping for canonical workspace tables. New tenant-scoped tables get RLS policies + manifest entries + route guards in the same migration.
- **Billing seat derivation.** Pure function `deriveSeatConsumption(identity_status)` returning `consumes_seat: boolean`. Wired into the existing `subscriptions` / `orgSubscriptions` rollup.
- **Audit attribution.** `audit_events.actor_id` populated for every agent-originating write. `agent_runs.actor_id` populated for every run.

### Explicitly deferred to a fast-follow (post-launch, separate spec)

- **Microsoft 365 adapter.** Same canonical layer, new adapter file. No schema change. Tracked as `agent-as-employee-microsoft-adapter` build slug.
- **Vanity domain (brief Q1 Option B).** `sarah@ai.clientco.com` via customer-supplied DNS. Default at launch is Option A (`sarah@<subaccount-slug>.automationos.io`). Vanity domain is a self-serve setup step.
- **Per-agent custom email signatures (brief Q3).** Launch ships a default subaccount-level signature with optional disclosure. Per-agent configurability is v2.
- **Operator-overridable profile photos (brief Q2).** Launch auto-generates deterministic photos. Manual upload is v2.
- **Workspace documents / Drive integration.** Canonical document store deferred. On Google, agents can write to Drive directly via the Drive scope granted at account creation; we do not mirror or list documents in v1. Native has no document store yet. A canonical `workspace_documents` table will land in a follow-up spec when there's a concrete operator workflow that requires it.

### Explicitly deferred to v2

- **Cross-subaccount agents.** A single agent identity across multiple subaccounts of the same agency. Different identity model. Defer.
- **Agent-to-agent messaging across subaccount tenants.** Same constraint.
- **Agent-identity marketplace** (onboard from a public catalogue). Adjacent product surface.
- **Slack / Teams as workplace identity providers.** Future adapters; not on the launch path.
- **Identity-state reconciliation job** (compares local `workspace_identities.status` to Google `users.suspended`). Not load-bearing for v1 correctness; spec'd transitions are atomic locally.

### Explicitly out

- **Building a Gmail / Calendar / Drive client UI.** Native writes to canonical tables; per-agent surfaces render minimum viable views. We do not build a Gmail clone.
- **Replicating Workspace canvas-mode co-creation in Slides / Docs.** Belongs on a "content surface" roadmap, separate from identity.
- **Re-implementing provider ACLs.** Drive / Gmail / Calendar ACLs on the Google adapter are owned by Google.
- **Reporting lines that gate permissions or routing.** Org chart is display metadata only in v1.
- **Aggregate cross-agent inbox.** Per-agent mailbox only; no top-level "all agent mail" landing page.
- **Standalone audit page.** Reuse existing `ActivityPage` instead of building a new one.

---

## 3. UX walkthrough — see HTML prototypes

The canonical visual reference lives outside this spec, in `prototypes/agent-as-employee/index.html`. 16 standalone HTML mockups walk an operator (Maya at Acme Agency) end-to-end: configure the workspace backend, onboard an existing agent, watch it appear on the org chart with its email and photo, review its Identity tab, view its mailbox / calendar / activity, suspend or revoke, then migrate the subaccount from native to Google.

The mockups have been reviewed and signed off. The implementation should match them on layout, copy, primary actions, and information density. Tailwind class choices, animation, and exact spacing are implementation detail.

### Frontend design re-check (per CLAUDE.md "Five hard rules") — applied during mockup design

1. **Primary task first.** The operator's task is "onboard an existing agent into the workplace and have it work like an employee." Every screen is the minimum surface for that task — not a backend visualisation.
2. **Default to hidden.** No metric dashboards, KPI tiles, cost charts, internal-ID exposure, or aggregated-cost views ship in v1. The Identity tab shows lifecycle state inline, not a status panel. Internal IDs (actor, identity, connector) are not exposed on user-facing screens.
3. **One primary action per screen.** Onboard flow → "Confirm & onboard". Identity tab → either "Suspend" or "Resume" depending on state, never both. Migration modal → "Migrate".
4. **Inline state beats dashboards.** Lifecycle state renders as a coloured dot + word inline next to the agent name. Seats consumed renders inline on the subaccount header, not a billing dashboard.
5. **The re-check.** A non-technical operator onboards an existing agent in 4 clicks: Agents tab row → "Onboard to workplace" → identity step → "Confirm & onboard". Everything else (mailbox, calendar, activity, migration) is a follow-up surface, not part of the golden path.

### Mockup index (with file paths)

| # | Surface | File |
|---|---|---|
| 01 | Workspace backend setup — Synthetos-native | `prototypes/agent-as-employee/01-workspace-setup-native.html` |
| 02 | Workspace backend setup — Google Workspace | `prototypes/agent-as-employee/02-workspace-setup-google.html` |
| 03 | Subaccount Agents tab — per-row Onboard CTA | `prototypes/agent-as-employee/03-subaccount-agents-list.html` |
| 04 | Onboard step 1: identity (name, email, send-mail toggle) | `prototypes/agent-as-employee/04-onboard-step1-identity.html` |
| 05 | Onboard step 2: confirm | `prototypes/agent-as-employee/05-onboard-step2-confirm.html` |
| 06 | Onboard step 3: progress (native + Google variants) | `prototypes/agent-as-employee/06-onboard-step3-progress.html` |
| 07 | Onboard success | `prototypes/agent-as-employee/07-onboard-success.html` |
| 08 | Org chart — humans + agents on one canvas | `prototypes/agent-as-employee/08-org-chart.html` |
| 09 | Agent profile — Identity tab | `prototypes/agent-as-employee/09-agent-identity-tab.html` |
| 10 | Agent mailbox (same shell, backend-aware) | `prototypes/agent-as-employee/10-agent-mailbox.html` |
| 11 | Agent calendar (same shell, backend-aware) | `prototypes/agent-as-employee/11-agent-calendar.html` |
| 12 | Suspend confirmation | `prototypes/agent-as-employee/12-suspend-dialog.html` |
| 13 | Revoke confirmation (type-the-name gate) | `prototypes/agent-as-employee/13-revoke-dialog.html` |
| 14 | Subaccount-wide Activity page (existing `ActivityPage`, new actor filter) | `prototypes/agent-as-employee/14-subaccount-activity.html` |
| 15 | Agent profile — Activity tab (focused inline view) | `prototypes/agent-as-employee/15-agent-activity-tab.html` |
| 16 | Workspace migration (native → Google) | `prototypes/agent-as-employee/16-migration-modal.html` |

### What we deliberately did NOT build (per CLAUDE.md frontend rules)

- ❌ No "agent activity dashboard" with KPI tiles (rule 2 default-to-hidden).
- ❌ No "agent productivity score" or "tasks completed this week" widgets.
- ❌ No timeline-style visualisation of every action — Activity is a tabular list, not a chart.
- ❌ No metric exposure on `agentExecutionEvent`-derived data inside the agent profile. Live status is a green dot, not a panel.
- ❌ No internal IDs (actor, identity, connector) on user-facing screens — diagnostic only.
- ❌ No standalone Documents surface in v1 — agents on Google own files in Drive directly; native has no document store yet.
- ❌ No standalone aggregate "Agent inbox" landing page across all agents in an org.

If a customer asks for any of these, we add them as targeted single-task surfaces in a follow-up. Default is they don't exist.


---

## 4. Existing primitives — reuse / extend / invent

Per the spec authoring checklist §1, every new primitive needs justification. Below: what we reuse as-is, what we extend, and what we genuinely have to invent.

### Reuse (no change)

| Primitive | File | Why this fits |
|---|---|---|
| `UserPrincipal` / `ServicePrincipal` / `DelegatedPrincipal` | `server/services/principal/types.ts` | The three-principal model is what makes "agent has its own seat" expressible in the auth layer — `ServicePrincipal` already represents an agent acting under its own identity. No new principal type needed. |
| `withOrgTx` / `getOrgScopedDb` / `withAdminConnection` | `server/middleware/orgScoping.ts`, `server/instrumentation.ts` | All canonical workspace tables are tenant-scoped — the existing transaction wrappers carry the right session vars. No new wrapper needed. |
| `RLS_PROTECTED_TABLES` manifest | `server/config/rlsProtectedTables.ts` | Four new canonical tables join the manifest in the same migration that creates them. |
| `verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh` | `scripts/gates/` | CI gates already enforce manifest coverage and direct-DB-access prohibition. Inherits without change. |
| `integration_connections` table | `server/db/schema/integrationConnections.ts` | Google Workspace OAuth + service-account credentials sit here, alongside `gohighlevel`, `hubspot`, etc. Just a new provider value. |
| `auditEvents` schema | `server/db/schema/auditEvents.ts` | Already carries `actorId`, `actorType` (`'user' | 'system' | 'agent'`), `action`, `entityType`, `metadata`. We add an `actor_id` column that joins to `workspace_actors`, and namespace new action types (`email.sent`, `identity.activated`, etc.). No new audit table. |
| `agentExecutionEvents` + `agentRunPromptService` + `agentRunPayloadWriter` | `server/services/...` | Agent-run attribution already flows through these. We add `actor_id` to `agent_runs` so events emit with workspace-actor context. |
| `STATUS_DOT` colour map + `OrgChartPage` layout algorithm | `client/src/pages/OrgChartPage.tsx` | Existing forest-layout + trunk/tree edge collector handles humans + agents on one canvas with no algorithm change — we extend the input dataset, not the renderer. |
| `Modal` + `ConfirmDialog` components | `client/src/components/` | Onboard / migrate / suspend / revoke flows reuse these. No new modal primitive. |
| `withBackoff` / `TripWire` / `runCostBreaker` | `server/lib/` | Provisioning calls to Google Admin SDK / Gmail / Calendar go through `withBackoff`. No new retry primitive. |
| `ActivityPage` + `activity` route + `activityService` | `client/src/pages/ActivityPage.tsx`, `server/routes/activity.ts`, `server/services/activityService.ts` | The subaccount-wide Activity page already exists with three scopes (subaccount/org/system), an `agentId` filter on the backend, and 6 event types. We extend the `ActivityType` union and merge in `audit_events` rows for the new event types. No new audit page. |
| `failure() + FailureReason` | `shared/iee/failure.ts` | Adapter contract failures use the existing failure shape. No new error envelope. |
| `subscriptions` / `orgSubscriptions` rollup | `server/db/schema/subscriptions.ts` | Seat consumption derived from identity lifecycle is a function over existing rollup. No new billing table. |

### Extend (new column / new variant)

| Primitive | What we add | Why not invent new |
|---|---|---|
| `connector_configs.connector_type` enum | Add `synthetos_native`, `google_workspace` (and reserve `microsoft_365`). | Identical FK shape — `connection_id`, `config_json`, `status`. Inventing a parallel "workspace_configs" table would split provenance across two registries. |
| `agents` schema | Add `workspace_actor_id uuid REFERENCES workspace_actors(id)`. | The agent already exists; the actor is the **persistent** entity an agent can be re-identified through. FK direction matches CRM canonical pattern (entity points at canonical identity). |
| `users` schema | Add `workspace_actor_id uuid REFERENCES workspace_actors(id)`. | Same reasoning — humans and agents share the actor table. |
| `agent_runs` | Add `actor_id uuid REFERENCES workspace_actors(id)`. | Required for "audit, in one place, every action the agent has taken since being hired" (brief §3 success condition 6). Backfill from `agent_runs.agentId → agents.workspace_actor_id`. |
| `audit_events` | Add `actor_id uuid REFERENCES workspace_actors(id)`. Backfill from `auditEvents.actorId → users / agents → workspace_actor_id`. | Same reasoning. Existing `actorId` + `actorType` columns are kept for rows pre-dating workspace identity. New writes populate both. |
| `RLS_PROTECTED_TABLES` | Four new entries (one per canonical table). | Existing manifest is the single source of truth — extending it is the only correct option. |
| `OrgChartPage` data fetch + tree builder | Reads from `workspace_actors` joined to `agents` and `users`; uses new `parent_actor_id` for the forest hierarchy instead of agent-only `parentSubaccountAgentId`. | The renderer already supports a forest of nodes; we change the input dataset (canonical actor rows) and the parent-link source. |
| `SubaccountAgentEditPage` tabs | Adds `'identity'` and `'activity'` to the Tab union. | Profile already supports tab-based progressive disclosure. The Activity tab is a new lightweight view inside the existing page chrome — it does NOT reuse the full `ActivityPage` component. |
| `ActivityType` union + `activityService.listActivityItems` | Add new event types (`email.sent`, `email.received`, `calendar.event_accept`, `identity.provisioned`, `identity.activated`, `identity.suspended`, `identity.resumed`, `identity.revoked`, `actor.onboarded`). Extend `activityService` to merge `audit_events` rows for these types into the existing aggregate. | Existing service already aggregates 6 types (`agent_run`, `review_item`, `health_finding`, `inbox_item`, `workflow_run`, `workflow_execution`). Pattern is identical — pure extension. |
| `activity.ts` route filter parser | Add `actorId` (covering humans + agents). Today only `agentId` is parsed. | Existing parser is the right shape — adding one more field is trivial. |
| Frontend SPA route `/admin/subaccounts/:subaccountId/activity` | Un-redirect (currently redirects to home). | Page already exists in component code; just disabled in routing. |
| `system_agents` seed data + `server/config/c.ts` agent registry | All system agents intended for subaccount-level use are renamed to human-style names (Sarah, Johnny, Helena, Patel, Riley, Dana, etc.) with explicit `agent_role` (Specialist / Worker). Internal-only agents (Orchestrator, Heads) keep their technical names. | Direct extension of existing rows + registry entries; no new primitive. |

### Invent (new primitive — justified)

| New primitive | Why reuse / extend was insufficient |
|---|---|
| `workspace_actors` table | The `agents` table is org-scoped (template-level, organisation-wide). The `users` table is org-scoped (one human at one org). Neither captures "the same logical entity persists across native → Google migration." Reusing either would conflate identity with template/role — exactly the conflation the brief rejects. |
| `workspace_actors.parent_actor_id` | Existing hierarchy lives on `subaccountAgents.parentSubaccountAgentId`, which is agent-only. To support reporting lines spanning humans + agents (a human manager of an agent, or vice-versa), the parent reference moves up to the canonical actor. Cannot reuse the agent-only column. |
| `workspace_identities` table | One identity per actor per backend. Cannot reuse `integration_connections` (1 row per connection, not per user) or `connector_configs` (1 row per provider type per subaccount). Identity-per-actor is a new cardinality. |
| `workspace_identities.email_sending_enabled` | Controls whether `workspaceEmailPipeline.send()` accepts outbound from this identity. Required because some agents need account-level access (Drive scope on Google) without sending mail. Could in theory live elsewhere (a permission flag), but co-locating with the identity makes the toggle a per-identity state surfaced naturally on the identity tab. |
| `workspace_messages`, `workspace_calendar_events` | The `documentBundles` table is for cached-context attachments. No `messages` or `calendar_events` table exists. These are the canonical equivalents of `canonicalContacts` / `canonicalOpportunities` from CRM — a deliberate parallel pattern. (Note: `workspace_documents` was scoped in v1 and removed; deferred to a follow-up — see §18.) |
| `nativeWorkspaceAdapter` and `googleWorkspaceAdapter` | The adapter directory `server/adapters/` exists for CRM (`ghlAdapter`, `stripeAdapter`, etc.) but no workspace adapters. Two new files; no new adapter framework — they conform to the existing adapter shape. |
| `workspaceEmailPipeline` service | No existing inbound or outbound email service in the codebase. Service-layer pipeline is mandated by brief §5.10 ("all agent email passes through a single platform-controlled pipeline"). Cannot live in either adapter. The pipeline gates on `email_sending_enabled` for outbound. |
| `workspace_identity_status` enum (`provisioned`, `active`, `suspended`, `revoked`, `archived`) | Lifecycle states are spec-defined; not reusable from `agents.status` (`draft | active | inactive`) or any existing enum. |
| `deriveSeatConsumption(status)` pure function | One-line predicate — but it is the **single source of truth** for billing seat derivation per brief §5.13. Lives in `shared/billing/seatDerivation.ts` to be consumed by both the rollup job and the UI display. |
| `<ActivityFeedTable>` shared component | Small React component rendering one row per activity item. Shared between the subaccount-wide `ActivityPage` and the agent-profile Activity tab. Not a full page — just the table. Lives in `client/src/components/activity/ActivityFeedTable.tsx`. |

---

## 5. File inventory (single source of truth)

This table is the **only** authoritative list of what this spec touches. Every prose reference to a file / column / migration in this document must appear here.

### Schema (new)

| File | Purpose |
|---|---|
| `server/db/schema/workspaceActors.ts` | `workspace_actors` table — canonical actor identity, persistent across migrations. Includes `parent_actor_id` for org-chart hierarchy. |
| `server/db/schema/workspaceIdentities.ts` | `workspace_identities` table — provider-scoped identity rows; one per (actor, backend). Includes `email_sending_enabled` boolean. |
| `server/db/schema/workspaceMessages.ts` | `workspace_messages` table — canonical email/message store. |
| `server/db/schema/workspaceCalendarEvents.ts` | `workspace_calendar_events` table — canonical calendar event store. |
| `server/db/migrations/0240_workspace_canonical_layer.sql` | Migration: tables above + indexes + RLS policies + manifest entries + enum extension on `connector_configs.connector_type` + new `workspace_identity_status` enum. (Migration number renumbered before merge per `DEVELOPMENT_GUIDELINES.md` §6.2.) |
| `server/db/migrations/0241_workspace_actor_fks_and_hierarchy.sql` | Migration: add `workspace_actor_id` to `agents`, `users`, `agent_runs`, `audit_events`. Populate `workspace_actors.parent_actor_id` from `subaccountAgents.parentSubaccountAgentId`. Backfill rules. |
| `server/db/migrations/0242_system_agents_human_names.sql` | Migration: rename subaccount-facing system agents to human-style names + assign explicit roles. Internal-only agents (Orchestrator, Heads) untouched. |

### Schema (modified)

| File | Change |
|---|---|
| `server/db/schema/agents.ts` | Add `workspaceActorId: uuid('workspace_actor_id').references(() => workspaceActors.id)`. |
| `server/db/schema/users.ts` | Add `workspaceActorId: uuid('workspace_actor_id').references(() => workspaceActors.id)`. |
| `server/db/schema/agentRuns.ts` | Add `actorId: uuid('actor_id').references(() => workspaceActors.id)`. |
| `server/db/schema/auditEvents.ts` | Add `workspaceActorId: uuid('actor_id').references(() => workspaceActors.id)`. (Existing `actorId` + `actorType` retained.) |
| `server/db/schema/connectorConfigs.ts` | Extend `connectorType` enum union to include `'synthetos_native' | 'google_workspace'`. |
| `server/config/rlsProtectedTables.ts` | Add 4 entries: `workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events`. |

### Adapters (new)

| File | Purpose |
|---|---|
| `server/adapters/workspace/nativeWorkspaceAdapter.ts` | Implements `WorkspaceAdapter` contract against the canonical tables + transactional email provider (Postmark / SendGrid / Mailgun) for SMTP. |
| `server/adapters/workspace/googleWorkspaceAdapter.ts` | Implements `WorkspaceAdapter` against Admin SDK + Gmail + Calendar APIs. Drive scope is granted at account creation but not exercised in v1. |
| `server/adapters/workspace/workspaceAdapterContract.ts` | The `WorkspaceAdapter` TypeScript interface — every adapter implements this exactly. |
| `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` | One test suite, both adapters. Behavioural divergence = adapter bug. |

### Services (new)

| File | Purpose |
|---|---|
| `server/services/workspace/workspaceActorService.ts` | CRUD on `workspace_actors`. Used by the onboard flow + migration runbook. |
| `server/services/workspace/workspaceIdentityService.ts` | Lifecycle transitions on `workspace_identities`. State machine implementation. |
| `server/services/workspace/workspaceOnboardingService.ts` | Confirmation-gated, idempotent onboarding. Operates on an existing actor (created during seed). Calls one adapter at a time. |
| `server/services/workspace/workspaceMigrationService.ts` | Per-subaccount migration orchestration. Iterates active identities, archives old, provisions new. |
| `server/services/workspace/workspaceEmailPipeline.ts` | Outbound (audit + rate-limit + signing + policy + send-mail-toggle gate) + inbound (normalisation + threading + attachment handling). Called by both adapters. |
| `server/services/workspace/workspaceEmailPipelinePure.ts` | Pure logic for outbound policy checks, signature stamping, threading. Tested via `tsx`. |

### Services (modified)

| File | Change |
|---|---|
| `server/services/activityService.ts` | Extend `ActivityType` union with workspace event types. Merge `audit_events` rows for these types into the existing aggregate. Honour the new `actorId` filter (humans + agents). |

### Routes (new)

| File | Endpoints |
|---|---|
| `server/routes/workspace.ts` | `POST /api/subaccounts/:saId/workspace/configure` (set backend) · `POST /api/subaccounts/:saId/workspace/onboard` (idempotent onboarding of an existing agent) · `POST /api/subaccounts/:saId/workspace/migrate` · `POST /api/agents/:agentId/identity/suspend` · `POST /api/agents/:agentId/identity/resume` · `POST /api/agents/:agentId/identity/revoke` · `PATCH /api/agents/:agentId/identity/email-sending` (toggle) |
| `server/routes/workspaceMail.ts` | `GET /api/agents/:agentId/mailbox` · `POST /api/agents/:agentId/mailbox/send` · `GET /api/agents/:agentId/mailbox/threads/:threadId` |
| `server/routes/workspaceCalendar.ts` | `GET /api/agents/:agentId/calendar` · `POST /api/agents/:agentId/calendar/events` · `POST /api/agents/:agentId/calendar/events/:eventId/respond` |

### Routes (modified)

| File | Change |
|---|---|
| `server/routes/subaccounts.ts` | New `/api/subaccounts/:saId/workspace` GET (returns backend + seat usage). |
| `server/routes/activity.ts` | Add `actorId` query-param filter to `parseFilters` (covers both humans and agents). Existing `agentId` retained for backwards compatibility. |
| `server/index.ts` | Mount the three new route files. |
| `client/src/App.tsx` (or wherever SPA routes live) | Un-redirect `/admin/subaccounts/:subaccountId/activity` to render the existing `ActivityPage` in subaccount scope. |

### Frontend (new)

| File | Purpose |
|---|---|
| `client/src/pages/AgentMailboxPage.tsx` | Per-agent mailbox view (mockup 10). Same shell on both backends; deep-links to Gmail on Google. |
| `client/src/pages/AgentCalendarPage.tsx` | Per-agent calendar view (mockup 11). Same shell both backends; deep-links to Google Calendar. |
| `client/src/components/workspace/OnboardAgentModal.tsx` | 3-step onboarding modal — identity / confirm / progress (mockups 4–6). No template picker; the agent is already chosen. |
| `client/src/components/workspace/MigrateWorkspaceModal.tsx` | Mockup 16. |
| `client/src/components/workspace/SuspendIdentityDialog.tsx` | Mockup 12. |
| `client/src/components/workspace/RevokeIdentityDialog.tsx` | Mockup 13. |
| `client/src/components/workspace/IdentityCard.tsx` | Reusable header card on Identity tab. |
| `client/src/components/workspace/LifecycleProgress.tsx` | Inline lifecycle bar. |
| `client/src/components/workspace/SeatsPanel.tsx` | Inline seats panel on the Workspace tab. |
| `client/src/components/workspace/EmailSendingToggle.tsx` | Reusable toggle component for the per-agent send-mail flag. |
| `client/src/components/activity/ActivityFeedTable.tsx` | Shared table primitive — used by both the subaccount-wide `ActivityPage` and the per-agent Activity tab. |
| `client/src/components/agent/AgentActivityTab.tsx` | The Activity tab content rendered inside `SubaccountAgentEditPage`. Wraps `<ActivityFeedTable>` with `actorId` locked. Does NOT import `ActivityPage`. |

### Frontend (modified)

| File | Change |
|---|---|
| `client/src/pages/AdminSubaccountDetailPage.tsx` | Add `'workspace'` to `ActiveTab` + `TAB_LABELS` + `visibleTabs`. Render `WorkspaceTabContent` (lazy). |
| `client/src/pages/SubaccountAgentsPage.tsx` | Add per-row "Onboard to workplace" CTA on agents not yet onboarded. Open `OnboardAgentModal`. The existing `Load System Agents` CTA is retained for adding additional agent instances (rare). |
| `client/src/pages/SubaccountAgentEditPage.tsx` | Add `'identity'` and `'activity'` to Tab union. Default to `'identity'` when navigating from a freshly onboarded agent (`?newlyOnboarded=1` query param). |
| `client/src/pages/OrgChartPage.tsx` | Extend data fetch: read from `workspace_actors` joined to `agents` and `users`. Use `parent_actor_id` for the forest hierarchy instead of `parentSubaccountAgentId`. Add `actorKind: 'agent' \| 'human'` to the node type. |
| `client/src/pages/ActivityPage.tsx` | Add actor-filter UI (humans + agents). Extend type-filter dropdown with new event types. Use `<ActivityFeedTable>` for the row rendering. |
| `client/src/lib/api.ts` | Add typed wrappers for new endpoints. |

### Shared

| File | Purpose |
|---|---|
| `shared/billing/seatDerivation.ts` | `deriveSeatConsumption(status: WorkspaceIdentityStatus): boolean`. |
| `shared/types/workspace.ts` | TS types for `WorkspaceActor`, `WorkspaceIdentity`, `WorkspaceMessage`, `WorkspaceCalendarEvent`. Mirrored to client + server. |
| `shared/types/workspaceAdapterContract.ts` | The TS interface (also imported server-side from the adapter contract file). |
| `shared/types/activityType.ts` (extended) | Extended `ActivityType` union with workspace event types. |

### Configuration / env / scripts

| File | Change |
|---|---|
| `server/lib/env.ts` + `.env.example` | Add `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` (path or JSON), `GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER`, `NATIVE_EMAIL_PROVIDER` (`postmark` / `sendgrid` / `mailgun`), `NATIVE_EMAIL_PROVIDER_API_KEY`, `NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET`. |
| `scripts/seed-workspace-actors.ts` | Backfill: for each existing agent and user, create a `workspace_actor` row and link it. Populate `parent_actor_id` from `subaccountAgents.parentSubaccountAgentId`. |
| `scripts/verify-workspace-actor-coverage.ts` | Static gate: every `agents` row has a `workspace_actor_id` after seed. Every `users` row has one. CI fail if not. |

### Documentation

| File | Update |
|---|---|
| `architecture.md` | Add a "Workspace canonical layer" subsection mirroring the existing CRM canonical pattern note. Add the new route files to the route conventions table. |
| `docs/capabilities.md` | Add "Agent-as-employee identity" capability. Add Google Workspace integration. Editorial rules apply. |
| `docs/spec-context.md` | Add `workspaceActorService` / `workspaceIdentityService` / `workspaceEmailPipeline` / `<ActivityFeedTable>` to `accepted_primitives`. |
| `prototypes/agent-as-employee/` | Canonical UI mockups — already shipped. Source of truth for visual design. |

---

## 6. Schema delta

### 6.1 `workspace_actors`

```sql
CREATE TABLE workspace_actors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid NOT NULL REFERENCES subaccounts(id),
  actor_kind          text NOT NULL CHECK (actor_kind IN ('agent', 'human')),
  display_name        text NOT NULL,
  -- Org-chart hierarchy. Replaces agent-only `subaccountAgents.parentSubaccountAgentId`
  -- so reporting lines can span humans <-> agents.
  parent_actor_id     uuid REFERENCES workspace_actors(id),
  agent_role          text,                  -- ceo / orchestrator / specialist / worker — display only
  agent_title         text,                  -- e.g. "Marketing analyst" — display only
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_actors_org_idx          ON workspace_actors(organisation_id);
CREATE INDEX workspace_actors_subaccount_idx   ON workspace_actors(subaccount_id);
CREATE INDEX workspace_actors_kind_idx         ON workspace_actors(actor_kind);
CREATE INDEX workspace_actors_parent_idx       ON workspace_actors(parent_actor_id);

-- Org-chart integrity: parent must be in the same subaccount.
-- CHECK cannot subquery in Postgres, so this is enforced via trigger and
-- defended by the service layer (workspaceActorService.setParent).
CREATE OR REPLACE FUNCTION workspace_actors_parent_same_subaccount() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_actor_id IS NOT NULL THEN
    PERFORM 1 FROM workspace_actors p
      WHERE p.id = NEW.parent_actor_id
        AND p.subaccount_id = NEW.subaccount_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'workspace_actors.parent_actor_id must reference an actor in the same subaccount';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_actors_parent_same_subaccount_trg
  BEFORE INSERT OR UPDATE OF parent_actor_id, subaccount_id ON workspace_actors
  FOR EACH ROW EXECUTE FUNCTION workspace_actors_parent_same_subaccount();
```

`actor_kind` is intentionally minimal — the agent vs human distinction is needed at query time (org chart filter, audit-log filter), but no further taxonomy belongs here.

`parent_actor_id` is self-referential and nullable (root nodes have no parent). `agent_role` + `agent_title` are display metadata for the org chart card; they migrate from `subaccountAgents.{agentRole, agentTitle}` for agent rows and are populated from human role data for human rows. **No permission or routing semantics ride on these fields** — brief §5 stance.

**Cycle prevention.** The schema admits cycles on `parent_actor_id` (e.g. A→B→A) — the same-subaccount trigger doesn't catch them. Cycles are prevented at the service layer: `workspaceActorService.setParent(actorId, parentActorId)` walks the proposed parent chain and rejects any input that would close a cycle. The walk is bounded (the actor count per subaccount is small — well under 1000 in practice) and runs inside the same transaction as the update. Failure shape: `failure(parent_actor_cycle_detected, { actorId, parentActorId, cycleVia })` where `cycleVia` is the actor id where the cycle was detected. Frontend surfaces this as a clear "this would create a reporting-line cycle" message; org chart fetch never returns cyclic data.

**Actor lifecycle (derived, not stored).** Actors do not have their own status column. They are permanent audit anchors — once created, an actor row is never deleted. The actor's effective state is derived from its identities:

```typescript
// shared/types/workspaceActor.ts
export function deriveActorState(identities: { status: WorkspaceIdentityStatus }[]):
  'active' | 'suspended' | 'inactive' {
  if (identities.some(i => i.status === 'active')) return 'active';
  if (identities.some(i => i.status === 'suspended')) return 'suspended';
  return 'inactive'; // all identities are provisioned (pre-activate), revoked, or archived
}
```

Used by org-chart filtering, activity scoping, and the seat-rollup display. The actor row persists forever so historical `audit_events.actor_id` joins always resolve, even after every identity is revoked or archived.

### 6.2 `workspace_identities`

```sql
CREATE TYPE workspace_identity_status AS ENUM
  ('provisioned', 'active', 'suspended', 'revoked', 'archived');

CREATE TABLE workspace_identities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          uuid NOT NULL REFERENCES organisations(id),
  subaccount_id            uuid NOT NULL REFERENCES subaccounts(id),
  actor_id                 uuid NOT NULL REFERENCES workspace_actors(id),
  connector_config_id      uuid NOT NULL REFERENCES connector_configs(id),
  backend                  text NOT NULL CHECK (backend IN ('synthetos_native', 'google_workspace')),
  email_address            text NOT NULL,
  email_sending_enabled    boolean NOT NULL DEFAULT true,  -- per-agent send-mail toggle
  external_user_id         text,           -- Google Admin SDK user id; null for native
  display_name             text NOT NULL,
  photo_url                text,
  status                   workspace_identity_status NOT NULL DEFAULT 'provisioned',
  status_changed_at        timestamptz NOT NULL DEFAULT now(),
  status_changed_by        uuid REFERENCES users(id),
  provisioning_request_id  text NOT NULL,  -- idempotency key
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz
);

-- One active-or-suspended identity per actor per backend.
CREATE UNIQUE INDEX workspace_identities_actor_backend_active_uniq
  ON workspace_identities (actor_id, backend)
  WHERE status IN ('provisioned', 'active', 'suspended');

-- Idempotency: one identity per provisioning_request_id.
CREATE UNIQUE INDEX workspace_identities_provisioning_request_uniq
  ON workspace_identities (provisioning_request_id);

-- Email uniqueness within a connector config (matches Google's domain-uniqueness).
CREATE UNIQUE INDEX workspace_identities_email_per_config_uniq
  ON workspace_identities (connector_config_id, lower(email_address))
  WHERE status IN ('provisioned', 'active', 'suspended');

CREATE INDEX workspace_identities_org_idx        ON workspace_identities(organisation_id);
CREATE INDEX workspace_identities_subaccount_idx ON workspace_identities(subaccount_id);
CREATE INDEX workspace_identities_actor_idx      ON workspace_identities(actor_id);
CREATE INDEX workspace_identities_status_idx     ON workspace_identities(status);

-- Migration retry idempotency: at most one identity per (migrationRequestId, actorId).
-- Without this, retries of a partial migration can double-provision.
CREATE UNIQUE INDEX workspace_identities_migration_request_actor_uniq
  ON workspace_identities ((metadata->>'migrationRequestId'), actor_id)
  WHERE metadata ? 'migrationRequestId';

-- Identity must live in the same subaccount as its actor.
-- Enforced via trigger because CHECK cannot subquery.
CREATE OR REPLACE FUNCTION workspace_identities_actor_same_subaccount() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM workspace_actors a
    WHERE a.id = NEW.actor_id
      AND a.subaccount_id = NEW.subaccount_id
      AND a.organisation_id = NEW.organisation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_identities.{subaccount_id, organisation_id} must match the actor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_identities_actor_same_subaccount_trg
  BEFORE INSERT OR UPDATE OF actor_id, subaccount_id, organisation_id ON workspace_identities
  FOR EACH ROW EXECUTE FUNCTION workspace_identities_actor_same_subaccount();

-- Backend mismatch guard: connector_config must belong to the same backend as the identity.
-- Prevents subtle misconfigs during migration or multi-backend subaccount setup.
CREATE OR REPLACE FUNCTION workspace_identities_backend_matches_config() RETURNS trigger AS $$
DECLARE
  config_type text;
BEGIN
  SELECT connector_type INTO config_type
    FROM connector_configs WHERE id = NEW.connector_config_id;
  IF config_type IS DISTINCT FROM NEW.backend THEN
    RAISE EXCEPTION
      'workspace_identities.backend (%) must match connector_configs.connector_type (%) for config %',
      NEW.backend, config_type, NEW.connector_config_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_identities_backend_matches_config_trg
  BEFORE INSERT OR UPDATE OF backend, connector_config_id ON workspace_identities
  FOR EACH ROW EXECUTE FUNCTION workspace_identities_backend_matches_config();
```

### 6.3 `workspace_messages`

```sql
CREATE TABLE workspace_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  subaccount_id         uuid NOT NULL REFERENCES subaccounts(id),
  identity_id           uuid NOT NULL REFERENCES workspace_identities(id),
  actor_id              uuid NOT NULL REFERENCES workspace_actors(id),
  thread_id             uuid NOT NULL,         -- canonical thread grouping
  external_message_id   text,                  -- Gmail messageId; null for native
  direction             text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address          text NOT NULL,
  to_addresses          text[] NOT NULL,
  cc_addresses          text[],
  subject               text,
  body_text             text,
  body_html             text,
  sent_at               timestamptz NOT NULL,
  received_at           timestamptz,
  audit_event_id        uuid REFERENCES audit_events(id),
  rate_limit_decision   text NOT NULL DEFAULT 'allowed',
  attachments_count     integer NOT NULL DEFAULT 0,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_messages_org_idx        ON workspace_messages(organisation_id);
CREATE INDEX workspace_messages_subaccount_idx ON workspace_messages(subaccount_id);
CREATE INDEX workspace_messages_identity_idx   ON workspace_messages(identity_id);
CREATE INDEX workspace_messages_actor_idx      ON workspace_messages(actor_id);
CREATE INDEX workspace_messages_thread_idx     ON workspace_messages(thread_id);
CREATE UNIQUE INDEX workspace_messages_external_uniq
  ON workspace_messages (identity_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- Native inbound idempotency: providers may not surface a stable external id, so
-- the pipeline computes a deterministic dedupe_key = sha256(from + subject + sent_at + providerMessageId)
-- and stores it in metadata. Required because workspace_messages_external_uniq only
-- covers rows where external_message_id IS NOT NULL.
CREATE UNIQUE INDEX workspace_messages_dedupe_uniq
  ON workspace_messages (identity_id, (metadata->>'dedupe_key'))
  WHERE metadata ? 'dedupe_key';
```

**actor_id trust invariant.** `workspace_messages.actor_id` MUST equal `workspace_identities.actor_id` for the referenced `identity_id`. This is enforced in `workspaceEmailPipeline` (both ingest and send populate `actor_id` by reading the identity row, never from the caller) and in the adapter mirroring path (Google adapter reads the identity row before inserting). It is treated as a hard data-integrity invariant — a row where these diverge is a pipeline bug, not a data anomaly.

### 6.4 `workspace_calendar_events`

```sql
CREATE TABLE workspace_calendar_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL REFERENCES organisations(id),
  subaccount_id         uuid NOT NULL REFERENCES subaccounts(id),
  identity_id           uuid NOT NULL REFERENCES workspace_identities(id),
  actor_id              uuid NOT NULL REFERENCES workspace_actors(id),
  external_event_id     text,                  -- Google Calendar eventId; null for native
  organiser_email       text NOT NULL,
  title                 text NOT NULL,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  attendee_emails       text[] NOT NULL,
  response_status       text NOT NULL CHECK (response_status IN ('needs_action', 'accepted', 'declined', 'tentative')),
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_calendar_events_actor_idx       ON workspace_calendar_events(actor_id);
CREATE INDEX workspace_calendar_events_starts_idx      ON workspace_calendar_events(starts_at);
CREATE UNIQUE INDEX workspace_calendar_events_external_uniq
  ON workspace_calendar_events (identity_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
```

### 6.5 RLS policies (canonical pattern, post-0227)

Every canonical table above gets a policy of the same shape (per `architecture.md §1155`):

```sql
ALTER TABLE workspace_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_actors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_actors_org_isolation ON workspace_actors;
CREATE POLICY workspace_actors_org_isolation ON workspace_actors
  USING (
    organisation_id IS NOT NULL
    AND current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id::text = current_setting('app.organisation_id', true)
  )
  WITH CHECK (
    organisation_id IS NOT NULL
    AND current_setting('app.organisation_id', true) IS NOT NULL
    AND organisation_id::text = current_setting('app.organisation_id', true)
  );
```

Same for `workspace_identities`, `workspace_messages`, `workspace_calendar_events`. Manifest entries added in the same migration.

### 6.6 Backfill (seed-workspace-actors.ts)

```sql
-- 1. For each existing agent linked to a subaccount, create an actor.
INSERT INTO workspace_actors
  (organisation_id, subaccount_id, actor_kind, display_name, agent_role, agent_title)
SELECT a.organisation_id, sa.subaccount_id, 'agent', a.name, sa.agent_role, sa.agent_title
FROM agents a
JOIN subaccount_agents sa ON sa.agent_id = a.id
WHERE a.deleted_at IS NULL;

-- 2. For each existing user assigned to a subaccount, create an actor.
INSERT INTO workspace_actors (organisation_id, subaccount_id, actor_kind, display_name)
SELECT u.organisation_id, sua.subaccount_id, 'human', u.email
FROM users u
JOIN subaccount_user_assignments sua ON sua.user_id = u.id;

-- 3. Backfill `agents.workspace_actor_id` and `users.workspace_actor_id`.
-- 4. Translate `subaccount_agents.parentSubaccountAgentId` -> `workspace_actors.parent_actor_id`.
--    Existing parent links are preserved. Humans start with no parent unless explicit assignment data exists.
```

Backfill is gated by `scripts/verify-workspace-actor-coverage.ts` — every `agents` row + every `users` row in the relevant subaccount-assignment scope has a `workspace_actor_id` after the script runs.

### 6.7 (Removed) `workspace_documents`

Documents are deferred from v1 — see §18. No `workspace_documents` table is created. On Google Workspace, agents have a Drive scope granted at account creation but Automation OS does not mirror file metadata or render a documents UI. On native there is no document store. A canonical document table will be added in a follow-up spec when there is a concrete operator workflow that requires it.

---

## 7. Adapter contract — what every workspace adapter must implement

The contract is enforced as a TypeScript interface. Every adapter exports an instance of it. The same test suite (`canonicalAdapterContract.test.ts`) imports both adapters and runs the same scenarios against each. Behavioural divergence is a bug.

```typescript
// server/adapters/workspace/workspaceAdapterContract.ts

export interface WorkspaceAdapter {
  readonly backend: 'synthetos_native' | 'google_workspace';

  // Identity lifecycle
  provisionIdentity(params: ProvisionParams): Promise<ProvisionResult>;
  suspendIdentity(identityId: string): Promise<void>;
  resumeIdentity(identityId: string): Promise<void>;
  revokeIdentity(identityId: string): Promise<void>;
  archiveIdentity(identityId: string): Promise<void>;

  // Email
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
  fetchInboundSince(identityId: string, since: Date): Promise<InboundMessage[]>;

  // Calendar
  createEvent(params: CreateEventParams): Promise<CreateEventResult>;
  respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void>;
  fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]>;
}

export interface ProvisionParams {
  actorId: string;               // existing actor (created during seed/onboard)
  subaccountId: string;
  organisationId: string;
  connectorConfigId: string;
  emailLocalPart: string;        // "sarah" — adapter applies the domain
  displayName: string;
  photoUrl?: string;
  signature: string;
  emailSendingEnabled: boolean;  // mirrored to workspace_identities; pipeline checks
  provisioningRequestId: string; // idempotency key
}

export interface ProvisionResult {
  identityId: string;            // workspace_identities.id
  emailAddress: string;
  externalUserId: string | null; // null for native
}
```

**Adapter shape rules:**

- **Mirroring invariant (MUST).** For every external side-effect the adapter performs (Gmail send, Calendar event create, Admin SDK user provision, etc.), the adapter MUST produce exactly one canonical row write — `workspace_messages`, `workspace_calendar_events`, or `workspace_identities` as appropriate. Native adapters write canonical-only (no external system to mirror); Google adapters call the Google API **and** insert/update the canonical row in the same call site. Missing mirror writes are treated as data-loss bugs, not adapter quirks. Mirroring is the responsibility of the adapter, never the calling code.
- **Pipeline-only outbound (MUST NOT).** All outbound email MUST go through `workspaceEmailPipeline.send(...)` which performs audit / rate-limit / signing / policy / send-mail-toggle checks **before** calling `adapter.sendEmail`. Adapters MUST NOT be called directly for outbound email — calling `adapter.sendEmail()` outside the pipeline is a spec violation (brief §5.10). Static check: `adapter.sendEmail` is only referenced from `workspaceEmailPipeline.ts`; CI lints any other importer.
- Inbound: native ingests via the configured transactional email provider's inbound webhook (Postmark / SendGrid / Mailgun) into `workspace_messages`. Google adapter polls (or receives push notifications via Pub/Sub) and writes via `workspaceEmailPipeline.ingest(...)` which normalises and threads.
- Document-related methods are **not** part of the v1 contract — deferred per §18.
- Errors use the existing `failure(reason, ...)` envelope from `shared/iee/failure.ts`. New `FailureReason` values and their retryability:

  | `FailureReason` | Retryable | Notes |
  |---|---|---|
  | `workspace_identity_provisioning_failed` | yes | Transient Google / provider error. Retry with same `provisioningRequestId` — idempotent. |
  | `workspace_email_rate_limited` | yes | Back off and retry; pipeline quota resets per window. |
  | `workspace_email_sending_disabled` | no | Toggle is off. Retry will produce the same failure until the toggle is re-enabled. |
  | `workspace_provider_acl_denied` | no | Google returned 403. Operator action required (re-check service-account delegation). |
  | `workspace_idempotency_collision` | no | A different request already holds this key. Caller should use the existing row. |
  | `parent_actor_cycle_detected` | no | Setting this `parent_actor_id` would close a cycle. Operator must pick a different parent. |

  Job processors (`pg-boss`) classify `retryable: true` reasons as eligible for `withBackoff` replay; `retryable: false` reasons dead-letter immediately.

---

## 8. Email / calendar pipeline

### 8.1 Outbound email

```
Agent skill → workspaceEmailPipeline.send(SendEmailParams)
  ↓ (1) sending-enabled check — workspace_identities.email_sending_enabled = true
  ↓ (2) policy check — recipient allowlist, content policy
  ↓ (3) rate-limit check — per-identity quota AND per-organisation quota
  ↓ (4) signing — append subaccount-default signature unless per-identity override present
  ↓ (5) audit_events insert — direction='outbound', action='email.sent'
  ↓ (6) adapter.sendEmail(...)
  ↓ (7) workspace_messages insert (native = direct insert; Google = mirror after Gmail API success)
  ← SendEmailResult { messageId, externalMessageId? }
```

If step (1) fails, the call returns `failure(workspace_email_sending_disabled, ...)` without writing to `audit_events` or calling the adapter.

**Send-mail toggle edge case.** The toggle is checked once at pipeline entry (step 1), not continuously. If `email_sending_enabled` flips to `false` while a send is already in flight past step 1, that send completes normally — in-flight sends are not cancelled. This is intentional: cancelling a mid-flight send would leave the external provider in an unknown state. Callers that need stricter control should check the toggle before invoking the pipeline. The toggle takes effect on the *next* call.

**Native outbound infrastructure.** The native adapter sends through a transactional email provider (Postmark / SendGrid / Mailgun — chosen at deployment time via `NATIVE_EMAIL_PROVIDER` env var). The provider handles SPF / DKIM / bounce handling for the synthetos.io subdomain. We do not run our own SMTP infrastructure.

**Rate-limit scopes.** Two independent caps gate every outbound send:

- **Per-identity** — bounded sends per rolling window. Defaults: 60/min, 1000/hour, 5000/day. Tunable per-subaccount via `connector_configs.config_json.rateLimitOverride`.
- **Per-organisation** — bounded sends across all identities in the organisation. Defaults: 600/min, 20000/hour, 100000/day. Tunable on `org_subscriptions.metadata.workspaceRateLimitOverride`.

A send fails fast on whichever scope trips first. Failure: `failure(workspace_email_rate_limited, { scope: 'identity' \| 'org', windowResetAt })`. The per-org cap exists to contain runaway loops (one buggy skill flooding through every agent identity) — it is a defence-in-depth layer, not the primary tuning knob. **Simultaneous-trip tie-break:** if a single check observes both scopes exceeded in the same call, return whichever has the *later* `windowResetAt` (the tighter constraint from the caller's perspective — they're going to wait the longer of the two anyway). The scope returned to the caller drives the user-visible message, so picking the longer wait avoids a misleading "wait 60s" when the real wait is 1 hour. **Implementation note:** counters are tracked in Redis (or whatever the existing rate-limit primitive uses; see `withBackoff` / `TripWire` ecosystem); no new schema. Both scopes share the same `failure` envelope so callers do not branch on scope.

### 8.2 Inbound email

```
Native: transactional email provider's inbound webhook (verified via NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET)
Google: Pub/Sub watch notification (or scheduled poll fallback)
  → workspaceEmailPipeline.ingest(rawMessage)
  ↓ (1) parse — RFC 5322 to canonical fields
  ↓ (2) compute dedupe_key = sha256(from + subject + sent_at_iso + providerMessageId)
        — store on metadata.dedupe_key, gates workspace_messages_dedupe_uniq
  ↓ (3) thread resolution — match In-Reply-To + References to existing thread_id
  ↓ (4) attachment handling — store metadata; defer body fetch unless requested
  ↓ (5) audit_events insert — direction='inbound', action='email.received'
  ↓ (6) workspace_messages insert (23505 on dedupe_uniq → silent upsert no-op)
  ↓ (7) downstream trigger — emit IEE event for skill handlers / orchestrator routing
```

The `dedupe_key` is computed for every inbound message regardless of backend. For Google the `external_message_id` (Gmail `messageId`) carries idempotency on its own; the dedupe key is a defence-in-depth layer. For native, where the transactional provider may not surface a stable id, the dedupe key is the **only** idempotency mechanism — duplicate webhook deliveries are silently absorbed by `workspace_messages_dedupe_uniq`. Hash collisions on sha256 are considered practically impossible — no secondary check is performed and none should be added.

**Thread ID derivation (canonical, not provider).** Thread identity is owned by Automation OS, not by Gmail thread IDs or any provider concept. The threading rule, applied at step (3):

```
thread_id =
  if In-Reply-To or References headers resolve to an existing workspace_messages.thread_id
    → reuse that thread_id
  else
    → uuidv7()  (new thread root; monotonic, index-friendly)
```

This guarantees that inbound replies to outbound messages land in the same thread regardless of backend, and that a native-to-Google migration does not shatter conversation history. Provider thread IDs (`Gmail.threadId`) are stored in `metadata` for deep-linking only.

### 8.3 Calendar

Native runs RFC 5546 calendar-over-email — invites and replies are specially-formatted emails with iCalendar (.ics) attachments. The inbound pipeline detects iCal attachments and creates `workspace_calendar_events` rows alongside the message row. Outbound responses (accept / decline / tentative) emit a reply email with the appropriate iCal payload.

Google syncs from the Calendar API. `workspaceCalendarSyncService` polls every 5 min per active Google identity (or receives push notifications via Pub/Sub if configured). New / changed events are mirrored to `workspace_calendar_events`.

Outbound event creation goes through `adapter.createEvent`; the response (`accept` / `decline` / `tentative`) goes through `adapter.respondToEvent`. Both write to `workspace_calendar_events` after success.

### 8.4 Provider-permission boundary (brief §5)

Per the brief, provider ACLs are authoritative for provider-hosted resources:

- Gmail thread visibility / Calendar event visibility on the Google adapter: query Google's API via the service-account-delegated identity. Don't check our own permissions table — Google already gates.
- Drive (deferred): when documents land in a follow-up spec, the same rule applies — Google governs ACLs.

This split prevents "Automation OS thinks the agent can read X but Google says no" failures.

---

## 9. Provisioning, migration, deprovisioning runbook

### 9.1 Onboarding (the "Onboard to workplace" flow)

The actor row already exists by the time onboarding runs (created during seed for every existing agent + user, or during subaccount-agent linking for newly added agents). Onboarding does **not** create the actor — it creates the identity that lets the actor receive email and calendar invites.

```
POST /api/subaccounts/:saId/workspace/onboard
  body: { agentId, displayName, emailLocalPart, emailSendingEnabled,
          signatureOverride?, onboardingRequestId }
  ↓
authenticate → resolveSubaccount → requireSubaccountPermission('agents:onboard')
  ↓
withOrgTx(orgId)
  ↓ (1) check workspace backend is configured for the subaccount
  ↓ (2) resolve actor: workspace_actors row already exists for this agent
        (idempotency safety: fail loudly if not — backfill is a hard prerequisite)
  ↓ (3) check onboarding_request_id not already used → 200 idempotent return if so
  ↓ (4) check email_local_part is unique within connector_config
  ↓ (5) update actor display_name (operator may have edited it on the modal)
  ↓ (6) adapter.provisionIdentity({ actorId, emailLocalPart, emailSendingEnabled, ... })
        ← outside transaction (external call to Google or transactional email provider)
  ↓ (7) workspaceIdentityService.markActive(identityId)
  ↓ (8) emit audit_events: actor.onboarded + identity.provisioned + identity.activated
  ↓ (9) emit IEE event: identity.activated
  ← 201 { identityId, emailAddress }
```

**Request ID semantics — two distinct concepts:**

- `onboardingRequestId` — generated by the UI, passed in the request body, scoped to one modal session. Identifies "the operator's intent to onboard this agent in this sitting." Passed through to `adapter.provisionIdentity` as the `provisioningRequestId`. If the user opens the modal twice for the same agent, two different `onboardingRequestId` values are generated; the second will 409 on `workspace_identities_actor_backend_active_uniq` (identity already exists), not on the request-ID index.
- `provisioningRequestId` — persisted on `workspace_identities.provisioning_request_id`. This is the durable idempotency key stored in the DB row. For onboarding flows it equals the `onboardingRequestId`. For migration flows it equals `migrationRequestId` (keyed on the batch, not the per-identity call). The distinction matters: the same DB column carries two conceptually different upstream keys depending on which flow created the identity.

**Idempotency:** keyed on `provisioningRequestId` via `workspace_identities_provisioning_request_uniq`. UI generates a fresh UUID per modal session; double-click returns the same identity.

**Failure modes & rollback:**

- Step (2) fails (no actor for this agent): hard error. Indicates broken backfill / missing seed. Operator-visible message: "agent has no workspace actor — contact support". Should never happen post-seed.
- Adapter step (6) fails before identity created (e.g. Google quota): no `workspace_identities` row written; user sees error toast; can retry with the same `onboardingRequestId` (no-op duplicate). Existing actor is untouched.
- Adapter step (6) creates external user but local insert fails: orphan in Google. Cleanup job `workspaceProvisioningOrphanReaper` reconciles by listing Google users matching the configured domain and checking for missing local rows. (Deferred — sweep runs nightly.)
- Step (7)–(8) fail after identity is `provisioned` but before `active`: a follow-up retry lands on step (7) (idempotent transition).

### 9.2 Suspension

```
POST /api/agents/:agentId/identity/suspend
  ↓ requireSubaccountPermission('agents:manage_lifecycle')
  ↓ workspaceIdentityService.transition(identityId, 'active' → 'suspended')
    — predicate: WHERE status = 'active'
    — 0 rows affected → return current status (race-safe, first-commit-wins)
  ↓ adapter.suspendIdentity(...)
  ↓ audit_events: action='identity.suspended'
  ← 200 { status: 'suspended', seatFreedImmediately: true }
```

Same shape for `resume`, `revoke`, `archive`. State machine §14.7.

### 9.3 Migration (per-subaccount)

```
POST /api/subaccounts/:saId/workspace/migrate
  body: { targetBackend: 'google_workspace', targetConnectorConfigId, migrationRequestId }
  ↓ requireSubaccountPermission('subaccounts:manage_workspace')
  ↓
For each active or suspended identity at the subaccount,
  ORDER BY actor_id ASC  — deterministic order for reproducibility + failure replay:
  (a) targetAdapter.provisionIdentity({ actorId: currentActorId, ... })
      — keyed on migrationRequestId + actorId for idempotency
  (b) workspaceIdentityService.transition(newIdentityId, 'activate')
      — target identity becomes 'active'; partial-unique index allows concurrent
        active rows on different backends for the same actor
  (c) workspaceIdentityService.transition(currentIdentityId, 'archive')
      — source identity becomes 'archived', archived_at=now(); seat consumption
        is unaffected because target is already active
  (d) audit_events: action='identity.migrated', metadata.from=currentIdentityId
                                                metadata.to=newIdentityId
```

**Ordering rationale.** Provision-then-archive (rather than archive-then-provision) is deliberate. If step (a) fails, the source remains active and the actor is unaffected — a clean retry. If steps (a)+(b) succeed but (c) fails, the actor briefly has two active identities on different backends; the unique index `workspace_identities_actor_backend_active_uniq` permits this since it's scoped per-backend. The next retry of (c) is idempotent (state-based predicate `WHERE status IN ('active','suspended')`). No state where the actor has zero active identities is reachable mid-flight.

**Failure modes:**

- Migration is per-identity within a per-subaccount loop. Each identity migration is its own transaction. A failure on one identity does NOT roll back others.
- A partial migration leaves the subaccount in a "mixed" state (some actors on new backend, some on old). The Workspace tab shows a banner: "Migration partially completed. 3 of 4 identities migrated. Retry?"
- **A partially migrated subaccount continues operating normally — both backends remain fully functional until migration completes.** Already-migrated actors send/receive on the new backend; not-yet-migrated actors continue on the old backend. There is no system-wide pause, no dual-write window, and no operator-visible degradation while a migration is in progress.
- Retrying a migration is keyed on `(migrationRequestId, actorId)` — already-migrated actors skip; failed actors retry.
- **Archive is irreversible via the migration pipeline.** Once a source identity reaches `archived`, it does not transition back. Recovery from a corrupted migration requires an explicit out-of-band restore flow (provision a fresh identity on the desired backend; deferred until a real recovery scenario forces the design).

### 9.4 Deprovisioning (revoke)

Per brief: revoke removes access, preserves owned resources. Deletion is never automatic.

```
POST /api/agents/:agentId/identity/revoke
  ↓ confirmation gate at UI layer (type the agent name)
  ↓ workspaceIdentityService.transition(identityId, '*' → 'revoked')
  ↓ adapter.revokeIdentity(...)
    — Google: Admin SDK users.delete (after a configurable grace period for data
      retention) OR Admin SDK users.update {suspended: true} (default).
      Default at launch: suspend-not-delete, to preserve provider audit trail.
  ↓ audit_events: action='identity.revoked'
```

**Default revoke semantics:** the Google adapter uses `users.update { suspended: true }` (not `users.delete`) so Google's audit logs continue to attribute historical actions. An explicit "Delete from Google entirely" option is **deferred** to a follow-up — see Q-§9.4 in §17.

---

## 10. Permissions / RLS / multi-tenant safety

### 10.1 New permission keys

| Key | Scope | Default for `manager` | Default for `org_admin` |
|---|---|---|---|
| `subaccounts:manage_workspace` | subaccount | no | yes |
| `agents:onboard` | subaccount | yes | yes |
| `agents:manage_lifecycle` (suspend / resume / revoke) | subaccount | no | yes |
| `agents:toggle_email` | subaccount | no | yes |
| `agents:view_mailbox` | subaccount | yes (own subaccount) | yes |
| `agents:view_calendar` | subaccount | yes | yes |
| `agents:view_activity` | subaccount | yes (own subaccount) | yes |

`system_admin` and `org_admin` bypass all. New keys appear in `permission_set_items` seeded by migration. UI hides the relevant buttons when the principal lacks the key.

The Activity tab + subaccount Activity page reuse `EXECUTIONS_VIEW` (already required by the existing `activity.ts` route) — no new audit-specific permission added.

### 10.2 Per-table RLS

Every canonical workspace table has the `_org_isolation` policy shape from §6.6. Manifest entry added in the same migration. CI gate `verify-rls-coverage.sh` runs as part of the pre-merge gate.

### 10.3 Principal-scoped access on agent execution paths

Agent skill handlers that read mailbox / calendar read from the canonical tables under a `ServicePrincipal` whose `actor_id` is the agent's `workspace_actor_id`. Predicates filter to `actor_id = principal.actor_id` for owned resources.

### 10.4 Provider-permission boundary (recap)

Gmail / Calendar ACLs on the Google adapter are owned by Google. We do NOT cache or re-implement them. If the adapter call returns 403, surface the error as `failure(workspace_provider_acl_denied, ...)` and let the caller handle it. Don't pre-check; let Google authoritatively answer.

### 10.5 Multi-tenant safety checklist (per `DEVELOPMENT_GUIDELINES.md` §9)

- [x] Every new tenant-scoped table has `organisation_id NOT NULL` + RLS policy + manifest entry.
- [x] Cross-org queries are impossible at the DB layer (RLS forces session var).
- [x] Service layer uses `withOrgTx` for tenant work; `withAdminConnection` for admin/system work.
- [x] No raw `db.execute(...)` writes; all writes go through Drizzle (auto Proxy-guarded by `rlsBoundaryGuard`).
- [x] New routes name an explicit middleware guard (`authenticate`, `resolveSubaccount`, permission key).
- [x] Adapter calls to external providers carry `subaccountId` + `organisationId` so audit events tie back to tenant.
- [x] Idempotency keys (`onboarding_request_id`, `migration_request_id`) are scoped — two different orgs cannot collide.
- [x] No bypass paths through `getOrgScopedDb` for canonical workspace tables.

### 10.6 Billing seat derivation

Pure function, single source of truth:

**Only `active` consumes a seat.** `provisioned` (the pre-activate transitional state during onboarding) does NOT consume a seat. `suspended`, `revoked`, and `archived` do not consume a seat. There is no race-window ambiguity during onboarding because the rollup reads committed rows and the transition `provisioned → active` is atomic. The Workspace tab's inline seat count and the hourly rollup MUST agree at all times.

```typescript
// shared/billing/seatDerivation.ts
export type WorkspaceIdentityStatus =
  | 'provisioned' | 'active' | 'suspended' | 'revoked' | 'archived';

export function deriveSeatConsumption(status: WorkspaceIdentityStatus): boolean {
  return status === 'active';
}

export function countActiveIdentities(
  identities: { status: WorkspaceIdentityStatus }[]
): number {
  return identities.filter(i => deriveSeatConsumption(i.status)).length;
}
```

Wired into:

- The existing seat-rollup job (`server/jobs/seatRollupJob.ts` if exists, or extend the subscription rollup) — runs hourly, writes the count to `org_subscriptions.consumed_seats`.
- The Workspace tab `SeatsPanel.tsx` — reads identities for the subaccount, calls `countActiveIdentities`.

**Rollup timing.** The inline `SeatsPanel` display is authoritative — it reads live from `workspace_identities` on page load. The hourly rollup written to `org_subscriptions.consumed_seats` is eventually consistent (≤1 hour lag). Billing systems that read from the rollup must account for this lag. The two values will converge; momentary divergence is expected and not a bug.

Pricing (per-seat amount, agency-bundled rates) is **out of scope** per brief — only the *unit of monetisation* and its derivation are spec'd here.

---

## 12. Contracts (data shapes crossing service boundaries)

### Contract `ProvisionParams` / `ProvisionResult`

- **Type:** TypeScript interface (`server/adapters/workspace/workspaceAdapterContract.ts`).
- **Producer:** `workspaceOnboardingService` calls `adapter.provisionIdentity(params)`.
- **Consumer:** `nativeWorkspaceAdapter`, `googleWorkspaceAdapter`.
- **Example:**
  ```json
  {
    "actorId": "act_01HZX5W3AAA0001",
    "subaccountId": "sa_01HZ...",
    "organisationId": "org_01HZ...",
    "connectorConfigId": "cc_01HZ...",
    "emailLocalPart": "sarah",
    "displayName": "Sarah",
    "photoUrl": null,
    "signature": "Sarah\nMarketing analyst · Acme Client Co.",
    "emailSendingEnabled": true,
    "onboardingRequestId": "onboard_req_01HZX5W3..."
  }
  ```
- **Nullability:** `photoUrl` may be null (server auto-generates). `externalUserId` in result is null for `synthetos_native` and required for `google_workspace`.

### Contract `WorkspaceIdentityRow`

- **Type:** Drizzle row, mirrored to `shared/types/workspace.ts`.
- **Producer:** `workspaceIdentityService` (only writer).
- **Consumer:** all read paths — UI, audit, billing, agent execution.
- **Source-of-truth precedence:** the DB row is canonical. Adapter mirroring of canonical tables is one-way (adapter writes after external success). If a Google Admin SDK row reports `suspended` but our row says `active`, our row is wrong — a reconciliation job (`workspaceIdentityReconciliationJob`, deferred to a fast-follow) detects drift.

### Contract `SendEmailParams` (outbound pipeline input)

- **Type:** TypeScript interface, exported from `workspaceEmailPipeline.ts`.
- **Example:**
  ```json
  {
    "fromIdentityId": "wid_01HZ...",
    "toAddresses": ["maya@acme.com"],
    "ccAddresses": [],
    "subject": "Re: Q2 attribution dashboard",
    "bodyText": "...",
    "bodyHtml": null,
    "threadId": "thr_01HZ...",
    "inReplyToExternalId": "<gmail-msg-id@mail.gmail.com>",
    "policyContext": { "skill": "marketing-analyst:reply", "runId": "run_01HZ..." }
  }
  ```
- **Sending-enabled gate:** the pipeline reads `workspace_identities.email_sending_enabled` for the `fromIdentityId` and rejects with `failure(workspace_email_sending_disabled, ...)` if false. No audit row is written.
- **Producer:** agent skill handlers; `Compose` modal in mailbox UI.
- **Consumer:** `workspaceEmailPipeline.send` then `adapter.sendEmail`.

### Contract `audit_events.actor_id` join semantics

- **Source-of-truth precedence:** `audit_events.actor_id` is the canonical actor reference. Existing `audit_events.actor_id_legacy` (renamed from current `actorId`) + `actor_type` are kept for pre-migration rows. New writes populate `actor_id`. Reads prefer `actor_id` and fall back to legacy when null.
- **Backfill:** migration `0241` populates `actor_id` for every existing row by joining `actor_id_legacy → users / agents → workspace_actor_id`.

### Contract `MigrateSubaccountResponse` (per-subaccount migration result)

- **Type:** TypeScript interface, returned by `POST /api/subaccounts/:saId/workspace/migrate` (final result; the endpoint is async — see §13 — so this shape is delivered via job-completion socket or the per-batch status poll).
- **Shape:**
  ```typescript
  interface MigrateSubaccountResponse {
    status: 'success' | 'partial' | 'failed';  // matches subaccount.migration_completed terminal event (§14.4)
    total: number;                              // identities considered
    migrated: number;                           // succeeded
    failed: number;                             // hard-failed; not retried
    failures: Array<{
      actorId: string;
      previousIdentityId: string;
      reason: string;       // FailureReason from failure() envelope
      retryable: boolean;   // false = won't help; true = retry the migrationRequestId
    }>;
  }
  ```
- **Status semantics** (mirrors §14.4 no-silent-partial-success rule): all migrated → `success`; some migrated, some failed → `partial`; none migrated → `failed`. The Workspace tab banner reads from `failures[]` to show the per-actor reason and the "Retry?" CTA.

### Contract `ActivityFeedItem` ordering

- **Type:** Drizzle row shape consumed by `<ActivityFeedTable>`.
- **Source-of-truth precedence:** ordering is strictly `created_at DESC` from the canonical row (`audit_events.created_at` for new event types; existing source rows for the 6 pre-existing types). **Never** order by adapter-supplied timestamps (Gmail `internalDate`, Calendar `created`) — those drift, span timezones, and lie when providers reprocess. The activity feed is canonical-time-ordered so the agent profile and the subaccount-wide page agree row-for-row.
- **Tie-breaker:** `id ASC` within the same `created_at`, for stable pagination.
- **Pagination:** cursor-based, not offset-based. Cursor shape: `{ created_at: string; id: string }`. Clients pass `?cursor=<opaque-base64>` on subsequent pages. Offset pagination produces drift under concurrent inserts and is explicitly forbidden for this feed. Page size default: 50 items. Max: 200.

### Contract `WorkspaceTenantConfig` (subaccount-level)

- **Type:** JSON shape on `subaccounts.workspace_config_json` (or a derived view of `connector_configs` filtered by workspace types — TBD in implementation; current design uses `connector_configs`).
- **Example:**
  ```json
  {
    "backend": "google_workspace",
    "connectorConfigId": "cc_01HZ...",
    "domain": "clientco.com",
    "defaultSignatureTemplate": "{agent-name}\n{role} · {subaccount-name}",
    "discloseAsAgent": false,
    "vanityDomain": null
  }
  ```
- **`discloseAsAgent`:** when true, the signature template is augmented with a "Sent by {name}, AI agent at {subaccount-name}, on behalf of {agency-name}" disclosure line. Default false at launch — operators opt in for compliance contexts.

---

## 13. Execution model (sync / async / inline / queued)

| Operation | Model | Why |
|---|---|---|
| `POST /workspace/onboard` | **Inline / synchronous** | Operator waits on the modal. Adapter call (Google API) is the slow part; pipeline runs inline so the user sees success/failure within the same request. Maximum acceptable latency: ~10s for Google. |
| `POST /workspace/migrate` | **Inline initially, then queued** | The endpoint enqueues per-identity migration jobs onto pg-boss. Returns 202 with a `migrationJobBatchId`. UI polls or subscribes to socket for completion. Reason: per-identity Google calls can take ~30s each; serialising in a single HTTP request is hostile to timeouts. |
| Per-identity migration step | **Queued (pg-boss)** | One job per identity. Idempotent on `(migrationRequestId, actorId)`. Replays-safe. |
| `workspaceEmailPipeline.send` | **Inline** | Agent skill handlers call this synchronously as part of their run; result determines IEE event payload. |
| Inbound email ingest (native) | **Inline** | The native ingest endpoint receives, normalises, writes — done. |
| Inbound email ingest (Google push/watch) | **Queued** | Webhook receipt is fast; ingest pipeline runs as a `gmail.inbound.ingest` job. Reason: webhook handlers must be fast to keep Google retries quiet. |
| Adapter "fetch upcoming calendar events" sync | **Queued (pg-boss, periodic)** | Job runs every 5 min per active Google identity. Mirrors recent events. |
| Seat-rollup recompute | **Queued (pg-boss, hourly)** | Existing rollup job extended. |
| Identity-status reconciliation | **Queued (deferred to fast-follow)** | Detects drift between local + Google `suspended` flag. Out of scope at launch; tracked in §18. |

---

## 14. Execution-safety contracts (per spec authoring checklist §10)

### 14.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `POST /workspace/onboard` | **key-based** | `onboarding_request_id` (UUID from UI) + `workspace_identities_provisioning_request_uniq`. 23505 → 200 with the existing row. |
| `POST /workspace/migrate` per identity | **key-based** | `(migrationRequestId, actorId)` uniqueness via `metadata.migrationRequestId` on `workspace_identities` + a partial unique index on the metadata field. |
| `POST /agents/:id/identity/suspend` (and resume / revoke / archive) | **state-based** | `UPDATE workspace_identities SET status = 'suspended' WHERE id = ? AND status = 'active'`. 0 rows → return current status (race-safe; first-commit-wins). |
| `PATCH /agents/:id/identity/email-sending` | **state-based** | `UPDATE workspace_identities SET email_sending_enabled = ? WHERE id = ?`. Idempotent by definition (last write wins). |
| `workspaceEmailPipeline.send` | **non-idempotent (intentional)** | An email send is a real-world side effect. Caller is responsible for not retrying after success. We tag with `audit_events.id` so retry detection is possible diagnostically, but the pipeline does not itself dedup. **Callers MUST NOT retry `sendEmail` after a success or unknown result without an application-level idempotency key.** The pipeline does not provide deduplication for outbound sends; wrapping it in a generic retry loop is a spec violation. |
| Inbound email ingest | **key-based** | `workspace_messages_external_uniq` on `(identity_id, external_message_id)`. Duplicate Gmail webhook → upsert no-op. |

### 14.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| `adapter.provisionIdentity` | `guarded` | Wrapped by `provisioningRequestId`. Safe to retry. |
| `adapter.sendEmail` | `unsafe` | Pipeline records the audit event before calling the adapter — caller can detect "did the audit row exist before this retry?" If yes, do NOT retry. |
| `adapter.suspendIdentity` / `resume` / `revoke` | `safe` | Idempotent on Google's side (`users.update {suspended: true}` is set-not-toggle). |
| pg-boss jobs | `guarded` | All jobs use `withBackoff` + idempotency key in payload. |

### 14.3 Concurrency guards

| Race | Guard | Loser sees |
|---|---|---|
| Two operators clicking "Suspend" simultaneously | Optimistic predicate `WHERE status = 'active'`. | The current status (`'suspended'`) returned 200 with `noOpDueToRace=true`. |
| Two parallel "Onboard" clicks (UI double-click) | `onboarding_request_id` uniqueness. | The existing identity returned 200 idempotent-hit. |
| Two parallel migrations of the same subaccount | `subaccount_id` advisory lock acquired at the start of `workspaceMigrationService.start()`. Second caller gets 409 `migration_already_in_progress`. |
| Concurrent inbound email ingests for the same Gmail message | `workspace_messages_external_uniq`. Loser's INSERT raises 23505 → upsert no-op, returns existing row. |

### 14.4 Terminal event guarantee

Every workspace-domain flow has exactly one terminal event:

| Flow | Terminal event | `status` field |
|---|---|---|
| Onboard | `identity.activated` (success) or `identity.provisioning_failed` (failure) | `success` / `failed` |
| Suspend | `identity.suspended` | `success` |
| Resume | `identity.resumed` | `success` |
| Revoke | `identity.revoked` | `success` |
| Email-sending toggle | `identity.email_sending_enabled` / `identity.email_sending_disabled` | `success` |
| Migration of one identity | `identity.migrated` (success) or `identity.migration_failed` (failure) | `success` / `failed` |
| Migration of one subaccount | `subaccount.migration_completed` (with per-identity status array) | `success` / `partial` / `failed` |

**No-silent-partial-success rule:** the subaccount-level terminal event uses `status='partial'` if and only if at least one identity migrated and at least one failed. Pure-failure → `failed`. Pure-success → `success`.

### 14.5 Unique-constraint-to-HTTP mapping

| Constraint | HTTP status |
|---|---|
| `workspace_identities_provisioning_request_uniq` | 200 with idempotent existing row. Body includes `idempotent: true`. |
| `workspace_identities_actor_backend_active_uniq` | 409 `identity_already_exists_for_actor_in_backend` |
| `workspace_identities_email_per_config_uniq` | 409 `email_address_already_in_use` |
| `workspace_messages_external_uniq` | 200 (silent upsert; inbound ingest is meant to be idempotent) |
| `workspace_calendar_events_external_uniq` | 200 (same) |

No `23505` ever bubbles as a 500.

### 14.6 State machine — `workspace_identity_status`

```
                  ┌──────────────┐
                  │ provisioned  │  ← created by adapter; pre-Active gate
                  └──────┬───────┘
                         │ activate
                         ▼
                  ┌──────────────┐
       ┌─────────▶│   active     │◀─────────┐
       │          └──────┬───────┘          │
       │                 │ suspend          │ resume
       │                 ▼                  │
       │          ┌──────────────┐          │
       │          │  suspended   │──────────┘
       │          └──────┬───────┘
       │                 │ revoke
       │                 ▼
       │          ┌──────────────┐
       │          │   revoked    │  (terminal — no return)
       │          └──────┬───────┘
       │                 │ archive (post-migration; optional)
       │                 ▼
       │          ┌──────────────┐
       └──        │   archived   │  (terminal — audit anchor only)
                  └──────────────┘
```

**Forbidden transitions:**

- `provisioned → suspended` (must go through `active` first)
- `revoked → *` (terminal)
- `archived → *` (terminal)
- Any transition with no `status_changed_by` set (the change must be attributable)

**Valid transitions:**

- `provisioned → active`
- `active → suspended`, `active → revoked`, `active → archived`
- `suspended → active`, `suspended → revoked`, `suspended → archived`
- `revoked → archived` (cleanup-only)

**Status set is closed.** Adding a new value requires a spec amendment.

---

## 15. Phase sequencing — dependency graph

The work is split into five phases. Each phase is a separate PR off a shared feature branch. Order is dictated by dependency.

### Phase A — Schema + manifest + permissions + system-agent rename (foundation)

**Migrations introduced:** `0240_workspace_canonical_layer.sql` + `0241_workspace_actor_fks_and_hierarchy.sql` + `0242_system_agents_human_names.sql`.
**Tables introduced:** `workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events`.
**Columns referenced by code in this phase:** all columns above + new FK columns on `agents`, `users`, `agent_runs`, `audit_events` + `parent_actor_id` populated from existing `subaccount_agents.parentSubaccountAgentId`.
**Seeds:** `scripts/seed-workspace-actors.ts` populates actor rows for every existing agent + user. System agents intended for subaccount-level use are renamed to human-style names with explicit `agent_role`.
**Gate:** `scripts/verify-workspace-actor-coverage.ts` is added to CI; passes after seed.
**Permissions:** new permission keys (`subaccounts:manage_workspace`, `agents:onboard`, `agents:manage_lifecycle`, `agents:toggle_email`, `agents:view_mailbox`, `agents:view_calendar`, `agents:view_activity`) added to seed in same migration.
**Config:** `server/config/c.ts` agent registry updated with human names + roles.

No services or routes ship in this phase. Pure schema + seed + manifest + config.

### Phase B — Native adapter + canonical pipeline + onboard flow

**Services introduced:** `workspaceActorService`, `workspaceIdentityService`, `nativeWorkspaceAdapter`, `workspaceEmailPipeline` (+ `Pure`), `workspaceOnboardingService`.
**Routes introduced:** `server/routes/workspace.ts` (onboard / suspend / resume / revoke / archive / email-sending-toggle — native only), `workspaceMail.ts`, `workspaceCalendar.ts`.
**Frontend:** `OnboardAgentModal` (3-step: identity / confirm / progress + success), Identity tab on `SubaccountAgentEditPage`, Workspace tab on `AdminSubaccountDetailPage` (native-only — Google card disabled with a "coming next phase" tooltip), per-row "Onboard to workplace" CTA on `SubaccountAgentsPage`, `EmailSendingToggle` component.
**Native infra:** transactional email provider configured (Postmark / SendGrid / Mailgun); MX records pointed at provider for the `<subaccount-slug>.synthetos.io` zone; inbound webhook secured.
**Phase B is the demoable milestone:** every native flow works end-to-end, no Google dependency.

### Phase C — Google adapter

**Services introduced:** `googleWorkspaceAdapter`.
**Adapter contract test suite:** `canonicalAdapterContract.test.ts` runs against both adapters.
**Frontend:** Google Workspace card on Workspace tab now functional. OAuth + service-account configuration flow.
**Env:** `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON`, `GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER` added to `.env.example`.

### Phase D — Org chart + Activity wiring + seats

**Frontend:** `OrgChartPage` extended to render humans + agents from `workspace_actors` with `parent_actor_id` hierarchy. `ActivityPage` extended with actor-filter UI; subaccount-scope SPA route un-redirected. `<ActivityFeedTable>` shared component extracted. New `AgentActivityTab` rendered inside `SubaccountAgentEditPage`. `SeatsPanel` on the Workspace tab.
**Services modified:** `activityService` extended with new event types and `actorId` filter; emits `audit_events` rows for new types from the email/calendar pipelines (already wired in phase B but the Activity surfaces consume them here). Seat-rollup job extended to call `deriveSeatConsumption` over `workspace_identities`.
**Routes modified:** `activity.ts` route parser accepts `actorId`.

### Phase E — Migration runbook

**Services introduced:** `workspaceMigrationService` + per-identity migration job processor.
**Frontend:** `MigrateWorkspaceModal`.
**Tests:** end-to-end "native → google" migration test against the canonical adapter contract suite (no live Google calls; uses a mock `googleWorkspaceAdapter` in test mode).

### Dependency check

| Phase | Depends on |
|---|---|
| A | (nothing) |
| B | A (tables + actors must exist; system agents renamed before any UI surfaces them) |
| C | B (pipeline + adapter contract must exist) |
| D | C (org chart needs both backends populated; Activity needs new event types from email/calendar pipelines) |
| E | D (migration uses both backends; org chart shows result) |

No backward references. No orphaned deferrals (every "deferred to phase N+1" is realised). No phase-boundary contradictions.

---

## 16. Acceptance criteria

Per brief §8 success conditions, plus the spec-level checks:

- [ ] An operator at a pilot agency can onboard an existing subaccount agent in 4 clicks.
- [ ] The agent's email and photo show on the existing org chart card after onboarding.
- [ ] Both humans and agents appear on the org chart, joined via `workspace_actors.parent_actor_id`.
- [ ] Sending the agent email lands in `workspace_messages`; the agent's mailbox shows it.
- [ ] Inviting the agent to a meeting writes a `workspace_calendar_events` row; the agent's calendar shows the event with `response_status='needs_action'`.
- [ ] An agent skill that calls `workspaceEmailPipeline.send(...)` produces an outbound email under the agent's identity, IF `email_sending_enabled` is true.
- [ ] If `email_sending_enabled = false`, `workspaceEmailPipeline.send()` returns `failure(workspace_email_sending_disabled, ...)` without writing audit or contacting the adapter.
- [ ] All agent actions are audit-attributable to `actor_id` in `audit_events`.
- [ ] The Activity tab on the agent profile shows that agent's events filtered by `actor_id`.
- [ ] The subaccount-wide Activity page (existing `ActivityPage`) shows all activity with the new actor filter exposed.
- [ ] System agents intended for subaccount-level use have human-style names + explicit `agent_role`.
- [ ] Email handles do not have an `agent-` prefix on either backend.
- [ ] The same flows work against `nativeWorkspaceAdapter` and `googleWorkspaceAdapter` with identical user-facing UX (verified by the contract test suite).
- [ ] Suspending an agent freezes seat consumption; resuming restores it.
- [ ] Migrating a subaccount from native to Google produces (a) archived identities on native, (b) new active identities on Google, (c) a single `actor_id` linking both.
- [ ] Adding a Microsoft adapter post-launch is purely an adapter file — no schema, UX, or permission change. (Verified by extending the contract test suite with a mock `microsoftWorkspaceAdapter` and running it.)
- [ ] All new tenant tables have RLS policies, manifest entries, and pass `verify-rls-coverage.sh`.
- [ ] `verify-workspace-actor-coverage.ts` passes in CI.
- [ ] The `deriveSeatConsumption` rollup matches the inline display on the Workspace tab.
- [ ] Every screen in `prototypes/agent-as-employee/index.html` is implemented in the live app (layout, copy, primary actions match).

---

## 17. Open product questions (carried from brief §7, plus spec-induced)

These are decided defaults at spec time. Implementation can proceed; revisit during phase reviews if a real customer's case forces a different answer.

| ID | Question | Default |
|---|---|---|
| Q1 (brief) | Native-backend agent email domain | Option A: `{name}@{subaccount-slug}.synthetos.io`. **Resolved:** dropped the `agent-` prefix per design review — agents look human externally. Option B (vanity) deferred. |
| Q2 (brief) | Profile photos auto-generated or required | Auto-generated, deterministic from `display_name`. Operator override deferred to v2. |
| Q3 (brief) | Email signatures default or per-agent | Subaccount-level default. **Resolved:** per-agent configurability deferred. Disclosure (e.g. "Sent by … AI agent at …") is opt-in per subaccount via `WorkspaceTenantConfig.discloseAsAgent`, not mandatory. Reverses the brief's non-negotiable disclosure stance — see §1 framing change. |
| Q4 (brief) | Document ownership: agents own or only access | **Resolved by deferral.** Documents are deferred from v1 entirely — see §18. When the canonical document table lands in a follow-up, agents will own. |
| Q5 (brief) | Calendar invitations: outbound or inbound only | Both. Spec encodes outbound via `adapter.createEvent` and inbound via the inbound email pipeline (iCal parsing). |
| Q-§3.8 (spec) | Native-backend humans during migration | At launch, native-only subaccounts have no human identities (humans use the SaaS app, not native email). On migration to Google, only agent identities are migrated. If a future customer asks for "native human identity migration," that's a separate spec. |
| Q-§9.4 (spec) | Revoke = suspend or hard-delete on Google | Default suspend (preserves Google audit). Hard-delete is a deferred follow-up with a 30-day grace period and explicit operator confirmation. |
| Q-§14.1 (spec) | Migration tracking: separate `workspace_migration_attempts` table or metadata field on `workspace_identities` | Default to a metadata field on `workspace_identities` (`metadata.migration_request_id`) plus a partial unique index. If observability requires more, a follow-up spec adds the table. |
| Q-§3 (spec) | Should the agent profile Activity tab share the full `ActivityPage` component with hard-coded scope, or render its own focused view | **Resolved:** focused inline view inside the tab. Shares the backend endpoint and a small `<ActivityFeedTable>` primitive with the subaccount page. Does NOT import `ActivityPage` itself. Per design review. |
| Q-§5 (spec) | Agent-`/` filter parameter naming on `activity.ts` route | Add `actorId` (covering both humans and agents). Keep existing `agentId` for backwards compatibility — service treats them as equivalent for agent rows. |
| Q-§5 (spec) | Where do system-agent human names land — DB seed only, or `c.ts` config too | Both. The seed migration owns the source-of-truth values; `c.ts` mirrors them so static UI references and skill registrations agree at compile time. |

---

## 18. Deferred items

- **Microsoft 365 adapter.** Phase F (post-launch). Same contract as native + Google. Build slug `agent-as-employee-microsoft-adapter`.
- **Workspace documents / canonical document store.** No `workspace_documents` table in v1. On Google Workspace, agents have a Drive scope granted at account creation but Automation OS does not mirror metadata or render a documents UI. Native has no document store. Reason: no concrete operator workflow today requires a documents surface; brief Q4 ("agents own documents") is honoured in spirit by Drive ownership on Google. A canonical document table will be specified in a follow-up when there's a real requirement.
- **Vanity domain (brief Q1 Option B).** `{name}@ai.{customer-domain}` via customer DNS. Self-serve setup step. Reason: requires DNS verification flow + email-deliverability work outside this spec's surface area.
- **Per-agent custom signatures (brief Q3).** v2. Reason: subaccount-default + opt-in disclosure is sufficient at launch; per-agent adds UI surface.
- **Operator-overridable profile photos (brief Q2).** v2. Reason: launch auto-generation is sufficient; override is polish.
- **Cross-subaccount agents.** v2. Reason: different identity model.
- **Agent-to-agent messaging across subaccount tenants.** v2. Reason: same.
- **Agent-identity marketplace.** Adjacent product surface; not in scope.
- **Slack / Teams as workplace identity providers.** Future adapters.
- **Identity drift reconciliation job** (compares local `workspace_identities.status` to Google `users.suspended`). Fast-follow. Reason: catches drift but isn't load-bearing for v1 correctness — spec'd transitions are atomic locally.
- **Hard-delete revoke option** (`users.delete` on Google with grace period). Fast-follow.
- **`workspace_migration_attempts` table** (if metadata-field approach proves insufficient for observability).
- **Aggregate "Agent inbox" landing page across all agents in an org.** Possible v2 if a customer asks. Default is the per-agent mailbox.
- **Calendar push/watch via Google Pub/Sub** (vs polling). v2 optimisation. Polling at launch.
- **Subaccount Activity page export to CSV / scheduled report.** Mockup shows the button; v2 if customers ask.
- **Retention / archival policy** for `workspace_messages`, `workspace_calendar_events`, archived `workspace_identities`, and JSONB `metadata` blobs. v1 keeps everything indefinitely (pre-production, no data-volume pressure). When live data exists, define: (a) retention window per table — likely 18 months for messages, indefinitely for identities (they are audit anchors), (b) archive vs hard-delete policy, (c) operator-visible deletion controls per `agents:manage_lifecycle`. Deferred until volume justifies the design work; flagged here so DB-growth surprises do not catch ops off-guard.
- **Per-event-type granular permissions** (e.g. "view email events but not run events"). Today everything reuses `EXECUTIONS_VIEW`. Defer.

---

## 19. Out of scope

Re-stated for clarity; full discussion in §2.

- Building a Gmail / Calendar / Drive client UI.
- Replicating Workspace canvas-mode co-creation in Slides / Docs.
- Re-implementing provider ACLs.
- Reporting lines that gate permissions or routing.
- Pricing details (per-seat amount, agency-bundled rates).
- Microsoft 365 adapter at launch.

---

## 20. Testing posture

Aligned with `docs/spec-context.md` 2026-04-16:

- **Static gates.** `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-workspace-actor-coverage.ts`, typecheck, lint.
- **Pure-function tsx tests.** `workspaceEmailPipelinePure` (signature stamping, threading, policy checks), `seatDerivation` (4 status values × `deriveSeatConsumption`), `workspaceIdentityServicePure` (state machine valid/forbidden transitions).
- **Adapter contract test suite.** One scenario file under `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` exercises both adapters against the same scripted scenarios. Google adapter runs in test mode against an in-memory mock matching the Admin SDK / Gmail / Calendar / Drive shapes — not live Google calls. The mock's behaviour is the contract.
- **No new vitest / supertest / playwright suites.** Per `convention_rejections` in `spec-context.md`.
- **No frontend unit tests.** Per `frontend_tests: none_for_now`.
- **No e2e tests of the SaaS app.** Per `e2e_tests_of_own_app: none_for_now`.
- **No migration-safety tests.** Per `migration_safety_tests: defer_until_live_data_exists`.
- **Manual UAT.** Each UI surface in `prototypes/agent-as-employee/` is exercised manually against a dev database before merge. The acceptance criteria in §16 are the manual checklist. Mockups are the visual contract; the implementation should match them on layout, copy, primary actions, and information density.

---

## 21. Cross-references

- Source brief: `tasks/builds/agent-as-employee/brief.md`
- **UI mockups (canonical):** [`prototypes/agent-as-employee/index.html`](../../../prototypes/agent-as-employee/index.html) — 16 HTML screens, source of truth for visual design
- Architecture: `architecture.md` (key files per domain, RLS three-layer model, permission system)
- Spec context: `docs/spec-context.md` (framing assumptions)
- Spec authoring checklist: `docs/spec-authoring-checklist.md` (this spec was authored against it)
- CRM canonical pattern (the parallel): `server/db/schema/canonicalEntities.ts`, `server/adapters/`
- Three-principal model: `server/services/principal/types.ts`
- Existing org chart renderer: `client/src/pages/OrgChartPage.tsx`
- Existing onboarding entry-point page: `client/src/pages/SubaccountAgentsPage.tsx`
- Existing Activity page (extended in this spec): `client/src/pages/ActivityPage.tsx`, `server/routes/activity.ts`, `server/services/activityService.ts`
- Existing audit table: `server/db/schema/auditEvents.ts`

---


