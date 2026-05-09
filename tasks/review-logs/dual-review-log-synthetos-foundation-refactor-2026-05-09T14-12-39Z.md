# Dual Review Log — synthetos-foundation-refactor

**Files reviewed:** branch `claude/openclaw-worker-mode-VnjQT` vs `main` (93 changed files; SynthetOS Phase 1 foundation refactor).
**Iterations run:** 3/3
**Timestamp:** 2026-05-09T14:12:39Z
**Codex CLI:** `/c/Users/micha/AppData/Roaming/npm/codex` v0.125.0 (`--base main`)

**Prior reviews on this branch (not re-litigated):**
- spec-conformance NON_CONFORMANT (2 deferred naming gaps SCD-1, SCD-2)
- adversarial-reviewer HOLES_FOUND (ADV-A closed in `5e80a3e4`; 2 likely-holes + 3 obs deferred)
- pr-reviewer APPROVED after 3 fix-loops (B1-B5 closed in `7001f861` and `68120f8a`); S1-S6 + N1-N7 deferred to post-merge

---

## Iteration 1

Codex returned 6 findings. All 6 ACCEPTED.

### [ACCEPT] credentialBrokerService.ts:159-162 — subaccount caller can revoke org-level connection via fallback path
**Codex severity:** P1
**Reason:** Real cross-scope authorization bug. Broker tried `revokeOrgConnection` first regardless of caller's `subaccountId`. If `credentialId` was an org-level row in the same org, a subaccount user with `connections:manage` would silently revoke an org-level credential outside their authority. Adversarial-reviewer's prior fix on the fallback UPDATE was correct but didn't cover the org-first attempt.
**Fix:** Branch on `params.subaccountId === null`; org-level path delegates to `revokeOrgConnection` (already pinned by `subaccount_id IS NULL`); subaccount path goes directly to a pinned `(id, organisationId, subaccountId)` UPDATE — no fall-through.

### [ACCEPT] subaccountAgentService.ts:308-401 — updateLink does not type or persist 4 governance fields
**Codex severity:** P2
**Reason:** Schema accepts `controllerStyleAllowed` / `allowedEnvironments` / `maxRiskTier` / `requireApprovalAtTier`, columns exist on `subaccount_agents`, but `updateLink` neither typed them nor wrote them. PATCH succeeded silently — Governance tab edits could not persist.
**Fix:** Added 4 fields to type signature and `update` builder.

### [ACCEPT] runTraceService.ts:111-262, 333-374 — cursor and filters applied AFTER LIMIT in memory
**Codex severity:** P2
**Reason:** SQL fetched `limit+1` earliest rows globally; cursor + event-type + time-range + toolSlug filters were applied in memory. A cursor past the first page → empty result with `hasMore: false`. A toolSlug filter whose first match was later than first page → silent zero. Pagination was effectively unusable beyond page 1.
**Fix:** Pushed all predicates into SQL via tagged-template fragments — tuple comparison `(ts, seq, source_table, source_id) > (cursor)` for cursor, `event_type = ANY($eventTypes)` for type filter, `ts >= $since`, `ts <= $until` for time range, and the toolSlug semantics from spec §4.4.5 (tool-scoped tables filter by their slug column / payload key; non-tool-scoped tables emit zero rows).

### [ACCEPT] credentialBrokerService.ts:218-234 — audit query filters by subaccountId in memory after LIMIT
**Codex severity:** P2
**Reason:** Same memory-vs-SQL bug. Latest 50 org-wide rows could all belong to other subaccounts, leaving the requested scope's audit history invisible.
**Fix:** Pushed `metadata ->> 'subaccountId' = $subaccountId` predicate into SQL. Imported `sql` from drizzle-orm.

