# Brief — New Task Modal Overhaul: rename brief → task + enrich the creation surface

**Status:** DRAFT v2 (2026-05-18) — Round 1 brief review applied
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `new-task-modal-overhaul`
**Class:** Major (cross-cutting rename across schema + API + 300+ files, plus new UI scope)
**Predecessor for:** `operator-confidence-layer` (Preview + Undo + recurring task add-on) — that build is paused pending this build's completion

## Core thesis

This build modernises the new-task creation flow. It renames the legacy "brief" concept to "task" across the codebase (a deprecated concept that lives on in 300+ files), replaces the minimal `NewBriefModal` with a richer `NewTaskModal` that can capture a real task's context up front (instructions, assigned agent, attachments, due date), and unblocks the paused `operator-confidence-layer` build which depends on this richer surface for its recurring task creation, Preview, and Undo features.

## Required architectural decision: canonical operator-task model

The biggest risk in this build is NOT the rename itself — it is ending up with parallel, partially-overlapping "task" concepts after the rename (old-task / new-task / kanban-task / portal-task / scheduled-task / intake-task). Without an upfront ownership decision, the spec author could accidentally create `tasks` + `portalTasks` + legacy wrappers + duplicate services + dual DTOs, leaving a state worse than today.

**Invariant:** This build must end with exactly one canonical operator-task domain model. Parallel `portalBriefs` and `tasks` concepts representing the same operator workflow are prohibited post-build.

Spec author MUST declare one of the following resolutions before any rename work begins:

1. **`portalBriefs` becomes the canonical `tasks` model.** The existing kanban-board `tasks` table is merged into the new canonical model, or the kanban surface is migrated to use the canonical model.
2. **Existing `tasks` model absorbs `portalBriefs`.** The kanban-board `tasks` table is the canonical model; `portalBriefs` row data is migrated into it with any schema gaps reconciled.
3. **Façade / consolidation model with declared ownership boundaries.** A single facade owns the canonical task concept; underlying physical separation (if any) is justified explicitly with a documented ownership boundary in the spec.

Silent dual-model coexistence after this build is prohibited. The spec must declare the chosen resolution, the post-build topology (which tables / services / routes exist, who owns each), and the surviving domain vocabulary.

## Product invariants

1. **Single canonical operator-task model.** Per the architectural decision above, exactly one canonical task domain model exists post-build. No parallel `portalBriefs` + `tasks` overlap representing the same operator workflow.
2. **Semantic ownership of the rename.** Only references representing the deprecated operator-task concept are renamed. Historical migration snapshots, audit evidence, third-party payload compatibility structures, and unrelated domain terminology (e.g. "brief summary" as English) are exempt unless explicitly migrated. The spec lists the rename targets at authoring; reviewers reject grep-blind renames.
3. **Task creation and attachment upload are separate operations.** A task may exist with zero, partial, or failed attachments. Execution-start gating behaviour must be explicitly declared by the spec (uploads block runnable state vs uploads are advisory).
4. **API rename emits migration telemetry.** If aliased deprecation is selected, all legacy route usage emits structured telemetry sufficient to identify remaining consumers before removal. Hard cutover is the default; aliases without telemetry are prohibited.
5. **Database rename declares migration semantics.** The spec must declare whether the migration is pure rename, copy-and-cutover, or merge / consolidation. Rollback semantics, FK preservation, index / constraint rename policy, ORM regeneration order, and lock expectations must be documented.
6. **Accessibility floor for drag-and-drop.** The file upload affordance is keyboard-accessible, screen-reader labelled, and provides a non-drag fallback (button-driven file picker) always available.

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

- `portalBriefs` table → resolved per § Required architectural decision (rename in place, merged into existing `tasks`, or façade-mediated). The spec author declares the chosen resolution and its migration shape.
- `briefId` foreign-key column on `fastPathDecisions` (and any other tables) → renamed to `taskId` (or pointing at the renamed primary table per the chosen resolution).
- 35 historical migrations mention `brief`. Most are historical state and require no change; the spec author identifies which entities are still live and need rename migrations.
- **Migration shape declaration required (per Product invariant 5).** The spec must declare one of: (a) pure rename (column / table renames preserving identity), (b) copy-and-cutover (new table populated from old, old removed in a later phase), or (c) merge / consolidation (existing `tasks` absorbs `portalBriefs` data). FK preservation, index / constraint rename policy, ORM schema regeneration order, and lock expectations are documented per the chosen shape.
- **Rollback expectations declared.** Each migration ships with an up / down pair. The spec documents what rollback means for in-flight data and whether rollback is a supported emergency path or a build-time-only safety net. For copy-and-cutover or merge shapes, rollback semantics must include the recovery posture for any data written to the new structure after cutover.

