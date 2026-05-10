import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const connectionString = process.env.DATABASE_URL!;

export const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;

/**
 * The transaction handle type that drizzle passes into `db.transaction()`
 * callbacks. Used by `server/lib/orgScopedDb.ts` to type the tx slot on the
 * AsyncLocalStorage context. Kept here (not inline in orgScopedDb.ts) to
 * avoid an import cycle with `server/instrumentation.ts`.
 */
export type OrgScopedTx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Drizzle transaction handle type — the same shape passed into the
 * `db.transaction((tx) => ...)` callback. Re-exported as the canonical name
 * for adapter / service code that participates in a caller-owned transaction
 * (see ExecutionBackend contract — `BackendFinalisationInput.tx`,
 * `loadTerminalState(tx, ...)`).
 *
 * Structurally identical to `OrgScopedTx`; declared as a named alias so
 * adapter / contract code can import a name that reads as "the tx handle"
 * without the orgScoped framing.
 */
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];
