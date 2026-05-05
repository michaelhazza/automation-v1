# Spec Review Log — CRM Query Planner v1 — Iteration 3

**Timestamp:** 2026-04-22T03:44:00Z
**Spec path:** `tasks/builds/crm-query-planner/spec.md`
**Spec commit at start:** `22f43aa8c467b9b3ccf283ebc65affcc9fe1e5d6` (iter-1 + iter-2 edits in working tree)
**Codex output:** `tasks/review-logs/_spec-review-crm-query-planner-iter3-codex-output.txt`

## Contents

- Findings F1–F6 (router drift / cost contract / runCostBreaker / validator signatures / event wiring / ghlReadHelpers inventory)
- Findings F7–F12 (capability taxonomy / stale release / readPath / schema-changes wording / ungrounded primitives / metric formula)
- Classification summary
- Iteration 3 Summary
- Stopping heuristic evaluation after iteration 3

---

## Findings F1–F6

### FINDING F1 — `llmRouter.routeCall` drift in §4 data flow + tier names passed as `context.model`
- Source: Codex
- Section: §4 diagram + §10.3
- Description: §4's Stage 3 block still used retired `task:` / top-level `model:` / `schema:` args and stale `orgId` (iter-2 fixed this only in §10.1). §10.3 `resolvePlannerTier` returns an abstract tier (`'haiku'` / `'sonnet'`) but in `bypass_routing` mode the router expects a concrete provider/model identifier in `context.model`.
- Classification: mechanical (factual correction)
- Disposition: AUTO-APPLY. §4 Stage 3 block rewritten to match the current `routeCall` shape (full `context` block with `taskType`, `organisationId`, `model`, `systemCallerPolicy: 'bypass_routing'`; `postProcess` + re-parse of `response.content`). §10.3 updated: `resolvePlannerTier` returns a concrete string (e.g. `'claude-haiku-4-5'`), `systemSettings` defaults now carry real model identifiers (`claude-haiku-4-5` / `claude-sonnet-4-6`), per-org overrides same.

### FINDING F2 — `BriefCostPreview` real shape is `{ predictedCostCents, confidence, basedOn }`; no `predicted/actual` split
- Source: Codex
- Section: §6.2 (`DraftQueryPlan`) + §16.2.1
- Description: iter-2 §16.2.1 described `BriefCostPreview` as carrying both `predicted` and `actual` slots and read `computePlannerCost(...).actual.cents`. The real type in `shared/types/briefResultContract.ts:162-167` is `{ predictedCostCents, confidence, basedOn }` only. Plus: `DraftQueryPlan` inherited `costPreview` via `Omit<QueryPlan, 'validated' | 'stageResolved'>`, meaning the LLM schema would have to emit planner-derived cost data.
- Classification: mechanical (contract drift against concrete wire type)
- Disposition: AUTO-APPLY. §16.2.1 rewritten: `computePlannerCostPreview` returns real `BriefCostPreview`; a separate `computeActualCostCents` returns a `number` for observability (`planner.result_emitted.actualCostCents`) and for the per-query ceiling check. `DraftQueryPlan` narrowed to `Omit<QueryPlan, 'validated' | 'stageResolved' | 'costPreview'>` so the LLM no longer has to emit cost; service fills `costPreview` post-parse. `QueryPlan.costPreview` still matches the wire type exactly.

### FINDING F3 — `runCostBreaker.assertWithinRunBudgetFromLedger` is post-ledger; can't be called pre-Stage-3
- Source: Codex
- Section: §16.2
- Description: The real helper (`server/lib/runCostBreaker.ts:225`) requires an already-inserted `llm_requests` row id — it's the post-ledger sibling called from inside `llmRouter`, not a pre-call gate. Spec said "called before Stage 3 and before live-executor dispatch". Also conflicts with the new auth-derived `runId` rule that allows `runId === undefined` for human callers while §16.2 said every invocation runs inside one.
- Classification: mechanical (factual correction against existing primitive)
- Disposition: AUTO-APPLY. §16.2 rewritten: planner does not call `runCostBreaker` directly. Per-run enforcement rides on the router's internal `assertWithinRunBudgetFromLedger` call on every `routeCall` that carries `runId`; `crmQueryPlannerService` catches `BudgetExceededError` and maps to `BriefErrorResult { errorCode: 'cost_exceeded' }`. Human callers without `runId` rely on the per-query cent ceiling + the router's existing per-subaccount/per-day budgets — no planner-local per-run check.

