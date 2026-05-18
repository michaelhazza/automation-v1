// ---------------------------------------------------------------------------
// pgBossTxSend — enqueue a pg-boss job inside a caller's open Drizzle tx.
//
// The INSERT lands in the pgboss.job table within the same Postgres transaction,
// rolling back atomically if the caller's tx rolls back. This is the required
// pattern for scorecard-judge → failure:post-mortem dispatch (Chunk 3).
//
// Implementation: direct INSERT into pgboss.job using the Drizzle sql tag on
// the caller's tx handle. pg-boss picks up the row when the tx commits and its
// maintenance timer fires.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';

/**
 * Enqueue a pg-boss job inside an open Drizzle transaction.
 *
 * The INSERT is atomic with the caller's transaction — if the tx rolls back,
 * the job row is never visible to pg-boss workers.
 *
 * @param tx   - The open Drizzle transaction handle (from db.transaction callback or withOrgTx).
 * @param name - pg-boss queue name.
 * @param data - Job payload (must be JSON-serialisable).
 * @param options - Optional pg-boss job options (retryLimit, expireInSeconds, priority).
 */
export async function sendWithTx(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  name: string,
  data: unknown,
  options?: {
    retryLimit?: number;
    expireInSeconds?: number;
    priority?: number;
    singletonKey?: string;
  },
): Promise<void> {
  const expireIn = options?.expireInSeconds
    ? `${options.expireInSeconds} seconds`
    : '15 minutes';

  const retryLimit = options?.retryLimit ?? 2;
  const priority = options?.priority ?? 0;

  await tx.execute(sql`
    INSERT INTO pgboss.job (name, data, state, retrylimit, priority, expirein, createdon)
    VALUES (
      ${name},
      ${JSON.stringify(data)}::jsonb,
      'created',
      ${retryLimit},
      ${priority},
      ${expireIn}::interval,
      now()
    )
  `);
}
