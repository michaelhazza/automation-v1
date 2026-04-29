/**
 * Pure-function tests for ApprovalCardPure.
 * Run via: npx tsx client/src/components/brief-artefacts/__tests__/ApprovalCardPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  deriveIsDisabled,
  deriveRiskContainerStyle,
  deriveAffectedLabel,
  RISK_BORDER_STYLES,
  RISK_BADGE_STYLES,
} from '../ApprovalCardPure.js';

// ---------------------------------------------------------------------------
// deriveIsDisabled
// ---------------------------------------------------------------------------

test('is not disabled for pending status and not superseded', () => {
  expect(deriveIsDisabled({ executionStatus: 'pending' }, false)).toBe(false);
});

test('is disabled when superseded', () => {
  expect(deriveIsDisabled({ executionStatus: 'pending' }, true)).toBe(true);
});

test('is disabled when executionStatus is completed', () => {
  expect(deriveIsDisabled({ executionStatus: 'completed' }, false)).toBe(true);
});

test('is disabled when executionStatus is running', () => {
  expect(deriveIsDisabled({ executionStatus: 'running' }, false)).toBe(true);
});

test('is not disabled when executionStatus is failed and not superseded', () => {
  expect(deriveIsDisabled({ executionStatus: 'failed' }, false)).toBe(false);
});

test('is disabled when both superseded and completed', () => {
  expect(deriveIsDisabled({ executionStatus: 'completed' }, true)).toBe(true);
});

test('treats undefined isSuperseded as falsy', () => {
  expect(deriveIsDisabled({ executionStatus: 'pending' })).toBe(false);
});

// ---------------------------------------------------------------------------
// deriveRiskContainerStyle
// ---------------------------------------------------------------------------

test('returns low risk style for low', () => {
  expect(deriveRiskContainerStyle('low')).toBe(RISK_BORDER_STYLES.low);
});

test('returns medium risk style for medium', () => {
  expect(deriveRiskContainerStyle('medium')).toBe(RISK_BORDER_STYLES.medium);
});

test('returns high risk style for high', () => {
  expect(deriveRiskContainerStyle('high')).toBe(RISK_BORDER_STYLES.high);
});

// ---------------------------------------------------------------------------
// deriveAffectedLabel
// ---------------------------------------------------------------------------

test('returns null for zero affected records', () => {
  expect(deriveAffectedLabel(0)).toBe(null);
});

test('returns singular label for one record', () => {
  expect(deriveAffectedLabel(1)).toBe('Affects 1 record');
});

test('returns plural label for multiple records', () => {
  expect(deriveAffectedLabel(5)).toBe('Affects 5 records');
});

// ---------------------------------------------------------------------------
// Style maps are complete
// ---------------------------------------------------------------------------

test('RISK_BORDER_STYLES covers all risk levels', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    expect(RISK_BORDER_STYLES[level], `missing border style for ${level}`).toBeTruthy();
  }
});

test('RISK_BADGE_STYLES covers all risk levels', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    expect(RISK_BADGE_STYLES[level], `missing badge style for ${level}`).toBeTruthy();
  }
});
