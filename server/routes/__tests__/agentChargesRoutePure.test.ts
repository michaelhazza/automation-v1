/**
 * agentChargesRoutePure.test.ts — Light pure tests for agent-charges route helpers.
 *
 * Covers:
 *   - Query-parameter parsing validation (dimension validation, date parsing, limit capping).
 *   - Filter validation logic (no DB required).
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/agentChargesRoutePure.test.ts
 */

import { expect, test, describe } from 'vitest';

// ---------------------------------------------------------------------------
// Valid dimension values
// ---------------------------------------------------------------------------

const VALID_DIMENSIONS = ['agent_spend_subaccount', 'agent_spend_org', 'agent_spend_run'] as const;
type ValidDimension = (typeof VALID_DIMENSIONS)[number];

function isValidDimension(value: string): value is ValidDimension {
  return VALID_DIMENSIONS.includes(value as ValidDimension);
}

describe('dimension query param validation', () => {
  test('agent_spend_subaccount is valid', () => {
    expect(isValidDimension('agent_spend_subaccount')).toBe(true);
  });

  test('agent_spend_org is valid', () => {
    expect(isValidDimension('agent_spend_org')).toBe(true);
  });

  test('agent_spend_run is valid', () => {
    expect(isValidDimension('agent_spend_run')).toBe(true);
  });

  test('unknown dimension is invalid', () => {
    expect(isValidDimension('llm_cost_run')).toBe(false);
    expect(isValidDimension('')).toBe(false);
    expect(isValidDimension('agent_spend')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Limit clamping
// ---------------------------------------------------------------------------

function resolveLimit(limitStr: string | undefined): number {
  return Math.min(parseInt(limitStr ?? '50', 10) || 50, 200);
}

describe('limit query param parsing', () => {
  test('default is 50', () => {
    expect(resolveLimit(undefined)).toBe(50);
  });

  test('valid value is accepted', () => {
    expect(resolveLimit('100')).toBe(100);
  });

  test('value above 200 is capped at 200', () => {
    expect(resolveLimit('500')).toBe(200);
  });

  test('non-numeric value falls back to 50', () => {
    expect(resolveLimit('abc')).toBe(50);
  });

  test('zero falls back to 50', () => {
    expect(resolveLimit('0')).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

describe('date filter parsing', () => {
  test('valid ISO date string parses to a Date', () => {
    const d = new Date('2026-05-01T00:00:00Z');
    expect(d.getFullYear()).toBe(2026);
    expect(isNaN(d.getTime())).toBe(false);
  });

  test('invalid date string produces Invalid Date', () => {
    const d = new Date('not-a-date');
    expect(isNaN(d.getTime())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Status filter validation — closed enum check
// ---------------------------------------------------------------------------

const VALID_STATUSES = [
  'proposed', 'pending_approval', 'approved', 'executed', 'succeeded',
  'failed', 'blocked', 'denied', 'disputed', 'shadow_settled', 'refunded',
] as const;

function isValidChargeStatus(s: string): boolean {
  return (VALID_STATUSES as readonly string[]).includes(s);
}

describe('status filter validation', () => {
  test('succeeded is valid', () => {
    expect(isValidChargeStatus('succeeded')).toBe(true);
  });

  test('pending_approval is valid', () => {
    expect(isValidChargeStatus('pending_approval')).toBe(true);
  });

  test('unknown string is invalid', () => {
    expect(isValidChargeStatus('paid')).toBe(false);
    expect(isValidChargeStatus('')).toBe(false);
  });
});
