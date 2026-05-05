# PR Review Log — paperclip-hierarchy Chunk 4d

**Reviewed:** 2026-04-25T00:45:00Z
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`

**Files:**
- `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildrenPure.ts`
- `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts`
- `server/services/workspaceHealth/detectors/__tests__/explicitDelegationSkillsWithoutChildren.test.ts`
- `server/services/workspaceHealth/detectors/index.ts`
- `architecture.md` (lines 3033–3083)

---

## Blocking Issues

### B1. architecture.md §DelegationScope — delegationScope is NOT stored on subaccountAgents

Line ~3047: "Scope is stored on the subaccount_agent row and read into `HierarchyContext.delegationScope`."

`server/db/schema/subaccountAgents.ts` has NO `delegationScope` / `delegation_scope` column. That column lives only on `agent_runs` and `delegation_outcomes`. `delegationScope` is a per-call skill parameter with an adaptive default computed inside the skill handler.

**Fix:** "Scope is a per-call parameter passed to `spawn_sub_agents` / `reassign_task` and the three `config_list_*` read skills. The value is persisted on `agent_runs.delegation_scope` and `delegation_outcomes.delegation_scope` for the run; it is NOT stored on `subaccount_agents`."

### B2. architecture.md §HierarchyContext — wrong field list

Claims: `subaccountAgentId`, `subaccountId`, `parentSubaccountAgentId | null`, `childIds[]`, `delegationScope`, `hierarchyDepth`.

Actual shape from `shared/types/delegation.ts`: `{ agentId: string; parentId: string | null; childIds: string[]; rootId: string; depth: number; }`.

None of `subaccountAgentId`, `subaccountId`, `parentSubaccountAgentId`, `delegationScope`, `hierarchyDepth` exist on `HierarchyContext`.

**Fix:** Replace with `agentId`, `parentId | null`, `childIds[]`, `rootId`, `depth`.

### B3. architecture.md §Adaptive default — scope too narrow

Claims: "resolver uses `subaccount` when the caller is the subaccount root." Actually applies to ANY leaf agent (`childIds.length === 0`), not only the subaccount root.

**Fix:** "if `delegationScope` is null, the resolver uses `children` when `childIds.length > 0`, and `subaccount` otherwise (any leaf agent, including non-root leaves with explicit skill attachment)."

---

## Strong Recommendations

### SR1. Missing test: explicit trio PLUS unrelated skills → still emits finding

Add test: `skillSlugs: ['config_list_agents', 'spawn_sub_agents', 'reassign_task', 'fetch_url']`, `hasActiveChildren: false` → result.length === 1.

### SR2. Type-narrow `filter(Boolean)` instead of `as string[]` assertion

`explicitDelegationSkillsWithoutChildren.ts:66`: use `.filter((id): id is string => id !== null)` instead of `.filter(Boolean) as string[]`.

### SR3. Test 5 redundancy — "derived-only" test overlaps with "with children" test

Test 5 uses `hasActiveChildren: true` which short-circuits before checking slugs. Better: use `skillSlugs: [], hasActiveChildren: false` (exercises the `!skillSlugs`/empty guard distinctly).

---

## Non-Blocking

- Message duplication between detector and spec §6.9 — consider extracting to const with sync comment.
- Step-number reference in architecture.md ("step 4 of agentExecutionService") is fragile — describe by phase instead.
- Detector correctly registered in ASYNC_DETECTORS only (not ALL_DETECTORS). Wiring verified.

---

## Verdict

BLOCKED on three architecture.md factual errors (B1, B2, B3). Detector code, tests, and registration are correct and ship-ready.
