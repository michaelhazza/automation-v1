/**
 * Test data factories — create insert-ready objects for test entities.
 * Each factory returns a plain object with sensible defaults.
 * Override any field by passing a partial.
 */
import { randomUUID } from 'crypto';
import type { TestDB } from './testDb.js';
import {
  organisations,
  users,
  subaccounts,
  agents,
  orgAgentConfigs,
  canonicalAccounts,
  connectorConfigs,
  subaccountTags,
} from '../../server/db/schema/index.js';

// ── Build helpers (return plain objects, don't touch DB) ─────────────────

export function buildOrg(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    name: `Test Org ${Date.now()}`,
    slug: `test-org-${Date.now()}`,
    plan: 'pro' as const,
    status: 'active' as const,
    ...overrides,
  };
}

export function buildUser(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organisationId: randomUUID(),
    email: `user-${Date.now()}@test.com`,
    passwordHash: '$2a$10$test-hash-placeholder',
    firstName: 'Test',
    lastName: 'User',
    role: 'org_admin' as const,
    status: 'active' as const,
    ...overrides,
  };
}

export function buildSubaccount(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organisationId: randomUUID(),
    name: `Test Subaccount ${Date.now()}`,
    slug: `test-sa-${Date.now()}`,
    status: 'active' as const,
    ...overrides,
  };
}

export function buildAgent(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organisationId: randomUUID(),
    name: `Test Agent ${Date.now()}`,
    slug: `test-agent-${Date.now()}`,
    status: 'active' as const,
    masterPrompt: 'You are a test agent.',
    executionMode: 'api' as const,
    ...overrides,
  };
}

export function buildOrgAgentConfig(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organisationId: randomUUID(),
    agentId: randomUUID(),
    isActive: true,
    tokenBudgetPerRun: 30000,
    maxToolCallsPerRun: 20,
    timeoutSeconds: 300,
    ...overrides,
  };
}

export function buildConnectorConfig(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organisationId: randomUUID(),
    connectorType: 'ghl',
    status: 'active' as const,
    pollIntervalMinutes: 60,
    ...overrides,
  };
}

export function buildCanonicalAccount(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    organisationId: randomUUID(),
    connectorConfigId: randomUUID(),
    externalId: `ext-${Date.now()}`,
    displayName: 'Test Account',
    status: 'active' as const,
    ...overrides,
  };
}

// ── Insert helpers (write to DB and return the created record) ───────────

export async function insertOrg(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildOrg(overrides);
  const [row] = await db.insert(organisations).values(data).returning();
  return row;
}

export async function insertUser(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildUser(overrides);
  const [row] = await db.insert(users).values(data).returning();
  return row;
}

export async function insertSubaccount(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildSubaccount(overrides);
  const [row] = await db.insert(subaccounts).values(data).returning();
  return row;
}

export async function insertAgent(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildAgent(overrides);
  const [row] = await db.insert(agents).values(data).returning();
  return row;
}

export async function insertOrgAgentConfig(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildOrgAgentConfig(overrides);
  const [row] = await db.insert(orgAgentConfigs).values(data).returning();
  return row;
}

export async function insertConnectorConfig(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildConnectorConfig(overrides);
  const [row] = await db.insert(connectorConfigs).values(data).returning();
  return row;
}

export async function insertCanonicalAccount(db: TestDB, overrides?: Record<string, unknown>) {
  const data = buildCanonicalAccount(overrides);
  const [row] = await db.insert(canonicalAccounts).values(data).returning();
  return row;
}

/**
 * Convenience: create a full org + user + agent setup for testing.
 * Returns all created entities.
 */
export async function insertFullOrgSetup(db: TestDB) {
  const org = await insertOrg(db);
  const user = await insertUser(db, { organisationId: org.id });
  const subaccount = await insertSubaccount(db, { organisationId: org.id });
  const agent = await insertAgent(db, { organisationId: org.id });
  return { org, user, subaccount, agent };
}
