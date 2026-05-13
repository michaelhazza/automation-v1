# Progress — fleet-and-codebase-health (Branch 2)

**Slug:** `fleet-and-codebase-health`
**Branch:** `codebase-health` (worktree: `.worktrees/codebase-health/`)
**Branch role:** Branch 2 of 2 (per plan §2 — gate fix + route migrations + archive moves + KNOWLEDGE/todo sweeps; chunks 1, 3, 11, 12, 13)
**Sibling branch:** `fleet-and-process` / PR #293 (Branch 1 — agent fleet + GRADED policy + new agents + transition-plan doc)
**Started:** 2026-05-12
**Phase 2 status (this branch):** complete after deferred-item closure; ready for finalisation

> **Reconstruction note:** This progress file is authored post-hoc on 2026-05-13 from committed artefacts (commits, spec-conformance log, branch diff). Phase 2 was not driven by `feature-coordinator` in the standard pipeline shape; chunks were implemented directly. Two of the three deferred items from the spec-conformance NON_CONFORMANT verdict have since been closed by post-conformance commits and main-merges — current state cited below.

---

## Implementation commits

| Commit | Author time | Description |
|---|---|---|
| `06eb8d05` | 2026-05-13 11:03 +1000 | `chore(health): codebase hygiene — T2 route isolation, archive move, KNOWLEDGE sweep, todo triage` — single implementation commit covering Branch 2 chunks |
| `c2c7adca` | 2026-05-13 11:06 +1000 | Merge `origin/main` — resolve KNOWLEDGE.md and tasks/todo.md conflicts (S1 sync) |
| `173f3a35` | 2026-05-13 11:09 +1000 | `fix(T2): move agentRuns list-by-agentId query into agentActivityService` — additional T2 route isolation |
| `d8483c38` | 2026-05-13 11:26 +1000 | `chore(spec-conformance): fleet-and-codebase-health Branch 2 — NON_CONFORMANT` — spec-conformance verdict committed |
| `4eb5d92b` | 2026-05-13 11:27 +1000 | `chore(spec-conformance): record commit hash in conformance log` — log metadata fix |
| `5ce8f2c7` | 2026-05-13 11:43 +1000 | `fix(T2): migrate operatorSessions + operatorTasks routes to service layer` — closes REQ-FCH-B1 (gate violations from operator-backend merge) |
| `79fc01db` | 2026-05-13 12:05 +1000 | `fix(review): address pr-reviewer findings — move predicate to services, tx wrapping, org filters, drop cast` — pr-reviewer follow-up |
| `642dce2c` | 2026-05-13 12:11 +1000 | `chore(merge): merge main into codebase-health — adopt condensed KNOWLEDGE.md + todo.md from PR #292` — closes REQ-FCH-C2 |

## Plan chunks covered

Per `plan.md` §2 branch posture, Branch 2 covers:

| Chunk | Spec section | Status | Notes |
|---|---|---|---|
| 1 | §4.B1 | done | Fix `verify-no-db-in-routes.sh` (gate fix) |
| 3 | §5.C4 | done | Move `prototypes/` + `attached_assets/` to `_archive/` |
| 11 | §5.C2 | done | Route violator triage — 9 sub-chunks (`mcp.ts`, `subaccountAgents.ts`, `agentTriggers.ts`, `crmEvents.ts`, `subaccountAdmin.ts`, `projects.ts`, `eaDrafts.ts`, `agentRuns.ts`, `operatorSessions.ts` + `operatorTasks.ts`) |
| 12 | §5.C1 | done | `KNOWLEDGE.md` sweep + condensation |
| 13 | §9 | done | `tasks/todo.md` triage sprint + inventory |

Branch 1 chunks (2, 4, 5, 6, 7, 8, 9, 10) are explicitly out of scope.

## Files changed (vs `origin/main`)

331 files changed, 10,418 insertions, 3,073 deletions.

