# Wave 5 Session K — Progress

**Slug:** wave-5-cleanup-and-ci-consolidation
**Branch:** claude/wave-5-cleanup-and-ci-consolidation
**PR:** #336 — https://github.com/michaelhazza/automation-v1/pull/336
**Class:** Standard (light-pipeline, no formal Phase 1/2 coordinator)

---

## Phase 3 — Finalisation

**S2 sync:** 1 commit behind main at finalisation (8c51aa65 — wave-5 capabilities backfill). Merged cleanly, no conflicts.
**G4 guard:** PASS — 0 lint errors, typecheck clean.
**chatgpt-pr-review:** 2 rounds. F2 (shell fix) auto-applied. F1 (workspace-actor-coverage gate loss) deferred to tasks/todo.md.
**Doc-sync sweep:**
- `architecture.md`: yes (§ CI integration — grep_invariants → lint_and_typecheck)
- `docs/capabilities.md`: n/a: build / tooling change only
- `docs/integration-reference.md`: no — checked assign_task, notify_operator, crm/*, cross_owner/*; all internal stubs; no integration behaviour changed
- `CLAUDE.md / DEVELOPMENT_GUIDELINES.md`: no — checked grep_invariants, workspace-actor-coverage, Portable framework tests; zero stale references
- `CONTRIBUTING.md`: no — no lint-suppression policy changes
- `docs/frontend-design-principles.md`: n/a — no UI changes
- `KNOWLEDGE.md`: yes (3 entries — CI enforcement-surface shrink; grep -c || echo 0 gotcha; definePruneJob RETURNING id composite-key bug)
- `docs/spec-context.md`: n/a — spec-review session only
- `docs/decisions/`: n/a — no durable architectural choice warranting an ADR
- `docs/context-packs/`: no — architecture.md section anchor § CI integration unchanged; no anchor changes
- `references/test-gate-policy.md`: no — checked grep_invariants, workspace-actor-coverage, Portable framework; zero stale references; gate posture (forbidden/allowed commands) unchanged
- `references/spec-review-directional-signals.md`: n/a — no spec review signals
- `docs/incident-response.md`: n/a — no SEV matrix changes
- `docs/testing-transition-plan.md`: n/a — no testing migration sequencing changes
- `scripts/verify-*` / `.claude/FRAMEWORK_VERSION`: n/a — no gates added/removed; no framework-level changes

**KNOWLEDGE.md entries added:** 3
**tasks/todo.md items closed:** to be verified in Step 8

---

## LEARNING_FEEDBACK_PROPOSAL

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| CI consolidation can silently retire enforcement-surface by inheriting the absorbing job's `if:` conditional — spec must pin both trigger events AND conditional gates for every CI gate it names | `finalisation-coordinator` | Add a doc-sync step: when a workflow file is deleted, verify each absorbed `run:` block still fires on `push: [main]` + unconditional `pull_request` | pending |
| `grep -c PATTERN FILE \|\| echo 0` concatenates two zeros — endemic in scripts/verify-*.sh and scripts/gates/*.sh | `hook-or-grep-gate` | Add a static gate that scans shell scripts for `\|\| echo 0` after a counting command (grep -c, wc -l) and fails with remediation hint | pending |
| `definePruneJob` factory `RETURNING id` is a categorical runtime failure on composite-key tables (no surrogate id) — any migration to the factory must verify the target table schema first | `regression-test` | Add a Vitest test in definePruneJob.test.ts that runs the factory against a mock table without an id column and asserts it returns the correct row count (not throws) | pending |
| Two pg-boss queue names use underscore convention (`refresh_optimiser_peer_medians`, `refresh_memory_utility_30d`) — these are documented exceptions, not bugs | `no-further-action` | Already documented in KNOWLEDGE.md; no further propagation needed | pending |

---

## REVIEW_GAP entries

REVIEW_GAP: chatgpt-pr-review F1 (workspace-actor-coverage gate) | task-class: Standard | reason: deferred by operator — user said "nothing else, lock this" | operator-override: yes-2026-05-16T13:00:00Z | remediation: tasks/todo.md item added — restore dedicated verify-workspace-actor-coverage enforcement on push:[main] + every PR
