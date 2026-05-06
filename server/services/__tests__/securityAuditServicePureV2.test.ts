/**
 * securityAuditServicePureV2.test.ts — Pure-function tests for normaliseSecurityEventV2.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normaliseSecurityEventV2 } from '../securityAuditServicePure.js';
import { auditEvent } from '../../../shared/types/securityAuditEvents.js';

test('severity from factory entry injected into meta', () => {
  const result = normaliseSecurityEventV2({
    event: auditEvent.security.crossTenantAttempt,
    organisationId: 'org-1',
  });
  assert.equal(result.meta.severity, 'security_boundary');
  assert.equal(result.eventType, 'security.cross_tenant_attempt');
});

test('no severity key when factory entry has no severity', () => {
  const result = normaliseSecurityEventV2({
    event: auditEvent.auth.loginFailed,
    organisationId: 'org-1',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.meta, 'severity'),
    false,
  );
});

test('factory severity wins over caller-supplied meta severity', () => {
  const result = normaliseSecurityEventV2({
    event: auditEvent.security.crossTenantAttempt,
    organisationId: 'org-1',
    meta: { severity: 'rate_limit' },
  });
  assert.equal(result.meta.severity, 'security_boundary');
});
