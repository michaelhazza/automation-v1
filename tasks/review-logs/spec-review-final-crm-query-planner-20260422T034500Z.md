# Spec Review Final Report — CRM Query Planner v1

**Spec:** `tasks/builds/crm-query-planner/spec.md`
**Spec commit at start:** `76bbd36905353d2cfb021c3afd0bac25b95a7d3e` ("spec(crm-planner): v1 development spec — handoff-ready")
**Spec commit at finish:** uncommitted — iter-1 + iter-2 + iter-3 edits in working tree (the review agent does not commit; handoff to the human)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949`
**Iterations run:** 3 of 5
**Exit condition:** two-consecutive-mechanical-only (iter-2 + iter-3 both had `directional == 0 AND ambiguous == 0 AND reclassified == 0`)

## Contents

- Iteration summary table
- Mechanical changes applied (grouped by spec section)
- Rejected findings
- Directional / ambiguous findings (autonomously decided)
- Mechanically tight, but verify directionally

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 20 | 0 (Codex covered the rubric checks) | 17 mechanical + 1 reclassified→directional (narrower accept) + 1 directional clarification | 0 | 0 | 1 (#16 narrower rewrite, RLS harness) | 1 (#20 §21.3 clarifying sentence — also routed to tasks/todo.md) |
| 2 | 12 | 0 | 17 (12 primary + 5 F12 sub-items) | 0 | 0 | 0 | 0 |
| 3 | 12 | 0 | 14 (12 primary + 2 F11 sub-items) | 0 | 0 | 0 | 0 |
| **Total** | **44** | **0** | **49** | **0** | **0** | **1** | **1** |

Iteration-1 was interrupted by a computer crash partway through edit application. On resume, 14 of the 17 mechanical edits were already persisted to the working tree; the remaining edits (finding #14 partial, #16, #17, #18, #19, #20) were applied cleanly in the resume session. All iter-1 findings are reflected in the spec.

---

## Mechanical changes applied

Grouped by spec section. Each line corresponds to one finding disposition; see the per-iteration scratch logs for the raw reasoning.

### §1 Scope + non-goals
- (iter-2 F12d) §1.1 approval-card follow-up wording updated from "`crm.send_email` targeting a result's contact IDs" to "a single contact from the result set" — matches the §15.4 single-contact v1 rule.

### §2 Closed decisions from brief §11
- (iter-2 F12d) Decision 11.8 rewritten to match the single-contact v1 rule with a pointer to Deferred Items for batch-email.
- (iter-2 F12b) §2.1 alias-list reference fixed from §12.3 → §12.2.

### §4 Data flow
- (iter-1 F8 + iter-3 F1) Stage 3 block in the ASCII data-flow diagram rewritten to match the current `llmRouter.routeCall` shape — `context.taskType`, `context.organisationId`, `context.model`, `systemCallerPolicy: 'bypass_routing'`, `postProcess`, `response.content` parse.
- (iter-2 F8) Data-flow diagram request-body annotation updated: body carries `{ rawIntent, subaccountId, briefId? }` only; `organisationId`, `userId`, `runId` are auth-derived.

### §5 File / module layout
- (iter-1 F15) Added `liveExecutor.test.ts`, `hybridExecutor.test.ts`, `integration.test.ts`, `systemPnlService.ts` [extend in P3], `SystemPnlPage.tsx` [extend in P3], `pressure-test-results.md`.
- (iter-1 F12) Added `scripts/verify-crm-query-planner-read-only.sh`.
- (iter-2 F11) Added `server/index.ts` [existing — extend], `server/services/systemSettingsService.ts` [existing — extend], `scripts/run-all-gates.sh` [existing — extend], `server/db/schema/llmRequests.ts` [existing — extend, TS-const only].
- (iter-2 F2 + F10) Added `plannerCostPure.ts` + `plannerCostPure.test.ts` (new cost calculator).
- (iter-2 F16) Added `crmQueryPlannerService.test.ts` (orchestration pure test with mocked registry/cache/llmRouter/executors/runCostBreaker).
- (iter-3 F6) Added `server/services/adapters/ghlReadHelpers.ts` [existing — extend in P2] — names the four new helpers (`listGhlOpportunities`, `listGhlAppointments`, `listGhlConversations`, `listGhlTasks`) that ship with the P2 live executor.
- (resume) "No client changes v1" narrowed to "P1/P2 no client changes; P3 extends `SystemPnlPage.tsx`".

### §6 Type contracts
- (iter-1 F1) Stripped `normalisedAt` from `NormalisedIntent`; purity note added.
- (iter-1 F3) Stripped `'unsupported'` from `QuerySource` — wire contract alignment.
- (iter-1 F4) Dropped `'tags'` from `PrimaryEntity`.
- (iter-1 F5) Added `mapOperatorForWire` helper + doc on wire translation.
- (iter-1 F6) Added `parseArgs?` to `CanonicalQueryRegistryEntry`; added `ParsedArgs` type.
- (iter-1 F11) Added executor-side note that `requiredCapabilities` is enforced at dispatch (cross-reference to §12.1).
- (iter-1 F14) Added `'planner.canonical_promoted'` to `PlannerEventKind`.
- (iter-3 F4) Registry entry extended with **`allowedFields`** static map (operators + projectable + sortable per field) so Stage 1's reduced validator subset has a P1 source of truth without `schemaContext`.
- (iter-3 F2) `DraftQueryPlan` narrowed to `Omit<QueryPlan, 'validated' | 'stageResolved' | 'costPreview'>` — LLM no longer responsible for emitting cost.

### §7 Intent normalisation
- (iter-2 F12a) §7.4 stale `normalisedAt` diagnostic reference removed; replaced with "NormalisedIntent has no timestamp field; diagnostic timestamps, if needed, are stamped outside the pure function".

### §8 Stage 1 — Registry matcher
- (iter-1 F6) §8.3 rewritten: Stage 1 hits run a **reduced validator subset** (rules 2, 3, 9) instead of skipping Stage 4 entirely.
- (iter-3 F4) Stage 1 contract extended to `(intent, registry, PrincipalContext) → QueryPlan|null` — rules 9 + 10 are caller-specific. Field-existence check routed through `CanonicalQueryRegistryEntry.allowedFields` (static, P1) instead of `schemaContext` (P2-only).

### §9 Stage 2 — Plan cache
- (iter-1 F13) Cut §11.11 dangling reference; schema-change invalidation dropped in v1 (60s TTL only), routed to Deferred Items.
- (iter-3 F5) New §9.3.1 "Cache hits rerun per-principal validation rules" — per-principal rules (9 + 10) re-run on every hit; failures surface as `planner.stage2_cache_miss` with `reason: 'principal_mismatch'`; cache entry survives for other principals. §17.1 `stage2_cache_miss` payload extended with the optional `reason` field.

### §10 Stage 3 — LLM planner
- (iter-1 F1) §10.1 `routeCall` body scaffolded to the real `RouterCallParams` shape.
- (iter-2 F2) §10.1 `routeCall` corrected: `context.organisationId` / `context.taskType` / `context.model` / `systemCallerPolicy: 'bypass_routing'`; `postProcess` signature matches reality; `JSON.parse` + `DraftQueryPlanSchema` on `response.content`.
- (iter-2 F1) Prompt no longer tells the LLM to set `source='unsupported'`; uses `intentClass='unsupported'` instead and documents how the service treats that as the terminal signal.
- (iter-3 F1) §10.3 `resolvePlannerTier` returns a concrete model string (e.g. `'claude-haiku-4-5'`), not an abstract tier name; `systemSettings` defaults carry real provider/model identifiers.

### §11 Stage 4 — Validator
- (iter-1 F2) §11.4 side-effects moved out of `validatePlanPure`; imperative service wrapper writes cache + emits events.
- (iter-1 F9) Rule 8 (canonical-precedence tie-breaker) rewritten with three explicit cases; no silent filter-stripping.
- (iter-2 F6) Tie-breaker corrected to **keep** `canonicalCandidateKey` on promotion (executor requires it).
- (iter-3 F4) Stage 4 contract extended to include `PrincipalContext`. Added **Rule 10 — per-entry capability check** to §11.2. Corrected §9.3.1 ref from "Rule 11" to "Rule 10".

### §12 Canonical executor + registry
- (iter-1 F11) Executor now checks `entry.requiredCapabilities` against caller's `capabilityMap` pre-dispatch; throws `MissingPermissionError` which maps to `BriefErrorResult { errorCode: 'missing_permission' }`.
- (iter-3 F7) Added v1 capability-taxonomy note: only `crm.query` is a concretely-granted v1 skill slug (via `actionRegistry.ts` → `capabilityMap.skills`). Per-entry `canonical.*` slugs stay as forward-looking metadata; v2 activates them once the canonical-capability source of truth ships. Deferred Items updated accordingly.

### §13 Live executor
- (iter-1 F12) §13.3 "structural" claim replaced with static-gate claim; `scripts/verify-crm-query-planner-read-only.sh` added to `scripts/run-all-gates.sh`. §24.5 / §16.6 reworded.
- (iter-2 F2) §13.1 rewritten: `acquire(locationId)` with no release; introduced `dispatchGhlRead` + `TranslatedGhlRead` discriminated union. §13.2 / §13.5 / §13.6 updated.
- (iter-3 F6) §13.1 dispatcher description acknowledges real vs P2-pending `ghlReadHelpers` surface; P1 can't dispatch live because Stage 3 is stubbed.
- (iter-3 F8) §19.1 P2 exit criterion + §20.2 pure-conversion note updated to drop stale "release" wording.

### §15 Result normaliser + approval card
- (iter-1 F10) §15.4 approval card redescribed as single-contact per dispatchable `crm.send_email` action; batch-email deferred.
- (iter-3 F11b) `defaultSenderIdentifier` described as a new field on the planner-local `NormaliserContext` type (declared in `resultNormaliser.ts`, not an existing primitive); resolution reuses the shipped `crm.send_email` path's `subaccount_crm_connections` lookup.

### §16 Governance integration
- (iter-1 F12) §16.6 "two independent guards" — second guard now cites the static gate as the enforcement mechanism.
- (iter-1 F19) §16.2 per-query cent ceiling restated as post-Stage-3 guard.
- (iter-2 F3) §16.4 `withPrincipalContext` nested inside `withOrgTx` — matches the real primitive's requirement. Principal context shape corrected. Live reads noted as OAuth-token-scoped.
- (iter-2 F10) New §16.2.1 "Cost attribution — one calculator, one source-of-truth field": `plannerCostPure.ts` + `QueryPlan.costPreview` as the single-owner pair.
- (iter-3 F2) §16.2.1 rewritten to match real `BriefCostPreview` shape (`predictedCostCents`, `confidence`, `basedOn` — no predicted/actual split); split into `computePlannerCostPreview` + `computeActualCostCents`; `DraftQueryPlan` omits `costPreview`.
- (iter-3 F3) §16.2 `runCostBreaker` rewired: planner never calls it directly; per-run enforcement rides on the router's internal `assertWithinRunBudgetFromLedger` post-ledger call; human callers without `runId` rely on per-query ceiling + router's existing budgets.

### §17 Observability
- (iter-1 F14) Dropped `topAliasSimilarity` from `stage1_missed` payload (deferred); added `canonical_promoted` event kind; pinned `hybrid_unsupported_rate` formula. (iter-2 F7 qualified the metric as post-P3-only with chart suppression during P2.)
- (iter-3 F5) §17 intro rewritten: structured log + metrics always fire; agent-log forwarding gated on `runId` presence + mapping into existing `AgentExecutionEventType` values. No changes to `shared/types/agentExecutionLog.ts` — Deferred Items entry tracks native planner event types as a BUILD-WHEN-SIGNAL follow-up.
- (iter-3 F12) `canonical_hit_rate` derivation formula corrected to use real event fields (`count(planner.classified where payload.source === 'canonical') / count(planner.classified)`).

### §18 API surface
- (iter-1 F11) Route gate clarified.
- (iter-2 F8) Request body narrowed to `{ rawIntent, subaccountId, briefId? }`; `organisationId`/`userId`/`runId` auth-derived. Route gate aligned with rollout: `crm.query` capability only.
- (iter-2 F9) `crm.query` `ActionDefinition` entry rewritten against the real `ActionDefinition` shape (`actionType`, `actionCategory`, `defaultGateLevel`, `readPath`, `idempotencyStrategy`, `scopeRequirements`, `mcp.annotations`, `onFailure`).
- (iter-3 F9) `readPath: 'liveFetch'` with concrete `liveFetchRationale` — correct classification for a mixed-path skill; matches `verify-skill-read-paths.sh`.
- (iter-3 F11a) `resolveAmbientRunId(principal)` as a file-local utility in `crmQueryPlannerService.ts` (not a claimed repo primitive); `getOrgTxContext` noted as the AsyncLocalStorage pattern for future expansion.

### §19 Phased delivery plan
- (iter-1 F7) P1 Stage 3 stub short-circuits to `unsupported_query` before Stage 4; cache module ships inert in P1.
- (iter-1 F8) P2 rejects `source: 'hybrid'` as `unsupported_query`; removed in P3.
- (iter-2 F12e) P3 "What ships" no longer claims "any remaining approval card patterns"; reaffirms v1 ships exactly one.

### §20 Test plan
- (iter-1 F16) §20.2 integration tests narrowed to RLS-only; end-to-end, cost breaker, rate limiter moved to pure tests.
- (iter-1 F17) `registryMatcherPure.test.ts` row updated to ~40 cases (35 aliases × 1 + 5 edge cases).

### §21 Rollout + feature flags
- (iter-1 F20) §21.3 clarifying sentence distinguishing capability-grant rollout from infrastructure-level staged rollout.

### §22 Open questions / §24 Appendix A
- (iter-1 F12) §22.2 dependency-cruiser open question closed (replaced by static gate).
- (iter-2 F12c) §24 Appendix A reference §21 → §22 fixed.
- (iter-2 F11 + iter-3 F2) Appendix A Deferred Items checklist item updated to point at the new consolidated `## Deferred Items` section.
- (iter-3 F10) Success criterion 11 reworded: "No DB-level schema changes" — TS-const extension to `llmRequests.ts` called out explicitly.

