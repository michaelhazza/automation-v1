# Spec Review Final Report — pre-prod-tenancy

**Spec:** `docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md`
**Spec commit at start:** `bb0b276671de652929c21b23a0e7eae8adcaaffe`
**Spec commit at finish:** `a9135930` (will be updated to the final-report commit hash on push)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 1 of 5
**Exit condition:** `operator-elected-early-exit-after-iteration-1` (non-standard — see "Exit rationale" below)
**Verdict:** READY_FOR_BUILD (1 iteration, 10 mechanical fixes applied; 0 directional / 0 ambiguous / 0 reclassified; no AUTO-DECIDED items routed to `tasks/todo.md`)

---

## Sections

- Exit rationale
- Iteration summary table
- Mechanical changes applied (by spec section)
- Rejected findings
- Directional and ambiguous findings (autonomously decided)
- Mechanically tight, but verify directionally

---

## Exit rationale

This is a deviation from the standard exit conditions in the spec-reviewer agent (`iteration-cap` / `two-consecutive-mechanical-only` / `codex-found-nothing` / `zero-acceptance-drought`).

The first Codex iteration produced 8 findings; the agent's rubric pass added 2 more for a total of 10, all classified `mechanical`. Every finding was applied. The round produced **zero directional findings** — meaning Codex and the rubric saw nothing that contradicted the project's framing or required scope/sequencing/architecture changes.

Per the agent's design notes ("hitting the cap is a sign the spec is still being shaped and should probably have stopped earlier"), the operator elected to short-circuit after iteration 1 rather than spend a second ~30-minute Codex cycle that would, at best, produce another small mechanical batch and trigger the `two-consecutive-mechanical-only` early-stop on iteration 2. The iteration-1 commit log (`a9135930`) plus this final report stand as the permanent record.

The MAX_ITERATIONS=5 lifetime cap is preserved — 4 iterations remain available for any future re-invocation. The two-consecutive-mechanical-only stopping heuristic is not satisfied at this exit (we have one mechanical-only round, not two), so the spec is **mechanically tight against iteration 1 only**, not against the tighter convergence the agent's standard exit would demonstrate. Operators reading this report after a future scope expansion should consider re-invoking the agent.

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 8 | 2 | 10 | 0 | 0 | 0 | 0 |

---

## Mechanical changes applied

Grouped by spec section:

### §0.2 — What this spec does

- Phase 1 table count restated as "61 currently-unregistered tenant tables" (was "60"); line now points at §3.2 / §3.4.1 as the source of truth and adds the `+ 4 stale + 2 caller-level = 67` breakdown.

### §1 — Verification log

- `SC-2026-04-26-1` row updated to enumerate the 67-violation total as `61 unregistered + 4 stale + 2 caller-level`, citing the two `systemMonitor` files for the caller-level breakdown.

### §2.1 — New migrations

- Migration batching rule rewritten: "one migration file per policy-shape batch — up to 4 canonical-org-isolation tables per file; tables that need parent-EXISTS or any other custom shape each get their own standalone file." Naming pattern updated to `0245_<batch>_rls.sql`.

### §2.2 — Source files modified

- Added `server/services/interventionService.ts` (Phase 2 — `recordOutcome` signature change `Promise<void>` → `Promise<boolean>` + `.onConflictDoNothing` body).
- Added `server/services/systemMonitor/baselines/refreshJob.ts` (Phase 1 — move existing justification comment within ±1 line of the `allowRlsBypass: true` flag).
- Added `server/services/systemMonitor/triage/loadCandidates.ts` (Phase 1 — same caller-level fix).

### §2.6 — Build artefacts (new subsection)

- New section listing `tasks/builds/pre-prod-tenancy/progress.md` (Phase 1 classification deliverable + Phase 2 load-test result + Phase 3 lock-scope verdicts) and `tasks/todo.md` (deferral entries per §9).

### §3.1 — Phase 1 goal

- Reframed to "drive `verify-rls-protected-tables.sh` to a CI-passing state (exit 0)"; added explicit "Gates are CI-only per CLAUDE.md" sentence so the acceptance criteria below cannot be misread as a local-run mandate.

### §3.2 — Inputs (current state)

- Replaced "63 unregistered + 4 stale = 67" with "61 unregistered + 4 stale + 2 caller-level = 67"; the breakdown now lists the two `systemMonitor` files explicitly.

### §3.4.1 — Unregistered tenant tables

- Replaced the inline comma-separated list with a structured 61-row table: `Table | Owning migration | Has policy? | Verdict | Notes`. Every cell is `_(implementer)_` to flag the pending-fill state. Two rows (`workflow_engines`, `workflow_runs`) carry sister-branch-scope-out notes per §0.4. The framing block above the table now explicitly states "the verdict column is INTENTIONALLY EMPTY at spec-authoring time."

### §3.4.2 — Stale registry entries

- "Hard requirement" wording slightly tightened — replaced a `grep -nE` recipe with prose phrasing so the spec doesn't read as a local-run instruction.

