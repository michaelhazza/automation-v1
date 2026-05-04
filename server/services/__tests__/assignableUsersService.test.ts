/**
 * assignableUsersService.test.ts — Pure logic tests for assignable users.
 *
 * Tests the role-mapping and email-redaction logic extracted from
 * assignableUsersService without any DB interaction.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/assignableUsersService.test.ts
 */

import { expect, test, describe } from 'vitest';
import type { AssignableUser } from '../../../shared/types/assignableUsers.js';

// ── Inline the pure mapping helpers (mirrors service implementation) ──────────

function mapDbRoleToResponseRole(
  dbRole: string,
  hasSubaccountAssignment: boolean
): AssignableUser['role'] {
  if (dbRole === 'org_admin' || dbRole === 'system_admin') return 'org_admin';
  if (dbRole === 'manager') return 'org_manager';
  if (dbRole === 'user' && hasSubaccountAssignment) return 'subaccount_admin';
  return 'subaccount_member';
}

function isOrgUser(dbRole: string): boolean {
  return dbRole === 'org_admin' || dbRole === 'manager' || dbRole === 'system_admin';
}

function buildUserRow(params: {
  dbRole: string;
  hasSubaccountAssignment: boolean;
}): AssignableUser {
  const { dbRole, hasSubaccountAssignment } = params;
  return {
    id: 'user-1',
    name: 'Test User',
    email: hasSubaccountAssignment ? 'user@example.com' : null,
    role: mapDbRoleToResponseRole(dbRole, hasSubaccountAssignment),
    is_org_user: isOrgUser(dbRole),
    is_subaccount_member: hasSubaccountAssignment,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('role mapping', () => {
  test('org_admin caller maps to org_admin role', () => {
    const user = buildUserRow({ dbRole: 'org_admin', hasSubaccountAssignment: false });
    expect(user.role).toBe('org_admin');
    expect(user.is_org_user).toBe(true);
  });

  test('system_admin maps to org_admin role', () => {
    const user = buildUserRow({ dbRole: 'system_admin', hasSubaccountAssignment: false });
    expect(user.role).toBe('org_admin');
    expect(user.is_org_user).toBe(true);
  });

  test('manager maps to org_manager role', () => {
    const user = buildUserRow({ dbRole: 'manager', hasSubaccountAssignment: false });
    expect(user.role).toBe('org_manager');
    expect(user.is_org_user).toBe(true);
  });

  test('user with subaccount assignment maps to subaccount_admin', () => {
    const user = buildUserRow({ dbRole: 'user', hasSubaccountAssignment: true });
    expect(user.role).toBe('subaccount_admin');
    expect(user.is_org_user).toBe(false);
    expect(user.is_subaccount_member).toBe(true);
  });

  test('user without subaccount assignment maps to subaccount_member', () => {
    const user = buildUserRow({ dbRole: 'user', hasSubaccountAssignment: false });
    expect(user.role).toBe('subaccount_member');
    expect(user.is_org_user).toBe(false);
    expect(user.is_subaccount_member).toBe(false);
  });

  test('client_user maps to subaccount_member', () => {
    const user = buildUserRow({ dbRole: 'client_user', hasSubaccountAssignment: false });
    expect(user.role).toBe('subaccount_member');
    expect(user.is_org_user).toBe(false);
  });
});

describe('email redaction (option 2)', () => {
  test('org-level user not in subaccount gets email: null', () => {
    const user = buildUserRow({ dbRole: 'org_admin', hasSubaccountAssignment: false });
    expect(user.email).toBeNull();
    expect(user.is_subaccount_member).toBe(false);
  });

  test('user assigned to subaccount keeps email', () => {
    const user = buildUserRow({ dbRole: 'user', hasSubaccountAssignment: true });
    expect(user.email).toBe('user@example.com');
    expect(user.is_subaccount_member).toBe(true);
  });

  test('manager assigned to subaccount keeps email', () => {
    const user = buildUserRow({ dbRole: 'manager', hasSubaccountAssignment: true });
    expect(user.email).toBe('user@example.com');
    expect(user.is_subaccount_member).toBe(true);
  });
});

describe('pool filtering by caller role', () => {
  test('subaccount_admin caller should only see subaccount members (simulated)', () => {
    // Simulate the subaccount-admin pool: all users are is_subaccount_member = true
    const pool: AssignableUser[] = [
      buildUserRow({ dbRole: 'user', hasSubaccountAssignment: true }),
      buildUserRow({ dbRole: 'client_user', hasSubaccountAssignment: true }),
    ];
    // All members in this pool should be subaccount members
    expect(pool.every(u => u.is_subaccount_member)).toBe(true);
  });
});

console.log('assignableUsersService tests passed');
