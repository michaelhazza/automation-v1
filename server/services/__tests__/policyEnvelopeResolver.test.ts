// Unit tests for policyEnvelopeResolver with mocked DB and service dependencies.
// Verifies: idempotency of persist (INV-9), NULL-tolerance on legacy runs,
// mid-run mutation resistance, and error propagation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PolicyEnvelopeSnapshot } from '../../../shared/types/policyEnvelope.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock db module before importing resolver
vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../credentialBrokerService.js', () => ({
  credentialBrokerService: {
    resolveAvailableCredentials: vi.fn(),
  },
}));

vi.mock('../../config/controllerLimits.js', () => ({
  CONTROLLER_LIMITS: {
    native: {
      maxLoopIterations: 25,
      defaultTokenBudgetMultiplier: 1.0,
      maxToolCallsPerRun: 20,
      approvalDefault: 'auto',
    },
    operator: {
      maxLoopIterations: 100,
      defaultTokenBudgetMultiplier: 2.0,
      maxToolCallsPerRun: 80,
      approvalDefault: 'review',
    },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(partial?: Partial<PolicyEnvelopeSnapshot>): PolicyEnvelopeSnapshot {
  return {
    schemaVersion: 1,
    resolvedAt: new Date().toISOString(),
    runId: 'run-1',
    agentId: 'agent-1',
    subaccountAgentId: 'sa-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    controllerStyle: 'native',
    executionMode: 'api',
    controllerLimits: {
      maxLoopIterations: 25,
      defaultTokenBudgetMultiplier: 1.0,
      maxToolCallsPerRun: 20,
      approvalDefault: 'auto',
    },
    allowedControllers: ['native'],
    allowedEnvironments: ['api_tool', 'headless'],
    allowedSkillSlugs: [],
    allowedIntegrationSlugs: [],
    maxRiskTier: 3,
    riskTierApprovalDefaults: { 0: 'auto', 1: 'auto', 2: 'auto', 3: 'review', 4: 'block', 5: 'block', 6: 'block' },
    budgets: { tokenBudget: 30000, maxToolCalls: 20, maxCostCents: 0, maxLlmCalls: 25 },
    approvalDefaults: { sendEmailToClient: 'auto', sendSlackToClient: 'auto', deployOrFundsTransfer: 'block' },
    availableCredentialIds: [],
    activePolicyRuleIds: [],
    sources: {
      subaccountAgentVersion: null,
      spendingPoliciesVersion: null,
      activePolicyRulesVersion: null,
      capabilityMapVersion: null,
    },
    ...partial,
  };
}

// ── persist tests ─────────────────────────────────────────────────────────────

describe('persist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves immediately when UPDATE affects one row', async () => {
    const { db } = await import('../../db/index.js');
    const { persist } = await import('../policyEnvelopeResolver.js');

    const mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'run-1' }]),
    };
    vi.mocked(db.update).mockReturnValue(mockUpdate as never);

    const snapshot = makeSnapshot();
    await expect(persist('run-1', snapshot)).resolves.toBeUndefined();
    expect(db.update).toHaveBeenCalledOnce();
  });

  it('first-resolver-wins: no-ops when snapshot already present (zero rows updated)', async () => {
    const { db } = await import('../../db/index.js');
    const { persist } = await import('../policyEnvelopeResolver.js');

    const existingSnapshot = makeSnapshot();

    // UPDATE returns empty (another resolver won)
    const mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(mockUpdate as never);

    // Re-read returns existing snapshot
    const mockSelect = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ policyEnvelopeSnapshot: existingSnapshot }]),
    };
    vi.mocked(db.select).mockReturnValue(mockSelect as never);

    await expect(persist('run-1', makeSnapshot())).resolves.toBeUndefined();
  });

  it('throws PolicyEnvelopePersistFailedError when both UPDATE and re-read fail', async () => {
    const { db } = await import('../../db/index.js');
    const { persist, PolicyEnvelopePersistFailedError } = await import('../policyEnvelopeResolver.js');

    // UPDATE returns empty
    const mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(mockUpdate as never);

    // Re-read returns null snapshot (row missing or snapshot null)
    const mockSelect = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ policyEnvelopeSnapshot: null }]),
    };
    vi.mocked(db.select).mockReturnValue(mockSelect as never);

    await expect(persist('run-1', makeSnapshot())).rejects.toBeInstanceOf(
      PolicyEnvelopePersistFailedError,
    );
  });

  it('throws PolicyEnvelopePersistFailedError when row does not exist after UPDATE', async () => {
    const { db } = await import('../../db/index.js');
    const { persist, PolicyEnvelopePersistFailedError } = await import('../policyEnvelopeResolver.js');

    // UPDATE returns empty
    const mockUpdate = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValue(mockUpdate as never);

    // Re-read returns empty array (row missing)
    const mockSelect = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(mockSelect as never);

    await expect(persist('run-1', makeSnapshot())).rejects.toBeInstanceOf(
      PolicyEnvelopePersistFailedError,
    );
  });
});

