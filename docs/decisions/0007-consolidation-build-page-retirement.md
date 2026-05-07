# ADR-0007: Page consolidation: retire 9 admin/skill pages into 4 Build stream pages

**Status:** Accepted
**Date:** 2026-05-07
**Domain:** UI / navigation
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

The pre-consolidation client had 9 separate admin and skill-management pages scattered across the route tree:

- `AdminAgentsPage` — org-level agent list
- `AdminAgentEditPage` — org-level agent edit (identity, skills, schedule, budget tabs)
- `AdminSkillsPage` — org-level skills list
- `AdminSkillEditPage` — org-level skill edit
- `SkillStudioPage` — chat-driven skill authoring surface with regression simulation, version history, and rollback
- `SkillAnalyzerPage` — bulk skill library import and merge-review surface
- `SystemAgentsPage` — system-admin agent management page
- `ScheduledTasksPage` — scheduled/recurring tasks list (multiple workspaces)
- `GoalsPage` — per-project goal management surface

This fragmentation caused three problems. First, the agent edit flow was split across multiple pages (edit identity on one page, edit skills on another, Skill Studio on a third), requiring unnecessary navigation for a single logical task. Second, the recurring-tasks and goals surfaces existed independently of the project and agent entities they described, breaking discoverability. Third, the page count made the navigation sidebar harder to reason about and increased the maintenance surface for routing, sidebar config, and permission gates.

The consolidation-build spec (Phase 0, PR #270) introduced shared UI primitives and a Build-stream route layout as the foundation for consolidation.

## Decision

We will retire the 9 legacy pages and replace them with 4 consolidated Build-stream pages:

- `client/src/pages/build/AgentsListPage.tsx` — replaces `AdminAgentsPage` and `SystemAgentsPage`; single list with ETag-gated inline actions across all agent tiers
- `client/src/pages/build/AgentEditPage.tsx` — replaces `AdminAgentEditPage`; multi-tab edit (identity / skills / schedule / budget) with ETag-based per-tab writes; the Skills tab surfaces skill authoring (replaces `AdminSkillsPage`, `AdminSkillEditPage`, and `SkillStudioPage`); `SkillAnalyzerPage` functionality remains reachable via a dedicated route but is no longer a top-level nav item
- `client/src/pages/build/RecurringTasksPage.tsx` — replaces `ScheduledTasksPage`; aggregates recurring tasks across all workspaces for the org, with union/sort/filter/cursor pagination via `recurringTasksServicePure.ts`
- `client/src/pages/build/ProjectEditPage.tsx` — consolidates project CRUD with goal management (replaces `GoalsPage`); goals are now a tab on the project edit surface

Legacy redirect routes remain in place so bookmarked URLs and external links continue to resolve. The redirect target is the equivalent consolidated page.

New server-side primitives introduced to support the consolidated pages:

- `server/routes/agents/agentTabs.ts` — tab-scoped PATCH/PUT endpoints + `GET /:id/full`
- `server/services/recurringTasksService.ts` + `recurringTasksServicePure.ts`
- `server/services/projectService.ts` — project CRUD with `toApiProject` / `fromApiPatch` mappers
- `server/lib/agentEtag.ts` — ETag canonicalisation (`computeAgentEtag` + `canonicalStringify`)
- `server/lib/identityKeyDiff.ts` — identity-key safe full-replacement diff helper
- `shared/types/build.ts` — Build stream wire types
- `client/src/lib/api/build.ts` — typed API client wrappers for Build stream endpoints

## Consequences

- **Positive:**
  - Agent edit flow is a single page with tabs — no cross-page navigation required for a single agent's full configuration
  - Skill authoring is discoverable from the same surface where skills are managed
  - Goal management is co-located with the project it belongs to
  - Navigation sidebar is simpler; fewer top-level items in the Build section
  - Reduced route/permission gate surface area to maintain: fewer permission-gated routes means fewer auth checks, fewer configuration drift points, and simpler delegation rules
  - Fewer permission surfaces (one agent-edit permission gate covers all tabs; previously scattered across AdminAgentEditPage, AdminSkillsPage, AdminSkillEditPage, SkillStudioPage)
- **Negative:**
  - Bookmark / deep-link breakage risk mitigated by redirect routes, but not fully eliminated for any integration that constructed URLs by string-interpolation against the old patterns
  - `schedule` and `budget` tabs in `AgentEditPage` are Phase 1 placeholders — trigger editing still uses the existing per-workspace override page; budget cap fields have no backing schema (always null/zero, writes accepted but not persisted). These are deferred to Phase 2
  - `SkillAnalyzerPage` is not retired — it remains reachable but is removed from the primary nav; operators who relied on it as a top-level shortcut need to navigate via the Build section
- **Neutral:**
  - `formatFireCondition` in `recurringTasksServicePure.ts` handles FREQ + BYDAY + BYMONTHDAY + INTERVAL from the RRULE spec; unknown patterns fall back to the literal RRULE string — expected behaviour until a full RRULE parser is added

## Alternatives considered

- **Keep all 9 pages, add a Build-stream wrapper nav** — rejected. The wrapper nav would paper over the fragmentation without solving it; cross-page navigation for a single agent's full configuration would remain.
- **Merge all 9 pages into one mega-page** — rejected. A single page with 9 concerns would be harder to lazy-load, harder to permission-gate at the tab level, and would violate the one-primary-action-per-screen frontend design principle.
- **Retire pages without redirects** — rejected. Bookmarked URLs and any external integration constructing links would break with no recovery path.

## When to revisit

- When trigger editing is brought into `AgentEditPage` (currently deferred; triggers still use the per-workspace override page)
- When budget cap fields have a backing schema and real write path (currently Phase 1 placeholders)
- When `SkillAnalyzerPage` is formally retired or re-integrated into `AgentEditPage` as a tab

## References

- Spec: `tasks/builds/consolidation-build/plan.md`
- Foundation PR: #270 (slug: consolidation-foundation)
- Implementation PR: ui-consolidation-build branch
- Deferred items: Phase 2 trigger editing, Phase 2 budget caps
