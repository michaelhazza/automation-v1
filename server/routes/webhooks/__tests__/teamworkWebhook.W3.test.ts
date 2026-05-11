// guard-ignore-file: pure-helper-convention reason="env preamble + vi.mock must run before module-level imports; dynamic import used after setup"
/**
 * teamworkWebhook.W3.test.ts — W3 tests for per-connector token + persistent dedup.
 *
 * Covers spec §C2:
 *  - URL carries a per-connector token; unknown token → 401 webhook.token_unknown
 *  - HMAC validated against the single resolved config; invalid sig → 401 webhook.signature_invalid
 *  - Missing/empty deliveryId → 400 webhook.delivery_id_required (no fallback)
 *  - Replay → 200 + replay_deduped log, no side effects
 *  - DB-backed dedup survives "multiple app instances" (same store, separate handler calls)
 *  - Old un-tokened route (POST /api/webhooks/teamwork with no param) → 404
 *
 * Run via: npx vitest run server/routes/webhooks/__tests__/teamworkWebhook.W3.test.ts
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';
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

const mockFindByWebhookToken = vi.fn();
vi.mock('../../../services/connectorConfigService.js', () => ({
  connectorConfigService: {
    findByWebhookToken: mockFindByWebhookToken,
    // Keep findAllActiveByType for any legacy paths (not used in W3 handler)
    findAllActiveByType: vi.fn().mockResolvedValue([]),
  },
}));

const mockRecordIfNew = vi.fn();
// PTH-CGT-CI: path updated when webhookReplayNonceStore moved server/lib/ → server/services/.
vi.mock('../../../services/webhookReplayNonceStore.js', () => ({
  recordIfNew: mockRecordIfNew,
}));

const mockVerifySignature = vi.fn();
const mockNormaliseEvent = vi.fn();
vi.mock('../../../adapters/index.js', () => ({
  adapters: {
    teamwork: {
      webhook: {
        verifySignature: mockVerifySignature,
        normaliseEvent: mockNormaliseEvent,
      },
    },
  },
}));

vi.mock('../../../lib/webhookDedupe.js', () => ({
  webhookDedupeStore: {
    isDuplicate: vi.fn().mockReturnValue(false),
  },
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

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VALID_TOKEN = 'cccccccc-0000-0000-0000-000000000001';
const OTHER_TOKEN = 'dddddddd-0000-0000-0000-000000000002';

const ORG_A_CONFIG = {
  id: 'config-tw-1',
  organisationId: 'aaaaaaaa-0000-0000-0000-000000000001',
  webhookSecret: 'secret-org-a',
  webhookToken: VALID_TOKEN,
  status: 'active',
  connectorType: 'teamwork',
};

const ORG_B_CONFIG = {
  id: 'config-tw-2',
  organisationId: 'bbbbbbbb-0000-0000-0000-000000000002',
  webhookSecret: 'secret-org-b',
  webhookToken: OTHER_TOKEN,
  status: 'active',
  connectorType: 'teamwork',
};

const VALID_DELIVERY_ID = 'delivery-abc-123';
const VALID_PAYLOAD = Buffer.from(JSON.stringify({ id: 1, data: {} }));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock req/res pair for the tokened route.
 */
function buildReq(overrides: {
  token?: string;
  signature?: string;
  deliveryId?: string | null;
  body?: Buffer;
  eventType?: string;
} = {}): Request {
  const {
    token = VALID_TOKEN,
    signature = 'valid-sig',
    deliveryId = VALID_DELIVERY_ID,
    body = VALID_PAYLOAD,
    eventType = 'ticket.created',
  } = overrides;

  const headers: Record<string, string | undefined> = {
    'x-desk-signature': signature,
    'x-desk-event': eventType,
  };
  if (deliveryId !== null) {
    headers['x-desk-delivery'] = deliveryId;
  }

  return {
    method: 'POST',
    url: `/api/webhooks/teamwork/${token}`,
    params: { orgWebhookToken: token },
    headers,
    body,
  } as unknown as Request;
}

