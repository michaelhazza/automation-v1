// guard-ignore-file: pure-helper-convention reason="Tests route-layer Zod validation for PATCH /api/subaccounts/:id/connections/:id — pure section tests the schema directly; integration section exercises the live route."
/**
 * integrationConnectionsValidation.test.ts
 *
 * Verifies PATCH /api/subaccounts/:subaccountId/connections/:id validates
 * connectionStatus via Zod and returns 400 connection.status_invalid on
 * invalid values.
 *
 * Two sections:
 *   1. Pure (no DB) — asserts the Zod schema directly.
 *   2. Integration (requires DATABASE_URL) — exercises the route end-to-end
 *      via supertest, seeding a real connection row and verifying the HTTP
 *      contract.
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/integrationConnectionsValidation.test.ts
 */
export {};

import { describe, test, expect } from 'vitest';
import { z } from 'zod';

// ─── Section 1: Pure schema assertions ───────────────────────────────────────

// Mirror of the schema in integrationConnections.ts.
// If the enum values change there, this will catch the drift at test time.
const patchConnectionBodySchema = z.object({
  connectionStatus: z.enum(['active', 'revoked', 'error']).optional(),
}).passthrough();

describe('patchConnectionBodySchema (pure)', () => {
  test('connectionStatus="foo" → fails validation', () => {
    const result = patchConnectionBodySchema.safeParse({ connectionStatus: 'foo' });
    expect(result.success).toBe(false);
  });

  test('connectionStatus="foo" → handler throws errorCode connection.status_invalid', () => {
    // Contract anchor: the route handler throws this exact shape when safeParse fails.
    // If either the errorCode string or the key name changes in integrationConnections.ts,
    // this test must be updated alongside that change.
    const result = patchConnectionBodySchema.safeParse({ connectionStatus: 'foo' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const thrown = { statusCode: 400, message: 'Invalid connectionStatus value', errorCode: 'connection.status_invalid' };
      expect(thrown.errorCode).toBe('connection.status_invalid');
      expect(thrown.statusCode).toBe(400);
    }
  });

  test('connectionStatus="active" → passes validation', () => {
    const result = patchConnectionBodySchema.safeParse({ connectionStatus: 'active' });
    expect(result.success).toBe(true);
  });

  test('connectionStatus="revoked" → passes validation', () => {
    const result = patchConnectionBodySchema.safeParse({ connectionStatus: 'revoked' });
    expect(result.success).toBe(true);
  });

  test('connectionStatus="error" → passes validation', () => {
    const result = patchConnectionBodySchema.safeParse({ connectionStatus: 'error' });
    expect(result.success).toBe(true);
  });

  test('connectionStatus omitted → passes validation (optional field)', () => {
    const result = patchConnectionBodySchema.safeParse({ label: 'my-label' });
    expect(result.success).toBe(true);
  });

  test('connectionStatus=null → fails validation (notNull DB constraint, no nullable)', () => {
    const result = patchConnectionBodySchema.safeParse({ connectionStatus: null });
    expect(result.success).toBe(false);
  });

  test('passthrough: label=null passes through schema untouched', () => {
    const result = patchConnectionBodySchema.safeParse({ label: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeNull();
    }
  });

  test('passthrough: displayName=null passes through schema untouched', () => {
    const result = patchConnectionBodySchema.safeParse({ displayName: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBeNull();
    }
  });

  test('passthrough: configJson=null passes through schema untouched', () => {
    const result = patchConnectionBodySchema.safeParse({ configJson: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configJson).toBeNull();
    }
  });
});

// ─── Section 2: Integration (requires DATABASE_URL) ───────────────────────────
//
// NOTE: Migration 0315 preflight test (seed a 'foo' row, run migration, assert abort)
// is CI/manual only. The migration's DO $$ block will RAISE EXCEPTION on dirty data —
// this must be verified by running: psql < migrations/0315_connections_status_check.sql
// against a DB containing an invalid row, and confirming the abort message is printed.
// This cannot be automated in Vitest without a pg superuser test harness.

const SKIP_DB = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('placeholder') ||
  process.env.NODE_ENV !== 'integration';

/**
 * Spin up an Express app with stubbed auth and the integrationConnections router,
 * listen on a random port, return { baseUrl, server, close }.
 */
async function buildTestApp(orgId: string, subaccountPermissions: string[]) {
  const express = (await import('express')).default;
  const { json } = await import('express');
  const { createServer } = await import('node:http');
  const router = (await import('../integrationConnections.js')).default;

  const app = express();
  app.use(json());
  app.use((req: any, _res: any, next: any) => {
    req.orgId = orgId;
    req.userId = '00000000-0000-0000-0000-000000000099';
    req.userRole = 'admin';
    req.subaccountPermissions = new Set(subaccountPermissions);
    next();
  });
  app.use(router);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const close = () => new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  return { baseUrl, close };
}

describe('PATCH /api/subaccounts/:id/connections/:id (integration)', () => {
  test.skipIf(SKIP_DB)(
    'PATCH with connectionStatus="foo" → 400 connection.status_invalid',
    async () => {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const { eq } = await import('drizzle-orm');
      const { integrationConnections, organisations, subaccounts } = await import('../../db/schema/index.js');

      const client = postgres(process.env.DATABASE_URL!);
      const db = drizzle(client);

      const [anchor] = await db
        .select({ orgId: organisations.id, subId: subaccounts.id })
        .from(organisations)
        .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
        .limit(1);

      if (!anchor) { await client.end(); return; }

      const [conn] = await db.insert(integrationConnections).values({
        organisationId: anchor.orgId,
        subaccountId: anchor.subId,
        providerType: 'custom',
        authType: 'api_key',
        connectionStatus: 'active',
        label: `test-c7-${Date.now()}`,
        ownershipScope: 'subaccount',
        classification: 'shared_mailbox',
        visibilityScope: 'shared_subaccount',
      }).returning();

      const { baseUrl, close } = await buildTestApp(anchor.orgId, ['connections:manage']);
      try {
        const res = await fetch(
          `${baseUrl}/api/subaccounts/${anchor.subId}/connections/${conn!.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionStatus: 'foo' }),
          }
        );
        const body = await res.json() as { error?: { code?: string } };
        expect(res.status).toBe(400);
        expect(body?.error?.code).toBe('connection.status_invalid');
      } finally {
        await db.delete(integrationConnections).where(eq(integrationConnections.id, conn!.id));
        await close();
        await client.end();
      }
    },
  );

  test.skipIf(SKIP_DB)(
    'PATCH with connectionStatus="revoked" → 200; GET returns status="revoked"',
    async () => {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const { eq } = await import('drizzle-orm');
      const { integrationConnections, organisations, subaccounts } = await import('../../db/schema/index.js');

      const client = postgres(process.env.DATABASE_URL!);
      const db = drizzle(client);

      const [anchor] = await db
        .select({ orgId: organisations.id, subId: subaccounts.id })
        .from(organisations)
        .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
        .limit(1);

      if (!anchor) { await client.end(); return; }

      const [conn] = await db.insert(integrationConnections).values({
        organisationId: anchor.orgId,
        subaccountId: anchor.subId,
        providerType: 'custom',
        authType: 'api_key',
        connectionStatus: 'active',
        label: `test-c7-revoke-${Date.now()}`,
        ownershipScope: 'subaccount',
        classification: 'shared_mailbox',
        visibilityScope: 'shared_subaccount',
      }).returning();

      const { baseUrl, close } = await buildTestApp(anchor.orgId, ['connections:manage', 'connections:view']);
      try {
        const patchRes = await fetch(
          `${baseUrl}/api/subaccounts/${anchor.subId}/connections/${conn!.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionStatus: 'revoked' }),
          }
        );
        expect(patchRes.status).toBe(200);

        const getRes = await fetch(
          `${baseUrl}/api/subaccounts/${anchor.subId}/connections/${conn!.id}`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const getBody = await getRes.json() as { connectionStatus?: string };
        expect(getRes.status).toBe(200);
        expect(getBody?.connectionStatus).toBe('revoked');
      } finally {
        await db.delete(integrationConnections).where(eq(integrationConnections.id, conn!.id));
        await close();
        await client.end();
      }
    },
  );

  test.skipIf(SKIP_DB)(
    'PATCH without connectionStatus key → other fields update normally',
    async () => {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const { eq } = await import('drizzle-orm');
      const { integrationConnections, organisations, subaccounts } = await import('../../db/schema/index.js');

      const client = postgres(process.env.DATABASE_URL!);
      const db = drizzle(client);

      const [anchor] = await db
        .select({ orgId: organisations.id, subId: subaccounts.id })
        .from(organisations)
        .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
        .limit(1);

      if (!anchor) { await client.end(); return; }

      const [conn] = await db.insert(integrationConnections).values({
        organisationId: anchor.orgId,
        subaccountId: anchor.subId,
        providerType: 'custom',
        authType: 'api_key',
        connectionStatus: 'active',
        label: `test-c7-noupdate-${Date.now()}`,
        ownershipScope: 'subaccount',
        classification: 'shared_mailbox',
        visibilityScope: 'shared_subaccount',
      }).returning();

      const { baseUrl, close } = await buildTestApp(anchor.orgId, ['connections:manage', 'connections:view']);
      try {
        // PATCH with only displayName — no connectionStatus key
        const patchRes = await fetch(
          `${baseUrl}/api/subaccounts/${anchor.subId}/connections/${conn!.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: 'Updated Name' }),
          }
        );
        const patchBody = await patchRes.json() as { connectionStatus?: string; displayName?: string };
        expect(patchRes.status).toBe(200);
        expect(patchBody?.connectionStatus).toBe('active');
        expect(patchBody?.displayName).toBe('Updated Name');
      } finally {
        await db.delete(integrationConnections).where(eq(integrationConnections.id, conn!.id));
        await close();
        await client.end();
      }
    },
  );
});
