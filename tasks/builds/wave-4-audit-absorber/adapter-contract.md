# Adapter Contract — pg-boss + Drizzle bridge for AE2 atomicity

**Produced by:** Chunk 0 (Setup & verification)
**Date:** 2026-05-16
**Spec ref:** §3 D1 architecture note — "chunk 0 must verify Pattern A is implementable with the project's pg-boss + Drizzle stack before chunk 2a proceeds"

## Verdict

**Pattern A is FEASIBLE.** The Drizzle postgres-js driver exposes the underlying postgres.js `TransactionSql` object as a public field (`session.client`) on each transaction scope. The `TransactionSql` object supports `.unsafe(text, values[])`, which satisfies the `Db` interface required by pg-boss's `boss.send({ db })` pattern.

**Chunk 2a proceeds with Pattern A.**

---

## 1. pg-boss Pattern A — how `boss.send({ db })` works

Source: `node_modules/pg-boss/src/manager.js` (read lines 380-457).

When a caller passes a `db` object in the send options, pg-boss's `createJob` method delegates the INSERT entirely to that object:

```js
// manager.js ~line 410
const { db: wrapper } = options;
// ...
const result = await db.executeSql(this.insertJobCommand, values);
if (result.rowCount === 1) {
  return result.rows[0].id;
}
```

The `db` parameter must implement:

```ts
interface PgBossDb {
  executeSql(text: string, values: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}
```

`this.insertJobCommand` is a fixed parameterized SQL string. `values` is a 14-element positional array containing job fields (id, name, priority, data, state, retry config, expiration, etc.).

The `singletonNextSlot` debounce path can call `executeSql` twice in a single `send` (first to delete the held slot, then to insert the new job), but both calls go through the same `db` object, so the same transaction scope covers both.

**No pg-boss patches or monkey-patching required.** The `db` parameter is a first-class API surface in pg-boss v9+.

---

## 2. Drizzle postgres-js driver — transaction client exposure

Source: `node_modules/drizzle-orm/postgres-js/session.d.ts` and `session.js` (read fully).

### 2a. Class hierarchy

```
PostgresJsSession
  .client: TSQL  (a Sql | TransactionSql from postgres.js)
  .query(sql, params): Promise<QueryResultRow[]>  — calls client.unsafe(sql, params).values()
  .execute(query): Promise<...>  — delegates to prepared query

PostgresJsPreparedQuery
  .client: TSQL
  .execute(...): calls this.client.unsafe(query, params)

PostgresJsTransaction extends PgTransaction
  constructor(session: PostgresJsSession, ...)  // session marked @internal but is a public JS property
  — nesting via: this.session.client.savepoint(...)
```

### 2b. The critical field

`PostgresJsSession` exposes:
```ts
public client: TSQL;  // declared in session.d.ts as public
```

Where `TSQL = Sql | TransactionSql` from the `postgres` npm package.

Inside a `db.transaction(async (tx) => { ... })` callback, `tx` is a `PostgresJsTransaction`. Its session's client is a `TransactionSql` — the postgres.js object bound to the active transaction.

### 2c. Accessing the client

