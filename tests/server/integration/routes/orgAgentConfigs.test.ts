import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../../setup/createTestApp.js';
import { getTestDb, cleanupTestDb, closeTestDb } from '../../../setup/testDb.js';
import { insertOrg, insertUser, insertAgent } from '../../../setup/factories.js';
import { createTestToken } from '../../../setup/authHelpers.js';

describe('Org Agent Config Routes', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let token: string;
  let orgId: string;
  let agentId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const db = getTestDb();
    await cleanupTestDb();

    const org = await insertOrg(db);
    const user = await insertUser(db, { organisationId: org.id });
    const agent = await insertAgent(db, { organisationId: org.id });
    orgId = org.id;
    agentId = agent.id;
    token = createTestToken({ id: user.id, organisationId: org.id });
  });

  afterAll(async () => {
    await cleanupTestDb();
    await closeTestDb();
  });

  describe('GET /api/org/agent-configs', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/org/agent-configs');
      expect(res.status).toBe(401);
    });

    it('returns 200 with empty list', async () => {
      const res = await request(app)
        .get('/api/org/agent-configs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/org/agent-configs', () => {
    it('creates an org agent config', async () => {
      const res = await request(app)
        .post('/api/org/agent-configs')
        .set('Authorization', `Bearer ${token}`)
        .send({ agentId, tokenBudgetPerRun: 25000, skillSlugs: ['web_search'] });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ agentId, tokenBudgetPerRun: 25000 });
    });

    it('returns config in list after creation', async () => {
      const res = await request(app)
        .get('/api/org/agent-configs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });
});
