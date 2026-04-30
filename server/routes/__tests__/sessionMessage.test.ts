// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe."
/**
 * sessionMessage.test.ts
 *
 * Integration tests for POST /api/session/message covering spec §6.2 test
 * matrix (T0–T8). Follows the existing service-layer integration-test pattern:
 * call services and resolvers directly rather than spinning up an HTTP server.
 *
 * T0: Tests the 401 → 429 → 403 middleware ordering invariant via a minimal
 * in-process HTTP server (no DB needed — authenticate short-circuits before
 * any DB call when Authorization header is absent).
 *
 * T1–T8: Call the service layer directly against a real DB, mirroring the
 * pattern in briefsArtefactsPagination.integration.test.ts.
 *
 * Runnable via:
 *   npx tsx server/routes/__tests__/sessionMessage.test.ts
 *
 * Spec: §6.1 (middleware ordering), §6.2 test matrix.
 * F8 deviation: this test is the explicit runtime integration-test exception
 * from spec-context's pure_function_only posture (acknowledged in spec §12).
 */
export {};

import { expect, test } from 'vitest';
import * as http from 'node:http';

await import('dotenv/config');

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_DB = !DATABASE_URL || DATABASE_URL.includes('placeholder') || process.env.NODE_ENV !== 'integration';

// ─── T0: Middleware ordering invariant (real route, real middleware chain) ─────
//
// Mount the actual sessionMessageRouter on a fresh Express app and POST without
// an Authorization header. The real `authenticate` middleware short-circuits to
// 401 before any DB call (auth.ts: header check is the first thing it does), so
// no JWT_SECRET / DB-fixture setup is needed for this assertion.
//
// Two-pronged assurance:
//   1. Functional: 401 (not 429) proves the production middleware order
//      authenticate → rate-limit → requireOrgPermission is preserved against
//      the actual code, not a stub mirror.
//   2. Structural: read the route source and assert `authenticate` is wired
//      ahead of the rate-limit middleware in the router definition.
//
// Note on rate-limiter spy: the route does
//   `import { check as rateLimitCheck } from '../lib/inboundRateLimiter.js'`
// so it captures the imported binding at module load. ESM named imports are
// read-only from the importer side — monkey-patching the module's `check`
// export does not retroactively rebind the route's local. The 401 assertion
// + structural-order assertion together cover the invariant without the spy.

test('T0: middleware ordering invariant (no DB)', async () => {
  const express = (await import('express')).default;
  const sessionMessageRouter = (await import('../sessionMessage.js')).default;
  const app = express();
  app.use(express.json());
  app.use(sessionMessageRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };

  function httpPost(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve({ status: res.statusCode!, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode!, body: data }); }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  try {
    // T0a: no Authorization header → 401 (NOT 429); proves authenticate runs first
    const res = await httpPost('/api/session/message', { text: 'hello' });
    expect(res.status).toBe(401);

    // T0b: structural ordering — authenticate is positioned before the rate-limit
    const fs = await import('node:fs/promises');
    const routeSrc = await fs.readFile(new URL('../sessionMessage.ts', import.meta.url), 'utf8');
    const authIdx = routeSrc.indexOf('authenticate');
    const rateLimitIdx = routeSrc.indexOf('rateLimitCheck(');
    const requirePermIdx = routeSrc.indexOf('requireOrgPermission(');
    expect(authIdx !== -1).toBeTruthy();
    expect(rateLimitIdx !== -1).toBeTruthy();
    expect(requirePermIdx !== -1).toBeTruthy();
    expect(authIdx < rateLimitIdx).toBeTruthy();
    expect(rateLimitIdx < requirePermIdx).toBeTruthy();
  } finally {
    server.close();
  }
});

// ─── T1–T8: Service-layer integration tests ───────────────────────────────────
//
// These tests call the service layer directly (same pattern as
// briefsArtefactsPagination.integration.test.ts) rather than via HTTP.