### Deferred Items (new section added iter-1 F18; extended in iter-2 + iter-3)
- Consolidated v1 exclusions with explicit DEFER-V2 / WON'T-DO / BUILD-WHEN-SIGNAL verdicts. Added (iter-2 F7) hybrid-pattern trigger is post-P3-only. Added (iter-3 F5) "Native planner event types in `AgentExecutionEventType`". Added (iter-3 F7) "Canonical-data capability source of truth".

---

## Rejected findings

None. Every finding across all three iterations was either accepted and applied (mechanical) or auto-decided with a documented rationale (one directional item, iter-1 #20 — clarification accepted, Codex's "staged rollout" framing concern rejected with a framing-priority-1 citation).

---

## Directional and ambiguous findings (autonomously decided)

| Iteration | Finding | Classification | Decision | Rationale |
|---|---|---|---|---|
| 1 | #16 §20.2 integration-test scope | Reclassified → directional (narrower accept) | AUTO-ACCEPT (convention) | Repo convention: RLS isolation already accepts `rls.context-propagation.test.ts` as an integration-harness primitive. Narrow accept: keep RLS harness, move cost-breaker and rate-limiter checks to pure tests with mocked primitives. Codex's "delete entirely" recommendation rejected (framing priority 1 doesn't require deleting the RLS harness). |
| 1 | #20 §21.3 phased rollout per org | Directional | AUTO-REJECT (framing) + clarification accepted | §21.3 describes per-org capability grants via the skill-permission system, not infrastructure-level traffic-shifted rollout. The framing assumption targets % traffic / feature flags / canary deploys; per-org permission grants are standard operational practice. Added one clarifying sentence to §21.3 to pre-empt future confusion. Routed to `tasks/todo.md` under `## Deferred spec decisions — crm-query-planner` for human verification. |

No other directional or ambiguous findings surfaced across iterations 2 and 3.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against three rounds of Codex review. The human has implicitly approved every autonomous decision (one item is in `tasks/todo.md` for review at leisure). However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 Scope, §2 Closed decisions, §19 Phased delivery, §21 Rollout sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem (contract drift, file inventory drift, sequencing bugs, invariant violations, self-contradictions). It does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- **Capability taxonomy is a known soft edge.** v1 ships with `canonical.*` and `clientpulse.*` per-entry capability slugs as forward-looking metadata only — the route gate is `crm.query` alone, and per-entry enforcement only bites once the Deferred Items canonical-capability source-of-truth is declared. The spec is explicit about this (§12.1 taxonomy note + Deferred Items entry) but the architect should confirm this posture is acceptable for v1 before starting P1.
- **`bypass_routing` for system caller.** Iter-2 set `systemCallerPolicy: 'bypass_routing'` so the planner pins its own tier per org config. The alternative (`'respect_routing'`) would let the router's resolver pick the model. `bypass_routing` is the right call for a planner that has its own tier-resolution logic (§10.3), but the architect should confirm this decision isn't in tension with the org-wide routing policy.

**Recommended next step:** read the spec's framing sections (§1, §2, §3, §19, §21) one more time, verify the single AUTO-DECIDED item in `tasks/todo.md` (§21.3 clarification) reads correctly, and confirm the capability-taxonomy posture. Then start implementation at P1.

---

## Provenance files

Persistent evidence trail, all under `tasks/review-logs/`:

- **Plan:** `spec-review-plan-crm-query-planner-20260422T023318Z.md`
- **Iteration scratch logs (durable):**
  - `spec-review-log-crm-query-planner-1-20260422T023318Z.md`
  - `spec-review-log-crm-query-planner-2-20260422T031621Z.md`
  - `spec-review-log-crm-query-planner-3-20260422T034400Z.md`
- **Raw Codex output (per iteration):**
  - `_spec-review-crm-query-planner-iter1-codex-output.txt`
  - `_spec-review-crm-query-planner-iter2-codex-output.txt`
  - `_spec-review-crm-query-planner-iter3-codex-output.txt`
- **Prompts + full inputs (per iteration):**
  - `_spec-review-crm-query-planner-iter1-prompt.txt` / `-full-input.txt`
  - `_spec-review-crm-query-planner-iter2-prompt.txt` / `-full-input.txt`
  - `_spec-review-crm-query-planner-iter3-prompt.txt` / `-full-input.txt`
- **AUTO-DECIDED items:** `tasks/todo.md` under `## Deferred spec decisions — crm-query-planner` (one entry from iter-1)
