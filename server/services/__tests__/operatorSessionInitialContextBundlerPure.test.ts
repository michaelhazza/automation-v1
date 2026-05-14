/**
 * operatorSessionInitialContextBundlerPure.test.ts
 *
 * Pure tests for the operator session initial-context bundler trim algorithm.
 *
 * Spec: docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md §4.2, §4.3
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/operatorSessionInitialContextBundlerPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  buildBundle,
  isConfigDegraded,
  type BundleRawInputs,
  type OperatorSessionInitialContextBundle,
} from '../operatorSessionInitialContextBundlerPure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byteSize(bundle: OperatorSessionInitialContextBundle): number {
  return Buffer.byteLength(JSON.stringify(bundle), 'utf8');
}

function makeMinimalInputs(overrides: Partial<BundleRawInputs> = {}): BundleRawInputs {
  return {
    voice_profile: null,
    memory_blocks: [],
    owner_identity: {
      timezone: 'UTC',
      working_hours: null,
    },
    ...overrides,
  };
}

/** Produce a string of exactly `n` bytes (all ASCII). */
function repeat(char: string, n: number): string {
  return char.repeat(n);
}

// ---------------------------------------------------------------------------
// Test 1: bundle that fits → returned as-is; serialised_size_bytes accurate
// ---------------------------------------------------------------------------

test('bundle that fits within 4096 bytes is returned as-is', () => {
  const inputs = makeMinimalInputs({
    voice_profile: {
      tone_features: ['concise', 'professional'],
      style_markers: ['bullet points'],
      do_not_use: ['jargon'],
      canonical_examples: ['Hi Jane, see attached.'],
    },
    memory_blocks: [
      { label: 'project', content: 'Working on Q2 report', updated_at: '2026-05-01T00:00:00Z' },
    ],
    owner_identity: {
      timezone: 'Australia/Sydney',
      working_hours: { start: '09:00', end: '17:00' },
      recent_activity_summary: 'Reviewed PRs',
    },
  });

  const bundle = buildBundle(inputs);

  expect(bundle.voice_profile?.do_not_use).toEqual(['jargon']);
  expect(bundle.voice_profile?.canonical_examples).toEqual(['Hi Jane, see attached.']);
  expect(bundle.memory_blocks).toHaveLength(1);
  expect(bundle.owner_identity.recent_activity_summary).toBe('Reviewed PRs');

  const expectedSize = Buffer.byteLength(
    JSON.stringify({
      voice_profile: bundle.voice_profile,
      memory_blocks: bundle.memory_blocks,
      owner_identity: bundle.owner_identity,
      serialised_size_bytes: bundle.serialised_size_bytes,
    }),
    'utf8',
  );
  expect(bundle.serialised_size_bytes).toBe(expectedSize);
  expect(bundle.serialised_size_bytes).toBeLessThanOrEqual(4096);
});

// ---------------------------------------------------------------------------
// Test 2: bundle exceeds 4096 only due to canonical_examples → examples dropped
// ---------------------------------------------------------------------------

test('canonical_examples dropped when bundle exceeds cap due to examples', () => {
  // Large canonical_examples that push us over the cap
  const bigExamples = Array.from({ length: 40 }, (_, i) => repeat('x', 100) + i);

  const inputs = makeMinimalInputs({
    voice_profile: {
      tone_features: ['direct'],
      style_markers: ['short sentences'],
      do_not_use: ['fluff'],
      canonical_examples: bigExamples,
    },
    owner_identity: {
      timezone: 'UTC',
      working_hours: null,
    },
  });

  const bundle = buildBundle(inputs);

  expect(bundle.voice_profile).not.toBeNull();
  expect(bundle.voice_profile?.canonical_examples).toEqual([]);
  // do_not_use preserved (not the degraded path)
  expect(bundle.voice_profile?.do_not_use).toEqual(['fluff']);
  expect(bundle.serialised_size_bytes).toBeLessThanOrEqual(4096);
  expect(byteSize(bundle)).toBe(bundle.serialised_size_bytes);
});

// ---------------------------------------------------------------------------
// Test 3: bundle exceeds cap even after dropping examples → memory blocks trimmed
// ---------------------------------------------------------------------------

test('memory blocks trimmed oldest-first when bundle still exceeds cap after dropping examples', () => {
  // Large canonical_examples so even without them we need to trim blocks
  const bigExamples = Array.from({ length: 30 }, (_, i) => repeat('e', 100) + i);

  // 10 blocks, each ~300 bytes
  const memoryBlocks = Array.from({ length: 10 }, (_, i) => ({
    label: `block-${i}`,
    content: repeat('b', 270),
    updated_at: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }));

  const inputs = makeMinimalInputs({
    voice_profile: {
      tone_features: ['direct'],
      style_markers: ['short'],
      do_not_use: ['fluff'],
      canonical_examples: bigExamples,
    },
    memory_blocks: memoryBlocks,
    owner_identity: { timezone: 'UTC', working_hours: null },
  });

  const bundle = buildBundle(inputs);

  // canonical_examples dropped
  expect(bundle.voice_profile?.canonical_examples).toEqual([]);
  // Oldest blocks (tail of input array) removed first; remaining blocks are from the front
  const originalLabels = memoryBlocks.map((b) => b.label);
  const bundleLabels = bundle.memory_blocks.map((b) => b.label);
  // bundleLabels must be a prefix of originalLabels
  expect(originalLabels.slice(0, bundleLabels.length)).toEqual(bundleLabels);
  // Must fit
  expect(bundle.serialised_size_bytes).toBeLessThanOrEqual(4096);
  expect(byteSize(bundle)).toBe(bundle.serialised_size_bytes);
});

