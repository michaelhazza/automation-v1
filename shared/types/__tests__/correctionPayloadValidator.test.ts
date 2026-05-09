// shared/types/__tests__/correctionPayloadValidator.test.ts
// Unit tests for correctionPayloadValidator pure function.
// Trust & Verification Layer spec §13.2 test considerations.

import { describe, it, expect } from 'vitest';
import { correctionPayloadValidator } from '../correction';

describe('correctionPayloadValidator', () => {
  it('returns null for a valid payload', () => {
    expect(correctionPayloadValidator({
      editedOutput: 'Corrected response text',
      reason: 'Wrong tone',
    })).toBeNull();
  });

  it('returns null when reason is null', () => {
    expect(correctionPayloadValidator({
      editedOutput: 'Some output',
      reason: null,
    })).toBeNull();
  });

  it('returns EDITED_OUTPUT_EMPTY for empty string', () => {
    expect(correctionPayloadValidator({
      editedOutput: '',
      reason: null,
    })).toBe('EDITED_OUTPUT_EMPTY');
  });

  it('returns EDITED_OUTPUT_EMPTY for whitespace-only string', () => {
    expect(correctionPayloadValidator({
      editedOutput: '   ',
      reason: null,
    })).toBe('EDITED_OUTPUT_EMPTY');
  });

  it('returns EDITED_OUTPUT_TOO_LARGE for output exceeding 50KB', () => {
    const huge = 'x'.repeat(51_000);
    expect(correctionPayloadValidator({
      editedOutput: huge,
      reason: null,
    })).toBe('EDITED_OUTPUT_TOO_LARGE');
  });

  it('returns null for output at exactly 50000 bytes (ASCII)', () => {
    const exact = 'x'.repeat(50_000);
    expect(correctionPayloadValidator({
      editedOutput: exact,
      reason: null,
    })).toBeNull();
  });

  it('returns REASON_TOO_LONG for reason over 500 chars', () => {
    const longReason = 'r'.repeat(501);
    expect(correctionPayloadValidator({
      editedOutput: 'Valid output',
      reason: longReason,
    })).toBe('REASON_TOO_LONG');
  });

  it('returns null for reason at exactly 500 chars', () => {
    const reason = 'r'.repeat(500);
    expect(correctionPayloadValidator({
      editedOutput: 'Valid output',
      reason,
    })).toBeNull();
  });

  it('checks editedOutput before reason (EDITED_OUTPUT_EMPTY takes priority)', () => {
    const longReason = 'r'.repeat(600);
    expect(correctionPayloadValidator({
      editedOutput: '',
      reason: longReason,
    })).toBe('EDITED_OUTPUT_EMPTY');
  });
});
