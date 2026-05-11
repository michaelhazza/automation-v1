// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * webhookService.test.ts — W1 tests for verifyCallbackToken.
 *
 * Covers spec §2.1:
 *  - W1 negative: production + no WEBHOOK_SECRET → throws webhook.signature_required
 *  - W1 positive: production + valid secret + valid HMAC → returns true
 *  - W1 dev: dev env + no secret → returns true; warn emitted exactly once across two calls
 *
 * Run via: npx vitest run server/services/__tests__/webhookService.test.ts
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

export {};

// ── Env preamble (before any module imports that parse process.env) ──────────
import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

// ── Module mocks ─────────────────────────────────────────────────────────────

// We need to control env.NODE_ENV and env.WEBHOOK_SECRET per-test.
// The env module parses process.env once at import time, so we mock the module
// and return a mutable object that tests can reassign between cases.

const envMock = {
  NODE_ENV: 'test' as string,
  WEBHOOK_SECRET: undefined as string | undefined,
  WEBHOOK_BASE_URL: '',
};

vi.mock('../../lib/env.js', () => ({ env: envMock }));

// Mock heavy DB / storage imports that webhookService pulls in transitively.
vi.mock('../../db/index.js', () => ({ db: {} }));
vi.mock('../../db/schema/index.js', () => ({
  executionFiles: {},
  executions: {},
  executionPayloads: {},
  users: {},
  automationEngines: {},
}));
vi.mock('../../lib/storage.js', () => ({
  getS3Client: vi.fn(),
  getBucketName: vi.fn(),
}));
vi.mock('../../services/emailService.js', () => ({ emailService: {} }));
vi.mock('../../websocket/emitters.js', () => ({
  emitExecutionUpdate: vi.fn(),
  emitSubaccountUpdate: vi.fn(),
}));

// ── Import module under test (dynamic, after mocks are in place) ─────────────

const { webhookService, resetForTest } = await import('../webhookService.js');
const { logger } = await import('../../lib/logger.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHmac(secret: string, executionId: string): string {
  return crypto.createHmac('sha256', secret).update(executionId).digest('hex');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('verifyCallbackToken — W1 (HMAC fail-closed)', () => {
  beforeEach(() => {
    // Reset the boot-once warn flag between tests
    envMock.NODE_ENV = 'test';
    envMock.WEBHOOK_SECRET = undefined;
    resetForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rejects in production when WEBHOOK_SECRET is unset', () => {
    envMock.NODE_ENV = 'production';
    envMock.WEBHOOK_SECRET = undefined;

    expect(() => {
      webhookService.verifyCallbackToken('exec-1', 'some-token', undefined);
    }).toThrow();

    let caught: unknown;
    try {
      webhookService.verifyCallbackToken('exec-1', 'some-token', undefined);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect((caught as Record<string, unknown>).errorCode).toBe('webhook.signature_required');
    expect((caught as Record<string, unknown>).statusCode).toBe(401);
    expect((caught as Record<string, unknown>).message).toBe('Webhook signature required');
  });

  test('accepts in production with valid secret + valid HMAC', () => {
    const secret = 'my-prod-secret-32chars-long-enough';
    envMock.NODE_ENV = 'production';
    envMock.WEBHOOK_SECRET = secret;

    const executionId = 'exec-prod-1';
    const validToken = makeHmac(secret, executionId);

    const result = webhookService.verifyCallbackToken(executionId, validToken, undefined);
    expect(result).toBe(true);
  });

  test('accepts in development with no secret AND emits a warn log exactly once across two calls', () => {
    envMock.NODE_ENV = 'development';
    envMock.WEBHOOK_SECRET = undefined;

    const warnSpy = vi.spyOn(logger, 'warn');

    const result1 = webhookService.verifyCallbackToken('exec-dev-1', undefined, undefined);
    const result2 = webhookService.verifyCallbackToken('exec-dev-2', undefined, undefined);

    expect(result1).toBe(true);
    expect(result2).toBe(true);

    // The warn should be emitted exactly once (boot-once flag)
    const webhookWarnCalls = warnSpy.mock.calls.filter(
      ([event]) => event === 'webhook_secret_missing',
    );
    expect(webhookWarnCalls.length).toBe(1);
  });
});
