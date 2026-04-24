# Spec Conformance Log

**Spec:** `docs/hierarchical-delegation-dev-spec.md` §6.1 + `tasks/builds/paperclip-hierarchy/plan.md` Chunk 3a
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Head at check:** `b1a4e61f076cde0d270ead905e5cf3d51788522b`
**Commit at finish:** `b0479e9a`
**Base (merge-base main):** `399f3864b5187d2be99ca9f9807793699560ece7`
**Scope:** Chunk 3a — pure + impure hierarchy builder, `SkillExecutionContext.hierarchy`, `agentExecutionService` integration
**Run at:** 2026-04-23T00:00:00Z

---

## Summary

- Requirements extracted:     16
- PASS:                       15
- MECHANICAL_GAP → fixed:      1
- DIRECTIONAL_GAP → deferred:  0
- AMBIGUOUS → deferred:        0

**Verdict:** CONFORMANT_AFTER_FIXES

---

## Requirements

### New files

**REQ #1 — `MAX_HIERARCHY_DEPTH = 10`** — PASS
`hierarchyContextBuilderServicePure.ts:13`. Cap checked as `depth >= MAX_HIERARCHY_DEPTH` before increment. Boundary test "depth of exactly MAX_HIERARCHY_DEPTH does not throw" passes; deeper chain throws `depth_exceeded`.

**REQ #2 — `HierarchyContextBuildError` class with three codes** — PASS
`hierarchyContextBuilderServicePure.ts:20-28`. Codes: `agent_not_in_subaccount | depth_exceeded | cycle_detected`.

**REQ #3 — `buildHierarchyContextPure({ agentId, agents }): HierarchyContext`** — MECHANICAL_GAP → FIXED
- Spec quote (docs/hierarchical-delegation-dev-spec.md:659): `agents: Array<{ id: string; parentSubaccountAgentId: string | null }>`
- Gap: input parameter key was `roster`, not `agents`.
- Fix: renamed input key `roster` -> `agents` in signature + JSDoc (pure), the `buildForRun` call site (impure), and 22 test call sites. Internal body variable preserved via `const { agentId, agents: roster } = input;`. `RosterRow` type alias and fixture variable names (`baseRoster`, `cyclicRoster`, etc.) left as-is — internal implementation details not named by the spec.
- Re-verified post-fix: `npx tsx server/services/__tests__/hierarchyContextBuilderServicePure.test.ts` → 21/21 PASS.

**REQ #4 — Algorithm: parentId from caller row** — PASS
`hierarchyContextBuilderServicePure.ts:53-62`. Missing caller throws `agent_not_in_subaccount`; else `parentId = callerRow.parentSubaccountAgentId ?? null`.

**REQ #5 — Algorithm: childIds filter + sort asc** — PASS
`hierarchyContextBuilderServicePure.ts:65-68`. `.filter(...).map(...).sort()` — deterministic. Covered by the reversed-order determinism test.

**REQ #6 — Algorithm: upward walk + cycle detection + depth cap** — PASS
`hierarchyContextBuilderServicePure.ts:73-102`. `visited` Set throws `cycle_detected` on revisit; `depth >= MAX_HIERARCHY_DEPTH` throws `depth_exceeded` before increment.

**REQ #7 — Algorithm: rootId = terminal ancestor** — PASS
`hierarchyContextBuilderServicePure.ts:104`. `rootId = current.id` after loop terminates on `parentSubaccountAgentId === null`.

**REQ #8 — `buildForRun(...)` signature** — PASS
`hierarchyContextBuilderService.ts:37-41`. Input `{ agentId, subaccountId, organisationId }`, return `Promise<Readonly<HierarchyContext>>`.

**REQ #9 — Uses `db` directly (not `getOrgScopedDb`)** — PASS
`hierarchyContextBuilderService.ts:11,43`. Caller-provided criteria explicitly accepts `db`; `executeRun` call site is outside `withOrgTx`.

**REQ #10 — `Object.freeze(pureResult)` per INV-4** — PASS
`hierarchyContextBuilderService.ts:60`. `return Object.freeze(result)`.

