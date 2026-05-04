/**
 * conversationsRoutePure.test.ts — predicate matrix for selectConversationFollowUpAction.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/conversationsRoutePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  selectConversationFollowUpAction,
  buildConversationFollowUpResponseExtras,
} from '../conversationsRoutePure.js';

test('selectConversationFollowUpAction predicate matrix', () => {
  expect(selectConversationFollowUpAction({ scopeType: 'brief' })).toBe('brief_followup');
  expect(selectConversationFollowUpAction({ scopeType: 'task' })).toBe('noop');
  expect(selectConversationFollowUpAction({ scopeType: 'agent_run' })).toBe('noop');
  expect(selectConversationFollowUpAction({ scopeType: 'agent' })).toBe('noop');
  expect(selectConversationFollowUpAction({ scopeType: null })).toBe('noop');
  expect(selectConversationFollowUpAction({ scopeType: undefined })).toBe('noop');
  expect(selectConversationFollowUpAction(null)).toBe('noop');
  expect(selectConversationFollowUpAction(undefined)).toBe('noop');
});

test('buildConversationFollowUpResponseExtras — noop branch', () => {
  const extras = buildConversationFollowUpResponseExtras(null);
  expect('route' in extras).toBeTruthy();
  expect('fastPathDecision' in extras).toBeTruthy();
  expect(extras.route).toBe(null);
  expect(extras.fastPathDecision).toBe(null);
  const json = JSON.parse(JSON.stringify(extras));
  expect(json.route).toBe(null);
  expect(json.fastPathDecision).toBe(null);
  expect('route' in json).toBeTruthy();
  expect('fastPathDecision' in json).toBeTruthy();
});

test('buildConversationFollowUpResponseExtras — brief branch', () => {
  const fastPathDecision = { route: 'simple_reply', confidence: 0.92, reasonCode: 'low_complexity' };
  const extras = buildConversationFollowUpResponseExtras({ route: 'simple_reply', fastPathDecision });
  expect(extras.route).toBe('simple_reply');
  expect(extras.fastPathDecision).toEqual(fastPathDecision);
  expect(extras.route).not.toBe(null);
  expect(extras.fastPathDecision).not.toBe(null);
});
