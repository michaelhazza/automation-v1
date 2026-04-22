# Spec Review Log — CRM Query Planner v1 — Iteration 2

**Timestamp:** 2026-04-22T03:16:21Z
**Spec path:** `tasks/builds/crm-query-planner/spec.md`
**Spec commit at start:** `22f43aa8c467b9b3ccf283ebc65affcc9fe1e5d6` (iteration 1 edits still uncommitted in working tree)
**Codex output:** `tasks/review-logs/_spec-review-crm-query-planner-iter2-codex-output.txt`

## Contents

- Findings F1–F6 (contract drift / sequencing / validator / cache / promotion)
- Findings F7–F12 (metric + rollout + action registry + cost + file inventory + low-severity)
- Classification summary
- Iteration 2 Summary
- Stopping heuristic evaluation after iteration 2

---

## Findings F1–F6

### FINDING F1 — Stage 3 prompt still references removed `source='unsupported'`
- Source: Codex
- Section: §6.2 + §10.2 (prompt body)
- Description: `QuerySource` was narrowed in iter-1 to `'canonical' | 'live' | 'hybrid'`, but the Stage 3 prompt body (line 726) still tells the model to `set source='unsupported'`. Direct self-contradiction.
- Classification: mechanical
- Disposition: AUTO-APPLY. Prompt changed to `set intentClass='unsupported'` (the `QueryIntentClass` enum retains `'unsupported'` as planner-internal); documented how the service treats `intentClass: 'unsupported'` as the terminal signal and never reads `source` on an unsupported plan.

### FINDING F2 — Contract drift against real primitives (`llmRouter`, `rateLimiter`, `ghlReadHelpers`)
- Source: Codex
- Section: §10.1 + §13.1 + §13.2 + §13.5 + §13.6
- Description: Three sub-claims:
  1. `llmRouter.routeCall` doesn't take `schema:` / `task:` / top-level `model:`. Real signature: `RouterCallParams { messages, system?, tools?, maxTokens?, temperature?, context: LLMCallContext, abortSignal?, postProcess?, stream? }`. `task` → `context.taskType`, `model` → `context.model`, schema validation via `postProcess`. Also: `systemCallerPolicy` valid values are `'respect_routing' | 'bypass_routing'` (no `'strict'`); `orgId` → `organisationId`; `sourceId` requires a UUID.
  2. `getProviderRateLimiter('ghl').acquire(...)` returns `Promise<void>`, not a releaser. Spec had `const release = await rateLimiter.acquire(...)` then `finally { release(); }` — wrong.
  3. `ghlReadHelpers` exposes per-resource helpers (`listGhlContacts`, `listGhlAutomations`, `listGhlUsers`, `listGhlFromAddresses`, `listGhlFromNumbers`) — there is no generic `.query(...)` method.
- Classification: mechanical (factual correction against existing primitives)
- Disposition: AUTO-APPLY. §10.1 rewritten with correct `RouterCallParams` shape (context.taskType, context.model, context.organisationId, systemCallerPolicy: 'bypass_routing', postProcess signature matching reality, response parsed via `JSON.parse` + `DraftQueryPlanSchema`). §13.1 rewritten: `acquire(locationId)` no release; introduced `dispatchGhlRead` as the per-endpoint dispatcher mapping `TranslatedGhlRead.endpoint` → correct `listGhl*` helper. §13.2 + §13.5 + §13.6 updated to match. `server/db/schema/llmRequests.ts` added to §5 (extending `TASK_TYPES` with `'crm_query_planner'` is a TS-const change, not a DB schema change).

### FINDING F3 — `withPrincipalContext` used as standalone wrapper but real primitive requires nesting inside `withOrgTx`
- Source: Codex
- Section: §16.4
- Description: Real `withPrincipalContext(principal, work)` throws if not called inside an active `withOrgTx(...)` block (see `server/db/withPrincipalContext.ts:29-33`). Spec described it as a standalone pipeline wrapper. Load-bearing RLS claim with wrong mechanism.
- Classification: mechanical (factual correction against existing primitive)
- Disposition: AUTO-APPLY. §16.4 rewritten with nested `withOrgTx` → `withPrincipalContext` pattern; principal-context shape corrected (`{ organisationId, subaccountId, type, id, teamIds }`); call-site is top of `crmQueryPlannerService.runQuery`. Live reads noted as OAuth-token-scoped (no principal-context needed), but still inside outer `withOrgTx` so canonical side-queries stay RLS-correct.

### FINDING F4 — P1 Stage 1 reduced-validator subset depends on `schemaContext` which ships in P2
- Source: Codex
- Section: §8.3 vs §19 P1/P2 file list
- Description: Iter-1 added a Stage 1 validator subset that checks field existence, operator sanity, and projection overlap against "the caller's current schemaContext". But `schemaContextService.ts` / `schemaContextPure.ts` are P2 files; in P1 they do not exist. Real sequencing bug.
- Classification: mechanical (sequencing fix)
- Disposition: AUTO-APPLY. Rewrote §8.3 to route the Stage 1 subset through a new static `allowedFields: Record<string, { operators, projectable, sortable }>` map declared on each `CanonicalQueryRegistryEntry` (§6.3 extended). The 8 v1 registry entries have known canonical shapes; declaring their field/operator/projection envelope inline is a pure addition with no `schemaContext` dependency. P1 Stage 1 is now self-contained.

