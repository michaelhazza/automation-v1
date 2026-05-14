import { expect, test } from 'vitest';
import { isManagerAllowlisted } from '../middleware/managerGuardPure.js';
import type { ActionDefinition } from '../../config/actionRegistry.js';

// Minimal ActionDefinition factory for tests — only fields the guard reads.
function makeDef(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    gateLevel: 'auto',
    idempotencyStrategy: 'read_only',
    sideEffectClass: 'none',
    directExternalSideEffect: false,
    managerAllowlistMember: false,
    ...overrides,
  } as ActionDefinition;
}

// Test 1: non-manager role → always allowed
test('non-manager role returns allowed: true regardless of def', () => {
  const def = makeDef({ managerAllowlistMember: false });
  const result = isManagerAllowlisted(def, 'worker', [], 'some_tool');
  expect(result).toEqual({ allowed: true });
});

test('null agentRole returns allowed: true', () => {
  const def = makeDef({ managerAllowlistMember: false });
  const result = isManagerAllowlisted(def, null, [], 'some_tool');
  expect(result).toEqual({ allowed: true });
});

// Test 2: manager + managerAllowlistMember: true + sideEffectClass: 'none' + directExternalSideEffect: false → allowed
test('manager + globally allowlisted + no side effects → allowed', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'none',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'allowed_tool');
  expect(result).toEqual({ allowed: true });
});

// Test 3: manager + NOT on allowlist → manager_role_violation
test('manager + not on allowlist → manager_role_violation', () => {
  const def = makeDef({
    managerAllowlistMember: false,
    sideEffectClass: 'none',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'restricted_tool');
  expect(result).toEqual({ allowed: false, reason: 'manager_role_violation' });
});

// Test 4: manager + allowlisted + directExternalSideEffect: true → manager_direct_external_side_effect
test('manager + allowlisted + directExternalSideEffect: true → manager_direct_external_side_effect', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'none',
    directExternalSideEffect: true,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'send_email');
  expect(result).toEqual({ allowed: false, reason: 'manager_direct_external_side_effect' });
});

// Test 5: manager + allowlisted + sideEffectClass: 'write' + directExternalSideEffect: false → manager_indirect_side_effect_class
test('manager + allowlisted + sideEffectClass: write → manager_indirect_side_effect_class', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'write',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'mutate_canonical');
  expect(result).toEqual({ allowed: false, reason: 'manager_indirect_side_effect_class' });
});

// Test 6: manager + NOT on global allowlist BUT IS in perManagerDeclaredSlugs + sideEffectClass: 'none' → allowed
test('manager + in perManagerDeclaredSlugs (not global) + sideEffectClass: none → allowed', () => {
  const def = makeDef({
    managerAllowlistMember: false,
    sideEffectClass: 'none',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', ['per_manager_tool'], 'per_manager_tool');
  expect(result).toEqual({ allowed: true });
});

// Test 7: undefined def + manager → manager_role_violation (not allowlisted)
test('undefined def + manager → manager_role_violation', () => {
  const result = isManagerAllowlisted(undefined, 'manager', [], 'unknown_tool');
  expect(result).toEqual({ allowed: false, reason: 'manager_role_violation' });
});

// Test 8 (S9): manager + per-manager declared READ skill (e.g. read_revenue, read_crm)
// + sideEffectClass: 'read' + directExternalSideEffect: false → allowed.
// Spec §10.1.4 explicitly puts read_revenue / read_crm on head-of-commercial's
// per-manager declared bundle. They are canonical DB reads (no external blast)
// so the third deny check (now scoped to 'write' only) must let them through.
test('manager + per-manager declared READ skill + directExternalSideEffect: false → allowed', () => {
  const def = makeDef({
    managerAllowlistMember: false,
    sideEffectClass: 'read',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', ['read_revenue'], 'read_revenue');
  expect(result).toEqual({ allowed: true });
});

// Test 9 (S9): per-manager declared READ that hits an external API
// (read_campaigns / read_analytics — directExternalSideEffect: true) is still
// blocked by the second check, even though the third check no longer rejects
// 'read'. This preserves spec §8.2 line 797's stance that reads against
// quota'd external APIs should not run from a manager.
test('manager + per-manager declared external-API read → manager_direct_external_side_effect', () => {
  const def = makeDef({
    managerAllowlistMember: false,
    sideEffectClass: 'read',
    directExternalSideEffect: true,
  });
  const result = isManagerAllowlisted(def, 'manager', ['read_campaigns'], 'read_campaigns');
  expect(result).toEqual({ allowed: false, reason: 'manager_direct_external_side_effect' });
});

// Test 10 (S9): manager + globally allowlisted + sideEffectClass: 'read'
// → allowed (the third check no longer rejects 'read'; only 'write').
test('manager + globally allowlisted + sideEffectClass: read → allowed', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'read',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'allowlisted_read');
  expect(result).toEqual({ allowed: true });
});