### FINDING F4 — Permission-sensitive validation has no single authoritative signature; cache hit references non-existent "Rule 11"
- Source: Codex + rubric
- Section: §8.1 (Stage 1 contract) + §11.1 (Stage 4 contract) + §9.3.1 (cache hit) + §11.2 (rules list)
- Description: Stage 1 declared as `(intent, registry) → QueryPlan|null`; Stage 4 as `(draft, schemaContext, registry) → QueryPlan|ValidationError`. But §8.3 Rule 9 (projection overlap) and §9.3.1 per-principal rerun need the caller's principal context. §9.3.1 even called it "Rule 11" but §11.2 only listed 9 rules.
- Classification: mechanical (signature + rules-list fix)
- Disposition: AUTO-APPLY. Stage 1 contract extended to `(NormalisedIntent, CanonicalQueryRegistry, PrincipalContext) → QueryPlan|null`. Stage 4 contract extended to `(DraftQueryPlan, SchemaContext, CanonicalQueryRegistry, PrincipalContext) → QueryPlan|ValidationError`. Added **Rule 10 — Per-entry capability check** to §11.2 (caller's `capabilityMap` must contain every capability in `registry[plan.canonicalCandidateKey].requiredCapabilities` for canonical/hybrid plans). §9.3.1 reference to "Rule 11" corrected to "Rule 10".

### FINDING F5 — Agent-log event wiring can't work as written (closed event-type union + required runId)
- Source: Codex
- Section: §17 intro + §17.1 + agent-log contract
- Description: Spec said `plannerEvents.emit` forwards to `tryEmitAgentEvent` so events surface in Agent Live Execution Log. But `shared/types/agentExecutionLog.ts` has a closed `AgentExecutionEventType` union and `agentExecutionEventService.appendEvent` requires `runId` + known `sourceService`. `PlannerEvent.runId` is optional, and human callers may not have one. As written, emission would throw.
- Classification: mechanical (correctness fix)
- Disposition: AUTO-APPLY. §17 intro rewritten: `plannerEvents.emit` always emits structured log lines + metrics counters; agent-log forwarding is a **conditional** step gated on both `runId` presence and a mapping to existing `AgentExecutionEventType` values (`skill_start` / `skill_complete` / `skill_error`) with `sourceService: 'crm-query-planner'`. Raw `planner.*` kind preserved in the event payload. No changes to `shared/types/agentExecutionLog.ts` or the service ship in this spec; a Deferred Items entry tracks "native planner event types in `AgentExecutionEventType`" as a BUILD-WHEN-SIGNAL follow-up.

### FINDING F6 — Live-executor overstates `ghlReadHelpers` surface; file missing from §5
- Source: Codex
- Section: §5 + §13.1 dispatcher
- Description: Dispatcher names `listContacts / listOpportunities / listAppointments / listConversations / listTasks / listUsers` endpoints, but the real `ghlReadHelpers.ts` exports only `listGhlAutomations / listGhlContacts / listGhlUsers / listGhlFromAddresses / listGhlFromNumbers`. §5 file inventory did not mark `ghlReadHelpers.ts` as `[existing — extend]`.
- Classification: mechanical (file inventory + sequencing)
- Disposition: AUTO-APPLY. §5 adds `server/services/adapters/ghlReadHelpers.ts` as `[existing — extend in P2]` with the four new helpers (`listGhlOpportunities`, `listGhlAppointments`, `listGhlConversations`, `listGhlTasks`) named explicitly. §13.1 dispatcher description updated to acknowledge current vs P2 state and note that P1 cannot dispatch live reads because P1 Stage 3 stubs to `unsupported_query`.

---

## Findings F7–F12

### FINDING F7 — Capability taxonomy (`canonical.contacts.read` etc.) has no source-of-truth file
- Source: Codex + rubric
- Section: §12.1 (executor per-entry check) + §12.2 (registry entries) + §18.1 (route gate) + §21.3 (rollout)
- Description: Spec uses capability slugs (`crm.query`, `canonical.contacts.read`, `canonical.opportunities.read`, `canonical.revenue.read`, `clientpulse.health_snapshots.read`, …) that don't exist anywhere in the repo outside this spec. Without an anchored taxonomy, route gating, rollout, executor gating, and tests have no concrete target. Spec referenced `server/lib/permissions.ts or equivalent` — no equivalent was named.
- Classification: mechanical (ground the claim)
- Disposition: AUTO-APPLY. §12.1 given a new **Capability taxonomy note for v1**: only `crm.query` is a v1-grantable skill slug (registered in `actionRegistry.ts` §18.2, which feeds `capabilityMap.skills` via `computeCapabilityMapPure` in `server/services/capabilityMapService.ts`). Per-entry `canonical.*` / `clientpulse.*` slugs stay on `CanonicalQueryRegistryEntry.requiredCapabilities` as forward-looking metadata — the v1 route gate enforces `crm.query`; per-entry enforcement runs against whatever `capabilityMap` actually grants (missing slugs = absent) and becomes a real gate in v2 when the canonical-capability source of truth ships. §18.1 and a new Deferred Items entry "Canonical-data capability source of truth" make this explicit.

### FINDING F8 — Stale rate-limiter `release()` language in P2 exit criteria + integration-test fallback
- Source: Codex
- Section: §19.1 P2 exit criteria line + §20.2 integration test pure-conversion note
- Description: Iter-2 fixed the code blocks in §13 but left "acquire + release" phrasing in two downstream places: the P2 exit criterion "Rate limiter acquired + released correctly in all success + error paths" and the §20.2 pure-conversion note "Rate limiter acquire/release lifecycle".
- Classification: mechanical (prose hygiene)
- Disposition: AUTO-APPLY. Both lines rewritten to "`acquire(locationId)` awaited on every live dispatch (no release — token-bucket refill is timer-driven)" — matches the §13.5 correction.

### FINDING F9 — `readPath: 'canonical'` on `crm.query` is structurally misleading
- Source: Codex + rubric
- Section: §18.2 `crm.query` `ActionDefinition`
- Description: `readPath` in `ActionDefinition` (`server/config/actionRegistry.ts:109-123`) describes where the action reads from — it is not a "read-only" marker. The planner explicitly falls through to live and hybrid paths, so `readPath: 'canonical'` would misreport the action to `verify-skill-read-paths.sh` and to read-path reporting.
- Classification: mechanical (contract match)
- Disposition: AUTO-APPLY. Changed `readPath` to `'liveFetch'` with a concrete `liveFetchRationale` explaining that canonical is the preferred path but live and hybrid fall-throughs are real, measured via `planner.llm_skipped_rate`.

### FINDING F10 — "No schema changes" success criterion contradicts `llmRequests.ts` extension
- Source: Codex
- Section: §24 success criterion 11
- Description: Success criterion 11 said `db/schema/` is unchanged; migration count unchanged. But §5 explicitly extends `server/db/schema/llmRequests.ts` to add `'crm_query_planner'` to the `TASK_TYPES` TS const array. The intent was "no DB-level migration", not "no files in `db/schema/` change".
- Classification: mechanical (wording fix)
- Disposition: AUTO-APPLY. Success criterion 11 reworded: "**No DB-level schema changes.** No new tables, no new columns, no migrations — migration count unchanged. The one change to `server/db/schema/llmRequests.ts` is a TypeScript-const extension; the `llmRequests` table and its `task_type` column remain unchanged at the database level."

### FINDING F11 — Ungrounded primitive claims: `requireAgentRunContext()` and `defaultSenderIdentifier`
- Source: Codex
- Section: §18.1 body-auth description + §15.4 approval card body
- Description:
  - **F11a:** §18.1 referenced a `requireAgentRunContext()` helper to derive `runId` from ambient context — no such helper exists in the repo.
  - **F11b:** §15.4 described `defaultSenderIdentifier` as "existing convention in `crm.send_email` dispatch paths" — the identifier does not appear elsewhere in the repo.
- Classification: mechanical (ground each claim or declare it new)
- Disposition: AUTO-APPLY.
  - F11a: replaced with a small file-local `resolveAmbientRunId(principal)` helper declared in `crmQueryPlannerService.ts` — returns `principal.runId` if present, else `undefined`. Noted `getOrgTxContext` (`server/instrumentation.ts`) as the AsyncLocalStorage pattern to mirror if v2 needs run-context discovery beyond the principal.
  - F11b: `defaultSenderIdentifier` redescribed as a **new** field on the planner-local `NormaliserContext` type (declared in `server/services/crmQueryPlanner/resultNormaliser.ts`, not an existing repo primitive). The resolution reuses the existing `subaccount_crm_connections` lookup that the shipped `crm.send_email` path already uses — the spec does not reinvent the query, it reuses it.

### FINDING F12 — Stale `canonical_classified` in `canonical_hit_rate` derivation formula
- Source: Codex
- Section: §17.2
- Description: Metric formula referenced `canonical_classified` but the event set at §17.1 only emits `planner.classified` (with `source` as a payload field).
- Classification: mechanical (derivation fix)
- Disposition: AUTO-APPLY. Formula rewritten: `count(planner.classified where payload.source === 'canonical') / count(planner.classified)`.

---

## Classification summary

| Bucket | Count |
|---|---|
| Mechanical (auto-apply) | 12 primary + 2 sub (F11a, F11b) = 14 applied |
| Reclassified → directional | 0 |
| Directional AUTO-REJECT (framing) | 0 |
| Directional AUTO-REJECT (convention) | 0 |
| Directional AUTO-ACCEPT (convention) | 0 |
| AUTO-DECIDED (routed to tasks/todo.md) | 0 |
| Ambiguous | 0 |

**Iteration-3 counts:**
- mechanical_accepted: 14
- mechanical_rejected: 0
- directional_or_ambiguous: 0
- reclassified → directional: 0

---

## Iteration 3 Summary

- Mechanical findings accepted:  14
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit at iteration start: `22f43aa8c467b9b3ccf283ebc65affcc9fe1e5d6` (iter-1 + iter-2 edits in working tree)
- Spec commit after iteration:   uncommitted (iter-1 + iter-2 + iter-3 edits in working tree)

---

## Stopping heuristic evaluation after iteration 3

- **Iteration cap reached?** N = 3, MAX = 5. NO.
- **Two consecutive mechanical-only rounds?** Iteration 2 had `directional_or_ambiguous = 0`. Iteration 3 had `directional_or_ambiguous = 0`. Both rounds had `reclassified == 0`. **YES — two consecutive mechanical-only rounds. Stop.**
- **Codex produced no findings?** 12 findings this round. N/A (heuristic 2 fires first).
- **Zero acceptance drought?** 14 accepted. N/A.

**Decision: stop. Exit condition: two-consecutive-mechanical-only.** The spec has converged on its current framing. Further iterations would yield diminishing returns — Codex is now catching only narrow contract-match issues, and the heuristic reading is that the spec is mechanically tight. Directional review (scope, phase sequencing, product judgement) is a human job from here.
