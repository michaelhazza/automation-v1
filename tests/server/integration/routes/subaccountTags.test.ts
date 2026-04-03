import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../../setup/createTestApp.js';
import { getTestDb, cleanupTestDb, closeTestDb } from '../../../setup/testDb.js';
import { insertOrg, insertUser, insertSubaccount } from '../../../setup/factories.js';
import { createTestToken } from '../../../setup/authHelpers.js';

describe('Subaccount Tags Routes', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let subaccountId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const db = getTestDb();
    await cleanupTestDb();

    const org = await insertOrg(db);
    const user = await insertUser(db, { organisationId: org.id });
    const sa = await insertSubaccount(db, { organisationId: org.id });
    subaccountId = sa.id;
    token = createTestToken({ id: user.id, organisationId: org.id });
  });

  afterAll(async () => {
    await cleanupTestDb();
    await closeTestDb();
  });

  describe('PUT /api/subaccounts/:id/tags/:key', () => {
    it('creates a tag', async () => {
      const res = await request(app)
        .put(`/api/subaccounts/${subaccountId}/tags/vertical`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: 'dental' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ key: 'vertical', value: 'dental' });
    });
  });

  describe('GET /api/subaccounts/:id/tags', () => {
    it('returns tags for a subaccount', async () => {
      const res = await request(app)
        .get(`/api/subaccounts/${subaccountId}/tags`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'vertical', value: 'dental' }),
      ]));
    });
  });

  describe('GET /api/org/subaccounts/by-tags', () => {
    it('returns 400 for malformed JSON filters', async () => {
      const res = await request(app)
        .get('/api/org/subaccounts/by-tags?filters=not-json')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('filters subaccounts by tag', async () => {
      // First create a tag
      await request(app)
        .put(`/api/subaccounts/${subaccountId}/tags/tier`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value: 'premium' });

      const filters = JSON.stringify([{ key: 'tier', value: 'premium' }]);
      const res = await request(app)
        .get(`/api/org/subaccounts/by-tags?filters=${encodeURIComponent(filters)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain(subaccountId);
    });
  });

  describe('DELETE /api/subaccounts/:id/tags/:key', () => {
    it('deletes a tag', async () => {
      const res = await request(app)
        .delete(`/api/subaccounts/${subaccountId}/tags/vertical`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });
});
