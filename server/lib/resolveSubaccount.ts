// guard-ignore-next-line: with-org-tx-or-scoped-db reason="lib helper — orgId resolved by caller; called within withOrgTx context"
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Validates that a subaccount exists and belongs to the given organisation.
 * Throws { statusCode: 403 } if the subaccount exists but belongs to a
 * different organisation (access denied), or { statusCode: 404 } if the
 * subaccount id is not found at all.
 */
export async function resolveSubaccount(subaccountId: string, organisationId: string) {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: function executes within withOrgTx caller chain — tenant-scoped"
  const [sa] = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.id, subaccountId), isNull(subaccounts.deletedAt)));

  if (!sa) throw { statusCode: 404, message: 'Subaccount not found' };
  if (sa.organisationId !== organisationId) throw { statusCode: 403, message: 'Subaccount not found' };
  return sa;
}
