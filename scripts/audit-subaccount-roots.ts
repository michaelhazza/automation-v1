/**
 * audit-subaccount-roots.ts
 *
 * Standalone admin script that checks every subaccount for multiple active
 * root agents (parent_subaccount_agent_id IS NULL AND is_active = true).
 *
 * Prints a table: subaccount_id | org_id | count | agent_slugs
 * Exits 0 if all counts ≤ 1, non-zero otherwise.
 *
 * Usage:
 *   npx tsx scripts/audit-subaccount-roots.ts
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, isNull, and } from 'drizzle-orm';
import { subaccountAgents } from '../server/db/schema/subaccountAgents.js';
import { agents } from '../server/db/schema/agents.js';
import { auditSubaccountRoots } from './auditSubaccountRootsPure.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main(): Promise<void> {
  // Fetch all active root subaccount_agents rows with agent slugs
  const roots = await db
    .select({
      subaccountId: subaccountAgents.subaccountId,
      orgId: subaccountAgents.organisationId,
      agentSlug: agents.slug,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        isNull(subaccountAgents.parentSubaccountAgentId),
        eq(subaccountAgents.isActive, true)
      )
    );

  // Group by subaccountId
  const grouped = new Map<
    string,
    { orgId: string; agentSlugs: string[] }
  >();

  for (const row of roots) {
    const existing = grouped.get(row.subaccountId);
    if (existing) {
      existing.agentSlugs.push(row.agentSlug);
    } else {
      grouped.set(row.subaccountId, {
        orgId: row.orgId,
        agentSlugs: [row.agentSlug],
      });
    }
  }

  const rows = Array.from(grouped.entries()).map(([subaccountId, data]) => ({
    subaccountId,
    orgId: data.orgId,
    count: data.agentSlugs.length,
    agentSlugs: data.agentSlugs,
  }));

  // Print table
  console.log('');
  console.log(
    'subaccount_id                        | org_id                              | count | agent_slugs'
  );
  console.log('-'.repeat(120));
  for (const r of rows) {
    console.log(
      `${r.subaccountId.padEnd(36)} | ${r.orgId.padEnd(36)} | ${String(r.count).padEnd(5)} | ${r.agentSlugs.join(', ')}`
    );
  }
  console.log('');

  const { violations, summary } = auditSubaccountRoots(rows);
  console.log(summary);
  console.log('');

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
