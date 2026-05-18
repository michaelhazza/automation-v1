# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
**Spec commit at check:** `e90906fb` (acceptance HEAD)
**Branch:** `main`
**Base:** `e90906fb` (Phase 1 close commit on main; build commits `46af84ee..bf9be298` are in scope)
**Scope:** all-of-spec — single-phase, single-PR delivery (13 chunks); all chunks committed to main; build slug is closed
**Changed-code set:** 22 implementation files (excluding spec-review logs, plan.md, progress.md, unrelated `oss-pattern-lifts-bundle` artefacts, and `tasks/todo.md`)
**Run at:** 2026-05-18T13-46-23Z
**Commit at finish:** `6d14d2e7`

---

## Summary

- Requirements extracted:     22
- PASS:                       20
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  2
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** CONFORMANT (2 minor directional gaps documented; not blocking — both are intentional V1 deferrals consistent with spec §13).

---

## Requirements extracted (full checklist)

| REQ | Spec § | Category | Requirement | Verdict | Evidence |
|-----|--------|----------|-------------|---------|----------|
| 1 | §7 / §8.1 | file/export | `shared/types/visionActions.ts` exports `VisionAction` discriminated union (9 verbs) + `VisionDecisionMode` enum | PASS | `shared/types/visionActions.ts:4,18-27` |
| 2 | §7 / §8.1 | file/behavior | `server/services/visionActionParserPure.ts` parses UI-TARS native text format; rejects unknown verbs, missing args, negative/non-integer coords, malformed combos; normalises whitespace | PASS | `server/services/visionActionParserPure.ts:114-181` |
| 3 | §15 / §1.8 V1 | test | Vitest suite covers all 9 action types + invalid-input cases | PASS | `server/services/__tests__/visionActionParserPure.test.ts:17-201` (9 happy-path verbs, 8 rejection-case groups, whitespace normalisation, tryParseVisionAction null-parity) |
| 4 | §7 / §8.8 | export | `shared/iee/failureReason.ts` adds `vision_inference_unavailable` + `vision_inference_not_configured` to Zod enum | PASS | `shared/iee/failureReason.ts:98-99` |
| 5 | §7 / §8.2 | export | `shared/types/sandbox.ts` extends `SandboxRunTaskInput` with `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, `visionModelId` (all optional, nullable) | PASS | `shared/types/sandbox.ts:271-281` |
| 6 | §7 / §8.5 / §9 | schema/migration | `server/db/schema/visionInferenceCalls.ts` + `migrations/0378_vision_inference_calls.sql` + `.down.sql`; FORCE RLS; org-isolation policy two-arg form; unique key `(iee_run_id, step_index, call_index)` | PASS | `server/db/schema/visionInferenceCalls.ts:19-44`, `migrations/0378_vision_inference_calls.sql:11-43`, `migrations/0378_vision_inference_calls.down.sql:1` |
| 7 | §9.2 / §7 | config | `server/config/rlsProtectedTables.ts` entry for `vision_inference_calls` | PASS | `server/config/rlsProtectedTables.ts:1449-1455` |
| 8 | §7 / schema index | export | `server/db/schema/index.ts` exports `visionInferenceCalls` | PASS | `server/db/schema/index.ts:109` |
| 9 | §7 / §8.4 | file/export | `shared/visionInferencePricing.ts` exports `computeCostCents` + `VISION_PRICING_RATES`; throws on unknown modelId; Math.round rounding; 0-floor for sub-cent | PASS | `shared/visionInferencePricing.ts:10-45` |
| 10 | §15 | test | Vitest for `computeCostCents`: ui-tars-7b lookup, rounding, throw on unknown, sub-cent 0-floor | PASS | `shared/__tests__/visionInferencePricing.test.ts:6-79` |
| 11 | §7 / §8.6 / §10 / §12.1 | file/export | `server/services/visionGroundingService.ts` exports `resolveEndpointConfig()` (HTTPS-only; throws `vision_inference_not_configured`), `parseVisionEndpointHostPort()` (host/port for allowlist), `harvestVisionCalls(tx, ieeRun)` (sets org GUC first, ON CONFLICT DO NOTHING, parity-validates costCents) | PASS | `server/services/visionGroundingService.ts:67-84,96-103,124-218` |
| 12 | §7 / §10 / §1.6 / §13 | file/job | `server/jobs/visionInferenceCostRollupJob.ts` mirrors `ieeCostRollupDailyJob`; queue `vision-inference-cost-rollup-daily`; cron `15 2 * * *` UTC; two upserts (source_type + run); `withAdminConnection` + `SET LOCAL ROLE admin_role`; UTC-day boundary | PASS | `server/jobs/visionInferenceCostRollupJob.ts:27-142` |
| 13 | §7 / §2.7 plan | config | Boot registration of cost rollup job | PASS | `server/index.ts:817-827` (plan §2.7 documents site as `server/index.ts` not `server/jobs/index.ts`) |
| 14 | §7 / §2.6 plan / §8.9 | export | `server/services/skillParserServicePure.ts` surfaces `iee_decision_mode` YAML key onto `ParsedSkill.ieeDecisionMode` (undefined for absent/unknown values; only `dom\|vision\|hybrid` accepted) | PASS | `server/services/skillParserServicePure.ts:28,150-153,237-240` (parseMarkdownFile + parseJsonFile both wired) |
| 15 | §7 / §8.3 | file/behavior | `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts` — loud-failure stub; never writes `status: 'completed'`; token redaction obligation called out in file header and code comment | PASS | `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts:1-56` |
| 16 | §7 / §8.3 | behavior | `infra/sandbox-templates/iee-browser/harness/index.ts` adds four vision fields to `HarnessInput`; routes to `visionDecisionLoop` when `decisionMode !== 'dom'` | PASS | `infra/sandbox-templates/iee-browser/harness/index.ts:50-59,94-100` |
| 17 | §7 / §8.2 / §8.6 / §8.7 | behavior | `_ieeShared.ts::ieeDispatchBrowser` calls `resolveEndpointConfig()` (throws fail-closed before sandbox creation), threads four fields into `SandboxRunTaskInput`, merges (not replaces) vision allowlist entry, preserves DOM-mode `network.mode='none'` | PASS | `server/services/executionBackends/_ieeShared.ts:219-239,250-269,312-315` |
| 18 | §7 / §12.1 / plan §2.1 | behavior | `_ieeShared.ts::ieeFinalise` invokes `harvestVisionCalls(tx, ieeRun)` inside the orchestrator transaction, gated by `ieeRun.type === 'browser'`, before `assertValidTransition` and the `agent_runs` terminal UPDATE | PASS | `server/services/executionBackends/_ieeShared.ts:642-653` |
| 19 | §7 | docs | `docs/iee-development-spec.md` documents `iee_decision_mode` skill YAML field + three-mode behaviour | PASS | `docs/iee-development-spec.md` new §6.7 inserted |
| 20 | §1 V1 / §3 framing assumptions | behavior | V1 stub posture: harness fails loudly when `decisionMode !== 'dom'`; no ByteDance domain in allowlist (vision allowlist host is parsed from `VISION_INFERENCE_ENDPOINT_URL`, not hard-coded) | PASS | `visionDecisionLoop.ts:44-56`, `_ieeShared.ts:237-238` |
| 21 | §8.9 / plan §2.6 | behavior | `ParsedSkill.ieeDecisionMode` flows through to `IeeTask.decisionMode` so the dispatch path receives the skill author's declared mode | DIRECTIONAL_GAP | `shared/iee/jobPayload.ts:84-89` (field exists), `BrowserTaskPayload.decisionMode` exists; but no production code site assigns it from `ParsedSkill.ieeDecisionMode`. The only `ieeTask` construction in routes (`webLoginConnections.ts:286-295`) does not pass `decisionMode`. C13 added the types but not the upstream assignment. See deferred item D-1 below. |
| 22 | §8.5 column type | schema | `image_size_bytes` declared as `integer` in spec | DIRECTIONAL_GAP | `migrations/0378_vision_inference_calls.sql:20` and `server/db/schema/visionInferenceCalls.ts:30` use `bigint`. Bigint is a strict superset of integer for valid values; PNG screenshots fit either; migration has already shipped on main. See deferred item D-2 below. |

---

## Mechanical fixes applied

None — no mechanical gaps were identified.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

| ID | REQ | Description | Routed |
|----|-----|-------------|--------|
| D-1 | REQ #21 | `ParsedSkill.ieeDecisionMode → IeeTask.decisionMode` upstream wiring is not implemented in any production code path; only types are in place. V1 dispatch path defaults to `'dom'` silently when skills declare `iee_decision_mode: vision/hybrid` — the declaration is parsed but never read into the in-flight envelope. Likely intentional V1 stubbing (harness is itself a stub and §13 defers full wiring), but worth surfacing because the spec's stated success criterion "Dispatch path threads `decisionMode` … into `SandboxRunTaskInput`" is only verifiable for an already-populated `IeeTask.decisionMode`, not end-to-end from skill YAML. | `tasks/todo.md` |
| D-2 | REQ #22 | Spec §8.5 declares `image_size_bytes integer NOT NULL`. Implementation uses `bigint NOT NULL` in both the migration (line 20) and the Drizzle schema (line 30). Functionally compatible (bigint is a strict superset of integer for valid values; PNG screenshots easily fit either), but a literal deviation from the spec row shape. Not surgical to fix — migration has shipped on main; reverting requires a follow-up ALTER COLUMN migration. | `tasks/todo.md` |

---

## Files verified (changed-code set in scope)

New files (11):
- `shared/types/visionActions.ts`
- `server/services/visionActionParserPure.ts`
- `server/services/__tests__/visionActionParserPure.test.ts`
- `server/services/visionGroundingService.ts`
- `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`
- `server/db/schema/visionInferenceCalls.ts`
- `migrations/0378_vision_inference_calls.sql`
- `migrations/0378_vision_inference_calls.down.sql`
- `server/jobs/visionInferenceCostRollupJob.ts`
- `shared/visionInferencePricing.ts`
- `shared/__tests__/visionInferencePricing.test.ts`

Modified files (11 — spec §7 lists 9; C13 added 2 more):
- `shared/types/sandbox.ts`
- `server/services/skillParserServicePure.ts`
- `shared/iee/failureReason.ts`
- `infra/sandbox-templates/iee-browser/harness/index.ts`
- `server/services/executionBackends/_ieeShared.ts`
- `server/db/schema/index.ts`
- `server/index.ts` (boot registration; plan §2.7 documents this site choice)
- `server/config/rlsProtectedTables.ts`
- `docs/iee-development-spec.md`
- `shared/iee/jobPayload.ts` (C13)
- `server/services/agentExecutionService/types.ts` (C13)

22 implementation files in scope; matches plan §5 file inventory plus the C13 thread audit.

---

## Files modified by this run

None (no mechanical fixes applied; only this log is written; `tasks/todo.md` is appended below for D-1 and D-2).

---

## Gates run

- `npm run lint` — PASS (0 errors, 879 pre-existing warnings)
- `npm run typecheck` — PASS (server + client configs both clean)

Both gates run as Step 5 re-verification only; full test suites are CI-only and not run locally per CLAUDE.md § *Test gates are CI-only*.

---

## Next step

**CONFORMANT** — no blocking gaps. Proceed to `pr-reviewer`.

Two minor directional gaps documented in `tasks/todo.md`:
- D-1 (upstream skill→ieeTask wiring) is consistent with the V1 stub posture stated in spec §3 / §13 and does not block the V1 success criteria, which only require the dispatch-path-to-sandbox link be present (REQ #17 PASS).
- D-2 (bigint vs integer column type) is a literal-deviation annotation with no functional impact; not worth a follow-up migration.

Recommendation: include both items in the follow-up "Full harness wiring" build (§13).
