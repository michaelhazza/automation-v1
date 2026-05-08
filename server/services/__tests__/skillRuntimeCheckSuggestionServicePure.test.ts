import { describe, it, expect } from 'vitest';
import {
  deriveCacheKey,
  validateSuggestionResponse,
} from '../skillRuntimeCheckSuggestionServicePure.js';

describe('deriveCacheKey', () => {
  it('returns the same key for the same inputs', () => {
    const a = deriveCacheKey('Sends a customer SMS via Twilio', 'some api spec');
    const b = deriveCacheKey('Sends a customer SMS via Twilio', 'some api spec');
    expect(a).toBe(b);
  });

  it('returns a different key for different descriptions', () => {
    const a = deriveCacheKey('Sends a customer SMS via Twilio');
    const b = deriveCacheKey('Creates a Jira ticket in the project board');
    expect(a).not.toBe(b);
  });

  it('returns a different key when apiSpec differs', () => {
    const a = deriveCacheKey('Sends a customer SMS via Twilio', 'spec v1');
    const b = deriveCacheKey('Sends a customer SMS via Twilio', 'spec v2');
    expect(a).not.toBe(b);
  });

  it('treats missing apiSpec the same as empty string', () => {
    const a = deriveCacheKey('Sends a customer SMS via Twilio');
    const b = deriveCacheKey('Sends a customer SMS via Twilio', '');
    expect(a).toBe(b);
  });

  it('returns a 64-character hex string', () => {
    const key = deriveCacheKey('some description');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('validateSuggestionResponse', () => {
  const validPayload = {
    name: 'SMS via Twilio',
    blastRadius: 'external' as const,
    reversible: false,
    suggestedCheck: {
      kind: 'api_status_2xx',
      parameters: {},
    },
    plainEnglish: 'Verify the Twilio API returns 2xx after sending the SMS.',
  };

  it('returns a typed SuggestionResult for a valid payload', () => {
    const result = validateSuggestionResponse(validPayload);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('SMS via Twilio');
    expect(result!.blastRadius).toBe('external');
    expect(result!.reversible).toBe(false);
    expect(result!.suggestedCheck.kind).toBe('api_status_2xx');
    expect(result!.plainEnglish).toBe('Verify the Twilio API returns 2xx after sending the SMS.');
    expect(result!.cacheHit).toBe(false);
  });

  it('returns null for null input', () => {
    expect(validateSuggestionResponse(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateSuggestionResponse('string')).toBeNull();
    expect(validateSuggestionResponse(42)).toBeNull();
    expect(validateSuggestionResponse([])).toBeNull();
  });

  it('returns null when name is missing', () => {
    const { name: _omitted, ...rest } = validPayload;
    expect(validateSuggestionResponse(rest)).toBeNull();
  });

  it('returns null when name is empty string', () => {
    expect(validateSuggestionResponse({ ...validPayload, name: '' })).toBeNull();
  });

  it('returns null when blastRadius is invalid', () => {
    expect(validateSuggestionResponse({ ...validPayload, blastRadius: 'universe' })).toBeNull();
  });

  it('accepts all valid blastRadius values', () => {
    for (const blastRadius of ['self', 'tenant', 'external'] as const) {
      expect(validateSuggestionResponse({ ...validPayload, blastRadius })).not.toBeNull();
    }
  });

  it('returns null when reversible is not a boolean', () => {
    expect(validateSuggestionResponse({ ...validPayload, reversible: 'yes' })).toBeNull();
  });

  it('returns null when suggestedCheck is missing', () => {
    const { suggestedCheck: _omitted, ...rest } = validPayload;
    expect(validateSuggestionResponse(rest)).toBeNull();
  });

  it('returns null when suggestedCheck.kind is missing', () => {
    expect(validateSuggestionResponse({
      ...validPayload,
      suggestedCheck: { parameters: {} },
    })).toBeNull();
  });

  it('returns null when suggestedCheck.parameters is an array', () => {
    expect(validateSuggestionResponse({
      ...validPayload,
      suggestedCheck: { kind: 'api_status_2xx', parameters: [] },
    })).toBeNull();
  });

  it('returns null when plainEnglish is missing', () => {
    const { plainEnglish: _omitted, ...rest } = validPayload;
    expect(validateSuggestionResponse(rest)).toBeNull();
  });

  it('returns null when plainEnglish is empty string', () => {
    expect(validateSuggestionResponse({ ...validPayload, plainEnglish: '' })).toBeNull();
  });
});
