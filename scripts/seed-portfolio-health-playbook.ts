/**
 * seed-portfolio-health-playbook.ts
 *
 * Sprint 4 P3.2 — seeds the system playbook template for Portfolio Health
 * Sweep. This template runs in `bulk` mode, enumerating active subaccounts
 * and fanning out per-subaccount health checks in parallel.
 *
 * Usage: npx tsx scripts/seed-portfolio-health-playbook.ts
 */

export {};

import { db } from '../server/db/index.js';
import {
  systemPlaybookTemplates,
  systemPlaybookTemplateVersions,
} from '../server/db/schema/index.js';
import { eq } from 'drizzle-orm';

const TEMPLATE_SLUG = 'portfolio-health-sweep';
const TEMPLATE_NAME = 'Portfolio Health Sweep';

const definition = {
  name: TEMPLATE_NAME,
  description:
    'Enumerate active subaccounts and run health checks in parallel via bulk mode. ' +
    'A synthesis step waits for all per-subaccount results before generating the portfolio report.',
  initialInputSchema: { type: 'object', properties: {}, required: [] },
  maxParallelSteps: 8,
  steps: [
    {
      id: 'enumerate_subaccounts',
      name: 'List active subaccounts',
      type: 'agent_call',
      dependsOn: [],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'reporting-agent' },
      agentInputs: { skill: 'list_active_subaccounts' },
      outputSchema: {
        type: 'object',
        properties: { subaccountIds: { type: 'array', items: { type: 'string' } } },
      },
    },
    {
      id: 'synthesise',
      name: 'Generate portfolio report',
      type: 'agent_call',
      dependsOn: ['enumerate_subaccounts'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'reporting-agent' },
      agentInputs: {
        skill: 'generate_portfolio_report',
        context: '{{ steps.enumerate_subaccounts.output }}',
      },
    },
  ],
};

async function main() {
  // Upsert the system template
  const existing = await db
    .select()
    .from(systemPlaybookTemplates)
    .where(eq(systemPlaybookTemplates.slug, TEMPLATE_SLUG));

  let templateId: string;

  if (existing.length > 0) {
    templateId = existing[0].id;
    console.log(`[seed] System template '${TEMPLATE_SLUG}' already exists: ${templateId}`);
  } else {
    const [row] = await db
      .insert(systemPlaybookTemplates)
      .values({
        slug: TEMPLATE_SLUG,
        name: TEMPLATE_NAME,
        description: definition.description,
        category: 'reporting',
      })
      .returning();
    templateId = row.id;
    console.log(`[seed] Created system template '${TEMPLATE_SLUG}': ${templateId}`);
  }

  // Upsert version 1
  const existingVersion = await db
    .select()
    .from(systemPlaybookTemplateVersions)
    .where(eq(systemPlaybookTemplateVersions.templateId, templateId));

  if (existingVersion.length > 0) {
    console.log(`[seed] Template version already exists, updating definition...`);
    await db
      .update(systemPlaybookTemplateVersions)
      .set({
        definitionJson: definition as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(systemPlaybookTemplateVersions.id, existingVersion[0].id));
  } else {
    await db.insert(systemPlaybookTemplateVersions).values({
      templateId,
      version: 1,
      definitionJson: definition as unknown as Record<string, unknown>,
      status: 'published',
    });
    console.log(`[seed] Created template version 1 for '${TEMPLATE_SLUG}'`);
  }

  console.log('[seed] Portfolio health playbook seeded successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
