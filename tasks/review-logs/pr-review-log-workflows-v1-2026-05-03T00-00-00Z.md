# PR Review — workflows-v1 (brief, spec, plan)

**Branch:** `claude/workflows-brainstorm-LSdMm`
**Build slug:** `workflows-v1`
**Reviewer:** `pr-reviewer` (Claude-native, read-only)
**Reviewed at:** 2026-05-03T00:00:00Z

**Verdict:** CHANGES_REQUESTED (5 blocking, 6 strong, 4 non-blocking)

## Table of contents

- Scope note
- Prior review history
- Blocking issues (B1–B5)
- Strong recommendations (S1–S6)
- Non-blocking improvements (N1–N4)
- Summary

## Scope note

Diff was taken against the merge-base `eb39ac3e` (PR #246 lint/typecheck baseline). Branch is 119 commits behind `origin/main`; raw `main..HEAD` would surface spurious deletions. Actual contributions: 21 files, +10,260 lines, 0 deletions, all docs/spec/plan/mockup work.

**Reviewed paths (all absolute):**
- `c:\files\Claude\automation-v1-3rd\docs\workflows-dev-brief.md` (826 lines)
- `c:\files\Claude\automation-v1-3rd\docs\workflows-dev-spec.md` (1,775 lines)
- `c:\files\Claude\automation-v1-3rd\tasks\builds\workflows-v1\plan.md` (2,085 lines)

**Cross-referenced (read-only):**
- `server/db/schema/tasks.ts`, `workflowRuns.ts`, `workflowTemplates.ts`, `agentExecutionEvents.ts`, `teamMembers.ts`, `scheduledTasks.ts`
- `server/services/workflowStepReviewService.ts`, `workflowRunService.ts`, `workflowStudioService.ts`
- `client/src/App.tsx`, `architecture.md`, `DEVELOPMENT_GUIDELINES.md`, `docs/spec-context.md`

## Prior review history

- `spec-reviewer` ran 4 iterations on `workflows-dev-spec.md`
- `chatgpt-spec-review` finalised APPROVED (commit 3f54f3cd)
- Plan-gate review ran 3 hardening rounds on `tasks/builds/workflows-v1/plan.md` (commit 5d6ac5f9)

This review surfaces gaps the prior passes missed by validating spec text against actual repo schema.

---

## Blocking Issues (must fix before marking done)

### B1. `tasks.created_by_user_id` referenced but does not exist in schema

- **Where:** spec §5.1 line 388 (`task_requester | tasks.created_by_user_id`); spec §13.4 line 1279; spec §5.3 line 444.
- **Reality:** `server/db/schema/tasks.ts` has `createdByAgentId`, `assignedAgentId`, `assignedAgentIds` — no `createdByUserId`.
- **Impact:** `task_requester` approver kind, stall-and-notify cadence, and `workflow.run.start` skill all depend on a column that doesn't exist. Plan Chunk 1 doesn't add it. Plan Chunk 5 hits a wall.
- **Fix:** add `created_by_user_id uuid REFERENCES users(id)` to `tasks` schema and Chunk 1's migration. Decide NULL handling (probably reject `kind: 'task_requester'` at publish-time on workflows whose triggering path doesn't guarantee a user, or stall the gate at runtime). Pin in spec §5.1 + §3.1.

### B2. `agent_execution_events.run_id NOT NULL` blocks task-scoped events that lack a run

- **Where:** plan line 642 (task-scoped event allocation key); spec §8.2 lists `task.created`, `task.routed`, `chat.message` as fire-before-run event kinds.
- **Reality:** `server/db/schema/agentExecutionEvents.ts` line 16-18 declares `runId` `notNull` with FK cascade.
- **Impact:** the reconnect-with-replay design (spec §8.1, plan Chunk 9) cannot persist the `task.created` first event. Spec §9.6 empty-state ("One event: 'Task created · just now'") cannot be emitted.
- **Fix:** drop NOT NULL on `run_id` and add CHECK `run_id IS NOT NULL OR task_id IS NOT NULL`; OR write task-scoped pre-run events to a separate table; OR materialise a synthetic agent run for task-creation. Pin choice in spec §8.1 + Chunk 1 schema delta.

### B3. `workflow_template_versions.updated_at` referenced but does not exist

- **Where:** spec §10.5 line 927; plan line 1591.
- **Reality:** `workflow_template_versions` has `id`, `templateId`, `version`, `definitionJson`, `publishedAt`, `publishedByUserId` — no `updated_at`. Versions are immutable.
- **Impact:** Chunk 14a's concurrent-edit detection (`expectedUpstreamUpdatedAt`) cannot be implemented as written. The 409 `concurrent_publish` shape relies on a non-existent column.
- **Fix:** rewrite contract to use `workflow_templates.latestVersion` (integer comparison: "expected latest_version was N; current is N+1 → conflict"). Cleaner; matches versioned-resource patterns in the codebase. Update spec §10.5 + plan Chunk 14a.

