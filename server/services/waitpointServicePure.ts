// ---------------------------------------------------------------------------
// waitpointServicePure.ts
//
// Pure helpers for waitpointService — no DB I/O, no telemetry, no pg-boss.
// These are extracted to enable unit testing of validation and predicate logic
// in isolation.
//
// Spec: docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md §5.1, §5.2
// ---------------------------------------------------------------------------

import crypto from 'crypto';

export type WaitpointKind = 'oauth' | 'approval' | 'external_event';

export interface CreateWaitpointParams {
  kind: WaitpointKind;
  organisationId: string;
  subaccountId?: string;
  boundRunId?: string;
  expiresInSeconds: number;
  resumeQueue: string | null;
  resumePayload: Record<string, unknown>;
}

/** Generates a 32-byte random token as a 64-char hex string. */
export function generateWaitpointPlaintext(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validates the params for createWaitpoint. Throws with errorCode
 * 'VALIDATION_FAILED' for any invalid combination. The DB CHECK constraints
 * are defence-in-depth; this provides fast feedback at the service boundary.
 */
export function validateCreateWaitpointParams(params: CreateWaitpointParams): void {
  if (params.kind === 'oauth') {
    if (!params.boundRunId) {
      throw Object.assign(
        new Error('boundRunId is required for oauth waitpoints'),
        { statusCode: 400, errorCode: 'VALIDATION_FAILED' as const },
      );
    }
    if (params.resumeQueue === null) {
      throw Object.assign(
        new Error('resumeQueue is required for oauth waitpoints'),
        { statusCode: 400, errorCode: 'VALIDATION_FAILED' as const },
      );
    }
  }

  if (params.kind === 'approval') {
    if (params.resumeQueue !== null) {
      throw Object.assign(
        new Error('approval waitpoints must not specify resumeQueue (Path B inline resume — see §5.2)'),
        { statusCode: 400, errorCode: 'VALIDATION_FAILED' as const },
      );
    }
    const payload = params.resumePayload as Record<string, unknown>;
    if (!payload.approvedActionId) {
      throw Object.assign(
        new Error('approval waitpoints require resumePayload.approvedActionId'),
        { statusCode: 400, errorCode: 'VALIDATION_FAILED' as const },
      );
    }
    if (!payload.workflowStepRunId) {
      throw Object.assign(
        new Error('approval waitpoints require resumePayload.workflowStepRunId'),
        { statusCode: 400, errorCode: 'VALIDATION_FAILED' as const },
      );
    }
  }
}

/**
 * Returns true iff the waitpoint row is in a state where completeWaitpoint's
 * optimistic UPDATE predicate would match (status pending and not yet expired).
 */
export function isCompletableWaitpointRow(
  row: { status: string; expiresAt: Date },
  now: Date,
): boolean {
  return row.status === 'pending' && row.expiresAt > now;
}

/**
 * Defence-in-depth: asserts that the caller-chosen input shape is consistent
 * with the waitpoint row's kind. Throws INTERNAL_ERROR for the two illegal
 * pairings ({plaintext} × non-oauth and {waitpointId} × oauth).
 *
 * Closes Round 2 finding 5 — makes the shape/kind binding explicit and
 * fail-closed at the service boundary.
 */
export function validateCompleteInputShapeMatchesKind(
  inputShape: 'plaintext' | 'waitpointId',
  rowKind: WaitpointKind,
): void {
  if (inputShape === 'plaintext' && rowKind !== 'oauth') {
    throw Object.assign(
      new Error(`plaintext path used for non-oauth waitpoint kind=${rowKind}`),
      { statusCode: 500, errorCode: 'INTERNAL_ERROR' as const },
    );
  }
  if (inputShape === 'waitpointId' && rowKind === 'oauth') {
    throw Object.assign(
      new Error('waitpointId path used for oauth waitpoint — oauth completion requires plaintext presentation'),
      { statusCode: 500, errorCode: 'INTERNAL_ERROR' as const },
    );
  }
}

// Re-export deriveTokenHash so consumers only need to import from this module.
export { deriveTokenHash } from './agentResumeService.js';
