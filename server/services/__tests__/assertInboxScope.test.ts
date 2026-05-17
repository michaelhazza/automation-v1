// SUPPORT-PATCH-SCOPE-ORDER pure unit test (Wave 3 deferred → Wave 5 Session K).
//
// assertInboxScope must throw a 403 support.inbox.scope_mismatch when the
// principal carries a sibling subaccountId compared to the inbox's. The check
// runs BEFORE body validation in supportAgentRoutes — the test verifies the
// pure-function shape so the route-level ordering invariant is enforceable.
//
// Runnable via:
//   npx vitest run server/services/__tests__/assertInboxScope.test.ts

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
process.env.EMAIL_FROM ??= 'skip@placeholder.example';

import { describe, it, expect } from 'vitest';
import { assertInboxScope } from '../supportInboxService.js';
import type { PrincipalContext } from '../principal/types.js';

function makePrincipal(subaccountId: string | null): PrincipalContext {
  return {
    type: 'user',
    id: 'user-1',
    organisationId: 'org-1',
    subaccountId,
    teamIds: [],
  };
}

describe('assertInboxScope — SUPPORT-PATCH-SCOPE-ORDER', () => {
  it('throws 403 support.inbox.scope_mismatch when principal subaccountId mismatches the inbox', () => {
    const inbox = { subaccountId: 'sub-A' };
    const principal = makePrincipal('sub-B');
    let caught: unknown;
    try {
      assertInboxScope(inbox, principal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const errCast = caught as { statusCode: number; errorCode: string };
    expect(errCast.statusCode).toBe(403);
    expect(errCast.errorCode).toBe('support.inbox.scope_mismatch');
  });

  it('passes when principal and inbox share the same subaccountId', () => {
    const inbox = { subaccountId: 'sub-A' };
    const principal = makePrincipal('sub-A');
    expect(() => assertInboxScope(inbox, principal)).not.toThrow();
  });

  it('bypasses for org-tier principals (subaccountId === null)', () => {
    const inbox = { subaccountId: 'sub-A' };
    const principal = makePrincipal(null);
    expect(() => assertInboxScope(inbox, principal)).not.toThrow();
  });
});
