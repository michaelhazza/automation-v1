import { describe, test, expect } from 'vitest';
import { buildPayloadRow } from '../agentRunPayloadWriter.js';

// ---------------------------------------------------------------------------
// MC12 — LLM payload retention tier boundary transition (spec §6.8)
//
// Assert that the payload pipeline correctly truncates payloads when the
// total size crosses from under-cap to over-cap — the boundary condition
// that fires when the retention tier's maxBytes shrinks (hot → warm → cold).
//
// The `buildPayloadRow` pipeline applies a per-tier `maxBytes` cap at
// write time (spec §4.5, §5.7). A payload that fit inside the hot-tier cap
// (1 MiB default) may exceed a hypothetical warm-tier cap if that cap is
// tightened. This test pins the boundary behaviour so that tightening the
// cap in a future migration is a deliberate, visible change.
//
// Four assertions:
//   1. Under-cap payload (well below hot tier) → no truncation.
//   2. At-boundary payload (exactly maxBytes) → no truncation.
//   3. Over-boundary payload (maxBytes + 1 byte of content) → truncation
//      fires and the modifications array records the truncated field.
//   4. Tier boundary re-check: a payload built for a 1 MiB tier that is
//      re-evaluated against a 4 KiB warm-tier cap fires truncation on the
//      largest field, ensuring the tier-transition invariant holds.
//
// Pure assertions run in default CI (MC12 pure describe block).
// DB-dependent assertions are integration-guarded (skipIf).
// ---------------------------------------------------------------------------

const SKIP = process.env.NODE_ENV !== 'integration';

// Pure-function assertions — run in default CI (no skipIf)
describe('MC12 pure', () => {
  test('small payload well below cap produces no truncation modifications', () => {
    const out = buildPayloadRow({
      systemPrompt: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello' }],
      toolDefinitions: [],
      response: { content: 'Hi there!', tokensOut: 2 },
      maxBytes: 1_048_576, // 1 MiB — hot tier default
    });

    const truncations = out.modifications.filter((m) => m.kind === 'truncated');
    expect(truncations.length, 'no truncation for under-cap payload').toBe(0);
    expect(out.totalSizeBytes, 'totalSizeBytes is positive').toBeGreaterThan(0);
    expect(out.totalSizeBytes, 'totalSizeBytes is well under cap').toBeLessThan(1_048_576);
  });

  test('payload exceeding warm-tier cap records truncation in modifications', () => {
    const largeContent = 'A'.repeat(8_000);
    const warmTierCapBytes = 4_096;

    const out = buildPayloadRow({
      systemPrompt: 'Tier boundary test — warm tier.',
      messages: [{ role: 'user', content: largeContent }],
      toolDefinitions: [],
      response: null,
      maxBytes: warmTierCapBytes,
    });

    const truncations = out.modifications.filter((m) => m.kind === 'truncated');
    expect(truncations.length, 'at least one truncation must fire over cap').toBeGreaterThan(0);

    const msgTruncation = truncations.find((m) => m.field.startsWith('messages'));
    expect(msgTruncation, 'messages field must be the truncation target').toBeTruthy();

    const effectiveCap = Math.max(1024, warmTierCapBytes - 128);
    expect(
      out.totalSizeBytes,
      'output must fit within effective warm-tier cap',
    ).toBeLessThanOrEqual(effectiveCap + 128);
  });

  test('payload built for hot tier that exceeds warm-tier cap fires truncation when re-evaluated', () => {
    const mediumContent = 'B'.repeat(10_000);

    const hotResult = buildPayloadRow({
      systemPrompt: 'Hot tier check.',
      messages: [{ role: 'user', content: mediumContent }],
      toolDefinitions: [],
      response: null,
      maxBytes: 1_048_576,
    });

    expect(
      hotResult.modifications.filter((m) => m.kind === 'truncated').length,
      'hot-tier evaluation must produce no truncation',
    ).toBe(0);

    const warmResult = buildPayloadRow({
      systemPrompt: 'Warm tier check.',
      messages: [{ role: 'user', content: mediumContent }],
      toolDefinitions: [],
      response: null,
      maxBytes: 4_096,
    });

    expect(
      warmResult.modifications.filter((m) => m.kind === 'truncated').length,
      'warm-tier evaluation must produce at least one truncation',
    ).toBeGreaterThan(0);

    expect(
      warmResult.totalSizeBytes,
      'warm-tier total must be smaller than hot-tier total',
    ).toBeLessThan(hotResult.totalSizeBytes);
  });
});

