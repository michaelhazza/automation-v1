# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit:** `947111d0ddb919023ddb7bdfd58af8579197499a`
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-21T01:35:09Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until the finding below is resolved. Resolve by editing the `Decision:` line, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 1.1 | Testing-posture deviation (frontend RTL tests + route integration test) | Keep the RTL component tests and route integration test, or drop them to match framing? | Option B — keep the RTL tests and route integration test, but add a one-paragraph framing-deviation acknowledgement to §9's opener. | `spec-context.md` lists `frontend_tests: none_for_now` + `api_contract_tests: none_for_now`, both in `convention_rejections`. The spec introduces both without flagging the deviation. This is the only directional item in iteration 1 — the other 5 Codex findings were classified mechanical and auto-applied. |

---

## Finding 1.1 — Testing-posture deviation (frontend RTL tests + route integration test)

**Classification:** directional
**Signal matched:** Testing posture signals — "Add frontend unit tests" / "Introduce a test framework (vitest, jest, playwright for the app itself, supertest, MSW, etc.)" — both `convention_rejections` entries in `docs/spec-context.md`. Also "API contract tests" for `server/routes/__tests__/llmUsage.test.ts`.
**Source:** Codex (Finding P1 #6) + Rubric (testing-posture sanity check, §9 of `docs/spec-authoring-checklist.md`)
**Spec sections:** §4.1 (`RunCostPanel.test.tsx`, `llmUsage.test.ts`), §9.1 (Phase A tests), §9.3 (Phase C breaker test), §5.9 done #3, §6.9 done #5

### Finding (verbatim)

> [P1] Declare the testing-posture exception before requiring RTL/DB tests — tasks/hermes-audit-tier-1-spec.md:802-806
> This section presents React Testing Library component tests and real-DB integration tests as the default plan, but the project framing for this build is static-gates-primary with pure-function unit tests only. Unless the spec explicitly records that this is an intentional exception and why, implementers are being asked to satisfy the document by adding unsupported frontend/API test surfaces, which makes the spec non-executable under the stated posture.

Rubric context from `spec-context.md` lines 28–31 and 63–72:

- `frontend_tests: none_for_now`, `api_contract_tests: none_for_now`
- `"do not add vitest / jest / playwright for own app (until Phase 2 trigger)"`
- `"do not add supertest for API contract tests (until Phase 2 trigger)"`
- `"do not add frontend unit tests (until Phase 2 trigger)"`

The spec proposes three test surfaces against the framing:

1. `client/src/components/run-cost/RunCostPanel.test.tsx` — **frontend component tests (RTL)**. Direct hit on `frontend_tests: none_for_now`.
2. `server/routes/__tests__/llmUsage.test.ts` — **API route integration test**. Direct hit on `api_contract_tests: none_for_now`.
3. `server/services/__tests__/llmRouterCostBreaker.test.ts` — **real-DB integration test for cost-breaker enforcement**. This fits the "small number of carved-out integration tests for genuinely hot-path concerns" envelope; cost-breaker enforcement is the primary runaway-spend gate. NOT a framing deviation.

### Recommendation

**Option B — keep the RTL + route tests, declare the deviation explicitly.**

Add a paragraph near the top of §9 (Testing posture) that says:

> This spec proposes two test surfaces that deviate from the current project testing posture (`docs/spec-context.md`):
>
> 1. `RunCostPanel.test.tsx` — a first React Testing Library surface. `RunCostPanel` is a new shared component with five non-trivial rendering branches (loading, error, zero-cost, compact single-line, full table with mixed call-site split). Pinning that behaviour at the component boundary once is better ROI than re-deriving it visually on every downstream page. Scoped to this one file; no precedent for other frontend work.
> 2. `llmUsage.test.ts` — a route integration test for the one extended endpoint. The response shape is the source of truth for five client consumers (four pages + the shared TS type). The `RunCostResponse` type already catches missing fields at compile time; this test pins the shape/semantics guarantees (zero-row defaulting, failed-call exclusion, cross-org 404). Scoped to this one file.
>
> The third new test file, `llmRouterCostBreaker.test.ts`, is a real-DB integration test and matches the "small number of carved-out integration tests for genuinely hot-path concerns" envelope in the framing. No deviation.

Alternative options:

- **Option A — drop the RTL + route tests.** Ship code; rely on lint + typecheck + `verify-*.sh` + the `RunCostResponse` type. Breaker integration test stays. Simplest; matches framing cleanly; costs the component-behaviour regression safety net.
- **Option C — update `docs/spec-context.md` to permit RTL tests generally.** Larger scope than this spec warrants; would trigger re-review of every in-flight spec. Not recommended.

### Why

- `docs/spec-context.md` is the framing ground truth. A spec proposing rejected surfaces either (a) needs an explicit deviation paragraph, or (b) needs to drop those surfaces.
- Option B is the right-sized fix: the spec's §9 intro already appeals to existing convention; it just doesn't flag which parts are new categories. Explicit scoping ("this one file; no precedent") prevents the deviation from silently expanding into future specs.
- Option A is viable but slightly worse ROI: `RunCostPanel` is the first shared rendering component with non-trivial state. Pick A only if you want to hold the line on "no frontend tests, full stop."
- Option C is a posture change, not a spec fix.

### Classification reasoning

Testing-posture changes are on the directional signals list ("Add frontend unit tests", "Introduce a test framework"). Regardless of how obvious either resolution looks, this is a posture choice — not a mechanical tidy-up — and must be owned by the human.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the loop exits and the spec stays in its current state.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing the `Decision:` line above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint as its first action, honour the decision, and continue to iteration 2 (or exit).

---

## Mechanical findings applied this iteration (FYI, no decision needed)

The following findings were classified as mechanical and auto-applied alongside this checkpoint. They do not block on the human.

1. **File inventory drift (Codex P1 #1)** — §4.1 `shared/types/runCost.ts` role updated to list `totalTokensIn`/`totalTokensOut`; §4.2 gained an `agentExecutionServicePure.ts` row + test; §4.2 `workspaceMemories.ts` row removed to match §4.5's "NOT modified" list.
2. **Phase C breaker read path (Codex P1 #2)** — §4.3 and §8.3 updated to match §7.4.1's conservative default: the breaker gets a code change (direct-sum read variant), not just a JSDoc tweak. §7.4.1 pinned — `cost_aggregates` is updated asynchronously (via `routerJobService.enqueueAggregateUpdate` in `llmRouter.ts:897`), so option (a) applies.
3. **`runIsTerminal` contract (Codex P2 #3)** — §5.3 `RunCostPanelProps` updated to include `runIsTerminal: boolean` matching §5.2.1; §4.1 caller examples updated to pass the prop.
4. **Failed-run guard inputs (Codex P2 #4)** — §6.4 / §8.3 extended `extractRunInsights` signature to pass `errorMessage: string | null` alongside `runSummary` and `outcome`. §6.9 acceptance #4 reworded to remove the "no `fail` substring" wording.
5. **False-trajectory per-entry verdicts (Codex P2 #5)** — §6.5 matrix `success|false|any` row expanded into per-entry-type rows.
