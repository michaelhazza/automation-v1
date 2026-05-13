# Spec Conformance Log

**Spec:** `tasks/builds/fleet-and-codebase-health/spec.md` (LOCKED 2026-05-12)
**Plan:** `tasks/builds/fleet-and-codebase-health/plan.md`
**Spec commit at check:** `8858e6bf`
**Branch:** `codebase-health` (worktree `.worktrees/codebase-health`)
**Branch HEAD:** `173f3a35`
**Base (merge-base with main):** `89b7ee47`
**Scope:** Branch 2 — Chunks 1, 3, 11 (9 sub-chunks), 12, 13 → spec §4.B1, §5.C4, §5.C2, §5.C1, §9
**Changed-code set (non-archive):** 462 files
**Run at:** 2026-05-13T01:17:33Z
**Commit at finish:** `d8483c38`

---

## Summary

- Requirements extracted:     40
- PASS:                       33
- MECHANICAL_GAP → fixed:       3
- DIRECTIONAL_GAP → deferred:   3
- OUT_OF_SCOPE → skipped:       1

**Verdict:** NON_CONFORMANT — 3 directional gaps need operator decision before `pr-reviewer`. See `tasks/todo.md` § *Deferred from spec-conformance review — fleet-and-codebase-health (Branch 2 codebase-health) (2026-05-13)*. The 3 mechanical gaps are fixed in-session.

---

## Requirements extracted

### B1 — Gate + route migrations (Chunks 1, 11)

| # | Requirement | Verdict |
|---|---|---|
| 1 | Gate whitelist removed | PASS |
| 2 | T1 token format accepted in `is_suppressed` | PASS |
| 3 | Gate rejects malformed `guard-ignore` | PASS |
| 4 | `workspaceInboundWebhook.ts` uses T1 token | PASS |
| 5 | Webhook ADR exists with NON-COLLIDING number | MECHANICAL → fixed (0011 → 0022) |
| 6 | Route `agentPromptRevisions.ts` T2-compliant | PASS |
| 7 | `agentPromptRevisionService` — listForAgent, getById, rollback | PASS |
| 8 | Route `mcp.ts` T2-compliant | PASS |
| 9 | `subaccountAgentService.getAllowedSkillSlugs` | PASS |
| 10 | Route `projects.ts` T2-compliant | PASS |
| 11 | `projectService` — create, softDelete, getInFlightRunCount | PASS |
| 12 | Route `agentTriggers.ts` T2-compliant | PASS |
| 13 | `subaccountAgentService.assertBelongsToSubaccount` | PASS |
| 14 | Route `permissionSets.ts` T2-compliant | PASS |
| 15 | `permissionSetService.ts` new file with named methods | PASS |
| 16 | Route `integrationConnections.ts` T2-compliant | PASS |
| 17 | `connectionsService` extended | PASS |
| 18 | Route `portal.ts` T2-compliant | PASS |
| 19 | Route `systemEngines.ts` T2-compliant | PASS |
| 20 | `engineService` system methods (5) | PASS |
| 21 | Route `webhookAdapter.ts` T2-compliant | PASS |
| 22 | `agentService.getFull` used in webhookAdapter | PASS |
| 23 | §9 F4: gate exits 0 on branch tip | DIRECTIONAL → deferred |

T2 invariant item #4 (no `db`/schema/drizzle imports in routes) holds for all 9 migrated routes — verified by grep.

### C4 — Archive move (Chunk 3)

| # | Requirement | Verdict |
|---|---|---|
| 24 | `prototypes/` moved via `git mv` | PASS |
| 25 | `attached_assets/` moved via `git mv` | PASS |
| 26 | `_archive/README.md` exists | PASS |
| 27 | T7 path-reference sweep clean | MECHANICAL → fixed (1 stale comment); DIRECTIONAL for new top-level dirs from post-merge builds |

### C2 — KNOWLEDGE.md sweep (Chunk 12)

| # | Requirement | Verdict |
|---|---|---|
| 28 | `docs/knowledge-sweep-inventory.md` 4 required sections | PASS |
| 29 | KNOWLEDGE.md ≤2,500 lines | DIRECTIONAL → deferred (actual 3,846) |
| 30 | ≤5 new ADRs from sweep (0012–0016) | PASS |
| 31 | Dated header `## 2026-05 quarterly trim` | PASS |
| 32 | Non-deletion rule | PASS |

### C1 — todo.md triage (Chunk 13)

| # | Requirement | Verdict |
|---|---|---|
| 33 | `tasks/todo-triage-inventory.md` one-row-per-item | PASS |
| 34 | `tasks/todo.md` ≤500 lines | PASS (199) |
| 35 | `tasks/todo-archive/2026-Q2.md` exists | PASS |
| 36 | SHIP stubs created (38) | PASS |
| 37 | ≤5 ADRs from ACCEPT triage (0017–0021) | PASS |
| 38 | Forward-references for removed items | PASS |