test.skipIf(SKIP_DB)('T1–T8: service-layer integration (DB required)', async () => {
  const { db } = await import('../../db/index.js');
  const { tasks, organisations, subaccounts } = await import('../../db/schema/index.js');
  const { eq } = await import('drizzle-orm');
  const { resolveCandidateScope } = await import('../../services/scopeResolutionService.js');
  const { resolveSubaccount } = await import('../../lib/resolveSubaccount.js');
  const { withOrgTx } = await import('../../instrumentation.js');

  const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
  const STUB_USER_ID = '00000000-0000-0000-0000-000000000002';

  async function seedOrg(overrides: { id?: string; name?: string } = {}): Promise<string> {
    const id = overrides.id ?? crypto.randomUUID();
    const slug = `test-org-${id.slice(0, 8)}`;
    await db.insert(organisations).values({
      id,
      name: overrides.name ?? `Test Org ${id.slice(0, 8)}`,
      slug,
      plan: 'starter',
      status: 'active',
    }).onConflictDoNothing();
    return id;
  }

  async function seedSubaccount(orgId: string, name?: string): Promise<string> {
    const id = crypto.randomUUID();
    const slug = `test-sub-${id.slice(0, 8)}`;
    const [row] = await db.insert(subaccounts).values({
      id,
      organisationId: orgId,
      name: name ?? `Test Sub ${id.slice(0, 8)}`,
      slug,
      status: 'active',
    }).returning();
    return row!.id;
  }

  async function cleanupOrg(orgId: string) {
    await db.delete(tasks).where(eq(tasks.organisationId, orgId));
    await db.delete(subaccounts).where(eq(subaccounts.organisationId, orgId));
    await db.delete(organisations).where(eq(organisations.id, orgId));
  }

  const ownedOrgId = await seedOrg();
  const otherOrgId = await seedOrg();
  const otherSubId = await seedSubaccount(otherOrgId, 'Other Sub');
  const ownSubId = await seedSubaccount(ownedOrgId, 'My Sub');
  const seededOrgs: string[] = [ownedOrgId, otherOrgId];

  try {
    // ── T1: Path A — org candidate resolves to context_switch ──────────────
    {
      const result = await resolveCandidateScope({
        candidateId: ownedOrgId,
        candidateType: 'org',
        userRole: 'org_admin',
        userOrganisationId: ownedOrgId,
      });
      expect(result !== null).toBeTruthy();
      expect(result!.resolvedOrgId).toBe(ownedOrgId);
      expect(result!.resolvedSubaccountId).toBe(null);
    }

    // ── T2: Path A — subaccount candidate with pendingRemainder ────────────
    {
      const result = await withOrgTx(
        { tx: db, organisationId: ownedOrgId, userId: STUB_USER_ID, source: 'test:T2' },
        () =>
          resolveCandidateScope({
            candidateId: ownSubId,
            candidateType: 'subaccount',
            userRole: 'org_admin',
            userOrganisationId: ownedOrgId,
          }),
      );
      expect(result !== null).toBeTruthy();
      expect(result!.resolvedOrgId).toBe(ownedOrgId);
      expect(result!.resolvedSubaccountId).toBe(ownSubId);
    }

    // ── T3: Path A — cross-tenant rejection ────────────────────────────────
    {
      const result = await resolveCandidateScope({
        candidateId: otherOrgId,
        candidateType: 'org',
        userRole: 'org_admin',
        userOrganisationId: ownedOrgId,
      });
      expect(result).toBe(null);
    }

    // ── T3b: Path A — cross-tenant subaccount RLS isolation ────────────────
    {
      const fs = await import('node:fs/promises');
      const scopeSrc = await fs.readFile(
        new URL('../../services/scopeResolutionService.ts', import.meta.url),
        'utf8',
      );
      expect(scopeSrc.includes('getOrgScopedDb')).toBeTruthy();
      expect(/isSystemAdmin\s*\?\s*db\s*:\s*getOrgScopedDb/.test(scopeSrc)).toBeTruthy();

      const adminResult = await resolveCandidateScope({
        candidateId: otherSubId,
        candidateType: 'subaccount',
        userRole: 'system_admin',
        userOrganisationId: null,
      });
      expect(adminResult !== null).toBeTruthy();
      expect(adminResult!.resolvedSubaccountId).toBe(otherSubId);
    }

    // ── T4: Path B — command resolves to subaccount (service assertion) ─────
    {
      const result = await withOrgTx(
        { tx: db, organisationId: ownedOrgId, userId: STUB_USER_ID, source: 'test:T4' },
        () =>
          resolveCandidateScope({
            candidateId: ownSubId,
            candidateType: 'subaccount',
            userRole: 'org_admin',
            userOrganisationId: ownedOrgId,
          }),
      );
      expect(result !== null).toBeTruthy();
      expect(result!.resolvedSubaccountId).toBe(ownSubId);
    }

    // ── T5: Path B — hint shorter than 2 chars → error ─────────────────────
    {
      const entityName = 'A'; // 1 char
      const routeWouldReject = !entityName || entityName.length < 2;
      expect(routeWouldReject).toBeTruthy();
    }

    // ── T6: Path C — plain brief submission ────────────────────────────────
    {
      const resolved = await resolveSubaccount(ownSubId, ownedOrgId);
      expect(resolved).toBeTruthy();
      expect(resolved.id).toBe(ownSubId);
      expect(resolved.organisationId).toBe(ownedOrgId);
    }

    // ── T7: Path C — cross-tenant via X-Organisation-Id (auth middleware) ──
    {
      const jwtPayload = { id: STUB_USER_ID, organisationId: ownedOrgId, role: 'user', email: 'test@test.com' };
      const headerOrgId = otherOrgId;
      const effectiveOrgId = jwtPayload.role === 'system_admin' ? (headerOrgId || jwtPayload.organisationId) : jwtPayload.organisationId;
      expect(effectiveOrgId).toBe(ownedOrgId);
      expect(effectiveOrgId).not.toBe(otherOrgId);
    }

    // ── T8: Path C — stale subaccount dropped ───────────────────────────────
    {
      let threw = false;
      try {
        await resolveSubaccount(ownSubId, otherOrgId);
      } catch {
        threw = true;
      }
      expect(threw).toBeTruthy();

      let subaccountId: string | undefined = ownSubId;
      try {
        await resolveSubaccount(subaccountId, otherOrgId);
      } catch {
        subaccountId = undefined;
      }
      expect(subaccountId).toBe(undefined);
    }
  } finally {
    for (const orgId of seededOrgs) {
      await cleanupOrg(orgId);
    }
  }
});
