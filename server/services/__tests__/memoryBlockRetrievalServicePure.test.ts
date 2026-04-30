/**
 * Pure-function tests for the memory_block precedence algorithm.
 * Run via: npx tsx server/services/__tests__/memoryBlockRetrievalServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  rankByPrecedencePure,
  deriveRuleStatus,
} from '../memoryBlockRetrievalServicePure.js';
import type { MemoryBlockRow, MemoryBlockRetrievalInput } from '../memoryBlockRetrievalServicePure.js';

const now = new Date('2026-04-22T12:00:00Z');
const older = new Date('2026-04-20T12:00:00Z');

const ORG_ID = 'org-1';
const SUB_ID = 'sub-1';
const AGENT_ID = 'agent-1';

function makeRow(overrides: Partial<MemoryBlockRow> & { id: string }): MemoryBlockRow {
  return {
    organisationId: ORG_ID,
    subaccountId: null,
    ownerAgentId: null,
    content: 'Rule text',
    isAuthoritative: false,
    priority: 'medium',
    pausedAt: null,
    deprecatedAt: null,
    createdAt: now,
    ...overrides,
  };
}

test('deriveRuleStatus returns active for clean row', () => {
  const row = makeRow({ id: 'r1' });
  expect(deriveRuleStatus(row)).toBe('active');
});

test('deriveRuleStatus returns paused when pausedAt set', () => {
  const row = makeRow({ id: 'r1', pausedAt: now });
  expect(deriveRuleStatus(row)).toBe('paused');
});

test('deriveRuleStatus returns deprecated when deprecatedAt set', () => {
  const row = makeRow({ id: 'r1', deprecatedAt: now });
  expect(deriveRuleStatus(row)).toBe('deprecated');
});

test('excludes paused rows', () => {
  const active = makeRow({ id: 'active' });
  const paused = makeRow({ id: 'paused', pausedAt: now });
  const input: MemoryBlockRetrievalInput = {
    organisationId: ORG_ID,
    candidates: [active, paused],
  };
  const result = rankByPrecedencePure(input);
  expect(result.length).toBe(1);
  expect(result[0].id).toBe('active');
});

test('excludes deprecated rows', () => {
  const active = makeRow({ id: 'active' });
  const deprecated = makeRow({ id: 'deprecated', deprecatedAt: now });
  const input: MemoryBlockRetrievalInput = {
    organisationId: ORG_ID,
    candidates: [active, deprecated],
  };
  const result = rankByPrecedencePure(input);
  expect(result.length).toBe(1);
  expect(result[0].id).toBe('active');
});

test('authoritative tier wins over non-authoritative', () => {
  const normal = makeRow({ id: 'normal', priority: 'high' });
  const auth = makeRow({ id: 'auth', isAuthoritative: true, priority: 'low' });
  const input: MemoryBlockRetrievalInput = {
    organisationId: ORG_ID,
    candidates: [normal, auth],
  };
  const result = rankByPrecedencePure(input);
  expect(result[0].id).toBe('auth');
});

test('subaccount scope outranks org scope within same priority', () => {
  const org = makeRow({ id: 'org' });
  const sub = makeRow({ id: 'sub', subaccountId: SUB_ID });
  const input: MemoryBlockRetrievalInput = {
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    candidates: [org, sub],
  };
  const result = rankByPrecedencePure(input);
  expect(result[0].id).toBe('sub');
});

test('high priority outranks medium within same scope', () => {
  const medium = makeRow({ id: 'medium', priority: 'medium' });
  const high = makeRow({ id: 'high', priority: 'high' });
  const input: MemoryBlockRetrievalInput = {
    organisationId: ORG_ID,
    candidates: [medium, high],
  };
  const result = rankByPrecedencePure(input);
  expect(result[0].id).toBe('high');
});

test('recency wins as final tiebreaker', () => {
  const old = makeRow({ id: 'old', createdAt: older });
  const recent = makeRow({ id: 'recent', createdAt: now });
  const input: MemoryBlockRetrievalInput = {
    organisationId: ORG_ID,
    candidates: [old, recent],
  };
  const result = rankByPrecedencePure(input);
  expect(result[0].id).toBe('recent');
});

test('empty candidates returns empty result', () => {
  const result = rankByPrecedencePure({ organisationId: ORG_ID, candidates: [] });
  expect(result.length).toBe(0);
});
