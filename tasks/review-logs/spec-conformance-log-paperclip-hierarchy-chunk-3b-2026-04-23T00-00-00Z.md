# Spec Conformance Log

**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` § Chunk 3b (mirrors `docs/hierarchical-delegation-dev-spec.md` §4.1, §6.2, INV-2, INV-4)
**Spec commit at check:** `8be9d050` (Chunk 3b commit)
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Base:** merge-base with `main`
**Scope:** Chunk 3b only — Scope param on three list skills
**Changed-code set (6 files):**
- `server/tools/config/configSkillHandlers.ts` (modified)
- `server/tools/config/configSkillHandlersPure.ts` (new)
- `server/tools/config/__tests__/configSkillHandlersPure.test.ts` (new)
- `server/skills/config_list_agents.md` (modified)
- `server/skills/config_list_subaccounts.md` (modified)
- `server/skills/config_list_links.md` (modified)
**Run at:** 2026-04-23T00-00-00Z

---

## Summary

- Requirements extracted:     21
- PASS:                       17
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 4
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (4 directional gaps — behavioral tests for `executeConfigListAgents`).

---

## Requirements extracted

| # | Cat. | Spec | Requirement | Verdict |
|---|------|------|-------------|---------|
| 1 | export | plan:508 | `configSkillHandlersPure.ts` exports `computeDescendantIds` | PASS |
| 2 | file | plan:508 | `configSkillHandlersPure.test.ts` exists | PASS |
| 3 | test | plan:508 | adaptive default with children → `children` | DIRECTIONAL |
| 4 | test | plan:508 | adaptive default without children → `subaccount` | DIRECTIONAL |
| 5 | test | plan:508 | explicit scope overrides adaptive | DIRECTIONAL |
| 6 | test | plan:508 | missing-hierarchy fallthrough + WARN log assertion | DIRECTIONAL |
| 7 | test | plan:508 | `descendants` walks subtree (pure, no CTE) | PASS |
| 8 | test | plan:508 | `computeDescendantIds` is tested | PASS |
| 9 | behav | plan:511 | `executeConfigListAgents` accepts optional `scope` | PASS |
| 10 | behav | plan:513 | Adaptive default formula | PASS |
| 11 | behav | plan:516 | WARN `hierarchy_missing_read_skill_fallthrough` | PASS |
| 12 | behav | plan:522 | `children` → filter to direct children | PASS |
| 13 | behav | plan:522 | `descendants` → filter via `computeDescendantIds` | PASS |
| 14 | behav | plan:522 | `subaccount` → existing behaviour (no filter) | PASS |
| 15 | behav | plan:523 | `executeConfigListSubaccounts` accepts `scope`, no filter | PASS |
| 16 | behav | plan:523 | `executeConfigListLinks` accepts `scope`, no filter | PASS |
| 17 | contract | plan:530 | WARN tag exact + distinct from `hierarchy_context_missing` | PASS |
| 18 | docs | plan:524 | `config_list_agents.md` documents scope + values + default | PASS |
| 19 | docs | plan:525 | `config_list_subaccounts.md` — "no filter effect in v1" | PASS |
| 20 | docs | plan:526 | `config_list_links.md` — same note | PASS |
| 21 | INV-2 | plan:536 | Read skills do NOT emit `hierarchy_context_missing` | PASS |

### Evidence (PASS)

- **REQ 1** — `configSkillHandlersPure.ts:21-56` — BFS over parent→children map with visited set. Caller excluded.
- **REQ 2** — file exists; `npx tsx …configSkillHandlersPure.test.ts` → `8 passed, 0 failed`.
- **REQ 7** — `configSkillHandlersPure.test.ts:76-84` — `grandparent → 4 descendants` (children + grandchildren).
- **REQ 8** — 5 tests on `computeDescendantIds` + 3 on `mapSubaccountAgentIdsToAgentIds`.
- **REQ 9** — `configSkillHandlers.ts:499` reads `input.scope`.
- **REQ 10** — `configSkillHandlers.ts:500-504` — verbatim match with spec formula `(context.hierarchy?.childIds.length ?? 0) > 0 ? 'children' : 'subaccount'`.
- **REQ 11** — `configSkillHandlers.ts:507-509` — `logger.warn('hierarchy_missing_read_skill_fallthrough', { skill, runId })`.
- **REQ 12** — line 544-545 uses `context.hierarchy.childIds` directly.
- **REQ 13** — line 546-552 calls `computeDescendantIds({ callerSubaccountAgentId: context.hierarchy.agentId, roster })`.
- **REQ 14** — line 566 comment `// effectiveScope === 'subaccount': return all agents`; no filter on the list in that branch.
- **REQ 15** — lines 585-599. Signature accepts input object (scope can pass, silently ignored). Inline comment confirms intent.
- **REQ 16** — lines 601-626. Reads `input.subaccountId`, ignores `input.scope`. Comment matches.
- **REQ 17** — string `'hierarchy_missing_read_skill_fallthrough'` is distinct from `HIERARCHY_CONTEXT_MISSING = 'hierarchy_context_missing'` in `shared/types/delegation.ts:32`. Grep confirms no write-side error-code emission in the config skill handlers.
- **REQ 18** — `config_list_agents.md:10` — exact values enum + adaptive default note.
- **REQ 19** — `config_list_subaccounts.md:10` — exact text "Accepted for signature consistency across list skills; has no filter effect in v1".
- **REQ 20** — `config_list_links.md:11` — identical note.
- **REQ 21** — read path never throws or emits write-side error code; falls through to unfiltered on missing hierarchy.

