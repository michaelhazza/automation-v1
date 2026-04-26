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

- Invariants pinned at: _(captured in Task 0.6 Step 3)_
- Schema-decisions architect SHA: _(captured in Task 2.1 Step 3)_
- Dead-path-completion architect SHA: _(captured in Task 3.1 Step 3)_

## Architect-output conflict check

_(stamped after §10b clears — pre-Task 2/3 gate)_

## Spec Freeze

_(stamped in Task 6.5 once all 6 specs are merged + Open Decisions resolved + Review Residuals clean)_

## Cross-Spec Consistency Sweep

_(stamped in Task 6.6 once cross-spec naming, contracts, primitives, and assumptions all align)_

## Status

- [x] Task 0    Branch setup
- [ ] Task 0.5  Mini-spec on branch
- [ ] Task 0.6  Cross-chunk invariants doc
- [ ] Task 1    Chunk 1 — RLS Hardening Sweep
- [ ] Task 2.1  Architect input — Chunk 2
- [ ] Task 3.1  Architect input — Chunk 3
- [ ] Task 4    Chunk 4 — Maintenance Job RLS Contract
- [ ] Task 6    Chunk 6 — Gate Hygiene Cleanup
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
| 1 | pre-launch-rls-hardening | spec/pre-launch-rls-hardening | TBD | not started |
| 2 | pre-launch-schema-decisions | spec/pre-launch-schema-decisions | TBD | not started |
| 3 | pre-launch-dead-path-completion | spec/pre-launch-dead-path-completion | TBD | not started |
| 4 | pre-launch-maintenance-job-rls | spec/pre-launch-maintenance-job-rls | TBD | not started |
| 5 | pre-launch-execution-correctness | spec/pre-launch-execution-correctness | TBD | not started |
| 6 | pre-launch-gate-hygiene | spec/pre-launch-gate-hygiene | TBD | not started |
