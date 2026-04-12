# Org Subaccount Refactor — Development Specification

**Date:** 2026-04-12
**Status:** Draft
**Brief:** `tasks/org-subaccount-refactor-brief.md`
**Supersedes:** `tasks/org-level-agents-brief.md`, `tasks/org-level-agents-full-spec-v2.md`
**Migration:** `0106_org_subaccount.sql`
**Session:** https://claude.ai/code/session_01MPgWmCKMHoWvBWkfAwhrVB

---

## Table of Contents

1. Context & Problem
2. Decision
3. Schema Changes
4. Migration SQL
5. Data Migration
6. Execution Service Refactor
7. Skill Handler Changes
8. Scheduling Refactor
9. Seed & Agent Definition Changes
10. Route & Service Cleanup
11. UI Implications
12. Deprecation Plan
13. Verification Plan
14. Phased Delivery
15. Open Questions

---

## 1. Context & Problem

The platform has two execution scopes for agents: `subaccount` (default, 15 of 16 system agents) and `org` (only Portfolio Health Agent). These scopes have radically different capabilities:

**Subaccount-scoped agents get:**
- Task board with full CRUD (`create_task`, `move_task`, `reassign_task`, `update_task`)
- Workspace memory injection into system prompt
- Workspace entities for hallucination detection
- Subaccount state summary for operational context
- Agent briefings (cross-run orientation documents)
- Trigger firing on run completion
- Memory extraction post-run
- All 99+ skills

**Org-scoped agents get:**
- 8 specialised intelligence skills (`compute_health_score`, `query_subaccount_cohort`, etc.)
- Org memory (separate `org_memories` / `org_memory_entries` tables)
- No task board (routes return 501 — `server/routes/orgWorkspace.ts:18-25`)
- No workspace memory, no entities, no state summary, no briefings
- 22 skills hard-fail via `requireSubaccountContext()` in `skillExecutor.ts:145-149`

**Evidence of deferred duplication across the codebase:**
- `agentExecutionService.ts:656-669`: Agent briefing skipped for org runs
- `agentExecutionService.ts:710-720`: Workspace memory skipped for org runs
- `agentExecutionService.ts:723-728`: Workspace entities skipped for org runs
- `agentExecutionService.ts:738-750`: State summary skipped for org runs
- `agentExecutionService.ts:1179-1230`: Memory extraction skipped for org runs
- `agentExecutionService.ts:1234-1252`: Trigger firing skipped for org runs
- Comment: "org board comes in Phase 3" — never shipped
- Comment: "org triggers come in Phase 5" — never shipped

Every new feature (Agent Intelligence Upgrade, scraping engine, playbooks) adds more `if (!isOrgRun)` conditionals.

---

## 2. Decision

Every organisation gets a **default org subaccount** — a permanently linked, undeletable subaccount that serves as the org's own workspace. All org-level agent execution moves into this subaccount using existing infrastructure. No duplication.

The `executionScope: 'org'` path is deprecated. All agents become subaccount-scoped. Cross-subaccount skills (Portfolio Health Agent) continue to query across all subaccounts — they just run inside the org subaccount.

---

## 3. Schema Changes

### 3a. `subaccounts` table — add `isOrgSubaccount` column

**File:** `server/db/schema/subaccounts.ts`

```typescript
// Add after includeInOrgInbox:
isOrgSubaccount: boolean('is_org_subaccount').notNull().default(false),
```

**Constraints:**
- One org subaccount per org (partial unique index: `WHERE is_org_subaccount = true AND deleted_at IS NULL`)
- Cannot be soft-deleted (enforced in route/service layer, not DB constraint)
- Status always `'active'` (enforced in route/service layer)

### 3b. `organisations` table — no changes required

The `orgExecutionEnabled` flag on `organisations` is repurposed: instead of gating org-scoped runs specifically, it becomes a general "enable/disable agent execution for this org" toggle. No schema change — just a semantic shift documented in the migration comment.

### 3c. `org_agent_configs` table — no schema change (deprecated in place)

Table remains for backward compatibility during transition. Data is migrated to `subaccount_agents`. A deprecation comment is added to the schema file. Table is dropped in a future cleanup migration after verification.

