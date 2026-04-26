// Fixture: spread first argument — VIOLATION.
// The gate must reject spread expressions in first-arg position because the
// resulting shape is not statically inspectable.
//
// Reference fixture for scripts/verify-principal-context-propagation.sh.
// Not imported anywhere; not part of the gate's run set.
import { canonicalDataService } from '../../../server/services/canonicalDataService.js';

export async function loadAccount(args: [unknown, string]) {
  // VIOLATION — spread expression as the first argument.
  return canonicalDataService.getAccountById(...args as never);
}
