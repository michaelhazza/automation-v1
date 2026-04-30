/**
 * Pure unit tests for suggested actions parsing and dispatch routing.
 * No DB, no network — these only test logic in shared/types/messageSuggestedActions.ts
 * and server/services/suggestedActionDispatchService.ts.
 *
 * Run: npx tsx server/services/__tests__/suggestedActionsPure.test.ts
 */

import assert from 'node:assert/strict';
import { parseSuggestedActions } from '../../../shared/types/messageSuggestedActions.js';
import { dispatchSuggestedAction } from '../suggestedActionDispatchService.js';

const CTX = { conversationId: 'test-conv-id' };

// ── parseSuggestedActions ─────────────────────────────────────────────────────

// 1. Valid array with prompt + system chips
{
  const content = `Here is some response.\n<suggested_actions>\n[{"kind":"prompt","label":"Save template","prompt":"Save as template"},{"kind":"system","label":"Schedule daily","actionKey":"schedule_daily"}]\n</suggested_actions>`;
  const { chips, strippedContent } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 2, 'should parse 2 valid chips');
  assert.equal(chips[0].kind, 'prompt');
  assert.equal(chips[1].kind, 'system');
  assert.ok(!strippedContent.includes('<suggested_actions>'), 'block stripped from content');
  assert.ok(strippedContent.includes('Here is some response.'), 'substantive content preserved');
  console.log('PASS: valid array parses correctly');
}

// 2. Drops unknown actionKey, keeps valid sibling
{
  const content = `Text\n<suggested_actions>\n[{"kind":"system","label":"Bad","actionKey":"unknown_key"},{"kind":"prompt","label":"Good","prompt":"Do something"}]\n</suggested_actions>`;
  const { chips } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 1, 'should keep only valid chip');
  assert.equal(chips[0].kind, 'prompt');
  console.log('PASS: drops unknown actionKey, keeps valid sibling');
}

// 3. Drops malformed entry (missing required field), keeps valid siblings
{
  const content = `Text\n<suggested_actions>\n[{"kind":"prompt","label":""},{"kind":"prompt","label":"Valid","prompt":"Do it"}]\n</suggested_actions>`;
  const { chips } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 1, 'should drop empty label entry');
  assert.equal(chips[0].label, 'Valid');
  console.log('PASS: drops malformed entry, keeps valid siblings');
}

// 4. Empty array
{
  const content = `Text\n<suggested_actions>\n[]\n</suggested_actions>`;
  const { chips, strippedContent } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 0, 'empty array returns no chips');
  assert.ok(!strippedContent.includes('<suggested_actions>'), 'block still stripped');
  console.log('PASS: empty array');
}

// 5. null input (non-string)
{
  const { chips, strippedContent } = parseSuggestedActions(null, CTX);
  assert.equal(chips.length, 0, 'null input returns no chips');
  assert.equal(strippedContent, '', 'null input returns empty string');
  console.log('PASS: null input');
}

// 6. No block in content
{
  const content = 'Just a normal response with no chips.';
  const { chips, strippedContent } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 0, 'no block → no chips');
  assert.equal(strippedContent, content, 'content unchanged when no block');
  console.log('PASS: no block in content');
}

// 7. Max 4 chips enforced
{
  const chips5 = Array.from({ length: 5 }, (_, i) => ({ kind: 'prompt', label: `L${i}`, prompt: `P${i}` }));
  const content = `Text\n<suggested_actions>\n${JSON.stringify(chips5)}\n</suggested_actions>`;
  const { chips } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 4, 'max 4 chips enforced');
  console.log('PASS: max 4 chips enforced');
}

// 8. Malformed JSON block
{
  const content = `Text\n<suggested_actions>\nnot json at all\n</suggested_actions>`;
  const { chips, strippedContent } = parseSuggestedActions(content, CTX);
  assert.equal(chips.length, 0, 'malformed JSON returns no chips');
  assert.ok(!strippedContent.includes('<suggested_actions>'), 'block still stripped on JSON error');
  console.log('PASS: malformed JSON block');
}

// ── dispatchSuggestedAction routing ──────────────────────────────────────────

const DISPATCH_PARAMS = {
  conversationId: 'conv-123',
  agentId: 'agent-456',
  userId: 'user-789',
  organisationId: 'org-abc',
};

// 9. save_thread_as_agent → redirectUrl with conversationId
{
  const result = await dispatchSuggestedAction({ ...DISPATCH_PARAMS, actionKey: 'save_thread_as_agent' });
  assert.equal(result.success, true);
  assert.ok(result.redirectUrl?.includes('/admin/agents/new?fromConversation=conv-123'), `got ${result.redirectUrl}`);
  console.log('PASS: save_thread_as_agent redirectUrl');
}

// 10. schedule_daily → redirectUrl with agentId + tab=scheduling
{
  const result = await dispatchSuggestedAction({ ...DISPATCH_PARAMS, actionKey: 'schedule_daily' });
  assert.equal(result.success, true);
  assert.ok(result.redirectUrl?.includes('/admin/agents/agent-456?tab=scheduling'), `got ${result.redirectUrl}`);
  console.log('PASS: schedule_daily redirectUrl');
}

// 11. pin_skill → redirectUrl with agentId + tab=skills
{
  const result = await dispatchSuggestedAction({ ...DISPATCH_PARAMS, actionKey: 'pin_skill' });
  assert.equal(result.success, true);
  assert.ok(result.redirectUrl?.includes('/admin/agents/agent-456?tab=skills'), `got ${result.redirectUrl}`);
  console.log('PASS: pin_skill redirectUrl');
}

console.log('\nAll tests passed.');
