# Spec Review Log — CRM Query Planner v1 — Iteration 1

**Timestamp:** 2026-04-22T02:33:18Z
**Spec path:** `tasks/builds/crm-query-planner/spec.md`
**Spec commit at start:** `76bbd36905353d2cfb021c3afd0bac25b95a7d3e`
**Codex output:** `tasks/review-logs/_spec-review-crm-query-planner-iter1-codex-output.txt`

## Contents

- Findings 1-5 (contract drift / purity violations)
- Findings 6-10 (Stage 1 bypass / phase sequencing / approval card)
- Findings 11-15 (capabilities / read-only / cache invalidation / observability / file inventory)
- Findings 16-20 (testing posture / test counts / deferred items / cost ceiling / rollout)
- Classification summary

---

## Findings 1-5

### FINDING #1 — `normalisedAt` violates pure-function claim
- Source: Codex
- Section: §6.1 + §7.4
- Description: `NormalisedIntent.normalisedAt` is a wall-clock stamp returned from `normaliseIntentPure`, but §7.4 claims the function is pure with "no clock dependency."
- Classification: mechanical
- Disposition: auto-apply — strip `normalisedAt` from `NormalisedIntent` (or move to a sibling diagnostics type).

### FINDING #2 — Validator side-effects inside a pure module
- Source: Codex
- Section: §5 + §11.4
- Description: `validatePlanPure.ts` is declared pure, but §11.4 says validation success writes to `planCache` and emits `planner.classified`.
- Classification: mechanical
- Disposition: auto-apply — move cache write + event emission into `crmQueryPlannerService.ts` after pure validate returns success.

### FINDING #3 — `'unsupported'` in `QuerySource` contradicts wire contract
- Source: Codex + rubric
- Section: §6.2 + §15.2
- Description: `QuerySource` includes `'unsupported'`, but `BriefResultSource` is `'canonical' | 'live' | 'hybrid'` only. §15.2 maps source through directly.
- Classification: mechanical
- Disposition: auto-apply — strip `'unsupported'` from `QuerySource`; unsupported queries emit `BriefErrorResult { errorCode: 'unsupported_query' }` and never reach the executor.

### FINDING #4 — `PrimaryEntity` includes `'tags'` but wire contract does not
- Source: Codex + rubric
- Section: §6.2 + §15.2
- Description: `PrimaryEntity` has `'tags'`, but `BriefResultEntityType` does not. §15.2 copies through.
- Classification: mechanical
- Disposition: auto-apply — drop `'tags'` from `PrimaryEntity`. The tag-count query already uses `primaryEntity: 'contacts'`.

### FINDING #5 — `QueryFilter.operator` vocabulary drift vs wire contract
- Source: Codex
- Section: §6.2 + §15.2
- Description: `QueryFilter.operator` uses `ne`, `nin`, `starts_with`, `is_null`, `is_not_null`; `BriefResultFilter.operator` doc-comment lists `eq | neq | gt | gte | lt | lte | in | contains | between | exists`.
- Classification: mechanical
- Disposition: auto-apply — add an explicit `mapOperatorForWire` pure helper; document the translation.

---

## Findings 6-10

### FINDING #6 — Stage 1 bypasses validation with untyped `parseArgs` hook
- Source: Codex
- Section: §8.3 + §11.2 + §6.3
- Description: Stage 1 skips Stage 4; `parseArgs?: (intent) => ParsedArgs | null` is named in §8.3 prose but missing from §6.3 registry type.
- Classification: mechanical
- Disposition: auto-apply — add `parseArgs` to `CanonicalQueryRegistryEntry`; tighten §8.3 to "Stage 1 outputs run a minimum validator subset: field-existence + projection-overlap only."

### FINDING #7 — P1 cache is inert given Stage 3 stub
- Source: Codex
- Section: §9.3 + §19 P1
- Description: Only `stageResolved === 3` plans are cached; P1 stubs Stage 3 to return `unsupported_query`.
- Classification: mechanical
- Disposition: auto-apply — §19 P1 says Stage 3 stub short-circuits to `BriefErrorResult { errorCode: 'unsupported_query' }` before Stage 4; cache module ships but holds no entries until P2.

### FINDING #8 — Hybrid classification before hybrid executor ships
- Source: Codex
- Section: §10.2 + §11.2 + §19 P2/P3
- Description: P2 adds Stage 3 + hybrid validator branch; P3 ships `hybridExecutor.ts`.
- Classification: mechanical
- Disposition: auto-apply — until P3, validator rejects `source: 'hybrid'` as `unsupported_query`. Rejection removed in P3.