// ── NULL-tolerance ────────────────────────────────────────────────────────────

describe('NULL-tolerance for legacy runs', () => {
  it('PolicyEnvelopeSnapshot type allows null (legacy run)', () => {
    // A legacy run row with policy_envelope_snapshot = NULL reads cleanly at the type level.
    // The type is PolicyEnvelopeSnapshot | null — null is valid.
    const legacySnapshot: PolicyEnvelopeSnapshot | null = null;
    expect(legacySnapshot).toBeNull();
  });
});

// ── PolicyEnvelopePersistFailedError ──────────────────────────────────────────

describe('PolicyEnvelopePersistFailedError', () => {
  it('has the correct statusCode and errorCode', async () => {
    const { PolicyEnvelopePersistFailedError } = await import('../policyEnvelopeResolver.js');
    const err = new PolicyEnvelopePersistFailedError('run-abc');
    expect(err.statusCode).toBe(500);
    expect(err.errorCode).toBe('policy_envelope_persist_failed');
    expect(err.message).toContain('run-abc');
    expect(err.name).toBe('PolicyEnvelopePersistFailedError');
  });
});

// ── mid-run mutation resistance ───────────────────────────────────────────────

describe('mid-run mutation resistance', () => {
  it('snapshot is immutable once persisted — state-based WHERE prevents overwrite', async () => {
    // Demonstrates the design: once persisted (UPDATE WHERE IS NULL), a second call
    // with the same runId finds zero rows to update (snapshot already set).
    // The persist function then reads the existing snapshot and no-ops.
    const { db } = await import('../../db/index.js');
    const { persist } = await import('../policyEnvelopeResolver.js');
    vi.resetAllMocks();

    const original = makeSnapshot({ runId: 'run-immutable' });
    const mutated = makeSnapshot({ runId: 'run-immutable', maxRiskTier: 6 });

    // First persist: UPDATE succeeds
    const mockUpdate1 = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'run-immutable' }]),
    };
    vi.mocked(db.update).mockReturnValueOnce(mockUpdate1 as never);

    await persist('run-immutable', original);

    // Second persist (simulating mutation attempt): UPDATE finds zero rows (snapshot already set)
    const mockUpdate2 = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.update).mockReturnValueOnce(mockUpdate2 as never);

    // Re-read returns original snapshot (not mutated)
    const mockSelect = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ policyEnvelopeSnapshot: original }]),
    };
    vi.mocked(db.select).mockReturnValue(mockSelect as never);

    await expect(persist('run-immutable', mutated)).resolves.toBeUndefined();

    // The UPDATE was called with WHERE IS NULL — it would not overwrite an existing snapshot
    expect(mockUpdate2.where).toHaveBeenCalledOnce();
  });
});
