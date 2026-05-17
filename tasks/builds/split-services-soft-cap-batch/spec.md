---
status: DRAFT
date: 2026-05-15
author: main-session (claude opus 4.7)
scope_class: Significant
source_branch: main
build_slug: split-services-soft-cap-batch
output_location: tasks/builds/split-services-soft-cap-batch/spec.md
pattern_setter: tasks/builds/feat-split-agentexecutionservice/spec.md
companion: tasks/builds/split-workflow-engine/spec.md, tasks/builds/split-skill-analyzer/spec.md
adopts_conventions_from: tasks/builds/feat-split-skillexecutor/spec.md § 5
---

# Wave 2 Session B — soft-cap god-file batch

Splits the 5 services / 1 job still over the 1,500 LOC soft cap after Wave 1. Closes `tasks/todo.md` line 296 (soft-cap register) + SA3 (`skillAnalyzerJob`).

Adopts `§5 Module-Decomposition Conventions` of `tasks/builds/feat-split-skillexecutor/spec.md` and the lifecycle-phase decomposition pattern of `tasks/builds/feat-split-agentexecutionservice/spec.md` by reference.

---

## 1. Targets

| File | Current LOC | Cap | Domain | Pattern |
|---|---|---|---|---|
| `server/services/agentService.ts` | 2,335 | 1,500 | Agent CRUD + roster management | Split by operation cluster |
| `server/jobs/skillAnalyzerJob.ts` | 2,254 | 1,500 (Area 10 extension per R5) | Skill-analyzer pipeline worker | Split by pipeline stage |
| `server/services/workspaceMemoryService.ts` | 1,949 | 1,500 | Workspace memory write/read/eviction | Split by lifecycle phase |
| `server/services/llmRouter.ts` | 1,918 | 1,500 | LLM dispatch + cost guards + retry | Split by routing concern |
| `server/services/queueService.ts` | 1,683 | 1,500 | pg-boss queue helpers + DLQ + metrics | Split by responsibility |

Total ~10,140 LOC across 5 targets. Architect's chunk-0 sweep enumerates exact line ranges and existing internal seams.

## 2. Goals

1. Reduce each target to a thin barrel (< 250 LOC) re-exporting the public surface from a sibling directory tree.
2. Each target gets its own sibling directory matching the file slug minus `.ts` (e.g., `server/services/agentService/`, `server/jobs/skillAnalyzerJob/`).
3. Preserve public APIs exactly. Every external caller compiles without source edits beyond the barrel re-exports.
4. Close `tasks/todo.md` line 296 (Area 10 soft-cap breaches register) and SA3 (skillAnalyzerJob god-file).
5. No raw `db` regressions inside the new trees; new sub-modules use `getOrgScopedDb()` per the canonical pattern.

## 3. Non-Goals

- No behaviour change in any of the 5 targets.
- No new features, no new pipeline stages, no new perms.
- No re-shaping of pg-boss integration, no queue-name changes.
- No drive-by lint cleanup, no commingling with other refactors.
- No splitting of Wave 1 targets (`workflowEngineService`, `skillAnalyzer*`, `agentExecutionService`, `skillExecutor`) — they are out of scope; their splits already landed.
- No `*Pure.ts` companion creation as part of this build — if a pure helper extraction surfaces during a chunk, defer to a follow-up tagged `SOFTCAP-PURE-<service>`.

## 4. Framing Assumptions

- Repo is pre-production per `docs/spec-context.md`; testing posture is `static_gates_primary`. No new unit tests required for the splits.
- Each target has different internal structure; the architect's chunk-0 sweep produces per-target decomposition seams. Five mini-plans within one master plan.
- All 5 targets are widely imported (agentService alone is one of the most-called services in the codebase). The architect's caller sweep enumerates each file's imports during chunk 0 and locks the public surface before any split work.
- TypeScript strict mode is on. The existing tsconfig path mapping is immutable.
- The architect MAY choose to ship the 5 splits as 5 sequential PRs OR as one master PR with multiple commits — chunk 0 records the PR shape decision. Recommended default: **one master PR** because the 5 targets have no cross-imports between them (verify during chunk 0), making conflict-free parallel chunk execution feasible.
## 5. Public-Surface Lock per target

Architect enumerates the exact export list per target during chunk 0. For each target, the rule is: every name exported from the current file MUST remain importable from the same path at the end of the migration. The expected high-level surfaces:

| Target | Expected primary exports |
|---|---|
| `agentService` | `agentService` object OR individual CRUD functions (`createAgent`, `updateAgent`, `deleteAgent`, `listAgents`, `getAgent`, role assignment, permission grants) — architect confirms shape |
| `skillAnalyzerJob` | `skillAnalyzerJob` worker handler + pipeline stage helpers — architect confirms shape |
| `workspaceMemoryService` | Memory write / read / search / eviction operations — architect confirms shape |
| `llmRouter` | `llmRouter` object OR individual functions (`routeRequest`, `selectModel`, `estimateCost`, retry/backoff wrappers) — architect confirms shape |
| `queueService` | Queue lifecycle (start, stop, register), DLQ helpers, metrics helpers — architect confirms shape |

