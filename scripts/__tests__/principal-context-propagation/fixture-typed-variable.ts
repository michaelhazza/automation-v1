// Fixture: locally-typed PrincipalContext variable — PASS.
// The gate accepts identifiers whose same-file declaration is annotated
// `: PrincipalContext` or assigned from `fromOrgId` / `withPrincipalContext`.
//
// Reference fixture for scripts/verify-principal-context-propagation.sh.
// Not imported anywhere; not part of the gate's run set.
import { canonicalDataService } from '../../../server/services/canonicalDataService.js';
import { fromOrgId } from '../../../server/services/principal/fromOrgId.js';
import type { PrincipalContext } from '../../../server/services/principal/types.js';

export async function loadAccountTypedAnnotation(accountId: string) {
  // PASS — `principal` carries an explicit `: PrincipalContext` annotation.
  const principal: PrincipalContext = fromOrgId('00000000-0000-0000-0000-000000000000');
  return canonicalDataService.getAccountById(principal, accountId);
}

export async function loadAccountAssignedFromShim(organisationId: string, accountId: string) {
  // PASS — `principal` is assigned from fromOrgId(...), which the gate traces.
  const principal = fromOrgId(organisationId);
  return canonicalDataService.getAccountById(principal, accountId);
}
