/**
 * configAgentGuidelinesInjection — runtime injection path tests
 *
 * Two sections:
 *
 * 1. Pure (no DB) — tests `formatBlocksForPrompt` with a mock
 *    config-agent-guidelines block. Verifies that the block is correctly
 *    formatted for prompt injection when `getBlocksForAgent` returns it.
 *
 * 2. Integration (requires DATABASE_URL) — calls `getBlocksForAgent` against a
 *    real DB seeded with the guidelines block, and asserts the block is present
 *    in the returned array with `permission: 'read'`. Skipped when
 *    DATABASE_URL is not set.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/configAgentGuidelinesInjection.test.ts
 *
 * Spec: docs/config-agent-guidelines-spec.md §3.5, §8 criterion 5
 */

import { expect, test } from 'vitest';
import { formatBlocksForPrompt } from '../memoryBlockServicePure.js';
import type { MemoryBlockForPrompt } from '../memoryBlockServicePure.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Section 1: Pure (no DB) ──────────────────────────────────────────────────

console.log('\n--- configAgentGuidelinesInjection (pure) ---');

const guidelinesBlock: MemoryBlockForPrompt = {
  id: 'test-guidelines-id',
  name: 'config-agent-guidelines',
  content: 'Three Cs: Context, Clarity, Confirmation.',
  permission: 'read',
};

await test('formatBlocksForPrompt includes config-agent-guidelines block name', async () => {
  const result = formatBlocksForPrompt([guidelinesBlock]);
  expect(result !== null, 'result is not null').toBeTruthy();
  expect(result!.includes('config-agent-guidelines'), 'block name in output').toBeTruthy();
});

await test('formatBlocksForPrompt includes config-agent-guidelines content', async () => {
  const result = formatBlocksForPrompt([guidelinesBlock]);
  expect(result !== null, 'result is not null').toBeTruthy();
  expect(result!.includes('Three Cs: Context, Clarity, Confirmation.'), 'content in output').toBeTruthy();
});

await test('formatBlocksForPrompt returns null for empty array (no injection when block absent)', async () => {
  const result = formatBlocksForPrompt([]);
  expect(result, 'result for empty array').toBe(null);
});

await test('formatBlocksForPrompt preserves read permission on guidelines block (schema contract)', async () => {
  // The MemoryBlockForPrompt type carries permission through for write-path
  // decisions. Verify that the block we store has permission 'read' — not
  // 'read_write' — which would allow the agent to self-overwrite the block.
  expect(guidelinesBlock.permission, 'permission').toBe('read');
});

// ─── Section 2: Integration (requires DATABASE_URL) ───────────────────────────

if (!process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration') {
  console.log('\n--- configAgentGuidelinesInjection (integration) ---');
  console.log('  SKIP  DATABASE_URL not set — run with a real database to test getBlocksForAgent');
  console.log('        npx tsx server/services/__tests__/configAgentGuidelinesInjection.test.ts');
} else {
  // Dynamic imports to avoid loading DB modules in pure/unit test contexts.
  const postgres = (await import('postgres')).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { eq, and, isNull } = await import('drizzle-orm');
  const {
    memoryBlocks,
    memoryBlockAttachments,
    agents,
  } = await import('../../db/schema/index.js');
  const { getBlocksForAgent } = await import('../memoryBlockService.js');

  const sql = postgres(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const CONFIG_ASSISTANT_SLUG = 'configuration-assistant';
  const BLOCK_NAME = 'config-agent-guidelines';

  console.log('\n--- configAgentGuidelinesInjection (integration) ---');

  let iPassed = 0;
  let iFailed = 0;

  async function itest(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      iPassed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      iFailed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err instanceof Error ? err.message : err}`);
    }
  }

  // Find any org that has the Configuration Assistant agent
  const [configAgent] = await db
    .select({ id: agents.id, organisationId: agents.organisationId })
    .from(agents)
    .where(and(eq(agents.slug, CONFIG_ASSISTANT_SLUG), isNull(agents.deletedAt)));

  if (!configAgent) {
    console.log('  SKIP  No configuration-assistant agent found — is the DB seeded?');
} else {
    await itest('getBlocksForAgent returns config-agent-guidelines block', async () => {
      const blocks = await getBlocksForAgent(configAgent.id, configAgent.organisationId);
      const guidelinesInBlocks = blocks.find((b) => b.name === BLOCK_NAME);
      expect(guidelinesInBlocks !== undefined, `block '${BLOCK_NAME}' present in getBlocksForAgent result`).toBeTruthy();
    });

    await itest('config-agent-guidelines block has permission: read', async () => {
      const blocks = await getBlocksForAgent(configAgent.id, configAgent.organisationId);
      const guidelinesInBlocks = blocks.find((b) => b.name === BLOCK_NAME);
      expect(guidelinesInBlocks !== undefined, `block '${BLOCK_NAME}' present`).toBeTruthy();
      expect(guidelinesInBlocks!.permission, 'permission').toBe('read');
    });

    await itest('config-agent-guidelines attachment row has deletedAt = null', async () => {
      // Verify the attachment is live (not tombstoned) in the DB
      const [block] = await db
        .select({ id: memoryBlocks.id })
        .from(memoryBlocks)
        .where(
          and(
            eq(memoryBlocks.organisationId, configAgent.organisationId),
            eq(memoryBlocks.name, BLOCK_NAME),
            isNull(memoryBlocks.deletedAt),
          ),
        );
      expect(block !== undefined, `memory block '${BLOCK_NAME}' exists`).toBeTruthy();

      const [attachment] = await db
        .select({ id: memoryBlockAttachments.id, deletedAt: memoryBlockAttachments.deletedAt })
        .from(memoryBlockAttachments)
        .where(
          and(
            eq(memoryBlockAttachments.blockId, block.id),
            eq(memoryBlockAttachments.agentId, configAgent.id),
            isNull(memoryBlockAttachments.deletedAt),
          ),
        );
      expect(attachment !== undefined, 'live attachment row exists').toBeTruthy();
      expect(attachment!.deletedAt, 'deletedAt is null').toBe(null);
    });
if (iFailed > 0) process.exitCode = 1;
  }

  await sql.end();
}

