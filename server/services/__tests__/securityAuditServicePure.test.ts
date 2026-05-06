import { describe, it, expect } from 'vitest';
import { normaliseSecurityEvent } from '../securityAuditServicePure.js';

describe('normaliseSecurityEvent', () => {
  const base = { organisationId: 'org-1', eventType: 'auth.login.success' as const };

  it('redacts password and token in meta', () => {
    const result = normaliseSecurityEvent({
      ...base,
      meta: { password: 'p4ss', token: 't', email: 'a@b.com' },
    });
    expect(result.meta).toEqual({ password: '[redacted]', token: '[redacted]', email: 'a@b.com' });
  });

  it('truncates oversized meta', () => {
    const big = { blob: 'x'.repeat(20_000) };
    const result = normaliseSecurityEvent({ ...base, meta: big });
    expect(result.meta?._truncated).toBe(true);
    expect(typeof result.meta?.originalBytes).toBe('number');
  });

  it('passes through small meta unchanged', () => {
    const result = normaliseSecurityEvent({ ...base, meta: { x: 1 } });
    expect(result.meta).toEqual({ x: 1 });
  });
});
