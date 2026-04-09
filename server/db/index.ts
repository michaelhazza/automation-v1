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
