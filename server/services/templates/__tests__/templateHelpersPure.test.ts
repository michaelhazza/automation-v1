import { describe, it, expect } from 'vitest';
import { computeManifestHash, slugify, PARSER_VERSION } from '../templateHelpers.js';

describe('templateHelpers', () => {
  describe('computeManifestHash', () => {
    it('returns the same hash for the same input', () => {
      const input = { name: 'test', slots: [{ id: '1' }] };
      expect(computeManifestHash(input)).toBe(computeManifestHash(input));
    });

    it('returns different hashes for different inputs', () => {
      const a = { name: 'alpha' };
      const b = { name: 'beta' };
      expect(computeManifestHash(a)).not.toBe(computeManifestHash(b));
    });
  });

  describe('slugify', () => {
    it('lowercases and replaces non-alphanumeric with hyphens', () => {
      expect(slugify('Hello World!')).toBe('hello-world');
    });

    it('strips leading and trailing hyphens', () => {
      expect(slugify('  test  ')).toBe('test');
    });
  });

  describe('PARSER_VERSION', () => {
    it('equals 1.0.0', () => {
      expect(PARSER_VERSION).toBe('1.0.0');
    });
  });
});
