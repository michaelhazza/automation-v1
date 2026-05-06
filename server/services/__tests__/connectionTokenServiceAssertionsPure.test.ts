/**
 * Pure tests for D.3 — connection-token cross-tenant assertion logic.
 * No IO; pure decision function only.
 */

import { strict as assert } from 'assert';

type AssertionResult = 'allow' | 'missing_principal' | 'cross_tenant';

function decideTokenRefreshAssertion({
  principalOrgId,
  connectionOrgId,
  isSystemContext = true,
}: {
  principalOrgId: string | null | undefined;
  connectionOrgId: string;
  isSystemContext?: boolean;
}): AssertionResult {
  if (principalOrgId === undefined) return 'missing_principal';
  // null = system-flow — only allowed when isSystemContext is true
  if (principalOrgId === null && !isSystemContext) return 'missing_principal';
  if (principalOrgId === null) return 'allow';
  if (principalOrgId === connectionOrgId) return 'allow';
  return 'cross_tenant';
}

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// undefined → missing_principal
{
  const result = decideTokenRefreshAssertion({ principalOrgId: undefined, connectionOrgId: ORG_A });
  assert.equal(result, 'missing_principal', 'undefined principalOrgId → missing_principal');
}

// null → allow (system flow override)
{
  const result = decideTokenRefreshAssertion({ principalOrgId: null, connectionOrgId: ORG_A });
  assert.equal(result, 'allow', 'null principalOrgId → allow (system context)');
}

// matching org → allow
{
  const result = decideTokenRefreshAssertion({ principalOrgId: ORG_A, connectionOrgId: ORG_A });
  assert.equal(result, 'allow', 'matching org IDs → allow');
}

// mismatched org → cross_tenant
{
  const result = decideTokenRefreshAssertion({ principalOrgId: ORG_B, connectionOrgId: ORG_A });
  assert.equal(result, 'cross_tenant', 'mismatched org IDs → cross_tenant');
}

// null + isSystemContext=false → missing_principal (null principal outside system context)
{
  const result = decideTokenRefreshAssertion({ principalOrgId: null, connectionOrgId: ORG_A, isSystemContext: false });
  assert.equal(result, 'missing_principal', 'null principal outside system context → missing_principal');
}

console.log('connectionTokenServiceAssertionsPure: all assertions passed');
