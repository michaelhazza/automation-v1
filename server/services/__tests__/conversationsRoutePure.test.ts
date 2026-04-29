/**
 * conversationsRoutePure.test.ts — predicate matrix for selectConversationFollowUpAction.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/conversationsRoutePure.test.ts
 */

import { expect, test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  selectConversationFollowUpAction,
  buildConversationFollowUpResponseExtras,
} from '../conversationsRoutePure.js';

test('selectConversationFollowUpAction predicate matrix', () => {
  assert.strictEqual(selectConversationFollowUpAction({ scopeType: 'brief' }), 'brief_followup');
  assert.strictEqual(selectConversationFollowUpAction({ scopeType: 'task' }), 'noop');
  assert.strictEqual(selectConversationFollowUpAction({ scopeType: 'agent_run' }), 'noop');
  assert.strictEqual(selectConversationFollowUpAction({ scopeType: 'agent' }), 'noop');
  assert.strictEqual(selectConversationFollowUpAction({ scopeType: null }), 'noop');
  assert.strictEqual(selectConversationFollowUpAction({ scopeType: undefined }), 'noop');
  assert.strictEqual(selectConversationFollowUpAction(null), 'noop');
  assert.strictEqual(selectConversationFollowUpAction(undefined), 'noop');
});

test('buildConversationFollowUpResponseExtras — noop branch', () => {
  const extras = buildConversationFollowUpResponseExtras(null);
  assert.ok('route' in extras);
  assert.ok('fastPathDecision' in extras);
  assert.strictEqual(extras.route, null);
  assert.strictEqual(extras.fastPathDecision, null);
  const json = JSON.parse(JSON.stringify(extras));
  assert.strictEqual(json.route, null);
  assert.strictEqual(json.fastPathDecision, null);
  assert.ok('route' in json);
  assert.ok('fastPathDecision' in json);
});

test('buildConversationFollowUpResponseExtras — brief branch', () => {
  const fastPathDecision = { route: 'simple_reply', confidence: 0.92, reasonCode: 'low_complexity' };
  const extras = buildConversationFollowUpResponseExtras({ route: 'simple_reply', fastPathDecision });
  assert.strictEqual(extras.route, 'simple_reply');
  assert.deepStrictEqual(extras.fastPathDecision, fastPathDecision);
  assert.notStrictEqual(extras.route, null);
  assert.notStrictEqual(extras.fastPathDecision, null);
});
