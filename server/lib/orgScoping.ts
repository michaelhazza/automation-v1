import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../db/index.js';

/**
 * Sets the per-statement organisation_id GUC on the current transaction.
 *
 * MUST be called as the first statement inside any db.transaction(async tx => { ... })
 * block that touches RLS-protected tables outside the request middleware path.
 *
 * The `true` third argument to set_config scopes the setting to the current
 * transaction (is_local = true) so it is cleared automatically on commit/rollback
 * and cannot leak back into the connection pool.
 *
 * This is the canonical replacement for the `withOrgTx({ tx: db })` anti-pattern
 * (passing the module-level db connection as `tx`). See KNOWLEDGE.md —
 * "2026-05-05 Gotcha — withOrgTx({ tx: db }) in unauthenticated callbacks".
 */
export async function setOrgGUC(tx: OrgScopedTx, orgId: string): Promise<void> {
  if (!orgId) throw new Error('orgId required for setOrgGUC');
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);
}
