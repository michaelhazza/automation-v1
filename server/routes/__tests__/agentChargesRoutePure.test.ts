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
import {
  isValidAggregateDimension,
  resolveListLimit,
  isValidChargeStatus,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from '../agentChargesRoutePure.js';

describe('dimension query param validation', () => {
  test('agent_spend_subaccount is valid', () => {
    expect(isValidAggregateDimension('agent_spend_subaccount')).toBe(true);
  });

  test('agent_spend_org is valid', () => {
    expect(isValidAggregateDimension('agent_spend_org')).toBe(true);
  });

  test('agent_spend_run is valid', () => {
    expect(isValidAggregateDimension('agent_spend_run')).toBe(true);
  });

  test('unknown dimension is invalid', () => {
    expect(isValidAggregateDimension('llm_cost_run')).toBe(false);
    expect(isValidAggregateDimension('')).toBe(false);
    expect(isValidAggregateDimension('agent_spend')).toBe(false);
  });
});

describe('limit query param parsing', () => {
  test(`default is ${DEFAULT_LIST_LIMIT}`, () => {
    expect(resolveListLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
  });

  test('valid value is accepted', () => {
    expect(resolveListLimit('100')).toBe(100);
  });

  test(`value above ${MAX_LIST_LIMIT} is capped at ${MAX_LIST_LIMIT}`, () => {
    expect(resolveListLimit('500')).toBe(MAX_LIST_LIMIT);
  });

  test(`non-numeric value falls back to ${DEFAULT_LIST_LIMIT}`, () => {
    expect(resolveListLimit('abc')).toBe(DEFAULT_LIST_LIMIT);
  });

  test(`zero falls back to ${DEFAULT_LIST_LIMIT}`, () => {
    expect(resolveListLimit('0')).toBe(DEFAULT_LIST_LIMIT);
  });
});

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
