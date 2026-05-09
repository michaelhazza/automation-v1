// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * credentialBrokerService — unit tests for the five-method facade.
 *
 * Verifies:
 *   - Each method delegates to the correct underlying primitive.
 *   - issueCredential and revoke emit the correct log codes.
 *   - Scoping fields (organisationId, subaccountId) are passed through correctly.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
process.env.TOKEN_ENCRYPTION_KEY ??= 'a'.repeat(64);

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Build a chainable query mock that resolves to a configurable rows array.
// The resolved value hangs on the last chained method — `.limit()` for queries
// that call it, or `.where()` for queries that do not use `.limit()`.
function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

// resolveAvailableCredentials does not call .limit() — the chain resolves at .where().
function makeSelectChainNoLimit(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
}

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../../db/schema/index.js', () => ({
  auditEvents: { organisationId: {}, entityType: {}, createdAt: {} },
  integrationConnections: {
    id: {},
    organisationId: {},
    subaccountId: {},
    connectionStatus: {},
    authType: {},
    providerType: {},
    tokenExpiresAt: {},
  },
}));

vi.mock('../connectionTokenService.js', () => ({
  connectionTokenService: {
    getAccessToken: vi.fn().mockResolvedValue('decrypted-token-value'),
  },
}));

vi.mock('../integrationConnectionService.js', () => ({
  integrationConnectionService: {
    revokeOrgConnection: vi.fn().mockResolvedValue(true),
  },
}));

const mockLoggerInfo = vi.fn();
vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn((...args) => mockLoggerInfo(...args)),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ _and: args })),
  desc: vi.fn((col) => ({ _desc: col })),
  eq: vi.fn((col, val) => ({ _eq: { col, val } })),
  gte: vi.fn((col, val) => ({ _gte: { col, val } })),
}));

// ── Dynamic import after mocks ────────────────────────────────────────────────

