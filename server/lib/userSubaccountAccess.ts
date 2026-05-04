/**
 * userSubaccountAccess — does this user have access to this subaccount?
 *
 * Org-level callers (system_admin, org_admin, manager) have implicit access to
 * every subaccount in their org. Subaccount-scoped users (`user`) need a row
 * in `subaccount_user_assignments`. `client_user` never has access.
 *
 * Used by routes that resolve a resource by its primary ID (rather than via a
 * `:subaccountId` path segment) and need to verify the caller is in the
 * subaccount the resource belongs to. Spec §3.3 contract: "every read endpoint
 * MUST verify subaccount_id = resolvedSubaccount.id" — for non-path-scoped
 * routes this helper closes the same gap.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountUserAssignments } from '../db/schema/index.js';

export type UserDbRole = 'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user';

export async function userCanAccessSubaccount(
  userId: string,
  dbRole: UserDbRole,
  subaccountId: string,
): Promise<boolean> {
  if (dbRole === 'system_admin' || dbRole === 'org_admin' || dbRole === 'manager') {
    return true;
  }
  if (dbRole === 'client_user') {
    return false;
  }

  const [row] = await db
    .select({ id: subaccountUserAssignments.id })
    .from(subaccountUserAssignments)
    .where(
      and(
        eq(subaccountUserAssignments.userId, userId),
        eq(subaccountUserAssignments.subaccountId, subaccountId),
      ),
    )
    .limit(1);

  return row != null;
}
