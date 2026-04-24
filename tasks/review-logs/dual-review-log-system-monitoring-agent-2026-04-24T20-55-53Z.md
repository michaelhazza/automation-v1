# Dual Review Log — system-monitoring-agent

**Files reviewed:** System Monitor Phase 0 + 0.5 code on branch `claude/system-monitoring-agent-PXNGy`
(spec: `tasks/builds/system-monitoring-agent/phase-0-spec.md`; plan: `tasks/builds/system-monitoring-agent/implementation-plan.md`).
Primary focus set: `server/services/incidentIngestor.ts`, `server/services/incidentIngestorPure.ts`,
`server/services/incidentIngestorAsyncWorker.ts`, `server/services/systemIncidentService.ts`,
`server/services/systemIncidentFatigueGuard.ts`, `server/services/systemIncidentNotifyJob.ts`,
`server/services/systemOperationsOrgResolver.ts`, `server/services/alertFatigueGuardBase.ts`,
`server/jobs/systemMonitorSelfCheckJob.ts`, `server/routes/systemIncidents.ts`,
`server/schemas/systemIncidents.ts`, `server/db/schema/systemIncidents.ts`,
`server/db/schema/systemIncidentEvents.ts`, `server/db/schema/systemIncidentSuppressions.ts`,
`server/websocket/rooms.ts`, `server/websocket/emitters.ts`,
`migrations/0225_seed_system_operations_org.sql`, `migrations/0226_fix_suppression_unique_nulls.sql`,
all six ingestion call-sites.

**Iterations run:** 3/3
**Timestamp:** 2026-04-24T20:55:53Z

---

## Iteration 1

Codex invocation: `codex review --commit c96960c8` (the pr-reviewer fix commit on HEAD).
First attempt against `--base main` spent the 300s budget walking the full 457-file, ~67K-insertion diff
without producing findings, so iteration 1 was re-scoped to the single fix commit.

**Codex findings:**

1. **[P1] `migrations/0226_fix_suppression_unique_nulls.sql:6-10`** — dropping and recreating the unique
   index as `NULLS NOT DISTINCT` will fail if any dev / staging DB already contains duplicate
   global-suppression rows (same `fingerprint`, `organisation_id IS NULL`). That state is
   reachable because the previous unique index was `NULLS DISTINCT` — `suppressIncident()`'s
   `onConflictDoUpdate` never matched for global rules, so each subsequent global suppression
   inserted a new row. Needs a dedupe step before the `CREATE UNIQUE INDEX`.

2. **[P1] `server/services/incidentIngestor.ts:269-273`** — post-commit `boss.send('system-monitor-notify', …)`
   is outside the tx on purpose, but when `SYSTEM_INCIDENT_INGEST_MODE=async`
   `handleSystemMonitorIngest()` rethrows, so pg-boss retries the ingest job. On retry the upsert
   hits its conflict path, `occurrence_count` is incremented again, and a second `occurrence`
   event is appended — even though the real-world event happened once. Notify enqueue needs to
   be best-effort.

**Adjudication:**

```
[ACCEPT] migrations/0226_fix_suppression_unique_nulls.sql:6-10 — CREATE UNIQUE INDEX blocks on duplicate rows
  Reason: Old code could insert duplicate (fingerprint, org_id=NULL) rows under NULLS DISTINCT.
  Any dev/staging DB run pre-fix is blocked. Pre-production framing doesn't exempt dev DBs.

[ACCEPT] server/services/incidentIngestor.ts:269-273 — async retry non-idempotent on enqueue failure
  Reason: Real correctness bug. pg-boss retry on post-commit enqueue failure double-increments
  occurrence_count and writes a duplicate occurrence event. Fix: swallow+log — incident is durable,
  notification is best-effort.
```

**Changes applied in iteration 1:**

- `migrations/0226_fix_suppression_unique_nulls.sql` — added a Step-1 CTE dedupe before the
  `CREATE UNIQUE INDEX`. Initial pass used `ORDER BY created_at ASC` and
  `COALESCE(..., 'epoch')` for the `last_suppressed_at` fold.
- `server/services/incidentIngestor.ts` — wrapped the post-commit `boss.send(...)` in try/catch
  that logs `incident_notify_enqueue_failed`, with a comment explaining why async-retry demands
  best-effort notification.

---

## Iteration 2

Codex invocation: `codex review --uncommitted` against the two modified files.

**Codex findings:**

