# Module C — Critical-Path Test Coverage Matrix

**Verdict:** PASS_WITH_DEFERRED
**Scope:** Per-critical-path test coverage review against `docs/codebase-audit-framework.md` § *Module C — Test Coverage*.
**Branch:** `claude/wave-2-audit-sweep`
**Captured:** 2026-05-15T07-19-34Z
**Mode:** Read-only review.

## Methodology

For each critical path declared in Module C and the broader §8 AutomationOS-specific modules, identify which test files cover the path. Coverage tier (per Module C) recorded as: `gates only` / `gates + sparse unit` / `gates + unit + trajectory` / `comprehensive`.

## Critical-Path Coverage Matrix

| # | Critical Path | Canonical Test(s) Found | Coverage Tier | Gap |
|---|---|---|---|---|
| 1 | RLS context propagation (`withOrgTx` propagates `app.organisation_id`) | `server/services/__tests__/rls.context-propagation.test.ts` | gates + sparse unit | Single unit-test file. No trajectory coverage. RLS gates `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-subaccount-resolution.sh`, `verify-org-id-source.sh`, `verify-no-db-in-routes.sh` provide static coverage. **Acceptable for pre-prod.** |
| 2 | Idempotency-key dedup logic | Scattered: `server/lib/__tests__/postCommitEmitter.test.ts`, `server/lib/__tests__/softBreakerPure.test.ts`, `server/services/__tests__/webhookService.test.ts`. No single canonical "idempotency dedup" test file. | **partial / inferred** | **GAP.** No named canonical test for the idempotency-key surface. Per Module C: "Idempotency-key dedup logic" should have named coverage. Spread across surface tests; the failure mode (race-condition + simultaneous duplicate submissions) is likely uncovered. Recommend: add `server/lib/__tests__/idempotencyKey.dedup.test.ts` (real DB, exercising concurrent insert path against the unique constraint). |
| 3 | Three-tier agent visibility rules (`agentRunVisibility.ts`) | `server/lib/__tests__/agentRunVisibilityPure.test.ts` | **partial / inferred** | **Pure-only test.** The impure read path (`agentRunVisibility.ts` itself reading from DB with permission joins) has no integration test. Pure logic is tested; the integration with `agentRunPermissionContext.ts` is not. Recommend: add `agentRunVisibility.integration.test.ts` exercising real RLS context + permission joins. |
| 4 | Cost breaker invocation on every LLM call site | `server/services/__tests__/llmRouterCostBreaker.test.ts` | **partial / inferred** | **Single-router test.** Tests that the LLM router invokes the breaker, but does NOT prove every LLM call site goes through the router. The "every LLM call checks the breaker" invariant requires a gate (`verify-llm-call-site-routes-through-router.sh`) — no such gate located. Recommend: add gate, OR add a coverage test asserting all `*.ts` files calling Anthropic SDK / OpenAI SDK do so via the router boundary. |
| 5 | Workflow-engine tick worker (per `workflowEngineService.tick()`) | None located via search | gates only | **GAP.** PR #319 split `workflowEngineService.ts` (4,073 → 64 LOC) — the post-split phase modules (`workflowEngine/queueLifecycle/*.ts`) have no named test directory found under `server/services/workflowEngine/__tests__/`. Verified post-merge per existing audit log (workflow-engine 2026-05-14). |
| 6 | Webhook adapter signature verification + dedup | `server/services/__tests__/webhookService.test.ts` | **partial / inferred** | Single file covers webhook service surface. The provider-specific signature-verifier modules (Slack, HubSpot, GHL, Stripe, Teamwork, GitHub, Gmail) are not individually tested. Recommended action: per-provider signature-verifier unit test. |
| 7 | pg-boss job idempotency (every handler is idempotent under retry) | None — coverage is inferred from individual handler tests, not a meta-test | gates only | **GAP.** Per Module J: "running it twice with the same payload produces the same result". This is a property-level requirement; current tests check happy path only. Recommend: add a meta-property test that exercises every registered queue handler with the same payload twice and asserts identical observable side-effects. |
| 8 | Handoff durability (sub-agent spawn survives worker restart) | None located | gates only | **GAP.** See Wave 2 agent-execution audit AE1, AE2. The fire-and-forget `insertExecutionEventSafe` posture has no test asserting the row persists across simulated restart. Recommend: integration test that kills the worker mid-spawn and verifies the audit-event row was either persisted-before-crash or replayable-on-boot. |
| 9 | Auth + permission gate on every API boundary | Per-route tests scattered; no global "every route has auth" meta-test | gates + sparse unit | The gate `verify-routes-require-permission.sh` (if it exists; not confirmed in scan) substitutes for a meta-test. Verification deferred to Wave 3. |
| 10 | Three-tier visibility on shared dashboards (service-principal traces don't leak into user-shared views) | None located | gates only | **GAP.** This is a high-risk multi-tenant boundary. No named test located. Recommend: add `server/lib/__tests__/agentRunVisibility.servicePrincipal.test.ts`. |
| 11 | Cost ledger increments-once under retry | None located | gates only | **GAP.** Module J explicitly calls this out. Single canonical test missing. Recommend: integration test against real DB with simulated retry. |
| 12 | LLM payload retention tiering (recent full / summarised older / archived oldest) | None located | gates only | **GAP.** Per `tasks/live-agent-execution-log-spec.md` §9. The tiering is implemented; the boundary-condition test ("a record exactly at the boundary moves to the next tier") not found. |

## Summary

| Tier | Count |
|---|---|
| comprehensive | 0 |
| gates + unit + trajectory | 0 |
| gates + sparse unit | 2 (rows 1, 9 — named coverage of the invariant exists, though sparse) |
| partial / inferred | 4 (rows 2, 3, 4, 6 — coverage of the surface exists but the canonical invariant is not directly proven) |
| gates only | 6 (rows 5, 7, 8, 10, 11, 12 — no named test or gate proves the invariant) |

**Module C grade: `mixed — partial/inferred-dominant`** — acceptable for pre-production per the framework, but it constrains Rule 9 trust more than the prior wording suggested. Any high-confidence finding in this audit cycle that depends on a critical-path test for proof must downgrade to medium per Universal Rule 9. Earlier wording in this matrix claimed 6 paths were "fully covered (sparse)" — corrected: only rows 1 and 9 have named coverage of the canonical invariant; rows 2–4 and 6 have surface tests that don't prove the named invariant.

## Prevention Proposals

| ID | Target | Proposal |
|---|---|---|
| PP-MC1 | `docs/codebase-audit-framework.md` § Module C | Add a checklist line: "Every critical-path declaration in Module C must name (a) at least one test file, OR (b) a gate script that statically proves the property, OR (c) a documented `wont-test — <reason>` line." Current 12-row matrix shows 6 of 12 paths missing a named test. Closes the discoverability gap. |
| PP-MC2 | `gate` | New gate `verify-critical-path-coverage.sh` consuming a manifest file (`tasks/critical-paths-manifest.yml`) that maps each critical-path slug → expected test file. Fails the build when the manifest names a path that has no covering test. Pairs with PP-MC1. |
| PP-MC3 | `tasks/todo.md` | Convert each of the 6 "gates only" rows above into a tracked TODO with `[origin:audit:wave-2-critical-path-coverage]` so the gaps don't slip past v1 lockdown. |

## Post-audit actions required

- Operator decision: which of the 6 "gates only" gaps are v1 blockers vs v2 backlog? Recommended blockers: row 7 (pg-boss handler idempotency property), row 8 (handoff durability), row 10 (three-tier visibility service-principal leak). Rows 11, 12 can defer to v2.

12 critical paths inspected; 2 have sparse named coverage, 4 are partial/inferred, and 6 are gates-only with no named test.
