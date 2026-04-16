/**
 * scripts/seedConfigAgentGuidelines.ts
 *
 * Seeds the Configuration Assistant runtime guidelines memory block for every
 * organisation that has the Configuration Assistant agent activated.
 *
 * Behaviour (idempotent — safe to re-run):
 *   - Reads the canonical text from docs/agents/config-agent-guidelines.md.
 *   - For each org with a 'configuration-assistant' agent AND an org subaccount:
 *       1. If the block does not exist: INSERT block + INSERT attachment.
 *       2. If the block exists but is not attached: INSERT attachment only.
 *       3. If the block exists and is attached:
 *            - Same content  → no-op (debug log).
 *            - Diff content  → warn (runtime edits are preserved; no overwrite).
 *   - Never overwrites an existing block's content — that is an intentional
 *     design decision so runtime edits survive redeploys.
 *
 * To force-resync runtime content to canonical, update the block via the
 * Knowledge page in the UI, or directly in the DB. A `--force-resync` flag
 * will be added alongside the governance UI in the memory & briefings spec.
 *
 * Usage (standalone):
 *   npx tsx scripts/seedConfigAgentGuidelines.ts
 *
 * Also called by scripts/seed.ts (Phase 6) using a shared db instance.
 *
 * Spec: docs/config-agent-guidelines-spec.md §3.4
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { eq, and, isNull } from 'drizzle-orm';
import {
  agents,
  memoryBlocks,
  memoryBlockAttachments,
  subaccounts,
} from '../server/db/schema/index.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { decideSeederAction } from './lib/seedConfigAgentGuidelinesPure.js';
export { decideSeederAction } from './lib/seedConfigAgentGuidelinesPure.js';
export type { SeederDecision } from './lib/seedConfigAgentGuidelinesPure.js';

const CONFIG_ASSISTANT_SLUG = 'configuration-assistant';
const BLOCK_NAME = 'config-agent-guidelines';
const CANONICAL_PATH = resolve(process.cwd(), 'docs/agents/config-agent-guidelines.md');

// ─── Core seeder logic ────────────────────────────────────────────────────────

export async function seedConfigAgentGuidelinesForOrg(
  db: NodePgDatabase,
  orgId: string,
  canonicalContent: string,
  log: (msg: string) => void,
): Promise<void> {
  // 1. Find the org subaccount (where Configuration Assistant runs)
  const [orgSubaccount] = await db
    .select({ id: subaccounts.id })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.organisationId, orgId),
        eq(subaccounts.isOrgSubaccount, true),
        isNull(subaccounts.deletedAt),
      ),
    );

  if (!orgSubaccount) {
    log(`  [skip] org ${orgId}: no org subaccount found`);
    return;
  }

  // 2. Find the Configuration Assistant agent for this org
  const [configAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.organisationId, orgId),
        eq(agents.slug, CONFIG_ASSISTANT_SLUG),
        isNull(agents.deletedAt),
      ),
    );

  if (!configAgent) {
    log(`  [skip] org ${orgId}: no ${CONFIG_ASSISTANT_SLUG} agent found`);
    return;
  }

  // 3. Check for existing block
  const [existingBlock] = await db
    .select({ id: memoryBlocks.id, content: memoryBlocks.content })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, orgId),
        eq(memoryBlocks.subaccountId, orgSubaccount.id),
        eq(memoryBlocks.name, BLOCK_NAME),
        isNull(memoryBlocks.deletedAt),
      ),
    );

  // 4. Check for existing attachment (only relevant if block exists)
  let attachmentExists = false;
  if (existingBlock) {
    const [existingAttachment] = await db
      .select({ id: memoryBlockAttachments.id })
      .from(memoryBlockAttachments)
      .where(
        and(
          eq(memoryBlockAttachments.blockId, existingBlock.id),
          eq(memoryBlockAttachments.agentId, configAgent.id),
          isNull(memoryBlockAttachments.deletedAt),
        ),
      );
    attachmentExists = !!existingAttachment;
  }

  const contentMatches = existingBlock?.content === canonicalContent;
  const decision = decideSeederAction({
    blockExists: !!existingBlock,
    attachmentExists,
    contentMatches,
  });

  switch (decision.kind) {
    case 'create': {
      const [created] = await db
        .insert(memoryBlocks)
        .values({
          organisationId: orgId,
          subaccountId: orgSubaccount.id,
          name: BLOCK_NAME,
          content: canonicalContent,
          ownerAgentId: configAgent.id,
          isReadOnly: true,
          autoAttach: false,
          confidence: 'normal',
        })
        .returning({ id: memoryBlocks.id });

      await db.insert(memoryBlockAttachments).values({
        blockId: created.id,
        agentId: configAgent.id,
        permission: 'read',
        source: 'manual',
      });

      log(`  [create] org ${orgId}: block seeded and attached (block_id=${created.id}, agent_id=${configAgent.id})`);
      break;
    }

    case 'reattach': {
      await db.insert(memoryBlockAttachments).values({
        blockId: existingBlock!.id,
        agentId: configAgent.id,
        permission: 'read',
        source: 'manual',
      }).onConflictDoUpdate({
        target: [memoryBlockAttachments.blockId, memoryBlockAttachments.agentId],
        set: { permission: 'read', source: 'manual', deletedAt: null },
      });
      log(`  [reattach] org ${orgId}: attachment restored (block_id=${existingBlock!.id}, agent_id=${configAgent.id})`);
      break;
    }

    case 'warn_divergence': {
      log(`  [warn] org ${orgId}: runtime content diverges from canonical — no overwrite (block_id=${existingBlock!.id})`);
      break;
    }

    case 'noop': {
      log(`  [noop] org ${orgId}: already seeded and up to date`);
      break;
    }
  }
}

export async function seedConfigAgentGuidelinesAll(
  db: NodePgDatabase,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const canonicalContent = readFileSync(CANONICAL_PATH, 'utf8');

  // Find all orgs with the Configuration Assistant activated
  const orgsWithConfigAgent = await db
    .select({ organisationId: agents.organisationId })
    .from(agents)
    .where(
      and(
        eq(agents.slug, CONFIG_ASSISTANT_SLUG),
        isNull(agents.deletedAt),
      ),
    );

  if (orgsWithConfigAgent.length === 0) {
    log('  [skip] no orgs with configuration-assistant agent found — is the DB seeded?');
    return;
  }

  log(`  Found ${orgsWithConfigAgent.length} org(s) with Configuration Assistant`);

  for (const { organisationId } of orgsWithConfigAgent) {
    await seedConfigAgentGuidelinesForOrg(db, organisationId, canonicalContent, log);
  }
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  await import('dotenv/config');
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('\n▸ Seed: Configuration Assistant guidelines memory block');
  console.log('  ' + '─'.repeat(52));

  seedConfigAgentGuidelinesAll(db)
    .then(() => {
      console.log('\n✓ Done.');
    })
    .catch((err) => {
      console.error('\n✗ Failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
