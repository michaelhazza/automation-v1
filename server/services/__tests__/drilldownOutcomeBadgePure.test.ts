import { expect, test } from 'vitest';
import { deriveOutcomeBadge } from '../drilldownOutcomeBadgePure.js';

test('failed action → failed badge', () => {
  expect(deriveOutcomeBadge({ status: 'failed', actionType: 'crm.send_email' }, null)).toEqual({ kind: 'failed' });
});

test('rejected action → failed badge', () => {
  expect(deriveOutcomeBadge({ status: 'rejected', actionType: 'crm.send_email' }, null)).toEqual({ kind: 'failed' });
});

test('outcome with executionFailed=true → failed badge', () => {
  expect(deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { executionFailed: true, scoreDelta: 5 },
    )).toEqual({ kind: 'failed' });
});

test('proposed action → pending:window_open', () => {
  expect(deriveOutcomeBadge({ status: 'proposed', actionType: 'crm.send_email' }, null)).toEqual({ kind: 'pending', reason: 'window_open' });
});

test('completed notify_operator with no outcome → pending:operator_alert_no_signal', () => {
  expect(deriveOutcomeBadge({ status: 'completed', actionType: 'notify_operator' }, null)).toEqual({ kind: 'pending', reason: 'operator_alert_no_signal' });
});

test('completed action with no outcome → pending:no_snapshot', () => {
  expect(deriveOutcomeBadge({ status: 'completed', actionType: 'crm.send_email' }, null)).toEqual({ kind: 'pending', reason: 'no_snapshot' });
});

test('band improved atRisk → healthy', () => {
  expect(deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'atRisk', bandAfter: 'healthy', scoreDelta: 20 },
    )).toEqual({ kind: 'band_improved', fromBand: 'atRisk', toBand: 'healthy' });
});

test('band worsened watch → atRisk', () => {
  expect(deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'atRisk', scoreDelta: -15 },
    )).toEqual({ kind: 'band_worsened', fromBand: 'watch', toBand: 'atRisk' });
});

test('score improved, same band → score_improved', () => {
  expect(deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'watch', scoreDelta: 5 },
    )).toEqual({ kind: 'score_improved', delta: 5 });
});

test('score worsened, same band → score_worsened', () => {
  expect(deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'watch', scoreDelta: -3 },
    )).toEqual({ kind: 'score_worsened', delta: -3 });
});

test('zero delta, same band → neutral', () => {
  expect(deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'watch', scoreDelta: 0 },
    )).toEqual({ kind: 'neutral' });
});