### 3d. `system_agents` table — `executionScope` semantics change

The `execution_scope` column remains but its meaning changes:
- `'subaccount'` (default): agent is linked to subaccounts normally
- `'org'` → repurposed as `'org_hq'`: hint that this agent should be auto-linked to the org subaccount during hierarchy template application. **Not** an execution-time branching signal.

Alternatively, `executionScope` can be deprecated entirely and replaced with a `defaultTargetScope` field in the seed YAML. This is a **Phase 2 cleanup** — for Phase 1, we just stop reading `executionScope` at execution time.

---

## 4. Migration SQL

**File:** `migrations/0106_org_subaccount.sql`

```sql
-- 1. Add isOrgSubaccount column
ALTER TABLE subaccounts
  ADD COLUMN is_org_subaccount BOOLEAN NOT NULL DEFAULT false;

-- 2. Partial unique index: one org subaccount per org
CREATE UNIQUE INDEX subaccounts_org_subaccount_unique_idx
  ON subaccounts (organisation_id)
  WHERE is_org_subaccount = true AND deleted_at IS NULL;

-- 3. Composite index for fast lookup
CREATE INDEX subaccounts_org_hq_idx
  ON subaccounts (organisation_id, is_org_subaccount)
  WHERE is_org_subaccount = true;

-- 4. Backfill: create org subaccount for every existing org that doesn't have one
INSERT INTO subaccounts (id, organisation_id, name, slug, status, is_org_subaccount, include_in_org_inbox, created_at, updated_at)
SELECT
  gen_random_uuid(),
  o.id,
  o.name || ' HQ',
  'org-hq',
  'active',
  true,
  true,
  NOW(),
  NOW()
FROM organisations o
WHERE NOT EXISTS (
  SELECT 1 FROM subaccounts s
  WHERE s.organisation_id = o.id
    AND s.is_org_subaccount = true
    AND s.deleted_at IS NULL
);

-- 5. Init board config for each new org subaccount (copies org board template)
-- This is handled in application code post-migration via a one-time job,
-- not in SQL, because boardService.initSubaccountBoard() has application logic.

-- 6. RLS policy update (if applicable) — org subaccounts follow standard
-- subaccount RLS; no special policy needed.
```

---

## 5. Data Migration

### 5a. `orgAgentConfigs` → `subaccountAgents`

For each `org_agent_configs` row, create a corresponding `subaccount_agents` row linked to the org subaccount.

**Field mapping:**

| `org_agent_configs` | `subaccount_agents` | Notes |
|---|---|---|
| `organisation_id` | `organisation_id` | Same |
| `agent_id` | `agent_id` | Same |
| `is_active` | `is_active` | Same |
| `token_budget_per_run` | `token_budget_per_run` | Same |
| `max_tool_calls_per_run` | `max_tool_calls_per_run` | Same |
| `timeout_seconds` | `timeout_seconds` | Same |
| `max_cost_per_run_cents` | `max_cost_per_run_cents` | Same |
| `max_llm_calls_per_run` | `max_llm_calls_per_run` | Same |
| `skill_slugs` | `skill_slugs` | Same |
| `allowed_skill_slugs` | `allowed_skill_slugs` | Same |
| `custom_instructions` | `custom_instructions` | Same |
| `heartbeat_enabled` | `heartbeat_enabled` | Same |
| `heartbeat_interval_hours` | `heartbeat_interval_hours` | Same |
| `heartbeat_offset_minutes` | `heartbeat_offset_minutes` | Same |
| `concurrency_policy` | `concurrency_policy` | Same |
| `catch_up_policy` | `catch_up_policy` | Same |
| `catch_up_cap` | `catch_up_cap` | Same |
| `max_concurrent_runs` | `max_concurrent_runs` | Same |
| `schedule_cron` | `schedule_cron` | Same |
| `schedule_enabled` | `schedule_enabled` | Same |
| `schedule_timezone` | `schedule_timezone` | Same |
| `last_run_at` | `last_run_at` | Same |
| `allowed_subaccount_ids` | (drop) | Cross-subaccount access is controlled by skill permissions, not config |
| — | `subaccount_id` | Set to the org subaccount's `id` |
| — | `heartbeat_offset_hours` | Default `0` |

