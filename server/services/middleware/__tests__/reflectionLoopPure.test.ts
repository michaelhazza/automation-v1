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

import { expect, test } from 'vitest';
import {
  parseVerdict,
  decideReflectionAction,
  type ReflectionDecisionInput,
} from '../reflectionLoopPure.js';

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
  expect(parseVerdict(out), 'verdict mismatch').toBe('APPROVE');
});

test('parses BLOCKED from a canonical review_code output', () => {
  const out = `
## Review summary
The patch leaks a secret.

## Verdict
BLOCKED
`;
  expect(parseVerdict(out), 'verdict mismatch').toBe('BLOCKED');
});

test('returns null for empty string', () => {
  expect(parseVerdict(''), 'expected null for empty').toBe(null);
});

test('returns null when no verdict keyword present', () => {
  expect(parseVerdict('just some text, no verdict here'), 'expected null').toBe(null);
});

test('returns null when verdict word is malformed', () => {
  expect(parseVerdict('Verdict: unknown'), 'expected null').toBe(null);
});

test('is case-insensitive on the verdict keyword', () => {
  expect(parseVerdict('Verdict: approve'), 'lowercase approve').toBe('APPROVE');
  expect(parseVerdict('Verdict: Blocked'), 'mixed case blocked').toBe('BLOCKED');
});

test('handles verdict with trailing punctuation', () => {
  expect(parseVerdict('## Verdict\n**APPROVE**'), 'trailing punctuation').toBe('APPROVE');
});

test('picks the LAST verdict when multiple appear', () => {
  const out = `
First pass: Verdict BLOCKED
Second pass: Verdict APPROVE
`;
  expect(parseVerdict(out), 'expected last verdict to win').toBe('APPROVE');
});

test('ignores non-string input safely', () => {
   
  expect(parseVerdict(undefined as unknown as string), 'undefined').toBe(null);
   
  expect(parseVerdict(null as unknown as string), 'null').toBe(null);
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
  expect(result.action.kind, 'action kind').toBe('continue');
  expect(result.stateDelta.lastReviewCodeVerdict, 'verdict delta').toBe('APPROVE');
  expect(result.stateDelta.reviewCodeIterations, 'count delta').toBe(1);
});

test('review_code BLOCKED with room left → inject_message, count incremented', () => {
  const result = decideReflectionAction(
    base({ toolName: 'review_code', toolResult: '## Verdict\nBLOCKED', reviewCodeIterations: 0 }),
  );
  expect(result.action.kind, 'action kind').toBe('inject_message');
  if (result.action.kind === 'inject_message') {
    expect(result.action.message.includes('1/3'), 'iteration counter in message').toBeTruthy();
    expect(result.action.message.includes('BLOCKED'), 'verdict in message').toBeTruthy();
  }
  expect(result.stateDelta.lastReviewCodeVerdict, 'verdict delta').toBe('BLOCKED');
  expect(result.stateDelta.reviewCodeIterations, 'count delta').toBe(1);
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
  expect(result.action.kind, 'action kind').toBe('escalate_to_review');
  if (result.action.kind === 'escalate_to_review') {
    expect(result.action.reason, 'reason').toBe('reflection_iterations_exhausted');
  }
  expect(result.stateDelta.reviewCodeIterations, 'count delta').toBe(3);
});

test('review_code unparseable → treated as BLOCKED', () => {
  const result = decideReflectionAction(
    base({ toolName: 'review_code', toolResult: 'completely unrelated output' }),
  );
  expect(result.action.kind, 'malformed counts as blocked').toBe('inject_message');
  expect(result.stateDelta.lastReviewCodeVerdict, 'verdict delta').toBe('BLOCKED');
});

test('write_patch without prior APPROVE → inject_message reminder', () => {
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: null }),
  );
  expect(result.action.kind, 'action kind').toBe('inject_message');
  if (result.action.kind === 'inject_message') {
    expect(result.action.message.toLowerCase().includes('review_code'), 'message must mention review_code').toBeTruthy();
    expect(result.action.message.toLowerCase().includes('approve'), 'message must mention APPROVE requirement').toBeTruthy();
  }
  // Do NOT increment iteration counter — the agent has not actually
  // attempted reflection, it skipped it.
  expect(result.stateDelta.reviewCodeIterations, 'counter must not change').toBe(undefined);
});

test('write_patch after BLOCKED verdict → still blocked (reminder)', () => {
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: 'BLOCKED' }),
  );
  expect(result.action.kind, 'action kind').toBe('inject_message');
});

test('write_patch after APPROVE → continue but consumes approval', () => {
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: 'APPROVE' }),
  );
  expect(result.action.kind, 'action kind').toBe('continue');
  expect(result.stateDelta.lastReviewCodeVerdict, 'approval consumed').toBe(null);
});

test('second write_patch after consumed approval → blocked', () => {
  // Simulates the state after the first write_patch consumed the approval
  const result = decideReflectionAction(
    base({ toolName: 'write_patch', lastReviewCodeVerdict: null }),
  );
  expect(result.action.kind, 'must require fresh review').toBe('inject_message');
});

test('create_pr does not require its own approval (follows write_patch)', () => {
  // After write_patch consumes the approval, create_pr must still pass
  // through — it opens a PR for the patch that was just approved.
  const result = decideReflectionAction(
    base({ toolName: 'create_pr', lastReviewCodeVerdict: null }),
  );
  expect(result.action.kind, 'create_pr should pass through').toBe('continue');
});

test('other tools pass through unchanged', () => {
  const result = decideReflectionAction(
    base({ toolName: 'read_file', lastReviewCodeVerdict: null }),
  );
  expect(result.action.kind, 'action kind').toBe('continue');
  expect(result.stateDelta.reviewCodeIterations, 'no state change').toBe(undefined);
  expect(result.stateDelta.lastReviewCodeVerdict, 'no state change').toBe(undefined);
});

// ---------------------------------------------------------------------------
