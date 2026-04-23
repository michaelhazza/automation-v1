# Progress: paperclip-hierarchy (Hierarchical Agent Delegation)

**Spec:** `docs/hierarchical-delegation-dev-spec.md` (locked, 1929 lines)
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Classification:** Major
**Slug:** `paperclip-hierarchy`

## Pipeline

| Stage | Status | Notes |
|-------|--------|-------|
| A) Intake | done | Spec confirmed locked; deferred items at `tasks/todo.md` lines 308–315 left untouched; pre-Phase-2 manifest blocker confirmed (two `reportsTo: null` agents — `orchestrator` line 18, `portfolio-health-agent` line 168). `CLAUDE.md` + `architecture.md` + `tasks/todo.md` + `tasks/lessons.md` read. |
| B) Architecture | in-progress | Architect delegation prompt emitted — awaiting `tasks/builds/paperclip-hierarchy/plan.md`. |
| B.5) Plan gate | pending | HARD STOP after plan review. User switches to Sonnet + confirms before execution. |
| C) Implementation | pending | Per-chunk: implement → spec-conformance → pr-reviewer. |
| D) Handoff | pending | |

## Invariants (must be honoured by every chunk)

Full wording authored by architect in `plan.md § System Invariants`. Names only, here:

1. **runId continuity** end-to-end via `SkillExecutionContext.runId` (spec §10.6). Never regenerate; enforced at call-site.
2. **Uniform error contract** — stable `{ code, message, context }` with `runId` + `callerAgentId` mandatory, additive-only, serialised context ≤ 4 KiB, arrays truncate to 50 with `truncated: true` (spec §4.3).
3. **Best-effort dual-writes** — `insertOutcomeSafe` (tag: `delegation_outcome_write_failed`) + `insertExecutionEventSafe` (tag: `delegation_event_write_failed`) detached, post-commit, named swallow points, never propagate (spec §10.3, §15.6, §15.8). `recordOutcomeStrict` exists for tests/backfills only.
4. **Immutable hierarchy snapshot** — `context.hierarchy` built once at run start via `hierarchyContextBuilderService.buildForRun()`, `Object.freeze`d, typed `Readonly<HierarchyContext>`. No mid-run mutation or re-query. Stale-context errors fail fast (spec §4.1, §15.3).

## Pre-Phase-2 blocker

Partial unique index (migration 0202) will fail until seeded manifest is re-parented. Current: `companies/automation-os/automation-os-manifest.json` has `orchestrator` (line 18, `reportsTo: null`) AND `portfolio-health-agent` (line 168, `reportsTo: null`, `executionScope: 'org'`). Resolution is manifest edit + re-seed per spec §13. Architect plan sequences as Phase-2 Chunk 0 before migration 0202 runs: audit → edit → re-seed → re-audit → migration.

## Chunks

_Populated after architect finalises the plan._

## Review logs

_Populated as chunks complete. All logs under `tasks/review-logs/`._

## Out of scope (do NOT implement)

- Nearest-common-ancestor routing (`tasks/todo.md:314`).
- Violation sampling / alerting tier (`tasks/todo.md:315`).
- Spec §3.2 out-of-scope list (seeded-company multi-tier reorg, mesh patterns, role enum, RLS-layer delegation enforcement, cost rollups, broader upward-reassign).
