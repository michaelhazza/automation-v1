---
title: Agent Coworker Features — Development Specification
date: 2026-04-11
status: ready-for-implementation
supersedes: docs/agent-coworker-features-brief.md
---

# Agent Coworker Features — Development Specification

> **Status:** ready-for-implementation. Spec-level decisions are baked in. Development starts on a fresh branch cut from main.
> **Supersedes:** `docs/agent-coworker-features-brief.md` (the originating brief — read it for rationale and history)
> **Upstream dependency resolved:** Skills-to-DB migration is complete (migrations 0097–0099 landed on main 2026-04-11). All five features are unblocked.

---

## Table of Contents

1. [Context & Current State](#1-context--current-state)
2. [Feature 1 — Ops Dashboard](#2-feature-1--ops-dashboard)
3. [Feature 2 — Prioritized Work Feed](#3-feature-2--prioritized-work-feed)
4. [Feature 3 — Skill Studio](#4-feature-3--skill-studio)
5. [Feature 4 — Slack Conversational Surface](#5-feature-4--slack-conversational-surface)
6. [Feature 5 — Cross-Agent Memory Search](#6-feature-5--cross-agent-memory-search)
7. [Build Sequence & Implementation Plan](#7-build-sequence--implementation-plan)
8. [Testing Strategy](#8-testing-strategy)
9. [CI Gate Requirements](#9-ci-gate-requirements)

---

## 1. Context & Current State

### What changed since the brief was written

The brief (2026-04-11) flagged the skills-from-files-to-DB migration as the sole blocking dependency for Feature 3. That migration is now **complete**. The relevant migrations are:

| Migration | Content |
|---|---|
| `0097_system_skills_db_backed.sql` | Adds `visibility` and `handler_key` columns to `system_skills`. Establishes the `handlerKey = slug` invariant. |
| `0098_skill_analyzer_v2_columns.sql` | Creates `agent_embeddings` table. Adds `agentProposals`, `proposedMergedContent`, `originalProposedMerge`, `userEditedMerge`, `candidateContentHash` to `skill_analyzer_results`. Drops `matchedSystemSkillSlug` and `matchedSkillName`. |
| `0099_skill_analyzer_merge_updated_at.sql` | Minor: `updatedAt` on merge records. |

`systemSkillService` is now DB-backed. `server/skills/*.md` files are a seed source only. The backfill script (`scripts/backfill-system-skills.ts`) has been run. All active system skills are in `system_skills`. Every active row has a `handlerKey` wired to a TypeScript handler in `skillExecutor.ts`'s `SKILL_HANDLERS` map, enforced at server boot by `validateSystemSkillHandlers()`.

### Next migration sequence number

Migrations 0097–0099 are the last shipped. This spec allocates the following sequence:

| Number | Feature | Purpose |
|---|---|---|
| 0100 | Feature 2 | `priority_feed_claims` — optimistic claim locks for feed entries |
| 0101 | Feature 3 | `skill_versions` — immutable version history for skills |
| 0102 | Feature 4 | `slack_conversations` — thread → agent conversation mapping |
| 0103 | Feature 4 | `users.slack_user_id` column — Slack user ↔ org user linkage |

### Key existing files this spec builds on

| File | Relevance |
|---|---|
| `server/db/schema/systemSkills.ts` | Skills are now DB-backed. Skill Studio reads/writes here. |
| `server/db/schema/regressionCases.ts` | Auto-captured on every HITL rejection. Skill Studio reads from this table. |
| `server/db/schema/workspaceMemories.ts` | `workspaceMemoryEntries` has `embedding vector(1536)` + HNSW index. Feature 5 searches this. |
| `server/routes/webhooks/slackWebhook.ts` | Existing multi-tenant webhook with HMAC + replay protection. TODO comment at line 113 says "Future: publish to pg-boss queue for agent processing." Feature 4 fulfils this. |
| `server/services/agentActivityService.ts` | `listRuns(filters)` — powers Feature 1's agent run panel. |
| `server/config/actionRegistry.ts` | Feature 2 and Feature 5 add entries here. |
| `server/config/universalSkills.ts` | Feature 2 and Feature 5 add their skills here. |
| `server/routes/agentRuns.ts` | Existing org-scoped agent run routes. Feature 1 adds ops-dashboard aggregation routes. |

---

## 2. Feature 1 — Ops Dashboard

**Priority:** P0 | **Effort:** Small (~1–2 days, mostly frontend) | **Schema changes:** none

### 2.1 Summary

A unified, filter-driven activity table served at three scopes (subaccount / org / system), replacing the need to bounce between `AgentRunHistoryPage`, the inbox, the review queue, and `AdminHealthFindingsPage`. The underlying primitives all exist; this feature aggregates them into one endpoint and one page component.

### 2.2 Database schema changes

None. All data comes from existing tables.

### 2.3 API routes

#### `GET /api/subaccounts/:subaccountId/ops-dashboard`

Auth: `authenticate` + `requireSubaccountAccess`. Calls `resolveSubaccount(subaccountId, orgId)`.

Query params (all optional, composable):

| Param | Type | Description |
|---|---|---|
| `type` | `string[]` | Filter by activity type. Values: `agent_run`, `review_item`, `health_finding`, `inbox_item`, `decision_log`, `playbook_run`, `task_event`, `workflow_execution` |
| `status` | `string[]` | `active`, `attention_needed`, `completed`, `failed`, `cancelled` |
| `from` | ISO date | Start of date range |
| `to` | ISO date | End of date range |
| `agentId` | uuid | Filter to a specific agent |
| `severity` | `string[]` | `critical`, `warning`, `info` |
| `assignee` | uuid | User ID filter |
| `q` | string | Free-text search (applied as ilike on subject field) |
| `sort` | `newest` \| `oldest` \| `severity` \| `attention_first` | Default: `attention_first` |
| `limit` | number | Default 50, max 200 |
| `offset` | number | Default 0 |

Response shape:

```ts
{
  items: OpsDashboardItem[];
  total: number;
  hasMore: boolean;
}

type OpsDashboardItem = {
  id: string;                 // source record id
  type: ActivityType;         // agent_run | review_item | ...
  status: NormalisedStatus;   // active | attention_needed | completed | failed | cancelled
  subject: string;            // one-line description
  actor: string;              // who/what triggered it
  subaccountId: string | null;
  subaccountName: string | null;
  agentId: string | null;
  agentName: string | null;
  severity: 'critical' | 'warning' | 'info' | null;
  createdAt: string;          // ISO
  updatedAt: string;          // ISO
  detailUrl: string;          // deep-link to the relevant detail page
};
```

#### `GET /api/ops-dashboard`

Auth: `authenticate` + `requireOrgAdmin`. Same query params as above except no `subaccountId` param (org-level returns all subaccounts). Adds:

| Param | Type | Description |
|---|---|---|
| `subaccountId` | uuid | Narrow to a specific subaccount within the org |

#### `GET /api/system/ops-dashboard`

Auth: `authenticate` + `requireSystemAdmin`. Same params as org-level. Adds:

| Param | Type | Description |
|---|---|---|
| `organisationId` | uuid | Narrow to a specific org |

### 2.4 Service layer

**New file:** `server/services/opsDashboardService.ts`

```ts
// Public API
export async function listOpsDashboardItems(
  filters: OpsDashboardFilters,
  scope: OpsDashboardScope,   // { type: 'subaccount', subaccountId, orgId }
                               // | { type: 'org', orgId }
                               // | { type: 'system', organisationId? }
): Promise<{ items: OpsDashboardItem[]; total: number }>;
```

Implementation: fan out to each data source in parallel using `Promise.all`, normalise each result into `OpsDashboardItem`, merge-sort by requested sort order, apply limit/offset. Sources:

| Source | Service call | Type tag |
|---|---|---|
| Agent runs | `agentActivityService.listRuns(filters)` | `agent_run` |
| Review items | Direct DB query on `reviewItems` | `review_item` |
| Health findings | `workspaceHealthService.listActiveFindings(orgId)` | `health_finding` |
| Agent inbox | Direct DB query on `agentInboxItems` | `inbox_item` |
| Playbook runs | `playbookRunService.listRuns(filters)` | `playbook_run` |
| Workflow executions | Direct DB query on `executions` | `workflow_execution` |

No new DB queries for tables that already have service methods. Direct DB queries only for tables without a service layer (`reviewItems`, `agentInboxItems`).

**No pure/impure split required** for v1 — aggregation logic is trivial fan-out + normalise. Add a pure helper `normaliseToOpsDashboardItem` in a sibling file if the normalisation logic gets complex.

### 2.5 Client

**New file:** `client/src/pages/OpsDashboardPage.tsx`

- Lazy-loaded with `Suspense` fallback (matches codebase convention — `client/src/App.tsx`).
- Hits the scope-appropriate endpoint based on which route rendered it.
- Single `<DataTable>` component, filter bar above, URL-persisted filter state (mirrors `ExecutionHistoryPage.tsx` pattern).
- Default filter on load: `status=attention_needed`, `sort=attention_first`.
- Each row's `detailUrl` drives the "open" action — no inline mutations in v1.
- Poll interval: 10 seconds (no WebSocket for v1).

**Router additions** (`client/src/App.tsx`):
```
/subaccounts/:id/ops           → OpsDashboardPage (subaccount scope)
/admin/ops                     → OpsDashboardPage (org scope)      ← extend /executions pattern
/system/ops                    → OpsDashboardPage (system scope)
```

The existing `/executions` and system activity routes remain unchanged. The new `/admin/ops` and `/system/ops` routes are the unified Ops view.

### 2.6 File inventory

| File | Action |
|---|---|
| `server/services/opsDashboardService.ts` | Create |
| `server/routes/opsDashboard.ts` | Create |
| `server/index.ts` | Register new router |
| `client/src/pages/OpsDashboardPage.tsx` | Create |
| `client/src/App.tsx` | Add 3 routes |

### 2.7 Implementation chunks

**Chunk A — backend (day 1):**
1. Create `opsDashboardService.ts` with `listOpsDashboardItems`.
2. Create `opsDashboard.ts` routes (3 routes, different auth middleware per scope).
3. Register router in `server/index.ts`.
4. Run `npm run typecheck` and `npm run lint`.

**Chunk B — frontend (day 1–2):**
1. Create `OpsDashboardPage.tsx` hitting the correct scoped endpoint.
2. Add 3 routes to `App.tsx`.
3. Add sidebar navigation entries under Org Admin and System Admin menus.
4. Test golden path: load page at all three scope URLs, verify filter state persistence in URL, verify "attention needed" default view.
5. Run `npm run build`.

---

## 3. Feature 2 — Prioritized Work Feed

**Priority:** P1 | **Effort:** Medium (~2–3 days) | **Schema changes:** migration 0100 (`priority_feed_claims`)

### 3.1 Summary

A scored, ranked queue of open work items that heartbeat agents consume at run start to decide what to do next. Auto-injected as a universal skill. No user-facing UI — agents are the sole consumer.

### 3.2 Database schema — migration 0100: `priority_feed_claims`

The brief initially noted "no schema changes" but the claim mechanism requires durable storage to survive process restarts and multi-node deployments. A small claims table is the correct approach.

```sql
-- migrations/0100_priority_feed_claims.sql
CREATE TABLE priority_feed_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_source    text NOT NULL,   -- 'health_finding' | 'review_item' | 'agent_inbox' | 'task' | 'playbook_run' | 'agent_run_failure'
  item_id        text NOT NULL,   -- source record's uuid (as text — heterogeneous sources)
  agent_run_id   uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL            -- now() + TTL (default 30 min)
);
CREATE UNIQUE INDEX priority_feed_claims_item_idx ON priority_feed_claims (item_source, item_id);
CREATE INDEX priority_feed_claims_expires_idx ON priority_feed_claims (expires_at);
```

Drizzle schema: `server/db/schema/priorityFeedClaims.ts`. Export from `server/db/schema/index.ts`.

Expired claims are pruned by a daily pg-boss `priority-feed-cleanup` job (registered in `server/jobs/index.ts`). On delete cascade from `agent_runs` covers the case where the run ends before the claim expires.

### 3.3 Service layer

**New file:** `server/services/priorityFeedService.ts` (impure — DB access)

```ts
export async function listFeed(
  scope: { orgId: string; subaccountId?: string; agentRunId?: string },
  opts?: { limit?: number }          // default 20
): Promise<PriorityFeedItem[]>;

export async function claimItem(
  source: string,
  itemId: string,
  agentRunId: string,
  ttlMinutes?: number                // default 30
): Promise<{ claimed: boolean; reason?: string }>;

export async function releaseItem(
  source: string,
  itemId: string,
  agentRunId: string
): Promise<void>;
```

**New file:** `server/services/priorityFeedServicePure.ts` (pure — scoring only)

```ts
export type FeedEntry = {
  source: 'health_finding' | 'review_item' | 'agent_inbox' | 'task' | 'playbook_run' | 'agent_run_failure';
  id: string;
  subaccountId: string;
  severity: 'critical' | 'warning' | 'info';
  ageHours: number;
  assignedSubaccountId?: string;   // for relevance scoring
  metadata: Record<string, unknown>;
};

export function scoreEntry(
  entry: FeedEntry,
  callerId: { subaccountId: string }
): number;                           // 0.0–1.0 composite score

export function rankFeed(entries: FeedEntry[], callerId: { subaccountId: string }): FeedEntry[];
```

Scoring formula:
```
score = severity_weight × age_factor × assignment_relevance
```
- `severity_weight`: critical=1.0, warning=0.6, info=0.3
- `age_factor`: linear ramp from 1.0 at t=0 to 2.0 at 7 days, capped at 2.0
- `assignment_relevance`: 1.0 if item's `subaccountId` matches caller's, 0.5 if org-wide, 0.1 if cross-subaccount

Return top N sorted descending by score. Exclude items with an active (non-expired) claim in `priority_feed_claims`.

### 3.4 Skill definition

**New skill** `read_priority_feed` — seeded via `createSystemSkill()` at boot or in the backfill script. Handler registered in `skillExecutor.ts`'s `SKILL_HANDLERS`.

Action registry entry (`server/config/actionRegistry.ts`):
```ts
read_priority_feed: {
  actionType: 'read_priority_feed',
  isUniversal: true,
  schema: z.discriminatedUnion('op', [
    z.object({ op: z.literal('list'), limit: z.number().int().min(1).max(50).optional() }),
    z.object({ op: z.literal('claim'), source: z.string(), itemId: z.string(), ttlMinutes: z.number().int().min(5).max(120).optional() }),
    z.object({ op: z.literal('release'), source: z.string(), itemId: z.string() }),
  ]),
}
```

Add `'read_priority_feed'` to `UNIVERSAL_SKILL_NAMES` in `server/config/universalSkills.ts`.

Handler in `server/services/skillExecutor.ts`: delegate to `priorityFeedService.listFeed` / `claimItem` / `releaseItem`, passing `agentRunId` from the execution context.

### 3.5 File inventory

| File | Action |
|---|---|
| `migrations/0100_priority_feed_claims.sql` | Create |
| `server/db/schema/priorityFeedClaims.ts` | Create |
| `server/db/schema/index.ts` | Export new schema |
| `server/services/priorityFeedService.ts` | Create |
| `server/services/priorityFeedServicePure.ts` | Create |
| `server/services/__tests__/priorityFeedServicePure.test.ts` | Create |
| `server/config/actionRegistry.ts` | Add `read_priority_feed` entry |
| `server/config/universalSkills.ts` | Add `'read_priority_feed'` |
| `server/services/skillExecutor.ts` | Add `read_priority_feed` to `SKILL_HANDLERS` |
| `server/jobs/index.ts` | Register `priority-feed-cleanup` job |
| `server/jobs/priorityFeedCleanupJob.ts` | Create |

### 3.6 Implementation chunks

**Chunk A — schema + service (day 1):**
1. Create migration 0100. Run `npm run db:generate` and verify.
2. Create `priorityFeedClaims.ts` schema. Export from index.
3. Create `priorityFeedServicePure.ts` with `scoreEntry` and `rankFeed`.
4. Write tests in `priorityFeedServicePure.test.ts` — cover: empty feed, single critical item, age ramp at 7 days, assignment relevance weighting, tie-breaking consistency.
5. Create `priorityFeedService.ts` with `listFeed`, `claimItem`, `releaseItem`.
6. Run `npm run typecheck` + `npm test`.

**Chunk B — skill wiring (day 2):**
1. Add `read_priority_feed` entry to `actionRegistry.ts`.
2. Add to `UNIVERSAL_SKILL_NAMES`.
3. Add handler to `SKILL_HANDLERS` in `skillExecutor.ts`.
4. Create cleanup job + register in `server/jobs/index.ts`.
5. Run `npm run typecheck` + `npm run lint`.

---

## 4. Feature 3 — Skill Studio

**Priority:** P1 | **Effort:** Medium–Large (~5–7 days) | **Schema changes:** migration 0101 (`skill_versions`)

### 4.1 Summary

A chat-driven authoring surface for refining skill definitions and master prompts, backed by regression capture data. Mirrors Playbook Studio. Now that skills are DB-backed, writes go directly to `system_skills` (or `skills` for org overrides) — no PR flow required.

### 4.2 Database schema — migration 0101: `skill_versions`

```sql
-- migrations/0101_skill_versions.sql
CREATE TABLE skill_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source skill — either system_skill_id or skill_id (org-tier), exactly one set
  system_skill_id uuid REFERENCES system_skills(id) ON DELETE CASCADE,
  skill_id        uuid REFERENCES skills(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  -- Full snapshot of the skill definition at this version
  name            text NOT NULL,
  description     text,
  definition      jsonb NOT NULL,
  instructions    text,
  -- Authoring context
  change_summary  text,            -- what changed and why (from skill-author agent)
  authored_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  regression_ids  uuid[] NOT NULL DEFAULT '{}',  -- regression_cases.id resolved by this version
  -- Simulation result
  simulation_pass_count   integer NOT NULL DEFAULT 0,
  simulation_total_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skill_versions_system_skill_idx ON skill_versions (system_skill_id, version_number DESC);
CREATE INDEX skill_versions_skill_idx ON skill_versions (skill_id, version_number DESC);
CHECK (
  (system_skill_id IS NOT NULL AND skill_id IS NULL) OR
  (system_skill_id IS NULL AND skill_id IS NOT NULL)
);
```

Drizzle schema: `server/db/schema/skillVersions.ts`. Export from `server/db/schema/index.ts`.

### 4.3 Studio skills (system agent tools)

The `skill-author` system agent uses these five skills:

| Skill slug | Purpose |
|---|---|
| `skill_read_existing` | Read current definition + instructions for a skill from `system_skills` or `skills` |
| `skill_read_regressions` | Query `regression_cases` filtered by `agentId` + optional `rejectedCallJson->>'name'` |
| `skill_validate` | Validate a proposed definition against Anthropic tool-definition schema + Zod rules |
| `skill_simulate` | Replay proposed skill version against captured `inputContractJson` fixtures; return pass/fail per fixture |
| `skill_propose_save` | Write new `skill_versions` row + atomically update `system_skills.definition` / `system_skills.instructions` (or `skills` row for org overrides) |

Each skill gets a row in `system_skills` via `createSystemSkill()` (same boot-time/backfill pattern as other system skills) and a handler in `SKILL_HANDLERS`.

### 4.4 `skillStudioService.ts` API

**New file:** `server/services/skillStudioService.ts`

```ts
// List all skills with their open-regression count
export async function listSkillsForStudio(
  scope: 'system' | 'org',
  orgId?: string
): Promise<SkillStudioListItem[]>;
// { id, slug, name, scope, lastVersionAt, openRegressionCount }

// Fetch full studio context for one skill: definition + versions + regressions
export async function getSkillStudioContext(
  skillId: string,
  scope: 'system' | 'org',
  orgId?: string
): Promise<SkillStudioContext>;

// Validate a proposed definition (pure shape check + handler-key check)
export async function validateSkillDefinition(
  definition: unknown,
  handlerKey: string
): Promise<{ valid: boolean; errors: string[] }>;

// Simulate proposed definition against regression fixtures
export async function simulateSkillVersion(
  proposedDefinition: object,
  proposedInstructions: string | null,
  regressionCaseIds: string[],
  orgId: string
): Promise<SimulationResult[]>;
// SimulationResult: { caseId, passed, rejectedCallHashMatched, notes }

// Write new version. Atomic: version row + skill row update in one transaction.
// Returns the new version row.
export async function saveSkillVersion(
  skillId: string,
  scope: 'system' | 'org',
  orgId: string | null,
  payload: SaveSkillVersionPayload,
  authorUserId: string
): Promise<SkillVersion>;

// List version history for a skill
export async function listSkillVersions(
  skillId: string,
  scope: 'system' | 'org'
): Promise<SkillVersion[]>;

// Rollback to a prior version (atomic pointer flip)
export async function rollbackSkillVersion(
  skillId: string,
  scope: 'system' | 'org',
  versionId: string,
  authorUserId: string
): Promise<void>;
```

### 4.5 API routes

**New file:** `server/routes/skillStudio.ts`

```
GET    /api/system/skill-studio                    → listSkillsForStudio({ scope: 'system' })
GET    /api/system/skill-studio/:skillId           → getSkillStudioContext
POST   /api/system/skill-studio/:skillId/simulate  → simulateSkillVersion
POST   /api/system/skill-studio/:skillId/save      → saveSkillVersion (system scope)
GET    /api/system/skill-studio/:skillId/versions  → listSkillVersions
POST   /api/system/skill-studio/:skillId/rollback  → rollbackSkillVersion

GET    /api/admin/skill-studio                     → listSkillsForStudio({ scope: 'org', orgId })
GET    /api/admin/skill-studio/:skillId            → getSkillStudioContext (org scope)
POST   /api/admin/skill-studio/:skillId/simulate   → simulateSkillVersion
POST   /api/admin/skill-studio/:skillId/save       → saveSkillVersion (org override)
GET    /api/admin/skill-studio/:skillId/versions   → listSkillVersions
```

Auth: `requireSystemAdmin` for `/api/system/skill-studio` routes. `requireOrgAdmin` for `/api/admin/skill-studio` routes.

### 4.6 System agent: `skill-author`

Seeded via `createSystemSkill()` at boot or in the backfill script (same pattern as other system agents). Receives a Studio session with pre-loaded context:

- Current skill definition
- Recent regression list
- Chat thread

The agent's `masterPrompt` focuses it on: reading regressions, proposing targeted edits, running simulation before any save, classifying unfixable regressions into the four categories (`skill-fixable`, `master-prompt-fixable`, `bug`, `data`).

System agent slug: `skill-author`. Seeded to `system_agents` table.

### 4.7 Client

**New file:** `client/src/pages/SkillStudioPage.tsx`

- Route: `/system/skill-studio` (system scope), `/admin/skill-studio` (org scope)
- Layout: left pane = skill list (sort by regression count), center pane = studio context (current def + regression cards + version history), right pane = chat with `skill-author` agent
- Mirrors the existing `PlaybookStudioPage` layout
- "Simulate" button calls the simulate endpoint and renders pass/fail per regression card inline
- "Save system-wide" / "Save to org" buttons call the save endpoint
- Version history tab shows version list with rollback action

### 4.8 File inventory

| File | Action |
|---|---|
| `migrations/0101_skill_versions.sql` | Create |
| `server/db/schema/skillVersions.ts` | Create |
| `server/db/schema/index.ts` | Export new schema |
| `server/services/skillStudioService.ts` | Create |
| `server/routes/skillStudio.ts` | Create |
| `server/index.ts` | Register new router |
| `server/skills/skill_read_existing.md` | Create (seed source for DB row) |
| `server/skills/skill_read_regressions.md` | Create |
| `server/skills/skill_validate.md` | Create |
| `server/skills/skill_simulate.md` | Create |
| `server/skills/skill_propose_save.md` | Create |
| `server/services/skillExecutor.ts` | Add 5 skill handlers to `SKILL_HANDLERS` |
| `client/src/pages/SkillStudioPage.tsx` | Create |
| `client/src/App.tsx` | Add 2 routes |

### 4.9 Implementation chunks

**Chunk A — schema + service (days 1–2):**
1. Create migration 0101 + `skillVersions.ts` schema.
2. Create `skillStudioService.ts` with all 6 service methods.
3. Create skill studio routes and register router.
4. Run `npm run typecheck` + `npm run lint`.

**Chunk B — studio agent skills (days 2–3):**
1. Create 5 skill markdown seed files.
2. Add 5 handler entries to `SKILL_HANDLERS`.
3. Seed `skill-author` system agent via `createSystemAgent()`.
4. Run `npm run typecheck`.

**Chunk C — frontend (days 3–5):**
1. Create `SkillStudioPage.tsx` with list view and studio panel.
2. Wire simulate + save + rollback buttons to their endpoints.
3. Add routes to `App.tsx` and sidebar entries.
4. Test golden path: open Studio, read regressions, propose fix, simulate, save, verify version history shows the new version.
5. Run `npm run build`.

---

## 5. Feature 4 — Slack Conversational Surface

**Priority:** P1 | **Effort:** Medium (~3–4 days) | **Schema changes:** migrations 0102 (`slack_conversations`) + 0103 (`users.slack_user_id`)

### 5.1 Summary

Extends the existing multi-tenant Slack webhook (`slackWebhook.ts`) to dispatch inbound `app_mention` and `message.im` events to agent runs via pg-boss. Adds thread-persistent conversations, @mention routing, interactive HITL buttons, and Slack-user → org-user identity linkage. The existing HMAC verification, dedup, OAuth, and outbound messaging infrastructure is unchanged.

### 5.2 Database schema — migration 0102: `slack_conversations`

```sql
-- migrations/0102_slack_conversations.sql
CREATE TABLE slack_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL REFERENCES organisations(id),
  subaccount_id       uuid REFERENCES subaccounts(id),
  agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  workspace_id        text NOT NULL,     -- Slack team_id
  channel_id          text NOT NULL,
  thread_ts           text NOT NULL,     -- root message ts; uniquely identifies the thread
  agent_run_id        uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX slack_conversations_thread_idx
  ON slack_conversations (workspace_id, channel_id, thread_ts);
CREATE INDEX slack_conversations_org_idx ON slack_conversations (organisation_id);
```

Drizzle schema: `server/db/schema/slackConversations.ts`. Export from `server/db/schema/index.ts`.

### 5.3 Database schema — migration 0103: `users.slack_user_id`

```sql
-- migrations/0103_users_slack_user_id.sql
ALTER TABLE users ADD COLUMN slack_user_id text;
CREATE UNIQUE INDEX users_slack_user_id_idx ON users (slack_user_id) WHERE slack_user_id IS NOT NULL;
```

Drizzle schema update: add `slackUserId: text('slack_user_id')` to `server/db/schema/users.ts`.

The `slack_user_id` is set during Slack OAuth connection or via an admin settings UI field. Until linked, a Slack user can converse with agents but cannot act on review items (HITL actions require a verified org-user identity).

### 5.4 Service layer

**New file:** `server/services/slackConversationService.ts`

```ts
export async function resolveConversation(params: {
  workspaceId: string; channelId: string; threadTs: string; orgId: string;
}): Promise<SlackConversation | null>;

export async function createConversation(params: {
  workspaceId: string; channelId: string; threadTs: string;
  orgId: string; subaccountId: string; agentId: string; agentRunId: string;
}): Promise<SlackConversation>;

// Resolve Slack user_id to an org user for HITL authorization
export async function resolveSlackUser(
  slackUserId: string, orgId: string
): Promise<{ userId: string; orgId: string } | null>;

// Post a review item as an interactive Block Kit message to the org's review channel
export async function postReviewItemToSlack(
  reviewItemId: string, orgId: string
): Promise<void>;
```

### 5.5 Event handling extensions in `slackWebhook.ts`

The existing handler already verifies HMAC, deduplicates, and normalises events. New event handlers hook in after normalisation and publish to pg-boss:

| Event | Trigger condition | Action |
|---|---|---|
| `app_mention` | Any channel the bot is in | Parse @AgentName, resolve agent in org, create `slack_conversations` row, enqueue `slack-inbound` job |
| `message.im` (DM) | Always | Parse optional @mention for agent, resolve default subaccount agent as fallback, resume or create conversation, enqueue job |
| `message.channels` / `message.groups` | Only if `thread_ts` exists in `slack_conversations` | Thread stickiness — look up conversation, enqueue job. Silently drop if thread is unknown. |
| `block_actions` | `hitl:{reviewItemId}:{action}` action IDs | Resolve Slack user → org user (HITL auth boundary). Call `reviewService.processReview()`. Update Slack message. |

#### pg-boss job: `slack-inbound`

**New file:** `server/jobs/slackInboundJob.ts`

Payload: `{ type: 'mention' | 'dm' | 'thread_reply', conversationId, slackUserId, text, orgId }`.

Worker: load conversation → dispatch to standard agent-run infrastructure with the Slack message as input → send agent response back to Slack via existing `sendToSlackService` posting to the same `channel_id` + `thread_ts`.

### 5.6 HITL interactive messages

On `reviewItem` creation, `reviewService.ts` optionally calls `slackConversationService.postReviewItemToSlack()` if the org has a Slack connector with a configured `reviewChannel`. This posts a Block Kit message:

```
[Agent: <name>] wants to [action summary]
[Context snippet]
[ Approve ]  [ Reject ]  [ Ask for changes ]
```

Action IDs: `hitl:{reviewItemId}:{approve|reject|ask}`. Flows back through `block_actions` handler. If no Slack connector is configured, no posting occurs — existing HITL flow is unchanged.

The `reviewChannel` field is added to the org's Slack `connectorConfig` JSON. No new table needed.

### 5.7 File inventory

| File | Action |
|---|---|
| `migrations/0102_slack_conversations.sql` | Create |
| `migrations/0103_users_slack_user_id.sql` | Create |
| `server/db/schema/slackConversations.ts` | Create |
| `server/db/schema/users.ts` | Add `slackUserId` column |
| `server/db/schema/index.ts` | Export new schema |
| `server/services/slackConversationService.ts` | Create |
| `server/routes/webhooks/slackWebhook.ts` | Extend with 4 new event handlers |
| `server/jobs/slackInboundJob.ts` | Create |
| `server/jobs/index.ts` | Register `slack-inbound` job |
| `server/services/reviewService.ts` | Add optional `postReviewItemToSlack()` call |

### 5.8 Implementation chunks

**Chunk A — schema + service (day 1):**
1. Create migrations 0102 + 0103. Run `npm run db:generate`.
2. Create `slackConversations.ts` schema. Update `users.ts` schema.
3. Create `slackConversationService.ts`.
4. Run `npm run typecheck`.

**Chunk B — event handlers + pg-boss job (days 2–3):**
1. Extend `slackWebhook.ts` with `app_mention`, `message.im`, thread-follow-up, and `block_actions` handlers.
2. Create `slackInboundJob.ts` + register in `server/jobs/index.ts`.
3. Add optional Slack posting to `reviewService.ts`.
4. Run `npm run typecheck` + `npm run lint`.

**Chunk C — test golden paths (day 4):**
1. Simulate `app_mention` webhook payload, verify conversation row created + `slack-inbound` job enqueued.
2. Simulate `block_actions` with `approve` action, verify `reviewItem` status updated.
3. Simulate unlinked Slack user clicking HITL button, verify ephemeral "link your account first" response.
4. Run `npm run typecheck` + `npm test` (any new pure tests).

---

## 6. Feature 5 — Cross-Agent Memory Search

**Priority:** P2 (quick win — bundle with Feature 1) | **Effort:** Tiny (~half day) | **Schema changes:** none

### 6.1 Summary

A new universal skill `search_agent_history` that exposes `workspaceMemoryEntries` via semantic vector search. Agents can query what other agents in their org have learned, not just their own memory. Fully automated — no operator configuration, no user-facing UI. Observable via existing `RunTraceViewerPage` tool-call traces.

### 6.2 Database schema changes

None. `workspaceMemoryEntries` already has:
- `embedding vector(1536)` column
- HNSW index (migration M-11)
- Indexes on `(organisationId)`, `(subaccountId)`, `(agentRunId)`, `(createdAt)`

### 6.3 Service layer

**Extend** `server/services/workspaceMemoryService.ts` with a new method:

```ts
export async function semanticSearchMemories(params: {
  query: string;
  orgId: string;
  subaccountId: string;          // default scope; expanded by includeOtherSubaccounts
  includeOtherSubaccounts?: boolean; // default false
  topK?: number;                 // default 10, max 50
  queryEmbedding?: number[];     // pre-computed embedding (avoids redundant embed call if caller has it)
}): Promise<MemorySearchResult[]>;

type MemorySearchResult = {
  id: string;
  score: number;                 // cosine similarity 0.0–1.0
  sourceAgentId: string;
  sourceAgentName: string;
  sourceSubaccountId: string;
  summary: string | null;        // workspaceMemoryEntries.summary field
  createdAt: string;
};
```

Implementation: compute embedding for `query` via `embeddingService` (same service used by skill/agent embedding pipelines), run `<=>` (cosine distance) operator against `workspaceMemoryEntries.embedding`, filter by `organisationId` (always) + optionally `subaccountId`, return top K ordered by similarity descending.

`read(memoryId)` op: direct `SELECT` by `id` with org-scope guard. No new service method needed — use existing `getMemoryEntry()` if it exists, or add a one-liner.

### 6.4 Skill definition

**New skill** `search_agent_history` — seeded via `createSystemSkill()` at boot or via backfill script. Handler in `SKILL_HANDLERS`.

Action registry entry (`server/config/actionRegistry.ts`):
```ts
search_agent_history: {
  actionType: 'search_agent_history',
  isUniversal: true,
  schema: z.discriminatedUnion('op', [
    z.object({
      op: z.literal('search'),
      query: z.string().min(1).max(1000),
      includeOtherSubaccounts: z.boolean().optional(),
      topK: z.number().int().min(1).max(50).optional(),
    }),
    z.object({
      op: z.literal('read'),
      memoryId: z.string().uuid(),
    }),
  ]),
}
```

Add `'search_agent_history'` to `UNIVERSAL_SKILL_NAMES` in `server/config/universalSkills.ts`.

Handler in `skillExecutor.ts`:
- `search` op → `workspaceMemoryService.semanticSearchMemories()`
- `read` op → `workspaceMemoryService.getMemoryEntry()` with org-scope guard

### 6.5 File inventory

| File | Action |
|---|---|
| `server/services/workspaceMemoryService.ts` | Add `semanticSearchMemories()` method |
| `server/config/actionRegistry.ts` | Add `search_agent_history` entry |
| `server/config/universalSkills.ts` | Add `'search_agent_history'` |
| `server/services/skillExecutor.ts` | Add `search_agent_history` to `SKILL_HANDLERS` |

No new files. No migration. No client changes.

### 6.6 Implementation chunk (single chunk — half day)

1. Add `semanticSearchMemories()` to `workspaceMemoryService.ts`.
2. Add `search_agent_history` entry to `actionRegistry.ts`.
3. Add to `UNIVERSAL_SKILL_NAMES`.
4. Add handler to `SKILL_HANDLERS` in `skillExecutor.ts`.
5. Run `npm run typecheck` + `npm run lint`.
6. Smoke test: trigger an agent run, call `search_agent_history` with a test query, verify a result appears in `RunTraceViewerPage` for that run.

---

## 7. Build Sequence & Implementation Plan

### 7.1 Wave structure

Development starts on a fresh branch cut from main. Features are grouped into waves to maximise delivered value at each merge point.

**Wave 1 — Visibility + quick win (one branch)**

- Feature 1: Ops Dashboard
- Feature 5: Cross-Agent Memory Search

Rationale: Both are unblocked, both are cheap. Together they deliver operational visibility + cross-agent knowledge in a single release. No schema blockers. Expected branch lifetime: 2–3 days.

**Wave 2 — Prioritized Work Feed**

- Feature 2: Prioritized Work Feed (includes migration 0100)

Rationale: Valuable once operators can see the feed's output via the Ops Dashboard. Build after Wave 1 is merged so you can verify the scoring output in production before heartbeat agents start consuming it. Expected branch lifetime: 2–3 days.

**Wave 3 — Slack Conversational Surface**

- Feature 4: Slack Conversational Surface (migrations 0102 + 0103)

Rationale: Can be developed in parallel with Wave 2 if resourcing allows — no dependency between them. The HITL button flow is the most careful integration point; test against a real Slack workspace before merging. Expected branch lifetime: 3–4 days.

**Wave 4 — Skill Studio**

- Feature 3: Skill Studio (migration 0101)

Rationale: The most complex feature. Blocked on nothing now that the skills-to-DB migration is complete. Build last to avoid merge conflicts with Wave 1–3 if any of them touch `systemSkillService` or `skillExecutor`. Expected branch lifetime: 5–7 days.

### 7.2 Branch naming convention

Suggested: `feature/ops-dashboard-memory-search` (Wave 1), `feature/priority-feed` (Wave 2), `feature/slack-surface` (Wave 3), `feature/skill-studio` (Wave 4).

### 7.3 Migration sequencing

Run `npm run db:generate` after creating each Drizzle schema change. Verify the generated SQL file matches the hand-authored migration above. Apply using the standard migration runner.

| Migration | Wave | Prerequisite |
|---|---|---|
| 0100 `priority_feed_claims` | Wave 2 | — |
| 0101 `skill_versions` | Wave 4 | — |
| 0102 `slack_conversations` | Wave 3 | — |
| 0103 `users.slack_user_id` | Wave 3 | — |

### 7.4 Cross-feature dependencies

| Feature | Depends on |
|---|---|
| 1 — Ops Dashboard | Nothing |
| 2 — Priority Feed | Feature 1 merged (so operators can see feed output before agents act on it) |
| 3 — Skill Studio | Nothing (skills-to-DB migration already complete) |
| 4 — Slack Surface | Nothing (existing Slack connector already in place) |
| 5 — Memory Search | Nothing |

---

## 8. Testing Strategy

### 8.1 Unit tests (pure functions only)

Each feature with a pure service module must have corresponding `.test.ts` files following the `*Pure.test.ts` naming convention in `server/services/__tests__/`.

| Test file | What to cover |
|---|---|
| `priorityFeedServicePure.test.ts` | `scoreEntry`: empty feed, single critical item, age ramp at 7 days, assignment relevance weighting, tie-breaking consistency. `rankFeed`: sort order correctness with mixed sources. |

Feature 1, 3, 4, and 5 have no pure functions that aren't already tested by existing suites. Add pure tests if normalisation logic or simulation logic grows complex.

### 8.2 Integration tests

Not in scope for v1. The existing `npm test` suite covers service integration. New services follow the same patterns.

### 8.3 Smoke tests (golden path, manual)

One golden path per feature, documented as a checklist in `tasks/todo.md` for each wave branch:

**Feature 1:** Load `/admin/ops`, verify all 8 activity types appear in the type filter. Apply "attention needed" filter, verify only active/failing items surface. Navigate to `/subaccounts/:id/ops`, verify data is narrowed to that subaccount.

**Feature 2:** Trigger an agent run that calls `read_priority_feed op='list'`. Verify the result contains at least one item from a known open health finding or review item. Call `claim`, verify a second call to `list` excludes the claimed item.

**Feature 3:** Open `/system/skill-studio`, select a skill with ≥1 regression. Ask the `skill-author` agent to propose a fix. Click "Simulate" — verify simulation output shows pass/fail per regression card. Click "Save system-wide" — verify a new row appears in `skill_versions` and the skill's definition updated.

**Feature 4:** Send a DM to the Slack bot with `@AgentName what is the status of Acme?`. Verify an agent run is enqueued. Verify a reply lands in the DM thread. Trigger a review item, verify a Block Kit message appears in the configured review channel with Approve/Reject buttons.

**Feature 5:** Trigger an agent run. In the run trace (`RunTraceViewerPage`), verify `search_agent_history` appears as a tool call with a non-empty result array. Verify `includeOtherSubaccounts: true` returns results from a different subaccount in the same org.

### 8.4 Regression gate

Before any Wave branch merges to main:
1. `npm run lint` — zero errors, zero warnings suppressed
2. `npm run typecheck` — zero type errors
3. `npm test` — all existing tests pass; new tests pass
4. `npm run db:generate` — verify migration file matches the spec's SQL (review the diff manually)
5. `npm run build` — zero build errors

---

## 9. CI Gate Requirements

No new static-gate scripts are required for these features. Existing gates apply:

| Gate | Trigger | Pass condition |
|---|---|---|
| `npm run lint` | Any code change | Zero errors |
| `npm run typecheck` | Any TypeScript change | Zero type errors |
| `npm test` | Logic change in `server/` | All tests pass, including new `priorityFeedServicePure.test.ts` |
| `npm run db:generate` | Schema change (each wave) | Migration file generated without errors; diff reviewed |
| `npm run build` | Client change (Feature 1, 3) | Zero build errors |

**Feature 3 additional gate:** after `skill-author` system agent is seeded, run the boot-time `validateSystemSkillHandlers()` check and confirm it passes (all 5 new skill handlers resolve). This is already enforced at `server/index.ts` boot — CI gate is a local `npm run dev` boot check.

**Feature 4 additional gate:** after `users.slack_user_id` migration runs, verify the existing `users` service and route tests still pass (no `NOT NULL` constraint on the new column — it's nullable, so existing inserts are unaffected).