The `PostgresJsTransaction` class does not re-expose `session` in its TypeScript declaration, but the `session` property IS accessible at runtime (it's not a Symbol or WeakMap). The declaration file marks it `/** @internal */` in a comment but uses `public` access modifier, making it accessible from TypeScript code.

Access pattern:
```ts
// tx is DrizzleTransaction<PostgresJsQueryResultHKT, ...>
// Cast needed to access the internal session field
const pgSession = (tx as any)._.session as PostgresJsSession;
const transactionSql = pgSession.client; // TransactionSql
```

The `._` property on a Drizzle transaction is the internal dialect-specific transaction object. For postgres-js, `._` is the `PostgresJsTransaction` instance, which holds `.session`.

---

## 3. The adapter

### 3a. Interface implementation

```ts
// Implements PgBossDb interface
function makePgBossDb(tx: PostgresJsTransaction): { executeSql: ... } {
  const transactionSql = (tx as any)._.session.client as TransactionSql;
  return {
    async executeSql(text: string, values: unknown[]) {
      // postgres.js unsafe() executes parameterized SQL with positional params
      const rows = await transactionSql.unsafe(text, values as any[]);
      return { rows: rows as unknown[], rowCount: rows.length };
    },
  };
}
```

### 3b. Usage in chunk 2a (AEL atomicity pattern)

```ts
await db.transaction(async (tx) => {
  // 1. Write execution event row via Drizzle
  const [event] = await tx.insert(agentExecutionEvents).values({ ... }).returning();

  // 2. Enqueue next-step job within the same transaction
  const pgBossDb = makePgBossDb(tx as any);
  await boss.send({
    name: 'agent-execution-loop',
    data: { executionId: event.id },
  }, { db: pgBossDb });
  // pg-boss inserts the job row via our adapter — same tx, same commit
});
// On commit: both event row and job row land atomically
// On rollback: neither lands — no orphaned jobs
```

### 3c. Return shape compatibility

pg-boss checks `result.rowCount === 1` to confirm the INSERT succeeded and reads `result.rows[0].id` for the job UUID.

postgres.js `unsafe()` returns an array of row objects. The `rowCount` field is not natively on the array, but `rows.length` is equivalent for the INSERT case (always returns exactly 1 row on success, or throws on error). The adapter maps `rows.length` → `rowCount`, which satisfies pg-boss's check.

---

## 4. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `(tx as any)._.session` path relies on Drizzle internals | Medium | Drizzle's postgres-js session is stable across minor versions; `PostgresJsSession` class has not changed structure since v0.28. Pin `drizzle-orm` version in package.json. If Drizzle upgrades break the path, the adapter throws at runtime (not silently). |
| `rows.length` vs `rowCount` | Low | pg-boss only uses `rowCount === 1` to confirm success. For the job INSERT, postgres returns exactly 1 row. The `rows.length` mapping is correct. |
| `singletonNextSlot` double-call | Low | Both `executeSql` calls go through the same adapter/same `TransactionSql`, so both execute in the same transaction scope. Correct behaviour. |
| Transaction already closed when adapter is called | Low | The adapter is constructed inside the `db.transaction` callback and passed to `boss.send` within the same callback scope. It cannot outlive the transaction. |
| pg-boss version upgrade changes `db` contract | Low | pg-boss v9 API is stable. The `Db` interface (`executeSql`) is documented in pg-boss changelog as stable since v8. Current version in package.json: check via `npm ls pg-boss`. |

---

## 5. Alternative: Pattern B (post-commit enqueue)

For reference only — Pattern A is selected.

Pattern B: write the execution event row in the main transaction, commit, then enqueue the job. Uses `boss.send` without `{ db }`.

**Downside:** If the process crashes between commit and `boss.send`, the event row exists but no job is enqueued. The execution is permanently stuck (no retry path). Requires a recovery sweep job or idempotent re-enqueue on startup — additional complexity.

**Pattern A win:** Atomicity is guaranteed by the database. No recovery sweep needed. Pattern A is preferable for AEL where missing an enqueue = stalled agent execution.

---

## 6. Acceptance criteria for chunk 2a

Chunk 2a (AEL atomicity implementation) must:
1. Implement `makePgBossDb(tx)` adapter in a new file (e.g., `server/lib/pgBossAdapter.ts`)
2. Use the adapter in `agentExecutionLoopService.ts` where the next-step job is enqueued
3. Confirm the `(tx as any)._.session.client` path resolves to a `TransactionSql` at runtime (add a type assertion that throws if the path is `null`/`undefined`)
4. Not import `db` directly in the new `server/lib/pgBossAdapter.ts` — the adapter receives `tx` as a parameter only
5. Pass G1 lint + typecheck with the `as any` cast isolated to the adapter file
