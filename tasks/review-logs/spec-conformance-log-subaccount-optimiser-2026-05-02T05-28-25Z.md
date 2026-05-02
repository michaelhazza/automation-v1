# Spec Conformance Log — Re-verification

**Spec:** `docs/sub-account-optimiser-spec.md`
**Spec commit at check:** `d47ca0c6` (main branch HEAD; spec text unchanged from prior run at `173a4b47`)
**Branch:** `claude/subaccount-optimiser`
**Worktree:** `c:/files/Claude/automation-v1.subaccount-optimiser`
**Branch HEAD at re-check:** `a338c373`
**Branch HEAD at prior check:** `1ba02c3b`
**Base (merge-base with main):** `6d6c6ff48174b5913a1132c8cd41b93babb30c6d`
**Scope:** targeted re-verification of B1-B10 + B12 (the 11 directional gaps the main session reports as fixed). B11/B13/B14/B16 remain intentionally deferred and were NOT re-examined per caller direction.
**Run at:** 2026-05-02T05:28:25Z
**Prior log:** `tasks/review-logs/spec-conformance-log-subaccount-optimiser-2026-05-02T05-00-11Z.md`
**Commit at finish:** `541fc2c4`

---

## Summary

- Gaps re-verified:                  11 (B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B12)
- PASS (gap closed):                 11
- Still open after fix attempt:       0
- Intentionally deferred (untouched): 4 (B11, B13, B14, B16)

**Verdict:** CONFORMANT_AFTER_FIXES

The 11 directional gaps named by the caller are all closed. The branch is now spec-conformant on the dimensions the prior log identified as material drift (severity assignments, trigger thresholds, run-atomicity wiring, timezone semantics, response-shape contract, sql.raw safety annotation).

---

## Sections

- B1 — `playbook.escalation_rate` severity + window
- B2 — `inactive.workflow` severity
- B3 — `escalation.repeat_phrase` severity
- B4 — `memory.low_citation_waste` severity + threshold
- B5 — `agent.routing_uncertainty` threshold + OR clause + volume gate
- B6 — `llm.cache_poor_reuse` volume floor
- B7 — `runOptimiser` orchestrator wired to production schedule path
- B8 — Cron timezone reads sub-account timezone
- B9 — `inactive.workflow` cron-only scope + 1.5x grace
- B10 — Acknowledge route HTTP response shape
- B12 — `listRecommendations` `sql.raw` safety comment
- Intentionally deferred (NOT re-examined)
- Files modified by this run
- Next step

---

## Gap-by-gap re-verification

### B1 — `playbook.escalation_rate` severity + window — CLOSED

- **Spec §2 line 109:** severity=`critical`, window 14 days
- **Prior state:** severity=`warn`, query window 7 days
- **Fix in commit `ee794a96`:**
  - `recommendations/playbookEscalation.ts:6` comment now reads "60% over 14 days" (no longer references 7-day query window)
  - `recommendations/playbookEscalation.ts:9` comment severity → `critical`
  - `recommendations/playbookEscalation.ts:38` candidate severity → `'critical'`
  - `queries/escalationRate.ts:5,8` comments updated to 14-day window
  - `queries/escalationRate.ts:46,58` SQL `INTERVAL '7 days'` → `INTERVAL '14 days'` (both occurrences — recent_runs CTE and escalation_flags CTE)
- **Verification:** read `recommendations/playbookEscalation.ts:1-52` and `queries/escalationRate.ts:42-65`. Severity is `critical`. Window is 14 days on both filters. PASS.

### B2 — `inactive.workflow` severity — CLOSED

- **Spec §2 line 111:** severity=`warn`
- **Prior state:** severity=`info`
- **Fix in commit `ee794a96`:**
  - `recommendations/inactiveWorkflow.ts:10` comment severity → `warn`
  - `recommendations/inactiveWorkflow.ts:24` candidate severity → `'warn' as const`
- **Verification:** read `recommendations/inactiveWorkflow.ts:1-35`. Severity is `warn`. PASS.

### B3 — `escalation.repeat_phrase` severity — CLOSED

