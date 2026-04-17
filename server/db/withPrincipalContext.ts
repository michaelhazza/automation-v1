import { sql } from 'drizzle-orm';
import type { PrincipalContext } from '../services/principal/types.js';
import { getOrgTxContext } from '../instrumentation.js';
import type { OrgScopedTx } from '../db/index.js';

/**
 * Layer principal session variables on top of the existing org-scoped
 * transaction opened by `withOrgTx`. The org variable
 * (`app.organisation_id`) is already set by the `withOrgTx` caller;
 * this function adds the four principal variables that RLS policies
 * introduced in P3B consume:
 *
 *   - `app.current_subaccount_id`
 *   - `app.current_principal_type`
 *   - `app.current_principal_id`
 *   - `app.current_team_ids`
 *
 * Must be called inside an active `withOrgTx(...)` block. Throws if
 * no org-scoped transaction is active.
 */
export async function withPrincipalContext<T>(
  principal: PrincipalContext,
  work: (tx: OrgScopedTx) => Promise<T>,
): Promise<T> {
  if (!principal.organisationId) {
    throw new Error('withPrincipalContext: principal.organisationId is required');
  }

  const orgCtx = getOrgTxContext();
  if (!orgCtx) {
    throw new Error(
      'withPrincipalContext: must be called inside an active withOrgTx() block',
    );
  }

  const tx = orgCtx.tx as OrgScopedTx;

  // Set all four principal session variables in a single round-trip.
  // `true` (is_local) scopes these to the current transaction, matching
  // the pattern used by auth middleware for app.organisation_id.
  await tx.execute(sql`
    SELECT
      set_config('app.current_subaccount_id',
        ${principal.subaccountId ?? ''}, true),
      set_config('app.current_principal_type',
        ${principal.type}, true),
      set_config('app.current_principal_id',
        ${principal.id}, true),
      set_config('app.current_team_ids',
        ${(principal.teamIds ?? []).join(',')}, true)
  `);

  return work(tx);
}