### [ACCEPT] agentExecutionService.ts:692-696 — allowedEnvironments not enforced before run continues
**Codex severity:** P2
**Reason:** Spec §4.2.8 (lines 670-674) explicitly defines the gate `if (!allowed_environments.includes(env)) throw ExecutionModeNotAllowedForAgentError`. Currently a no-op — Governance restrictions on browser/headless/terminal_repo were captured in the snapshot but never enforced.
**Fix:** Added `ExecutionModeNotAllowedForAgentError` to `policyEnvelopeResolver.ts` (statusCode 403, errorCode `execution_mode_not_allowed_for_agent`). Added gate after `persistPolicyEnvelope`. Differentiated failure-path observability — env-violation emits the new `foundation.execution_environment.rejected` event code (registered in `shared/types/agentExecutionLog.ts` per spec §3.5).

### [ACCEPT] runTraceService.ts:357-364 — toolSlug filter lets non-tool-scoped tables pass through
**Codex severity:** P3
**Reason:** Spec §4.4.5 explicitly excludes `delegation_outcomes`, `review_audit_records`, `llm_requests`, `iee_steps`, and `agent_runs` when `toolSlug` is set. Code passed them through unconditionally.
**Fix:** When `toolSlug` is set, non-tool-scoped UNION arms emit zero rows via `AND FALSE`. Tool-scoped arms apply the per-spec column predicate.

## Iteration 2

Codex returned 3 findings. All 3 ACCEPTED.

### [ACCEPT] runTraceService.ts:196 — agent log event names not mapped to run-trace event names
**Codex severity:** P2
**Reason:** Source `event_type` values are log codes (`run.started`, `foundation.controller_style.derived`, `foundation.policy_envelope.resolved`); the run-trace mapper `switch` expects dotless run-trace names (`run_started`, `controller_style_decided`, `policy_envelope_resolved`). Unmapped rows fell into the default `tool_proposed` shape — controller/policy events were never displayed.
**Fix:** Added a `CASE event_type WHEN 'run.started' THEN 'run_started' ... END` translation in the `agent_execution_events` UNION arm, plus an `IN (...)` filter limiting that arm to the three run-trace-relevant log codes. Intentionally excluded `run.completed` translation to avoid double-emission with the synthesised terminal event.

### [ACCEPT] runTraceService.ts:583-584 — synthetic terminal event bypasses filters and limit
**Codex severity:** P2
**Reason:** Unconditional `events.push({ ..., eventType: 'run_terminated' })` ignored `eventTypes`, `toolSlug`, time bounds, cursor, and `limit`. A `?eventTypes=llm_call` query on a terminal run still returned the terminal event; pages could overflow `limit + 1`.
**Fix:** Gate the synthetic event on five conditions: not cursor-paged, not filtered out by `eventTypes`, not filtered out by `toolSlug` (run_terminated is not tool-scoped), within `since/until` window, and not pushing past `limit`. Skipped entirely when `hasMore=true` so it only appears on the last page.

### [ACCEPT] subaccountAgents.ts route:101-131 — route does not destructure or forward governance fields
**Codex severity:** P2
**Reason:** Iter 1 fix wired `updateLink` to accept the 4 governance fields, but the route handler in `server/routes/subaccountAgents.ts` never destructured them from `req.body` nor forwarded to `updateLink`. End-to-end PATCH still silently dropped the values.
**Fix:** Added 4 fields to destructure block and type cast, forwarded to `updateLink` call.

## Iteration 3

Codex returned 3 findings. 2 ACCEPTED, 1 REJECTED.

### [REJECT] migrations/0307_subaccount_agents_governance.sql:10 — terminal_repo excluded from default `allowed_environments`
**Codex severity:** P2
**Reason for reject:** Spec lines 1827-1831 explicitly state this is a deliberate design choice: *"`terminal_repo` is intentionally excluded from the default — the §5.2.3 UI mockup gates Terminal/Repo as 'system agents only', and subaccount-level agents must opt into terminal/repo capability explicitly."* The matching fallback in `policyEnvelopeResolver.ts:90` is consistent. Codex correctly identifies the operational impact (existing `claude-code` / `iee_dev` runs need to opt in), but the spec is the locked authority for this trade-off; reverting it would re-litigate a closed spec decision.

