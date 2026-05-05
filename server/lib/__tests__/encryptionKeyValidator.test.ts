import { describe, it, expect, afterEach } from 'vitest';
import { validateEncryptionKeyOrThrow } from '../../services/connectionTokenValidation.js';

describe('validateEncryptionKeyOrThrow', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    }
    process.env.NODE_ENV = originalEnv;
  });

  it('throws in production when missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => validateEncryptionKeyOrThrow()).toThrow(/required in production/);
  });

  it('warns in dev when missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'development';
    expect(() => validateEncryptionKeyOrThrow()).not.toThrow();
  });

  it('throws on malformed key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'too-short';
    expect(() => validateEncryptionKeyOrThrow()).toThrow(/decode to 32 bytes/);
  });

  it('accepts a valid hex key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    expect(() => validateEncryptionKeyOrThrow()).not.toThrow();
  });
});
