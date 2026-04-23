/**
 * explicitDelegationSkillsWithoutChildren.test.ts — pure-function tests for
 * findAgentsWithExplicitDelegationButNoChildren().
 *
 * Runnable via:
 *   npx tsx server/services/workspaceHealth/detectors/__tests__/explicitDelegationSkillsWithoutChildren.test.ts
 */

import {
  findAgentsWithExplicitDelegationButNoChildren,
  type SubaccountAgentDelegationRow,
} from '../explicitDelegationSkillsWithoutChildrenPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

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
  assertEqual(result.length, 1);
  assert(result[0].id === 'saa-1', 'wrong row returned');
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
  assertEqual(result.length, 0);
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
  assertEqual(result.length, 0);
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
  assertEqual(result.length, 0);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`[explicitDelegationSkillsWithoutChildren] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
