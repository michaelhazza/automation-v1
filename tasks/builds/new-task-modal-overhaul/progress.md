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

*(none yet)*

## Mockup paths (final — Round 3 CLEAN)

- `prototypes/new-task-modal-overhaul/index.html`
- `prototypes/new-task-modal-overhaul/01-default-state.html`
- `prototypes/new-task-modal-overhaul/02-with-attachments.html`
- `prototypes/new-task-modal-overhaul/03-advanced-expanded.html`
- `prototypes/new-task-modal-overhaul/_shared.css`
