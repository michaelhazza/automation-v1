**Status:** reviewing
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18 (spec-reviewer iteration 3)
**Author:** spec-coordinator
**Build slug:** new-task-modal-overhaul
**Scope class:** Major

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime |
| Capability owner | owner-resolution-task-board-workspace |
| Lifecycle state on launch | Growth |
| Risk surface | server/routes, server/db/schema, auth/permission services, middleware |
| Review cadence | on-incident-only |

---

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | S | Task creation is already implemented; no external licensing required |
| Build | L | 300+ file rename sweep + 5 schema/data migrations (A–E) + modal enrichment across both surfaces |
| Carry | S | Rename reduces ongoing maintenance burden; no new services or infrastructure added |
| decommission | M | Reversing the rename would require re-sweeping 300+ files and reversing migrations |

---

## Table of Contents

1. [Goals](#1-goals)
2. [Non-Goals](#2-non-goals)
3. [Framing Assumptions](#3-framing-assumptions)
4. [Architecture Background](#4-architecture-background)
5. [Required Architectural Decision — Canonical Operator-Task Model](#5-required-architectural-decision)
6. [Capability 1 — Brief→Task Rename](#6-capability-1--brieftask-rename)
7. [Capability 2 — NewTaskModal Enrichment](#7-capability-2--newtaskmodal-enrichment)
8. [File Inventory Lock](#8-file-inventory-lock)
9. [Data Contracts](#9-data-contracts)
10. [Permissions and RLS](#10-permissions-and-rls)
11. [Execution Model](#11-execution-model)
12. [Phase Sequencing](#12-phase-sequencing)
13. [Test Invariants](#13-test-invariants)
14. [Deferred Items](#14-deferred-items)
15. [Testing Posture](#15-testing-posture)
16. [Execution-Safety Contracts](#16-execution-safety-contracts)
17. [Self-Consistency Pass](#17-self-consistency-pass)
18. [Open Questions](#18-open-questions)

---

## 1. Goals

1. **One vocabulary.** "Task" is used at every codebase layer — routes, services, types, client components, database FKs. The legacy "brief" term is absent from all operator-facing code paths after this build.
2. **One creation surface.** The operator clicks "+ New Task", fills title + instructions + optional agent + optional files in one modal, and submits. No follow-up edit step required to make the task useful.
3. **One canonical operator-task model.** The existing `tasks` table is the canonical model. `portalBriefs` (a portal card publishing table) is renamed to `portalCards`. The `/api/briefs` route family is renamed to `/api/task-intake`. No parallel brief + task representations for the same concept remain after this build.
4. **Unblock `operator-confidence-layer`.** That build's recurring add-on, Preview, and Undo features layer onto the enriched `NewTaskModal` without further surface changes.

## 2. Non-Goals

- Scheduling, Preview, Undo, or recurring task toggle — `operator-confidence-layer` scope
- A new page or route for task creation — stays as a modal overlay on the existing `+ New Task` button
- Changes to downstream task behaviour: kanban board, agent triggers, scheduled tasks, workflow engine, fast-path triage logic
- Renaming historical migration snapshot SQL, third-party payload compatibility structures, or incidental English uses of "brief" (e.g., prose comments using "brief" as a common word)
- New agent infrastructure, new workflow primitives, or changes to the orchestrator routing job
- Multi-agent assignment or retry/token-budget fields on the creation modal — those stay on `TaskModal.tsx`
- Staging/rollout infrastructure — no feature flags; hard cutover for all route and schema changes

## 3. Framing Assumptions

- `tasks` is already the canonical database table. All task and brief creation paths write rows into `tasks`. This build performs a terminology rename, not a data model migration.
- `portalBriefs` stores portal card snapshots (workflow output display: `workflowSlug`, `bullets`, `detailMarkdown`, `isPortalVisible`) keyed on `(runId, subaccountId, workflowSlug)`. It is NOT a competing operator-task model. Its "brief" suffix is legacy naming.
- `fastPathDecisions.briefId` already references `tasks.id` — the rename is a column rename only; no FK retargeting required.
- No external API consumers of `/api/briefs/*` exist. Hard cutover is safe.
- `tasks.brief` column is unused by all current creation and update paths. Dropping it is safe after a code-level verification grep.
- The `brief-creation-unify` stub spec (`tasks/builds/brief-creation-unify/spec.md`) is superseded by this build. Its F1 item (response envelope harmonisation) becomes moot when the routes are renamed; F5–F8/F15 (rate limiting, ILIKE, session/message tests) are unrelated to this build and are deferred as separate work.
- `docs/spec-context.md` — `pre_production: yes`, `live_users: no`. Data migrations on existing rows are safe at this stage.

## 4. Architecture Background

### 4.1 Existing state — brief vs task models

The `tasks` table is the single database model for operator-created work items. Both the "brief" creation path and the kanban task creation path write to `tasks`. A "brief" is not a separate entity — it is a task with additional metadata: a linked conversation thread and a fast-path triage decision.

Key schema facts:
- `tasks.title` — required text
- `tasks.description` — nullable text; written by both creation paths as the user's input text
- `tasks.brief` — nullable text; exists but is **never written** by any creation path (unused legacy column; dropped by this build)
- `tasks.status` — starts as `'inbox'` on creation
- `tasks.priority` — defaults to `'normal'`
- `tasks.assignedAgentId` / `tasks.assignedAgentIds` — nullable; set for direct assignment
- `tasks.dueDate` — nullable timestamp

The `fastPathDecisions` table links triage decisions to tasks via `briefId UUID REFERENCES tasks(id)`. The column name says "brief" but the FK target is the `tasks` table — a pure naming artifact.

The `portalBriefs` table is entirely unrelated to the operator-task model. It stores versioned portal card snapshots keyed on `(subaccountId, workflowSlug, publishedAt)`. Its connection to the "brief" concept is historical naming only.

### 4.2 Two creation paths

| Path | Endpoint | Permission | Return shape | Side effects |
|------|----------|------------|--------------|--------------|
| Task intake (AI-augmented) | `POST /api/briefs` | `BRIEFS_WRITE` | `BriefCreationEnvelope` (briefId, conversationId, fastPathDecision) | Creates conversation with `scopeType: 'brief'`; enqueues fast-path triage job |
| Kanban task creation | `POST /api/subaccounts/:id/tasks` | `WORKSPACE_MANAGE` | Task object | Optionally enqueues orchestrator routing if unassigned + description ≥ 10 chars |

Both paths create a row in `tasks`. The intake path additionally creates a linked conversation and runs triage.

After this build:
- Task intake path: `POST /api/task-intake`, permission `TASKS_WRITE`, returns `TaskCreationEnvelope`
- Kanban task path: `POST /api/subaccounts/:id/tasks`, permission `WORKSPACE_MANAGE`, unchanged path

### 4.3 The portalBriefs table

`portal_briefs` (Drizzle schema at `server/db/schema/portalBriefs.ts`) stores one row per `(runId, subaccountId, workflowSlug)` combination. It is a read-only portal card display table written by workflow runs to publish output cards to the portal surface. It does not participate in task creation or the operator-task lifecycle. It is renamed to `portal_cards` by this build to remove the legacy "brief" suffix.

## 5. Required Architectural Decision

### 5.1 Topology decision

**Resolution: Option 2 variant — the existing `tasks` table is already the canonical model; the rename is API-layer and naming-layer only.**

The three options from the brief are evaluated:
1. ~~`portalBriefs` becomes the canonical `tasks` model~~ — rejected: `portalBriefs` is a portal card publishing table, not a task model.
2. **Existing `tasks` model is the canonical model** — correct. `portalBriefs` is a separate concept; it is renamed to `portalCards` for clarity. The `/api/briefs` route family is renamed to `/api/task-intake`. No table topology changes to the operator-task model.
3. ~~Façade / consolidation model~~ — not needed; the models are not competing.

**Route topology (decided in grill Q1):** `/api/briefs` becomes a standalone path `/api/task-intake`. The kanban task route `POST /api/subaccounts/:id/tasks` stays separate. These serve different caller shapes and return different envelopes.

**Why `/api/task-intake` and not `/api/tasks/intake`?** Nesting under `/api/tasks/*` would imply task-intake is a sub-collection of the task CRUD family — that the intake endpoint operates on an existing `:taskId`. It does not: intake is the AI-augmented creation flow that *produces* a task plus a linked conversation plus a triage decision, while `/api/tasks/*` is the CRUD family for established tasks. The two endpoints take different request shapes and return different envelopes (`TaskCreationEnvelope` vs a plain task object). A flat sibling path keeps that separation unambiguous to future developers and to API consumers. Future task-CRUD additions belong under `/api/tasks/*` or `/api/subaccounts/:id/tasks`; future AI-intake variations belong under `/api/task-intake`.

### 5.2 Post-build topology

**Surviving tables:**
- `tasks` — canonical operator-task model (unchanged schema except `brief` column dropped)
- `portal_cards` (renamed from `portal_briefs`) — portal card publishing table
- `fast_path_decisions` — triage decisions; `brief_id` column renamed to `task_id`

**Surviving routes:**
- `POST /api/task-intake` — AI-augmented task creation with triage (renamed from `/api/briefs`)
- `GET /api/task-intake/:taskId` — fetch task metadata + conversationId
- `GET /api/task-intake/:taskId/active-run` — active run for polling
- `GET /api/task-intake/:taskId/artefacts` — paginated artefacts
- `POST /api/task-intake/:taskId/messages` — follow-up message
- `POST /api/task-intake/:taskId/approvals/:artefactId/decision` — approval decision
- `POST /api/subaccounts/:id/tasks` — kanban task creation (unchanged path)
- `POST /api/tasks/:taskId/attachments` — attachment upload (unchanged)

**Surviving services (renamed):**
- `taskCreationService.ts` (was `briefCreationService.ts`)
- `taskConversationService.ts` (was `briefConversationService.ts`)
- `taskConversationWriter.ts` (was `briefConversationWriter.ts`)
- `taskApprovalService.ts` (was `briefApprovalService.ts`)
- `taskVisibilityService.ts` (was `briefVisibilityService.ts`)
- `taskArtefactBackstopPure.ts`, `taskArtefactCursorPure.ts`, `taskArtefactPaginationPure.ts`, `taskArtefactValidatorPure.ts`, `taskArtefactValidator.ts` (all renamed)
- `taskDispatchRoutePure.ts` (was `briefDispatchRoutePure.ts`)
- `taskMessageHandlerPure.ts` (was `briefMessageHandlerPure.ts`)
- `taskSimpleReplyGeneratorPure.ts` (was `briefSimpleReplyGeneratorPure.ts`)

**No parallel representations remain post-build.** The `brief` term is absent from operator-facing code paths.

## 6. Capability 1 — Brief→Task Rename

### 6.1 API route rename and cutover

**Cutover strategy: hard cutover.** No aliased deprecation window. No external consumers confirmed. The old `/api/briefs/*` routes are removed in the same commit that adds `/api/task-intake/*`.

**Permission key rename:** `ORG_PERMISSIONS.BRIEFS_WRITE` → `ORG_PERMISSIONS.TASKS_WRITE`. All callers of `requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE)` are swept in the same commit. **DB storage:** the architect confirms during plan authoring whether the permission key is also persisted as a string in a `permissions` / `role_permissions` table. If so, a conditional **Migration F** (`UPDATE permissions SET key = 'TASKS_WRITE' WHERE key = 'BRIEFS_WRITE'`) ships in Chunk 4 alongside the route rename — this is the **only** migration count change permitted at plan-authoring; all other migration counts in this spec are final. If the permission is code-only (enum key, no DB storage), Migration F is dropped entirely and counts stay at five. See §14 for the deferred-item note.

**Route file:** `server/routes/briefs.ts` → `server/routes/taskIntake.ts`. Registered in `server/index.ts` under the new `/api/task-intake` prefix.

**Client URL sweep:** every `'/api/briefs'` string in `client/src/` is updated to `'/api/task-intake'`. The `OpenTaskView.tsx` call to `/api/briefs/${taskId}` becomes `/api/task-intake/${taskId}`.

**Conversation `scopeType` migration:** the `briefCreationService` creates conversations with `scopeType: 'brief'`. The `conversations.scope_type` column is a text enum that already includes both `'brief'` and `'task'` as valid values. Migration D (see §6.3) updates existing rows: `UPDATE conversations SET scope_type = 'task' WHERE scope_type = 'brief'`. Going forward `taskCreationService` writes `scopeType: 'task'`. Dropping `'brief'` from the enum is deferred (see §14). The `'brief_chat'` surface value in `BriefUiContext` is renamed to `'task_intake_chat'` exhaustively in Chunk 5 (no per-site deferral — string-literal sweep). `'task_intake_chat'` is intentionally distinct from `'task_chat'` (the latter is the existing direct-task-conversation surface).

**New fields on `POST /api/task-intake`:** the renamed route's full request shape is the canonical contract in §9.1. New enrichment fields added by Capability 2 are: `instructions` (required, replaces nothing — mapped to `description` server-side), `assignedAgentId` (optional), `dueDate` (optional ISO date string), `priority` (optional). Pre-existing fields retained: `title`, `source`, `uiContext`, `subaccountId`, `organisationId`. See §9.1 for the full shape and validation rules.

### 6.2 Service layer rename inventory

All 13 `brief*` service files are renamed. Internal function names, class names, and type imports are updated. Cross-service imports are swept in the same pass.

| Old filename | New filename |
|---|---|
| `briefCreationService.ts` | `taskCreationService.ts` |
| `briefConversationService.ts` | `taskConversationService.ts` |
| `briefConversationWriter.ts` | `taskConversationWriter.ts` |
| `briefApprovalService.ts` | `taskApprovalService.ts` |
| `briefVisibilityService.ts` | `taskVisibilityService.ts` |
| `briefArtefactBackstopPure.ts` | `taskArtefactBackstopPure.ts` |
| `briefArtefactCursorPure.ts` | `taskArtefactCursorPure.ts` |
| `briefArtefactPaginationPure.ts` | `taskArtefactPaginationPure.ts` |
| `briefArtefactValidatorPure.ts` | `taskArtefactValidatorPure.ts` |
| `briefArtefactValidator.ts` | `taskArtefactValidator.ts` |
| `briefDispatchRoutePure.ts` | `taskDispatchRoutePure.ts` |
| `briefMessageHandlerPure.ts` | `taskMessageHandlerPure.ts` |
| `briefSimpleReplyGeneratorPure.ts` | `taskSimpleReplyGeneratorPure.ts` |

**Merge decision:** none of the brief services are merged with the existing `taskService.ts`. They serve different responsibilities (brief/intake creation path vs CRUD) and merging would muddy the service boundary. Rename only.

**Internal symbol renames within each file:** `createBrief` → `createTask`, `BriefInput` → `TaskInput`, etc. The architect enumerates per-file symbol renames during plan authoring.

### 6.3 Database migrations

Five migrations are required. **Authoring and commit boundary:** Migrations A–D are authored AND committed in Chunk 1 (alongside their corresponding schema-file edits). Migration E is authored AND committed in Chunk 4 (alongside the server-side `instructions` required validation — the coupling between the new DB constraint and the new route validation makes them a single commit unit). All migrations are applied by the Drizzle migration runner at deploy time. The migrations touch different tables with no cross-dependencies; runtime ordering inside the migration runner follows the runner's standard sequence and is otherwise unconstrained.

**Migration A — Rename `portal_briefs` → `portal_cards`**
- `ALTER TABLE portal_briefs RENAME TO portal_cards`
- Rename indexes: `ALTER INDEX portal_briefs_run_id_idx RENAME TO portal_cards_run_id_idx`; `ALTER INDEX portal_briefs_subaccount_slug_idx RENAME TO portal_cards_subaccount_slug_idx` (exact index names verified against the live DB schema during plan authoring)
- Update Drizzle schema file: `server/db/schema/portalBriefs.ts` → `server/db/schema/portalCards.ts`; table name string updated
- Update `server/config/rlsProtectedTables.ts`: `portalBriefs` → `portalCards`
- Down migration: rename back to `portal_briefs` + index rename back
- **Shape:** pure rename; no data migration; no FK retargeting (no other table references `portal_briefs`). PostgreSQL `ALTER TABLE RENAME` preserves RLS policies on the table; policy names continue to reference the old table name (cosmetic only; renamed only if a policy-name sweep is added during plan authoring).

**Migration B — Rename `fast_path_decisions.brief_id` → `task_id`**
- `ALTER TABLE fast_path_decisions RENAME COLUMN brief_id TO task_id`
- `ALTER TABLE fast_path_decisions RENAME CONSTRAINT fast_path_decisions_brief_id_fkey TO fast_path_decisions_task_id_fkey` (exact constraint name verified against the live DB schema during plan authoring)
- Down migration: rename column back to `brief_id` + constraint rename back
- **Shape:** pure column rename; FK target (`tasks.id`) is unchanged; no data migration

**Migration C — Drop `tasks.brief` column**
- Prerequisite: code-level grep confirms no code reads `tasks.brief` (the architect runs this grep before authoring the migration)
- `ALTER TABLE tasks DROP COLUMN IF EXISTS brief`
- Down migration: `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS brief text`
- **Shape:** column removal; no FK references; safe at pre-production stage

**Migration D — Update `conversations.scope_type` data**
- `UPDATE conversations SET scope_type = 'task' WHERE scope_type = 'brief'`
- Down migration: intentionally non-reversible — implemented as a no-op (`SELECT 1`) with a `RAISE NOTICE 'Migration D down: no-op; see spec §14 for production rollback guidance'`. A naive `UPDATE conversations SET scope_type = 'brief' WHERE scope_type = 'task'` would corrupt any pre-existing direct-task conversations that already used `scope_type = 'task'` — see §14.
- **Shape:** data migration; no schema change; idempotent if re-run (the `WHERE scope_type = 'brief'` clause prevents double-application)

**Migration E — Enforce `tasks.description` NOT NULL (paired with Capability 2's "Instructions required" decision)**
- **Pre-condition (mandatory plan-authoring audit):** before Migration E is finalised, the architect performs a repo-wide audit of *every* code path that inserts into `tasks` (not only the two creation paths in §4.2 — this includes background jobs, seed scripts, agent-internal task creation, migration-time inserts, and any service that creates derived tasks). The audit's required output is an enumerated list of insert sites with a verdict per site: (a) "already supplies a non-null `description`" — no change required, (b) "needs a code change in this build" — added to the inventory in §8.2, or (c) "system-internal insert with no human description — exempt; will write `description = ''` explicitly". The audit lands in the plan document; without it, Migration E does not ship.
- Backfill step: `UPDATE tasks SET description = '' WHERE description IS NULL` (one statement; idempotent — no-op on second run). Legacy rows backfilled to `''` are explicitly **exempt** from the new min-1-character invariant (see §7.1 for the invariant's scope — it applies to *new writes*, not historical data). The DB constraint is `NOT NULL`; the min-1-character rule is enforced at the route-validation layer and applies to every new INSERT and UPDATE, but the backfilled empty strings on pre-existing rows are accepted state.
- Constraint step: `ALTER TABLE tasks ALTER COLUMN description SET NOT NULL`
- Down migration: `ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL` (drops the constraint; leaves any '' empty-string descriptions in place — losing data is impossible, the column simply becomes nullable again)
- **Shape:** schema constraint + data backfill; pre-condition for the server-side "instructions required" enforcement in §7.2. Runs in Chunk 4 alongside the route-validation change.

**Rollback semantics:** each migration ships with a down file. Migrations A, B, C, E have functional down scripts (the inverse SQL is safe). Migration D's down script is intentionally a no-op with a `RAISE NOTICE` because the naive inverse would corrupt pre-existing direct-task conversation rows — see §14 for the production-readiness conditional-rollback note. Rollback is a supported emergency path at pre-production stage for the reversible migrations.

**Whole-build rollback caveat:** because Migration D is intentionally non-reversible, a *full build rollback* after Migration D has applied is not semantically complete by re-running the down migrations in reverse order. The schema-level rollbacks (A, B, C, E down scripts) succeed, but the `conversations.scope_type` data already migrated from `'brief'` to `'task'` stays migrated. A production-grade reversal requires either (a) a forward-fix that re-introduces the `'brief'` value where it is needed, or (b) the timestamped conditional rollback variant of Migration D described in §14 (replacing the no-op with `UPDATE conversations SET scope_type = 'brief' WHERE scope_type = 'task' AND created_at < '<cutover-timestamp>'`). At pre-production stage neither path is required — this caveat exists so production-readiness review can decide which option to adopt before the first live agency lands.

### 6.4 Client rename

**Files swept (45 client files referencing "brief"):**

- `client/src/components/layout/modals/NewBriefModal.tsx` → `NewTaskModal.tsx` (rewritten in Capability 2)
- `client/src/components/review-queue/NewBriefModal.tsx` → `NewTaskModal.tsx` (enriched in Capability 2)
- All `client/src/api/*brief*` modules → renamed (file names and exported symbols)
- All `BriefXxx` TypeScript types/interfaces in `client/src/types/` → renamed to `TaskXxx`
- All hardcoded `'/api/briefs'` URLs → `'/api/task-intake'`
- `client/src/pages/OpenTaskView.tsx` — URL updated (parameter name `taskId` already correct)

The architect enumerates the full 45-file list during plan authoring, marking each file as rename-only or rename+update.

### 6.5 Shared types rename

| Old | New |
|---|---|
| `shared/types/briefFastPath.ts` | `shared/types/taskFastPath.ts` |
| `BriefCreationEnvelope` | `TaskCreationEnvelope` (`briefId` field → `taskId`) |
| `BriefCreatedResponse` | `TaskCreatedResponse` |
| `BriefUiContext` | `TaskUiContext` |
| `BriefScope` | `TaskScope` |
| `BriefUiContext.surface: 'brief_chat'` | `TaskUiContext.surface: 'task_intake_chat'` |

`FastPathDecision` and `FastPathRoute` are retained as-is — they describe routing concepts, not brief/task concepts.

### 6.6 Rename exemption list

The following references to "brief" are **not renamed** in this build:

- Historical migration SQL (`.sql` files in `migrations/`) that mention `brief` in comments or early schema history — these are immutable historical records
- The `brief-creation-unify` stub spec and any progress files under `tasks/builds/brief-creation-unify/` — superseded, not deleted
- Any third-party webhook payload compatibility structures that use `brief` as a field name expected by an external system (spec author verifies: none found)
- The word "brief" used in ordinary English prose in comments, doc strings, or READMEs where it means "concise" or "summary" — not renamed

## 7. Capability 2 — NewTaskModal Enrichment

### 7.1 Field set

Both `NewTaskModal` variants (layout and review-queue) expose the same **core** operator-visible field set. The two variants differ only on the layout-only overrides (Organisation, Subaccount) — the review-queue modal omits those because its endpoint binds the subaccount via the URL path.

| Field | Required (modal UX) | Required (API) | Storage | Notes |
|---|---|---|---|---|
| Title | Yes (both modals) | `POST /api/task-intake`: No (server derives from `instructions` if absent — existing behaviour). `POST /api/subaccounts/:id/tasks`: Yes (pre-existing required field, unchanged). | `tasks.title` | max 500 chars (existing constraint) |
| Instructions | **Yes** | **Yes** | `tasks.description` | Multi-line textarea; min 1 char; replaces "Description" label. On `POST /api/task-intake` the API field is `instructions` (server maps to `description`); on `POST /api/subaccounts/:id/tasks` the API field is `description` (unchanged). |
| Assign Agent | No | No | `tasks.assignedAgentId` | `<select>` picker; defaults to "Unassigned" (auto-route) or default agent (review-queue) |
| File attachments | No | No | `task_attachments` table | Uploaded after task creation via existing `/api/tasks/:taskId/attachments` |
| Due Date | No | No | `tasks.dueDate` | Date-only; hidden in Advanced section |
| Priority | No | No | `tasks.priority` | low/normal/high/urgent; hidden in Advanced section |
| Organisation override | No (layout modal only) | No | context field | System admins only; hidden in Advanced section; review-queue modal omits this field (subaccount is path-bound on `POST /api/subaccounts/:id/tasks`) |
| Subaccount override | No (layout modal only) | No | context field | Shown when `subaccounts.length > 0`; hidden in Advanced section; review-queue modal omits this field |

**Required fields in the modal UX:** Title AND Instructions both required client-side; the Create Task button is disabled until both have at least 1 character. **Server-side validation:** `instructions` field is required (min 1 char) on `POST /api/task-intake`; `description` field is required (min 1 char) on `POST /api/subaccounts/:id/tasks`. `title` is only enforced as required on `POST /api/subaccounts/:id/tasks` (pre-existing behaviour); on `POST /api/task-intake` the server derives the title from `instructions` if the client somehow submits without one (defensive — the modal disables Create so this shouldn't happen). Server-side `description NOT NULL` is also backed by Migration E (see §6.3).

> **Note on the Title contract.** Title-required-in-UX vs Title-optional-on-the-`/api/task-intake`-API is intentional and is an **API compatibility behaviour**, not the product contract. The product contract is that operators always supply a Title in the modal. The server-side title derivation from `instructions` is defensive belt-and-braces for the case where a non-modal caller (programmatic, future integrations, replay) submits without one. This divergence is not surfaced to operators and should not be promoted to "the API accepts title-less submissions" in any operator-facing material.

### 7.2 Instructions field data contract

**Resolution (grill Q2): UI-only relabel.** "Instructions" is the display label for the existing `tasks.description` column. No schema rename in this build.

- Storage field: `tasks.description` (text, becomes `NOT NULL` after this build — enforced by Migration E in §6.3)
- UI label: "Instructions"
- API field name on `POST /api/task-intake`: `instructions` (remapped server-side to `description` before writing)
- API field name on `POST /api/subaccounts/:id/tasks`: `description` (unchanged; no API rename on this endpoint)
- No dual-field ambiguity: `tasks.brief` column is dropped (Migration C); only `description` survives as the text content field

**Long-term data-side rename:** renaming `tasks.description` → `tasks.instructions` at the schema level is deferred to a future build. This spec establishes "Instructions" as the canonical UX label and declares `description` as the storage field. The two are intentionally divergent until the future rename build.

### 7.3 Agent assignment

**Layout modal:** plain `<select>` picker. Default option: "Unassigned" (maps to null `assignedAgentId`). The orchestrator routing job is **always enqueued by `emitCreateTaskSideEffects` after task creation** (existing behaviour, unchanged by this build); the job's handler then evaluates eligibility at job time against three conditions, all required: status = `'inbox'` AND no assigned agent AND `description` length ≥ 10 chars. If any condition fails, the job no-ops. Consequence: when the operator selects an agent in the modal, `assignedAgentId` is set and the job no-ops; when the operator leaves agent unassigned and writes ≥ 10 chars of instructions, the job routes; when the operator writes 1–9 chars (above the 1-char Instructions floor but below the 10-char routing threshold), the job no-ops and the task waits in inbox for operator follow-up.

**Review-queue modal:** same picker. Default option: the subaccount's default agent (pre-selected, matching current behaviour). Operator can override.

**Agent list source:** rendered from the same React Query hook used by existing modals (`useSubaccountAgents` or equivalent — architect confirms the exact hook + endpoint during plan authoring).

### 7.4 Attachment lifecycle

**Attachment gating posture (grill Q3): advisory.** Task creation and attachment upload are decoupled operations.

Lifecycle:
1. Operator fills modal, optionally selects files (held client-side as pending).
2. Operator submits. Task is created via `POST /api/task-intake` (or `POST /api/subaccounts/:id/tasks`). Task creation succeeds independently of attachments.
3. The orchestrator routing job is enqueued unconditionally by `emitCreateTaskSideEffects` (see §7.3 — the handler's eligibility check is what gates routing). When Instructions is filled (≥ 10 chars) and agent is unassigned, the job's eligibility check passes and the task is routed to an agent (existing behaviour). The task may start execution before attachments land.
4. Pending attachments upload against the new task ID via `POST /api/tasks/:taskId/attachments`, one at a time, with inline progress.
5. Each upload outcome: success (file listed on task), recoverable failure (retry button inline), unrecoverable failure (red marker; operator dismisses or re-adds).

**Operator-visible state:** the modal shows upload progress inline (see prototypes at `prototypes/new-task-modal-overhaul/02-with-attachments.html`). Mid-upload rows show a "Cancel" button; settled rows show a "Remove" button. A two-sentence lifecycle notice explains the separate operation.

**Cancel and Remove semantics per row state:**

| Row state | Button shown | Action |
|---|---|---|
| Pending (file picked, not yet uploading) | Cancel | Remove from client-side pending list; no server call. |
| In-flight (upload in progress) | Cancel | Abort the `fetch` (AbortController); drop the row from the client list. The server may have started writing the attachment row. If the upload request was aborted mid-write, any resulting partial-state row remains until reconciled by the existing attachment endpoint's transactional boundary (the upload endpoint is expected to commit atomically — partial rows shouldn't occur; if they do, they are leftover from existing behaviour, not introduced by this build). |
| Succeeded (uploaded) | Remove | Issue `DELETE /api/attachments/:attachmentId` (existing endpoint at `server/routes/attachments.ts`, unchanged); on success remove from list. |
| Failed (unrecoverable) | Remove | Drop from client list; no server call (no row was persisted). |
| Failed (recoverable) | Retry + Remove | Retry re-POSTs with the same `idempotencyKey`; Remove drops the row from the client list. |

**No new gating mechanism is introduced.** The `tasks.status` enum is unchanged. The spec explicitly adopts the advisory posture and defers blocking attachment gating to a named future enhancement (§14).

### 7.5 Progressive disclosure

Visual hierarchy per `docs/frontend-design-principles.md`:

**Always visible (primary task setup):**
- Title (text input, required)
- Instructions (textarea, required)
- Assign Agent (compact inline row below Instructions)

**Always visible but secondary:**
- File drop-zone + "Browse files" fallback button (subtle when empty, shows upload list when files present)

**Default-hidden behind "Advanced" expander:**
- Due Date
- Priority
- Subaccount override (conditional: `subaccounts.length > 0`)
- Organisation override (conditional: system admins only)

The Advanced section is collapsed by default. Title + Instructions + Agent are never hidden behind disclosure.

### 7.6 Accessibility

Per Product invariant 6:
- Drop-zone: `role="button"`, `tabindex="0"`, `aria-label="Drop files here, or press Enter to choose files"`. Enter/Space opens the file picker.
- "Browse files" fallback button: always visible, never hidden behind the drag interaction.
- Attached-file list rows: keyboard-navigable. Remove buttons: `aria-label="Remove {filename}"`. Cancel buttons: `aria-label="Cancel upload of {filename}"`.
- Screen-reader labels announce drop-zone state changes.

The `<button type="button">` pattern is used for the lifecycle tooltip trigger (not a bare `<a>` without href — caught in mockup pre-implementation notes).

### 7.7 Due date semantics

- **Type:** date-only (no time of day) on the wire; stored as a `timestamp` in `tasks.dueDate` (existing column type, unchanged).
- **Conversion rule:** the modal posts `dueDate` as `YYYY-MM-DD` (ISO date). The server interprets it as midnight in the subaccount's configured timezone (`subaccounts.timezone`), converts to UTC, and writes to `tasks.dueDate`. The existing TaskModal-edit code already converts date-only input on the subaccount-tasks endpoint; the task-intake route invokes the same conversion helper at route-handler scope (architect confirms the exact helper name during plan authoring — typical pattern in this codebase: a `parseDueDate(input, subaccountTimezone)` helper colocated with the route or in `server/lib/dates.ts`).
- **Display:** operator's local browser timezone (date-only).
- **Execution scheduling:** subaccount timezone (re-interpreted from the stored UTC timestamp).
- **Past dates:** allowed (back-dating supported per existing `TaskModal.tsx` behaviour).
- No divergent date model introduced; conforms to existing `dueDate` field conventions.

### 7.8 Concurrent execution and attachment gating posture

**Advisory posture declared (grill Q3).** Task routing and execution are not blocked by pending attachment uploads. The spec explicitly adopts this posture:

> Tasks may start execution before all attachments are uploaded. The agent receives the task with whatever attachments have settled at execution time. The operator can add missing attachments to the running task via the edit surface (`TaskModal.tsx` attachments tab).

**Consequence for the orchestrator routing check:** no changes to `orchestratorFromTaskJob.ts`. The job fires when status = 'inbox', no assigned agent, and description ≥ 10 chars — these conditions are evaluated at job time, not at attachment-settle time.

**Product invariant 3 compliance:** the gating posture IS declared (advisory). Product invariant 3 is satisfied by this explicit declaration. The blocking posture (task held until attachments settle) is deferred to §14.

**Product invariant 11 compliance:** no attachment-based hold is introduced, so there is no timeout/recovery posture needed for a stall that cannot occur.

### 7.9 Layout modal vs review-queue modal

Both modals are renamed and enriched. They remain separate components.

| | Layout `NewTaskModal` | Review-Queue `NewTaskModal` |
|---|---|---|
| File | `client/src/components/layout/modals/NewTaskModal.tsx` | `client/src/components/review-queue/NewTaskModal.tsx` |
| Endpoint | `POST /api/task-intake` | `POST /api/subaccounts/:id/tasks` |
| Return | `TaskCreationEnvelope` | Task object |
| Agent default | "Unassigned" (auto-route) | Subaccount default agent (pre-selected) |
| Conversation | Created (triage path) | Not created |
| Field set | Full core set (§7.1) + Organisation/Subaccount overrides | Full core set (§7.1); Organisation/Subaccount overrides omitted (subaccount is path-bound on the endpoint) |

**Shared sub-components extracted:**
- `TaskAttachmentDropZone` — drop-zone + fallback button + attachment list; used by both modals
- `TaskAgentPicker` — agent `<select>` with "Unassigned" / default-agent logic; used by both modals

These shared components live under `client/src/components/task-modal/` alongside existing attachment helpers.

## 8. File Inventory Lock

This is the authoritative list of file categories touched. The architect enumerates exact filenames during plan authoring. Any file added to the implementation not in these categories is a scope creep flag.

### 8.1 Schema and migrations

| File / artifact | Change |
|---|---|
| `server/db/schema/portalBriefs.ts` | Rename to `portalCards.ts`; update table name |
| `server/db/schema/fastPathDecisions.ts` | Rename `briefId` column reference to `taskId` |
| `server/db/schema/tasks.ts` | Remove `brief` column definition |
| `server/config/rlsProtectedTables.ts` | Update `portalBriefs` → `portalCards` |
| Migration A (new) | Rename `portal_briefs` → `portal_cards` + indexes |
| Migration B (new) | Rename `fast_path_decisions.brief_id` → `task_id` + FK constraint |
| Migration C (new) | Drop `tasks.brief` column |
| Migration D (new) | Data migration: `conversations.scope_type` 'brief' → 'task' (down: no-op, see §6.3) |
| Migration E (new) | Backfill `tasks.description` (NULL → '') + `SET NOT NULL` (enforces Capability 2's "Instructions required" decision) |

### 8.2 Server routes and services

| File | Change |
|---|---|
| `server/routes/briefs.ts` | Rename to `taskIntake.ts`; update route prefix to `/api/task-intake`; add `assignedAgentId`, `dueDate`, and `priority` request fields; make `instructions` required (Migration E enforces at DB level too) |
| `server/index.ts` | Update route registration: `/api/briefs` → `/api/task-intake` |
| All 13 `server/services/brief*.ts` | Rename to `task*.ts` (see §6.2 table) |
| `server/services/taskCreationService.ts` | Accept `assignedAgentId`, `dueDate`, `priority`; require `instructions` (description) |
| `server/routes/tasks.ts` | Make `description` required in Zod schema for `POST /api/subaccounts/:id/tasks` |
| `server/lib/permissions.ts` (or equivalent) | Rename `BRIEFS_WRITE` → `TASKS_WRITE` |
| All files referencing `BRIEFS_WRITE` | Updated to `TASKS_WRITE` |
| All files importing `brief*` services | Import paths updated |

### 8.3 Client components and types

| File | Change |
|---|---|
| `client/src/components/layout/modals/NewBriefModal.tsx` | Rename to `NewTaskModal.tsx`; rewrite with full field set (§7.1) |
| `client/src/components/review-queue/NewBriefModal.tsx` | Rename to `NewTaskModal.tsx`; enrich with full field set (§7.1) |
| `client/src/components/task-modal/TaskAttachmentDropZone.tsx` | New shared component extracted from modal implementation |
| `client/src/components/task-modal/TaskAttachmentDropZonePure.ts` | New pure helper module (file-selection / progress-state decision logic — testable per §15) |
| `client/src/components/task-modal/TaskAgentPicker.tsx` | New shared component extracted from modal implementation |
| `client/src/components/task-modal/TaskAgentPickerPure.ts` | New pure helper module (default-selection logic — testable per §15) |
| Agent-listing data source | Existing React Query hook (`useSubaccountAgents` or equivalent — architect confirms exact hook name during plan authoring); no new endpoint introduced |
| `client/src/components/Layout.tsx` | Update import reference: `NewBriefModal` → `NewTaskModal` |
| All `client/src/api/*brief*.ts` | Rename files; update API paths to `/api/task-intake` |
| All `client/src/types/Brief*.ts` | Rename to `Task*.ts`; update field names (`briefId` → `taskId`) |
| `client/src/pages/OpenTaskView.tsx` | Update `/api/briefs/` URL to `/api/task-intake/` |
| All other client files referencing `brief` in the deprecated sense | Swept (architect enumerates the ~45-file list during plan authoring; estimate based on the v3 brief grep count) |

### 8.4 Shared types

| File | Change |
|---|---|
| `shared/types/briefFastPath.ts` | Rename to `taskFastPath.ts` |
| `BriefCreationEnvelope` | Renamed to `TaskCreationEnvelope`; `briefId` field → `taskId` |
| `BriefCreatedResponse` | Renamed to `TaskCreatedResponse` |
| `BriefUiContext` | Renamed to `TaskUiContext`; `'brief_chat'` surface → `'task_intake_chat'` |
| `BriefScope` | Renamed to `TaskScope` |
| All shared files referencing `Brief*` types | Imports updated |

### 8.5 Tests

| Category | Change |
|---|---|
| All test files referencing `brief` routes/services/types | Updated for renamed routes, types, and symbols |
| New unit tests | Pure-function tests only (per §15 / `docs/spec-context.md`): tests live alongside the new pure helper modules listed in §8.3 (`TaskAttachmentDropZonePure.ts` + `TaskAttachmentDropZonePure.test.ts`; `TaskAgentPickerPure.ts` + `TaskAgentPickerPure.test.ts`). No frontend component-rendering tests. |

### 8.6 Documentation

| File | Change |
|---|---|
| `architecture.md` | Sweep `brief` references in the task/brief domain sections; update route family listing |
| `KNOWLEDGE.md` | Append only if implementation surfaces a non-obvious pattern (e.g. unexpected migration sequencing, library quirk). No update required if the sweep is mechanical. |
| `docs/capabilities.md` | Update capability row for `universal-brief` → `task-intake`; rename cluster entry if applicable |
| `tasks/builds/brief-creation-unify/spec.md` | Mark as superseded by this build (add `Status: superseded by 2026-05-18-new-task-modal-overhaul-spec.md`) |

### 8.7 Supporting documents (read-only)

The spec depends on the following files as context. They are not modified by this build.

| Path | Role |
|---|---|
| `tasks/builds/new-task-modal-overhaul/brief.md` | FINAL v3 brief — Product invariants, success criteria, test invariants |
| `tasks/builds/new-task-modal-overhaul/intent.md` | spec-coordinator intent; grill-me Q&A (Q1–Q9 referenced throughout this spec) |
| `docs/spec-context.md` | Framing assumptions (pre-production, no live users, no feature flags, static-gates-primary testing posture) |
| `docs/frontend-design-principles.md` | UI design principles — referenced by §7.5 progressive disclosure |
| `docs/spec-authoring-checklist.md` | Authoring checklist Sections 12.1 / 12.2 — Lifecycle Declaration + ABCd block conventions |
| `prototypes/new-task-modal-overhaul/02-with-attachments.html` | Clickable mockup of the attachment lifecycle UI (§7.4) |

## 9. Data Contracts

### 9.1 POST /api/task-intake — request shape

**Producer:** `NewTaskModal` (layout variant)
**Consumer:** `server/routes/taskIntake.ts`

```typescript
// Request body
{
  instructions: string;               // required, min 1 char — mapped to tasks.description server-side
  title?: string;                     // optional if text present; explicit title field from modal
  source?: 'new_task_modal' | 'global_ask_bar' | 'programmatic';  // renamed from prior values (see mapping below)
  uiContext?: Partial<TaskUiContext>;
  subaccountId?: string;              // optional subaccount override
  organisationId?: string;            // optional org override (system admins only)
  assignedAgentId?: string;           // optional; if set, writes tasks.assignedAgentId (singular) — orchestrator job no-ops at job time
  dueDate?: string;                   // optional ISO date "YYYY-MM-DD"; server converts to subaccount-tz midnight UTC timestamp before writing to tasks.dueDate
  priority?: 'low' | 'normal' | 'high' | 'urgent';  // defaults to 'normal'
}
```

**`source` enum mapping (prior → renamed):**

| Prior value | New value |
|---|---|
| `'brief_modal'` | `'new_task_modal'` |
| `'global_ask_bar'` | `'global_ask_bar'` (unchanged) |
| `'programmatic'` | `'programmatic'` (unchanged) |

The architect confirms the exact list of prior `source` values from `briefCreationService.ts` during plan authoring. **Every legacy value must be either explicitly mapped (extending the table above) or removed before cutover.** The new enum is strict: post-build, the server validates `source` against `'new_task_modal' | 'global_ask_bar' | 'programmatic'` — any other value (including legacy spellings the spec did not catch) is rejected with `400 Bad Request`. The mapping table is the authoritative pre-cutover translation; the strict enum is the post-cutover contract.

**`assignedAgentId` vs `assignedAgentIds`:** the creation modal writes only `assignedAgentId` (singular). The multi-agent column `assignedAgentIds` exists on `tasks` for downstream multi-agent assignment via `TaskModal.tsx` edit; it is untouched by this build and remains writable only via the edit surface.

**Example (filled modal):**
```json
{
  "title": "Draft Q2 agency report",
  "instructions": "Compile the Q2 performance data from the three agency integrations and draft a summary for the leadership team. Include month-over-month comparisons.",
  "assignedAgentId": "a1b2c3d4-...",
  "dueDate": "2026-06-15",
  "priority": "high"
}
```

**Nullability / defaults:**
- `instructions`: required; server rejects (400) if absent or empty string
- `title`: optional; if absent, server truncates `instructions` for the title (existing behaviour)
- All other fields: optional

### 9.2 TaskCreationEnvelope — response shape

**Producer:** `server/routes/taskIntake.ts`
**Consumer:** `NewTaskModal` (layout variant), `OpenTaskView.tsx`

```typescript
interface TaskCreationEnvelope {
  taskId: string;                     // UUID — renamed from briefId
  conversationId: string;
  fastPathDecision: FastPathDecision;
  organisationId: string;
  subaccountId: string | null;
  organisationName: string | null;
  subaccountName: string | null;
}

type TaskCreatedResponse = { type: 'task_created' } & TaskCreationEnvelope;
```

**Example:**
```json
{
  "type": "task_created",
  "taskId": "f1e2d3c4-...",
  "conversationId": "a9b8c7d6-...",
  "fastPathDecision": {
    "route": "needs_orchestrator",
    "scope": "subaccount",
    "confidence": 0.87,
    "tier": 2,
    "secondLookTriggered": false
  },
  "organisationId": "org-uuid",
  "subaccountId": "sub-uuid",
  "organisationName": "Acme Agency",
  "subaccountName": "Client A"
}
```

**Source-of-truth precedence:** `taskId` in the envelope is the authoritative task identifier. The conversation is a derived entity linked via `conversations.scope_id = taskId` (polymorphic; `conversations.scope_id` has no FK — application-level linkage only, see `server/db/schema/conversations.ts`). The application contract: the task-intake route writes the `tasks` row and the `conversations` row inside the same transaction (§11). If the in-memory envelope ever disagrees with the DB row (e.g. after a client cache refresh against a stale response), the DB row is authoritative; clients refetch via `GET /api/task-intake/:taskId`. No new detection / repair mechanism is introduced — the transactional write boundary in §11 is the consistency mechanism.

### 9.3 POST /api/subaccounts/:id/tasks — widened request shape

**Producer:** `NewTaskModal` (review-queue variant)
**Consumer:** `server/routes/tasks.ts`

This endpoint is widened (not renamed). Change: `description` is now required.

```typescript
// Before (description optional):
{ title: string; description?: string; ... }

// After (description required):
{ title: string; description: string; /* min 1 char */ ... }
```

Other fields (`assignedAgentId`, `dueDate`, `priority`) are already accepted by this endpoint — no additional changes needed for the enriched field set.

**Example (filled review-queue modal):**
```json
{
  "title": "Follow up on overdue invoices",
  "description": "Check the three flagged invoices from last month and send follow-up emails to the respective contacts. Log responses in the CRM.",
  "assignedAgentId": "agent-uuid",
  "dueDate": "2026-05-25",
  "priority": "normal"
}
```

## 10. Permissions and RLS

### New and renamed routes

| Route | Permission guard(s) | Change |
|---|---|---|
| `POST /api/task-intake` | `authenticate` → `requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE)` | Renamed from `BRIEFS_WRITE` |
| `GET /api/task-intake/:taskId` | `authenticate` → `requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE)` → `requireTaskVisibility` (existing helper used on briefs routes today; renamed in line with §6.2; architect confirms the exact middleware name during plan authoring) | Renamed |
| `GET /api/task-intake/:taskId/active-run` | Same as above (`authenticate` + `TASKS_WRITE` + `requireTaskVisibility`) | Renamed |
| `GET /api/task-intake/:taskId/artefacts` | Same as above | Renamed |
| `POST /api/task-intake/:taskId/messages` | Same as above | Renamed |
| `POST /api/task-intake/:taskId/approvals/:artefactId/decision` | Same as above | Renamed |
| `POST /api/subaccounts/:id/tasks` | `authenticate` → `requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE)` → `resolveSubaccount` | Unchanged |

**Permission key rename:** `ORG_PERMISSIONS.BRIEFS_WRITE` → `ORG_PERMISSIONS.TASKS_WRITE`. The underlying permission string value stored in the database must also be updated via a data migration (architect confirms the exact string key during plan authoring; if it equals `'BRIEFS_WRITE'`, a `UPDATE permissions SET key = 'TASKS_WRITE' WHERE key = 'BRIEFS_WRITE'` data migration is added — see §6.1 and §14).

**Organisation / subaccount override guards on `POST /api/task-intake`:** when the request includes `organisationId` ≠ caller's resolved org, the route requires `requireSystemAdmin` (system-admin scope); a non-admin caller sending a foreign `organisationId` receives `403 Forbidden`. When the request includes `subaccountId` not in the caller's accessible subaccount list for the resolved org, the same `403 Forbidden` is returned. These guards are existing middleware patterns used on neighbouring admin-override routes; no new guard is introduced.

### RLS posture

No new tenant-scoped tables are introduced by this build. The existing RLS policies on `tasks`, `fast_path_decisions`, and `conversations` are unchanged.

**`portal_cards` (renamed from `portal_briefs`):** PostgreSQL `ALTER TABLE ... RENAME` preserves the existing RLS policies attached to the table (they continue to enforce the same checks). Policy names themselves are not auto-renamed by `ALTER TABLE` and may still reference `portal_briefs` in their internal name (cosmetic only — verified during plan authoring; if the team wants to sweep policy names too, that is a separate optional step). `rlsProtectedTables.ts` entry is updated from `portalBriefs` to `portalCards`. The policy shape is identical.

**`tasks` table:** RLS enforces the organisation boundary; subaccount filtering is service-layer. No change.

**`fast_path_decisions` table:** RLS enforces the organisation boundary; subaccount filtering is service-layer. Column rename (`brief_id` → `task_id`) does not affect policy. No change.

## 11. Execution Model

### Task intake creation (POST /api/task-intake)

**Model: inline / synchronous for the task row and the initial fast-path decision; asynchronous (pg-boss) for any second-look triage work.**

1. The route handler synchronously writes the `tasks` row and the `conversations` row within a transaction.
2. The initial fast-path decision (route/scope/confidence/tier/secondLookTriggered) is computed synchronously and embedded in the response envelope (existing behaviour — the envelope's `fastPathDecision` field is never null on success).
3. A pg-boss second-look triage job is enqueued (fire-and-forget) after the transaction commits, but only if the initial decision sets `secondLookTriggered: true`.
4. The route returns `TaskCreationEnvelope` (with the initial decision) before any second-look work completes.
5. The orchestrator routing job is enqueued unconditionally by `emitCreateTaskSideEffects` (existing behaviour); its handler then evaluates the three-condition eligibility check at job time (status='inbox' AND no assigned agent AND `description` ≥ 10 chars) and no-ops if any condition fails. See §7.3 for the full eligibility semantics and the operator-visible consequences.

**Model: inline / synchronous for task creation on POST /api/subaccounts/:id/tasks.**

1. The route handler synchronously writes the `tasks` row.
2. `emitCreateTaskSideEffects` (existing) fires — may enqueue orchestrator job if eligible.
3. Returns the task object.

### Attachment upload

**Model: queued / asynchronous at the client level; synchronous on the server per file.**

Each attachment upload is a separate `POST /api/tasks/:taskId/attachments` call. The client fires them serially after task creation succeeds. Each upload is independent — failure of one does not affect others. The server processes each upload synchronously and returns the attachment record.

### Database migrations

**Model: synchronous at deploy time.** Migrations A–E (plus conditional Migration F if DB-stored permissions exist — see §6.1) run during the standard migration step at deployment. Each is applied exactly once by the Drizzle migration runner's "already-applied" tracking; the SQL itself is not strictly idempotent (raw `ALTER TABLE ... RENAME` and `SET NOT NULL` would error on re-run), but the migration runner prevents double-application. All migrations complete in sub-second time at pre-production scale.

## 12. Phase Sequencing

This is a single-phase build. All work ships in one PR. Chunks within the phase follow this dependency order to avoid broken states:

**Single-PR convention.** All chunks below ship in one PR (one deploy unit). Migrations are authored as part of Chunk 1 and run by the Drizzle migration runner at deploy time — there is no intermediate deploy between chunks. The codebase remains buildable at the PR boundary (end of Chunk 9), not necessarily between chunks. Reviewers should not expect a clean `npm run build` at every chunk boundary; mid-PR commits may have transient unresolved imports until the matching rename commit lands.

**Chunk order (within the single PR):**

1. **Schema migrations A–D** (Migrations A, B, C, D): author and commit Migrations A–D alongside their respective schema-file edits (`portalBriefs` → `portalCards`, `fastPathDecisions.brief_id` → `task_id`, `tasks.brief` drop, `conversations.scope_type` data update). Migration E is **authored in Chunk 4** (see Chunk 4), not Chunk 1, because it is coupled to the server-side validation change.
2. **Shared types rename** (`shared/types/briefFastPath.ts` → `taskFastPath.ts`): rename shared types and the `BriefUiContext` → `TaskUiContext` type declaration (including the `surface` field's literal-type narrowing from `'brief_chat'` to `'task_intake_chat'`). The first commit that renames the file may leave some importers broken until Chunks 3 and 6 land. **Chunk 2 owns the type declaration**; **Chunk 5 owns the value usages** (call-site string literals in services + fixtures) — split because the type rename can land before the value sweep without breaking the type-checker (a TS narrowing error is the buildable-at-PR-boundary signal that the sweep is incomplete).
3. **Server service rename** (all 13 `brief*` services): rename service files and update internal symbols. Update imports in route files.
4. **Server route rename + permission data migration + author Migration E** (`briefs.ts` → `taskIntake.ts`, `/api/briefs` → `/api/task-intake`, permission key rename + conditional Migration F if DB-stored permissions exist, new fields including `priority`, `tasks.description NOT NULL`): updates the route after services are renamed; ships the conditional permission data migration in the same commit as the permission constant/guard change so the DB and code change together; **authors and ships Migration E** (`tasks.description` backfill + `SET NOT NULL`) in the same commit as the server-side `instructions` required validation.
5. **`'brief_chat'` surface sweep** (single-line atomic rename across services and `BriefUiContext` → `TaskUiContext`): exhaustive string-literal sweep; no per-site deferral (see §14).
6. **Client API and type rename** (~45 files): update client API calls, type imports, and URL strings. Client builds against the renamed server types.
7. **`NewTaskModal` implementation** (both variants + shared sub-components): the modal rewrite happens after all rename work is complete so the new modal builds against the final API shape.
8. **Test sweep**: update all test files for renamed routes/services/types; add new pure-function unit tests (per §15).
9. **Documentation sweep**: `architecture.md`, `docs/capabilities.md`, `brief-creation-unify` spec superseded marker.

**Dependency invariants:**
- Chunk 3 (services) before Chunk 4 (route) — route imports services
- Chunk 2 (shared types) before Chunk 6 (client) — client imports shared types
- Chunk 4 (route with new fields + Migration E) before Chunk 7 (modal) — modal calls the widened route
- Chunk 6 (client rename) before Chunk 7 (modal) — modal imports renamed client API modules
- Chunk 5 (`brief_chat` sweep) before Chunk 8 (test sweep) so test fixtures reference the new value

No backward dependencies. No phase within this ordering references an artifact created in a later phase.

### 12.1 Pre-launch concurrent-branch scan

Because this build's rename surface is wide (300+ files, 5 migrations, the `BRIEFS_WRITE` → `TASKS_WRITE` permission key, the `tasks.description` constraint), any concurrent in-flight branch that also touches the same surface is a high-conflict risk. Before Chunk 1 commits, the implementer (or `feature-coordinator` Phase 0) runs the following scan and records the result in `tasks/builds/new-task-modal-overhaul/progress.md`:

```bash
# 1. Branches with edits to renamed files in the last 30 days, excluding this branch.
git for-each-ref --format='%(refname:short)' refs/heads/ refs/remotes/origin/ \
  | grep -vE '^(origin/)?builds/new-task-modal-overhaul$' \
  | while read -r ref; do
      git log --since='30 days ago' --pretty=format:'%h %an %s' "$ref" -- \
        'server/routes/briefs.ts' \
        'server/services/brief*.ts' \
        'client/src/components/**/NewBriefModal.tsx' \
        'server/db/schema/portalBriefs.ts' \
        'server/db/schema/fastPathDecisions.ts' \
        'shared/types/briefFastPath.ts' \
        2>/dev/null | head -5 | sed "s|^|$ref: |"
    done

# 2. Open PRs touching the same surface.
gh pr list --state open --json number,title,headRefName,files \
  --jq '.[] | select(.files[]?.path | test("(server/routes/briefs|server/services/brief|NewBriefModal|portal_briefs|fast_path_decisions|BRIEFS_WRITE|tasks\\.description)")) | "\(.number) \(.headRefName) \(.title)"'
```

Any non-empty result is escalated to the user before Chunk 1 commits. The two scans must produce a "clean" entry in `progress.md` (either "no concurrent touches in window" or "concurrent touches found: <list>; resolved by <decision>") — silent absence is not acceptable.

## 13. Test Invariants

These CI/review gates are required for this build per the brief's § Test invariants. **Automated gates** name the script file expected to host the check (architect lands the script in Chunk 8). **Manual / reviewer-enforced gates** are not script-backed; they are enforced via the PR description or the `pr-reviewer` agent's checklist.

**1. Single-canonical-model gate (automated).** Verifies the rename is complete: no application code references the old `portal_briefs` table name (snake_case), the legacy operator-task `briefs` terminology in write paths, *or* the renamed camelCase / type / identifier surface. Script: `scripts/gates/verify-brief-rename.sh`. Concrete command (both passes must return zero matches):

```bash
# Pass 1 — snake_case table + URL prefix + service-file path remnants
git grep -nE 'portal_briefs|/api/briefs|server/services/brief[A-Z]' -- \
  'server/**' 'client/**' 'shared/**' \
  ':(exclude)server/db/migrations/**' \
  ':(exclude)docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md' \
  ':(exclude)tasks/builds/brief-creation-unify/**'

# Pass 2 — camelCase identifier + type-level + import-symbol remnants
git grep -nE '\bportalBriefs\b|\bBriefCreationEnvelope\b|\bBriefCreatedResponse\b|\bBriefUiContext\b|\bBriefScope\b|\bbriefId\b|\bBRIEFS_WRITE\b|brief_chat|briefCreationService|briefConversationService|briefConversationWriter|briefApprovalService|briefVisibilityService|briefArtefact[A-Za-z]+|briefDispatchRoutePure|briefMessageHandlerPure|briefSimpleReplyGeneratorPure' -- \
  'server/**' 'client/**' 'shared/**' \
  ':(exclude)server/db/migrations/**' \
  ':(exclude)docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md' \
  ':(exclude)tasks/builds/brief-creation-unify/**'
```

Both passes must return zero matches. Path scope is restricted to `server/`, `client/`, `shared/` (the gate intentionally does not scan `docs/` or `tasks/` — those carry historical references). The two-pass split is required because the snake_case / URL surface and the camelCase / type surface are independent rename categories; a single regex risks under-catching either side.

**2. Semantic-rename review check (manual).** The spec's rename targets (§6.2 service table, §6.4 client list, §6.5 shared types table) form the rename inventory. A PR review requirement verifies the implementation PR touches the inventoried files and does not introduce new brief-named entities for the deprecated concept. Enforced via the PR template / `pr-reviewer` checklist.

**3. No `/api/briefs` reference check.** Folded into gate 1 (`scripts/gates/verify-brief-rename.sh`).

**4. Accessibility smoke test (manual).** A keyboard navigation walkthrough confirms the drop-zone affordance has working keyboard (Enter/Space opens picker) + screen-reader labels + always-visible non-drag fallback across both modal variants. Documented in the PR description by the implementer.

**5. Instructions single-source gate (automated).** A static check verifies no code reads a `brief` column from `tasks`. Script: `scripts/gates/verify-brief-rename.sh` (same file as gate 1). Concrete command:

```bash
git grep -nE 'tasks\.brief\b|\.brief\b.*from\s+tasks' -- \
  'server/**' 'client/**' 'shared/**' \
  ':(exclude)server/db/migrations/**'
```

Must return zero matches.

**6. Runnable-state declaration gate.** Advisory posture declared (§7.8). No new attachment-gating mechanism is introduced. This gate is satisfied by the spec's explicit advisory declaration — no automated check needed since no new state is being added that could drift.

**7. Compatibility adapter inventory gate (automated).** Script: `scripts/gates/verify-brief-rename.sh`. Concrete command:

```bash
git grep -nE 'createTaskFromBrief|legacyBriefAdapter|briefCompatMapper' -- \
  'server/**' 'client/**' 'shared/**'
```

Must return zero matches.

**8. Stable identifier preservation check (manual).** Task URLs use task IDs (UUIDs); the rename does not change task IDs. Existing run IDs, audit links, attachment references, and WebSocket channels are unchanged. Reviewer-enforced via the PR description's "operator-visible identifiers" subsection. The only operator-visible URL change is `/api/briefs` → `/api/task-intake`.

**9. Attachment gating timeout posture check.** Advisory posture (§7.8) — no timeout/recovery mechanism is introduced. This invariant is satisfied by the advisory declaration (Product invariant 11 in `tasks/builds/new-task-modal-overhaul/brief.md § Product invariants` is satisfied because no attachment hold can occur that would require a timeout); no automated check required.

### 13.1 PR-template requirements for manual gates

Because gates 2, 4, 6, 8, and 9 are reviewer-enforced rather than script-backed, the implementation PR description **must** carry an explicit checklist with one tick-box per manual gate. A bare "all manual gates reviewed" comment is not sufficient — the reviewer's check is item-by-item.

The required PR checklist (paste-into-description block):

```
## Manual gate checklist (per spec §13)

### Gate 2 — Semantic rename review
- [ ] Touched files match the §6.2 service-rename table (13 services) — list any divergence.
- [ ] Touched files match the §6.5 shared-types table — list any divergence.
- [ ] Touched files match the §6.4 client-rename list — note the architect-supplied ~45-file enumeration.
- [ ] No new brief-named entities were introduced for the deprecated concept.

### Gate 4 — Accessibility smoke test
- [ ] Drop-zone keyboard activation verified (Tab to focus, Enter / Space opens picker) on both modal variants.
- [ ] Drop-zone has a working `aria-label` announced by a screen reader.
- [ ] "Browse files" fallback button is always visible (not hidden behind drag interaction).
- [ ] Attached-file list rows are keyboard navigable; Remove and Cancel buttons have per-file `aria-label`s.
- [ ] Lifecycle-tooltip trigger uses `<button type="button">`, not a bare `<a>` without href.

### Gate 6 — Runnable-state declaration
- [ ] Spec's §7.8 advisory declaration is unchanged in the implementation (no new attachment-gating state introduced).

### Gate 8 — Stable identifier preservation
- [ ] Existing task UUIDs are unchanged by the rename.
- [ ] Existing run IDs, audit links, attachment references, and WebSocket channel names are unchanged.
- [ ] The only operator-visible URL change is `/api/briefs` → `/api/task-intake` (link, screenshot, or curl in the description proving the new path serves the existing taskId).

### Gate 9 — Attachment gating timeout posture
- [ ] No timeout / recovery mechanism was introduced for attachment holds (advisory posture preserved).
```

The `pr-reviewer` agent's review-pass for this build verifies the checklist is present, every box is ticked, and any "list any divergence" lines have a substantive entry rather than "none" without supporting grep evidence. A PR that omits the checklist block, or carries unticked boxes, is a blocking finding.

## 14. Deferred Items

- **Blocking attachment gating posture.** The advisory posture (task executes before attachments settle) is the declared stance for this build. A blocking posture (task held in a new `awaiting_attachments` status until all uploads settle, with a timeout/recovery path per invariant 11) is deferred. Reason: adds a new task lifecycle state, a timeout mechanism, and queue plumbing that increase spec scope significantly. When the blocking posture is needed (production user feedback, incident), it ships as a separate spec.

- **`tasks.description` column rename to `instructions`.** "Instructions" is the UI label; `description` is the storage column. The schema-level rename is deferred to a dedicated cleanup build. Reason: the column rename sweeps all service/job/query code that reads `tasks.description` (a larger surface than the UI rename alone). Deferring keeps this build focused.

- **`brief-creation-unify` F5–F8/F15 items.** Rate limiting on `/api/session/message` (F6), ILIKE search hardening (F7), session/message tests (F8), and `organisationName`/`subaccountName` from Path C (F15) are not in scope. F1 (response envelope harmonisation) is superseded by this build. F5–F8/F15 remain as separate deferred work in `tasks/builds/brief-creation-unify/spec.md` or `tasks/todo.md`.

- **Migration D production-rollback option.** Migration D's down script is already a non-reversible no-op (see §6.3) — this is safe at every stage. Listed here as a deferred *option*: if the team eventually wants a true reversible down at production, the no-op can be replaced with a timestamped conditional rollback (e.g. `UPDATE conversations SET scope_type = 'brief' WHERE scope_type = 'task' AND created_at < '<cutover-timestamp>'`). The no-op remains acceptable indefinitely; this entry exists so the production-readiness pass can decide whether to swap it in.

- **Permission string data migration.** The `BRIEFS_WRITE` permission string may be stored in a permissions/roles table. The architect confirms the exact storage mechanism and adds a conditional Migration F if required (see §6.1). If the permission is code-only (enum key, no DB storage), Migration F is dropped entirely.

- **`conversations.scope_type` enum value `'brief'` removal.** Migration D migrates row data from `'brief'` to `'task'`, but `'brief'` remains a valid enum value in `conversations.scope_type` after this build. Dropping the value from the enum is deferred (it requires a careful sequenced migration that no other code path can still write `'brief'`). The existing `'task'` enum value is already present and the migration is therefore non-breaking. The enum-cleanup migration ships as a separate build alongside any other deferred terminology drift.

## 15. Testing Posture

Per `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
```

**In scope for this build:**
- Pure function unit tests for `TaskAttachmentDropZone` state logic (file selection, upload progress state transitions, cancel/remove decision)
- Pure function unit tests for `TaskAgentPicker` default-selection logic
- Rename sweep does not require new tests — existing test files are updated for renamed symbols/routes
- Static grep gates (§13) are CI-checked

**Not in scope:**
- E2E tests of the modal interaction
- API contract tests for the renamed routes
- Frontend integration tests

This posture is consistent with `docs/spec-context.md`. No deviations.

## 16. Execution-Safety Contracts

### 16.1 Task creation idempotency

**`POST /api/task-intake`:**
- **Idempotency posture:** non-idempotent (intentional). Each call creates a new task row. No idempotency key on task creation.
- **Retry classification:** unsafe. Caller must not retry on network error without confirming no task was created. The client shows an error state and requires the operator to manually re-submit.
- **Concurrency guard:** not applicable — each task creation is independent. Two parallel calls create two separate tasks.

**`POST /api/subaccounts/:id/tasks`:**
- Same posture as above. Unchanged from existing behaviour.

### 16.2 Attachment upload safety

**`POST /api/tasks/:taskId/attachments`:**
- **Idempotency posture:** guarded via `idempotencyKey` column on `task_attachments`. The client generates a UUID **per selected file row** (not per upload attempt); retries of the same row reuse the same key. Re-adding a file after Remove generates a fresh key. Retrying with the same key returns the existing attachment (existing behaviour — unchanged by this build).
- **Retry classification:** safe (key-based). The client may retry failed uploads with the same `idempotencyKey`.
- **Concurrency guard:** DB unique constraint on `(taskId, idempotencyKey)` catches duplicate uploads. `23505` → 200 idempotent hit (existing behaviour).
- **Terminal state:** each file upload is either `uploaded` (success) or `failed` (unrecoverable). No partial-file concept. Terminal events: success returns the attachment row; failure returns an error the client displays inline.

### 16.3 Database migration safety

**Migrations A–E:**
- **A (table rename):** DDL; runs inside the Drizzle migration runner's transaction. No data at risk (pure rename — table identity preserved, RLS policies preserved by PostgreSQL).
- **B (column rename):** DDL; runs inside the migration runner's transaction. No data at risk (pure rename — column identity preserved, FK target preserved).
- **C (column drop):** DDL; irreversible at production. Pre-production: safe. Down migration re-adds the column as nullable. Verify no live reads of `tasks.brief` before shipping.
- **D (data update):** DML; transactional. Idempotent (re-running `UPDATE ... WHERE scope_type = 'brief'` on already-migrated data is a no-op). Down migration is a non-reversible no-op by design (see §6.3 Migration D).
- **E (constraint + backfill):** DDL + DML in a single migration. Backfill runs before the constraint is applied; the migration runner wraps both in a transaction so the constraint is only enforced after the backfill commits. Idempotent (backfill `WHERE description IS NULL` is a no-op on second run; `SET NOT NULL` errors if already set — handled by the migration runner's "already-applied" tracking).

### 16.4 State machine closure

No new state machine is introduced. The `tasks.status` enum is unchanged. The `task_attachments` table is unchanged. No new status transitions are introduced by the advisory attachment posture (attachments are uploaded independently of task status).

## 17. Self-Consistency Pass

- **Goals ↔ Implementation match:** Yes. Goal 1 (one vocabulary) is covered by §6. Goal 2 (one creation surface) is covered by §7. Goal 3 (one canonical model) is covered by §5. Goal 4 (unblock operator-confidence-layer) is achieved by shipping Goals 1–3.
- **Load-bearing claims have named mechanisms:** Instructions required → server validation + client gate (§7.1, §9.1, §9.3). Advisory posture → explicit declaration (§7.8). Hard cutover → no alias routes added (§6.1).
- **File inventory ↔ prose consistency:** 13 brief service files listed in §6.2 = 13 rows in §6.2 service rename table (referenced from §8.2 as a single "All 13" category row). 5 migrations listed in §6.3 (A, B, C, D, E) reconcile against §8.1's 5 migration rows. Shared types listed in §6.5 = §8.4 rows. No count drift.
- **Execution model ↔ goals:** Task intake is synchronous for task creation, async for triage — consistent with the existing fast-path pattern. No inline operation claims "queued" or vice versa.
- **Deferred items listed:** all items marked "deferred" in prose (blocking gating, column rename, F5–F8/F15, Migration D rollback, permission string) appear in §14.
- **No orphaned deferrals:** §14 is the single list; each deferred item in prose points to §14.
- **RLS canonical sentence:** §10 states "RLS enforces the organisation boundary; subaccount filtering is service-layer" for tables touched. No dual-GUC claims without explicit declaration.
- **Testing posture ↔ spec-context.md:** §15 is consistent. No E2E, no frontend tests, no API contract tests proposed.
- **Lifecycle Declaration launch state:** `Growth` — both underlying capabilities (`universal-brief`, `task-board-workspace`) are live and actively iterating. Valid per §12.1 of spec-authoring-checklist.
- **ABCd sizing:** S/M/L only. No numeric estimates.

**Numeric reconciliation:**
- 13 service files: §6.2 table = 13 rows ✓
- 5 migrations: §6.3 (A, B, C, D, E) and §8.1 = 5 rows ✓
- ~45 client files: estimate per the v3 brief grep count; architect enumerates the exact list during plan authoring ✓
- 264 server files referenced in brief.md § Problem: spec defers per-file enumeration to the plan (architect convention) ✓
- 2 new shared components: §7.9 = `TaskAttachmentDropZone` + `TaskAgentPicker` ✓

## 18. Open Questions

None. All questions raised in `intent.md` were resolved during the grill-me session (Steps Q1–Q9). Decisions are recorded in `tasks/builds/new-task-modal-overhaul/intent.md § Grill-me Q&A` and throughout this spec.
