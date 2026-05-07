import { describe, it, expect } from 'vitest';
import { canonicalStringify, computeAgentEtag, type AgentFullForEtag } from '../agentEtag.js';

describe('canonicalStringify', () => {
  describe('numeric edge cases', () => {
    it('rejects NaN', () => {
      expect(() => canonicalStringify(NaN)).toThrow('NaN is not supported');
    });

    it('rejects positive Infinity', () => {
      expect(() => canonicalStringify(Infinity)).toThrow('Infinity is not supported');
    });

    it('rejects negative Infinity', () => {
      expect(() => canonicalStringify(-Infinity)).toThrow('Infinity is not supported');
    });

    it('canonicalises -0 to 0', () => {
      const result = canonicalStringify(-0);
      expect(result).toBe('0');
    });

    it('strips trailing zeros from floats', () => {
      expect(canonicalStringify(1.0)).toBe('1');
      expect(canonicalStringify(1.50)).toBe('1.5');
      expect(canonicalStringify(1.500)).toBe('1.5');
    });

    it('handles scientific notation equivalently', () => {
      // 1e3 and 1000 should produce the same output (within safe integer range)
      expect(canonicalStringify(1e3)).toBe(canonicalStringify(1000));
      expect(canonicalStringify(1e3)).toBe('1000');
    });

    it('is deterministic despite IEEE 754 precision quirks', () => {
      // 0.1 + 0.2 != 0.3 in IEEE 754, but the serialisation is deterministic and identical
      expect(canonicalStringify(0.1 + 0.2)).toBe(canonicalStringify(0.1 + 0.2));
    });

    it('rejects BigInt', () => {
      expect(() => canonicalStringify(BigInt(123))).toThrow('BigInt values are not supported');
    });

    it('handles integers within MAX_SAFE_INTEGER', () => {
      expect(canonicalStringify(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
      expect(canonicalStringify(Number.MIN_SAFE_INTEGER)).toBe('-9007199254740991');
    });

    it('handles numbers beyond MAX_SAFE_INTEGER range', () => {
      // Number.MAX_SAFE_INTEGER + 1 loses precision in JavaScript but is still serialisable
      const huge = Number.MAX_SAFE_INTEGER + 1;
      const result = canonicalStringify(huge);
      // The actual value depends on JavaScript's internal representation
      expect(typeof result).toBe('string');
      expect(result.length > 0).toBe(true);
    });
  });

  describe('object key sorting', () => {
    it('sorts keys lexicographically', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const result = canonicalStringify(obj);
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('omits undefined values', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const result = canonicalStringify(obj);
      expect(result).toBe('{"a":1,"c":3}');
    });

    it('preserves null values', () => {
      const obj = { a: 1, b: null, c: 3 };
      const result = canonicalStringify(obj);
      expect(result).toBe('{"a":1,"b":null,"c":3}');
    });
  });

  describe('arrays', () => {
    it('preserves array insertion order', () => {
      const arr = [3, 1, 2];
      const result = canonicalStringify(arr);
      expect(result).toBe('[3,1,2]');
    });

    it('treats undefined array elements as null', () => {
      // Note: sparse arrays are converted on serialisation
      const arr = [1, undefined, 3];
      const result = canonicalStringify(arr);
      expect(result).toBe('[1,null,3]');
    });
  });

  describe('rejects undefined at top level', () => {
    it('throws on undefined input', () => {
      expect(() => canonicalStringify(undefined)).toThrow('undefined is not a valid input');
    });
  });

  describe('determinism', () => {
    it('produces identical output for identical inputs', () => {
      const input1 = { z: 1, a: [2, 3], b: { nested: true, order: 'matters' } };
      const input2 = { a: [2, 3], z: 1, b: { order: 'matters', nested: true } };
      expect(canonicalStringify(input1)).toBe(canonicalStringify(input2));
    });

    it('produces different output for different inputs', () => {
      const input1 = { a: 1 };
      const input2 = { a: 2 };
      expect(canonicalStringify(input1)).not.toBe(canonicalStringify(input2));
    });
  });
});

describe('computeAgentEtag', () => {
  const createMinimalPayload = (): AgentFullForEtag => ({
    configure: {
      name: 'test-agent',
      description: 'A test agent',
      roleTitle: 'Assistant',
      parentAgentId: null,
      model: 'claude-3-opus',
      outputSize: 'standard',
      allowSubaccountModelOverride: false,
      responseMode: 'balanced',
    },
    behaviour: { briefingTemplate: '' },
    personality: { traits: [] },
    skills: [],
    dataSources: [],
    triggers: [],
    budget: { dailyCapUsd: null, monthlyCapUsd: null, warnThresholdPct: 100 },
  });

  it('returns a 64-character lowercase hex string', () => {
    const payload = createMinimalPayload();
    const etag = computeAgentEtag(payload);
    expect(etag).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces identical ETags for identical payloads', () => {
    const payload1 = createMinimalPayload();
    const payload2 = createMinimalPayload();
    expect(computeAgentEtag(payload1)).toBe(computeAgentEtag(payload2));
  });

  it('produces different ETags for different payloads', () => {
    const payload1 = createMinimalPayload();
    const payload2 = createMinimalPayload();
    payload2.configure.name = 'different-agent';
    expect(computeAgentEtag(payload1)).not.toBe(computeAgentEtag(payload2));
  });

  it('is sensitive to array reordering (arrays are NOT sorted)', () => {
    const payload1 = createMinimalPayload();
    const payload2 = createMinimalPayload();
    payload1.skills = [
      { id: 'skill-1', key: 'skill1', configJson: {}, status: 'enabled' },
      { id: 'skill-2', key: 'skill2', configJson: {}, status: 'enabled' },
    ];
    payload2.skills = [
      { id: 'skill-2', key: 'skill2', configJson: {}, status: 'enabled' },
      { id: 'skill-1', key: 'skill1', configJson: {}, status: 'enabled' },
    ];
    expect(computeAgentEtag(payload1)).not.toBe(computeAgentEtag(payload2));
  });

  it('invariant: arrays MUST be sorted by caller (see spec Q1)', () => {
    const payload = createMinimalPayload();
    payload.skills = [
      { id: 'z-skill', key: 'zskill', configJson: {}, status: 'enabled' },
      { id: 'a-skill', key: 'askill', configJson: {}, status: 'enabled' },
    ];
    // The ETag produced here is deterministic, but if the array is reordered
    // at a different call site without re-sorting, a semantically identical
    // payload would produce a different ETag. The caller MUST ensure stable
    // ordering via the plan invariant at `tasks/builds/consolidation-build/plan.md § Q1`.
    const etag1 = computeAgentEtag(payload);
    expect(typeof etag1).toBe('string');
    expect(etag1.length).toBe(64);
  });
});
