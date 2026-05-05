// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * integrationBlockService — E-D4 unsafe-tool hard-block unit tests (C-P0-1).
 *
 * Verifies that checkRequiredIntegration returns { allowed: false, code: 'TOOL_NOT_RESUMABLE' }
 * when a tool is marked integrationNotResumable: true and the required integration is not connected.
 */
import { expect, test, vi, beforeAll, afterAll } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

vi.mock('../integrationConnectionService.js', () => ({
  integrationConnectionService: {
    findActiveConnection: vi.fn().mockResolvedValue(null),
  },
}));

const { ACTION_REGISTRY } = await import('../../config/actionRegistry.js');
const { checkRequiredIntegration } = await import('../integrationBlockService.js');

const BASE_CTX = {
  organisationId: '00000000-0000-0000-0000-000000000001',
  subaccountId: null,
  conversationId: 'conv-test',
  runId: 'run-test',
  agentId: 'agent-test',
  currentBlockSequence: 1,
};

const FIXTURE_TOOL = '__test_not_resumable_tool__';
const RESUMABLE_TOOL = '__test_resumable_tool__';

beforeAll(() => {
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
});

afterAll(() => {
  delete (ACTION_REGISTRY as Record<string, unknown>)[FIXTURE_TOOL];
  delete (ACTION_REGISTRY as Record<string, unknown>)[RESUMABLE_TOOL];
});

test('returns TOOL_NOT_RESUMABLE shape when integration missing and integrationNotResumable:true', async () => {
  const result = await checkRequiredIntegration(FIXTURE_TOOL, {}, BASE_CTX);
  expect('code' in result).toBe(true);
  const r = result as { code: string; allowed: boolean; toolName: string; reason: string };
  expect(r.code).toBe('TOOL_NOT_RESUMABLE');
  expect(r.allowed).toBe(false);
  expect(r.toolName).toBe(FIXTURE_TOOL);
  expect(typeof r.reason === 'string' && r.reason.length > 0).toBe(true);
});

test('does not throw when integration is missing but integrationNotResumable is not set', async () => {
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
  };
  const result = await checkRequiredIntegration(RESUMABLE_TOOL, {}, BASE_CTX);
  expect((result as { shouldBlock?: boolean }).shouldBlock).toBe(true);
});

test('returns shouldBlock:false when tool has no requiredIntegration', async () => {
  const result = await checkRequiredIntegration('list_platform_capabilities', {}, BASE_CTX);
  expect((result as { shouldBlock: boolean }).shouldBlock).toBe(false);
});
