// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports"
/**
 * taskVisibilityPure.test.ts
 *
 * Visibility decisions for each role variant.
 *
 * No DB imports. No I/O. All pure functions.
 */

import { describe, expect, test } from 'vitest';
import { assertTaskVisibilityPure } from '../taskVisibilityPure.js';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';
const SA_1  = 'cccccccc-0000-0000-0000-000000000001';
const SA_2  = 'cccccccc-0000-0000-0000-000000000002';
const USER_A = 'dddddddd-0000-0000-0000-000000000001';
const USER_B = 'dddddddd-0000-0000-0000-000000000002';

const baseTask = {
  organisationId: ORG_A,
  subaccountId: SA_1,
  requesterUserId: null as string | null,
};

// ─── Requester check ──────────────────────────────────────────────────────────

describe('requester visibility', () => {
  test('requester can always see their task', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'user',
      userSubaccountIds: [],
      task: { ...baseTask, requesterUserId: USER_A },
      orgId: ORG_A,
    })).toBe(true);
  });

  test('non-requester user without subaccount membership is denied', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_B,
      userRole: 'user',
      userSubaccountIds: [],
      task: { ...baseTask, requesterUserId: USER_A },
      orgId: ORG_A,
    })).toBe(false);
  });
});

// ─── org_admin ────────────────────────────────────────────────────────────────

describe('org_admin visibility', () => {
  test('org_admin sees any task in their org', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'org_admin',
      userSubaccountIds: [],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(true);
  });

  test('org_admin cannot see task in another org', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'org_admin',
      userSubaccountIds: [],
      task: { ...baseTask, organisationId: ORG_B },
      orgId: ORG_A,
    })).toBe(false);
  });
});

// ─── manager (org_manager) ────────────────────────────────────────────────────

describe('manager visibility', () => {
  test('manager sees any task in their org', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'manager',
      userSubaccountIds: [],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(true);
  });

  test('manager cannot see task in another org', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'manager',
      userSubaccountIds: [],
      task: { ...baseTask, organisationId: ORG_B },
      orgId: ORG_A,
    })).toBe(false);
  });
});

// ─── system_admin ─────────────────────────────────────────────────────────────

describe('system_admin visibility', () => {
  test('system_admin sees any task in the org context', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'system_admin',
      userSubaccountIds: [],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(true);
  });
});

// ─── user (subaccount_admin / subaccount_member) ──────────────────────────────

describe('user role visibility', () => {
  test('user in the task subaccount can see the task', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'user',
      userSubaccountIds: [SA_1],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(true);
  });

  test('user in multiple subaccounts including task subaccount can see it', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'user',
      userSubaccountIds: [SA_2, SA_1],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(true);
  });

  test('user NOT in the task subaccount cannot see the task', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'user',
      userSubaccountIds: [SA_2],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(false);
  });

  test('user with no subaccount memberships cannot see the task', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'user',
      userSubaccountIds: [],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(false);
  });

  test('user cannot see task with null subaccountId unless they are the requester', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'user',
      userSubaccountIds: [SA_1],
      task: { ...baseTask, subaccountId: null },
      orgId: ORG_A,
    })).toBe(false);
  });
});

// ─── client_user ─────────────────────────────────────────────────────────────

describe('client_user visibility', () => {
  test('client_user is always denied unless requester', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'client_user',
      userSubaccountIds: [SA_1],
      task: baseTask,
      orgId: ORG_A,
    })).toBe(false);
  });

  test('client_user who is requester can see their task', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'client_user',
      userSubaccountIds: [SA_1],
      task: { ...baseTask, requesterUserId: USER_A },
      orgId: ORG_A,
    })).toBe(true);
  });
});

// ─── Cross-org ────────────────────────────────────────────────────────────────

describe('cross-org isolation', () => {
  test('cross-org access denied even for org_admin with wrong orgId context', () => {
    expect(assertTaskVisibilityPure({
      userId: USER_A,
      userRole: 'org_admin',
      userSubaccountIds: [],
      task: { ...baseTask, organisationId: ORG_B },
      orgId: ORG_A,
    })).toBe(false);
  });
});