### §3.4.3 — Caller-level violations (new subsection)

- New table covering the two `systemMonitor` callers with per-file remediation. Notes that `server/services/systemMonitor/**` is not in either sister-branch scope-out list, so the edits land in this branch.

### §3.5 — Implementation approach

- Step 5 added: "Resolve the §3.4.3 caller-level violations on the two `systemMonitor` files (move/add the inline `// allowRlsBypass: …` justification comment within ±1 line of the flag)." Existing step 5 ("Add `run_gate …` to `run-all-gates.sh`") moved to step 6.

### §3.6 — Acceptance criteria

- "`bash scripts/verify-rls-protected-tables.sh` exits 0" rewritten to "CI gate `verify-rls-protected-tables.sh` exits 0 on the post-merge `pre-prod-tenancy` head (gates run by CI, not locally — per CLAUDE.md)."

### §4.3 — Phase 2 job refactor

- Added explicit before/after signature for `interventionService.recordOutcome`:
  - before: `async recordOutcome(data: { ...existing fields... }): Promise<void>`
  - after: `async recordOutcome(data: { ...existing fields... }): Promise<boolean>`
- Parenthetical pinning: input shape is the existing inline object literal at `server/services/interventionService.ts:53–70`, reused unchanged.
- Tightened ambiguous "`db` here is whatever the existing service uses — likely the org-scoped DB" to "the existing module-level handle the service already uses."

### §4.8 — Phase 2 acceptance

- Load-test acceptance reworded: "5× speedup vs. legacy must be demonstrated against either the full §4.7 fixture (10,000 rows / 5 orgs) or the smaller fallback fixture (1,000 rows / 2 orgs); only the absolute rows/sec/org figure may be deferred."
- "`bash scripts/verify-rls-protected-tables.sh` still exits 0" replaced with "Phase 2 schema change introduces no new RLS-gate violations of its own. Phase 1 owns driving the gate to exit 0; Phase 2 must not *worsen* it. See §6 / §8.1 for ordering."

### §5.4 — Phase 3 acceptance

- "`bash scripts/verify-rls-protected-tables.sh` still exits 0" rewritten to "CI gate `verify-rls-protected-tables.sh` still exits 0 (Phase 3 must not regress the Phase 1 deliverable; gates run by CI)."

### §5.6 — Per-job concurrency contract (new subsection)

- New Section-10 §10.3 contract for Phase 3. Pattern A (enumeration-only lock) vs. Pattern B (per-org session-level lock required) decision tree pinned. Pre-commit `progress.md` deliverable per job. Idempotency posture (`state-based`). Retry classification (`safe`).

### §6 — Migration sequence

- Order-1 row note expanded: `0244` is independent of Phase 1 *as a schema migration*, but the registry edit for `intervention_outcomes` is a Phase 1 deliverable (§3.5) — Phase 1 still owns `verify-rls-protected-tables.sh` exit 0, not Phase 2 (§4.8).

### §10 — Section-10 contracts (table)

- Phase column expanded to "Phase 2 + Phase 3" for §10.1 / §10.2 / §10.3 / §10.5, with cross-links to §5.6 in addition to §4.4 / §4.5 / §4.6.
- Closing paragraph rewritten to acknowledge Phase 3's lock-lifetime change.

---

## Rejected findings

None. Every finding (8 Codex + 2 rubric) was classified `mechanical` and accepted.

---

## Directional and ambiguous findings (autonomously decided)

None. The first Codex iteration plus the agent's rubric pass surfaced exclusively mechanical findings.

If the operator wishes to re-invoke the agent for a directional pass after future scope changes, 4 iterations remain on the MAX_ITERATIONS=5 lifetime cap.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's first review pass. No findings remain unresolved; no AUTO-DECIDED items were routed to `tasks/todo.md`. However:

- **Iteration count was 1, not 2-or-more.** The standard agent flow prefers exiting on `two-consecutive-mechanical-only`, which provides a stronger convergence signal. Operator elected to exit early on diminishing-returns basis. If future scope changes land or if a sister-branch merge surfaces new tables, re-invoke the agent (4 iterations remain on the lifetime cap).
- **Directional findings are not what this review surfaces.** Automated review converges on known mechanical-class problems. It does not generate insight from product judgement. The operator already ran a Section-0 verification pass before authoring (closure citations live in §1) and confirmed 14 of 17 source-brief items were already shipped on `main` — that is the directional-validation step this report does not replicate.
- **The review did not prescribe what to build next.** Sprint sequencing, scope trade-offs, and priority decisions are still the operator's job.

**Recommended next step:** read the spec's framing sections (§0 + §1), confirm the three-phase scope still matches your intent, and then invoke the architect agent to decompose into chunks at `tasks/builds/pre-prod-tenancy/plan.md`. Stop at the plan gate per CLAUDE.md model-guidance rule (Opus → Sonnet for execution).
