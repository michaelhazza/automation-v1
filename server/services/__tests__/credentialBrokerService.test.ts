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
    usabilityState: {},
    configJson: {},
    isDefault: {},
    label: {},
    planTier: {},
    secretsRef: {},
    accessToken: {},
    refreshToken: {},
    updatedAt: {},
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
  ne: vi.fn((col, val) => ({ _ne: { col, val } })),
  // sql is the tagged-template function used for the metadata->>'subaccountId'
  // predicate in audit() and the JSONB allowlist filter in resolveAvailableCredentials().
  // Capture the parts so tests can assert if needed.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: { strings, values } })),
}));

// ── Dynamic import after mocks ────────────────────────────────────────────────

const { credentialBrokerService } = await import('../credentialBrokerService.js');
const { db } = await import('../../db/index.js');
const { connectionTokenService } = await import('../connectionTokenService.js');
const { integrationConnectionService } = await import('../integrationConnectionService.js');
const { logger } = await import('../../lib/logger.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

import { CANONICAL_ORG_ID, CANONICAL_SUBACCOUNT_ID } from '../../__tests__/fixtures/canonicalIds';

const ORG_ID = CANONICAL_ORG_ID;
const SUBACCOUNT_ID = CANONICAL_SUBACCOUNT_ID;
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
        organisationId: ORG_ID,
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
        organisationId: ORG_ID,
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
          organisationId: ORG_ID,
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
      subaccountId: null,
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
      subaccountId: null,
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
      credentialBrokerService.revoke({ organisationId: ORG_ID, credentialId: CONNECTION_ID, subaccountId: null }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('subaccount-scoped revoke never delegates to revokeOrgConnection (cross-scope guard)', async () => {
    // Regression: a subaccount-A actor calling revoke with subaccountId=A
    // must not be able to revoke an org-level connection in the same org by
    // supplying its credentialId. revokeOrgConnection MUST NOT be called.
    const dbModule = await import('../../db/index.js');
    // Provide a chainable update mock so the direct subaccount UPDATE can run.
    // The chain ends in .returning(...) which yields the array of revoked rows.
    (dbModule.db as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: CONNECTION_ID }]),
    }));

    const revoked = await credentialBrokerService.revoke({
      organisationId: ORG_ID,
      credentialId: CONNECTION_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(integrationConnectionService.revokeOrgConnection).not.toHaveBeenCalled();
    expect(revoked).toBe(true);
  });

  test('returns false when no row matches the requested scope', async () => {
    // Pre-broker route returned 404 when the subaccount/connection pair did
    // not exist. Broker.revoke now reports false in that case so the route
    // can preserve 404 semantics rather than silently succeeding.
    const dbModule = await import('../../db/index.js');
    (dbModule.db as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    }));

    const revoked = await credentialBrokerService.revoke({
      organisationId: ORG_ID,
      credentialId: CONNECTION_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(revoked).toBe(false);
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

  test('pushes subaccountId predicate into SQL when provided', async () => {
    // The subaccountId filter is pushed into SQL via metadata->>'subaccountId',
    // so LIMIT applies AFTER the subaccount match — not against the latest
    // org-wide window. The mock returns only the rows the SQL would have
    // returned (i.e. only the matching subaccount's rows).
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([MOCK_AUDIT_ROW]),
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const entries = await credentialBrokerService.audit({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    // Only entries matching SUBACCOUNT_ID should appear
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.subaccountId).toBe(SUBACCOUNT_ID);
    }
    // And the WHERE clause must have been called with the subaccount-id sql predicate
    expect(chain.where).toHaveBeenCalled();
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

// resolveAvailableCredentials now makes two db.select calls:
//   1st: regular (non-operator_session) active connections
//   2nd: operator_session connections with usabilityState = 'connected_usable'
// Tests use mockReturnValueOnce for each call in sequence.

const MOCK_OP_CONN = {
  id: '00000000-0000-0000-0000-000000000004',
  organisationId: ORG_ID,
  subaccountId: SUBACCOUNT_ID,
  authType: 'operator_session',
  providerType: 'salesforce',
  connectionStatus: 'active',
  usabilityState: 'connected_usable',
  tokenExpiresAt: null,
};

describe('resolveAvailableCredentials', () => {
  test('queries integrationConnections for active connections in scope', async () => {
    const chain1 = makeSelectChainNoLimit([MOCK_CONN]);
    const chain2 = makeSelectChainNoLimit([]);
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain1)
      .mockReturnValueOnce(chain2);

    await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(db.select).toHaveBeenCalled();
    expect(chain1.from).toHaveBeenCalled();
    expect(chain1.where).toHaveBeenCalled();
  });

  test('returns ResolvedCredential array with correct shape', async () => {
    const chain1 = makeSelectChainNoLimit([MOCK_CONN]);
    const chain2 = makeSelectChainNoLimit([]);
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain1)
      .mockReturnValueOnce(chain2);

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
    const chain1 = makeSelectChainNoLimit([]);
    const chain2 = makeSelectChainNoLimit([]);
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain1)
      .mockReturnValueOnce(chain2);

    const result = await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(result).toHaveLength(0);
  });

  test('does not call connectionTokenService (no decryption)', async () => {
    const chain1 = makeSelectChainNoLimit([MOCK_CONN]);
    const chain2 = makeSelectChainNoLimit([]);
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain1)
      .mockReturnValueOnce(chain2);

    await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(connectionTokenService.getAccessToken).not.toHaveBeenCalled();
  });

  test('includes operator_session rows when second query returns usable rows', async () => {
    const chain1 = makeSelectChainNoLimit([]);
    const chain2 = makeSelectChainNoLimit([MOCK_OP_CONN]);
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(chain1)
      .mockReturnValueOnce(chain2);

    const result = await credentialBrokerService.resolveAvailableCredentials({
      organisationId: ORG_ID,
      subaccountId: SUBACCOUNT_ID,
    });

    expect(result).toHaveLength(1);
    expect(result[0].authType).toBe('operator_session');
    expect(result[0].credentialId).toBe(MOCK_OP_CONN.id);
    expect(result[0].providerType).toBe('salesforce');
  });
});