**Execution:** Application-level script (not raw SQL) to resolve the org subaccount ID per org. Run as a one-time migration job after `0106` applies.

**Conflict handling:** If a `subaccount_agents` row already exists for the same `(subaccount_id, agent_id)` pair, skip (idempotent). Log skipped rows for manual review.

### 5b. `orgMemories` / `orgMemoryEntries` → workspace memory

For each org:
1. Create a `workspace_memories` row for the org subaccount (if not exists)
2. For each `org_memory_entries` row, create a `workspace_memory_entries` row with:
   - `subaccount_id` = org subaccount ID
   - `organisation_id` = same
   - All content, embedding, quality_score, entry_type fields copied
   - `source_subaccount_ids` preserved in a metadata JSONB field for traceability
3. Copy `org_memories.summary` → `workspace_memories.summary`

**Timing:** This runs after the schema migration but can be done asynchronously. The org memory tables are kept read-only as backup until verified.

### 5c. Historical `agentRuns` with `executionScope = 'org'`

Existing org-scoped runs in `agent_runs` table keep their data. No migration needed — they're historical records. The `execution_scope` column remains for audit/reporting. New runs always have `execution_scope = 'subaccount'`.

---

## 6. Execution Service Refactor

**File:** `server/services/agentExecutionService.ts`

This is the primary refactoring target. The goal: **remove all `isOrgRun` branching** so every run flows through the same subaccount path.

### 6a. Remove scope validation gate (lines 242-260)

**Before:**
```typescript
if (request.executionScope === 'org' && request.subaccountId) {
  throw new Error('Org-level run must not have a subaccountId');
}
if (request.executionScope === 'org') {
  // check orgExecutionEnabled kill switch
}
```

**After:** Remove both blocks. All runs require `subaccountId`. The org subaccount is just a subaccount. The `orgExecutionEnabled` flag either moves to a general org-level toggle or is removed.

### 6b. Unify config loading (lines 342-365)

**Before:** Dual path — org runs load from `orgAgentConfigs`, subaccount runs load from `subaccountAgents`.

**After:** Single path — all runs load from `subaccountAgents`. The org subaccount's `subaccount_agents` rows contain the migrated org config.

### 6c. Remove `isOrgRun` flag and all conditional skips

Delete or simplify every `if (!isOrgRun)` / `if (isOrgRun)` block:

| Location (approx lines) | What's skipped for org runs | After refactor |
|---|---|---|
| 286 | `const isOrgRun = ...` | Delete declaration |
| 388-390 | Workspace limit check | Always run |
| 642-644 | Team roster (dual builder) | Always use `buildTeamRoster()` |
| 656-669 | Agent briefing injection | Always inject |
| 710-720 | Workspace memory injection | Always inject |
| 723-728 | Workspace entities injection | Always inject |
| 738-750 | Subaccount state summary | Always inject |
| 1179-1230 | Memory extraction + briefing job | Always run |
| 1234-1252 | Trigger firing | Always fire |

### 6d. Remove `buildOrgTeamRoster()` function

**Location:** ~lines 2470-2497. This function builds the team roster from `orgAgentConfigs` for org runs. After migration, the team roster is built from `subaccountAgents` in the org subaccount — the standard `buildTeamRoster()` function handles this.

### 6e. `AgentRunRequest` type change

```typescript
// Before:
executionScope: 'subaccount' | 'org';
orgAgentConfigId?: string;

// After:
executionScope?: 'subaccount'; // deprecated, always 'subaccount', kept for backward compat
// orgAgentConfigId removed
```

All callers that construct `AgentRunRequest` with `executionScope: 'org'` are updated to provide `subaccountId` (the org subaccount) and `executionScope: 'subaccount'`.

### 6f. Callers to update

| Caller | File | Change |
|---|---|---|
| Org schedule handler | `agentScheduleService.ts` | Resolve org subaccount ID, pass as `subaccountId` |
| Manual org run trigger | Routes that accept org-level run requests | Resolve org subaccount ID |
| `orgAgentConfigService` | `orgAgentConfigService.ts` | Deprecated — callers use `subaccountAgentService` |

