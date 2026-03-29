import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Validates that a subaccount exists and belongs to the given organisation.
 * Throws { statusCode: 404 } if not found.
 */
export async function resolveSubaccount(subaccountId: string, organisationId: string) {
  const [sa] = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId), isNull(subaccounts.deletedAt)));

  if (!sa) throw { statusCode: 404, message: 'Subaccount not found' };
  return sa;
}
