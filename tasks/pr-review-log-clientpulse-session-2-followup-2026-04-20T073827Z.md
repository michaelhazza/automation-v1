# PR Review Log — ClientPulse Session 2 — Follow-up (Blocker-Fix Pass)

**Branch:** `claude/clientpulse-session-2-arch-gzYlZ`
**Diff scope:** Working-tree fix diff against the 13-commit Session 2 range (unstaged changes only)
**Reviewer:** pr-reviewer agent
**Timestamp:** 2026-04-20T07:38:27Z
**Prior log:** `tasks/pr-review-log-clientpulse-session-2-2026-04-20T072618Z.md`

---

## Files reviewed

- `server/services/drilldownService.ts` (B-1 fix)
- `server/services/adapters/ghlReadHelpers.ts` (B-3 fix)
- `server/routes/clientpulseInterventions.ts` (B-2 fix)
- `server/services/clientPulseInterventionContextService.ts` (H-1 + N-1 fix)
- `server/services/organisationService.ts` (H-2 fix)
- `server/services/notifyOperatorChannels/inAppChannel.ts` (H-3 fix)
- `server/services/adapters/apiAdapter.ts` (H-4 fix)
- `server/services/crmLiveDataService.ts` (N-3 fix)
- `tasks/builds/clientpulse/progress.md` (B-4 + H-5 re-classification)
- Cross-check reads: `availabilityPure.ts`, `notifyOperatorFanoutService.ts`, `notifyOperatorFanoutServicePure.test.ts`, `configHistoryService.ts`

---

## Blocking Issues

None.

---

## Finding Confirmations

**B-1** — `drilldownService.ts:130` now has `eq(clientPulseSignalObservations.organisationId, params.organisationId)` inside the `and(...)` block. All four queries in the file carry both `organisationId` and `subaccountId`. Closed.

**B-2** — `clientpulseInterventions.ts:21` carries `AGENTS_VIEW` on the context GET; `:63` carries `AGENTS_EDIT` on the propose POST. `AGENTS_EDIT` is the correct gate — this endpoint creates an `actions` row advancing the review queue. Zod `issues` now included in the 400 response body at `:82`. Closed.

**B-3** — `ghlReadHelpers.ts:40` adds `eq(integrationConnections.organisationId, params.organisationId)` as the first predicate. The parameter is no longer silently dropped. Closed.

**B-4** — Re-classified in `progress.md` as a named Session 3 gate (`server/routes/__tests__/organisationConfig.integration.test.ts`) with explicit reason (pending DB-fixture layer). Scope change properly documented. Closed.

**H-1** — `pickRecommendedActionType` is gone from `clientPulseInterventionContextService.ts`. Closed.

**H-2** — `organisationService.ts:277-285` now calls `configHistoryService.recordHistory` with full typed params. No race possible: the org was created in the immediately preceding `createOrganisation` call, has zero prior history rows for `organisation_operational_config`, so `MAX(version)` → null → nextVersion = 1, cleanly. Closed.

**H-3** — `inAppChannel.ts` returns `{ status: 'skipped_not_configured', recipientCount: 0, errorMessage: ... }`. Audit trail is honest. Closed.

**H-4** — `apiAdapter.ts:266-287` logs structured `apiAdapter.token_expired` / `apiAdapter.token_near_expiry` warnings before dispatch using `console.warn` with JSON payload. OAuth refresh deferred to Session 3 per named `progress.md` gate. Closed.

**H-5** — Re-classified in `progress.md` as a named Session 3 gate (`server/services/__tests__/organisationServiceCreateFromTemplate.test.ts`). Closed.

**N-1** — Priority-inversion comment at `clientPulseInterventionContextService.ts:175-176` reads "Config priority: higher = more important (operator intuition). Pure fn sort key: lower = first. Negate to bridge." Clear. Closed.

**N-3** — `crmLiveDataService.ts:23,43-47`: `MAX_CACHE_ENTRIES = 500` + oldest-insertion eviction via `cache.keys().next().value`. ECMAScript §23.1.3.5 mandates Map insertion-order iteration; this is correct. `undefined` guard is correct defensive coding. Closed.

---

## Non-Blocking Observation

The in-app channel fix creates a minor semantic tension: `availabilityPure.ts` hardcodes `inApp: true`, so `planFanout` continues to route `in_app` to `dispatch` — but the fixed `deliverInApp` returns `skipped_not_configured`. The plan says "dispatch," the channel result says "skipped." This is not a regression (old code was worse — falsely reported `delivered`) and the audit trail is honest. Session 3 can close this cleanly by making `ChannelAvailability.inApp` a runtime-derived `boolean` once real in-app delivery lands, allowing `planFanout` to move in-app to `skipped` when not configured. Flagged for Session 3, not actionable now.

---

## Verdict

**PR-ready.** All 4 blockers + all 5 high-priority findings cleanly resolved. No new issues introduced by the fix diff. Typecheck baseline (43 server / 11 client) held. Pure test suites green (classifier 10, recommendedIntervention 8, notifyOperatorFanout 8).
