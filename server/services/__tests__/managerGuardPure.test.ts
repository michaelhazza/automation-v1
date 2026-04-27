import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.deepEqual(result, { allowed: true });
});

test('null agentRole returns allowed: true', () => {
  const def = makeDef({ managerAllowlistMember: false });
  const result = isManagerAllowlisted(def, null, [], 'some_tool');
  assert.deepEqual(result, { allowed: true });
});

// Test 2: manager + managerAllowlistMember: true + sideEffectClass: 'none' + directExternalSideEffect: false → allowed
test('manager + globally allowlisted + no side effects → allowed', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'none',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'allowed_tool');
  assert.deepEqual(result, { allowed: true });
});

// Test 3: manager + NOT on allowlist → manager_role_violation
test('manager + not on allowlist → manager_role_violation', () => {
  const def = makeDef({
    managerAllowlistMember: false,
    sideEffectClass: 'none',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'restricted_tool');
  assert.deepEqual(result, { allowed: false, reason: 'manager_role_violation' });
});

// Test 4: manager + allowlisted + directExternalSideEffect: true → manager_direct_external_side_effect
test('manager + allowlisted + directExternalSideEffect: true → manager_direct_external_side_effect', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'none',
    directExternalSideEffect: true,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'send_email');
  assert.deepEqual(result, { allowed: false, reason: 'manager_direct_external_side_effect' });
});

// Test 5: manager + allowlisted + sideEffectClass: 'read' + directExternalSideEffect: false → manager_indirect_side_effect_class
test('manager + allowlisted + sideEffectClass: read → manager_indirect_side_effect_class', () => {
  const def = makeDef({
    managerAllowlistMember: true,
    sideEffectClass: 'read',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', [], 'read_crm');
  assert.deepEqual(result, { allowed: false, reason: 'manager_indirect_side_effect_class' });
});

// Test 6: manager + NOT on global allowlist BUT IS in perManagerDeclaredSlugs + sideEffectClass: 'none' → allowed
test('manager + in perManagerDeclaredSlugs (not global) + sideEffectClass: none → allowed', () => {
  const def = makeDef({
    managerAllowlistMember: false,
    sideEffectClass: 'none',
    directExternalSideEffect: false,
  });
  const result = isManagerAllowlisted(def, 'manager', ['per_manager_tool'], 'per_manager_tool');
  assert.deepEqual(result, { allowed: true });
});

// Test 7: undefined def + manager → manager_role_violation (not allowlisted)
test('undefined def + manager → manager_role_violation', () => {
  const result = isManagerAllowlisted(undefined, 'manager', [], 'unknown_tool');
  assert.deepEqual(result, { allowed: false, reason: 'manager_role_violation' });
});
