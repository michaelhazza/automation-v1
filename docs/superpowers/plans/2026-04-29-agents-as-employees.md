# Agents Are Employees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** [`docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`](../specs/2026-04-29-agents-as-employees-spec.md). The spec is authoritative — when this plan and the spec disagree, the spec wins. Tasks reference spec sections (`§N.M`) for canonical SQL / TypeScript / contract definitions instead of duplicating them.

**Goal:** Ship an "agents are employees" identity layer — every agent gets a real workplace identity (email, calendar, mailbox, lifecycle, seat) on either a Synthetos-native backend or Google Workspace, with org-chart hierarchy, audit-attributable actions, and a clean migration path between backends.

**Architecture:** Canonical-first, mirroring the existing CRM canonical pattern. Provider-agnostic tables (`workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events`) sit in the centre. Two adapters (`nativeWorkspaceAdapter`, `googleWorkspaceAdapter`) sit at the edges and conform to a single TypeScript `WorkspaceAdapter` contract. A single `workspaceEmailPipeline` services all outbound and inbound mail across both backends. Lifecycle is a closed state machine on `workspace_identities`. Seat consumption is a pure function of identity status. Org chart uses `parent_actor_id` so reporting lines span humans + agents.

**Tech Stack:** Node/Express + TypeScript + Drizzle ORM + Postgres (RLS), React 18 + React Router v6 + TypeScript + Tailwind, pg-boss for queues, transactional email provider (Postmark / SendGrid / Mailgun) for native SMTP, Google Admin SDK + Gmail + Calendar APIs via service-account + domain-wide delegation.

**Testing posture (per `docs/spec-context.md` 2026-04-16 + spec §20):** static gates are **CI-only** per CLAUDE.md, never run locally. Targeted `tsx` pure-function tests for `workspaceEmailPipelinePure`, `seatDerivation`, `workspaceIdentityServicePure`. One adapter contract test suite at `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` exercising both adapters against scripted scenarios (Google in mock mode). No new vitest / supertest / playwright suites. No frontend unit tests. Manual UAT against `prototypes/agent-as-employee/` is the visual contract.