**REQ #11 — Re-exports `HierarchyContextBuildError`** — PASS
`hierarchyContextBuilderService.ts:13-21`. Named import + `export { HierarchyContextBuildError }`.

**REQ #12 — Test coverage (8 scenarios)** — PASS
All named scenarios covered in `__tests__/hierarchyContextBuilderServicePure.test.ts`: root (parentId null, depth 0, rootId === agentId, childIds populated) L98-117; middle manager (parentId set, childIds populated, depth 1) L123-141; leaf (childIds empty) L147-165; deterministic childIds L171-182; cycle_detected (two-node + self-loop) L204-225; depth_exceeded + boundary at exactly MAX_DEPTH L227-257; agent_not_in_subaccount L188-202; root childIds completeness L263-271. Harness is tsx-runnable; 21/21 PASS.

### Modified files

**REQ #13 — `SkillExecutionContext.hierarchy?: Readonly<HierarchyContext>`** — PASS
`skillExecutor.ts:178`. Optional + `Readonly<>`.

**REQ #14 — Import from `shared/types/delegation.ts`** — PASS
`skillExecutor.ts:2`. `import type { HierarchyContext } from '../../shared/types/delegation.js';`

**REQ #15 — `buildForRun` called BEFORE `skillService.resolveSkillsForAgent` (INV-4)** — PASS
`agentExecutionService.ts`: block `── 4.5. Build immutable hierarchy snapshot ──` at L616-651 runs before block `── 5. Resolve skills ──` and the `resolveSkillsForAgent` call at L672.

**REQ #16 — Error handling + fire-and-forget depth UPDATE + threaded through skillExecutionContext** — PASS
- `agentExecutionService.ts:637-649` — `instanceof HierarchyContextBuildError` branch calls `logger.warn('hierarchy_not_built_for_run', ...)` and leaves `hierarchyContext` undefined. Non-build errors rethrow (DB failures surface).
- `agentExecutionService.ts:628-636` — `db.update(agentRuns).set({ hierarchyDepth: ..., updatedAt: ... }).where(...).catch(...)` is NOT awaited. True fire-and-forget with WARN-level catch.
- `agentExecutionService.ts:2124` — `hierarchy: hierarchyContext` inside `skillExecutionContext` object. Threaded via `LoopParams` (L1293 → L2077 destructure).

### Invariants

- **INV-4 (freeze + Readonly + built once before skill resolver):** covered by REQ #10 / #13 / #15.
- **`HierarchyContextBuildError` NOT in `shared/types/delegation.ts`:** verified — only `HierarchyContext`, delegation enums, and error-code string constants live there.
- **`hierarchy` is optional:** `hierarchy?:` at `skillExecutor.ts:178`, `hierarchyContext?:` at `agentExecutionService.ts:2052`.

---

## Mechanical fixes applied

| File | Change |
|------|--------|
| `server/services/hierarchyContextBuilderServicePure.ts` | Renamed input parameter `roster` -> `agents` in signature + JSDoc (internal body variable retained via destructure-rename). |
| `server/services/hierarchyContextBuilderService.ts` | Renamed call-site key `roster: rows` -> `agents: rows`. |
| `server/services/__tests__/hierarchyContextBuilderServicePure.test.ts` | Renamed 22 call-site keys `roster:` -> `agents:`. Fixture variable names and `RosterRow` type import preserved. |

Re-verification: 21/21 tests pass post-fix.

---

## Directional / ambiguous gaps

None.

---

## Files modified by this run

- `server/services/hierarchyContextBuilderServicePure.ts`
- `server/services/hierarchyContextBuilderService.ts`
- `server/services/__tests__/hierarchyContextBuilderServicePure.test.ts`

---

## Next step

**CONFORMANT_AFTER_FIXES** — one mechanical gap closed (parameter-name rename to match spec §6.1 Pure API). Re-run `pr-reviewer` on the expanded changed-code set so the reviewer sees the post-fix state. No directional gaps, no `tasks/todo.md` entries.
