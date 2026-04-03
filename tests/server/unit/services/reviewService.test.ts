import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockSelectWhere, mockInsertReturning, mockUpdateWhere,
  mockTransactionCallback,
} = vi.hoisted(() => {
  const mockSelectWhere = vi.fn();
  const mockInsertReturning = vi.fn();
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockTransactionCallback = vi.fn();
  return { mockSelectWhere, mockInsertReturning, mockUpdateWhere, mockTransactionCallback };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockSelectWhere,
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: mockInsertReturning,
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: mockUpdateWhere,
      }),
    }),
    transaction: vi.fn(async (cb: Function) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        }),
      };
      return cb(tx);
    }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  actions: { id: 'id', organisationId: 'organisationId', payloadJson: 'payloadJson', updatedAt: 'updatedAt', rejectionComment: 'rejectionComment' },
  reviewItems: {
    id: 'id', organisationId: 'organisationId', subaccountId: 'subaccountId',
    actionId: 'actionId', agentRunId: 'agentRunId', reviewStatus: 'reviewStatus',
    reviewPayloadJson: 'reviewPayloadJson', createdAt: 'createdAt',
    humanEditJson: 'humanEditJson', reviewedBy: 'reviewedBy', reviewedAt: 'reviewedAt',
  },
  actionEvents: {},
  actionResumeEvents: { actionId: 'actionId', organisationId: 'organisationId', subaccountId: 'subaccountId', eventType: 'eventType', resolvedBy: 'resolvedBy', payload: 'payload', createdAt: 'createdAt' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col) => ({ op: 'desc', col })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  isNull: vi.fn((col) => ({ op: 'isNull', col })),
}));

vi.mock('../../../../server/services/actionService.js', () => ({
  actionService: {
    getAction: vi.fn().mockResolvedValue({ id: 'act-1', organisationId: 'org-1', subaccountId: 'sa-1', payloadJson: {} }),
    transitionState: vi.fn().mockResolvedValue(undefined),
    emitEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../server/services/executionLayerService.js', () => ({
  executionLayerService: {
    executeAction: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../../../../server/services/hitlService.js', () => ({
  hitlService: {
    resolveDecision: vi.fn(),
  },
}));

vi.mock('../../../../server/services/auditService.js', () => ({
  auditService: { log: vi.fn() },
}));

vi.mock('../../../../server/websocket/emitters.js', () => ({
  emitSubaccountUpdate: vi.fn(),
  emitOrgUpdate: vi.fn(),
}));

import { reviewService } from '../../../../server/services/reviewService.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('reviewService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createReviewItem', () => {
    it('inserts a review item and returns it', async () => {
      const mockItem = { id: 'ri-1', actionId: 'act-1', reviewStatus: 'pending' };
      mockInsertReturning.mockResolvedValueOnce([mockItem]);

      const action = { id: 'act-1', organisationId: 'org-1', subaccountId: 'sa-1', agentRunId: 'run-1' } as any;
      const payload = { actionType: 'send_email', proposedPayload: { to: 'test@example.com' } };

      const result = await reviewService.createReviewItem(action, payload);
      expect(result).toEqual(mockItem);
    });

    it('emits org-level update when subaccountId is null', async () => {
      const { emitOrgUpdate } = await import('../../../../server/websocket/emitters.js');
      const mockItem = { id: 'ri-2', reviewStatus: 'pending' };
      mockInsertReturning.mockResolvedValueOnce([mockItem]);

      const action = { id: 'act-2', organisationId: 'org-1', subaccountId: null, agentRunId: 'run-1' } as any;
      const payload = { actionType: 'send_email', proposedPayload: {} };

      await reviewService.createReviewItem(action, payload);
      expect(emitOrgUpdate).toHaveBeenCalled();
    });
  });

  describe('approveItem', () => {
    it('approves a pending review item and transitions action', async () => {
      const mockItem = { id: 'ri-1', actionId: 'act-1', reviewStatus: 'pending', organisationId: 'org-1' };
      mockSelectWhere.mockResolvedValueOnce([mockItem]);

      const { actionService } = await import('../../../../server/services/actionService.js');

      await reviewService.approveItem('ri-1', 'org-1', 'user-1');

      expect(actionService.transitionState).toHaveBeenCalledWith('act-1', 'org-1', 'approved', 'user-1');
    });

    it('throws 404 for non-existent review item', async () => {
      mockSelectWhere.mockResolvedValueOnce([]);

      try {
        await reviewService.approveItem('ri-missing', 'org-1', 'user-1');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('throws 409 when review item is already resolved', async () => {
      const mockItem = { id: 'ri-1', actionId: 'act-1', reviewStatus: 'approved', organisationId: 'org-1' };
      mockSelectWhere.mockResolvedValueOnce([mockItem]);

      try {
        await reviewService.approveItem('ri-1', 'org-1', 'user-1');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    });
  });

  describe('rejectItem', () => {
    it('rejects a pending review item and transitions action', async () => {
      const mockItem = { id: 'ri-1', actionId: 'act-1', reviewStatus: 'pending', organisationId: 'org-1' };
      mockSelectWhere.mockResolvedValueOnce([mockItem]);

      const { actionService } = await import('../../../../server/services/actionService.js');

      await reviewService.rejectItem('ri-1', 'org-1', 'user-1', 'Not needed');

      expect(actionService.transitionState).toHaveBeenCalledWith('act-1', 'org-1', 'rejected', 'user-1');
    });

    it('throws 404 for non-existent review item on reject', async () => {
      mockSelectWhere.mockResolvedValueOnce([]);

      try {
        await reviewService.rejectItem('ri-missing', 'org-1', 'user-1');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('throws 409 when rejecting an already-resolved item', async () => {
      const mockItem = { id: 'ri-1', actionId: 'act-1', reviewStatus: 'rejected', organisationId: 'org-1' };
      mockSelectWhere.mockResolvedValueOnce([mockItem]);

      try {
        await reviewService.rejectItem('ri-1', 'org-1', 'user-1');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
      }
    });

    it('resolves HITL decision with approved: false', async () => {
      const mockItem = { id: 'ri-1', actionId: 'act-1', reviewStatus: 'pending', organisationId: 'org-1' };
      mockSelectWhere.mockResolvedValueOnce([mockItem]);

      const { hitlService } = await import('../../../../server/services/hitlService.js');

      await reviewService.rejectItem('ri-1', 'org-1', 'user-1', 'Bad action');

      expect(hitlService.resolveDecision).toHaveBeenCalledWith('act-1', expect.objectContaining({
        approved: false,
        comment: 'Bad action',
      }));
    });
  });

  describe('getReviewItem', () => {
    it('throws 404 for non-existent item', async () => {
      mockSelectWhere.mockResolvedValueOnce([]);

      try {
        await reviewService.getReviewItem('ri-missing', 'org-1');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
      }
    });
  });
});
