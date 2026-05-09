/**
 * runtimeCheckBadgePure.test.ts
 *
 * Vitest tests for the client-side runtime-check badge pure helpers.
 * Covers all five state → three badge mappings and tooltip formatting.
 * Spec: tasks/builds/trust-verification-layer/spec.md §6.2, §14.
 */

import { describe, it, expect } from 'vitest';
import { collapseToOperatorBadge, formatBadgeTooltip } from '../runtimeCheckBadgePure.js';
import type { RuntimeCheckState } from '../../../../shared/types/runtimeCheck.js';

describe('collapseToOperatorBadge', () => {
  it('maps pass → pass', () => {
    expect(collapseToOperatorBadge('pass')).toBe('pass');
  });

  it('maps fail → fail', () => {
    expect(collapseToOperatorBadge('fail')).toBe('fail');
  });

  it('maps inconclusive → pending', () => {
    expect(collapseToOperatorBadge('inconclusive')).toBe('pending');
  });

  it('maps pending → pending', () => {
    expect(collapseToOperatorBadge('pending')).toBe('pending');
  });

  it('maps not_applicable → pending', () => {
    expect(collapseToOperatorBadge('not_applicable')).toBe('pending');
  });

  it('covers all five internal states', () => {
    const allStates: RuntimeCheckState[] = ['pass', 'fail', 'inconclusive', 'pending', 'not_applicable'];
    const results = allStates.map(collapseToOperatorBadge);
    expect(results).toEqual(['pass', 'fail', 'pending', 'pending', 'pending']);
  });
});

describe('formatBadgeTooltip', () => {
  it('returns "Check passed" for pass state regardless of reasonText', () => {
    expect(
      formatBadgeTooltip({ state: 'pass', reasonText: 'anything', suggestedFix: null }),
    ).toBe('Check passed');
  });

  it('returns "Check passed" for pass state even with a suggestedFix', () => {
    expect(
      formatBadgeTooltip({ state: 'pass', reasonText: 'HTTP 200', suggestedFix: 'do something' }),
    ).toBe('Check passed');
  });

  it('returns reasonText for fail state without suggestedFix', () => {
    expect(
      formatBadgeTooltip({ state: 'fail', reasonText: 'HTTP 500 is out of range', suggestedFix: null }),
    ).toBe('HTTP 500 is out of range');
  });

  it('appends suggestedFix on a new line for fail state', () => {
    expect(
      formatBadgeTooltip({ state: 'fail', reasonText: 'Row not found', suggestedFix: 'Check the table name' }),
    ).toBe('Row not found\nSuggested fix: Check the table name');
  });

  it('returns reasonText for inconclusive state', () => {
    expect(
      formatBadgeTooltip({ state: 'inconclusive', reasonText: 'Timed out', suggestedFix: null }),
    ).toBe('Timed out');
  });

  it('returns "Check pending" for pending state with empty reasonText', () => {
    expect(
      formatBadgeTooltip({ state: 'pending', reasonText: '', suggestedFix: null }),
    ).toBe('Check pending');
  });

  it('returns reasonText for pending state when reasonText is non-empty', () => {
    expect(
      formatBadgeTooltip({ state: 'pending', reasonText: 'Evaluation queued', suggestedFix: null }),
    ).toBe('Evaluation queued');
  });

  it('returns "Check pending" for not_applicable state with empty reasonText', () => {
    expect(
      formatBadgeTooltip({ state: 'not_applicable', reasonText: '', suggestedFix: null }),
    ).toBe('Check pending');
  });

  it('returns reasonText for not_applicable state when reasonText is non-empty', () => {
    expect(
      formatBadgeTooltip({ state: 'not_applicable', reasonText: 'Skill has no verify config', suggestedFix: null }),
    ).toBe('Skill has no verify config');
  });
});
