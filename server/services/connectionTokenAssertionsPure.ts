/**
 * connectionTokenAssertionsPure
 *
 * Pure decision function for D.3: cross-tenant token-refresh assertion
 * logic. Mirrors the inline checks in connectionTokenService.refreshToken
 * (around the principalOrgId / connection.organisationId comparison) so
 * the rule is testable in isolation without spinning up auth/RLS context.
 */

export type AssertionResult = 'allow' | 'missing_principal' | 'cross_tenant';

export function decideTokenRefreshAssertion({
  principalOrgId,
  connectionOrgId,
  isSystemContext = true,
}: {
  principalOrgId: string | null | undefined;
  connectionOrgId: string;
  isSystemContext?: boolean;
}): AssertionResult {
  if (principalOrgId === undefined) return 'missing_principal';
  if (principalOrgId === null && !isSystemContext) return 'missing_principal';
  if (principalOrgId === null) return 'allow';
  if (principalOrgId === connectionOrgId) return 'allow';
  return 'cross_tenant';
}
