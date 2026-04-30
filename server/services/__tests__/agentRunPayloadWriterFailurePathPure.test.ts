/**
 * Pure tests for buildPayloadRow's failure-path semantics (REQ §1.1 Gap D /
 * spec 2026-04-28-pre-test-integration-harness-spec.md §1.5 Option A).
 *
 * Failure-path contract:
 *   - response: null  → row with response: null (no usable provider output).
 *   - response: <partial> → row with response: <same partial>, byte-identical.
 *   - response: <usage-without-content> → tokens reflect provider-reported
 *     usage (NOT zeroed) even though assistant content is empty.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/agentRunPayloadWriterFailurePathPure.test.ts
 */

import { expect, test } from 'vitest';
import { buildPayloadRow } from '../agentRunPayloadWriter.js';

// ─── Case 1: response: null → output's response is null ─────────────────────
test('failure-path: response: null produces output with response === null', () => {
  const out = buildPayloadRow({
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    toolDefinitions: [],
    response: null,
    maxBytes: 1_000_000,
  });
  expect(out.response, 'response field must be null when input is null').toBe(null);
  // System prompt and messages still flow through unchanged.
  expect(out.systemPrompt).toBe('sys');
  expect(out.messages).toStrictEqual([{ role: 'user', content: 'hi' }]);
});

// ─── Case 2: partial response → output's response matches the partial ───────
test('failure-path: partial response is preserved through the pipeline', () => {
  // A streaming-interrupted response: partial assistant content, partial
  // tokens. The pipeline must not strip or mutate the partial — partial
  // observability is the entire reason for persisting failure-path rows.
  const partial: Record<string, unknown> = {
    content: 'The answer is 4',
    tokensIn: 120,
    tokensOut: 5,
    stopReason: 'streaming_interrupted',
    providerRequestId: 'prov-req-abc',
  };
  const out = buildPayloadRow({
    systemPrompt: '',
    messages: [{ role: 'user', content: 'what is 2 + 2' }],
    toolDefinitions: [],
    response: partial,
    maxBytes: 1_000_000,
  });
  expect(out.response).not.toBe(null);
  // The pipeline returns a deep-copy, so a same-reference assertion is wrong;
  // assert structural equality instead.
  expect(out.response).toStrictEqual(partial);
});

// ─── Case 3: round-trip — partial response is byte-identical to persisted ───
test('failure-path: partial response is byte-identical (no silent truncation)', () => {
  // Concretely: when the partial is small (well under maxBytes), the pipeline
  // performs no truncation on the response field, so a JSON round-trip of
  // the input and the output's response must match byte-for-byte.
  const partial: Record<string, unknown> = {
    content: 'partial assistant text',
    tokensIn: 50,
    tokensOut: 10,
    providerRequestId: 'prov-req-deadbeef',
  };
  const out = buildPayloadRow({
    systemPrompt: '',
    messages: [],
    toolDefinitions: [],
    response: partial,
    maxBytes: 1_000_000,
  });
  const inputJson = JSON.stringify(partial);
  const outputJson = JSON.stringify(out.response);
  expect(outputJson, 'partial response must round-trip byte-identical').toBe(inputJson);
});

// ─── Case 4: usage-without-content — tokens NOT zeroed even when content empty
test('failure-path: usage-without-content preserves provider-reported usage', () => {
  // A content-policy refusal: provider consumed input tokens, returned a
  // usage block, but produced no assistant content. The pipeline must NOT
  // zero tokensIn / tokensOut just because content is empty — that would be
  // a "free" regression where empty-content failures silently record zero
  // cost. The router downstream uses these token counts to compute the cost
  // recorded in the ledger row.
  const usageOnly: Record<string, unknown> = {
    content: '',          // explicit empty
    tokensIn: 4096,       // provider-reported usage — not zero
    tokensOut: 0,         // zero output is legitimate; zero input would not be
    stopReason: 'content_filter',
    providerRequestId: 'prov-req-policy-refusal',
  };
  const out = buildPayloadRow({
    systemPrompt: 'sys',
    messages: [{ role: 'user', content: 'redacted question' }],
    toolDefinitions: [],
    response: usageOnly,
    maxBytes: 1_000_000,
  });
  expect(out.response).not.toBe(null);
  const outResponse = out.response as Record<string, unknown>;
  expect(outResponse.tokensIn, 'provider-reported tokensIn must NOT be zeroed').toBe(4096);
  expect(outResponse.content, 'empty content is preserved verbatim').toBe('');
  expect(outResponse.stopReason).toBe('content_filter');
});
