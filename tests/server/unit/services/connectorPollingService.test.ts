import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockDbSelectWhere,
  mockAdapters,
  mockIntegrationConnectionService,
  mockConnectorConfigService,
  mockCanonicalDataService,
  mockGhlRateLimiter,
} = vi.hoisted(() => {
  const mockDbSelectWhere = vi.fn();
  const mockAdapters: Record<string, { ingestion: Record<string, vi.Mock> }> = {
    ghl: {
      ingestion: {
        listAccounts: vi.fn().mockResolvedValue([]),
        fetchContacts: vi.fn().mockResolvedValue([]),
        fetchOpportunities: vi.fn().mockResolvedValue([]),
        fetchConversations: vi.fn().mockResolvedValue([]),
        fetchRevenue: vi.fn().mockResolvedValue([]),
      },
    },
  };
  const mockIntegrationConnectionService = {
    getDecryptedConnection: vi.fn(),
  };
  const mockConnectorConfigService = {
    updateSyncStatus: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const mockCanonicalDataService = {
    upsertAccount: vi.fn().mockResolvedValue(undefined),
    upsertContact: vi.fn().mockResolvedValue(undefined),
    upsertOpportunity: vi.fn().mockResolvedValue(undefined),
    upsertConversation: vi.fn().mockResolvedValue(undefined),
    upsertRevenue: vi.fn().mockResolvedValue(undefined),
  };
  const mockGhlRateLimiter = {
    acquire: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockDbSelectWhere,
    mockAdapters,
    mockIntegrationConnectionService,
    mockConnectorConfigService,
    mockCanonicalDataService,
    mockGhlRateLimiter,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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
  connectorConfigs: { id: 'id' },
  canonicalAccounts: { connectorConfigId: 'connectorConfigId' },
}));

vi.mock('../../../../server/adapters/index.js', () => ({
  adapters: mockAdapters,
}));

vi.mock('../../../../server/services/integrationConnectionService.js', () => ({
  integrationConnectionService: mockIntegrationConnectionService,
}));

vi.mock('../../../../server/services/connectorConfigService.js', () => ({
  connectorConfigService: mockConnectorConfigService,
}));

vi.mock('../../../../server/services/canonicalDataService.js', () => ({
  canonicalDataService: mockCanonicalDataService,
}));

vi.mock('../../../../server/lib/rateLimiter.js', () => ({
  ghlRateLimiter: mockGhlRateLimiter,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { connectorPollingService } from '../../../../server/services/connectorPollingService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc-1',
    organisationId: 'org-1',
    connectorType: 'ghl',
    connectionId: 'conn-1',
    configJson: {},
    syncPhase: 'backfill',
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('connectorPollingService.syncConnector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when connector config not found', async () => {
    mockDbSelectWhere.mockResolvedValueOnce([]);

    await expect(
      connectorPollingService.syncConnector('missing-id'),
    ).rejects.toThrow(/not found/);
  });

  it('throws when adapter does not support ingestion', async () => {
    mockDbSelectWhere.mockResolvedValueOnce([makeConfig({ connectorType: 'unsupported' })]);

    await expect(
      connectorPollingService.syncConnector('cc-1'),
    ).rejects.toThrow(/does not support ingestion/);
  });

  it('throws when no connectionId is linked', async () => {
    mockDbSelectWhere.mockResolvedValueOnce([makeConfig({ connectionId: null })]);

    await expect(
      connectorPollingService.syncConnector('cc-1'),
    ).rejects.toThrow(/no connection linked/);
  });

  it('handles connection errors gracefully and updates status', async () => {
    mockDbSelectWhere.mockResolvedValueOnce([makeConfig()]);
    mockIntegrationConnectionService.getDecryptedConnection.mockRejectedValue(
      new Error('Credentials expired'),
    );

    const result = await connectorPollingService.syncConnector('cc-1');

    expect(result.success).toBe(false);
    expect(result.accountsSynced).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(mockConnectorConfigService.updateSyncStatus).toHaveBeenCalledWith(
      'cc-1',
      'org-1',
      expect.objectContaining({ lastSyncStatus: 'error' }),
    );
    expect(mockConnectorConfigService.update).toHaveBeenCalledWith(
      'cc-1',
      'org-1',
      { status: 'error' },
    );
  });

  it('syncs accounts and entities on success', async () => {
    mockDbSelectWhere
      .mockResolvedValueOnce([makeConfig()]) // config lookup
      .mockResolvedValueOnce([                 // dbAccounts lookup
        { id: 'acc-1', externalId: 'ext-1' },
      ]);

    mockIntegrationConnectionService.getDecryptedConnection.mockResolvedValue({
      accessToken: 'token',
    });
    mockAdapters.ghl.ingestion.listAccounts.mockResolvedValue([
      { externalId: 'ext-1', displayName: 'Account 1', status: 'active', externalMetadata: {} },
    ]);
    mockAdapters.ghl.ingestion.fetchContacts.mockResolvedValue([
      { externalId: 'c-1', firstName: 'Test' },
    ]);
    mockAdapters.ghl.ingestion.fetchOpportunities.mockResolvedValue([]);
    mockAdapters.ghl.ingestion.fetchConversations.mockResolvedValue([]);
    mockAdapters.ghl.ingestion.fetchRevenue.mockResolvedValue([]);

    const result = await connectorPollingService.syncConnector('cc-1');

    expect(result.success).toBe(true);
    expect(result.accountsSynced).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockCanonicalDataService.upsertAccount).toHaveBeenCalled();
    expect(mockCanonicalDataService.upsertContact).toHaveBeenCalled();
  });

  it('updates sync status on success', async () => {
    mockDbSelectWhere
      .mockResolvedValueOnce([makeConfig()])
      .mockResolvedValueOnce([]); // no DB accounts

    mockIntegrationConnectionService.getDecryptedConnection.mockResolvedValue({ accessToken: 'token' });
    mockAdapters.ghl.ingestion.listAccounts.mockResolvedValue([]);

    await connectorPollingService.syncConnector('cc-1');

    expect(mockConnectorConfigService.updateSyncStatus).toHaveBeenCalledWith(
      'cc-1',
      'org-1',
      expect.objectContaining({ lastSyncStatus: 'success' }),
    );
  });

  it('transitions syncPhase from backfill to live on successful sync', async () => {
    mockDbSelectWhere
      .mockResolvedValueOnce([makeConfig({ syncPhase: 'backfill' })])
      .mockResolvedValueOnce([]); // no DB accounts

    mockIntegrationConnectionService.getDecryptedConnection.mockResolvedValue({ accessToken: 'token' });
    mockAdapters.ghl.ingestion.listAccounts.mockResolvedValue([]);

    await connectorPollingService.syncConnector('cc-1');

    expect(mockConnectorConfigService.update).toHaveBeenCalledWith(
      'cc-1',
      'org-1',
      { syncPhase: 'live' },
    );
  });

  it('does not transition syncPhase if already live', async () => {
    mockDbSelectWhere
      .mockResolvedValueOnce([makeConfig({ syncPhase: 'live' })])
      .mockResolvedValueOnce([]); // no DB accounts

    mockIntegrationConnectionService.getDecryptedConnection.mockResolvedValue({ accessToken: 'token' });
    mockAdapters.ghl.ingestion.listAccounts.mockResolvedValue([]);

    await connectorPollingService.syncConnector('cc-1');

    // update should not be called for syncPhase transition
    expect(mockConnectorConfigService.update).not.toHaveBeenCalled();
  });

  it('handles per-account errors gracefully and reports partial success', async () => {
    mockDbSelectWhere
      .mockResolvedValueOnce([makeConfig()])
      .mockResolvedValueOnce([
        { id: 'acc-1', externalId: 'ext-1' },
        { id: 'acc-2', externalId: 'ext-2' },
      ]);

    mockIntegrationConnectionService.getDecryptedConnection.mockResolvedValue({ accessToken: 'token' });
    mockAdapters.ghl.ingestion.listAccounts.mockResolvedValue([]);

    // First account succeeds, second throws
    mockAdapters.ghl.ingestion.fetchContacts
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Rate limited'));
    mockAdapters.ghl.ingestion.fetchOpportunities.mockResolvedValue([]);
    mockAdapters.ghl.ingestion.fetchConversations.mockResolvedValue([]);
    mockAdapters.ghl.ingestion.fetchRevenue.mockResolvedValue([]);

    const result = await connectorPollingService.syncConnector('cc-1');

    expect(result.accountsSynced).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].accountId).toBe('ext-2');
    expect(mockConnectorConfigService.updateSyncStatus).toHaveBeenCalledWith(
      'cc-1',
      'org-1',
      expect.objectContaining({ lastSyncStatus: 'partial' }),
    );
  });
});