// ---------------------------------------------------------------------------
// Test 4: voice_profile very large → config-error path; isConfigDegraded true
// ---------------------------------------------------------------------------

test('config-error path fires for very large voice_profile; isConfigDegraded returns true', () => {
  // do_not_use and canonical_examples push the bundle over 4096; tone_features
  // and style_markers alone fit within the cap so the config-error path produces
  // a valid (≤ 4096) bundle.
  const smallArray = Array.from({ length: 3 }, () => repeat('v', 40));
  const bigArray = Array.from({ length: 40 }, () => repeat('z', 100));

  const inputs: BundleRawInputs = {
    voice_profile: {
      tone_features: smallArray,
      style_markers: smallArray,
      do_not_use: bigArray,
      canonical_examples: bigArray,
    },
    memory_blocks: [],
    owner_identity: { timezone: 'UTC', working_hours: null },
  };

  const bundle = buildBundle(inputs);

  // Must be valid (no throw)
  expect(bundle).toBeDefined();

  // isConfigDegraded must return true
  expect(isConfigDegraded(bundle)).toBe(true);

  // do_not_use and canonical_examples must be empty
  expect(bundle.voice_profile?.do_not_use).toEqual([]);
  expect(bundle.voice_profile?.canonical_examples).toEqual([]);

  // Bundle must fit within cap
  expect(bundle.serialised_size_bytes).toBeLessThanOrEqual(4096);

  // serialised_size_bytes reflects actual size
  expect(byteSize(bundle)).toBe(bundle.serialised_size_bytes);
});

// ---------------------------------------------------------------------------
// Test 5: determinism — two calls with same inputs → byte-identical output
// ---------------------------------------------------------------------------

test('buildBundle is deterministic (DEVELOPMENT_GUIDELINES §8.21)', () => {
  const inputs = makeMinimalInputs({
    voice_profile: {
      tone_features: ['warm', 'clear'],
      style_markers: ['active voice'],
      do_not_use: ['passive voice'],
      canonical_examples: ['Let me know if you need anything.'],
    },
    memory_blocks: [
      { label: 'context', content: 'Q2 planning in progress', updated_at: '2026-05-10T00:00:00Z' },
    ],
    owner_identity: {
      timezone: 'America/New_York',
      working_hours: { start: '08:00', end: '18:00' },
    },
  });

  const first = buildBundle(inputs);
  const second = buildBundle(inputs);

  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

// ---------------------------------------------------------------------------
// Test 6: serialised_size_bytes always ≤ 4096 across all fixtures
// ---------------------------------------------------------------------------

test('serialised_size_bytes ≤ 4096 across multiple fixtures', () => {
  const fixtures: BundleRawInputs[] = [
    // Empty
    makeMinimalInputs(),
    // Just a voice profile
    makeMinimalInputs({
      voice_profile: { tone_features: ['a'], style_markers: ['b'], do_not_use: [], canonical_examples: [] },
    }),
    // Many small memory blocks
    makeMinimalInputs({
      memory_blocks: Array.from({ length: 20 }, (_, i) => ({
        label: `blk-${i}`,
        content: repeat('c', 50),
        updated_at: '2026-01-01T00:00:00Z',
      })),
    }),
    // Blocks + voice profile together
    makeMinimalInputs({
      voice_profile: {
        tone_features: Array.from({ length: 5 }, () => repeat('t', 40)),
        style_markers: ['short'],
        do_not_use: ['buzzwords'],
        canonical_examples: Array.from({ length: 5 }, () => repeat('e', 100)),
      },
      memory_blocks: Array.from({ length: 10 }, (_, i) => ({
        label: `b${i}`,
        content: repeat('m', 100),
        updated_at: '2026-03-01T00:00:00Z',
      })),
    }),
    // Config-error path: do_not_use + canonical_examples push over cap;
    // tone_features + style_markers alone fit so result is ≤ 4096.
    {
      voice_profile: {
        tone_features: Array.from({ length: 3 }, () => repeat('v', 40)),
        style_markers: Array.from({ length: 3 }, () => repeat('s', 40)),
        do_not_use: Array.from({ length: 40 }, () => repeat('d', 100)),
        canonical_examples: Array.from({ length: 40 }, () => repeat('x', 100)),
      },
      memory_blocks: [],
      owner_identity: { timezone: 'UTC', working_hours: null },
    },
  ];

  for (const [i, fixture] of fixtures.entries()) {
    const bundle = buildBundle(fixture);
    expect(
      bundle.serialised_size_bytes,
      `fixture ${i} serialised_size_bytes should be ≤ 4096`,
    ).toBeLessThanOrEqual(4096);
    expect(
      Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
      `fixture ${i} actual byte size should match serialised_size_bytes`,
    ).toBe(bundle.serialised_size_bytes);
  }
});
