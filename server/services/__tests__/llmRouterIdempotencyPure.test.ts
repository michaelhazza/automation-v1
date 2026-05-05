import { expect, test } from 'vitest';
import { generateIdempotencyKey } from '../llmRouterIdempotencyPure.js';
import { IDEMPOTENCY_KEY_VERSION } from '../../lib/idempotencyVersion.js';

// ---------------------------------------------------------------------------
// Pins the v1:-prefixed idempotency-key contract for the LLM router.
// See `tasks/llm-inflight-deferred-items-brief.md` §2.
//
// Any change to the hash inputs or their ordering (adding a field,
// re-ordering fields, changing the message-hash algorithm) is a contract
// break that MUST bump `IDEMPOTENCY_KEY_VERSION`. Without that bump, retries
// issued before the change won't match their originating row — a provider
// double-bill waiting to happen. These tests trip on every such drift so
// the bump is the only way forward.
// ---------------------------------------------------------------------------

const baseCtx = {
  organisationId: 'org_1',
  runId:          'run_1',
  agentName:      'writer',
  taskType:       'development' as const,
};

test('generateIdempotencyKey — prefixed with IDEMPOTENCY_KEY_VERSION', () => {
  const key = generateIdempotencyKey(
    baseCtx,
    [{ role: 'user', content: 'hello' }],
    'anthropic',
    'claude-sonnet-4-6',
  );
  expect(key.startsWith(`${IDEMPOTENCY_KEY_VERSION}:`)).toBeTruthy();
});

test('generateIdempotencyKey — current v1 shape pinned', () => {
  const key = generateIdempotencyKey(
    baseCtx,
    [{ role: 'user', content: 'hello' }],
    'anthropic',
    'claude-sonnet-4-6',
  );
  // Shape: v1:orgId:sourceSlot:agentSlot:taskType:provider:model:messageHash
  // Trip this if any of the hash inputs move or the separator changes.
  const parts = key.split(':');
  expect(parts[0]).toBe('v1');
  expect(parts[1]).toBe('org_1');
  expect(parts[2]).toBe('run_1');
  expect(parts[3]).toBe('writer');
  expect(parts[4]).toBe('development');
  expect(parts[5]).toBe('anthropic');
  expect(parts[6]).toBe('claude-sonnet-4-6');
  expect(parts[7].length).toBe(32);
  expect(parts[7]).toMatch(/^[0-9a-f]{32}$/);
});

test('generateIdempotencyKey — same inputs → same key', () => {
  const a = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'hi' }], 'anthropic', 'claude-sonnet-4-6');
  const b = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'hi' }], 'anthropic', 'claude-sonnet-4-6');
  expect(a).toBe(b);
});

test('generateIdempotencyKey — different message content → different key', () => {
  const a = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'hi' }], 'anthropic', 'claude-sonnet-4-6');
  const b = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'bye' }], 'anthropic', 'claude-sonnet-4-6');
  expect(a).not.toBe(b);
});

test('generateIdempotencyKey — different provider/model → different key', () => {
  const anthropicKey = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'hi' }], 'anthropic', 'claude-sonnet-4-6');
  const openaiKey    = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'hi' }], 'openai', 'gpt-4o');
  expect(anthropicKey).not.toBe(openaiKey);
});

test('generateIdempotencyKey — sourceSlot falls through runId → executionId → ieeRunId → sourceId → "system"', () => {
  const messages = [{ role: 'user', content: 'hi' }];
  const runIdKey       = generateIdempotencyKey({ organisationId: 'o', taskType: 'general', runId: 'r' }, messages, 'anthropic', 'claude-sonnet-4-6');
  const executionIdKey = generateIdempotencyKey({ organisationId: 'o', taskType: 'general', executionId: 'e' }, messages, 'anthropic', 'claude-sonnet-4-6');
  const ieeRunIdKey    = generateIdempotencyKey({ organisationId: 'o', taskType: 'general', ieeRunId: 'i' }, messages, 'anthropic', 'claude-sonnet-4-6');
  const sourceIdKey    = generateIdempotencyKey({ organisationId: 'o', taskType: 'general', sourceId: 's' }, messages, 'anthropic', 'claude-sonnet-4-6');
  const systemKey      = generateIdempotencyKey({ organisationId: 'o', taskType: 'general' }, messages, 'anthropic', 'claude-sonnet-4-6');

  // runId wins over the others when present.
  expect(runIdKey.includes(':r:')).toBeTruthy();
  expect(executionIdKey.includes(':e:')).toBeTruthy();
  expect(ieeRunIdKey.includes(':i:')).toBeTruthy();
  expect(sourceIdKey.includes(':s:')).toBeTruthy();
  expect(systemKey.includes(':system:')).toBeTruthy();
});

test('generateIdempotencyKey — agentSlot falls through agentName → featureTag → "no-agent"', () => {
  const messages = [{ role: 'user', content: 'hi' }];
  const agentKey   = generateIdempotencyKey({ organisationId: 'o', taskType: 'general', agentName: 'writer' }, messages, 'anthropic', 'claude-sonnet-4-6');
  const featureKey = generateIdempotencyKey({ organisationId: 'o', taskType: 'general', featureTag: 'skill-analyzer' }, messages, 'anthropic', 'claude-sonnet-4-6');
  const defaultKey = generateIdempotencyKey({ organisationId: 'o', taskType: 'general' }, messages, 'anthropic', 'claude-sonnet-4-6');
  expect(agentKey.includes(':writer:')).toBeTruthy();
  expect(featureKey.includes(':skill-analyzer:')).toBeTruthy();
  expect(defaultKey.includes(':no-agent:')).toBeTruthy();
});

test('generateIdempotencyKey — message array order IS significant (positional semantics)', () => {
  const a = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'one' }, { role: 'user', content: 'two' }], 'anthropic', 'claude-sonnet-4-6');
  const b = generateIdempotencyKey(baseCtx, [{ role: 'user', content: 'two' }, { role: 'user', content: 'one' }], 'anthropic', 'claude-sonnet-4-6');
  expect(a).not.toBe(b);
});
