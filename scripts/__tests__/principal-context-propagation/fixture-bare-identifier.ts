// Fixture: bare-identifier first argument — VIOLATION.
// The gate should flag this call because `organisationId` is a string, not a
// PrincipalContext, and there is no same-file annotation typing it as one.
//
// Reference fixture for scripts/verify-principal-context-propagation.sh.
// Not imported anywhere; not part of the gate's run set.
import { canonicalDataService } from '../../../server/services/canonicalDataService.js';

export async function loadAccount(organisationId: string, accountId: string) {
  // VIOLATION — bare string identifier as the first argument.
  return canonicalDataService.getAccountById(organisationId, accountId);
}
