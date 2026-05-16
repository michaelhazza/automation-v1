// guard-ignore-file: pure-helper-convention reason="Integration-style isolation test — exercises credentialBrokerService.injectIntoEnvironment with mocked DB; no pure sibling module applies"
/**
 * userOwnedAgentCredentialIsolation.test.ts
 *
 * Proves the critical safety invariant (§15, §25.3):
 *
 *   1. injectIntoEnvironment with ownerUserId=A resolves user A's connection.
 *   2. injectIntoEnvironment with ownerUserId=B resolves user B's connection
 *      (a different connection — different token value).
 *   3. Attempting injectIntoEnvironment where the credential's stored
 *      owner_user_id differs from the requested ownerUserId throws a typed
 *      OWNER_MISMATCH error (statusCode=403, errorCode=OWNER_MISMATCH).
 *
 * This test mocks the DB layer (same approach as credentialBrokerService.test.ts)
 * so no live database is required. The invariant tested is the in-memory
 * owner-match guard inside injectIntoEnvironment — which is a pure comparison
 * after the DB fetch, and the DB fetch is mocked to return a controlled row.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/userOwnedAgentCredentialIsolation.test.ts
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';
process.env.TOKEN_ENCRYPTION_KEY ??= 'a'.repeat(64);

import { CANONICAL_ORG_ID, CANONICAL_SUBACCOUNT_ID } from '../../__tests__/fixtures/canonicalIds';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = CANONICAL_ORG_ID;
const SUBACCOUNT_ID = CANONICAL_SUBACCOUNT_ID;

// Two users in the same subaccount + organisation
const USER_A_ID = '00000000-0000-0000-0000-000000000010';
const USER_B_ID = '00000000-0000-0000-0000-000000000020';

// Each user has their own Gmail integration connection
const CONN_A_ID = '00000000-0000-0000-0000-000000000011';
const CONN_B_ID = '00000000-0000-0000-0000-000000000021';

// Distinct token values so cross-fetch is detectable
const TOKEN_A = 'user-a-gmail-access-token';
const TOKEN_B = 'user-b-gmail-access-token';

const CONN_A_ROW = {
  id: CONN_A_ID,
  organisationId: ORG_ID,
  subaccountId: SUBACCOUNT_ID,
  authType: 'oauth2',
  providerType: 'gmail',
  connectionStatus: 'active',
  ownerUserId: USER_A_ID,
  tokenExpiresAt: null,
};

const CONN_B_ROW = {
  id: CONN_B_ID,
  organisationId: ORG_ID,
  subaccountId: SUBACCOUNT_ID,
  authType: 'oauth2',
  providerType: 'gmail',
  connectionStatus: 'active',
  ownerUserId: USER_B_ID,
  tokenExpiresAt: null,
};

// ── DB mock ───────────────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
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
    ownerUserId: {},
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
    getAccessToken: vi.fn(),
  },
}));

vi.mock('../integrationConnectionService.js', () => ({
  integrationConnectionService: {
    revokeOrgConnection: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
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
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: { strings, values } })),
}));

// ── Dynamic import after mocks ────────────────────────────────────────────────

const { credentialBrokerService, OWNER_MISMATCH } = await import('../credentialBrokerService.js');
const { db } = await import('../../db/index.js');
const { connectionTokenService } = await import('../connectionTokenService.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIssuedCredential(connectionId: string, organisationId: string) {
  return {
    credentialId: connectionId,
    connectionId,
    organisationId,
    authType: 'oauth2' as const,
    issuedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Test 1 — correct owner resolution for User A ──────────────────────────────

describe('credential isolation — user-owned Gmail connections', () => {
  test('Test 1: injectIntoEnvironment with ownerUserId=A resolves User A connection', async () => {
    // DB returns User A's connection row when queried
    const chain = makeSelectChain([CONN_A_ROW]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (connectionTokenService.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(TOKEN_A);

    const env: Record<string, string> = {};
    await credentialBrokerService.injectIntoEnvironment({
      issuedCredential: makeIssuedCredential(CONN_A_ID, ORG_ID),
      environment: env,
      ownerUserId: USER_A_ID,
    });

    // Token is User A's — correct connection was resolved
    expect(env['CREDENTIAL_TOKEN']).toBe(TOKEN_A);
    expect(env['CREDENTIAL_ID']).toBe(CONN_A_ID);
    // connectionTokenService was called with User A's connection row
    expect(connectionTokenService.getAccessToken).toHaveBeenCalledWith(CONN_A_ROW);
  });

  // ── Test 2 — correct owner resolution for User B ─────────────────────────────

  test('Test 2: injectIntoEnvironment with ownerUserId=B resolves User B connection (different token)', async () => {
    // DB returns User B's connection row
    const chain = makeSelectChain([CONN_B_ROW]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (connectionTokenService.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(TOKEN_B);

    const env: Record<string, string> = {};
    await credentialBrokerService.injectIntoEnvironment({
      issuedCredential: makeIssuedCredential(CONN_B_ID, ORG_ID),
      environment: env,
      ownerUserId: USER_B_ID,
    });

    // Token is User B's — a different value from User A's
    expect(env['CREDENTIAL_TOKEN']).toBe(TOKEN_B);
    expect(env['CREDENTIAL_TOKEN']).not.toBe(TOKEN_A);
    expect(env['CREDENTIAL_ID']).toBe(CONN_B_ID);
    expect(connectionTokenService.getAccessToken).toHaveBeenCalledWith(CONN_B_ROW);
  });

  // ── Test 3 — cross-owner rejection (OWNER_MISMATCH) ──────────────────────────

  test('Test 3: cross-owner fetch throws OWNER_MISMATCH when connection owner differs from requested ownerUserId', async () => {
    // The DB row belongs to User B (ownerUserId = USER_B_ID), but the caller
    // requests injection with ownerUserId = USER_A_ID — simulating an agent
    // for User A attempting to inject User B's connection.
    const chain = makeSelectChain([CONN_B_ROW]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const env: Record<string, string> = {};
    await expect(
      credentialBrokerService.injectIntoEnvironment({
        issuedCredential: makeIssuedCredential(CONN_B_ID, ORG_ID),
        environment: env,
        ownerUserId: USER_A_ID, // User A's agent tries to inject User B's credential
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: OWNER_MISMATCH,
    });

    // The environment must not be populated — no token leaked
    expect(env['CREDENTIAL_TOKEN']).toBeUndefined();
    // connectionTokenService must not have been called — broker stopped before decryption
    expect(connectionTokenService.getAccessToken).not.toHaveBeenCalled();
  });

  // ── Test 4 — symmetry: User B trying to use User A's connection ──────────────

  test('Test 4: OWNER_MISMATCH is symmetric — User B cannot inject User A connection', async () => {
    // DB row belongs to User A; caller passes ownerUserId = USER_B_ID
    const chain = makeSelectChain([CONN_A_ROW]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const env: Record<string, string> = {};
    await expect(
      credentialBrokerService.injectIntoEnvironment({
        issuedCredential: makeIssuedCredential(CONN_A_ID, ORG_ID),
        environment: env,
        ownerUserId: USER_B_ID, // User B's agent tries to inject User A's credential
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: OWNER_MISMATCH,
    });

    expect(env['CREDENTIAL_TOKEN']).toBeUndefined();
    expect(connectionTokenService.getAccessToken).not.toHaveBeenCalled();
  });

  // ── Test 5 — no ownerUserId guard (org/subaccount-scoped connection) ──────────

  test('Test 5: connection with no ownerUserId stored bypasses the owner check (shared subaccount connection)', async () => {
    // A subaccount-level shared connection has ownerUserId = null
    const sharedConn = { ...CONN_A_ROW, ownerUserId: null, id: CONN_A_ID };
    const chain = makeSelectChain([sharedConn]);
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (connectionTokenService.getAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(TOKEN_A);

    const env: Record<string, string> = {};
    // Passing ownerUserId should NOT throw when the connection has no owner set
    await credentialBrokerService.injectIntoEnvironment({
      issuedCredential: makeIssuedCredential(CONN_A_ID, ORG_ID),
      environment: env,
      ownerUserId: USER_A_ID,
    });

    expect(env['CREDENTIAL_TOKEN']).toBe(TOKEN_A);
    expect(connectionTokenService.getAccessToken).toHaveBeenCalledWith(sharedConn);
  });

  // ── Test 6 — OWNER_MISMATCH value is the typed constant ──────────────────────

  test('Test 6: OWNER_MISMATCH export equals the string constant used in errorCode', async () => {
    expect(OWNER_MISMATCH).toBe('OWNER_MISMATCH');
  });
});
