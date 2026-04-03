import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReturning, mockWhere, mockSet, mockValues, mockInnerJoin, mockFrom } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin });
  return { mockReturning, mockWhere, mockSet, mockValues, mockInnerJoin, mockFrom };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockWhere }),
  },
}));

import { orgAgentConfigService } from '../../../../server/services/orgAgentConfigService.js';

describe('orgAgentConfigService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('get', () => {
    it('returns config when found', async () => {
      const mockConfig = { id: 'cfg-1', organisationId: 'org-1', agentId: 'agent-1', isActive: true };
      mockWhere.mockResolvedValueOnce([mockConfig]);
      const result = await orgAgentConfigService.get('cfg-1', 'org-1');
      expect(result).toEqual(mockConfig);
    });

    it('throws 404 when config not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(orgAgentConfigService.get('missing', 'org-1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('getByAgentId', () => {
    it('throws 404 when no config exists for agent', async () => {
      mockWhere.mockResolvedValueOnce([]);
      await expect(orgAgentConfigService.getByAgentId('org-1', 'agent-missing'))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('updateLastRunAt', () => {
    it('calls update', async () => {
      mockWhere.mockResolvedValueOnce(undefined);
      await orgAgentConfigService.updateLastRunAt('cfg-1', 'org-1');
      expect(mockSet).toHaveBeenCalled();
    });
  });
});
