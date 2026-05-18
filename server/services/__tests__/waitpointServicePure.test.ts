import { describe, test, expect } from 'vitest';
import {
  generateWaitpointPlaintext,
  validateCreateWaitpointParams,
  isCompletableWaitpointRow,
  validateCompleteInputShapeMatchesKind,
} from '../waitpointServicePure.js';

describe('generateWaitpointPlaintext', () => {
  test('returns a 64-character hex string', () => {
    const plaintext = generateWaitpointPlaintext();
    expect(plaintext).toMatch(/^[a-f0-9]{64}$/);
  });

  test('returns a different value on each call', () => {
    const a = generateWaitpointPlaintext();
    const b = generateWaitpointPlaintext();
    expect(a).not.toBe(b);
  });
});

describe('validateCreateWaitpointParams', () => {
  const base = {
    organisationId: 'org-1',
    expiresInSeconds: 3600,
    resumePayload: {},
  };

  test('oauth: throws VALIDATION_FAILED when boundRunId is missing', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'oauth',
        resumeQueue: 'agent-run-resume-from-waitpoint',
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
  });

  test('oauth: throws VALIDATION_FAILED when resumeQueue is null', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'oauth',
        boundRunId: 'run-1',
        resumeQueue: null,
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
  });

  test('oauth: passes with valid boundRunId and resumeQueue', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'oauth',
        boundRunId: 'run-1',
        resumeQueue: 'agent-run-resume-from-waitpoint',
      }),
    ).not.toThrow();
  });

  test('approval: throws VALIDATION_FAILED when resumeQueue is non-null', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'approval',
        resumeQueue: 'some-queue',
        resumePayload: { approvedActionId: 'a1', workflowStepRunId: 's1' },
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
  });

  test('approval: throws VALIDATION_FAILED when approvedActionId is missing', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'approval',
        resumeQueue: null,
        resumePayload: { workflowStepRunId: 's1' },
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
  });

  test('approval: throws VALIDATION_FAILED when workflowStepRunId is missing', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'approval',
        resumeQueue: null,
        resumePayload: { approvedActionId: 'a1' },
      }),
    ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
  });

  test('approval: passes with required payload fields', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'approval',
        resumeQueue: null,
        resumePayload: { approvedActionId: 'a1', workflowStepRunId: 's1' },
      }),
    ).not.toThrow();
  });

  test('external_event: passes with no special requirements', () => {
    expect(() =>
      validateCreateWaitpointParams({
        ...base,
        kind: 'external_event',
        resumeQueue: null,
      }),
    ).not.toThrow();
  });
});

describe('isCompletableWaitpointRow', () => {
  const now = new Date('2026-05-19T10:00:00Z');

  test('returns true for pending row not yet expired', () => {
    const row = { status: 'pending', expiresAt: new Date('2026-05-19T11:00:00Z') };
    expect(isCompletableWaitpointRow(row, now)).toBe(true);
  });

  test('returns false for pending row already expired', () => {
    const row = { status: 'pending', expiresAt: new Date('2026-05-19T09:00:00Z') };
    expect(isCompletableWaitpointRow(row, now)).toBe(false);
  });

  test('returns false for completed row', () => {
    const row = { status: 'completed', expiresAt: new Date('2026-05-19T11:00:00Z') };
    expect(isCompletableWaitpointRow(row, now)).toBe(false);
  });

  test('returns false for expired row', () => {
    const row = { status: 'expired', expiresAt: new Date('2026-05-19T11:00:00Z') };
    expect(isCompletableWaitpointRow(row, now)).toBe(false);
  });

  test('returns false when expiresAt exactly equals now', () => {
    const row = { status: 'pending', expiresAt: now };
    expect(isCompletableWaitpointRow(row, now)).toBe(false);
  });
});

describe('validateCompleteInputShapeMatchesKind', () => {
  test('plaintext × oauth is legal (no-op)', () => {
    expect(() => validateCompleteInputShapeMatchesKind('plaintext', 'oauth')).not.toThrow();
  });

  test('waitpointId × approval is legal (no-op)', () => {
    expect(() => validateCompleteInputShapeMatchesKind('waitpointId', 'approval')).not.toThrow();
  });

  test('waitpointId × external_event is legal (no-op)', () => {
    expect(() => validateCompleteInputShapeMatchesKind('waitpointId', 'external_event')).not.toThrow();
  });

  test('plaintext × approval throws INTERNAL_ERROR', () => {
    expect(() => validateCompleteInputShapeMatchesKind('plaintext', 'approval')).toThrow(
      expect.objectContaining({ errorCode: 'INTERNAL_ERROR' }),
    );
  });

  test('plaintext × external_event throws INTERNAL_ERROR', () => {
    expect(() => validateCompleteInputShapeMatchesKind('plaintext', 'external_event')).toThrow(
      expect.objectContaining({ errorCode: 'INTERNAL_ERROR' }),
    );
  });

  test('waitpointId × oauth throws INTERNAL_ERROR', () => {
    expect(() => validateCompleteInputShapeMatchesKind('waitpointId', 'oauth')).toThrow(
      expect.objectContaining({ errorCode: 'INTERNAL_ERROR' }),
    );
  });
});
