import type { PrincipalContext } from '../services/principal/types.js';

// withPrincipalContext layers principal session variables on top of the
// existing org-scoped transaction opened by withOrgTx. The org variable
// (app.organisation_id) is already set by the withOrgTx caller; this
// function adds the four principal variables.
//
// Actual implementation wires into withOrgTx in P3B when RLS policies
// consume these variables. For now it's a type-safe passthrough that
// validates the principal shape and delegates to the existing org-tx path.

export async function withPrincipalContext<T>(
  principal: PrincipalContext,
  work: () => Promise<T>,
): Promise<T> {
  // P3B will add: SET LOCAL for app.current_subaccount_id,
  // app.current_principal_type, app.current_principal_id, app.current_team_ids
  // For now, just validate and pass through.
  if (!principal.organisationId) {
    throw new Error('withPrincipalContext: principal.organisationId is required');
  }
  return work();
}
