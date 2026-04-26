# Pre-Launch Hardening Specs — Progress

**Branch:** `spec/pre-launch-hardening`
**Plan:** `tasks/builds/pre-launch-hardening-specs/plan.md`
**Invariants:** `docs/pre-launch-hardening-invariants.md` (created in Task 0.6)
**Started:** 2026-04-26T09:44:53Z

## Implementation Order (MANDATORY — DO NOT REORDER)

```
1 → {2, 4, 6} → 5 → 3
```

Blocking rules — engineers picking up the implementation branches MUST honour all four:

- **Chunk 1 must land before ANY data-access changes.** RLS posture is the prerequisite for every other chunk; a code branch that touches tenant tables before Chunk 1 is merged risks silently fail-open queries.
- **Chunk 2 must land before any code touching `agent_runs`, schema renames (W1-6 / W1-29), or skill error envelope (C4a-6-RETSHAPE).** Schema decisions are ground-truth for Chunks 3 and 5.
- **Chunks 4 and 6 may run in parallel with 2.** They have no schema dependency.
- **Chunk 3 is last.** Dead-path completion depends on RLS (Chunk 1), schema decisions (Chunk 2), and execution correctness (Chunk 5) being stable.

PR order ≠ implementation order. Do **not** infer dependency ordering from PR merge order. The dependency graph above is authoritative.

## Pinned SHAs

- **Invariants pinned at:** `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2` (commit `cf2ecbd0`, 2026-04-26 — v3 with Manual-enforcement owners + 6.3 cancelled/skipped semantics + amendment SHA re-pin protocol; supersedes `31e94d34` → `a00506b0`)
- Schema-decisions architect SHA: _(captured in Task 2.1 Step 3)_
- Dead-path-completion architect SHA: _(captured in Task 3.1 Step 3)_

## Workflow deviations from plan.md

**Authorised by user 2026-04-26 mid-Task-1:**

- **`spec-reviewer` agent is SKIPPED for every chunk in this sprint.** Plan.md §3 + every chunk task's Step 4 references `spec-reviewer`; those steps are bypassed. Each spec ships without the iterative reviewer pass. The user adjudicates spec quality directly when they review.
- **Review-cadence checkpoints are SKIPPED.** Plan.md §15 lists 7 checkpoint stops; the session runs straight through to Task 7 without pausing. Stop conditions still apply (anything that genuinely blocks → escalate), but normal review pauses are removed.
- **Per-chunk verification (Q2 default) is RETAINED.** Each chunk's cited items are verified against present `tasks/todo.md` + repo state before drafting, to avoid the same scope-mismatch caught on Chunk 1.

Effect on `## Status` below: spec-reviewer entries are not separately listed.

## Architect-output conflict check

_(stamped after §10b clears — pre-Task 2/3 gate)_

## Spec Freeze

_(stamped in Task 6.5 once all 6 specs are merged + Open Decisions resolved + Review Residuals clean)_

## Cross-Spec Consistency Sweep

_(stamped in Task 6.6 once cross-spec naming, contracts, primitives, and assumptions all align)_

## Coverage Baseline (SC-COVERAGE-BASELINE — captured 2026-04-26)

Per Chunk 6 spec § 2.2 SC-COVERAGE-BASELINE. Live counts captured before any pre-launch chunk PRs land. Future PRs touching input-validation or permission-scope must cite the baseline + delta in their PR body.

| Gate | Baseline (2026-04-26) |
|---|---|
| `verify-input-validation.sh` | **44 violations** (warning) |
| `verify-permission-scope.sh` | **13 violations** (warning) |

Source: live runs of `bash scripts/verify-input-validation.sh` and `bash scripts/verify-permission-scope.sh` against `spec/pre-launch-hardening` HEAD prior to Chunk 6 PR open.

## Status

- [x] Task 0    Branch setup
- [x] Task 0.5  Mini-spec on branch — no-op (PR #203 already merged to main, mini-spec inherited at branch creation; verified byte-identical to source SHA 1023ff02)
- [x] Task 0.6  Cross-chunk invariants doc — committed at 31e94d34 (v2 supersedes a00506b0), all 5 done-criteria pass (6 sections, 36 invariants, typed enforcement (Gate/Test/Static/Manual), State/Lifecycle category added, Invariant Violation Protocol explicit, Amendments section present)
- [x] Task 1    Chunk 1 — RLS Hardening Sweep — PR #204 open
- [ ] Task 2.1  Architect input — Chunk 2
- [ ] Task 3.1  Architect input — Chunk 3
- [x] Task 4    Chunk 4 — Maintenance Job RLS Contract — PR #205 open
- [x] Task 6    Chunk 6 — Gate Hygiene Cleanup — PR #206 open
- [ ] Architect-output conflict check (pre-Task 2/3 gate)
- [ ] Task 2    Chunk 2 — Schema Decisions + Renames
- [ ] Task 5    Chunk 5 — Execution-Path Correctness
- [ ] Task 3    Chunk 3 — Dead-Path Completion
- [ ] Task 6.5  Spec freeze gate
- [ ] Task 6.6  Cross-spec consistency sweep
- [ ] Task 7    Handoff log

## Per-spec PR list

_(populated as each chunk PR opens)_

| Chunk | Spec slug | Branch | PR # | Status |
|---|---|---|---|---|
| 1 | pre-launch-rls-hardening | spec/pre-launch-rls-hardening | [#204](https://github.com/michaelhazza/automation-v1/pull/204) | open for review |
| 2 | pre-launch-schema-decisions | spec/pre-launch-schema-decisions | TBD | not started |
| 3 | pre-launch-dead-path-completion | spec/pre-launch-dead-path-completion | TBD | not started |
| 4 | pre-launch-maintenance-job-rls | spec/pre-launch-maintenance-job-rls | [#205](https://github.com/michaelhazza/automation-v1/pull/205) | open for review |
| 5 | pre-launch-execution-correctness | spec/pre-launch-execution-correctness | TBD | not started |
| 6 | pre-launch-gate-hygiene | spec/pre-launch-gate-hygiene | [#206](https://github.com/michaelhazza/automation-v1/pull/206) | open for review |
