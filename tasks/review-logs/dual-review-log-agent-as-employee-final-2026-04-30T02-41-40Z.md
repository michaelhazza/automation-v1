# Dual Review Log — agent-as-employee-final

**Files reviewed:** entire `feat/agents-are-employees` branch diff vs `origin/main` (~128 files), with Codex's attention focused on the four most recent commits (`d5bbc2ef`, `d1702fda`, `05fff3cd`, `3bccf9fa`) per caller's brief. Older Phase A–C commits were already through prior pr-reviewer + dual-reviewer rounds.
**Iterations run:** 3/3
**Timestamp:** 2026-04-30T02:41:40Z
**Commit at finish:** 1eddbd28a9a69548e86cec47b7d328adef639932

---

## Iteration 1

### Codex findings

- **[P1]** Persist migration failures outside the retried transaction — `server/services/workspace/workspaceMigrationService.ts:193-194`
- **[P2]** Align activity cursors with the selected sort — `server/services/activityService.ts:776-776`

### Decisions

```
[ACCEPT] server/services/workspace/workspaceMigrationService.ts:193,206,219 — terminal failure rows + finalisation row are written inside the createWorker tx; rethrowing rolls them back. After retryLimit exhausts, the per-actor failure is invisible and the batch never finalises (status stays `running` forever).
  Reason: Verified by reading server/lib/createWorker.ts:123-137. The handler IS wrapped in db.transaction(...) and rolls back on rethrow. The status-poll endpoint at server/routes/workspace.ts:382-401 relies on `subaccount.migration_completed` to flip from `running` to terminal — without that row the migration is permanently in-flight from the operator's view. Spec §14.4 mandates `identity.migration_failed` as a terminal audit event. Real, severe, in-spec.
  Fix applied: write the failure audit row + the finaliser through a fresh db.transaction (separate connection from the postgres-js pool, commits independently of the worker tx). Org context restored via `SELECT set_config('app.organisation_id', $1, true)` so RLS allows the audit_events insert under tenant scope — no admin-bypass.

[ACCEPT] server/services/activityService.ts:776-789 — cursor predicate walks canonical `(createdAt DESC, id ASC)` per spec §12, but `nextCursor` is emitted from the post-`attention_first`-sort `paged[]` last item. Records with newer createdAt that didn't make page 1 (because they ranked low under attention_first) get permanently skipped on page 2+ because the cursor predicate excludes them.
  Reason: Spec §12 mandates `created_at DESC, id ASC` ordering for the activity feed. Verified that the new AgentActivityTab component (introduced on this branch) paginates by cursor and does NOT pass `sort` (defaulting to `attention_first`). Real bug introduced by DE-CR-7 cursor pagination. Spec is unambiguous.
  Fix applied: slice in canonical order, emit cursor from canonical-last item, then re-sort the slice for display. Iteration 3 refined this further (see below).
```

---

## Iteration 2

### Codex findings

- **[P1]** Defer finalising failures until retries are exhausted — `server/services/workspace/workspaceMigrationService.ts:329-329`
  - "When a transient failure occurs on the last actor in a batch, this durable failure path writes `identity.migration_failed` and immediately calls `maybeFinaliseBatch`, so it can commit a `subaccount.migration_completed` row before pg-boss retries the job. If the retry later succeeds, the partial unique index and `DO NOTHING` prevent the completion row from being corrected, while the status endpoint reads `completionRow.metadata.status` as the terminal status; the migration can therefore remain reported as `failed`/`partial` even after all identities migrated successfully."

### Decisions

```
[ACCEPT] server/services/workspace/workspaceMigrationService.ts:329 — Codex confirmed exactly the edge case I had documented in the iteration-1 fix as a "known limitation". The user-visible bug is real: a transient failure on the last actor that successfully retries leaves the migration permanently mis-reported as `failed`/`partial`. Worse than the original bug because the operator can't tell something went wrong (no `running` indication).
  Reason: Codex's recommendation matches the spec's terminal-event-once-per-identity model (§14.4). The cleanest correct semantics: write `identity.migration_failed` only on the final attempt. Earlier attempts just rethrow; pg-boss retries naturally. The terminal audit row is single-shot per actor.
  Fix applied: introduced `WORKSPACE_MIGRATE_IDENTITY_RETRY_LIMIT = 5` (exported), threaded `attempt: { retrycount, retryLimit }` from the queueService createWorker handler into `processIdentityMigration`, and added an `isFinalAttempt` guard on `persistTerminalFailure`. Initial implementation (iteration 2) wrote the audit row on every attempt but only finalised on the final one — iteration 3 tightened this further to write nothing on intermediate attempts (see below).
```

