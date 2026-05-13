import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { browserWarmSessions } from '../../db/schema/browserWarmSessions.js';
import { subaccountIeeBrowserSettings } from '../../db/schema/subaccountIeeBrowserSettings.js';
import { llmRequests } from '../../db/schema/llmRequests.js';
import { parseCurrentVersion } from './templateVersionParserPure.js';
import { isRefillEligible, computeIdleCostCents } from './browserWarmPoolPure.js';
import { logger } from '../../lib/logger.js';

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
): Promise<void> {
  // 1. Read session row
  const [session] = await db.select().from(browserWarmSessions)
    .where(eq(browserWarmSessions.id, warmSessionId));
  if (!session) {
    logger.debug('iee_browser.warm_pool.terminate_not_found', { warmSessionId });
    return;
  }
  if (session.status === 'terminated') {
    logger.debug('iee_browser.warm_pool.terminate_idempotent', { warmSessionId });
    return;
  }

  // 2. Compute cost
  const terminatedAt = new Date();
  const idleCostCents = computeIdleCostCents(
    session.createdAt.getTime(), terminatedAt.getTime(), warmPoolRatePerSecond,
  );

  // 3. UPDATE status=terminated (accepts both 'available' and 'leased' — idempotent)
  const updated = await db.update(browserWarmSessions)
    .set({
      status: 'terminated',
      terminatedAt,
      idleCostCentsAttributed: idleCostCents,
    })
    .where(and(
      eq(browserWarmSessions.id, warmSessionId),
      sql`${browserWarmSessions.status} IN ('leased', 'available')`,
    ))
    .returning({ id: browserWarmSessions.id });

  if (updated.length === 0) {
    logger.debug('iee_browser.warm_pool.terminate_race_lost', { warmSessionId });
    return;
  }

  // 4. Write idle cost row to llm_requests (unique partial index makes this idempotent)
  const now = new Date();
  const billingMonth = now.toISOString().slice(0, 7);  // YYYY-MM
  const billingDay = now.toISOString().slice(0, 10);   // YYYY-MM-DD
  const costCentsStr = (idleCostCents / 100).toFixed(8);

  try {
    await db.insert(llmRequests).values({
      idempotencyKey: `warm_pool:${warmSessionId}`,
      organisationId: session.organisationId,
      subaccountId: session.subaccountId,
      sourceType: 'sandbox_compute',
      subtype: 'warm_pool',
      warmSessionId,
      featureTag: 'iee-browser-warm-pool',
      callSite: 'worker',
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
      // Idempotent — cost row already written; no-op
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

async function checkout(ctx: { organisationId: string; subaccountId: string }): Promise<{
  warmSessionId: string;
  sandboxId: string;
  leaseToken: string;
} | null> {
  // Load settings
  const [settings] = await db.select().from(subaccountIeeBrowserSettings)
    .where(eq(subaccountIeeBrowserSettings.subaccountId, ctx.subaccountId));

  if (!isRefillEligible(settings ?? null)) {
    logger.info('iee_browser.warm_pool_miss', { subaccountId: ctx.subaccountId, reason: 'feature_disabled' });
    return null;
  }

  // Find an available warm session
  const [available] = await db.select().from(browserWarmSessions)
    .where(and(
      eq(browserWarmSessions.subaccountId, ctx.subaccountId),
      eq(browserWarmSessions.status, 'available'),
    ));

  if (!available) {
    logger.info('iee_browser.warm_pool_miss', { subaccountId: ctx.subaccountId, reason: 'starvation' });
    return null;
  }

  // Atomic lease: only succeeds if still available (concurrent checkout loses)
  const leased = await db.update(browserWarmSessions)
    .set({ status: 'leased', leasedAt: new Date() })
    .where(and(
      eq(browserWarmSessions.id, available.id),
      eq(browserWarmSessions.status, 'available'),
    ))
    .returning({ id: browserWarmSessions.id, sandboxId: browserWarmSessions.sandboxId });

  if (leased.length === 0) {
    // Race lost
    logger.info('iee_browser.warm_pool_miss', { subaccountId: ctx.subaccountId, reason: 'starvation' });
    return null;
  }

  return { warmSessionId: leased[0].id, sandboxId: leased[0].sandboxId, leaseToken: leased[0].id };
}

async function terminate(input: {
  warmSessionId: string;
  reason: 'post_lease' | 'evict_stale' | 'feature_disabled';
}): Promise<void> {
  await _terminateAndWriteCostRow(input.warmSessionId, input.reason);
}

async function evictStale(): Promise<{ evicted: number }> {
  // Claim stale available sessions with FOR UPDATE SKIP LOCKED
  const staleRows = await db.execute(sql`
    SELECT id FROM browser_warm_sessions
    WHERE status = 'available'
      AND created_at < NOW() - INTERVAL '30 minutes'
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  `);

  const ids = (staleRows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
  if (ids.length === 0) return { evicted: 0 };

  let evicted = 0;
  for (const id of ids) {
    await _terminateAndWriteCostRow(id, 'evict_stale');
    evicted++;
  }

  logger.info('iee_browser.warm_pool.evict_stale', { evicted });
  return { evicted };
}

async function refillIfEligible(ctx: { subaccountId: string }): Promise<void> {
  const [settings] = await db.select().from(subaccountIeeBrowserSettings)
    .where(eq(subaccountIeeBrowserSettings.subaccountId, ctx.subaccountId));

  if (!isRefillEligible(settings ?? null)) return;

  // Provision stub — e2b SDK not yet installed (see e2bSandbox.ts: SANDBOX-DEF-EGRESS-MECH).
  // A real provisioning call will replace this placeholder when the SDK is available.
  // The unique partial index on browser_warm_sessions(subaccount_id) WHERE status='available'
  // ensures only one available row exists; the 23505 catch handles concurrent refill races.
  const sandboxId = `stub-${randomUUID()}`; // placeholder until e2b SDK is installed
  const cvPath = join(process.cwd(), 'infra/sandbox-templates/iee-browser/CURRENT_VERSION');
  let templateVersion = 'local-dev-v1.0.0';
  try {
    const parsed = parseCurrentVersion(readFileSync(cvPath, 'utf8'));
    templateVersion = parsed.version;
  } catch { /* ignore */ }

  try {
    await db.insert(browserWarmSessions).values({
      organisationId: settings!.organisationId,
      subaccountId: ctx.subaccountId,
      sandboxId,
      templateName: BROWSER_TEMPLATE_NAME,
      templateVersion,
      status: 'available',
    });
    logger.info('iee_browser.warm_pool.refilled', { subaccountId: ctx.subaccountId, sandboxId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      // Another worker already refilled — no-op
      logger.debug('iee_browser.warm_pool.refill_race_lost', { subaccountId: ctx.subaccountId });
      return;
    }
    throw err;
  }
}

export const browserWarmPool = { checkout, terminate, evictStale, refillIfEligible } as const;