### FINDING F5 — Cache contract violates per-principal projection-overlap invariant
- Source: Codex
- Section: §9.1 / §9.3 + §11.2 rule 9
- Description: Plan cache is keyed on `(subaccountId, intentHash)` only. A plan validated for principal A's field-visibility envelope could be retrieved for principal B in the same subaccount whose capabilities differ, bypassing rule 9's projection-overlap check.
- Classification: mechanical (correctness fix)
- Disposition: AUTO-APPLY. Added new §9.3.1 "Cache hits rerun per-principal validation rules": on every Stage 2 hit, `planCache.get(...)` reruns rule 9 (projection overlap) + rule 11 (per-entry capability) against the caller's principal. Hits that fail are discarded (not evicted — entry survives for other principals); service emits `planner.stage2_cache_miss` with `reason: 'principal_mismatch'` (event payload updated in §17.1).

### FINDING F6 — Canonical-precedence tie-breaker drops `canonicalCandidateKey` but executor throws without it
- Source: Codex
- Section: §11.2 rule 8 vs §12.1
- Description: Rule 8's "zero live-only filters → promote to canonical AND drop `canonicalCandidateKey`" contradicts `canonicalExecutor`'s `if (!entry) throw` at the top of the dispatch function (the executor looks up the registry by `canonicalCandidateKey`). The promotion would never successfully dispatch.
- Classification: mechanical (self-contradiction)
- Disposition: AUTO-APPLY. Rewrote rule 8: promotion **keeps** `canonicalCandidateKey` populated (both canonical and hybrid executors dereference it to find the registry handler). Added a closing sentence explaining why.

---

## Findings F7–F12

