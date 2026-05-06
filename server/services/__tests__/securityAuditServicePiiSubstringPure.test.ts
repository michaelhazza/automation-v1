/**
 * Pure tests for D.2 — PII substring blacklist in sanitiseMeta.
 * Exercises normaliseSecurityEventV2's sanitisation logic without IO.
 */

import { strict as assert } from 'assert';
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

// exact-match (existing PII_BLACKLIST)
{
  const out = sanitiseViaV2({ password: 'hunter2' });
  assert.equal(out['password'], '[redacted]', 'exact key "password" must be redacted');
}

// substring match — user_password
{
  const out = sanitiseViaV2({ user_password: 'hunter2' });
  assert.equal(out['user_password'], '[redacted]', 'key containing "password" substring must be redacted');
}

// non-PII key — must NOT be redacted
{
  const out = sanitiseViaV2({ name: 'John' });
  assert.equal(out['name'], 'John', 'non-PII key "name" must not be redacted');
}

// case-insensitive substring match — AUTH_TOKEN
{
  const out = sanitiseViaV2({ AUTH_TOKEN: 'abc123' });
  assert.equal(out['AUTH_TOKEN'], '[redacted]', 'AUTH_TOKEN must be redacted (case-insensitive substring match on "token")');
}

// credential substring
{
  const out = sanitiseViaV2({ client_credential: 'xyz' });
  assert.equal(out['client_credential'], '[redacted]', 'key containing "credential" must be redacted');
}

// mixed bag — redacted and non-redacted in same object
{
  const out = sanitiseViaV2({ name: 'John', client_secret: 'abc', email: 'john@example.com' });
  assert.equal(out['name'], 'John', 'non-PII name preserved');
  assert.equal(out['client_secret'], '[redacted]', 'client_secret redacted via substring');
  assert.equal(out['email'], 'john@example.com', 'email preserved');
}

console.log('securityAuditServicePiiSubstringPure: all assertions passed');