### Notes on close-but-passing

- **REQ 9 — Zod vs runtime enum.** Plan line 532 suggests `z.enum(...)`; impl uses `DELEGATION_SCOPE_VALUES.includes(rawScope as DelegationScope)`. Functionally equivalent validation; the caller task prompt did not mandate Zod. PASS.
- **REQ 15 — `_input` prefix.** `executeConfigListSubaccounts(_input, context)` renames the param for `no-unused-vars`. JS ignores parameter names at call site; `scope` can still be passed. PASS.

---

## Mechanical fixes applied

None. All MECHANICAL_GAP candidates resolved to PASS on verification. The four remaining gaps (REQs 3-6) were classified DIRECTIONAL per fail-closed rule (see below).

---

## Directional / ambiguous gaps (routed to `tasks/todo.md`)

All four gaps form a single coherent finding: **behavioral tests for `executeConfigListAgents` are missing**. Only the pure helpers are tested; the handler-level adaptive/override/warn/fallthrough behaviour has no runtime assertion.

| REQ | Gap | Suggested direction |
|-----|-----|---------------------|
| 3 | adaptive-default-with-children branch untested | Either (a) extract adaptive logic to pure helper `resolveEffectiveScope({ rawScope, hierarchy })` and unit-test, OR (b) add integration test with stubbed `agentService` + DB query. |
| 4 | adaptive-default-without-children branch untested | Same as REQ 3. |
| 5 | explicit-scope-overrides-adaptive untested | Same as REQ 3. |
| 6 | missing-hierarchy WARN + fallthrough untested | Needs logger mock plus either handler-level integration test, OR a pure helper returning `{ effectiveScope, shouldWarn }` for pure assertion. |

### Why DIRECTIONAL (not MECHANICAL)

1. **Design choice required.** The file `configSkillHandlersPure.test.ts` currently tests only pure helpers. Adding these four cases needs either (a) a new mocking pattern (`agentService`, `db`, `logger`) in this module — not present today — or (b) further pure-helper extraction not spelled out in the spec.
2. **Testing posture tension.** Plan.md line 6 declares `runtime_tests: pure_function_only`, which argues for extraction — but the extraction boundary is not spec-named.
3. **Prompt phrasing.** The caller's prompt says "*WARN log assertion (or at least behavioral test)*" — explicit acknowledgement that the test form is an open design choice.
4. **Fail-closed rule.** Shipping a new test-harness convention without the developer's approval is outside this agent's remit.

---

## Files modified by this run

None (no mechanical fixes applied).

Files appended by this run:
- `tasks/todo.md` — new dated section "Deferred from spec-conformance review — paperclip-hierarchy-chunk-3b (2026-04-23)".
- This log file itself.

---

## Next step

**NON_CONFORMANT** — 4 directional gaps must be triaged by the main session before `pr-reviewer`.

Per `CLAUDE.md` § *Processing `spec-conformance` NON_CONFORMANT findings*, the main session decides:
- **(a) Close in-session** by extracting a pure helper (`resolveEffectiveScope`) and adding 4 pure tests, then re-invoke `spec-conformance` to confirm closure; OR
- **(b) Close in-session** by adding a new behavioral test file (`configSkillHandlers.test.ts`) with mocks, then re-invoke `spec-conformance`; OR
- **(c) Promote to architectural backlog** by appending to `tasks/todo.md § PR Review deferred items / ### paperclip-hierarchy` with justification (e.g. "runtime_tests: pure_function_only posture — behavioral coverage deferred to live-agent telemetry").

No mechanical fixes were applied, so the changed-code set is unchanged. **Re-running `pr-reviewer` is NOT required purely on the basis of this run** — the "CONFORMANT_AFTER_FIXES → re-run" trigger does not apply.
