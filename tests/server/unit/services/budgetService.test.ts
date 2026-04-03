import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockDb, mockTxSelectWhere, mockTxForUpdate, mockReturning } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([{ id: 'res-1', createdAt: new Date() }]);
  const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
  const mockSelect = vi.fn();
  const mockExecute = vi.fn().mockResolvedValue(undefined);

  // tx.select chain — the key insight is that `.where()` returns a thenable
  // (for direct awaiting) but also has a `.for()` method (for SELECT ... FOR UPDATE).
  const mockTxForUpdate = vi.fn().mockResolvedValue([{ id: 'budget-lock' }]);
  const mockTxSelectWhere = vi.fn();

  // Make each call to where() return an object that is both thenable and has .for()
  mockTxSelectWhere.mockImplementation(() => {
    const result = Promise.resolve([]);
    (result as any).for = mockTxForUpdate;
    return result;
  });

  const mockTxSelectFrom = vi.fn().mockReturnValue({ where: mockTxSelectWhere });
  const mockTxSelect = vi.fn().mockReturnValue({ from: mockTxSelectFrom });

  const mockTransaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({
      select: mockTxSelect,
      insert: mockInsert,
      update: mockUpdate,
      execute: mockExecute,
    });
  });

  return {
    mockDb: {
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      transaction: mockTransaction,
      execute: mockExecute,
      _updateSet: mockUpdateSet,
      _updateWhere: mockUpdateWhere,
    },
    mockTxSelectWhere,
    mockTxForUpdate,
    mockReturning,
  };
});

vi.mock('../../../../server/db/index.js', () => ({ db: mockDb }));

vi.mock('../../../../server/db/schema/index.js', () => ({
  workspaceLimits: { subaccountId: 'subaccountId' },
  orgBudgets: { id: 'id', organisationId: 'organisationId', monthlyCostLimitCents: 'monthlyCostLimitCents' },
  budgetReservations: {
    id: 'id',
    idempotencyKey: 'idempotencyKey',
    entityType: 'entityType',
    entityId: 'entityId',
    estimatedCostCents: 'estimatedCostCents',
    actualCostCents: 'actualCostCents',
    status: 'status',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
  },
  costAggregates: {
    entityType: 'entityType',
    entityId: 'entityId',
    periodType: 'periodType',
    periodKey: 'periodKey',
    totalCostCents: 'totalCostCents',
    requestCount: 'requestCount',
  },
  subaccountAgents: { id: 'id', maxLlmCallsPerRun: 'maxLlmCallsPerRun', maxCostPerRunCents: 'maxCostPerRunCents' },
}));

vi.mock('../../../../server/lib/env.js', () => ({
  env: { PLATFORM_MONTHLY_COST_LIMIT_CENTS: undefined },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  checkAndReserve,
  commitReservation,
  releaseReservation,
  BudgetExceededError,
} from '../../../../server/services/budgetService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a Promise that resolves to `val` and has a `.for()` method */
function thenableWithFor(val: unknown[], forVal: unknown[] = [{ id: 'lock' }]) {
  const p = Promise.resolve(val);
  (p as any).for = vi.fn().mockResolvedValue(forVal);
  return p;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('budgetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: every tx select returns empty with .for() support
    mockTxSelectWhere.mockImplementation(() => thenableWithFor([]));
  });

  describe('checkAndReserve', () => {
    const baseCtx = {
      organisationId: 'org-1',
      subaccountId: 'sa-1',
      runId: 'run-1',
      billingDay: '2026-04-03',
      billingMonth: '2026-04',
    };

    it('creates a reservation when within all budget limits', async () => {
      mockReturning.mockResolvedValueOnce([{ id: 'res-1', createdAt: new Date() }]);

      const reservationId = await checkAndReserve(baseCtx, 100, 'key-1');
      expect(reservationId).toBe('res-1');
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('propagates BudgetExceededError when thrown inside transaction', async () => {
      // Simulate the budget check failing by making the transaction itself throw
      mockDb.transaction.mockRejectedValueOnce(
        new BudgetExceededError('monthly_org', 100, 160, 'org-1'),
      );

      await expect(
        checkAndReserve(baseCtx, 50, 'key-2'),
      ).rejects.toThrow(BudgetExceededError);
    });

    it('returns reservation id when no subaccount is provided', async () => {
      mockReturning.mockResolvedValueOnce([{ id: 'res-new', createdAt: new Date() }]);

      const result = await checkAndReserve(
        { ...baseCtx, subaccountId: undefined },
        50,
        'key-3',
      );
      expect(result).toBe('res-new');
    });

    it('invokes transaction for atomic budget check', async () => {
      mockReturning.mockResolvedValueOnce([{ id: 'res-tx', createdAt: new Date() }]);

      await checkAndReserve(baseCtx, 10, 'key-4');
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('commitReservation', () => {
    it('updates reservation status to committed with actual cost', async () => {
      await commitReservation('res-1', 42);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'committed', actualCostCents: 42 }),
      );
    });
  });

  describe('releaseReservation', () => {
    it('updates reservation status to released', async () => {
      await releaseReservation('res-1');
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb._updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'released' }),
      );
    });
  });

  describe('BudgetExceededError', () => {
    it('includes limit details in the error', () => {
      const err = new BudgetExceededError('monthly_org', 5000, 6000, 'org-1');
      expect(err.limitType).toBe('monthly_org');
      expect(err.limitCents).toBe(5000);
      expect(err.projectedCents).toBe(6000);
      expect(err.entityId).toBe('org-1');
      expect(err.message).toContain('5000');
      expect(err.message).toContain('6000');
    });

    it('has name set to BudgetExceededError', () => {
      const err = new BudgetExceededError('test', 0, 0, '');
      expect(err.name).toBe('BudgetExceededError');
    });
  });
});
