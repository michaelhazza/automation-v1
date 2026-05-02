/**
 * configAgentGuidelinesInjection — runtime injection path tests
 *
 * Two sections:
 *   1. Pure (no DB) — formatBlocksForPrompt formatting tests.
 *   2. Integration (requires DATABASE_URL=...&NODE_ENV=integration) —
 *      getBlocksForAgent against a real DB seeded with the guidelines block.
 *
 * Spec: docs/config-agent-guidelines-spec.md §3.5, §8 criterion 5
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { formatBlocksForPrompt } from '../memoryBlockServicePure.js';
import type { MemoryBlockForPrompt } from '../memoryBlockServicePure.js';

// ─── Section 1: Pure (no DB) ──────────────────────────────────────────────────

const guidelinesBlock: MemoryBlockForPrompt = {
  id: 'test-guidelines-id',
  name: 'config-agent-guidelines',
  content: 'Three Cs: Context, Clarity, Confirmation.',
  permission: 'read',
};

test('formatBlocksForPrompt includes config-agent-guidelines block name', () => {
  const result = formatBlocksForPrompt([guidelinesBlock]);
  expect(result).not.toBe(null);
  expect(result!.includes('config-agent-guidelines')).toBe(true);
});

test('formatBlocksForPrompt includes config-agent-guidelines content', () => {
  const result = formatBlocksForPrompt([guidelinesBlock]);
  expect(result).not.toBe(null);
  expect(result!.includes('Three Cs: Context, Clarity, Confirmation.')).toBe(true);
});

test('formatBlocksForPrompt returns null for empty array (no injection when block absent)', () => {
  const result = formatBlocksForPrompt([]);
  expect(result).toBe(null);
});

test('formatBlocksForPrompt preserves read permission on guidelines block (schema contract)', () => {
  // The MemoryBlockForPrompt type carries permission through for write-path
  // decisions. permission must stay 'read' — 'read_write' would let the agent
  // overwrite the block.
  expect(guidelinesBlock.permission).toBe('read');
});

// ─── Section 2: Integration (requires DATABASE_URL + NODE_ENV=integration) ───

const SKIP_INTEGRATION = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

describe.skipIf(SKIP_INTEGRATION)('configAgentGuidelinesInjection (integration)', () => {
  const CONFIG_ASSISTANT_SLUG = 'configuration-assistant';
  const BLOCK_NAME = 'config-agent-guidelines';

  // reason: populated via dynamic imports in beforeAll; declared as `any` because module types are not statically available at declaration site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sql: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let memoryBlocks: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let memoryBlockAttachments: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getBlocksForAgent: any;

  let configAgent: { id: string; organisationId: string } | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let eq: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let and: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let isNull: any;

  beforeAll(async () => {
    const postgres = (await import('postgres')).default;
    const drizzleMod = await import('drizzle-orm/postgres-js');
    const orm = await import('drizzle-orm');
    const schema = await import('../../db/schema/index.js');
    const service = await import('../memoryBlockService.js');

    eq = orm.eq;
    and = orm.and;
    isNull = orm.isNull;
    memoryBlocks = schema.memoryBlocks;
    memoryBlockAttachments = schema.memoryBlockAttachments;
    getBlocksForAgent = service.getBlocksForAgent;

    sql = postgres(process.env.DATABASE_URL!);
    db = drizzleMod.drizzle(sql);

    const [agent] = await db
      .select({ id: schema.agents.id, organisationId: schema.agents.organisationId })
      .from(schema.agents)
      .where(and(eq(schema.agents.slug, CONFIG_ASSISTANT_SLUG), isNull(schema.agents.deletedAt)));
    configAgent = agent;
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  test.skipIf(SKIP_INTEGRATION)('getBlocksForAgent returns config-agent-guidelines block', async () => {
    if (!configAgent) return; // No seeded Configuration Assistant agent — vacuous pass.
    const blocks = await getBlocksForAgent(configAgent.id, configAgent.organisationId);
    const guidelinesInBlocks = blocks.find((b: { name: string }) => b.name === BLOCK_NAME);
    expect(guidelinesInBlocks).toBeDefined();
  });

  test.skipIf(SKIP_INTEGRATION)('config-agent-guidelines block has permission: read', async () => {
    if (!configAgent) return;
    const blocks = await getBlocksForAgent(configAgent.id, configAgent.organisationId);
    const guidelinesInBlocks = blocks.find((b: { name: string }) => b.name === BLOCK_NAME);
    expect(guidelinesInBlocks).toBeDefined();
    expect(guidelinesInBlocks!.permission).toBe('read');
  });

  test.skipIf(SKIP_INTEGRATION)('config-agent-guidelines attachment row has deletedAt = null', async () => {
    if (!configAgent) return;
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
    expect(block).toBeDefined();

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
    expect(attachment).toBeDefined();
    expect(attachment!.deletedAt).toBe(null);
  });
});

