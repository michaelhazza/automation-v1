# Spec Conformance Log

**Spec:** `tasks/builds/home-dashboard-reactivity/spec.md` (paired plan: `docs/superpowers/plans/2026-04-27-home-dashboard-reactivity.md`)
**Spec commit at check:** `7ed0851275b666e3a9963050b389383a16b4ed30` (HEAD of `create-views`)
**Branch:** `create-views`
**Base:** `399f3864b5187d2be99ca9f9807793699560ece7` (merge-base with `main`)
**Scope:** All-of-spec verification — implementation is complete (Tasks 1–20 committed across `035ccafb` → `7ed08512`); every section of the spec is in scope.
**Changed-code set:** 23 files attributable to home-dashboard-reactivity commits.
**Run at:** 2026-04-27T21:02:16Z

---

## Summary

- Requirements extracted:     35
- PASS:                       32
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (`dashboard.queue.changed` emitter — spec §5.5 explicitly marks best-effort with deferral allowed)

**Verdict:** NON_CONFORMANT (2 directional gaps — see `tasks/todo.md`)

> Both directional gaps are scope-edge cases the spec mentions but the plan explicitly carves out as documented-gap candidates. Neither blocks the core reactivity contract — operator-visible behaviour (live counters, freshness pulse, consistency groups, reconnect refetch) is fully delivered. Routing rather than auto-fixing is the conservative call: both involve scope decisions (how to emit on bulk paths, which of 6 services owns `action: 'new'`) that the human should make.

---

## Requirements extracted (full checklist)

