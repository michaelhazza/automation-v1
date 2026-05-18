# Handoff — new-task-modal-overhaul

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md
**Branch:** builds/new-task-modal-overhaul
**Build slug:** new-task-modal-overhaul
**UI-touching:** yes
**Mockup paths:**
- prototypes/new-task-modal-overhaul/index.html
- prototypes/new-task-modal-overhaul/01-default-state.html
- prototypes/new-task-modal-overhaul/02-with-attachments.html
- prototypes/new-task-modal-overhaul/03-advanced-expanded.html
- prototypes/new-task-modal-overhaul/_shared.css

**Spec-reviewer iterations used:** 3 / 5 (exited on two-consecutive-mechanical-only condition)
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-new-task-modal-overhaul-2026-05-18T03-41-57Z.md
**ChatGPT spec review verdict:** APPROVED after 3 rounds (12 + 5 + 0 findings)
**PR for spec:** [#352](https://github.com/michaelhazza/automation-v1/pull/352)

## Open questions for Phase 2

- **OQ1 (pre-Chunk-4 BLOCKER) — Permission key DB storage.** Is `ORG_PERMISSIONS.BRIEFS_WRITE` stored as a string in a `permissions` or `role_permissions` table, or is it code-only (enum key)? Architect resolves at plan authoring. If DB-persisted, Migration F (`UPDATE permissions SET key = 'TASKS_WRITE' WHERE key = 'BRIEFS_WRITE'`) ships in Chunk 4 alongside the route rename. If code-only, no Migration F. Failure to resolve before Chunk 4 risks a user-facing access regression at cutover. See spec §18 OQ1, §6.1, §12 Chunk 4.

- **Pre-Chunk-4 verification gate — External consumers of `/api/briefs`.** The spec assumes no external consumers; verification is mandatory before Chunk 4 commits. The architect runs four checks: (a) repo grep for `/api/briefs` in docs and tasks, (b) Postman/OpenAPI collection scan, (c) 30-day route telemetry / access log query for non-internal callers, (d) partner integration docs scan. Any non-empty result escalates to operator before proceeding. See spec §6.1.

- **`pr-reviewer` PR checklist needs an "operator-facing copy review" item** that protects the §7.4 advisory-attachment framing from drift. The checklist text is specified in spec §13.1. Architect ensures this lands in Chunk 8 or 9.

## Decisions made in Phase 1

The following design decisions were locked during grill-me (intent.md §Grill-me Q&A) and applied across the spec:

- **Q1 — Route topology:** `/api/briefs` is renamed to standalone path `/api/task-intake`. Not merged into `POST /api/subaccounts/:id/tasks`. Different return shapes and side effects.
- **Q2 — Instructions field data contract:** UI-only relabel of existing `tasks.description` column. No schema rename in this build. The data-side rename `description` → `instructions` is deferred to a future build.
- **Q3 — Attachment gating posture:** advisory. Task execution starts immediately when conditions are met; attachments resolve in parallel. No new task lifecycle status is introduced. Operator-facing framing: "attachments are context enrichment, not guaranteed execution context."
- **Q4 — `portalBriefs` table rename:** renamed to `portalCards`. Pure rename migration (Migration A).
- **Q5 — External API consumers:** assumed none; hard cutover declared. Verification gate added pre-Chunk-4 (per ChatGPT Round 1 F2).
- **Q6 — Instructions required:** operator-mandated change from current optional `description`. Instructions is required client-side (Create Task disabled until filled) and server-side (rejected with 400 if absent or empty). Migration E enforces `tasks.description NOT NULL` at the schema level after backfilling NULL rows to empty string. Legacy rows are exempt from the min-1 semantic invariant.
- **Q7 — Two separate `NewTaskModal` components:** layout variant calls `POST /api/task-intake` (triage path); review-queue variant calls `POST /api/subaccounts/:id/tasks` (kanban path). Shared sub-components (`TaskAttachmentDropZone`, `TaskAgentPicker`) extracted.
- **Q8 — Review-queue modal enrichment:** full field set on both variants — same operator capability across both surfaces. Review-queue variant omits Organisation/Subaccount overrides (subaccount is path-bound on the endpoint).
- **Q9 — `tasks.brief` column:** dropped in Migration C after code-level grep verification.

## Test invariants from Phase 1 (architect must wire in Chunk 8)

Three CI-scriptable gates, one PR-checklist item:

1. **`scripts/gates/verify-brief-rename.sh`** — single script hosting three grep checks: (a) `portal_briefs` / `/api/briefs` absent from `server/`, `client/`, `shared/`; (b) no `tasks.brief` column reads; (c) no compatibility adapters (`createTaskFromBrief`, `legacyBriefAdapter`, `briefCompatMapper`).
2. **PR template / pr-reviewer checklist** — operator-facing copy review for the §7.4 attachment lifecycle notice; semantic rename review; accessibility smoke test; stable identifier preservation.

## Deferred items routed to tasks/todo.md

Three directional items from spec-reviewer iteration 1 (NTMO-D1/D2/D3 — all about whether to inline per-file enumeration in the spec or defer to the plan; convention is to defer, applied accordingly). See `tasks/todo.md § Deferred spec decisions — new-task-modal-overhaul`.

## Mockup notes for Phase 2

- Nav bar active link label "Workspace" → "Tasks" in the real implementation (matches `sidebar.ts:139`)
- "What happens if an upload fails?" tooltip trigger: use `<button type="button">` styled as link, not bare `<a>`
- `index.html` round label says "Round 1" — update to "Round 3" or remove

These are implementation details, not mockup blockers.

## Phase 3 (FINALISATION) — complete

**PR number:** #352
**chatgpt-pr-review log:** tasks/review-logs/chatgpt-pr-review-new-task-modal-overhaul-2026-05-18T09-10-23Z.md
**spec_deviations reviewed:** n/a
**Doc-sync sweep verdicts:**
- architecture.md: no — all rename terms absent; Task Intake section already correct
- capabilities.md: yes: update existing capability record (PR #352 back-pointer corrected)
- integration-reference.md: no — internal rename, no OAuth/MCP/slug change
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md: no — no convention changes
- CONTRIBUTING.md: n/a
- frontend-design-principles.md: no — no new UI pattern
- KNOWLEDGE.md: yes (3 entries added)
- docs/decisions/: n/a
- docs/context-packs/: no — no anchor changes
- references/test-gate-policy.md: no — posture unchanged
- references/spec-review-directional-signals.md: n/a
- docs/incident-response.md: n/a
- docs/testing-transition-plan.md: n/a
- .claude/CHANGELOG.md: n/a
- scripts/verify-*: n/a — new gate addition, not posture change
**KNOWLEDGE.md entries added:** 3
**tasks/todo.md items removed:** 3 (NTMO-D1/D2/D3)
**ready-to-merge label applied at:** 2026-05-18T09:46:03Z

## Phase 2 (BUILD) — complete

**Branch:** builds/new-task-modal-overhaul
**PR:** [#352](https://github.com/michaelhazza/automation-v1/pull/352)
**Phase 2 closed:** 2026-05-18T09:01:25Z (operator force-path)

**Chunks completed:** 10 / 10

| Chunk | Description | Status |
|-------|-------------|--------|
| Chunk 1 | Schema migrations A–C + portalCards rename | COMPLETE |
| Chunk 2 | Shared types rename (briefFastPath → taskFastPath, etc.) | COMPLETE |
| Chunk 3 | Server service rename (13 files + 8 test files) | COMPLETE |
| Chunk 4 | Route rename + Migrations D/E/F + permissions (TASKS_WRITE) | COMPLETE |
| Chunk 5 | brief_chat sweep (clean after Chunk 4) | COMPLETE |
| Chunk 6 | Client API + URL sweep | COMPLETE |
| Chunk 7 | NewTaskModal implementation (both variants + shared sub-components) | COMPLETE |
| Chunk 8 | CI gate (verify-brief-rename.sh) + PR template | COMPLETE |
| Chunk 9 | Test sweep (symbol renames) | COMPLETE |
| Chunk 10 | Documentation sweep (architecture.md, capabilities.md, KNOWLEDGE.md) | COMPLETE |

**Final verification:**
- lint: 0 errors (873 pre-existing warnings)
- typecheck: clean
- pure-helper tests: 37/37 passing
- verify-brief-rename.sh: PASSED (all 3 passes clean)
- build:client: PASS
- build:server: PASS

**REVIEW_GAP entries (operator force-path — all Phase 2 reviewers skipped):**
- REVIEW_GAP: spec-conformance | task-class: Significant | reason: operator force-path | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
- REVIEW_GAP: adversarial-reviewer | task-class: Significant | reason: operator force-path | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
- REVIEW_GAP: pr-reviewer | task-class: Significant | reason: operator force-path | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
- REVIEW_GAP: reality-checker | task-class: Significant | reason: operator force-path | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion
- REVIEW_GAP: dual-reviewer | task-class: Significant | reason: operator force-path | operator-override: yes-2026-05-18T09:01:25Z | remediation: chatgpt-pr-review (Phase 3) serves as primary second-opinion

**spec_deviations:** none recorded

**Open issues for finalisation:** none — all spec items implemented; deferred items per spec §14 captured in progress.md § Deferred items.

## Phase 1 audit trail

- Spec final state: `docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md` (Status: accepted)
- Intent: `tasks/builds/new-task-modal-overhaul/intent.md`
- Brief: `tasks/builds/new-task-modal-overhaul/brief.md` (FINAL v3)
- Mockup log: `tasks/builds/new-task-modal-overhaul/mockup-log.md` (status: complete, 3 rounds CLEAN)
- Mockup review logs: 3 files dated 2026-05-18T01-44-37Z
- spec-reviewer final report: `tasks/review-logs/spec-review-final-new-task-modal-overhaul-2026-05-18T03-37-49Z.md`
- chatgpt-spec-review log: `tasks/review-logs/chatgpt-spec-review-new-task-modal-overhaul-2026-05-18T03-41-57Z.md`
- Progress: `tasks/builds/new-task-modal-overhaul/progress.md`
