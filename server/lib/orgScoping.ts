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

/**
 * Sets BOTH the organisation_id AND subaccount_id GUCs on the current
 * transaction. Required for tables whose RLS policy is keyed on both
 * `current_setting('app.organisation_id')` AND
 * `current_setting('app.subaccount_id')`.
 *
 * Mandatory for the three new operator backend tables:
 *   operator_runs, operator_task_profiles, subaccount_operator_settings.
 *
 * Future subaccount-scoped tables that require dual-GUC isolation MUST also
 * call this helper. Calling only `setOrgGUC` is a build error for these tables
 * because the subaccount_id policy check will fail-closed.
 *
 * Both arguments are validated non-empty; throws on missing input.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3 (Rev 2 F3)
 */
export async function setOrgAndSubaccountGUC(
  tx: OrgScopedTx,
  orgId: string,
  subaccountId: string,
): Promise<void> {
  if (!orgId) throw new Error('orgId required for setOrgAndSubaccountGUC');
  if (!subaccountId) throw new Error('subaccountId required for setOrgAndSubaccountGUC');
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);
  await tx.execute(sql`SELECT set_config('app.subaccount_id', ${subaccountId}, true)`);
}
