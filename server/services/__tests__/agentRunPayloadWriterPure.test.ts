import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildPayloadRow } from '../agentRunPayloadWriter.js';

// ---------------------------------------------------------------------------
// Pipeline order (spec §4.5): redaction → tool-policy → truncation.
// Every test drives a specific branch of the composed pipeline.
// ---------------------------------------------------------------------------

test('buildPayloadRow: under-cap no-op', () => {
  const out = buildPayloadRow({
    systemPrompt: 'You are an assistant.',
    messages: [{ role: 'user', content: 'hi' }],
    toolDefinitions: [{ name: 'search', input_schema: {} }],
    response: { ok: true },
    maxBytes: 1_000_000,
  });
  assert.equal(out.modifications.length, 0, 'no modifications expected under cap');
  assert.equal(out.redactedFields.length, 0, 'no redactions expected');
  assert.ok(out.totalSizeBytes > 0);
});

test('buildPayloadRow: redaction rewrites a bearer token and records it', () => {
  const out = buildPayloadRow({
    systemPrompt: '',
    messages: [
      {
        role: 'user',
        content: 'Authorization: Bearer sk-ant-AA1122334455667788990011',
      },
    ],
    toolDefinitions: [],
    response: {},
    maxBytes: 1_000_000,
  });
  const serialised = JSON.stringify(out.messages);
  assert.ok(serialised.includes('[REDACTED:'), 'bearer token should be replaced');
  assert.ok(out.redactedFields.length > 0, 'redactedFields must record the hit');
  const hit = out.redactedFields.find((r) => r.pattern === 'bearer_token' || r.pattern === 'anthropic_key');
  assert.ok(hit, 'at least one redaction pattern should match');
});

test('buildPayloadRow: tool-policy args-never-persisted wipes input regardless of size', () => {
  const out = buildPayloadRow({
    systemPrompt: '',
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'oauth-exchange',
            input: { code: 'very-secret-code', clientId: 'xyz' },
          },
        ],
      },
    ],
    toolDefinitions: [{ name: 'oauth-exchange' }],
    response: {},
    toolPolicies: { 'oauth-exchange': 'args-never-persisted' },
    maxBytes: 1_000_000,
  });
  const serialised = JSON.stringify(out.messages);
  assert.ok(
    serialised.includes('[POLICY:args-never-persisted]'),
    'tool-call input should be replaced with policy marker',
  );
  const mod = out.modifications.find(
    (m) => m.kind === 'tool_policy' && m.toolSlug === 'oauth-exchange',
  );
  assert.ok(mod, 'modifications must record the tool-policy substitution');
});

test('buildPayloadRow: oversized payload is truncated greatest-first under cap', () => {
  const bigMessage = 'x'.repeat(500_000);
  const smallerMessage = 'y'.repeat(200_000);
  const out = buildPayloadRow({
    systemPrompt: 'system',
    messages: [
      { role: 'user', content: bigMessage },
      { role: 'assistant', content: smallerMessage },
    ],
    toolDefinitions: [{ name: 'search' }],
    response: { text: 'ok' },
    maxBytes: 100_000,
  });
  assert.ok(
    out.totalSizeBytes <= 100_000,
    `totalSizeBytes ${out.totalSizeBytes} should fit under cap after truncation`,
  );
  const truncs = out.modifications.filter((m) => m.kind === 'truncated');
  assert.ok(truncs.length > 0, 'should have at least one truncation modification');
  // Greatest-first: the first-truncated field's originalSizeBytes should be
  // the biggest of the candidates.
  const first = truncs[0];
  if (first.kind === 'truncated') {
    assert.ok(first.originalSizeBytes >= 200_000);
  }
});

test('buildPayloadRow: redaction + tool-policy + truncation compose correctly', () => {
  // Use a non-redactable filler so truncation still kicks in after redaction.
  const filler = 'x'.repeat(250_000);
  const redactable = 'Bearer abcdefghij1234567890xxxyz';
  const out = buildPayloadRow({
    systemPrompt: '',
    messages: [
      { role: 'user', content: `${filler} token=${redactable}` },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'oauth-exchange', input: { secret: 'x' } },
        ],
      },
    ],
    toolDefinitions: [],
    response: {},
    toolPolicies: { 'oauth-exchange': 'args-redacted' },
    maxBytes: 100_000,
  });
  assert.ok(out.totalSizeBytes <= 100_000);
  assert.ok(out.redactedFields.length > 0, 'bearer should be redacted');
  assert.ok(
    out.modifications.some((m) => m.kind === 'tool_policy' && m.policy === 'args-redacted'),
    'tool-policy args-redacted recorded',
  );
  assert.ok(
    out.modifications.some((m) => m.kind === 'truncated'),
    'truncation recorded',
  );
});

test('buildPayloadRow: returns fresh copies (no mutation of caller inputs)', () => {
  const originalMessages = [{ role: 'user', content: 'hi' }] as unknown[];
  const originalResponse = { ok: true };
  const out = buildPayloadRow({
    systemPrompt: 'sys',
    messages: originalMessages,
    toolDefinitions: [],
    response: originalResponse,
    maxBytes: 1_000_000,
  });
  out.messages[0] = { mutated: true };
  assert.deepEqual(originalMessages[0], { role: 'user', content: 'hi' });
  (out.response as Record<string, unknown>).added = 'x';
  assert.equal((originalResponse as Record<string, unknown>).added, undefined);
});
