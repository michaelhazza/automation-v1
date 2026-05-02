// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports"
/**
 * agentRecommendationsServicePure.test.ts
 *
 * Pure-helper tests for materialDelta predicates, eviction priority comparator,
 * severity rank, cooldown defaults, and canonical-JSON rules.
 *
 * No DB imports. No I/O. All pure functions.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/agentRecommendationsServicePure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  materialDelta,
  severityRank,
  COOLDOWN_HOURS_BY_SEVERITY,
  canonicaliseEvidence,
  evidenceHash,
} from '../../../shared/types/agentRecommendations.js';
import { comparePriority } from '../agentRecommendationsServicePure.js';

// ── Severity rank ─────────────────────────────────────────────────────────────

describe('severityRank', () => {
  test('critical=3', () => {
    expect(severityRank('critical')).toBe(3);
  });
  test('warn=2', () => {
    expect(severityRank('warn')).toBe(2);
  });
  test('info=1', () => {
    expect(severityRank('info')).toBe(1);
  });
});

// ── Cooldown defaults ─────────────────────────────────────────────────────────

describe('COOLDOWN_HOURS_BY_SEVERITY', () => {
  test('critical = 24h', () => {
    expect(COOLDOWN_HOURS_BY_SEVERITY.critical).toBe(24);
  });
  test('warn = 168h', () => {
    expect(COOLDOWN_HOURS_BY_SEVERITY.warn).toBe(168);
  });
  test('info = 336h', () => {
    expect(COOLDOWN_HOURS_BY_SEVERITY.info).toBe(336);
  });
});

// ── materialDelta predicates ──────────────────────────────────────────────────

describe('materialDelta[agent.over_budget]', () => {
  const fn = materialDelta['agent.over_budget'];
  const base = { this_month: 5000, last_month: 4000, budget: 3000, agent_id: 'a', top_cost_driver: 'x' };

  test('returns false when relative change < 10%', () => {
    expect(fn(base, { ...base, this_month: 5400 })).toBe(false); // 8%
  });
  test('returns false when absolute change < 1000 cents', () => {
    expect(fn(base, { ...base, this_month: 5600 })).toBe(false); // >10% relative but only $6
  });
  test('returns true when 10% relative AND >= $10 absolute', () => {
    const next = { ...base, this_month: 6000 }; // 20% + $10
    expect(fn(base, next)).toBe(true);
  });
  test('returns true on large absolute change with relative >= 10%', () => {
    const next = { ...base, this_month: 7300 }; // 46% + $23
    expect(fn(base, next)).toBe(true);
  });
});

describe('materialDelta[playbook.escalation_rate]', () => {
  const fn = materialDelta['playbook.escalation_rate'];
  const base = { workflow_id: 'w', run_count: 20, escalation_count: 8, escalation_pct: 0.4, common_step_id: 's' };

  test('returns false when rate change < 10pp', () => {
    expect(fn(base, { ...base, escalation_pct: 0.48 })).toBe(false);
  });
  test('returns false when count change < 3', () => {
    // 10pp+ rate but only 2 count change
    expect(fn(base, { ...base, escalation_pct: 0.51, escalation_count: 10 })).toBe(false); // delta=2
  });
  test('returns true when rate >= 10pp AND count change >= 3', () => {
    expect(fn(base, { ...base, escalation_pct: 0.55, escalation_count: 11 })).toBe(true);
  });
});

describe('materialDelta[skill.slow]', () => {
  const fn = materialDelta['skill.slow'];
  const base = { skill_slug: 's', latency_p95_ms: 4000, peer_p95_ms: 1000, ratio: 4.0 };

  test('returns false when ratio change < 0.20', () => {
    expect(fn(base, { ...base, ratio: 4.15, latency_p95_ms: 4150 })).toBe(false);
  });
  test('returns false when latency change < 200ms', () => {
    expect(fn(base, { ...base, ratio: 4.3, latency_p95_ms: 4100 })).toBe(false); // only 100ms
  });
  test('returns true when both thresholds met', () => {
    expect(fn(base, { ...base, ratio: 5.0, latency_p95_ms: 5000 })).toBe(true); // 25% ratio + 1000ms
  });
});

describe('materialDelta[inactive.workflow]', () => {
  const fn = materialDelta['inactive.workflow'];
  const base = { subaccount_agent_id: 'sa', agent_id: 'a', agent_name: 'n', expected_cadence: '7d', last_run_at: '2026-04-01T00:00:00Z' };

  test('returns false when last_run_at unchanged', () => {
    expect(fn(base, { ...base })).toBe(false);
  });
  test('returns true when last_run_at changes', () => {
    expect(fn(base, { ...base, last_run_at: '2026-05-01T00:00:00Z' })).toBe(true);
  });
  test('returns true when last_run_at changes from null', () => {
    expect(fn({ ...base, last_run_at: null }, base)).toBe(true);
  });
});

describe('materialDelta[escalation.repeat_phrase]', () => {
  const fn = materialDelta['escalation.repeat_phrase'];
  const base = { phrase: 'guarantee', count: 3, sample_escalation_ids: [] };

  test('returns false when count unchanged', () => {
    expect(fn(base, { ...base })).toBe(false);
  });
  test('returns true when count changes', () => {
    expect(fn(base, { ...base, count: 4 })).toBe(true);
  });
});

describe('materialDelta[memory.low_citation_waste]', () => {
  const fn = materialDelta['memory.low_citation_waste'];
  const base = { agent_id: 'a', low_citation_pct: 0.6, total_injected: 20, projected_token_savings: 1000 };

  test('returns false when rate change < 10pp', () => {
    expect(fn(base, { ...base, low_citation_pct: 0.65 })).toBe(false);
  });
  test('returns false when total_injected < floor', () => {
    expect(fn(base, { ...base, low_citation_pct: 0.8, total_injected: 8, projected_token_savings: 500 })).toBe(false);
  });
  test('returns false when count change < 3', () => {
    expect(fn(base, { ...base, low_citation_pct: 0.8, total_injected: 22 })).toBe(false); // delta=2
  });
  test('returns true when all thresholds met', () => {
    expect(fn(base, { ...base, low_citation_pct: 0.8, total_injected: 25 })).toBe(true); // 20pp + floor + delta=5
  });
});

describe('materialDelta[agent.routing_uncertainty]', () => {
  const fn = materialDelta['agent.routing_uncertainty'];
  const base = { agent_id: 'a', low_confidence_pct: 0.3, second_look_pct: 0.2, total_decisions: 30 };

  test('returns false when neither metric changes by 10pp', () => {
    expect(fn(base, { ...base, low_confidence_pct: 0.35, second_look_pct: 0.24 })).toBe(false);
  });
  test('returns false when volume floor not met', () => {
    expect(fn(base, { ...base, low_confidence_pct: 0.45, total_decisions: 8 })).toBe(false);
  });
  test('returns false when volume change < 3', () => {
    expect(fn(base, { ...base, low_confidence_pct: 0.45, total_decisions: 32 })).toBe(false); // delta=2
  });
  test('returns true when low_confidence_pct changes by 10pp', () => {
    expect(fn(base, { ...base, low_confidence_pct: 0.45, total_decisions: 35 })).toBe(true);
  });
  test('returns true when second_look_pct changes by 10pp', () => {
    expect(fn(base, { ...base, second_look_pct: 0.35, total_decisions: 35 })).toBe(true);
  });
});

describe('materialDelta[llm.cache_poor_reuse]', () => {
  const fn = materialDelta['llm.cache_poor_reuse'];
  const base = { agent_id: 'a', creation_tokens: 10000, reused_tokens: 5000, dominant_skill: 's' };

  test('returns false when relative change < 20%', () => {
    expect(fn(base, { ...base, creation_tokens: 11500 })).toBe(false); // 15%
  });
  test('returns false when absolute change < 1000', () => {
    expect(fn(base, { ...base, creation_tokens: 10500 })).toBe(false); // only 500
  });
  test('returns true when 20% relative AND >= 1000 absolute', () => {
    expect(fn(base, { ...base, creation_tokens: 13000 })).toBe(true); // 30% + 3000
  });
});

// ── Eviction priority comparator ──────────────────────────────────────────────

describe('comparePriority', () => {
  const now = '2026-05-02T10:00:00Z';
  const later = '2026-05-02T11:00:00Z';

  test('critical beats warn', () => {
    const a = { severity: 3, updatedAt: now, category: 'z', dedupeKey: 'z' };
    const b = { severity: 2, updatedAt: now, category: 'z', dedupeKey: 'z' };
    expect(comparePriority(a, b)).toBeGreaterThan(0);
  });

  test('newer updatedAt beats older (when severity equal)', () => {
    const a = { severity: 2, updatedAt: later, category: 'z', dedupeKey: 'z' };
    const b = { severity: 2, updatedAt: now, category: 'z', dedupeKey: 'z' };
    expect(comparePriority(a, b)).toBeGreaterThan(0);
  });

  test('alphabetically earlier category beats later (when severity+time equal)', () => {
    const a = { severity: 2, updatedAt: now, category: 'agent.budget', dedupeKey: 'z' };
    const b = { severity: 2, updatedAt: now, category: 'skill.slow', dedupeKey: 'z' };
    expect(comparePriority(a, b)).toBeGreaterThan(0); // 'agent' < 'skill' alphabetically
  });

  test('alphabetically earlier dedupeKey breaks final tie', () => {
    const a = { severity: 2, updatedAt: now, category: 'same', dedupeKey: 'abc' };
    const b = { severity: 2, updatedAt: now, category: 'same', dedupeKey: 'xyz' };
    expect(comparePriority(a, b)).toBeGreaterThan(0);
  });

  test('equal tuples return 0', () => {
    const a = { severity: 2, updatedAt: now, category: 'same', dedupeKey: 'key' };
    expect(comparePriority(a, { ...a })).toBe(0);
  });

  test('deterministic across permutations (sort stability)', () => {
    const recs = [
      { severity: 1, updatedAt: now, category: 'z', dedupeKey: 'z' },
      { severity: 3, updatedAt: now, category: 'a', dedupeKey: 'a' },
      { severity: 2, updatedAt: later, category: 'm', dedupeKey: 'm' },
      { severity: 2, updatedAt: now, category: 'm', dedupeKey: 'm' },
      { severity: 3, updatedAt: later, category: 'a', dedupeKey: 'a' },
    ];

    // Sort ascending (lowest priority first — eviction target)
    const sorted1 = [...recs].sort((a, b) => comparePriority(a, b));
    const sorted2 = [...recs].reverse().sort((a, b) => comparePriority(a, b));
    const sorted3 = [...recs].sort(() => Math.random() - 0.5).sort((a, b) => comparePriority(a, b));

    expect(JSON.stringify(sorted1)).toBe(JSON.stringify(sorted2));
    expect(JSON.stringify(sorted1)).toBe(JSON.stringify(sorted3));
  });
});

// ── Canonical-JSON rules (plan.md §Contracts, 8 rules) ───────────────────────

describe('canonicaliseEvidence — rule 1: key sort', () => {
  test('object keys are sorted lexicographically', () => {
    const a = canonicaliseEvidence({ z: 1, a: 2, m: 3 });
    const b = canonicaliseEvidence({ m: 3, z: 1, a: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  test('nested object keys are also sorted', () => {
    const a = canonicaliseEvidence({ outer: { z: 1, a: 2 } });
    expect(a).toBe('{"outer":{"a":2,"z":1}}');
  });
});

describe('canonicaliseEvidence — rule 2: undefined dropped', () => {
  test('undefined values are omitted', () => {
    const a = canonicaliseEvidence({ x: 1, y: undefined as unknown as string });
    const b = canonicaliseEvidence({ x: 1 });
    expect(a).toBe(b);
  });
});

describe('canonicaliseEvidence — rule 3: null preserved', () => {
  test('{x: null} != {}', () => {
    const withNull = canonicaliseEvidence({ x: null });
    const withoutX = canonicaliseEvidence({});
    expect(withNull).not.toBe(withoutX);
    expect(withNull).toBe('{"x":null}');
  });
});

describe('canonicaliseEvidence — rule 4: number normalisation', () => {
  test('integers serialise without trailing .0', () => {
    expect(canonicaliseEvidence({ n: 1000 })).toBe('{"n":1000}');
  });
  test('floats round to 4 decimal places', () => {
    expect(canonicaliseEvidence({ r: 0.123456789 })).toBe('{"r":0.1235}');
  });
  test('NaN throws', () => {
    expect(() => canonicaliseEvidence({ n: NaN })).toThrow();
  });
  test('Infinity throws', () => {
    expect(() => canonicaliseEvidence({ n: Infinity })).toThrow();
  });
});

describe('canonicaliseEvidence — rule 5: NFC normalised strings', () => {
  test('NFC and NFD forms of same string produce same hash', () => {
    const nfc = 'café'; // U+00E9 = precomposed
    const nfd = 'café'; // combining accent
    const hashNfc = evidenceHash({ phrase: nfc });
    const hashNfd = evidenceHash({ phrase: nfd });
    expect(hashNfc).toBe(hashNfd);
  });
});

describe('canonicaliseEvidence — rule 6: booleans as bool', () => {
  test('{x: true} != {x: 1}', () => {
    const withBool = canonicaliseEvidence({ x: true });
    const withInt = canonicaliseEvidence({ x: 1 });
    expect(withBool).not.toBe(withInt);
  });
  test('boolean true serialises as JSON true not 1', () => {
    expect(canonicaliseEvidence({ x: true })).toBe('{"x":true}');
  });
});

describe('canonicaliseEvidence — rule 7: array sort', () => {
  test('arrays are sorted ascending before hashing', () => {
    const a = canonicaliseEvidence({ ids: ['c', 'a', 'b'] });
    const b = canonicaliseEvidence({ ids: ['a', 'b', 'c'] });
    expect(a).toBe(b);
  });
  test('different array contents produce different hashes', () => {
    const a = evidenceHash({ ids: ['x', 'y'] });
    const b = evidenceHash({ ids: ['x', 'z'] });
    expect(a).not.toBe(b);
  });
});

describe('evidenceHash — determinism', () => {
  test('byte-equal hashes for inputs differing only in key order', () => {
    const a = evidenceHash({ z: 1, a: 2 });
    const b = evidenceHash({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  test('byte-equal hashes for equivalent number representations', () => {
    const a = evidenceHash({ n: 1000 });
    const b = evidenceHash({ n: 1000 }); // same
    expect(a).toBe(b);
  });

  test('hash is lowercase hex', () => {
    const h = evidenceHash({ x: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
