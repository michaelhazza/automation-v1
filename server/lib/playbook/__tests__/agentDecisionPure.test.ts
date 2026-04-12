/**
 * Unit tests for agentDecisionPure.ts — the decision step pure helpers.
 *
 * Runnable via:
 *   npx tsx server/lib/playbook/__tests__/agentDecisionPure.test.ts
 *
 * No test framework. Each test prints PASS/FAIL and the script exits
 * non-zero on any failure. Follows the same pattern as playbook.test.ts.
 *
 * Spec: docs/playbook-agent-decision-step-spec.md §12, §14, §24.
 */

import {
  computeSkipSet,
  computeStepReadiness,
  parseDecisionOutput,
  validateDecisionStep,
  renderBranchesTable,
} from '../agentDecisionPure.js';
import type {
  StepRunStatus,
  DecisionParseErrorCode,
} from '../agentDecisionPure.js';
import type { PlaybookDefinition, AgentDecisionStep } from '../types.js';

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

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function assertThrows(fn: () => void, matcher: string | RegExp, label: string) {
  let threw = false;
  let msg = '';
  try { fn(); } catch (err) { threw = true; msg = err instanceof Error ? err.message : String(err); }
  if (!threw) throw new Error(`${label}: expected to throw`);
  if (matcher instanceof RegExp) {
    if (!matcher.test(msg)) throw new Error(`${label}: message '${msg}' did not match ${matcher}`);
  } else {
    if (!msg.includes(matcher)) throw new Error(`${label}: message '${msg}' did not include '${matcher}'`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid PlaybookDefinition with a 2-branch decision step.
 *
 * Topology:
 *   start → decision → [ branch_a_step, branch_b_step ] → merge
 *
 * Branches:
 *   branch_a: entrySteps: ['branch_a_step']
 *   branch_b: entrySteps: ['branch_b_step']
 */
function makeDecisionDef(overrides: {
  extraSteps?: PlaybookDefinition['steps'];
  branches?: AgentDecisionStep['branches'];
  decisionId?: string;
} = {}): PlaybookDefinition {
  const decisionId = overrides.decisionId ?? 'decision';
  const branches = overrides.branches ?? [
    { id: 'branch_a', label: 'Path A', description: 'Take path A', entrySteps: ['branch_a_step'] },
    { id: 'branch_b', label: 'Path B', description: 'Take path B', entrySteps: ['branch_b_step'] },
  ];
  const baseSteps: PlaybookDefinition['steps'] = [
    {
      id: 'start',
      name: 'Start',
      type: 'prompt',
      dependsOn: [],
      sideEffectType: 'none',
      outputSchema: {} as any,
    },
    {
      id: decisionId,
      name: 'Decision',
      type: 'agent_decision',
      dependsOn: ['start'],
      sideEffectType: 'none',
      outputSchema: {} as any,
      decisionPrompt: 'Which path?',
      agentRef: { kind: 'system', slug: 'triage' },
      branches,
    } as unknown as PlaybookDefinition['steps'][0],
    {
      id: 'branch_a_step',
      name: 'Branch A',
      type: 'prompt',
      dependsOn: [decisionId],
      sideEffectType: 'none',
      outputSchema: {} as any,
    },
    {
      id: 'branch_b_step',
      name: 'Branch B',
      type: 'prompt',
      dependsOn: [decisionId],
      sideEffectType: 'none',
      outputSchema: {} as any,
    },
    {
      id: 'merge',
      name: 'Merge',
      type: 'prompt',
      dependsOn: ['branch_a_step', 'branch_b_step'],
      sideEffectType: 'none',
      outputSchema: {} as any,
    },
    ...(overrides.extraSteps ?? []),
  ];

  return {
    slug: 'test',
    name: 'Test',
    description: '',
    version: 1,
    steps: baseSteps,
    initialInputSchema: {} as any,
  };
}

function makeDecisionStep(overrides: Partial<AgentDecisionStep> = {}): AgentDecisionStep {
  return {
    id: 'decision',
    name: 'Decision',
    type: 'agent_decision',
    dependsOn: ['start'],
    sideEffectType: 'none',
    outputSchema: {} as any,
    decisionPrompt: 'Which path?',
    agentRef: { kind: 'system', slug: 'triage' },
    branches: [
      { id: 'branch_a', label: 'Path A', description: 'Take path A', entrySteps: ['branch_a_step'] },
      { id: 'branch_b', label: 'Path B', description: 'Take path B', entrySteps: ['branch_b_step'] },
    ],
    ...overrides,
  } as AgentDecisionStep;
}

// ---------------------------------------------------------------------------
// computeSkipSet — §24.1
// ---------------------------------------------------------------------------

console.log('\n--- computeSkipSet ---');

test('skip_set: choosing branch_a skips branch_b_step but not branch_a_step', () => {
  const def = makeDecisionDef();
  const skipSet = computeSkipSet(def, 'decision', 'branch_a');
  assert(skipSet.has('branch_b_step'), 'branch_b_step must be skipped');
  assert(!skipSet.has('branch_a_step'), 'branch_a_step must NOT be skipped');
});

test('skip_set: choosing branch_b skips branch_a_step but not branch_b_step', () => {
  const def = makeDecisionDef();
  const skipSet = computeSkipSet(def, 'decision', 'branch_b');
  assert(skipSet.has('branch_a_step'), 'branch_a_step must be skipped');
  assert(!skipSet.has('branch_b_step'), 'branch_b_step must NOT be skipped');
});

test('skip_set: decision step itself is never in the skip set', () => {
  const def = makeDecisionDef();
  const skipSet = computeSkipSet(def, 'decision', 'branch_a');
  assert(!skipSet.has('decision'), 'decision step must never be skipped');
});

test('skip_set: convergence step (merge) is NOT skipped when one branch is chosen', () => {
  // merge depends on both branch_a_step and branch_b_step.
  // Choosing branch_a means branch_b_step is skipped but merge has branch_a_step as a live ancestor.
  const def = makeDecisionDef();
  const skipSet = computeSkipSet(def, 'decision', 'branch_a');
  assert(!skipSet.has('merge'), 'merge (convergence) must not be skipped');
});

test('skip_set: downstream of non-chosen branch entry step is also skipped', () => {
  // Add an extra step downstream of branch_b_step.
  const def = makeDecisionDef({
    extraSteps: [
      {
        id: 'branch_b_sub',
        name: 'Branch B sub',
        type: 'prompt',
        dependsOn: ['branch_b_step'],
        sideEffectType: 'none',
        outputSchema: {} as any,
      },
    ],
  });
  const skipSet = computeSkipSet(def, 'decision', 'branch_a');
  assert(skipSet.has('branch_b_step'), 'branch_b_step must be skipped');
  assert(skipSet.has('branch_b_sub'), 'branch_b_sub must be skipped (transitive)');
});

test('skip_set: throws if decision step not found', () => {
  const def = makeDecisionDef();
  assertThrows(
    () => computeSkipSet(def, 'nonexistent', 'branch_a'),
    'not found',
    'should throw for missing decision step'
  );
});

test('skip_set: throws if chosen branch not found', () => {
  const def = makeDecisionDef();
  assertThrows(
    () => computeSkipSet(def, 'decision', 'nonexistent_branch'),
    'not found',
    'should throw for unknown branch'
  );
});

test('skip_set: 3-branch — choosing branch_a skips b and c entry steps', () => {
  const def = makeDecisionDef({
    branches: [
      { id: 'branch_a', label: 'A', description: 'A', entrySteps: ['branch_a_step'] },
      { id: 'branch_b', label: 'B', description: 'B', entrySteps: ['branch_b_step'] },
      { id: 'branch_c', label: 'C', description: 'C', entrySteps: ['branch_c_step'] },
    ],
    extraSteps: [
      {
        id: 'branch_c_step',
        name: 'C',
        type: 'prompt',
        dependsOn: ['decision'],
        sideEffectType: 'none',
        outputSchema: {} as any,
      },
    ],
  });
  const skipSet = computeSkipSet(def, 'decision', 'branch_a');
  assert(skipSet.has('branch_b_step'), 'branch_b_step must be skipped');
  assert(skipSet.has('branch_c_step'), 'branch_c_step must be skipped');
  assert(!skipSet.has('branch_a_step'), 'branch_a_step must not be skipped');
});

// ---------------------------------------------------------------------------
// computeStepReadiness — §24.2
// ---------------------------------------------------------------------------

console.log('\n--- computeStepReadiness ---');

test('readiness: root step (no deps) is always ready', () => {
  const step = { id: 'start', dependsOn: [] } as any;
  const r = computeStepReadiness(step, new Map());
  assertEqual(r, 'ready', 'root step should be ready');
});

test('readiness: all deps completed → ready', () => {
  const step = { id: 'child', dependsOn: ['a', 'b'] } as any;
  const statuses = new Map<string, StepRunStatus>([['a', 'completed'], ['b', 'completed']]);
  assertEqual(computeStepReadiness(step, statuses), 'ready', 'all completed');
});

test('readiness: mix of completed and skipped → ready (at least one completed)', () => {
  const step = { id: 'child', dependsOn: ['a', 'b'] } as any;
  const statuses = new Map<string, StepRunStatus>([['a', 'completed'], ['b', 'skipped']]);
  assertEqual(computeStepReadiness(step, statuses), 'ready', 'mixed completed+skipped');
});

test('readiness: all deps skipped → skipped', () => {
  const step = { id: 'child', dependsOn: ['a', 'b'] } as any;
  const statuses = new Map<string, StepRunStatus>([['a', 'skipped'], ['b', 'skipped']]);
  assertEqual(computeStepReadiness(step, statuses), 'skipped', 'all skipped');
});

test('readiness: one dep running → waiting', () => {
  const step = { id: 'child', dependsOn: ['a', 'b'] } as any;
  const statuses = new Map<string, StepRunStatus>([['a', 'completed'], ['b', 'running']]);
  assertEqual(computeStepReadiness(step, statuses), 'waiting', 'one running');
});

test('readiness: one dep pending → waiting', () => {
  const step = { id: 'child', dependsOn: ['a'] } as any;
  const statuses = new Map<string, StepRunStatus>([['a', 'pending']]);
  assertEqual(computeStepReadiness(step, statuses), 'waiting', 'one pending');
});

test('readiness: dep has no row yet (undefined) → waiting', () => {
  const step = { id: 'child', dependsOn: ['a'] } as any;
  assertEqual(computeStepReadiness(step, new Map()), 'waiting', 'no row');
});

test('readiness: awaiting_input dep → waiting', () => {
  const step = { id: 'child', dependsOn: ['a'] } as any;
  const statuses = new Map<string, StepRunStatus>([['a', 'awaiting_input']]);
  assertEqual(computeStepReadiness(step, statuses), 'waiting', 'awaiting_input');
});

// ---------------------------------------------------------------------------
// parseDecisionOutput — §24.3
// ---------------------------------------------------------------------------

console.log('\n--- parseDecisionOutput ---');

const decisionStep = makeDecisionStep();

test('parse: valid minimal JSON', () => {
  const raw = JSON.stringify({ chosenBranchId: 'branch_a', rationale: 'good reason' });
  const result = parseDecisionOutput(raw, decisionStep);
  assert(result.ok, `expected ok=true, got error: ${!result.ok && result.error.message}`);
  if (result.ok) {
    assertEqual(result.output.chosenBranchId, 'branch_a', 'chosenBranchId');
    assertEqual(result.output.rationale, 'good reason', 'rationale');
  }
});

test('parse: valid JSON with confidence', () => {
  const raw = JSON.stringify({ chosenBranchId: 'branch_b', rationale: 'reasoning', confidence: 0.8 });
  const result = parseDecisionOutput(raw, decisionStep);
  assert(result.ok, 'should succeed with confidence field');
  if (result.ok) assertEqual(result.output.confidence, 0.8, 'confidence');
});

test('parse: strips leading/trailing whitespace', () => {
  const raw = `  \n${JSON.stringify({ chosenBranchId: 'branch_a', rationale: 'ok' })}\n  `;
  assert(parseDecisionOutput(raw, decisionStep).ok, 'whitespace stripped');
});

test('parse: strips json code fence', () => {
  const inner = JSON.stringify({ chosenBranchId: 'branch_a', rationale: 'ok' });
  const raw = `\`\`\`json\n${inner}\n\`\`\``;
  const result = parseDecisionOutput(raw, decisionStep);
  assert(result.ok, `json fence stripped: ${!result.ok && (result as any).error?.message}`);
});

test('parse: strips bare code fence', () => {
  const inner = JSON.stringify({ chosenBranchId: 'branch_a', rationale: 'ok' });
  const raw = `\`\`\`\n${inner}\n\`\`\``;
  assert(parseDecisionOutput(raw, decisionStep).ok, 'bare fence stripped');
});

test('parse: strips leading prose before first brace', () => {
  const inner = JSON.stringify({ chosenBranchId: 'branch_a', rationale: 'ok' });
  const raw = `Sure, here is my decision:\n${inner}`;
  assert(parseDecisionOutput(raw, decisionStep).ok, 'leading prose stripped');
});

test('parse: invalid JSON returns invalid_json error', () => {
  const result = parseDecisionOutput('not json at all', decisionStep);
  assert(!result.ok, 'should fail');
  if (!result.ok) assertEqual(result.error.code, 'invalid_json' as DecisionParseErrorCode, 'error code');
});

test('parse: missing chosenBranchId returns schema_violation', () => {
  const raw = JSON.stringify({ rationale: 'forgot the branch id' });
  const result = parseDecisionOutput(raw, decisionStep);
  assert(!result.ok, 'should fail');
  if (!result.ok) assertEqual(result.error.code, 'schema_violation' as DecisionParseErrorCode, 'error code');
});

test('parse: missing rationale returns schema_violation', () => {
  const raw = JSON.stringify({ chosenBranchId: 'branch_a' });
  const result = parseDecisionOutput(raw, decisionStep);
  assert(!result.ok, 'should fail');
  if (!result.ok) assertEqual(result.error.code, 'schema_violation' as DecisionParseErrorCode, 'error code');
});

test('parse: unknown branch id returns unknown_branch error', () => {
  const raw = JSON.stringify({ chosenBranchId: 'nonexistent', rationale: 'oops' });
  const result = parseDecisionOutput(raw, decisionStep);
  assert(!result.ok, 'should fail');
  if (!result.ok) assertEqual(result.error.code, 'unknown_branch' as DecisionParseErrorCode, 'error code');
});

test('parse: passthrough extra fields are preserved', () => {
  const raw = JSON.stringify({ chosenBranchId: 'branch_a', rationale: 'ok', myExtra: 42 });
  const result = parseDecisionOutput(raw, decisionStep);
  assert(result.ok, 'should succeed');
  if (result.ok) {
    const out = result.output as Record<string, unknown>;
    assertEqual(out.myExtra as any, 42, 'extra field preserved');
  }
});

test('parse: empty string returns invalid_json', () => {
  const result = parseDecisionOutput('', decisionStep);
  assert(!result.ok, 'should fail on empty');
  if (!result.ok) assertEqual(result.error.code, 'invalid_json' as DecisionParseErrorCode, 'code');
});

// ---------------------------------------------------------------------------
// validateDecisionStep — §24.4
// ---------------------------------------------------------------------------

console.log('\n--- validateDecisionStep ---');

function validStep(overrides: Partial<AgentDecisionStep> = {}): AgentDecisionStep {
  return makeDecisionStep(overrides);
}

function assertFailedRule(
  result: import('../types.js').ValidationResult,
  rule: string,
  label: string
) {
  if (result.ok) throw new Error(`${label}: expected validation failure, got ok`);
  if (!result.errors.some((e) => e.rule === rule)) {
    throw new Error(`${label}: expected rule '${rule}', got: ${result.errors.map((e) => e.rule).join(', ')}`);
  }
}

test('validate: valid step passes', () => {
  const def = makeDecisionDef();
  const step = validStep();
  const r = validateDecisionStep(step, def);
  assert(r.ok, `should pass: ${r.ok === false ? r.errors.map((e) => e.rule).join(', ') : ''}`);
});

test('validate: fewer than 2 branches fails decision_branches_too_few', () => {
  const def = makeDecisionDef({ branches: [{ id: 'branch_a', label: 'A', description: 'A', entrySteps: ['branch_a_step'] }] });
  const step = validStep({ branches: [{ id: 'branch_a', label: 'A', description: 'A', entrySteps: ['branch_a_step'] }] });
  assertFailedRule(validateDecisionStep(step, def), 'decision_branches_too_few', '1 branch');
});

test('validate: 0 branches fails decision_branches_too_few', () => {
  const step = validStep({ branches: [] as any });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_branches_too_few', '0 branches');
});

test('validate: more than 8 branches fails decision_branches_too_many', () => {
  const step = validStep({
    branches: Array.from({ length: 9 }, (_, i) => ({
      id: `b${i}`, label: `B${i}`, description: `D${i}`, entrySteps: ['branch_a_step'],
    })),
  });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_branches_too_many', '9 branches');
});

test('validate: duplicate branch ids fails decision_branch_duplicate_id', () => {
  const step = validStep({
    branches: [
      { id: 'branch_a', label: 'A', description: 'A', entrySteps: ['branch_a_step'] },
      { id: 'branch_a', label: 'Dup', description: 'Dup', entrySteps: ['branch_b_step'] },
    ],
  });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_branch_duplicate_id', 'duplicate id');
});

test('validate: sideEffectType not none fails decision_side_effect_not_none', () => {
  const step = validStep({ sideEffectType: 'irreversible' });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_side_effect_not_none', 'side effect');
});

test('validate: entry step not found fails decision_entry_step_not_found', () => {
  const step = validStep({
    branches: [
      { id: 'branch_a', label: 'A', description: 'A', entrySteps: ['nonexistent_step'] },
      { id: 'branch_b', label: 'B', description: 'B', entrySteps: ['branch_b_step'] },
    ],
  });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_entry_step_not_found', 'entry step not found');
});

test('validate: entry step missing dep fails decision_entry_step_missing_dep', () => {
  // branch_a_step depends on 'start', not 'decision'
  const def: PlaybookDefinition = {
    ...makeDecisionDef(),
    steps: makeDecisionDef().steps.map((s) =>
      s.id === 'branch_a_step' ? { ...s, dependsOn: ['start'] } : s
    ),
  };
  const step = validStep();
  assertFailedRule(validateDecisionStep(step, def), 'decision_entry_step_missing_dep', 'missing dep');
});

test('validate: entry step collision fails decision_branch_entry_collision', () => {
  const step = validStep({
    branches: [
      { id: 'branch_a', label: 'A', description: 'A', entrySteps: ['branch_a_step'] },
      { id: 'branch_b', label: 'B', description: 'B', entrySteps: ['branch_a_step'] }, // collision
    ],
  });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_branch_entry_collision', 'entry collision');
});

test('validate: invalid defaultBranchId fails decision_default_branch_invalid', () => {
  const step = validStep({ defaultBranchId: 'no_such_branch' });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_default_branch_invalid', 'bad default');
});

test('validate: valid defaultBranchId passes', () => {
  const step = validStep({ defaultBranchId: 'branch_a' });
  const r = validateDecisionStep(step, makeDecisionDef());
  assert(r.ok, `valid defaultBranchId should pass: ${r.ok === false ? r.errors.map((e) => e.rule).join(', ') : ''}`);
});

test('validate: minConfidence out of range (negative) fails decision_min_confidence_out_of_range', () => {
  const step = validStep({ minConfidence: -0.1 });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_min_confidence_out_of_range', 'min confidence negative');
});

test('validate: minConfidence out of range (> 1) fails decision_min_confidence_out_of_range', () => {
  const step = validStep({ minConfidence: 1.5 });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_min_confidence_out_of_range', 'min confidence > 1');
});

test('validate: minConfidence = 0 is valid', () => {
  const step = validStep({ minConfidence: 0 });
  assert(validateDecisionStep(step, makeDecisionDef()).ok, 'minConfidence=0 is valid');
});

test('validate: minConfidence = 1 is valid', () => {
  const step = validStep({ minConfidence: 1 });
  assert(validateDecisionStep(step, makeDecisionDef()).ok, 'minConfidence=1 is valid');
});

test('validate: empty entrySteps fails decision_branch_no_entry_steps', () => {
  const step = validStep({
    branches: [
      { id: 'branch_a', label: 'A', description: 'A', entrySteps: [] },
      { id: 'branch_b', label: 'B', description: 'B', entrySteps: ['branch_b_step'] },
    ],
  });
  assertFailedRule(validateDecisionStep(step, makeDecisionDef()), 'decision_branch_no_entry_steps', 'empty entrySteps');
});

// ---------------------------------------------------------------------------
// renderBranchesTable — §24.5
// ---------------------------------------------------------------------------

console.log('\n--- renderBranchesTable ---');

test('renderBranchesTable: outputs branch ids and labels', () => {
  const branches = [
    { id: 'branch_a', label: 'Path A', description: 'Take path A', entrySteps: ['a_step'] },
    { id: 'branch_b', label: 'Path B', description: 'Take path B', entrySteps: ['b_step'] },
  ];
  const table = renderBranchesTable(branches);
  assert(table.includes('branch_a'), 'contains branch_a id');
  assert(table.includes('branch_b'), 'contains branch_b id');
  assert(table.includes('Path A'), 'contains label A');
  assert(table.includes('Take path A'), 'contains description A');
});

test('renderBranchesTable: escapes triple backticks in description', () => {
  const branches = [
    { id: 'b', label: 'L', description: 'Has ```code``` here', entrySteps: ['s'] },
    { id: 'c', label: 'M', description: 'Normal', entrySteps: ['t'] },
  ];
  const table = renderBranchesTable(branches);
  assert(!table.includes('```code```'), 'raw triple backtick must be escaped');
});

test('renderBranchesTable: each branch separated with blank line', () => {
  const branches = [
    { id: 'a', label: 'A', description: 'Desc A', entrySteps: ['sa'] },
    { id: 'b', label: 'B', description: 'Desc B', entrySteps: ['sb'] },
    { id: 'c', label: 'C', description: 'Desc C', entrySteps: ['sc'] },
  ];
  const table = renderBranchesTable(branches);
  // Should have two blank-line separators for 3 branches
  const doubleLf = (table.match(/\n\n/g) ?? []).length;
  assert(doubleLf >= 2, `expected at least 2 blank-line separators, got ${doubleLf}`);
});

test('renderBranchesTable: single branch renders without separator', () => {
  const branches = [{ id: 'only', label: 'Only', description: 'The one', entrySteps: ['s'] }];
  const table = renderBranchesTable(branches);
  assert(table.includes('only'), 'id present');
  assert(table.includes('The one'), 'description present');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