---

## 7. Skill Handler Changes

**File:** `server/services/skillExecutor.ts`

### 7a. `requireSubaccountContext()` — no change needed

This function checks that `context.subaccountId` is present. Since all runs now have a subaccountId (including org runs via the org subaccount), this guard never fires. **No code change** — the function works correctly as-is.

### 7b. Intelligence skills — remove org-only guards

**File:** `server/services/intelligenceSkillExecutor.ts`

Four skills currently reject non-org runs:

```typescript
// Lines 115, 164, 207, 535:
if (context.subaccountId) {
  return { error: '... is only available to org-level agents' };
}
```

**After:** Remove these guards. The skills still work the same way — they query across all subaccounts via direct DB queries. The guard was preventing subaccount-scoped agents from calling them, which was intentional but is no longer needed since the Portfolio Health Agent now runs inside the org subaccount (which has a `subaccountId`).

**Access control replacement:** Instead of scope-based guards, control access via skill assignment. Only agents that have these skills in their `skillSlugs` can call them. The Portfolio Health Agent has them; the Dev Agent doesn't. No guard needed.

### 7c. Cross-subaccount query safety

Skills like `query_subaccount_cohort` query across all subaccounts for the org. They must NOT accidentally scope to only the org subaccount. Verify that these skills use `organisationId` for their queries, not `subaccountId`. Current code already does this — confirm with tests.

---

## 8. Scheduling Refactor

**File:** `server/services/agentScheduleService.ts`

### 8a. Remove `AGENT_ORG_RUN_QUEUE` (line 21)

Org-scoped agents currently use a separate pg-boss queue (`agent-org-scheduled-run`). After refactor, they use the standard `AGENT_RUN_QUEUE` like all other agents — because they're subaccount agents linked to the org subaccount.

### 8b. Remove `registerOrgSchedule()` / `unregisterOrgSchedule()` (lines 353+)

These functions register schedules from `orgAgentConfigs`. After migration, schedules live in `subaccountAgents` and use the standard `registerSchedule()` / `updateSchedule()` functions.

### 8c. Remove org config schedule loading (lines 286-310)

The startup loop that loads active `orgAgentConfigs` with `scheduleEnabled = true` and registers org schedules is removed. The standard subaccount schedule loading picks up org subaccount agents automatically.

### 8d. Org run handler removal (lines 89-131)

The `AGENT_ORG_RUN_QUEUE` worker handler that loads `orgAgentConfigs`, checks `orgExecutionEnabled`, and calls `executeRun()` with `executionScope: 'org'` is removed. Standard subaccount run handler processes all runs.

---

## 9. Seed & Agent Definition Changes

### 9a. Portfolio Health Agent

**File:** `companies/automation-os/agents/portfolio-health-agent/AGENTS.md`

**Before:**
```yaml
executionScope: org
reportsTo: null
```

**After:**
```yaml
# executionScope removed (deprecated)
reportsTo: null
defaultTarget: org-hq  # hint for hierarchy template: auto-link to org subaccount
```

The agent is no longer defined as org-scoped. The seed script treats `defaultTarget: org-hq` as a hint to auto-link this agent to the org subaccount during hierarchy template application (or during org setup).

### 9b. Seed script changes

**File:** `scripts/seed.ts`

When parsing `AGENTS.md` frontmatter:
- `executionScope: org` → translate to `defaultTarget: 'org-hq'` (metadata only, not stored in `system_agents.executionScope`)
- Or: keep `executionScope` in the DB but stop using it at execution time (Phase 1 approach — less disruptive)

### 9c. Hierarchy template changes

When a hierarchy template is applied to a subaccount AND includes the Portfolio Health Agent:
- If the target subaccount is the org subaccount → link normally
- If the target is a regular subaccount → skip agents with `defaultTarget: org-hq` (they belong in the org subaccount only)

### 9d. Org subaccount auto-provisioning

