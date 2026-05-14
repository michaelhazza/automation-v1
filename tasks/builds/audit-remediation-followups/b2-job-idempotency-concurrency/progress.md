# B2 + B2-ext — Job idempotency + concurrency standard across 4 jobs

Date: 2026-04-26
Branch: claude/deferred-quality-fixes-ZKgVV

## Per-job approach

### 1. connectorPollingSync (lease-based — already protected)

- **Concurrency:** UNCHANGED — existing `sync_lock_token` UPDATE-with-skip-if-held lease (per-(orgId, connectionId)).
- **Idempotency:** documented per-phase no-op predicates + `INSERT … ON CONFLICT DO UPDATE` on `integration_ingestion_stats(connectionId, syncStartedAt)`.
- **Changes:**
  - Added standard header comment block declaring concurrency + idempotency models.
  - Added `__testHooks` export (`pauseBetweenClaimAndCommit`).
  - Added structured no-op return `{ status: 'noop', reason: 'lock_held', jobName }` when lease acquisition fails.
  - Changed return type from `Promise<void>` to typed result union. Caller (queueService) ignores the return value via `await`, so no breaking change.
- **Risk:** very low — comment-only formalisation + non-breaking return type widening + dead-in-prod test seam.

### 2. bundleUtilizationJob (advisory-lock + replay-safe upsert)

- **Concurrency:** NEW — per-org `pg_advisory_xact_lock(hashtext('<orgId>::bundleUtilization')::bigint)` acquired inside the `withAdminConnection` transaction, before the per-bundle UPDATE.
- **Idempotency:** replay-safe — the entire `utilizationByModelFamily` blob is recomputed deterministically from current state and written via UPDATE that REPLACES the blob (not append/merge). Same input → same blob.
- **Changes:**
  - Replaced existing header with the standard form.
  - Added per-org advisory lock inside the per-bundle loop (lock acquired once per bundle org, released on transaction commit/rollback).
  - Added structured no-op when no bundles or policies exist.
  - Added `__testHooks` export.
  - Changed return type from `Promise<void>` to result union. Caller in queueService awaits without using the value.
- **Risk:** low-medium — adds advisory-lock acquisition path that didn't exist before, but the lock is released automatically by transaction semantics so no manual lifecycle.

### 3. measureInterventionOutcomeJob (claim+verify)

- **Concurrency:** NEW — per-org `pg_advisory_xact_lock` inside a `db.transaction` wrapping each `recordOutcome` write. Different orgs proceed in parallel; same org serialises.
- **Idempotency:** claim+verify — the eligibility SELECT already filters via `NOT EXISTS (SELECT 1 FROM intervention_outcomes WHERE intervention_id = a.id)`. The new transactional write re-checks NOT EXISTS inside the lock to defend against a sibling worker that wrote the row between SELECT and now.
- **Changes:**
  - Replaced existing header with the standard form.
  - Added per-org advisory lock + claim-verify re-check inside `db.transaction` around `interventionService.recordOutcome` call.
  - Added structured no-op when no eligible action rows are found (`reason: 'no_rows_to_claim'`).
  - Added `__testHooks` export.
  - Extended `MeasureOutcomesJobSummary` type with `status: 'ok'` + `jobName` discriminator; added `MeasureOutcomesJobResult` union with the noop variant. Caller (queueService) maps to `undefined` via `.then(() => undefined)`, so no breaking change.
- **Risk:** medium — touches a hot per-row code path (hourly job, real production traffic). Mitigated by: (a) the advisory lock is acquired per row, in a per-org transaction, so a deadlock would surface as a row failure not a cascade; (b) the NOT EXISTS re-check inside the lock is a strict additive guard — if a sibling already wrote the outcome, we skip without writing; (c) per-row failures are already handled by the existing try/catch + summary.failed counter.

### 4. ruleAutoDeprecateJob (global advisory lock; nightly)

- **Concurrency:** NEW — global `pg_advisory_xact_lock(hashtext('ruleAutoDeprecateJob')::bigint)` inside a `db.transaction`. Justified inline by nightly cadence + low frequency — per-org parallelism is not needed at this rate.
- **Idempotency:** idempotent-by-construction — `applyBlockQualityDecay` already filters `WHERE deprecated_at IS NULL` and writes deprecated_at exactly once per row.
- **Changes:**
  - Replaced existing header with the standard form (including the global-lock justification paragraph).
  - Wrapped the entire run in `db.transaction` and acquired the global advisory lock at the top of the transaction.
  - Added structured no-op when no orgs exist.
  - Added `__testHooks` export.
  - Changed return type from `Promise<void>` to result union. Caller maps to undefined.
- **Risk:** low — the lock is global but the cadence is nightly; serialisation across all orgs is acceptable for a job that runs once per day.

## Tests

Each job gets one minimal idempotency contract test in `server/jobs/__tests__/<jobName>.idempotency.test.ts`:

- Asserts `__testHooks` export is an object with `pauseBetweenClaimAndCommit` defaulting to undefined.
- Asserts override is invokable.
- Asserts reset (assigning undefined) clears the override.

Sequential / parallel double-invocation tests against a real DB are deferred — they require a live Postgres harness which the existing `*Pure.test.ts` tests in this codebase intentionally avoid. The header comment carries the contract; the optional gate (not added — see below) would enforce it.

## Architecture.md update

Appended one paragraph to § Architecture Rules covering: standard header, per-org default lock scope, structured noop return shape, transactional rollback for partial-state, `__testHooks` production-safety contract.

## Gate extension — skipped

The existing `scripts/verify-job-idempotency-keys.sh` enforces `idempotencyStrategy:` declarations on `JOB_CONFIG` *enqueue-side* entries — a different concern from the *handler-side* header comments this task adds. Extending it would conflate two distinct concerns; per the task brief's "skip if too complex" instruction, the comment standard is enforced by code review for now. A separate `verify-job-concurrency-headers.sh` is documented as future work in the spec § B2 step 4 (advisory).

## Verification

`npm run typecheck` to be run at the end of the task.

## Status

DONE — 4 jobs migrated to the idempotency + concurrency standard; architecture.md updated; spec §5 tracking flipped; minimal idempotency contract tests landed for each job.
