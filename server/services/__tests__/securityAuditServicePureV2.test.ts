/**
 * Pure-function tests for normaliseSecurityEventV2.
 */

import { expect, test } from 'vitest';
import { normaliseSecurityEventV2 } from '../securityAuditServicePure.js';
import { auditEvent } from '../../../shared/types/securityAuditEvents.js';

test('severity from factory entry injected into meta', () => {
  const result = normaliseSecurityEventV2({
    event: auditEvent.security.crossTenantAttempt,
    organisationId: 'org-1',
  });
  expect(result.meta.severity).toBe('security_boundary');
  expect(result.eventType).toBe('security.cross_tenant_attempt');
});

test('no severity key when factory entry has no severity', () => {
  const result = normaliseSecurityEventV2({
    event: auditEvent.auth.loginFailed,
    organisationId: 'org-1',
  });
  expect(Object.prototype.hasOwnProperty.call(result.meta, 'severity')).toBe(false);
});

test('factory severity wins over caller-supplied meta severity', () => {
  const result = normaliseSecurityEventV2({
    event: auditEvent.security.crossTenantAttempt,
    organisationId: 'org-1',
    meta: { severity: 'rate_limit' },
  });
  expect(result.meta.severity).toBe('security_boundary');
});
