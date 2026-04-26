# System Agents v7.1 Migration — Implementation Spec

**Status:** Draft
**Date:** 2026-04-26
**Author:** Main session (Opus 4.7)
**Source brief:** `docs/automation-os-system-agents-v7.1-migration-brief.md`
**Predecessor brief:** `docs/automation-os-system-agents-brief-v6.md`
**Branch:** `claude/audit-system-agents-46kTN` (branched off `main` at `b5fcb314`)
**Build slug:** `system-agents-v7-1-migration`
**Class:** Major (new schema + new tables + new agents + runtime contracts spanning seed + middleware + executor + verification gates)

---

## Table of contents

1. Framing & philosophy
2. Scope & non-goals
3. Existing primitives — reuse / extend / invent
4. File inventory (single source of truth)
5. Migration order (mandatory)
6. Phase 1 — Schema migration (partial-unique indexes + idempotency table)
7. Phase 2 — Skill files & classification
8. Phase 3 — Action registry extensions
9. Phase 4 — Skill executor: handlers, manager guard, side-effect wrapper
10. Phase 5 — Agent file changes (7 new + 13 reparents + finance rescope)
11. Phase 6 — Retire `client-reporting-agent`
12. Phase 7 — Env vars + manifest regeneration
13. Phase 8 — Seed-script orphan cleanup + verification gates + assertions
14. Phase 9 — Local-dev reset paths + rollback
15. Contracts (data shapes crossing service boundaries)
16. Permissions / RLS posture for new tenant-scoped tables
17. Execution model (sync / async / inline / queued)
18. Logging contract for new skills
19. Phase sequencing — dependency graph
20. Acceptance criteria
21. Deferred items
22. Out of scope
23. Testing posture
24. Cross-references

---

## 1. Framing & philosophy

This migration moves the Automation OS company roster from the v6 flat-under-Orchestrator structure to the v7.1 three-tier structure (Orchestrator → 4 Heads + admin-ops + strategic-intelligence + portfolio-health → workers), and turns five v7.1 organisational invariants into runtime/build-time contracts:

1. **Active-row uniqueness** for soft-deletable system rows (so iterative dev resets don't accumulate duplicates).
2. **Cross-run idempotency for write skills** (so retried jobs don't duplicate invoices, emails, or CRM writes).
3. **Side-effect classification** for skills (so reads can fail-soft while writes hard-block on missing config).
4. **Manager allowlist** for the four department-head agents (so managers cannot drift into worker execution).
5. **Agent ↔ skill contract completeness** as a build-time gate (so an agent never references a skill that has no handler at runtime).

**Framing assumptions** (consistent with `docs/spec-context.md` 2026-04-16):
- Pre-production. Wiping system-agent state in the dev DB is acceptable.
- No live users. No staged rollout. No feature flags for any of these changes.
- Static gates and tsx pure-function tests only. No new vitest / supertest / E2E suites.
- Rapid evolution: prefer extending existing primitives over inventing new ones.
- This spec sets the contract; the migration is the only rollout vehicle (no flag-gated dual-write).

**Why this is one spec, not several.** The five invariants are coupled: the schema migration is a hard prerequisite for the local-dev reset; the action-registry extensions are consumed by both the manager guard and the side-effect wrapper; the new agents reference new skills which reference new handlers which reference the new action-registry fields. Splitting into five PRs creates merge ordering hazards with no benefit at this stage.

---

## 2. Scope & non-goals

### In scope

- Schema migration `0228_system_agents_v7_1.sql` — partial-unique indexes on `system_agents.slug` and `agents.(organisation_id, slug)` `WHERE deleted_at IS NULL`, plus the new `skill_idempotency_keys` table.
- 14 new skill files in `server/skills/<slug>.md` + classification updates + visibility application.
- Action-registry extensions: `sideEffectClass`, `idempotency` block, `directExternalSideEffect`, `managerAllowlistMember` flag.
- Skill-executor extensions: 14 new handlers, manager-role guard, side-effect-class wrapper, cross-run idempotency wrapper.
- 7 new `companies/automation-os/agents/<slug>/AGENTS.md` folders.
- 13 reparent edits + `finance-agent` skill list rescope + `update_financial_record` removal.
- Retirement of `client-reporting-agent/` folder.
- 2 new env vars in `server/lib/env.ts` + `.env.example`.
- Manifest JSON regenerated to v7.1 with all 22 agents.
- Seed-script orphan cleanup + cascade soft-delete + post-seed hierarchy assertion.
- New verification script `scripts/verify-agent-skill-contracts.ts` (or extension to existing seed pre-flight).
- Foundational-skill self-containment assertion in the existing visibility verifier.
- Local-dev Path A SQL + the recommended migration order.

### Out of scope (covered in §22)

- Deeper hierarchy plumbing from v7.1 Appendix E (`parentAgentId` on `SkillExecutionContext`, scope param on `config_list_agents`, parent-scoping in `spawn_sub_agents`/`reassign_task`) — see §22.
- Real Stripe / Xero integration for admin-ops handlers — handlers stub at first.
- Master prompts for the 4 manager agents and 3 new workers — written from v7.1 §10–§14, §21, §29 in the same PR but the prompt drafting is a copy/adapt task, not an architectural decision the spec gates on.
- Content/SEO + Social Media merge investigation (v7.1 Appendix F) — explicitly deferred.

---

## 3. Existing primitives — reuse / extend / invent

Per the spec-authoring checklist §1, every new primitive must justify why reuse and extension were both insufficient. The following table records that decision for each piece this spec adds:

| Brief proposes | Codebase has | Decision | Why |
|---|---|---|---|
| `skill_idempotency_keys` table for cross-run dedup | `actions.idempotencyKey` (unique on `(subaccount_id, idempotency_key)`) — keyed on `(runId, toolCallId, argsHash)`; scoped to a single tool-call within a run | **Extend with new sibling table** | `actions.idempotencyKey` is a **per-tool-call within-run** key; replays inside the same run hit it. Cross-run replay (the same `send_invoice` for the same `(engagement_id, period)` triggered by two different runs from the queue retry layer) is a different scope and needs a different keyspace. Reusing `actions` would conflate the two — a different `runId` produces a different key today, so the dedup never fires. The new table is small, owns its own keyspace, and the wrapper composes with `proposeAction` rather than replacing it. |
| `sideEffectClass: 'read' \| 'write'` on registry | `idempotencyStrategy: 'read_only' \| 'keyed_write' \| 'locked'` already on every entry | **Extend registry, don't repurpose** | `idempotencyStrategy` documents the retry-safety contract; the brief's `sideEffectClass` documents the on-failure UX (fail-soft return-warning vs hard-block return-`{status:'blocked'}`). They overlap but are not the same axis: a `read_only` skill could still be `sideEffectClass: 'read'` (Stripe revenue read) or `'none'` (workspace memory read). Two fields keep both contracts explicit. The wrapper reads `sideEffectClass`; the proposeAction layer reads `idempotencyStrategy`. |
| `directExternalSideEffect: bool` on registry | implicit via `mcp.annotations.openWorldHint` + `actionCategory: 'api'` + `defaultGateLevel: 'review'` | **New explicit flag** | The manager guard's "no direct external side effects from a manager" rule (§4.11.5 of the brief) needs a single boolean to read at allowlist-check time, not a 3-field heuristic. We add it explicitly; existing fields stay as-is. |
| Manager-role allowlist guard | `proposeActionMiddleware` already runs as the universal pre-tool hook | **Extend the middleware** | The hook already sees every tool call with full context including the agent row. We add a single conditional: when the resolved agent's `agentRole === 'manager'`, the call passes the allowlist check or returns `{ action: 'block', reason: 'manager_role_violation' }`. No new middleware, no new pipeline position. |
| Cross-run idempotency wrapper | `executeWithActionAudit` in `skillExecutor.ts` already wraps every auto-gated skill | **Extend the wrapper** | The wrapper is the single chokepoint every audited skill call passes through. We add: before `lockForExecution`, if the skill declares `idempotency.keyShape`, attempt a first-writer-wins INSERT on `skill_idempotency_keys`; on conflict, read the prior `response_payload` and return it verbatim. Existing wrapper behaviour for non-declaring skills is unchanged. |
| `list_my_subordinates` skill | no equivalent exists; `read_workspace` is unrelated; `config_list_agents` is admin-tool-scoped | **New foundational skill** | Required by every manager agent's delegation flow. Foundational because it reads `system_agents` directly, declares no external integration, and is invokable from any agent. Goes in `APP_FOUNDATIONAL_SKILLS`. |
| `agentRole: 'manager'` on system_agents | `agentRole text` column already exists; `portfolio-health-agent` uses `role: analyst` | **Reuse the column** | No schema change. The four department heads land with `role: manager` in their `AGENTS.md` frontmatter; `companyParser.toSystemAgentRows` already passes `agentRole` through to the seed row. |
| Manifest regeneration script | none today | **New small script** | Index-only manifest is human-edited today and drift is the dominant failure mode. A 30-line `scripts/regenerate-company-manifest.ts` walks the agent folders and emits the JSON; it is wired as a pre-flight check in the seed so drift fails the seed loudly. Cheaper than maintaining the manifest by hand. |
| Pre-flight `scripts/verify-agent-skill-contracts.ts` | `preflightVerifySkillVisibility` (existing) covers visibility only; no contract-completeness check today | **New script + wired into seed** | Extends the existing pre-flight model; covers an orthogonal failure class (handler-missing-but-frontmatter-references-it) that visibility doesn't catch. |

Anything else this spec touches reuses an existing primitive without modification (`policyEngineService`, `actionService.proposeAction`, `withBackoff`, `TripWire`, `runCostBreaker`, `failure() + FailureReason enum`, `withOrgTx`, `RLS_PROTECTED_TABLES` manifest, `verify-rls-coverage.sh`, `tsx + static-gate test convention`).

---

## 4. File inventory (single source of truth)

Every file the implementation touches. Prose elsewhere in this spec must reference one of these entries — if a section names a file that isn't here, the spec has drifted and the inventory is the authoritative anchor.

### 4.1 Migrations (1 new)

| Path | Purpose |
|------|---------|
| `migrations/0228_system_agents_v7_1.sql` | Partial-unique-index swap on `system_agents.slug` + `agents.(organisation_id, slug)`; create `skill_idempotency_keys` table + RLS policy + supporting indexes |

### 4.2 Schema files (3 modified, 1 new)

| Path | Change |
|------|--------|
| `server/db/schema/systemAgents.ts` | Replace full `uniqueIndex` on `slug` with partial unique `WHERE deleted_at IS NULL` |
| `server/db/schema/agents.ts` | Replace `agents_org_slug_uniq` partial unique (already partial) — confirm WHERE-clause matches new migration |
| `server/db/schema/skillIdempotencyKeys.ts` | **NEW** — Drizzle schema for `skill_idempotency_keys` |
| `server/db/schema/index.ts` | Re-export the new schema |

### 4.3 RLS manifest (1 modified)

| Path | Change |
|------|--------|
| `server/config/rlsProtectedTables.ts` | Append `skill_idempotency_keys` entry pointing at migration `0228` |

### 4.4 Skill files (14 new, 1 deleted)

New (in `server/skills/`):
`list_my_subordinates.md`, `generate_invoice.md`, `send_invoice.md`, `reconcile_transactions.md`, `chase_overdue.md`, `process_bill.md`, `track_subscriptions.md`, `prepare_month_end.md`, `discover_prospects.md`, `draft_outbound.md`, `score_lead.md`, `book_meeting.md`, `score_nps_csat.md`, `prepare_renewal_brief.md`.

Deleted: `server/skills/update_financial_record.md`.

### 4.5 Skill classification (1 modified)

| Path | Change |
|------|--------|
| `scripts/lib/skillClassification.ts` | Add `list_my_subordinates` to `APP_FOUNDATIONAL_SKILLS` |

### 4.6 Action registry (1 modified)

| Path | Change |
|------|--------|
| `server/config/actionRegistry.ts` | (a) Extend `ActionDefinition` interface with `sideEffectClass`, `idempotency`, `directExternalSideEffect`, `managerAllowlistMember`. (b) Add 14 new `ACTION_REGISTRY` entries. (c) Remove `update_financial_record` entry. (d) Add `provider` parameter + Hunter routing to `enrich_contact` entry. |

### 4.7 Skill executor (1 modified)

| Path | Change |
|------|--------|
| `server/services/skillExecutor.ts` | (a) Add 14 handler entries to `SKILL_HANDLERS`. (b) Extend `executeWithActionAudit` with the cross-run idempotency wrapper (only when `idempotency.keyShape` is declared) and the side-effect-class fail-soft / must-block branches. (c) Remove `update_financial_record` handler + worker-adapter case. |

### 4.8 Pre-tool middleware (1 modified)

| Path | Change |
|------|--------|
| `server/services/middleware/proposeAction.ts` | Add manager-role allowlist check — returns `{ action: 'block', reason: 'manager_role_violation' }` when `agent.agentRole === 'manager'` and the resolved skill is not in `manager_allowlist` |

### 4.9 Universal-skill list (review only)

| Path | Change |
|------|--------|
| `server/config/universalSkills.ts` | Reviewed — no change. Universal skills (`ask_clarifying_question`, `request_clarification`, `read_workspace`, `web_search`, `read_codebase`, `search_agent_history`, `read_priority_feed`) remain the same. New foundational skill `list_my_subordinates` is **not** universal — it's only available where wired (managers + Orchestrator). |

### 4.10 Env config (2 modified)

| Path | Change |
|------|--------|
| `server/lib/env.ts` | Add `GOOGLE_PLACES_API_KEY` + `HUNTER_API_KEY` (both `z.string().optional()`) |
| `.env.example` | Add both vars under a `# Lead discovery (SDR Agent)` heading |

### 4.11 Hunter / Places provider plumbing (2 new)

| Path | Purpose |
|------|---------|
| `server/services/leadDiscovery/hunterProvider.ts` | **NEW** — Hunter `domain-search` + `email-finder` client; in-memory LRU keyed on domain; fail-soft on 402/429 |
| `server/services/leadDiscovery/googlePlacesProvider.ts` | **NEW** — Places `text-search` + `place-details` client; same fail-soft posture |

(Both files stub when their env var is absent — handlers return `{ status: 'not_configured' }` rather than throw.)

### 4.11a Domain-handler service modules (3 new)

Per §9.1, the 14 new handler implementations live in dedicated service modules (no `server/skills/handlers/` folder convention exists in the codebase).

| Path | Handlers it owns |
|------|-------------------|
| `server/services/adminOpsService.ts` | **NEW** — `executeGenerateInvoice`, `executeSendInvoice`, `executeReconcileTransactions`, `executeChaseOverdue`, `executeProcessBill`, `executeTrackSubscriptions`, `executePrepareMonthEnd` |
| `server/services/sdrService.ts` | **NEW** — `executeDiscoverProspects`, `executeDraftOutbound`, `executeScoreLead`, `executeBookMeeting` |
| `server/services/retentionSuccessService.ts` | **NEW** — `executeScoreNpsCsat`, `executePrepareRenewalBrief` |
| `server/tools/config/configSkillHandlersPure.ts` | **MODIFIED** — append `executeListMySubordinates` (reuses existing `computeDescendantIds`) |

### 4.11b pg-boss cleanup job (1 new)

Per §17, the daily cleanup of expired `skill_idempotency_keys` rows runs as a queued job.

| Path | Purpose |
|------|---------|
| `server/jobs/skillIdempotencyKeysCleanupJob.ts` | **NEW** — daily worker that deletes rows where `expires_at < NOW()`. Permanent-class rows never match. |
| `server/jobs/index.ts` | **MODIFIED** — register the new job in the worker fan-out |

### 4.11c Pure helpers + unit tests (2 new pure modules, 2 new test files)

| Path | Purpose |
|------|---------|
| `server/services/skillIdempotencyKeysPure.ts` | **NEW** — `hashKeyShape(keyShape, input)`, `ttlClassToExpiresAt(class)` pure helpers consumed by the wrapper extension in §9.3 |
| `server/services/middleware/managerGuardPure.ts` | **NEW** — `isManagerAllowlisted(skill, agentRole, perAgentReads)` pure helper consumed by §9.4 |
| `server/services/__tests__/skillIdempotencyKeysPure.test.ts` | **NEW** — tsx pure-function tests for `hashKeyShape` + `ttlClassToExpiresAt` |
| `server/services/__tests__/managerGuardPure.test.ts` | **NEW** — tsx pure-function tests for `isManagerAllowlisted` (allowed bundle, denied worker skill, per-manager declared read pass-through, `directExternalSideEffect` reject) |

### 4.12 Agent files (7 new, 13 modified, 1 deleted)

New folders under `companies/automation-os/agents/<slug>/AGENTS.md`:
`head-of-product-engineering`, `head-of-growth`, `head-of-client-services`, `head-of-commercial`, `admin-ops-agent`, `retention-success-agent`, `sdr-agent`.

Modified (single-line `reportsTo:` switch + skill-list edits where noted):
`business-analyst`, `dev`, `qa`, `knowledge-management-agent` (→ `head-of-product-engineering`);
`social-media-agent`, `ads-management-agent`, `email-outreach-agent`, `content-seo-agent` (→ `head-of-growth`);
`support-agent`, `onboarding-agent` (→ `head-of-client-services`);
`finance-agent` (→ `head-of-commercial`; **also** drop `update_financial_record` from `skills:` list);
`crm-pipeline-agent` (→ `head-of-commercial`).

Deleted: `companies/automation-os/agents/client-reporting-agent/` (entire folder).

Unchanged: `orchestrator`, `strategic-intelligence-agent`, `portfolio-health-agent`.

### 4.13 Manifest JSON (1 modified, 1 new script)

| Path | Change |
|------|--------|
| `companies/automation-os/automation-os-manifest.json` | Regenerate to `version: "7.1.0"`, all 22 agents, updated `description` + `masterBrief` |
| `scripts/regenerate-company-manifest.ts` | **NEW** — walks `companies/automation-os/agents/*/AGENTS.md`, emits the JSON. Wired as a seed pre-flight that fails on drift. |

### 4.14 Seed pipeline (1 modified)

| Path | Change |
|------|--------|
| `scripts/seed.ts` | (a) Extend pre-flight: invoke new `verify-agent-skill-contracts.ts` + the manifest-regenerator drift check. (b) Phase 2/3 — orphan-soft-delete + cascade soft-delete to `agents` + deactivate matching `subaccount_agents`. (c) Post-Phase-3 hierarchy assertion (one root, no cycles, depth ≤ 3, all parents non-deleted). |

### 4.15 Verification scripts (1 new, 1 modified)

| Path | Change |
|------|--------|
| `scripts/verify-agent-skill-contracts.ts` | **NEW** — parses every `companies/automation-os/agents/*/AGENTS.md`, asserts each `skills:` slug exists in `server/skills/`, in `ACTION_REGISTRY`, and in `SKILL_HANDLERS`. Also asserts: (a) every `.md` skill file is referenced by at least one agent OR carries `reusable: true` frontmatter; (b) every skill in `APP_FOUNDATIONAL_SKILLS` has no external integration in its registry entry. Exit 1 on any miss. |
| `scripts/verify-skill-visibility.ts` (existing) | Extend to cover the foundational-skill self-containment assertion (item (b) above) — keeps the visibility gate's coverage with the contracts gate's |

### 4.16 Documentation (3 modified)

| Path | Change |
|------|--------|
| `architecture.md` § "Key files per domain" | Add row for `companies/automation-os/agents/<slug>/AGENTS.md` (system-agent definitions) + `skill_idempotency_keys` to the RLS-protected list |
| `tasks/current-focus.md` | Update in-flight pointer to this spec / branch |
| `docs/capabilities.md` | Append the 7 new agents to the customer-facing roster (Marketing-and-sales-ready terms — no LLM provider names) |

### 4.17 Build artefacts (per CLAUDE.md task convention)

| Path | Purpose |
|------|---------|
| `tasks/builds/system-agents-v7-1-migration/plan.md` | Architect-emitted plan (one chunk per phase) |
| `tasks/builds/system-agents-v7-1-migration/progress.md` | Per-session progress (cross-session handoff) |

---

## 5. Migration order (mandatory)

The phase order below is **load-bearing**. Reordering causes silent failures (the Path A reset fails on the second attempt because the partial-unique index isn't in place; the seed pre-flight aborts because skills declared in `AGENTS.md` have no handler). Do not parallelise across phases without re-reading this section.

| Order | Phase | Why it must come first/next | Failure mode if skipped |
|-------|-------|------------------------------|--------------------------|
| 1 | **Phase 1 — Schema migration** (§6) | Partial-unique indexes are required before §14 Path A; `skill_idempotency_keys` is required before any new write skill writes a row. | Path A reset hits unique-constraint violation; idempotency wrapper can't write. |
| 2 | **Phase 2 — Skill files + classification + visibility** (§7) | Pre-flight (`preflightVerifySkillVisibility` + new `verify-agent-skill-contracts.ts`) reads these. | Seed aborts. |
| 3 | **Phase 3 — Action registry** (§8) | Handlers in §9 reference registry entries; manager-guard in §9 reads `managerAllowlistMember`; idempotency wrapper reads `idempotency.keyShape`; side-effect wrapper reads `sideEffectClass`. | Handlers throw "unknown action type"; guard never triggers; wrapper no-ops. |
| 4 | **Phase 4 — Skill executor extensions** (§9) | Agent files in §10 reference handlers via skills list; without handler entries, agent-skill contract gate fails. | Pre-flight gate aborts seed. |
| 5 | **Phase 5 — Agent file changes** (§10) + **Phase 6 — Retire `client-reporting-agent`** (§11) | Combined in one PR step because they're the same file-system operation class. Pre-flight gate now passes (skills + handlers + registry all aligned). | n/a — all upstream prerequisites in place. |
| 6 | **Phase 7 — Env vars + manifest regeneration** (§12) | Manifest pre-flight check in seed reads the regenerated JSON; env vars consumed by the new Hunter / Places providers. | Seed pre-flight reports manifest drift; providers fail at runtime when handlers are first invoked (graceful — they return `{ status: 'not_configured' }`). |
| 7 | **Phase 8 — Seed-script changes + verification gates** (§13) | Cannot land before Phases 1–7 because the new gates would fire prematurely against an inconsistent state. | Seed aborts during dev iteration. |
| 8 | **Phase 9 — Local-dev reset** (§14) | Final step — exercises every prior phase end-to-end on the dev DB. | n/a (this is the validation step). |

> **Single-PR vs multi-PR.** Phases 1–8 land in a single PR. Phase 9 is a local-dev step the reviewer or merger runs once after merge — it touches no committed files. Splitting Phases 1–8 across PRs creates the merge-order hazards called out in §1; the framing assumption (`pre_production: yes`, `staged_rollout: never_for_this_codebase_yet`) makes a single PR the cheaper option.

---

## 6. Phase 1 — Schema migration

### 6.1 Migration file

**Path:** `migrations/0228_system_agents_v7_1.sql`

The migration does three things, in this order, in a single transaction:

1. **Drop the existing full-unique indexes and replace with partial uniques** scoped to `WHERE deleted_at IS NULL`.
2. **Create the `skill_idempotency_keys` table** with primary key, indexes, and `ENABLE ROW LEVEL SECURITY`.
3. **Create the matching RLS policy** keyed on `current_setting('app.organisation_id', true)` — same shape as every other tenant-isolated table, per `architecture.md §1155`.

```sql
-- migrations/0228_system_agents_v7_1.sql
-- v7.1 system-agents migration: active-row uniqueness + cross-run idempotency table.

BEGIN;

-- (1a) system_agents.slug — replace full unique with partial unique
DROP INDEX IF EXISTS system_agents_slug_idx;
CREATE UNIQUE INDEX system_agents_slug_active_idx
  ON system_agents (slug)
  WHERE deleted_at IS NULL;

-- (1b) agents.(organisation_id, slug) — confirm partial-unique posture.
-- The index is already declared partial in server/db/schema/agents.ts
-- (`agents_org_slug_uniq` with WHERE deleted_at IS NULL). This block is
-- defensive: drop-and-recreate to guarantee shape parity in any DB that
-- predates the partial declaration.
DROP INDEX IF EXISTS agents_org_slug_uniq;
CREATE UNIQUE INDEX agents_org_slug_active_uniq
  ON agents (organisation_id, slug)
  WHERE deleted_at IS NULL;

-- (2) skill_idempotency_keys — cross-run replay dedup for write skills
CREATE TABLE skill_idempotency_keys (
  subaccount_id     uuid       NOT NULL,
  organisation_id   uuid       NOT NULL,
  skill_slug        text       NOT NULL,
  key_hash          text       NOT NULL,
  request_hash      text       NOT NULL,
  response_payload  jsonb      NOT NULL DEFAULT '{}'::jsonb,
  status            text       NOT NULL DEFAULT 'in_flight'
                                CHECK (status IN ('in_flight', 'completed', 'failed')),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  expires_at        timestamptz NULL,  -- NULL = never expires (financial)
  PRIMARY KEY (subaccount_id, skill_slug, key_hash)
);

CREATE INDEX skill_idempotency_keys_expires_at_idx
  ON skill_idempotency_keys (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX skill_idempotency_keys_org_idx
  ON skill_idempotency_keys (organisation_id);

ALTER TABLE skill_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_skill_idempotency_keys
  ON skill_idempotency_keys
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);

COMMIT;
```

**Why include `organisation_id`** (not just `subaccount_id`):
- The RLS policy needs an org column to match the manifest pattern in `rlsProtectedTables.ts`. Every other RLS-protected table is keyed on `current_setting('app.organisation_id', true)`. Adding `organisation_id` keeps the new table consistent with the existing convention and lets `verify-rls-coverage.sh` recognise it.
- It is denormalised relative to `subaccount_id` — handlers must populate both. The wrapper (§9) does this from `SkillExecutionContext`.

**Why `status` is a CHECK column, not an enum type:** lower migration risk — no `CREATE TYPE` required; pre-prod doesn't yet justify schema-level enum churn. The wrapper writes `'in_flight'` first, then updates to `'completed'` or `'failed'`.

### 6.2 Drizzle schema additions

**`server/db/schema/skillIdempotencyKeys.ts`** (NEW):

```ts
import { pgTable, uuid, text, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

export const skillIdempotencyKeys = pgTable('skill_idempotency_keys', {
  subaccountId: uuid('subaccount_id').notNull(),
  organisationId: uuid('organisation_id').notNull(),
  skillSlug: text('skill_slug').notNull(),
  keyHash: text('key_hash').notNull(),
  requestHash: text('request_hash').notNull(),
  responsePayload: jsonb('response_payload').notNull().default({}),
  status: text('status').notNull().default('in_flight').$type<'in_flight' | 'completed' | 'failed'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ columns: [table.subaccountId, table.skillSlug, table.keyHash] }),
  expiresAtIdx: index('skill_idempotency_keys_expires_at_idx').on(table.expiresAt),
  orgIdx: index('skill_idempotency_keys_org_idx').on(table.organisationId),
}));

export type SkillIdempotencyKey = typeof skillIdempotencyKeys.$inferSelect;
export type NewSkillIdempotencyKey = typeof skillIdempotencyKeys.$inferInsert;
```

**`server/db/schema/index.ts`** (MODIFIED): re-export the new module.

**`server/db/schema/systemAgents.ts`** (MODIFIED): replace the full `uniqueIndex('system_agents_slug_idx').on(table.slug)` with:

```ts
slugActiveIdx: uniqueIndex('system_agents_slug_active_idx')
  .on(table.slug)
  .where(sql`${table.deletedAt} IS NULL`),
```

**`server/db/schema/agents.ts`** (MODIFIED — confirm only): the existing `agents_org_slug_uniq` declaration is already partial. The migration's defensive drop-and-recreate ensures a clean DB shape; the schema file changes only its index name to `agents_org_slug_active_uniq` to match.

### 6.3 RLS manifest entry

**`server/config/rlsProtectedTables.ts`** (MODIFIED) — append:

```ts
{
  tableName: 'skill_idempotency_keys',
  schemaFile: 'skillIdempotencyKeys.ts',
  policyMigration: '0228_system_agents_v7_1.sql',
  rationale: 'Cross-run idempotency keys for write skills — request payload hashes can encode customer PII (email recipient hashes, invoice amounts, contact updates).',
},
```

`verify-rls-coverage.sh` will pass because the migration creates the policy in the same file. `verify-rls-session-var-canon.sh` will pass because the policy uses `app.organisation_id` (the canonical session var).

### 6.4 Down-migration

A `migrations/_down/0228_system_agents_v7_1.sql` is **NOT** required per repo convention (down-migrations are deferred until production per `docs/spec-context.md` `migration_safety_tests: defer_until_live_data_exists`). If a rollback is needed in dev, run the §14 Rollback path.

### 6.5 Verification (run after migration)

- `psql $DATABASE_URL -c "\d+ system_agents"` shows `system_agents_slug_active_idx` as a partial unique with `WHERE deleted_at IS NULL`.
- `psql $DATABASE_URL -c "\d+ agents"` shows `agents_org_slug_active_uniq` as the partial unique.
- `psql $DATABASE_URL -c "\d+ skill_idempotency_keys"` shows the table + RLS enabled (`Row security: ENABLED`).
- `npm run typecheck` passes (Drizzle schema parses).
- `bash scripts/verify-rls-coverage.sh` passes.
- `bash scripts/verify-rls-session-var-canon.sh` passes.

---

## 7. Phase 2 — Skill files + classification + visibility

### 7.1 New skill files (14 — flat list under `server/skills/`)

All 14 skill files use the existing skill-frontmatter shape (copy-paste-then-edit from a peer like `server/skills/draft_post.md`). The only structural variation is `visibility:` (set per the classification rule below). Frontmatter fields used: `name`, `description`, `isActive: true`, `visibility`. Body sections: `## Parameters`, `## Instructions`.

| # | Slug | Used by | Visibility | One-line purpose |
|---|------|---------|------------|------------------|
| 1 | `list_my_subordinates` | Orchestrator + 4 manager heads | `none` | Returns the agent's subtree (children only by default; scope=`children`/`descendants`). Reads `system_agents` directly. |
| 2 | `generate_invoice` | admin-ops-agent | `basic` | Build invoice from engagement record + billing schedule; returns structured invoice + idempotency key. |
| 3 | `send_invoice` | admin-ops-agent | `basic` | Deliver invoice via configured channel (Stripe / email). Stubs to `{ status: 'not_configured' }` if no provider. |
| 4 | `reconcile_transactions` | admin-ops-agent | `basic` | Match Stripe payouts against accounting records; surface mismatches as a structured diff. |
| 5 | `chase_overdue` | admin-ops-agent | `basic` | Draft a dunning communication for a specific invoice + dunning step. Returns text + recommended channel. |
| 6 | `process_bill` | admin-ops-agent | `basic` | Record an inbound bill / expense; emits a `review`-gated approval for human sign-off. |
| 7 | `track_subscriptions` | admin-ops-agent | `basic` | Pull current SaaS subscription state, flag renewals/cancellations within a configurable window. |
| 8 | `prepare_month_end` | admin-ops-agent | `basic` | Aggregate revenue + expenses + reconciliation status into a month-end close package. |
| 9 | `discover_prospects` | sdr-agent | `basic` | Google Places caller — returns SMB prospects matching geo + vertical + size criteria. Fail-soft on missing `GOOGLE_PLACES_API_KEY`. |
| 10 | `draft_outbound` | sdr-agent | `basic` | Draft a 1:1 outbound message (cold email / LinkedIn) for a prospect; returns text + tone score. |
| 11 | `score_lead` | sdr-agent | `basic` | Score a lead's qualification fit using stated criteria; returns structured score + rationale. |
| 12 | `book_meeting` | sdr-agent | `basic` | Book a meeting on a configured calendar provider; idempotent on `(prospect_email, requested_slot)`. |
| 13 | `score_nps_csat` | retention-success-agent | `basic` | Aggregate NPS/CSAT signals, classify trend, surface at-risk segments. |
| 14 | `prepare_renewal_brief` | retention-success-agent | `basic` | Draft a renewal/QBR prep doc from account state + churn-risk + recent reports. |

### 7.2 Skill classification update

**`scripts/lib/skillClassification.ts`** (MODIFIED) — add `list_my_subordinates` to `APP_FOUNDATIONAL_SKILLS`:

```ts
export const APP_FOUNDATIONAL_SKILLS: ReadonlySet<string> = new Set([
  // ... existing entries ...
  'list_my_subordinates',  // NEW — manager-bundle delegation primitive
]);
```

The other 13 new skills default to BUSINESS-VISIBLE (`visibility: basic`) and need no classification entry.

### 7.3 Visibility application

After creating the 14 files, run:

```bash
npx tsx scripts/apply-skill-visibility.ts
```

This bulk-applies the `visibility:` field per `classifySkill(slug)`. The seed pre-flight (`preflightVerifySkillVisibility`) will then pass.

### 7.4 Foundational-skill self-containment assertion (NEW)

Extend `scripts/verify-skill-visibility.ts` (existing) so it additionally asserts:

> Every skill in `APP_FOUNDATIONAL_SKILLS` declares no external integration in its `ACTION_REGISTRY` entry — i.e. `actionCategory !== 'api'` AND `mcp.annotations.openWorldHint === false` AND `directExternalSideEffect !== true`.

This catches the failure mode where someone adds a skill to the foundational set that needs an env var or external API at runtime — a classification bug, not an integration bug.

`list_my_subordinates` reads `system_agents` directly — fine. Other foundational skills (`read_workspace`, `write_workspace`, `update_memory_block`, `create_task`, `move_task`, `update_task`, `reassign_task`, `add_deliverable`, `spawn_sub_agents`, `request_approval`, `triage_intake`, `read_data_source`, `playbook_*`) are also internal-only — fine.

### 7.5 Hunter / Places provider extensions (per SDR brief)

#### 7.5.1 `enrich_contact` enhancement

**`server/config/actionRegistry.ts`** (MODIFIED — `enrich_contact` entry):

- Add `provider` parameter to `parameterSchema`: `provider: z.enum(['default', 'hunter']).optional().describe('Enrichment provider — default uses configured org provider; "hunter" forces Hunter.io routing')`.
- Handler in `SKILL_HANDLERS` reads `input.provider`. When `'hunter'`, routes to the new `hunterProvider.ts` (§7.5.3).

#### 7.5.2 `discover_prospects` skill — new

**`server/services/leadDiscovery/googlePlacesProvider.ts`** (NEW):

- Exports `searchPlaces(input: { query, location, radius, type, limit })` returning `{ places: PlaceSummary[] }`.
- Calls Google Places `text-search` + (optional) `place-details`.
- In-memory LRU keyed on the request hash, 24h TTL.
- Fail-soft: returns `{ status: 'not_configured', warning: 'GOOGLE_PLACES_API_KEY not set' }` when env absent. Returns `{ status: 'transient_error', warning: '...' }` on 429/5xx.

#### 7.5.3 Hunter provider — new

**`server/services/leadDiscovery/hunterProvider.ts`** (NEW):

- Exports `domainSearch(domain)` and `emailFinder({ domain, firstName, lastName })`.
- Calls Hunter.io `/v2/domain-search` + `/v2/email-finder`.
- In-memory LRU keyed on domain, 24h TTL.
- Fail-soft on 402 (quota) / 429 (rate limit): returns `{ status: 'transient_error', warning, data: null }` rather than throw.

Both providers depend on the env vars added in §12 (`GOOGLE_PLACES_API_KEY`, `HUNTER_API_KEY`).

### 7.6 Removed skill file

`server/skills/update_financial_record.md` — **delete** (pre-production; the v7.1 finance rescope drops this skill entirely; the registry entry + worker-adapter case are removed in §8 / §9).

### 7.7 Verification

- `ls server/skills/*.md | wc -l` — expect previous count + 14 new − 1 removed = previous + 13.
- `npx tsx scripts/apply-skill-visibility.ts` is idempotent; second run produces no changes.
- `npx tsx scripts/seed.ts --dry-run` (if dry-run flag exists) or `npm run seed` against the dev DB completes the pre-flight without errors.
- `bash scripts/verify-skill-visibility.ts` exits 0 (extended foundational-skill self-containment assertion passes).

---

## 8. Phase 3 — Action registry extensions

### 8.1 Interface extensions

**`server/config/actionRegistry.ts`** (MODIFIED — `ActionDefinition` interface):

```ts
export type SideEffectClass = 'read' | 'write' | 'none';

export interface IdempotencyContract {
  /** Field names from `parameterSchema` that combine to form the dedup key. */
  keyShape: string[];
  /** Persistence scope. 'subaccount' = the default for tenant-scoped skills. */
  scope: 'subaccount' | 'org';
  /** TTL class — drives `expires_at` in skill_idempotency_keys.
   *  - 'permanent' (financial, audit-trail-required) → expires_at = NULL
   *  - 'long' (CRM / commitments / scheduled-meetings) → 30 days
   *  - 'short' (communications) → 14 days
   */
  ttlClass: 'permanent' | 'long' | 'short';
}

export interface ActionDefinition {
  // ... existing fields preserved ...

  /**
   * v7.1 — UX semantics on failure or missing config.
   *  - 'read'  : on missing config / transient failure, return
   *              { status: 'not_configured' | 'transient_error', warning, data: null }.
   *              Never throw. fail-soft.
   *  - 'write' : on missing config / validation failure, return
   *              { status: 'blocked', reason } BEFORE any side effect.
   *              Partial success returns { status: 'partial', completed_steps, remaining_steps }
   *              and surfaces a board task with explicit recovery instructions.
   *  - 'none'  : neither — pure internal operation (most foundational skills).
   * Enforced by the executeWithActionAudit wrapper (§9.3).
   */
  sideEffectClass: SideEffectClass;

  /**
   * v7.1 — Cross-run idempotency contract. When present, the wrapper hashes
   * the inputs per `keyShape` and acquires a row in skill_idempotency_keys
   * before executing. Replays return the cached `response_payload` verbatim.
   * Read-only skills MUST omit this field.
   */
  idempotency?: IdempotencyContract;

  /**
   * v7.1 — Manager guard hint. When true, this skill's handler may itself
   * call an external system (Stripe, Gmail, GitHub, Anthropic, etc.).
   * The manager-role guard rejects any skill where this is true, regardless
   * of allowlist membership. Defaults to inferred-from-`mcp.openWorldHint`
   * when omitted, but explicit declaration is preferred for clarity.
   */
  directExternalSideEffect?: boolean;

  /**
   * v7.1 — Manager allowlist membership. When true, this skill is permitted
   * for managers as part of the universal+delegation bundle or the manager's
   * declared per-domain reads. Foundational skills (universal bundle +
   * delegation bundle) carry this flag; per-manager domain reads (e.g.
   * `read_revenue` for the CRO) are added at agent-load time, not here.
   */
  managerAllowlistMember?: boolean;
}
```

### 8.2 New ACTION_REGISTRY entries (14)

Each new entry follows the standard shape. The fields that vary across the 14 are summarised in this table; the full Zod `parameterSchema` and per-skill rationale belong in the implementation PR, not in this spec.

| Slug | actionCategory | sideEffectClass | defaultGateLevel | idempotencyStrategy | directExternalSideEffect | idempotency.keyShape (write only) | idempotency.ttlClass | managerAllowlistMember |
|------|----------------|-----------------|------------------|---------------------|--------------------------|-----------------------------------|----------------------|------------------------|
| `list_my_subordinates` | worker | none | auto | read_only | false | (n/a — read) | (n/a) | **true** |
| `generate_invoice` | worker | write | review | keyed_write | false | `[engagement_id, billing_period_start, billing_period_end]` | permanent | false |
| `send_invoice` | api | write | review | locked | true | `[invoice_id]` | permanent | false |
| `reconcile_transactions` | api | read | auto | read_only | true | (n/a — read) | (n/a) | false |
| `chase_overdue` | api | write | review | locked | true | `[invoice_id, dunning_step]` | long | false |
| `process_bill` | worker | write | review | keyed_write | false | `[external_bill_id, amount, due_date]` | permanent | false |
| `track_subscriptions` | api | read | auto | read_only | true | (n/a — read) | (n/a) | false |
| `prepare_month_end` | worker | write | review | keyed_write | false | `[period_start, period_end]` | permanent | false |
| `discover_prospects` | api | read | auto | read_only | true | (n/a — read) | (n/a) | false |
| `draft_outbound` | worker | none | auto | read_only | false | (n/a) | (n/a) | false |
| `score_lead` | worker | none | auto | read_only | false | (n/a) | (n/a) | false |
| `book_meeting` | api | write | review | locked | true | `[prospect_email, requested_slot]` | long | false |
| `score_nps_csat` | worker | none | auto | read_only | false | (n/a) | (n/a) | false |
| `prepare_renewal_brief` | worker | none | auto | read_only | false | (n/a — output is a draft) | (n/a) | false |

Notes on the table:
- `defaultGateLevel: review` everywhere a write touches an external system or a financial record. Matches v7.1 §5 gate model.
- `discover_prospects` and `track_subscriptions` are reads even though `directExternalSideEffect: true` — the flag describes whether the handler can hit an external API, not whether the operation mutates external state. The manager guard rejects on this flag specifically because a "read" that calls a quota'd API still shouldn't run from a manager.
- `book_meeting` `idempotencyStrategy: 'locked'` because the calendar provider's own dedup is a secondary safety net, not the primary; we want a pg-side guarantee.
- `chase_overdue` `keyShape` includes `dunning_step` so the same invoice can be chased multiple times across the dunning ladder, but each step fires once.

### 8.3 Existing-entry modifications

#### `enrich_contact` (per §7.5.1):
- Add `provider` to `parameterSchema`.
- No `idempotency` block (per existing `idempotencyStrategy: 'keyed_write'` — already covered at the actions-table layer; cross-run replay is rare for enrichment and the LRU cache in the provider absorbs it).
- `sideEffectClass: 'write'` (writes enrichment back to the CRM).

#### Universal-bundle skills (already in registry):
- Add `managerAllowlistMember: true` to: `read_workspace`, `write_workspace`, `move_task`, `update_task`, `request_approval`, `add_deliverable`, `create_task`, `list_my_subordinates`, `spawn_sub_agents`, `reassign_task`.
- Other universal skills (`ask_clarifying_question`, `request_clarification`, `web_search`, `read_codebase`, `search_agent_history`, `read_priority_feed`) — set `managerAllowlistMember: true` only for the ones the manager bundle explicitly includes (`read_codebase` for the CTO is per-manager, not universal-allowlist; `web_search` is universal already and stays so but is also OK for managers — set true for clarity).

#### Side-effect-class backfill (existing entries):
- For every entry already in `ACTION_REGISTRY`, add `sideEffectClass`. Defaults inferred:
  - `actionCategory === 'api'` AND `mcp.annotations.readOnlyHint === false` → `'write'`.
  - `actionCategory === 'api'` AND `mcp.annotations.readOnlyHint === true` → `'read'`.
  - `actionCategory === 'worker'` AND no external write → `'none'`.
  - `actionCategory === 'worker'` AND DB writes (e.g. `create_task`, `update_task`) → `'none'` (DB-internal write is not the contract — `sideEffectClass: 'write'` is reserved for external-blast-radius writes).

> **Why backfill is in scope.** The wrapper in §9.3 reads `sideEffectClass` for every audited skill. Without backfill, existing skills hit `undefined` and the wrapper either no-ops (silent) or throws (loud). Backfill is mechanical (~50 entries), low-risk, and the new TypeScript field is non-optional so the compiler enforces completeness.

#### Removed entry:
- `update_financial_record` — delete entirely.

### 8.4 Verification

- `npx tsc --noEmit` passes (`sideEffectClass` is required so any missing entry fails).
- `bash scripts/verify-action-registry-zod.sh` passes.
- `bash scripts/verify-idempotency-strategy-declared.sh` passes.
- `bash scripts/verify-skill-read-paths.sh` passes (every new write skill declares `readPath`).

---

## 9. Phase 4 — Skill executor: handlers, manager guard, side-effect wrapper

### 9.1 New handler entries (14)

**`server/services/skillExecutor.ts`** (MODIFIED — `SKILL_HANDLERS` map). All 14 handlers route through `executeWithActionAudit` (per the existing convention for auto-gated skills) so the action-audit row is written and the §9.3 wrapper extensions take effect.

```ts
// Inside SKILL_HANDLERS:

list_my_subordinates: async (input, context) => {
  return executeWithActionAudit('list_my_subordinates', input, context, () =>
    executeListMySubordinates(input, context)
  );
},

generate_invoice: async (input, context) => {
  requireSubaccountContext(context, 'generate_invoice');
  return executeWithActionAudit('generate_invoice', input, context, () =>
    executeGenerateInvoice(input, context)
  );
},
// ... 12 more, same shape ...
```

Each handler implementation lives in a dedicated module under `server/services/` (no new `server/skills/handlers/` folder — that path doesn't exist in the codebase; we follow the existing pattern of co-locating related handlers in a service file). Suggested groupings:

| Module | Handlers |
|--------|----------|
| `server/services/configSkillHandlersPure.ts` (existing) — extend | `executeListMySubordinates` (reads `system_agents` via existing `computeDescendantIds`) |
| `server/services/adminOpsService.ts` (NEW) | `executeGenerateInvoice`, `executeSendInvoice`, `executeReconcileTransactions`, `executeChaseOverdue`, `executeProcessBill`, `executeTrackSubscriptions`, `executePrepareMonthEnd` |
| `server/services/sdrService.ts` (NEW) | `executeDiscoverProspects`, `executeDraftOutbound`, `executeScoreLead`, `executeBookMeeting` |
| `server/services/retentionSuccessService.ts` (NEW) | `executeScoreNpsCsat`, `executePrepareRenewalBrief` |

Stub semantics:
- Handlers that wrap external providers (`send_invoice`, `reconcile_transactions`, `chase_overdue`, `track_subscriptions`, `discover_prospects`, `book_meeting`) — when the relevant provider is not configured, return `{ status: 'not_configured', warning, data: null }` for `sideEffectClass: 'read'` skills, or `{ status: 'blocked', reason: 'provider_not_configured', requires: ['STRIPE_API_KEY' | ...] }` for `sideEffectClass: 'write'` skills.
- Handlers that synthesise text via the LLM (`draft_outbound`, `prepare_renewal_brief`, `prepare_month_end`) — call `routeCall` from `llmRouter.ts` with the agent's configured model. No new infrastructure.

### 9.2 `executeListMySubordinates` (the only foundational new handler)

Builds on the existing `computeDescendantIds` utility in `server/tools/config/configSkillHandlersPure.ts`. Inputs:

```ts
parameterSchema: z.object({
  scope: z.enum(['children', 'descendants']).optional().default('children'),
})
```

Returns:

```ts
{
  success: true,
  scope: 'children' | 'descendants',
  agents: Array<{
    slug: string;
    name: string;
    title: string | null;
    role: string | null;          // 'manager' | 'analyst' | etc., or null
    isActive: boolean;
  }>,
}
```

Logic:
1. From `context.agentId`, look up the corresponding `system_agents` row by `agentSystemId`.
2. Resolve children via `system_agents.parent_system_agent_id = <self>` (children) or descendants via DFS up to depth 3.
3. Filter by `deleted_at IS NULL` and `status = 'active'`.

The skill is `sideEffectClass: 'none'` and `idempotencyStrategy: 'read_only'` — no idempotency-key writes, no audit-row write beyond the one `executeWithActionAudit` already emits.

### 9.3 `executeWithActionAudit` extensions

The wrapper sits at `server/services/skillExecutor.ts:1881`. Two extensions:

#### 9.3.1 Cross-run idempotency (when `idempotency.keyShape` is declared)

Inserted **before** `actionService.lockForExecution` and **after** `proposeAction` returns `auto`-approved status:

```ts
const def = getActionDefinition(actionType);
if (def?.idempotency) {
  const requestHash = hashActionArgs(input);  // existing utility
  const keyHash = hashKeyShape(def.idempotency.keyShape, input);  // NEW pure helper

  // First-writer-wins INSERT
  const insertResult = await db.execute(sql`
    INSERT INTO skill_idempotency_keys
      (subaccount_id, organisation_id, skill_slug, key_hash, request_hash, status, expires_at)
    VALUES (
      ${context.subaccountId},
      ${context.organisationId},
      ${actionType},
      ${keyHash},
      ${requestHash},
      'in_flight',
      ${ttlClassToExpiresAt(def.idempotency.ttlClass)}
    )
    ON CONFLICT (subaccount_id, skill_slug, key_hash) DO NOTHING
    RETURNING xmax = 0 AS is_first_writer
  `);

  const isFirstWriter = (insertResult.rows[0] as { is_first_writer?: boolean })?.is_first_writer === true;

  if (!isFirstWriter) {
    // Read existing row
    const [existing] = await db.select()
      .from(skillIdempotencyKeys)
      .where(and(
        eq(skillIdempotencyKeys.subaccountId, context.subaccountId),
        eq(skillIdempotencyKeys.skillSlug, actionType),
        eq(skillIdempotencyKeys.keyHash, keyHash),
      ))
      .limit(1);

    if (existing.requestHash !== requestHash) {
      createEvent('skill.error', { skillName: actionType, reason: 'idempotency_collision' }, { level: 'ERROR' });
      return { status: 'idempotency_collision', error: 'Same idempotency key with different request hash' };
    }

    if (existing.status === 'completed') {
      createEvent('skill.idempotency.hit', { skillName: actionType, key_hash: keyHash });
      return existing.responsePayload;
    }

    if (existing.status === 'in_flight') {
      // Another caller is currently executing — return a structured signal
      return { status: 'in_flight', message: 'Another caller is processing this idempotent request' };
    }

    // status === 'failed' — caller may retry by submitting a new key (handler decision)
    return { status: 'previous_failure', error: 'Prior attempt failed' };
  }

  // First writer wins — proceed with execution; write response_payload + status='completed' on success
}
```

After the executor runs, the wrapper persists the result:

```ts
if (def?.idempotency && isFirstWriter) {
  await db.update(skillIdempotencyKeys)
    .set({
      responsePayload: result,
      status: resultObj?.success ? 'completed' : 'failed',
    })
    .where(/* same primary key */);
}
```

#### 9.3.2 Side-effect-class wrapper (`sideEffectClass`)

Inserted **before** the executor runs, **after** action-record creation:

```ts
if (def?.sideEffectClass === 'write') {
  // Validate config presence — handler-specific; the wrapper provides
  // a hook the handler can implement via a thin "checkPreconditions" function.
  // If not configured, return { status: 'blocked', reason } before any side effect.
  const preconditions = await checkSkillPreconditions(actionType, input, context);
  if (preconditions.status === 'blocked') {
    createEvent('skill.blocked', {
      skillName: actionType, reason: preconditions.reason, provider: preconditions.provider, requires: preconditions.requires,
    }, { level: 'INFO' });
    return preconditions;  // { status: 'blocked', reason, provider, requires }
  }
}

if (def?.sideEffectClass === 'read') {
  // Read skills run normally; if the handler returns { status: 'not_configured' | 'transient_error' },
  // the wrapper logs skill.warn and propagates the structured warning unchanged.
}
```

The `checkSkillPreconditions` hook is a small new function that dispatches per skill (similar to the existing executor pattern). Most write skills only need to confirm an env var or integration-connection row exists.

#### 9.3.3 Failure-mode logging

Per §18 logging contract:
- Read fail-soft → `skill.warn` (WARN level).
- Expected blocked write (config missing, validation failed) → `skill.blocked` (INFO level — never paged).
- Hard failure / contract violation → `skill.error` (ERROR level — paged).
- Idempotency cache hit → `skill.idempotency.hit`.
- Idempotency collision → `skill.error` with `reason: 'idempotency_collision'`.

### 9.4 Manager-role guard (in `proposeActionMiddleware`)

**`server/services/middleware/proposeAction.ts`** (MODIFIED) — extend the existing pre-tool middleware. The check runs **after** scope validation and **before** `proposeAction()`:

```ts
// Manager-role guard (v7.1) ---------------------------------------------
const agentRole = await resolveAgentRole(context.agentId);  // reads system_agents.agent_role via cache
if (agentRole === 'manager') {
  const def = getActionDefinition(toolSlug);
  const allowed =
    def?.managerAllowlistMember === true ||
    isPerManagerDeclaredRead(toolSlug, context.agentId);

  if (!allowed || def?.directExternalSideEffect === true) {
    await writeSecurityEvent({
      ...auditFields,
      decision: 'deny',
      reason: def?.directExternalSideEffect ? 'manager_direct_external_side_effect' : 'manager_role_violation',
    });
    return { action: 'block', reason: 'manager_role_violation' };
  }
}
```

`isPerManagerDeclaredRead(toolSlug, agentId)` is a small lookup that resolves the manager's `defaultSystemSkillSlugs` (from `system_agents`) and returns true iff `toolSlug` is in that list. This lets per-manager domain reads (e.g. `read_codebase` for the CTO, `read_revenue` for the CRO) pass even though they are not universally `managerAllowlistMember: true`.

The guard returns `{ action: 'block', reason: 'manager_role_violation' }` — the existing middleware-block surface. The agent observes the block as a normal denial; no exception is thrown.

### 9.5 Worker-adapter case removal

In `registerAdapter('worker', ...)` (top of `skillExecutor.ts`), the `case 'update_financial_record'` line is removed. The handler `executeFinancialRecordUpdateApproved` is also removed from the file (it has no other call sites). If `tsc` reports the function as unused, this is the expected effect of the v7.1 finance rescope.

### 9.6 Verification

- `npm run typecheck` passes.
- `npm run lint` passes.
- `bash scripts/verify-no-silent-failures.sh` passes (the new wrapper paths emit structured logs, not silent returns).
- Manual test: invoke `draft_post` from a `head-of-growth` test run → wrapper returns `{ action: 'block', reason: 'manager_role_violation' }`.
- Manual test: invoke `send_invoice` twice with the same `(engagement_id, billing_period_start, billing_period_end)` → second call returns the cached payload with `skill.idempotency.hit` log.

---

## 10. Phase 5 — Agent file changes (7 new + 13 reparents + finance rescope)

### 10.1 Seven new `AGENTS.md` folders

Path shape: `companies/automation-os/agents/<slug>/AGENTS.md`. Frontmatter follows the existing pattern (e.g. `companies/automation-os/agents/orchestrator/AGENTS.md`). The four department heads share the same shape; admin-ops and the two new workers vary by skill list and gate.

#### 10.1.1 `head-of-product-engineering`

```yaml
---
name: Head of Product Engineering
title: CTO — Coordinates the build pipeline (BA → Dev → QA → KM)
slug: head-of-product-engineering
role: manager
reportsTo: orchestrator
model: claude-sonnet-4-6
temperature: 0.3
maxTokens: 8192
schedule: on-demand
gate: auto
tokenBudget: 9000
maxToolCalls: 12
skills:
  - read_workspace
  - write_workspace
  - list_my_subordinates
  - spawn_sub_agents
  - reassign_task
  - create_task
  - move_task
  - update_task
  - add_deliverable
  - request_approval
  - read_codebase
---
```

Body: master prompt encoding the manager pattern (vet → decompose → pick subordinate → delegate → aggregate → report) per master brief §10. The prompt drafting itself is implementation work, not spec scope (per §2 out-of-scope).

#### 10.1.2 `head-of-growth`

Same shape; `reportsTo: orchestrator`; skills add `read_campaigns`, `read_analytics` (drop `read_codebase`).

#### 10.1.3 `head-of-client-services`

Same shape; `reportsTo: orchestrator`; skills are the manager bundle only (no per-domain reads beyond the bundle).

#### 10.1.4 `head-of-commercial`

Same shape; `reportsTo: orchestrator`; skills add `read_revenue`, `read_crm`.

#### 10.1.5 `admin-ops-agent`

```yaml
---
name: Admin-Ops Agent
title: Back-office operations — invoicing, AR/AP, reconciliation, month-end
slug: admin-ops-agent
role: staff
reportsTo: orchestrator
model: claude-sonnet-4-6
temperature: 0.2
maxTokens: 4096
schedule: on-demand
gate: review
tokenBudget: 25000
maxToolCalls: 20
skills:
  - read_workspace
  - write_workspace
  - read_revenue
  - read_expenses
  - generate_invoice
  - send_invoice
  - reconcile_transactions
  - chase_overdue
  - process_bill
  - track_subscriptions
  - prepare_month_end
  - send_email
  - request_approval
  - move_task
  - update_task
  - add_deliverable
---
```

Body per master brief §14 — includes "Must not" rules about payment initiation and accounting-record direct edits.

#### 10.1.6 `retention-success-agent`

```yaml
---
name: Retention/Success Agent
title: Proactive retention, churn-risk scoring, NPS/CSAT, renewal prep, client reporting
slug: retention-success-agent
role: worker
reportsTo: head-of-client-services
model: claude-sonnet-4-6
temperature: 0.3
maxTokens: 4096
schedule: on-demand
gate: review
tokenBudget: 25000
maxToolCalls: 20
skills:
  - read_workspace
  - write_workspace
  - move_task
  - update_task
  - add_deliverable
  - request_approval
  - detect_churn_risk
  - score_nps_csat
  - prepare_renewal_brief
  - draft_report
  - deliver_report
  - send_email
---
```

Body per master brief §21. **`detect_churn_risk`** is correct. `detect_churn_risk` (engagement-signal scorer, wired to crm-pipeline-agent and retention-success-agent) and `compute_churn_risk` (portfolio-level churn model, wired to portfolio-health-agent only) are two distinct existing skills with different runtime paths — confirmed in master brief Appendix A.

#### 10.1.7 `sdr-agent`

```yaml
---
name: SDR Agent
title: Outbound prospecting, lead qualification, meeting booking
slug: sdr-agent
role: worker
reportsTo: head-of-commercial
model: claude-sonnet-4-6
temperature: 0.4
maxTokens: 4096
schedule: on-demand
gate: review
tokenBudget: 25000
maxToolCalls: 20
skills:
  - read_workspace
  - write_workspace
  - move_task
  - update_task
  - add_deliverable
  - request_approval
  - discover_prospects
  - web_search
  - enrich_contact
  - draft_outbound
  - score_lead
  - book_meeting
  - send_email
  - update_crm
---
```

Body: standard worker pattern. Boundary statement vs Email Outreach (per master brief §1): SDR handles 1:1 prospecting with reply handling; Email Outreach handles nurture, broadcast, newsletter sequences.

### 10.2 Thirteen reparents

Edit one line in each existing `companies/automation-os/agents/<slug>/AGENTS.md` — `reportsTo:` switches from `orchestrator` to the new T2 head. No body changes.

| Agent slug | New `reportsTo` |
|-----------|-----------------|
| `business-analyst` | `head-of-product-engineering` |
| `dev` | `head-of-product-engineering` |
| `qa` | `head-of-product-engineering` |
| `knowledge-management-agent` | `head-of-product-engineering` |
| `social-media-agent` | `head-of-growth` |
| `ads-management-agent` | `head-of-growth` |
| `email-outreach-agent` | `head-of-growth` |
| `content-seo-agent` | `head-of-growth` |
| `support-agent` | `head-of-client-services` |
| `onboarding-agent` | `head-of-client-services` |
| `finance-agent` | `head-of-commercial` |
| `crm-pipeline-agent` | `head-of-commercial` |

(Twelve listed; the thirteenth is the `finance-agent` skill drop in §10.3.)

Unchanged:
- `orchestrator` (T1, `reportsTo: null`).
- `strategic-intelligence-agent` (T2 staff, `reportsTo: orchestrator` — already correct).
- `portfolio-health-agent` (special, `reportsTo: null`).

### 10.3 Finance Agent rescope

`companies/automation-os/agents/finance-agent/AGENTS.md` — two edits in the same diff:

1. `reportsTo: orchestrator` → `reportsTo: head-of-commercial`.
2. Remove `update_financial_record` from the `skills:` list. The skill file itself was deleted in §7.6; the registry entry was removed in §8.3.

The body of the prompt should be reviewed for AR/AP/reconciliation references and trimmed to revenue analytics + anomaly detection per master brief §1 (this is a prompt edit, captured here so the implementing PR doesn't miss it; full new prompt content is out-of-scope per §2).

### 10.4 Verification

- `ls companies/automation-os/agents/` — exactly 22 folders post-§11 (16 existing − 1 retired + 7 new = 22).
- `bash scripts/verify-agent-skill-contracts.ts` (new — see §13) passes.
- All `AGENTS.md` files parse via `parseCompanyFolder` without warnings.

---

## 11. Phase 6 — Retire `client-reporting-agent`

### 11.1 Folder removal

Delete the entire folder: `companies/automation-os/agents/client-reporting-agent/`.

### 11.2 Skill files NOT deleted

`server/skills/draft_report.md` and `server/skills/deliver_report.md` are preserved. They are now wired into `retention-success-agent` (§10.1.6). No changes to those skill files.

### 11.3 DB cleanup

Handled by §13 (seed orphan cleanup) and §14 (Path A reset). Nothing to do at the file level beyond the folder deletion.

### 11.4 Stale references

Search for the slug across the repo and update any non-code references (docs, comments) that name `client-reporting-agent`:

```bash
rg -l '\bclient-reporting-agent\b'
```

The only expected non-code hits are: `companies/automation-os/automation-os-manifest.json` (regenerated in §12), `docs/automation-os-system-agents-brief-v6.md` (predecessor — no edit), and any `tasks/builds/*/progress.md` files (no edit). If any active source file references the slug, that's a missed reparent — investigate before continuing.

---

## 12. Phase 7 — Env vars + manifest regeneration

### 12.1 Env config

**`server/lib/env.ts`** (MODIFIED) — add to the Zod schema:

```ts
// Lead discovery (SDR Agent)
GOOGLE_PLACES_API_KEY: z.string().optional(),
HUNTER_API_KEY: z.string().optional(),
```

**`.env.example`** (MODIFIED) — add:

```
# Lead discovery (SDR Agent)
GOOGLE_PLACES_API_KEY=
HUNTER_API_KEY=
```

Both are optional. Handlers in `googlePlacesProvider.ts` and `hunterProvider.ts` (§7.5) gracefully degrade when absent.

### 12.2 Manifest regeneration

#### 12.2.1 New script

**`scripts/regenerate-company-manifest.ts`** (NEW) — walks `companies/automation-os/agents/*/AGENTS.md`, parses frontmatter via the existing `parseCompanyFolder`, and emits `companies/automation-os/automation-os-manifest.json` with shape:

```json
{
  "_comment": "INDEX ONLY — generated by scripts/regenerate-company-manifest.ts. Do not hand-edit.",
  "parserVersion": "1.0.0",
  "company": {
    "name": "Automation OS",
    "description": "The platform's own agent company — a 22-agent team spanning product development, customer operations, growth, finance, back-office operations, and portfolio health.",
    "slug": "automation-os",
    "schema": "agentcompanies/v1",
    "version": "7.1.0",
    "sourceOfTruth": "companies/automation-os/agents/<slug>/AGENTS.md",
    "seedScript": "scripts/seed.ts",
    "masterBrief": "docs/automation-os-system-agents-master-brief-v7.1.md",
    "agents": [ /* 22 entries with slug, name, title, reportsTo, model, schedule, gate, phase */ ]
  }
}
```

The script has two modes:
- `npx tsx scripts/regenerate-company-manifest.ts` — write the file.
- `npx tsx scripts/regenerate-company-manifest.ts --check` — exit 1 if the on-disk JSON differs from the regenerated output. Used as a seed pre-flight in §13.

#### 12.2.2 Manifest content

Driven by the regenerator — no hand-edited values to track here. The script reads frontmatter and emits the manifest. The `description`, `version`, and `masterBrief` fields are constants in the script itself (one-line edits when v7.2 lands).

### 12.3 Verification

- `npx tsx scripts/regenerate-company-manifest.ts` writes the JSON; `git diff` shows expected content.
- Re-running is idempotent; second run produces no diff.
- `npx tsx scripts/regenerate-company-manifest.ts --check` exits 0 immediately after a write; non-zero if a stray hand-edit drifts the file.

---

## 13. Phase 8 — Seed-script orphan cleanup + verification gates + assertions

### 13.1 Pre-flight extensions in `scripts/seed.ts`

The existing `preflightVerifySkillVisibility()` function runs before Phase 1. Add two more pre-flight calls to its sibling sequence:

1. **`preflightVerifyAgentSkillContracts()`** (NEW) — calls into `scripts/verify-agent-skill-contracts.ts`.
2. **`preflightVerifyManifestDrift()`** (NEW) — calls `regenerate-company-manifest.ts --check`.

Pre-flight order:

```ts
await preflightVerifySkillVisibility();      // existing
await preflightVerifyAgentSkillContracts();  // NEW
await preflightVerifyManifestDrift();        // NEW
```

Any failure aborts the seed with a clear error referencing the gate that fired.

### 13.2 New verification script

**`scripts/verify-agent-skill-contracts.ts`** (NEW) — single-file script. Logic:

1. **Read agent-skill universe.** Walk `companies/automation-os/agents/*/AGENTS.md`. Parse frontmatter via `parseFrontmatter` from `companyParser.ts`. Collect the union of all `skills:` slugs.
2. **Read the action registry.** Import `ACTION_REGISTRY` from `server/config/actionRegistry.ts`.
3. **Read the handler registry.** Import `SKILL_HANDLERS` from `server/services/skillExecutor.ts`.
4. **Read the skill-file inventory.** `readdir('server/skills/')`, filter `.md`.
5. **Assertions** (all violations collected, then printed at end; exit 1 if any):
   - For every slug in the agent-skill universe:
     - The corresponding `server/skills/<slug>.md` exists with valid frontmatter (incl. `visibility:`).
     - The slug exists as a key in `ACTION_REGISTRY`.
     - The slug exists as a key in `SKILL_HANDLERS`.
   - For every `.md` file in `server/skills/`:
     - It is referenced by at least one agent's `skills:` list, **OR** its frontmatter declares `reusable: true`.
   - For every slug in `APP_FOUNDATIONAL_SKILLS`:
     - Its `ACTION_REGISTRY` entry has `actionCategory !== 'api'`, `mcp.annotations.openWorldHint === false`, `directExternalSideEffect !== true`.

Exit 0 on no violations.

### 13.3 Phase 2/3 orphan cleanup in `scripts/seed.ts`

Append a new step in `phase3_playbookAuthor()` (so Playbook Author is in scope before the cleanup runs).

```ts
// After the Playbook Author upsert, before returning:

// v7.1 — Orphan cleanup: soft-delete any system_agents row whose slug is
// no longer in (parsed.agents.slug ∪ 'workflow-author'). Cascade soft-delete
// to the matching `agents` rows and deactivate `subaccount_agents`.

const expectedSlugs = new Set([
  ...parsed.agents.map((a) => a.slug),
  'workflow-author',
]);

// Identify orphans
const orphanSlugs = await db
  .select({ slug: systemAgents.slug, id: systemAgents.id })
  .from(systemAgents)
  .where(and(
    isNull(systemAgents.deletedAt),
    not(inArray(systemAgents.slug, [...expectedSlugs])),
  ));

if (orphanSlugs.length > 0) {
  log(`  [cleanup] soft-deleting ${orphanSlugs.length} orphan system_agents row(s): ${orphanSlugs.map((o) => o.slug).join(', ')}`);

  // Soft-delete orphan system_agents rows
  await db
    .update(systemAgents)
    .set({ deletedAt: new Date(), status: 'inactive', updatedAt: new Date() })
    .where(and(
      isNull(systemAgents.deletedAt),
      not(inArray(systemAgents.slug, [...expectedSlugs])),
    ));

  // Cascade soft-delete to agents rows that reference orphan system_agents
  const orphanIds = orphanSlugs.map((o) => o.id);
  await db
    .update(agents)
    .set({ deletedAt: new Date(), status: 'inactive', updatedAt: new Date() })
    .where(and(
      isNull(agents.deletedAt),
      eq(agents.isSystemManaged, true),
      inArray(agents.systemAgentId, orphanIds),
    ));

  // Deactivate subaccount_agents linking to those agents (uses is_active boolean)
  const orphanAgentIds = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.isSystemManaged, true), inArray(agents.systemAgentId, orphanIds)));

  if (orphanAgentIds.length > 0) {
    await db
      .update(subaccountAgents)
      .set({ isActive: false, updatedAt: new Date() })
      .where(inArray(subaccountAgents.agentId, orphanAgentIds.map((a) => a.id)));
  }
}
```

This is idempotent: if no orphans exist, the loop is a no-op.

### 13.4 Post-Phase-3 hierarchy assertion

Append to `phase3_playbookAuthor()` after the orphan cleanup:

```ts
// v7.1 — Hierarchy assertions (master brief §3 + §6)
const all = await db
  .select({
    id: systemAgents.id,
    slug: systemAgents.slug,
    parentId: systemAgents.parentSystemAgentId,
  })
  .from(systemAgents)
  .where(isNull(systemAgents.deletedAt));

// Build slug → row map
const bySlug = new Map(all.map((r) => [r.slug, r]));
const byId = new Map(all.map((r) => [r.id, r]));

// Assertion 1: exactly one root in the business team (orchestrator).
// portfolio-health-agent and workflow-author are exempt (special).
const businessRoots = all.filter(
  (r) =>
    r.parentId === null &&
    r.slug !== 'portfolio-health-agent' &&
    r.slug !== 'workflow-author',
);
if (businessRoots.length !== 1 || businessRoots[0].slug !== 'orchestrator') {
  throw new Error(
    `[hierarchy] expected exactly one business-team root 'orchestrator'; found ${businessRoots.length}: ${businessRoots.map((r) => r.slug).join(', ')}`,
  );
}

// Assertion 2: no cycles, depth ≤ 3 from any leaf.
for (const row of all) {
  if (row.slug === 'orchestrator' || row.slug === 'portfolio-health-agent' || row.slug === 'workflow-author') continue;
  let cur = row;
  let hops = 0;
  while (cur.parentId !== null) {
    if (hops >= 3) {
      throw new Error(`[hierarchy] depth > 3 from leaf '${row.slug}' — chain exceeds Orchestrator → Head → Worker`);
    }
    const parent = byId.get(cur.parentId);
    if (!parent) {
      throw new Error(`[hierarchy] '${cur.slug}' references non-existent or soft-deleted parent ${cur.parentId}`);
    }
    cur = parent;
    hops += 1;
  }
}

// Assertion 3: every non-root non-special agent has a non-null parent.
for (const row of all) {
  if (row.slug === 'orchestrator' || row.slug === 'portfolio-health-agent' || row.slug === 'workflow-author') continue;
  if (row.parentId === null) {
    throw new Error(`[hierarchy] '${row.slug}' has parent_system_agent_id = NULL but is not a designated root`);
  }
}

log('  [ok]   hierarchy assertions: 1 root, no cycles, depth ≤ 3, all parents present');
```

Failure aborts the seed with a clear error.

### 13.5 Verification

- `npm run seed` against a fresh dev DB completes Phases 1–6 with the new pre-flights green.
- Manually deleting an agent folder and re-running `npm run seed` triggers `preflightVerifyAgentSkillContracts` (because the deleted agent's skills are still referenced from the manifest) — gate fires loudly.
- Manually editing `automation-os-manifest.json` and re-running `npm run seed` triggers `preflightVerifyManifestDrift` (because regen would produce different output).
- After a full wipe + reseed, `select count(*) from system_agents where deleted_at is null` returns **23** (22 v7.1 agents + Playbook Author). Manual check after §14.

---

## 14. Phase 9 — Local-dev reset paths + rollback

### 14.1 Path A (recommended) — soft-delete state, re-seed

Fastest, cleanest, FK-safe. No seed-script changes required after Phase 8. **Prerequisite:** the `0228` migration from §6 must already be applied — without it, soft-deleted rows still occupy the slug under the old full-unique index and re-seed fails on a unique-constraint violation.

```bash
# 1. All file-on-disk changes from Phases 2–7 are merged on the working branch.

# 2. Apply the schema migration:
npm run migrate

# 3. Wipe the system-agent surface in the dev DB, FK-safely:
psql $DATABASE_URL <<'SQL'
BEGIN;

-- Deactivate subaccount-level activations linked to system-managed agents
UPDATE subaccount_agents
   SET is_active = false, updated_at = NOW()
 WHERE agent_id IN (
   SELECT id FROM agents WHERE is_system_managed = true
 );

-- Soft-delete org-level rows linked to system_agents
UPDATE agents
   SET deleted_at = NOW(), updated_at = NOW()
 WHERE is_system_managed = true AND deleted_at IS NULL;

-- Soft-delete the authoritative system_agents rows (incl. Playbook Author)
UPDATE system_agents
   SET deleted_at = NOW(), status = 'inactive', updated_at = NOW()
 WHERE deleted_at IS NULL;

COMMIT;
SQL

# 4. Re-seed. Phases 1–6 of seed.ts run; Phase 3's orphan cleanup is a no-op
#    because everything in this run is fresh.
npm run seed

# 5. Verify
psql $DATABASE_URL -c "
  SELECT count(*) FROM system_agents WHERE deleted_at IS NULL;
  -- expect: 23 (22 v7.1 + workflow-author)
"
psql $DATABASE_URL -c "
  SELECT slug FROM system_agents
  WHERE parent_system_agent_id = (
    SELECT id FROM system_agents WHERE slug = 'orchestrator' AND deleted_at IS NULL
  )
  AND deleted_at IS NULL
  ORDER BY slug;
  -- expect: 6 rows: head-of-product-engineering, head-of-growth, head-of-client-services,
  -- head-of-commercial, admin-ops-agent, strategic-intelligence-agent
"
```

The seed will recreate all 22 v7.1 agents + Playbook Author = 23 fresh rows in `system_agents` (the soft-deleted rows are ignored by the `isNull(deletedAt)` filters in `phase2_systemAgents` and `phase3_playbookAuthor`), set `parentSystemAgentId` correctly across all three tiers, and reactivate them in the Synthetos Workspace subaccount via Phase 5.

Existing `agent_runs` rows continue to satisfy the FK because the `agents` rows they reference are still present (just soft-deleted). User passwords are preserved by the seed (`upsertUser` deliberately omits `passwordHash` on update). Integration-connection placeholders use `onConflictDoNothing` and won't be re-overwritten.

> **Why not `DELETE`?** `agent_runs.agent_id` references `agents.id` with no cascade. A hard delete on a populated dev DB raises a foreign-key violation and rolls the whole transaction back — Path A then silently fails. Soft-delete is the only correct choice.

### 14.2 Path B — full DB reset

Heavier hammer. Use only if other schema drifts you want to clear are present.

```bash
dropdb $DB_NAME && createdb $DB_NAME
npm run migrate
npm run seed
```

You lose any local UI-created data (custom agents, custom prompts, etc.). Acceptable in pre-production but unnecessary if Path A is sufficient.

### 14.3 Path C — already implemented as Phase 8

The migration brief mentioned this as a deferred path; this spec lands it as Phase 8. After §13, `npm run seed` alone reaches the same end state — no manual SQL required. Path A remains documented for the migration moment because it lets the operator clearly observe the soft-delete + reseed transition; the seed-script orphan cleanup is the long-term mechanism.

### 14.4 Rollback

Even pre-prod, keep an exit:

```bash
# 1. Revert the branch
git checkout main
git branch -D claude/audit-system-agents-46kTN  # or your branch

# 2. Run the same wipe SQL (Path A step 3) and re-seed from main
psql $DATABASE_URL < <( /* same wipe SQL as §14.1 step 3 */ )
npm run seed
```

The seed is idempotent against any prior agent state, so reverting the file changes and re-seeding is a clean rollback. Custom (non-system-managed) agents in the dev org are protected by the existing `existingCustomAgents` guard in `activateBaselineSystemAgents` (Phase 5).

> **Note on the `0228` migration in rollback:** the partial-unique indexes are forward-compatible with the v6 state — a v6 seed against a DB with the partial indexes works correctly because no soft-deleted rows yet exist. No down-migration is required for rollback.

---

## 15. Contracts (data shapes crossing service boundaries)

### 15.1 `skill_idempotency_keys` row

| Field | Type | Producer | Consumer | Nullability / default |
|-------|------|----------|----------|------------------------|
| `subaccount_id` | uuid | `executeWithActionAudit` wrapper | wrapper (replay path) | NOT NULL |
| `organisation_id` | uuid | wrapper | RLS policy | NOT NULL |
| `skill_slug` | text | wrapper | wrapper | NOT NULL — equals registry slug |
| `key_hash` | text | wrapper | wrapper | NOT NULL — SHA-256 hex of canonicalised key tuple per registry `idempotency.keyShape` |
| `request_hash` | text | wrapper | wrapper | NOT NULL — SHA-256 hex of full request payload |
| `response_payload` | jsonb | wrapper (post-execute) | wrapper (replay) | DEFAULT `'{}'::jsonb` until first writer completes |
| `status` | text CHECK | wrapper | wrapper | DEFAULT `'in_flight'`; transitions to `'completed'` or `'failed'` |
| `created_at` | timestamptz | wrapper | telemetry | DEFAULT `NOW()` |
| `expires_at` | timestamptz | wrapper | cleanup job | NULL (permanent) / NOW()+30d (long) / NOW()+14d (short) |

**Worked example — `send_invoice`:**

```json
{
  "subaccount_id": "f8b0c5b8-...",
  "organisation_id": "0f3a-...",
  "skill_slug": "send_invoice",
  "key_hash": "e3b0c44...:invoice-INV-2026-04-001",
  "request_hash": "a1b2c3...full-payload-hash",
  "response_payload": {
    "success": true,
    "invoice_id": "INV-2026-04-001",
    "delivered_at": "2026-04-26T14:22:00Z",
    "channel": "stripe"
  },
  "status": "completed",
  "created_at": "2026-04-26T14:21:58Z",
  "expires_at": null
}
```

### 15.2 Manager-role-violation block response

Returned by `proposeActionMiddleware` as the `PreToolResult.action: 'block'` payload:

```ts
{
  action: 'block',
  reason: 'manager_role_violation' | 'manager_direct_external_side_effect',
  details: {
    skill: 'draft_post',
    agent_role: 'manager',
    agent_slug: 'head-of-growth',
  }
}
```

The agent observes this as a denied tool call, not an exception. Manager prompts are written to expect this surface and route the work to a worker via `reassign_task` instead.

### 15.3 Side-effect-class `blocked` response

Returned by `executeWithActionAudit` when `sideEffectClass: 'write'` and preconditions fail:

```ts
{
  status: 'blocked',
  reason: 'provider_not_configured' | 'validation_failed' | 'auth_missing',
  provider: 'stripe' | 'gmail' | 'hunter' | 'google_places' | null,
  requires?: ['STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET'],
}
```

### 15.4 Side-effect-class `partial` response

Returned by handlers that touch multiple resources and can land in an intermediate state:

```ts
{
  status: 'partial',
  completed_steps: ['stripe_invoice_created'],
  remaining_steps: ['email_delivered'],
  recovery: 'A board task has been created at <task_id> with explicit recovery instructions.',
}
```

The wrapper auto-creates the recovery task via the existing `taskService.createTask` primitive when it sees `status: 'partial'`.

---

## 16. Permissions / RLS posture for new tenant-scoped tables

### 16.1 `skill_idempotency_keys`

The only new tenant-scoped table. Posture per the four checklist items in `docs/spec-authoring-checklist.md` §4:

1. **RLS policy in same migration that creates the table** — yes, see §6.1 (`CREATE POLICY tenant_isolation_skill_idempotency_keys`).
2. **Entry in `server/config/rlsProtectedTables.ts`** — yes, see §6.3.
3. **Route-level guard** — n/a; the table is never accessed via HTTP. Read/write only by the in-process `executeWithActionAudit` wrapper, which runs inside `withOrgTx` (the agent execution path is already principal-scoped per `architecture.md §1116`).
4. **Principal-scoped context** — yes, by inheritance: agent execution runs inside `withPrincipalContext` which sets `app.organisation_id`. The wrapper does not need to manage the session var explicitly.

### 16.2 No new HTTP routes

This spec adds no new HTTP routes. All new behaviour is reachable only via the agent skill-execution path, which is already gated by:
- Authentication (existing JWT middleware).
- `requirePermission(key)` per route.
- `resolveSubaccount` for subaccount-scoped agents.
- `withOrgTx` for the org-scoped DB session.

No new permission keys are introduced.

### 16.3 No new HTTP-accessible operations

The cleanup of expired `skill_idempotency_keys` rows runs as a daily pg-boss job (registered in `server/jobs/index.ts`). This is a backend job, not an HTTP route — same posture as every other ledger-cleanup job in the codebase.

---

## 17. Execution model

Per `docs/spec-authoring-checklist.md` §5, this spec must pick the execution model explicitly for each cross-boundary operation it introduces.

| Operation | Model | Why |
|-----------|-------|-----|
| Skill handler invocation (all 14 new) | **Inline / synchronous** | Existing convention — `executeWithActionAudit` runs synchronously inside the agent loop. No new pg-boss job rows. |
| `skill_idempotency_keys` write | **Inline / synchronous** | First-writer-wins INSERT must complete before the side effect runs; cannot be enqueued. |
| `skill_idempotency_keys` cleanup | **Queued (pg-boss daily)** | Durable, survives restarts. New job `skillIdempotencyKeysCleanupJob` registered in `server/jobs/index.ts`. Runs once per day; deletes rows where `expires_at < NOW()`. |
| `regenerate-company-manifest.ts --check` (pre-flight) | **Inline / synchronous** | Pre-flight runs before Phase 1 of `seed.ts`. Aborts on drift. |
| `verify-agent-skill-contracts.ts` (pre-flight) | **Inline / synchronous** | Same as above. |
| Manager-role guard | **Inline / synchronous** | Per-tool-call middleware. Inherits the existing pre-tool middleware execution model. |

**No prompt-partition / cache-tier work** in this spec. The agent prompts for the 7 new agents inherit the existing prompt-assembly model (system prompt → org overlay → run-time context). No partition changes.

---

## 18. Logging contract for new skills

Every new skill handler must emit structured logs at the standard tag points (the existing logging infra treats tagged logs as metrics). All tags are pre-existing in the codebase except `skill.idempotency.hit` (new), which is consumed by the wrapper.

| Event | Tag | Required fields | Level |
|-------|-----|------------------|-------|
| Skill invoked | `skill.invoke` | `slug`, `agent_slug`, `subaccount_id`, `idempotency_key` (where applicable) | INFO |
| External call started | `skill.external.start` | `slug`, `provider` (`google_places`, `hunter`, `stripe`, `xero`, etc.), `endpoint` | INFO |
| External call succeeded | `skill.external.success` | `slug`, `provider`, `latency_ms`, `result_count` (where applicable) | INFO |
| Read fail-soft (transient error or missing config) | `skill.warn` | `slug`, `reason`, `provider`, `retryable: bool` | **WARN** |
| Expected blocked write (config missing, validation failed, auth missing) | `skill.blocked` | `slug`, `reason`, `provider`, `requires` | **INFO** (never paged) |
| Hard failure (write skill that should have blocked but didn't, or any contract violation) | `skill.error` | `slug`, `reason`, full context | **ERROR** (paged) |
| Idempotency hit (replay returned cached result) | `skill.idempotency.hit` | `slug`, `key_hash` | INFO |
| Idempotency collision (same key, different request hash) | `skill.error` | `slug`, `reason: 'idempotency_collision'`, both hashes | **ERROR** (paged) |

Fail-soft on a **read** skill emits `skill.warn`. An *expected* blocked write (the §15.3 must-block path — config missing, no auth, validation rejected) emits `skill.blocked` at INFO level. Only contract violations and unexpected failures emit `skill.error`. The split prevents the alerting layer from paging on every "Stripe API key not configured" event during local dev.

---

## 19. Phase sequencing — dependency graph

| Phase | Schema introduces | Code introduces | Code modifies | Schema referenced by code |
|-------|-------------------|-----------------|---------------|----------------------------|
| 1 | `system_agents_slug_active_idx`, `agents_org_slug_active_uniq`, `skill_idempotency_keys`, RLS policy | — | `systemAgents.ts`, `agents.ts`, `index.ts`, `rlsProtectedTables.ts` | `skill_idempotency_keys` (used in Phase 4) |
| 2 | — | 14 skill `.md` files (no code) | `scripts/lib/skillClassification.ts`, `scripts/verify-skill-visibility.ts` | — |
| 3 | — | — | `server/config/actionRegistry.ts` (interface + 14 entries + backfill + `update_financial_record` removal) | — |
| 4 | — | `server/services/leadDiscovery/{hunter,googlePlaces}Provider.ts`, `server/services/{adminOpsService,sdrService,retentionSuccessService}.ts` | `server/services/skillExecutor.ts` (handlers + wrapper extensions), `server/services/middleware/proposeAction.ts` (manager guard) | `skill_idempotency_keys` |
| 5 | — | 7 new `AGENTS.md` folders | 13 existing `AGENTS.md` files (`reportsTo:` line); `finance-agent` skill drop | — |
| 6 | — | — | (delete `client-reporting-agent/` folder) | — |
| 7 | — | `scripts/regenerate-company-manifest.ts` | `server/lib/env.ts`, `.env.example`, `companies/automation-os/automation-os-manifest.json` | — |
| 8 | — | `scripts/verify-agent-skill-contracts.ts` | `scripts/seed.ts` (pre-flight + orphan cleanup + hierarchy assertion) | `system_agents`, `agents`, `subaccount_agents` (cleanup); `skill_idempotency_keys` schema referenced for typecheck |
| 9 | — | — (operations only) | — | — |

**No backward dependencies.** Every "code referenced by" arrow points forward. Phase 4 reads the `skill_idempotency_keys` table created in Phase 1; that's the only cross-phase data dependency, and the order is correct.

**No orphaned deferrals.** Items mentioned as "deferred" in §22 are listed in §22 as Out-of-Scope, not buried in prose.

**No phase-boundary contradictions.** Phase 1 introduces all schema; subsequent phases are code-only.

---

## 20. Acceptance criteria

The migration is complete when **all** of the following hold. Numbered for traceability against the migration brief §7.

1. **22 agent folders.** `companies/automation-os/agents/` contains exactly 22 folders. `client-reporting-agent` is absent. The 7 new folders (`head-of-product-engineering`, `head-of-growth`, `head-of-client-services`, `head-of-commercial`, `admin-ops-agent`, `retention-success-agent`, `sdr-agent`) are present.
2. **Reparents applied.** Every `AGENTS.md` `reportsTo:` matches master brief §6.
3. **Skill files synced.** `server/skills/` contains the 14 new skill files; `update_financial_record.md` is deleted.
4. **Foundational classification.** `scripts/lib/skillClassification.ts` lists `list_my_subordinates` in `APP_FOUNDATIONAL_SKILLS`.
5. **Registry + handlers.** `server/config/actionRegistry.ts` and `server/services/skillExecutor.ts` register all 14 new skills with `sideEffectClass`, `idempotency.keyShape` (where applicable), and `directExternalSideEffect` populated; `update_financial_record` is removed from both.
6. **Env vars.** `server/lib/env.ts` and `.env.example` include `GOOGLE_PLACES_API_KEY` and `HUNTER_API_KEY`.
7. **Seed completes clean.** `npm run seed` succeeds with all three pre-flights green: visibility, agent-skill contracts, manifest drift.
8. **Active-row count.** After Path A reset + reseed, `select count(*) from system_agents where deleted_at is null` returns **23** (22 + Playbook Author).
9. **Roots.** `select count(*) from system_agents where parent_system_agent_id is null and slug not in ('portfolio-health-agent', 'workflow-author') and deleted_at is null` returns **1** (Orchestrator only).
10. **Direct reports of Orchestrator.** `select slug from system_agents where parent_system_agent_id = (select id from system_agents where slug = 'orchestrator' and deleted_at is null) and deleted_at is null` returns exactly **6** rows: `head-of-product-engineering`, `head-of-growth`, `head-of-client-services`, `head-of-commercial`, `admin-ops-agent`, `strategic-intelligence-agent`.
11. **Subaccount activations.** The Synthetos Workspace subaccount has `subaccount_agents` rows for all 21 subaccount-scoped agents (everything except `portfolio-health-agent`, which goes to the org subaccount).
12. **Agent ↔ skill contract.** `npx tsx scripts/verify-agent-skill-contracts.ts` exits 0; every skill in every `AGENTS.md` resolves to a `.md` file, an `ACTION_REGISTRY` entry, and a `SKILL_HANDLERS` handler.
13. **Hierarchy invariants.** Post-seed assertion passes: exactly one business-team root (Orchestrator), no cycles, depth ≤ 3, all parents non-deleted (§13.4 logic).
14. **Side-effect classification.** Every new write skill has `sideEffectClass: 'write'` in its registry entry; the `executeWithActionAudit` wrapper enforces fail-soft vs must-block by class.
15. **Idempotency wiring.** Every new write skill declares `idempotency.keyShape` in its registry entry; manual replay test (invoking `send_invoice` twice with the same key tuple) confirms second invocation returns cached result.
16. **Manager guard.** Manual test: invoking `draft_post` from a `head-of-growth` test run returns `{ action: 'block', reason: 'manager_role_violation' }`.
17. **Manifest JSON.** `companies/automation-os/automation-os-manifest.json` is at `version: "7.1.0"` with all 22 agents listed, `reportsTo` matching frontmatter, and `masterBrief` pointing at `docs/automation-os-system-agents-master-brief-v7.1.md`.
18. **Foundational-skill self-containment.** Every skill in `APP_FOUNDATIONAL_SKILLS` declares no external integration in its registry entry (verified by extended `verify-skill-visibility.ts`).
19. **No orphan skills.** Every skill `.md` file in `server/skills/` is referenced by at least one agent's `AGENTS.md` `skills:` list **OR** carries `reusable: true` in its own frontmatter.
20. **No orphan agents.** Every active `system_agents` row except `orchestrator`, `portfolio-health-agent`, and `workflow-author` has a non-null `parent_system_agent_id` referencing another active row.
21. **Active-row uniqueness.** `\d+ system_agents` shows `system_agents_slug_active_idx` and `\d+ agents` shows `agents_org_slug_active_uniq` — both as `WHERE (deleted_at IS NULL)` partial uniques.
22. **RLS coverage.** `bash scripts/verify-rls-coverage.sh` exits 0; `skill_idempotency_keys` is in `RLS_PROTECTED_TABLES` and has a matching `CREATE POLICY` in `0228`.
23. **Static gates.** `npm run typecheck`, `npm run lint`, all `scripts/verify-*.sh` (relevant set) exit 0.

---

## 21. Deferred items

### Deferred-from-this-spec

- **Master prompts for the 4 manager agents and 3 new workers.** Drafted in the implementing PR per master brief §10–§14, §21, §29. Each prompt encodes the manager pattern (vet → decompose → pick subordinate → delegate → aggregate → report) for the heads, and the standard worker pattern for the others. Reason: prompt drafting is implementation work, not architectural decision.
- **Stripe / Xero real integration for admin-ops handlers.** Handlers stub at first (per §9.1); real provider plumbing is its own piece of work. Reason: provider integration scope spans OAuth flows, webhook handlers, and reconciliation logic far beyond the v7.1 migration's blast radius.
- **Master brief sections 14–22 + Appendices A–F.** ~~Pending capture.~~ Resolved — user provided full master brief; `docs/automation-os-system-agents-master-brief-v7.1.md` rewritten with all 22 agents + Appendices A–F.
- **Content/SEO + Social Media merge investigation.** Master brief Appendix F flags this for evaluation based on combined skill count and context-window impact. Out-of-scope here.

### Deferred-from-master-brief

- **Hierarchy infrastructure plumbing from v7.1 Appendix E** — `parentAgentId` on `SkillExecutionContext`, scope param on `config_list_agents`, parent-scoping in `spawn_sub_agents` / `reassign_task` for child-only delegation routing. Tracked at `docs/hierarchical-delegation-dev-brief.md`. **NOT** the same as the manager-role guard in §9.4 (which IS in scope and lands in this migration).
- **Workstream B (`canonical_prospect_profiles` extension)** for the SDR agent. If unshipped when SDR goes live in Phase 5, the prospect-profile write at the SDR handler stubs with a TODO and proceeds. Reason: Workstream B is a separate canonical-data spec; not a blocker.

> The deferred items above are listed here, not buried in prose elsewhere in the spec, per `docs/spec-authoring-checklist.md` §7.

---

## 22. Out of scope

- Deeper hierarchy enforcement plumbing from v7.1 Appendix E (see §21).
- Content/SEO + Social Media merge investigation (v7.1 Appendix F).
- The actual master prompts for the 4 manager agents and 3 new workers (see §21).
- Admin-Ops Stripe/Xero real integration (see §21).
- New HTTP routes, new permission keys, new auth surfaces.
- New frontend / UI changes — this spec is backend-only.
- New test categories (vitest, supertest, E2E) — testing posture is `static_gates_primary` per `docs/spec-context.md`.
- Feature flags or staged rollout — pre-prod, single-PR landing.
- Backwards-compatibility shims — pre-prod allows breaking changes.

---

## 23. Testing posture

Per `docs/spec-context.md` (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`):

- **Static gates** (binding): `npm run typecheck`, `npm run lint`, all `scripts/verify-*.sh` referenced in §6.5 / §7.7 / §8.4 / §9.6 / §13.5.
- **Pure-function unit tests** (recommended): tsx tests for the new pure helpers introduced in this spec — `hashKeyShape`, `ttlClassToExpiresAt`, the manager-allowlist resolver. Land in `server/services/__tests__/skillIdempotencyKeysPure.test.ts` and `server/services/__tests__/managerGuardPure.test.ts`. Convention: `.test.ts` next to the pure module.
- **Manual end-to-end tests** (one-off, recorded in PR description):
  - Manager-guard happy path + violation path (one of each).
  - Idempotency replay test — `send_invoice` twice; verify cached payload.
  - Pre-flight gate fires when `client-reporting-agent` folder is restored without restoring the registry entry.
- **NO new vitest / jest / playwright / supertest suites.** Per framing assumption.

---

## 24. Cross-references

- **Master brief:** `docs/automation-os-system-agents-master-brief-v7.1.md` (§§1–13 captured; §§14–22 + Appendices A–F pending).
- **Migration brief:** `docs/automation-os-system-agents-v7.1-migration-brief.md` (the source of this spec's structural decisions).
- **Predecessor master brief:** `docs/automation-os-system-agents-brief-v6.md` (carry-forward reference for agents 14–22 until the v7.1 capture is complete).
- **Spec context:** `docs/spec-context.md` (framing assumptions consumed by `spec-reviewer`).
- **Spec-authoring checklist:** `docs/spec-authoring-checklist.md` (§§1–9; this spec self-checked against the checklist).
- **Architecture:** `architecture.md` § "Row-Level Security — Three-Layer Fail-Closed Data Isolation", § "Canonical RLS session variables (hard rule)", § "Key files per domain".
- **Lead-discovery dev brief:** `docs/dev-briefs/sdr-lead-discovery.md` — referenced by master brief §1 and migration brief §5. **Not present on disk at spec-authoring time** (2026-04-26). The §7.5 / §8.2 plumbing for `discover_prospects` + Hunter / Places providers is fully specified in this spec without it; if the implementing PR encounters open questions on the SDR provider plumbing, surface them to the user rather than blocking on the missing dev brief.
- **Hierarchy infrastructure dev brief (deferred):** `docs/hierarchical-delegation-dev-brief.md`.
- **Seed pipeline:** `scripts/seed.ts`.
- **Skill classification:** `scripts/lib/skillClassification.ts`.
- **Action registry:** `server/config/actionRegistry.ts`.
- **Skill handler dispatch:** `server/services/skillExecutor.ts` (`SKILL_HANDLERS`, `executeWithActionAudit`).
- **Pre-tool middleware:** `server/services/middleware/proposeAction.ts`.
- **RLS manifest:** `server/config/rlsProtectedTables.ts`.
- **Universal-skills list:** `server/config/universalSkills.ts`.