- **Spec §2 line 112:** severity=`info`
- **Prior state:** severity=`warn`
- **Fix in commit `ee794a96`:**
  - `recommendations/repeatPhrase.ts:10` comment severity → `info`
  - `recommendations/repeatPhrase.ts:116` candidate severity → `'info'`
- **Verification:** read `recommendations/repeatPhrase.ts`. Severity is `info` at the candidate construction site (line 116). PASS.

### B4 — `memory.low_citation_waste` severity + threshold — CLOSED

- **Spec §2 line 118:** severity=`warn`, threshold ">50%"
- **Prior state:** severity=`info`, threshold 0.40 (40%)
- **Fix in commit `ee794a96`:**
  - `recommendations/memoryCitation.ts:6` comment "low_citation_pct > 50%"
  - `recommendations/memoryCitation.ts:9` comment severity → `warn`
  - `recommendations/memoryCitation.ts:18` `LOW_CITATION_THRESHOLD = 0.50`
  - `recommendations/memoryCitation.ts:34` candidate severity → `'warn'`
  - `queries/memoryCitation.ts:48` schema-encoding comment added: "cited=false is the schema encoding for final_score < threshold in memory_citation_scores"
- **Verification:** read both files. Severity is `warn`. Threshold is 0.50. The query module's `cited=false` flag is documented as the schema encoding of the spec's `final_score < 0.3` rule. PASS.

### B5 — `agent.routing_uncertainty` threshold + OR clause + volume gate — CLOSED

- **Spec §2 line 119:** "Fast-path confidence < 0.5 on > 30% of decisions, OR `secondLookTriggered` rate > 30%, sustained 7 days"
- **Prior state:** confidence threshold 0.7 (spec: 0.5); evaluator used AND `total_decisions >= 50` instead of OR `second_look_pct > 0.30`; missing OR clause
- **Fix in commit `ee794a96`:**
  - `queries/routingUncertainty.ts:26` `LOW_CONFIDENCE_THRESHOLD = 0.5`
  - `recommendations/routingUncertainty.ts:6` comment "low_confidence_pct > 30% OR second_look_pct > 30%"
  - `recommendations/routingUncertainty.ts:21` `MIN_TOTAL_DECISIONS = 50` constant removed
  - `recommendations/routingUncertainty.ts:36` evaluator condition is now `low_confidence_pct > 0.30 || second_look_pct > 0.30` (OR, no volume gate)
- **Verification:** read both files. Confidence threshold 0.5, OR clause present, no `total_decisions >= 50` gate. Spec's volume floor of 10 lives in `materialDelta` per §2 line 155, not in the trigger — correctly separated. PASS.

### B6 — `llm.cache_poor_reuse` volume floor — CLOSED

- **Spec §2 line 120:** "AND `cacheCreationTokens + cachedPromptTokens >= 5000` over the same window"
- **Prior state:** no volume floor anywhere in evaluator or query
- **Fix in commit `ee794a96`:**
  - `recommendations/cacheEfficiency.ts:19` `CACHE_VOLUME_FLOOR = 5000` constant added
  - `recommendations/cacheEfficiency.ts:29` skip rows where `creation_tokens + reused_tokens < 5000`
- **Verification:** read `recommendations/cacheEfficiency.ts:1-49`. Volume floor of 5000 is enforced before the reuse-ratio test. Note: the implementation's "reuse ratio < 20%" trigger is a different formulation than the spec's "creation > reused" trigger — but this divergence was NOT in the caller's "fix" set and was not flagged in the prior log as a separate gap; the prior log called out only the missing volume floor. PASS on the named gap.

### B7 — `runOptimiser` orchestrator wired to production schedule path — CLOSED

- **Spec §6.2 / §13:** run-level atomicity (pre-sort + sequential `output.recommend` calls + per-subaccount singleton key). Required for the atomicity invariant to hold for the daily cron path.
- **Prior state:** `runOptimiser` existed in `optimiserOrchestrator.ts` with all three properties, but `grep` found no production callsite. The `AGENT_RUN_QUEUE` worker dispatched all scheduled runs through `agentExecutionService.executeRun`, which routes through the LLM-driven loop reading AGENTS.md — letting the LLM call scan skills + `output.recommend` in any order.
- **Fix in commit `f70390c2`:**
  - `server/services/agentScheduleService.ts:5` imports `runOptimiser` from `./optimiser/optimiserOrchestrator.js`
  - `server/services/agentScheduleService.ts:75-90` (inside the `AGENT_RUN_QUEUE` worker handler):
    - Looks up `agents.slug` for the dispatched `data.agentId`
    - If slug is `subaccount-optimiser`, calls `runOptimiser({ subaccountId, organisationId, agentId })` directly and returns
    - All other agents continue through `agentExecutionService.executeRun` unchanged