#### Frontend rename

- `client/src/components/layout/modals/NewBriefModal.tsx` → `NewTaskModal.tsx`. The component itself is rewritten in Capability 2 below.
- `client/src/components/review-queue/NewBriefModal.tsx` → also renamed (separate review-queue modal; today is also minimal).
- All `client/src/api/*brief*` files → renamed.
- All `BriefXxx` TypeScript types/interfaces → renamed.
- All hardcoded "/api/briefs" URLs in client → updated to the new route.
- 45 client files swept.

#### API cutover strategy

The `/api/briefs` rename is a breaking API change. Two options for the spec to pick between:

1. **Hard cutover.** New route only; old route removed. Default choice when no external consumers depend on `/api/briefs`.
2. **Aliased deprecation window.** Old route stays for one release as a thin shim that proxies to the new route; deprecation header set; removal scheduled.

**Telemetry requirement (per Product invariant 4).** If aliased deprecation is selected, the alias MUST emit structured telemetry capturing: caller identifier (user agent / API key / source IP cluster), legacy route hit count, timestamp, and the migrated equivalent route. Telemetry feeds a deprecation dashboard or report sufficient to identify remaining consumers before removal. Without this, the alias becomes silently permanent.

**Removal gate.** When alias is selected, the spec author defines the removal trigger condition (e.g. "zero legacy hits for N consecutive days") and the CI invariant that enforces it (see § Test invariants).

Spec author decides; brief defaults to hard cutover unless review surfaces an external consumer.

### Capability 2: Enrich the new-task modal

`NewTaskModal.tsx` (renamed from `NewBriefModal.tsx`) is rebuilt as the operator's primary task-creation surface. It captures everything a task needs without forcing a follow-up edit step.

#### Field set

The new modal supports:

