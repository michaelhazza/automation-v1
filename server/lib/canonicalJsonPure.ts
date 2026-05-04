// Pure canonical-JSON + hashing helpers.
//
// Extracted from server/services/actionService.ts so pure consumers
// (chargeRouterServicePure.ts, regressionCaptureServicePure.ts) can import
// these without dragging the impure DB / drizzle import chain through
// actionService.ts. Keeps the pure-helper boundary clean per spec §10
// Invariant 15.
//
// Used by both the idempotency-key hash and the validationDigest drift
// check, so two logically-identical payloads always produce the same
// string regardless of key insertion order.

import { createHash } from 'crypto';

/**
 * Canonical JSON stringification with recursive key sorting. Unlike
 * `JSON.stringify(value, Object.keys(value).sort())` — whose 2nd arg is an
 * allowlist applied at every depth (thus silently dropping nested keys) —
 * this walks the value and sorts object keys at every level before emitting.
 * Arrays retain order (positional semantics).
 *
 * Object properties with `undefined` values are omitted — matching
 * `JSON.stringify`'s default behaviour. This closes the "present-vs-absent"
 * trap where one caller writes `{ x: undefined }` and another omits `x`
 * entirely; both now canonicalise the same way. Explicit `null` stays
 * distinct from omitted — null is semantically meaningful ("explicitly
 * unset"), whereas `undefined` vs absent is a JS surface accident.
 */
export function canonicaliseJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicaliseJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicaliseJson(v)}`).join(',')}}`;
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

export function hashActionArgs(args: Record<string, unknown>): string {
  const canonical = canonicaliseJson(args);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Full SHA-256 digest of a canonicalised payload. Stored in
 * metadata_json.validationDigest at propose-time; re-computed by the execution
 * engine's precondition gate and compared byte-for-byte — a drift triggers
 * `blocked: drift_detected`.
 */
export function computeValidationDigest(payload: Record<string, unknown>): string {
  const canonical = canonicaliseJson(payload);
  return createHash('sha256').update(canonical).digest('hex');
}
