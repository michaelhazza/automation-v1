# Spec Conformance Log

**Spec:** `tasks/builds/paperclip-hierarchy/plan.md` (Chunk 4b — Derived skill resolver, lines 627–661)
**Reference spec:** `docs/hierarchical-delegation-dev-spec.md` (§6.5, §12.2)
**Spec commit at check:** `99cb5c5c2fb21cc3af7365c1790d5da1bb30b602` (HEAD)
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Base:** `399f3864b5187d2be99ca9f9807793699560ece7`
**Scope:** Chunk 4b only (caller-specified). Sections mapped per `plan.md`: Chunk 4b block (lines 627–661). Named cross-references followed: §6.5 and §12.2 of the source dev-spec.
**Changed-code set:** 4 files
  - `server/services/skillServicePure.ts` (new)
  - `server/services/__tests__/skillService.resolver.test.ts` (new)
  - `server/services/skillService.ts` (modified — `resolveSkillsForAgent`)
  - `server/services/agentExecutionService.ts` (modified — call site at L681)
**Run at:** 2026-04-24T00:00:00Z

---

## Summary

- Requirements extracted:     13
- PASS:                       12
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 1
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (1 directional gap — see `tasks/todo.md` under "Deferred from spec-conformance review — paperclip-hierarchy-chunk-4b")

Note: the gap is a pure-test-coverage-vs-integration-coverage design call, not a missing functional behaviour. Runtime behaviour specified by §6.5 (derived-union logic, WARN emission, non-failure on missing hierarchy) is all present and working.

---

## Requirements extracted (full checklist)

| REQ | Category | Spec section | Requirement | Verdict |
|---|---|---|---|---|
| #1 | file | plan.md L631–632 | New file `server/services/__tests__/skillService.resolver.test.ts` | PASS |
| #2 | test | plan.md L632 | `computeDerivedSkills({ hierarchy })` returns `[]` for empty `childIds` | PASS |
| #3 | test | plan.md L632 | Returns `['config_list_agents', 'spawn_sub_agents', 'reassign_task']` for non-empty `childIds` | PASS |
| #4 | test | plan.md L632 | Union idempotency — explicit + derived de-dupes | PASS |
| #5 | test | plan.md L632 | `context.hierarchy` undefined → no derived skills, WARN logged | DIRECTIONAL_GAP |
| #6 | behavior | plan.md L635–641 + spec §6.5 L836–845 | `resolveSkillsForAgent` implements the derived-union logic (Set-dedup over `attached ∪ derived`) | PASS |
| #7 | file | plan.md L642 | Extract `computeDerivedSkills({ hierarchy })` as a pure helper in `skillServicePure.ts` | PASS |
| #8 | behavior | plan.md L642 + spec §6.5 L850 | When `context.hierarchy` undefined, log WARN `hierarchy_missing_at_resolver_time` and return attached-only; do NOT fail the run | PASS |
| #9 | behavior | plan.md L646 | Always union all three delegation slugs together | PASS |
| #10 | behavior | plan.md L647 | Explicit attachment survives idempotent union | PASS |
| #11 | invariant | plan.md L645 + L885–886 (R4 mitigation) | INV-4: resolver does NOT re-invoke `hierarchyContextBuilderService`; no import from `skillService.ts` or `skillServicePure.ts` | PASS |
| #12 | ordering | plan.md L645 + spec §6.5 L848 | `agentExecutionService` builds `context.hierarchy` BEFORE invoking the resolver | PASS |
| #13 | file | plan.md L634–641 (Files — Modified) | `agentExecutionService.ts` call-site wires `hierarchyContext` into `resolveSkillsForAgent` | PASS |

---

## Evidence per REQ

