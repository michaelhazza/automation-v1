# Spec Conformance Log

**Spec:** `tasks/builds/split-workflow-engine/spec.md`
**Spec commit at check:** Spec landed at PR #316 (commit `76377549`); no further edits to `spec.md` on this branch.
**Branch:** `claude/split-workflow-engine`
**Base:** `76377549101b331f2d07d73972f0596bfbcb4fb1` (merge-base with main)
**Scope:** whole spec — caller confirmed Chunks 7 (db scoping) and 8 (RLS) were INTENTIONALLY deferred; classified as DIRECTIONAL_GAPs per caller instruction, not MECHANICAL.
**Changed-code set:** 16 files (server/services/workflowEngine/**, server/services/workflowEngineService.ts, server/lib/permissions.ts, server/routes/workflowRuns.ts, migrations/0359_workflow_runs_org_permissions.{sql,down.sql})
**Run at:** 2026-05-15T04:18:08Z

---

## Summary

- Requirements extracted:     33
- PASS:                       24
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  9 (all pre-known — already routed by handoff.md REVIEW_GAPs + open WF items in tasks/todo.md)
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** CONFORMANT (relative to Phase 2 declared scope — Chunks 1–6, 9, 10).

All 9 DIRECTIONAL_GAPs are from the intentional Chunks 7 and 8 deferral, which the build coordinator declared up front. Each maps 1:1 to an existing `[status:open]` item in `tasks/todo.md` (WF1, WF3, WF4, WF6) — no new routing required.

There are no spec-conformance issues blocking the next reviewer. The branch is CONFORMANT against its declared Phase 2 scope.

---

## Requirements extracted (full checklist)

| # | Category | Spec section | Requirement | Verdict |
|---|---|---|---|---|
| 1 | file | §1 goal 1, §8.1 | barrel under 250 LOC | PASS (64 LOC) |
| 2 | file | §1 goal 2, §5.2 | decompose along queue lifecycles (tick / watchdog / agent-step) + shared helpers | PASS |
| 3 | migration/schema | §1 goal 3, §6 | RLS policies for 5 FK-only workflow tables | DIRECTIONAL_GAP (Chunk 8 deferred) |
| 4 | config | §1 goal 4, §6.4, §8.6 | rlsProtectedTables.ts allowlist entries | DIRECTIONAL_GAP (Chunk 8 deferred) |
| 5 | config/migration | §1 goal 5, §7 | WORKFLOW_RUNS_* permission family + route wiring | PASS |
| 6 | behavior | §1 goal 6 | raw db → getOrgScopedDb migration | DIRECTIONAL_GAP (Chunk 7 deferred) |
| 7 | behavior | §1 goal 7 | tick worker re-opens withOrgTx after run-row load | DIRECTIONAL_GAP (Chunk 7 deferred) |
| 8 | behavior | §1 goal 8 | workflowAgentRunHook.ts:36-39 raw db fix | DIRECTIONAL_GAP (Chunk 7 deferred) |
| 9 | contract | §1 goal 9, §4 | public API preserved; all callers compile | PASS |
| 10 | export | §4 | WorkflowEngineService const object with full member list | PASS |
| 11 | export | §4 | queue constants (TICK_QUEUE / WATCHDOG_QUEUE / AGENT_STEP_QUEUE) on the object | PASS (D2 deviation — AGENT_STEP_QUEUE not exposed; operator-approved) |
| 12 | file | §5.2 | directory layout matches | PASS (architect added stepLifecycle.ts, dispatch.ts, registerWorkers.ts per §5.2 allowance) |
| 13 | behavior | §5.3 | dependency direction (no upward / no barrel imports from sub-modules) | PASS (zero matches on `workflowEngineService(\.js)?["']` inside the tree) |
| 14 | file | §5.4 | workflowEngineServicePure.ts untouched | PASS |
| 15 | migration | §6 | RLS migration file + .down.sql | DIRECTIONAL_GAP (Chunk 8 deferred) |
| 16 | config | §7 | WORKFLOW_RUNS_VIEW permission | PASS |
| 17 | config | §7 | WORKFLOW_RUNS_EXECUTE (reused as existing START per plan §3e) | PASS (D3 deviation, operator-approved) |
| 18 | config | §7 | WORKFLOW_RUNS_CANCEL permission | PASS |
| 19 | config | §3, §7 | default role grants | PASS (per D3 — Org Manager omits START/EXECUTE per plan operator decision) |
| 20 | migration | §7 | permission migration touchpoints (enum + SQL + routes; AGENTS_VIEW removed in same chunk) | PASS |
| 21 | file | §8.1 | barrel < 250 LOC re-exports only | PASS |
| 22 | file | §8.2 | directory tree matches §5.2 | PASS |
| 23 | behavior | §8.3 | `npm run build:server` exits 0 | PASS (only 2 pre-existing `docx`/`mammoth` errors in unrelated files) |
| 24 | behavior | §8.4 | `npm run lint` exits 0 | PASS (0 errors, 888 pre-existing warnings) |
| 25 | migration | §8.5 | RLS migrations land + gates pass | DIRECTIONAL_GAP (Chunk 8 deferred) |
| 26 | config | §8.6 | rlsProtectedTables.ts allowlist contains 5 new entries | DIRECTIONAL_GAP (Chunk 8 deferred) |
| 27 | config | §8.7 | verify-with-org-tx-or-scoped-db.sh baseline unchanged in new tree | DIRECTIONAL_GAP (Chunk 7 deferred) |
| 28 | behavior | §8.8 | verify-canonical-retry.sh baseline honoured (no new retry occurrences in new code) | PASS (existing decision-retry logic preserved verbatim, no new patterns) |
| 29 | file | §8.9 | verify-loc-cap.sh — files < 1,500 LOC; barrel < 250 LOC | PASS (largest sub-module: dispatch.ts 1,251; barrel 64) |
| 30 | contract | §8.10 | WORKFLOW_RUNS_* in place, default-granted, all routes gate on them | PASS |
| 31 | behavior | §8.11 | no AGENTS_VIEW for workflow-run access | PASS (zero hits in workflowRuns.ts) |
| 32 | contract | §8.12 | all 5 callers compile against new barrel | PASS (5 callers identified; no source-code modifications to any caller beyond the perm-migration edit in workflowRuns.ts) |
| 33 | docs | §8.13 | tasks/todo.md WF items marked closure-pending-merge | PASS (T2 documented deviation: Phase 2 writes `closure-pending-merge:slug:split-workflow-engine`; Phase 3 finalisation does the literal swap to `[status:closed:pr:<num>]`) |

---

## Mechanical fixes applied

None. Zero MECHANICAL_GAPs identified.

---

## Directional / ambiguous gaps

All 9 DIRECTIONAL_GAPs derive from the operator-approved Chunks 7 + 8 deferral, which is recorded in three places already:

1. `tasks/builds/split-workflow-engine/progress.md` — entries dated 2026-05-15 marking both chunks DEFERRED.
2. `tasks/builds/split-workflow-engine/handoff.md` — `### Deferred chunks` section + two REVIEW_GAP lines (chunk-7, chunk-8).
3. `tasks/todo.md` — pre-existing WF1/WF3/WF4/WF6 items remain in `[status:open]`.

Per the playbook's "scan tasks/todo.md for an existing entry... skip if already present — re-runs must not duplicate", no new section is appended to `tasks/todo.md` from this run. The four open WF items already serve as the single source of truth for the deferred work.

| REQ | Spec section | Existing tracking |
|---|---|---|
| #3, #15, #25, #26 | §1 goal 3, §6, §8.5, §8.6 | `tasks/todo.md` WF1 (line 1582) — `[status:open]` |
| #6 | §1 goal 6 | `tasks/todo.md` WF3 (line 1584) — `[status:open]` |
| #7, #27 | §1 goal 7, §8.7 | `tasks/todo.md` WF4 (line 1585) — `[status:open]` |
| #8 | §1 goal 8 | `tasks/todo.md` WF6 (line 1587) — `[status:open]` |

---

## Spec deviations (acknowledged, operator-approved)

Three deviations were ratified during plan-review Round 1 (2026-05-15T02:55:00Z) and are recorded in plan §7 + handoff.md:

- **D1** — Spec §1 goal 3 names tables that do not exist (`workflow_run_steps`, `workflow_definitions`, `workflow_audit_events`). Plan and implementation operate on the audit-correct set (`workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`). N/A for this PR since Chunk 8 is deferred.
- **D2** — Spec §4 wording implies `AGENT_STEP_QUEUE` is exposed on `WorkflowEngineService`; in fact only `TICK_QUEUE` and `WATCHDOG_QUEUE` are exposed today. Implementation preserves current behaviour. Operator-approved.
- **D3** — Spec §7 names 3 new perms; actual route surface needs 4 + reuse of `WORKFLOW_RUNS_START`. Implementation lands 4 new perms + reuses START for EXECUTE. Operator-approved.

A fourth implementation-detail note (not a spec deviation per se): `enqueueTick` lives in `constants.ts` rather than `queueLifecycle/tick.ts` (plan §1 target shape placed it in `tick.ts`). The barrel still re-exports `enqueueTick` correctly via the `WorkflowEngineService` object literal, so the public-surface contract is preserved; the internal placement deviates from the plan's target shape but does not affect any caller. Surfaced here for transparency only.

---

## Files modified by this run

None. No mechanical fixes were required. This run produced one artefact only: the review log at this path.

---

## Next step

**CONFORMANT** relative to Phase 2 declared scope — proceed to `pr-reviewer`.

The deferred Chunks 7 + 8 (WF1, WF3, WF4, WF6) remain `[status:open]` in `tasks/todo.md` and are targeted for a follow-up PR per the `handoff.md` remediation plan. They do NOT block this PR's review pipeline because the operator declared the deferral up front and the open items pre-date this branch.

For Phase 3 finalisation:
- `pr-reviewer` next.
- `reality-checker` after `pr-reviewer`.
- `dual-reviewer` (Codex) if available — otherwise REVIEW_GAP already on record.
- `chatgpt-pr-review` mandatory at Phase 3 (manual loop).
- Finalisation Step swaps `closure-pending-merge:slug:split-workflow-engine` → `[status:closed:pr:<num>]` in the merge commit per plan §6 acceptance criterion #13.