| # | Category | Spec section | Requirement | Verdict |
|---|---|---|---|---|
| REQ #1 | file | §3.1 | Create `client/src/components/dashboard/FreshnessIndicator.tsx` exporting `formatAge` + `<FreshnessIndicator>` component | PASS |
| REQ #2 | file | §3.1 | Create `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx` returning `null` | PASS |
| REQ #3 | file | §3.1, §10.2 | Extract `QueueHealthSummary` to `client/src/components/dashboard/QueueHealthSummary.tsx` with `refreshToken?: number` prop | PASS |
| REQ #4 | test | §13.1 | Pure-function test for `formatAge` covering 0/5/9/10/59/60/90/3599/3600/7200s | PASS (test runs green) |
| REQ #5 | test | §13.2 | Pure-function test for `applyIfNewer` covering newer/older/equal/empty | PASS (test runs green) |
| REQ #6 | test | §13.3 | Pure-function test for `mergeActivityItems` covering prepend/replace/equal/older/overlap | PASS (test runs green) |
| REQ #7 | behavior | §6.1 | All five watched API endpoints wrap response in `{ data, serverTimestamp }` envelope | PASS — `pulse.ts:22`, `agentRuns.ts:367`, `clientpulseReports.ts:65–82`, `activity.ts:73`, `jobQueue.ts:16` |
| REQ #8 | behavior | §6.1 | `serverTimestamp` generated AFTER all data reads, immediately before serialization | PASS — every emit is in the `res.json(...)` call after the awaited service call |
| REQ #9 | export | §6.5, §7 | `UnifiedActivityFeed` adds `refreshToken?: number` and `expectedTimestamp?: string` props; exports pure `mergeActivityItems` | PASS — `UnifiedActivityFeed.tsx:53–54, 230, 260–261` |
| REQ #10 | behavior | §6.5 | When `refreshToken` changes, internal fetch runs; if `serverTimestamp < expectedTimestamp`, response is discarded | PASS — `UnifiedActivityFeed.tsx:331` |
| REQ #11 | behavior | §4.2, §5.1 | Server emits `dashboard.approval.changed` to `org:${orgId}` on review item approve | PASS — `server/routes/reviewItems.ts:177` |
| REQ #12 | behavior | §4.2, §5.1 | Server emits `dashboard.approval.changed` to `org:${orgId}` on review item reject | PASS — `server/routes/reviewItems.ts:229` |
| REQ #13 | behavior | §5.1 | Server emits `dashboard.approval.changed` with `action: 'new'` on review item creation (in scope per spec; plan §10.4 carves out documented-gap option) | DIRECTIONAL_GAP — `reviewService.createReviewItem` has 6 callers; choice of where to emit is a design call |
| REQ #14 | behavior | §5.2 | Server emits `dashboard.activity.updated` from `agentRunFinalizationService` for non-sub-agent terminal runs | PASS — `server/services/agentRunFinalizationService.ts:382` (gated by `!parentIsSubAgent`) |
| REQ #15 | behavior | §5.3 | Server emits `dashboard.activity.updated` from `workflowEngineService` for terminal workflow statuses | PASS — five emit sites: 766 (cancelled), 887 (completed/completed_with_errors), 2733/3164/3330 (failed paths) |
| REQ #16 | behavior | §5.4, §11.2 | Server emits `dashboard.client.health.changed` from ClientPulse health mutation path | PASS — `server/services/reportService.ts:124` (in `saveReport` after the persisted-report row is returned) |
| REQ #17 | behavior | §11.2 | Server also emits `dashboard:update` from same ClientPulse mutation path (paired emit) | PASS — `server/services/reportService.ts:127` (same payload object reused) |
| REQ #18 | behavior | §5.5 | Server emits `dashboard.queue.changed` from job-queue mutation path (best-effort) | OUT_OF_SCOPE per spec carve-out — no emit present; matches plan Task 14 "best-effort if not straightforward" stance. Bounded staleness via reconnect refetch. |
| REQ #19 | client consumer | §6.1 | `client/src/hooks/usePulseAttention.ts` reads `res.data.data` for org-scope pulse attention | PASS — line 65 (scope-conditioned: `org` reads `.data.data`, `subaccount` reads `.data`) |
| REQ #20 | client consumer | §6.1 | `client/src/pages/ActivityPage.tsx` reads `res.data.data` for `/api/activity` | PASS — lines 265–266 |
| REQ #21 | client consumer | §6.1 | `client/src/components/pulse/HistoryTab.tsx` reads `res.data.data` for `/api/activity` | PASS — lines 229–230 |
| REQ #22 | client consumer | §6.1 | `client/src/pages/ClientPulseDashboardPage.tsx` reads `res.data.data` for `/api/clientpulse/health-summary` | PASS — line 64 (`healthRes?.data?.data`) |
| REQ #23 | client consumer | §6.1 | `client/src/pages/JobQueueDashboardPage.tsx` reads `res.data.data` for `/api/system/job-queues` | PASS — line 62 |
| REQ #24 | behavior | §11.1, §11.2 | `ClientPulseDashboardPage` removes the `toast.success('Dashboard updated...')` from the `dashboard:update` handler | PASS — handler retained (lines 73–77), no toast call, no `toast` import remaining |
| REQ #25 | behavior | §6.2 | `applyIfNewer` uses strict `>` (equal timestamps NOT applied) | PASS — `DashboardPage.tsx:81` |
| REQ #26 | behavior | §6.3 | Each consistency group has per-group `inflight` + `pending` refs and the coalescing pattern | PASS — refs at lines 49–63; pattern present in every `refetch*` |
| REQ #27 | behavior | §6.4 | Failure path: refetch errors do NOT call `applyIfNewer` and do NOT call `markFresh` | PASS — every `refetch*` puts `applyIfNewer(…, () => { …; markFresh(...); })` inside `try`; `catch` only logs |
| REQ #28 | behavior | §7.2 | Activity group uses `Promise.all` and group version = MIN of two `serverTimestamp` values | PASS — `DashboardPage.tsx:131–134` |
| REQ #29 | behavior | §7.4, §9.5 | `markFresh(ts: Date)` helper dedups via `lastUpdatedAtRef`; only `setLastUpdatedAt` if `ts > lastUpdatedAtRef.current` | PASS — `DashboardPage.tsx:91–96` |
| REQ #30 | behavior | §8.2 | Reconnect: track `prevConnected.current`, only act on `false → true`, debounce by `RECONNECT_DEBOUNCE_MS = 500`, call `refetchAll()` | PASS — `DashboardPage.tsx:35` (constant) + lines 217–227 (effect) |
| REQ #31 | behavior | §9.3 | `<FreshnessIndicator>` debounce-pulse: `PULSE_DEBOUNCE_MS = 1500`, `PULSE_DURATION_MS = 600`, 5s tick | PASS — `FreshnessIndicator.tsx:4–5, 28–32, 36–46` |
| REQ #32 | behavior | §10.2 | Sysadmin sysadmin-room subscription via `useSocketRoom` with `null` roomId for non-sysadmins (unconditional hook call) | PASS — `DashboardPage.tsx:200–207` |
| REQ #33 | behavior | §12 | `<OperationalMetricsPlaceholder>` rendered between approval section and workspaces section | PASS — `DashboardPage.tsx:340–341` |
| REQ #34 | behavior | §4.2 | `EVENT_TO_GROUP` constant exists in `DashboardPage.tsx` listing the three org-room dashboard events | PASS — `DashboardPage.tsx:184–188` (queue event correctly omitted — that lives on the sysadmin room and is wired via `useSocketRoom`) |
| REQ #35 | behavior | §4.2 (pre-merge coverage check) | `grep -r "emitOrgUpdate.*'dashboard\." server/` returns only events from the §4.2 table | PASS — 9 matches, all `dashboard.approval.changed` / `dashboard.activity.updated` / `dashboard.client.health.changed`; `dashboard:update` is the documented co-existing event from §11 |
| REQ #36 | behavior | §3.1 (file inventory) | `client/src/index.css` has `freshness-pulse` keyframe per §9.4 | PASS — lines 53–60 |
| REQ #37 | scope-edge | §5.1 (broad reading) | Bulk approve/reject endpoints (`bulk-approve`, `bulk-reject`) emit `dashboard.approval.changed` | DIRECTIONAL_GAP — spec language is broad ("after a successful approve or reject"); plan does not name bulk endpoints; payload + per-item-vs-once decision is a design call |

