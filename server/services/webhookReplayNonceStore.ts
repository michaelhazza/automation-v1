/**
 * webhookReplayNonceStore — durable webhook replay deduplication.
 *
 * Provides a DB-backed nonce store keyed on (organisation_id, webhook_source, nonce).
 * Uses INSERT … ON CONFLICT DO NOTHING to guarantee exactly-once insertion per nonce
 * within an org+source namespace. The dedup row commits before downstream processing
 * (at-most-once delivery semantics per spec §6 — LOCKED).
 *
 * RLS: the INSERT runs inside a db.transaction that sets app.organisation_id so that
 * the webhook_replay_nonces_org_isolation policy engages on insert.
 *
 * The in-memory webhookDedupeStore (webhookDedupe.ts) remains as a layer-0 fast-path
 * probe. This store is the authoritative durable layer.
 *
 * Public surface:
 *   recordIfNew(orgId, source, nonce): Promise<{ inserted: boolean }>
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';

/**
 * Atomically record a nonce for (orgId, source) if it has not been seen before.
 *
 * Returns `{ inserted: true }` when this is the first delivery of the nonce.
 * Returns `{ inserted: false }` when the nonce already exists (replay detected).
 *
 * Failure semantics (LOCKED): the dedup row commits independently of downstream
 * processing. If the route crashes after insert but before side-effects, the system
 * is at-most-once for that delivery. This is acceptable per spec.
 */
export async function recordIfNew(
  orgId: string,
  source: string,
  nonce: string,
): Promise<{ inserted: boolean }> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);
    return withOrgTx(
      { tx, organisationId: orgId, source: 'webhook-replay-nonce-store' },
      async () => {
        // INSERT … ON CONFLICT DO NOTHING returns 0 rows on conflict.
        const rows = (await tx.execute(
          sql`INSERT INTO webhook_replay_nonces (organisation_id, webhook_source, nonce)
              VALUES (${orgId}::uuid, ${source}, ${nonce})
              ON CONFLICT (organisation_id, webhook_source, nonce) DO NOTHING
              RETURNING 1 AS inserted`,
        )) as unknown as Array<{ inserted: number }>;
        return rows.length === 1;
      },
    );
  });

  return { inserted: result };
}
