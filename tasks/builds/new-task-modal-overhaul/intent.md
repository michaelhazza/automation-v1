# Intent — new-task-modal-overhaul

**Produced by:** spec-coordinator Step 3 (2026-05-18)
**Scope class:** Major
**Brief source:** `tasks/builds/new-task-modal-overhaul/brief.md` (FINAL v3, 2026-05-18)

---

## Problem Statement

The product removed the "brief" concept from its operator-facing vocabulary — operators interact with "Tasks" throughout the UI. However, the codebase retains "brief" terminology at every layer: routes (`/api/briefs/*`), services (`briefCreationService`, `briefConversationService`, `briefVisibilityService`, `briefApprovalService`), shared types (`BriefCreationEnvelope`, `FastPathDecision`, `BriefUiContext`), client components (`NewBriefModal.tsx`), and database FKs (`fastPathDecisions.briefId`). This creates onboarding friction for developers and misrepresents the product at API boundaries. Separately, the current task creation modals are intentionally minimal, requiring operators to open a follow-up edit step to add agent assignment, instructions, attachments, and due date. This two-step creation flow is sub-optimal and blocks the paused `operator-confidence-layer` build.

## Desired Outcome

1. **One vocabulary.** "Task" is used at every layer — routes, services, types, UI, database FKs. The legacy "brief" term is absent from all operator-facing code paths.
2. **One creation surface.** The operator clicks "+ New Task", fills title + instructions + agent + files in one modal, and submits — no follow-up edit step required.
3. **One canonical operator-task domain model.** The existing `tasks` table remains the canonical model. The `portalBriefs` table (a portal card publishing table unrelated to the operator-task model) is renamed to reflect its actual purpose. The `/api/briefs` route family is renamed with a declared topology (merged into existing task route or renamed to a new dedicated path). No parallel "brief + task" representations for the same concept after this build.
4. **Unblock `operator-confidence-layer`.** That build's recurring task add-on, Preview, and Undo features layer onto the enriched `NewTaskModal` surface without further changes.

## Non-Goals

- Scheduling, Preview, Undo, or recurring task toggle (operator-confidence-layer scope)
- A new page or route for task creation (stays as a modal overlay)
- Changes to downstream task behaviour (kanban board, agent triggers, scheduled tasks, workflow engine)
- Renaming incidental English uses of "brief" (e.g., "brief summary"), historical migration snapshot SQL comments, or third-party payload compatibility structures
- New agent infrastructure, new workflow primitives, or changes to fast-path triage logic
- Multi-agent assignment or retry/token-budget fields on the creation modal (those stay on the edit surface `TaskModal.tsx`)

## Affected Capability Area

Agent Runtime (universal-brief, task-board-workspace)

## User / Operator Impact

Operators get a richer task creation surface in one step. Developers stop navigating a "brief" layer when working on what the product calls "tasks". The `operator-confidence-layer` build can resume immediately on the enriched surface. External integrations and documentation become simpler as the API surface aligns with product vocabulary.

## Risk Surface

server/routes, server/db/schema, auth/permission services, middleware

## Assumptions

- `tasks` is already the canonical database table for operator tasks; `portalBriefs` is a portal card publishing table (workflow output display — stores `workflowSlug`, `bullets`, `detailMarkdown`, `isPortalVisible`) and is NOT a competing operator-task model.
- `fastPathDecisions.briefId` already references `tasks.id` — it requires a column rename to `taskId` only, no data migration.
- The two current creation paths (`/api/briefs` for AI-augmented task creation with fast-path triage and `POST /api/subaccounts/:id/tasks` for plain kanban task creation) both write to the `tasks` table; topology is API-layer only, not schema-layer.
- No external API consumers of `/api/briefs/*` exist (spec author must verify before spec lock; default to hard cutover if none found).
- The `brief-creation-unify` stub spec (`tasks/builds/brief-creation-unify/spec.md`) is superseded by this build — its F1 item (response envelope harmonisation) becomes moot when the routes are renamed; F5–F8/F15 (rate limiting, ILIKE, session/message tests, org/subaccount names) are unrelated to this build and remain as separate deferred work if still applicable.
- Instructions is the canonical UX label for the long-form task description field; the spec author will declare whether it maps to the existing `description` column, the existing `brief` column, or a new column (the `tasks` table has both `description` and `brief` columns).

