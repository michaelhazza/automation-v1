import { createHash } from 'node:crypto';

/**
 * Canonicalise an override body before hashing.
 * Order (INVARIANT I4, spec §6):
 *   (a) Unicode NFC normalisation
 *   (b) CRLF + lone CR → LF
 *   (c) trim leading/trailing whitespace
 *   (d) collapse internal whitespace runs to single space
 *   (e) preserve case
 * The canonical form contains no newlines.
 */
export function canonicaliseBody(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('canonicaliseBody: input must be string');
  }
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * SHA-256 hex (lower-case) of the canonicalised body.
 * Caller MUST pass output of canonicaliseBody.
 */
export function hashBody(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export type DbStatus = 'active' | 'draft' | 'pending_review' | 'rejected';
export type ContractStatus = 'pending_review' | 'in_use' | 'ignored';

export class UnknownEnumValueError extends Error {
  constructor(public readonly enumName: string, public readonly value: string) {
    super(`Unknown ${enumName} value: ${value}`);
    this.name = 'UnknownEnumValueError';
  }
}

/**
 * INVARIANT I2 — fail closed on unknown enum value.
 */
export function dbStatusToContract(s: DbStatus): ContractStatus {
  switch (s) {
    case 'active':         return 'in_use';
    case 'draft':
    case 'pending_review': return 'pending_review';
    case 'rejected':       return 'ignored';
    default: {
      const _exhaustive: never = s;
      throw new UnknownEnumValueError('memory_blocks.status', _exhaustive as string);
    }
  }
}

/**
 * Confidence mapping: DB 'low' → 0.4, 'normal' → 0.85. Documented gap (plan §3 Gap 3).
 */
export function dbConfidenceToContract(c: 'low' | 'normal' | null | undefined): number {
  if (c === 'low') return 0.4;
  return 0.85;
}

/**
 * Override is only allowed on 'active' (in_use) rows. Spec §4.1.
 */
export function isOverrideAllowed(dbStatus: DbStatus): boolean {
  return dbStatus === 'active';
}
