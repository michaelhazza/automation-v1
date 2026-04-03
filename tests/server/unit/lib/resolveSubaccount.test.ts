import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWhere } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  return { mockWhere };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
      }),
    }),
  },
}));

vi.mock('../../../../server/db/schema/index.js', () => ({
  subaccounts: {
    id: 'id',
    organisationId: 'organisationId',
    deletedAt: 'deletedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ op: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col) => ({ op: 'isNull', col })),
}));

import { resolveSubaccount } from '../../../../server/lib/resolveSubaccount.js';

describe('resolveSubaccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns subaccount when found with matching org', async () => {
    const mockSubaccount = {
      id: 'sa-1',
      organisationId: 'org-1',
      name: 'Test Subaccount',
      deletedAt: null,
    };
    mockWhere.mockResolvedValueOnce([mockSubaccount]);

    const result = await resolveSubaccount('sa-1', 'org-1');
    expect(result).toEqual(mockSubaccount);
  });

  it('throws { statusCode: 404 } when subaccount not found', async () => {
    mockWhere.mockResolvedValueOnce([]);

    try {
      await resolveSubaccount('sa-missing', 'org-1');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Subaccount not found');
    }
  });

  it('throws 404 when org does not match (empty result)', async () => {
    mockWhere.mockResolvedValueOnce([]);

    try {
      await resolveSubaccount('sa-1', 'wrong-org');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
    }
  });

  it('throws 404 when subaccount is soft-deleted (empty result)', async () => {
    mockWhere.mockResolvedValueOnce([]);

    try {
      await resolveSubaccount('sa-deleted', 'org-1');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Subaccount not found');
    }
  });

  it('returns the first matching subaccount from the result set', async () => {
    const sa = { id: 'sa-2', organisationId: 'org-2', name: 'Second' };
    mockWhere.mockResolvedValueOnce([sa, { id: 'sa-other' }]);

    const result = await resolveSubaccount('sa-2', 'org-2');
    expect(result).toEqual(sa);
  });
});