Each surface is locked at chunk 0. Any internal helper that is not exported today stays internal in the split.

## 6. Module-Decomposition Conventions

### 6.1. Reference to pattern-setters

Adopts §5.1 (naming), §5.4 (Pure/impure separation), §5.5 (Module-level state), §5.6 (Test-collocation) from `tasks/builds/feat-split-skillexecutor/spec.md` verbatim.

Adopts the lifecycle-phase decomposition pattern from `tasks/builds/feat-split-agentexecutionservice/spec.md` for any target whose internal structure matches a phased lifecycle (likely `workspaceMemoryService` and `llmRouter`).

### 6.2. Directory layout per target

```
server/services/agentService.ts                ← barrel (< 250 LOC)
server/services/agentService/                  ← decomposition tree
  <sub-modules per architect's plan>

server/jobs/skillAnalyzerJob.ts                ← barrel (< 250 LOC)
server/jobs/skillAnalyzerJob/                  ← decomposition tree
  <sub-modules per architect's plan>

server/services/workspaceMemoryService.ts      ← barrel (< 250 LOC)
server/services/workspaceMemoryService/        ← decomposition tree
  <sub-modules per architect's plan>

server/services/llmRouter.ts                   ← barrel (< 250 LOC)
server/services/llmRouter/                     ← decomposition tree
  <sub-modules per architect's plan>

server/services/queueService.ts                ← barrel (< 250 LOC)
server/services/queueService/                  ← decomposition tree
  <sub-modules per architect's plan>
```

### 6.3. Dependency direction (across targets)

The 5 targets MUST NOT introduce cross-target imports during the split. If the architect's chunk-0 sweep finds an existing cross-target import (e.g., `agentService` calls `queueService`), preserve it through the public barrel — do not import from another target's `<target>/internal-module.ts`.

### 6.4. Per-target seam guidance

The architect's chunk 0 produces concrete seams per target. Suggested starting points:

- **agentService** — split by operation cluster: CRUD, roster management, permissions, role assignment, validation
- **skillAnalyzerJob** — split by pipeline stage: ingest, classify, dedup, merge, persist, telemetry
- **workspaceMemoryService** — split by lifecycle phase: write, read/search, retention/eviction, embedding cache
- **llmRouter** — split by routing concern: model selection, cost guard, retry, fallback, observability
- **queueService** — split by responsibility: registration, lifecycle (start/stop), DLQ, metrics, health checks

These are architect-confirmed during chunk 0, not locked by this spec.
## 7. Acceptance Criteria

A build is complete when ALL of the following hold:

1. All 5 barrels are < 250 LOC and contain only re-exports.
2. Each sibling directory contains the architect-confirmed module set.
3. `npm run build:server` exits 0.
4. `npm run lint` exits 0.
5. `verify-loc-cap.sh` passes — no file in the new trees exceeds the 1,500 LOC soft cap (or the Area 10 jobs extension per R5).
6. `verify-with-org-tx-or-scoped-db.sh` does not introduce new baseline entries inside the new trees.
7. `verify-canonical-retry.sh` baseline is honoured (no new occurrences in new code).
8. `verify-duplicate-blocks.sh` does not regress.
9. All callers of the 5 targets compile against the new barrels without source-code modifications.
10. `tasks/todo.md` line 296 (Area 10 soft-cap register) and SA3 marked `[status:closed:pr:<num>]` in the merge commit.

## 8. Chunks (high-level)

Architect refines during plan phase. Expected shape — five mini-plans, one per target. Architect MAY interleave or parallelise:

For each of the 5 targets:
- **Chunk N.0** — caller sweep + locked-surface confirmation
- **Chunk N.1..N.k** — extract sub-modules in dependency order (leaves first)
- **Chunk N.last** — barrel re-export + caller verification

After all 5 targets:
- **Final chunk** — cross-target verification + gate run + spec-conformance review

## 9. Caller Sweep — Architect Responsibility

Per-target caller sweep at chunk 0:

- Every file importing from the target (e.g., `from '../services/agentService'`).
- Every callsite that destructures named exports.
- Any frontend file referencing the target's types (less likely for backend services).

Recorded in `plan.md` chunk-0 per target. Verified during spec-conformance review post-build.

## 10. PR Shape Decision

The architect's chunk 0 decides the PR shape:

- **Option A: One master PR** with one commit per target chunk (preferred default if no cross-target imports surface)
- **Option B: 5 sequential PRs** (one per target — adopt if any target has cross-target callers that require staged migration)

Document the decision in `plan.md` chunk 0 with the cross-target import audit result.
