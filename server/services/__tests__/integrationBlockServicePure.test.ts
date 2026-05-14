/**
 * integrationBlockServicePure.test.ts — Pure function tests for integrationBlockService.
 *
 * Covers:
 *   - generateBlockDecision produces correct sha256 hash format
 *   - generateBlockDecision produces deterministic dedupKey
 *   - checkRequiredIntegration routes correctly based on ACTION_REGISTRY + connection state
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/integrationBlockServicePure.test.ts
 */

import { expect, test, vi } from 'vitest';
import crypto from 'crypto';

// Mock DB-dependent modules before any imports that transitively load them.
vi.mock('../integrationConnectionService.js', () => ({
  integrationConnectionService: {
    findActiveConnection: vi.fn(),
  },
}));

// actionRegistry imports zod for schema definitions — no DB, safe to import directly.
import { ACTION_REGISTRY } from '../../config/actionRegistry.js';
import { integrationConnectionService } from '../integrationConnectionService.js';
import { generateBlockDecision, checkRequiredIntegration } from '../integrationBlockService.js';

test('generateBlockDecision: tokenHash is sha256 of plaintext', () => {
  const decision = generateBlockDecision({
    toolName: 'send_slack_message',
    integrationId: 'slack',
    runId: 'run-123',
    currentBlockSequence: 1,
  });

  expect(decision.shouldBlock).toBe(true);
  const expected = crypto.createHash('sha256').update(decision.plaintext).digest('hex');
  expect(decision.tokenHash).toBe(expected);
});

test('generateBlockDecision: plaintext is 64 hex chars (32 bytes)', () => {
  const decision = generateBlockDecision({
    toolName: 'send_slack_message',
    integrationId: 'slack',
    runId: 'run-123',
    currentBlockSequence: 1,
  });

  expect(decision.plaintext).toMatch(/^[a-f0-9]{64}$/);
});

test('generateBlockDecision: dedupKey is deterministic for same inputs', () => {
  const params = {
    toolName: 'read_notion_page',
    integrationId: 'notion',
    runId: 'run-abc',
    currentBlockSequence: 2,
  };

  const d1 = generateBlockDecision(params);
  const d2 = generateBlockDecision(params);

  expect(d1.integrationDedupKey).toBe(d2.integrationDedupKey);
});

test('generateBlockDecision: dedupKey differs for different block sequences', () => {
  const base = { toolName: 'read_notion_page', integrationId: 'notion', runId: 'run-abc' };
  const d1 = generateBlockDecision({ ...base, currentBlockSequence: 1 });
  const d2 = generateBlockDecision({ ...base, currentBlockSequence: 2 });

  expect(d1.integrationDedupKey).not.toBe(d2.integrationDedupKey);
});

test('generateBlockDecision: each call produces unique plaintexts', () => {
  const params = {
    toolName: 'send_slack_message',
    integrationId: 'slack',
    runId: 'run-xyz',
    currentBlockSequence: 1,
  };

  const d1 = generateBlockDecision(params);
  const d2 = generateBlockDecision(params);

  // Plaintext is random — two calls must differ
  expect(d1.plaintext).not.toBe(d2.plaintext);
  // But dedupKey is deterministic
  expect(d1.integrationDedupKey).toBe(d2.integrationDedupKey);
});

test('generateBlockDecision: card fields are populated', () => {
  const decision = generateBlockDecision({
    toolName: 'send_slack_message',
    integrationId: 'slack',
    runId: 'run-123',
    currentBlockSequence: 1,
  });

  expect(decision.card.kind).toBe('integration_card');
  expect(decision.card.integrationId).toBe('slack');
  expect(decision.card.blockSequence).toBe(1);
  expect(decision.card.title).toContain('Slack');
  expect(decision.card.actionLabel).toContain('Slack');
  expect(decision.card.dismissed).toBe(false);
});

// ── checkRequiredIntegration v2 tests ──────────────────────────────────────

test('checkRequiredIntegration: tool with requiredIntegration, no active connection → shouldBlock:true', async () => {
  const origAction = (ACTION_REGISTRY as Record<string, unknown>)['send_email'];
  const origFind = integrationConnectionService.findActiveConnection;

  (ACTION_REGISTRY as Record<string, unknown>)['send_email'] = {
    ...(origAction as object),
    requiredIntegration: 'gmail',
  };
  integrationConnectionService.findActiveConnection = vi.fn().mockResolvedValue(null);

  const result = await checkRequiredIntegration('send_email', {}, {
    organisationId: 'org-1', subaccountId: 'sub-1', conversationId: 'conv-1',
    runId: 'run-1', agentId: 'agent-1', currentBlockSequence: 1,
  });

  expect(result.shouldBlock).toBe(true);
  if (result.shouldBlock) {
    expect(result.integrationId).toBe('gmail');
    expect(result.card.integrationId).toBe('gmail');
  }

  (ACTION_REGISTRY as Record<string, unknown>)['send_email'] = origAction;
  integrationConnectionService.findActiveConnection = origFind;
});

test('checkRequiredIntegration: tool with requiredIntegration, active connection → shouldBlock:false', async () => {
  const origAction = (ACTION_REGISTRY as Record<string, unknown>)['send_email'];
  const origFind = integrationConnectionService.findActiveConnection;

  (ACTION_REGISTRY as Record<string, unknown>)['send_email'] = {
    ...(origAction as object),
    requiredIntegration: 'gmail',
  };
  integrationConnectionService.findActiveConnection = vi.fn().mockResolvedValue({
    id: 'conn-1', providerType: 'gmail', connectionStatus: 'active', oauthStatus: 'active',
  });

  const result = await checkRequiredIntegration('send_email', {}, {
    organisationId: 'org-1', subaccountId: 'sub-1', conversationId: 'conv-1',
    runId: 'run-1', agentId: 'agent-1', currentBlockSequence: 1,
  });

  expect(result.shouldBlock).toBe(false);

  (ACTION_REGISTRY as Record<string, unknown>)['send_email'] = origAction;
  integrationConnectionService.findActiveConnection = origFind;
});

test('checkRequiredIntegration: tool with no requiredIntegration → shouldBlock:false, no DB call', async () => {
  const origFind = integrationConnectionService.findActiveConnection;
  const mockFind = vi.fn();
  integrationConnectionService.findActiveConnection = mockFind;

  // create_task has no requiredIntegration — if it now does, replace with list_platform_capabilities
  const result = await checkRequiredIntegration('create_task', {}, {
    organisationId: 'org-1', subaccountId: null, conversationId: '',
    runId: 'run-1', agentId: 'agent-1', currentBlockSequence: 1,
  });

  expect(result.shouldBlock).toBe(false);
  expect(mockFind).not.toHaveBeenCalled();

  integrationConnectionService.findActiveConnection = origFind;
});
