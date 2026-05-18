# Brief — New Task Modal Overhaul: rename brief → task + enrich the creation surface

**Status:** DRAFT v1 (2026-05-18) — initial draft
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `new-task-modal-overhaul`
**Class:** Major (cross-cutting rename across schema + API + 300+ files, plus new UI scope)
**Predecessor for:** `operator-confidence-layer` (Preview + Undo + recurring task add-on) — that build is paused pending this build's completion

## Core thesis

This build modernises the new-task creation flow. It renames the legacy "brief" concept to "task" across the codebase (a deprecated concept that lives on in 300+ files), replaces the minimal `NewBriefModal` with a richer `NewTaskModal` that can capture a real task's context up front (instructions, assigned agent, attachments, due date), and unblocks the paused `operator-confidence-layer` build which depends on this richer surface for its recurring task creation, Preview, and Undo features.

## Problem

### 1. The "brief" concept lives on in the codebase as legacy naming

The product removed the "brief" concept from its operator-facing model a long time ago — the operator clicks "+ New Task" to create a task, not a brief. But the codebase still uses `brief` everywhere:

- **264 server files** reference `brief` (routes, services, schemas, jobs, tests)
- **45 client files** reference `brief` (modal, types, hooks, pages)
- **10 shared types** (e.g. `BriefCreationEnvelope`, `briefFastPath`)
- **35 migrations** mention `brief`
- The whole `/api/briefs/*` route family (POST create, GET metadata, GET active-run, GET artefacts, POST messages, POST approvals) is the operator's task-creation API today
- A `portalBriefs` table and a `briefId` foreign-key column on `fastPathDecisions`
- `client/src/pages/OpenTaskView.tsx` calls `/api/briefs/${taskId}` — the URL parameter is even named `taskId` while the route segment says `briefs`, capturing the disconnect

This is technical debt that confuses new developers, misrepresents the product, and makes every future change in this area more expensive than it should be.

### 2. The new-task modal is too thin to set up a real task

The current `NewBriefModal.tsx` is intentionally minimal: Title, Description, Priority, Org override (system admins), Subaccount override. That's it.

This is too thin to set up a real task. An operator who wants to give an agent a meaningful work assignment cannot:

- Attach files (drag-and-drop or otherwise)
- Pick a specific agent up front (assignment happens downstream via auto-routing)
- Write longer instructions or a brief textarea distinct from the short description
- Set a due date
- Set retry policy, token budget, or other execution context

To do any of that, the operator has to create a minimal brief, wait for it to become a task, then open `TaskModal.tsx` (the *edit* modal) which has the richer field set. Creation is artificially two-step.

The asymmetry breaks the downstream `operator-confidence-layer` build: that build wants to add a "Make this task recurring" toggle on the creation modal, but recurring tasks require an assigned agent + schedule fields and benefit from instructions / context being captured up front. The current modal cannot host this without feeling cramped or under-specified.

## Goal — what operators can do (and what the codebase looks like)

Two operator-visible outcomes plus one codebase outcome:

