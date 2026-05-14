# Spec Conformance Log — Chunk 4a recheck

**Spec:** `docs/hierarchical-delegation-dev-spec.md` + `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4a, lines 567–625)
**Spec commit at check:** `ac60f6e66c36d16bbf34b084db11fa3b7798bba9`
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Base:** `399f3864b5187d2be99ca9f9807793699560ece7`
**Scope:** Targeted recheck of REQ #C4a-1..#C4a-5 (test-coverage gaps) only. REQ #C4a-6 (return-shape contract) is architectural and intentionally out of scope for this recheck — it remains in `tasks/todo.md § PR Review deferred items / ### paperclip-hierarchy`.
**Changed-code set for recheck:**
 - `server/services/skillExecutorDelegationPure.ts`
 - `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts`
 - `server/services/__tests__/skillExecutor.reassignTask.test.ts`
**Run at:** 2026-04-24T00:00:00Z
**Prior log:** `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-4a-2026-04-24T00-00-00Z.md`
**Remediation commit:** `ac60f6e6` — `fix(paperclip-hierarchy): chunk 4a spec gap — extract spawn/reassign precondition pure helpers + tests`
**Commit at finish:** `f6917d68`

---

## Summary

- Requirements rechecked:      5 (C4a-1..C4a-5)
- PASS:                        5
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  0
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      1 (C4a-6, architectural — still tracked in `tasks/todo.md`)

**Verdict:** CONFORMANT (for the rechecked scope; C4a-6 remains open by design)

---

## Remediation pattern

The main session chose **option (a) — extract outer-handler gates into pure helpers** from `skillExecutorDelegationPure.ts`, consistent with the existing pure-test pattern. Two new helpers were added:

- `evaluateSpawnPreconditions({ hierarchy, currentHandoffDepth, maxHandoffDepth, effectiveScope }) → { ok, … }` — covers hierarchy-missing, depth-limit, subaccount-scope rejection.
- `evaluateReassignPreconditions({ hierarchy }) → { ok, … }` — covers hierarchy-missing for `reassign_task`.

Both are exported from `server/services/skillExecutorDelegationPure.ts`. Verified in this recheck:

```
$ grep -n '^export function evaluate' server/services/skillExecutorDelegationPure.ts
134:export function evaluateSpawnPreconditions(input: { … })
162:export function evaluateReassignPreconditions(input: { … })
```

The constant `MAX_HANDOFF_DEPTH_SPAWN = 5` (line 126) is exported alongside and documented as mirroring `MAX_HANDOFF_DEPTH` in `skillExecutor.ts`.

---

## Verification verdicts

### REQ #C4a-1 — `spawn_sub_agents`: `effectiveScope === 'subaccount'` → `cross_subtree_not_permitted`

**Verdict:** PASS

**Evidence:** `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts:231–239`

```ts
test('subaccount scope → cross_subtree_not_permitted', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: hierarchyWithChild,
    currentHandoffDepth: 0,
    maxHandoffDepth: 5,
    effectiveScope: 'subaccount',
  });
  assertEqual(result, { ok: false, errorCode: 'cross_subtree_not_permitted' }, 'result');
});
```

Asserts the exact error code the spec names (§6.3 step 2). Pure helper `evaluateSpawnPreconditions` returns `{ ok: false, errorCode: 'cross_subtree_not_permitted' }` when `effectiveScope === 'subaccount'` (`skillExecutorDelegationPure.ts:148–150`). Test run: `17 passed, 0 failed`.

### REQ #C4a-2 — `spawn_sub_agents`: `handoffDepth >= maxHandoffDepth` → `max_handoff_depth_exceeded`

**Verdict:** PASS

**Evidence:** `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts:211–219`

```ts
test('depth at limit → max_handoff_depth_exceeded', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: hierarchyWithChild,
    currentHandoffDepth: 5,
    maxHandoffDepth: 5,
    effectiveScope: 'children',
  });
  assertEqual(result, { ok: false, errorCode: 'max_handoff_depth_exceeded' }, 'result');
});
```

Covers the `currentHandoffDepth + 1 > maxHandoffDepth` branch (`skillExecutorDelegationPure.ts:145–147`). A complementary "depth below limit → ok" test (lines 221–229) pins the happy path. Test run: passes.

### REQ #C4a-3 — `spawn_sub_agents`: `hierarchy: undefined` → `hierarchy_context_missing`

**Verdict:** PASS

**Evidence:** `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts:201–209`

```ts
test('hierarchy missing → hierarchy_context_missing', () => {
  const result = evaluateSpawnPreconditions({
    hierarchy: undefined,
    currentHandoffDepth: 0,
    maxHandoffDepth: 5,
    effectiveScope: 'children',
  });
  assertEqual(result, { ok: false, errorCode: 'hierarchy_context_missing' }, 'result');
});
```

Covers the hierarchy-missing branch (`skillExecutorDelegationPure.ts:142–144`). Test run: passes.

### REQ #C4a-4 — `spawn_sub_agents`: end-to-end chain — `resolveWriteSkillScope` (no children → `subaccount`) → `evaluateSpawnPreconditions` rejects

