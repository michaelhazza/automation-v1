import { describe, it, expect } from 'vitest';
import {
  detectNamedOwnerReference,
  extractTrustedToolCallOwner,
  normaliseDisplayName,
} from '../crossOwnerDelegationAuthorisationPure.js';

describe('detectNamedOwnerReference', () => {
  it("returns candidateName for Michael's calendar", () => {
    expect(detectNamedOwnerReference("check Michael's calendar")).toEqual({ candidateName: 'Michael' });
  });

  it("returns candidateName for my colleague Jane's inbox", () => {
    expect(detectNamedOwnerReference("get my colleague Jane's inbox")).toEqual({ candidateName: 'Jane' });
  });

  it('returns null when no possessive pattern', () => {
    expect(detectNamedOwnerReference('send an email to the team')).toBeNull();
  });
});

describe('extractTrustedToolCallOwner', () => {
  it('returns the user id when target_owner_user_id is present', () => {
    expect(extractTrustedToolCallOwner({ target_owner_user_id: 'user-123' })).toBe('user-123');
  });

  it('returns null when target_owner_user_id is empty string', () => {
    expect(extractTrustedToolCallOwner({ target_owner_user_id: '' })).toBeNull();
  });

  it('returns null when target_owner_user_id is absent', () => {
    expect(extractTrustedToolCallOwner({})).toBeNull();
  });
});

describe('normaliseDisplayName', () => {
  it('lowercases and trims', () => {
    expect(normaliseDisplayName('  Michael  ')).toBe('michael');
  });

  it('collapses internal spaces', () => {
    expect(normaliseDisplayName('John  Smith')).toBe('john smith');
  });
});
