import { readFileSync } from 'fs';
import { join } from 'path';
import { eq, and, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { browserWarmSessions } from '../../db/schema/browserWarmSessions.js';
import { subaccountIeeBrowserSettings } from '../../db/schema/subaccountIeeBrowserSettings.js';
import { llmRequests } from '../../db/schema/llmRequests.js';
import { parseCurrentVersion } from './templateVersionParserPure.js';
import { isRefillEligible, computeIdleCostCents } from './browserWarmPoolPure.js';
import { logger } from '../../lib/logger.js';
import { FailureError, failure } from '../../../shared/iee/failure.js';

const BROWSER_TEMPLATE_NAME = 'iee-browser';

// Load warm-pool rate from CURRENT_VERSION. Fail closed — if missing, terminate() logs 0 cost.
let warmPoolRatePerSecond = 0;
try {
  const cvPath = join(process.cwd(), 'infra/sandbox-templates/iee-browser/CURRENT_VERSION');
  const parsed = parseCurrentVersion(readFileSync(cvPath, 'utf8'));
  warmPoolRatePerSecond = parsed.max_cost_cents_per_second;
} catch {
  logger.warn('iee_browser.warm_pool.rate_load_failed', { fallback: 0 });
}

// ---------------------------------------------------------------------------
// Private helper — single source of truth for termination + cost write
// ---------------------------------------------------------------------------

async function _terminateAndWriteCostRow(
  warmSessionId: string,
  reason: 'post_lease' | 'evict_stale' | 'feature_disabled',
  _organisationId: string,
  _subaccountId: string,
): Promise<void> {
  const scopedDb = getOrgScopedDb('browserWarmPool._terminateAndWriteCostRow');
  // 1. Read session row
  const [session] = await scopedDb.select().from(browserWarmSessions)
    .where(eq(browserWarmSessions.id, warmSessionId));
  if (!session) {
    logger.debug('iee_browser.warm_pool.terminate_not_found', { warmSessionId });
    return;
  }
  if (session.status === 'terminated') {
    logger.debug('iee_browser.warm_pool.terminate_idempotent', { warmSessionId });
    return;
  }
  const terminatedAt = new Date();
  const idleCostCents = computeIdleCostCents(
    session.createdAt.getTime(), terminatedAt.getTime(), warmPoolRatePerSecond,
  );
  const updated = await scopedDb.update(browserWarmSessions)
    .set({ status: 'terminated', terminatedAt, idleCostCentsAttributed: idleCostCents })
    .where(and(
      eq(browserWarmSessions.id, warmSessionId),
      sql`${browserWarmSessions.status} IN ('leased', 'available')`,
    ))
    .returning({ id: browserWarmSessions.id });
  if (updated.length === 0) {
    logger.debug('iee_browser.warm_pool.terminate_race_lost', { warmSessionId });
    return;
  }
  const now = new Date();
  const billingMonth = now.toISOString().slice(0, 7);
  const billingDay = now.toISOString().slice(0, 10);
  const costCentsStr = (idleCostCents / 100).toFixed(8);
  try {
    await scopedDb.insert(llmRequests).values({
      idempotencyKey: `warm_pool:${warmSessionId}`,
      organisationId: session.organisationId,
      subaccountId: session.subaccountId,
      sourceType: 'sandbox_compute',
      subtype: 'warm_pool',
      warmSessionId,
      featureTag: 'iee-browser-warm-pool',
      callSite: 'iee-browser-warm-pool',
      provider: 'e2b',
      model: `sandbox:${BROWSER_TEMPLATE_NAME}`,
      costRaw: costCentsStr,
      costWithMargin: costCentsStr,
      costWithMarginCents: idleCostCents,
      billingMonth,
      billingDay,
      sandboxProvider: 'e2b',
      sandboxTemplateVersion: session.templateVersion,
      status: 'success',
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      logger.debug('iee_browser.warm_pool.cost_row_already_exists', { warmSessionId });
      return;
    }
    throw err;
  }
  logger.info('iee_browser.warm_pool.terminated', { warmSessionId, reason, idleCostCents });
}

// ---------------------------------------------------------------------------
// Public methods
// ---------------------------------------------------------------------------

// TODO IEE-DEF-9: once refillIfEligible is wired (IEE-DEF-2), checkout must
// filter the SELECT below on `template_name = 'iee-browser'` AND on a compatible
// `template_version` set so we never lease a warm session created against an
// incompatible browser template digest. Today only one template exists and the
// refill path is RUNTIME-DISABLED, so this is a forward-looking invariant note.
async function checkout(ctx: { organisationId: string; subaccountId: string }): Promise<{
  warmSessionId: string;
  sandboxId: string;
  leaseToken: string;
} | null> {
  const scopedDb = getOrgScopedDb('browserWarmPool.checkout');
  const [settings] = await scopedDb.select().from(subaccountIeeBrowserSettings)
    .where(eq(subaccountIeeBrowserSettings.subaccountId, ctx.subaccountId));
  if (!isRefillEligible(settings ?? null)) {
    logger.info('iee_browser.warm_pool_miss', { subaccountId: ctx.subaccountId, reason: 'feature_disabled' });
    return null;
  }
  // NOTE (IEE-DEF-9): add template_name + compatible-template_version filter
  // here before refill goes live.
  const [available] = await scopedDb.select().from(browserWarmSessions)
    .where(and(
      eq(browserWarmSessions.subaccountId, ctx.subaccountId),
      eq(browserWarmSessions.status, 'available'),
    ));
  if (!available) {
    logger.info('iee_browser.warm_pool_miss', { subaccountId: ctx.subaccountId, reason: 'starvation' });
    return null;
  }
  const leased = await scopedDb.update(browserWarmSessions)
    .set({ status: 'leased', leasedAt: new Date() })
    .where(and(
      eq(browserWarmSessions.id, available.id),
      eq(browserWarmSessions.status, 'available'),
    ))
    .returning({ id: browserWarmSessions.id, sandboxId: browserWarmSessions.sandboxId });
  if (leased.length === 0) {
    logger.info('iee_browser.warm_pool_miss', { subaccountId: ctx.subaccountId, reason: 'starvation' });
    return null;
  }
  return { warmSessionId: leased[0].id, sandboxId: leased[0].sandboxId, leaseToken: leased[0].id };
}

async function terminate(input: {
  warmSessionId: string;
  reason: 'post_lease' | 'evict_stale' | 'feature_disabled';
  organisationId: string;
  subaccountId: string;
}): Promise<void> {
  await _terminateAndWriteCostRow(input.warmSessionId, input.reason, input.organisationId, input.subaccountId);
}

/**
 * evictStale — RUNTIME-DISABLED scaffold.
 *
 * Cross-tenant sweep of stale 'available' warm sessions. The candidate-discovery
 * step requires `withAdminConnection` (FORCE RLS blocks cross-tenant reads from
 * a tenant-scoped connection), and the per-row mutation step needs tenant-scoped
 * GUC wrapping. Neither is wired today. To prevent accidental use, this function
 * THROWS at runtime. Wire withAdminConnection per IEE-DEF-1 before any caller
 * lights up — at that point the implementation in git history (commit `8259da5c`
 * predecessor) is the reference. Tracked in tasks/todo.md IEE-DEF-1.
 */
async function evictStale(): Promise<{ evicted: number }> {
  throw new FailureError(
    failure(
      'sandbox_provider_unavailable',
      'browserWarmPool.evictStale is a RUNTIME-DISABLED scaffold. Wire withAdminConnection before enabling (IEE-DEF-1 in tasks/todo.md).',
      { method: 'evictStale' },
    ),
  );
}

/**
 * refillIfEligible — RUNTIME-DISABLED scaffold.
 *
 * Reads settings and inserts warm sessions. Needs organisationId on the ctx and
 * dual-GUC transaction wrapping; also inserts stub sandbox IDs because the e2b
 * SDK is not yet installed. To prevent accidental use, this function THROWS at
 * runtime. Wire the org-scoping + real provisioning per IEE-DEF-2 before any
 * caller lights up. Tracked in tasks/todo.md IEE-DEF-2.
 */
async function refillIfEligible(_ctx: { subaccountId: string }): Promise<void> {
  throw new FailureError(
    failure(
      'sandbox_provider_unavailable',
      'browserWarmPool.refillIfEligible is a RUNTIME-DISABLED scaffold. Wire dual-GUC + real e2b provisioning before enabling (IEE-DEF-2 in tasks/todo.md).',
      { method: 'refillIfEligible' },
    ),
  );
}

export const browserWarmPool = { checkout, terminate, evictStale, refillIfEligible } as const;
