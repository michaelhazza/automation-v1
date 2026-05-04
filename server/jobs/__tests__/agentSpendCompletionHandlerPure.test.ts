// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * agentSpendCompletionHandlerPure.test.ts
 *
 * Pure-function tests for agentSpendCompletionHandler.
 * Tests decision logic for the three completion branches. Uses stubbed DB
 * query results — no Postgres or pg-boss required.
 *
 * Run via: npx vitest run server/jobs/__tests__/agentSpendCompletionHandlerPure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { decideCompletionAction } from '../agentSpendCompletionHandler.js';

export {};

console.log('\nagentSpendCompletionHandlerPure — pure-function tests\n');

// ---------------------------------------------------------------------------
// decideCompletionAction — merchant_succeeded on still-executed row
// ---------------------------------------------------------------------------

describe('merchant_succeeded on still-executed row', () => {
  test('executed + merchant_succeeded → allowed, action set_provider_charge_id', () => {
    const decision = decideCompletionAction('executed', 'merchant_succeeded');
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.action).toBe('set_provider_charge_id');
    }
  });
});

// ---------------------------------------------------------------------------
// decideCompletionAction — merchant_failed on still-executed row
// ---------------------------------------------------------------------------

describe('merchant_failed on still-executed row', () => {
  test('executed + merchant_failed → allowed, action transition_to_failed', () => {
    const decision = decideCompletionAction('executed', 'merchant_failed');
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.action).toBe('transition_to_failed');
    }
  });
});

// ---------------------------------------------------------------------------
// decideCompletionAction — already-terminal rows (invariant 20)
// ---------------------------------------------------------------------------

describe('already-terminal rows — handler MUST drop silently', () => {
  test('succeeded + merchant_succeeded → not allowed (webhook beat worker)', () => {
    const decision = decideCompletionAction('succeeded', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('succeeded + merchant_failed → not allowed', () => {
    const decision = decideCompletionAction('succeeded', 'merchant_failed');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('failed + merchant_succeeded → not allowed', () => {
    const decision = decideCompletionAction('failed', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('failed + merchant_failed → not allowed', () => {
    const decision = decideCompletionAction('failed', 'merchant_failed');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('blocked + merchant_succeeded → not allowed', () => {
    const decision = decideCompletionAction('blocked', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('denied + merchant_succeeded → not allowed', () => {
    const decision = decideCompletionAction('denied', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('shadow_settled + merchant_succeeded → not allowed', () => {
    const decision = decideCompletionAction('shadow_settled', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('refunded + merchant_succeeded → not allowed', () => {
    const decision = decideCompletionAction('refunded', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });
});

// ---------------------------------------------------------------------------
// Critical invariant 20: handler MUST NOT transition to succeeded
// ---------------------------------------------------------------------------

describe('invariant 20: handler never produces succeeded outcome', () => {
  test('merchant_succeeded maps to set_provider_charge_id, NOT transition_to_succeeded', () => {
    const decision = decideCompletionAction('executed', 'merchant_succeeded');
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.action).not.toBe('transition_to_succeeded');
      expect(decision.action).toBe('set_provider_charge_id');
    }
  });
});

// ---------------------------------------------------------------------------
// Non-executed states (proposed, approved, pending_approval)
// ---------------------------------------------------------------------------

describe('non-executed in-flight states', () => {
  test('proposed row → not allowed', () => {
    const decision = decideCompletionAction('proposed', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('approved row → not allowed', () => {
    const decision = decideCompletionAction('approved', 'merchant_succeeded');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });

  test('pending_approval row → not allowed', () => {
    const decision = decideCompletionAction('pending_approval', 'merchant_failed');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('already_terminal');
    }
  });
});
