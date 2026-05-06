import { describe, it, expect } from 'vitest';
import { rateLimitKeys } from '../rateLimitKeys.js';

describe('rate-limit key convention', () => {
  it('short and long window keys are distinct for the same (ip, email)', () => {
    const ip = '1.2.3.4';
    const email = 'a@b.com';
    const shortKey = rateLimitKeys.authLogin(ip, email);
    const longKey = rateLimitKeys.authLoginLong(ip, email);
    expect(shortKey).not.toBe(longKey);
    expect(shortKey).toContain('short');
    expect(longKey).toContain('long');
  });

  it('authLogin key is email-case-insensitive', () => {
    const ip = '1.2.3.4';
    expect(rateLimitKeys.authLogin(ip, 'User@Example.COM')).toBe(
      rateLimitKeys.authLogin(ip, 'user@example.com'),
    );
  });

  it('authSignup key includes email dimension', () => {
    const ip = '1.2.3.4';
    const key = rateLimitKeys.authSignup(ip, 'test@example.com');
    expect(key).toContain('signup');
    expect(key).toContain('test@example.com');
  });
});
