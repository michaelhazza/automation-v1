/**
 * conversationsRoutePure.test.ts — predicate matrix for selectConversationFollowUpAction.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/conversationsRoutePure.test.ts
 */

import { strict as assert } from 'node:assert';
import {
  selectConversationFollowUpAction,
  buildConversationFollowUpResponseExtras,
} from '../conversationsRoutePure.js';

// brief scope → brief_followup
assert.strictEqual(
  selectConversationFollowUpAction({ scopeType: 'brief' }),
  'brief_followup',
  'brief → brief_followup',
);

// task scope → noop
assert.strictEqual(
  selectConversationFollowUpAction({ scopeType: 'task' }),
  'noop',
  'task → noop',
);

// agent_run scope → noop
assert.strictEqual(
  selectConversationFollowUpAction({ scopeType: 'agent_run' }),
  'noop',
  'agent_run → noop',
);

// agent scope → noop
assert.strictEqual(
  selectConversationFollowUpAction({ scopeType: 'agent' }),
  'noop',
  'agent → noop',
);

// null scopeType → noop
assert.strictEqual(
  selectConversationFollowUpAction({ scopeType: null }),
  'noop',
  'null scopeType → noop',
);

// undefined scopeType → noop
assert.strictEqual(
  selectConversationFollowUpAction({ scopeType: undefined }),
  'noop',
  'undefined scopeType → noop',
);

// null conv → noop (defensive)
assert.strictEqual(
  selectConversationFollowUpAction(null),
  'noop',
  'null conv → noop',
);

// undefined conv → noop (defensive)
assert.strictEqual(
  selectConversationFollowUpAction(undefined),
  'noop',
  'undefined conv → noop',
);

// ── DR2 response-shape contract — anchors the §0.5 invariant that
//    `route` and `fastPathDecision` are always present, never undefined,
//    never omitted; null on noop, populated on brief.

// noop branch: both keys present, both literal null
{
  const extras = buildConversationFollowUpResponseExtras(null);
  assert.ok('route' in extras, 'noop: route key is present');
  assert.ok('fastPathDecision' in extras, 'noop: fastPathDecision key is present');
  assert.strictEqual(extras.route, null, 'noop: route is literal null');
  assert.strictEqual(extras.fastPathDecision, null, 'noop: fastPathDecision is literal null');
  // JSON serialisation preserves null (not omits it)
  const json = JSON.parse(JSON.stringify(extras));
  assert.strictEqual(json.route, null, 'noop: JSON serialised route stays null');
  assert.strictEqual(json.fastPathDecision, null, 'noop: JSON serialised fastPathDecision stays null');
  assert.ok('route' in json, 'noop: JSON keeps route key');
  assert.ok('fastPathDecision' in json, 'noop: JSON keeps fastPathDecision key');
}

// brief branch: both keys populated with the supplied values
{
  const fastPathDecision = { route: 'simple_reply', confidence: 0.92, reasonCode: 'low_complexity' };
  const extras = buildConversationFollowUpResponseExtras({ route: 'simple_reply', fastPathDecision });
  assert.strictEqual(extras.route, 'simple_reply', 'brief: route populated');
  assert.deepStrictEqual(extras.fastPathDecision, fastPathDecision, 'brief: fastPathDecision passed through');
  assert.notStrictEqual(extras.route, null, 'brief: route is non-null');
  assert.notStrictEqual(extras.fastPathDecision, null, 'brief: fastPathDecision is non-null');
}

console.log('conversationsRoutePure: all predicate matrix + DR2 contract assertions passed');