1. **One-modal task setup.** The operator clicks "+ New Task", enters title, writes instructions (longer than today's description), picks an assigned agent, sets a due date, drags in any context files, and submits — all in one place. No follow-up edit step required to make the task useful.
2. **Right vocabulary everywhere.** The product surfaces and the codebase both say "task". The legacy "brief" naming is removed.
3. **A clean foundation for `operator-confidence-layer`.** When that build resumes, the recurring task add-on, Preview option, and Undo affordance all layer onto a modern, capable modal rather than the minimal one.

## Proposed approach — mechanisms (for the architect to evaluate)

### Capability 1: Codebase rename — brief → task

The deprecated "brief" concept is renamed to "task" wherever it represents the same thing operators now call a task. The architect at spec authoring decides per-file whether to rename in place, merge with existing `task`-shaped code (some `tasks` tables / services already exist for the kanban-board task model), or keep the name where "brief" is genuinely a different domain concept (e.g. marketing briefs, if any).

#### Backend rename

- `server/routes/briefs.ts` — rename file and rename every route inside it from `/api/briefs/*` to `/api/tasks/*` (or merge with an existing `/api/tasks` route family if present). Decision at spec authoring.
- `server/services/*brief*` — rename services to `*task*`. Spec author must list each affected service and decide rename vs merge.
- `shared/types/briefFastPath.ts` and similar — rename types (e.g. `BriefCreationEnvelope` → `TaskCreationEnvelope`).
- 264 server files referencing `brief` to be swept. Architect decides which are genuine renames vs incidental string matches vs unrelated brief usages.

#### Database migration

- `portalBriefs` table → renamed (or merged with an existing `tasks` table if appropriate).
- `briefId` foreign-key column on `fastPathDecisions` (and any other tables) → renamed to `taskId` (or pointing at the renamed primary table).
- 35 migrations mention `brief`. Most are historical; the spec author identifies which entities are still live and need rename migrations.
- Standard up/down migration pair. Existing row data preserved through the rename.

#### Frontend rename

- `client/src/components/layout/modals/NewBriefModal.tsx` → `NewTaskModal.tsx`. The component itself is rewritten in Capability 2 below.
- `client/src/components/review-queue/NewBriefModal.tsx` → also renamed (separate review-queue modal; today is also minimal).
- All `client/src/api/*brief*` files → renamed.
- All `BriefXxx` TypeScript types/interfaces → renamed.
- All hardcoded "/api/briefs" URLs in client → updated to the new route.
- 45 client files swept.

#### API cutover strategy

The `/api/briefs` rename is a breaking API change. Two options for the spec to pick between:

1. **Hard cutover.** New route only; old route removed. Acceptable if no external consumers depend on `/api/briefs`.
2. **Aliased deprecation window.** Old route stays for one release as a thin shim that proxies to the new route; deprecation header set; removal scheduled. Adds complexity but reduces blast radius.

Spec author decides; brief defaults to hard cutover unless review surfaces an external consumer.

### Capability 2: Enrich the new-task modal

`NewTaskModal.tsx` (renamed from `NewBriefModal.tsx`) is rebuilt as the operator's primary task-creation surface. It captures everything a task needs without forcing a follow-up edit step.

#### Field set

The new modal supports:

- **Title** (required; existing)
- **Description / Instructions** (textarea; the brief writes longer instructions here instead of a separate "brief" textarea — single field, scaled up)
- **Assigned Agent** (select from configured subaccount agents; if exactly one agent is available, the select is hidden and the agent assigned automatically per the existing default-agent pattern from `client/src/components/review-queue/NewBriefModal.tsx`)
- **Due Date** (optional; existing TaskModal pattern)
- **File attachments** (NEW — drag-and-drop area; uses the existing task-attachment API the existing `TaskModal.tsx` already wires to `/api/tasks/:id/attachments`)
- **Priority** (existing; low / normal / high / urgent)
- **Organisation override** (system admins only; existing)
- **Subaccount override** (existing)

The field set is the minimum needed to set up a task that can run unattended. Anything beyond this (status, multi-agent assignment, retry policy, token budget, etc.) stays on the edit surface — operators set those after the task is created, not at intake.

#### File attachment UX

Drag-and-drop is the primary interaction. A subtle drop-zone surrounds the modal body when dragging; clicking the drop-zone opens a file picker. Attached files appear as a small list under the description, with size + filename + remove (`×`). The existing `TaskModal.tsx` attachments tab patterns (`AttachmentTypeIcon`, formatBytes, plain-English failure handling) are reused. Allowed types: same as today (PNG / JPEG / GIF / WebP / PDF / TXT / Markdown, 10MB max).

Upload happens after the task is created. UX: title + agent + description submitted first, then attachments uploaded against the new task ID — same pattern the edit modal uses today. Operator sees attachments uploading inline with progress.

#### Progressive disclosure

The modal grows when fields are filled but stays compact by default. Decisions for the mockup round:

- Default-visible fields: Title, Description (collapsed to a single-line until clicked?), Agent
- Default-hidden / progressively-disclosed fields: Due Date, Priority, Org / Subaccount overrides (admin-conditional already)
- The drop-zone is always present but visually quiet until a file is dragged over the modal

Goal: a first-time user sees a clear "what's the task?" intake. An experienced user can fill in everything.

## Constraints / non-goals

- DO NOT introduce a new page or route for task creation. The new-task modal stays a modal — same `+ New Task` nav button, same overlay-style modal pattern as today.
- DO NOT change downstream task behaviour. Once a task is created, every existing flow (kanban board, scheduled-task creation, agent triggers, etc.) continues to work. Only the intake surface and the naming change.
- DO NOT add scheduling, Preview, or Undo affordances in this build. Those are `operator-confidence-layer`'s scope, sequenced after this.
- DO NOT add status / multi-agent assignment / retry policy / token budget fields to the creation modal. Those stay on the edit surface (`TaskModal.tsx`) — creation captures the minimum needed to set up a runnable task, not every editable field.
- DO NOT rewrite incidental "brief" usages that are not the deprecated concept. If "brief" appears as a generic English noun ("a brief summary", "in brief"), leave it alone. Spec author identifies the rename targets at authoring.
- DO NOT defer the database rename. The codebase-level rename without the schema rename leaves the worst possible state (operator-facing words say "task", developer-facing words say "task", database says `briefs`). All three layers rename together.
- DO NOT touch external API consumers without an explicit cutover decision. If `/api/briefs` is being deprecated, the spec must declare hard cutover vs aliased deprecation window per Capability 1's cutover strategy.

## Open decisions for the mockup round

The mockup round resolves these decisions before spec authoring begins:

1. **Modal layout when expanded.** With the richer field set, the modal grows taller. Compact column-stacked layout, or two-column grid for Priority / Due Date / Agent? Mockup picks the one that reads cleanly at the standard modal width (`max-w-lg` ≈ 512px, or wider if the design requires it).
2. **File attachment affordance.** Always-visible drop-zone vs button vs hidden-until-drag? Where in the modal layout?
3. **Agent picker shape.** Plain select dropdown vs richer card-style picker showing agent name + role + icon (as in some existing surfaces)?
4. **Description vs Instructions naming.** Single textarea labelled "Description"? Or split into a short "Title" + a longer "Instructions" textarea?
5. **Progressive disclosure cutoff.** Which fields are visible by default vs revealed via an "Advanced" expander? Frontend Design Principles default-to-hidden rule applies.

## Mockup constraints

The mockup round MUST NOT imply any of the following — these are explicit non-features for this build:

- No scheduling fields, no "Make this task recurring" toggle (that's `operator-confidence-layer` scope)
- No Preview-before-running option (also `operator-confidence-layer`)
- No status / column picker in the modal (creation lands in inbox / default; status is set on the kanban surface)
- No multi-agent assignment in the modal (single primary agent only; multi-assign happens on edit)
- No conversation / chat tab on the creation modal (creation, not edit)
- No legacy "brief" terminology anywhere in the mockup

## Files in scope (architect locks at spec authoring; mockup round runs first)

The actual file inventory is large and the architect locks it at spec authoring. The brief lists the categories and example anchor files; the spec author enumerates the full set.

- **Mockup:** `prototypes/new-task-modal-overhaul/` (multi-screen — new modal default state, new modal with attachments dragged in, new modal expanded with Advanced disclosure if used)
- **Client (Capability 1 — rename):**
  - `client/src/components/layout/modals/NewBriefModal.tsx` → `NewTaskModal.tsx` (the global "+ New Task" modal; rewritten in C2 below)
  - `client/src/components/review-queue/NewBriefModal.tsx` → `NewTaskModal.tsx` (the review-queue create modal)
  - All `client/src/api/*brief*` modules → renamed
  - `client/src/pages/OpenTaskView.tsx` and other pages that fetch `/api/briefs/...` — updated to the new route
  - All `BriefXxx` types in `client/src/types/` and inline interfaces → renamed
- **Client (Capability 2 — enrichment):**
  - `NewTaskModal.tsx` body: add Assigned Agent select, Due Date input, Instructions textarea, File drop-zone + attachment list
  - Reuse `client/src/components/task-modal/*` helpers (`AttachmentTypeIcon`, `formatBytes`, etc.) for attachment rendering
  - Possibly extract a shared `TaskAttachmentDropZone` component used by both modals
- **Server (Capability 1 — rename):**
  - `server/routes/briefs.ts` → renamed; route paths swept
  - All `server/services/*brief*.ts` → renamed (or merged with existing task services where appropriate; spec decides per file)
  - All `server/jobs/*brief*.ts` if any → renamed
  - `server/db/schema/portalBriefs.ts` → renamed; `briefId` FK on `fastPathDecisions.ts` renamed
  - 264 server files swept for rename targets
- **Server (Capability 2 — enrichment):**
  - The new-task creation endpoint (renamed) must accept the new fields: `assignedAgentId`, `dueDate`, `description` (longer-form), and the task-attachment upload still uses the existing `/api/tasks/:id/attachments` endpoint
  - No new endpoints; existing endpoints take wider payload
- **Shared types:**
  - `shared/types/briefFastPath.ts` and similar → renamed; type names swept
  - `shared/types/BriefCreationEnvelope` → `TaskCreationEnvelope`
- **Migrations:**
  - One or more rename migrations: `portalBriefs` table → renamed; `briefId` FK column on `fastPathDecisions` → `taskId`; any other `brief`-named DB entities
  - Standard up/down pair; data preserved
  - 35 historical migrations mention `brief`; most are no-op (historical state); the spec lists which need attention
- **Tests:**
  - All test files updated for renamed types / routes / components
  - New tests for the enrichment: NewTaskModal field-set, file-drop interaction (pure decision logic), agent-select default behaviour
- **Documentation:**
  - `architecture.md` swept for `brief` references; renamed where the deprecated concept is meant
  - `KNOWLEDGE.md` swept similarly
  - `docs/capabilities.md` swept

## Success criteria

1. **No legacy `brief` references for the deprecated concept** remain in `server/`, `client/`, `shared/`, `migrations/`, or top-level docs. (Generic English uses of "brief" are allowed; the spec lists which.)
2. **The `/api/briefs/*` route family is replaced** with `/api/tasks/*` (or merged); old endpoints either removed or aliased per the cutover decision.
3. **The database has no `briefs` table or `briefId` columns** referring to the deprecated concept; data is preserved in the renamed structures.
4. **`NewTaskModal` supports rich task setup in one modal.** An operator can: enter title, write instructions, pick assigned agent, set due date, drag files in, set priority, and submit — without needing a follow-up edit step.
5. **The existing one-off task creation flow still works.** Operator clicks "+ New Task", fills the form, submits — task is created with the same downstream behaviour as today, just with richer initial state.
6. **Existing task-related surfaces continue to work unchanged.** The kanban board (`WorkspaceBoardPage`), `TaskModal` edit view, scheduled tasks list, agent triggers, etc. all operate normally on the renamed model.
7. **CI / typecheck / migration runs pass.** No broken references, no orphaned imports.
8. **The `operator-confidence-layer` build can resume on this surface.** That build's recurring add-on + Preview + Undo features lay on top of the renamed and enriched modal without needing further surface changes.

## What unblocks when this ships

- The `operator-confidence-layer` build resumes immediately on a clean, modern foundation.
- New developers stop having to learn that "brief" means "task" in this codebase.
- Operators get a creation experience that captures real task context up front, not a deferred two-step.
- The API surface aligns with the actual product vocabulary, making future external integrations and documentation simpler.
- Any future task-creation enhancements (multi-step wizards, templates, AI-assisted intake) have a sane base to build on.

## Concurrent safety note

This build conflicts with the paused `operator-confidence-layer` build, which extends `NewBriefModal.tsx` directly. Sequence is enforced: this build merges first, then `operator-confidence-layer` resumes with re-grounded mockups against the renamed `NewTaskModal`.

Also flag any other in-flight build touching `/api/briefs`, the `briefs` table, or `NewBriefModal` before launching the spec for this build. The rename is wide enough that mid-flight collisions are likely. Scan `tasks/builds/*/spec.md`, `*/plan.md`, and `*/brief.md` for `brief`-related work before starting Phase 2.

Backend API rename is breaking for external consumers if any. Spec author must verify whether `/api/briefs/*` is documented externally or called by any non-internal client (Postman collection, partner integration, etc.).

## Provenance

Discovered during `operator-confidence-layer` Round 3 mockup audit on 2026-05-18. Operator noted that the "brief" concept was removed from the product model long ago but the codebase still uses it everywhere — `NewBriefModal.tsx`, `/api/briefs/*`, `briefs` table, `BriefCreationEnvelope` type, 300+ files. Operator also noted the current new-task modal is too thin to support a real task with attachments / agent / instructions, which would in turn make `operator-confidence-layer`'s recurring task add-on feel cramped and under-specified.

Decision: scope this as a separate prerequisite build to avoid conflating an unrelated rename + UX enrichment with the operator-confidence layer's actual operator-facing value (Preview + Undo + recurring add-on). `operator-confidence-layer` pauses; this build leads.

Operator-ratified 2026-05-18.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/new-task-modal-overhaul/brief.md
```
