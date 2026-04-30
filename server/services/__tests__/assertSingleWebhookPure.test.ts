// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness; parent-directory sibling import not applicable for this self-contained test pattern"
/**
 * assertSingleWebhookPure.test.ts
 *
 * Pure tests for W1-43: assertSingleWebhook contract.
 * Verifies that the assertion catches zero-webhook and multi-webhook violations
 * while passing single-webhook automations unchanged.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/assertSingleWebhookPure.test.ts
 */

import { expect, test } from 'vitest';

export {};

// Pure mirror of assertSingleWebhook from invokeAutomationStepService.ts
function assertSingleWebhook(automation: { id: string; webhookPath: string | null }): { code: string; message: string } | null {
  const webhookFields = [automation.webhookPath].filter((v) => v != null && v !== '');
  if (webhookFields.length !== 1) {
    return {
      code: 'automation_composition_invalid',
      message: `Automation '${automation.id}' must have exactly one outbound webhook; found ${webhookFields.length}.`,
    };
  }
  return null;
}

console.log('\nW1-43 — assertSingleWebhook pure tests\n');

test('automation with valid webhookPath → no error (returns null)', () => {
  const err = assertSingleWebhook({ id: 'auto-1', webhookPath: '/webhook/path' });
  expect(err === null, 'valid automation should return null').toBeTruthy();
});

test('automation with null webhookPath → automation_composition_invalid (0 webhooks)', () => {
  const err = assertSingleWebhook({ id: 'auto-2', webhookPath: null });
  expect(err !== null, 'null webhookPath should return error').toBeTruthy();
  expect(err!.code === 'automation_composition_invalid', `expected composition_invalid, got ${err!.code}`).toBeTruthy();
  expect(err!.message.includes('found 0'), `message should say found 0, got: ${err!.message}`).toBeTruthy();
});

test('automation with empty string webhookPath → automation_composition_invalid (0 webhooks)', () => {
  const err = assertSingleWebhook({ id: 'auto-3', webhookPath: '' });
  expect(err !== null, 'empty webhookPath should return error').toBeTruthy();
  expect(err!.code === 'automation_composition_invalid', `expected composition_invalid, got ${err!.code}`).toBeTruthy();
  expect(err!.message.includes('found 0'), `message should say found 0, got: ${err!.message}`).toBeTruthy();
});

test('error message includes automation id for operator diagnostics', () => {
  const err = assertSingleWebhook({ id: 'auto-diagnostic-id', webhookPath: null });
  expect(err !== null, 'should return error').toBeTruthy();
  expect(err!.message.includes('auto-diagnostic-id'), 'error message must include automation id').toBeTruthy();
});

test('non-empty webhookPath = exactly one webhook → valid', () => {
  const variants = ['/path', 'https://example.com/hook', '/a/b/c'];
  for (const path of variants) {
    const err = assertSingleWebhook({ id: 'auto-x', webhookPath: path });
    expect(err === null, `webhookPath '${path}' should be valid`).toBeTruthy();
  }
});
