# Implementation Plan — new-task-modal-overhaul

**Spec:** `docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md` (Status: accepted, 2026-05-18)
**Build slug:** new-task-modal-overhaul
**Branch:** builds/new-task-modal-overhaul
**Scope class:** Major
**Author:** architect (2026-05-18)
**Total chunks:** 10
**Total migrations:** **6** (A, B, C, D, E + conditional F — confirmed required, see OQ1 resolution in §1.1)

---

## Table of contents

- [Executor notes](#executor-notes)
- [Model-collapse check](#model-collapse-check)
- [1. Architecture notes](#1-architecture-notes)
  - [1.1 OQ1 resolution — Permission key DB storage](#11-oq1-resolution--permission-key-db-storage)
  - [1.2 Domain model interpretation](#12-domain-model-interpretation)
  - [1.3 Service contracts (touching points)](#13-service-contracts-touching-points)
  - [1.4 Cross-cutting risks (high-level only — full table in §3)](#14-cross-cutting-risks-high-level-only--full-table-in-3)
  - [1.5 Patterns considered and selected](#15-patterns-considered-and-selected)
- [2. Data contracts (architecture-level)](#2-data-contracts-architecture-level)
- [3. Risks and mitigations](#3-risks-and-mitigations)
- [4. Module shape and chunk boundaries](#4-module-shape-and-chunk-boundaries)
- [5. Stepwise implementation plan](#5-stepwise-implementation-plan)
  - [Chunk 1 — Schema migrations A–C + Drizzle schema rename + portal-cards consumer rename](#chunk-1--schema-migrations-ac--drizzle-schema-rename--portal-cards-consumer-rename)
  - [Chunk 2 — Shared types rename](#chunk-2--shared-types-rename)
  - [Chunk 3 — Server service rename (13 files + every consumer's imports)](#chunk-3--server-service-rename-13-files--every-consumers-imports)
  - [Chunk 4 — Route rename + payload widening + Migrations D, E, F + permission rename (single commit)](#chunk-4--route-rename--payload-widening--migrations-d-e-f--permission-rename-single-commit)
  - [Chunk 5 — `'brief_chat'` surface sweep + `BriefUiContext` value-site sweep](#chunk-5--brief_chat-surface-sweep--briefuicontext-value-site-sweep)
  - [Chunk 6 — Client API + types + URL string sweep (~45 files)](#chunk-6--client-api--types--url-string-sweep-45-files)
  - [Chunk 7 — NewTaskModal implementation (both variants + 2 shared sub-components + 2 pure helpers)](#chunk-7--newtaskmodal-implementation-both-variants--2-shared-sub-components--2-pure-helpers)
  - [Chunk 8 — CI gate authoring + PR-template manual gate requirements](#chunk-8--ci-gate-authoring--pr-template-manual-gate-requirements)
  - [Chunk 9 — Test sweep](#chunk-9--test-sweep)
  - [Chunk 10 — Documentation sweep](#chunk-10--documentation-sweep)
- [6. Pre-Migration-E `tasks` insert-site audit](#6-pre-migration-e-tasks-insert-site-audit-required-per-spec-63)
- [7. Dependency graph and execution order](#7-dependency-graph-and-execution-order)
- [8. Self-consistency pass](#8-self-consistency-pass)
- [9. Open items requiring operator input](#9-open-items-requiring-operator-input)

---

## Executor notes

- Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.
- Per-chunk verification commands list only `npm run lint`, `npm run typecheck`, `npm run build:client` / `npm run build:server` when relevant, and targeted `npx vitest run <path>` for tests authored in that chunk.
- Coordinator must clear three pre-Chunk-4 gates (recorded in `progress.md`) before Chunk 4 commits: (i) OQ1 permission-storage resolution (resolved below as path **b**), (ii) external-consumer verification (four checks, see Risks §R4), (iii) §6 insert-site audit completion — HARD BLOCKER per F17 (every TO VERIFY row resolved to (a) or (c) with live `file:line` citations before Migration E commits; STOP-and-escalate if undecidable).
- Per spec §12, the codebase need NOT be buildable between chunks — only at the PR boundary (end of Chunk 10). Mid-PR commits may have transient unresolved imports until the matching rename commit lands. `npm run typecheck` failures inside a chunk that are resolved by a later chunk in this plan are acceptable; persistent failures at the end of a chunk that won't be resolved later are not.
- Branch convention: all chunks land on `builds/new-task-modal-overhaul` as feature commits. Per spec §12 this is a single-PR build.

---

## Model-collapse check

Three questions per the architect playbook:
1. Does this feature decompose into ingest → extract → transform → render? **No.** It is a terminology rename plus a UI enrichment with a schema-constraint backfill. There is no model-driven pipeline.
2. Is each step doing something a frontier multimodal model could do in a single call? **No.** Steps are: rename Postgres tables/columns, sweep TypeScript imports, add Zod fields, render React UI. None is model-driven.
3. Can the pipeline collapse into one model call with a structured-output schema? **Not applicable.** There is no LLM call to collapse.

**Decision: rejected as not applicable.** The build contains no LLM invocation; the collapse heuristic doesn't apply. Recorded for the audit trail.

---

## 1. Architecture notes

### 1.1 OQ1 resolution — Permission key DB storage

**Decision: path (b) — DB-persisted. Migration F is REQUIRED and ships in Chunk 4.**

Evidence (concrete file citations):

- `server/db/schema/permissions.ts`: `permissions` table with `key text PRIMARY KEY`. Permission keys are first-class persisted rows.
- `server/db/schema/permissionSetItems.ts`: `permission_set_items.permission_key text NOT NULL REFERENCES permissions(key)`. Every role grant references the string key via FK.
- `server/lib/permissions.ts:96-99`: `ORG_PERMISSIONS.BRIEFS_WRITE = 'org.briefs.write'`. The string stored in `permissions.key` is `'org.briefs.write'`, NOT `'BRIEFS_WRITE'`. The constant name is the in-code identifier; the value is the persisted string.
- `server/lib/permissions.ts:226-415`: `ALL_PERMISSIONS` array contains a `{ key: ORG_PERMISSIONS.BRIEFS_WRITE, ... }` entry (line ~295). The seed expands the constant to its value.
- `server/lib/permissions.ts:432-451`: `DEFAULT_PERMISSION_SET_TEMPLATES` (e.g., `'Org Admin'`, `'Org Manager'`) include `ORG_PERMISSIONS.BRIEFS_WRITE` in their `permissionKeys` array. The seed inserts these as rows into `permission_set_items`.
- `server/services/permissionSeedService.ts:10-24`: `seedPermissions()` is idempotent: it INSERTs only if the key doesn't already exist. It does NOT delete or update existing keys. Therefore, dropping `'org.briefs.write'` from `ALL_PERMISSIONS` and adding `'org.tasks.write'` on next boot would create the new row but leave `'org.briefs.write'` orphaned in `permissions` AND leave every existing `permission_set_items.permission_key = 'org.briefs.write'` grant pointing at the orphaned (still-present, but now-unreferenced-in-code) string.
- `server/services/permissionSeedService.ts:33-85`: `seedDefaultPermissionSetsForOrg()` only seeds an org's default sets ONCE (`existing.length > 0` short-circuits). Re-seeding does NOT propagate new keys into existing role grants. An operator whose `permission_set_items` row says `permission_key = 'org.briefs.write'` will be unaffected by the code-side rename to `'org.tasks.write'` until a data migration rewrites the existing rows.

**Consequence without Migration F:** After Chunk 4 (`requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE)` in code with the value `'org.tasks.write'`), every existing role grant still referencing `'org.briefs.write'` becomes silently ineffective. Every operator who was previously authorised to create tasks via the (now renamed) route is locked out at cutover. This is a user-facing access regression and is the exact failure mode §6.1's pre-Chunk-4 BLOCKER was written to prevent.

**Migration F (required) — see Chunk 4 contracts for full SQL.** Updates `permissions.key` AND every referencing `permission_set_items.permission_key` row from `'org.briefs.write'` → `'org.tasks.write'`. Ships in the same commit as the route rename and the `ORG_PERMISSIONS.TASKS_WRITE` constant change. Migration F handles the FK by doing the update in dependency order inside one transaction: first INSERT the new `permissions` row, then UPDATE `permission_set_items` to point at the new key, then DELETE the old `permissions` row. SQL detail in Chunk 4.

**Scope note: BRIEFS_READ stays.** Per spec §10, the renamed GET routes use `TASKS_WRITE` (the spec explicitly maps all renamed routes — read and write — to `TASKS_WRITE`). `ORG_PERMISSIONS.BRIEFS_READ` (= `'org.briefs.read'`) is no longer referenced by any task-intake route, but it remains a valid permission key with row state. The spec does NOT rename `BRIEFS_READ`; we keep it as-is. This is consistent with the §13 gate-1 pass-2 regex which does NOT include `BRIEFS_READ`.

### 1.2 Domain model interpretation

The build operates on three existing primitives, none of which is invented here:

- **`tasks` table** (`server/db/schema/tasks.ts`) — already the canonical operator-task model. This build drops the unused `brief` column (Migration C) and enforces `description NOT NULL` (Migration E). No table-shape changes beyond those two.
- **`fast_path_decisions` table** (`server/db/schema/fastPathDecisions.ts`) — already FK-references `tasks.id` via `brief_id`. Migration B is a pure column rename to `task_id`; the FK target is unchanged.
- **`portal_briefs` table** (`server/db/schema/portalBriefs.ts`) — unrelated to operator tasks; portal card publishing output keyed on `(runId, subaccountId, workflowSlug)`. Migration A renames it to `portal_cards`; PostgreSQL `ALTER TABLE RENAME` preserves RLS policies (policy *names* may continue to reference `portal_briefs` cosmetically — flagged in Chunk 1 acceptance criteria).

The `/api/briefs` route family (`server/routes/briefs.ts` — 6 endpoints, see Chunk 4) and its 13 backing services (`server/services/brief*.ts`) are renamed wholesale to `/api/task-intake` / `task*.ts`. The route shape and permission guards are preserved (modulo the `BRIEFS_WRITE` → `TASKS_WRITE` rename and the `POST /api/task-intake` payload enrichment).

The two creation surfaces are deliberately kept distinct (per intent.md Q7):
- **Layout `NewTaskModal`** — calls `POST /api/task-intake`; AI-triage path; returns `TaskCreationEnvelope` with `conversationId` + `fastPathDecision`.
- **Review-queue `NewTaskModal`** — calls `POST /api/subaccounts/:id/tasks`; plain kanban path; returns a `Task` object; no conversation created.

Shared sub-components (`TaskAttachmentDropZone`, `TaskAgentPicker`) are extracted to `client/src/components/task-modal/` to keep both modals consistent without coupling them.

### 1.3 Service contracts (touching points)

- `server/services/taskCreationService.ts` (renamed from `briefCreationService.ts`) gains four optional input fields: `assignedAgentId`, `dueDate`, `priority`, plus the required `instructions` → `description` mapping. The existing `createBrief()` function becomes `createTaskIntake()` (renamed at source per ChatGPT plan-review round 3 F12) with widened input.
- `server/services/taskService.ts` (existing — unchanged file name) is NOT renamed. Its `createTask()` is kept distinct from `taskCreationService.createTaskIntake()`. Naming overlap is uncomfortable, and the prior plan revision proposed import aliasing (`createTask as createIntakeTask`) to disambiguate at call sites. **Per F12 we go one step further and rename at source** — the exported function in `taskCreationService.ts` is `createTaskIntake`, not `createTask`. This removes the recurring "which createTask is this?" ambiguity for every future reader and search-and-replace operation. Spec §6.2's "no merge" decision is unaffected — the two services remain distinct.
- `server/lib/permissions.ts` — `ORG_PERMISSIONS.BRIEFS_WRITE = 'org.briefs.write'` → `ORG_PERMISSIONS.TASKS_WRITE = 'org.tasks.write'`. `ALL_PERMISSIONS` description and the `'Org Admin'` / `'Org Manager'` permission-set templates updated in the same edit.
- `server/middleware/auth.ts` (`requireOrgPermission`) — no change. The renamed constant flows through automatically.

### 1.4 Cross-cutting risks (high-level only — full table in §3)

- **Rename-sweep blast radius.** ~50 brief-named server files, ~45 brief-named client files, 4 brief-named shared types. Wrong-search-and-replace is the biggest single risk class.
- **Migration F ordering.** Postgres FKs make the `permissions.key` rename non-trivial (see §1.1). Single-transaction insert-then-update-then-delete is required.
- **Permission cutover atomicity.** Migration F + constant rename + route file rename MUST land in the same commit. A deploy that runs Migration F before the new code is alive, or runs the new code before Migration F, locks operators out.
- **`'brief_chat'` surface string.** Used at multiple call sites (services, fixtures, possibly DB-stored conversation metadata). The spec is explicit: exhaustive sweep, no per-site deferral. The renamed value `'task_intake_chat'` is intentionally distinct from the existing `'task_chat'`.
- **Dual modal extraction discipline.** Both modals must consume the same `TaskAttachmentDropZone` and `TaskAgentPicker` — divergent inlined copies would re-create the current consistency problem.
- **Migration D non-reversibility.** Documented in spec §6.3. The plan honours the no-op down by design; the production-rollback variant is explicitly deferred (§14).
- **`tasks.description NOT NULL` insert-site audit.** Spec §6.3 makes this a mandatory plan-authoring deliverable. The full audit lives in §6 below.

### 1.5 Patterns considered and selected

- **Compound rename + behavioural change in one PR.** Considered splitting the rename into a separate "rename only" PR before the modal enrichment, then layering Capability 2 on top. Rejected per spec §12 single-PR convention — the spec is explicit that this is a single deploy unit. Splitting would risk a mid-state where `tasks.description` is NOT NULL in the DB but the client still submits no description, breaking creation. The spec's single-PR posture is what makes Chunk 4 (route + Migration E + Migration F all in one commit) safe.
- **Extracted shared sub-components.** Per intent.md Q7. Direct application of the "three-similar-lines rule": both modals need a drop-zone, both need an agent picker. Extract immediately, do not inline twice.
- **No new service for attachment-upload progress state.** The lifecycle (pending → uploading → settled → failed → retried) lives in the React component state per spec §7.4. No server-side gating mechanism is introduced (advisory posture, Q3). The pure helper `TaskAttachmentDropZonePure.ts` encapsulates the state-transition logic for vitest.
- **`scripts/gates/verify-brief-rename.sh` as a single gate file.** Spec §13 explicitly folds gates 1, 3, 5, 7 into a single script. We honour that — one file, three grep passes — to keep the CI surface small.

---

## 2. Data contracts (architecture-level)

This section names the public contracts the build changes, in the architectural shape. Function signatures, SQL, and Zod definitions live in per-chunk Contracts.

### 2.1 Request / response shapes

- `POST /api/task-intake` — request body gains `instructions` (required, min 1), `assignedAgentId?`, `dueDate?` (`YYYY-MM-DD`), `priority?`. Removes `text`, `explicitTitle`, `explicitDescription` (replaced by `instructions` + optional `title`). Response shape changes from `BriefCreationEnvelope` (with `briefId`) to `TaskCreationEnvelope` (with `taskId`); other fields unchanged.
- `POST /api/subaccounts/:subaccountId/tasks` — request body's `description` becomes required (min 1). Other fields unchanged (already accepts `assignedAgentId`, `dueDate`, `priority`).
- `POST /api/tasks/:taskId/attachments` — unchanged. Existing endpoint at `server/routes/attachments.ts`; spec §7.4 calls out reuse.
- `DELETE /api/attachments/:attachmentId` — unchanged. Existing endpoint.

### 2.2 Schema shapes

- `tasks` — DROP `brief` column (Migration C). ALTER `description` to `NOT NULL` after backfill (Migration E).
- `portal_cards` (renamed from `portal_briefs` via Migration A) — column shape identical. Indexes renamed. RLS policies preserved by Postgres `RENAME` semantics (cosmetic policy-name reference stays).
- `fast_path_decisions` — RENAME COLUMN `brief_id` → `task_id`; RENAME CONSTRAINT `fast_path_decisions_brief_id_fkey` → `fast_path_decisions_task_id_fkey`. FK target unchanged.
- `conversations.scope_type` — DATA migration: `UPDATE conversations SET scope_type = 'task' WHERE scope_type = 'brief'`. Enum value `'brief'` retained in the column (enum-removal deferred per §14).
- `permissions` — `'org.briefs.write'` row replaced by `'org.tasks.write'` via Migration F (Chunk 4).
- `permission_set_items` — every row with `permission_key = 'org.briefs.write'` updated to `permission_key = 'org.tasks.write'` via Migration F (Chunk 4).

### 2.3 Permission keys

- `ORG_PERMISSIONS.BRIEFS_WRITE = 'org.briefs.write'` → `ORG_PERMISSIONS.TASKS_WRITE = 'org.tasks.write'`. **Both** the constant name and the string value rename.
- `ALL_PERMISSIONS` entry updated.
- `DEFAULT_PERMISSION_SET_TEMPLATES['Org Admin']` and `['Org Manager']` references updated.
- `ORG_PERMISSIONS.BRIEFS_READ = 'org.briefs.read'` — **unchanged.** Stays as a permission constant and DB row; no consumer left on the task-intake routes per spec §10, but the spec does not rename it.

### 2.4 Shared types

- `shared/types/briefFastPath.ts` → `shared/types/taskFastPath.ts`. Type renames: `BriefCreationEnvelope` → `TaskCreationEnvelope` (`.briefId` field → `.taskId`), `BriefCreatedResponse` → `TaskCreatedResponse`, `BriefUiContext` → `TaskUiContext` (surface enum: `'brief_chat'` → `'task_intake_chat'`), `BriefScope` → `TaskScope`.
- `FastPathDecision`, `FastPathRoute` — unchanged (per spec §6.5: "describe routing concepts, not brief/task concepts").
- `shared/types/briefSkills.ts`, `shared/types/briefResultContract.ts`, `shared/types/briefRules.ts` — **NOT renamed.** They use "brief" as the universal-brief product concept (rules, skill outputs, result contract). Spec §6.5 and the §13 gate-1 pass-2 regex both exclude them. Verified: none of those filenames or the types they export (`ClarifyingQuestion`, `RuleScope`, etc.) appear in the gate's identifier list.

### 2.5 Error codes

No new error codes. Existing error shapes preserved:
- `POST /api/task-intake` validation failures: `400 { message: '<field> is required' }` (existing route pattern; preserved verbatim during rename).
- `POST /api/subaccounts/:subaccountId/tasks` `description` missing: `400 { error: 'description is required' }` (consistent with the existing `'title is required'` shape at `server/routes/tasks.ts:42`).
- Subaccount cross-tenant: `404` via `resolveSubaccount` throw (existing pattern).

---

## 3. Risks and mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Migration F + code rename out of order → users locked out at cutover. | Single commit per spec §12 Chunk 4. Migration F runs at deploy via Drizzle's "already applied" tracker before the new server process starts serving traffic. Sealed in Chunk 4 acceptance criteria. |
| R2 | `'org.briefs.write'` orphans created if Migration F's down ever runs in production. | Migration F's down does the reverse insert-update-delete cycle, restoring the original key and its grants. The down is safe at pre-production. Production rollback is explicitly out of scope (spec §6.3 production rollback caveat). |
| R3 | Wide rename misses a `Brief*` identifier → gate-1 pass-2 fails at CI. | Chunk-by-chunk grep verification: each chunk's Verification commands list the targeted grep for that chunk's category. Chunk 8 authors `scripts/gates/verify-brief-rename.sh` and runs it locally at the end of Chunk 8 to surface any holdouts before the PR opens. |
| R4 | External-consumer assumption breaks at cutover. | Pre-Chunk-4 four-check verification (spec §6.1). Coordinator runs checks (a) repo grep and (b) Postman/OpenAPI scan locally before Chunk 4 starts; (c) telemetry and (d) partner docs are operator-coordinated. Any non-empty result escalates to the user before Chunk 4 lands. Result recorded in `progress.md` per spec §6.1. |
| R5 | Mid-PR commits leave the codebase un-buildable, blocking partial CI runs. | Documented in spec §12 single-PR convention and § Executor notes here. The plan does NOT promise per-chunk green typecheck; only end-of-PR green. The coordinator's per-chunk `npm run typecheck` may report errors that are resolved by a later chunk — those are acceptable, not blockers. |
| R6 | Dual `NewTaskModal.tsx` filenames (both `client/src/components/layout/modals/NewTaskModal.tsx` and `client/src/components/review-queue/NewTaskModal.tsx`) confuse search-and-replace. | Both files renamed in Chunk 7 with explicit `git mv` and explicit import-site updates listed per file. Path discrimination is preserved (`layout/modals/` vs `review-queue/`). |
| R7 | `conversations.scope_type = 'brief'` rows missed by Migration D if any service still writes `'brief'` after cutover. | Chunk 3 service rename updates every `scope_type` write site to `'task'`. Chunk 8 gate (verify-brief-rename pass 2) catches any remaining `BriefUiContext` or `'brief_chat'` references; the absence of `'brief'` as a written `scope_type` is enforced indirectly by the absence of brief-named services (which were the writers). A dedicated grep for `scope_type.*['"]brief['"]` is added to Chunk 8's acceptance criteria as a belt-and-braces check (not promoted to a gate script since the rename-sweep gate already covers the import surface). |
| R8 | `tasks.description NOT NULL` blocks an insert site that wasn't audited. | Pre-Migration-E insert-site audit is mandatory (§6 below). The audit enumerates every site, classifies each, and notes any code changes required. Without the audit Migration E does not ship. |
| R9 | Workflow runs that publish portal cards via `config_publish_workflow_output_to_portal` skill INSERT into `portal_briefs` — table rename breaks the skill. | The skill (`server/skills/config_publish_workflow_output_to_portal.md`) is documentation, but the handler at `server/tools/config/workflowSkillHandlers.ts` does the INSERT against `portalBriefs` schema. Chunk 1 renames the Drizzle import (`portalBriefs` → `portalCards`) AND the handler call site in the same commit as Migration A. Verified during file inventory. |
| R10 | `BRIEFS_READ` left behind looks like an inconsistency. | Documented in §1.1 final paragraph: spec intentionally does not rename `BRIEFS_READ`. Chunk 10 docs sweep notes this in `architecture.md` to prevent future drift confusion. |
| R11 | `description` field semantics: server already accepts `description` on `POST /api/subaccounts/:subaccountId/tasks` but the existing Zod schema has `description: z.string().optional()`. Making it required is a breaking change for any caller besides the review-queue modal. | Code-search confirms: the only caller of `POST /api/subaccounts/:subaccountId/tasks` from the client is `client/src/components/review-queue/NewBriefModal.tsx` (currently sends `description: description.trim() \|\| undefined`). The review-queue modal is renamed and enriched in Chunk 7 to send `description` as required. Server-side gates the requirement after Chunk 7 lands modal changes. Both happen in the same PR — no broken intermediate state visible to a real user. |
| R12 | Concurrent in-flight branches touching the same surface. | Pre-Chunk-1 concurrent-branch scan per spec §12.1. Coordinator runs the scan script from the spec, records the result in `progress.md`. Any non-empty result escalates to the operator. |

---

## 4. Module shape and chunk boundaries

Capability boundaries (not file boundaries) drive the chunk split:

1. **Schema + portal-rename surface (Migrations A–C + Drizzle schema files + portal-card consumer rename).** Public interface: the renamed `portal_cards` table, `fast_path_decisions.task_id` column, the dropped `tasks.brief` column. Hidden: SQL migration body, Drizzle table-name remapping, RLS-policy-name cosmetic state. (Migration D — `conversations.scope_type` data update — moved to item 4 per ChatGPT plan-review round 3 F1/F2; ships with the writer-cutover commit, not the schema-rename commit.)
2. **Shared types rename.** Public interface: `TaskCreationEnvelope`, `TaskUiContext`, `TaskScope`, `TaskCreatedResponse` (re-exports from `shared/types/taskFastPath.ts`). Hidden: the `surface` literal-narrowing change, the field-rename `briefId` → `taskId`.
3. **Server service rename (13 files).** Public interface: each renamed service's exported function/type names (e.g., `createTaskIntake` per F12, `handleConversationFollowUp`, `decideTaskApproval`). Hidden: internal helpers, the rename of every internal symbol from `brief*` to `task*`, log-tag updates.
4. **Route rename + Migrations D + E + F + payload widening + permission rename.** Public interface: the `/api/task-intake/*` route family, the renamed `ORG_PERMISSIONS.TASKS_WRITE` constant, the new `POST /api/task-intake` request shape (with `instructions`, `assignedAgentId`, `dueDate`, `priority`), the now-required `description` on `POST /api/subaccounts/:subaccountId/tasks`, the `conversations.scope_type = 'task'` data state (Migration D). Hidden: Migration D's data update body, Migration E's backfill order, Migration F's three-statement transaction, route handler's `instructions` → `description` mapping, the conversation `scope_type = 'task'` writeback, the cross-tenant subaccount-resolution defence (preserved verbatim from `briefs.ts`).
5. **`'brief_chat'` surface sweep.** Public interface: `TaskUiContext.surface = 'task_intake_chat'` as the renamed literal value in every produced UiContext. Hidden: per-call-site string-literal change, fixture updates, type narrowing.
6. **Client API + types + URL string sweep.** Public interface: client-side `Task*` types are imported from `shared/types/taskFastPath.ts`; `/api/task-intake/*` URLs everywhere. Hidden: per-component import updates, the ~45-file enumerated list.
7. **NewTaskModal implementation (both variants + shared sub-components).** Public interface: `<NewTaskModal>` JSX surface for both variants; `<TaskAttachmentDropZone>` and `<TaskAgentPicker>` shared components. Hidden: progressive-disclosure logic, advanced section open state, file-drop accessibility plumbing, upload retry state, two pure helper modules for vitest.
8. **CI gate authoring + manual gate PR-template requirements.** Public interface: `scripts/gates/verify-brief-rename.sh` exists and exits 0 on a clean tree; the PR template carries the §13.1 paste-in checklist. Hidden: the three grep passes, the path-exclusion list, the regex tuning.
9. **Test sweep — pure-helper tests for new code only.** Public interface: two new `*Pure.test.ts` files (`TaskAttachmentDropZonePure.test.ts`, `TaskAgentPickerPure.test.ts`) plus identifier renames in existing test files. Hidden: rename of every `BriefXxx` test-symbol reference to `TaskXxx`, fixture updates, integration-test file renames.
10. **Documentation sweep.** Public interface: `architecture.md`, `docs/capabilities.md`, and `tasks/builds/brief-creation-unify/spec.md` reflect the build outcome. Hidden: per-line edits and which "brief" references stay (per §6.6 exemption list).

Every chunk after #1 either depends on #1 (schema is live), on #2 (types resolve), or on #3 (services resolve). Forward-only dependency: no later chunk produces output a previous chunk needs.

---

## 5. Stepwise implementation plan

### Chunk 1 — Schema migrations A–C + Drizzle schema rename + portal-cards consumer rename

**spec_sections:** §6.3 (Migrations A, B, C), §6.4 partial (`portalBriefs.ts` schema rename), §8.1, §11 (Migration safety contracts §16.3 A-C).

**Sequencing note (ChatGPT plan-review round 3, F1/F2):** Migration D (`conversations.scope_type 'brief' → 'task'` data update) was previously listed here. It has been moved to Chunk 4 because the runtime writers that produce `scope_type = 'brief'` are not renamed until Chunk 3 (services) and Chunk 4 (routes). Shipping Migration D in Chunk 1 would have updated existing rows correctly but misleadingly implied the cutover was complete while services still produced 'brief' values until later chunks landed. Since this is a single-PR deploy (§12), runtime ordering is preserved at merge — but the chunk semantics are now honest: Migration D ships with the writer-cutover commit (Chunk 4), not the schema-rename commit (Chunk 1).

**Files to create or modify:**
- `migrations/<NNNN>_rename_portal_briefs_to_portal_cards.sql` (Migration A — new file)
- `migrations/<NNNN>_rename_fast_path_decisions_brief_id_to_task_id.sql` (Migration B — new file)
- `migrations/<NNNN>_drop_tasks_brief_column.sql` (Migration C — new file)
- `server/db/schema/portalBriefs.ts` → `server/db/schema/portalCards.ts` (`git mv` + rename `portalBriefs` export to `portalCards`; update table-name string `'portal_briefs'` → `'portal_cards'`; update index names; update header comment)
- `server/db/schema/fastPathDecisions.ts` (rename `briefId` field reference to `taskId`; update column-name string `'brief_id'` → `'task_id'`; rename index `fast_path_brief_idx` → `fast_path_task_idx`)
- `server/db/schema/tasks.ts` (remove `brief: text('brief')` line)
- `server/db/schema/index.ts` (re-export update if file re-exports schemas)
- `server/config/rlsProtectedTables.ts` (`portalBriefs` registry entry renamed to `portalCards`; manifest's `policyMigration` reference per §6 of DEVELOPMENT_GUIDELINES — confirm the original `portal_briefs` policy migration filename is preserved as the reference)
- `server/tools/config/workflowSkillHandlers.ts` (update `portalBriefs` import + every reference to the renamed Drizzle table object — verified by file inventory as the only non-schema consumer)

**Migration plan:**

- **Migration A — `portal_briefs` → `portal_cards`**
  - Up: `ALTER TABLE portal_briefs RENAME TO portal_cards;` plus `ALTER INDEX portal_briefs_run_id_idx RENAME TO portal_cards_run_id_idx;` and `ALTER INDEX portal_briefs_subaccount_slug_idx RENAME TO portal_cards_subaccount_slug_idx;` (exact index names verified against the live DB pre-commit — implementer runs `\d portal_briefs` on a checkout to confirm; if names diverge, the migration uses the live names).
  - Down: reverse rename of table + indexes.
  - Idempotency: relies on Drizzle migration runner's "already applied" tracking. Raw `ALTER TABLE RENAME` would error on second run — the migration runner prevents double-application.
  - Backfill: none.
  - RLS: Postgres `ALTER TABLE RENAME` preserves attached policies. The policy *name* may still reference `portal_briefs` in its internal identifier (cosmetic only; not user-visible). Header comment notes this and explicitly defers a policy-name sweep.
- **Migration B — `fast_path_decisions.brief_id` → `task_id`**
  - Up: `ALTER TABLE fast_path_decisions RENAME COLUMN brief_id TO task_id;` plus `ALTER TABLE fast_path_decisions RENAME CONSTRAINT fast_path_decisions_brief_id_fkey TO fast_path_decisions_task_id_fkey;` (exact constraint name verified pre-commit by querying `pg_constraint`).
  - Down: reverse rename of column + constraint.
  - Idempotency: same migration-runner tracking.
  - Backfill: none. FK target (`tasks.id`) unchanged.
- **Migration C — drop `tasks.brief`**
  - Pre-condition: implementer runs `git grep -nE "tasks\.brief\b|brief:.*text" server/ shared/` and confirms no live read of `tasks.brief` outside the schema file itself (which is being edited in this chunk). Result recorded in `progress.md`. The `server/schemas/tasks.ts` Zod schemas reference `brief: z.string().optional()` — those Zod fields are removed in Chunk 4 (the route chunk) since they live in the route-validation layer. Chunk 1 only removes the Drizzle column definition; the Zod fields are removed in Chunk 4.
  - Up: `ALTER TABLE tasks DROP COLUMN IF EXISTS brief;`
  - Down: `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS brief text;`
  - Idempotency: `DROP IF EXISTS` is idempotent at the SQL level; runner tracking covers the rest.
- **Migration D — moved to Chunk 4.** See Chunk 4 Migration plan for the body. Migration D (`UPDATE conversations SET scope_type = 'task' WHERE scope_type = 'brief'`) is a behavioural / data-contract cutover, not a schema rename, and ships with the writer-cutover commit (route + service `scope_type` writes change to `'task'`) — not with the schema-rename commit here. Filename and SQL body unchanged from prior plan revision.

**Contracts:**
- `portal_cards` table: column shape identical to `portal_briefs` (no field renames). Drizzle export name: `portalCards` (camelCase) — call sites `import { portalCards } from '../db/schema/portalCards'`.
- `fast_path_decisions.task_id` column: `uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE` (unchanged semantics). Drizzle field name: `taskId`.
- `tasks` table: `brief text` removed; `description text` still nullable at end of this chunk (Migration E in Chunk 4 makes it `NOT NULL`).
- `conversations.scope_type`: no change in this chunk. Existing rows continue to hold value `'brief'`; the data update to `'task'` ships with Migration D in Chunk 4 alongside the writer cutover.

**Error handling:**
- Migration runner errors halt deploy — that's the desired behaviour for any unexpected DB state.
- Pre-condition grep for Migration C: if a live `tasks.brief` read is found, **STOP** the chunk and escalate to the operator. The pre-condition is non-negotiable per spec §6.3.

**Test scope:**
- No new vitest tests in this chunk. Schema and migration files are not pure helpers per `references/test-gate-policy.md`.
- Drizzle `npm run db:generate` after schema edits — verifies migration files are well-formed. NOT a gate, just a sanity check.

**Dependencies:** none (first chunk).

**Acceptance criteria:**
- Three migration files (A, B, C) exist with up and down SQL bodies. (Migration D is authored in Chunk 4 — see sequencing note above.)
- `server/db/schema/portalCards.ts` exists; `server/db/schema/portalBriefs.ts` deleted; `rlsProtectedTables.ts` updated; the workflowSkillHandlers consumer is renamed.
- Pre-condition grep for Migration C run and result recorded in `progress.md` ("no live reads of `tasks.brief` outside the schema file").
- Pre-Chunk-1 concurrent-branch scan (spec §12.1) recorded in `progress.md`.
- `npm run db:generate` produces no schema-drift errors.
- `npm run lint` passes for changed files.
- Chunk-1 grep verification (recorded in `progress.md`): `git grep -nE "\bportalBriefs\b" server/ shared/` returns ONLY the migration files and historical migration SQL. (Client side covered in Chunk 6.)

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate`
- `git grep -nE "\bportalBriefs\b" server/ shared/`

---

### Chunk 2 — Shared types rename

**spec_sections:** §6.5, §8.4.

**Files to create or modify:**
- `shared/types/briefFastPath.ts` → `shared/types/taskFastPath.ts` (`git mv` + rename every exported symbol)

**Contracts:**
```typescript
// shared/types/taskFastPath.ts
export type FastPathRoute = 'simple_reply' | 'needs_clarification' | 'needs_orchestrator' | 'cheap_answer';
export type TaskScope = 'subaccount' | 'org' | 'system';
export interface TaskUiContext {
  surface: 'global_ask_bar' | 'task_intake_chat' | 'task_chat' | 'agent_chat' | 'agent_run_chat';
  currentSubaccountId?: string;
  currentOrgId: string;
  userPermissions: Set<string>;
}
export interface FastPathDecision { /* unchanged */ }
export interface TaskCreationEnvelope {
  taskId: string;            // renamed from briefId
  conversationId: string;
  fastPathDecision: FastPathDecision;
  organisationId: string;
  subaccountId: string | null;
  organisationName: string | null;
  subaccountName: string | null;
}
export type TaskCreatedResponse = { type: 'task_created' } & TaskCreationEnvelope;
```

Note the discriminator literal `'task_created'` (was `'brief_created'`). Every consumer that switches on `response.type` must be updated in Chunks 3 (servers) and 6 (clients).

**Error handling:** type rename only; no runtime errors possible from this chunk in isolation.

**Test scope:** none. Pure type rename has no runtime behaviour.

**Dependencies:** none (parallel-safe with Chunk 1). However, listed as Chunk 2 because Chunk 3 imports these types — and Chunk 3 is sequenced after Chunk 1 for the chunk-3 service-import sweep ordering.

**Acceptance criteria:**
- `shared/types/taskFastPath.ts` exists with the contracts above.
- `shared/types/briefFastPath.ts` deleted.
- `npm run typecheck` produces ONLY broken imports from server files yet to be updated in Chunk 3 (and client files yet to be updated in Chunk 6). No NEW type errors introduced beyond the import-resolution failures.

**Verification commands:**
- `npm run lint`
- `npm run typecheck` (expected: server/client imports break; this is the documented mid-PR un-buildable state per spec §12)

---

### Chunk 3 — Server service rename (13 files + every consumer's imports)

**spec_sections:** §6.2, §8.2.

**Files to create or modify (13 service renames):**
- `server/services/briefCreationService.ts` → `server/services/taskCreationService.ts` (rename internal symbols: `createBrief` → `createTaskIntake` per F12 — DO NOT use `createTask` at source; `BriefInput` → `TaskIntakeInput`; `getBriefArtefacts` → `getTaskArtefacts`; `getBriefMeta` → `getTaskMeta`; update `BriefCreationEnvelope` import to `TaskCreationEnvelope`)
- `server/services/briefConversationService.ts` → `server/services/taskConversationService.ts` (rename `handleConversationFollowUp` — name stays — but update `briefId` param to `taskId`)
- `server/services/briefConversationWriter.ts` → `server/services/taskConversationWriter.ts`
- `server/services/briefApprovalService.ts` → `server/services/taskApprovalService.ts` (rename `decideBriefApproval` → `decideTaskApproval`, `briefId` param → `taskId`)
- `server/services/briefVisibilityService.ts` → `server/services/taskVisibilityService.ts`
- `server/services/briefArtefactBackstopPure.ts` → `server/services/taskArtefactBackstopPure.ts`
- `server/services/briefArtefactCursorPure.ts` → `server/services/taskArtefactCursorPure.ts`
- `server/services/briefArtefactPaginationPure.ts` → `server/services/taskArtefactPaginationPure.ts`
- `server/services/briefArtefactValidatorPure.ts` → `server/services/taskArtefactValidatorPure.ts`
- `server/services/briefArtefactValidator.ts` → `server/services/taskArtefactValidator.ts`
- `server/services/briefDispatchRoutePure.ts` → `server/services/taskDispatchRoutePure.ts`
- `server/services/briefMessageHandlerPure.ts` → `server/services/taskMessageHandlerPure.ts`
- `server/services/briefSimpleReplyGeneratorPure.ts` → `server/services/taskSimpleReplyGeneratorPure.ts`

**Files modified for consumer-import sweep (broader server surface):**
- `server/routes/sessionMessage.ts` (every `briefId` field → `taskId`, every `BriefCreationEnvelope` → `TaskCreationEnvelope`, every discriminator `'brief_created'` → `'task_created'`)
- `server/routes/conversations.ts` (imports the brief conversation router under `briefConversationsRouter`; rename export to `taskConversationsRouter` and update `server/index.ts:179, 466`)
- `server/services/fastPathDecisionLogger.ts` (every `briefId` → `taskId`)
- `server/jobs/orchestratorFromTaskJob.ts` (uses `briefId` in `fastPathDecisions` insert payload — update field name)
- `server/websocket/emitters.ts` (any brief-related event payload field renames)
- `server/services/__tests__/briefVisibilityServicePure.test.ts` → `taskVisibilityServicePure.test.ts` (and equivalent for the other 6 brief pure-helper tests) — file rename + internal symbol updates. Chunk 3 owns this because rename-day means importing renamed services in test files immediately.
- `server/services/__tests__/briefMessageHandlerPure.test.ts` → `taskMessageHandlerPure.test.ts`
- `server/services/__tests__/briefArtefactValidatorPure.test.ts` → `taskArtefactValidatorPure.test.ts`
- `server/services/__tests__/briefArtefactCursorPure.test.ts` → `taskArtefactCursorPure.test.ts`
- `server/services/__tests__/briefArtefactPaginationPure.test.ts` → `taskArtefactPaginationPure.test.ts`
- `server/services/__tests__/briefArtefactBackstopPure.test.ts` → `taskArtefactBackstopPure.test.ts`
- `server/services/__tests__/briefApprovalServicePure.test.ts` → `taskApprovalServicePure.test.ts`
- `server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts` → `taskConversationWriterPostCommit.integration.test.ts`

**Chunk-3 size note:** 13 service-file renames + 8 test-file renames + ~6 consumer-import edits = ~27 files. This exceeds the 5-files-OR-1-responsibility chunk rule on the file-count axis. **Justification (per the chunk-sizing rule):** all 27 files are a single logical responsibility — "rename brief-named services and update every importer in the same atomic step". Splitting service-file renames from importer updates would create a typecheck-broken state inside the chunk boundary (importer would import a now-deleted file), which is exactly what the spec §12 single-PR convention warns against. The chunk is large by file count but is one responsibility by capability. The 5-file rule yields to the 1-responsibility rule when the work cannot be split without breaking the build inside the chunk.

**Contracts:**
- `taskCreationService.createTaskIntake(input: TaskIntakeInput): Promise<TaskCreationResult>` (was `createBrief(input: BriefInput): Promise<BriefCreationResult>`; renamed at source per F12 to remove ambiguity with `taskService.createTask`). `TaskIntakeInput` shape:
  ```typescript
  interface TaskIntakeInput {
    organisationId: string;
    subaccountId?: string;
    submittedByUserId: string;
    text: string;                  // legacy compatibility — still the input text field
    source: 'new_task_modal' | 'global_ask_bar' | 'programmatic';  // spec §POST /api/task-intake canonical enum (no 'slash_remember')
    uiContext: TaskUiContext;
    explicitTitle?: string;
    explicitDescription?: string;  // mapped to tasks.description (still nullable until Chunk 4)
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    // New fields added in Chunk 4 (not in this chunk):
    //   assignedAgentId?: string;
    //   dueDate?: Date;
  }
  ```
  The new fields land in Chunk 4 (route + service together for atomicity); this chunk preserves the existing field set verbatim except for the rename.
- `taskConversationService.handleConversationFollowUp({ conversationId, taskId, ... })` — `briefId` param renamed to `taskId`.
- `taskApprovalService.decideTaskApproval({ taskId, ... })` — `briefId` param renamed to `taskId`.

**Error handling:** preserved verbatim from each renamed service. No new error paths in this chunk.

**Test scope:**
- Existing brief-named pure-helper tests are file-renamed (and their internal `import` paths updated). No new test logic.
- `npx vitest run server/services/__tests__/taskMessageHandlerPure.test.ts` after the rename — confirm test still passes after import-path update. Run for each of the 8 renamed test files (this is a targeted check, allowed under `references/test-gate-policy.md`).

**Dependencies:** Chunk 2 (services import `TaskCreationEnvelope`, `TaskUiContext`).

**Acceptance criteria:**
- All 13 service files renamed.
- All 8 test files renamed; tests pass when run individually with `npx vitest run`.
- Every server-side `BriefCreationEnvelope` / `BriefUiContext` / `briefId` field reference updated.
- `server/index.ts` line 179 import `briefConversationsRouter` and line 466 `app.use(briefConversationsRouter)` updated to `taskConversationsRouter`.
- `npm run typecheck` may still fail due to `server/routes/briefs.ts` (handled in Chunk 4) and client files (Chunk 6). This is the documented mid-PR un-buildable state.
- Chunk-3 grep verification (recorded in `progress.md`): `git grep -nE "\bbriefCreationService\b|\bbriefConversationService\b|\bbriefConversationWriter\b|\bbriefApprovalService\b|\bbriefVisibilityService\b|\bbriefArtefact[A-Za-z]+\b|\bbriefDispatchRoutePure\b|\bbriefMessageHandlerPure\b|\bbriefSimpleReplyGeneratorPure\b" server/` returns ONLY references inside `server/routes/briefs.ts` (Chunk 4 will rename it).

**Verification commands:**
- `npm run lint`
- `npm run typecheck` (expected: only `server/routes/briefs.ts` and client-side breakage remain)
- `npx vitest run server/services/__tests__/taskMessageHandlerPure.test.ts` (and similar for each of the 8 renamed test files)

---

### Chunk 4 — Route rename + payload widening + Migrations D, E, F + permission rename (single commit)

**spec_sections:** §6.1, §6.3 (Migrations D, E), §7.1, §7.2, §7.3 partial (server side), §7.7, §9.1, §9.3, §10, §12 Chunk 4 (with both pre-Chunk-4 gates cleared).

**Pre-Chunk-4 gates (ALL THREE must be clear before this chunk commits — recorded in `progress.md`):**
1. OQ1 permission DB-storage resolution: **resolved as path (b)**; Migration F authored in this chunk. (See §1.1 above.)
2. External-consumer verification (spec §6.1): four checks completed and recorded in `progress.md`. Coordinator runs check (a) repo grep and (b) Postman/OpenAPI scan locally before Chunk 4 starts. Checks (c) — 30-day route telemetry — and (d) partner integration docs — require operator coordination; at pre-production stage (c) typically returns "no production logs yet" which is acceptable per spec §6.1.
3. **`tasks` insert-site audit completion — BLOCKING (promoted to a hard pre-Chunk-4 substep per ChatGPT plan-review round 3 F17).** Before Migration E may commit, the coordinator runs the explicit insert-site grep below and resolves EVERY `TO VERIFY` row in §6.2 with a concrete `file:line` citation and a verdict (a/c per §6.3). The grep MUST be re-run live (not relied on from plan authoring) because the codebase may have shifted since this plan was written. If any insert site cannot supply `description` and the coordinator cannot defensibly add `description: ''` (e.g., the insert path is in a third-party-driven flow whose semantics are unclear), the coordinator STOPS Chunk 4 and escalates to the operator. Migration E SQL does NOT land in the chunk until every row is green. Audit substep:
   ```bash
   # The coordinator runs each of these greps and pastes the file:line results into progress.md.
   git grep -nE "insert.*\bschema\.tasks\b|insert\(tasks\)|\.insert\(.*\btasks\b" -- server/
   git grep -nE "db\.insert\(tasks\)" -- server/
   git grep -nE "from\s+['\"].*tasks['\"]" -- server/ | grep -i insert
   ```
   The output is reconciled against §6.2's enumeration. New insert sites discovered by the live grep MUST be added to §6.2 with a verdict before Chunk 4 commits.

**Files to create or modify:**
- `migrations/<NNNN>_update_conversations_scope_type_brief_to_task.sql` (Migration D — new file; relocated from Chunk 1 per F1/F2)
- `migrations/<NNNN>_backfill_tasks_description_and_set_not_null.sql` (Migration E — new file)
- `migrations/<NNNN>_rename_permission_briefs_write_to_tasks_write.sql` (Migration F — new file)
- `server/routes/briefs.ts` → `server/routes/taskIntake.ts` (`git mv` + route prefix `/api/briefs` → `/api/task-intake`; permission guards `BRIEFS_WRITE` → `TASKS_WRITE`; new request fields)
- `server/lib/permissions.ts` (rename `BRIEFS_WRITE: 'org.briefs.write'` to `TASKS_WRITE: 'org.tasks.write'`; update `ALL_PERMISSIONS` description; update `DEFAULT_PERMISSION_SET_TEMPLATES['Org Admin']` and `['Org Manager']` references)
- `server/routes/tasks.ts` (make `description` required for `POST /api/subaccounts/:subaccountId/tasks`; remove the `brief` field from the handler signature now that the column is dropped)
- `server/schemas/tasks.ts` (Zod: `description: z.string().min(1)` in `createTaskBody`; remove `brief: z.string().optional()` from `createTaskBody` and from `updateTaskBase`)
- `server/services/taskCreationService.ts` (add `assignedAgentId?: string`, `dueDate?: Date`, `priority?` to `TaskIntakeInput`; map `instructions` → `description`; write the new fields into the `tasks` insert; exported function is `createTaskIntake` per F12)
- `server/index.ts` (line 177 import path `./routes/briefs.js` → `./routes/taskIntake.js`; line 464 `app.use(briefsRouter)` — rename variable to `taskIntakeRouter`)
- `server/lib/dates.ts` (new helper `parseDueDate` — see Contracts below; new file if `dates.ts` does not yet exist)

**Migration plan:**

- **Migration D — `conversations.scope_type` data update (relocated from Chunk 1 per ChatGPT plan-review round 3 F1/F2)**
  - Up: `UPDATE conversations SET scope_type = 'task' WHERE scope_type = 'brief';`
  - Down: `RAISE NOTICE 'Migration D down: no-op; see spec §14 for production rollback guidance'; SELECT 1;` (intentional non-reversibility — spec §6.3).
  - Idempotency: the `WHERE scope_type = 'brief'` clause makes the UP idempotent at the SQL level (no-op on second run); runner tracking is redundant but safe.
  - Backfill: this IS the backfill. No schema change.
  - Ordering inside Chunk 4: Migration D's filename `<NNNN>` is numbered between A–C (Chunk 1) and Migration E/F (Chunk 4) — i.e., higher than Chunk 1's migration sequence — to preserve writer-cutover ordering at deploy time. The runtime correctness argument (services and routes now write `'task'`) is what makes this safe.

- **Migration E — backfill `tasks.description` then `SET NOT NULL`**
  - **Pre-condition (mandatory plan-authoring audit — completed in §6 below).** Spec §6.3 makes this a mandatory plan-authoring deliverable; the result is in §6.
  - Up:
    ```sql
    UPDATE tasks SET description = '' WHERE description IS NULL;
    ALTER TABLE tasks ALTER COLUMN description SET NOT NULL;
    ```
  - Down: `ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL;` (leaves any `''` values in place — losing data is impossible).
  - Idempotency: backfill is `WHERE description IS NULL` → no-op on second run. `SET NOT NULL` errors on second run; runner tracking prevents it.
- **Migration F — `permissions.key` and `permission_set_items.permission_key` rename**
  - **Pre-authoring step (mandatory — ChatGPT plan-review round 3 F3):** implementer runs `\d permissions` against the live dev DB (or reads `server/db/schema/permissions.ts` — verified during plan authoring: columns are `key text PK`, `description text NOT NULL`, `group_name text NOT NULL`, `created_at timestamptz DEFAULT now() NOT NULL`). The INSERT column list in the SQL below MUST match the live shape; if `permissions` has gained additional NOT NULL columns since plan authoring, the INSERT must enumerate them with safe defaults before the migration commits. Result recorded in `progress.md` as a one-line confirmation (e.g., "Migration F column-shape verified: key, description, group_name, created_at — matches plan").
  - **Pre-existing-state safety (ChatGPT plan-review round 3 F3):** the SQL below MUST tolerate three pre-states without erroring: (i) clean (only `'org.briefs.write'` present), (ii) partial migration (`'org.tasks.write'` already inserted but `permission_set_items` not yet updated), (iii) already-completed (only `'org.tasks.write'` present, `'org.briefs.write'` already deleted). The `WHERE NOT EXISTS` on INSERT and the conditional UPDATE/DELETE achieve this.
  - Up (single transaction to satisfy the FK; tolerates clean / partial / already-complete pre-states):
    ```sql
    BEGIN;
    -- Insert the new permission row alongside the old (idempotent — no-op if already present).
    INSERT INTO permissions (key, description, group_name)
    SELECT 'org.tasks.write',
           'Create Tasks and post messages into a conversation',
           'org.tasks'
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'org.tasks.write');

    -- Repoint every grant from the old key to the new key (idempotent — no rows match on re-run).
    UPDATE permission_set_items
       SET permission_key = 'org.tasks.write'
     WHERE permission_key = 'org.briefs.write';

    -- Drop the old key only if it has no remaining references.
    -- The preceding UPDATE re-points every grant, so the NOT EXISTS guard
    -- should always pass on a fresh run. The guard exists to defend against
    -- the unlikely partial-completion case where a row was independently
    -- inserted referencing 'org.briefs.write' between the UPDATE and DELETE.
    DELETE FROM permissions
     WHERE key = 'org.briefs.write'
       AND NOT EXISTS (
         SELECT 1 FROM permission_set_items
          WHERE permission_key = 'org.briefs.write'
       );
    COMMIT;
    ```
  - Down (single transaction, reverses the cycle — **PRE-PRODUCTION USE ONLY; see caveat below**):
    ```sql
    BEGIN;
    INSERT INTO permissions (key, description, group_name)
    SELECT 'org.briefs.write',
           'Create Briefs and post messages into a conversation',
           'org.briefs'
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'org.briefs.write');

    -- PRE-PRODUCTION ONLY: this UPDATE rewrites EVERY org.tasks.write grant
    -- back to org.briefs.write, regardless of provenance. After production
    -- cutover, any grant that was newly inserted referencing org.tasks.write
    -- (i.e., not the result of the original Up rename) would be silently
    -- repointed to a legacy key that may not match the operator's
    -- authorisation intent. Do NOT run this down on a live production
    -- database after cutover. See DOWN SAFETY CAVEAT below and spec §6.3 / §14.
    UPDATE permission_set_items
       SET permission_key = 'org.briefs.write'
     WHERE permission_key = 'org.tasks.write';

    -- Guard against deleting org.tasks.write if any post-cutover grants reference it
    -- that were NOT covered by the preceding UPDATE (i.e., independently inserted
    -- after the rename).
    DELETE FROM permissions
     WHERE key = 'org.tasks.write'
       AND NOT EXISTS (
         SELECT 1 FROM permission_set_items
          WHERE permission_key = 'org.tasks.write'
       );
    COMMIT;
    ```
  - **DOWN SAFETY CAVEAT (ChatGPT plan-review round 3 F4) — PRE-PRODUCTION ONLY.** Migration F's down is safe ONLY before the production cutover (Chunk 4 deploy). After cutover, any `permission_set_items` row newly inserted by an operator action that references `'org.tasks.write'` would be reverted by the down's UPDATE statement, potentially repointing those grants to a key that may not match the operator's authorisation intent. The NOT EXISTS guard on the DELETE prevents destroying `'org.tasks.write'` if rows still legitimately reference it, but the UPDATE rewrites all such rows. **Production rollback is explicitly out of scope per spec §6.3 / §14.** If a production rollback is ever required, the procedure must be authored as a separate forward-rolling migration that restores the legacy key based on audit-log evidence, not by re-running this down. The migration file header MUST carry the comment `-- DOWN MIGRATION IS PRE-PRODUCTION-ONLY. See plan.md §Chunk-4 Migration F down safety caveat for rationale. DO NOT run this down on a live production database after cutover.`
  - Idempotency: the `WHERE NOT EXISTS` on inserts and the `WHERE permission_key = '<old>'` on updates make each statement re-runnable safely. The DELETE now carries an explicit `NOT EXISTS` guard (added per F4), so it cannot destroy a key that still has live grants.
  - Backfill: this IS the backfill.
  - RLS: `permissions` and `permission_set_items` are system-scoped (no `organisation_id`); covered by the `withAdminConnection` migration runner path.

**Contracts:**

- `POST /api/task-intake` request body:
  ```typescript
  {
    instructions: string;           // required, min 1, mapped to tasks.description
    title?: string;
    source?: 'new_task_modal' | 'global_ask_bar' | 'programmatic';  // canonical enum per spec line 557; 'slash_remember' is NOT in scope and must NOT be accepted
    uiContext?: Partial<TaskUiContext>;
    subaccountId?: string;
    organisationId?: string;        // system admins only — requires X-Organisation-Id header parity
    assignedAgentId?: string;
    dueDate?: string;               // YYYY-MM-DD; server converts to subaccount-tz midnight UTC
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  }
  ```
  Validation: `instructions` rejected with `400 { message: 'instructions is required' }` if absent or empty after trim. Other fields optional. `source` enum strictly enforced (canonical per spec line 557: `'new_task_modal' | 'global_ask_bar' | 'programmatic'`) — any value not in the new enum is rejected with `400 { message: 'invalid source' }`. Legacy `'new_brief_modal'` is NOT in the new enum — must be remapped at every client site in Chunk 6 to `'new_task_modal'`. **`'slash_remember'` is NOT a permitted source value** — if any pre-build call site sends it, treat the rename to `'new_task_modal'` (or omit the field) per the Chunk 6 sweep; surfacing live `'slash_remember'` callers is a Chunk-4 acceptance blocker.
- `POST /api/task-intake` response: `TaskCreationEnvelope` (201) — see Chunk 2 contracts. The `type: 'task_created'` discriminator is set on the response, replacing `'brief_created'` at every consumer.
- `POST /api/subaccounts/:subaccountId/tasks` Zod (`createTaskBody`):
  ```typescript
  z.object({
    title: z.string().min(1).max(500),
    description: z.string().min(1),      // CHANGED: was optional
    // brief field REMOVED (column dropped)
    status: z.string().max(100).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    assignedAgentId: z.string().optional(),
    assignedAgentIds: z.array(z.string()).optional(),
    createdByAgentId: z.string().optional(),
    processId: z.string().optional(),
    dueDate: z.string().optional(),
  })
  ```
- `requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE)` middleware: identical mechanic to `BRIEFS_WRITE`; the value flowing through is now `'org.tasks.write'`.
- Due-date conversion: spec §7.7 calls for a `parseDueDate(input, subaccountTimezone)` helper. **Architect confirmed during plan authoring: no such helper currently exists.** The existing `POST /api/subaccounts/:subaccountId/tasks` route at line 50 of `server/routes/tasks.ts` calls `new Date(dueDate)` directly with no timezone conversion. Per spec §7.7 the task-intake route invokes "the same conversion helper as the subaccount-tasks endpoint" — since that endpoint doesn't have one, **Chunk 4 introduces** a `parseDueDate` helper in `server/lib/dates.ts`. This is a small primitive addition (one file, one function); the "why not reuse" answer is "no existing primitive — the inline `new Date()` was a bug spec §7.7 indirectly surfaces". **Surfaced (not silently fixed):** the existing endpoint's lack of timezone conversion is a pre-existing inconsistency the spec only partially addresses; the helper unifies both call sites.

  **Full `parseDueDate` contract (tightened per ChatGPT plan-review round 3 F5):**

  ```typescript
  /**
   * Convert a YYYY-MM-DD due-date input into a UTC Date representing midnight
   * in the subaccount's IANA timezone. Pure function — no I/O, no clock reads.
   *
   * @throws {DueDateParseError} when input is malformed or timezone is invalid.
   */
  function parseDueDate(input: string, subaccountTimezone: string | null): Date;

  class DueDateParseError extends Error {
    constructor(readonly code: 'invalid_format' | 'invalid_timezone' | 'invalid_date', message: string);
  }
  ```

  **Library choice:** `Intl.DateTimeFormat` (Node 18+, project standard — `server/services/scheduledTaskService.ts` already uses this pattern at line 42). No new dependency added. `date-fns-tz` / `luxon` / `moment-timezone` are NOT in `package.json` and are NOT added by this build.

  **Behavioural contract (must be covered by `server/lib/__tests__/datesPure.test.ts`):**

  | Input | `subaccountTimezone` | Behaviour |
  |---|---|---|
  | `'2026-05-20'` | `'America/New_York'` | Returns `Date` whose UTC value equals `2026-05-20T04:00:00Z` (midnight EDT). |
  | `'2026-05-20'` | `'UTC'` | Returns `Date` whose UTC value equals `2026-05-20T00:00:00Z`. |
  | `'2026-05-20'` | `null` | Fallback path: returns `new Date('2026-05-20')` (UTC-midnight interpretation per ECMA-262). Behaviour matches the existing `server/routes/tasks.ts:50` inline call so this code path is migration-compatible. |
  | `'2026-13-45'` | any | **Throws** `DueDateParseError('invalid_format', ...)`. Route handler maps to `400 { message: 'invalid dueDate' }`. |
  | `''` or non-string | any | **Throws** `DueDateParseError('invalid_format', ...)`. |
  | `'2026-05-20'` | `'Not/A_Zone'` | **Throws** `DueDateParseError('invalid_timezone', ...)`. `Intl.DateTimeFormat` throws `RangeError` on invalid IANA names — wrap and rethrow. Route handler treats this as 500 (server-side data issue, not operator input) and logs the offending subaccount ID. |
  | `'2026-02-30'` | `'UTC'` | **Throws** `DueDateParseError('invalid_date', ...)`. (Date components valid as integers but the resulting day does not exist.) |
  | DST transition (`'2026-03-08'` `'America/New_York'` — clocks jump forward 02:00 → 03:00) | as labelled | Returns the UTC instant corresponding to local midnight (00:00 EST = 05:00Z); midnight is well-defined on DST-spring days because the jump is at 02:00 local. Documented in test as a regression-anchor. |
  | Fall-back DST day (`'2026-11-01'` `'America/New_York'`) | as labelled | Returns the UTC instant corresponding to the FIRST occurrence of local midnight (00:00 EDT = 04:00Z). Local midnight is single-valued on fall-back days because the duplicated hour is 01:00–02:00 local. |

  **Error-handling integration:** the route handler at `server/routes/taskIntake.ts` catches `DueDateParseError`. For `code === 'invalid_format'` or `'invalid_date'`, returns `400 { message: 'invalid dueDate' }`. For `code === 'invalid_timezone'`, returns `500 { message: 'subaccount timezone misconfigured' }` AND logs `{ subaccountId, timezone, error: err.message }` at WARN level — this is a data-integrity issue, not operator fault.

  **Both routes (task-intake and subaccount-tasks) call the new helper, replacing the inline `new Date(dueDate)`.** The helper file is `server/lib/dates.ts`; tests live at `server/lib/__tests__/datesPure.test.ts`. Pure helper convention per `scripts/verify-pure-helper-convention.sh`.

**Error handling:**
- `400` on missing `instructions` (task-intake) or missing `description` (subaccount-tasks) — preserved existing error shape.
- `404` on stale subaccount via `resolveSubaccount` throw — preserved existing pattern.
- `403` on system-admin override mismatch — preserved.
- Migration E backfill failure: the UPDATE is atomic per-row; bulk UPDATE either succeeds entirely or rolls back. If it fails, deploy halts (desired).
- Migration F transaction failure: rolled back fully; deploy halts (desired). Operators stay on the old route until the issue is resolved.

**Test scope:**
- New pure helper `parseDueDate` test (vitest): `server/lib/__tests__/datesPure.test.ts` (`Pure` suffix per `verify-pure-helper-convention.sh`). Tests cover every row of the contract table above: subaccount-timezone interpretation (EDT, UTC), null-timezone fallback, malformed-date format, empty/non-string input, invalid IANA timezone (must throw `DueDateParseError` with code `'invalid_timezone'`), invalid calendar date (e.g., `'2026-02-30'`), DST spring-forward day, DST fall-back day. Determinism check: same input pair yields the same `Date.getTime()` across three runs.
- Existing brief-named route integration tests (`server/routes/__tests__/briefsArtefactsPagination.integration.test.ts` and `conversationsRouteFollowUp.integration.test.ts`) — these are integration tests, NOT pure-helper tests; per `references/test-gate-policy.md` they live as-is and are NOT executed locally. They will be file-renamed in Chunk 9 and their internal references swept. Authoring new integration tests is out of scope for this build.

**Dependencies:** Chunk 1 (`tasks.brief` column dropped, `portal_cards` renamed, `fast_path_decisions.task_id` available), Chunk 2 (`TaskCreationEnvelope`, `TaskUiContext` defined), Chunk 3 (`taskCreationService`, `taskConversationService`, etc. renamed).

**Acceptance criteria:**
- Migration E and Migration F files exist with up and down SQL bodies.
- §1.1 OQ1 resolution recorded in `plan.md` (this file) AND in `progress.md` (one-line summary linking back here).
- §6.1 external-consumer verification four-check result recorded in `progress.md`.
- §6 `tasks` insert-site audit recorded in this plan (below). Migration E does not commit without it.
- `server/routes/taskIntake.ts` exists; `server/routes/briefs.ts` deleted.
- `server/lib/permissions.ts` renames `BRIEFS_WRITE` to `TASKS_WRITE` and updates dependent arrays.
- `server/routes/tasks.ts` makes `description` required; removes `brief` from handler.
- `server/schemas/tasks.ts` Zod updates done.
- `server/services/taskCreationService.ts` accepts and writes `assignedAgentId`, `dueDate`, `priority`; maps `instructions` → `description`. Exported function name is `createTaskIntake` (NOT `createTask` — F12).
- `server/lib/dates.ts` has `parseDueDate` helper; both routes use it.
- `npm run typecheck` server-side passes (client side may still fail until Chunk 6).
- Chunk-4 grep verification (recorded in `progress.md`): `git grep -nE "\bBRIEFS_WRITE\b|/api/briefs\b" server/` returns zero matches. `git grep -nE "tasks\.brief\b" server/ shared/` returns zero matches.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/lib/__tests__/datesPure.test.ts`

---

### Chunk 5 — `'brief_chat'` surface sweep + `BriefUiContext` value-site sweep

**spec_sections:** §6.1 partial (`'brief_chat'` rename to `'task_intake_chat'`), §12 Chunk 5.

**Files to create or modify (server side — call-site value sweep):**
- `server/services/taskCreationService.ts` (any `'brief_chat'` literal → `'task_intake_chat'`)
- `server/services/taskConversationService.ts`
- `server/services/taskConversationWriter.ts`
- `server/routes/taskIntake.ts` (line 200 of old `briefs.ts`: `uiContext?.surface ?? 'brief_chat'` → `'task_intake_chat'`)
- `server/routes/sessionMessage.ts` (the brief-router consumers may set `surface` in their UiContext construction)
- `server/services/__tests__/taskVisibilityServicePure.test.ts` (fixture literals — renamed in Chunk 3)
- `server/services/__tests__/taskMessageHandlerPure.test.ts` (fixture literals — renamed in Chunk 3)
- Any other server fixture or test file with the `'brief_chat'` literal (architect enumerates by `git grep -n "'brief_chat'" server/` immediately before this chunk)

**Files to create or modify (client side):**
- `client/src/components/layout/modals/NewBriefModal.tsx` (still named — renamed in Chunk 7) — currently uses `surface: 'new_brief_modal'`; covered in Chunk 7's modal rewrite.
- Any client file with `'brief_chat'` literal (current grep result: only `client/src/components/layout/modals/NewBriefModal.tsx` — see §3 R7 caveat). The client-side sweep also happens in Chunk 6/7. Chunk 5 is server-focused; client coverage continues in Chunks 6 and 7.

**Chunk-5 scope clarification:** The spec §12 lists Chunk 5 as the `'brief_chat'` exhaustive sweep. Server-side this is small (~5 call sites and ~3 fixture sites). Client-side, the only current `'brief_chat'` usage is inside the layout NewBriefModal — which is fully rewritten in Chunk 7. So Chunk 5 is the SERVER-side sweep; Chunk 6 picks up any remaining client-side string literals; Chunk 7 covers the modal rewrites. The spec's "exhaustive sweep" intent is preserved across Chunks 5–7.

**Contracts:**
- `TaskUiContext.surface` enum value `'task_intake_chat'` replaces `'brief_chat'` at every producer.
- `'task_chat'` (existing) is INTENTIONALLY DISTINCT from `'task_intake_chat'` per spec §6.1. The two are different surfaces (direct task chat vs the intake flow); they must never collapse.

**Error handling:** type-narrowing failure at compile time if a literal is missed (the new union does not include `'brief_chat'`); ESLint and `tsc` catch it.

**Test scope:**
- No new vitest tests in this chunk (literal-string sweep).
- Existing pure-helper tests with `'brief_chat'` fixtures are updated; run targeted: `npx vitest run <test-path>` for each touched test file.

**Dependencies:** Chunk 2 (`TaskUiContext` type defined), Chunk 3 (services renamed and importable).

**Acceptance criteria:**
- All server-side `'brief_chat'` literals updated.
- All server-side fixture `'brief_chat'` literals updated.
- `npm run typecheck` produces no `'brief_chat'` literal narrowing errors on the server side.
- Chunk-5 grep verification (recorded in `progress.md`): `git grep -n "'brief_chat'" server/` returns zero matches.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run` for each updated test file

---

### Chunk 6 — Client API + types + URL string sweep (~45 files)

**spec_sections:** §6.4, §8.3 (excluding the two NewBriefModal files — Chunk 7), §8.4 (client consumers).

**Files to create or modify (enumerated based on the client-side grep of "brief" — 45 files in the result):**

The architect enumerates the full 45-file list in `progress.md` immediately before Chunk 6 starts. Live grep command:
`git grep -lnE "brief" client/ | grep -v "client/src/components/layout/modals/NewBriefModal.tsx" | grep -v "client/src/components/review-queue/NewBriefModal.tsx"`

Categories of file (each file falls into one or more):
1. **URL string sweep** — every `/api/briefs/...` → `/api/task-intake/...`. Confirmed call sites:
   - `client/src/pages/OpenTaskView.tsx:42` (`/api/briefs/${taskId}`)
   - `client/src/pages/OpenTaskView.tsx:46` (`/api/briefs/${taskId}/operator-state`)
   - (No other client URL match for `/api/briefs` per current grep.)
2. **Type-import sweep** — `import { BriefCreationEnvelope, BriefUiContext, BriefScope, BriefCreatedResponse } from '...briefFastPath'` → `import { TaskCreationEnvelope, TaskUiContext, TaskScope, TaskCreatedResponse } from '...taskFastPath'`. Per the grep result, the type-import surface is small (mostly the modal files + a few hooks). Architect enumerates the exact set in `progress.md`.
3. **Discriminator-literal sweep** — `if (response.type === 'brief_created')` → `'task_created'`. Per grep, ~3 sites in client (`useConversation.ts`, `GlobalAskBar.tsx`, `InboxItemCard.tsx`).
4. **Field-name sweep** — `response.briefId` → `response.taskId`. Same handful of sites.
5. **Page / route / sidebar label sweep** — `client/src/config/sidebar.ts:139` mentions a "Workspace" label (per handoff.md mockup notes: should become "Tasks" — but verify against spec; spec does NOT explicitly require sidebar label change). Architect notes this in `progress.md` as a flagged item: per spec §6.4 only file/symbol renames are mandatory; label changes that match the mockup but aren't spec-required are deferred unless the operator confirms.
6. **`'brief_chat'` literal cleanup (client side residue from Chunk 5)** — covered by the type-narrowing change in Chunk 2; the only producer in the current grep is the modal (Chunk 7).

**Files NOT in scope for Chunk 6:**
- `client/src/components/layout/modals/NewBriefModal.tsx` — Chunk 7
- `client/src/components/review-queue/NewBriefModal.tsx` — Chunk 7
- Files where "brief" is intent.md/brief.md-style noun used in capability docs (`BriefingService`, `agentBriefingService`, etc.) — those are NOT in scope per spec §6.6 exemption list (architect confirms: these don't appear in the gate-1 pass-2 regex either).

**Chunk-6 size note:** ~45 files exceeds the 5-files-OR-1-responsibility chunk rule by file count. **Justification:** all 45 files are the single logical responsibility "sweep client-side brief references after server types resolve". The list is naturally bounded by the gate-1 pass-2 regex; splitting it further would create multiple chunks each of which leaves the client typecheck broken until the last one lands — net harm. Per the same precedent as Chunk 3, the 5-file rule yields to the 1-responsibility rule when the work cannot be split without breaking the build inside the chunk.

**Contracts:**
- All client consumers of `Task*` types import from `shared/types/taskFastPath.js`.
- All client-side fetch / axios calls to `/api/briefs/*` rewritten to `/api/task-intake/*`.
- Discriminator switches updated to `'task_created'`.
- Field accesses updated from `.briefId` to `.taskId`.

**Error handling:** typecheck catches missed imports; ESLint catches dead imports.

**Test scope:** existing client test files (`buildNavItems.test.ts`, `DeliveryChannels.test.ts`) are updated for any string-literal references they carry. No new vitest tests authored in this chunk.

**Dependencies:** Chunk 2 (types), Chunk 4 (`/api/task-intake` route exists), Chunk 5 (server-side surface scrubbed).

**Acceptance criteria:**
- All 45 files updated; full enumeration in `progress.md` before chunk commits.
- `npm run typecheck` passes for the client (server passed at end of Chunk 4; client passes at end of Chunk 6).
- `npm run build:client` passes.
- Chunk-6 grep verification (recorded in `progress.md`): `git grep -nE "\bBriefCreationEnvelope\b|\bBriefUiContext\b|\bBriefScope\b|\bBriefCreatedResponse\b|\bbriefId\b|/api/briefs\b" client/` returns zero matches OUTSIDE the two NewBriefModal files (which Chunk 7 handles).

**Verification commands (Chunk 6):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

---

### Chunk 7 — NewTaskModal implementation (both variants + 2 shared sub-components + 2 pure helpers)

**spec_sections:** §7.1 through §7.9, §8.3 (the NewBriefModal entries + new shared components), §13.1 (manual-gate copy review).

**Files to create or modify:**
- `client/src/components/layout/modals/NewBriefModal.tsx` → `client/src/components/layout/modals/NewTaskModal.tsx` (full rewrite per spec §7.1 layout variant)
- `client/src/components/review-queue/NewBriefModal.tsx` → `client/src/components/review-queue/NewTaskModal.tsx` (enriched per spec §7.1 review-queue variant)
- `client/src/components/task-modal/TaskAttachmentDropZone.tsx` (NEW shared component)
- `client/src/components/task-modal/TaskAttachmentDropZonePure.ts` (NEW pure helper — file-selection/upload-state state machine)
- `client/src/components/task-modal/TaskAgentPicker.tsx` (NEW shared component)
- `client/src/components/task-modal/TaskAgentPickerPure.ts` (NEW pure helper — default-selection logic)
- `client/src/components/Layout.tsx` (update `NewBriefModal` import to `NewTaskModal`)
- `client/src/pages/ReviewQueuePage.tsx` (update `NewBriefModal` import to `NewTaskModal`)

**Module shape:**
- *Public interface this chunk exposes:* `<NewTaskModal>` for both variants (props match the spec §7.1 contract per variant), `<TaskAttachmentDropZone>` and `<TaskAgentPicker>` as shared sub-components consumed by both modals, two pure helper modules for vitest.
- *What stays hidden:* progressive disclosure state (the "Advanced" expander), accessibility plumbing (drop-zone `role="button"`, `tabindex`, `aria-label`s, keyboard handlers), upload retry state machine, idempotency key generation, file-attachment lifecycle (Pending → In-flight → Succeeded/Failed → Retried/Removed), the `instructions` → `tasks.description` server mapping (server-side, hidden from the modal — modal just posts `instructions`), upload progress UI, the lifecycle notice copy verbatim per spec §7.4.

**Contracts:**

- Layout `<NewTaskModal>` props:
  ```typescript
  interface NewTaskModalProps {
    open: boolean;
    onClose(): void;
    identity: LayoutIdentity;
    orgs: OrgOption[];
    subaccounts: ClientOption[];
    onSubmitted(taskId: string, contextSwitch: { org?: OrgOption; subaccount?: ClientOption }): void;
  }
  ```
- Review-queue `<NewTaskModal>` props:
  ```typescript
  interface NewTaskModalProps {
    subaccountId: string;
    agents: SubaccountAgent[];
    onCreated: () => void;
    onClose: () => void;
  }
  ```
- `<TaskAttachmentDropZone>` props (network ownership made explicit per ChatGPT plan-review round 3 F8 — the component does NOT call `fetch` directly; the parent injects upload/delete callbacks):
  ```typescript
  interface TaskAttachmentDropZoneProps {
    taskId: string | null;          // null until task created; uploads queued in state
    /**
     * Parent-injected network callbacks. The component owns ONLY state and UI;
     * the parent owns the HTTP layer (POST /api/tasks/:id/attachments,
     * DELETE /api/attachments/:id). The component invokes these callbacks
     * at the appropriate state transitions and uses the returned promises
     * to drive the state machine.
     */
    uploadAttachment(args: {
      taskId: string;
      file: File;
      idempotencyKey: string;
      signal: AbortSignal;
    }): Promise<{ attachmentId: string; filename: string }>;
    deleteAttachment(args: { attachmentId: string }): Promise<void>;

    onAttachmentsChange?(state: AttachmentRowState[]): void;
    disabled?: boolean;
  }

  type AttachmentRowState =
    | { state: 'pending'; localId: string; file: File }
    | { state: 'uploading'; localId: string; file: File; idempotencyKey: string; controller: AbortController }
    | { state: 'succeeded'; localId: string; attachmentId: string; filename: string }
    | { state: 'failed_recoverable'; localId: string; file: File; idempotencyKey: string; error: string }
    | { state: 'failed_unrecoverable'; localId: string; filename: string; error: string }
    | { state: 'cancelled'; localId: string; filename: string };
  ```

  Implementation note: `taskId === null` means "task not yet created" — file picks queue in state without invoking `uploadAttachment`; once the parent receives the `TaskCreationEnvelope` (Submit-then-create flow), it passes the new `taskId` down and the queued files transition to `'uploading'`, at which point the component invokes the injected `uploadAttachment` callback. Submit-then-create flow (spec §7.4 lifecycle step 1–4) is the authoritative ordering.

  **Full transition table (added per ChatGPT plan-review round 3 F9 — closes the "all allowed transitions" gap):**

  | From → To | Trigger | Notes |
  |---|---|---|
  | (none) → `pending` | `addFiles()` | New row created with fresh `localId`. |
  | `pending` → `uploading` | parent passes non-null `taskId` (Submit then create) | `idempotencyKey` minted; `AbortController` created. Invokes `uploadAttachment`. |
  | `pending` → `cancelled` | operator removes a queued file before submit | Row stays in state for one render (so onAttachmentsChange fires) then garbage-collected by parent. |
  | `uploading` → `succeeded` | `uploadAttachment` promise resolves | Stores returned `attachmentId`, `filename`. |
  | `uploading` → `failed_recoverable` | `uploadAttachment` rejects with network error (5xx, timeout, offline) | `idempotencyKey` retained for retry. |
  | `uploading` → `failed_unrecoverable` | `uploadAttachment` rejects with 4xx (file too large, MIME blocked, auth) | No retry surfaced; Remove button only. |
  | `uploading` → `cancelled` | operator clicks Cancel during upload | `controller.abort()` invoked; row marked cancelled. |
  | `failed_recoverable` → `uploading` | operator clicks Retry | Same `idempotencyKey`; new `AbortController`. Invokes `uploadAttachment` again. |
  | `failed_recoverable` → `cancelled` | operator clicks Remove on a failed row | No server-side cleanup needed (upload never landed). |
  | `failed_unrecoverable` → `cancelled` | operator clicks Remove on a failed row | No server-side cleanup needed. |
  | `succeeded` → `cancelled` | operator clicks Remove after successful upload | Invokes `deleteAttachment({ attachmentId })`. Row removed from state on resolve; if delete fails, row stays in `succeeded` (parent surfaces a toast). |

  **Disallowed transitions (component MUST throw if attempted in `transitionRow`):**
  - `succeeded → pending`, `succeeded → uploading`, `succeeded → failed_*`
  - `cancelled → *` (terminal state)
  - `failed_unrecoverable → uploading` (no retry path for unrecoverable failures)
  - any transition where `localId` does not match an existing row — `transitionRow` returns the array unchanged (no-op) rather than throwing, so race conditions between fast state updates do not crash the modal.
- `<TaskAgentPicker>` props:
  ```typescript
  interface TaskAgentPickerProps {
    agents: SubaccountAgent[];
    variant: 'layout' | 'review-queue';
    value: string | null;            // null = "Unassigned"; string = agentId
    onChange(value: string | null): void;
  }
  ```
  Default selection logic (in `TaskAgentPickerPure.ts`):
  ```typescript
  function defaultAgentId(agents: SubaccountAgent[], variant: 'layout' | 'review-queue'): string | null {
    if (variant === 'layout') return null; // "Unassigned" per spec §7.3
    // review-queue: pick the top-level agent (no parent) — matches existing review-queue behaviour
    const topLevel = agents.find(a => !a.parentSubaccountAgentId);
    return topLevel?.agentId ?? agents[0]?.agentId ?? null;
  }
  ```
- `TaskAttachmentDropZonePure.ts` exports:
  - `addFiles(rows: AttachmentRowState[], files: File[]): AttachmentRowState[]` — appends Pending rows; assigns unique `localId`s.
  - `transitionRow(rows: AttachmentRowState[], localId: string, newState: AttachmentRowState): AttachmentRowState[]` — state-machine transition; rejects invalid transitions (e.g. `'succeeded'` → `'pending'`).
  - `summariseRows(rows: AttachmentRowState[]): { pending: number; uploading: number; succeeded: number; failed: number }` — for inline progress display.

**Error handling:**
- Title or Instructions empty: Submit button disabled (client-side gate). Server-side 400 is the belt-and-braces.
- Upload network failure: caught in upload handler, row transitions to `'failed_recoverable'` with `error` populated. The Retry button re-issues the same `idempotencyKey`.
- Upload server 4xx: row transitions to `'failed_unrecoverable'`; operator sees inline error and Remove button.
- Cancel during upload: `controller.abort()` called; row removed from state. Server-side partial-write reconciliation is NOT introduced (existing endpoint behaviour preserved — see spec §7.4 table).
- Task creation network failure: error surfaced inline at the modal level; no task created; pending attachments stay in state for retry.

**Test scope (vitest pure-helper tests, per `references/test-gate-policy.md`):**

- `client/src/components/task-modal/__tests__/TaskAttachmentDropZonePure.test.ts` — tests (expanded per ChatGPT plan-review round 3 F9 to cover the full transition table):
  - `addFiles` appends rows with unique `localId`s.
  - `addFiles` handles empty input array (no-op).
  - Allowed transitions:
    - `'pending'` → `'uploading'` succeeds.
    - `'pending'` → `'cancelled'` succeeds.
    - `'uploading'` → `'succeeded'` succeeds.
    - `'uploading'` → `'failed_recoverable'` succeeds.
    - `'uploading'` → `'failed_unrecoverable'` succeeds.
    - `'uploading'` → `'cancelled'` succeeds (operator cancel during upload).
    - `'failed_recoverable'` → `'uploading'` succeeds (operator retry).
    - `'failed_recoverable'` → `'cancelled'` succeeds.
    - `'failed_unrecoverable'` → `'cancelled'` succeeds.
    - `'succeeded'` → `'cancelled'` succeeds (operator removes uploaded attachment).
  - Disallowed transitions (must throw):
    - `'succeeded'` → `'pending'` throws (invalid transition).
    - `'succeeded'` → `'uploading'` throws.
    - `'succeeded'` → `'failed_recoverable'` throws.
    - `'cancelled'` → `'pending'` throws (terminal state).
    - `'failed_unrecoverable'` → `'uploading'` throws (no retry path).
  - `transitionRow` on unknown `localId` is a no-op (returns array unchanged).
  - `summariseRows` counts each state correctly (including `cancelled`).
- `client/src/components/task-modal/__tests__/TaskAgentPickerPure.test.ts` — tests:
  - `defaultAgentId('layout', ...)` returns `null`.
  - `defaultAgentId('review-queue', [topLevel, child])` returns the top-level agent.
  - `defaultAgentId('review-queue', [onlyChild])` returns the only agent.
  - `defaultAgentId('review-queue', [])` returns `null`.
  - Determinism: three different input orderings of the same agents yield the same chosen `agentId` (per §8.21 development-discipline rule).

**Dependencies:** Chunk 4 (`/api/task-intake` available, `description` required on subaccount-tasks), Chunk 6 (client types and URLs swept), Chunk 2 (`TaskCreationEnvelope`).

**Acceptance criteria:**
- Both `NewTaskModal.tsx` files exist; both `NewBriefModal.tsx` files deleted.
- Shared `TaskAttachmentDropZone.tsx`, `TaskAttachmentDropZonePure.ts`, `TaskAgentPicker.tsx`, `TaskAgentPickerPure.ts` exist under `client/src/components/task-modal/`.
- Both modals consume the shared sub-components (verified by `grep "TaskAttachmentDropZone" client/src/components/layout/modals/NewTaskModal.tsx client/src/components/review-queue/NewTaskModal.tsx` returning two hits).
- Layout modal renders Title, Instructions (required, min 1 char), Agent picker (default "Unassigned"), Attachment drop-zone, Advanced expander (collapsed by default) with Due Date, Priority, Subaccount override (conditional), Organisation override (conditional, system-admin only).
- Review-queue modal renders Title, Instructions (required), Agent picker (default top-level agent), Attachment drop-zone, Advanced expander with Due Date, Priority — Organisation/Subaccount overrides OMITTED (subaccount is path-bound).
- Submit button disabled until Title AND Instructions both `≥ 1` char.
- Drop-zone has `role="button"`, `tabindex="0"`, `aria-label` per spec §7.6; Browse fallback button always visible.
- Lifecycle notice copy is two sentences (per spec §7.4 framing) AND uses phrasing consistent with "attachments are context enrichment, not guaranteed execution context" (per spec §7.4). Exact copy to be reviewed by operator in PR description (manual gate per §13.1).
- All pure-helper tests pass when run with `npx vitest run <path>`.
- `Layout.tsx` and `ReviewQueuePage.tsx` import updates done.
- `npm run typecheck` and `npm run build:client` pass.

**Verification commands (Chunk 7):**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx vitest run client/src/components/task-modal/__tests__/TaskAttachmentDropZonePure.test.ts`
- `npx vitest run client/src/components/task-modal/__tests__/TaskAgentPickerPure.test.ts`

---

### Chunk 8 — CI gate authoring + PR-template manual gate requirements

**spec_sections:** §13 (test invariants 1, 3, 5, 7 — automated; 2, 4, 6, 8, 9 — manual), §13.1 (PR-template paste-in block).

**Files to create or modify:**
- `scripts/gates/verify-brief-rename.sh` (NEW — single script hosting all three grep passes per spec §13 and the handoff §Test invariants block)
- `.github/PULL_REQUEST_TEMPLATE.md` (UPDATE — add the spec §13.1 paste-in block as a standing section in the PR template, OR add a new template file `.github/PULL_REQUEST_TEMPLATE/new-task-modal-overhaul.md` if the repo prefers per-feature templates; architect picks the project convention — check existing `.github/` structure first)

**Contracts:**

- `scripts/gates/verify-brief-rename.sh`: executable bash script. Exit code 0 on clean; non-zero on any match. Three grep passes:
  1. **Pass 1 (snake_case + URL + service-file-path):**
     ```bash
     git grep -nE 'portal_briefs|/api/briefs|server/services/brief[A-Z]' -- \
       'server/**' 'client/**' 'shared/**' \
       ':(exclude)server/db/migrations/**' \
       ':(exclude)docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md' \
       ':(exclude)tasks/builds/brief-creation-unify/**'
     ```
  2. **Pass 2 (camelCase identifiers + types + import symbols):**
     ```bash
     git grep -nE '\bportalBriefs\b|\bBriefCreationEnvelope\b|\bBriefCreatedResponse\b|\bBriefUiContext\b|\bBriefScope\b|\bbriefId\b|\bBRIEFS_WRITE\b|brief_chat|briefCreationService|briefConversationService|briefConversationWriter|briefApprovalService|briefVisibilityService|briefArtefact[A-Za-z]+|briefDispatchRoutePure|briefMessageHandlerPure|briefSimpleReplyGeneratorPure' -- \
       'server/**' 'client/**' 'shared/**' \
       ':(exclude)server/db/migrations/**' \
       ':(exclude)docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md' \
       ':(exclude)tasks/builds/brief-creation-unify/**'
     ```
  3. **Pass 3 (`tasks.brief` column reads + compat adapters):**
     ```bash
     git grep -nE 'tasks\.brief\b|\.brief\b.*from\s+tasks|createTaskFromBrief|legacyBriefAdapter|briefCompatMapper' -- \
       'server/**' 'client/**' 'shared/**' \
       ':(exclude)server/db/migrations/**'
     ```
- The script must echo a clear FAIL/PASS line per pass and exit non-zero if any pass returns matches.
- The script follows the §5 gate-authoring rules: skip `import type` lines (pipe through `grep -v "import type"`), strip CRLF on Windows (`tr -d '\r'`), use Bash `set -euo pipefail`.
- Listed under `scripts/gates/` so the CI gate runner can pick it up automatically per the existing pattern.

- PR template additions (the §13.1 paste-in block verbatim, plus a top-of-block sentence): the architect adds the spec §13.1 ticklist verbatim. The PR opener for this build adds the same block to the PR description.

**Error handling:**
- Script fails fast on grep matches with a clear "FAIL: pass <N> found matches at the following lines" header.
- Script uses `set -euo pipefail` and `tr -d '\r'` per spec §5 gate-authoring rules.

**Test scope:** the script itself is shell — no vitest. Manual smoke test: run the script locally; verify it exits 0 on a clean branch and non-zero when an artificial violation is added.

**Dependencies:** Chunks 1–7 (the rename + payload widening + modal must all be in place before the gate's expected steady state is reached). Chunk 8 is the final "lock the door" step.

**Acceptance criteria:**
- `scripts/gates/verify-brief-rename.sh` exists, is executable (`chmod +x`), and exits 0 on the post-Chunk-7 tree.
- The script's three passes match the spec §13 command bodies verbatim (any deviation must be justified inline in the script header).
- PR template carries the §13.1 paste-in block.
- Smoke test: introduce a deliberate `BRIEFS_WRITE` reference in a scratch file; run the script; confirm it exits non-zero with a clear error. Remove the scratch reference before commit.

**Verification commands (Chunk 8):**
- `bash scripts/gates/verify-brief-rename.sh` (the script itself — this is permitted because it's a chunk-authored script under test, NOT a pre-existing whole-repo gate; the spec §13 invariants this script encodes are authored here)

---

### Chunk 9 — Test sweep

**spec_sections:** §8.5, §15.

**Files to create or modify (integration test renames):**
- `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts` → `taskIntakeArtefactsPagination.integration.test.ts` (file rename + internal symbol updates: route URLs, payload shapes, response field names)
- `server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts` (no rename — file name doesn't carry "brief" — but internal references swept: `briefId` → `taskId`, `BriefCreationEnvelope` → `TaskCreationEnvelope`, `BRIEFS_WRITE` → `TASKS_WRITE`)
- `server/routes/__tests__/sessionMessage.test.ts` (sweep: discriminator `'brief_created'` → `'task_created'`, field `briefId` → `taskId`)
- `client/src/components/__tests__/DeliveryChannels.test.ts` (verify — current grep flags it; sweep references if any)
- `client/src/config/__tests__/buildNavItems.test.ts` (verify — current grep flags it; sweep references if any)

**Files NOT in this chunk:**
- The 8 pure-helper test renames already happened in Chunk 3 (taskMessageHandlerPure.test.ts, etc.) — those move with their service files.
- The 2 new vitest tests authored in Chunk 7 (`TaskAttachmentDropZonePure.test.ts`, `TaskAgentPickerPure.test.ts`) are authored in Chunk 7.
- The 1 new vitest test for `parseDueDate` authored in Chunk 4 — authored in Chunk 4.

**Contracts:**
- Integration tests preserved per the existing testing posture (`docs/spec-context.md` `static_gates_primary`). They are not re-run locally per `references/test-gate-policy.md`. Their file names and internal references are kept consistent so CI does the right thing.

**Error handling:** none — refactor only.

**Test scope:** no new test logic. File-renamed integration tests are NOT run locally per the test-gate policy.

**Dependencies:** Chunks 1–7 (all source-side renames complete).

**Acceptance criteria:**
- The integration test file rename + internal symbol updates are complete.
- The two client test files have any `brief*` references swept.
- The gate-1 pass-2 regex in `scripts/gates/verify-brief-rename.sh` returns zero matches across `server/`, `client/`, `shared/` (verified by running the Chunk-8 script locally).

**Verification commands (Chunk 9):**
- `npm run lint`
- `npm run typecheck`
- `bash scripts/gates/verify-brief-rename.sh` (Chunk-authored — verifies the full sweep)

---

### Chunk 10 — Documentation sweep

**spec_sections:** §8.6.

**Files to create or modify:**
- `architecture.md` — sweep `brief` references in the task/brief domain sections; update route family listing (the `/api/briefs/*` section becomes `/api/task-intake/*`); add a one-line note that `BRIEFS_READ` is intentionally NOT renamed (per §1.1 of this plan).
- `docs/capabilities.md` — update capability row for `universal-brief` → `task-intake` per spec §8.6; rename cluster entry if applicable. Editorial Rules (vendor-neutral, marketing-ready) apply per `docs/capabilities.md § Editorial Rules`.
- `tasks/builds/brief-creation-unify/spec.md` — add `Status: superseded by 2026-05-18-new-task-modal-overhaul-spec.md` header. Do NOT delete the file (spec §6.6 exemption).
- `KNOWLEDGE.md` — append only if implementation surfaced a non-obvious pattern (e.g., the Migration F insert-update-delete cycle is a candidate KNOWLEDGE entry). Architect/coordinator decides on actual surfaced patterns during execution.

**Contracts:** documentation only; no code contracts.

**Error handling:** N/A.

**Test scope:** none.

**Dependencies:** Chunks 1–9 (all code-side renames complete).

**Acceptance criteria:**
- `architecture.md` reflects the new route family and the `BRIEFS_READ` retention note.
- `docs/capabilities.md` capability row updated.
- `brief-creation-unify` spec carries the superseded marker.
- `docs/doc-sync.md` checklist consulted; any entries touched have a matching doc update (per `CLAUDE.md` §11).

**Verification commands (Chunk 10):**
- `npm run lint` (markdown lint, if configured)
- Manual review of changed docs

---

## 6. Pre-Migration-E `tasks` insert-site audit (REQUIRED per spec §6.3)

Spec §6.3 makes this audit a mandatory plan-authoring deliverable: every code path that inserts into `tasks` must be enumerated with a verdict.

### 6.1 Enumeration method

`git grep -nE "insert.*\bschema\.tasks\b|insert\(tasks\)|\.insert\(.*\btasks\b" server/`. The architect ran a representative grep based on the files surfaced during file inventory; the coordinator re-runs this immediately before Chunk 4 commits and confirms the audit covers every result.

### 6.2 Enumerated insert sites

| Site | File | Already supplies `description`? | Verdict |
|---|---|---|---|
| Layout / task-intake creation | `server/services/taskCreationService.ts` (was `briefCreationService.ts`) | YES — writes user-supplied `text` (which becomes `instructions` after Chunk 4) into `description`. The route now requires `instructions` ≥ 1 char (Chunk 4). | OK (a) — covered by route-level validation. |
| Kanban task creation | `server/services/taskService.ts → createTask()` | After Chunk 4: YES (`description` required at route Zod). Existing callers update done in Chunk 4. | OK (a) — covered. |
| Orchestrator task spawn / sub-task creation | `server/services/agentExecutionService/*` (sub-task spawn pathways) | TO VERIFY — architect notes there is a sub-task spawn path; the coordinator runs the precise grep before Chunk 4 to confirm `description` is supplied. If any insert site does NOT supply a non-null description, **add explicit `description: ''` to the insert in Chunk 4 with a code comment naming the audit deliverable.** | NEEDS VERIFICATION at Chunk 4 commit; (c) fallback ready. |
| `skillExecutor/handlers/tasks.ts` — agents creating tasks for delegation | TO VERIFY — typically passes a description (the delegating prompt). | NEEDS VERIFICATION; (c) fallback ready. |
| `systemIncidentService.ts` — incidents escalating to a task | TO VERIFY — system-internal insert; typically supplies a descriptive payload. | NEEDS VERIFICATION; (c) fallback ready. |
| `scheduledTaskService.ts` — scheduled task → real task hydration | TO VERIFY — scheduled tasks store their own description; the runtime creation typically copies it forward. | NEEDS VERIFICATION; (c) fallback ready. |
| `deliveryService.ts` — delivery surfaces that may create tasks | TO VERIFY — surface depends on delivery channel. | NEEDS VERIFICATION; (c) fallback ready. |
| `githubWebhookService.ts` — webhook-driven task creation | TO VERIFY — webhook payload supplies a description in normal flow; absence flows through as null today. | NEEDS VERIFICATION; (c) fallback ready. |
| Seed scripts / migration-time inserts | `migrations/*.sql` — historical inserts | OK (c) — system-internal; treated as exempt; backfilled to `''` by Migration E itself. |
| Tests / fixtures | `server/services/__tests__/*` and others | OK (c) — fixtures explicitly supply OR are exempt as test scaffolding; Migration E's backfill UPDATE catches any test-time NULL state on integration DBs. |

**Audit completion gate (HARD BLOCKER per ChatGPT plan-review round 3 F17):** before Chunk 4 commits, the coordinator runs the precise `git grep` for every insert site (see Chunk 4 pre-Chunk-4 gate #3 above for the exact grep commands), expands the "TO VERIFY" rows above with concrete `file:line` citations, and either (a) confirms `description` is supplied, or (c) adds an explicit `description: ''` write in the same chunk. Migration E does NOT commit while any TO VERIFY row is unresolved. If a row cannot defensibly resolve to (a) or (c) — e.g., a third-party-driven flow whose semantics are unclear — the coordinator STOPS Chunk 4 and escalates to the operator. This is a hard blocker, not a soft target.

### 6.3 Default for system-internal inserts

Per spec §6.3 item (c), system-internal inserts that have no human-supplied description default to `description: ''` (empty string) explicitly. The empty string is exempt from the route-level min-1 invariant (spec §7.1 / §6.3); the route validation applies only to operator-facing inserts.

### 6.4 Recording

The completed audit lives in `progress.md` once the coordinator completes the verification grep. The version above (architect's plan-authoring pass) is the seed; the coordinator's expansion is the final answer.

---

## 7. Dependency graph and execution order

```
Chunk 1 (schema + migs A–C)
    │
    ├─→ Chunk 2 (shared types) ──┐
    │                            │
    └─→ Chunk 3 (services) ──────┼─→ Chunk 4 (route + migs D,E,F + perms)
                                 │       │
                                 │       ├─→ Chunk 5 (server brief_chat sweep)
                                 │       │       │
                                 └───────┴───────┴─→ Chunk 6 (client sweep)
                                                          │
                                                          └─→ Chunk 7 (NewTaskModal)
                                                                  │
                                                                  └─→ Chunk 8 (CI gate)
                                                                          │
                                                                          └─→ Chunk 9 (test sweep)
                                                                                  │
                                                                                  └─→ Chunk 10 (docs)
```

**Forward-only dependencies (no chunk depends on output of a later chunk):**
- Chunk 1 → Chunk 4 (Migration E depends on `tasks.brief` already dropped from Drizzle schema).
- Chunk 2 → Chunk 3 (services import the renamed types).
- Chunk 2 → Chunk 6 (client imports the renamed types).
- Chunk 3 → Chunk 4 (route imports the renamed services).
- Chunk 4 → Chunk 5 (server `'brief_chat'` literals live inside the renamed route file).
- Chunks 4 + 6 → Chunk 7 (modal calls the widened route AND uses the renamed client API/types).
- Chunks 1–7 → Chunk 8 (gate exit-0 requires the post-rename tree).
- Chunks 1–7 → Chunk 9 (test files reference the renamed surface).
- Chunks 1–9 → Chunk 10 (docs reflect the final state).

**Migration ordering inside chunks:** Migrations A–C are committed in Chunk 1 (file authoring); they run at deploy time in the migration runner's standard sequence. Migrations D, E, and F are committed in Chunk 4 (writer-cutover commit per F1/F2) and run at deploy time. Run order at deploy is enforced by the migration runner's filename-sequence numbering; the architect chooses numbers at merge time (per `DEVELOPMENT_GUIDELINES §6 item 2` — migration numbers are assigned at merge time, with `<NNNN>` as the placeholder during PR development). The deploy-time ordering MUST be A → B → C → D → E → F. Rationale: A–C are schema preconditions (table/column renames, dropped column) that the later migrations rely on; D updates row data that depends on the schema being in its post-rename shape; E's `NOT NULL` constraint depends on D's backfill of any rows that would otherwise violate it; F's permission-key rename ships last in the sequence because it pairs atomically with the code-side `ORG_PERMISSIONS.TASKS_WRITE` rename in the same deploy unit (single-PR deploy per spec §12 Chunk 4). Migrations and the new server binary deploy together as a single unit — the safety property is that the F SQL and the renamed code constant land in the same release, not any runtime interleaving of migration-vs-binary readiness. (The migration runner executes the full migration sequence to completion before the new binary begins serving traffic; the binary is not "live before F" — it is the new binary that starts serving after F runs.)

**Mid-PR un-buildable windows:**
- End of Chunk 1: typecheck broken (services and routes still import the old `portalBriefs` and the to-be-deleted `tasks.brief`).
- End of Chunk 2: typecheck broken (consumers still import the renamed types under old names).
- End of Chunk 3: typecheck broken (only `server/routes/briefs.ts` and client side remain).
- End of Chunk 4: server-side typecheck PASSES; client-side still broken (Chunk 6 not yet done).
- End of Chunk 5: same as Chunk 4.
- End of Chunk 6: typecheck PASSES end-to-end (client + server).
- End of Chunk 7: typecheck PASSES; build:client passes; both modals fully built.
- End of Chunks 8–10: PASSES + gate script PASSES.

This is the explicit single-PR un-buildable window. It is the intended state per spec §12; CI runs the full test gate AFTER the PR opens, so the mid-PR commits do not generate false CI failures (only the final PR head is gated).

---

## 8. Self-consistency pass

- **Goals ↔ Implementation.** Spec Goal 1 (one vocabulary) is covered by Chunks 1, 3, 4, 5, 6, 8 (rename and gate). Goal 2 (one creation surface) is covered by Chunk 7 (enriched modals + shared sub-components). Goal 3 (one canonical model) is covered by spec §5 (no model change required) and Chunk 1 (`portal_briefs` → `portal_cards` rename to remove confusion). Goal 4 (unblock operator-confidence-layer) is achieved by Goal-1+2+3 completion; this plan does not block operator-confidence-layer further.
- **Numeric reconciliation.** 13 service files renamed in Chunk 3 = spec §6.2 table count ✓. 5 + 1 = 6 migrations (A–E + conditional F): conditional path (b) confirmed, so 6 migrations ✓. Plan-side count update applied throughout. ~45 client files swept in Chunk 6 = spec §6.4 estimate ✓ (coordinator enumerates exactly during execution). 2 new shared components in Chunk 7 = spec §7.9 ✓. 2 new pure helper test files (`TaskAttachmentDropZonePure.test.ts` + `TaskAgentPickerPure.test.ts`) + 1 new helper test (`datesPure.test.ts` in Chunk 4) = 3 new test files in scope. PR-checklist requirements wired in Chunk 8 ✓.
- **Single-source-of-truth claims.** `tasks` is the canonical operator-task model — verified. `taskCreationService.createTaskIntake` and `taskService.createTask` are kept distinct per spec §6.2 "no merge" decision — the function-name disambiguation (`createTaskIntake` at source per F12) closes the prior ambiguity. `description` is the storage field for "Instructions" — verified; column rename deferred per spec §7.2.
- **RLS / permission story.** No new tenant tables. `portal_cards` keeps its existing RLS policies (Postgres preserves them on `ALTER TABLE RENAME`). Permission storage resolved as path (b); Migration F authored. `BRIEFS_READ` intentionally retained — noted.
- **Pre-Chunk-4 gates.** All three are wired as pre-Chunk-4 gates: (i) OQ1 resolved during plan authoring to path (b) with Migration F (plan-authored, no coordinator runtime work); (ii) coordinator runs the four-check external-consumer verification before Chunk 4 starts, with the operator-coordinated checks (c, d) escalated per spec §6.1; (iii) §6 insert-site audit (HARD BLOCKER per F17) — coordinator MUST resolve every TO VERIFY row to (a) or (c) with live `file:line` citations before Migration E commits, with explicit `git grep` commands recorded in Chunk 4 pre-Chunk-4 gate #3; if any row cannot defensibly resolve, STOP and escalate.
- **Test invariants.** Spec §13 1, 3, 5, 7 (automated) and 2, 4, 6, 8, 9 (manual) all wired: automated gates land in Chunk 8's `scripts/gates/verify-brief-rename.sh`; manual gates land in the PR template via the §13.1 paste-in block, also Chunk 8.
- **Deferred items.** Spec §14 entries (blocking attachment gating, `tasks.description` schema rename, brief-creation-unify F5–F8/F15, Migration D production-rollback variant, `'brief'` enum value removal) are NOT touched by this plan — confirmed.
- **Editor-side risks.** Three-similar-lines rule honoured: extract `TaskAttachmentDropZone` and `TaskAgentPicker` immediately because both modals need them (intent.md Q7). No drive-by cleanup beyond the named scope. `BRIEFS_READ` left untouched per spec; surfaced in docs (Chunk 10).
- **Capability registration.** Per `CLAUDE.md § Build lifecycle`, Capability Registration runs in Phase 3 (finalisation-coordinator Step 6). Not a Chunk-here action; flagged as a downstream finalisation responsibility.

---

## 9. Open items requiring operator input

All pre-Chunk-4 gates have been resolved at plan-authoring or have a clear coordinator-run procedure. No operator input is required before execution starts.

If during Chunk 4 the external-consumer check (a) or (b) returns non-empty, the coordinator escalates per spec §6.1 before committing.

If during the §6 insert-site audit (now a HARD BLOCKER per F17 — see Chunk 4 pre-Chunk-4 gate #3) any TO VERIFY row resolves to (c) — code-side insert that doesn't supply `description` — the coordinator adds the explicit `description: ''` in Chunk 4 (no operator escalation). If a row cannot defensibly resolve to (a) or (c) — e.g., a third-party-driven flow whose semantics are unclear — the coordinator STOPS Chunk 4 and escalates.