**Migration numbering:** spec references `0240` / `0241` / `0242`. Current latest committed migration is `0253` (`rate_limit_buckets`, merged via PR #234). Renumber to the next-available trio — at execution time use the smallest unused integers >= `0254` (i.e. `0254` / `0255` / `0256` if no further migrations have landed) per `DEVELOPMENT_GUIDELINES.md` §6.2. Verify the latest number by running `ls migrations | grep -E "^[0-9]{4}_" | sort | tail -3` immediately before creating the migration files. Plan uses spec numbers `0240` / `0241` / `0242` as placeholders only — they MUST be substituted before any commit.

**Phase strategy:** Five phases (A–E), each a separate PR off shared feature branch `feat/agents-are-employees`. Phase B is the demoable milestone. Each phase ends with `lint` + `typecheck` + `build:client` (where applicable) + manual UAT against the relevant mockups + a phase-named commit.

**Rollout ordering (deploy-time invariant).** Phase A ships **schema-only**: new tables + new columns + the `connector_configs` index swap + permission keys + system-agent rename. No service or route in Phase A consumes any of the new structure. This is a deliberate compatibility-preserving baseline — the deployed application keeps running unchanged after Phase A merges, because all readers still target the CRM-style partial unique index and the new workspace columns are nullable. Phase B is the first phase where code reads the new structure (pipeline, onboarding service, workspace routes). Phase E's migration runbook depends on Phase D (org-chart + activity wiring) being live so partial-completion banners surface to operators correctly. Order at deploy time: **migration → application code that uses it → removal of any legacy assumption** (the latter only when a follow-up spec calls for it; this plan does not remove anything from `audit_events.actor_id` / `actor_type`). Phases A→E already encode this order — do not interleave commits across phases on the feature branch.

**First-run containment (Phase A → Phase B gate).** Treat the first production deploy as a controlled rollout, not a normal merge. After Phase A reaches production, pause before Phase B starts shipping consumers and run three smoke checks: (1) configure a workspace on a single dev/staging subaccount and confirm `connector_configs` resolves to the right row via the new partial unique index, (2) exercise one onboarding round-trip to confirm the schema + RLS combination behaves under real session-var propagation (not just dev seed), (3) tail logs for one minute and confirm the invariant #10 INFO line emits with all 10 canonical fields populated. Only after all three pass does Phase B's PR get queued for merge. This is the cheapest place to catch a misconfigured policy or a silent permission mismatch — once Phase B's pipeline is live, the blast radius is every outbound email.

**Cross-cutting hardening invariants** — every task that writes to `workspace_*` tables, calls an adapter, or emits an audit event MUST honour these:

1. **Pre-send orphan-detection anchor.** The `audit_events` row written at spec §8.1 step (5) — *before* `adapter.sendEmail` — is the durable orphan-detection anchor. It MUST be committed in its own transaction before the adapter call so that a Step 7 mirror-write failure cannot roll it back. If step (6) succeeds but step (7) (canonical mirror) fails, the committed audit row alone identifies the orphan for an `outboundMirrorReaper` (deferred) to reconcile. Adapters MUST pass a deterministic provider idempotency key when the provider supports it: Postmark accepts `MessageID`, Gmail accepts an `RFC 5322 Message-ID:` header, SendGrid accepts `X-Message-Id`. Pass `audit_events.id` as the value so duplicate provider deliveries are detectable and the same audit-anchored send isn't double-billed. **Timeout handling:** a provider timeout is retryable — the provider idempotency key ensures the provider deduplicates re-delivery even if the timeout concealed a successful first attempt. Never treat a timeout as permanent failure. **Late-success race:** if a timed-out adapter call later resolves successfully (provider eventually delivers), the persisted idempotency record (provider `MessageID` = `audit_events.id`) causes the provider to suppress re-delivery on the retry. The canonical record is written by the retry's TX2. No duplicate send, no missing record.
2. **DB time for ordering / pagination.** Columns that drive ordering or cursor pagination — `workspace_messages.created_at`, `workspace_calendar_events.created_at`, `audit_events.created_at` — MUST be set by Postgres `DEFAULT now()` or `sql\`now()\``. Adapter code MUST NOT pass `new Date()` for these fields. App-time across multiple processes drifts; DB time is monotonic within a connection. `sent_at` on outbound messages is allowed to use app time (it represents "when the adapter call returned"), but `created_at` is canonical. The same rule extends to rate-limit window calculations: window boundary timestamps MUST be anchored to DB server time (`now()` inside the rate-limit query), not `new Date()` in application code. A multi-instance deployment that uses app time for rate-limit windows will produce drifted windows and inconsistent enforcement across processes.
3. **Metadata namespacing convention.** Every key written to a `metadata` JSONB column MUST be one of:
   - **Pipeline-owned** — unprefixed snake_case keys defined by this spec (`dedupe_key`, `migrationRequestId`, `signature`, `provider_id`, `lastPolledAt`, `batchId`).
   - **Provider-owned** — prefixed with the provider name (`gmail_thread_id`, `postmark_message_id`, `sendgrid_message_id`, `google_user_id`).
   - **Skill-owned** — prefixed with `skill_` and the skill slug (`skill_marketing-analyst_v1`).

   Mixing untyped keys across owners produces parse chaos as adapters multiply. Reviewers reject metadata writes that don't match one of these prefixes. Additionally, the total serialised size of any single `metadata` value MUST NOT exceed 8 KB. Values approaching the limit are a signal to move the data to a dedicated column or a linked table; oversized JSONB bloats index pages and causes silent provider rejection for metadata forwarded in webhook payloads.
4. **State-dependent writes are predicate-guarded.** Any write whose correctness depends on a row's current state — lifecycle transitions, parent-actor reassignment, identity activation — MUST use a `WHERE`-predicate guard (`WHERE status = <expected>`, `WHERE archived_at IS NULL`, etc.) and treat 0 rows-affected as "first commit wins; return observed state with `noOpDueToRace=true`." Per spec §14.1. Do NOT introduce `SELECT FOR UPDATE` for these — it serializes legitimate concurrent operators (suspend + email-toggle in different sessions) for no functional gain. `SELECT FOR UPDATE` is acceptable only for genuine row-level critical sections that have no predicate alternative.
5. **Rate-limit scopes are per-identity AND per-organisation.** Per spec §8.1 (amended). The pipeline's `rateLimitCheck` dependency takes `{ identityId, organisationId }` and returns the scope of any failure so callers can surface the right message. **Reuse the existing primitive — do NOT invent a new rate limiter.** [server/lib/inboundRateLimiter.ts](server/lib/inboundRateLimiter.ts) (added by PR #234, sliding-window, DB-canonical clock per invariant #2) is the platform's rate-limit primitive; key builders live in [server/lib/rateLimitKeys.ts](server/lib/rateLimitKeys.ts). The pipeline's `rateLimitCheck` calls `inboundRateLimiter.check(key, limit, windowSec)` twice in sequence (per-identity then per-org) and returns the first failure. New keys to add to `rateLimitKeys`: `workspaceEmailIdentity(identityId)` and `workspaceEmailOrg(organisationId)`. Use the returned `nowEpochMs` for any `Retry-After` computation (never `Date.now()` — invariant #2). The `inboundRateLimiter.check` UPSERTs unconditionally — the per-identity check increments the bucket even if the per-org check would have rejected. This is acceptable for spec §8.1 (saturation is rare and the cleanup job evicts stale buckets) and avoids a CTE-join across two keys.
6. **No throws past an external side-effect — responsibility split by operation type.**
   - **`sendEmail`:** The adapter makes the provider call and returns `{ externalMessageId }`. The pipeline owns the canonical `workspace_messages` write (Step 7). Step 7 runs in a second transaction (after the audit row is committed in its own transaction — see invariant #1). If Step 7 fails, the pipeline MUST catch the error, emit a structured log entry containing `{ externalMessageId, auditEventId }`, and return a failure result rather than rethrowing. The committed audit row is the orphan anchor; the structured log is the reconciliation signal for `outboundMirrorReaper`.
   - **`provisionIdentity`, `createEvent`, `respondToEvent`:** These adapters DO write canonical rows (identity rows, calendar event rows) as part of their implementation. The original rule applies: wrap provider call + DB insert in a try/catch; on insert failure after a successful provider call, log and return a partial result rather than throwing. Throwing past a successful provider side-effect produces "created externally but unknown locally" state — the worst possible failure mode.
   - **Never rethrow after a successful provider response.** Rethrow is only correct when the provider call itself failed (no external side-effect occurred).
7. **`audit_events` rows are append-only and immutable after insert.** No `UPDATE` or `DELETE` on `audit_events` rows except via an explicit archival process scoped to the organisation's data-retention policy. This preserves forensic integrity (the orphan-detection anchor in invariant #1 must always be readable) and guarantees replay correctness (any audit-log consumer can safely re-read from the beginning without encountering mutated history). Any code that attempts to update or delete an audit row is a reviewer-blocking violation.
8. **Structured log fields are consistent across all failure emissions.** Every `log.error` / `log.warn` call in this subsystem MUST include `{ organisationId, operation, actorId? }` plus any operation-specific anchor fields (`auditEventId`, `externalMessageId`, `batchId`). Structured fields must be flat (no nested objects) so log aggregation tools can index and filter them without JSON parsing. Omitting `organisationId` from a failure log makes cross-tenant incident investigation impossible.
9. **All workspace operations are retry-safe (N-times idempotency).** Any write operation in this subsystem — onboarding, provisioning, pipeline send, migration step, lifecycle transition — can be retried any number of times without producing additional external side-effects. The combination of idempotency keys (`provisioningRequestId`, `migrationRequestId`, audit-event anchor), predicate-guarded writes (invariant #4), and provider idempotency keys (invariant #1) guarantees this. Reviewers reject any new operation that breaks this property. The invariant is machine-testable: the adapter contract test suite asserts that calling any adapter method twice with the same inputs produces one external side-effect and one canonical row.
10. **Happy-path observability — structured INFO log on first action of every workspace operation.** Invariant #8 covers failure emissions; this one covers successes so on-call engineers have signal when something behaves unexpectedly without erroring. Every entry point — `workspaceEmailPipeline.send`, `workspaceEmailPipeline.ingest`, `workspaceOnboardingService.onboard`, `workspaceMigrationService.processIdentityMigration`, `workspaceIdentityService.transition`, and any route handler that resolves a connector — emits exactly one INFO log at the **start of the operation** with the canonical fields:

    ```typescript
    log.info('workspace.<operation>', {
      organisationId,
      subaccountId,         // resolved from identity / actor / route param
      operation: '<send|ingest|onboard|migrate|transition|connector_resolve>',
      actorId,              // null for system-originated operations
      identityId,           // when applicable
      connectorType,        // 'synthetos_native' | 'google_workspace' | null
      connectorConfigId,    // resolved id, null if pre-resolution
      rateLimitKey,         // when rate-limit check ran; from rateLimitKeys.workspaceEmail*
      requestId,            // for cross-service correlation when present
    });
    ```

    Field omission is allowed only when the field is genuinely unknown at log time (e.g. `rateLimitKey` is null on `ingest`). Empty strings or `'unknown'` placeholders are not — log NULL. Fields are flat (no nested objects) per invariant #8. This is the single shape the log aggregator indexes; deviating shapes silently fall out of dashboards. Reviewers reject any new entry point that doesn't emit this line.

---

## Contents

- [File Map](#file-map)
- [Pre-flight](#pre-flight)
- [Phase A — Schema, manifest, permissions, system-agent rename](#phase-a)
- [Phase B — Native adapter + canonical pipeline + onboard flow](#phase-b)
- [Phase C — Google Workspace adapter](#phase-c)
- [Phase D — Org chart + Activity wiring + seats](#phase-d)
- [Phase E — Migration runbook](#phase-e)
- [Acceptance walkthrough](#acceptance-walkthrough)

---

## File Map

Single source of truth for files this plan touches. Mirrors spec §5 — when the spec adds or removes a file, update this section in the same edit.

### Schema (new)

| File | Purpose |
|---|---|
| `server/db/schema/workspaceActors.ts` | Canonical actor; persistent across migrations. Includes `parent_actor_id`. |
| `server/db/schema/workspaceIdentities.ts` | Provider-scoped identity rows; one per `(actor, backend)`. Includes `email_sending_enabled`. |
| `server/db/schema/workspaceMessages.ts` | Canonical email/message store. |
| `server/db/schema/workspaceCalendarEvents.ts` | Canonical calendar event store. |
| `migrations/0240_workspace_canonical_layer.sql` | Tables + indexes + RLS + manifest entries + enum extensions. |
| `migrations/0241_workspace_actor_fks_and_hierarchy.sql` | FK columns on `agents`, `users`, `agent_runs`, `audit_events` + actor-hierarchy backfill. |
| `migrations/0242_system_agents_human_names.sql` | Rename subaccount-facing system agents + assign explicit roles. |

### Schema (modified)

| File | Change |
|---|---|
| `server/db/schema/agents.ts` | Add `workspaceActorId`. |
| `server/db/schema/users.ts` | Add `workspaceActorId`. |
| `server/db/schema/agentRuns.ts` | Add `actorId`. |
| `server/db/schema/auditEvents.ts` | Add `workspaceActorId`; existing `actorId` + `actorType` retained. |
| `server/db/schema/connectorConfigs.ts` | Extend `connectorType` enum: `'synthetos_native' \| 'google_workspace'`. |
| `server/config/rlsProtectedTables.ts` | 4 new manifest entries. |

### Adapters (new)

| File | Purpose |
|---|---|
| `server/adapters/workspace/workspaceAdapterContract.ts` | TypeScript `WorkspaceAdapter` interface. |
| `server/adapters/workspace/nativeWorkspaceAdapter.ts` | Provider calls only (SMTP, iCal) — canonical writes owned by the pipeline. |
| `server/adapters/workspace/googleWorkspaceAdapter.ts` | Admin SDK + Gmail + Calendar APIs via service-account delegation. |
| `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` | One scenario file, both adapters. |

### Services (new)

| File | Purpose |
|---|---|
| `server/services/workspace/workspaceActorService.ts` | CRUD on `workspace_actors`. |
| `server/services/workspace/workspaceIdentityService.ts` | Lifecycle state machine. |
| `server/services/workspace/workspaceIdentityServicePure.ts` | Pure state-machine logic; tested via `tsx`. |
| `server/services/workspace/workspaceOnboardingService.ts` | Confirmation-gated, idempotent onboarding. |
| `server/services/workspace/workspaceMigrationService.ts` | Per-subaccount migration orchestration. |
| `server/services/workspace/workspaceEmailPipeline.ts` | Outbound + inbound pipeline. |
| `server/services/workspace/workspaceEmailPipelinePure.ts` | Pure logic for policy / signing / threading; tested via `tsx`. |

### Services (modified)

| File | Change |
|---|---|
| `server/services/activityService.ts` | Extend `ActivityType` union; merge `audit_events` rows for new types; honour `actorId` filter. |

### Routes (new)

| File | Endpoints |
|---|---|
| `server/routes/workspace.ts` | Configure / onboard / migrate / suspend / resume / revoke / archive / email-sending toggle. |
| `server/routes/workspaceMail.ts` | Per-agent mailbox read + compose. |
| `server/routes/workspaceCalendar.ts` | Per-agent calendar read + event create + respond. |

### Routes (modified)

| File | Change |
|---|---|
| `server/routes/subaccounts.ts` | New `GET /api/subaccounts/:saId/workspace`. |
| `server/routes/activity.ts` | Add `actorId` query-param filter. |
| `server/index.ts` | Mount three new route files. |
| `client/src/App.tsx` | Un-redirect `/admin/subaccounts/:subaccountId/activity`. |

### Frontend (new)

| File | Purpose |
|---|---|
| `client/src/pages/AgentMailboxPage.tsx` | Mockup 10. |
| `client/src/pages/AgentCalendarPage.tsx` | Mockup 11. |
| `client/src/components/workspace/OnboardAgentModal.tsx` | Mockups 4–6 (3-step modal). |
| `client/src/components/workspace/MigrateWorkspaceModal.tsx` | Mockup 16. |
| `client/src/components/workspace/SuspendIdentityDialog.tsx` | Mockup 12. |
| `client/src/components/workspace/RevokeIdentityDialog.tsx` | Mockup 13 (type-the-name gate). |
| `client/src/components/workspace/IdentityCard.tsx` | Identity-tab header card. |
| `client/src/components/workspace/LifecycleProgress.tsx` | Inline lifecycle bar. |
| `client/src/components/workspace/SeatsPanel.tsx` | Inline seats panel. |
| `client/src/components/workspace/EmailSendingToggle.tsx` | Per-agent send-mail toggle. |
| `client/src/components/workspace/WorkspaceTabContent.tsx` | Workspace tab body on `AdminSubaccountDetailPage`. |
| `client/src/components/activity/ActivityFeedTable.tsx` | Shared table primitive. |
| `client/src/components/agent/AgentActivityTab.tsx` | Activity tab inside `SubaccountAgentEditPage`. |

### Frontend (modified)

| File | Change |
|---|---|
| `client/src/pages/AdminSubaccountDetailPage.tsx` | Add `'workspace'` to `ActiveTab` + render `WorkspaceTabContent`. |
| `client/src/pages/SubaccountAgentsPage.tsx` | Per-row "Onboard to workplace" CTA. |
| `client/src/pages/SubaccountAgentEditPage.tsx` | Add `'identity'` + `'activity'` tabs. |
| `client/src/pages/OrgChartPage.tsx` | Read from `workspace_actors`; use `parent_actor_id`. |
| `client/src/pages/ActivityPage.tsx` | Actor-filter UI; new event types in dropdown; render via `<ActivityFeedTable>`. |
| `client/src/lib/api.ts` | Typed wrappers for new endpoints. |

### Shared

| File | Purpose |
|---|---|
| `shared/billing/seatDerivation.ts` | `deriveSeatConsumption(status)` + `countActiveIdentities`. |
| `shared/types/workspace.ts` | TS types + `deriveActorState`. |
| `shared/types/workspaceAdapterContract.ts` | TS interface mirror. |
| `shared/types/activityType.ts` | Extended `ActivityType` union. |

### Configuration / scripts / docs

| File | Change |
|---|---|
| `server/lib/env.ts` + `.env.example` | New env vars (Google service account, native email provider). |
| `scripts/seed-workspace-actors.ts` | Backfill actor rows for every existing agent + user. |
| `scripts/verify-workspace-actor-coverage.ts` | CI gate. |
| `server/config/c.ts` | System-agent registry: human names + roles. |
| `architecture.md` | Add "Workspace canonical layer" subsection + new route files. |
| `docs/capabilities.md` | Add capability + Google Workspace integration. |
| `docs/spec-context.md` | Add new services to `accepted_primitives`. |

---

## Pre-flight

### Task PF1: Confirm clean tree + create feature branch

**Files:** none (git operations).

- [ ] **Step 1: Verify working tree is clean**

```bash
git status --short
```

Expected: empty output. If unrelated unstaged changes exist, stash or commit them before starting.

- [ ] **Step 2: Rebase against main**

```bash
git fetch origin main
git rebase origin/main
```

- [ ] **Step 3: Create feature branch**

```bash
git checkout -b feat/agents-are-employees
```

- [ ] **Step 4: Confirm latest migration number**

```bash
ls migrations | grep -E "^[0-9]{4}_" | sort | tail -5
```

As of the merge of `main` (post-PR #235) the latest committed migration is `0253_rate_limit_buckets.sql`. The next available trio is therefore **`0254` / `0255` / `0256`** (verify nothing has landed since by re-running the command above). Substitute these numbers for the spec's `0240` / `0241` / `0242` everywhere in this plan when creating files. **Do not skip this verification — landing on an already-used number breaks the migration runner.**

**Drift assertion (mandatory before writing any SQL).** Plan-approval and first-commit may be hours or days apart; another branch may have merged a migration in the meantime. Before authoring `0254_workspace_canonical_layer.sql`, re-run the `ls migrations | …` command and assert the latest number is strictly less than your chosen `<N>`. If a higher number exists, renumber **all three** of your migrations and the down migrations in lockstep before writing a single line of SQL. Do not "shift one and patch later" — half-renamed migration sets are how you ship a duplicate-number commit.

### Task PF2: Build slug + progress file

**Files:**
- Create: `tasks/builds/agent-as-employee/progress.md`

- [ ] **Step 1: Confirm build slug directory**

```bash
ls tasks/builds/agent-as-employee/
```

The brief file should already exist (`brief.md`).

- [ ] **Step 2: Create progress.md**

```markdown
# Agent-as-employee — build progress

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Plan:** `docs/superpowers/plans/2026-04-29-agents-as-employees.md`
**Branch:** `feat/agents-are-employees`

## Status

- [ ] Phase A — schema + manifest + permissions + system-agent rename
- [ ] Phase B — native adapter + canonical pipeline + onboard flow
- [ ] Phase C — Google adapter
- [ ] Phase D — org chart + activity + seats
- [ ] Phase E — migration runbook

## Decisions / deviations from spec

(none yet)

## Open questions

(none yet)
```

This file is updated at session compact-points and at phase boundaries.

- [ ] **Step 3: Commit pre-flight scaffolding**

```bash
git add tasks/builds/agent-as-employee/progress.md
git commit -m "chore(agent-as-employee): pre-flight progress file"
```

---

## Phase A — Schema, manifest, permissions, system-agent rename

**Goal:** Land all schema, RLS manifest, permission keys, and system-agent renaming in one PR. No services or routes ship in this phase. Once Phase A is merged, the database has actor + identity + message + calendar tables, every existing agent and user has a `workspace_actor_id`, and subaccount-facing system agents have human-style names. Phase A unblocks all later phases.

**Spec sections:** §5 (file inventory), §6 (schema delta), §10.1–10.2 (permissions + RLS), §15 (Phase A entry).

**Phase A exit checklist (do all before opening Phase A PR):**
1. `npm run lint` clean.
2. `npm run typecheck` clean.
3. `npm run db:generate` produces no diff (migration files are the single source of truth — generated artefacts must match).
4. Backfill seed runs locally without errors.
5. `tsx scripts/verify-workspace-actor-coverage.ts` exits 0.
6. `tsx shared/billing/seatDerivation.test.ts` exits 0.
7. Manual: query `SELECT actor_kind, COUNT(*) FROM workspace_actors GROUP BY actor_kind;` returns rows for both `agent` and `human`.
8. Manual: open Subaccount Agents tab in dev — system agents show new human names (Sarah, Johnny, etc.).

---

### Task A1: Drizzle schema — `workspaceActors`

**Files:**
- Create: `server/db/schema/workspaceActors.ts`

**Spec reference:** §6.1.

- [ ] **Step 1: Inspect a comparable canonical table for style**

```bash
sed -n '1,40p' server/db/schema/canonicalContacts.ts 2>/dev/null || sed -n '1,40p' server/db/schema/auditEvents.ts
```

Match the existing import order, column-builder style, and `pgTable` export shape.

- [ ] **Step 2: Write `workspaceActors.ts`**

Implement the table per spec §6.1:

```typescript
import { pgTable, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const workspaceActors = pgTable(
  'workspace_actors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    actorKind: text('actor_kind').notNull(), // 'agent' | 'human' — guarded by CHECK in SQL
    displayName: text('display_name').notNull(),
    parentActorId: uuid('parent_actor_id'),
    agentRole: text('agent_role'),
    agentTitle: text('agent_title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('workspace_actors_org_idx').on(table.organisationId),
    subaccountIdx: index('workspace_actors_subaccount_idx').on(table.subaccountId),
    kindIdx: index('workspace_actors_kind_idx').on(table.actorKind),
    parentIdx: index('workspace_actors_parent_idx').on(table.parentActorId),
    actorKindCheck: check('workspace_actors_kind_chk', sql`${table.actorKind} IN ('agent', 'human')`),
  })
);

export type WorkspaceActor = typeof workspaceActors.$inferSelect;
export type NewWorkspaceActor = typeof workspaceActors.$inferInsert;
```

The self-referential FK on `parent_actor_id` is added in the SQL migration (Drizzle does not express it cleanly without a circular import), and the same-subaccount trigger (spec §6.1) lives only in SQL.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema/workspaceActors.ts
git commit -m "feat(workspace): add workspaceActors Drizzle schema"
```

---

### Task A2: Drizzle schema — `workspaceIdentities`

**Files:**
- Create: `server/db/schema/workspaceIdentities.ts`

**Spec reference:** §6.2.

- [ ] **Step 1: Write `workspaceIdentities.ts`**

Per spec §6.2 — match column types, defaults, index list. The `status` column is typed as `text` in Drizzle but enforced by the Postgres `workspace_identity_status` enum (declared in the SQL migration). Mirror columns in TS:

```typescript
import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { workspaceActors } from './workspaceActors';
import { connectorConfigs } from './connectorConfigs';
import { users } from './users';

export const workspaceIdentities = pgTable(
  'workspace_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
    actorId: uuid('actor_id').notNull().references(() => workspaceActors.id),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    backend: text('backend').notNull(), // 'synthetos_native' | 'google_workspace'
    emailAddress: text('email_address').notNull(),
    emailSendingEnabled: boolean('email_sending_enabled').notNull().default(true),
    externalUserId: text('external_user_id'),
    displayName: text('display_name').notNull(),
    photoUrl: text('photo_url'),
    status: text('status').notNull().default('provisioned'), // workspace_identity_status enum
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: uuid('status_changed_by').references(() => users.id),
    provisioningRequestId: text('provisioning_request_id').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('workspace_identities_org_idx').on(table.organisationId),
    subaccountIdx: index('workspace_identities_subaccount_idx').on(table.subaccountId),
    actorIdx: index('workspace_identities_actor_idx').on(table.actorId),
    statusIdx: index('workspace_identities_status_idx').on(table.status),
  })
);

export type WorkspaceIdentity = typeof workspaceIdentities.$inferSelect;
export type NewWorkspaceIdentity = typeof workspaceIdentities.$inferInsert;
```

Partial unique indexes (`workspace_identities_actor_backend_active_uniq`, `workspace_identities_provisioning_request_uniq`, `workspace_identities_email_per_config_uniq`, `workspace_identities_migration_request_actor_uniq`) live in SQL — Drizzle's index DSL does not express partial indexes cleanly.

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add server/db/schema/workspaceIdentities.ts
git commit -m "feat(workspace): add workspaceIdentities Drizzle schema"
```

---

### Task A3: Drizzle schemas — `workspaceMessages` + `workspaceCalendarEvents`

**Files:**
- Create: `server/db/schema/workspaceMessages.ts`
- Create: `server/db/schema/workspaceCalendarEvents.ts`

**Spec references:** §6.3, §6.4.

- [ ] **Step 1: Write `workspaceMessages.ts`**

Mirror spec §6.3. Columns: `id`, `organisationId`, `subaccountId`, `identityId`, `actorId`, `threadId`, `externalMessageId`, `direction` (`'inbound'` / `'outbound'`), `fromAddress`, `toAddresses` (text[]), `ccAddresses` (text[]), `subject`, `bodyText`, `bodyHtml`, `sentAt`, `receivedAt`, `auditEventId`, `rateLimitDecision` (default `'allowed'`), `attachmentsCount` (default 0), `metadata` (jsonb), `createdAt`. Drizzle indexes on `org`, `subaccount`, `identity`, `actor`, `thread`. Partial unique indexes (`workspace_messages_external_uniq`, `workspace_messages_dedupe_uniq`) live in SQL.

- [ ] **Step 2: Write `workspaceCalendarEvents.ts`**

Mirror spec §6.4. Columns: `id`, `organisationId`, `subaccountId`, `identityId`, `actorId`, `externalEventId`, `organiserEmail`, `title`, `startsAt`, `endsAt`, `attendeeEmails` (text[]), `responseStatus`, `metadata`, `createdAt`, `updatedAt`. Drizzle indexes on `actor`, `startsAt`. Partial unique on `(identityId, externalEventId)` lives in SQL.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add server/db/schema/workspaceMessages.ts server/db/schema/workspaceCalendarEvents.ts
git commit -m "feat(workspace): add workspaceMessages + workspaceCalendarEvents Drizzle schemas"
```

---

### Task A4: Migration `0240_workspace_canonical_layer.sql`

**Files:**
- Create: `migrations/0240_workspace_canonical_layer.sql`
- Create: `migrations/_down/0240_workspace_canonical_layer.sql`

**Spec references:** §6.1–§6.5 (table SQL + triggers + RLS).

- [ ] **Step 1: Look at the most recent migration as a style reference**

```bash
sed -n '1,40p' migrations/0243_task_deliverables_deleted_at.sql
```

Match comment style, transaction wrapping (most migrations use implicit transaction; check repo convention).

- [ ] **Step 2: Write `migrations/0240_workspace_canonical_layer.sql`**

**Transactional boundary (MUST).** The entire migration runs in a **single Postgres transaction** — wrap the body in `BEGIN; … COMMIT;`. Postgres makes most DDL transactional, but the `connector_configs` index swap (drop + create two partials) and the four-table RLS policy creation MUST be atomic: a partial application that drops the old unique index without creating the new partials leaves the table in a state where two CRM connector_configs rows could be inserted. If any statement fails, the migration runner aborts the whole transaction; partial state is impossible.

**RLS-manifest pairing (CI-enforced — already required by `verify-rls-coverage.sh`).** Every `CREATE TABLE` in this migration MUST be paired with a corresponding entry in [server/config/rlsProtectedTables.ts](server/config/rlsProtectedTables.ts) **in the same commit** as Task A6. The CI gate fails the build if a manifest entry references a non-existent policy or a table is created without a manifest entry. Do not split A4 (table creation) and A6 (manifest) across different commits.

Single migration that contains, in order:

1. `CREATE TYPE workspace_identity_status AS ENUM ('provisioned', 'active', 'suspended', 'revoked', 'archived');`
2. Extend `connector_configs.connector_type` to include the new workspace types. **Verified at plan-review time:** [server/db/schema/connectorConfigs.ts:12](server/db/schema/connectorConfigs.ts#L12) declares `connectorType` as `text` with a TS-level union (`'ghl' | 'hubspot' | 'stripe' | 'slack' | 'teamwork' | 'custom'`) — there is **no Postgres enum or CHECK constraint** to alter. The migration only needs to update the Drizzle `$type<...>()` annotation to add `'synthetos_native' | 'google_workspace'` (modify `server/db/schema/connectorConfigs.ts` and commit alongside the SQL migration).
3. **`connector_configs` UNIQUE constraint divergence** (per `KNOWLEDGE.md` 2026-04-29 decision, "Workspace identity uses canonical pattern, one workspace per subaccount"). The existing `connector_configs_org_type_unique` index on `(organisation_id, connector_type)` enforces one CRM connector per organisation org-wide — the same shape the workspace layer must NOT inherit, because workspace must be `(organisation_id, subaccount_id, connector_type)`. Drop the existing index and replace with two:

   ```sql
   DROP INDEX IF EXISTS connector_configs_org_type_unique;

   -- CRM-style connectors (one per org, no subaccount scoping)
   CREATE UNIQUE INDEX connector_configs_org_type_uniq_crm
     ON connector_configs (organisation_id, connector_type)
     WHERE connector_type NOT IN ('synthetos_native', 'google_workspace');

   -- Workspace connectors (one per (org, subaccount, type) — multi-tenant within an org)
   CREATE UNIQUE INDEX connector_configs_org_subaccount_type_uniq_workspace
     ON connector_configs (organisation_id, subaccount_id, connector_type)
     WHERE connector_type IN ('synthetos_native', 'google_workspace');
   ```

   This split is mandatory — without it, the second subaccount in an org cannot configure a Google Workspace because the first one already holds `(org, 'google_workspace')`. Down migration restores the old shape (drop the two new partials, recreate the original combined unique). Update [server/db/schema/connectorConfigs.ts](server/db/schema/connectorConfigs.ts) to expose both indexes (or drop the existing `orgConnectorUnique` definition and re-declare the two partials in Drizzle index syntax).

   **Reader-audit invariant (MUST run before merging Phase A).** Existing call sites that read `connector_configs` may assume `(organisation_id, connector_type)` returns at most one row — that assumption holds for CRM types but breaks for workspace types post-migration. Audit:

   ```bash
   git grep -nE "connector_configs|connectorConfigs" -- 'server/**/*.ts' | grep -vE "schema/|test|spec"
   ```

   For each hit, confirm one of the following:
   - The query filters on a CRM type (`'ghl' | 'hubspot' | 'stripe' | 'slack' | 'teamwork' | 'custom'`) — safe, no change needed.
   - The query filters on `subaccount_id` already — safe.
   - The query is workspace-aware and needs `subaccount_id` added to the `WHERE` clause — fix in Phase A.

   Document the audit findings in `tasks/builds/agent-as-employee/progress.md` under "Reader audit". Reviewers reject the Phase A PR if this audit log is absent.
4. `CREATE TABLE workspace_actors (...)` per spec §6.1, including the self-referential `parent_actor_id` FK.
5. Indexes per §6.1.
6. `workspace_actors_parent_same_subaccount` trigger function + trigger per §6.1.
7. `CREATE TABLE workspace_identities (...)` per §6.2.
8. Partial unique indexes: `workspace_identities_actor_backend_active_uniq`, `workspace_identities_provisioning_request_uniq`, `workspace_identities_email_per_config_uniq`, `workspace_identities_migration_request_actor_uniq` per §6.2.
9. Trigger functions + triggers: `workspace_identities_actor_same_subaccount`, `workspace_identities_backend_matches_config` per §6.2.
10. `CREATE TABLE workspace_messages (...)` per §6.3 + indexes + partial unique on `external_message_id` + partial unique on `metadata->>'dedupe_key'`.
11. `CREATE TABLE workspace_calendar_events (...)` per §6.4 + indexes + partial unique on `external_event_id`.
12. RLS enable + force + `_org_isolation` policy on each of the four tables per §6.5. **Use the migration `0245_all_tenant_tables_rls.sql` template (post-2026-04-29 canonical) — `current_setting('app.organisation_id', true)::uuid` cast on the right of the equality, `IS NOT NULL AND <> ''` empty-string guard, `WITH CHECK` clause matching `USING`.** This supersedes the older `architecture.md §1155` template that uses `organisation_id::text`. Inspect [migrations/0245_all_tenant_tables_rls.sql:18-28](migrations/0245_all_tenant_tables_rls.sql#L18-L28) for the canonical block to copy.

- [ ] **Step 3: Write the down migration**

`migrations/_down/0240_workspace_canonical_layer.sql`: drop the four tables (cascade), drop trigger functions, drop the `workspace_identity_status` enum, restore the old `connector_configs_org_type_unique` index (drop both partials, re-create the original combined unique). The `connectorType` `$type<...>()` widening is a TS-only change (no enum to revert in Postgres).

- [ ] **Step 4: Apply locally and verify**

```bash
npm run db:migrate
psql $DATABASE_URL -c "\d workspace_actors"
psql $DATABASE_URL -c "\d workspace_identities"
psql $DATABASE_URL -c "SELECT typname FROM pg_type WHERE typname = 'workspace_identity_status';"
```

Each `\d` should show all expected columns; the enum should exist.

- [ ] **Step 4b: Runtime sanity on a non-empty dataset (MANDATORY pre-PR)**

Schema correctness on an empty DB tells you nothing. Run these against a dev DB with realistic seed data — the existing reseed flow (`scripts/_reseed_drop_create.ts` then `scripts/_reseed_restore_users.ts`) is sufficient. Each query has a hard pass/fail:

1. **Pre-flight: no duplicates would violate the new `connector_configs` partials.** Run BEFORE `db:migrate`:
   ```sql
   -- CRM partial: existing data already satisfies this (it's the old constraint, narrowed)
   SELECT organisation_id, connector_type, COUNT(*) FROM connector_configs
   WHERE connector_type NOT IN ('synthetos_native','google_workspace')
   GROUP BY 1,2 HAVING COUNT(*) > 1;
   -- Workspace partial: should return 0 rows (no workspace types exist yet)
   SELECT organisation_id, subaccount_id, connector_type, COUNT(*) FROM connector_configs
   WHERE connector_type IN ('synthetos_native','google_workspace')
   GROUP BY 1,2,3 HAVING COUNT(*) > 1;
   ```
   Both queries MUST return 0 rows. If the CRM query returns rows, the existing data already violates the old unique index (impossible if the index was healthy) — STOP and investigate. If the workspace query returns rows, someone ran the migration twice — drop the partial and try again.

2. **Index swap completes without blocking.** `\timing on; npm run db:migrate;` — the migration should finish in <1 second on dev seed data. If it hangs more than 5 seconds, something else holds an `ACCESS EXCLUSIVE` lock on `connector_configs` (likely a leftover psql session). Check `SELECT * FROM pg_locks WHERE relation = 'connector_configs'::regclass;` and abort the offending session before retrying. **Do not switch to `CREATE INDEX CONCURRENTLY`** — it cannot run inside a transaction, which would break the atomicity guarantee from Step 2's transactional boundary.

3. **RLS policies do not lock out existing rows.** After migration:
   ```sql
   -- Pick any seeded org id
   SET app.organisation_id = '<seed-org-uuid>';
   SET ROLE org_member;
   SELECT count(*) FROM workspace_actors;            -- expect 0 (no rows yet) or seed count
   SELECT count(*) FROM workspace_identities;        -- expect 0
   SELECT count(*) FROM workspace_messages;          -- expect 0
   SELECT count(*) FROM workspace_calendar_events;   -- expect 0
   RESET ROLE; RESET app.organisation_id;
   ```
   Each query must succeed (return a count, not raise `permission denied for table …`). If any query errors, the policy is malformed — diff it against the canonical block in [migrations/0245_all_tenant_tables_rls.sql:18-28](migrations/0245_all_tenant_tables_rls.sql#L18-L28) and redo Step 2 #12.

4. **Down migration is reversible.** Run `npm run db:migrate:down` then `npm run db:migrate` again — both should complete cleanly. Confirms the rollback path works before any upstream branch ever needs it.

Document the four results in `tasks/builds/agent-as-employee/progress.md` under "Runtime sanity log".

- [ ] **Step 5: Lint + typecheck**

```bash
npm run lint
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add migrations/0240_workspace_canonical_layer.sql migrations/_down/0240_workspace_canonical_layer.sql server/db/schema/connectorConfigs.ts
git commit -m "feat(workspace): migration 0240 — canonical workspace tables, RLS, triggers"
```

---

### Task A5: Extend FK columns on `agents` / `users` / `agent_runs` / `audit_events`

**Files:**
- Modify: `server/db/schema/agents.ts`
- Modify: `server/db/schema/users.ts`
- Modify: `server/db/schema/agentRuns.ts`
- Modify: `server/db/schema/auditEvents.ts`
- Create: `migrations/0241_workspace_actor_fks_and_hierarchy.sql`
- Create: `migrations/_down/0241_workspace_actor_fks_and_hierarchy.sql`

**Spec references:** §5 (schema modified), §6.6 (backfill).

- [ ] **Step 1: Add `workspaceActorId` column to `agents.ts`**

```typescript
// Inside the existing agents table builder, add:
workspaceActorId: uuid('workspace_actor_id').references(() => workspaceActors.id),
```

Add the import at the top: `import { workspaceActors } from './workspaceActors';`. Same pattern for `users.ts` (`workspaceActorId`). For `agentRuns.ts`: `actorId: uuid('actor_id').references(() => workspaceActors.id)`.

For `auditEvents.ts`: **Verified at plan-review time** — [server/db/schema/auditEvents.ts:14](server/db/schema/auditEvents.ts#L14) already declares `actorId: uuid('actor_id')` (uuid-typed, nullable, no FK) plus `actorType: text('actor_type')` as a `'user' | 'system' | 'agent'` discriminator. The existing column is the polymorphic principal-id field; we cannot repurpose it without coordinating every existing writer. Add a **new** column `workspace_actor_id uuid REFERENCES workspace_actors(id)` mapped in Drizzle as `workspaceActorId`. Keep the existing `actorId` + `actorType` fields untouched. New writes (workspace pipeline + onboarding + lifecycle transitions) populate `workspaceActorId`; legacy writers continue using `actorId` until a follow-up consolidation. The spec text in §5 schema-modified row for `auditEvents` mentions `actor_id` as the new column name — that wording is wrong post-merge; the plan's `workspace_actor_id` choice is authoritative.

- [ ] **Step 2: Write `migrations/0241_workspace_actor_fks_and_hierarchy.sql`**

In order:

1. `ALTER TABLE agents ADD COLUMN workspace_actor_id uuid REFERENCES workspace_actors(id);`
2. `ALTER TABLE users ADD COLUMN workspace_actor_id uuid REFERENCES workspace_actors(id);`
3. `ALTER TABLE agent_runs ADD COLUMN actor_id uuid REFERENCES workspace_actors(id);`
4. `ALTER TABLE audit_events ADD COLUMN workspace_actor_id uuid REFERENCES workspace_actors(id);` — see Task A5 step 1 above for the rationale: the existing `actor_id uuid` column is the polymorphic principal field and must be preserved. The new column is named `workspace_actor_id` to avoid the collision. Note the deviation from spec §5 wording in `tasks/builds/agent-as-employee/progress.md` (spec says `actor_id`; we use `workspace_actor_id`).
5. Backfill (per spec §6.6):
   - `UPDATE agents SET workspace_actor_id = wa.id FROM workspace_actors wa WHERE wa.actor_kind = 'agent' AND wa.display_name = agents.name AND wa.organisation_id = agents.organisation_id;` — done after Task A8 (seed) runs, but the SQL goes here as a no-op-if-empty backfill so re-applying the migration on a populated DB is correct.
   - `UPDATE users ...` similarly.
6. After seed runs (in Task A8), `agent_runs.actor_id` is backfilled by joining `agent_runs.agent_id → agents.workspace_actor_id`.

- [ ] **Step 3: Write the down migration**

Drop the four columns. Use `IF EXISTS` for safety.

- [ ] **Step 4: Apply locally + verify**

```bash
npm run db:migrate
psql $DATABASE_URL -c "\d agents" | grep workspace_actor_id
psql $DATABASE_URL -c "\d users" | grep workspace_actor_id
psql $DATABASE_URL -c "\d agent_runs" | grep actor_id
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/db/schema/agents.ts server/db/schema/users.ts server/db/schema/agentRuns.ts server/db/schema/auditEvents.ts migrations/0241_workspace_actor_fks_and_hierarchy.sql migrations/_down/0241_workspace_actor_fks_and_hierarchy.sql
git commit -m "feat(workspace): migration 0241 — workspace_actor_id FKs on agents/users/agent_runs/audit_events"
```

---

### Task A6: RLS manifest entries

**Files:**
- Modify: `server/config/rlsProtectedTables.ts`

**Spec reference:** §6.5, §10.2.

- [ ] **Step 1: Read the manifest and match the existing entry shape**

```bash
sed -n '1,80p' server/config/rlsProtectedTables.ts
```

- [ ] **Step 2: Add 4 entries**

Add `workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events` with their `_org_isolation` policy names. Match the format of existing entries (e.g. `canonical_contacts`).

- [ ] **Step 3: Lint + typecheck**

```bash
npm run lint
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add server/config/rlsProtectedTables.ts
git commit -m "feat(workspace): register 4 canonical tables in RLS manifest"
```

---

### Task A7: System-agent rename migration

**Files:**
- Create: `migrations/0242_system_agents_human_names.sql`
- Create: `migrations/_down/0242_system_agents_human_names.sql`
- Modify: `server/config/c.ts`

**Spec reference:** §2 (system-agent rename + role assignment), §15 (Phase A entry).

- [ ] **Step 1: Inspect current system-agent registry**

```bash
grep -n "Specialist\|Worker\|agent_role" server/config/c.ts | head -30
grep -n "system_agent" server/db/schema/agents.ts | head -10
```

Confirm where canonical names live (DB seed vs `c.ts`). Per spec Q-§5: **both**. The seed migration is source of truth; `c.ts` mirrors.

- [ ] **Step 2: Decide the human-name list**

Spec leaves the final list TBD. Use this default mapping unless product gives a different list — record any deviation in `tasks/builds/agent-as-employee/progress.md`:

| Old technical name | New human name | `agent_role` |
|---|---|---|
| `marketing-analyst` | Sarah | Specialist |
| `sales-coordinator` | Johnny | Worker |
| `client-success` | Helena | Specialist |
| `data-engineer` | Patel | Specialist |
| `support-agent` | Riley | Worker |
| `finance-clerk` | Dana | Worker |

(Adjust to match the actual current registry — if the registry has fewer / more / different system agents, name only what exists. Internal-only agents — `Orchestrator`, `Heads`, etc. — are NOT renamed.)

- [ ] **Step 3: Write `migrations/0242_system_agents_human_names.sql`**

For each entry above (whose old name exists in `agents` rows where `is_system = true`):

```sql
UPDATE agents
SET name = '<new-name>',
    agent_role = '<role>'
WHERE is_system = true
  AND name = '<old-name>';
```

(Inspect actual columns — `is_system` may be a different flag.)

- [ ] **Step 4: Update `server/config/c.ts`**

Find the agent registry block, update technical names → human names, set `agent_role` field for each. Internal-only entries (Orchestrator, Heads) untouched.

- [ ] **Step 5: Apply + verify**

```bash
npm run db:migrate
psql $DATABASE_URL -c "SELECT name, agent_role FROM agents WHERE is_system = true ORDER BY name;"
```

Expected: human names appear; `agent_role` populated.

- [ ] **Step 6: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add migrations/0242_system_agents_human_names.sql migrations/_down/0242_system_agents_human_names.sql server/config/c.ts
git commit -m "feat(workspace): rename subaccount-facing system agents to human names + roles"
```

---

### Task A8: New permission keys seed

**Files:**
- Modify: `migrations/0240_workspace_canonical_layer.sql` (append) OR create a new sub-migration in the same PR.

**Spec reference:** §10.1.

- [ ] **Step 1: Find where permission keys are seeded**

```bash
grep -rn "permission_set_items" server/db/schema/ migrations/ | head -10
```

- [ ] **Step 2: Append seed inserts to migration `0240`**

For each key in spec §10.1 table — `subaccounts:manage_workspace`, `agents:onboard`, `agents:manage_lifecycle`, `agents:toggle_email`, `agents:view_mailbox`, `agents:view_calendar`, `agents:view_activity` — insert into the relevant role's permission set (`manager` and `org_admin`) with the defaults from the spec table.

Use `INSERT ... ON CONFLICT DO NOTHING` so the migration is idempotent.

- [ ] **Step 3: Apply + verify**

```bash
npm run db:migrate
psql $DATABASE_URL -c "SELECT permission_key, role FROM permission_set_items WHERE permission_key LIKE 'agents:%' OR permission_key LIKE 'subaccounts:manage_workspace' ORDER BY permission_key;"
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0240_workspace_canonical_layer.sql
git commit --amend --no-edit
```

(Amend into the original 0240 commit since it's the same migration. If 0240 already pushed, create a separate `0240b_workspace_permissions.sql` instead and commit fresh.)

---

### Task A9: Backfill seed — `seed-workspace-actors.ts`

**Files:**
- Create: `scripts/seed-workspace-actors.ts`

**Spec reference:** §6.6.

- [ ] **Step 1: Inspect an existing seed script for style**

```bash
ls scripts/ | grep -i seed | head -5
sed -n '1,30p' scripts/seed-system-agents.ts 2>/dev/null || sed -n '1,30p' scripts/seed-org-defaults.ts 2>/dev/null
```

- [ ] **Step 2: Write the seed script**

Per spec §6.6, in this order, all inside one `withAdminConnection`:

1. Insert `workspace_actors` rows for every existing `agents` row joined to `subaccount_agents`. `actor_kind = 'agent'`, `display_name = agents.name`, `agent_role = subaccount_agents.agent_role`, `agent_title = subaccount_agents.agent_title`.
2. Insert `workspace_actors` rows for every `users` row joined to `subaccount_user_assignments`. `actor_kind = 'human'`, `display_name = users.email`.
3. Backfill `agents.workspace_actor_id` and `users.workspace_actor_id` by matching org + display_name.
4. Backfill `workspace_actors.parent_actor_id` from `subaccount_agents.parentSubaccountAgentId` (translate via `subaccount_agents → agents.workspace_actor_id`).
5. Backfill `agent_runs.actor_id` by joining `agent_runs.agent_id → agents.workspace_actor_id`.
6. **Selective backfill of `audit_events.workspace_actor_id`** (per the renamed column from Task A5). The new column is **nullable forever** — historical rows whose principal cannot be cleanly mapped to a workspace actor stay NULL. Backfill rules:
   - `actor_type = 'user'` AND `actor_id` resolves to a `users` row → set `workspace_actor_id = user.workspace_actor_id` (which itself was set in step 3 above).
   - `actor_type = 'agent'` AND `actor_id` resolves to an `agents` row → set `workspace_actor_id = agent.workspace_actor_id`.
   - `actor_type = 'system'` OR `actor_id IS NULL` OR no FK match → **leave NULL**. Do NOT invent a synthetic actor row for system events; the legacy `(actor_id, actor_type)` pair remains authoritative for historical rows.
   - New writes (Phase B+ pipeline + onboarding + lifecycle transitions) populate `workspace_actor_id` directly. Legacy writers continue using the existing `actor_id` + `actor_type` columns until a follow-up consolidation. The two columns coexist permanently; `verify-workspace-actor-coverage.ts` does NOT assert coverage on `audit_events`.

Idempotent: every INSERT uses `ON CONFLICT DO NOTHING`; every UPDATE has `WHERE workspace_actor_id IS NULL`.

- [ ] **Step 3: Run locally**

```bash
npx tsx scripts/seed-workspace-actors.ts
```

Expected: clean exit; logs counts ("Created N agent actors, M human actors, backfilled K agent_run rows, …").

- [ ] **Step 4: Verify**

```bash
psql $DATABASE_URL -c "SELECT actor_kind, COUNT(*) FROM workspace_actors GROUP BY actor_kind;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM agents WHERE workspace_actor_id IS NULL;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users WHERE workspace_actor_id IS NULL;"
```

Expected: actor counts > 0; remaining-NULL counts = 0 (or only for soft-deleted / orphan rows).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-workspace-actors.ts
git commit -m "feat(workspace): backfill seed for workspace_actors + FK columns"
```

---

### Task A10: CI gate — `verify-workspace-actor-coverage.ts`

**Files:**
- Create: `scripts/verify-workspace-actor-coverage.ts`

**Spec reference:** §5 (configuration / scripts), §15 (Phase A gate).

- [ ] **Step 1: Inspect a comparable verify script**

```bash
ls scripts/verify-* 2>/dev/null | head -5
sed -n '1,40p' scripts/verify-rls-coverage.sh 2>/dev/null
```

- [ ] **Step 2: Write the script**

```typescript
import { withAdminConnection } from '../server/instrumentation';
import { sql } from 'drizzle-orm';

async function main() {
  await withAdminConnection(async (db) => {
    const orphanAgents = await db.execute(sql`
      SELECT id, name FROM agents
      WHERE workspace_actor_id IS NULL
        AND deleted_at IS NULL
        AND id IN (SELECT agent_id FROM subaccount_agents)
    `);
    const orphanUsers = await db.execute(sql`
      SELECT id, email FROM users
      WHERE workspace_actor_id IS NULL
        AND id IN (SELECT user_id FROM subaccount_user_assignments)
    `);
    const orphans = [...orphanAgents.rows, ...orphanUsers.rows];
    if (orphans.length > 0) {
      console.error('verify-workspace-actor-coverage: FAIL —', orphans.length, 'rows missing workspace_actor_id');
      console.error(orphans.slice(0, 10));
      process.exit(1);
    }
    console.log('verify-workspace-actor-coverage: OK');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it**

```bash
npx tsx scripts/verify-workspace-actor-coverage.ts
```

Expected: `OK` line, exit 0.

- [ ] **Step 4: Add to CI**

Add this script to the existing CI workflow next to `verify-rls-coverage.sh`. Locate the workflow:

```bash
ls .github/workflows/ | grep -i gate
grep -rn "verify-rls-coverage" .github/workflows/ | head -3
```

Append a step running `npx tsx scripts/verify-workspace-actor-coverage.ts`.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-workspace-actor-coverage.ts .github/workflows/<file>
git commit -m "feat(workspace): CI gate verifying every agent + user has a workspace_actor_id"
```

---

### Task A11: Shared types — `workspace.ts` + actor-state pure function

**Files:**
- Create: `shared/types/workspace.ts`

**Spec references:** §5 (shared), §6.1 (`deriveActorState`), §6.2 (status enum).

- [ ] **Step 1: Write the file**

```typescript
export type WorkspaceIdentityStatus =
  | 'provisioned' | 'active' | 'suspended' | 'revoked' | 'archived';

export interface WorkspaceActor {
  id: string;
  organisationId: string;
  subaccountId: string;
  actorKind: 'agent' | 'human';
  displayName: string;
  parentActorId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceIdentity {
  id: string;
  organisationId: string;
  subaccountId: string;
  actorId: string;
  connectorConfigId: string;
  backend: 'synthetos_native' | 'google_workspace';
  emailAddress: string;
  emailSendingEnabled: boolean;
  externalUserId: string | null;
  displayName: string;
  photoUrl: string | null;
  status: WorkspaceIdentityStatus;
  statusChangedAt: string;
  statusChangedBy: string | null;
  provisioningRequestId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface WorkspaceMessage {
  id: string;
  organisationId: string;
  subaccountId: string;
  identityId: string;
  actorId: string;
  threadId: string;
  externalMessageId: string | null;
  direction: 'inbound' | 'outbound';
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string;
  receivedAt: string | null;
  auditEventId: string | null;
  rateLimitDecision: string;
  attachmentsCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceCalendarEvent {
  id: string;
  organisationId: string;
  subaccountId: string;
  identityId: string;
  actorId: string;
  externalEventId: string | null;
  organiserEmail: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeEmails: string[];
  responseStatus: 'needs_action' | 'accepted' | 'declined' | 'tentative';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function deriveActorState(
  identities: { status: WorkspaceIdentityStatus }[]
): 'active' | 'suspended' | 'inactive' {
  if (identities.some((i) => i.status === 'active')) return 'active';
  if (identities.some((i) => i.status === 'suspended')) return 'suspended';
  return 'inactive';
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add shared/types/workspace.ts
git commit -m "feat(workspace): shared types + deriveActorState"
```

---

### Task A12: Pure function — `seatDerivation.ts` + tsx test

**Files:**
- Create: `shared/billing/seatDerivation.ts`
- Create: `shared/billing/seatDerivation.test.ts`

**Spec reference:** §10.6.

- [ ] **Step 1: Write the failing test first**

```typescript
// shared/billing/seatDerivation.test.ts
import { strict as assert } from 'node:assert';
import { deriveSeatConsumption, countActiveIdentities } from './seatDerivation';

assert.equal(deriveSeatConsumption('provisioned'), false, 'provisioned must NOT consume a seat');
assert.equal(deriveSeatConsumption('active'), true, 'active consumes a seat');
assert.equal(deriveSeatConsumption('suspended'), false, 'suspended frees the seat');
assert.equal(deriveSeatConsumption('revoked'), false, 'revoked frees the seat');
assert.equal(deriveSeatConsumption('archived'), false, 'archived does not consume');

assert.equal(
  countActiveIdentities([
    { status: 'active' }, { status: 'suspended' }, { status: 'active' },
    { status: 'revoked' }, { status: 'provisioned' },
  ]),
  2,
  'countActiveIdentities counts only active'
);

console.log('seatDerivation.test: OK');
```

- [ ] **Step 2: Run the failing test**

```bash
npx tsx shared/billing/seatDerivation.test.ts
```

Expected: FAIL with "Cannot find module './seatDerivation'".

- [ ] **Step 3: Write `seatDerivation.ts` per spec §10.6**

```typescript
import type { WorkspaceIdentityStatus } from '../types/workspace';

export function deriveSeatConsumption(status: WorkspaceIdentityStatus): boolean {
  return status === 'active';
}

export function countActiveIdentities(
  identities: { status: WorkspaceIdentityStatus }[]
): number {
  return identities.filter((i) => deriveSeatConsumption(i.status)).length;
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
npx tsx shared/billing/seatDerivation.test.ts
```

Expected: `seatDerivation.test: OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add shared/billing/seatDerivation.ts shared/billing/seatDerivation.test.ts
git commit -m "feat(workspace): deriveSeatConsumption pure function + tsx test"
```

---

### Task A13: Phase A close-out

- [ ] **Step 1: Run all Phase A exit checks**

```bash
npm run lint
npx tsc --noEmit
npm run db:generate
npx tsx scripts/verify-workspace-actor-coverage.ts
npx tsx shared/billing/seatDerivation.test.ts
psql $DATABASE_URL -c "SELECT actor_kind, COUNT(*) FROM workspace_actors GROUP BY actor_kind;"
```

All clean / exit 0 / counts > 0.

- [ ] **Step 2: Manual UAT — system-agent names**

Open the dev SaaS app → log in as `org_admin` → navigate to a subaccount → Agents tab. Confirm system agents show human names (Sarah, Johnny, etc.) instead of technical names. Internal-only agents (Orchestrator, Heads) absent or unchanged.

- [ ] **Step 3: Update build progress file**

Edit `tasks/builds/agent-as-employee/progress.md`: mark Phase A complete; record any deviation from the spec's default human-name list, any column-name divergence on `audit_events`, and the actual migration numbers chosen.

- [ ] **Step 4: Open Phase A PR**

```bash
git push -u origin feat/agents-are-employees
gh pr create --title "Agent-as-employee: Phase A — schema, manifest, permissions, system-agent rename" --base main --body "$(cat <<'EOF'
## Summary

- Introduces canonical workspace tables (`workspace_actors`, `workspace_identities`, `workspace_messages`, `workspace_calendar_events`) with RLS, partial unique indexes, and integrity triggers.
- Adds FK columns (`workspace_actor_id` / `actor_id`) to `agents`, `users`, `agent_runs`, `audit_events` and backfills them.
- Renames subaccount-facing system agents to human names + roles (Sarah, Johnny, Helena, Patel, Riley, Dana).
- Adds 7 permission keys + 4 RLS-manifest entries.
- Pure function `deriveSeatConsumption(status)` covered by tsx tests.
- CI gate `verify-workspace-actor-coverage.ts` ensures every agent + user has a `workspace_actor_id`.

Reference: `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md` §1, §6, §10.1–10.2, §15 (Phase A).

## Test plan
- [x] `npm run lint` clean
- [x] `npm run typecheck` clean
- [x] `npm run db:generate` no-diff
- [x] `tsx scripts/verify-workspace-actor-coverage.ts` exits 0
- [x] `tsx shared/billing/seatDerivation.test.ts` exits 0
- [x] Manual: system-agent names in dev show human names

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Run pr-reviewer agent (per CLAUDE.md review pipeline)**

After CI passes, invoke the `pr-reviewer` agent against the Phase A diff. This is mandatory for Major-class work before merge. Address blocking findings before merging.

- [ ] **Step 6: First-run containment gate (between Phase A merge and Phase B PR)**

After Phase A is merged + deployed, run the three smoke checks from the front-matter "First-run containment" rule against the deployed environment: (1) configure a workspace on one staging subaccount and verify `connector_configs` resolution lands on the partial-unique index, (2) round-trip one onboarding (a stub identity is fine — the goal is to exercise RLS under live session-var propagation), (3) tail one minute of logs and confirm invariant #10's 10-field INFO shape emits cleanly. Record pass/fail in `tasks/builds/agent-as-employee/progress.md` under "First-run containment". **Phase B's PR does not open until all three pass.** If any check fails, file findings, fix the underlying issue (likely a policy diff or a missing log field), and re-run all three from clean.

---

## Phase B — Native adapter + canonical pipeline + onboard flow

**Goal:** Ship the complete native-backend experience end-to-end: configure native workspace → onboard an existing agent → see the agent in Identity tab → send/receive email through `workspaceEmailPipeline` → suspend / resume / revoke / archive identity → toggle email-sending. **Phase B is the demoable milestone** — every native flow works without any Google dependency.

**Spec sections:** §1 (framing), §3 (UX walkthrough — mockups 01, 03–07, 09, 10, 11, 12, 13), §7 (adapter contract), §8 (email/calendar pipeline), §9.1, §9.2, §9.4 (onboarding / suspend / revoke), §10.6 (seat panel), §13–§14 (execution model + safety contracts).

**Phase B exit checklist:**
1. `npm run lint` + `npm run typecheck` clean.
2. `npx tsx server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts` exits 0.
3. `npx tsx server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts` exits 0.
4. `npm run build:client` clean.
5. Manual UAT: walk through mockups 01 → 03 → 04 → 05 → 06 → 07 → 09 → 12 → 13 against the native backend in dev. Each surface matches the mockup on layout, copy, and primary action.
6. Manual UAT: send a test email from the agent identity through the pipeline; confirm `workspace_messages` row appears, `audit_events` row appears, recipient receives it.
7. Manual UAT: with `email_sending_enabled = false`, send fails with `workspace_email_sending_disabled` and writes neither audit nor message rows.
8. Manual UAT: suspending an agent immediately drops `SeatsPanel` count; resuming restores it.
9. **Targeted tsx tests — operational safety (run before Phase B PR):**
   - `tsx` test: duplicate send retry with same `idempotencyKey` → provider receives one delivery (assert via mock provider call count = 1 on second call).
   - `tsx` test: adapter timeout on `sendEmail` → retry with same `idempotencyKey` → provider deduplicates → only one `workspace_messages` row.
   - `tsx` test: adapter `sendEmail` succeeds + TX2 mirror write throws → function returns `{ sent: true, reconciling: true }` → zero rethrowing, one `log.error` call with `{ auditEventId, externalMessageId }`.
   - `tsx` test: `setParent` cycle detection — direct cycle (A→B, set B parent = A), deep cycle (A→B→C, set C parent = A), and depth-cap (chain of 21 nodes) each throw `parent_actor_cycle` or depth-cap error.

---

### Task B1: Adapter contract — `workspaceAdapterContract.ts`

**Files:**
- Create: `server/adapters/workspace/workspaceAdapterContract.ts`
- Create: `shared/types/workspaceAdapterContract.ts` (mirror)

**Spec reference:** §7.

- [ ] **Step 1: Write the shared interface file**

Per spec §7 — exhaustive copy:

```typescript
// shared/types/workspaceAdapterContract.ts
export interface ProvisionParams {
  actorId: string;
  subaccountId: string;
  organisationId: string;
  connectorConfigId: string;
  emailLocalPart: string;
  displayName: string;
  photoUrl?: string;
  signature: string;
  emailSendingEnabled: boolean;
  provisioningRequestId: string;
}

export interface ProvisionResult {
  identityId: string;
  emailAddress: string;
  externalUserId: string | null;
}

export interface SendEmailParams {
  fromIdentityId: string;
  toAddresses: string[];
  ccAddresses?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  threadId?: string;
  inReplyToExternalId?: string;
  policyContext: { skill?: string; runId?: string };
  // Set by workspaceEmailPipeline AFTER it inserts the audit row at §8.1 step (5).
  // Adapters pass this through to the provider's idempotency channel:
  //   Postmark → MessageID; Gmail → RFC 5322 Message-ID header; SendGrid → X-Message-Id.
  // Hardening invariant #1.
  idempotencyKey?: string;
}

export interface SendEmailResult {
  messageId: string;            // workspace_messages.id
  externalMessageId: string | null;
}

export interface InboundMessage {
  externalMessageId: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: Date;
  receivedAt: Date;
  inReplyToExternalId: string | null;
  referencesExternalIds: string[];
  attachmentsCount: number;
  rawProviderId: string;        // provider's stable id, used for dedupe_key
}

export interface CreateEventParams {
  fromIdentityId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
}

export interface CreateEventResult {
  eventId: string;              // workspace_calendar_events.id
  externalEventId: string | null;
}

export interface CalendarEvent {
  externalEventId: string | null;
  organiserEmail: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
  responseStatus: 'needs_action' | 'accepted' | 'declined' | 'tentative';
}

export interface WorkspaceAdapter {
  readonly backend: 'synthetos_native' | 'google_workspace';
  provisionIdentity(params: ProvisionParams): Promise<ProvisionResult>;
  suspendIdentity(identityId: string): Promise<void>;
  resumeIdentity(identityId: string): Promise<void>;
  revokeIdentity(identityId: string): Promise<void>;
  archiveIdentity(identityId: string): Promise<void>;
  sendEmail(params: SendEmailParams): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }>; // pipeline writes workspace_messages; adapter returns provider result only
  fetchInboundSince(identityId: string, since: Date): Promise<InboundMessage[]>;
  createEvent(params: CreateEventParams): Promise<CreateEventResult>;
  respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void>;
  fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]>;
}
```

- [ ] **Step 2: Add new `FailureReason` values**

Open `shared/iee/failure.ts`. Per spec §7, append to the `FailureReason` union:

```
| 'workspace_identity_provisioning_failed'
| 'workspace_email_rate_limited'
| 'workspace_email_sending_disabled'
| 'workspace_provider_acl_denied'
| 'workspace_idempotency_collision'
```

If the file has a separate retryability table / map, register each per spec §7's retryability table.

- [ ] **Step 3: Write `server/adapters/workspace/workspaceAdapterContract.ts`**

Re-export from `shared/types/workspaceAdapterContract.ts`:

```typescript
export * from '../../../shared/types/workspaceAdapterContract';
```

- [ ] **Step 4: Add CI lint guard for "pipeline-only outbound"**

Add a tiny static check (in `scripts/verify-pipeline-only-outbound.ts` or extend an existing static-check script) that greps for `adapter.sendEmail(` references outside `workspace/workspaceEmailPipeline.ts` and the contract file itself. Fail CI if any other importer exists.

```typescript
// scripts/verify-pipeline-only-outbound.ts
import { execSync } from 'node:child_process';

const allowed = ['server/services/workspace/workspaceEmailPipeline.ts'];
const out = execSync(
  `git grep -n "\\.sendEmail(" -- 'server/**/*.ts' 'client/**/*.ts'`,
  { encoding: 'utf8' }
).split('\n').filter(Boolean);

const violations = out.filter((line) => !allowed.some((f) => line.startsWith(f)));
if (violations.length > 0) {
  console.error('verify-pipeline-only-outbound: FAIL');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('verify-pipeline-only-outbound: OK');
```

Wire this into the same CI job that runs `verify-workspace-actor-coverage.ts`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add server/adapters/workspace/workspaceAdapterContract.ts shared/types/workspaceAdapterContract.ts shared/iee/failure.ts scripts/verify-pipeline-only-outbound.ts
git commit -m "feat(workspace): WorkspaceAdapter contract + new FailureReason values + pipeline-only-outbound CI guard"
```

---

### Task B2: `workspaceActorService`

**Files:**
- Create: `server/services/workspace/workspaceActorService.ts`

**Spec reference:** §5 (services new), §6.1 (parent-actor-id rules).

- [ ] **Step 1: Write the service**

```typescript
import { withOrgTx } from '../../instrumentation';
import { workspaceActors } from '../../db/schema/workspaceActors';
import { eq, and } from 'drizzle-orm';
import type { WorkspaceActor } from '../../../shared/types/workspace';

export async function getActorById(orgId: string, id: string): Promise<WorkspaceActor | null> {
  return withOrgTx(orgId, async (db) => {
    const [row] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, id));
    return row ?? null;
  });
}

export async function setParent(orgId: string, actorId: string, parentActorId: string | null) {
  return withOrgTx(orgId, async (db) => {
    if (parentActorId !== null) {
      const [parent] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, parentActorId));
      const [self] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, actorId));
      if (!parent || !self || parent.subaccountId !== self.subaccountId) {
        throw new Error('parent_actor_id must reference an actor in the same subaccount');
      }
      // Cycle prevention per spec §6.1: walk ancestors of the proposed parent;
      // reject if actorId appears in the chain. Depth cap of 20 — org-chart reporting
      // depth >20 is implausible, and a chain that long indicates corrupted data
      // and should fail loudly. Use the spec's `failure()` envelope so the route layer
      // surfaces the canonical `parent_actor_cycle_detected` error code.
      if (parentActorId === actorId) {
        throw failure('parent_actor_cycle_detected', { actorId, parentActorId, cycleVia: actorId });
      }
      const visited = new Set<string>();
      let cursor: string | null = parentActorId;
      let depth = 0;
      while (cursor !== null && depth < 20) {
        if (cursor === actorId) {
          throw failure('parent_actor_cycle_detected', { actorId, parentActorId, cycleVia: cursor });
        }
        if (visited.has(cursor)) {
          // Pre-existing cycle in the stored chain — defence in depth.
          throw failure('parent_actor_cycle_detected', { actorId, parentActorId, cycleVia: cursor });
        }
        visited.add(cursor);
        const [ancestor] = await db.select({ parentActorId: workspaceActors.parentActorId }).from(workspaceActors).where(eq(workspaceActors.id, cursor));
        cursor = ancestor?.parentActorId ?? null;
        depth++;
      }
      if (cursor !== null) {
        // Hit the depth cap without resolving — fail loudly rather than silently allowing.
        throw failure('parent_actor_cycle_detected', { actorId, parentActorId, cycleVia: 'depth-cap-exceeded' });
      }
    }
    await db.update(workspaceActors).set({ parentActorId, updatedAt: new Date() }).where(eq(workspaceActors.id, actorId));
  });
}

export async function listActorsForSubaccount(orgId: string, subaccountId: string): Promise<WorkspaceActor[]> {
  return withOrgTx(orgId, async (db) => {
    return db.select().from(workspaceActors).where(eq(workspaceActors.subaccountId, subaccountId));
  });
}

export async function updateDisplayName(orgId: string, id: string, displayName: string) {
  return withOrgTx(orgId, async (db) => {
    await db.update(workspaceActors).set({ displayName, updatedAt: new Date() }).where(eq(workspaceActors.id, id));
  });
}
```

The service-layer same-subaccount check is **defence-in-depth** — the DB trigger from §6.1 is authoritative.

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add server/services/workspace/workspaceActorService.ts
git commit -m "feat(workspace): workspaceActorService"
```

---

### Task B3: `workspaceIdentityServicePure` — pure state machine + tsx test

**Files:**
- Create: `server/services/workspace/workspaceIdentityServicePure.ts`
- Create: `server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts`

**Spec reference:** §14.6 (state machine).

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts
import { strict as assert } from 'node:assert';
import { canTransition, nextStatus } from '../workspaceIdentityServicePure';

// Valid transitions
assert.equal(canTransition('provisioned', 'active'), true);
assert.equal(canTransition('active', 'suspended'), true);
assert.equal(canTransition('suspended', 'active'), true);
assert.equal(canTransition('active', 'revoked'), true);
assert.equal(canTransition('suspended', 'revoked'), true);
assert.equal(canTransition('active', 'archived'), true);
assert.equal(canTransition('revoked', 'archived'), true);

// Forbidden transitions
assert.equal(canTransition('provisioned', 'suspended'), false, 'must go through active first');
assert.equal(canTransition('revoked', 'active'), false, 'revoked is terminal');
assert.equal(canTransition('archived', 'active'), false, 'archived is terminal');
assert.equal(canTransition('archived', 'revoked'), false);

// nextStatus enforces the rules
assert.equal(nextStatus('provisioned', 'activate'), 'active');
assert.throws(() => nextStatus('provisioned', 'suspend'));
assert.throws(() => nextStatus('revoked', 'resume'));

console.log('workspaceIdentityServicePure.test: OK');
```

- [ ] **Step 2: Run failing test**

```bash
npx tsx server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the pure module**

```typescript
// server/services/workspace/workspaceIdentityServicePure.ts
import type { WorkspaceIdentityStatus } from '../../../shared/types/workspace';

export type IdentityAction = 'activate' | 'suspend' | 'resume' | 'revoke' | 'archive';

const VALID_TRANSITIONS: Record<WorkspaceIdentityStatus, WorkspaceIdentityStatus[]> = {
  provisioned: ['active'],
  active: ['suspended', 'revoked', 'archived'],
  suspended: ['active', 'revoked', 'archived'],
  revoked: ['archived'],
  archived: [],
};

const ACTION_TARGETS: Record<IdentityAction, WorkspaceIdentityStatus> = {
  activate: 'active',
  suspend: 'suspended',
  resume: 'active',
  revoke: 'revoked',
  archive: 'archived',
};

export function canTransition(from: WorkspaceIdentityStatus, to: WorkspaceIdentityStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function nextStatus(from: WorkspaceIdentityStatus, action: IdentityAction): WorkspaceIdentityStatus {
  const target = ACTION_TARGETS[action];
  if (!canTransition(from, target)) {
    throw new Error(`Forbidden transition ${from} -> ${target} via ${action}`);
  }
  return target;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx tsx server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/services/workspace/workspaceIdentityServicePure.ts server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts
git commit -m "feat(workspace): identity state machine pure module + tsx test"
```

---

### Task B4: `workspaceIdentityService` (DB-bound)

**Files:**
- Create: `server/services/workspace/workspaceIdentityService.ts`

**Spec references:** §9.2 (suspension flow + race-safety predicate), §14.1 (idempotency posture: state-based UPDATE), §14.5 (constraint→HTTP mapping).

- [ ] **Step 1: Write the service**

```typescript
import { withOrgTx } from '../../instrumentation';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities';
import { eq, and } from 'drizzle-orm';
import { canTransition, nextStatus, type IdentityAction } from './workspaceIdentityServicePure';
import type { WorkspaceIdentity, WorkspaceIdentityStatus } from '../../../shared/types/workspace';

export interface TransitionResult {
  status: WorkspaceIdentityStatus;
  noOpDueToRace: boolean;
}

export async function transition(
  orgId: string,
  identityId: string,
  action: IdentityAction,
  changedByUserId: string,
): Promise<TransitionResult> {
  return withOrgTx(orgId, async (db) => {
    const [current] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
    if (!current) throw new Error(`Identity ${identityId} not found`);
    const target = nextStatus(current.status as WorkspaceIdentityStatus, action);
    // State-based predicate: only update if still in current.status
    const result = await db.update(workspaceIdentities)
      .set({
        status: target,
        statusChangedAt: new Date(),
        statusChangedBy: changedByUserId,
        updatedAt: new Date(),
        archivedAt: target === 'archived' ? new Date() : current.archivedAt,
      })
      .where(and(eq(workspaceIdentities.id, identityId), eq(workspaceIdentities.status, current.status)));
    if (result.rowCount === 0) {
      // Race: someone else transitioned us first. Re-read.
      const [refreshed] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
      return { status: refreshed.status as WorkspaceIdentityStatus, noOpDueToRace: true };
    }
    return { status: target, noOpDueToRace: false };
  });
}

export async function setEmailSending(
  orgId: string,
  identityId: string,
  enabled: boolean,
  changedByUserId: string,
) {
  return withOrgTx(orgId, async (db) => {
    await db.update(workspaceIdentities)
      .set({ emailSendingEnabled: enabled, statusChangedBy: changedByUserId, updatedAt: new Date() })
      .where(eq(workspaceIdentities.id, identityId));
  });
}

export async function getIdentitiesForActor(orgId: string, actorId: string): Promise<WorkspaceIdentity[]> {
  return withOrgTx(orgId, async (db) => {
    return db.select().from(workspaceIdentities).where(eq(workspaceIdentities.actorId, actorId));
  });
}

export async function getActiveIdentitiesForSubaccount(orgId: string, subaccountId: string): Promise<WorkspaceIdentity[]> {
  return withOrgTx(orgId, async (db) => {
    return db.select().from(workspaceIdentities).where(eq(workspaceIdentities.subaccountId, subaccountId));
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add server/services/workspace/workspaceIdentityService.ts
git commit -m "feat(workspace): workspaceIdentityService with state-based race-safe transitions"
```

---

### Task B5: `workspaceEmailPipelinePure` + tsx test

**Files:**
- Create: `server/services/workspace/workspaceEmailPipelinePure.ts`
- Create: `server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts`

**Spec references:** §8.1 (outbound steps 4 — signing), §8.2 step 2 (dedupe key), step 3 (thread resolution rule).

- [ ] **Step 1: Write the failing tests**

```typescript
// server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts
import { strict as assert } from 'node:assert';
import {
  computeDedupeKey,
  applySignature,
  resolveThreadId,
  type ThreadLookup,
} from '../workspaceEmailPipelinePure';

// computeDedupeKey deterministic
const k1 = computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:00Z', providerMessageId: 'pmid-1' });
const k2 = computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:00Z', providerMessageId: 'pmid-1' });
assert.equal(k1, k2, 'dedupe key is deterministic');
assert.notEqual(k1, computeDedupeKey({ fromAddress: 'a@b.com', subject: 'Hi', sentAtIso: '2026-04-29T10:00:01Z', providerMessageId: 'pmid-1' }));

// Signature stamping
const stamped = applySignature('Hello', { template: '{agent-name}\n{role} · {subaccount-name}', agentName: 'Sarah', role: 'Specialist', subaccountName: 'Acme', discloseAsAgent: false });
assert.ok(stamped.endsWith('Sarah\nSpecialist · Acme'));

const disclosed = applySignature('Hi', { template: '{agent-name}', agentName: 'Sarah', role: 'Specialist', subaccountName: 'Acme', discloseAsAgent: true, agencyName: 'Maya Ops' });
assert.ok(disclosed.includes('AI agent'));

// Thread resolution
const lookup: ThreadLookup = async (externalIds) => {
  if (externalIds.includes('msg-existing')) return 'thread-X';
  return null;
};
assert.equal(await resolveThreadId({ inReplyToExternalId: 'msg-existing', referencesExternalIds: [] }, lookup), 'thread-X', 'reuses existing thread');
const fresh = await resolveThreadId({ inReplyToExternalId: 'unknown-msg', referencesExternalIds: [] }, lookup);
assert.match(fresh, /^[0-9a-f-]{36}$/i, 'new thread is a uuid');

console.log('workspaceEmailPipelinePure.test: OK');
```

- [ ] **Step 2: Run failing test**

```bash
npx tsx server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the module**

```typescript
// server/services/workspace/workspaceEmailPipelinePure.ts
import { createHash, randomUUID } from 'node:crypto';

export interface DedupeInput {
  fromAddress: string;
  subject: string;
  sentAtIso: string;
  providerMessageId: string;
}

export function computeDedupeKey(input: DedupeInput): string {
  return createHash('sha256')
    .update(`${input.fromAddress}|${input.subject}|${input.sentAtIso}|${input.providerMessageId}`)
    .digest('hex');
}

export interface SignatureInput {
  template: string;
  agentName: string;
  role: string;
  subaccountName: string;
  discloseAsAgent: boolean;
  agencyName?: string;
}

export function applySignature(body: string, sig: SignatureInput): string {
  let signature = sig.template
    .replaceAll('{agent-name}', sig.agentName)
    .replaceAll('{role}', sig.role)
    .replaceAll('{subaccount-name}', sig.subaccountName);
  if (sig.discloseAsAgent) {
    signature += `\n\nSent by ${sig.agentName}, AI agent at ${sig.subaccountName}, on behalf of ${sig.agencyName ?? sig.subaccountName}.`;
  }
  return `${body}\n\n--\n${signature}`;
}

export type ThreadLookup = (externalIds: string[]) => Promise<string | null>;

export interface ThreadInput {
  inReplyToExternalId?: string;
  referencesExternalIds: string[];
}

export async function resolveThreadId(input: ThreadInput, lookup: ThreadLookup): Promise<string> {
  const externalIds = [
    ...(input.inReplyToExternalId ? [input.inReplyToExternalId] : []),
    ...input.referencesExternalIds,
  ];
  const existing = externalIds.length ? await lookup(externalIds) : null;
  return existing ?? randomUUID();
}
```

(Spec §8.2 specifies `uuidv7()` — use Node's `randomUUID()` (uuid v4) at launch unless the codebase already imports a uuidv7 helper. Note this deviation in `tasks/builds/agent-as-employee/progress.md`. Behaviourally identical for thread ordering since threads are sorted by `created_at` not by uuid value.)

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx tsx server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/services/workspace/workspaceEmailPipelinePure.ts server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts
git commit -m "feat(workspace): pipeline pure logic (dedupe / signature / thread) + tsx test"
```

---

### Task B6: `workspaceEmailPipeline` service (DB-bound)

**Files:**
- Create: `server/services/workspace/workspaceEmailPipeline.ts`

**Spec references:** §8.1 (outbound flow steps 1–7), §8.2 (inbound flow steps 1–7), §12 (`SendEmailParams` contract), §14.1 (intentionally non-idempotent outbound).

- [ ] **Step 1: Write the service skeleton**

```typescript
import { withOrgTx } from '../../instrumentation';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities';
import { workspaceActors } from '../../db/schema/workspaceActors';
import { workspaceMessages } from '../../db/schema/workspaceMessages';
import { auditEvents } from '../../db/schema/auditEvents';
import { eq } from 'drizzle-orm';
import { failure } from '../../../shared/iee/failure';
import { computeDedupeKey, applySignature, resolveThreadId } from './workspaceEmailPipelinePure';
import type { SendEmailParams, SendEmailResult, InboundMessage, WorkspaceAdapter } from '../../../shared/types/workspaceAdapterContract';

interface PipelineDeps {
  adapter: WorkspaceAdapter;
  signatureContext: { template: string; subaccountName: string; agencyName?: string; discloseAsAgent: boolean };
  // Per spec §8.1 (amended): per-identity AND per-org caps.
  // Default implementation lives in workspaceEmailRateLimit.ts (Task B6 step 1b);
  // it wraps inboundRateLimiter.check from server/lib/inboundRateLimiter.ts using
  // rateLimitKeys.workspaceEmailIdentity / workspaceEmailOrg and returns the first
  // failure. Returns nowEpochMs from the DB-canonical clock per hardening invariant #2.
  rateLimitCheck: (scope: { identityId: string; organisationId: string }) => Promise<{ ok: boolean; scope?: 'identity' | 'org'; windowResetAt?: Date; nowEpochMs?: number; reason?: string }>;
  policyCheck: (params: SendEmailParams) => Promise<{ ok: boolean; reason?: string }>;
}

export async function send(
  orgId: string,
  params: SendEmailParams,
  deps: PipelineDeps,
): Promise<SendEmailResult | ReturnType<typeof failure>> {
  // TX1: checks + audit row committed BEFORE adapter call (hardening invariant #1).
  // Keeping this in its own committed transaction means a Step 7 mirror-write failure
  // cannot roll back the audit anchor.
  let identity: typeof workspaceIdentities.$inferSelect;
  let signed: string;
  let audit: typeof auditEvents.$inferSelect;

  const tx1Result = await withOrgTx(orgId, async (db) => {
    // Step 1: sending-enabled check
    const [id] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, params.fromIdentityId));
    if (!id) throw new Error(`Identity ${params.fromIdentityId} not found`);
    if (!id.emailSendingEnabled) {
      return { early: failure('workspace_email_sending_disabled', { identityId: params.fromIdentityId }) };
    }

    // Step 2: policy check
    const policy = await deps.policyCheck(params);
    if (!policy.ok) return { early: failure('workspace_provider_acl_denied', { reason: policy.reason }) };

    // Step 3: rate-limit check — per-identity AND per-org per spec §8.1 (amended).
    const rl = await deps.rateLimitCheck({ identityId: params.fromIdentityId, organisationId: orgId });
    if (!rl.ok) return { early: failure('workspace_email_rate_limited', { scope: rl.scope, windowResetAt: rl.windowResetAt, reason: rl.reason }) };

    // Step 4: signing
    const [actorRow] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, id.actorId));
    const signedBody = applySignature(params.bodyText, {
      template: deps.signatureContext.template,
      agentName: id.displayName,
      role: actorRow?.agentRole ?? 'Agent',
      subaccountName: deps.signatureContext.subaccountName,
      agencyName: deps.signatureContext.agencyName,
      discloseAsAgent: deps.signatureContext.discloseAsAgent,
    });

    // Step 5: audit row — committed with TX1 so it survives any later failure
    const [auditRow] = await db.insert(auditEvents).values({
      organisationId: orgId,
      action: 'email.sent',
      entityType: 'workspace_message',
      workspaceActorId: id.actorId,
      metadata: { toAddresses: params.toAddresses, subject: params.subject, skill: params.policyContext.skill, runId: params.policyContext.runId },
    }).returning();

    return { identity: id, signed: signedBody, audit: auditRow };
  });

  if ('early' in tx1Result) return tx1Result.early;
  ({ identity, signed, audit } = tx1Result);

  // Invariant #10 — structured INFO on first action.
  // rateLimitKey omitted here because the check has already passed; if you want it,
  // capture it inside defaultRateLimitCheck and pass back via the result.
  log.info('workspace.email.send', {
    organisationId: orgId,
    subaccountId: identity.subaccountId,
    operation: 'send',
    actorId: identity.actorId,
    identityId: identity.id,
    connectorType: identity.backend,
    connectorConfigId: identity.connectorConfigId,
    rateLimitKey: null,
    requestId: params.policyContext.runId ?? null,
    auditEventId: audit.id,
    skill: params.policyContext.skill,
  });

  // Step 6: adapter call — outside any transaction; audit row is already committed
  // Pass audit.id as the provider idempotency key so duplicate deliveries are detectable.
  const adapterResult = await deps.adapter.sendEmail({ ...params, bodyText: signed, idempotencyKey: audit.id });

  // TX2: canonical mirror write in its own transaction (hardening invariant #6).
  // If this fails, the audit row survives as the orphan anchor; we log and return a partial result.
  try {
    const msg = await withOrgTx(orgId, async (db) => {
      const threadId = params.threadId ?? await resolveThreadId(
        { inReplyToExternalId: params.inReplyToExternalId, referencesExternalIds: [] },
        async (ids) => {
          if (!ids.length) return null;
          const [row] = await db.select({ threadId: workspaceMessages.threadId })
            .from(workspaceMessages)
            .where(eq(workspaceMessages.externalMessageId, ids[0]));
          return row?.threadId ?? null;
        },
      );
      const [inserted] = await db.insert(workspaceMessages).values({
        organisationId: orgId,
        subaccountId: identity.subaccountId,
        identityId: identity.id,
        actorId: identity.actorId,
        threadId,
        externalMessageId: adapterResult.externalMessageId,
        direction: 'outbound',
        fromAddress: identity.emailAddress,
        toAddresses: params.toAddresses,
        ccAddresses: params.ccAddresses ?? null,
        subject: params.subject,
        bodyText: params.bodyText,
        bodyHtml: params.bodyHtml ?? null,
        sentAt: new Date(),
        auditEventId: audit.id,
        metadata: adapterResult.metadata ?? null,
      }).returning();
      return inserted;
    });
    return { messageId: msg.id, externalMessageId: adapterResult.externalMessageId };
  } catch (mirrorErr: any) {
    // Reconciliation signal for outboundMirrorReaper (hardening invariant #6).
    // Email was sent; only the canonical record is missing.
    log.error('workspace.email.mirror_write_failed', {
      auditEventId: audit.id,
      externalMessageId: adapterResult.externalMessageId,
      error: mirrorErr?.message,
    });
    return failure('workspace_mirror_write_failed', { auditEventId: audit.id, externalMessageId: adapterResult.externalMessageId });
  }
}

export async function ingest(
  orgId: string,
  identityId: string,
  raw: InboundMessage,
  deps: { adapter: WorkspaceAdapter },
): Promise<{ messageId: string; deduplicated: boolean }> {
  return withOrgTx(orgId, async (db) => {
    // Step 1: parse — already done by adapter, raw is canonical
    // Step 2: compute dedupe_key
    const dedupeKey = computeDedupeKey({
      fromAddress: raw.fromAddress,
      subject: raw.subject ?? '',
      sentAtIso: raw.sentAt.toISOString(),
      providerMessageId: raw.rawProviderId,
    });

    // Step 3: thread resolution
    const threadId = await resolveThreadId(
      { inReplyToExternalId: raw.inReplyToExternalId ?? undefined, referencesExternalIds: raw.referencesExternalIds },
      async (ids) => {
        if (!ids.length) return null;
        const [row] = await db.select({ threadId: workspaceMessages.threadId })
          .from(workspaceMessages)
          .where(eq(workspaceMessages.externalMessageId, ids[0]));
        return row?.threadId ?? null;
      },
    );

    // Step 4: attachment handling — store count only, defer body fetch
    // Step 5–6: audit + insert (use ON CONFLICT DO NOTHING via dedupe_uniq)
    const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
    if (!identity) throw new Error(`Identity ${identityId} not found`);

    const [audit] = await db.insert(auditEvents).values({
      organisationId: orgId,
      action: 'email.received',
      entityType: 'workspace_message',
      workspaceActorId: identity.actorId,
      metadata: { fromAddress: raw.fromAddress, subject: raw.subject },
    }).returning();

    try {
      const [inserted] = await db.insert(workspaceMessages).values({
        organisationId: orgId,
        subaccountId: identity.subaccountId,
        identityId: identity.id,
        actorId: identity.actorId,
        threadId,
        externalMessageId: raw.externalMessageId,
        direction: 'inbound',
        fromAddress: raw.fromAddress,
        toAddresses: raw.toAddresses,
        ccAddresses: raw.ccAddresses,
        subject: raw.subject,
        bodyText: raw.bodyText,
        bodyHtml: raw.bodyHtml,
        sentAt: raw.sentAt,
        receivedAt: raw.receivedAt,
        auditEventId: audit.id,
        attachmentsCount: raw.attachmentsCount,
        metadata: { dedupe_key: dedupeKey, provider_id: raw.rawProviderId },
      }).returning();
      return { messageId: inserted.id, deduplicated: false };
    } catch (err: any) {
      if (err?.code === '23505') {
        // Recover by dedupe_key (always non-null and deterministic); never by externalMessageId (nullable/unstable)
        const [existing] = await db.select({ id: workspaceMessages.id }).from(workspaceMessages)
          .where(sql`${workspaceMessages.metadata}->>'dedupe_key' = ${dedupeKey}`);
        return { messageId: existing?.id ?? '', deduplicated: true };
      }
      throw err;
    }
  });
}
```

(Notes: the `signatureContext.template` source-of-truth is the subaccount-level `WorkspaceTenantConfig` — see spec §12. The `role: 'Agent'` placeholder above is wrong: the caller resolves `actor.agent_role` and passes it through the signature context. Fix during integration with `workspaceOnboardingService` in Task B8.)

- [ ] **Step 1b: Add per-identity + per-org keys to `rateLimitKeys` and the wrapper**

Files:
- Modify: `server/lib/rateLimitKeys.ts` — append:
  ```typescript
  workspaceEmailIdentity: (identityId: string): string =>
    `rl:${KEY_VERSION}:workspace:email:identity:${identityId}`,
  workspaceEmailOrg: (organisationId: string): string =>
    `rl:${KEY_VERSION}:workspace:email:org:${organisationId}`,
  ```
- Create: `server/services/workspace/workspaceEmailRateLimit.ts` — exports `defaultRateLimitCheck(scope)`:
  ```typescript
  import { check, getRetryAfterSeconds } from '../../lib/inboundRateLimiter';
  import { rateLimitKeys } from '../../lib/rateLimitKeys';

  // Tunables (no env vars in v1; pin in code, revisit when we have load data).
  const IDENTITY_CAP_PER_HOUR = 60;
  const ORG_CAP_PER_HOUR = 1000;
  const WINDOW_SEC = 3600;

  export async function defaultRateLimitCheck(scope: { identityId: string; organisationId: string }) {
    const id = await check(rateLimitKeys.workspaceEmailIdentity(scope.identityId), IDENTITY_CAP_PER_HOUR, WINDOW_SEC);
    if (!id.allowed) {
      return { ok: false, scope: 'identity' as const, windowResetAt: id.resetAt, nowEpochMs: id.nowEpochMs, reason: 'identity_cap_exceeded' };
    }
    const org = await check(rateLimitKeys.workspaceEmailOrg(scope.organisationId), ORG_CAP_PER_HOUR, WINDOW_SEC);
    if (!org.allowed) {
      return { ok: false, scope: 'org' as const, windowResetAt: org.resetAt, nowEpochMs: org.nowEpochMs, reason: 'org_cap_exceeded' };
    }
    return { ok: true, nowEpochMs: org.nowEpochMs };
  }
  ```
- Route layer (Task B10 mailbox `POST .../send`) on `workspace_email_rate_limited` MUST emit the canonical 429 headers via `setRateLimitDeniedHeaders(res, windowResetAt, nowEpochMs)` from `inboundRateLimiter.ts`. Do NOT compute `Retry-After` manually with `Date.now()` — see hardening invariant #2.

The two-call sequence (identity then org) is the simplest correct shape. The identity bucket increments even when the org bucket would have denied — accepted because saturation is rare and `rateLimitCleanupJob` reaps stale buckets (see [server/lib/rateLimitCleanupJob.ts](server/lib/rateLimitCleanupJob.ts)).

**Wrapper-only invariant (CI-enforced).** All workspace email rate-limiting MUST go through `defaultRateLimitCheck` in `workspaceEmailRateLimit.ts`. Direct `inboundRateLimiter.check(rateLimitKeys.workspaceEmail*, …)` calls outside the wrapper drift on cap values and window sizes over time. Add a static check (extend the existing `scripts/verify-pipeline-only-outbound.ts` or create a sibling `scripts/verify-workspace-rate-limit-wrapper.ts`):

```typescript
// scripts/verify-workspace-rate-limit-wrapper.ts
import { execSync } from 'node:child_process';

const allowed = ['server/services/workspace/workspaceEmailRateLimit.ts'];
const out = execSync(
  `git grep -n "rateLimitKeys\\.workspaceEmail" -- 'server/**/*.ts'`,
  { encoding: 'utf8' }
).split('\n').filter(Boolean);

const violations = out.filter((line) => !allowed.some((f) => line.startsWith(f)));
if (violations.length > 0) {
  console.error('verify-workspace-rate-limit-wrapper: FAIL — workspace email rate-limit keys must only be used inside workspaceEmailRateLimit.ts');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('verify-workspace-rate-limit-wrapper: OK');
```

Wire into the same CI job that runs `verify-pipeline-only-outbound.ts`. Document the wrapper as the single entry point in the file header comment of `workspaceEmailRateLimit.ts`.

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add server/services/workspace/workspaceEmailPipeline.ts server/services/workspace/workspaceEmailRateLimit.ts server/lib/rateLimitKeys.ts
git commit -m "feat(workspace): workspaceEmailPipeline outbound + inbound + rate-limit wrapper"
```

---

### Deferred: `outboundMirrorReaper` — reconciliation consumer contract

**Not implemented in Phases A–E.** Tracked as a fast-follow once live sends exist. This stub defines the contract so the signal format is locked before the consumer is built.

**Trigger:** Any `log.error('workspace.email.mirror_write_failed', ...)` emission. In production these are ingested by the log aggregator and written to a `workspace_reconciliation_jobs` table (or equivalent pg-boss queue).

**Contract:**
- Keyed on `auditEventId` — exactly one reconciliation attempt per orphaned send.
- Input: `{ auditEventId: string; externalMessageId: string | null; organisationId: string }` (fields emitted by the pipeline's TX2 catch block).
- Process: fetch the committed `audit_events` row by `auditEventId`; derive `identityId`, `actorId`, `subaccountId`; write the missing `workspace_messages` row using the same field values as the original send, with `externalMessageId` from the reconciliation record.
- Idempotency: `ON CONFLICT DO NOTHING` on `auditEventId` FK — safe to re-run any number of times.
- Terminal state: the job is complete when a `workspace_messages` row with `auditEventId = <this job's auditEventId>` exists. No further action.
- No re-send: the reaper writes only the canonical record — it never calls `adapter.sendEmail` again. The email was already delivered; the gap is observability only.

---

### Task B7: `nativeWorkspaceAdapter`

**Files:**
- Create: `server/adapters/workspace/nativeWorkspaceAdapter.ts`

**Spec references:** §7 (contract), §8.1 (native SMTP), §8.3 (RFC 5546 calendar-over-email).

- [ ] **Step 1: Pick the transactional email provider client**

Inspect existing dependencies:

```bash
grep -E "postmark|sendgrid|mailgun|@sendgrid" package.json
```

Use whatever the codebase already has. If none, install Postmark (lowest setup overhead) — `npm install postmark`. Default to Postmark in `NATIVE_EMAIL_PROVIDER` env.

- [ ] **Step 2: Implement the adapter**

The adapter implements `WorkspaceAdapter`. **Canonical write invariant:** adapters make provider calls only — the pipeline owns all canonical writes to `workspace_messages`. The adapter's `sendEmail` returns `{ externalMessageId: string | null; metadata?: Record<string, unknown> }` and does not touch the DB. The pipeline's `send` function uses that result to write the row and returns the full `SendEmailResult` (with `messageId`). This diverges from the spec §7 wording; the plan is authoritative.

```typescript
// server/adapters/workspace/nativeWorkspaceAdapter.ts
import type { WorkspaceAdapter, ProvisionParams, ProvisionResult, SendEmailParams, SendEmailResult, InboundMessage, CreateEventParams, CreateEventResult, CalendarEvent } from './workspaceAdapterContract';
import { withOrgTx, withAdminConnection } from '../../instrumentation';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities';
import { workspaceMessages } from '../../db/schema/workspaceMessages';
import { workspaceCalendarEvents } from '../../db/schema/workspaceCalendarEvents';
import { eq } from 'drizzle-orm';
import { sendThroughProvider } from '../../lib/transactionalEmailProvider'; // small wrapper around chosen provider
import { buildICalEvent, buildICalReply } from '../../lib/iCalBuilder'; // RFC 5546 helper

export const nativeWorkspaceAdapter: WorkspaceAdapter = {
  backend: 'synthetos_native',

  async provisionIdentity(params: ProvisionParams): Promise<ProvisionResult> {
    return withOrgTx(params.organisationId, async (db) => {
      const emailAddress = `${params.emailLocalPart}@${getNativeDomain(params.subaccountId)}`;
      const [row] = await db.insert(workspaceIdentities).values({
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        actorId: params.actorId,
        connectorConfigId: params.connectorConfigId,
        backend: 'synthetos_native',
        emailAddress,
        emailSendingEnabled: params.emailSendingEnabled,
        externalUserId: null,
        displayName: params.displayName,
        photoUrl: params.photoUrl ?? null,
        status: 'provisioned',
        provisioningRequestId: params.provisioningRequestId,
        metadata: { signature: params.signature },
      }).onConflictDoNothing({ target: workspaceIdentities.provisioningRequestId }).returning();
      // Idempotency hit: row already exists for this provisioningRequestId. Return existing.
      if (!row) {
        const [existing] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.provisioningRequestId, params.provisioningRequestId));
        return { identityId: existing.id, emailAddress: existing.emailAddress, externalUserId: null };
      }
      return { identityId: row.id, emailAddress: row.emailAddress, externalUserId: null };
    });
  },

  async suspendIdentity(_identityId) { /* native — no provider step; identity service handles row */ },
  async resumeIdentity(_identityId) { /* native — no provider step */ },
  async revokeIdentity(_identityId) { /* native — no provider step */ },
  async archiveIdentity(_identityId) { /* native — no provider step */ },

  async sendEmail(params: SendEmailParams): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }> {
    // 1. Look up identity to get from-address
    return withAdminConnection(async (db) => {
      const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, params.fromIdentityId));
      if (!identity) throw new Error(`Identity ${params.fromIdentityId} not found`);
      // 2. Send via provider
      const providerResult = await sendThroughProvider({
        from: identity.emailAddress,
        fromName: identity.displayName,
        to: params.toAddresses,
        cc: params.ccAddresses,
        subject: params.subject,
        bodyText: params.bodyText,
        bodyHtml: params.bodyHtml,
      });
      // 3. Return provider result — pipeline owns the canonical workspace_messages write
      return { externalMessageId: providerResult.messageId };
    });
  },

  async fetchInboundSince(_identityId, _since): Promise<InboundMessage[]> {
    // Native uses provider webhooks — pull is not the primary path. Return empty or use provider's fetch API.
    return [];
  },

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    return withAdminConnection(async (db) => {
      const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, params.fromIdentityId));
      const ical = buildICalEvent({ ...params, organiser: identity.emailAddress });
      // Send invite as iCal email to attendees
      await sendThroughProvider({
        from: identity.emailAddress,
        fromName: identity.displayName,
        to: params.attendeeEmails,
        subject: params.title,
        bodyText: 'Calendar invite — see attached',
        attachments: [{ name: 'invite.ics', content: ical, contentType: 'text/calendar; method=REQUEST' }],
      });
      const [evt] = await db.insert(workspaceCalendarEvents).values({
        organisationId: identity.organisationId,
        subaccountId: identity.subaccountId,
        identityId: identity.id,
        actorId: identity.actorId,
        externalEventId: null,
        organiserEmail: identity.emailAddress,
        title: params.title,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        attendeeEmails: params.attendeeEmails,
        responseStatus: 'accepted',
      }).returning();
      return { eventId: evt.id, externalEventId: null };
    });
  },

  async respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void> {
    await withAdminConnection(async (db) => {
      const [evt] = await db.select().from(workspaceCalendarEvents).where(eq(workspaceCalendarEvents.id, eventId));
      const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, evt.identityId));
      const ical = buildICalReply({ event: evt, identityEmail: identity.emailAddress, response });
      await sendThroughProvider({
        from: identity.emailAddress,
        fromName: identity.displayName,
        to: [evt.organiserEmail],
        subject: `RE: ${evt.title}`,
        bodyText: `Response: ${response}`,
        attachments: [{ name: 'reply.ics', content: ical, contentType: 'text/calendar; method=REPLY' }],
      });
      await db.update(workspaceCalendarEvents).set({ responseStatus: response, updatedAt: new Date() }).where(eq(workspaceCalendarEvents.id, eventId));
    });
  },

  async fetchUpcoming(_identityId, _until): Promise<CalendarEvent[]> {
    // Native has no external calendar to fetch from — events are entirely in our store. Caller should query the DB directly.
    return [];
  },
};

function getNativeDomain(_subaccountId: string): string {
  // Per spec Q1: {subaccount-slug}.synthetos.io.
  // Resolve via subaccount lookup at runtime. Stub for now; final resolution lands in onboarding service integration.
  return 'placeholder.synthetos.io';
}
```

- [ ] **Step 3: Stub helpers**

Create `server/lib/transactionalEmailProvider.ts` with a `sendThroughProvider` function that dispatches to Postmark / SendGrid / Mailgun based on `process.env.NATIVE_EMAIL_PROVIDER`. Create `server/lib/iCalBuilder.ts` with `buildICalEvent` + `buildICalReply` (use the `ical-generator` npm package or hand-roll RFC 5546 — hand-rolling is simpler for v1).

- [ ] **Step 4: Add env var documentation**

Update `.env.example`:

```
# Native workspace email provider
NATIVE_EMAIL_PROVIDER=postmark
NATIVE_EMAIL_PROVIDER_API_KEY=
NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET=
```

Update `server/lib/env.ts` to declare and validate these.

- [ ] **Step 5: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/adapters/workspace/nativeWorkspaceAdapter.ts server/lib/transactionalEmailProvider.ts server/lib/iCalBuilder.ts server/lib/env.ts .env.example
git commit -m "feat(workspace): nativeWorkspaceAdapter + transactional email + iCal helpers"
```

---

### Task B8: `workspaceOnboardingService`

**Files:**
- Create: `server/services/workspace/workspaceOnboardingService.ts`

**Spec reference:** §9.1 (onboarding flow steps 1–9 + idempotency + failure modes).

- [ ] **Step 1: Implement onboarding per spec §9.1**

```typescript
import { withOrgTx } from '../../instrumentation';
import { workspaceActors } from '../../db/schema/workspaceActors';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities';
import { connectorConfigs } from '../../db/schema/connectorConfigs';
import { auditEvents } from '../../db/schema/auditEvents';
import { eq, and } from 'drizzle-orm';
import { failure } from '../../../shared/iee/failure';
import { transition } from './workspaceIdentityService';
import { updateDisplayName } from './workspaceActorService';
import type { WorkspaceAdapter } from '../../../shared/types/workspaceAdapterContract';

export interface OnboardParams {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  displayName: string;
  emailLocalPart: string;
  emailSendingEnabled: boolean;
  signatureOverride?: string;
  onboardingRequestId: string;
  initiatedByUserId: string;
}

export interface OnboardResult {
  identityId: string;
  emailAddress: string;
  idempotent: boolean;
}

export async function onboard(params: OnboardParams, deps: { adapter: WorkspaceAdapter; connectorConfigId: string }): Promise<OnboardResult | ReturnType<typeof failure>> {
  // (1) Resolve actor (must exist post-seed)
  const actorRow = await withOrgTx(params.organisationId, async (db) => {
    const { agents } = await import('../../db/schema/agents');
    const [agent] = await db.select().from(agents).where(eq(agents.id, params.agentId));
    if (!agent || !agent.workspaceActorId) {
      return null;
    }
    const [actor] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, agent.workspaceActorId));
    return actor ?? null;
  });
  if (!actorRow) return failure('workspace_idempotency_collision', { reason: 'agent has no workspace actor — backfill required' });

  // (3) Idempotency check: onboardingRequestId already used?
  const existing = await withOrgTx(params.organisationId, async (db) => {
    const [r] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.provisioningRequestId, params.onboardingRequestId));
    return r ?? null;
  });
  if (existing) return { identityId: existing.id, emailAddress: existing.emailAddress, idempotent: true };

  // (5) Update actor display name
  await updateDisplayName(params.organisationId, actorRow.id, params.displayName);

  // (6) Adapter call (outside transaction — external)
  let provisionResult;
  try {
    provisionResult = await deps.adapter.provisionIdentity({
      actorId: actorRow.id,
      subaccountId: params.subaccountId,
      organisationId: params.organisationId,
      connectorConfigId: deps.connectorConfigId,
      emailLocalPart: params.emailLocalPart,
      displayName: params.displayName,
      signature: params.signatureOverride ?? '',
      emailSendingEnabled: params.emailSendingEnabled,
      provisioningRequestId: params.onboardingRequestId,
    });
  } catch (err: any) {
    return failure('workspace_identity_provisioning_failed', { reason: String(err?.message ?? err) });
  }

  // (7) Mark active
  await transition(params.organisationId, provisionResult.identityId, 'activate', params.initiatedByUserId);

  // (8) Audit events
  await withOrgTx(params.organisationId, async (db) => {
    const baseAudit = { organisationId: params.organisationId, workspaceActorId: actorRow.id, entityType: 'workspace_identity' as const };
    await db.insert(auditEvents).values([
      { ...baseAudit, action: 'actor.onboarded', metadata: { identityId: provisionResult.identityId } },
      { ...baseAudit, action: 'identity.provisioned', metadata: { identityId: provisionResult.identityId } },
      { ...baseAudit, action: 'identity.activated', metadata: { identityId: provisionResult.identityId } },
    ]);
  });

  // (9) IEE event emission
  // (Wired through existing IEE event bus — call the existing emit helper.)

  return { identityId: provisionResult.identityId, emailAddress: provisionResult.emailAddress, idempotent: false };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add server/services/workspace/workspaceOnboardingService.ts
git commit -m "feat(workspace): workspaceOnboardingService per spec §9.1"
```

---

### Task B9: Workspace routes — `server/routes/workspace.ts`

**Files:**
- Create: `server/routes/workspace.ts`
- Modify: `server/index.ts` (mount route)
- Modify: `server/routes/subaccounts.ts` (`GET /api/subaccounts/:saId/workspace`)

**Spec reference:** §5 (routes new), §9.1–9.4, §10.1 (permissions), §14.5 (constraint→HTTP).

- [ ] **Step 1: Add the seven endpoints**

Per spec §5:

- `POST /api/subaccounts/:saId/workspace/configure` — body `{ backend: 'synthetos_native' \| 'google_workspace', connectorConfigId }`. Writes the subaccount-level workspace config. Permission: `subaccounts:manage_workspace`.
- `POST /api/subaccounts/:saId/workspace/onboard` — body per `OnboardParams`. Calls `workspaceOnboardingService.onboard`. Permission: `agents:onboard`. 23505 on `workspace_identities_actor_backend_active_uniq` → 409 `identity_already_exists_for_actor_in_backend`. 23505 on `workspace_identities_email_per_config_uniq` → 409 `email_address_already_in_use`. Idempotent hit → 200 with `idempotent: true`.
- `POST /api/subaccounts/:saId/workspace/migrate` — Phase E (stub returning 501 in Phase B).
- `POST /api/agents/:agentId/identity/suspend` — Permission: `agents:manage_lifecycle`. Calls `workspaceIdentityService.transition(..., 'suspend', ...)`, then `adapter.suspendIdentity`. Returns `{ status, seatFreedImmediately: true, noOpDueToRace }`.
- `POST /api/agents/:agentId/identity/resume` — same pattern, action `'resume'`.
- `POST /api/agents/:agentId/identity/revoke` — same pattern, action `'revoke'`. Body must include `confirmName: string` matching agent display name; reject with 400 if mismatch.
- `POST /api/agents/:agentId/identity/archive` — Permission: `agents:manage_lifecycle`. Action `'archive'`.
- `PATCH /api/agents/:agentId/identity/email-sending` — body `{ enabled: boolean }`. Permission: `agents:toggle_email`. Calls `setEmailSending`.

Each route uses the standard middleware chain: `authenticate → resolveSubaccount → requireSubaccountPermission(<key>)`. Match the style of an existing tenant-scoped route — `grep -n "requireSubaccountPermission" server/routes/*.ts | head -5`.

For revoke: surface "type-the-name" gate at the UI; the route just validates the submitted `confirmName` matches `actor.displayName`.

- [ ] **Step 2: Mount the route in `server/index.ts`**

Add the import and `app.use('/api', workspaceRoutes)` (or whatever the existing mount pattern is).

- [ ] **Step 3: Add `GET /api/subaccounts/:saId/workspace` to `subaccounts.ts`**

Returns `{ backend, connectorConfigId, seatUsage: { active, suspended, total } }`. Uses `countActiveIdentities`.

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/routes/workspace.ts server/index.ts server/routes/subaccounts.ts
git commit -m "feat(workspace): workspace routes (configure / onboard / lifecycle / email-toggle)"
```

---

### Task B10: Mailbox + calendar routes

**Files:**
- Create: `server/routes/workspaceMail.ts`
- Create: `server/routes/workspaceCalendar.ts`
- Modify: `server/index.ts` (mount both)

**Spec reference:** §5 (routes new), §10.1 (`agents:view_mailbox`, `agents:view_calendar`).

- [ ] **Step 1: `server/routes/workspaceMail.ts`**

Endpoints:

- `GET /api/agents/:agentId/mailbox` — query `?cursor=&limit=` → list of recent `workspace_messages` for the agent's identity, ordered `created_at DESC, id ASC`. Permission: `agents:view_mailbox`. Cursor pagination per spec §12 (`ActivityFeedItem ordering`).
- `POST /api/agents/:agentId/mailbox/send` — body `SendEmailParams`. Permission: `agents:view_mailbox` (compose is part of view). Calls `workspaceEmailPipeline.send`. Failure mapping:
  - `workspace_email_sending_disabled` → 403
  - `workspace_email_rate_limited` → 429
  - `workspace_mirror_write_failed` → **200** `{ sent: true, reconciling: true, auditEventId, externalMessageId }` — the email was delivered; only the canonical record is pending async repair. Never return 4xx/5xx for this case; doing so would cause the caller to retry the send, producing a duplicate delivery.
- `GET /api/agents/:agentId/mailbox/threads/:threadId` — list messages in the thread.

- [ ] **Step 2: `server/routes/workspaceCalendar.ts`**

Endpoints:

- `GET /api/agents/:agentId/calendar` — query `?from=&to=` → upcoming events. Permission: `agents:view_calendar`.
- `POST /api/agents/:agentId/calendar/events` — body `CreateEventParams`. Calls `adapter.createEvent` directly (calendar is not pipelined; create is its own action).
- `POST /api/agents/:agentId/calendar/events/:eventId/respond` — body `{ response: 'accepted' | 'declined' | 'tentative' }`. Calls `adapter.respondToEvent`.

- [ ] **Step 3: Mount + commit**

```bash
git add server/routes/workspaceMail.ts server/routes/workspaceCalendar.ts server/index.ts
git commit -m "feat(workspace): mailbox + calendar routes"
```

---

### Task B11: API client wrappers — `client/src/lib/api.ts`

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Add typed wrappers for every new endpoint**

Match the existing wrapper style. One function per endpoint:

```typescript
export async function configureWorkspace(saId: string, body: { backend: 'synthetos_native' | 'google_workspace'; connectorConfigId: string }) { ... }
export async function onboardAgentToWorkspace(saId: string, body: OnboardParams) { ... }
export async function suspendAgentIdentity(agentId: string) { ... }
export async function resumeAgentIdentity(agentId: string) { ... }
export async function revokeAgentIdentity(agentId: string, confirmName: string) { ... }
export async function archiveAgentIdentity(agentId: string) { ... }
export async function toggleAgentEmailSending(agentId: string, enabled: boolean) { ... }
export async function getAgentMailbox(agentId: string, cursor?: string) { ... }
export async function sendAgentEmail(agentId: string, body: SendEmailParams) { ... }
export async function getAgentMailboxThread(agentId: string, threadId: string) { ... }
export async function getAgentCalendar(agentId: string, from: string, to: string) { ... }
export async function createAgentCalendarEvent(agentId: string, body: CreateEventParams) { ... }
export async function respondToAgentCalendarEvent(agentId: string, eventId: string, response: 'accepted' | 'declined' | 'tentative') { ... }
export async function getSubaccountWorkspaceConfig(saId: string) { ... }
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add client/src/lib/api.ts
git commit -m "feat(workspace): typed API client wrappers"
```

---

### Task B12: Reusable workspace components — `IdentityCard`, `LifecycleProgress`, `EmailSendingToggle`, `SeatsPanel`

**Files:**
- Create: `client/src/components/workspace/IdentityCard.tsx`
- Create: `client/src/components/workspace/LifecycleProgress.tsx`
- Create: `client/src/components/workspace/EmailSendingToggle.tsx`
- Create: `client/src/components/workspace/SeatsPanel.tsx`

**Spec reference:** mockups 09 (Identity tab), 03 (subaccount Agents tab seats panel), 01 (Workspace setup native — seat counter).

- [ ] **Step 1: Read mockup 09 to confirm IdentityCard layout**

```bash
cat prototypes/agent-as-employee/09-agent-identity-tab.html
```

Match the visual structure: avatar / display name / email (visible) / lifecycle dot + word / send-mail toggle row / Suspend / Revoke buttons (one primary at a time depending on state).

- [ ] **Step 2: Build each component**

- `IdentityCard` — props `{ identity: WorkspaceIdentity; actor: WorkspaceActor; onSuspend; onResume; onRevoke; onArchive; onToggleEmail }`. Renders header with avatar + display name + email, then `<LifecycleProgress />`, then `<EmailSendingToggle />`, then a single primary action button (Suspend if `active`, Resume if `suspended`, disabled if terminal). Revoke button is secondary, always present unless `revoked` / `archived`.
- `LifecycleProgress` — props `{ status: WorkspaceIdentityStatus }`. Renders a coloured dot + word inline (active=green, suspended=amber, revoked=red, archived=grey). Per spec §3 frontend re-check rule 4 (inline state beats dashboards).
- `EmailSendingToggle` — props `{ enabled: boolean; onChange }`. Tailwind-styled switch with label "Email sending".
- `SeatsPanel` — props `{ subaccountId: string }`. Fetches `getSubaccountWorkspaceConfig(saId).seatUsage`, renders inline (e.g. "3 seats consumed · 2 active, 1 suspended"). Per spec §10.6, reads live from `workspace_identities`.

- [ ] **Step 3: build:client and commit**

```bash
npm run build:client
git add client/src/components/workspace/
git commit -m "feat(workspace): IdentityCard, LifecycleProgress, EmailSendingToggle, SeatsPanel"
```

---

### Task B13: `OnboardAgentModal` — 3-step modal (mockups 04 → 05 → 06 → 07)

**Files:**
- Create: `client/src/components/workspace/OnboardAgentModal.tsx`

**Spec reference:** §3 (UX walkthrough — mockups 04–07), §9.1 (onboarding flow), §10.1 (`agents:onboard`).

- [ ] **Step 1: Read all four mockups**

```bash
cat prototypes/agent-as-employee/04-onboard-step1-identity.html
cat prototypes/agent-as-employee/05-onboard-step2-confirm.html
cat prototypes/agent-as-employee/06-onboard-step3-progress.html
cat prototypes/agent-as-employee/07-onboard-success.html
```

Note copy, button labels, layout, and the single primary action at each step.

- [ ] **Step 2: Build the modal**

State machine: `'identity' → 'confirm' → 'progress' → 'success' | 'error'`.

- `'identity'` step (mockup 04): inputs for display name (pre-filled from agent), email local part (pre-filled "{first-name-lowercase}"), `email_sending_enabled` toggle. Primary: "Continue".
- `'confirm'` step (mockup 05): summary — display name, email address (`{local}@{native-domain}`), email-sending state, lifecycle next state. Primary: "Confirm & onboard".
- `'progress'` step (mockup 06): inline progress bar / lifecycle steps (`Provisioning…` → `Activating…` → `Done`). On click "Confirm" the modal generates `onboardingRequestId = crypto.randomUUID()` and calls `onboardAgentToWorkspace`. Idempotent: closing and re-opening creates a new `onboardingRequestId`; double-clicking the same modal session re-uses the same id (so 2nd click → idempotent 200).
- `'success'` step (mockup 07): "Onboarded" with "Go to Identity tab" CTA → navigates to `SubaccountAgentEditPage?tab=identity&newlyOnboarded=1`.
- Error: surface failure reason (`workspace_email_sending_disabled` etc.) inline.

Use the existing `Modal` + `ConfirmDialog` primitives — see `grep -n "ConfirmDialog" client/src/components/`.

- [ ] **Step 3: build:client + commit**

```bash
npm run build:client
git add client/src/components/workspace/OnboardAgentModal.tsx
git commit -m "feat(workspace): OnboardAgentModal — 3-step modal (mockups 04-07)"
```

---

### Task B14: `SuspendIdentityDialog` + `RevokeIdentityDialog`

**Files:**
- Create: `client/src/components/workspace/SuspendIdentityDialog.tsx`
- Create: `client/src/components/workspace/RevokeIdentityDialog.tsx`

**Spec reference:** mockups 12 (suspend), 13 (revoke with type-the-name gate), §9.2 (suspension), §9.4 (revoke = suspend-not-delete on Google).

- [ ] **Step 1: Build SuspendIdentityDialog (mockup 12)**

Single-step confirmation. Copy explains: "Suspending {name} immediately frees their seat and pauses email sending. You can resume them later." Primary: "Suspend". On confirm calls `suspendAgentIdentity(agentId)`.

- [ ] **Step 2: Build RevokeIdentityDialog (mockup 13)**

Two-step gate:

1. Read explanatory copy: "Revoking is permanent for billing purposes. The agent's email will be suspended but historical mail and audit are preserved. To proceed, type the agent's name to confirm."
2. Text input — must equal `actor.displayName` exactly (case-sensitive). "Revoke" button disabled until match.
3. On confirm calls `revokeAgentIdentity(agentId, confirmName)`.

- [ ] **Step 3: build:client + commit**

```bash
npm run build:client
git add client/src/components/workspace/SuspendIdentityDialog.tsx client/src/components/workspace/RevokeIdentityDialog.tsx
git commit -m "feat(workspace): SuspendIdentityDialog + RevokeIdentityDialog (mockups 12 + 13)"
```

---

### Task B15: `WorkspaceTabContent` — Workspace tab on `AdminSubaccountDetailPage`

**Files:**
- Create: `client/src/components/workspace/WorkspaceTabContent.tsx`
- Modify: `client/src/pages/AdminSubaccountDetailPage.tsx`

**Spec reference:** §3 (mockup 01 native, mockup 02 Google), §10.6 (SeatsPanel).

- [ ] **Step 1: Read mockups 01 + 02**

```bash
cat prototypes/agent-as-employee/01-workspace-setup-native.html
cat prototypes/agent-as-employee/02-workspace-setup-google.html
```

- [ ] **Step 2: Build `WorkspaceTabContent`**

Two cards: "Synthetos-native" (selectable in Phase B) and "Google Workspace" (disabled with "coming next phase" tooltip — this card becomes active in Phase C). Bottom: `<SeatsPanel subaccountId={saId} />`. Below: list of currently configured workspace + a "Migrate" button (stub for Phase E).

- [ ] **Step 3: Wire into `AdminSubaccountDetailPage`**

Open the file and add `'workspace'` to the `ActiveTab` union, `TAB_LABELS`, and `visibleTabs`. Render `WorkspaceTabContent` lazily under that tab.

```bash
grep -n "ActiveTab" client/src/pages/AdminSubaccountDetailPage.tsx | head -3
```

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/components/workspace/WorkspaceTabContent.tsx client/src/pages/AdminSubaccountDetailPage.tsx
git commit -m "feat(workspace): Workspace tab on AdminSubaccountDetailPage"
```

---

### Task B16: Per-row "Onboard to workplace" CTA on `SubaccountAgentsPage`

**Files:**
- Modify: `client/src/pages/SubaccountAgentsPage.tsx`

**Spec reference:** §3 mockup 03, §2 (no template picker; CTA renames from "+ Hire an agent").

- [ ] **Step 1: Read mockup 03**

```bash
cat prototypes/agent-as-employee/03-subaccount-agents-list.html
```

Note: per-row CTA reads "Onboard to workplace" only on agents NOT yet onboarded (`workspaceActorId` exists but no `workspace_identities` row exists for the configured backend).

- [ ] **Step 2: Update the page**

Add a per-row action that opens `OnboardAgentModal`. The CTA visibility predicate:

```typescript
const showOnboardCta = (agent) => agent.workspaceActorId !== null && !agent.hasActiveWorkspaceIdentity;
```

Backend: extend the existing agents-list endpoint (or add a sibling) to return `hasActiveWorkspaceIdentity` per agent. (Implement that boolean on the existing list service — single LEFT JOIN on `workspace_identities` filtered to `status IN ('provisioned','active','suspended')`.)

Keep the existing "Load System Agents" CTA — its purpose (adding additional agent instances) is unchanged.

- [ ] **Step 3: build:client + commit**

```bash
npm run build:client
git add client/src/pages/SubaccountAgentsPage.tsx
git commit -m "feat(workspace): per-row Onboard to workplace CTA"
```

---

### Task B17: Identity tab on `SubaccountAgentEditPage`

**Files:**
- Modify: `client/src/pages/SubaccountAgentEditPage.tsx`

**Spec reference:** §3 mockup 09, §2 (`'identity'` tab, no internal IDs shown).

- [ ] **Step 1: Read mockup 09**

```bash
cat prototypes/agent-as-employee/09-agent-identity-tab.html
```

- [ ] **Step 2: Add `'identity'` to the Tab union**

Find the existing tab union, add `'identity'`. Default to `'identity'` when navigated with `?newlyOnboarded=1`.

- [ ] **Step 3: Render the tab body**

```tsx
<IdentityCard
  identity={identity}
  actor={actor}
  onSuspend={() => setSuspendOpen(true)}
  onResume={() => resumeAgentIdentity(agentId)}
  onRevoke={() => setRevokeOpen(true)}
  onToggleEmail={(enabled) => toggleAgentEmailSending(agentId, enabled)}
/>
<SuspendIdentityDialog open={suspendOpen} ... />
<RevokeIdentityDialog open={revokeOpen} ... />
```

Per spec §2 explicit rule: **NO internal IDs (actor / identity / connector) shown.** Render only display name, email, lifecycle state.

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/pages/SubaccountAgentEditPage.tsx
git commit -m "feat(workspace): Identity tab on SubaccountAgentEditPage"
```

---

### Task B18: `AgentMailboxPage` (mockup 10)

**Files:**
- Create: `client/src/pages/AgentMailboxPage.tsx`
- Modify: `client/src/App.tsx` (add route)

**Spec reference:** §3 mockup 10, §2 (per-agent only — no aggregate inbox), §8 (canonical messages).

- [ ] **Step 1: Read mockup 10**

```bash
cat prototypes/agent-as-employee/10-agent-mailbox.html
```

- [ ] **Step 2: Build the page**

- Header: agent name + email + "Compose" button.
- Body: list of threads (group by `threadId`), most-recent message preview, sender, time.
- Right panel (when a thread is selected): full message thread view.
- Compose modal: opens on click → calls `sendAgentEmail`.
- For Google identity: "Open in Gmail" deep-link button on each thread (uses `metadata.gmail_thread_id`).

- [ ] **Step 3: Add SPA route**

`/admin/subaccounts/:saId/agents/:agentId/mailbox` → `AgentMailboxPage`.

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/pages/AgentMailboxPage.tsx client/src/App.tsx
git commit -m "feat(workspace): AgentMailboxPage (mockup 10)"
```

---

### Task B19: `AgentCalendarPage` (mockup 11)

**Files:**
- Create: `client/src/pages/AgentCalendarPage.tsx`
- Modify: `client/src/App.tsx` (add route)

**Spec reference:** §3 mockup 11, §8.3 (calendar pipeline).

- [ ] **Step 1: Read mockup 11**

```bash
cat prototypes/agent-as-employee/11-agent-calendar.html
```

- [ ] **Step 2: Build the page**

- Week view (default) with day-column layout.
- Each event: title, time, attendees, response-status pill.
- "New event" button → modal with title / start / end / attendees → calls `createAgentCalendarEvent`.
- Event detail panel: accept / decline / tentative buttons → call `respondToAgentCalendarEvent`.
- For Google identity: "Open in Google Calendar" deep-link.

- [ ] **Step 3: Add SPA route**

`/admin/subaccounts/:saId/agents/:agentId/calendar` → `AgentCalendarPage`.

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/pages/AgentCalendarPage.tsx client/src/App.tsx
git commit -m "feat(workspace): AgentCalendarPage (mockup 11)"
```

---

### Task B20: Native infra config — env vars + transactional email provider account

**Files:**
- Modify: `.env.example` (already touched in B7 — verify completeness)
- Documentation: add a short section to `architecture.md` or a dedicated `docs/agent-as-employee-runbook.md` covering DNS / MX setup for the `<subaccount-slug>.synthetos.io` zone

**Spec reference:** §8.1 (native outbound infra), §15 Phase B (native infra prerequisites).

- [ ] **Step 1: Confirm the env vars are correctly declared**

```bash
grep -E "NATIVE_EMAIL|GOOGLE_WORKSPACE" .env.example server/lib/env.ts
```

- [ ] **Step 2: Document the provider setup steps**

In `docs/agent-as-employee-runbook.md` (new file):

```markdown
# Agent-as-employee — operations runbook

## Native backend setup

1. Sign up for Postmark / SendGrid / Mailgun (whichever the deployment uses).
2. Provision a sender domain `*.synthetos.io` per the zone we own.
3. Add SPF + DKIM records per the provider's instructions.
4. Configure the inbound webhook URL: `https://<api-host>/api/workspace/native/inbound`. Set the shared secret as `NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET`.
5. Add API key as `NATIVE_EMAIL_PROVIDER_API_KEY`.

## Google Workspace setup

(Filled in during Phase C.)
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-as-employee-runbook.md
git commit -m "docs(workspace): native infra runbook"
```

---

### Task B21: Inbound webhook route — native

**Files:**
- Modify: `server/routes/workspace.ts` (or new `server/routes/workspaceInbound.ts`)

**Spec reference:** §8.2 (inbound flow), §14.1 (key-based idempotency on inbound).

- [ ] **Step 1: Add the inbound webhook**

`POST /api/workspace/native/inbound` — verifies `X-Provider-Signature` header against `NATIVE_EMAIL_INBOUND_WEBHOOK_SECRET`. On valid signature: parse the provider-shaped payload into the canonical `InboundMessage` shape and call `workspaceEmailPipeline.ingest`. On 23505 (dedupe collision): return 200 — webhook retries are expected. No tenant scoping at this layer; the webhook resolves the identity by recipient address (the email's `To:` value is the agent's `email_address`, which is unique per `connector_config`).

- [ ] **Step 2: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/routes/workspace.ts
git commit -m "feat(workspace): native inbound webhook"
```

---

### Task B22: Phase B close-out

- [ ] **Step 1: Run all Phase B exit checks**

```bash
npm run lint
npx tsc --noEmit
npm run build:client
npx tsx server/services/workspace/__tests__/workspaceEmailPipelinePure.test.ts
npx tsx server/services/workspace/__tests__/workspaceIdentityServicePure.test.ts
npx tsx scripts/verify-pipeline-only-outbound.ts
```

- [ ] **Step 2: Manual UAT walk-through (mockups 01 → 03 → 04 → 05 → 06 → 07 → 09 → 10 → 11 → 12 → 13)**

For each mockup, confirm the live UI matches on layout, copy, primary action. Note any deviation in `tasks/builds/agent-as-employee/progress.md`.

End-to-end: configure native → onboard "Sarah" → check Identity tab → send email → confirm `workspace_messages` + `audit_events` rows → toggle email-sending off → send fails with `workspace_email_sending_disabled` (no audit, no message) → toggle on → suspend → seat freed → resume → seat back → revoke (type-the-name) → state terminal.

- [ ] **Step 3: Update progress file + open Phase B PR**

```bash
git push origin feat/agents-are-employees
gh pr create --title "Agent-as-employee: Phase B — native adapter + canonical pipeline + onboard" --base main --body "$(cat <<'EOF'
## Summary

- WorkspaceAdapter contract + nativeWorkspaceAdapter (Postmark/SendGrid/Mailgun via configurable provider).
- workspaceEmailPipeline (outbound + inbound) gating policy / rate-limit / signing / send-mail toggle.
- workspaceIdentityService with state-based race-safe transitions and pure state-machine module.
- workspaceOnboardingService — confirmation-gated, idempotent, reversible.
- Routes: configure / onboard / suspend / resume / revoke / archive / email-toggle / mailbox / calendar / native inbound webhook.
- UI: Workspace tab on AdminSubaccountDetailPage (native card live, Google "next phase"), per-row Onboard CTA, OnboardAgentModal (3-step), Identity tab, AgentMailboxPage, AgentCalendarPage, Suspend / Revoke dialogs.
- CI gate: pipeline-only outbound (no `adapter.sendEmail` outside the pipeline).

Reference: spec §1, §3, §7, §8, §9.1–9.4, §10.6, §13–14, §15 Phase B.

## Test plan
- [x] lint + typecheck + build:client clean
- [x] tsx pure tests (pipeline / identity service) exit 0
- [x] verify-pipeline-only-outbound exit 0
- [x] Manual UAT mockups 01 / 03–07 / 09–13 against native backend
- [x] End-to-end: onboard → send → toggle off (fail) → toggle on → suspend → resume → revoke

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Run pr-reviewer agent on Phase B PR**

Mandatory before merge per CLAUDE.md.

---

## Phase C — Google Workspace adapter

**Goal:** Implement `googleWorkspaceAdapter` against Admin SDK + Gmail + Calendar APIs via service-account + domain-wide delegation. Complete the contract test suite so both adapters run identical scenarios. Wire the Google card on the Workspace tab from "coming next phase" to fully functional. After Phase C, the same UI flows from Phase B work transparently against either backend.

**Spec sections:** §1 (two backends ship at launch), §7 (adapter contract), §8 (pipeline — Google specifics), §9 (Google operations), §10.4 (provider-permission boundary), §15 Phase C.

**Phase C exit checklist:**
1. `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
2. `npx tsx server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts` exits 0 — same scenario file passes against `nativeWorkspaceAdapter` and `googleWorkspaceAdapter` (Google in mock mode).
3. Manual UAT against a real Google Workspace dev tenant: configure backend → onboard agent → real email lands in real Gmail → outbound send shows in `Sent`.
4. `failure(workspace_provider_acl_denied, ...)` surfaces correctly when the service-account has insufficient delegation.

---

### Task C1: `googleWorkspaceAdapter` — identity provisioning + lifecycle

**Files:**
- Create: `server/adapters/workspace/googleWorkspaceAdapter.ts`
- Modify: `server/lib/env.ts` + `.env.example`

**Spec references:** §7 (adapter contract — Google produces `externalUserId`), §9.1 (Google branch of onboarding).

- [ ] **Step 1: Add Google service-account env vars**

Append to `.env.example`:

```
# Google Workspace
GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON=     # path to JSON, or inline JSON
GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER=     # admin email used for domain-wide delegation
```

Validate in `server/lib/env.ts`.

- [ ] **Step 2: Add Google API SDK dependency**

```bash
npm install googleapis
```

- [ ] **Step 3: Implement provisioning + lifecycle methods**

```typescript
// server/adapters/workspace/googleWorkspaceAdapter.ts
import { google } from 'googleapis';
import type { WorkspaceAdapter, ProvisionParams, ProvisionResult, SendEmailParams, SendEmailResult, InboundMessage, CreateEventParams, CreateEventResult, CalendarEvent } from './workspaceAdapterContract';
import { withOrgTx, withAdminConnection } from '../../instrumentation';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities';
import { workspaceMessages } from '../../db/schema/workspaceMessages';
import { workspaceCalendarEvents } from '../../db/schema/workspaceCalendarEvents';
import { eq } from 'drizzle-orm';
import { withBackoff } from '../../lib/withBackoff';
import { failure } from '../../../shared/iee/failure';

function adminClient(delegatedUser: string) {
  const credentials = JSON.parse(
    process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON!.startsWith('{')
      ? process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON!
      : require('node:fs').readFileSync(process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON!, 'utf8')
  );
  const jwt = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/admin.directory.user',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive', // granted at account level, not exercised in v1
    ],
    subject: delegatedUser,
  });
  return jwt;
}

export const googleWorkspaceAdapter: WorkspaceAdapter = {
  backend: 'google_workspace',

  async provisionIdentity(params: ProvisionParams): Promise<ProvisionResult> {
    const auth = adminClient(process.env.GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER!);
    const admin = google.admin({ version: 'directory_v1', auth });
    const domain = await getDomainForConnectorConfig(params.connectorConfigId);
    const primaryEmail = `${params.emailLocalPart}@${domain}`;
    const password = generateRandomPassword();
    return withBackoff(async () => {
      try {
        const { data: user } = await admin.users.insert({
          requestBody: {
            primaryEmail,
            name: { givenName: params.displayName.split(' ')[0] ?? params.displayName, familyName: params.displayName.split(' ').slice(1).join(' ') || params.displayName },
            password,
            changePasswordAtNextLogin: false,
          },
        });
        // Post-provision verify: confirm the user exists and email matches before writing our DB row.
        // Google Admin SDK can return success while the user is not yet readable (eventual consistency).
        // withBackoff retries on 404 so transient propagation delays are handled automatically.
        const { data: verified } = await withBackoff(() => admin.users.get({ userKey: primaryEmail }));
        if (!verified || verified.primaryEmail !== primaryEmail) {
          throw new Error(`workspace_provision_verify_failed: Google user ${primaryEmail} not readable after insert`);
        }
        return await withOrgTx(params.organisationId, async (db) => {
          const [row] = await db.insert(workspaceIdentities).values({
            organisationId: params.organisationId,
            subaccountId: params.subaccountId,
            actorId: params.actorId,
            connectorConfigId: params.connectorConfigId,
            backend: 'google_workspace',
            emailAddress: primaryEmail,
            emailSendingEnabled: params.emailSendingEnabled,
            externalUserId: user.id ?? null,
            displayName: params.displayName,
            photoUrl: params.photoUrl ?? null,
            status: 'provisioned',
            provisioningRequestId: params.provisioningRequestId,
            metadata: { signature: params.signature, googleUserId: user.id },
          }).onConflictDoNothing({ target: workspaceIdentities.provisioningRequestId }).returning();
          if (!row) {
            const [existing] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.provisioningRequestId, params.provisioningRequestId));
            return { identityId: existing.id, emailAddress: existing.emailAddress, externalUserId: existing.externalUserId };
          }
          return { identityId: row.id, emailAddress: row.emailAddress, externalUserId: row.externalUserId };
        });
      } catch (err: any) {
        if (err?.code === 409 || err?.errors?.[0]?.reason === 'duplicate') {
          throw failure('workspace_idempotency_collision', { reason: 'Google user already exists' });
        }
        if (err?.code === 403) {
          throw failure('workspace_provider_acl_denied', { reason: 'Service account lacks delegation' });
        }
        throw err;
      }
    });
  },

  async suspendIdentity(identityId: string): Promise<void> {
    const auth = adminClient(process.env.GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER!);
    const admin = google.admin({ version: 'directory_v1', auth });
    const externalUserId = await getExternalUserId(identityId);
    await withBackoff(() => admin.users.update({ userKey: externalUserId, requestBody: { suspended: true } }));
  },

  async resumeIdentity(identityId: string): Promise<void> {
    const auth = adminClient(process.env.GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER!);
    const admin = google.admin({ version: 'directory_v1', auth });
    const externalUserId = await getExternalUserId(identityId);
    await withBackoff(() => admin.users.update({ userKey: externalUserId, requestBody: { suspended: false } }));
  },

  async revokeIdentity(identityId: string): Promise<void> {
    // Default: suspend-not-delete (per spec §9.4).
    await googleWorkspaceAdapter.suspendIdentity(identityId);
  },

  async archiveIdentity(_identityId: string): Promise<void> {
    // No external action — local archive only.
  },

  // sendEmail / fetchInboundSince / createEvent / respondToEvent / fetchUpcoming — Tasks C2, C3.
  ...stubsForC2C3,
};

async function getExternalUserId(identityId: string): Promise<string> {
  return withAdminConnection(async (db) => {
    const [row] = await db.select({ externalUserId: workspaceIdentities.externalUserId }).from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
    if (!row?.externalUserId) throw new Error(`Identity ${identityId} has no externalUserId`);
    return row.externalUserId;
  });
}

async function getDomainForConnectorConfig(connectorConfigId: string): Promise<string> {
  // Reads connector_configs.config_json.domain. Implementation per the existing connector-config service.
  return withAdminConnection(async (db) => {
    const { connectorConfigs } = await import('../../db/schema/connectorConfigs');
    const [row] = await db.select().from(connectorConfigs).where(eq(connectorConfigs.id, connectorConfigId));
    return (row?.configJson as { domain?: string })?.domain ?? 'example.com';
  });
}

function generateRandomPassword(): string {
  return require('node:crypto').randomBytes(24).toString('base64');
}
```

(`...stubsForC2C3` — placeholder. C2 and C3 fill in the real implementations; for now stub with `async () => { throw new Error('not implemented'); }` so this task lints + typechecks.)

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/adapters/workspace/googleWorkspaceAdapter.ts server/lib/env.ts .env.example package.json package-lock.json
git commit -m "feat(workspace): googleWorkspaceAdapter — provisioning + lifecycle"
```

---

### Task C2: Google adapter — Gmail send + fetch

**Files:**
- Modify: `server/adapters/workspace/googleWorkspaceAdapter.ts`

**Spec references:** §7 (sendEmail, fetchInboundSince), §8.2 (push/watch optional).

- [ ] **Step 1: Implement `sendEmail`**

```typescript
async sendEmail(params: SendEmailParams): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }> {
  return withAdminConnection(async (db) => {
    const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, params.fromIdentityId));
    if (!identity) throw new Error(`Identity ${params.fromIdentityId} not found`);
    const auth = adminClient(identity.emailAddress); // act as the agent itself
    const gmail = google.gmail({ version: 'v1', auth });

    // Build RFC 822 message
    const lines = [
      `From: ${identity.displayName} <${identity.emailAddress}>`,
      `To: ${params.toAddresses.join(', ')}`,
      ...(params.ccAddresses?.length ? [`Cc: ${params.ccAddresses.join(', ')}`] : []),
      `Subject: ${params.subject}`,
      ...(params.inReplyToExternalId ? [`In-Reply-To: ${params.inReplyToExternalId}`, `References: ${params.inReplyToExternalId}`] : []),
      'Content-Type: text/plain; charset=UTF-8',
      '',
      params.bodyText,
    ].join('\r\n');
    const raw = Buffer.from(lines).toString('base64url');

    const result = await withBackoff(() => gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: params.threadId } }));

    // Return provider result — pipeline owns the canonical workspace_messages write
    return { externalMessageId: result.data.id ?? null, metadata: { gmail_thread_id: result.data.threadId } };
  });
}
```

- [ ] **Step 2: Implement `fetchInboundSince`**

```typescript
async fetchInboundSince(identityId: string, since: Date): Promise<InboundMessage[]> {
  return withAdminConnection(async (db) => {
    const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
    if (!identity) throw new Error(`Identity ${identityId} not found`);
    const auth = adminClient(identity.emailAddress);
    const gmail = google.gmail({ version: 'v1', auth });

    const q = `after:${Math.floor(since.getTime() / 1000)} -in:sent`;
    const list = await withBackoff(() => gmail.users.messages.list({ userId: 'me', q, maxResults: 50 }));
    if (!list.data.messages) return [];

    const messages: InboundMessage[] = [];
    for (const m of list.data.messages) {
      const detail = await withBackoff(() => gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' }));
      const headers = detail.data.payload?.headers ?? [];
      const h = (k: string) => headers.find((x) => x.name?.toLowerCase() === k.toLowerCase())?.value ?? '';
      messages.push({
        externalMessageId: detail.data.id ?? null,
        fromAddress: h('From'),
        toAddresses: h('To').split(',').map((s) => s.trim()).filter(Boolean),
        ccAddresses: h('Cc') ? h('Cc').split(',').map((s) => s.trim()) : null,
        subject: h('Subject') || null,
        bodyText: extractBodyText(detail.data) ?? null,
        bodyHtml: extractBodyHtml(detail.data) ?? null,
        sentAt: new Date(parseInt(detail.data.internalDate ?? '0', 10)),
        receivedAt: new Date(),
        inReplyToExternalId: h('In-Reply-To') || null,
        referencesExternalIds: h('References').split(/\s+/).filter(Boolean),
        attachmentsCount: countAttachments(detail.data),
        rawProviderId: detail.data.id ?? '',
      });
    }
    return messages;
  });
}

function extractBodyText(msg: any): string | null { /* walk msg.payload.parts; return text/plain part decoded */ }
function extractBodyHtml(msg: any): string | null { /* same for text/html */ }
function countAttachments(msg: any): number { /* count parts with filename */ }
```

- [ ] **Step 3: Periodic poll job**

Add a pg-boss job `gmail.inbound.poll` running every 5 min per active Google identity. The job calls `adapter.fetchInboundSince(identityId, lastPolledAt)` and pushes each message through `workspaceEmailPipeline.ingest`. State (`lastPolledAt`) lives on `workspace_identities.metadata.lastPolledAt`.

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/adapters/workspace/googleWorkspaceAdapter.ts server/jobs/gmailInboundPoll.ts
git commit -m "feat(workspace): Google adapter — Gmail send + inbound poll"
```

---

### Task C3: Google adapter — Calendar create + respond + fetch

**Files:**
- Modify: `server/adapters/workspace/googleWorkspaceAdapter.ts`

**Spec references:** §7 (createEvent / respondToEvent / fetchUpcoming), §8.3 (Google calendar sync).

- [ ] **Step 1: Implement the three methods**

```typescript
async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
  return withAdminConnection(async (db) => {
    const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, params.fromIdentityId));
    const auth = adminClient(identity.emailAddress);
    const cal = google.calendar({ version: 'v3', auth });
    const evt = await withBackoff(() => cal.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      requestBody: {
        summary: params.title,
        start: { dateTime: params.startsAt.toISOString() },
        end: { dateTime: params.endsAt.toISOString() },
        attendees: params.attendeeEmails.map((email) => ({ email })),
      },
    }));
    const [row] = await db.insert(workspaceCalendarEvents).values({
      organisationId: identity.organisationId,
      subaccountId: identity.subaccountId,
      identityId: identity.id,
      actorId: identity.actorId,
      externalEventId: evt.data.id ?? null,
      organiserEmail: identity.emailAddress,
      title: params.title,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      attendeeEmails: params.attendeeEmails,
      responseStatus: 'accepted',
    }).returning();
    return { eventId: row.id, externalEventId: evt.data.id ?? null };
  });
}

async respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void> {
  await withAdminConnection(async (db) => {
    const [evt] = await db.select().from(workspaceCalendarEvents).where(eq(workspaceCalendarEvents.id, eventId));
    const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, evt.identityId));
    const auth = adminClient(identity.emailAddress);
    const cal = google.calendar({ version: 'v3', auth });
    if (!evt.externalEventId) throw new Error('Event has no externalEventId');
    await withBackoff(() => cal.events.patch({
      calendarId: 'primary',
      eventId: evt.externalEventId!,
      sendUpdates: 'all',
      requestBody: { attendees: [{ email: identity.emailAddress, responseStatus: response }] },
    }));
    await db.update(workspaceCalendarEvents).set({ responseStatus: response, updatedAt: new Date() }).where(eq(workspaceCalendarEvents.id, eventId));
  });
}

async fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]> {
  return withAdminConnection(async (db) => {
    const [identity] = await db.select().from(workspaceIdentities).where(eq(workspaceIdentities.id, identityId));
    const auth = adminClient(identity.emailAddress);
    const cal = google.calendar({ version: 'v3', auth });
    const list = await withBackoff(() => cal.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      timeMax: until.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    }));
    return (list.data.items ?? []).map((evt) => ({
      externalEventId: evt.id ?? null,
      organiserEmail: evt.organizer?.email ?? identity.emailAddress,
      title: evt.summary ?? '(no title)',
      startsAt: new Date(evt.start?.dateTime ?? evt.start?.date ?? Date.now()),
      endsAt: new Date(evt.end?.dateTime ?? evt.end?.date ?? Date.now()),
      attendeeEmails: (evt.attendees ?? []).map((a) => a.email!).filter(Boolean),
      responseStatus: (evt.attendees?.find((a) => a.email === identity.emailAddress)?.responseStatus ?? 'needs_action') as any,
    }));
  });
}
```

- [ ] **Step 2: Periodic calendar sync job**

Add a pg-boss job `calendar.sync` running every 5 min per active Google identity. Calls `fetchUpcoming` and upserts into `workspace_calendar_events` keyed on `(identity_id, external_event_id)` via the partial unique index.

- [ ] **Step 3: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/adapters/workspace/googleWorkspaceAdapter.ts server/jobs/calendarSync.ts
git commit -m "feat(workspace): Google adapter — calendar create / respond / fetch"
```

---

### Task C4: Adapter contract test suite — `canonicalAdapterContract.test.ts`

**Files:**
- Create: `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts`
- Create: `server/adapters/workspace/__tests__/mockGoogleApi.ts` (in-memory mock)

**Spec reference:** §20 (testing posture — adapter contract suite is the contract).

- [ ] **Step 1: Build the in-memory Google mock**

`mockGoogleApi.ts` exposes `mockGoogleAdapter` — same interface as `googleWorkspaceAdapter` but backed by Maps instead of Google API calls. Behaviour mirrors Google: provisioning is idempotent on `provisioningRequestId`; suspending sets a flag; sending writes to a "sent" map and to canonical tables; inbound fetch returns scripted messages.

- [ ] **Step 2: Write the test scenarios**

```typescript
import { strict as assert } from 'node:assert';
import { nativeWorkspaceAdapter } from '../nativeWorkspaceAdapter';
import { mockGoogleAdapter } from './mockGoogleApi';
import type { WorkspaceAdapter } from '../workspaceAdapterContract';

const adapters: Array<[string, WorkspaceAdapter]> = [
  ['native', nativeWorkspaceAdapter],
  ['google_mock', mockGoogleAdapter],
];

for (const [name, adapter] of adapters) {
  console.log(`-- ${name} --`);

  // Scenario: provision is idempotent on provisioningRequestId
  const a = await adapter.provisionIdentity({ ..., provisioningRequestId: 'req-1' });
  const b = await adapter.provisionIdentity({ ..., provisioningRequestId: 'req-1' });
  assert.equal(a.identityId, b.identityId, `${name}: idempotent provision`);

  // Scenario: send produces a canonical workspace_messages row
  const sent = await adapter.sendEmail({ fromIdentityId: a.identityId, toAddresses: ['x@y.com'], subject: 's', bodyText: 'hi', policyContext: {} });
  assert.ok(sent.messageId, `${name}: send returns messageId`);

  // Scenario: createEvent + respond round trip
  const evt = await adapter.createEvent({ fromIdentityId: a.identityId, title: 't', startsAt: new Date(), endsAt: new Date(Date.now() + 3600000), attendeeEmails: ['x@y.com'] });
  await adapter.respondToEvent(evt.eventId, 'accepted');

  // Scenario: suspend then resume idempotent
  await adapter.suspendIdentity(a.identityId);
  await adapter.suspendIdentity(a.identityId); // no-op second time
  await adapter.resumeIdentity(a.identityId);

  console.log(`-- ${name} OK --`);
}

console.log('canonicalAdapterContract.test: OK');
```

- [ ] **Step 3: Run**

```bash
npx tsx server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
```

Expected: both adapters pass the same scenarios, exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts server/adapters/workspace/__tests__/mockGoogleApi.ts
git commit -m "feat(workspace): adapter contract test suite — both adapters pass identical scenarios"
```

---

### Task C5: Workspace tab — Google card live + OAuth/service-account UI

**Files:**
- Modify: `client/src/components/workspace/WorkspaceTabContent.tsx`

**Spec reference:** mockup 02.

- [ ] **Step 1: Read mockup 02**

```bash
cat prototypes/agent-as-employee/02-workspace-setup-google.html
```

- [ ] **Step 2: Enable the Google card**

Remove the "coming next phase" disabled state. Wire selection → calls `configureWorkspace(saId, { backend: 'google_workspace', connectorConfigId })`. The `connectorConfigId` comes from the org-level integrations connection (existing pattern — `grep -n "integrationConnections" server/services/`).

The configure flow includes:

- A "Connect Google Workspace" button that opens the existing OAuth flow (use the same OAuth pattern other integrations use — service-account JSON upload OR OAuth consent + admin delegation).
- After connection, a domain-verification step that confirms the service-account can reach `users.list` on the customer's domain.
- On success, the card shows "Connected" + the verified domain.

- [ ] **Step 3: build:client + commit**

```bash
npm run build:client
git add client/src/components/workspace/WorkspaceTabContent.tsx
git commit -m "feat(workspace): enable Google Workspace card on Workspace tab"
```

---

### Task C6: Phase C close-out

- [ ] **Step 1: Run all Phase C exit checks**

```bash
npm run lint
npx tsc --noEmit
npm run build:client
npx tsx server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
```

- [ ] **Step 2: Manual UAT against a real Google Workspace dev tenant**

1. Set up a Google Workspace dev tenant (Google offers a 14-day trial domain).
2. Create a service account, grant domain-wide delegation, set scopes per spec §8.
3. Configure subaccount → Google Workspace card → connect.
4. Onboard "Sarah" → confirm Google Admin SDK creates `sarah@<dev-domain>`.
5. From an external email client, send `sarah@<dev-domain>` an email → confirm it lands in `workspace_messages` within 5 min (poll job).
6. Send outbound from the agent mailbox UI → confirm the email shows up in Gmail's Sent folder.
7. Suspend → confirm Google Admin shows the user as suspended.
8. Re-onboarding the same agent (idempotent) → returns the existing identity, no Google duplicate.

Update `tasks/builds/agent-as-employee/progress.md` with any deviations.

- [ ] **Step 3: Update Google portion of operations runbook**

Open `docs/agent-as-employee-runbook.md` and append the Google Workspace setup section (service-account creation, delegation, scopes, env vars).

- [ ] **Step 4: Open Phase C PR + run pr-reviewer**

```bash
git push origin feat/agents-are-employees
gh pr create --title "Agent-as-employee: Phase C — Google Workspace adapter" --base main --body "$(cat <<'EOF'
## Summary

- googleWorkspaceAdapter — provisioning, lifecycle, Gmail send, inbound poll, calendar create/respond/fetch via Admin SDK + Gmail + Calendar APIs.
- Domain-wide delegation via service-account JWT.
- Adapter contract test suite — same scenarios pass against native and Google (mock).
- Workspace tab Google card live; OAuth + service-account configuration flow.
- pg-boss jobs: gmail.inbound.poll (5min/identity), calendar.sync (5min/identity).
- Operations runbook updated with Google setup.

Reference: spec §1, §7, §8 (Google specifics), §9, §10.4, §15 Phase C.

## Test plan
- [x] lint + typecheck + build:client clean
- [x] tsx canonicalAdapterContract.test.ts exits 0 (both adapters)
- [x] Real Google Workspace dev-tenant UAT: provision → send → receive → suspend → idempotent re-onboard

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Run `pr-reviewer` agent on the PR before merge.

---

## Phase D — Org chart + Activity wiring + seats

**Goal:** Render humans + agents on a single `OrgChartPage` driven by `workspace_actors.parent_actor_id`. Extend `ActivityPage` with the actor filter + new event types and merge `audit_events` rows into the activity feed. Add the per-agent Activity tab. Wire the seat-rollup job to call `deriveSeatConsumption` over `workspace_identities`. Un-redirect the subaccount-scoped Activity SPA route.

**Spec sections:** §3 (mockups 08, 14, 15), §4 (extend `OrgChartPage`, `activityService`), §5 (modified routes / pages), §10.6 (seat rollup), §12 (`ActivityFeedItem` ordering).

**Phase D exit checklist:**
1. `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
2. Org chart shows humans + agents on one canvas with reporting lines via `parent_actor_id`.
3. Subaccount-scoped Activity SPA route resolves (no longer redirects).
4. Activity page exposes the actor filter; selecting an agent narrows results.
5. Identity-lifecycle events (`identity.activated`, `identity.suspended`, `email.sent`, etc.) appear in the feed for the matching agent.
6. Seat-rollup job writes the active count to `org_subscriptions.consumed_seats`, matches the inline `SeatsPanel` count.

---

### Task D1: Extend `ActivityType` union + `audit_events` action namespace

**Files:**
- Modify: `shared/types/activityType.ts`

**Spec reference:** §2 (subaccount-wide Activity page extension), §4 (extended types), §14.4 (terminal events list).

- [ ] **Step 1: Add new event types**

Append to the union:

```typescript
export type ActivityType =
  // existing 6
  | 'agent_run' | 'review_item' | 'health_finding' | 'inbox_item' | 'workflow_run' | 'workflow_execution'
  // new workspace types
  | 'email.sent'
  | 'email.received'
  | 'calendar.event_created'
  | 'calendar.event_accepted'
  | 'calendar.event_declined'
  | 'identity.provisioned'
  | 'identity.activated'
  | 'identity.suspended'
  | 'identity.resumed'
  | 'identity.revoked'
  | 'identity.archived'
  | 'identity.email_sending_enabled'
  | 'identity.email_sending_disabled'
  | 'identity.migrated'
  | 'identity.migration_failed'
  | 'identity.provisioning_failed'
  | 'actor.onboarded'
  | 'subaccount.migration_completed';
```

(Match the existing dot-namespace style; `audit_events.action` strings are the same as these enum values.)

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add shared/types/activityType.ts
git commit -m "feat(workspace): extend ActivityType union with workspace event types"
```

---

### Task D2: Extend `activityService` — merge `audit_events` rows + `actorId` filter

**Files:**
- Modify: `server/services/activityService.ts`

**Spec reference:** §4 (`activityService.listActivityItems` extension), §12 (`ActivityFeedItem` ordering — `created_at DESC`, `id ASC`, cursor-based).

- [ ] **Step 1: Inspect current shape**

```bash
sed -n '1,80p' server/services/activityService.ts
grep -n "ActivityType\|listActivityItems" server/services/activityService.ts
```

- [ ] **Step 2: Add a query branch for `audit_events`**

The existing service aggregates 6 source tables. Add a 7th query reading from `audit_events` filtered to `action IN (<new event types>)`. Each row maps to `{ type: ev.action, actorId: ev.workspaceActorId, createdAt: ev.createdAt, metadata: ev.metadata, ... }`. Honour the new `actorId` filter param at the SQL `WHERE` clause.

- [ ] **Step 3: Honour `actorId` in `listActivityItems` signature**

```typescript
export async function listActivityItems(opts: {
  scope: 'subaccount' | 'org' | 'system';
  subaccountId?: string;
  orgId: string;
  cursor?: { createdAt: string; id: string };
  limit?: number;
  types?: ActivityType[];
  actorId?: string;        // new — covers humans + agents
  agentId?: string;        // existing — back-compat
}): Promise<ActivityFeedItem[]>
```

If both `actorId` and `agentId` are provided, treat them as equivalent for agent rows. Document the precedence (prefer `actorId`).

- [ ] **Step 4: Cursor pagination per spec §12**

Replace any offset-based pagination with cursor-based: `WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id ASC LIMIT ?`.

- [ ] **Step 5: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/services/activityService.ts
git commit -m "feat(workspace): activityService extension — audit_events branch + actorId filter + cursor pagination"
```

---

### Task D3: Extend `activity.ts` route — `actorId` query param + un-redirect SPA route

**Files:**
- Modify: `server/routes/activity.ts`
- Modify: `client/src/App.tsx`

**Spec reference:** §5 (routes modified — `actorId` query parser), §2 (un-redirect `/admin/subaccounts/:saId/activity`).

- [ ] **Step 1: Add `actorId` to the route's filter parser**

```bash
grep -n "agentId\|parseFilters" server/routes/activity.ts
```

Add `actorId` to the parsed filter shape. Pass through to `activityService.listActivityItems`.

- [ ] **Step 2: Un-redirect the subaccount-scoped activity SPA route**

Open `client/src/App.tsx`, find the existing `<Redirect>` (or React Router v6 `<Navigate>`) for `/admin/subaccounts/:subaccountId/activity` and replace with a `<Route ... element={<ActivityPage scope="subaccount" />} />` (or however the existing scope prop is shaped).

- [ ] **Step 3: Lint + typecheck + build:client + commit**

```bash
npm run lint
npx tsc --noEmit
npm run build:client
git add server/routes/activity.ts client/src/App.tsx
git commit -m "feat(workspace): activity route actorId filter + un-redirect subaccount SPA route"
```

---

### Task D4: Shared `<ActivityFeedTable>` primitive

**Files:**
- Create: `client/src/components/activity/ActivityFeedTable.tsx`

**Spec reference:** §4 (new primitive), §12 (item ordering).

- [ ] **Step 1: Build the component**

```typescript
interface ActivityFeedTableProps {
  items: ActivityFeedItem[];
  loading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}
```

Renders a tabular list: time, type badge, actor (name + kind), summary text. No chart, no chrome — just the table per spec frontend rule 4 (inline state beats dashboards). Used by both `ActivityPage` and `AgentActivityTab`.

- [ ] **Step 2: build:client + commit**

```bash
npm run build:client
git add client/src/components/activity/ActivityFeedTable.tsx
git commit -m "feat(workspace): ActivityFeedTable shared primitive"
```

---

### Task D5: Refactor `ActivityPage` to use `<ActivityFeedTable>` + actor filter UI

**Files:**
- Modify: `client/src/pages/ActivityPage.tsx`

**Spec reference:** §3 mockup 14, §4 (modified pages).

- [ ] **Step 1: Read mockup 14**

```bash
cat prototypes/agent-as-employee/14-subaccount-activity.html
```

- [ ] **Step 2: Add actor filter dropdown**

Above the table: a dropdown listing every actor in scope (humans + agents from `workspace_actors`). Selecting one passes `actorId=<id>` to the API call. Default option: "All actors".

- [ ] **Step 3: Add new event types to the type filter**

The existing type filter already supports the 6 base types. Add the new workspace types (group them under a "Workspace" header in the dropdown).

- [ ] **Step 4: Replace the existing row renderer with `<ActivityFeedTable>`**

The table primitive owns row rendering; the page owns header + filters + load-more.

- [ ] **Step 5: build:client + commit**

```bash
npm run build:client
git add client/src/pages/ActivityPage.tsx
git commit -m "feat(workspace): ActivityPage — actor filter + new event types + ActivityFeedTable"
```

---

### Task D6: `AgentActivityTab` — focused inline view inside `SubaccountAgentEditPage`

**Files:**
- Create: `client/src/components/agent/AgentActivityTab.tsx`
- Modify: `client/src/pages/SubaccountAgentEditPage.tsx`

**Spec reference:** §3 mockup 15, §2 (focused inline view, NOT reusing `ActivityPage`), Q-§3.

- [ ] **Step 1: Read mockup 15**

```bash
cat prototypes/agent-as-employee/15-agent-activity-tab.html
```

- [ ] **Step 2: Build `AgentActivityTab`**

```typescript
interface AgentActivityTabProps {
  agentId: string;
  actorId: string;
  subaccountId: string;
}
```

Component:

- Calls `getActivity(subaccountId, { actorId, scope: 'subaccount' })` — same backend endpoint, `actorId` locked.
- Renders via `<ActivityFeedTable items={...} />`.
- No filter chrome at all — this is the focused inline view per spec.

Crucially: **does NOT import `ActivityPage`**. Only shares `<ActivityFeedTable>` and the API client.

- [ ] **Step 3: Add `'activity'` tab to `SubaccountAgentEditPage`**

Find the Tab union, add `'activity'`. Render `<AgentActivityTab agentId={...} actorId={agent.workspaceActorId} subaccountId={...} />`.

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/components/agent/AgentActivityTab.tsx client/src/pages/SubaccountAgentEditPage.tsx
git commit -m "feat(workspace): AgentActivityTab — focused inline view (mockup 15)"
```

---

### Task D7: Extend `OrgChartPage` — humans + agents on one canvas

**Files:**
- Modify: `client/src/pages/OrgChartPage.tsx`

**Spec reference:** §3 mockup 08, §2 (org chart with humans + agents joined via `workspace_actors`), §1 (org chart is representational only — no permission semantics).

- [ ] **Step 1: Read mockup 08**

```bash
cat prototypes/agent-as-employee/08-org-chart.html
```

- [ ] **Step 2: Inspect current data fetch**

```bash
grep -n "subaccountAgents\|parentSubaccount\|fetch" client/src/pages/OrgChartPage.tsx | head -10
```

- [ ] **Step 3: Replace data source**

Add a backend endpoint or extend the existing org-chart endpoint to return `workspace_actors` rows joined to `agents` and `users`. Each node:

```typescript
interface OrgChartNode {
  actorId: string;
  actorKind: 'agent' | 'human';
  displayName: string;
  parentActorId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  // For agents: link to identity (lifecycle dot)
  identity?: { id: string; emailAddress: string; status: WorkspaceIdentityStatus; photoUrl: string | null };
  // For humans: link to user
  user?: { id: string; email: string };
}
```

Build the forest from `parentActorId` (root nodes have `parentActorId === null`). Use the existing layout algorithm — no algorithm change per spec §4.

Each card shows: photo / display name / role / lifecycle dot inline (per spec frontend rule 4). For Google identities, the photo is the Google profile photo; for native it's auto-generated deterministically from `displayName`.

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/pages/OrgChartPage.tsx server/routes/<orgchart-route>.ts
git commit -m "feat(workspace): org chart with humans + agents joined via workspace_actors"
```

---

### Task D8: Audit-event emission from pipelines + onboarding (verify wiring)

**Files:**
- Verify (no edit needed if Phase B + C wired correctly): `workspaceEmailPipeline`, `workspaceOnboardingService`, identity transitions in `workspace.ts` route.

**Spec reference:** §8.1 step (5), §8.2 step (5), §9.1 step (8), §14.4 (terminal events).

- [ ] **Step 1: Confirm `audit_events` rows are written for every terminal event**

Go through each terminal event in spec §14.4. For each one, find the call site in code and confirm an `audit_events` row is written with the canonical `action` string (matching the `ActivityType` union value).

- [ ] **Step 2: Manual verification**

Open dev DB after exercising the flows in Phase B / C UAT:

```bash
psql $DATABASE_URL -c "SELECT action, COUNT(*) FROM audit_events WHERE action LIKE 'identity.%' OR action LIKE 'email.%' OR action LIKE 'calendar.%' OR action LIKE 'actor.%' GROUP BY action;"
```

Expected: rows for every event you've triggered in UAT. If something is missing, locate the call site and add the audit insert.

- [ ] **Step 3: If any audit insert was missing — commit fix**

```bash
git add server/services/workspace/...
git commit -m "fix(workspace): emit audit_events for previously-missed terminal event"
```

---

### Task D9: Wire seat-rollup job to `deriveSeatConsumption`

**Files:**
- Modify: `server/jobs/seatRollupJob.ts` (or wherever the existing rollup lives)

**Spec reference:** §10.6 (rollup wiring + 1-hour eventual consistency).

- [ ] **Step 1: Find the rollup**

```bash
grep -rn "consumed_seats\|seat_rollup\|seatRollup" server/jobs/ server/services/ | head -10
```

- [ ] **Step 2: Add workspace identity contribution**

For each org, count `workspace_identities` where `status = 'active'` (use `countActiveIdentities` from `shared/billing/seatDerivation.ts`). Add to the existing seat tally. Write to `org_subscriptions.consumed_seats`.

If no rollup job exists yet, create one as `server/jobs/seatRollupJob.ts` that runs hourly via pg-boss.

- [ ] **Step 3: Verify rollup matches the inline `SeatsPanel`**

After Phase B/C UAT (some identities active, some suspended):

```bash
psql $DATABASE_URL -c "SELECT (SELECT COUNT(*) FROM workspace_identities WHERE status = 'active') AS live, consumed_seats AS rolled_up FROM org_subscriptions LIMIT 1;"
```

Run the rollup once manually (`tsx server/jobs/seatRollupJob.ts --run-once` or whatever the pattern is). Re-query — counts must match.

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/jobs/seatRollupJob.ts
git commit -m "feat(workspace): seat-rollup wiring through deriveSeatConsumption"
```

---

### Task D10: Phase D close-out

- [ ] **Step 1: Run all Phase D exit checks**

```bash
npm run lint
npx tsc --noEmit
npm run build:client
```

- [ ] **Step 2: Manual UAT walk-through (mockups 08, 14, 15)**

- Org chart: confirm both humans and agents render; reporting lines come from `parent_actor_id`; lifecycle dots show next to agent names.
- Subaccount Activity page: navigate to `/admin/subaccounts/<id>/activity` (no redirect); use the actor filter to narrow to one agent; confirm new event types appear.
- Agent Activity tab: click into an agent → Activity tab → confirm only that agent's events show, no scope chrome.
- SeatsPanel: trigger suspend → live count drops; trigger resume → live count rises.

- [ ] **Step 3: Open Phase D PR + run pr-reviewer**

```bash
git push origin feat/agents-are-employees
gh pr create --title "Agent-as-employee: Phase D — org chart + activity wiring + seats" --base main --body "$(cat <<'EOF'
## Summary

- OrgChartPage extended to render humans + agents from workspace_actors with parent_actor_id hierarchy.
- ActivityType union + activityService + activity.ts route extended with workspace event types and actorId filter.
- Subaccount-scoped Activity SPA route un-redirected.
- ActivityPage uses ActivityFeedTable; new actor filter dropdown.
- AgentActivityTab — focused inline view (NOT a copy of ActivityPage).
- Seat-rollup job wires through deriveSeatConsumption; matches inline SeatsPanel.

Reference: spec §3 (mockups 08, 14, 15), §4, §10.6, §12.

## Test plan
- [x] lint + typecheck + build:client clean
- [x] Manual UAT: org chart, subaccount Activity page, agent Activity tab, SeatsPanel rollup
- [x] Audit_events rows present for every terminal event in §14.4

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase E — Migration runbook

**Goal:** Implement per-subaccount migration from one workspace backend to another (in v1: native → Google). Per-identity loop, per-identity transaction, idempotent on `(migrationRequestId, actorId)`. Mixed-mode operation continues normally during partial migration. The Workspace tab gets the migration modal + partial-completion banner.

**Spec sections:** §9.3 (migration runbook), §12 (`MigrateSubaccountResponse`), §13 (execution model — async with pg-boss), §14.1 (idempotency), §14.4 (no-silent-partial-success), §15 Phase E.

**Phase E exit checklist:**
1. `npm run lint` + `npm run typecheck` + `npm run build:client` clean.
2. Adapter contract test suite extended with a "migrate" scenario passing for both native and google_mock.
3. Manual UAT: pre-Phase-E subaccount on native → "Migrate" → modal → progress → Google identities active, native archived, single `actor_id` linking both.
4. Manual UAT: simulate one identity failing → status `'partial'` returned → banner shows the per-actor reason + Retry CTA → retry only retries failed actors.
5. **Targeted tsx tests — migration safety (run before Phase E PR):**
   - `tsx` test: all four terminal per-identity audit event actions emitted in the right scenario — `identity.migrated` (full success), `identity.migration_failed` (provision fails), `identity.migration_activation_failed` (activation fails after provision), `identity.migration_archive_failed` (archive fails after activation).
   - `tsx` test: retry after partial completion — if activation already succeeded (`noOpDueToRace: true`) and archive failed, retrying the job completes with `identity.migrated` and does not double-activate or double-provision.
   - `tsx` test: rate-limit window boundary — two sends within a window saturate the cap; third send at exact window-reset timestamp succeeds (confirms DB-time anchoring, not app-time).

---

### Task E1: `workspaceMigrationService` — orchestration layer

**Files:**
- Create: `server/services/workspace/workspaceMigrationService.ts`

**Spec reference:** §9.3, §14.3 (subaccount advisory lock).

- [ ] **Step 1: Implement the start + worker functions**

```typescript
import { withOrgTx } from '../../instrumentation';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities';
import { workspaceActors } from '../../db/schema/workspaceActors';
import { connectorConfigs } from '../../db/schema/connectorConfigs';
import { auditEvents } from '../../db/schema/auditEvents';
import { eq, and, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { transition } from './workspaceIdentityService';
import { failure } from '../../../shared/iee/failure';
import type { WorkspaceAdapter } from '../../../shared/types/workspaceAdapterContract';
import { boss } from '../../jobs/boss';

export interface MigrateStartParams {
  organisationId: string;
  subaccountId: string;
  targetBackend: 'synthetos_native' | 'google_workspace';
  targetConnectorConfigId: string;
  migrationRequestId: string;
  initiatedByUserId: string;
}

export async function start(params: MigrateStartParams): Promise<{ migrationJobBatchId: string; total: number } | ReturnType<typeof failure>> {
  return withOrgTx(params.organisationId, async (db) => {
    // (1) Acquire advisory lock per spec §14.3
    const lockKey = hashSubaccountId(params.subaccountId);
    const [lockRow] = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) AS got`);
    if (!lockRow?.got) return failure('workspace_idempotency_collision', { reason: 'migration_already_in_progress' });

    // (2) Load identities to migrate, deterministic order
    const identities = await db.select().from(workspaceIdentities)
      .where(and(
        eq(workspaceIdentities.subaccountId, params.subaccountId),
        inArray(workspaceIdentities.status, ['active', 'suspended']),
      ))
      .orderBy(workspaceIdentities.actorId);

    // (3) Enqueue per-identity jobs
    const batchId = crypto.randomUUID();
    for (const identity of identities) {
      await boss.send('workspace.migrate-identity', {
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        actorId: identity.actorId,
        currentIdentityId: identity.id,
        targetBackend: params.targetBackend,
        targetConnectorConfigId: params.targetConnectorConfigId,
        migrationRequestId: params.migrationRequestId,
        migrationJobBatchId: batchId,
        initiatedByUserId: params.initiatedByUserId,
      });
    }

    return { migrationJobBatchId: batchId, total: identities.length };
  });
}

export interface MigrateIdentityJob {
  organisationId: string;
  subaccountId: string;
  actorId: string;
  currentIdentityId: string;
  targetBackend: 'synthetos_native' | 'google_workspace';
  targetConnectorConfigId: string;
  migrationRequestId: string;
  migrationJobBatchId: string;
  initiatedByUserId: string;
}

export async function processIdentityMigration(job: MigrateIdentityJob, deps: { adapter: WorkspaceAdapter }) {
  return withOrgTx(job.organisationId, async (db) => {
    // (a) Provision in target backend, keyed on (migrationRequestId, actorId)
    // Archive happens AFTER target is confirmed active — never archive before provisioning succeeds.
    const [actor] = await db.select().from(workspaceActors).where(eq(workspaceActors.id, job.actorId));
    const provisioningRequestId = `${job.migrationRequestId}:${job.actorId}`;
    let provisioned;
    try {
      provisioned = await deps.adapter.provisionIdentity({
        actorId: job.actorId,
        subaccountId: job.subaccountId,
        organisationId: job.organisationId,
        connectorConfigId: job.targetConnectorConfigId,
        emailLocalPart: deriveLocalPartFromActor(actor!),
        displayName: actor!.displayName,
        signature: '',
        emailSendingEnabled: true,
        provisioningRequestId,
      });
    } catch (err: any) {
      await db.insert(auditEvents).values({
        organisationId: job.organisationId,
        action: 'identity.migration_failed',
        entityType: 'workspace_identity',
        workspaceActorId: job.actorId,
        metadata: { from: job.currentIdentityId, reason: String(err?.message ?? err), batchId: job.migrationJobBatchId },
      });
      throw err;
    }

    // (b) Mark target active — emit terminal event if this step fails so the caller can see
    // "provisioned but not yet active" in the audit log without guessing.
    // Idempotency: transition() returns { noOpDueToRace: true } (not throws) if the identity is
    // already active — treat that as success and continue. The catch fires only on actual errors.
    try {
      await transition(job.organisationId, provisioned.identityId, 'activate', job.initiatedByUserId);
    } catch (err: any) {
      await db.insert(auditEvents).values({
        organisationId: job.organisationId,
        action: 'identity.migration_activation_failed',
        entityType: 'workspace_identity',
        workspaceActorId: job.actorId,
        metadata: { from: job.currentIdentityId, target: provisioned.identityId, reason: String(err?.message ?? err), batchId: job.migrationJobBatchId },
      });
      throw err;
    }

    // (c) Archive source — only after target is confirmed active; safe rollback point preserved until here.
    // Emit terminal event if archive fails so the caller can see "activated but source not yet archived".
    // Idempotency: transition() returns { noOpDueToRace: true } if already archived — success, continue.
    try {
      await transition(job.organisationId, job.currentIdentityId, 'archive', job.initiatedByUserId);
    } catch (err: any) {
      await db.insert(auditEvents).values({
        organisationId: job.organisationId,
        action: 'identity.migration_archive_failed',
        entityType: 'workspace_identity',
        workspaceActorId: job.actorId,
        metadata: { from: job.currentIdentityId, target: provisioned.identityId, reason: String(err?.message ?? err), batchId: job.migrationJobBatchId },
      });
      throw err;
    }

    // (d) Audit success
    await db.insert(auditEvents).values({
      organisationId: job.organisationId,
      action: 'identity.migrated',
      entityType: 'workspace_identity',
      workspaceActorId: job.actorId,
      metadata: { from: job.currentIdentityId, to: provisioned.identityId, batchId: job.migrationJobBatchId },
    });
  });
}

function hashSubaccountId(saId: string): bigint {
  // Use any deterministic hash → bigint for advisory_lock arg
  const hex = require('node:crypto').createHash('sha1').update(saId).digest('hex').slice(0, 12);
  return BigInt(`0x${hex}`);
}

function deriveLocalPartFromActor(actor: { displayName: string }): string {
  return actor.displayName.toLowerCase().split(/\s+/)[0];
}

// Used at onboarding + migration when the derived local-part collides with an existing address.
// Strategy: append a numeric suffix until the address is available. Callers (onboardingService,
// migrationService) must check `workspace_identities_email_per_config_uniq` before inserting and
// invoke this to resolve conflicts rather than hard-failing.
//
// Example: "sarah" taken → try "sarah2", "sarah3", … up to suffix 99 then throw.
async function resolveConflictFreeLocalPart(
  base: string,
  domain: string,
  connectorConfigId: string,
  db: Db,
): Promise<string> {
  const { workspaceIdentities } = await import('../../db/schema/workspaceIdentities');
  const check = async (local: string) => {
    const [row] = await db.select({ id: workspaceIdentities.id })
      .from(workspaceIdentities)
      .where(and(
        eq(workspaceIdentities.connectorConfigId, connectorConfigId),
        eq(workspaceIdentities.emailAddress, `${local}@${domain}`),
      ));
    return !row; // true = address is free
  };
  if (await check(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}${i}`;
    if (await check(candidate)) return candidate;
  }
  throw new Error(`email_conflict_unresolvable: no free address for base "${base}" on domain "${domain}"`);
}
```

- [ ] **Step 2: Register pg-boss handler**

In `server/jobs/index.ts` (or wherever pg-boss handlers are registered), add:

```typescript
boss.work('workspace.migrate-identity', async (job) => {
  const adapter = await resolveAdapter(job.data.targetBackend);
  await processIdentityMigration(job.data, { adapter });
});
```

- [ ] **Step 3: Subaccount.migration_completed terminal event**

When the last in-flight job for a `migrationJobBatchId` completes (hook into pg-boss `onComplete`), aggregate the `audit_events` rows for that batch and emit `subaccount.migration_completed` with `status` = `'success'` / `'partial'` / `'failed'` per spec §14.4.

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/services/workspace/workspaceMigrationService.ts server/jobs/index.ts
git commit -m "feat(workspace): workspaceMigrationService + per-identity pg-boss job"
```

---

### Task E2: Migrate route — `POST /api/subaccounts/:saId/workspace/migrate`

**Files:**
- Modify: `server/routes/workspace.ts`

**Spec references:** §9.3, §13 (async — returns 202 with batch id), §14.5 (advisory-lock collision → 409).

- [ ] **Step 1: Replace the Phase B stub**

The Phase B stub returned 501. Replace with:

```typescript
router.post('/api/subaccounts/:saId/workspace/migrate', authenticate, resolveSubaccount, requireSubaccountPermission('subaccounts:manage_workspace'), async (req, res) => {
  const { targetBackend, targetConnectorConfigId, migrationRequestId } = req.body;
  const result = await workspaceMigrationService.start({
    organisationId: req.org!.id,
    subaccountId: req.params.saId,
    targetBackend,
    targetConnectorConfigId,
    migrationRequestId,
    initiatedByUserId: req.user!.id,
  });
  if ('error' in result) {
    if (result.error === 'workspace_idempotency_collision') return res.status(409).json(result);
    return res.status(500).json(result);
  }
  res.status(202).json(result);
});
```

- [ ] **Step 2: Add a status-poll endpoint**

`GET /api/subaccounts/:saId/workspace/migrate/:batchId` — returns the per-batch state (running / success / partial / failed) by aggregating `audit_events` rows tagged with `metadata.batchId`. Used by the modal's progress polling.

- [ ] **Step 3: Lint + typecheck + commit**

```bash
npm run lint
npx tsc --noEmit
git add server/routes/workspace.ts
git commit -m "feat(workspace): migrate route + status-poll endpoint"
```

---

### Task E3: `MigrateWorkspaceModal` (mockup 16)

**Files:**
- Create: `client/src/components/workspace/MigrateWorkspaceModal.tsx`
- Modify: `client/src/components/workspace/WorkspaceTabContent.tsx` (wire the Migrate CTA)

**Spec reference:** §3 mockup 16, §9.3, §14.4 (no-silent-partial-success).

- [ ] **Step 1: Read mockup 16**

```bash
cat prototypes/agent-as-employee/16-migration-modal.html
```

- [ ] **Step 2: Build the modal**

States: `'select-target'` → `'confirm'` → `'migrating'` → `'success' | 'partial' | 'failed'`.

- `'select-target'`: dropdown for target backend (in v1 only Google Workspace is selectable from native; the inverse direction is allowed too). Connect to a configured `connectorConfigId` for the target.
- `'confirm'`: explanatory copy: "Migrating archives current identities and provisions new ones on {target backend}. The same actors keep their reporting lines, audit history, and seat. In-flight email is not interrupted." Primary: "Migrate".
- `'migrating'`: progress bar showing X / N completed. Polls the status endpoint every 2s.
- `'success'`: "All N identities migrated."
- `'partial'`: lists failed actors with reasons (from `MigrateSubaccountResponse.failures`). Primary: "Retry failed".
- `'failed'`: "No identities migrated. Retry?" with the underlying reason.

- [ ] **Step 3: Wire from `WorkspaceTabContent`**

Replace the Phase B "Migrate" stub button → opens the modal.

- [ ] **Step 4: build:client + commit**

```bash
npm run build:client
git add client/src/components/workspace/MigrateWorkspaceModal.tsx client/src/components/workspace/WorkspaceTabContent.tsx
git commit -m "feat(workspace): MigrateWorkspaceModal (mockup 16)"
```

---

### Task E4: Adapter contract test extension — migration scenario

**Files:**
- Modify: `server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts`

**Spec reference:** §15 Phase E (end-to-end "native → google" test).

- [ ] **Step 1: Add a migration scenario**

```typescript
// Extension of canonicalAdapterContract.test.ts
console.log('-- migration native -> google_mock --');

// Set up: provision actors on native, then migrate
const actorIds = ['actor-a', 'actor-b', 'actor-c'];
for (const aid of actorIds) {
  await nativeWorkspaceAdapter.provisionIdentity({ ..., actorId: aid, provisioningRequestId: `seed:${aid}` });
}

// Iterate per spec §9.3
const migrationRequestId = 'mig-req-1';
for (const aid of actorIds.slice().sort()) {
  const provisioningRequestId = `${migrationRequestId}:${aid}`;
  // (b) provision on target
  await mockGoogleAdapter.provisionIdentity({ ..., actorId: aid, provisioningRequestId });
}

// Retry safety: re-running with the same migrationRequestId is a no-op
for (const aid of actorIds) {
  const provisioningRequestId = `${migrationRequestId}:${aid}`;
  const r = await mockGoogleAdapter.provisionIdentity({ ..., actorId: aid, provisioningRequestId });
  // r.identityId must equal the previous provision result
}
console.log('-- migration scenario OK --');
```

- [ ] **Step 2: Add forced-failure scenarios — one per migration step**

Per spec §9.3 the migration loop has four observable steps per identity: (a) archive current, (b) provision target, (c) activate target, (d) audit. The mock Google adapter in `mockGoogleApi.ts` exposes a `failNextCall` hook keyed on the method name. Drive the failure scenario through `processIdentityMigration` from `workspaceMigrationService` (not the adapter directly) so we exercise the orchestration path, not just the adapter.

```typescript
import { processIdentityMigration } from '../../../services/workspace/workspaceMigrationService';

console.log('-- migration failure injection --');

// Scenario 1: archive fails (state-machine rejects double-archive).
//   Pre-condition: identity already 'archived'. Migration must skip (idempotent),
//   not throw. Outcome: identity.migration_failed audit row written, retry on the
//   same migrationRequestId is a no-op.
await markIdentityArchived(seededIdentityIds[0]);
let archiveResult = await tryProcess({ actorId: actorIds[0], step: 'expect-skip' });
assert.equal(archiveResult.status, 'skipped', 'archive of already-archived identity is a skip, not an error');

// Scenario 2: target provision fails.
//   Inject a quota error on mockGoogleAdapter.provisionIdentity for this actor.
//   Outcome: source identity remains 'archived' (or restored if migration policy
//   says so), target absent, identity.migration_failed audit row, batch status
//   eventually 'partial'.
mockGoogleAdapter.failNextCall('provisionIdentity', new Error('quota_exceeded'));
let provisionResult = await tryProcess({ actorId: actorIds[1], step: 'expect-failure' });
assert.equal(provisionResult.status, 'failed');
assert.match(provisionResult.reason, /quota/);

// Retry: same migrationRequestId, same actor. Adapter no longer fails.
// Provisioning idempotency key (migrationRequestId:actorId) MUST land on the same
// target identity row — no double-provisioning, no duplicate Google user.
mockGoogleAdapter.failNextCall(null);
let retryResult = await tryProcess({ actorId: actorIds[1], step: 'expect-success' });
assert.equal(retryResult.status, 'success');

// Scenario 3: activate fails AFTER target provisioned.
//   Outcome: target identity row exists in 'provisioned' state. Retry transitions
//   it to 'active' (workspaceIdentityServicePure allows provisioned → active).
//   Source remains archived. Final batch status: 'success' after retry.
mockGoogleAdapter.failNextCall('archiveIdentity', new Error('mid-flight'));
// (Activation in workspaceMigrationService.processIdentityMigration step (c) ↑)
let activateResult = await tryProcess({ actorId: actorIds[2], step: 'expect-failure' });
assert.equal(activateResult.status, 'failed');
let activateRetry = await tryProcess({ actorId: actorIds[2], step: 'expect-success' });
assert.equal(activateRetry.status, 'success');

// Scenario 4: audit insert fails.
//   This is a system-fault, not a per-identity fault. Test via direct DB
//   constraint violation (e.g. fail-once stub on the audit_events insert).
//   Outcome: surfaced as 500, batch status reflects the unhandled error,
//   retry on the same migrationRequestId is idempotent and lands cleanly.
//   (Implementation: temporarily swap the auditEvents insert with one that
//   throws on first call; restore after.)

console.log('-- failure injection scenarios OK --');
```

Each scenario asserts: (i) the right `audit_events.action` row is written, (ii) retry on the same `migrationRequestId` is idempotent (no double-provision, no duplicate Google user), (iii) the per-batch terminal event matches §14.4 status semantics (`success` / `partial` / `failed`).

Run:

```bash
npx tsx server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts server/adapters/workspace/__tests__/mockGoogleApi.ts
git commit -m "feat(workspace): adapter contract test — migration scenario + failure-injection per step"
```

---

### Task E5: Phase E close-out

- [ ] **Step 1: Run all Phase E exit checks**

```bash
npm run lint
npx tsc --noEmit
npm run build:client
npx tsx server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
```

- [ ] **Step 2: Manual UAT**

1. Configure subaccount on native → onboard 3 agents.
2. Click "Migrate" → select Google Workspace target → confirm.
3. Watch progress modal → confirm 3/3 on success, banner reads "All 3 identities migrated".
4. Inspect DB: native rows are `archived`; new Google rows are `active`; same `actor_id` links both per actor.
5. Org chart: agents continue to appear in the same hierarchy positions.
6. To test `partial` flow: in dev, configure one of the agents to fail (e.g. inject a Google quota error in the mock adapter for one actor) → run migration → confirm banner reads "X of Y migrated" with retry CTA.
7. Test idempotency: re-run the same `migrationRequestId` → no duplicate provisioning, identical result.

- [ ] **Step 3: Update the operations runbook**

Append to `docs/agent-as-employee-runbook.md`: a "Migration" section covering the request shape, the partial-completion semantics, and the recovery procedure.

- [ ] **Step 4: Open Phase E PR + run pr-reviewer**

```bash
git push origin feat/agents-are-employees
gh pr create --title "Agent-as-employee: Phase E — migration runbook" --base main --body "$(cat <<'EOF'
## Summary

- workspaceMigrationService — per-identity loop, per-identity transaction, advisory-lock against concurrent migrations.
- pg-boss workspace.migrate-identity job; idempotent on (migrationRequestId, actorId).
- subaccount.migration_completed terminal event with status='success'|'partial'|'failed' per spec §14.4.
- POST /workspace/migrate route returns 202 with batchId; GET status-poll endpoint.
- MigrateWorkspaceModal (mockup 16) with select-target → confirm → migrating → result/partial/failed states.
- Adapter contract test extended with migration scenario (idempotent retry).

Reference: spec §9.3, §12, §13, §14.1, §14.4, §15 Phase E.

## Test plan
- [x] lint + typecheck + build:client clean
- [x] Adapter contract migration scenario passes both adapters
- [x] Manual UAT: full migration native → Google
- [x] Manual UAT: partial-failure flow + retry idempotency

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Failure State Matrix

Authoritative reference for every failure mode this plan introduces. Centralises the contracts distributed across invariants, pipeline code, and migration code. Reviewers and on-call engineers use this as the single source of truth for triage.

| Operation | Failure | Retryable? | Signal emitted | Final DB state | Notes |
|---|---|---|---|---|---|
| `sendEmail` — sending disabled | `workspace_email_sending_disabled` | No (config change required) | None | Unchanged | 403 from route |
| `sendEmail` — policy denied | `workspace_provider_acl_denied` | No | None | Unchanged | 403 |
| `sendEmail` — rate limited | `workspace_email_rate_limited` | Yes (after window reset) | None | Unchanged | 429 with `windowResetAt` |
| `sendEmail` — adapter timeout | retryable | Yes (idempotency key deduplicates) | None on first timeout | Unchanged until retry succeeds | Provider idempotency key prevents duplicate delivery |
| `sendEmail` — adapter success, TX2 mirror fails | `workspace_mirror_write_failed` | Async (reaper) | `log.error` with `{ auditEventId, externalMessageId }` | `audit_events` row committed; `workspace_messages` row missing | HTTP 200 `{ sent: true, reconciling: true }` — never 5xx |
| `provisionIdentity` — adapter success, DB write fails | partial (logged) | Yes (`provisioningRequestId` idempotency) | `log.error` | `workspace_identities` row missing | On retry, adapter gets 409 from provider → idempotency path writes existing row |
| Migration — provision fails | `identity.migration_failed` | Yes (same `migrationRequestId`) | `audit_events: identity.migration_failed` | Source still active | Retry re-provisions cleanly |
| Migration — activation fails | `identity.migration_activation_failed` | Yes | `audit_events: identity.migration_activation_failed` | Target provisioned, not yet active; source still active | Retry: activation `noOpDueToRace` if already applied |
| Migration — archive fails | `identity.migration_archive_failed` | Yes | `audit_events: identity.migration_archive_failed` | Target active; source not yet archived | Retry: archive `noOpDueToRace` if already applied |
| Migration — full success | — | N/A | `audit_events: identity.migrated` | Target active; source archived | |
| Inbound dedup collision | deduplicated (silent) | N/A | `{ deduplicated: true }` in return | Existing row unchanged | 23505 caught; `dedupe_key` lookup returns existing `messageId` |
| Lifecycle transition — race | `noOpDueToRace: true` | N/A (already in target state) | None | Unchanged (observed state returned) | Not an error; first-commit-wins |

---

## Acceptance walkthrough

After every phase has merged, run this end-to-end against a fresh dev environment with both backends configured. Each item maps to a row in spec §16; tick it only after manual verification.

- [ ] An operator at a pilot agency can onboard an existing subaccount agent in 4 clicks (Agents tab row → "Onboard to workplace" → identity step → "Confirm & onboard"). Mockups 03 → 04 → 05 → 07.
- [ ] The agent's email and photo show on the org chart card after onboarding (mockup 08).
- [ ] Both humans and agents appear on the org chart, joined via `workspace_actors.parent_actor_id`. Toggle a parent-actor-id update in the DB; refresh; confirm the line moves.
- [ ] Sending the agent email externally → `workspace_messages` row appears, `audit_events` (action `email.received`) appears, mailbox shows it (mockup 10).
- [ ] Inviting the agent to a meeting → `workspace_calendar_events` row with `response_status='needs_action'`, calendar shows it (mockup 11). Click Accept → `response_status='accepted'`, replies sent.
- [ ] An agent skill calling `workspaceEmailPipeline.send(...)` produces an outbound under the agent's identity, IF `email_sending_enabled` is true.
- [ ] If `email_sending_enabled = false`, `workspaceEmailPipeline.send()` returns `failure(workspace_email_sending_disabled, ...)` without writing audit or calling adapter.
- [ ] All agent actions are audit-attributable to `actor_id` in `audit_events`. Verify: `SELECT COUNT(*) FROM audit_events WHERE actor_id IS NOT NULL` > 0 after any agent flow.
- [ ] Agent-profile Activity tab shows that agent's events filtered by `actor_id` (mockup 15). No scope chrome.
- [ ] Subaccount-wide Activity page shows all activity with the new actor filter exposed (mockup 14). Filter dropdown narrows correctly.
- [ ] System agents intended for subaccount-level use have human-style names + explicit `agent_role` (verify in DB + UI).
- [ ] Email handles do not have `agent-` prefix. Verify in DB: `SELECT email_address FROM workspace_identities`.
- [ ] Same flows work against both adapters with identical UX. Manual: configure one subaccount on native, one on Google; walk through onboarding and email-send on each; UI is indistinguishable.
- [ ] Suspending an agent freezes seat consumption (live `SeatsPanel` count drops). Resume → count rises.
- [ ] Migrating native → Google: archived identities on native, new active on Google, single `actor_id` linking both. Activity tab continues to show full history because `actor_id` persists.
- [ ] Adding a Microsoft adapter post-launch is purely a new adapter file (verified by extending `canonicalAdapterContract.test.ts` with a stub `microsoftWorkspaceAdapter` and confirming no schema / UX / permission change is needed).
- [ ] All new tenant tables pass `verify-rls-coverage.sh` in CI.
- [ ] `verify-workspace-actor-coverage.ts` passes in CI.
- [ ] `deriveSeatConsumption` rollup matches the inline `SeatsPanel` (within the eventual-consistency window).
- [ ] Every screen in `prototypes/agent-as-employee/` is implemented in the live app (layout, copy, primary actions match).

### Final close-out

- [ ] Update `architecture.md` with the "Workspace canonical layer" subsection — must mention canonical tables, adapter contract, pipeline, and link to the spec.
- [ ] Update `docs/capabilities.md` with the "Agent-as-employee identity" capability + Google Workspace integration entry. Apply Editorial Rules.
- [ ] Update `docs/spec-context.md` — add `workspaceActorService`, `workspaceIdentityService`, `workspaceEmailPipeline`, `<ActivityFeedTable>` to `accepted_primitives`.
- [ ] Update `tasks/builds/agent-as-employee/progress.md` — mark all phases complete, list final deviations from spec.
- [ ] Move `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md` to `docs/superpowers/specs/done/` (or whatever the project's spec-completion convention is).
- [ ] Open one final "docs sync" PR with the doc updates.

---

## Plan self-review log

These checks were run against the spec at writing time. Re-run them after any spec amendment and before starting implementation.

### Spec coverage

Cross-check spec §5 file inventory against this plan's File Map:

- ✅ All four canonical schema files (Tasks A1, A2, A3) — present.
- ✅ All three migrations (Tasks A4, A5, A7 + A8 amend) — present.
- ✅ All four schema-modified files (Tasks A5) — present.
- ✅ All three adapter files + contract test (Tasks B1, B7, C1–C4) — present.
- ✅ All seven workspace services (Tasks A12, B2–B6, B8, E1) — present.
- ✅ Modified `activityService` (Task D2) — present.
- ✅ All three new route files (Tasks B9, B10) + modified `subaccounts.ts`, `activity.ts`, `index.ts`, `App.tsx` (Tasks B9, B10, D3) — present.
- ✅ All 13 new frontend components/pages (Tasks B12–B19, D4, D6, E3) — present.
- ✅ All six modified frontend pages (Tasks B15, B16, B17, D5, D6, D7, B11) — present.
- ✅ All four shared files (Tasks A11, A12, B1, D1) — present.
- ✅ All four configuration / scripts / docs touchpoints (Tasks A8, A9, A10, B7, B20, C1, final close-out) — present.

### Post-merge corrections (2026-04-29 review pass after merging `main` into the branch)

The plan was reviewed after merging `origin/main` (post-PR #234 + PR #235). The following items were updated:

1. **Migration numbering bumped** — `0240/0241/0242` placeholders now resolve to `0254/0255/0256` (the original `0244/0245/0246` example was taken by `intervention_outcomes_unique` and `all_tenant_tables_rls`; PR #234 also added `0253_rate_limit_buckets`).
2. **`connector_configs` UNIQUE constraint divergence** — Task A4 step 2 now explicitly drops `connector_configs_org_type_unique` and replaces it with two partial unique indexes (CRM `(org, type)` vs workspace `(org, subaccount, type)`). Without this the second subaccount in an org cannot configure a Google Workspace.
3. **`inboundRateLimiter` reuse** — hardening invariant #5 + Task B6 step 1b now require the pipeline to wrap [server/lib/inboundRateLimiter.ts](server/lib/inboundRateLimiter.ts) (DB-canonical clock per invariant #2) instead of inventing a new rate limiter. New keys added to `rateLimitKeys`: `workspaceEmailIdentity`, `workspaceEmailOrg`. 429 responses use `setRateLimitDeniedHeaders` for the canonical `Retry-After` shape.
4. **`audit_events.actor_id` collision resolved definitively** — Task A5 now mandates `workspace_actor_id` as the new column name (existing `actor_id uuid` is the polymorphic principal field, kept untouched). Spec §5 wording is overridden by plan; deviation logged in build progress.
5. **RLS policy template upgraded** — Task A4 step 12 now points at [migrations/0245_all_tenant_tables_rls.sql](migrations/0245_all_tenant_tables_rls.sql) as the canonical template (UUID cast on right-hand side, empty-string guard) rather than the older `architecture.md §1155` `::text` shape.

### Post-merge guardrails (added after second review pass)

The following guardrails were added after a review pass to prevent drift mid-implementation. None are structural; all close gaps where the plan was right but soft.

6. **Pre-flight drift assertion (Task PF1 step 4)** — Before authoring any migration SQL, re-scan `/migrations` and assert `max(existing) < <chosen-N>`. Renumber all three migrations + down migrations in lockstep if drift is detected; never half-rename.
7. **`connector_configs` reader-audit invariant (Task A4 step 2 #3)** — Mandatory `git grep` audit of every `connector_configs` reader before merging Phase A. Each call site must filter on a CRM-only type, on `subaccount_id`, or be fixed in Phase A. Findings logged in build progress.
8. **Wrapper-only rate-limit CI guard (Task B6 step 1b)** — New `scripts/verify-workspace-rate-limit-wrapper.ts` greps for direct uses of `rateLimitKeys.workspaceEmail*` outside `workspaceEmailRateLimit.ts` and fails CI on any other importer. Mirrors the existing pipeline-only-outbound guard.
9. **`audit_events.workspace_actor_id` backfill stance (Task A9 step 6)** — Column is nullable forever. Backfill maps cleanly only for `actor_type ∈ {'user', 'agent'}`; `'system'` rows stay NULL. No synthetic actor rows. Legacy `(actor_id, actor_type)` columns coexist permanently.
10. **Transactional boundary + manifest pairing in A4 (Task A4 step 2 preamble)** — The whole migration runs in a single `BEGIN; … COMMIT;` block so the `connector_configs` index swap + four-table RLS creation are atomic. Every `CREATE TABLE` is paired with a `rlsProtectedTables.ts` entry in the same commit (already CI-enforced via `verify-rls-coverage.sh`).
11. **Rollout ordering statement (Phase strategy front-matter)** — Phase A is schema-only and compatibility-preserving (no readers of new structure). Phase B is the first consumer. Deploy-time order is migration → consuming code → legacy-assumption removal (the latter is out of scope for this plan).

### Final 1% — runtime + observability (added after third review pass)

12. **Pre-merge runtime sanity check (Task A4 step 4b)** — MANDATORY before opening the Phase A PR. Four queries against a non-empty dev DB: pre-flight duplicate check on the new partials, index-swap timing assertion (<1s, no `pg_locks` contention), RLS-policy lock-out smoke test as `org_member`, and a down-then-up reversal. Results logged to `progress.md` under "Runtime sanity log". Schema correctness on an empty DB tells you nothing; this catches the failure modes that only show up against real data.
13. **Happy-path observability invariant (#10)** — Every workspace entry point emits exactly one structured INFO log at the start of the operation with a canonical 10-field shape (`organisationId`, `subaccountId`, `operation`, `actorId`, `identityId`, `connectorType`, `connectorConfigId`, `rateLimitKey`, `requestId`, plus operation-specific anchors). Complements invariant #8 (which covers failures). Existing B6 log line was updated to this shape; reviewers reject any new entry point that omits it.
14. **First-run containment gate (Phase strategy front-matter + Task A13 step 6)** — Phase A → Phase B is a deploy-time gate. After Phase A merges and deploys, three smoke checks run against the live environment (connector resolution, onboarding round-trip, log shape). Phase B's PR does not open until all three pass. Caps the blast radius of a misconfigured policy or silent permission mismatch before the pipeline goes live.

### Placeholder scan

Searched for `TBD` / "implement later" / "fill in details" / "similar to" — no occurrences.

One deviation noted explicitly (Task B5 step 3): spec §8.2 says `uuidv7()`; plan uses `randomUUID()` (uuid v4) at launch and notes the deviation in the build progress file. Behaviourally equivalent for thread ordering.

### Type consistency

- `WorkspaceIdentityStatus` shape: `'provisioned' | 'active' | 'suspended' | 'revoked' | 'archived'` — used identically in `shared/types/workspace.ts` (Task A11), `shared/billing/seatDerivation.ts` (Task A12), `workspaceIdentityServicePure.ts` (Task B3), all routes.
- `IdentityAction`: `'activate' | 'suspend' | 'resume' | 'revoke' | 'archive'` — used identically in pure module (B3), DB-bound service (B4), routes (B9), migration (E1).
- `ProvisionParams` / `ProvisionResult` / `SendEmailParams` / `SendEmailResult` / `InboundMessage` / `CreateEventParams` / `CreateEventResult` / `CalendarEvent` — defined once in `shared/types/workspaceAdapterContract.ts` (B1), re-exported from server-side contract (B1), consumed identically in native adapter (B7), Google adapter (C1–C3), pipeline (B6), onboarding (B8), migration (E1), routes (B9, B10).
- Spec ambiguity called out (Task A5 step 2): existing `audit_events.actorId` text column may collide with the new `actor_id` UUID column. Plan proposes `workspace_actor_id` for the new column and notes the deviation. Implementation MUST inspect the existing column and adjust either the spec or the plan to a single name; cannot have two `actor_id` columns on the same table.

### Migration numbering note

Spec uses `0240` / `0241` / `0242`. After the `main` merge (PR #234 + PR #235) the latest committed migration is `0253_rate_limit_buckets.sql`. Pre-flight task PF1 step 4 makes the renumbering explicit. Substitute `0254` / `0255` / `0256` (or the current latest+1 trio at execution time) for the spec placeholders. The plan body still uses `0240/0241/0242` as placeholders — the executor renames consistently across the migration file, the down migration, and any commit messages that reference the migration number.

### Notes for the executor

- Spec is the source of truth for SQL schema, RLS policies, trigger functions, contract shapes, state-machine transitions, and acceptance criteria. This plan references spec sections rather than duplicating exhaustive SQL.
- Each phase ends with `pr-reviewer` agent. CLAUDE.md mandates this for Major-class work — do not skip.
- Test gates are CI-only per CLAUDE.md. Locally only `lint` + `typecheck` + `build:client` + targeted `tsx <pure-test>` runs.
- After writing this plan: per CLAUDE.md, do NOT offer execution choice. The user moves to Sonnet and `superpowers:subagent-driven-development` to execute.
