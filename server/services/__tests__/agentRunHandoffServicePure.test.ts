/**
 * agentRunHandoffServicePure.test.ts — Brain Tree OS adoption P1 tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunHandoffServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  buildHandoff,
  extractDecisions,
  classifyBlockerSeverity,
  isValidHandoffV1,
  HANDOFF_MAX_ACCOMPLISHMENTS,
  HANDOFF_MAX_DECISIONS,
  HANDOFF_MAX_BLOCKERS,
  type BuildHandoffInput,
} from '../agentRunHandoffServicePure.js';

function makeBaseInput(overrides: Partial<BuildHandoffInput> = {}): BuildHandoffInput {
  return {
    run: {
      status: 'completed',
      summary: null,
      errorMessage: null,
      runResultStatus: 'success',
      durationMs: 12345,
      tasksCreated: 0,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
    assistantTexts: [],
    tasksTouched: [],
    deliverables: [],
    memoryBlocks: [],
    hitlItems: [],
    nextOpenTask: null,
    generatedAt: '2026-04-11T05:00:00.000Z',
    ...overrides,
  };
}

console.log('');
console.log('agentRunHandoffServicePure — Brain Tree OS adoption P1');
console.log('');

// ── extractDecisions ──────────────────────────────────────────────────────

test('extractDecisions — Decision: prefix', () => {
  const out = extractDecisions('Decision: deferred the migration to next sprint');
  expect(out.length, 'count').toBe(1);
  expect(out[0].decision, 'decision text').toBe('deferred the migration to next sprint');
});

test('extractDecisions — I chose X because Y', () => {
  const out = extractDecisions('I chose Postgres because it scales horizontally.');
  expect(out.length, 'count').toBe(1);
  expect(out[0].decision, 'decision text').toBe('Postgres');
  expect(out[0].rationale, 'rationale text').toBe('it scales horizontally');
});

test('extractDecisions — Going with X', () => {
  const out = extractDecisions('Going with the JSONB column approach.');
  expect(out.length, 'count').toBe(1);
  expect(out[0].decision, 'decision text').toBe('the JSONB column approach');
});

test('extractDecisions — caps at HANDOFF_MAX_DECISIONS', () => {
  const lines = Array.from(
    { length: HANDOFF_MAX_DECISIONS + 5 },
    (_, i) => `Decision: choice ${i}`,
  ).join('\n');
  const out = extractDecisions(lines);
  expect(out.length, 'capped count').toEqual(HANDOFF_MAX_DECISIONS);
});

test('extractDecisions — empty input returns empty', () => {
  expect(extractDecisions(''), 'empty').toEqual([]);
});

// ── classifyBlockerSeverity ───────────────────────────────────────────────

test('classifyBlockerSeverity — high severity for scope_violation', () => {
  expect(classifyBlockerSeverity('scope_violation in tool call X'), 'high').toBe('high');
});

test('classifyBlockerSeverity — high for permission_denied', () => {
  expect(classifyBlockerSeverity('Tool failed: permission_denied'), 'high').toBe('high');
});

test('classifyBlockerSeverity — medium for budget_exceeded', () => {
  expect(classifyBlockerSeverity('budget_exceeded after 5 tool calls'), 'medium').toBe('medium');
});

test('classifyBlockerSeverity — medium for timeout', () => {
  expect(classifyBlockerSeverity('timeout after 60s'), 'medium').toBe('medium');
});

test('classifyBlockerSeverity — low for unknown errors', () => {
  expect(classifyBlockerSeverity('something went wrong'), 'low').toBe('low');
});

test('classifyBlockerSeverity — low for null', () => {
  expect(classifyBlockerSeverity(null), 'low').toBe('low');
});

// ── buildHandoff — happy path ─────────────────────────────────────────────

test('happy path — counters + summary + open task', () => {
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'completed',
      summary: 'Reviewed 3 emails. Decision: send a follow-up to the GHL team.',
      errorMessage: null,
      runResultStatus: 'success',
      durationMs: 8000,
      tasksCreated: 3,
      tasksUpdated: 1,
      deliverablesCreated: 0,
    },
    assistantTexts: [
      'Decision: send a follow-up to the GHL team.',
    ],
    nextOpenTask: { id: 'task-99', title: 'Follow up with GHL on the stalled invoices' },
  }));

  expect(handoff.accomplishments.includes('Created 3 tasks'), 'has counter line for tasks created').toBe(true);
  expect(handoff.accomplishments.includes('Updated 1 task'), 'has counter line for tasks updated').toBe(true);
  expect(handoff.decisions.length, 'one decision extracted').toBe(1);
  expect(handoff.decisions[0].decision, 'decision text').toBe('send a follow-up to the GHL team');
  expect(handoff.blockers, 'no blockers').toEqual([]);
  expect(handoff.nextRecommendedAction, 'next action is the open task').toBe('Follow up with GHL on the stalled invoices');
  expect(isValidHandoffV1(handoff), 'shape is valid').toBe(true);
});

// ── buildHandoff — failed run ─────────────────────────────────────────────

test('failed run — error message becomes the blocker', () => {
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'failed',
      summary: null,
      errorMessage: 'budget_exceeded after 12 tool calls',
      runResultStatus: 'failed',
      durationMs: 60000,
      tasksCreated: 0,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
  }));

  expect(handoff.blockers.length, 'one blocker').toBe(1);
  expect(handoff.blockers[0].severity, 'medium severity for budget_exceeded').toBe('medium');
  expect(handoff.nextRecommendedAction?.startsWith('Resolve blockers:') ?? false, 'next action starts with Resolve blockers').toBe(true);
  expect(isValidHandoffV1(handoff), 'shape is valid').toBe(true);
});

// ── buildHandoff — counter-only run ───────────────────────────────────────

test('counter-only run — no summary text', () => {
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'completed',
      summary: null,
      errorMessage: null,
      runResultStatus: 'success',
      durationMs: 1000,
      tasksCreated: 5,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
  }));

  expect(handoff.accomplishments, 'only counter line').toEqual(['Created 5 tasks']);
  expect(handoff.decisions, 'no decisions').toEqual([]);
  expect(handoff.blockers, 'no blockers').toEqual([]);
  expect(handoff.nextRecommendedAction, 'null next action').toBe(null);
  expect(isValidHandoffV1(handoff), 'shape is valid').toBe(true);
});

// ── buildHandoff — duplicate artefacts deduplicated ───────────────────────

test('duplicate artefacts — same task in tasksTouched twice is deduped', () => {
  const handoff = buildHandoff(makeBaseInput({
    tasksTouched: [
      { id: 'task-1', title: 'First task' },
      { id: 'task-1', title: 'First task' }, // duplicate
      { id: 'task-2', title: 'Second task' },
    ],
  }));

  expect(handoff.keyArtefacts.length, 'deduplicated to 2').toBe(2);
});

// ── buildHandoff — caps enforced ──────────────────────────────────────────

test('cap enforcement — accomplishments capped at HANDOFF_MAX_ACCOMPLISHMENTS', () => {
  const summary = Array.from(
    { length: HANDOFF_MAX_ACCOMPLISHMENTS + 5 },
    (_, i) => `Created task ${i}.`,
  ).join(' ');
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'completed',
      summary,
      errorMessage: null,
      runResultStatus: 'success',
      durationMs: 1000,
      tasksCreated: 1, // adds one counter line
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
  }));

  expect(handoff.accomplishments.length <= HANDOFF_MAX_ACCOMPLISHMENTS, 'capped at the max').toBe(true);
});

test('cap enforcement — blockers capped at HANDOFF_MAX_BLOCKERS', () => {
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'failed',
      summary: null,
      errorMessage: 'something went wrong',
      runResultStatus: 'failed',
      durationMs: 1000,
      tasksCreated: 0,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
    hitlItems: Array.from({ length: HANDOFF_MAX_BLOCKERS + 3 }, (_, i) => ({
      id: `hitl-${i}`,
      title: `Item ${i}`,
      status: 'pending',
    })),
  }));

  expect(handoff.blockers.length, 'capped at the max').toEqual(HANDOFF_MAX_BLOCKERS);
});

// ── buildHandoff — high-severity error ────────────────────────────────────

test('high-severity error — scope_violation', () => {
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'failed',
      summary: null,
      errorMessage: 'scope_violation: cross-tenant read attempted',
      runResultStatus: 'failed',
      durationMs: 100,
      tasksCreated: 0,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
  }));

  expect(handoff.blockers[0].severity, 'high severity').toBe('high');
});

// ── buildHandoff — partial result with no error ───────────────────────────

test('partial result — no errorMessage but runResultStatus=partial', () => {
  const handoff = buildHandoff(makeBaseInput({
    run: {
      status: 'completed',
      summary: 'Reviewed 2 of 5 emails before timeout.',
      errorMessage: null,
      runResultStatus: 'partial',
      durationMs: 60000,
      tasksCreated: 0,
      tasksUpdated: 0,
      deliverablesCreated: 0,
    },
  }));

  expect(handoff.blockers.length, 'one synthetic blocker').toBe(1);
  expect(handoff.blockers[0].severity, 'medium severity').toBe('medium');
});

// ── isValidHandoffV1 — guards ─────────────────────────────────────────────

test('validator — rejects wrong version', () => {
  expect(isValidHandoffV1({
      version: 2,
      accomplishments: [],
      decisions: [],
      blockers: [],
      keyArtefacts: [],
      nextRecommendedAction: null,
      generatedAt: '2026-04-11',
      runStatus: 'completed',
      durationMs: null,
    }), 'wrong version').toBe(false);
});

test('validator — rejects missing field', () => {
  expect(isValidHandoffV1({ version: 1 }), 'missing fields').toBe(false);
});

test('validator — rejects invalid blocker severity', () => {
  expect(isValidHandoffV1({
      version: 1,
      accomplishments: [],
      decisions: [],
      blockers: [{ blocker: 'x', severity: 'critical' }],
      keyArtefacts: [],
      nextRecommendedAction: null,
      generatedAt: '2026-04-11',
      runStatus: 'completed',
      durationMs: null,
    }), 'invalid severity').toBe(false);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
