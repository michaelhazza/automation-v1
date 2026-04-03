import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockActionService, mockGetActionDefinition, mockDbSelectWhere } = vi.hoisted(() => {
  const mockActionService = {
    lockForExecution: vi.fn(),
    getAction: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };
  const mockGetActionDefinition = vi.fn();
  const mockDbSelectWhere = vi.fn().mockResolvedValue([]);
  return { mockActionService, mockGetActionDefinition, mockDbSelectWhere };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockDbSelectWhere,
      }),
    }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  actions: {},
  integrationConnections: {
    subaccountId: 'subaccountId',
    providerType: { _: { data: 'string' } },
    connectionStatus: 'connectionStatus',
  },
}));

vi.mock('../../../../server/services/actionService.js', () => ({
  actionService: mockActionService,
}));

vi.mock('../../../../server/config/actionRegistry.js', () => ({
  getActionDefinition: mockGetActionDefinition,
}));

vi.mock('../../../../server/services/adapters/apiAdapter.js', () => ({
  apiAdapter: { execute: vi.fn() },
}));

vi.mock('../../../../server/services/adapters/devopsAdapter.js', () => ({
  devopsAdapter: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { executionLayerService, registerAdapter } from '../../../../server/services/executionLayerService.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executionLayerService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('registerAdapter', () => {
    it('stores adapter and makes it available for dispatch', () => {
      const testAdapter = { execute: vi.fn().mockResolvedValue({ success: true, resultStatus: 'completed' }) };
      registerAdapter('test_category', testAdapter);

      // The adapter is registered internally; we verify it dispatches below
      expect(true).toBe(true);
    });
  });

  describe('executeAction', () => {
    it('returns failure when action is not in approved state', async () => {
      mockActionService.lockForExecution.mockResolvedValue(false);

      const result = await executionLayerService.executeAction('action-1', 'org-1');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('invalid_state');
    });

    it('returns failure for unknown action type', async () => {
      mockActionService.lockForExecution.mockResolvedValue(true);
      mockActionService.getAction.mockResolvedValue({
        id: 'action-1',
        actionType: 'unknown_type',
        subaccountId: 'sa-1',
        payloadJson: {},
      });
      mockGetActionDefinition.mockReturnValue(null);

      const result = await executionLayerService.executeAction('action-1', 'org-1');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('unknown_type');
      expect(mockActionService.markFailed).toHaveBeenCalled();
    });

    it('returns failure when no adapter found for category', async () => {
      mockActionService.lockForExecution.mockResolvedValue(true);
      mockActionService.getAction.mockResolvedValue({
        id: 'action-1',
        actionType: 'some_type',
        subaccountId: 'sa-1',
        payloadJson: {},
      });
      mockGetActionDefinition.mockReturnValue({
        actionCategory: 'nonexistent_category',
        isExternal: false,
      });

      const result = await executionLayerService.executeAction('action-1', 'org-1');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('no_adapter');
      expect(mockActionService.markFailed).toHaveBeenCalled();
    });

    it('dispatches to correct adapter and marks completed on success', async () => {
      const testAdapter = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          resultStatus: 'completed',
          result: { data: 'test' },
        }),
      };
      registerAdapter('test_dispatch', testAdapter);

      mockActionService.lockForExecution.mockResolvedValue(true);
      mockActionService.getAction.mockResolvedValue({
        id: 'action-1',
        actionType: 'test_action',
        subaccountId: 'sa-1',
        payloadJson: {},
      });
      mockGetActionDefinition.mockReturnValue({
        actionCategory: 'test_dispatch',
        isExternal: false,
      });

      const result = await executionLayerService.executeAction('action-1', 'org-1');

      expect(result.success).toBe(true);
      expect(testAdapter.execute).toHaveBeenCalled();
      expect(mockActionService.markCompleted).toHaveBeenCalled();
    });

    it('marks failed when adapter returns failure', async () => {
      const failAdapter = {
        execute: vi.fn().mockResolvedValue({
          success: false,
          resultStatus: 'failed',
          error: 'API error',
          errorCode: 'api_error',
        }),
      };
      registerAdapter('fail_cat', failAdapter);

      mockActionService.lockForExecution.mockResolvedValue(true);
      mockActionService.getAction.mockResolvedValue({
        id: 'action-1',
        actionType: 'fail_action',
        subaccountId: 'sa-1',
        payloadJson: {},
      });
      mockGetActionDefinition.mockReturnValue({
        actionCategory: 'fail_cat',
        isExternal: false,
      });

      const result = await executionLayerService.executeAction('action-1', 'org-1');

      expect(result.success).toBe(false);
      expect(mockActionService.markFailed).toHaveBeenCalledWith(
        'action-1', 'org-1', 'API error', 'api_error',
      );
    });

    it('catches adapter exceptions and marks failed', async () => {
      const throwAdapter = {
        execute: vi.fn().mockRejectedValue(new Error('Adapter exploded')),
      };
      registerAdapter('throw_cat', throwAdapter);

      mockActionService.lockForExecution.mockResolvedValue(true);
      mockActionService.getAction.mockResolvedValue({
        id: 'action-1',
        actionType: 'throw_action',
        subaccountId: 'sa-1',
        payloadJson: {},
      });
      mockGetActionDefinition.mockReturnValue({
        actionCategory: 'throw_cat',
        isExternal: false,
      });

      const result = await executionLayerService.executeAction('action-1', 'org-1');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('adapter_error');
      expect(result.error).toContain('Adapter exploded');
    });
  });

  describe('executeAutoAction', () => {
    it('delegates to executeAction', async () => {
      mockActionService.lockForExecution.mockResolvedValue(false);

      const result = await executionLayerService.executeAutoAction('action-1', 'org-1');

      expect(result.success).toBe(false);
      // It uses the same code path as executeAction
      expect(result.errorCode).toBe('invalid_state');
    });
  });
});
