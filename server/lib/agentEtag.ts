import crypto from 'node:crypto';

/**
 * Minimal payload shape required to compute an ETag for an agent.
 * Arrays must be sorted stably by the caller (see INVARIANT-Q1-A in the spec).
 */
export interface AgentFullForEtag {
  configure: {
    name: string;
    description: string;
    roleTitle: string;
    parentAgentId: string | null;
    model: string;
    outputSize: 'compact' | 'standard' | 'extended';
    allowSubaccountModelOverride: boolean;
    responseMode: 'balanced' | 'expressive' | 'precise' | 'highly_creative';
  };
  behaviour: unknown;
  personality: unknown;
  skills: Array<{ id: string; key: string; configJson: unknown; status: string }>;
  dataSources: Array<{ id: string; kind: string; ref: string; status: string }>;
  triggers: Array<{ id: string; kind: string; spec: unknown; status: string }>;
  budget: { dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number };
}

/**
 * Produce a sha256 hex digest of the canonically serialised payload.
 * The returned string is always a 64-character lowercase hex string.
 */
export function computeAgentEtag(payload: AgentFullForEtag): string {
  const canonical = canonicalStringify(payload as unknown);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Deterministic JSON serialisation.
 *
 * Rules:
 * - Object keys are sorted lexicographically (code-point order, same as Array.prototype.sort default).
 * - `undefined` values in objects are omitted; `null` values are preserved.
 * - Arrays preserve insertion order.
 * - Numbers: -0 → 0; NaN / ±Infinity → throw; integers/floats with same value emit same token
 *   (1.0 → "1"); trailing zeroes stripped (1.50 → "1.5"); 1e3 → "1000" unless outside
 *   Number.MAX_SAFE_INTEGER / Number.MIN_SAFE_INTEGER range (uses toPrecision fallback).
 * - BigInts → throw.
 */
export function canonicalStringify(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalStringify: undefined is not a valid input');
  }
  return _serialise(value);
}

function _serialise(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined'; // handled at call site for object values

  const type = typeof value;

  if (type === 'boolean') return String(value);

  if (type === 'bigint') {
    throw new TypeError('canonicalStringify: BigInt values are not supported');
  }

  if (type === 'number') {
    return _serialiseNumber(value as number);
  }

  if (type === 'string') {
    return JSON.stringify(value); // JSON.stringify handles escaping correctly
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? 'null' : _serialise(item)));
    return '[' + items.join(',') + ']';
  }

  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    // Lex-sort keys (Array.prototype.sort default = code-point ascending)
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const val = obj[key];
      if (val === undefined) continue; // omit undefined values
      parts.push(JSON.stringify(key) + ':' + _serialise(val));
    }
    return '{' + parts.join(',') + '}';
  }

  // function, symbol — treat as omitted (should not appear in data payloads)
  return 'null';
}

function _serialiseNumber(n: number): string {
  if (Number.isNaN(n)) {
    throw new TypeError('canonicalStringify: NaN is not supported');
  }
  if (!Number.isFinite(n)) {
    throw new TypeError('canonicalStringify: Infinity is not supported');
  }
  // Normalise -0 → 0
  if (Object.is(n, -0)) return '0';

  // If the number is an integer representable within safe integer range, use decimal notation.
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
    return String(n);
  }

  // For non-integer or large numbers, use JSON.stringify which uses toPrecision-style
  // representation — strip trailing zeros after decimal point.
  const s = JSON.stringify(n); // e.g. "1.5", "1e+21"
  // If it contains 'e' notation for very large/small numbers, leave as-is (JSON standard).
  // Otherwise normalise trailing zeros.
  if (s.includes('e')) return s;
  if (s.includes('.')) {
    // Strip trailing zeros: "1.50" → "1.5", "1.0" → "1"
    const stripped = s.replace(/\.?0+$/, '');
    return stripped === '' ? '0' : stripped;
  }
  return s;
}
