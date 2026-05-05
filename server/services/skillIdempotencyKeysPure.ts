/**
 * skillIdempotencyKeysPure.ts
 *
 * Pure helpers for skill idempotency key management.
 * No DB, no env, no I/O imports — safe to import in unit tests without
 * bootstrapping the application.
 */
import crypto from 'node:crypto';
import type { IdempotencyContract } from '../config/actionRegistry.js';

// ---------------------------------------------------------------------------
// TTL constants — single source of truth. No per-call-site literals elsewhere.
// ---------------------------------------------------------------------------

/** Single-source TTL constant table — no literal expires_at arithmetic anywhere else. */
export const TTL_DURATIONS_MS = {
  permanent: null,                    // sentinel → expires_at = NULL
  long:  30 * 24 * 60 * 60 * 1000,  // 30 days
  short: 14 * 24 * 60 * 60 * 1000,  // 14 days
} as const;

/**
 * Map a ttlClass to a concrete `expires_at` Date (or null for permanent).
 * The wrapper and the cleanup job both consume this helper — never compute
 * TTLs independently.
 */
export function ttlClassToExpiresAt(cls: IdempotencyContract['ttlClass']): Date | null {
  const ms = TTL_DURATIONS_MS[cls];
  return ms === null ? null : new Date(Date.now() + ms);
}

// ---------------------------------------------------------------------------
// Canonical JSON serialisation
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialisation for stable hashing.
 *
 * Rules (applied recursively):
 *  1. Object keys sorted lexicographically (ASCII, case-sensitive).
 *  2. `undefined` values are OMITTED entirely (never serialised as null).
 *  3. Numbers normalised: `-0` → `0`; `NaN` / `±Infinity` → throws TypeError.
 *  4. Strings normalised via NFC Unicode normalisation.
 *  5. Arrays preserved in order.
 *  6. `null` preserved as null.
 */
export function canonicaliseForHash(value: unknown): string {
  return serialise(value);
}

function serialise(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    // Top-level undefined — should not appear in well-formed inputs,
    // but matches JSON.stringify(undefined) which returns undefined (not a string).
    // Here we throw to surface the bug early.
    throw new TypeError('canonicaliseForHash: top-level undefined is not serialisable');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      throw new TypeError('canonicaliseForHash: NaN is not serialisable');
    }
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicaliseForHash: ${value} is not serialisable`);
    }
    // Normalise -0 → 0
    if (Object.is(value, -0)) {
      return '0';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    // NFC Unicode normalisation
    return JSON.stringify(value.normalize('NFC'));
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === undefined) {
        // Arrays with undefined elements are treated as null (matching JSON spec)
        return 'null';
      }
      return serialise(item);
    });
    return '[' + items.join(',') + ']';
  }
  if (typeof value === 'object') {
    // Sort keys lexicographically, omit undefined values
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const pairs: string[] = [];
    for (const key of sortedKeys) {
      const v = obj[key];
      if (v === undefined) {
        // Rule 2: omit undefined values
        continue;
      }
      pairs.push(JSON.stringify(key) + ':' + serialise(v));
    }
    return '{' + pairs.join(',') + '}';
  }
  throw new TypeError(`canonicaliseForHash: unsupported type: ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Idempotency key shape error
// ---------------------------------------------------------------------------

export class IdempotencyKeyShapeError extends Error {
  readonly missingField: string;

  constructor(field: string) {
    super(`IdempotencyKeyShapeError: field '${field}' resolved to undefined in input`);
    this.name = 'IdempotencyKeyShapeError';
    this.missingField = field;
  }
}

// ---------------------------------------------------------------------------
// hashKeyShape
// ---------------------------------------------------------------------------

/**
 * Resolve dot-path fields from `input` and produce a SHA-256 hex digest.
 *
 * Throws `IdempotencyKeyShapeError` if any keyShape field resolves to undefined.
 *
 * Field-resolution semantics:
 *  - Dot-paths traverse nested objects: 'customer.id' resolves input.customer.id.
 *  - Arrays addressed positionally: 'recipients.0.email'.
 *  - If a field is undefined after traversal → throws IdempotencyKeyShapeError.
 */
export function hashKeyShape(keyShape: string[], input: Record<string, unknown>): string {
  const resolved: Record<string, unknown> = {};
  for (const field of keyShape) {
    const value = resolveDotPath(field, input);
    if (value === undefined) {
      throw new IdempotencyKeyShapeError(field);
    }
    resolved[field] = value;
  }
  const canonical = canonicaliseForHash(resolved);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function resolveDotPath(path: string, obj: unknown): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object' && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Claim timeout constant
// ---------------------------------------------------------------------------

/** Claim timeout — wrapper reclaims in_flight rows older than this. */
export const IDEMPOTENCY_CLAIM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Test-mode invariant (§16A.1)
// ---------------------------------------------------------------------------

/**
 * Test-mode invariant per §16A.1. In test environments (NODE_ENV=test),
 * throws if called when isFirstWriter is false — the handler should not
 * be invoked when the wrapper is returning a cached response.
 * No-op in production.
 */
export function assertHandlerInvokedWithClaim(isFirstWriter: boolean): void {
  if (process.env['NODE_ENV'] === 'test' && !isFirstWriter) {
    throw new Error(
      'assertHandlerInvokedWithClaim: handler invoked with isFirstWriter=false in test environment. ' +
      'The wrapper should return the cached response without invoking the handler.',
    );
  }
}
