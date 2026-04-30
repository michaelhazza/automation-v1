/**
 * integrationBlockServicePure.test.ts — Pure function tests for integrationBlockService.
 *
 * Covers:
 *   - generateBlockDecision produces correct sha256 hash format
 *   - generateBlockDecision produces deterministic dedupKey
 *   - checkRequiredIntegration always returns shouldBlock:false in v1
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/integrationBlockServicePure.test.ts
 */

import { expect, test } from 'vitest';
import crypto from 'crypto';
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

test('checkRequiredIntegration: always returns shouldBlock:false in v1', async () => {
  const result = await checkRequiredIntegration(
    'some_tool',
    { key: 'value' },
    {
      organisationId: 'org-1',
      subaccountId: null,
      conversationId: '',
      runId: 'run-1',
      agentId: 'agent-1',
      currentBlockSequence: 1,
    },
  );

  expect(result.shouldBlock).toBe(false);
});