const { credentialBrokerService } = await import('../credentialBrokerService.js');
const { db } = await import('../../db/index.js');
const { connectionTokenService } = await import('../connectionTokenService.js');
const { integrationConnectionService } = await import('../integrationConnectionService.js');
const { logger } = await import('../../lib/logger.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUBACCOUNT_ID = '00000000-0000-0000-0000-000000000002';
const CONNECTION_ID = '00000000-0000-0000-0000-000000000003';

const MOCK_CONN = {
  id: CONNECTION_ID,
  organisationId: ORG_ID,
  subaccountId: SUBACCOUNT_ID,
  authType: 'oauth2',
  providerType: 'gmail',
  connectionStatus: 'active',
  tokenExpiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── issueCredential ───────────────────────────────────────────────────────────

describe('issueCredential', () => {
  test('calls db.select with org + subaccount + connectionId filter', async () => {
    const chain = makeSelectChain([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await credentialBrokerService.issueCredential({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
      connectionId: CONNECTION_ID,
      purpose: 'send_email',
    });

    expect(db.select).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  test('returns IssuedCredential with correct shape', async () => {
    const chain = makeSelectChain([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await credentialBrokerService.issueCredential({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
      connectionId: CONNECTION_ID,
      purpose: 'send_email',
    });

    expect(result.credentialId).toBe(CONNECTION_ID);
    expect(result.connectionId).toBe(CONNECTION_ID);
    expect(result.authType).toBe('oauth2');
    expect(result.issuedAt).toBeInstanceOf(Date);
  });

  test('emits foundation.credential_broker.issued log event', async () => {
    const chain = makeSelectChain([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await credentialBrokerService.issueCredential({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
      connectionId: CONNECTION_ID,
      purpose: 'iee_browser_login',
    });

    expect(logger.info).toHaveBeenCalledWith(
      'foundation.credential_broker.issued',
      expect.objectContaining({
        credentialId: CONNECTION_ID,
        organisationId: ORG_ID,
        subaccountId: SUBACCOUNT_ID,
        connectionId: CONNECTION_ID,
        purpose: 'iee_browser_login',
      }),
    );
  });

  test('throws 404 when connection not found', async () => {
    const chain = makeSelectChain([]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      credentialBrokerService.issueCredential({
        organisationId: ORG_ID,
        subaccountId: SUBACCOUNT_ID,
        connectionId: 'non-existent',
        purpose: 'test',
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: 'credential_not_found' });
  });

  test('maps authType web_login correctly', async () => {
    const chain = makeSelectChain([{ ...MOCK_CONN, authType: 'web_login' }]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await credentialBrokerService.issueCredential({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
      connectionId: CONNECTION_ID,
      purpose: 'login',
    });

    expect(result.authType).toBe('web_login');
  });

  test('maps authType api_key correctly', async () => {
    const chain = makeSelectChain([{ ...MOCK_CONN, authType: 'api_key' }]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await credentialBrokerService.issueCredential({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
      connectionId: CONNECTION_ID,
      purpose: 'api',
    });

    expect(result.authType).toBe('api_key');
  });
});

// ── injectIntoEnvironment ─────────────────────────────────────────────────────

describe('injectIntoEnvironment', () => {
  test('calls connectionTokenService.getAccessToken with the connection row', async () => {
    const chain = makeSelectChain([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const env: Record<string, string> = {};
    await credentialBrokerService.injectIntoEnvironment({
      issuedCredential: {
        credentialId: CONNECTION_ID,
        connectionId: CONNECTION_ID,
        authType: 'oauth2',
        issuedAt: new Date(),
      },
      environment: env,
    });

    expect(connectionTokenService.getAccessToken).toHaveBeenCalledWith(MOCK_CONN);
  });

  test('populates environment with CREDENTIAL_TOKEN, CREDENTIAL_ID, CREDENTIAL_AUTH_TYPE', async () => {
    const chain = makeSelectChain([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const env: Record<string, string> = {};
    await credentialBrokerService.injectIntoEnvironment({
      issuedCredential: {
        credentialId: CONNECTION_ID,
        connectionId: CONNECTION_ID,
        authType: 'oauth2',
        issuedAt: new Date(),
      },
      environment: env,
    });

    expect(env['CREDENTIAL_TOKEN']).toBe('decrypted-token-value');
    expect(env['CREDENTIAL_ID']).toBe(CONNECTION_ID);
    expect(env['CREDENTIAL_AUTH_TYPE']).toBe('oauth2');
  });

  test('throws 404 when connection not found during injection', async () => {
    const chain = makeSelectChain([]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await expect(
      credentialBrokerService.injectIntoEnvironment({
        issuedCredential: {
          credentialId: 'missing',
          connectionId: 'missing',
          authType: 'api_key',
          issuedAt: new Date(),
        },
        environment: {},
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: 'credential_not_found' });
  });
});

// ── revoke ────────────────────────────────────────────────────────────────────

describe('revoke', () => {
  test('calls integrationConnectionService.revokeOrgConnection with correct params', async () => {
    await credentialBrokerService.revoke({
      organisationId: ORG_ID,
      credentialId: CONNECTION_ID,
    });

    expect(integrationConnectionService.revokeOrgConnection).toHaveBeenCalledWith(
      CONNECTION_ID,
      ORG_ID,
    );
  });

  test('emits foundation.credential_broker.revoked log event', async () => {
    await credentialBrokerService.revoke({
      organisationId: ORG_ID,
      credentialId: CONNECTION_ID,
    });

    expect(logger.info).toHaveBeenCalledWith(
      'foundation.credential_broker.revoked',
      expect.objectContaining({
        credentialId: CONNECTION_ID,
        organisationId: ORG_ID,
      }),
    );
  });

  test('propagates errors from revokeOrgConnection', async () => {
    (integrationConnectionService.revokeOrgConnection as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce({ statusCode: 404, message: 'Connection not found' });

    await expect(
      credentialBrokerService.revoke({ organisationId: ORG_ID, credentialId: CONNECTION_ID }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── audit ─────────────────────────────────────────────────────────────────────

describe('audit', () => {
  const MOCK_AUDIT_ROW = {
    id: '00000000-0000-0000-0000-000000000099',
    organisationId: ORG_ID,
    actorId: null,
    actorType: 'user',
    action: 'web_login_connection.revoke',
    entityType: 'integration_connection',
    entityId: CONNECTION_ID,
    metadata: { subaccountId: SUBACCOUNT_ID },
    correlationId: null,
    ipAddress: null,
    workspaceActorId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  test('queries auditEvents table with organisationId scope', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([MOCK_AUDIT_ROW]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await credentialBrokerService.audit({ organisationId: ORG_ID });

    expect(db.select).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  test('maps revoke action to CredentialAuditEntry with action=revoked', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([MOCK_AUDIT_ROW]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const entries = await credentialBrokerService.audit({ organisationId: ORG_ID });

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('revoked');
    expect(entries[0].credentialId).toBe(CONNECTION_ID);
    expect(entries[0].organisationId).toBe(ORG_ID);
  });

  test('filters by subaccountId when provided', async () => {
    const otherSubaccountRow = {
      ...MOCK_AUDIT_ROW,
      metadata: { subaccountId: '00000000-0000-0000-0000-000000000099' },
    };
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([MOCK_AUDIT_ROW, otherSubaccountRow]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const entries = await credentialBrokerService.audit({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    // Only entries matching SUBACCOUNT_ID should appear
    for (const entry of entries) {
      expect(entry.subaccountId).toBe(SUBACCOUNT_ID);
    }
  });

  test('respects custom limit', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await credentialBrokerService.audit({ organisationId: ORG_ID, limit: 10 });

    expect(chain.limit).toHaveBeenCalledWith(10);
  });
});

// ── resolveAvailableCredentials ───────────────────────────────────────────────

describe('resolveAvailableCredentials', () => {
  test('queries integrationConnections for active connections in scope', async () => {
    const chain = makeSelectChainNoLimit([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(db.select).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
  });

  test('returns ResolvedCredential array with correct shape', async () => {
    const chain = makeSelectChainNoLimit([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(result).toHaveLength(1);
    expect(result[0].credentialId).toBe(CONNECTION_ID);
    expect(result[0].connectionId).toBe(CONNECTION_ID);
    expect(result[0].authType).toBe('oauth2');
    expect(result[0].providerType).toBe('gmail');
    expect(result[0].subaccountId).toBe(SUBACCOUNT_ID);
  });

  test('returns empty array when no active connections', async () => {
    const chain = makeSelectChainNoLimit([]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(result).toHaveLength(0);
  });

  test('does not call connectionTokenService (no decryption)', async () => {
    const chain = makeSelectChainNoLimit([MOCK_CONN]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(connectionTokenService.getAccessToken).not.toHaveBeenCalled();
  });
});
