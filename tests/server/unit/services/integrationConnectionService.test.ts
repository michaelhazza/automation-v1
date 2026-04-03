import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLimit, mockWhere, mockFrom } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  return { mockLimit, mockWhere, mockFrom };
});

vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn() }),
      }),
    }),
  },
}));

vi.mock('../../../../server/services/connectionTokenService.js', () => ({
  connectionTokenService: {
    refreshWithLock: vi.fn(),
    decryptToken: vi.fn((token: string) => token), // Pass-through in tests
  },
}));

import { integrationConnectionService } from '../../../../server/services/integrationConnectionService.js';

describe('integrationConnectionService.getDecryptedConnection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when no connection found with subaccountId', async () => {
    mockLimit.mockResolvedValueOnce([]);
    await expect(
      integrationConnectionService.getDecryptedConnection('sa-1', 'ghl', 'org-1')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when no connection found with null subaccountId', async () => {
    mockLimit.mockResolvedValueOnce([]);
    await expect(
      integrationConnectionService.getDecryptedConnection(null, 'ghl', 'org-1', 'conn-1')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns connection when found (subaccount-scoped)', async () => {
    const mockConn = {
      id: 'conn-1', organisationId: 'org-1', subaccountId: 'sa-1', providerType: 'ghl',
      accessToken: 'token-123', claimedAt: null, expiresIn: null, refreshToken: null,
    };
    mockLimit.mockResolvedValueOnce([mockConn]);
    const result = await integrationConnectionService.getDecryptedConnection('sa-1', 'ghl', 'org-1');
    expect(result).toBeDefined();
  });

  it('returns connection when found (org-level, null subaccountId)', async () => {
    const mockConn = {
      id: 'conn-1', organisationId: 'org-1', subaccountId: null, providerType: 'ghl',
      accessToken: 'token-123', claimedAt: null, expiresIn: null, refreshToken: null,
    };
    mockLimit.mockResolvedValueOnce([mockConn]);
    const result = await integrationConnectionService.getDecryptedConnection(null, 'ghl', 'org-1', 'conn-1');
    expect(result).toBeDefined();
  });
});
