/**
 * seed-memory-consolidation-audit-fixture.ts
 *
 * Operator-run seeder for the memory consolidation audit script.
 * Creates 5 seed tenants with fixture data that satisfies all audit checks.
 *
 * Run ONCE against local dev before the first audit invocation:
 *   npx tsx scripts/audit/_fixtures/seed-memory-consolidation-audit-fixture.ts
 *
 * Seed shape per tenant:
 *   - 200 workspace_memory_entries across tiers (60% episodic / 25% semantic /
 *     10% working / 5% procedural)
 *   - 10 workspace_memory_entry_tier_transitions
 *   - last_accessed_at set within last 7 days for 10 sampled entries
 *
 * Prerequisites:
 *   - DATABASE_URL env var set to local dev DB
 *   - MEMORY_CONSOLIDATION_TIER_ENABLED=true
 *   - The seed organisations must already exist in the organisations table,
 *     or the script will skip them with a warning.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

const SEED_ORG_SLUGS = [
  'audit_seed_org_1',
  'audit_seed_org_2',
  'audit_seed_org_3',
  'audit_seed_org_4',
  'audit_seed_org_5',
];

// Tier distribution: 60% episodic, 25% semantic, 10% working, 5% procedural
const TIER_DISTRIBUTION: Array<{ tier: string; count: number }> = [
  { tier: 'episodic',   count: 120 },
  { tier: 'semantic',   count: 50  },
  { tier: 'working',    count: 20  },
  { tier: 'procedural', count: 10  },
];

function randomUUID(): string {
  return crypto.randomUUID();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  for (const slug of SEED_ORG_SLUGS) {
    // Look up org by slug.
    const orgRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM organisations WHERE slug = ${slug} LIMIT 1`
    );
    const rawOrgRows = Array.isArray(orgRows) ? orgRows : (orgRows as { rows?: { id: string }[] }).rows ?? [];

    if (rawOrgRows.length === 0) {
      console.warn(`[seed] Org not found: ${slug} — skipping (create it first)`);
      continue;
    }

    const orgId = rawOrgRows[0].id;

    // Look up a subaccount for the org.
    const subRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM subaccounts WHERE organisation_id = ${orgId} LIMIT 1`
    );
    const rawSubRows = Array.isArray(subRows) ? subRows : (subRows as { rows?: { id: string }[] }).rows ?? [];

    if (rawSubRows.length === 0) {
      console.warn(`[seed] No subaccount found for org ${slug} — skipping`);
      continue;
    }

    const subaccountId = rawSubRows[0].id;

    console.log(`[seed] Seeding tenant ${slug} (org=${orgId}, sub=${subaccountId})...`);

    // Seed workspace_memory_entries.
    const entryIds: string[] = [];
    for (const { tier, count } of TIER_DISTRIBUTION) {
      for (let i = 0; i < count; i++) {
        const id = randomUUID();
        entryIds.push(id);
        await db.execute(sql`
          INSERT INTO workspace_memory_entries (
            id, organisation_id, subaccount_id, type, content,
            quality_score, access_count, last_accessed_at,
            consolidation_tier, created_at
          ) VALUES (
            ${id}::uuid,
            ${orgId}::uuid,
            ${subaccountId}::uuid,
            'observation',
            ${`Seed memory entry ${id} tier=${tier}`},
            0.8,
            ${i < 10 ? 3 : 0},
            ${i < 10 ? daysAgo(1).toISOString() : null},
            ${tier},
            ${daysAgo(30).toISOString()}
          )
          ON CONFLICT (id) DO NOTHING
        `);
      }
    }

    // Seed workspace_memory_entry_tier_transitions (10 per tenant).
    const transitions: Array<{ old_tier: string; new_tier: string }> = [
      { old_tier: 'working',  new_tier: 'episodic'   },
      { old_tier: 'working',  new_tier: 'episodic'   },
      { old_tier: 'working',  new_tier: 'episodic'   },
      { old_tier: 'episodic', new_tier: 'semantic'   },
      { old_tier: 'episodic', new_tier: 'semantic'   },
      { old_tier: 'episodic', new_tier: 'semantic'   },
      { old_tier: 'episodic', new_tier: 'procedural' },
      { old_tier: 'episodic', new_tier: 'procedural' },
      { old_tier: 'semantic', new_tier: 'procedural' },
      { old_tier: 'semantic', new_tier: 'procedural' },
    ];

    for (const t of transitions) {
      await db.execute(sql`
        INSERT INTO workspace_memory_entry_tier_transitions (
          id, entry_id, organisation_id, subaccount_id,
          old_tier, new_tier, config_version, signal_contributions,
          promotion_mode, created_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${entryIds[0]}::uuid,
          ${orgId}::uuid,
          ${subaccountId}::uuid,
          ${t.old_tier},
          ${t.new_tier},
          1,
          ${'{"reinforcementCount":5,"crossSessionRecurrence":2,"recency":0.9}'},
          'auto',
          ${daysAgo(Math.floor(Math.random() * 25 + 1)).toISOString()}
        )
        ON CONFLICT DO NOTHING
      `);
    }

    console.log(`[seed] Done: ${slug} — ${entryIds.length} entries, ${transitions.length} transitions.`);
  }

  await pool.end();
  console.log('[seed] Fixture seeding complete.');
}

main().catch(err => {
  console.error('[seed] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