When a new organisation is created:
1. Create the org subaccount (`isOrgSubaccount: true`, slug: `org-hq`)
2. Init board config from org template
3. Create workspace memory for the org subaccount
4. If the org's default hierarchy template exists, apply it to the org subaccount (auto-links Portfolio Health Agent and any other org-targeted agents)

This happens in the organisation creation route/service — a new step after org row insertion.

---

## 10. Route & Service Cleanup

### 10a. `server/routes/orgWorkspace.ts` — remove entirely

The 501 stubs for org-level task CRUD become unnecessary. Org tasks live in the org subaccount's task board, accessible via the standard `/api/subaccounts/:subaccountId/tasks` routes.

### 10b. `server/routes/orgAgentConfigs.ts` — deprecate

Keep the routes functional during transition (they read/write `org_agent_configs` which is being deprecated). Add deprecation headers. Remove in Phase 2 cleanup.

The execution kill switch endpoints (`GET/PATCH /api/org/settings/execution-enabled`) are either:
- Removed (if `orgExecutionEnabled` is dropped)
- Kept and wired to a general org execution toggle

### 10c. `server/services/orgAgentConfigService.ts` — deprecate

Mark as deprecated. Callers migrate to `subaccountAgentService` with the org subaccount ID. Remove in Phase 2.

### 10d. `server/services/orgMemoryService.ts` — deprecate

After data migration to workspace memory, this service is no longer needed for new writes. Keep read-only access during transition for any code that still references org memory. Remove in Phase 2.

### 10e. `server/routes/subaccounts.ts` — guard org subaccount

Add deletion guard:
```typescript
// In DELETE /api/subaccounts/:subaccountId
if (subaccount.isOrgSubaccount) {
  return res.status(403).json({ error: 'Cannot delete the organisation workspace' });
}
```

Add similar guard for status changes (prevent suspending/inactivating org subaccount).

---

## 11. UI Implications

### 11a. Subaccount list — distinguish org subaccount

The org subaccount appears in the subaccount list alongside client workspaces. The UI should:
- Pin it to the top of the list
- Show a distinct label (e.g., "HQ" or "[Org Name] Workspace")
- Use a different icon or badge to distinguish it from client subaccounts
- Hide the delete button / status toggle for it

**Implementation:** The API already returns `isOrgSubaccount` in the subaccount response. Client-side filtering/sorting is sufficient.

### 11b. Org agent config UI → subaccount agent config UI

Users who previously configured org agents via the org agent config UI now configure them via the standard subaccount agent edit page — targeting the org subaccount. No new UI needed. The existing `SubaccountAgentEditPage.tsx` (with its Skills, Instructions, Budget, Scheduling tabs) handles everything.

### 11c. Org workspace routes (if any client-side references)

Search for client-side references to `/api/org/tasks` or `/api/org/agent-configs`. Update to use standard subaccount-scoped routes with the org subaccount ID.

---

## 12. Deprecation Plan

| Item | Phase 1 (this spec) | Phase 2 (cleanup) |
|---|---|---|
| `org_agent_configs` table | Data migrated; table kept read-only | Drop table + migration |
| `org_memories` / `org_memory_entries` tables | Data migrated; tables kept read-only | Drop tables + migration |
| `orgAgentConfigService.ts` | Marked deprecated; no new callers | Delete file |
| `orgMemoryService.ts` | Marked deprecated for writes | Delete file |
| `orgWorkspace.ts` routes | Removed (501 stubs) | N/A |
| `buildOrgTeamRoster()` | Removed | N/A |
| `AGENT_ORG_RUN_QUEUE` | Removed; schedules migrated | N/A |
| `isOrgRun` branching | Removed | N/A |
| `system_agents.executionScope` | Stopped reading at execution time | Column dropped or repurposed |
| `organisations.orgExecutionEnabled` | Repurposed as general toggle | Decide: keep or drop |

---

## 13. Verification Plan

### 13a. Pre-migration checks

- [ ] Count `org_agent_configs` rows per org — verify all will map to org subaccount
- [ ] Count `org_memory_entries` — verify data volume is reasonable for migration
- [ ] Verify no `subaccount_agents` conflicts (same agent already linked to what will be the org subaccount)