1. **[P1] `migrations/0226_fix_suppression_unique_nulls.sql:21-23`** — the dedupe CTE keeps the
   OLDEST row. `suppressIncident()` overwrites `reason` / `expires_at` on conflict, so under the
   old NULLS-DISTINCT path the NEWEST duplicate row carries the operator's latest intent — e.g. a
   later `permanent` renewal on top of an earlier `24h` rule. Keeping the oldest silently reverts
   that renewal, potentially allowing incidents through an active suppression.

2. **[P3] `migrations/0226_fix_suppression_unique_nulls.sql:39-40`** — `COALESCE(last_suppressed_at, 'epoch'::timestamptz)`
   inside `GREATEST(...)` turns a NULL `last_suppressed_at` (semantic: "never suppressed") into
   `1970-01-01` for the survivor when every row was NULL. Corrupts the `listSuppressions()` surface.

**Adjudication:**

```
[ACCEPT] keep NEWEST row so latest renewal wins — ORDER BY created_at DESC.
[ACCEPT] preserve NULL last_suppressed_at — drop COALESCE('epoch'); MAX() propagates NULL naturally.
```

**Changes applied in iteration 2:**

- `migrations/0226_fix_suppression_unique_nulls.sql` — rewrote the dedupe block:
  - Survivor ordering flipped to `ORDER BY created_at DESC, id DESC`.
  - `MAX(last_suppressed_at)` now propagates NULL (no `COALESCE('epoch')`).
  - `rollup` aggregates over **all** rows in the group (`HAVING COUNT(*) > 1`), and the UPDATE
    replaces the survivor's `suppressed_count` with `r.total_suppressed` — removes a double-count
    bug from the previous `s.suppressed_count + r.total_suppressed`.
  - Kept `IS NOT DISTINCT FROM` for NULL-safe org_id join.

---

## Iteration 3

Codex invocation: `codex review --uncommitted` against the three modified files.

**Codex findings:**

1. **[P2] `migrations/0226_fix_suppression_unique_nulls.sql:70-72`** — SQL uses `NULLS NOT DISTINCT`
   but the Drizzle schema in `server/db/schema/systemIncidentSuppressions.ts` still declares the
   uniqueIndex without `.nullsNotDistinct()`. Existing precedent in this repo
   (`scrapingCache.ts`, `scrapingSelectors.ts`) aligns both. Risk: a future
   `drizzle-kit generate` emits a "recreate this index" migration that silently restores the
   old semantics.

**Adjudication:**

```
[ACCEPT] uniqueIndex missing .nullsNotDistinct()
  Reason: Drift is real and has precedent in this codebase. One-line fix aligned with the
  "docs stay in sync with code" rule applied to schema.
```

**Changes applied in iteration 3:**

- `server/db/schema/systemIncidentSuppressions.ts` — appended `.nullsNotDistinct()` to the
  `fpOrgUnique` uniqueIndex; added a comment pointing back to migration 0226.

---

## Changes Made

- `migrations/0226_fix_suppression_unique_nulls.sql` — added Step-1 dedupe block before the
  `CREATE UNIQUE INDEX`, keeping newest row per `(fingerprint, organisation_id)` group, folding
  `suppressed_count` and MAX-`last_suppressed_at` into the survivor with NULL-preserving semantics.
- `server/services/incidentIngestor.ts` — made post-commit `boss.send('system-monitor-notify', …)`
  best-effort (try/catch → `logger.error('incident_notify_enqueue_failed', …)`), with an inline
  comment explaining why rethrow would make the async ingest path non-idempotent.
- `server/db/schema/systemIncidentSuppressions.ts` — appended `.nullsNotDistinct()` to the
  `fpOrgUnique` uniqueIndex to match migration 0226.

## Rejected Recommendations

None in this dual-review run. All three Codex findings (two P1 + one P3 in iter 1/2, one P2 in iter 3)
were accepted because they were correctness issues in code introduced on this branch, none
conflicted with CLAUDE.md or `docs/spec-context.md` framing (pre-production doesn't excuse
data-corruption-on-deploy or ingest double-counting), and all fixes were minimal and follow existing
repo conventions.

Codex did not surface findings on the focus-area items the brief asked it to check:
fingerprint+org NULL semantics (now mitigated by iter-3 fix), fatigue-guard scoping
(pr-reviewer strong rec #10), `escalateIncidentToAgent` task-before-tx orphan (#11 — note the
current code DOES wrap task creation in `db.transaction`, so #11 may already be closed), or
`normaliseMessage` ordering test (#12). These stay as previously-deferred items from the earlier
pr-review; this dual-review did not re-process them.

---

**Verdict:** PR ready. All critical and important issues Codex surfaced across three iterations
have been resolved. Remaining pr-reviewer strong recommendations (#10, #11, #12) were outside
Codex's surfaced set in this run and stay as previously-deferred items — not blocking for merge.
