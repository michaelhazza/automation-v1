/**
 * Canonical JSON serialisation — deterministic, key-sorted JSON for hashing.
 *
 * Spec: tasks/playbooks-spec.md §3.5 (output schema enforcement) and §5.4
 * (output-hash firewall pattern).
 *
 * Two values that are deeply equal but have different key insertion order
 * MUST produce the same canonical string. This guarantees that:
 *
 *   - The output-hash firewall pattern correctly detects "no real change"
 *     edits regardless of how the LLM ordered its JSON output keys.
 *   - Replay determinism holds: a replay run produces byte-identical
 *     context blobs even if Postgres returns jsonb keys in a different
 *     order.
 *   - The input_hash dedup path (§5.5) doesn't false-negative on
 *     reordered-but-equivalent inputs.
 *
 * Rules:
 *   - Object keys are sorted lexicographically.
 *   - Arrays preserve their order (semantic).
 *   - undefined is dropped (treated as JSON.stringify does).
 *   - Numbers are emitted via JSON.stringify (avoids locale issues).
 *   - null is preserved.
 */

export function canonicalJsonStringify(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null'; // canonicalise — undefined becomes null
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) return 'null';
    return JSON.stringify(value);
  }
  if (t === 'string' || t === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v)).join(',') + ']';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // skip undefined keys
      entries.push(JSON.stringify(k) + ':' + stringify(v));
    }
    return '{' + entries.join(',') + '}';
  }
  // bigint, symbol, function, etc. — fall back to JSON.stringify which throws
  // or returns undefined. Caller should not pass these in.
  return JSON.stringify(value as never) ?? 'null';
}
