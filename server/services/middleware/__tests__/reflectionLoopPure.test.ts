/**
 * reflectionLoopPure unit tests — runnable via:
 *   npx tsx server/services/middleware/__tests__/reflectionLoopPure.test.ts
 *
 * Covers Sprint 3 P2.2 of docs/improvements-roadmap-spec.md. The reflection
 * loop is a postTool guardrail that enforces the "no write_patch without an
 * APPROVE verdict" contract and escalates to HITL after
 * MAX_REFLECTION_ITERATIONS blocked attempts. Both the regex parsing and
 * the state-machine decisions live in reflectionLoopPure.ts so they can be
 * tested without booting the middleware pipeline.
 */

import {
  parseVerdict,
  decideReflectionAction,
  type ReflectionDecisionInput,
} from '../reflectionLoopPure.js';

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

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(label);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// parseVerdict
// ---------------------------------------------------------------------------

console.log('parseVerdict');

test('parses APPROVE from a canonical review_code output', () => {
  const out = `
## Review summary
Everything looks good.

## Verdict
APPROVE
`;
  assertEqual(parseVerdict(out), 'APPROVE', 'verdict mismatch');
});

test('parses BLOCKED from a canonical review_code output', () => {
  const out = `
## Review summary
The patch leaks a secret.

## Verdict
BLOCKED
`;
  assertEqual(parseVerdict(out), 'BLOCKED', 'verdict mismatch');
});

test('returns null for empty string', () => {
  assertEqual(parseVerdict(''), null, 'expected null for empty');
});

test('returns null when no verdict keyword present', () => {
  assertEqual(parseVerdict('just some text, no verdict here'), null, 'expected null');
});

test('returns null when verdict word is malformed', () => {
  assertEqual(parseVerdict('Verdict: unknown'), null, 'expected null');
});

test('is case-insensitive on the verdict keyword', () => {
  assertEqual(parseVerdict('Verdict: approve'), 'APPROVE', 'lowercase approve');
  assertEqual(parseVerdict('Verdict: Blocked'), 'BLOCKED', 'mixed case blocked');
});

test('handles verdict with trailing punctuation', () => {
  assertEqual(parseVerdict('## Verdict\n**APPROVE**'), 'APPROVE', 'trailing punctuation');
});

test('picks the LAST verdict when multiple appear', () => {
  const out = `
First pass: Verdict BLOCKED
Second pass: Verdict APPROVE
`;
  assertEqual(parseVerdict(out), 'APPROVE', 'expected last verdict to win');
});

test('ignores non-string input safely', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertEqual(parseVerdict(undefined as unknown as string), null, 'undefined');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertEqual(parseVerdict(null as unknown as string), null, 'null');
});

// ---------------------------------------------------------------------------
// decideReflectionAction
// ---------------------------------------------------------------------------

console.log('\ndecideReflectionAction');

function base(overrides: Partial<ReflectionDecisionInput> = {}): ReflectionDecisionInput {
  return {
    toolName: 'write_patch',
    toolResult: '',
    reviewCodeIterations: 0,
    lastReviewCodeVerdict: null,
    maxReflectionIterations: 3,
    ...overrides,
  };
}

test('review_code APPROVE → continue, count incremented, verdict recorded', () => {
  const result = decideReflectionAction(
    base({ toolName: 'review_code', toolResult: '## Verdict\nAPPROVE' }),
  );
  assertEqual(result.action.kind, 'continue', 'action kind');
  assertEqual(result.stateDelta.lastReviewCodeVerdict, 'APPROVE', 'verdict delta');
  assertEqual(result.stateDelta.reviewCodeIterations, 1, 'count delta');
});

test('review_code BLOCKED with room left → inject_message, count incremented', () => {
  const result = decideReflectionAction(
    base({ toolName: 'review_code', toolResult: '## Verdict\nBLOCKED', reviewCodeIterations: 0 }),
  );
  assertEqual(result.action.kind, 'inject_message', 'action kind');
  if (result.action.kind === 'inject_message') {
    assert(result.action.message.includes('1/3'), 'iteration counter in message');
    assert(result.action.message.includes('BLOCKED'), 'verdict in message');
  }
  assertEqual(result.stateDelta.lastReviewCodeVerdict, 'BLOCKED', 'verdict delta');
  assertEqual(result.stateDelta.reviewCodeIterations, 1, 'count delta');
});

test('review_code BLOCKED on final iteration → escalate', () => {
  const result = decideReflectionAction(
    base({
      toolName: 'review_code',
      toolResult: '## Verdict\nBLOCKED',
      reviewCodeIterations: 2, // this call will bump to 3, hitting max
      maxReflectionIterations: 3,
    }),
  );
  assertEqual(result.action.kind, 'escalate_to_review', 'action kind');
  if (result.action.kind === 'escalate_to_review') {
    assertEqual(
      result.action.reason,
      'reflection_iterations_exhausted',
      'reason',
    );
  }
  assertEqual(result.stateDelta.reviewCodeIterations, 3, 'count delta');
});

test('review_code unparseable → treated as BLOCKED', () => {
  const result = decideReflectionAction(
    base({ toolName: 'review_code', toolResult: 'completely unrelated output' }),
  );
  assertEqual(result.action.kind, 'inject_message', 'malformed counts as blocked');
  assertEqual(result.stateDelta.lastReviewCodeVerdict, 'BLOCKED', 'verdict delta');
});

test('write_patch without prior APPROVE → inject_message reminder', () => {
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: null }),
  );
  assertEqual(result.action.kind, 'inject_message', 'action kind');
  if (result.action.kind === 'inject_message') {
    assert(
      result.action.message.toLowerCase().includes('review_code'),
      'message must mention review_code',
    );
    assert(
      result.action.message.toLowerCase().includes('approve'),
      'message must mention APPROVE requirement',
    );
  }
  // Do NOT increment iteration counter — the agent has not actually
  // attempted reflection, it skipped it.
  assertEqual(
    result.stateDelta.reviewCodeIterations,
    undefined,
    'counter must not change',
  );
});

test('write_patch after BLOCKED verdict → still blocked (reminder)', () => {
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: 'BLOCKED' }),
  );
  assertEqual(result.action.kind, 'inject_message', 'action kind');
});

test('write_patch after APPROVE → continue but consumes approval', () => {
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: 'APPROVE' }),
  );
  assertEqual(result.action.kind, 'continue', 'action kind');
  assertEqual(result.stateDelta.lastReviewCodeVerdict, null, 'approval consumed');
});

test('second write_patch after consumed approval → blocked', () => {
  // Simulates the state after the first write_patch consumed the approval
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: null }),
  );
  assertEqual(result.action.kind, 'inject_message', 'must require fresh review');
});

test('create_pr does not require its own approval (follows write_patch)', () => {
  // After write_patch consumes the approval, create_pr must still pass
  // through — it opens a PR for the patch that was just approved.
  const result = decideReflectionAction(
    base({ toolName: 'create_pr', lastReviewCodeVerdict: null }),
  );
  assertEqual(result.action.kind, 'continue', 'create_pr should pass through');
});

test('other tools pass through unchanged', () => {
  const result = decideReflectionAction(
    base({ toolName: 'read_file', lastReviewCodeVerdict: null }),
  );
  assertEqual(result.action.kind, 'continue', 'action kind');
  assertEqual(
    result.stateDelta.reviewCodeIterations,
    undefined,
    'no state change',
  );
  assertEqual(
    result.stateDelta.lastReviewCodeVerdict,
    undefined,
    'no state change',
  );
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
