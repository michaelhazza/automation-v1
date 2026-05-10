// guard-ignore-file: pure-helper-convention reason="env preamble + vi.mock must run before module-level imports; dynamic import used after setup"
/**
 * teamworkWebhook.test.ts — W2 tests for recordIncident on 5xx paths.
 *
 * Covers spec §2.2:
 *  - W2: handler throws → recordIncident called with webhook:teamwork:handler_failed.
 *
 * Updated for W3 (pre-test-hardening C2): route now uses :orgWebhookToken param,
 * connector lookup is by token (findByWebhookToken), and deliveryId header is required.
 *
 * Run via: npx vitest run server/routes/webhooks/__tests__/teamworkWebhook.test.ts
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

// Teamwork connector config resolved by token — return one active config
vi.mock('../../../services/connectorConfigService.js', () => ({
  connectorConfigService: {
    findByWebhookToken: vi.fn().mockResolvedValue({
      id: 'config-tw-1',
      organisationId: 'org-tw-1',
      webhookSecret: 'teamwork-test-signing-secret',
      webhookToken: 'aaaaaaaa-0000-0000-0000-000000000001',
      status: 'active',
    }),
    // Keep legacy method for any other code paths
    findAllActiveByType: vi.fn().mockResolvedValue([]),
  },
}));

// Teamwork adapter — verifySignature passes; normaliseEvent throws to simulate handler failure
vi.mock('../../../adapters/index.js', () => ({
  adapters: {
    teamwork: {
      webhook: {
        verifySignature: vi.fn().mockReturnValue(true),
        normaliseEvent: vi.fn().mockImplementation(() => {
          throw new Error('Simulated teamwork adapter failure');
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

// Replay nonce store — new delivery (inserted: true) so processing proceeds
vi.mock('../../../lib/webhookReplayNonceStore.js', () => ({
  recordIfNew: vi.fn().mockResolvedValue({ inserted: true }),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import router (dynamic, after mocks) ─────────────────────────────────────

const teamworkRouterModule = await import('../teamworkWebhook.js');
const teamworkRouter = teamworkRouterModule.default;

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'aaaaaaaa-0000-0000-0000-000000000001';

/**
 * Build a minimal mock req/res pair to call a route handler directly.
 * Updated for W3: includes :orgWebhookToken param and x-desk-delivery header.
 */
function buildMockReqRes() {
  const body = Buffer.from(
    JSON.stringify({ id: 12345, data: { ticketId: 42 } })
  );

  const req = {
    method: 'POST',
    url: `/api/webhooks/teamwork/${VALID_TOKEN}`,
    params: { orgWebhookToken: VALID_TOKEN },
    headers: {
      'x-desk-signature': 'mock-teamwork-signature',
      'x-desk-event': 'ticket.created',
      'x-desk-delivery': 'delivery-w2-test-1',
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
 */
type RouteHandle = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function getRouteHandler(): RouteHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers = (teamworkRouter as any).stack as Array<{ route?: { stack: Array<{ handle: RouteHandle }> } }>;
  const routeLayer = layers.find((l) => l.route?.stack?.length);
  if (!routeLayer?.route) throw new Error('Could not find route layer in teamworkRouter');
  return routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('teamworkWebhook — W2 (recordIncident on handler failure)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('calls recordIncident with webhook:teamwork:handler_failed before 500 when handler throws', async () => {
    const { req, res } = buildMockReqRes();
    const handler = getRouteHandler();
    const next = vi.fn();

    // Invoke the route handler — it will:
    // 1. Resolve connector config by token ✓ (mocked)
    // 2. Parse JSON ✓
    // 3. Verify signature ✓ (mocked to pass)
    // 4. Check deliveryId ✓ (present in headers)
    // 5. Record nonce ✓ (mocked: inserted=true)
    // 6. Send 200 (Teamwork ack)
    // 7. Run async processing → normaliseEvent throws → catch → recordIncident
    handler(req, res, next as unknown as NextFunction);

    // Give the async catch block a tick to flush
    await new Promise((resolve) => setImmediate(resolve));

    // recordIncident must have been called with the handler_failed fingerprint
    const calls = mockRecordIncident.mock.calls as Array<[{ fingerprintOverride?: string; source?: string; severity?: string }]>;
    const handlerFailCall = calls.find(
      ([input]) => input.fingerprintOverride === 'webhook:teamwork:handler_failed',
    );

    expect(
      handlerFailCall,
      'recordIncident should be called with fingerprint webhook:teamwork:handler_failed',
    ).toBeDefined();

    const [input] = handlerFailCall!;
    expect(input.source).toBe('route');
    expect(input.severity).toBe('medium');
  });
});
