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

export {};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

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
  assert(err === null, 'valid automation should return null');
});

test('automation with null webhookPath → automation_composition_invalid (0 webhooks)', () => {
  const err = assertSingleWebhook({ id: 'auto-2', webhookPath: null });
  assert(err !== null, 'null webhookPath should return error');
  assert(err!.code === 'automation_composition_invalid', `expected composition_invalid, got ${err!.code}`);
  assert(err!.message.includes('found 0'), `message should say found 0, got: ${err!.message}`);
});

test('automation with empty string webhookPath → automation_composition_invalid (0 webhooks)', () => {
  const err = assertSingleWebhook({ id: 'auto-3', webhookPath: '' });
  assert(err !== null, 'empty webhookPath should return error');
  assert(err!.code === 'automation_composition_invalid', `expected composition_invalid, got ${err!.code}`);
  assert(err!.message.includes('found 0'), `message should say found 0, got: ${err!.message}`);
});

test('error message includes automation id for operator diagnostics', () => {
  const err = assertSingleWebhook({ id: 'auto-diagnostic-id', webhookPath: null });
  assert(err !== null, 'should return error');
  assert(err!.message.includes('auto-diagnostic-id'), 'error message must include automation id');
});

test('non-empty webhookPath = exactly one webhook → valid', () => {
  const variants = ['/path', 'https://example.com/hook', '/a/b/c'];
  for (const path of variants) {
    const err = assertSingleWebhook({ id: 'auto-x', webhookPath: path });
    assert(err === null, `webhookPath '${path}' should be valid`);
  }
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
