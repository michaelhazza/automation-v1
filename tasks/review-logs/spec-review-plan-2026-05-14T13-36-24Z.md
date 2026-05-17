# Spec Review Plan — feat-split-skillexecutor

- **Spec path:** `tasks/builds/feat-split-skillexecutor/spec.md`
- **Spec commit at start:** (uncommitted draft)
- **Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318` (2026-05-12)
- **MAX_ITERATIONS:** 5
- **Stopping heuristic note:** Two consecutive mechanical-only rounds = stop before cap.

## Pre-loop context check

- spec-context.md: `last_reviewed_at: 2026-05-11`, today 2026-05-14, age = 3 days. GREEN. Proceeding.
- Spec framing aligns with spec-context: pre-production, static_gates_primary testing, no feature flags. No mismatch detected.

## Caller-supplied focus areas
1. Public-surface drift (§4 vs actual exports of skillExecutor.ts)
2. Dependency-direction soundness (§5.3 — pipeline.ts / gating.ts / registry.ts / adapter-registration.ts / handlers/*)
3. Chunk-plan completeness (§7 vs §6 enumeration; functions/helpers not in any chunk)
4. Caller sweep (§10 — anything missed?)
5. Anti-chunk discipline (no smuggled changes)
6. `requireSubaccountContext` home (context.ts vs elsewhere)

## Pre-iteration findings from manual rubric pass

These will feed into Iteration 1 alongside Codex's findings:

1. **§4 row "SkillExecutionParams"** — claims `exported interface`. Actual source: line 231 `interface SkillExecutionParams` (NOT exported, no `export` keyword). Also no external file imports it (grep verified 0 matches outside skillExecutor.ts). Mechanical fix: either (a) downgrade row to "internal interface (NOT in public surface)" and remove from §5.7 barrel re-export, OR (b) the spec intends to MAKE it part of the public surface as a fresh promotion — directional. The current text says "must remain importable… with identical types and runtime semantics," which is impossible for a symbol that isn't currently exported. Treat as mechanical: this is contradiction between §4 and source.

2. **§4 row "skillExecutor" consumer list** — names `intelligenceSkillExecutor.ts`. Actual source: that file only imports `SkillExecutionContext` (type-only), NOT `skillExecutor`. Mechanical fix: remove `intelligenceSkillExecutor.ts` from the `skillExecutor` row's consumer list.

3. **§6 enumeration missed two helpers:**
   - `resolveAgentOwner` (line 2356) — used by all calendar.* and slack.* handlers
   - `buildSupportPrincipal` (line 2197) — used by support handlers; spec §11 OQ#3 acknowledges it exists
4. **§6 understates `SKILL_HANDLERS` shape.** The file uses ONE literal at line 439 plus TWO `Object.assign(SKILL_HANDLERS, {...})` augmentations at lines 2210 and 2374. The registry is built in three pieces, not one. The §5.3 `registry.ts` description and §7 Chunk 14 must address this shape — `registry.ts` will need to either (a) merge all three pieces into one literal, or (b) preserve the assemble-then-extend pattern.

5. **§7 Chunk 4 worker-adapter dispatch missing items.** The registerAdapter dispatch switch at lines 69-131 contains:
   - `create_page` → `executeCreatePage` (NOT an "approved" variant; an in-barrel skill)
   - `update_page` → `executeUpdatePage`
   - `publish_page` → `executePublishPage`
   - 4 ads slugs → `executeAdsActionApproved`
   - `config_update_organisation_config` → inline await import of `executeApprovedOrganisationConfigUpdate` from `configUpdateOrganisationService.ts`
   - `notify_operator` → inline await import of `fanoutOperatorAlert` from `notifyOperatorFanoutService.ts`
   Spec §7 Chunk 4 says adapter-registration imports its dispatch targets "from the barrel transitionally." Spec §7 Chunk 12 says adapter-registration flips to import `handlers/delegation.ts` directly. BUT: `executeCreatePage`/`executeUpdatePage`/`executePublishPage` live in `handlers/pages.ts` (Chunk 10), not `handlers/delegation.ts`. And `config_update_organisation_config` and `notify_operator` use `await import('...')` inline, sourcing from sibling services NOT in any handlers/* — these dispatch paths should stay where they are (untouched by the split). Spec needs to either (a) name the non-delegation imports explicitly in the Chunk 12 description, or (b) acknowledge that adapter-registration imports from `handlers/pages.ts` AND `handlers/delegation.ts` AND keeps inline dynamic imports for two slugs.

6. **§7 chunked plan misses `resolveAgentOwner` placement.** It's used by both calendar.* (Chunk 13, `handlers/calendar.ts`) and slack.* (Chunk 13, `handlers/slack.ts`). Either it lives in a shared `handlers/userOwnedAgentOwner.ts` (new) or in `context.ts` (it depends on `SkillExecutionContext` and does an async DB lookup — so context.ts would violate the §5.3 leaf rule). Most defensible: it lives in one of the two handler modules and the other imports it (one-way edge, like `tasks.ts → handoff.ts`).

7. **§5.3 leaf-rule for `context.ts` vs `requireSubaccountContext` placement.** §5.3 says "context.ts is a leaf — imports types only from ../../shared/types/** and external libs." But `requireSubaccountContext` throws `Error` (no external import), so it satisfies the leaf rule. OK. However the spec's caller said: "`requireSubaccountContext` is mentioned as part of `context.ts` — verify that's the right home." Answer: yes — it's a pure function over a `SkillExecutionContext`, no DB, no service, throws an Error. context.ts is correct.

8. **§5.7 barrel re-export shape** — re-exports `SkillExecutionParams` as a type, but per finding #1 above, that symbol is not currently exported. The barrel re-export contradicts source state.

9. **§10 caller sweep — verified entries:**
   - `chargeRouterService.ts` (spec marks "verify at chunk 1") — needs verification now (not a TODO).
   - `mcpServer.ts` (spec says "`skillExecutor` or `SKILL_HANDLERS`") — wording is ambiguous; should be pinned. Per grep: imports `skillExecutor`.
   - `systemSkillService.ts` (spec says "`SKILL_HANDLERS` or related") — wording ambiguous; per grep: imports `SKILL_HANDLERS`.

10. **§10 missing callers** (per grep): `agentExecutionEventServicePure.ts`, `optimiser/runOptimiserScan.ts` (already in list), `__tests__/skillExecutor.reassignTask.test.ts`, `__tests__/skillExecutor.spawnSubAgents.test.ts`. Verify whether reassignTask.test and spawnSubAgents.test files exist and what they import.
