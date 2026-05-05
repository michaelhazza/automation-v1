# PR Review Log — paperclip-hierarchy Chunk 3b

**Files reviewed:**
- `server/tools/config/configSkillHandlersPure.ts`
- `server/tools/config/__tests__/configSkillHandlersPure.test.ts`
- `server/tools/config/configSkillHandlers.ts` (lines ~1–30, ~489–620)
- `server/skills/config_list_agents.md`
- `server/skills/config_list_subaccounts.md`
- `server/skills/config_list_links.md`

**Reviewed at:** 2026-04-24T00-00-00Z
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` § Chunk 3b (lines 503–556)

---

## Blocking Issues

No blocking issues found.

Correctness of all three target helpers verified against the spec:

1. **`computeDescendantIds` BFS** — correct child-map construction, cycle-safe via `visited: Set<string>`, caller excluded from result.
2. **`resolveEffectiveScope`** — all four branches correct.
3. **DB roster query** — correct table, columns, filters.
4. **WARN emission** — fires exactly once at handler entry when `!context.hierarchy`. Tag matches spec.
5. **`listAllAgents` delegation** — pre-existing service call unchanged, no regression.
6. **Backward compatibility** — agents with zero `childIds` get `'subaccount'` adaptive default, identical to pre-change behaviour.

## Strong Recommendations

### SR-1 — Roster query missing explicit `organisationId` filter (FIXED in-session)

The roster query filtered by `subaccountId + isActive` only. Added `eq(subaccountAgents.organisationId, context.organisationId)` per architecture convention that all queries include an explicit org filter.

### SR-2 — WARN parity across three list skills

WARN fires only in `executeConfigListAgents`. The two signature-consistency handlers don't consume `context.hierarchy` so no fallthrough exists. Acceptable — added inline comment to codify the divergence (deferred to backlog).

### SR-3 — Handler-level integration test for WARN log (already in tasks/todo.md)

The WARN-log assertion is tracked as a deferred item from spec-conformance. Policy-compliant per `runtime_tests: pure_function_only`.

### SR-4 — Inactive intermediate agent breaks descendant BFS

The active-only roster filter means an inactive agent hides its active grandchildren. Behaviour is conservative ("agents I can delegate to"). Noted for future product decision if permissive semantics are desired post-reorg.

## Observations

- `mapSubaccountAgentIdsToAgentIds` silent-drop behaviour is load-bearing for INV-4 stale-context tolerance — JSDoc mentions it, good.
- `RosterEntry.parentSubaccountAgentId` comment is slightly imprecise (says "null for root" but "null for any entry with no parent" is more accurate).
- `_input` vs `input` naming inconsistency between `executeConfigListSubaccounts` and `executeConfigListLinks` — intentional, not a bug.

## Verdict

**APPROVED** — SR-1 fixed in-session. All other items are observations or tracked backlog.
