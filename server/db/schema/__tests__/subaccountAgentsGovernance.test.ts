import { describe, it, expect } from 'vitest';
import type { InferSelectModel } from 'drizzle-orm';
import { subaccountAgents } from '../subaccountAgents.js';
import { updateLinkBody } from '../../../schemas/subaccountAgents.js';

// Type-level assertion: the four governance columns appear in the inferSelect type.
type SubaccountAgentRow = InferSelectModel<typeof subaccountAgents>;

// Compile-time check — if any field is missing this will be a TS error.
const _typeCheck: {
  controllerStyleAllowed: SubaccountAgentRow['controllerStyleAllowed'];
  allowedEnvironments: SubaccountAgentRow['allowedEnvironments'];
  maxRiskTier: SubaccountAgentRow['maxRiskTier'];
  requireApprovalAtTier: SubaccountAgentRow['requireApprovalAtTier'];
} = {
  controllerStyleAllowed: 'native_only',
  allowedEnvironments: ['api_tool'],
  maxRiskTier: 3,
  requireApprovalAtTier: 4,
};

describe('subaccountAgents governance columns — Drizzle type shape', () => {
  it('controllerStyleAllowed column exists on inferSelect type', () => {
    expect(_typeCheck.controllerStyleAllowed).toBe('native_only');
  });

  it('allowedEnvironments column exists on inferSelect type', () => {
    expect(_typeCheck.allowedEnvironments).toEqual(['api_tool']);
  });

  it('maxRiskTier column exists on inferSelect type', () => {
    expect(_typeCheck.maxRiskTier).toBe(3);
  });

  it('requireApprovalAtTier column exists on inferSelect type', () => {
    expect(_typeCheck.requireApprovalAtTier).toBe(4);
  });
});

describe('updateLinkBody Zod schema — allowedEnvironments closure (spec §3.6)', () => {
  it('accepts valid allowedEnvironments values', () => {
    const result = updateLinkBody.safeParse({
      allowedEnvironments: ['api_tool', 'headless', 'browser', 'terminal_repo'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a literal sandbox element not in the closed enum', () => {
    const result = updateLinkBody.safeParse({
      allowedEnvironments: ['api_tool', 'sandbox'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects any element outside the four permitted values', () => {
    const result = updateLinkBody.safeParse({
      allowedEnvironments: ['headless', 'unknown_env'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a single valid allowedEnvironments entry', () => {
    const result = updateLinkBody.safeParse({
      allowedEnvironments: ['browser'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid controllerStyleAllowed values', () => {
    const native = updateLinkBody.safeParse({ controllerStyleAllowed: 'native_only' });
    const operator = updateLinkBody.safeParse({ controllerStyleAllowed: 'native_and_operator' });
    expect(native.success).toBe(true);
    expect(operator.success).toBe(true);
  });

  it('rejects the legacy operator_allowed literal (renamed to native_and_operator)', () => {
    const result = updateLinkBody.safeParse({ controllerStyleAllowed: 'operator_allowed' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid controllerStyleAllowed value', () => {
    const result = updateLinkBody.safeParse({ controllerStyleAllowed: 'operator' });
    expect(result.success).toBe(false);
  });

  it('accepts maxRiskTier in range 0–6', () => {
    const result = updateLinkBody.safeParse({ maxRiskTier: 0 });
    expect(result.success).toBe(true);
    const result2 = updateLinkBody.safeParse({ maxRiskTier: 6 });
    expect(result2.success).toBe(true);
  });

  it('rejects maxRiskTier above 6', () => {
    const result = updateLinkBody.safeParse({ maxRiskTier: 7 });
    expect(result.success).toBe(false);
  });

  it('accepts requireApprovalAtTier in range 0–6', () => {
    const zero = updateLinkBody.safeParse({ requireApprovalAtTier: 0 });
    const six = updateLinkBody.safeParse({ requireApprovalAtTier: 6 });
    expect(zero.success).toBe(true);
    expect(six.success).toBe(true);
  });

  it('rejects requireApprovalAtTier = 7 (sentinel removed; spec §5.2.9 locks 0–6)', () => {
    const result = updateLinkBody.safeParse({ requireApprovalAtTier: 7 });
    expect(result.success).toBe(false);
  });

  it('rejects requireApprovalAtTier above 6', () => {
    const result = updateLinkBody.safeParse({ requireApprovalAtTier: 8 });
    expect(result.success).toBe(false);
  });
});