## Open Questions

- **Topology decision (required before spec authoring):** Should `/api/briefs` be renamed to a new standalone path (e.g., `/api/task-intake` or `/api/tasks/triage`), or merged into `POST /api/subaccounts/:id/tasks` as an extended payload that runs fast-path triage when certain fields are present? The namespace `/api/tasks/*` is already used for attachment operations (`/api/tasks/:taskId/attachments`); merging must not create a route collision.
- **Instructions field data contract:** `tasks` table has both `description` (text, nullable) and `brief` (text, nullable) columns. Which one becomes the storage home for the "Instructions" field? Options: (a) UI-only relabelling of `description`, (b) UI-only relabelling of `brief`, (c) rename one column, (d) new column. The spec must declare one resolution — dual fields with unclear precedence are prohibited (Product invariant 8).
- **Attachment gating mechanism:** Which existing `status` enum value, queue, or column on `tasks` implements "not runnable until attachments settle"? The spec must name the existing primitive, not invent new hidden state (Product invariant 3).
- **`portalBriefs` rename target:** What name best reflects its actual purpose — `portalCards`, `workflowOutputCards`, or leave named `portalBriefs` (acceptable since it IS a portal publishing concept, even if the "brief" suffix is legacy)? Low-risk naming decision but must be declared.

## Grill-me Q&A

*Conducted 2026-05-18 — 9 rounds. Decisions recorded verbatim.*

**Q1 — Route topology**
Should `/api/briefs` merge into the existing kanban task endpoint, or rename to a standalone path?
*Recommendation:* standalone rename (different return shape, side effects, caller expectations).
*Decision:* standalone rename (e.g., `/api/task-intake`).

**Q2 — Instructions field storage**
`description` column or schema-level rename?
*Recommendation:* UI-only relabel of `description`; defer column rename.
*Decision:* UI-only relabel — "Instructions" maps to `description` in storage.

**Q3 — Attachment gating posture**
Blocking (new status/flag) or advisory (execution starts immediately)?
*Recommendation:* advisory — no new primitive needed; defer blocking posture.
*Decision:* advisory. Task starts execution immediately; attachments resolve in parallel.

**Q4 — `portalBriefs` table rename**
Rename to `portalCards` or leave?
*Recommendation:* rename to `portalCards`.
*Decision:* rename to `portalCards`.

**Q5 — External API consumers**
Any external consumers of `/api/briefs/*`?
*Decision:* none confirmed. Hard cutover.

**Q6 — Instructions required or optional?**
*Recommendation:* optional with soft prompt (consistent with current behaviour).
*Operator override:* **Required.** Instructions mandatory at creation; Create Task button disabled until filled; server rejects without it. Eliminates "task sits in inbox without routing" class of problems.

**Q7 — Single shared component or two separate `NewTaskModal` components?**
*Recommendation:* two separate components (different endpoint behaviour).
*Decision:* two separate components. Layout modal → renamed brief-creation route (triage). Review-queue modal → kanban task endpoint. Shared sub-components extracted.

**Q8 — Review-queue modal enrichment scope**
Full field set or rename only?
*Operator direction:* full enrichment on both variants — operators should have the same capability at both surfaces. Inconsistency causes frustration when fields available in one place are missing in another.
*Decision:* both modals get full field set (Instructions required, agent picker, file attachments, due date). Review-queue variant keeps default-agent auto-selection as default but operator can override.

**Q9 — `brief` column on `tasks` table**
Drop (unused, legacy name) or leave?
*Recommendation:* drop in this build.
*Decision:* drop it. Add to migration; spec author verifies no live reads before shipping.

---

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

**Basis:** No truly in-flight spec duplicates this build's desired outcome. The `brief-creation-unify` stub exists but has an unactivated trigger condition ("when the next divergence is discovered") — it is not in-flight development; F1 of that stub will be superseded and closed by this build. The `operator-confidence-layer` and `task-preview-mode` builds are explicitly downstream dependents, not duplicates. Agent Runtime cluster is active (universal-brief at Growth, task-board-workspace at Mature).
