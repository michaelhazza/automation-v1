# PR Review — CRM Query Planner (second-pass, post B1–B6 fixes)
**Reviewed:** 2026-04-22T10-30-00Z
**Branch:** `claude/crm-query-planner-WR6PF`
**Scope:** Verification of fixes applied in response to `tasks/review-logs/pr-review-log-crm-query-planner-2026-04-22T09-45-00Z.md`.

---

## Verification of B1–B6 fixes

### B1 — budget error shape matching → RESOLVED
- `isBudgetExceededError` covers all three router shapes: typed `BudgetExceededError`, plain `{ statusCode: 402 }` pre-call, `FailureError` with `cost_limit_exceeded` post-ledger.
- Two new tests in `crmQueryPlannerService.test.ts` cover shapes #2 and #3.

### B2 — `wasEscalated` propagation → RESOLVED
- `llmPlanner.ts` threads `wasEscalated` + `escalationReason` through `singleLlmCall` → router context. Both escalation branches (`hybrid_detected`, `low_confidence`) set the flag correctly. Router persists to `llm_requests.was_escalated` / `escalation_reason`.

### B3 — rate-limiter key → RESOLVED
- `liveExecutor.ts` now keys on `ghlCtx.locationId` resolved from `integration_connections.configJson` — matches `ghlAdapter.acquireGhlToken` keying. `subaccountLocationId` marked `@deprecated` and optional. Route's `as any` cast removed.

### B4 — stale Stage 3 test → RESOLVED
- `RunQueryDeps.runLlmStage3?` seam + 4 rewritten/new tests. `systemSettingsService.get` fail-open to 100¢ default with warn log.

### B5 — RLS integration test → RESOLVED (with caveat)
- `integration.test.ts` verifies session-variable propagation per subaccount via `current_setting(...)` probe in a stub handler. Skips cleanly without `DATABASE_URL`.
- Caveat: test verifies session-var propagation, not actual RLS row-level isolation against a protected table — see S14.

### B6 — `skillExecutor` handler → MOSTLY RESOLVED
- Handler wired at `skillExecutor.ts:1379–1410`; correctly maps context (`principalType: 'agent'`, `principalId: context.agentId`, `runId` for breaker).
- Surfaces NEW BLOCKER B7 (below).

---

## Blocking Issues

### B7. `crm.query` skill handler trusts `input.subaccountId` — cross-subaccount read exposure
- **File:** `server/services/skillExecutor.ts:1379–1410`.
- **What's wrong:** Handler resolves target as `String(input.subaccountId ?? context.subaccountId)` with no `allowedSubaccountIds` check. A subaccount-A-scoped agent can pass `input.subaccountId: 'B'` and read subaccount B's data.
- **Precedent:** `intelligenceSkillExecutor.ts:144` enforces exactly this pattern — only `allowedSubaccountIds === null` may cross boundaries.
- **Fix:**
  1. Compute `targetSubaccountId = (string input.subaccountId) ?? context.subaccountId`.
  2. If `input.subaccountId` supplied AND differs from `context.subaccountId`, require `context.allowedSubaccountIds === null` OR `includes(targetSubaccountId)`.
  3. On violation return `{ success: false, error: 'missing_permission', ... }`.

---

## Strong Recommendations

- **S11** — Error envelope inconsistent with peers (`{ error, message }` vs `{ success: false, error, message }`).
- **S12** — Misleading comment about forward-looking `canonical.*` slugs that aren't actually in the Set.
- **S13** — `err.failure?.failureDetail` optional chain unnecessary (`.failure` is required). Drop `?.` or document why.
- **S14** — RLS integration test doesn't exercise row-level isolation against a real RLS-protected table — session-var propagation only. Add companion test that queries a real canonical table.
- **S15** — `parseInt` without radix in `crmQueryPlannerService.ts:500`. Consistency with `llmPlanner.ts`.
- **S16** — Settings fail-open swallows real config regressions. Document decision in code comment or gate on NODE_ENV.

## Non-Blocking

- **N10** — Consider wrapping `runQuery` return with `{ success: true, ...result }` at the skill-executor edge for agent consumer consistency.
- **N11** — Previously-flagged S2/S3/S5/N4/N7 still present; not regressions from B1–B6.

---

## Verdict

**BLOCKERS** — one new blocker (B7) surfaced by the B6 fix itself. All six original blockers (B1–B6) correctly resolved. Must address B7 before agents are enabled to invoke `crm.query`.