**Verdict:** PASS

**Evidence:** `server/services/__tests__/skillExecutor.spawnSubAgents.test.ts:241–261`

```ts
test('adaptive default for leaf caller (no children) resolves subaccount → evaluateSpawnPreconditions rejects', () => {
  const leafHierarchy: Readonly<HierarchyContext> = {
    agentId: 'sa-caller', parentId: null, childIds: [], rootId: 'sa-caller', depth: 0,
  };
  const resolved = resolveWriteSkillScope({ rawScope: undefined, hierarchy: leafHierarchy });
  assertEqual(resolved, 'subaccount', 'resolved scope');
  const result = evaluateSpawnPreconditions({
    hierarchy: leafHierarchy, currentHandoffDepth: 0, maxHandoffDepth: 5, effectiveScope: resolved,
  });
  assertEqual(result, { ok: false, errorCode: 'cross_subtree_not_permitted' }, 'precondition result');
});
```

Chains both helpers exactly as the spec (plan.md line 573) requires: adaptive default resolves to `subaccount` for a childless caller, and the precondition evaluator then rejects. Test run: passes.

### REQ #C4a-5 — `reassign_task`: `evaluateReassignPreconditions({ hierarchy: undefined })` → `hierarchy_context_missing`

**Verdict:** PASS

**Evidence:** `server/services/__tests__/skillExecutor.reassignTask.test.ts:222–225`

```ts
test('hierarchy missing → hierarchy_context_missing', () => {
  const result = evaluateReassignPreconditions({ hierarchy: undefined });
  assertEqual(result, { ok: false, errorCode: 'hierarchy_context_missing' }, 'result');
});
```

Covers the hierarchy-missing branch of `evaluateReassignPreconditions` (`skillExecutorDelegationPure.ts:167–169`). A complementary "hierarchy present → ok" test (lines 227–237) pins the happy path. Test run: `15 passed, 0 failed`.

### REQ #C4a-6 (out of scope for this recheck) — return-shape contract

**Verdict:** OUT_OF_SCOPE (architectural; still tracked)

Per the caller invocation and per `CLAUDE.md § Processing spec-conformance NON_CONFORMANT findings`, the return-shape gap is architectural and intentionally deferred to `tasks/todo.md § PR Review deferred items / ### paperclip-hierarchy`. Not re-verified here. It remains correctly recorded in both (a) the dated section `## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4a (2026-04-23)` at `tasks/todo.md:558–561`, and (b) the architectural backlog at `tasks/todo.md:331`.

---

## Test-run evidence

```
$ npx tsx server/services/__tests__/skillExecutor.spawnSubAgents.test.ts
classifySpawnTargets
  PASS  all targets in children scope → all accepted
  PASS  one out-of-scope target in children scope → rejected list contains it
  PASS  descendants scope includes grandchildren
  PASS  all accepted when scope=descendants and all are descendants
  PASS  grandchild rejected in children scope (not a direct child)

resolveWriteSkillScope
  PASS  explicit "children" override when hierarchy has no children → returns "children"
  PASS  adaptive default with children → "children"
  PASS  adaptive default without children → "subaccount"
  PASS  explicit "descendants" → "descendants"
  PASS  explicit "subaccount" → "subaccount"
  PASS  null rawScope adaptive with children → "children"
  PASS  unknown string rawScope falls through to adaptive default

evaluateSpawnPreconditions
  PASS  hierarchy missing → hierarchy_context_missing
  PASS  depth at limit → max_handoff_depth_exceeded
  PASS  depth below limit → ok
  PASS  subaccount scope → cross_subtree_not_permitted
  PASS  adaptive default for leaf caller (no children) resolves subaccount → evaluateSpawnPreconditions rejects

Results: 17 passed, 0 failed
```

```
$ npx tsx server/services/__tests__/skillExecutor.reassignTask.test.ts
computeReassignDirection
  PASS  (6/6)

validateReassignScope
  PASS  (7/7)

evaluateReassignPreconditions
  PASS  hierarchy missing → hierarchy_context_missing
  PASS  hierarchy present → ok

Results: 15 passed, 0 failed
```

Total across both files: **32 passed, 0 failed**.

---

## Mechanical fixes applied

None — this is a recheck. All rechecked items passed without intervention.

---

## Directional / ambiguous gaps

None for the rechecked scope.

---

## Files modified by this run

- `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-chunk-4a-recheck-2026-04-24T00-00-00Z.md` (this log)

No source files modified. `tasks/todo.md` not modified — C4a-1..C4a-5 line items in the dated section `## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4a (2026-04-23)` remain as the raw record; per `CLAUDE.md`'s "append-only, never rewrite" rule, they are closed by noting the closure in this log rather than by editing the dated section.

---

## Next step

**CONFORMANT** (for the C4a-1..C4a-5 recheck scope). Proceed to `pr-reviewer` on the expanded changed-code set for Chunk 4a. REQ #C4a-6 remains deferred under `## PR Review deferred items / ### paperclip-hierarchy` and does not block the PR flow per the caller's invocation.
