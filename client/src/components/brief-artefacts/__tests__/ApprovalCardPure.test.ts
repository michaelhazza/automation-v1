/**
 * Pure-function tests for ApprovalCardPure.
 * Run via: npx tsx client/src/components/brief-artefacts/__tests__/ApprovalCardPure.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
  assert.equal(deriveIsDisabled({ executionStatus: 'pending' }, false), false);
});

test('is disabled when superseded', () => {
  assert.equal(deriveIsDisabled({ executionStatus: 'pending' }, true), true);
});

test('is disabled when executionStatus is completed', () => {
  assert.equal(deriveIsDisabled({ executionStatus: 'completed' }, false), true);
});

test('is disabled when executionStatus is running', () => {
  assert.equal(deriveIsDisabled({ executionStatus: 'running' }, false), true);
});

test('is not disabled when executionStatus is failed and not superseded', () => {
  assert.equal(deriveIsDisabled({ executionStatus: 'failed' }, false), false);
});

test('is disabled when both superseded and completed', () => {
  assert.equal(deriveIsDisabled({ executionStatus: 'completed' }, true), true);
});

test('treats undefined isSuperseded as falsy', () => {
  assert.equal(deriveIsDisabled({ executionStatus: 'pending' }), false);
});

// ---------------------------------------------------------------------------
// deriveRiskContainerStyle
// ---------------------------------------------------------------------------

test('returns low risk style for low', () => {
  assert.equal(deriveRiskContainerStyle('low'), RISK_BORDER_STYLES.low);
});

test('returns medium risk style for medium', () => {
  assert.equal(deriveRiskContainerStyle('medium'), RISK_BORDER_STYLES.medium);
});

test('returns high risk style for high', () => {
  assert.equal(deriveRiskContainerStyle('high'), RISK_BORDER_STYLES.high);
});

// ---------------------------------------------------------------------------
// deriveAffectedLabel
// ---------------------------------------------------------------------------

test('returns null for zero affected records', () => {
  assert.equal(deriveAffectedLabel(0), null);
});

test('returns singular label for one record', () => {
  assert.equal(deriveAffectedLabel(1), 'Affects 1 record');
});

test('returns plural label for multiple records', () => {
  assert.equal(deriveAffectedLabel(5), 'Affects 5 records');
});

// ---------------------------------------------------------------------------
// Style maps are complete
// ---------------------------------------------------------------------------

test('RISK_BORDER_STYLES covers all risk levels', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    assert.ok(RISK_BORDER_STYLES[level], `missing border style for ${level}`);
  }
});

test('RISK_BADGE_STYLES covers all risk levels', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    assert.ok(RISK_BADGE_STYLES[level], `missing badge style for ${level}`);
  }
});
