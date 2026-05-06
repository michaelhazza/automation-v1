/**
 * Pure tests for D.2 — PII substring blacklist in sanitiseMeta.
 */

import { expect, test } from 'vitest';
import { normaliseSecurityEventV2 } from '../securityAuditServicePure.js';
import { auditEvent } from '../../../shared/types/securityAuditEvents.js';

const SENTINEL_ORG = '00000000-0000-0000-0000-000000000000';

function sanitiseViaV2(meta: Record<string, unknown>): Record<string, unknown> {
  const result = normaliseSecurityEventV2({
    event: auditEvent.auth.loginSucceeded,
    organisationId: SENTINEL_ORG,
    meta,
  });
  return result.meta;
}

test('exact key "password" must be redacted', () => {
  const out = sanitiseViaV2({ password: 'hunter2' });
  expect(out['password']).toBe('[redacted]');
});

test('key containing "password" substring must be redacted', () => {
  const out = sanitiseViaV2({ user_password: 'hunter2' });
  expect(out['user_password']).toBe('[redacted]');
});

test('non-PII key "name" must not be redacted', () => {
  const out = sanitiseViaV2({ name: 'John' });
  expect(out['name']).toBe('John');
});

test('AUTH_TOKEN must be redacted (case-insensitive substring match on "token")', () => {
  const out = sanitiseViaV2({ AUTH_TOKEN: 'abc123' });
  expect(out['AUTH_TOKEN']).toBe('[redacted]');
});

test('key containing "credential" must be redacted', () => {
  const out = sanitiseViaV2({ client_credential: 'xyz' });
  expect(out['client_credential']).toBe('[redacted]');
});

test('mixed bag — redacted and non-redacted in same object', () => {
  const out = sanitiseViaV2({ name: 'John', client_secret: 'abc', email: 'john@example.com' });
  expect(out['name']).toBe('John');
  expect(out['client_secret']).toBe('[redacted]');
  expect(out['email']).toBe('john@example.com');
});