### Cross-cutting

| # | Requirement | Verdict |
|---|---|---|
| 39 | `docs/decisions/README.md` index updated | MECHANICAL → fixed |
| 40 | `architecture.md` ACCEPT annotations | OUT_OF_SCOPE (defer to pr-reviewer) |

---

## Mechanical fixes applied

### M1 — ADR-0011 collision (REQ #5)

Two ADRs sat at slot 0011: `0011-operator-backend-chain-resume-model.md` (from upstream merge) and `0011-workspace-inbound-webhook-db-exception.md` (added by codebase-health). The convention is unique 4-digit slugs.

| File | Change |
|---|---|
| `docs/decisions/0011-workspace-inbound-webhook-db-exception.md` → `docs/decisions/0022-workspace-inbound-webhook-db-exception.md` | `git mv` to next free slot; heading `ADR-0011` → `ADR-0022`. |
| `server/routes/workspaceInboundWebhook.ts:24` | Guard-ignore ADR-id `0011-...` → `0022-...`. |
| `docs/knowledge-sweep-inventory.md` (2 lines) | Inventory notes updated with renumber explanation. |

Spec quote (§4.B1): *"The script must reject any bare `guard-ignore` without both an ADR reference and a rationale."* A duplicate-number ADR breaks the reference resolution.

### M2 — Stale comment in PnlKpiCard.tsx (REQ #27)

| File | Change |
|---|---|
| `client/src/components/system-pnl/PnlKpiCard.tsx:4` | `prototypes/system-costs-page.html` → `_archive/prototypes/system-costs-page.html`. |

Per plan §8: active TS code references to the old path must be updated. (Build artifacts under `tasks/builds/**` are explicitly left alone.)

### M3 — `docs/decisions/README.md` index missing 11 new ADRs (REQ #39)

The codebase-health work added ADRs 0012–0021 + the renumbered webhook 0022 but never updated the README index. The README's own instruction: *"Update when adding ADRs."*

| File | Change |
|---|---|
| `docs/decisions/README.md` | Appended 11 rows (0012–0022) in numeric order, matching the existing table shape and `accepted` / `proposed` status from each ADR file. ADR-0010 was missing pre-codebase-health (operator-backend's omission) and is out of scope for this conformance pass. |

---

## Directional / ambiguous gaps (routed to `tasks/todo.md`)

| ID | Summary |
|---|---|
| REQ-FCH-B1-gate-red | Gate is RED on branch tip — 2 violations from operator-backend merge (`operatorSessions.ts`, `operatorTasks.ts`). Spec §9 requires GREEN. |
| REQ-FCH-C2-knowledge-over-target | KNOWLEDGE.md is 3,846 lines, target ≤2,500. Sweep didn't converge on the target. |
| REQ-FCH-C4-new-prototypes | Three new top-level `prototypes/{operator-backend, personal-assistant-v1, memory-improvements}/` dirs from post-Chunk-3 merges. Convention scope is ambiguous. |

Full descriptions and suggested approaches in `tasks/todo.md`.

---

## Files modified by this run

- `client/src/components/system-pnl/PnlKpiCard.tsx` (M2)
- `docs/decisions/0011-workspace-inbound-webhook-db-exception.md` → `docs/decisions/0022-workspace-inbound-webhook-db-exception.md` (M1)
- `server/routes/workspaceInboundWebhook.ts` (M1)
- `docs/knowledge-sweep-inventory.md` (M1)
- `docs/decisions/README.md` (M3)
- `tasks/todo.md` (deferred-items append)
- This log

Verification after fixes: `npm run lint` → 0 errors / 892 warnings (identical baseline); `npm run typecheck` → clean; `bash scripts/verify-no-db-in-routes.sh` → 2 unrelated violations (unchanged by this run).

---

## Next step

**NON_CONFORMANT.** Operator decisions needed on three directional items before `pr-reviewer`:

1. **Gate RED.** Migrate `operatorSessions.ts` + `operatorTasks.ts` to T2 services (likely cohesive with operator-backend), or guard-ignore each with a new ADR. Branch cannot merge under §9 with gate red.
2. **KNOWLEDGE.md size.** Accept current 3,846 lines (amend the target line) or run a follow-up sweep.
3. **New top-level prototypes/.** Document that `_archive/` is for past artefacts only (update `_archive/README.md` + CLAUDE.md) or relocate the three new dirs.

After resolution, **re-run `pr-reviewer` on the expanded changed-code set** — M1, M2, M3 changed files need to be reviewed at their final state.
