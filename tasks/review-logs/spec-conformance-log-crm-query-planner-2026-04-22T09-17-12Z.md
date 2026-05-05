# Spec Conformance Log

**Spec:** `tasks/builds/crm-query-planner/spec.md`
**Spec commit at check:** `60bda7a1` (current HEAD — spec file unchanged in this run)
**Branch:** `claude/crm-query-planner-WR6PF`
**Base:** `f9b0042c9c5f4376b74fd422d31c4714d7776540`
**Scope:** all spec (caller-confirmed whole-branch coverage — P1.0, P1.1, P1.2, P2, P3)
**Changed-code set:** 19 code files (shared types, server services, server routes, scripts, client page, actionRegistry, llmRequests schema const)
**Run at:** 2026-04-22T09-17-12Z

---

## Summary

- Requirements extracted:     120
- PASS:                       ~109
- MECHANICAL_GAP → fixed:     2
- DIRECTIONAL_GAP → deferred: 6
- AMBIGUOUS → deferred:       1
- OUT_OF_SCOPE → skipped:     2

**Verdict:** CONFORMANT_AFTER_FIXES with blocking directional gaps — the 2 mechanical gaps were closed in-session, but 6 directional gaps remain that need main-session attention before merge. Re-run `pr-reviewer` on the expanded changed-code set before gating a PR. The 7th item (REQ #64) is a spec self-contradiction, not a code fix.

---

## Mechanical fixes applied

- **REQ #95 — `BudgetExceededError` handling** (§16.2)
  - File: `server/services/crmQueryPlanner/crmQueryPlannerService.ts`
  - Lines: 17–24 (imports), 298–316 (Stage 3 catch block)
  - Spec quote: "the router surfaces a `BudgetExceededError`; `crmQueryPlannerService` catches it and emits `BriefErrorResult { errorCode: 'cost_exceeded' }`"
  - Change: added import of `BudgetExceededError` from `server/services/budgetService.ts`; added `instanceof BudgetExceededError` branch in the Stage 3 catch so router-surfaced budget exhaustion routes to `cost_exceeded` (with `errorSubcategory: 'cost_exceeded_stage3'`) instead of the generic `ambiguous_intent` fallback.

- **REQ #98 — `cost_prediction_drift` warn-log** (§16.2.1)
  - File: `server/services/crmQueryPlanner/crmQueryPlannerService.ts`
  - Lines: 21 (logger import), 508–521 (drift-check block before `planner.result_emitted` on Stage 3 success)
  - Spec quote: "if `actualCostCents.total > plan.costPreview.predictedCostCents * 2`, the service emits a structured `warn`-level log line `cost_prediction_drift` with `{ intentHash, predicted, actual, stageResolved, source }`. Non-blocking — the response still returns normally."
  - Change: added `logger.warn('cost_prediction_drift', { intentHash, predicted, actual, stageResolved: 3, source })` when `actualCostCents.total > costPreview.predictedCostCents * 2` and `predictedCostCents > 0`. Fixed-multiplier `2` — spec says "tighten via systemSettings.crm_query_planner_cost_drift_multiplier if needed" so the default-2 emission satisfies the spec's emission requirement without extending `SETTING_KEYS`.

Re-verification: re-read both edit regions; imports resolve against existing modules, surrounding code unaffected. `npx tsc --noEmit -p tsconfig.json` produces zero new errors on the planner files (pre-existing unrelated errors in `client/src/components/ClarificationInbox.tsx` and `client/src/components/skill-analyzer/SkillAnalyzerExecuteStep.tsx` are not from this run).

---

## Requirements extracted — brief summary

The full scratch checklist lives at `tasks/review-logs/spec-conformance-scratch-crm-query-planner-2026-04-22T09-17-12Z.md`. Top-level section coverage:

- §5 file layout — 31 of 33 PASS (2 OUT_OF_SCOPE)
- §6 types — 8 of 9 PASS (1 DIRECTIONAL on `at` scalar type)
- §7 normaliser — 5 of 5 PASS
- §8 Stage 1 matcher — 4 of 4 PASS
- §9 plan cache — 5 of 6 PASS (1 DIRECTIONAL on stage2_cache_miss reason)
- §10 LLM planner — 6 of 7 PASS (1 AMBIGUOUS on spec self-contradiction)
- §11 validator — 5 of 6 PASS (1 DIRECTIONAL on rule 8 three-case)
- §12 canonical executor — 5 of 5 PASS
- §13 live executor — 6 of 6 PASS
- §14 hybrid executor — 5 of 5 PASS
- §15 result normaliser + cards — 8 of 8 PASS
- §16 governance — 3 of 6 PASS (2 MECHANICAL_GAP fixed, 1 DIRECTIONAL on RLS wrapping)
- §17 observability — 4 of 5 PASS (1 DIRECTIONAL on PlannerTrace embedding)
- §18 API surface — 6 of 7 PASS (1 DIRECTIONAL on capability check)
- §19 phased delivery — 4 of 4 PASS
- §21 rollout — 2 of 2 PASS
- §24 impl markers — 2 of 2 PASS

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

New section in `tasks/todo.md`: `## Deferred from spec-conformance review — crm-query-planner (2026-04-22)` at line 322. Items:

- **REQ #40** — PlannerEvent `at` scalar type (shared type `number` vs runtime `string`) — §6.6
- **REQ #57** — `stage2_cache_miss` reason not discriminated (always `not_present`) — §9.3.1
- **REQ #68** — Canonical-precedence rule 8 missing hybrid-promotion case — §11.2 rule 8
- **REQ #99** — RLS wrapping (`withOrgTx` + `withPrincipalContext`) not present in `runQuery` — §16.4
- **REQ #103** — `PlannerTrace` never built or embedded on `planner.result_emitted` — §6.7 + §17.1
- **REQ #111** — Route-level `crm.query` capability check is hard-coded, not verified against caller's `capabilityMap` — §18.1
- **REQ #64** — Spec self-contradiction on `systemCallerPolicy` (`'strict'` in §16.1 vs `'bypass_routing'` in §10.1) — requires spec patch, not code change

---

## Out-of-scope (skipped)

- **REQ #21** — `server/services/crmQueryPlanner/__tests__/integration.test.ts` (RLS-only) — already deferred at `tasks/todo.md` line 318 (pre-existing `## Deferred testing — crm-query-planner` section, captured during P1 build audit).
- **REQ #33** — `tasks/builds/crm-query-planner/pressure-test-results.md` — spec §20.3 explicitly designates this a manual architect activity against real ops data, not a code deliverable.

---

## Files modified by this run

- `server/services/crmQueryPlanner/crmQueryPlannerService.ts` — 2 additive patches (imports + BudgetExceededError branch + cost_prediction_drift log)
- `tasks/todo.md` — appended deferred-items section (no existing content mutated)

---

## Next step

**CONFORMANT_AFTER_FIXES — NON_CONFORMANT for directional gaps.** The 2 mechanical gaps were closed in-session; re-run `pr-reviewer` on the expanded changed-code set (the reviewer must see the post-fix state, not the pre-fix state). The 6 directional gaps (REQ #40, #57, #68, #99, #103, #111) must be addressed by the main session before PR, OR explicitly acknowledged by the caller as follow-on work. REQ #64 is a spec self-contradiction and should route through `spec-reviewer` or `chatgpt-spec-review` rather than a code edit.

**Strong recommendation to block merge until REQ #99 lands** — running canonical reads outside `withOrgTx` / `withPrincipalContext` wrapping defeats the RLS story the spec is built on; the RLS integration test (REQ #21) is deferred precisely to verify this invariant, but the invariant itself must be in place first.
