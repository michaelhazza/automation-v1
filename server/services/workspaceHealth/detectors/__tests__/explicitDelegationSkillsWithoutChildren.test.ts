/**
 * explicitDelegationSkillsWithoutChildren.test.ts — pure-function tests for
 * findAgentsWithExplicitDelegationButNoChildren().
 *
 * Runnable via:
 *   npx tsx server/services/workspaceHealth/detectors/__tests__/explicitDelegationSkillsWithoutChildren.test.ts
 */

import { expect, test } from 'vitest';
import {
  findAgentsWithExplicitDelegationButNoChildren,
  type SubaccountAgentDelegationRow,
} from '../explicitDelegationSkillsWithoutChildrenPure.js';

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

function makeRow(
  overrides: Partial<SubaccountAgentDelegationRow> & { id: string },
): SubaccountAgentDelegationRow {
  return {
    agentId: 'agent-' + overrides.id,
    subaccountId: 'sa-1',
    skillSlugs: null,
    hasActiveChildren: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('agent with all three slugs + no children → emits finding', () => {
  const rows = [
    makeRow({
      id: 'saa-1',
      skillSlugs: ['config_list_agents', 'spawn_sub_agents', 'reassign_task'],
      hasActiveChildren: false,
    }),
  ];
  const result = findAgentsWithExplicitDelegationButNoChildren(rows);
  expect(result.length).toBe(1);
  expect(result[0].id === 'saa-1', 'wrong row returned').toBeTruthy();
});

test('agent with children → emits nothing (normal manager)', () => {
  const rows = [
    makeRow({
      id: 'saa-2',
      skillSlugs: ['config_list_agents', 'spawn_sub_agents', 'reassign_task'],
      hasActiveChildren: true,
    }),
  ];
  const result = findAgentsWithExplicitDelegationButNoChildren(rows);
  expect(result.length).toBe(0);
});

test('agent with only one delegation slug attached → emits nothing', () => {
  const rows = [
    makeRow({
      id: 'saa-3',
      skillSlugs: ['spawn_sub_agents'],
      hasActiveChildren: false,
    }),
  ];
  const result = findAgentsWithExplicitDelegationButNoChildren(rows);
  expect(result.length).toBe(0);
});

test('agent with no delegation slugs → emits nothing', () => {
  const rows = [
    makeRow({
      id: 'saa-4',
      skillSlugs: ['some_other_skill'],
      hasActiveChildren: false,
    }),
  ];
  const result = findAgentsWithExplicitDelegationButNoChildren(rows);
  expect(result.length).toBe(0);
});

test('agent with all three derived but none attached → emits nothing (derived-only does NOT trip)', () => {
  // hasActiveChildren: true means the skill resolver would derive the trio
  // for this agent at runtime — but this detector only fires on EXPLICIT
  // attachment via skillSlugs. A manager with children and no explicit
  // delegation-slug attachments must not produce a finding.
  const rows = [
    makeRow({
      id: 'saa-5',
      skillSlugs: [],
      hasActiveChildren: true,
    }),
    makeRow({
      id: 'saa-6',
      skillSlugs: null,
      hasActiveChildren: true,
    }),
  ];
  const result = findAgentsWithExplicitDelegationButNoChildren(rows);
  expect(result.length).toBe(0);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