### 13b. Post-migration checks

- [ ] Every org has exactly one subaccount with `is_org_subaccount = true`
- [ ] Every `org_agent_configs` row has a corresponding `subaccount_agents` row in the org subaccount
- [ ] `org_memory_entries` count matches `workspace_memory_entries` count for org subaccount
- [ ] Portfolio Health Agent runs successfully inside org subaccount (trigger manually)
- [ ] Portfolio Health Agent can still query across all subaccounts (cross-subaccount skills work)
- [ ] Standard subaccount agents are unaffected (regression check)
- [ ] Scheduled runs fire correctly for migrated org agent configs
- [ ] Agent briefings generate for org subaccount agents
- [ ] Workspace memory, entities, and state summaries inject into org subaccount agent prompts
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all existing tests)

### 13c. New tests to write

- [ ] `orgSubaccountCreation.test.ts` — org creation auto-creates org subaccount
- [ ] `orgSubaccountGuards.test.ts` — cannot delete, cannot suspend org subaccount
- [ ] `orgAgentConfigMigration.test.ts` — config migration is idempotent and complete
- [ ] `crossSubaccountSkills.test.ts` — intelligence skills work from within org subaccount

---

## 14. Phased Delivery

### Phase 1: Foundation (this spec)

1. Schema migration: `isOrgSubaccount` column + backfill
2. Org creation hook: auto-create org subaccount
3. Subaccount deletion guard
4. Data migration: `orgAgentConfigs` → `subaccountAgents`
5. Execution service: remove `isOrgRun` branching
6. Scheduling: remove `AGENT_ORG_RUN_QUEUE`, migrate to standard queue
7. Intelligence skills: remove org-only guards
8. Seed: update Portfolio Health Agent definition
9. Remove `orgWorkspace.ts` routes
10. Verification

### Phase 2: Cleanup (follow-up)

1. Data migration: `orgMemories` → workspace memory (lower risk, can be async)
2. Deprecate `orgAgentConfigService`, `orgMemoryService`
3. UI: org subaccount visual distinction (pin to top, HQ label)
4. Drop `org_agent_configs` table
5. Drop `org_memories` / `org_memory_entries` tables
6. Clean up `executionScope` column semantics

---

## 15. Open Questions

### Q1: Should the org subaccount be visible in the subaccount list or hidden?

**Recommendation:** Visible but visually distinct (pinned to top, "HQ" badge). Hiding it creates confusion when users see agent runs happening in a subaccount they can't find. Showing it makes the system transparent.

**Need input:** Does the user/CEO have a preference on naming? "HQ", "[Org Name] Workspace", "Organisation", or something else?

### Q2: What happens to `allowedSubaccountIds` on `orgAgentConfigs`?

This field restricts which subaccounts an org-scoped agent can access. After migration, it's dropped from the `subaccountAgents` record (that field doesn't exist there). Cross-subaccount access control would need a different mechanism if needed.

**Recommendation:** Drop it for now. The skills themselves control what they query — they always query all active subaccounts for the org. If fine-grained access control is needed later, add it as a skill-level config, not an agent config.

### Q3: Should `orgExecutionEnabled` be kept as a general kill switch?

Currently it only gates org-scoped runs. Options:
- **Drop it:** One less thing to maintain. Orgs can disable agents individually.
- **Repurpose:** Make it disable ALL agent execution for the org (useful for billing/suspension).

**Recommendation:** Repurpose as a general org execution toggle. Rename to `executionEnabled` on the `organisations` table. Check it at the top of `executeRun()` regardless of scope.

### Q4: Should the org subaccount get auto-linked agents from the hierarchy template?

When the org subaccount is created, should the default hierarchy template be auto-applied to it? This would auto-link the Orchestrator, all business agents, and the Portfolio Health Agent.

**Recommendation:** Yes — but only agents with `defaultTarget: org-hq` (Portfolio Health Agent initially). Other agents get linked to client subaccounts. The org subaccount is the org's internal workspace, not a client workspace.

**Need input:** Which agents should be auto-linked to the org subaccount? Just Portfolio Health? Or also the Orchestrator and Strategic Intelligence Agent?
