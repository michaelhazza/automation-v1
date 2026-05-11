// guard-ignore-file: pure-helper-convention reason="env preamble + vi.mock must run before module-level imports; dynamic import used after setup"
/**
 * slackWebhook.test.ts — W2 tests for recordIncident on 5xx paths.
 *
 * Covers spec §2.2:
 *  - W2: handler throws → recordIncident called with webhook:slack:handler_failed.
 *
 * Run via: npx vitest run server/routes/webhooks/__tests__/slackWebhook.test.ts
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

export {};

// ── Env preamble ─────────────────────────────────────────────────────────────
import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockRecordIncident = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/incidentIngestor.js', () => ({
  recordIncident: mockRecordIncident,
}));

// Slack connector configs — return one active config with a matching webhook secret
vi.mock('../../../services/connectorConfigService.js', () => ({
  connectorConfigService: {
    findAllActiveByType: vi.fn().mockResolvedValue([
      {
        id: 'config-1',
        organisationId: 'org-1',
        webhookSecret: 'slack-test-signing-secret',
      },
    ]),
  },
}));

// Slack adapter — verifySignature passes; normaliseEvent throws to simulate handler failure
vi.mock('../../../adapters/index.js', () => ({
  adapters: {
    slack: {
      webhook: {
        verifySignature: vi.fn().mockReturnValue(true),
        normaliseEvent: vi.fn().mockImplementation(() => {
          throw new Error('Simulated adapter failure');
        }),
      },
    },
  },
}));

vi.mock('../../../lib/webhookDedupe.js', () => ({
  webhookDedupeStore: {
    isDuplicate: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../../services/slackConversationService.js', () => ({
  resolveConversation: vi.fn(),
  resolveSlackUser: vi.fn(),
}));

// ── Import router (dynamic, after mocks) ─────────────────────────────────────

const slackRouterModule = await import('../slackWebhook.js');
const slackRouter = slackRouterModule.default;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock req/res pair to call a route handler directly.
 * The handler is extracted from the router's layer stack.
 */
function buildMockReqRes(overrides: {
  body?: Buffer;
  headers?: Record<string, string>;
}) {
  const now = Math.floor(Date.now() / 1000).toString();
  const body = overrides.body ?? Buffer.from(
    JSON.stringify({ type: 'event_callback', team_id: 'T123', event: { type: 'message' } })
  );

  const req = {
    method: 'POST',
    url: '/api/webhooks/slack',
    headers: {
      'x-slack-signature': 'v0=mock-signature',
      'x-slack-request-timestamp': now,
      ...overrides.headers,
    },
    body,
  } as unknown as Request;

  const statusCode = { value: 0 };
  const jsonBody = { value: null as unknown };

  const res = {
    status(code: number) {
      statusCode.value = code;
      return this;
    },
    json(data: unknown) {
      jsonBody.value = data;
      return this;
    },
  } as unknown as Response;

  return { req, res, statusCode, jsonBody };
}

/**
 * Extract the asyncHandler-wrapped route handler from the router stack.
 * The router layer for POST /api/webhooks/slack is at stack[0].
 * asyncHandler wraps the actual handler; calling it returns a Promise.
 */
type RouteHandle = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function getRouteHandler(): RouteHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers = (slackRouter as any).stack as Array<{ route?: { stack: Array<{ handle: RouteHandle }> } }>;
  const routeLayer = layers.find((l) => l.route?.stack?.length);
  if (!routeLayer?.route) throw new Error('Could not find route layer in slackRouter');
  return routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('slackWebhook — W2 (recordIncident on handler failure)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('calls recordIncident with webhook:slack:handler_failed before 500 when handler throws', async () => {
    const { req, res } = buildMockReqRes({});
    const handler = getRouteHandler();
    const next = vi.fn();

    // Invoke the route handler — it will:
    // 1. Parse JSON ✓
    // 2. Find active configs ✓ (mocked)
    // 3. Verify signature ✓ (mocked to pass)
    // 4. Send 200 (Slack ack)
    // 5. Run async processing → normaliseEvent throws → catch → recordIncident
    await handler(req, res, next as unknown as NextFunction);

    // Give the async catch block a tick to flush (in case of any micro-task ordering)
    await new Promise((resolve) => setImmediate(resolve));

    // recordIncident must have been called with the handler_failed fingerprint
    const calls = mockRecordIncident.mock.calls as Array<[{ fingerprintOverride?: string; source?: string; severity?: string }]>;
    const handlerFailCall = calls.find(
      ([input]) => input.fingerprintOverride === 'webhook:slack:handler_failed',
    );

    expect(
      handlerFailCall,
      'recordIncident should be called with fingerprint webhook:slack:handler_failed',
    ).toBeDefined();

    const [input] = handlerFailCall!;
    expect(input.source).toBe('route');
    expect(input.severity).toBe('medium');
  });
});
