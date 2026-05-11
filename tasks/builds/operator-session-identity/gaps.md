# Operator Session Identity — Deferred Implementation Gaps

## GAP-1: Nightly sweep not registered as scheduled pg-boss job

**Spec reference:** Plan §988-989, Chunk 6
**Status:** DEFERRED

The `runOperatorSessionRefreshSweep()` function in `server/jobs/operatorSessionRefreshJob.ts`
is implemented but not registered as a scheduled pg-boss job. The trigger that activates it
is: when the provider registry flips `connectionMechanism` from `'none_verified'` to a live
mechanism, the sweep must be wired into the boot path via `boss.schedule(...)` or a cron hook.

**Required action:** Wire as a nightly pg-boss scheduled job in `server/index.ts` boot path,
calling `runOperatorSessionRefreshSweep()` on a `'0 2 * * *'` (2am UTC) cron expression,
alongside the worker registration already present for `operator-session-refresh`.

**Blocker for activation:** Registry flip (Phase 3+, OpenClaw adapter spec).
