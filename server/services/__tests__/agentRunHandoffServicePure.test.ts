/**
 * agentRunHandoffServicePure.test.ts — Brain Tree OS adoption P1 tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunHandoffServicePure.test.ts
 */

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

function assertEqual(a: unknown, b: unknown, label: string) {
  const aJson = JSON.stringify(a);
  const bJson = JSON.stringify(b);
  if (aJson !== bJson) {
    throw new Error(`${label} — expected ${bJson}, got ${aJson}`);
  }
}

function assertTrue(value: boolean, label: string) {
  if (!value) throw new Error(`${label} — expected truthy, got ${value}`);
}

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
  assertEqual(out.length, 1, 'count');
  assertEqual(out[0].decision, 'deferred the migration to next sprint', 'decision text');
});

test('extractDecisions — I chose X because Y', () => {
  const out = extractDecisions('I chose Postgres because it scales horizontally.');
  assertEqual(out.length, 1, 'count');
  assertEqual(out[0].decision, 'Postgres', 'decision text');
  assertEqual(out[0].rationale, 'it scales horizontally', 'rationale text');
});

test('extractDecisions — Going with X', () => {
  const out = extractDecisions('Going with the JSONB column approach.');
  assertEqual(out.length, 1, 'count');
  assertEqual(out[0].decision, 'the JSONB column approach', 'decision text');
});

test('extractDecisions — caps at HANDOFF_MAX_DECISIONS', () => {
  const lines = Array.from(
    { length: HANDOFF_MAX_DECISIONS + 5 },
    (_, i) => `Decision: choice ${i}`,
  ).join('\n');
  const out = extractDecisions(lines);
  assertEqual(out.length, HANDOFF_MAX_DECISIONS, 'capped count');
});

test('extractDecisions — empty input returns empty', () => {
  assertEqual(extractDecisions(''), [], 'empty');
});

// ── classifyBlockerSeverity ───────────────────────────────────────────────

test('classifyBlockerSeverity — high severity for scope_violation', () => {
  assertEqual(classifyBlockerSeverity('scope_violation in tool call X'), 'high', 'high');
});

test('classifyBlockerSeverity — high for permission_denied', () => {
  assertEqual(classifyBlockerSeverity('Tool failed: permission_denied'), 'high', 'high');
});

test('classifyBlockerSeverity — medium for budget_exceeded', () => {
  assertEqual(classifyBlockerSeverity('budget_exceeded after 5 tool calls'), 'medium', 'medium');
});

test('classifyBlockerSeverity — medium for timeout', () => {
  assertEqual(classifyBlockerSeverity('timeout after 60s'), 'medium', 'medium');
});

test('classifyBlockerSeverity — low for unknown errors', () => {
  assertEqual(classifyBlockerSeverity('something went wrong'), 'low', 'low');
});

test('classifyBlockerSeverity — low for null', () => {
  assertEqual(classifyBlockerSeverity(null), 'low', 'low');
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

  assertTrue(handoff.accomplishments.includes('Created 3 tasks'), 'has counter line for tasks created');
  assertTrue(handoff.accomplishments.includes('Updated 1 task'), 'has counter line for tasks updated');
  assertEqual(handoff.decisions.length, 1, 'one decision extracted');
  assertEqual(handoff.decisions[0].decision, 'send a follow-up to the GHL team', 'decision text');
  assertEqual(handoff.blockers, [], 'no blockers');
  assertEqual(
    handoff.nextRecommendedAction,
    'Follow up with GHL on the stalled invoices',
    'next action is the open task',
  );
  assertTrue(isValidHandoffV1(handoff), 'shape is valid');
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

  assertEqual(handoff.blockers.length, 1, 'one blocker');
  assertEqual(handoff.blockers[0].severity, 'medium', 'medium severity for budget_exceeded');
  assertTrue(
    handoff.nextRecommendedAction?.startsWith('Resolve blockers:') ?? false,
    'next action starts with Resolve blockers',
  );
  assertTrue(isValidHandoffV1(handoff), 'shape is valid');
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

  assertEqual(handoff.accomplishments, ['Created 5 tasks'], 'only counter line');
  assertEqual(handoff.decisions, [], 'no decisions');
  assertEqual(handoff.blockers, [], 'no blockers');
  assertEqual(handoff.nextRecommendedAction, null, 'null next action');
  assertTrue(isValidHandoffV1(handoff), 'shape is valid');
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

  assertEqual(handoff.keyArtefacts.length, 2, 'deduplicated to 2');
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

  assertTrue(
    handoff.accomplishments.length <= HANDOFF_MAX_ACCOMPLISHMENTS,
    'capped at the max',
  );
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

  assertEqual(handoff.blockers.length, HANDOFF_MAX_BLOCKERS, 'capped at the max');
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

  assertEqual(handoff.blockers[0].severity, 'high', 'high severity');
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

  assertEqual(handoff.blockers.length, 1, 'one synthetic blocker');
  assertEqual(handoff.blockers[0].severity, 'medium', 'medium severity');
});

// ── isValidHandoffV1 — guards ─────────────────────────────────────────────

test('validator — rejects wrong version', () => {
  assertEqual(
    isValidHandoffV1({
      version: 2,
      accomplishments: [],
      decisions: [],
      blockers: [],
      keyArtefacts: [],
      nextRecommendedAction: null,
      generatedAt: '2026-04-11',
      runStatus: 'completed',
      durationMs: null,
    }),
    false,
    'wrong version',
  );
});

test('validator — rejects missing field', () => {
  assertEqual(isValidHandoffV1({ version: 1 }), false, 'missing fields');
});

test('validator — rejects invalid blocker severity', () => {
  assertEqual(
    isValidHandoffV1({
      version: 1,
      accomplishments: [],
      decisions: [],
      blockers: [{ blocker: 'x', severity: 'critical' }],
      keyArtefacts: [],
      nextRecommendedAction: null,
      generatedAt: '2026-04-11',
      runStatus: 'completed',
      durationMs: null,
    }),
    false,
    'invalid severity',
  );
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