---

## Mechanical fixes applied

None. Every gap classifies as DIRECTIONAL.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- **REQ #13** — `action: 'new'` emit on review item creation. Spec §5.1 says it's in scope. Plan Task 10.4 explicitly carves out a documented-gap option ("If creation happens in a service called by this route, add the emit in that service instead. If there is no creation path in this route file, document it in the PR description as a known gap."). Implementation: 6 callers of `reviewService.createReviewItem` exist (`clientPulseInterventionContextService`, `configUpdateOrganisationService`, `flowExecutorService`, `skillExecutor` × 2, plus the service itself). Cleanest place to emit is inside `createReviewItem` itself using `action.organisationId`, but this is a design decision the human should ratify.

- **REQ #37** — Bulk approve / bulk reject paths in `server/routes/reviewItems.ts` (`POST /api/review-items/bulk-approve` lines 241–317; `POST /api/review-items/bulk-reject` lines 321–334) do not emit `dashboard.approval.changed`. Spec §5.1 trigger language ("after a successful approve or reject") is broad enough to read either way; plan §10 names only the single approve/reject endpoints. A user bulk-approving items would not see the home-dashboard pending-approval count refresh until the next reconnect cycle. Design call: emit once per request (less chatty, single refetch on the dashboard) vs emit per item (consistent with single-item paths). Payload also debatable — bulk has no canonical `subaccountId`.

Both routed under `tasks/todo.md § "Deferred from spec-conformance review — home-dashboard-reactivity (2026-04-27)"`.

---

## Files modified by this run

This run did not modify any spec-implementation files (zero MECHANICAL fixes applied).

Files modified BY THIS RUN:
- `tasks/todo.md` (deferred-items section appended)
- `tasks/review-logs/spec-conformance-log-home-dashboard-reactivity-2026-04-27T20-57-33Z.md` (this log)

---

## Implementation files verified (not modified)

Client:
- `client/src/components/dashboard/FreshnessIndicator.tsx`
- `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx`
- `client/src/components/dashboard/QueueHealthSummary.tsx`
- `client/src/components/dashboard/__tests__/freshnessIndicator.test.ts`
- `client/src/pages/__tests__/dashboardVersioning.test.ts`
- `client/src/components/__tests__/activityFeedMerge.test.ts`
- `client/src/pages/DashboardPage.tsx`
- `client/src/components/UnifiedActivityFeed.tsx`
- `client/src/hooks/usePulseAttention.ts`
- `client/src/pages/ActivityPage.tsx`
- `client/src/components/pulse/HistoryTab.tsx`
- `client/src/pages/ClientPulseDashboardPage.tsx`
- `client/src/pages/JobQueueDashboardPage.tsx`
- `client/src/index.css`

Server:
- `server/routes/pulse.ts`
- `server/routes/agentRuns.ts`
- `server/routes/clientpulseReports.ts`
- `server/routes/activity.ts`
- `server/routes/jobQueue.ts`
- `server/routes/reviewItems.ts`
- `server/services/agentRunFinalizationService.ts`
- `server/services/workflowEngineService.ts`
- `server/services/reportService.ts`

---

## Next step

NON_CONFORMANT — 2 directional gaps surfaced; see `tasks/todo.md` under "Deferred from spec-conformance review — home-dashboard-reactivity (2026-04-27)". Both gaps are scope-edge cases explicitly carved out by the plan as "documented gap acceptable" — the human chooses between (a) accepting them as documented limitations and proceeding to `pr-reviewer`, or (b) closing them in this PR. Pipeline should NOT silently auto-pick option (a).
