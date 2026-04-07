// ---------------------------------------------------------------------------
// Worker Drizzle client. Mirrors server/db/index.ts but is process-local so
// the worker does not depend on Express imports. Same connection options.
// ---------------------------------------------------------------------------

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../server/db/schema/index.js';
import { env } from './config/env.js';

export const client = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
