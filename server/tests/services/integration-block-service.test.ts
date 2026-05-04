/**
 * integrationBlockService — E-D4 unsafe-tool hard-block unit tests (C-P0-1).
 *
 * Verifies that checkRequiredIntegration returns { allowed: false, code: 'TOOL_NOT_RESUMABLE' }
 * when a tool is marked integrationNotResumable: true and the required integration is not connected.
 *
 * Runnable via:
 *   npx tsx server/tests/services/integration-block-service.test.ts
 */

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

import assert from 'node:assert/strict';

// --- module-level mocks before any import that loads DB ------------------

// Stub integrationConnectionService so no real DB call fires.
const mockFindActiveConnection = async (_params: unknown) => null; // no connection
const origModule = await import('../../services/integrationConnectionService.js');
(origModule.integrationConnectionService as { findActiveConnection: unknown }).findActiveConnection =
  mockFindActiveConnection;

const { ACTION_REGISTRY } = await import('../../config/actionRegistry.js');
const { checkRequiredIntegration } = await import('../../services/integrationBlockService.js');

// -------------------------------------------------------------------------

const BASE_CTX = {
  organisationId: '00000000-0000-0000-0000-000000000001',
  subaccountId: null,
  conversationId: 'conv-test',
  runId: 'run-test',
  agentId: 'agent-test',
  currentBlockSequence: 1,
};

let passed = 0;
let failed = 0;

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok — ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL — ${label}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log('\nintegration-block-service — E-D4 unit tests\n');

// Inject a fixture tool into the registry for the duration of the tests.
const FIXTURE_TOOL = '__test_not_resumable_tool__';
(ACTION_REGISTRY as Record<string, unknown>)[FIXTURE_TOOL] = {
  actionType: FIXTURE_TOOL,
  description: 'Test fixture',
  actionCategory: 'api',
  isExternal: true,
  defaultGateLevel: 'auto',
  createsBoardTask: false,
  payloadFields: [],
  parameterSchema: { parse: () => ({}) },
  retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
  idempotencyStrategy: 'read_only',
  readPath: 'none',
  requiredIntegration: 'slack',
  integrationNotResumable: true,
};

await test('returns TOOL_NOT_RESUMABLE shape when integration missing and integrationNotResumable:true', async () => {
  const result = await checkRequiredIntegration(FIXTURE_TOOL, {}, BASE_CTX);
  assert.ok('code' in result, 'result must have a code property');
  const r = result as { code: string; allowed: boolean; toolName: string; reason: string };
  assert.equal(r.code, 'TOOL_NOT_RESUMABLE', 'code must be TOOL_NOT_RESUMABLE');
  assert.equal(r.allowed, false, 'allowed must be false');
  assert.equal(r.toolName, FIXTURE_TOOL, 'toolName must match');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason must be a non-empty string');
});

await test('does not throw when integration is missing but integrationNotResumable is not set', async () => {
  const RESUMABLE_TOOL = '__test_resumable_tool__';
  (ACTION_REGISTRY as Record<string, unknown>)[RESUMABLE_TOOL] = {
    actionType: RESUMABLE_TOOL,
    description: 'Test fixture — resumable',
    actionCategory: 'api',
    isExternal: true,
    defaultGateLevel: 'auto',
    createsBoardTask: false,
    payloadFields: [],
    parameterSchema: { parse: () => ({}) },
    retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] },
    idempotencyStrategy: 'read_only',
    readPath: 'none',
    requiredIntegration: 'slack',
    // integrationNotResumable not set
  };
  const result = await checkRequiredIntegration(RESUMABLE_TOOL, {}, BASE_CTX);
  assert.equal(result.shouldBlock, true, 'should return shouldBlock:true (normal pause flow)');
  delete (ACTION_REGISTRY as Record<string, unknown>)[RESUMABLE_TOOL];
});

await test('returns shouldBlock:false when tool has no requiredIntegration', async () => {
  const result = await checkRequiredIntegration('list_platform_capabilities', {}, BASE_CTX);
  assert.equal(result.shouldBlock, false);
});

// Cleanup fixture
delete (ACTION_REGISTRY as Record<string, unknown>)[FIXTURE_TOOL];

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
