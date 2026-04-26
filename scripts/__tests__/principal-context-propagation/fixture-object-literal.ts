// Fixture: object-literal first argument — VIOLATION.
// The gate must reject ad-hoc PrincipalContext-shaped object literals; these
// bypass `fromOrgId` / `withPrincipalContext` and the construction discipline
// that goes with them (see spec §A1a step 3).
//
// Reference fixture for scripts/verify-principal-context-propagation.sh.
// Not imported anywhere; not part of the gate's run set.
import { canonicalDataService } from '../../../server/services/canonicalDataService.js';

export async function loadAccount(organisationId: string, accountId: string) {
  // VIOLATION — raw object literal as the first argument.
  return canonicalDataService.getAccountById(
    { organisationId, subaccountId: null, kind: 'service', serviceId: 'service:ad-hoc' } as never,
    accountId,
  );
}