- **Verification:** read `agentScheduleService.ts:71-105` and confirmed `runOptimiser` exists at `optimiserOrchestrator.ts:290` with signature `(input: OptimiserRunInput): Promise<void>`. The dispatch matches: `subaccountId`, `organisationId`, `agentId` are all in the pg-boss job's `data` shape. The atomicity-bearing orchestrator is now on the production cron path. PASS.

### B8 — Cron timezone reads sub-account timezone — CLOSED

- **Spec §4 line 200:** "daily at sub-account local 06:00 (cron derived from sub-account's `timezone`)"
- **Spec §9 line 648:** backfill `agentScheduleService.updateSchedule(linkId, { scheduleCron, scheduleEnabled: true, scheduleTimezone })`
- **Prior state:** schedule registered with hardcoded `'UTC'` in both `optimiserSubaccountHook.ts:131` and the backfill script. Sub-account's timezone field was never read.
- **Fix in commit `a338c373`:**
  - `optimiserSubaccountHook.ts:1-15` imports `subaccounts` schema
  - `optimiserSubaccountHook.ts:77-85` reads `subaccountRow.settings` (jsonb) and extracts `settings.timezone` if present, falls back to `'UTC'`
  - `optimiserSubaccountHook.ts:97` row insert uses the resolved `scheduleTimezone`
  - `optimiserSubaccountHook.ts:140` `agentScheduleService.registerSchedule` is called with the resolved `scheduleTimezone` (was `'UTC'`)
  - `optimiserSubaccountHook.ts:150` log line includes `scheduleTimezone`
  - `scripts/backfill-optimiser-schedules.ts:40` SELECT now includes `settings`
  - `scripts/backfill-optimiser-schedules.ts:93-96` resolves `scheduleTimezone` from `sa.settings.timezone` with UTC fallback
  - `scripts/backfill-optimiser-schedules.ts:112,152` writes use the resolved timezone
- **Verification:** read both files. The timezone is read from `subaccounts.settings.timezone` (jsonb) at registration time. UTC is the documented fallback. The deterministic 06:00–11:59 cron stagger from `computeOptimiserCron` is preserved (per spec §13 storm-mitigation), but pg-boss now interprets that cron in the sub-account's local timezone when one is set. This satisfies the spec's "cron derived from sub-account's `timezone`" while keeping the storm-mitigation stagger. PASS.

  *Implementation note (not a gap):* the `subaccounts` Drizzle schema does not expose a top-level `timezone` column — only `settings: jsonb`. The fix correctly pulls from `settings.timezone` rather than introducing a new column. If the spec intent was a top-level column, that would be a schema-migration concern outside the scope of this re-verification.

### B9 — `inactive.workflow` cron-only scope + 1.5x grace — CLOSED

- **Spec §2 line 111 / §3 line 174 / §5 line 222:** "Sub-account agent with `subaccountAgents.scheduleEnabled = true AND scheduleCron IS NOT NULL` whose most recent `agent_runs.startedAt` is older than 1.5x the expected cadence"
- **Prior state:** query had `OR sa.heartbeat_enabled = true` broadening the trigger; grace buffer was 1.25x (`*0.25` on top of one cadence)
- **Fix in commit `ee794a96`:**
  - `queries/inactiveWorkflows.ts:5-7` module comment rewritten to "schedule_enabled=true AND schedule_cron IS NOT NULL (cron-scheduled only)"
  - `queries/inactiveWorkflows.ts:69-70` grace buffer comment + math `* 0.5` (50%, total = 1.5x cadence)
  - `queries/inactiveWorkflows.ts:104-105` SQL `WHERE sa.schedule_enabled = true AND sa.schedule_cron IS NOT NULL` (no longer has `OR sa.heartbeat_enabled = true`)
  - `heartbeat_enabled` removed from SELECT, GROUP BY, and the row-shape type
