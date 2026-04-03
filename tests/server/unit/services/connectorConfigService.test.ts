import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock variables
// ---------------------------------------------------------------------------
const { mockReturning, mockWhere, mockFrom, mockSetWhere, mockSet } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockSetWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockWhere = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  return { mockReturning, mockWhere, mockFrom, mockSetWhere, mockSet };
});

const mockDeleteReturning = vi.hoisted(() => vi.fn());
const mockDeleteWhere = vi.hoisted(() => vi.fn().mockReturnValue({ returning: mockDeleteReturning }));

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: mockReturning }),
    }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
  },
}));

import { connectorConfigService } from '../../../../server/services/connectorConfigService.js';

describe('connectorConfigService', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── listByOrg ──────────────────────────────────────────────────────────────

  describe('listByOrg', () => {
    it('returns all configs for an org', async () => {
      const configs = [
        { id: 'cc-1', organisationId: 'org-1', connectorType: 'ghl', status: 'active' },
      ];
      mockWhere.mockResolvedValueOnce(configs);

      const result = await connectorConfigService.listByOrg('org-1');
      expect(result).toHaveLength(1);
      expect(result[0].connectorType).toBe('ghl');
    });

    it('returns empty array when none exist', async () => {
      mockWhere.mockResolvedValueOnce([]);
      const result = await connectorConfigService.listByOrg('org-1');
      expect(result).toEqual([]);
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns config when found', async () => {
      const config = { id: 'cc-1', organisationId: 'org-1', connectorType: 'ghl' };
      mockWhere.mockResolvedValueOnce([config]);

      const result = await connectorConfigService.get('cc-1', 'org-1');
      expect(result.id).toBe('cc-1');
    });

    it('throws 404 when config not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(
        connectorConfigService.get('missing', 'org-1')
      ).rejects.toMatchObject({ statusCode: 404, message: 'Connector config not found' });
    });
  });

  // ── getByType ──────────────────────────────────────────────────────────────

  describe('getByType', () => {
    it('returns config for a specific connector type', async () => {
      const config = { id: 'cc-1', connectorType: 'ghl' };
      mockWhere.mockResolvedValueOnce([config]);

      const result = await connectorConfigService.getByType('org-1', 'ghl');
      expect(result!.connectorType).toBe('ghl');
    });

    it('returns null when type not configured', async () => {
      mockWhere.mockResolvedValueOnce([undefined]);

      const result = await connectorConfigService.getByType('org-1', 'stripe');
      expect(result).toBeNull();
    });
  });

  // ── getActiveByOrg ─────────────────────────────────────────────────────────

  describe('getActiveByOrg', () => {
    it('returns only active configs', async () => {
      const configs = [{ id: 'cc-1', status: 'active' }];
      mockWhere.mockResolvedValueOnce(configs);

      const result = await connectorConfigService.getActiveByOrg('org-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a connector config with org scoping', async () => {
      const created = { id: 'cc-new', organisationId: 'org-1', connectorType: 'ghl', status: 'pending' };
      mockReturning.mockResolvedValueOnce([created]);

      const result = await connectorConfigService.create('org-1', {
        connectorType: 'ghl',
      });

      expect(result.id).toBe('cc-new');
      expect(result.organisationId).toBe('org-1');
    });

    it('uses default pollIntervalMinutes of 60', async () => {
      const created = { id: 'cc-new', pollIntervalMinutes: 60 };
      mockReturning.mockResolvedValueOnce([created]);

      const result = await connectorConfigService.create('org-1', { connectorType: 'ghl' });
      expect(result.pollIntervalMinutes).toBe(60);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates config and returns updated record', async () => {
      const updated = { id: 'cc-1', status: 'active' };
      mockReturning.mockResolvedValueOnce([updated]);

      const result = await connectorConfigService.update('cc-1', 'org-1', { status: 'active' });
      expect(result.status).toBe('active');
    });

    it('throws 404 when config not found', async () => {
      mockReturning.mockResolvedValueOnce([undefined]);

      await expect(
        connectorConfigService.update('missing', 'org-1', { status: 'active' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the config and returns it', async () => {
      mockDeleteReturning.mockResolvedValueOnce([{ id: 'cc-1' }]);

      const result = await connectorConfigService.delete('cc-1', 'org-1');
      expect(result.id).toBe('cc-1');
    });

    it('throws 404 when config not found', async () => {
      mockDeleteReturning.mockResolvedValueOnce([undefined]);

      await expect(
        connectorConfigService.delete('missing', 'org-1')
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // ── updateSyncStatus ───────────────────────────────────────────────────────

  describe('updateSyncStatus', () => {
    it('updates sync status fields', async () => {
      mockSetWhere.mockResolvedValueOnce(undefined);

      await connectorConfigService.updateSyncStatus('cc-1', 'org-1', {
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
      });

      expect(mockSet).toHaveBeenCalled();
    });
  });
});
