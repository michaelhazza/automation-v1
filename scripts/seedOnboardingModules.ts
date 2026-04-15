/**
 * scripts/seedOnboardingModules.ts
 *
 * Sets `onboarding_playbook_slugs = ['daily-intelligence-brief']` on the
 * `client_pulse` module (the default "reporting" module) so that any
 * sub-account belonging to a ClientPulse subscription is offered the Daily
 * Intelligence Brief during onboarding.
 *
 * Idempotent — safe to re-run. Already includes the slug → no-op.
 *
 * Per spec §10.6 / §G12.3.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { modules } from '../server/db/schema/modules.js';

const REPORTING_MODULE_SLUG = 'client_pulse';
const PLAYBOOK_SLUG = 'daily-intelligence-brief';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seedOnboardingModules(): Promise<void> {
  const [mod] = await db
    .select({ id: modules.id, onboardingPlaybookSlugs: modules.onboardingPlaybookSlugs })
    .from(modules)
    .where(eq(modules.slug, REPORTING_MODULE_SLUG))
    .limit(1);

  if (!mod) {
    console.log(`[seedOnboardingModules] module '${REPORTING_MODULE_SLUG}' not found — skipping`);
    return;
  }

  const already = (mod.onboardingPlaybookSlugs ?? []).includes(PLAYBOOK_SLUG);
  if (already) {
    console.log(`[seedOnboardingModules] '${PLAYBOOK_SLUG}' already in '${REPORTING_MODULE_SLUG}' — no-op`);
    return;
  }

  // Append slug using Postgres array concatenation to preserve any extras.
  await db
    .update(modules)
    .set({
      onboardingPlaybookSlugs: sql`array_append(${modules.onboardingPlaybookSlugs}, ${PLAYBOOK_SLUG})`,
      updatedAt: new Date(),
    })
    .where(eq(modules.id, mod.id));

  console.log(`[seedOnboardingModules] added '${PLAYBOOK_SLUG}' to '${REPORTING_MODULE_SLUG}'`);
}

// ── Run standalone ─────────────────────────────────────────────────────────────
seedOnboardingModules()
  .catch((err) => {
    console.error('[seedOnboardingModules] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
