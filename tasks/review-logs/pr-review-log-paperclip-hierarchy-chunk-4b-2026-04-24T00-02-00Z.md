# PR Review Log — paperclip-hierarchy Chunk 4b

**Files reviewed:**
- `server/services/skillServicePure.ts` (new, 45 lines)
- `server/services/__tests__/skillService.resolver.test.ts` (new, 172 lines)
- `server/services/skillService.ts` (modified — `resolveSkillsForAgent`, lines ~113–127 and imports)
- `server/services/agentExecutionService.ts` (modified — call site at L681–686)

**Reviewed at:** 2026-04-24T00-02-00Z
**Branch:** `claude/build-paperclip-hierarchy-ymgPW`
**Reviewer scope:** correctness of union logic, WARN condition, INV-4 compliance, test coverage gaps, code quality.

---

## Blocking Issues

No blocking issues found.

Verified:
- INV-4 holds — `skillServicePure.ts` imports only the `HierarchyContext` type; `skillService.ts` has no import of `hierarchyContextBuilderService` (confirmed by grep). The resolver consumes the already-built snapshot passed by `agentExecutionService`.
- Derived-union logic matches spec §6.5 exactly: `Array.from(new Set([...skillSlugs, ...derivedSlugs]))` at `skillService.ts:126` preserves the spec's shape and idempotency guarantee.
- WARN condition (`hierarchy === undefined && subaccountId` truthy) matches the reviewer-provided contract and is encapsulated in the `shouldWarnMissingHierarchy` pure helper. WARN fires at most once per run because the resolver is called exactly once per run from `agentExecutionService` (only call site — verified).
- Call-ordering (hierarchy built at step 4.5 before resolver at step 5) preserved at `agentExecutionService.ts:625–686`.
- `DERIVED_DELEGATION_SLUGS` is `as const` + returned via spread copy `[...DERIVED_DELEGATION_SLUGS]` — callers cannot mutate the source constant even at runtime.
- The three derived slugs (`config_list_agents`, `spawn_sub_agents`, `reassign_task`) are always returned as a single unit — no branch produces a subset (matches plan L646 "always union all three together").
- Explicit attachment survives the union; order in `skillSlugs` is preserved ahead of derived slugs in the `Set` (useful for the downstream `for (const slug of effectiveSlugs)` loop that walks in insertion order).
- Test file follows the existing console-based runner pattern used across `server/services/__tests__/*Pure.test.ts` — consistent with convention.

## Strong Recommendations

### SR1 — Missing integration-level WARN assertion

The pure tests cover `shouldWarnMissingHierarchy` return values, but no test asserts that `resolveSkillsForAgent` actually invokes `logger.warn('hierarchy_missing_at_resolver_time', …)` when the guard returns true. Already captured as REQ #C4b-1 in `tasks/todo.md` by spec-conformance.

Proposed test: Given `resolveSkillsForAgent` is invoked with `skillSlugs = []`, `organisationId = 'org-1'`, `subaccountId = 'sub-1'`, `hierarchy = undefined`, and a `logger.warn` spy — Then the spy records exactly one call with first argument `'hierarchy_missing_at_resolver_time'` and second argument `{ organisationId: 'org-1', subaccountId: 'sub-1' }`.

Deferred to backlog — requires logger/DB mock infrastructure.

### SR2 — Test does not assert WARN is NOT emitted for non-subaccount runs

The pure test for `shouldWarnMissingHierarchy` with `subaccountId: undefined` covers the return value, but no integration assertion verifies the wrapper does not call `logger.warn` in that case.

Deferred to backlog — same logger/DB mock requirement as SR1.

## Non-Blocking Improvements

### NB1 — Latent WARN false-positive when `subaccountId` set but `subaccountAgentId` not set

`agentExecutionService.ts:629` only builds hierarchy when BOTH are present, so `hierarchyContext` stays `undefined`. But `request.subaccountId` is passed through to the resolver — so `shouldWarnMissingHierarchy` returns `true` and the WARN fires for a run that legitimately never had a subaccount-agent. Every current caller pairs the two IDs together so this is latent, not live. Option: tighten the guard by basing the WARN decision on `subaccountAgentId` presence, or make `subaccountId`/`subaccountAgentId` a paired discriminated union. Deferred.

### NB2 — `DERIVED_DELEGATION_SLUGS` could be exported for reuse

Future chunks may want to check "is this a derived delegation skill?" Exporting `DERIVED_DELEGATION_SLUGS` would prevent string duplication. Not needed now.

### NB3 — Consider `Object.freeze(DERIVED_DELEGATION_SLUGS)` for runtime parity with `Readonly<HierarchyContext>`

Type-level `as const` doesn't prevent runtime mutation via type erasure. Defensive spread already protects callers. Genuinely optional.

### NB4 — JSDoc on `computeDerivedSkills` could cite the §6.5 spec anchor

Minor documentation improvement — link to spec §6.5 for future readers.

## Verdict

**APPROVED.** No blocking issues. INV-4, WARN contract, union logic, and call-ordering all correct. SR1 already captured in `tasks/todo.md` REQ #C4b-1.