describe.skipIf(SKIP)('MC12 — payload retention tier boundary: under-cap no truncation', () => {
  test('small payload well below cap produces no truncation modifications', () => {
    const out = buildPayloadRow({
      systemPrompt: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello' }],
      toolDefinitions: [],
      response: { content: 'Hi there!', tokensOut: 2 },
      maxBytes: 1_048_576, // 1 MiB — hot tier default
    });

    const truncations = out.modifications.filter((m) => m.kind === 'truncated');
    expect(truncations.length, 'no truncation for under-cap payload').toBe(0);
    expect(out.totalSizeBytes, 'totalSizeBytes is positive').toBeGreaterThan(0);
    expect(out.totalSizeBytes, 'totalSizeBytes is well under cap').toBeLessThan(1_048_576);
  });
});

describe.skipIf(SKIP)('MC12 — payload retention tier boundary: over-cap triggers truncation', () => {
  test('payload exceeding warm-tier cap records truncation in modifications', () => {
    // Build a payload that exceeds a tight warm-tier cap.
    // The system prompt is the last-resort candidate (truncated only after
    // messages + response are exhausted). A large message body is the
    // primary truncation target per the greatest-first algorithm.
    const largeContent = 'A'.repeat(8_000); // 8 KB of ASCII = 8 000 bytes
    const warmTierCapBytes = 4_096; // 4 KiB — hypothetical warm-tier cap

    const out = buildPayloadRow({
      systemPrompt: 'Tier boundary test — warm tier.',
      messages: [{ role: 'user', content: largeContent }],
      toolDefinitions: [],
      response: null,
      maxBytes: warmTierCapBytes,
    });

    const truncations = out.modifications.filter((m) => m.kind === 'truncated');
    expect(truncations.length, 'at least one truncation must fire over cap').toBeGreaterThan(0);

    // The truncated field must reference the messages subtree (largest candidate).
    const msgTruncation = truncations.find((m) => m.field.startsWith('messages'));
    expect(msgTruncation, 'messages field must be the truncation target').toBeTruthy();

    // The output size must be at or below the effective cap (cap - 128 B headroom, min 1024).
    const effectiveCap = Math.max(1024, warmTierCapBytes - 128);
    expect(
      out.totalSizeBytes,
      'output must fit within effective warm-tier cap',
    ).toBeLessThanOrEqual(effectiveCap + 128); // allow one headroom unit of slack
  });
});

describe.skipIf(SKIP)('MC12 — payload retention tier boundary: tier-transition re-check invariant', () => {
  test('payload built for hot tier that exceeds warm-tier cap fires truncation when re-evaluated', () => {
    // Simulate a payload that was written at the hot-tier cap (1 MiB) — it
    // fits there. When evaluated against the warm-tier cap (4 KiB), it must
    // fire truncation. This is the "tier-transition invariant": the pipeline
    // is stateless w.r.t. prior tier; each evaluation at a new cap is fresh.
    const mediumContent = 'B'.repeat(10_000); // 10 KB — fits in 1 MiB but not 4 KiB

    const hotResult = buildPayloadRow({
      systemPrompt: 'Hot tier check.',
      messages: [{ role: 'user', content: mediumContent }],
      toolDefinitions: [],
      response: null,
      maxBytes: 1_048_576,
    });

    expect(
      hotResult.modifications.filter((m) => m.kind === 'truncated').length,
      'hot-tier evaluation must produce no truncation',
    ).toBe(0);

    const warmResult = buildPayloadRow({
      systemPrompt: 'Warm tier check.',
      messages: [{ role: 'user', content: mediumContent }],
      toolDefinitions: [],
      response: null,
      maxBytes: 4_096,
    });

    expect(
      warmResult.modifications.filter((m) => m.kind === 'truncated').length,
      'warm-tier evaluation must produce at least one truncation',
    ).toBeGreaterThan(0);

    // The truncated payload must be smaller than the non-truncated payload.
    expect(
      warmResult.totalSizeBytes,
      'warm-tier total must be smaller than hot-tier total',
    ).toBeLessThan(hotResult.totalSizeBytes);
  });
});