### [ACCEPT] integrationConnections.ts route:153-157 — revoke route returns success on no-op delete
**Codex severity:** P2
**Reason:** After Iter 1's strict scope-pinning fix, `credentialBrokerService.revoke` performs a no-op UPDATE when the connection ID does not exist or belongs to a different subaccount. The route still returned `{ success: true }`. The pre-broker route returned 404. Behavioural regression at the API contract.
**Fix:** `revoke` now returns `Promise<boolean>` (true if updated, false if no rows matched). The DELETE route maps `false → 404 'Connection not found'`. Added unit tests covering both true-path (cross-scope guard) and false-path (no-match). The `webLoginConnections.ts` route was unaffected (it does its own existence check before calling `revoke`).

### [ACCEPT] agentRuns.ts route:676-679 — run trace endpoint requires only authentication
**Codex severity:** P2
**Reason:** Codex's claim that "other run-log endpoints call the run visibility helper" doesn't match the in-file convention (`/api/agent-runs/:id/delegation-graph` and `/api/agent-runs/:id/chain` use only `authenticate`). However, the trace endpoint exposes strictly more sensitive metadata (LLM costs, tool decisions, policy envelope, available credentials) than its neighbours, and the `/api/agent-activity` family already requires `requireOrgPermission(AGENTS_VIEW)`. Adding the same permission bar is consistent defense-in-depth at no breakage cost.
**Fix:** Added `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)` to the trace route.

---

## Changes Made

| File | Summary |
|---|---|
| `server/services/credentialBrokerService.ts` | Strict scope-branch in `revoke` (no fallback); `revoke` returns `Promise<boolean>`; pushed audit subaccountId predicate into SQL via `metadata ->> 'subaccountId'`; removed unused `isNull` import; added `sql` import. |
| `server/services/subaccountAgentService.ts` | `updateLink` accepts and persists 4 governance fields. |
| `server/services/runTraceService.ts` | All filters pushed into SQL (cursor tuple comparison, event-type ANY, since/until, toolSlug per-arm); agent_execution_events log-code → run-trace-name CASE translation; synthetic run_terminated gated on filters + cursor + limit. |
| `server/services/agentExecutionService.ts` | Imports `ExecutionModeNotAllowedForAgentError` and `executionModeToEnvironment`; gates run on `allowedEnvironments` after persisting envelope; differentiated failure observability. |
| `server/services/policyEnvelopeResolver.ts` | New `ExecutionModeNotAllowedForAgentError` class. |
| `server/services/agentExecutionEventServicePure.ts` | New validator branch for `foundation.execution_environment.rejected`. |
| `shared/types/agentExecutionLog.ts` | Registered `foundation.execution_environment.rejected` event type + payload + non-critical bit. |
| `server/routes/subaccountAgents.ts` | PATCH handler destructures + forwards 4 governance fields. |
| `server/routes/integrationConnections.ts` | DELETE route maps `revoke=false → 404`. |
| `server/routes/agentRuns.ts` | Run trace route requires `AGENTS_VIEW`. |
| `server/services/__tests__/credentialBrokerService.test.ts` | Added `sql` to drizzle-orm mock; updated subaccountId test to reflect SQL pushdown; added cross-scope guard regression test; added false-return regression test. |
| `server/services/__tests__/runTraceService.test.ts` | Updated cursor/eventType/toolSlug tests to reflect SQL pushdown semantics. |

12 source files modified, 2 test files updated. All 92 targeted unit tests pass; lint 0 errors; typecheck clean.

## Rejected Recommendations

**Iter 3 / Migration default `allowed_environments` excludes `terminal_repo`** — explicitly chosen in spec lines 1827-1831 (see iter 3 decision log for full rationale). Operational opt-in is the documented path; no code change.

---

**Verdict:** APPROVED (3 iterations, 11 findings raised, 10 accepted + applied, 1 rejected with documented spec rationale)
