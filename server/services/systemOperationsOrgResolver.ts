// Resolves the System Operations org + its sentinel subaccount.
// Seeded by migration 0225 (is_system_org=true, slug='system-ops').
// This resolver is used by escalateIncidentToAgent so tasks are created
// in the correct org context.
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations, subaccounts } from '../db/schema/index.js';

interface SystemOpsContext {
  organisationId: string;
  subaccountId: string;
}

let cached: SystemOpsContext | null = null;

export async function resolveSystemOpsContext(): Promise<SystemOpsContext> {
  if (cached) return cached;

  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isSystemOrg, true))
    .limit(1);

  if (!org) {
    throw Object.assign(
      new Error('System Operations org not found — run migration 0225 first'),
      { statusCode: 500, errorCode: 'system_ops_org_missing' },
    );
  }

  const [sub] = await db
    .select({ id: subaccounts.id })
    .from(subaccounts)
    .where(and(eq(subaccounts.organisationId, org.id), isNull(subaccounts.deletedAt)))
    .limit(1);

  if (!sub) {
    throw Object.assign(
      new Error('System Operations sentinel subaccount not found'),
      { statusCode: 500, errorCode: 'system_ops_subaccount_missing' },
    );
  }

  cached = { organisationId: org.id, subaccountId: sub.id };
  return cached;
}

/** Clear the resolver cache — test / reset use only. */
export function __clearSystemOpsCache(): void {
  cached = null;
}
