import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deriveOutcomeBadge } from '../drilldownOutcomeBadgePure.js';

test('failed action → failed badge', () => {
  assert.deepEqual(
    deriveOutcomeBadge({ status: 'failed', actionType: 'crm.send_email' }, null),
    { kind: 'failed' },
  );
});

test('rejected action → failed badge', () => {
  assert.deepEqual(
    deriveOutcomeBadge({ status: 'rejected', actionType: 'crm.send_email' }, null),
    { kind: 'failed' },
  );
});

test('outcome with executionFailed=true → failed badge', () => {
  assert.deepEqual(
    deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { executionFailed: true, scoreDelta: 5 },
    ),
    { kind: 'failed' },
  );
});

test('proposed action → pending:window_open', () => {
  assert.deepEqual(
    deriveOutcomeBadge({ status: 'proposed', actionType: 'crm.send_email' }, null),
    { kind: 'pending', reason: 'window_open' },
  );
});

test('completed notify_operator with no outcome → pending:operator_alert_no_signal', () => {
  assert.deepEqual(
    deriveOutcomeBadge({ status: 'completed', actionType: 'notify_operator' }, null),
    { kind: 'pending', reason: 'operator_alert_no_signal' },
  );
});

test('completed action with no outcome → pending:no_snapshot', () => {
  assert.deepEqual(
    deriveOutcomeBadge({ status: 'completed', actionType: 'crm.send_email' }, null),
    { kind: 'pending', reason: 'no_snapshot' },
  );
});

test('band improved atRisk → healthy', () => {
  assert.deepEqual(
    deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'atRisk', bandAfter: 'healthy', scoreDelta: 20 },
    ),
    { kind: 'band_improved', fromBand: 'atRisk', toBand: 'healthy' },
  );
});

test('band worsened watch → atRisk', () => {
  assert.deepEqual(
    deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'atRisk', scoreDelta: -15 },
    ),
    { kind: 'band_worsened', fromBand: 'watch', toBand: 'atRisk' },
  );
});

test('score improved, same band → score_improved', () => {
  assert.deepEqual(
    deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'watch', scoreDelta: 5 },
    ),
    { kind: 'score_improved', delta: 5 },
  );
});

test('score worsened, same band → score_worsened', () => {
  assert.deepEqual(
    deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'watch', scoreDelta: -3 },
    ),
    { kind: 'score_worsened', delta: -3 },
  );
});

test('zero delta, same band → neutral', () => {
  assert.deepEqual(
    deriveOutcomeBadge(
      { status: 'completed', actionType: 'crm.send_email' },
      { bandBefore: 'watch', bandAfter: 'watch', scoreDelta: 0 },
    ),
    { kind: 'neutral' },
  );
});
