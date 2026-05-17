# Spec Review Final Report

**Spec:** `tasks/builds/wave-4-architectural-and-duplication/spec.md`
**Spec commit at start:** 77b70f82
**Spec commit at finish:** ce5b4a5f
**Spec-context commit:** 62497257
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 10 | 5 (R1/R2/R3 subsumed into Codex #3; R4/R5 distinct on test-gate policy) | 9 Codex + 2 distinct rubric + 2 cascade cleanups | 0 | 0 | 0 | 1 (HandlerContext split — routed to tasks/todo.md) |
| 2 | 7 | 0 | 7 | 0 | 0 | 0 | 0 |
| 3 | 3 | 0 | 3 | 0 | 0 | 0 | 0 |

**Total findings adjudicated:** 20 Codex findings + 5 rubric findings = 25 distinct findings.
**Total mechanical fixes applied:** 23 (the 5 rubric findings reduce to 3 distinct fix sites + 2 test-gate framing changes; the 1 directional finding is routed for deferred review).

---

## Mechanical changes applied

### Frontmatter and top-matter (iter 1)
- Added Markdown frontmatter block (Status / Spec date / Last updated / Author / Build slug) below the existing YAML.
- Added Lifecycle Declaration table (5 fields: Platform Hygiene cluster, Growth, Risk Surface "None.", on-incident-only review cadence).
- Added ABCd Estimate table (L/L/S/S — large to acquire, large to build, small to carry, small to decommission).

### §1 Scope — present-state verification (iter 1, refined iter 3)
- Added §1.1 with a 12-row verification table mapping each scoped item to evidence pointers in the live tree.

### §2 Goals (iter 1, iter 2)
- Goal #5 — replaced "~1,800 lines" with "~1,200-1,500 lines" with breakdown.
- Goal #4 — reframed the "under 30 cycles" claim to acknowledge the 73-43=30 arithmetic; hard bar = "no CD1 edge remains", soft target = 28-31.

### §4 Framing Assumptions + §4.1 Files-to-change (iter 1, iter 2, iter 3)
- Deleted prose "Total touch surface" sentence; replaced with §4.1 sub-tables.
- Removed stale `notifyOperatorFanout` reference.
- Removed non-existent `client/src/pages/system/` path reference.
- "New files" table: 10 entries (8 DUP + 2 CD1).
- "FE4 sub-components" table: 2 placeholder rows + optional third with chunk-0 confirmation requirement.
- "Modified files" table: 16 entries.
- "Deleted files" table: 2 entries (the two DUP4 messageRender copies).
- Reframed total-files count as conditional on FE4 verdict (12 default / 10 override / 13 if third extraction needed).
- Updated FE4-default framing-assumption bullet to reference §7 binding verdicts.

### §5.2 HandlerContext contract (iter 1, iter 2, iter 3)
- Split §5.2 into §5.2.1 contract table + §5.2.2 conceptual shape.
- Pinned the contract: type module `server/services/handlerContextTypes.ts`, factory module `server/lib/buildHandlerContext.ts`, LAST-parameter position, producer/consumers, `import type` discipline, ~12-method cap.
- Corrected export shapes in code samples — `WorkflowEngineService` is a const facade (uppercase), `skillExecutor` is a const (lowercase). Type module now uses `typeof` to derive structural types from the value exports.
- Moved boot wiring from chunk 1 to chunk 4 (after receiving signatures land in chunks 2-3).

### §5.4 CD1 acceptance (iter 1)
- Reframed `madge --circular` as "CI's npm run check:circular" (CI-only).
- Replaced "existing Vitest passes" with targeted Vitest unit tests authored in this build.

### §6 Duplication extractions (iter 1, iter 2, iter 3)
- Locked module paths and export names for DUP1, DUP2, DUP3, DUP4, DUP5, DUP8.
- Acknowledged intentional chunk-0 export-name lock for DUP7 and DUP9, with spec-update requirement before extraction.
- Added per-DUP acceptance lines naming old files, new shared module, jscpd signal.
- DUP4: clarified that the two `messageRender.tsx` source copies are deleted (not left as shims).
- DUP8: scoped all 6 prune-job files (not the 4 from the audit baseline) — closes the §12-vs-DUP8 contradiction.

### §7 Frontend complexity (iter 1)
- FE1: binding default = TRIM (remove the 4 MetricCard tiles); override path = "trim to N tiles" at chunk 0.
- FE4: binding default = EXTRACT (IncidentTimeline + IncidentDetailDrawer); override = "accept the LOC" with documented rationale.
- FE5+FE6: binding default = ACCEPT all four (admin/power-user header comment); override = per-page trim instructions.

### §8 Acceptance Criteria (iter 1, iter 2)
- #1 reframed as "CI's npm run check:circular"; soft target 28-31 cycles.
- #2 reframed estimate as ~1,200-1,500 lines with breakdown.
- #3 references §7 binding verdicts.
- #7 reframed as "CI's verify-duplicate-blocks.sh baseline reports lower" — explicit "do NOT run locally" per CLAUDE.md.
- #8 reframed to limit local tests to targeted Vitest for new pure-function code only; full suite is CI-only.

### §9 Chunks (iter 3)
- Chunks 1-4 narrative updated: chunk 1 = author types + factory in isolation; chunks 2+3 = signature migration; chunk 4 = wire boot + verify cycle break.

### §11 + §12 (iter 2)
- §11 retitled framing as "non-scope, not deferred work".
- §12 Deferred Items added — "None" with explicit non-scope-vs-deferred distinction.

---

## Rejected findings

None. Across 3 iterations and 25 distinct findings, 0 were rejected — every Codex finding was either applied mechanically (24) or auto-decided directionally (1).

---

## Directional and ambiguous findings (autonomously decided)

| Iter | Finding | Class | Decision | Rationale |
|---|---|---|---|---|
| 1 | "Pure type module vs boot-time factory should be split" (Codex #2) | directional (architecture signal) | AUTO-DECIDED (accept) | Standard cycle-break pattern. If the type lives in the same file as the wiring factory, the cycle returns through the type module and the CD1 break does not actually land. Routed to `tasks/todo.md` under `## Deferred spec decisions — wave-4-architectural-and-duplication` for the operator to confirm at chunk 0. |

No AUTO-REJECT (framing) and no AUTO-REJECT (convention) entries — none of Codex's findings violated framing assumptions or conventions. The spec was reasonable on framing from the start; the entire review surface was mechanical tidying.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric, the spec-authoring-checklist (§0-§12), and three rounds of Codex review. The autonomous decision tree resolved every directional surface. However:

- The review did not re-verify the framing assumptions (pre-production, static-gates-primary, prefer-existing-primitives). The spec's framing was already consistent with `docs/spec-context.md` at the start of iteration 1 and was not touched by the review.
- The review did not catch directional findings Codex and the rubric did not surface. Three iterations of automated review converge on known classes of problem; novel architectural risk that depends on product judgement is the operator's responsibility.
- The review did not prescribe what to build first within the wave. Sprint sequencing across waves is the operator's call.

### What the operator should verify before starting implementation

1. **Chunk 0 obligations the spec now imposes:** confirm the architect can produce (a) the locked `HandlerContext` method set (capped ~12 methods), (b) the DUP7 + DUP9 export names with a spec update, (c) the FE4 sub-component names (or select the override path), (d) the FE1 trim list (default or operator-specified subset), (e) the FE5+FE6 per-page acceptance text. None of these are blocking the spec; they are chunk-0 deliverables.
2. **AUTO-DECIDED item routed to tasks/todo.md:** the HandlerContext type-module-vs-factory split is the right default but the operator may collapse to one file if chunk 0 confirms no cycle reintroduction. See `tasks/todo.md § Deferred spec decisions — wave-4-architectural-and-duplication`.
3. **Prune-job scope decision:** the spec now commits to all 6 prune-job files in DUP8 (not the 4 from the audit baseline). If the operator wants the lighter scope, edit §6.7 + §4.1 before chunk 11 begins. The current spec says all 6.

**Recommended next step:** read §1.1 (present-state verification), §4.1 (file inventory), §5.2.1 (HandlerContext contract), §7 (binding FE verdicts), and §9 (chunk sequencing). If those four sections match your intent, the spec is ready for `architect` to write the implementation plan.
