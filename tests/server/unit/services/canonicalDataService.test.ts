import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to declare mocks that vi.mock factory can reference
const { mockWhere, mockFrom } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  return { mockWhere, mockFrom };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
  },
}));

import { canonicalDataService } from '../../../../server/services/canonicalDataService.js';

describe('canonicalDataService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getAccountById', () => {
    it('requires organisationId parameter (2 args)', () => {
      expect(canonicalDataService.getAccountById.length).toBe(2);
    });

    it('returns null when not found', async () => {
      mockWhere.mockResolvedValueOnce([]);
      const result = await canonicalDataService.getAccountById('missing', 'org-1');
      expect(result).toBeNull();
    });

    it('returns account when found', async () => {
      const mockAccount = { id: 'acc-1', organisationId: 'org-1' };
      mockWhere.mockResolvedValueOnce([mockAccount]);
      const result = await canonicalDataService.getAccountById('acc-1', 'org-1');
      expect(result).toEqual(mockAccount);
    });
  });

  describe('getAccountsByOrg', () => {
    it('is callable', () => {
      expect(typeof canonicalDataService.getAccountsByOrg).toBe('function');
    });
  });
});
