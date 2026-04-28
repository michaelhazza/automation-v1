/**
 * conversationsRoutePure.test.ts — predicate matrix for selectConversationFollowUpAction.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/conversationsRoutePure.test.ts
 */

import { strict as assert } from 'node:assert';
import { selectConversationFollowUpAction } from '../conversationsRoutePure.js';

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

console.log('conversationsRoutePure: all predicate matrix assertions passed');
