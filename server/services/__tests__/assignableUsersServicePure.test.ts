// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports"
/**
 * assignableUsersServicePure.test.ts
 *
 * Tests for assertAccessForResolve (role x target combinations)
 * and validateIntent (malformed cases).
 *
 * No DB imports. No I/O. All pure functions.
 */

import { describe, expect, test } from 'vitest';
import {
  assertAccessForResolve,
  validateIntent,
} from '../assignableUsersServicePure.js';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';
const SA_1  = 'cccccccc-0000-0000-0000-000000000001';
const SA_2  = 'cccccccc-0000-0000-0000-000000000002';

// ─── assertAccessForResolve ───────────────────────────────────────────────────

describe('assertAccessForResolve', () => {
  // org_admin
  test('org_admin can access any subaccount in org', () => {
    expect(assertAccessForResolve({
      callerRole: 'org_admin',
      callerOrgId: ORG_A,
      callerSubaccountIds: [],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: true });
  });

  test('org_admin cannot access another org', () => {
    expect(assertAccessForResolve({
      callerRole: 'org_admin',
      callerOrgId: ORG_A,
      callerSubaccountIds: [],
      targetOrgId: ORG_B,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: false, reason: 'forbidden' });
  });

  // manager (org_manager)
  test('manager can access any subaccount in org', () => {
    expect(assertAccessForResolve({
      callerRole: 'manager',
      callerOrgId: ORG_A,
      callerSubaccountIds: [],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: true });
  });

  test('manager cannot access another org', () => {
    expect(assertAccessForResolve({
      callerRole: 'manager',
      callerOrgId: ORG_A,
      callerSubaccountIds: [],
      targetOrgId: ORG_B,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: false, reason: 'forbidden' });
  });

  // system_admin
  test('system_admin can access any subaccount', () => {
    expect(assertAccessForResolve({
      callerRole: 'system_admin',
      callerOrgId: ORG_A,
      callerSubaccountIds: [],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: true });
  });

  // user role (subaccount_admin / subaccount_member)
  test('user can access subaccount they belong to', () => {
    expect(assertAccessForResolve({
      callerRole: 'user',
      callerOrgId: ORG_A,
      callerSubaccountIds: [SA_1, SA_2],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: true });
  });

  test('user cannot access subaccount they are not in', () => {
    expect(assertAccessForResolve({
      callerRole: 'user',
      callerOrgId: ORG_A,
      callerSubaccountIds: [SA_2],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: false, reason: 'forbidden' });
  });

  test('user with no subaccounts cannot access any subaccount', () => {
    expect(assertAccessForResolve({
      callerRole: 'user',
      callerOrgId: ORG_A,
      callerSubaccountIds: [],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: false, reason: 'forbidden' });
  });

  // client_user
  test('client_user is always forbidden', () => {
    expect(assertAccessForResolve({
      callerRole: 'client_user',
      callerOrgId: ORG_A,
      callerSubaccountIds: [SA_1],
      targetOrgId: ORG_A,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: false, reason: 'forbidden' });
  });

  // cross-org with user role
  test('user role cross-org is forbidden', () => {
    expect(assertAccessForResolve({
      callerRole: 'user',
      callerOrgId: ORG_A,
      callerSubaccountIds: [SA_1],
      targetOrgId: ORG_B,
      targetSubaccountId: SA_1,
    })).toEqual({ allowed: false, reason: 'forbidden' });
  });
});

// ─── validateIntent ───────────────────────────────────────────────────────────

describe('validateIntent', () => {
  test('pick_approver is valid', () => {
    expect(validateIntent('pick_approver')).toEqual({ ok: true, intent: 'pick_approver' });
  });

  test('pick_submitter is valid', () => {
    expect(validateIntent('pick_submitter')).toEqual({ ok: true, intent: 'pick_submitter' });
  });

  test('undefined is invalid', () => {
    expect(validateIntent(undefined)).toEqual({ ok: false, reason: 'invalid_intent' });
  });

  test('null is invalid', () => {
    expect(validateIntent(null)).toEqual({ ok: false, reason: 'invalid_intent' });
  });

  test('empty string is invalid', () => {
    expect(validateIntent('')).toEqual({ ok: false, reason: 'invalid_intent' });
  });

  test('unknown intent string is invalid', () => {
    expect(validateIntent('pick_reviewer')).toEqual({ ok: false, reason: 'invalid_intent' });
  });

  test('future-only intent is invalid in V1', () => {
    expect(validateIntent('pick_delegate')).toEqual({ ok: false, reason: 'invalid_intent' });
  });

  test('number is invalid', () => {
    expect(validateIntent(42)).toEqual({ ok: false, reason: 'invalid_intent' });
  });
});
