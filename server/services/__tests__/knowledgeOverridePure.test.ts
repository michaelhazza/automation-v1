import { describe, it, expect } from 'vitest';
import {
  canonicaliseBody, hashBody,
  dbStatusToContract, dbConfidenceToContract,
  isOverrideAllowed,
  UnknownEnumValueError,
  type DbStatus,
} from '../knowledgeOverridePure.js';

describe('knowledgeOverridePure', () => {
  describe('canonicaliseBody', () => {
    it('normalises decomposed Unicode to NFC', () => {
      const decomposed = 'café'; // e + combining acute
      const composed   = 'café'; // é
      expect(canonicaliseBody(decomposed)).toBe(canonicaliseBody(composed));
    });
    it('trims leading and trailing whitespace', () => {
      expect(canonicaliseBody('  hello  ')).toBe('hello');
    });
    it('collapses internal whitespace runs', () => {
      expect(canonicaliseBody('hello   world\t\nfoo')).toBe('hello world foo');
    });
    it('preserves case', () => {
      expect(canonicaliseBody('Hello World')).toBe('Hello World');
    });
    it('is idempotent', () => {
      const once = canonicaliseBody('  Hello   World  ');
      expect(canonicaliseBody(once)).toBe(once);
    });
    it('normalises CRLF and lone CR to LF before whitespace collapse (INVARIANT I4)', () => {
      expect(canonicaliseBody('a\r\nb')).toBe(canonicaliseBody('a\nb'));
      expect(canonicaliseBody('a\rb')).toBe(canonicaliseBody('a\nb'));
      expect(canonicaliseBody('a\r\nb')).toBe('a b');
    });
    it('treats trailing whitespace and trailing newline equivalently', () => {
      expect(canonicaliseBody('hello   ')).toBe(canonicaliseBody('hello\n\n'));
    });
  });

  describe('hashBody', () => {
    it('is deterministic and lower-case hex', () => {
      const a = hashBody(canonicaliseBody('hello'));
      const b = hashBody(canonicaliseBody('hello'));
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
    it('differs for different canonical inputs', () => {
      expect(hashBody('hello')).not.toBe(hashBody('world'));
    });
    it('NFC-equivalent inputs hash identically', () => {
      expect(
        hashBody(canonicaliseBody('café')),
      ).toBe(
        hashBody(canonicaliseBody('café')),
      );
    });
  });

  describe('dbStatusToContract', () => {
    it('maps all four DB values', () => {
      expect(dbStatusToContract('active')).toBe('in_use');
      expect(dbStatusToContract('draft')).toBe('pending_review');
      expect(dbStatusToContract('pending_review')).toBe('pending_review');
      expect(dbStatusToContract('rejected')).toBe('ignored');
    });
    it('throws UnknownEnumValueError on unknown value (INVARIANT I2)', () => {
      expect(() => dbStatusToContract('archived' as unknown as DbStatus)).toThrow(UnknownEnumValueError);
    });
  });

  describe('dbConfidenceToContract', () => {
    it('low → 0.4, normal/null/undefined → 0.85', () => {
      expect(dbConfidenceToContract('low')).toBe(0.4);
      expect(dbConfidenceToContract('normal')).toBe(0.85);
      expect(dbConfidenceToContract(null)).toBe(0.85);
      expect(dbConfidenceToContract(undefined)).toBe(0.85);
    });
  });

  describe('isOverrideAllowed', () => {
    it('true only on DB active', () => {
      expect(isOverrideAllowed('active')).toBe(true);
      expect(isOverrideAllowed('draft')).toBe(false);
      expect(isOverrideAllowed('pending_review')).toBe(false);
      expect(isOverrideAllowed('rejected')).toBe(false);
    });
  });
});
