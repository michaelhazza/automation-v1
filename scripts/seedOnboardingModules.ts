/**
 * scripts/seedOnboardingModules.ts
 *
 * Sets `onboarding_playbook_slugs = ['intelligence-briefing', 'weekly-digest']`
 * on the `client_pulse` module (the default "reporting" module) so that any
 * sub-account belonging to a ClientPulse subscription is offered the
 * Intelligence Briefing and Weekly Digest during onboarding.
 *
 * Idempotent — safe to re-run. Already includes the slug → no-op.
 *
 * Per spec §10.6 / §G12.3.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, isNull } from 'drizzle-orm';
import { modules } from '../server/db/schema/modules.js';

const REPORTING_MODULE_SLUG = 'client_pulse';
const PLAYBOOK_SLUGS = ['intelligence-briefing', 'weekly-digest'] as const;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seedOnboardingModules(): Promise<void> {
  const [mod] = await db
    .select({ id: modules.id, onboardingPlaybookSlugs: modules.onboardingPlaybookSlugs })
    .from(modules)
    .where(and(eq(modules.slug, REPORTING_MODULE_SLUG), isNull(modules.deletedAt)))
    .limit(1);

  if (!mod) {
    console.log(`[seedOnboardingModules] module '${REPORTING_MODULE_SLUG}' not found — skipping`);
    return;
  }

  const existing = mod.onboardingPlaybookSlugs ?? [];
  const toAdd = PLAYBOOK_SLUGS.filter((s) => !existing.includes(s));
  if (toAdd.length === 0) {
    console.log(`[seedOnboardingModules] all slugs already in '${REPORTING_MODULE_SLUG}' — no-op`);
    return;
  }

  // Append missing slugs one at a time so existing extras are preserved.
  let current = existing;
  for (const slug of toAdd) {
    current = [...current, slug];
  }
  await db
    .update(modules)
    .set({
      onboardingPlaybookSlugs: current,
      updatedAt: new Date(),
    })
    .where(eq(modules.id, mod.id));

  console.log(`[seedOnboardingModules] added ${JSON.stringify(toAdd)} to '${REPORTING_MODULE_SLUG}'`);
}

// ── Run standalone ─────────────────────────────────────────────────────────────
seedOnboardingModules()
  .catch((err) => {
    console.error('[seedOnboardingModules] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
