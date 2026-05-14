// Fixture: fromOrgId(...) first argument — PASS.
// The gate accepts inline calls to the migration shim constructor.
//
// Reference fixture for scripts/verify-principal-context-propagation.sh.
// Not imported anywhere; not part of the gate's run set.
import { canonicalDataService } from '../../../server/services/canonicalDataService.js';
import { fromOrgId } from '../../../server/services/principal/fromOrgId.js';

export async function loadAccount(organisationId: string, accountId: string) {
  // PASS — fromOrgId(...) is on the gate's positive allowlist.
  return canonicalDataService.getAccountById(fromOrgId(organisationId), accountId);
}
