/**
 * Pure-function tests for agentEtag.ts — canonicalStringify and computeAgentEtag.
 */

import { describe, it, expect } from 'vitest';
import { computeAgentEtag, canonicalStringify } from '../agentEtag.js';
import type { AgentFullForEtag } from '../agentEtag.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<AgentFullForEtag> = {}): AgentFullForEtag {
  return {
    configure: {
      name: 'Test Agent',
      description: 'A test agent',
      roleTitle: 'Assistant',
      parentAgentId: null,
      model: 'claude-sonnet-4-6',
      outputSize: 'standard',
      allowSubaccountModelOverride: true,
      responseMode: 'balanced',
    },
    behaviour: { briefingTemplate: '', constraints: [] },
    personality: { traits: [], tone: 'neutral', description: '', enabled: false },
    skills: [],
    dataSources: [],
    triggers: [],
    budget: { dailyCapUsd: null, monthlyCapUsd: null, warnThresholdPct: 80 },
    ...overrides,
  };
}

// ── canonicalStringify tests ─────────────────────────────────────────────────

describe('canonicalStringify', () => {
  it('sorts object keys lexicographically at top level', () => {
    const result = canonicalStringify({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts keys at every nesting level', () => {
    const result = canonicalStringify({ z: { y: 1, b: 2 }, a: { n: 3, c: 4 } });
    expect(result).toBe('{"a":{"c":4,"n":3},"z":{"b":2,"y":1}}');
  });

  it('omits undefined values in objects', () => {
    const result = canonicalStringify({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });

  it('preserves null values', () => {
    const result = canonicalStringify({ a: null, b: 'x' });
    expect(result).toBe('{"a":null,"b":"x"}');
  });

  it('preserves array insertion order', () => {
    const result = canonicalStringify([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('handles nested arrays preserving order', () => {
    const result = canonicalStringify([[3, 1], [2, 4]]);
    expect(result).toBe('[[3,1],[2,4]]');
  });

  it('normalises integer 1.0 to same token as 1', () => {
    const r1 = canonicalStringify(1.0);
    const r2 = canonicalStringify(1);
    expect(r1).toBe(r2);
    expect(r1).toBe('1');
  });

  it('normalises 1.50 to 1.5 (strips trailing zeros)', () => {
    const result = canonicalStringify(1.5);
    expect(result).toBe('1.5');
  });

  it('normalises -0 to 0', () => {
    const result = canonicalStringify(-0);
    expect(result).toBe('0');
  });

  it('1e3 produces plain decimal "1000"', () => {
    const result = canonicalStringify(1e3);
    expect(result).toBe('1000');
  });

  it('throws on NaN', () => {
    expect(() => canonicalStringify(NaN)).toThrow();
  });

  it('throws on +Infinity', () => {
    expect(() => canonicalStringify(Infinity)).toThrow();
  });

  it('throws on -Infinity', () => {
    expect(() => canonicalStringify(-Infinity)).toThrow();
  });

  it('throws on BigInt', () => {
    expect(() => canonicalStringify(BigInt(1))).toThrow();
  });

  it('serialises booleans correctly', () => {
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(false)).toBe('false');
  });

  it('serialises strings with proper escaping', () => {
    expect(canonicalStringify('hello "world"')).toBe('"hello \\"world\\""');
  });

  it('throws a TypeError when called with undefined', () => {
    expect(() => canonicalStringify(undefined)).toThrow(TypeError);
    expect(() => canonicalStringify(undefined)).toThrow('canonicalStringify: undefined is not a valid input');
  });

  it('serialises array with undefined element as null (matching JSON.stringify behaviour)', () => {
    // JSON.stringify([undefined]) === '[null]'
    const result = canonicalStringify([undefined]);
    expect(result).toBe('[null]');
  });

  it('serialises mixed array with undefined elements correctly', () => {
    const result = canonicalStringify([1, undefined, 'x']);
    expect(result).toBe('[1,null,"x"]');
  });
});

// ── computeAgentEtag tests ───────────────────────────────────────────────────

describe('computeAgentEtag', () => {
  it('returns a 64-char lowercase hex string', () => {
    const etag = computeAgentEtag(makePayload());
    expect(etag).toHaveLength(64);
    expect(etag).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: same input → same hash across multiple calls', () => {
    const payload = makePayload();
    const e1 = computeAgentEtag(payload);
    const e2 = computeAgentEtag(payload);
    const e3 = computeAgentEtag(payload);
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
  });

  it('different name produces different etag', () => {
    const e1 = computeAgentEtag(makePayload());
    const e2 = computeAgentEtag(makePayload({ configure: { ...makePayload().configure, name: 'Other Agent' } }));
    expect(e1).not.toBe(e2);
  });

  it('integer 1.0 and 1 in payload produce same etag', () => {
    const e1 = computeAgentEtag(makePayload({ budget: { dailyCapUsd: 1.0, monthlyCapUsd: null, warnThresholdPct: 80 } }));
    const e2 = computeAgentEtag(makePayload({ budget: { dailyCapUsd: 1, monthlyCapUsd: null, warnThresholdPct: 80 } }));
    expect(e1).toBe(e2);
  });

  it('key order in configure object does not affect etag', () => {
    const p1 = makePayload();
    // Manually create a payload with reversed key order at runtime — JS objects
    // preserve insertion order but canonicalStringify must sort regardless.
    const configReversed = {
      responseMode: 'balanced' as const,
      allowSubaccountModelOverride: true,
      outputSize: 'standard' as const,
      model: 'claude-sonnet-4-6',
      parentAgentId: null,
      roleTitle: 'Assistant',
      description: 'A test agent',
      name: 'Test Agent',
    };
    const p2: AgentFullForEtag = { ...p1, configure: configReversed };
    expect(computeAgentEtag(p1)).toBe(computeAgentEtag(p2));
  });

  it('array order is preserved — reordering skills changes the etag', () => {
    const skill1 = { id: 'aaa', key: 'sk1', configJson: {}, status: 'enabled' };
    const skill2 = { id: 'bbb', key: 'sk2', configJson: {}, status: 'enabled' };
    const e1 = computeAgentEtag(makePayload({ skills: [skill1, skill2] }));
    const e2 = computeAgentEtag(makePayload({ skills: [skill2, skill1] }));
    expect(e1).not.toBe(e2);
  });
});