### FINDING F7 — `planner.hybrid_unsupported_rate` metric is poisoned during P2
- Source: Codex + rubric
- Section: §17.2 + §19.1 P2 rewrite rule
- Description: P2 rewrites every hybrid plan to `unsupported_query` before dispatch (deliberate — hybrid executor doesn't ship until P3). So the metric reads 100 % during P2 and signals "executor not shipped" rather than "pattern gap". Deferred Items trigger for "new hybrid patterns" references this metric and inherits the ambiguity.
- Classification: mechanical (derivation + trigger qualification)
- Disposition: AUTO-APPLY. §17.2 rewritten: metric "only meaningful after P3"; chart suppressed until the first run sees a non-rewritten hybrid dispatch (`executor_dispatched.executor === 'hybrid'` is the P2→P3 crossover marker). Deferred Items trigger for hybrid patterns qualified with "after P3 ships".

### FINDING F8 — Route gate, request body, and rollout gate describe two different access models
- Source: Codex
- Section: §4 data flow + §18.1 route + §21.3 rollout
- Description: Two inconsistencies:
  1. Route gate requires "any CRM read capability" (§18.1), but rollout grants `crm.query` specifically (§21.3). One access gate or two?
  2. Request body accepts `orgId`, `userId`, `runId` as payload fields — an authenticated caller could lie about any of them and bypass RLS.
- Classification: mechanical (security correctness + consistency)
- Disposition: AUTO-APPLY. §18.1 request body rewritten: only `rawIntent`, `subaccountId`, optional `briefId` come from the caller; `organisationId`, `userId`, `runId` are derived from the authenticated principal via existing `authenticate` middleware + `requireAgentRunContext()`. Route gate aligned with the rollout model: "caller must have `crm.query` capability on the target subaccount". §4 data-flow diagram updated.

### FINDING F9 — `crm.query` action entry shape doesn't match `ActionDefinition`
- Source: Codex + rubric
- Section: §18.2 vs `server/config/actionRegistry.ts:54-140`
- Description: Real `ActionDefinition` has `actionType, description, actionCategory, isExternal, defaultGateLevel, createsBoardTask, payloadFields, parameterSchema, retryPolicy, mcp?, idempotencyStrategy, scopeRequirements?, readPath, liveFetchRationale?, isMethodology?, isUniversal?`. The spec's `slug / namespace / category / gateLevel / readOnlyHint / openWorldHint / handler` (inline) shape is not a thing.
- Classification: mechanical (contract drift against concrete source of truth)
- Disposition: AUTO-APPLY. §18.2 entry rewritten against the real `ActionDefinition` shape: `actionType: 'crm.query'`, `actionCategory: 'api'`, `defaultGateLevel: 'auto'`, `readPath: 'canonical'`, `idempotencyStrategy: 'read_only'`, `scopeRequirements.validateSubaccountFields: ['subaccountId']`, MCP annotations moved to `mcp.annotations` block, `onFailure: 'skip'`, handler registration noted as separate (`ACTION_HANDLERS` pattern, not inlined on the definition).

### FINDING F10 — Cost surface has no single owner; ledger-entry claim is wrong
- Source: Codex
- Section: §6.2 + §16.2 + §17.1 + §18.1
- Description: Cost surfaces at four places (`QueryPlan.costPreview`, API response `costPreview`, `planner.executor_dispatched.predictedCostCents`, `planner.result_emitted.actualCostCents`). And iter-1 §16.2 claimed the per-query ceiling reads "llmRouter's returned ledger entries" — but the router returns `ProviderResponse`, not ledger rows. Needs one named calculator and one source-of-truth field.
- Classification: mechanical (narrow consolidation — not adding concepts, just naming the existing owner)
- Disposition: AUTO-APPLY. New §16.2.1 "Cost attribution — one calculator, one source-of-truth field": `plannerCostPure.ts` is the single calculator (`computePlannerCost(input): BriefCostPreview`); `QueryPlan.costPreview` is the source-of-truth field; all other surfaces derive from it. Inputs are `ProviderResponse.usage` objects captured from each `routeCall` (not ledger rows). `plannerCostPure.ts` + `plannerCostPure.test.ts` added to §5 inventory and §20.1 test count.

### FINDING F11 — §5 file inventory drift (mount route, SETTING_KEYS, run-all-gates)
- Source: Codex + rubric
- Section: §5 layout
- Description: Prose requires extending three existing files that don't appear in §5: `server/index.ts` (mount the new route), `server/services/systemSettingsService.ts` (allowlist the new planner keys in `SETTING_KEYS`), `scripts/run-all-gates.sh` (append the new verify script).
- Classification: mechanical (file inventory drift)
- Disposition: AUTO-APPLY. Added all three to §5: `server/index.ts` and `server/db/schema/llmRequests.ts` under `server/`; `systemSettingsService.ts` folded into `server/services/` alongside `canonicalDataService` and `systemPnlService`; `scripts/run-all-gates.sh` added as `[existing — extend]` in the `scripts/` block.

### FINDING F12 — Lower-severity drifts (5 sub-items)
- Source: Codex
- Sub-findings:
  - **F12a** — §7.4 (line 549) mentions `normalisedAt` as a diagnostic field, but iter-1 removed `normalisedAt` from the `NormalisedIntent` type.
  - **F12b** — §2.1 points alias seed list to §12.3; entries are actually in §12.2.
  - **F12c** — §24 Appendix A says "see §21 open questions"; open questions are §22.
  - **F12d** — §1.1 and §2 decision 11.8 use plural "result's contact IDs" / "contact result set" wording but §15.4 narrowed to single-contact — inconsistent.
  - **F12e** — §19 P3 "What ships" includes "any remaining approval card patterns" — contradicts the closed decision that v1 ships exactly one illustrative example.
- Classification: mechanical (all — prose hygiene)
- Disposition: AUTO-APPLY for all sub-findings.
  - F12a: §7.4 rewritten to drop the `normalisedAt` diagnostic reference and note timestamps are stamped outside the pure function.
  - F12b: fixed §12.3 → §12.2.
  - F12c: fixed §21 → §22.
  - F12d: §1.1 and §2 decision 11.8 rewritten to match single-contact v1 rule, with pointer to Deferred Items for batch-email.
  - F12e: §19 P3 rewritten — explicitly says v1 ships exactly one approval-card pattern, no additional patterns in P3.

---

## Classification summary

| Bucket | Count |
|---|---|
| Mechanical (auto-apply) | 12 primary + 5 sub (F12) = 17 applied |
| Reclassified → directional | 0 |
| Directional AUTO-REJECT (framing) | 0 |
| Directional AUTO-REJECT (convention) | 0 |
| Directional AUTO-ACCEPT (convention) | 0 |
| AUTO-DECIDED (routed to tasks/todo.md) | 0 |
| Ambiguous | 0 |

**Iteration-2 counts:**
- mechanical_accepted: 17
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified → directional: 0

---

## Iteration 2 Summary

- Mechanical findings accepted:  17
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit at iteration start: `22f43aa8c467b9b3ccf283ebc65affcc9fe1e5d6` (iter-1 edits in working tree)
- Spec commit after iteration:   uncommitted (iter-1 + iter-2 edits in working tree)

---

## Stopping heuristic evaluation after iteration 2

- **Iteration cap reached?** N = 2, MAX = 5. NO.
- **Two consecutive mechanical-only rounds?** Iteration 1 had `directional_or_ambiguous = 2` (#16 reclassified + #20 AUTO-DECIDED clarification). Iteration 2 had `directional_or_ambiguous = 0`. Need two consecutive rounds with ALL of `directional == 0 AND ambiguous == 0 AND reclassified == 0`. Iter-1 fails that test → cannot stop via this condition at N=2.
- **Codex produced no findings?** 12 findings this round. NO.
- **Zero acceptance drought for two consecutive rounds?** 17 accepted. NO.

**Decision: start iteration 3.** Iteration 2 surfaced real correctness + contract-drift findings that iteration 1 missed (rate-limiter API misuse, principal-context nesting requirement, cache per-principal leakage, cost-surface ownership). Iteration 3 may surface more. The spec is converging but hasn't stabilised.