- **REQ #1** — `server/services/__tests__/skillService.resolver.test.ts` (142 lines, created in commit `99cb5c5c`).
- **REQ #2** — Test at L50–61: `returns [] when hierarchy has no children (empty childIds)`.
- **REQ #3** — Test at L63–95: two variants (single child, multiple children) both assert the exact trio.
- **REQ #4** — Tests at L97–118 (partial overlap: 4 unique effective slugs) and L120–135 (full overlap: 3 unique).
- **REQ #5** — Test at L45–48 covers `hierarchy: undefined → []` but does NOT assert WARN emission. The file's own header comment (L7–10) documents this: *"The WARN fired inside `resolveSkillsForAgent` (the impure function) when `hierarchy === undefined && subaccountId` is truthy cannot be tested here — that behaviour requires a real DB and logger mock. It is exercised at the integration level in `agentExecutionService` tests."* No such integration-level test exists for this chunk. **→ DIRECTIONAL_GAP: see `tasks/todo.md` REQ #C4b-1.**
- **REQ #6** — `skillService.ts` L119: `const derivedSlugs = computeDerivedSkills({ hierarchy });`. L126: `const effectiveSlugs = Array.from(new Set([...skillSlugs, ...derivedSlugs]));`. Matches spec §6.5 L840–844 shape 1:1.
- **REQ #7** — `server/services/skillServicePure.ts` L25–32 exports `computeDerivedSkills` as a pure function. No DB access, no side effects. Imports only the type `HierarchyContext` from `shared/types/delegation.js`.
- **REQ #8** — `skillService.ts` L120–125:
  ```ts
  if (hierarchy === undefined && subaccountId) {
    logger.warn('hierarchy_missing_at_resolver_time', {
      organisationId,
      subaccountId,
    });
  }
  ```
  The WARN fires with the exact tag named in the spec. Resolver returns attached-only because `computeDerivedSkills({ hierarchy: undefined })` returns `[]`. No throw — the run continues. The `subaccountId`-truthy gate narrows WARN to subaccount runs only; this is consistent with spec §6.5 L850: *"This preserves behaviour for diagnostic / system runs that might legitimately bypass the builder."* Non-subaccount runs legitimately bypass the builder (agentExecutionService L629 only builds when `subaccountId && subaccountAgentId`), so silently dropping WARN for them matches spec intent.
- **REQ #9** — `skillServicePure.ts` L9–13: `DERIVED_DELEGATION_SLUGS` is a literal array returned as a whole in L29. No path returns a subset.
- **REQ #10** — `skillService.ts` L126 uses `new Set([...skillSlugs, ...derivedSlugs])`. Duplicate slugs present in both sets collapse to a single entry. Behaviour asserted by the two idempotency tests (REQ #4).
- **REQ #11** — `grep "hierarchyContextBuilderService" server/services/skillService.ts` → no matches. Same grep on `server/services/skillServicePure.ts` → no matches. The only import of `hierarchyContextBuilderService` is in `agentExecutionService.ts` L64, as expected.
- **REQ #12** — `agentExecutionService.ts` L625–660: hierarchy is built in step "4.5". L681–686: resolver is invoked in step "5". Correct ordering.
- **REQ #13** — `agentExecutionService.ts` L681–686:
  ```ts
  const { tools: skillTools, instructions: skillInstructions, truncated: skillInstructionsTruncated } =
    await skillService.resolveSkillsForAgent(
      skillSlugs,
      request.organisationId,
      request.subaccountId,
      request.subaccountAgentId ? hierarchyContext : undefined,
    );
  ```
  The gated pass-through on `subaccountAgentId` is defensive: if the builder succeeded, pass it; if the call is a non-subaccount run, pass undefined. This matches the call-ordering assumption in plan L645.

---

## Mechanical fixes applied

None. All concretely-named spec requirements are satisfied. The single gap is a test-coverage-shape design choice, not a missing deliverable, and therefore is not a mechanical fix.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- **REQ #5 / REQ #C4b-1** — Pure test file does not assert WARN emission; deferred to integration-level coverage that does not yet exist. Routed to `tasks/todo.md` under `## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4b (2026-04-24)`.

---

## Gate results

- `npx tsx server/services/__tests__/skillService.resolver.test.ts` → 6/6 PASS.
- `npx tsc --noEmit` on the two new files → clean (only pre-existing `Intl.Segmenter` typing error in `node_modules/@types/diff`, unrelated to this chunk).
- Lint / full typecheck / `npm test -- skillService.resolver` as called for by the chunk's static gates (plan L652–655): not executed by the conformance agent; flagged here for the caller's own verification pass if not already run.

---

## Files modified by this run

- `tasks/todo.md` — appended the dated chunk-4b deferred-items section.

No source files modified.

---

## Next step

**NON_CONFORMANT — 1 directional gap must be addressed by the main session before `pr-reviewer`.** See `tasks/todo.md` under `## Deferred from spec-conformance review — paperclip-hierarchy-chunk-4b (2026-04-24)`.

Caller disposition options:
1. **Close in-session** — refactor WARN into a pure return shape (suggested option b in the todo entry) or add a thin integration test with logger mock (option a). Then re-invoke `spec-conformance` to confirm closure.
2. **Accept as a deliberate test-shape deferral** — the runtime behaviour is correct and covered by manual smoke; treat REQ #C4b-1 as a known gap to resolve alongside the broader agentExecutionService integration-test surface (similar to how Chunk 4a deferred several integration-level assertions).

The gap is NOT architectural — either resolution path is low-risk and consistent with patterns already used in the project.