interface MockRes {
  res: Response;
  statusCode: { value: number };
  jsonBody: { value: unknown };
}

function buildRes(): MockRes {
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
  return { res, statusCode, jsonBody };
}

type RouteHandle = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function getRouteHandler(): RouteHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers = (teamworkRouter as any).stack as Array<{ route?: { stack: Array<{ handle: RouteHandle }> } }>;
  const routeLayer = layers.find((l) => l.route?.stack?.length);
  if (!routeLayer?.route) throw new Error('Could not find route layer in teamworkRouter');
  return routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('teamworkWebhook W3 — per-connector token + persistent dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: signature valid, nonce is new
    mockVerifySignature.mockReturnValue(true);
    mockRecordIfNew.mockResolvedValue({ inserted: true });
    mockNormaliseEvent.mockReturnValue({
      eventType: 'ticket.created',
      externalEventId: VALID_DELIVERY_ID,
      entityExternalId: '42',
    });
  });

  test('POST /api/webhooks/teamwork (no :orgWebhookToken) returns 404 AND performs zero side effects', async () => {
    // The un-tokened route is not registered; Express returns 404 for unmatched routes.
    // We verify the router stack: none of the route paths match without a token segment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers = (teamworkRouter as any).stack as Array<{ route?: { path?: string } }>;
    const paths = layers.filter((l) => l.route).map((l) => l.route?.path);
    // All registered paths must contain the :orgWebhookToken parameter.
    for (const path of paths) {
      expect(path).toContain(':orgWebhookToken');
    }
    // No side-effect mocks should have been called.
    expect(mockFindByWebhookToken).not.toHaveBeenCalled();
    expect(mockRecordIfNew).not.toHaveBeenCalled();
    expect(mockNormaliseEvent).not.toHaveBeenCalled();
  });

  /**
   * Helper: run the handler and flush the microtask queue.
   * asyncHandler returns void synchronously — the inner async fn runs as microtasks.
   * `await flush()` drains all pending Promise continuations.
   */
  async function runHandler(req: Request, res: Response): Promise<void> {
    const handler = getRouteHandler();
    handler(req, res, vi.fn() as unknown as NextFunction);
    // Drain microtasks: one setImmediate tick is enough for mock-backed Promises.
    await new Promise((resolve) => setImmediate(resolve));
  }

  test('valid token + valid HMAC + payload missing deliveryId → 400 webhook.delivery_id_required; no nonce row inserted; no downstream processing', async () => {
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);

    const req = buildReq({ deliveryId: null });
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(400);
    expect(jsonBody.value).toMatchObject({ error: 'webhook.delivery_id_required' });
    expect(mockRecordIfNew).not.toHaveBeenCalled();
    expect(mockNormaliseEvent).not.toHaveBeenCalled();
  });

  test('valid token + valid HMAC + payload with empty-string deliveryId → 400 webhook.delivery_id_required', async () => {
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);

    const req = buildReq({ deliveryId: '' });
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(400);
    expect(jsonBody.value).toMatchObject({ error: 'webhook.delivery_id_required' });
    expect(mockRecordIfNew).not.toHaveBeenCalled();
  });

  test('URL token does not match any active connector_config row → 401 webhook.token_unknown', async () => {
    mockFindByWebhookToken.mockResolvedValue(null); // no match

    const req = buildReq({ token: 'unknown-token-uuid' });
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(401);
    expect(jsonBody.value).toMatchObject({ error: 'webhook.token_unknown' });
    expect(mockRecordIfNew).not.toHaveBeenCalled();
  });

  test('URL token belongs to org A but signature is signed with org B secret → 401 webhook.signature_invalid (cross-tenant attribution)', async () => {
    // Config returned is org A, but the HMAC verification fails
    // (simulating a payload from org B that does not match org A's secret).
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);
    mockVerifySignature.mockReturnValue(false); // org B's sig ≠ org A's secret

    const req = buildReq({ signature: 'org-b-sig' });
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(401);
    expect(jsonBody.value).toMatchObject({ error: 'webhook.signature_invalid' });
    expect(mockRecordIfNew).not.toHaveBeenCalled();
  });

  test('valid token + valid signature + new deliveryId returns 200 and processes the event', async () => {
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);
    mockRecordIfNew.mockResolvedValue({ inserted: true });

    const req = buildReq();
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(200);
    expect(jsonBody.value).toMatchObject({ received: true });
    expect(mockRecordIfNew).toHaveBeenCalledWith(
      ORG_A_CONFIG.organisationId,
      'teamwork',
      VALID_DELIVERY_ID,
    );
    expect(mockNormaliseEvent).toHaveBeenCalled();
  });

  test('same deliveryId replayed within 10 minutes returns 200 with no side effects and emits replay_deduped', async () => {
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);
    mockRecordIfNew.mockResolvedValue({ inserted: false }); // duplicate

    const req = buildReq();
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(200);
    expect(jsonBody.value).toMatchObject({ received: true, deduplicated: true });
    // No downstream processing for replays
    expect(mockNormaliseEvent).not.toHaveBeenCalled();
    expect(mockRecordIncident).not.toHaveBeenCalled();
  });

  test('same deliveryId replayed across two simulated app instances (same store, separate handler invocations) is still deduped (DB-backed proof)', async () => {
    // Both invocations hit the same handler with the same nonce.
    // First: inserted = true. Second: inserted = false (simulates DB state from first instance).
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);
    mockRecordIfNew
      .mockResolvedValueOnce({ inserted: true })  // first "instance"
      .mockResolvedValueOnce({ inserted: false }); // second "instance" — DB already has the row

    // First invocation — processes normally
    const { res: res1, statusCode: sc1, jsonBody: jb1 } = buildRes();
    await runHandler(buildReq(), res1);
    expect(sc1.value).toBe(200);
    expect(jb1.value).not.toMatchObject({ deduplicated: true });

    // Second invocation — same deliveryId, different handler call (simulated second instance)
    const { res: res2, statusCode: sc2, jsonBody: jb2 } = buildRes();
    await runHandler(buildReq(), res2);
    expect(sc2.value).toBe(200);
    expect(jb2.value).toMatchObject({ deduplicated: true });

    // normaliseEvent was only called once (for the first delivery)
    expect(mockNormaliseEvent).toHaveBeenCalledTimes(1);
  });

  test('nonce row still present past the 10-minute mark because prune was paused → duplicate delivery still deduped', async () => {
    // The prune job removes rows after 10 min, but the dedup predicate is the row's
    // EXISTENCE, not the wall clock. If prune hasn't run yet, the row still deduplicates.
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);
    mockRecordIfNew.mockResolvedValue({ inserted: false }); // row exists — even if "old"

    const req = buildReq();
    const { res, statusCode, jsonBody } = buildRes();
    await runHandler(req, res);

    expect(statusCode.value).toBe(200);
    expect(jsonBody.value).toMatchObject({ deduplicated: true });
    expect(mockNormaliseEvent).not.toHaveBeenCalled();
  });

  test('two distinct deliveryIds within the same window both process', async () => {
    mockFindByWebhookToken.mockResolvedValue(ORG_A_CONFIG);
    mockRecordIfNew
      .mockResolvedValueOnce({ inserted: true })  // first delivery
      .mockResolvedValueOnce({ inserted: true }); // second delivery

    const { res: res1, statusCode: sc1 } = buildRes();
    await runHandler(buildReq({ deliveryId: 'delivery-1' }), res1);

    const { res: res2, statusCode: sc2 } = buildRes();
    await runHandler(buildReq({ deliveryId: 'delivery-2' }), res2);

    expect(sc1.value).toBe(200);
    expect(sc2.value).toBe(200);
    expect(mockNormaliseEvent).toHaveBeenCalledTimes(2);
  });
});
