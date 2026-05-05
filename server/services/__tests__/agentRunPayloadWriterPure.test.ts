import { expect, test } from 'vitest';
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
  expect(out.modifications.length, 'no modifications expected under cap').toBe(0);
  expect(out.redactedFields.length, 'no redactions expected').toBe(0);
  expect(out.totalSizeBytes > 0).toBeTruthy();
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
  expect(serialised.includes('[REDACTED:')).toBeTruthy();
  expect(out.redactedFields.length > 0).toBeTruthy();
  const hit = out.redactedFields.find((r) => r.pattern === 'bearer_token' || r.pattern === 'anthropic_key');
  expect(hit).toBeTruthy();
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
  expect(serialised.includes('[POLICY:args-never-persisted]')).toBeTruthy();
  const mod = out.modifications.find(
    (m) => m.kind === 'tool_policy' && m.toolSlug === 'oauth-exchange',
  );
  expect(mod).toBeTruthy();
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
  expect(out.totalSizeBytes <= 100_000).toBeTruthy();
  const truncs = out.modifications.filter((m) => m.kind === 'truncated');
  expect(truncs.length > 0).toBeTruthy();
  // Greatest-first: the first-truncated field's originalSizeBytes should be
  // the biggest of the candidates.
  const first = truncs[0];
  if (first.kind === 'truncated') {
    expect(first.originalSizeBytes >= 200_000).toBeTruthy();
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
  expect(out.totalSizeBytes <= 100_000).toBeTruthy();
  expect(out.redactedFields.length > 0).toBeTruthy();
  expect(out.modifications.some((m) => m.kind === 'tool_policy' && m.policy === 'args-redacted')).toBeTruthy();
  expect(out.modifications.some((m) => m.kind === 'truncated')).toBeTruthy();
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
  expect(originalMessages[0]).toEqual({ role: 'user', content: 'hi' });
  (out.response as Record<string, unknown>).added = 'x';
  expect((originalResponse as Record<string, unknown>).added).toBe(undefined);
});
