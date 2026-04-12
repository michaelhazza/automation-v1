import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccounts, organisations } from '../db/schema/index.js';
import { boardService } from './boardService.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Org Subaccount Service — manages the org's default workspace subaccount
//
// Spec: docs/org-subaccount-refactor-spec.md §9d
// ---------------------------------------------------------------------------

/**
 * Get the org subaccount for an organisation. Returns null if not yet created.
 */
export async function getOrgSubaccount(orgId: string) {
  const [sa] = await db
    .select()
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.organisationId, orgId),
        eq(subaccounts.isOrgSubaccount, true),
        isNull(subaccounts.deletedAt),
      ),
    );
  return sa ?? null;
}

/**
 * Get or create the org subaccount for an organisation.
 * Idempotent — safe for retries, multi-worker setups, and async flows.
 * The partial unique index prevents duplicate org subaccounts; on conflict
 * we just fetch the existing one.
 */
export async function ensureOrgSubaccount(orgId: string, orgName: string) {
  // Check if it already exists
  const existing = await getOrgSubaccount(orgId);
  if (existing) return existing;

  try {
    const [sa] = await db
      .insert(subaccounts)
      .values({
        organisationId: orgId,
        name: `${orgName} Workspace`,
        slug: `org-hq-${crypto.randomUUID()}`,
        status: 'active',
        isOrgSubaccount: true,
        includeInOrgInbox: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Init board config (non-fatal)
    boardService.initSubaccountBoard(orgId, sa.id).catch((err) => {
      logger.warn('org_subaccount.board_init_failed', {
        orgId,
        subaccountId: sa.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('org_subaccount.created', { orgId, subaccountId: sa.id });
    return sa;
  } catch (err: unknown) {
    // Handle unique violation (concurrent creation race)
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      const fallback = await getOrgSubaccount(orgId);
      if (fallback) return fallback;
    }
    throw err;
  }
}

/**
 * Get the org subaccount or throw 404 if not found.
 */
export async function requireOrgSubaccount(orgId: string) {
  const sa = await getOrgSubaccount(orgId);
  if (!sa) {
    throw { statusCode: 404, message: 'Organisation workspace not found' };
  }
  return sa;
}