### FINDING #9 — Canonical-precedence tie-breaker silently strips filters
- Source: Codex
- Section: §11.2 rule 8 + §14.1
- Description: Rule 8 promotes `live → canonical` and strips live-only filters whenever `canonicalCandidateKey` is set — changes user semantics.
- Classification: mechanical
- Disposition: auto-apply — rewrite rule 8: promote only when zero live-only filters; else hybrid (if pattern matches) or live.

### FINDING #10 — Approval card shape doesn't match registered `crm.send_email`
- Source: Codex + rubric
- Section: §15.4
- Description: Registered schema requires `{ from, toContactId, subject, body, scheduleHint?, scheduledFor?, provider? }` (single contact); spec emits `{ contactIds: string[], templatePickerRequired: true }`.
- Classification: mechanical
- Disposition: auto-apply — redescribe the card as per-contact (one card per row, up to ≤50 cap) with `{ from, toContactId, subject, body }` populated from plan + placeholder template. Batch-email flagged to deferred items.

---

## Findings 11-15

### FINDING #11 — `requiredCapabilities` declared but not enforced
- Source: Codex + rubric
- Section: §6.3 + §12.2 + §18.1
- Description: `requiredCapabilities` on registry entries is declared but never consumed; route gate hardcodes `canonical.contacts.read`, wrong for revenue/opportunity queries.
- Classification: mechanical
- Disposition: auto-apply — executor checks `entry.requiredCapabilities` against caller's capability map before dispatch; route gate enforces "any CRM read capability" minimum; per-entry enforcement at executor.

### FINDING #12 — "Structural / compile-time" read-only claim overstates v1 mechanism
- Source: Codex + rubric
- Section: §13.3 + §16.6 + §24.5
- Description: §24.5 claims "compile errors, not runtime errors" for write attempts; §13.3 admits convention-only enforcement.
- Classification: mechanical
- Disposition: auto-apply — add `scripts/verify-crm-query-planner-read-only.sh` to §5 + §16.6 as the v1 static gate; downgrade §24.5 to "attempted write imports fail the static gate at CI."

### FINDING #13 — Cache invalidation mechanism unnamed; broken §11.11 cross-ref
- Source: Codex + rubric
- Section: §9.2 + §5
- Description: §9.2 names `canonical_subaccount_mutations` version-change flush but no listener/poller/function is named. §11.11 reference is dangling (spec's §11 is Validator).
- Classification: mechanical
- Disposition: auto-apply — cut to TTL-only invalidation in v1; fix/remove §11.11 pointer; add "schema-change-driven cache flush" to Deferred Items.

### FINDING #14 — Observability drift: missing `canonical_promoted`; unbacked metrics
- Source: Codex + rubric
- Section: §6.6 + §17.1 + §17.2
- Description: `planner.canonical_promoted` in §17.1 table but not in §6.6 `PlannerEventKind`. `topAliasSimilarity` + `hybrid_unsupported_rate` have no derivation.
- Classification: mechanical
- Disposition: auto-apply — (a) add `'planner.canonical_promoted'` to union; (b) drop `topAliasSimilarity` from `stage1_missed` payload (deferred); (c) pin `hybrid_unsupported_rate` derivation formula.

### FINDING #15 — File inventory drift (multiple files missing from §5)
- Source: Codex + rubric
- Section: §5 + §19 P3 + §20.2 + §20.3
- Description: Files named later but not in §5: `integration.test.ts`, `liveExecutor.test.ts`, `hybridExecutor.test.ts`, `systemPnlService.ts` extension, `SystemPnlPage.tsx` modification, `pressure-test-results.md`. "No client changes v1" contradicts P3.
- Classification: mechanical
- Disposition: auto-apply — add referenced files to §5; revise "no client changes" line to "no client changes in P1/P2; P3 extends `SystemPnlPage.tsx`."

---

## Findings 16-20

### FINDING #16 — Integration-test scope vs framing
- Source: Codex
- Section: §20.2 + §20.4
- Description: §20.2 defines a route-level `integration.test.ts`. Framing: `api_contract_tests: none_for_now`, `testing_posture: static_gates_primary`.
- Classification: **reclassified → directional**
- Reasoning: Narrow mechanical move is to keep RLS isolation (repo already accepts `rls.context-propagation.test.ts` as an integration-harness primitive) and restate other checks as pure tests around mocked breakers/limiters.
- Disposition: AUTO-ACCEPT narrower rewrite (convention priority 2: repo has an accepted integration-harness primitive for RLS) + AUTO-REJECT Codex's "delete entirely" recommendation (framing priority 1 doesn't require deleting the RLS harness). §20.2 rewrite: "RLS isolation: one integration test using the `rls.context-propagation.test.ts` harness pattern; cost-breaker + rate-limiter behaviour verified via pure tests with mocked primitives."

