# Dev Brief: Org Subaccount Refactor

**Date:** 2026-04-12
**Status:** Approved direction — dev spec pending
**Supersedes:** `tasks/org-level-agents-brief.md` (which proposed duplicating data structures at org level)
**Dependency:** None — this is a foundational change; other features depend on it
**Session:** https://claude.ai/code/session_01MPgWmCKMHoWvBWkfAwhrVB

---

## Problem

The platform has two execution scopes for agents: `subaccount` and `org`. Subaccount-scoped agents get a full environment — task board, workspace memory, triggers, scheduling, all 99 skills. Org-scoped agents get almost nothing — no task board (routes return 501), no workspace memory, no triggers, and only 8 specialised skills.

This creates three ongoing problems:

1. **Every new feature must be built twice.** Any capability that works at subaccount level (tasks, memory, scraping, playbooks, etc.) requires a parallel org-level implementation. This has been deferred repeatedly — the codebase has comments like "org board comes in Phase 3", "org triggers come in Phase 5", "org memory extraction comes in Phase 3". None shipped.

2. **22 skills hard-fail at org level.** They call `requireSubaccountContext()` and throw if there's no `subaccountId`. An org-scoped agent can't create tasks, read workspace memory, reassign work, or use most of the platform's capabilities.

3. **New skills default to subaccount-only.** Every new skill (including the planned scraping engine) needs explicit org-level support or it silently doesn't work for org-scoped agents. This is a tax on every future feature.

---

## Decision

**Every organisation gets a default "org subaccount"** — a permanently linked subaccount that serves as the org's own workspace. All org-level agent execution happens inside this subaccount using existing infrastructure. No duplication.

This replaces the current approach of building parallel org-level data structures (`orgMemories`, `orgMemoryEntries`, org task routes, org board context, etc.).

---

## What Changes

### New: Org subaccount auto-creation

- Add `isOrgSubaccount: boolean` (default `false`) to the `subaccounts` table
- Auto-create one org subaccount when an organisation is created (name: org name, slug: `org-hq`, `isOrgSubaccount: true`)
- Migration backfills one for each existing organisation
- Guard rails: cannot be deleted, cannot be renamed to remove the flag, always `status: 'active'`

### Simplified: Agent execution scope

- Agents that currently require `executionScope: 'org'` (Portfolio Health Agent) become subaccount-scoped agents running inside the org subaccount
- The `executionScope` field on `systemAgents` is deprecated (or repurposed as a hint for where to auto-link the agent)
- Cross-subaccount skills (`query_subaccount_cohort`, `compute_health_score`, etc.) continue to work — they query the DB directly, not through subaccount-scoped context. They just run inside the org subaccount now.

### Simplified: Agent configuration

- `orgAgentConfigs` records migrate to `subaccountAgents` records linked to the org subaccount
- Scheduling, skill slugs, custom instructions, token budgets — all use the existing `subaccountAgents` infrastructure
- `orgAgentConfigs` table is deprecated (kept for backward compatibility during transition, removed later)

### Simplified: Execution service

- Remove `isOrgRun` branching throughout `agentExecutionService.ts`
- Remove conditional skipping of: board context, workspace memory, trigger firing, memory extraction
- All runs are subaccount runs. The org subaccount is just a subaccount.
- Remove the `orgExecutionEnabled` kill switch (or repurpose as a general execution toggle)

### Removed: Parallel org-level infrastructure

Over time, deprecate and remove:
- `orgMemories` / `orgMemoryEntries` tables (use workspace memory in org subaccount)
- `orgAgentConfigs` table (use subaccountAgents)
- `orgWorkspace.ts` routes (501 stubs no longer needed)
- `intelligenceSkillExecutor.ts` org-only skill guards (e.g., "read_org_insights is only available to org-level agents")
- Org-specific team roster building (`buildOrgTeamRoster`)

### Preserved: Cross-subaccount capabilities

Skills like `query_subaccount_cohort`, `detect_anomaly`, `compute_health_score` don't change. They query across all subaccounts by design. The only difference is they now run inside the org subaccount (so they have a task board, memory, etc.) instead of in a scope-less void.

---

## Migration Path

1. **Schema**: Add `isOrgSubaccount` column. Create org subaccounts for existing orgs.
2. **Data**: Migrate `orgAgentConfigs` → `subaccountAgents` in the org subaccount. Migrate `orgMemories` / entries → `workspaceMemories` / entries.
3. **Seed**: Update Portfolio Health Agent definition — remove `executionScope: org`, add it to the org subaccount's default hierarchy template instead.
4. **Execution service**: Remove `isOrgRun` branching. All runs flow through the same path.
5. **Skills**: Remove org-only guards from intelligence skills. Remove `requireSubaccountContext` from skills that should work everywhere (or make them resolve from context).
6. **Cleanup**: Deprecate org-level tables and routes. Remove dead code paths.

---

## What This Unlocks

- **Every agent works at org level for free.** Any agent can be linked to the org subaccount and it gets full capabilities — task board, memory, triggers, all skills. No special configuration.
- **New features work at both levels by default.** The scraping engine, future playbook features, goal tracking — all work in the org subaccount without any org-specific code paths.
- **Simpler codebase.** One execution path instead of two. One config table instead of two. One memory system instead of two.
- **The "Phase 3/5" backlog disappears.** Org task board, org triggers, org memory extraction — all resolved by using existing subaccount infrastructure.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Org subaccount appears in subaccount lists alongside client workspaces | Mark with `isOrgSubaccount` flag; UI can visually distinguish it (pin to top, different icon, "HQ" label) |
| Cross-subaccount skills could accidentally scope to org subaccount only | These skills already query the DB directly across all subaccounts — they don't use subaccount-scoped context. No change needed. |
| Migration of orgAgentConfigs / orgMemories could lose data | Run migration in a transaction; keep deprecated tables as read-only backup until verified |
| Existing org-level scheduling breaks during transition | Migrate schedules to subaccountAgents format before removing orgAgentConfigs queue handling |

---

## Sequencing

This refactor should be done **before** the scraping engine and any other feature that needs to work at both org and subaccount level. It's the foundation that makes everything else simpler.