### B4. Plan Chunk 16 references files that do not exist in the codebase

- **Where:** plan §Chunk 16 lines 1812–1814.
- **Reality:** there is no `BriefsPage.tsx` (only `BriefDetailPage.tsx`). No `NewBriefModal.tsx`. The actual route is `/admin/briefs/:briefId`, not `/briefs/:id`.
- **Impact:** Chunk 16's "smallest item" framing is false. The "redirect from `/briefs/:id`" rule is ineffective.
- **Fix:** Chunk 16 must re-grep `client/src/` for `Brief|brief` and rebuild the file list against ground truth. Spec §15.4 needs the same. Pin: is the new route `/admin/tasks/:taskId` (preserving the `/admin/` prefix) or `/tasks/:taskId` (top-level)?

### B5. Spec §3.1 names the workflow-template table as `workflows`; the actual table is `workflow_templates`

- **Where:** spec §3.1 lines 170–171.
- **Reality:** the table is `workflow_templates` (per `workflowTemplates.ts` line 75-76). PR #186 renamed `playbooks → workflows` for the runs table, NOT for the templates table. The spec's `workflows` reference is a fresh introduction, not a rename artifact.
- **Fix:** spec §3.1 line 170 — change `workflows` to `workflow_templates`. Sweep the spec for other `workflows` (singular, table-level) occurrences.

---

## Strong Recommendations (should fix)

### S1. `team_members` has no `deletedAt`

- **Where:** spec §5.1 line 387.
- **Reality:** `team_members` has no `deletedAt` column. The `teams` table has it; team membership is removed by deleting the join row.
- **Fix:** rewrite spec §5.1's `team` row: "All rows in `team_members` for `team_id = teamId` where `teams.deletedAt IS NULL`."

### S2. Chunk 7 ↔ Chunk 9 dependency declaration is contradictory

- **Where:** plan chunk-overview table (line 291) says Chunk 7 depends on `1, 4`. Per-chunk text (line 1049) says `1, 4, 9`. Chunk 9 (line 1259) says `1, 3, 7`.
- **Fix:** Chunk 9 owns event taxonomy + WebSocket transport + REST replay; Chunk 7 emits events through Chunk 9's primitive; Chunk 7 depends on 9. Update overview table to `7 | ... | 1, 4, 9`. Update Chunk 9 to drop `7` from dependencies. Redraw chunk-dependency graph.

### S3. Spec uses `review_required` while codebase uses `awaiting_approval`

- **Where:** spec §5.1.1 lines 401–409.
- **Fix:** add a one-line note to spec §5.1.1: "`review_required` is the spec's user-facing term; the codebase column value is `awaiting_approval`. All SQL predicates and `assertValidTransition` calls use `awaiting_approval`."

### S4. App-facing UI strings violate the no-em-dashes rule

- **Where:** spec line 1140, spec line 1149, plan line 1680.
- **Fix:** rewrite each string with commas/colons/sentence breaks per CLAUDE.md user-prefs.

### S5. Brief §14.1 still uses the v1 tab names

- **Where:** brief line 773. Brief §6.3 renamed Live → Now and Flow → Plan; §14 mockup index wasn't updated.
- **Fix:** change to `Now (org chart) / Plan (planned route)`.

### S6. Spec §6.3 `seen_payload.step_type` enum doesn't match engine union

- **Where:** spec §6.3 line 521.
- **Fix:** add a one-line note: "`step_type` is the four-A's user-facing label per §4.1, NOT the engine `WorkflowStepType`. Derived at gate-open via the validator's user-facing mapper."

---

## Non-Blocking Improvements (deferred to `tasks/todo.md`)

- **N1.** Spec §3.1 row for `agent_execution_events` event-allocation invariant duplicates §8.1's contract. §3.1 should defer to §8.1 with a one-line cross-reference.
- **N2.** Plan Chunk 0 spike: clarify whether the 2 days are inside or on top of the ~40-day baseline.
- **N3.** Spec §16.5 total ~59 days vs plan's ~40 days. Plan trims via primitive reuse. Fold the resolved number back into spec §16.5.
- **N4.** Plan §Risks lines 1857–1899 — anchor links to the responsible chunk would help navigation.

---

## Summary

Tight docs-only PR with prior review history (4 ChatGPT spec rounds + 3 plan-gate rounds). Structural shape is solid. Blocking issues are all of the form "spec assumed a column / file / table that doesn't exist in the post-rename codebase" — exactly the class of issue benefiting from a fresh independent reviewer comparing spec text against actual schema files.

Recommend: address B1–B5 in a single follow-up commit, fold in the strong items if operator agrees, route N1–N4 to `tasks/todo.md` as deferred.