### FINDING #17 — Test case count drift: `registryMatcherPure.test.ts`
- Source: Codex
- Section: §8.4 + §12.2 + §20.1
- Description: §20.1 row says 15 minimum; §8.4 requires every alias (35+) for 8 entries; arithmetic mismatch.
- Classification: mechanical
- Disposition: auto-apply — update §20.1 row to `35+ aliases × 1 + 5 edge cases ≈ 40 cases`; match §8.4 language.

### FINDING #18 — Missing single `## Deferred Items` section
- Source: Codex + rubric
- Section: Appendix A + §§1.2, 1.3, 22
- Description: Deferred items scattered across §1.2, §1.3, §2.1, §19.1, §22. Authoring checklist §7 requires one `## Deferred Items` section.
- Classification: mechanical
- Disposition: auto-apply — add a new `## Deferred Items` section consolidating: hybrid patterns beyond v1, semantic/fuzzy cache match, Query Memory Layer surfacing, non-GHL adapters, `crm.schema_describe`, external MCP exposure, Brief chat surface, free-text writes, plan-cache persistence, schema-change cache invalidation, batch-email approval card, dependency-cruiser rule (if not adopting static gate), `topAliasSimilarity` analytics, stopgap "Ask CRM" panel. Each entry with explicit DEFER-V2 / WON'T-DO / BUILD-WHEN-SIGNAL verdict.

### FINDING #19 — Per-query cent ceiling pre-check is unsatisfiable
- Source: Codex
- Section: §16.2 + §24.6
- Description: §16.2 says check "accumulated cost so far" BEFORE Stage 3, but at pre-Stage-3 the value is zero.
- Classification: mechanical
- Disposition: auto-apply — restate guard as post-Stage-3 (post-escalation) check: if summed LLM cost > ceiling, return `cost_exceeded` before executor dispatch.

### FINDING #20 — `§21.3 Phased rollout per org`
- Source: Codex
- Section: §21.3
- Description: Codex flags conflict with `staged_rollout: never_for_this_codebase_yet`.
- Classification: directional
- Disposition: **AUTO-REJECT (framing priority 1 interpreted correctly)** — §21.3 describes per-org capability grants (permission-system provisioning), not infrastructure-level traffic-shifted rollout. The framing statement targets % traffic / canary / feature-flag rollout; per-org permission grants are standard operational practice. Add one clarifying sentence to §21.3 to pre-empt future confusion.
- Logged to `tasks/todo.md` as AUTO-DECIDED (low-stakes clarification).

---

## Classification summary

| Bucket | Count |
|---|---|
| Mechanical (auto-apply) | 17 |
| Reclassified → directional (auto-accept narrower rewrite) | 1 (#16) |
| Directional AUTO-REJECT (framing) | 1 (#20, with clarification sentence auto-accepted) |
| Ambiguous | 0 |

**Iteration-1 counts:**
- mechanical_accepted: 17
- mechanical_rejected: 0
- directional_or_ambiguous: 2 (#16 narrow accept, #20 clarify)

---

## Iteration 1 Summary

- Mechanical findings accepted:  17
- Mechanical findings rejected:  0
- Directional findings:          1 (#20)
- Ambiguous findings:            0
- Reclassified → directional:    1 (#16)
- Autonomous decisions (directional/ambiguous): 2
  - AUTO-REJECT (framing):    0 (#20 partially rejected — accepted clarifying sentence only)
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 1 (#16 narrower rewrite — RLS harness primitive convention)
  - AUTO-DECIDED:             1 (#20 — clarifying sentence added inline; routed to tasks/todo.md)
- Spec commit at iteration start: `76bbd36905353d2cfb021c3afd0bac25b95a7d3e`
- Spec commit after iteration:   uncommitted (edits applied to working tree)

---

## Resume note

This iteration was interrupted by a computer crash partway through Step 6 (edit application). On resume, 14 of 17 mechanical edits were already applied and persisted to the working tree; remaining edits (finding #14 partial — `topAliasSimilarity` + `hybrid_unsupported_rate`; findings #16, #17, #18, #19, #20) were applied cleanly in the resume session. All 20 findings are now reflected in the spec. Final diff: 204 insertions / 56 deletions.

