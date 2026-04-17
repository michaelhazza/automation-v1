import { buildServicePrincipal } from './principalContext.js';
import type { PrincipalContext } from './types.js';

/**
 * TEMPORARY migration shim — converts a bare orgId into a ServicePrincipal
 * tagged with the 'service:legacy-shim' sentinel. This lets callers that
 * still pass raw orgId strings participate in the principal-based API while
 * we incrementally migrate them to supply a real PrincipalContext.
 *
 * Every call-site that uses fromOrgId() is a migration candidate for P3B.
 */
export function fromOrgId(orgId: string, subaccountId?: string): PrincipalContext {
  return buildServicePrincipal({
    organisationId: orgId,
    subaccountId: subaccountId ?? null,
    serviceId: 'service:legacy-shim',
  });
}
