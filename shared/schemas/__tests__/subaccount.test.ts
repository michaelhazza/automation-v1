import { test, expect } from 'vitest';
import {
  baselineArtefactsStatusSchema,
  isWizardCompletable,
  assertVersionGate,
} from '../subaccount.js';

const defaultStatus = {
  version: 1 as const,
  tier1: {
    brand_identity: { status: 'not_started' as const, captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
    voice_tone: { status: 'not_started' as const, captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
  },
  tier2: {
    offer_positioning: { status: 'not_started' as const, captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
    audience_icp: { status: 'not_started' as const, captured_at: null, skipped_at: null, memory_block_id: null, captured_by_user_id: null },
  },
  tier3: {
    operating_constraints: { status: 'not_started' as const, captured_at: null, skipped_at: null, workspace_memory_id: null, captured_by_user_id: null },
    proof_library: { status: 'not_started' as const, captured_at: null, skipped_at: null, workspace_memory_id: null, captured_by_user_id: null },
  },
};

test('defaultStatus parses cleanly', () => {
  const result = baselineArtefactsStatusSchema.parse(defaultStatus);
  expect(result.version).toBe(1);
});

test('Tier-1 entry with status skipped is rejected', () => {
  const invalid = {
    ...defaultStatus,
    tier1: {
      ...defaultStatus.tier1,
      brand_identity: { ...defaultStatus.tier1.brand_identity, status: 'skipped' as const },
    },
  };
  expect(() => baselineArtefactsStatusSchema.parse(invalid)).toThrow();
});

test('Tier-2 entry with status skipped is rejected', () => {
  const invalid = {
    ...defaultStatus,
    tier2: {
      ...defaultStatus.tier2,
      offer_positioning: { ...defaultStatus.tier2.offer_positioning, status: 'skipped' as const },
    },
  };
  expect(() => baselineArtefactsStatusSchema.parse(invalid)).toThrow();
});

test('Tier-3 entry with status skipped is accepted', () => {
  const valid = {
    ...defaultStatus,
    tier3: {
      ...defaultStatus.tier3,
      operating_constraints: { ...defaultStatus.tier3.operating_constraints, status: 'skipped' as const },
    },
  };
  const result = baselineArtefactsStatusSchema.parse(valid);
  expect(result.tier3.operating_constraints.status).toBe('skipped');
});

test('entry with both captured_at and skipped_at set is rejected', () => {
  const invalid = {
    ...defaultStatus,
    tier3: {
      ...defaultStatus.tier3,
      proof_library: {
        ...defaultStatus.tier3.proof_library,
        captured_at: '2024-01-01T00:00:00.000Z',
        skipped_at: '2024-01-01T00:00:00.000Z',
      },
    },
  };
  expect(() => baselineArtefactsStatusSchema.parse(invalid)).toThrow();
});

test('assertVersionGate with mismatched version throws', () => {
  // version: 2 fails the z.literal(1) schema guard; assertVersionGate throws
  // (via zod parse) before reaching the custom version-mismatch check
  const v2 = { ...defaultStatus, version: 2 };
  expect(() => assertVersionGate(v2, 1)).toThrow();
});

test('assertVersionGate with matching version returns parsed status without throwing', () => {
  const result = assertVersionGate(defaultStatus, 1);
  expect(result.version).toBe(1);
});

test('isWizardCompletable returns false when tier1.brand_identity is in_progress', () => {
  const status = baselineArtefactsStatusSchema.parse({
    ...defaultStatus,
    tier1: {
      ...defaultStatus.tier1,
      brand_identity: { ...defaultStatus.tier1.brand_identity, status: 'in_progress' },
    },
  });
  expect(isWizardCompletable(status)).toBe(false);
});

test('isWizardCompletable returns true when all Tier-1+2 are completed even if Tier-3 is not_started', () => {
  const status = baselineArtefactsStatusSchema.parse({
    ...defaultStatus,
    tier1: {
      brand_identity: { ...defaultStatus.tier1.brand_identity, status: 'completed', captured_at: '2024-01-01T00:00:00.000Z' },
      voice_tone: { ...defaultStatus.tier1.voice_tone, status: 'completed', captured_at: '2024-01-01T00:00:00.000Z' },
    },
    tier2: {
      offer_positioning: { ...defaultStatus.tier2.offer_positioning, status: 'completed', captured_at: '2024-01-01T00:00:00.000Z' },
      audience_icp: { ...defaultStatus.tier2.audience_icp, status: 'completed', captured_at: '2024-01-01T00:00:00.000Z' },
    },
  });
  expect(isWizardCompletable(status)).toBe(true);
});
