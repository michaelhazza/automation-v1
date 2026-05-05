/**
 * securityAuditServicePureV2.test.ts — Pure-function tests for normaliseSecurityEventV2.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/securityAuditServicePureV2.test.ts
 */

import assert from 'node:assert/strict';
import { normaliseSecurityEventV2 } from '../securityAuditServicePure.js';
import { auditEvent } from '../../../shared/types/securityAuditEvents.js';

// ─── Test 1: severity from factory entry injected into meta ──────────────────

{
  const result = normaliseSecurityEventV2({
    event: auditEvent.security.crossTenantAttempt,
    organisationId: 'org-1',
  });

  assert.equal(result.meta.severity, 'security_boundary', 'meta.severity should be security_boundary');
  assert.equal(result.eventType, 'security.cross_tenant_attempt', 'eventType should be security.cross_tenant_attempt');
  console.log('PASS: severity from factory entry injected into meta');
}

// ─── Test 2: no severity key when factory entry has no severity ──────────────

{
  const result = normaliseSecurityEventV2({
    event: auditEvent.auth.loginFailed,
    organisationId: 'org-1',
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(result.meta, 'severity'),
    false,
    'meta should not contain severity key when factory entry has no severity',
  );
  console.log('PASS: no severity key when factory entry has no severity');
}

// ─── Test 3: factory severity wins over caller-supplied meta severity ─────────

{
  const result = normaliseSecurityEventV2({
    event: auditEvent.security.crossTenantAttempt,
    organisationId: 'org-1',
    meta: { severity: 'rate_limit' },
  });

  assert.equal(result.meta.severity, 'security_boundary', 'factory severity should win over caller-supplied meta severity');
  console.log('PASS: factory severity wins over caller-supplied meta severity');
}

console.log('\nAll normaliseSecurityEventV2 pure tests passed.');
