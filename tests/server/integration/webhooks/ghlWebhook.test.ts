import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createTestApp } from '../../../setup/createTestApp.js';
import { getTestDb, cleanupTestDb, closeTestDb } from '../../../setup/testDb.js';
import { insertOrg, insertConnectorConfig, insertCanonicalAccount } from '../../../setup/factories.js';

describe('GHL Webhook', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let orgId: string;
  let webhookSecret: string;
  let locationId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const db = getTestDb();
    await cleanupTestDb();

    const org = await insertOrg(db);
    orgId = org.id;
    webhookSecret = 'test-webhook-secret-12345';
    locationId = 'ghl-location-123';

    const connector = await insertConnectorConfig(db, {
      organisationId: org.id,
      connectorType: 'ghl',
      status: 'active',
      webhookSecret,
    });

    await insertCanonicalAccount(db, {
      organisationId: org.id,
      connectorConfigId: connector.id,
      externalId: locationId,
    });
  });

  afterAll(async () => {
    await cleanupTestDb();
    await closeTestDb();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await request(app)
      .post('/api/webhooks/ghl')
      .set('Content-Type', 'application/json')
      .send('not-json');
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing locationId', async () => {
    const body = JSON.stringify({ someField: 'value' });
    const res = await request(app)
      .post('/api/webhooks/ghl')
      .type('json')
      .send(body);
    expect(res.status).toBe(400);
  });

  it('returns 200 for unknown locationId (no connector found)', async () => {
    const body = JSON.stringify({ locationId: 'unknown-location' });
    const res = await request(app)
      .post('/api/webhooks/ghl')
      .type('json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true });
  });

  it('returns 401 when HMAC signature is missing but secret configured', async () => {
    const body = JSON.stringify({ locationId });
    const res = await request(app)
      .post('/api/webhooks/ghl')
      .type('json')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('returns 401 when HMAC signature is invalid', async () => {
    const body = JSON.stringify({ locationId });
    const res = await request(app)
      .post('/api/webhooks/ghl')
      .type('json')
      .set('x-ghl-signature', 'invalid-signature')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('returns 200 when HMAC signature is valid', async () => {
    const body = JSON.stringify({ locationId, type: 'ContactCreate', firstName: 'Test' });
    const hmac = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    const res = await request(app)
      .post('/api/webhooks/ghl')
      .type('json')
      .set('x-ghl-signature', hmac)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true });
  });
});
