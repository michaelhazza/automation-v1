/**
 * supportContactResolutionPure.test.ts — Vitest pure tests for email-match resolver.
 *
 * Run:
 *   npx vitest run server/services/__tests__/supportContactResolutionPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { resolveByEmail } from '../supportContactResolutionPure.js';

const contacts = [
  { id: 'contact-1', email: 'alice@example.com' },
  { id: 'contact-2', email: 'bob@example.com' },
];

describe('resolveByEmail', () => {
  it('returns emailMatchCount 0 for null email', () => {
    expect(resolveByEmail(null, contacts)).toEqual({
      canonicalContactId: null,
      emailMatchCount: 0,
    });
  });

  it('returns emailMatchCount 0 for undefined email', () => {
    expect(resolveByEmail(undefined, contacts)).toEqual({
      canonicalContactId: null,
      emailMatchCount: 0,
    });
  });

  it('returns emailMatchCount 0 for empty string email', () => {
    expect(resolveByEmail('', contacts)).toEqual({
      canonicalContactId: null,
      emailMatchCount: 0,
    });
  });

  it('returns canonicalContactId and emailMatchCount 1 for a single match', () => {
    expect(resolveByEmail('alice@example.com', contacts)).toEqual({
      canonicalContactId: 'contact-1',
      emailMatchCount: 1,
    });
  });

  it('returns emailMatchCount "multiple" when two contacts share the same email', () => {
    const dupes = [
      { id: 'contact-a', email: 'shared@example.com' },
      { id: 'contact-b', email: 'shared@example.com' },
    ];
    expect(resolveByEmail('shared@example.com', dupes)).toEqual({
      canonicalContactId: null,
      emailMatchCount: 'multiple',
    });
  });

  it('matches case-insensitively', () => {
    expect(resolveByEmail('Foo@Example.COM', [{ id: 'cx-1', email: 'foo@example.com' }])).toEqual({
      canonicalContactId: 'cx-1',
      emailMatchCount: 1,
    });
  });

  it('trims whitespace before matching', () => {
    expect(resolveByEmail('  foo@bar.com  ', [{ id: 'cx-2', email: 'foo@bar.com' }])).toEqual({
      canonicalContactId: 'cx-2',
      emailMatchCount: 1,
    });
  });

  it('returns emailMatchCount 0 when candidate list is empty', () => {
    expect(resolveByEmail('alice@example.com', [])).toEqual({
      canonicalContactId: null,
      emailMatchCount: 0,
    });
  });
});