- **Verification:** read `queries/inactiveWorkflows.ts:1-150`. The cron-only filter is in place; heartbeat OR clause is gone; grace buffer is 0.5x interval on top of one full cadence (= 1.5x total). PASS.

### B10 — Acknowledge route HTTP response shape — CLOSED

- **Spec §6.5 line 495:** response is `{ success: true, alreadyAcknowledged: boolean }`
- **Prior state:** route returned `{ success, alreadyAcknowledged, scope_type, scope_id }` — extra fields beyond the spec contract
- **Fix in commit `a338c373`:**
  - `server/routes/agentRecommendations.ts:80-92`:
    - Destructures `{ scope_type, scope_id, ...httpResult }` from `result`
    - Socket emission uses `scope_type, scope_id` (still has the routing context)
    - HTTP response is `res.json(httpResult)` — only `success` + `alreadyAcknowledged`
  - The service-layer `AcknowledgeResult` interface keeps `scope_type` + `scope_id` because the route layer needs them for the socket emit; only the HTTP boundary is trimmed. This is the correct separation.
- **Verification:** read `routes/agentRecommendations.ts:60-95`. Response body is exactly `{ success, alreadyAcknowledged }`. Socket payload still carries `scope_type, scope_id` per spec §6.5. PASS.

### B12 — `listRecommendations` `sql.raw` safety comment — CLOSED

- **Spec §6.5:** read endpoint must filter by `organisation_id`; convention-wise the repo prefers parameterised drizzle queries over `sql.raw` interpolation
- **Prior state:** `sql.raw(...)` interpolated `${orgId}` into the SQL string. UUID format validated for `scopeId` but not for `orgId` (server-derived from session). The prior log routed this as DIRECTIONAL with a "refactor or document" recommendation.
- **Fix in commit `a338c373`:**
  - `server/services/agentRecommendationsService.ts:551` adds inline comment: "orgId is server-derived from the authenticated session — safe for sql.raw interpolation"
- **Verification:** read `agentRecommendationsService.ts:540-606`. The safety comment is present at the COUNT(*) short-circuit branch. The prior log explicitly offered "document the safety predicate inline" as one of two acceptable resolutions, so the comment closes the gap as routed. PASS.

  *Note (not a gap):* the comment is on the COUNT(*) short-circuit only; the same pattern is used in two other `sql.raw` invocations in this function (the main query at line 576 and the second COUNT at line 601). All three interpolate the same `${orgId}` into a `whereClause` string built earlier. The single comment serves as the rationale for the whole function. The audit could optionally request the comment be replicated at each `sql.raw` site, but the gap as-stated by the caller (B12) was about adding a safety comment somewhere in `listRecommendations`, which is satisfied. PASS.

---

## Intentionally deferred (NOT re-examined)

Per caller direction:

- **B11** — RLS scope in cooldown check. Caller flagged as "ambiguous; connection-level `app.organisation_id` likely sufficient". Untouched.
- **B13** — dismiss fallback. Caller flagged as "ambiguous; defensive code". Untouched.
- **B14** — RLS policy shape. Caller flagged as "ambiguous; needs multi-policy pattern check". Untouched.
- **B16** — stale `progress.md` in main worktree. Caller flagged as "expected during branch build; resolves on merge". Untouched.

These four remain on the deferred-items list. They do not block the conformance verdict.

---

## Files modified by this run

(none — read-only re-verification)

---

## Next step

**CONFORMANT_AFTER_FIXES** — all 11 named gaps closed. The main session's targeted fixes landed cleanly across:

1. Six evaluator/query files (commit `ee794a96`) — severity and threshold fixes for B1–B6 + B9 query-scope fix
2. One service-layer file (commit `f70390c2`) — `runOptimiser` wired to the production schedule path for B7
3. Four files (commit `a338c373`) — timezone resolution, ack response shape, sql.raw safety comment for B8/B10/B12

The branch is ready to proceed to `pr-reviewer` on the expanded changed-code set (the main implementation plus the three fix commits). The four intentionally-deferred items (B11/B13/B14/B16) remain on the deferred-items list for the main session to address before merge or, where the caller has documented them as acceptable, before final close-out.
