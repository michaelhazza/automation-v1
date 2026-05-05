import { sql } from 'drizzle-orm';
import type { PrincipalContext } from '../services/principal/types.js';
import { getOrgTxContext } from '../instrumentation.js';
import type { OrgScopedTx } from './index.js';

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
 *
 * Session variables are snapshot before the work block and restored after,
 * so nested callers (e.g. an agent-run transaction invoking the planner via
 * `crm.query`, then dispatching to a later tool call in the same tx) do not
 * inherit the inner caller's principal/subaccount context. Without restore,
 * `set_config(..., true)` persists for the remainder of the transaction and
 * the next RLS read would observe the wrong principal.
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

  // Snapshot the current values so nested invocations restore the outer
  // principal context on return. `current_setting(name, true)` returns the
  // empty string for unset names, which round-trips back through set_config
  // as the "unset" sentinel — the migration 0167–0169 policies treat '' and
  // NULL identically via the CASE WHEN = '' THEN '{}'::uuid[] guard.
  const snapshot = (await tx.execute(sql`
    SELECT
      current_setting('app.current_subaccount_id',   true) AS sub,
      current_setting('app.current_principal_type', true) AS ptype,
      current_setting('app.current_principal_id',   true) AS pid,
      current_setting('app.current_team_ids',       true) AS tids
  `)) as unknown as Array<{
    sub:   string | null;
    ptype: string | null;
    pid:   string | null;
    tids:  string | null;
  }>;

  const prior = snapshot[0] ?? { sub: null, ptype: null, pid: null, tids: null };

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

  try {
    return await work(tx);
  } finally {
    // Restore — fire-and-await to keep the round-trip inside the same tx
    // so a downstream consumer immediately sees the outer context. Errors
    // here would leak context, but `set_config` on an open tx is effectively
    // infallible; if the tx is already rolling back, the DB server drops
    // the snapshot along with the tx, and the caller's failure path is
    // unaffected.
    await tx.execute(sql`
      SELECT
        set_config('app.current_subaccount_id',   ${prior.sub   ?? ''}, true),
        set_config('app.current_principal_type', ${prior.ptype ?? ''}, true),
        set_config('app.current_principal_id',   ${prior.pid   ?? ''}, true),
        set_config('app.current_team_ids',       ${prior.tids  ?? ''}, true)
    `);
  }
}
