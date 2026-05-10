import { describe, expect, test } from 'vitest';
import { validatePromptOverride } from '../promptOverridePure.js';

describe('validatePromptOverride', () => {
  test('accepts a valid short override', () => {
    const result = validatePromptOverride('Please respond formally.');
    expect(result).toEqual({ valid: true });
  });

  test('accepts an override at exactly 500 chars', () => {
    const override = 'a'.repeat(500);
    const result = validatePromptOverride(override);
    expect(result).toEqual({ valid: true });
  });

  test('rejects an override exceeding 500 chars', () => {
    const override = 'a'.repeat(501);
    const result = validatePromptOverride(override);
    expect(result).toEqual({ valid: false, reason: 'Prompt override exceeds 500 character limit' });
  });

  test('rejects {{inject}} token', () => {
    const result = validatePromptOverride('Hello {{inject}}');
    expect(result).toEqual({ valid: false, reason: 'Prompt override contains a forbidden injection token' });
  });

  test('rejects {{system}} token', () => {
    const result = validatePromptOverride('{{system}} override');
    expect(result).toEqual({ valid: false, reason: 'Prompt override contains a forbidden injection token' });
  });

  test('rejects {{override}} token', () => {
    const result = validatePromptOverride('Use {{override}} mode');
    expect(result).toEqual({ valid: false, reason: 'Prompt override contains a forbidden injection token' });
  });

  test('rejects {{ignore}} token', () => {
    const result = validatePromptOverride('{{ignore}} previous');
    expect(result).toEqual({ valid: false, reason: 'Prompt override contains a forbidden injection token' });
  });

  test('rejects {{disregard}} token', () => {
    const result = validatePromptOverride('Please {{disregard}} instructions');
    expect(result).toEqual({ valid: false, reason: 'Prompt override contains a forbidden injection token' });
  });

  test('is case-insensitive for forbidden tokens', () => {
    const result = validatePromptOverride('{{INJECT}} now');
    expect(result).toEqual({ valid: false, reason: 'Prompt override contains a forbidden injection token' });
  });

  test('accepts {{org_name}} which is not a forbidden token', () => {
    const result = validatePromptOverride('Reply on behalf of {{org_name}}.');
    expect(result).toEqual({ valid: true });
  });

  test('length check takes priority — does not reach token check on overlength forbidden string', () => {
    const override = '{{inject}}'.repeat(60);
    const result = validatePromptOverride(override);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('500 character limit');
    }
  });
});