Notable concentrations:
- `server/routes/*.ts` — 9 route files migrated to service layer (Chunk 11)
- `server/services/**` — corresponding service additions/extensions
- `_archive/prototypes/`, `_archive/attached_assets/` — archive moves (Chunk 3)
- `KNOWLEDGE.md` — condensed from ~3,846 lines to 1,190 lines (Chunk 12 + PR #292 adopt)
- `tasks/todo.md` — triage and inventory (Chunk 13)
- `tasks/todo-archive/2026-Q2.md` — new archive file (4,427 lines)
- `tasks/todo-triage-inventory.md` — new triage inventory (208 lines)
- `scripts/verify-no-db-in-routes.sh` — gate fix (Chunk 1)

## Reviews completed on this branch

| Reviewer | Verdict | Evidence on-branch | Notes |
|---|---|---|---|
| `spec-conformance` | **NON_CONFORMANT** (33 PASS / 3 MECHANICAL_GAP fixed / 3 DIRECTIONAL_GAP deferred / 1 OUT_OF_SCOPE) | `tasks/review-logs/spec-conformance-log-fleet-and-codebase-health-branch-2-2026-05-13T01-17-33Z.md` | Three deferred items; two closed by post-conformance commits (see "Deferred items state" below); one open. spec-conformance was NOT re-run after the closures — this is an honest gap in the audit trail |
| `pr-reviewer` | findings ADDRESSED | no committed log; evidence is commit `79fc01db` | Four findings addressed: predicate moved to services, tx wrapping, org filters, drop unsafe cast |
| `dual-reviewer` | not run | n/a | Operator skip per 2026-05-13 |
| `adversarial-reviewer` | not run | n/a | Operator skip per 2026-05-13. Note: Branch 2 diff DOES touch §5.1.2 surface (`server/routes/*`); policy would normally auto-invoke. Operator explicitly chose chatgpt-pr-review as sole second-opinion |
| `reality-checker` | not run | n/a | Operator skip. Bootstrap gap anyway (agent introduced by Branch 1) |

## Deferred items state (post-conformance closures)

The spec-conformance NON_CONFORMANT verdict raised three directional gaps. Current state:

| ID | Original gap | Current state | Closing commit(s) |
|---|---|---|---|
| REQ-FCH-B1-gate-red | Gate RED with 2 violations (`operatorSessions.ts`, `operatorTasks.ts`) from operator-backend merge | **CLOSED.** Gate now GREEN (0 violations). Verified locally on 2026-05-13. | `5ce8f2c7` (T2 service migration) + `79fc01db` (pr-reviewer follow-up) |
| REQ-FCH-C2-knowledge-over-target | KNOWLEDGE.md is 3,846 lines, target ≤2,500 | **CLOSED.** KNOWLEDGE.md now 1,190 lines after main-merge `642dce2c` adopted PR #292's KNOWLEDGE.md cleanup. | `642dce2c` (main-merge adopting condensed file) |
| REQ-FCH-C4-new-prototypes | 3 new top-level `prototypes/{operator-backend, personal-assistant-v1, memory-improvements}/` dirs from post-Chunk-3 merges; convention scope ambiguous | **STILL OPEN.** All three dirs still present. Operator decision needed: are post-Chunk-3 prototypes acceptable, or should the convention extend to archive them too? | not yet closed |

## Spec deviations

The three deferred items above are the spec deviations on record. Two are now closed. One remains open and is the primary item chatgpt-pr-review should adjudicate.

## Open issues for finalisation

1. **REQ-FCH-C4** — three new top-level `prototypes/` dirs (from operator-backend, personal-assistant-v1, memory-improvements builds). Spec §5.C4 archive convention is ambiguous about whether post-Chunk-3 builds should pre-archive their prototypes or whether the next health-sweep batches them. chatgpt-pr-review should adjudicate.
2. **spec-conformance NOT re-run** after deferred items B1 and C2 were closed. The committed verdict is NON_CONFORMANT but the current state is "2 of 3 deferred items closed; 1 open." Honest gap in the audit trail; flagged for chatgpt-pr-review awareness.
3. **adversarial-reviewer was not run** despite the diff touching `server/routes/*` (§5.1.2 security surface). Operator explicitly skipped per scope decision; chatgpt-pr-review covers as the sole second-opinion pass.
4. **No pr-reviewer log on branch.** Only commit `79fc01db` documents the round. chatgpt-pr-review may want to read its diff to confirm findings were genuinely addressed.

## Doc-sync touchpoints (for Phase 3 sweep)

Already updated by Branch 2 implementation:
- `architecture.md` — Branch 2's route migrations may have updated entries (per chunk 11 sub-chunks)
- `KNOWLEDGE.md` — condensed via Chunk 12; PR #292 main-merge brought in further condensation
- `tasks/todo.md` — triage sprint (Chunk 13)
- `tasks/todo-archive/2026-Q2.md` — new archive file
- `tasks/todo-triage-inventory.md` — new inventory artefact
- `docs/decisions/` — 11 new/renumbered ADRs (M1 spec-conformance fix renamed 0011 → 0022)
- `docs/decisions/README.md` — ADR index sync (M3 spec-conformance fix)
- `_archive/prototypes/`, `_archive/attached_assets/` — archive moves (Chunk 3)
- `scripts/verify-no-db-in-routes.sh` — gate fix (Chunk 1)

Pending Phase 3 verification: `architecture.md` (per-route updates), `docs/capabilities.md` (no expected change), `docs/integration-reference.md` (no expected change), `docs/frontend-design-principles.md` (no expected change).