---

## Iteration 3

### Codex findings

- **[P1]** Don't count non-final migration failures as terminal — `server/services/workspace/workspaceMigrationService.ts:358-360`
  - "When a batch has multiple identities, this persists `identity.migration_failed` even for `retrycount < retryLimit`; a later final failure from another identity can then enter `maybeFinaliseBatch`, count that earlier non-final row as if the first identity were terminal, and insert `subaccount.migration_completed` before the first identity has exhausted its retries. Because the completion insert is `ON CONFLICT DO NOTHING`, a later successful retry cannot correct the stale failed/partial batch result."
- **[P2]** Preserve requested sort before limiting activity pages — `server/services/activityService.ts:789-790`
  - "For any feed with more than `limit` rows and `sort=attention_first`, `severity`, or `oldest`, this now chooses the page membership by newest-first before applying the requested sort. That means older attention-needed/critical/oldest items are excluded from the first page in favor of newer lower-priority items, and the default `attention_first` no longer prioritizes across the full filtered result set."

### Decisions

```
[ACCEPT] server/services/workspace/workspaceMigrationService.ts:329 (round 2) — multi-actor batch race confirmed. Iteration 2's fix wrote `identity.migration_failed` on every attempt. A later final failure on actor B can see actor A's still-retryable failure row, count both as terminal, finalise prematurely, and lock in a stale aggregate via the `ON CONFLICT DO NOTHING` partial unique index.
  Reason: This is exactly the same class of bug as the round-1 finding, just one level deeper. Spec §14.4 specifies ONE terminal event per identity. Writing one on every attempt violates the spec.
  Fix applied: hardened persistTerminalFailure to early-return when !isFinalAttempt — no audit row written on intermediate retries, just the rethrow that lets pg-boss retry. The per-attempt diagnostic trail lives in the `logger.info('workspace_migration_identity_start', …)` line plus pg-boss's job history; the spec-level terminal audit row is single, written exactly once when the actor's retries exhaust. On a successful retry, the worker tx writes `identity.migrated` and finalises atomically (no race because no failure row was ever written for this actor).

[ACCEPT] server/services/activityService.ts:789-790 — confirmed the iteration-1 fix regressed page-1 ranking semantics for non-paginating callers (e.g. ActivityPage which defaults to `attention_first` and does NOT use cursor pagination). The page-1 set is now top-50 by recency, then re-sorted by attention — losing very old `attention_needed` items that should have ranked first under the original behavior.
  Reason: Two correctness constraints in tension. (1) Spec §12 mandates canonical (createdAt DESC, id ASC) ordering for cursor walks — non-canonical sorts skip records on page 2+. (2) Legacy non-paginating UI relies on the requested ranking sort to decide page-1 membership across the full result set.
  Fix applied: gate behavior on `filters.cursor !== undefined`. When paginating: slice canonical, emit canonical cursor, re-sort slice for display (iteration-1 behavior preserved). When NOT paginating: slice under the requested sort, emit no cursor (the alternative-sort slice's last item is not a valid cursor anchor for subsequent walks). Restores legacy ranking for ActivityPage; keeps AgentActivityTab spec-compliant.
```

---

## Changes Made

- `server/services/workspace/workspaceMigrationService.ts` — added `WORKSPACE_MIGRATE_IDENTITY_RETRY_LIMIT` export; threaded optional `attempt: { retrycount, retryLimit }` through `processIdentityMigration`; new `persistTerminalFailure` helper that opens a separate db.transaction (commits independently of the createWorker rollback) and only writes the terminal `identity.migration_failed` audit row + finaliser on the FINAL pg-boss attempt; renamed local `db` to `orgDb` in `processIdentityMigration` to disambiguate from the imported top-level `db`.
- `server/services/queueService.ts` — pass `{ retrycount, retryLimit: WORKSPACE_MIGRATE_IDENTITY_RETRY_LIMIT }` into `processIdentityMigration` from the `workspace.migrate-identity` createWorker handler.
- `server/services/activityService.ts` — `listActivityItems` now branches on `filters.cursor !== undefined`. Paginating callers slice canonically, emit canonical cursor, re-sort slice for display. Non-paginating callers slice under requested sort, emit no cursor — preserves legacy `ActivityPage` ranking.

## Rejected Recommendations

None. Every Codex recommendation across the three iterations was accepted. (Two of the three iterations surfaced the same class of bug at increasing depth — first the durability of failure rows, then the per-attempt vs final-attempt distinction, then the multi-actor batch race. Each was resolved before Codex moved to the next layer.)

---

**Verdict:** APPROVED (3 iterations, both findings of each iteration accepted and fixed)
