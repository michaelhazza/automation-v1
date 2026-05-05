# PR Review — system-monitoring-agent (2026-04-24T14-55-00Z)

## Blocking Issues

1. `escalateIncidentToAgent` — `getIncident` returns `{ incident, events }` not `SystemIncident`; all property accesses are against the wrapper object. Also `actorId` field does not exist — should be `actorUserId`.

2. `suppressIncident` — `onConflictDoUpdate` on `(fingerprint, organisation_id)` will fail when `organisation_id IS NULL` because PG unique indexes don't match NULL=NULL without `NULLS NOT DISTINCT`.

3. `ingestInline` — `boss.send` called inside `db.transaction` does NOT enlist in the Drizzle tx. If the tx rolls back after the send, the notify job fires for a non-existent incident.

4. `shouldNotify` — dead type-cast `severity === 'user_fault' as unknown as SystemIncidentSeverity` is always false; the intent was to guard on classification, not severity.

5. `createTestIncident` — primary lookup uses raw `fingerprint` string (not the hash), so it always returns 0 rows; the fallback block also queries `isTestIncident = false` while the seed uses `false`.

6. Client `SuppressModal` posts `{ expiresInHours }` but Zod schema expects `{ duration: '24h' | '7d' | '30d' | 'permanent' }` — server returns 400 on every suppress action from the UI.

7. Client `ResolveModal` posts `{ note }` but Zod schema expects `{ resolutionNote }` — note is always stripped.

8. `systemOperationsOrgResolver` — subaccount query missing `isNull(subaccounts.deletedAt)` filter.

## Strong Recommendations

9. `registerSystemIncidentNotifyWorker` called unconditionally at boot, not gated on `JOB_QUEUE_BACKEND === 'pg-boss'`.

10. `SystemIncidentFatigueGuard.queryTodayCount` counts all notification_surfaced events today globally (no fingerprint filter) — per-fingerprint daily cap is incorrectly applied as a global daily cap.

11. `escalateIncidentToAgent` — task created before `db.transaction`; if tx rolls back the task is an orphan.

12. Missing test: `normaliseMessage` ordering — no assertion that ISO timestamps are stripped before the `\b\d{4,}\b` number pattern.

## Non-Blocking

13. `allStatuses` in `SystemIncidentsPage` missing `'suppressed'` — suppressed incidents can't be shown.
14. `Suspense` wrapper — confirm all lazy routes are wrapped (follows existing project pattern).
15. `teamConcurrency: 2` in notify worker — could deliver duplicate WebSocket events for the same incident.
16. `systemOperationsOrgResolver` process-level cache not cleared on error — acceptable for production.
