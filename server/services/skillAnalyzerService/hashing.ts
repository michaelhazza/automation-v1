import { createHash } from 'node:crypto';

/** Deterministic JSON stringify (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const stringify = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (seen.has(v as object)) return '"[circular]"';
    seen.add(v as object);
    if (Array.isArray(v)) return '[' + v.map(stringify).join(',') + ']';
    const keys = Object.keys(v as object).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stringify((v as Record<string, unknown>)[k])).join(',') + '}';
  };
  return stringify(value);
}

/** v2 §11.11.7 helper: deterministic hash of a skill's content fields so
 *  Execute can idempotent-skip a slug collision when the existing row was
 *  created by a prior (crashed) run. */
export function hashSkillContent(s: {
  name: string;
  description: string | null;
  definition: object | null;
  instructions: string | null;
}): string {
  const payload = stableStringify({
    name: s.name,
    description: s.description ?? '',
    definition: s.definition ?? null,
    instructions: s.instructions ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/** Best-effort string extraction for thrown values. Services in this codebase
 *  throw plain objects of shape `{ statusCode, message }` (not Error
 *  instances), so the standard `err instanceof Error ? err.message : String(err)`
 *  pattern produces "[object Object]" for service errors. Try the message
 *  field first, fall back to Error.message, then String coercion. */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return String(err);
}
