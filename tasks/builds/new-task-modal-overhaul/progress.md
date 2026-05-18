# Progress — new-task-modal-overhaul

## Phase 1 status

| Step | Status | Notes |
|------|--------|-------|
| S0 branch sync | COMPLETE | 0 commits behind main; no merge needed |
| Intent intake | COMPLETE | intent.md authored |
| Duplication / Strategy Check | COMPLETE | clear / clear / proceed |
| Grill-me Q&A | COMPLETE | 9 rounds; all open questions resolved |
| Build slug derivation | COMPLETE | `new-task-modal-overhaul` (pre-existing directory) |
| Mockup loop | COMPLETE | 3 rounds CLEAN via mockup-coordinator (prior session) |
| Spec authoring | COMPLETE | docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md |
| spec-reviewer | COMPLETE | READY_FOR_BUILD — 3 iterations, 72 mechanical fixes, 3 directional → tasks/todo.md |
| chatgpt-spec-review | COMPLETE | APPROVED — 3 rounds (12+5+0 findings) — 9bb07d01 |
| Handoff write | COMPLETE | tasks/builds/new-task-modal-overhaul/handoff.md |
| current-focus.md → BUILDING | COMPLETE | |

## Grill-me decisions (2026-05-18)

1. Route topology: rename `/api/briefs` to standalone path `/api/task-intake`; separate from kanban task route
2. Instructions field storage: UI-only relabel of `description` column; no schema rename in this build
3. Attachment gating: advisory — execution starts immediately; attachments resolve in parallel
4. `portalBriefs` rename: → `portalCards`
5. External API consumers: none; hard cutover
6. Instructions required: YES — required at creation; Create Task disabled until filled; server rejects without it
7. Component structure: two separate `NewTaskModal` components; shared sub-components extracted
8. Review-queue enrichment: full field set on both variants (Instructions, agent picker, attachments, due date)
9. `brief` column on `tasks` table: drop in migration; verify no live reads first

## REVIEW_GAP log

REVIEW_GAP: spec-conformance | task-class: Significant | reason: operator force-path — dev complete, branch-level review skipped | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
REVIEW_GAP: adversarial-reviewer | task-class: Significant | reason: operator force-path — dev complete, branch-level review skipped | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
REVIEW_GAP: pr-reviewer | task-class: Significant | reason: operator force-path — dev complete, branch-level review skipped | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
REVIEW_GAP: reality-checker | task-class: Significant | reason: operator force-path — dev complete, branch-level review skipped | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
REVIEW_GAP: dual-reviewer | task-class: Significant | reason: operator force-path — dev complete, branch-level review skipped | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion

## Phase 2 status

| Step | Status | Notes |
|------|--------|-------|
| Phase 1 close commit | COMPLETE | 8f6ea0f8 — intent + handoff + progress + current-focus → BUILDING |
| S1 branch sync | COMPLETE | merged origin/main (2 commits — framework submodule bump + bump-framework-submodule workflow); 'ort' strategy clean |
| Post-merge typecheck | PASS | clean |
| Migration-collision check | PASS | branch has no migrations yet |
| Overlapping-files guard | PASS | overlap = artefact-only (current-focus.md, todo.md, _index.jsonl); no code-area overlap; operator confirmed `continue` |
| architect invocation | COMPLETE | 10 chunks, 6 migrations (A,B,C in Chunk 1; D,E,F in Chunk 4 per chatgpt-plan-review Round 1); OQ1 resolved path (b) DB-persisted |
| chatgpt-plan-review (MANUAL) | COMPLETE | 3 rounds, APPROVED; 16 technical fixes auto-applied; 4 operator-approved escalations; 0 deferred. Log: tasks/review-logs/chatgpt-plan-review-new-task-modal-overhaul-2026-05-18T05-15-08Z.md |
| plan-gate | COMPLETE | operator approved, execution started |
| Chunk 1 — Schema migrations A-C + portal-cards | COMPLETE | migrations 0370-0372; portalCards rename; RLS gate fix |
| Chunk 2 — Shared types rename | COMPLETE | briefFastPath → taskFastPath; TaskCreationEnvelope, TaskUiContext, etc. |
| Chunk 3 — Server service rename (13 files) | COMPLETE | 13 services + 8 test files + consumer sweep; createTaskIntake (not createTask) |
| Chunk 4 — Route rename + Migrations D/E/F + perms | COMPLETE | /api/task-intake; TASKS_WRITE; parseDueDate; scope_type cutover |
| Chunk 5 — brief_chat sweep | COMPLETE | already clean after Chunk 4; no additional changes |
| Chunk 6 — Client API + URL sweep | COMPLETE | URL, types, discriminators, field names swept |
| Chunk 7 — NewTaskModal implementation | COMPLETE | both variants; TaskAttachmentDropZone; TaskAgentPicker; 37/37 tests |
| Chunk 8 — CI gate + PR template | COMPLETE | scripts/gates/verify-brief-rename.sh exits 0; PR template updated |
| Chunk 9 — Test sweep | COMPLETE | briefsArtefactsPagination → taskIntakeArtefactsPagination; symbol sweep |
| Chunk 10 — Documentation sweep | COMPLETE | architecture.md, capabilities.md, KNOWLEDGE.md (Migration F pattern) |

## Pre-Chunk-4 gates
- OQ1 (permission storage): resolved path (b) DB-persisted; Migration F shipped
- External-consumer verification: no external consumers found
- Insert-site audit: completed; all TO VERIFY rows resolved; Migration E safe

## Deferred items (per spec §14)
- `conversations.scope_type 'brief'` enum value removal: deferred — DB enum still includes 'brief'; removal is a follow-up migration
- `ORG_PERMISSIONS.BRIEFS_READ` rename: intentionally out of scope per spec §10
- `onOpenNewBrief`/`showNewBrief` in Layout.tsx/sidebar.ts: minor follow-up cleanup
- `brief-artefacts/` client component directory paths: not renamed in this build (spec scope was task-intake routes + modals)

## LEARNING_FEEDBACK_PROPOSAL

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| During S2 sync, when main brings in a migration with the same number as a branch migration, git rm the old file and keep the renumbered one — document the collision in the merge commit | `agent-instruction` (feature-coordinator) | Prevents duplicate-migration runtime failures that slip past local checks | pending |
| GET routes must use the read permission even when the feature's only write permission key is the obvious choice — pr-reviewer should flag any GET handler using a *_WRITE permission | `agent-instruction` (pr-reviewer) | Read-only users get locked out of viewing data when GETs gate on write permission | pending |
| The `title` field must be explicitly wired through route body destructuring AND service input type; deriving title from instructions silently discards user input — pr-reviewer should check create-style routes send title through end-to-end | `agent-instruction` (pr-reviewer) | Silent data loss; user-entered titles replaced by truncated instructions | pending |

## Final verification (2026-05-18)
- lint: 0 errors (873 pre-existing warnings)
- typecheck: clean pass
- pure-helper tests: 37/37 passing
- verify-brief-rename.sh: PASSED (all 3 passes clean)
- build:client: passing
- build:server: passing

## Mockup paths (final — Round 3 CLEAN)

- `prototypes/new-task-modal-overhaul/index.html`
- `prototypes/new-task-modal-overhaul/01-default-state.html`
- `prototypes/new-task-modal-overhaul/02-with-attachments.html`
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html`
- `prototypes/new-task-modal-overhaul/_shared.css`