- **Title** (required; existing)
- **Instructions** (textarea; canonical name — replaces today's short "Description" with a longer-form field; the field captures what the agent should actually do; multi-line)
- **Assigned Agent** (select from configured subaccount agents; if exactly one agent is available, the select is hidden and the agent assigned automatically per the existing default-agent pattern from `client/src/components/review-queue/NewBriefModal.tsx`)
- **Due Date** (optional; existing TaskModal pattern — see § Due date semantics)
- **File attachments** (NEW — drag-and-drop area; uses the existing task-attachment API the existing `TaskModal.tsx` already wires to `/api/tasks/:id/attachments` — see § Attachment lifecycle)
- **Priority** (existing; low / normal / high / urgent)
- **Organisation override** (system admins only; existing)
- **Subaccount override** (existing)

The field set is the minimum needed to set up a task that can run unattended. Anything beyond this (status, multi-agent assignment, retry policy, token budget, etc.) stays on the edit surface — operators set those after the task is created, not at intake.

#### File attachment UX

Drag-and-drop is the primary interaction, with a non-drag fallback (button-driven file picker) always visible (per Product invariant 6). A subtle drop-zone surrounds the modal body when dragging; clicking the fallback button opens a file picker. Attached files appear as a small list under the Instructions field, with size + filename + remove (`×`). The existing `TaskModal.tsx` attachments tab patterns (`AttachmentTypeIcon`, formatBytes, plain-English failure handling) are reused. Allowed types: same as today (PNG / JPEG / GIF / WebP / PDF / TXT / Markdown, 10MB max).

#### Attachment lifecycle (per Product invariant 3)

Task creation and attachment upload are separate operations. The lifecycle:

1. Operator fills the modal, optionally drags files in (held client-side in a pending list).
2. Operator submits.
3. Task is created via the renamed task-creation endpoint. Task creation succeeds independently of attachments.
4. Pending attachments upload against the new task ID, one at a time, with inline progress.
5. Each upload's outcome is one of: success (attachment listed on the task), recoverable failure (retry button inline), or unrecoverable failure (red marker; operator can dismiss or fix and re-add).
6. **Execution-start gating posture must be declared by the spec.** Options: (a) the task is not runnable until all attachments settle (success or operator-dismissed failure), or (b) the task starts execution immediately and attachments resolve in parallel (advisory). Default: option (a) for safety, with explicit per-task or per-skill override available if needed.

Partial-failure semantics: a task may exist with some attachments uploaded and others failed. The operator sees this state clearly; the task is in a defined runnable / not-runnable state per the gating posture above.

#### Accessibility (per Product invariant 6)

- Drop-zone is keyboard-focusable; Enter / Space opens the file picker
- Screen-reader labels announce drop-zone state ("Drop files here, or press Enter to choose files")
- Non-drag fallback (button-driven file picker) is always visible, never hidden behind drag interaction
- Attached-file list rows are keyboard-navigable; remove (`×`) buttons have accessible labels

#### Progressive disclosure

The modal is an operational intake surface, not a tiny quick-add dialog. Visual hierarchy:

- **Always visible (the primary task setup):** Title, Instructions textarea, Assigned Agent picker
- **Always visible but secondary:** File drop-zone + fallback button (subtle when empty, prominent when files are pending)
- **Default-hidden behind an "Advanced" expander or similar:** Due Date, Priority, Org / Subaccount overrides (admin-conditional already)

Title + Instructions + Agent are always visible together — they are the minimum coherent task setup, not a quick-add subset. Compactness wins where it doesn't fight clarity; clarity wins where they conflict.

#### Due date semantics

Due date is optional and conforms to the existing task date conventions; no divergent date model is introduced by this build:

- **Type:** date-only (no time of day); aligns with the existing `TaskModal.tsx` `dueDate` field shape
- **Timezone:** stored as ISO date string; interpreted in the operator's local browser timezone for display, in the subaccount timezone for execution scheduling decisions
- **Past dates:** allowed (the operator may set a due date already in the past for back-dating; the existing edit surface allows this)
- **Recurring-task compatibility:** when the downstream `operator-confidence-layer` build adds the recurring add-on, due date interacts with the schedule's end conditions — that interaction is `operator-confidence-layer`'s scope, not this build's

#### Concurrent execution posture (per Product invariant 3)

When a task is created and attachments are still uploading, there is a race: backend creates the task and may auto-route it to an agent; the agent may start execution before attachment uploads complete. This race must have a defined posture (per § Attachment lifecycle above). Default: a task is not runnable (auto-routing held, execution blocked) until all attachments settle. Architect may justify a per-task or per-skill override but cannot leave the race undefined.

## Constraints / non-goals

- DO NOT end this build with dual operator-task model coexistence (per Product invariant 1 and § Required architectural decision). Silent parallel `portalBriefs` + `tasks` is the worst possible outcome.
- DO NOT perform a grep-blind rename (per Product invariant 2). Only references representing the deprecated operator-task concept are renamed. Historical migration snapshots, audit evidence, third-party payload compatibility structures, and incidental English uses of "brief" are exempt unless explicitly migrated. The spec lists rename targets at authoring; reviewers reject blind sweeps.
- DO NOT introduce a new page or route for task creation. The new-task modal stays a modal — same `+ New Task` nav button, same overlay-style modal pattern as today.
- DO NOT change downstream task behaviour. Once a task is created, every existing flow (kanban board, scheduled-task creation, agent triggers, etc.) continues to work. Only the intake surface and the naming change.
- DO NOT add scheduling, Preview, or Undo affordances in this build. Those are `operator-confidence-layer`'s scope, sequenced after this.
- DO NOT add status / multi-agent assignment / retry policy / token budget fields to the creation modal. Those stay on the edit surface (`TaskModal.tsx`) — creation captures the minimum needed to set up a runnable task, not every editable field.
- DO NOT default to creating new endpoints. Widen existing endpoints by default. A new task-intake orchestration endpoint is permitted ONLY if architectural review demonstrates a cleaner boundary than payload-widening (e.g. transactional creation + attachment-claim semantics, draft creation, batched intake). Spec author justifies any new endpoint at authoring.
- DO NOT defer the database rename. The codebase-level rename without the schema rename leaves the worst possible state (operator-facing words say "task", developer-facing words say "task", database says `briefs`). All three layers rename together.
- DO NOT touch external API consumers without an explicit cutover decision. If `/api/briefs` is being deprecated, the spec must declare hard cutover vs aliased deprecation window per Capability 1's cutover strategy.
- DO NOT leave the attachment-upload race undefined (per Product invariant 3). The spec declares the execution-start gating posture explicitly.

## Open decisions for the mockup round

Naming is settled (per Round 1 brief review): the long-form text field is **Instructions** (canonical), not "Description". The mockup round resolves these remaining decisions before spec authoring begins:

1. **Modal layout when expanded.** With the richer field set, the modal grows taller. Compact column-stacked layout, or two-column grid for Priority / Due Date / Agent? Mockup picks the one that reads cleanly at the standard modal width (`max-w-lg` ≈ 512px, or wider if the design requires it).
2. **File attachment affordance.** Drop-zone shape + fallback button placement. Constraint: the non-drag fallback button is always visible (per Product invariant 6); the drop-zone itself may be subtle when empty.
3. **Agent picker shape.** Plain select dropdown vs richer card-style picker showing agent name + role + icon (as in some existing surfaces)?
4. **Advanced expander cutoff.** Which secondary fields (Due Date, Priority, Org / Subaccount overrides) live inside an "Advanced" expander vs always visible? Frontend Design Principles default-to-hidden rule applies; Title + Instructions + Agent stay always visible regardless.

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
  - The new-task creation endpoint (renamed) accepts the new fields: `assignedAgentId`, `dueDate`, `instructions` (longer-form), and the task-attachment upload still uses the existing `/api/tasks/:id/attachments` endpoint
  - Prefer widening existing endpoints. A new task-intake orchestration endpoint is permitted ONLY if architectural review demonstrates a cleaner boundary than payload-widening (e.g. transactional creation + attachment-claim semantics, draft creation, batched intake). Spec author justifies any new endpoint at authoring.
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

1. **Exactly one canonical operator-task model post-build.** The architectural decision from § Required architectural decision is implemented; no parallel `portalBriefs` + `tasks` overlap remains. The spec's declared post-build topology is verifiable in the merged code.
2. **No legacy `brief` references for the deprecated concept** remain in `server/`, `client/`, `shared/`, `migrations/`, or top-level docs. (Generic English uses of "brief" are allowed; the spec lists which. Per Product invariant 2, grep-blind sweeps are rejected at review.)
3. **The `/api/briefs/*` route family is replaced** with `/api/tasks/*` (or merged); old endpoints either removed or aliased per the cutover decision. If aliased, legacy route hits emit structured telemetry and the CI invariant for alias removal is active (see § Test invariants).
4. **The database has no `briefs` table or `briefId` columns** referring to the deprecated concept; data is preserved per the migration shape declared by the spec (pure rename, copy-and-cutover, or merge).
5. **`NewTaskModal` supports rich task setup in one modal.** An operator can: enter title, write instructions, pick assigned agent, set due date, drag files in, set priority, and submit — without needing a follow-up edit step. Drag-and-drop has a working non-drag fallback at all times and meets the accessibility floor (keyboard, screen-reader) per Product invariant 6.
6. **Attachment lifecycle is defined and respected.** Tasks may exist with zero / partial / failed attachments; the execution-start gating posture declared by the spec is enforced; the operator sees clear state at every step (per Product invariant 3).
7. **The existing one-off task creation flow still works.** Operator clicks "+ New Task", fills the form, submits — task is created with the same downstream behaviour as today, just with richer initial state.
8. **Existing task-related surfaces continue to work unchanged.** The kanban board (`WorkspaceBoardPage`), `TaskModal` edit view, scheduled tasks list, agent triggers, etc. all operate normally on the renamed model.
9. **CI / typecheck / migration runs pass.** No broken references, no orphaned imports. The alias-removal CI invariant fires when the deprecation window expires (if aliases used).
10. **The `operator-confidence-layer` build can resume on this surface.** That build's recurring add-on + Preview + Undo features lay on top of the renamed and enriched modal without needing further surface changes.

## Test invariants

Specific CI / review gates required for this build:

- **Alias-removal gate (conditional).** If aliased deprecation is selected for the API cutover, a CI invariant enforces removal at the end of the deprecation window: when the deprecation expiration date is reached, `grep` for `/api/briefs/` in routes / config / OpenAPI / docs fails the build until the alias is removed. Spec sets the expiration date.
- **Single-canonical-model gate.** A static check (grep or AST) verifies that no code creates rows in both `portalBriefs` and `tasks` post-build. If the chosen resolution merges them, the check verifies `portalBriefs` does not exist as a writable surface (per Product invariant 1).
- **Semantic-rename review check.** The spec lists the rename targets. A review-time check (or PR template requirement) verifies each PR touching brief-named code references the renaming inventory and does not introduce new brief-named entities for the deprecated concept (per Product invariant 2).
- **Accessibility smoke test.** A test (manual or automated keyboard navigation walkthrough) confirms drag-and-drop has working keyboard + screen-reader + non-drag fallback paths (per Product invariant 6).

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

Brief v2 (2026-05-18) absorbed Round 1 brief review — added the § Required architectural decision section forcing the spec author to declare canonical operator-task ownership before any rename work; added six Product invariants (single canonical model, semantic ownership of rename, attachment lifecycle separation, API telemetry, DB migration semantics, accessibility); tightened the Database migration subsection with rollback expectations and migration-shape declaration; added telemetry requirements to API cutover; locked `Instructions` as the canonical field name (removed from open decisions); added a Due date semantics subsection (date-only, no divergent date model); added a Concurrent execution posture subsection; refined the no-new-endpoints constraint to allow architect-justified orchestration endpoints; added a § Test invariants section with alias-removal / single-canonical-model / semantic-rename / accessibility gates; expanded success criteria from 8 to 10 to reflect the new invariants.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/new-task-modal-overhaul/brief.md
```
