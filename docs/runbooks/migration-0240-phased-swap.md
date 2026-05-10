# Migration 0240 — Phased Unique-Constraint Swap

Runbook for replacing the blocking unique constraint on the `conversations` table with a concurrently-built index, avoiding a full table lock under production load.

## When to use this runbook

Apply this runbook when **either** of the following thresholds is met:

- **Table size:** `conversations` reaches tens of millions of rows (ballpark: row count visible via `SELECT reltuples FROM pg_class WHERE relname = 'conversations'` exceeds ~10M).
- **Write-latency tail:** p99 write latency on `conversations` INSERT/UPDATE paths exceeds ~100–300 ms, and `pg_stat_activity` shows lock waits on `conversations` during schema changes.

At pre-launch row counts (low thousands), migration 0240 runs in milliseconds with a standard `ALTER TABLE`. This runbook is for the post-scale case.

## Background

PostgreSQL's `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` acquires an `AccessExclusiveLock` for the duration of the index build. On a large table under write load, this lock starves concurrent writers for seconds to minutes.

The phased approach:
1. Build the index concurrently (no table lock, writers proceed normally).
2. Promote the pre-built index to a named constraint (near-instant, index already exists).
3. Drop the old blocking constraint.

## Operator command sequence

Run each step in order. Do not wrap steps 1 or 3 in a transaction — `CREATE INDEX CONCURRENTLY` is explicitly forbidden inside a transaction block.

### Step 1 — Build the index concurrently

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  conversations_unique_idx_new
ON conversations (<column_list>);
```

Replace `<column_list>` with the exact column set of the constraint being replaced (inspect via `\d conversations` or `pg_constraint`). The `IF NOT EXISTS` makes the statement idempotent — safe to re-run if interrupted.

This step runs without a table lock. Duration scales with table size and write rate; on a busy table, expect minutes. Monitor via:

```sql
SELECT phase, blocks_done, blocks_total, tuples_done, tuples_total
FROM pg_stat_progress_create_index
WHERE relid = 'conversations'::regclass;
```

Wait until this query returns zero rows before proceeding.

### Step 2 — Verify the new index is valid

```sql
-- Check index validity before promoting (run after CREATE UNIQUE INDEX CONCURRENTLY completes)
SELECT i.relname AS indexname, ix.indisvalid
FROM pg_class i
JOIN pg_index ix ON ix.indexrelid = i.oid
JOIN pg_class t ON t.oid = ix.indrelid
WHERE t.relname = 'conversations'
  AND i.relname = 'conversations_unique_idx_new';
```

- If `indisvalid = true` — proceed to Step 3
- If `indisvalid = false` — the concurrent build was interrupted; clean up with `DROP INDEX CONCURRENTLY conversations_unique_idx_new` and restart from Step 1

For definition inspection only (to verify the column set is correct — this view does NOT expose `indisvalid`):

```sql
SELECT indexrelname, pg_get_indexdef(indexrelid) AS def
FROM pg_stat_user_indexes
WHERE relname = 'conversations'
  AND indexrelname = 'conversations_unique_idx_new';
```

### Step 3 — Promote the index to a named constraint and drop the old one

This step requires a short `AccessExclusiveLock` but holds it only for the constraint metadata update — no index rebuild occurs.

```sql
BEGIN;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_unique_new
  UNIQUE USING INDEX conversations_unique_idx_new;

ALTER TABLE conversations
  DROP CONSTRAINT <old_constraint_name>;

COMMIT;
```

Replace `<old_constraint_name>` with the name of the existing unique constraint (inspect via `\d conversations` or `SELECT conname FROM pg_constraint WHERE conrelid = 'conversations'::regclass AND contype = 'u'`).

Both `ALTER TABLE` statements run inside a single transaction so the swap is atomic — at no point does the table have zero unique constraints on this column set.

## Rollback plan

### If Step 1 fails or is interrupted

The partial index (if any) is automatically invalid. Drop it and retry:

```sql
DROP INDEX CONCURRENTLY IF EXISTS conversations_unique_idx_new;
```

No constraint changes have occurred; the old constraint is still in place.

### If Step 3 fails mid-transaction

PostgreSQL rolls back the entire transaction. Both `ALTER TABLE` statements are in the same `BEGIN/COMMIT` block — either both succeed or neither does. Verify:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'conversations'::regclass AND contype = 'u';
```

If the connection drops before `COMMIT`, Postgres rolls back the entire transaction atomically — there is no partial state where one `ALTER TABLE` committed but not the other. Verify the rollback succeeded by checking that the old constraint is still present:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'conversations'::regclass AND contype = 'u';
```

Both constraints should still be present (old constraint in place, new one not yet promoted). Once confirmed, retry Step 3. There is no manual cleanup required from a dropped-connection scenario — the transaction boundary guarantees atomicity.

### If Step 3 succeeds but the new constraint causes unexpected behaviour

Re-apply the old constraint using the standard (locking) path — at this point you have already confirmed the table is small enough to tolerate it, or you are accepting a brief lock in an emergency:

```sql
ALTER TABLE conversations
  ADD CONSTRAINT <old_constraint_name>
  UNIQUE (<column_list>);

ALTER TABLE conversations
  DROP CONSTRAINT conversations_unique_new;
```

## Post-migration verification

```sql
-- Confirm old constraint is gone and new one is present
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'conversations'::regclass AND contype = 'u';

-- Confirm the backing index is valid
SELECT indexname, pg_get_indexdef(indexrelid)
FROM pg_stat_user_indexes
WHERE relname = 'conversations';
```

Run a representative INSERT and UPDATE on `conversations` and confirm no constraint errors.
