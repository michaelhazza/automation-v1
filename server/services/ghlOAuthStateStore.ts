import { db } from '../db/index.js';
import { oauthStateNonces } from '../db/schema/oauthStateNonces.js';
import { and, eq, gt, sql } from 'drizzle-orm';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function setGhlOAuthState(
  nonce: string,
  organisationId: string,
  pendingRunId?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(oauthStateNonces).values({
    nonce,
    organisationId,
    expiresAt,
    pendingRunId: pendingRunId ?? null,
  });
}

// Nonce is single-use: DELETE ... RETURNING atomically guarantees consume-once.
// Expired AND unknown nonces both return null — callers cannot distinguish them.
export async function consumeGhlOAuthState(
  nonce: string,
): Promise<{ organisationId: string; pendingRunId: string | null } | null> {
  const rows = await db
    .delete(oauthStateNonces)
    // Use DB time (sql`now()`) rather than new Date() to avoid clock-skew across nodes
    .where(and(eq(oauthStateNonces.nonce, nonce), gt(oauthStateNonces.expiresAt, sql`now()`)))
    .returning({
      organisationId: oauthStateNonces.organisationId,
      pendingRunId: oauthStateNonces.pendingRunId,
    });
  return rows[0] ?? null;
}
