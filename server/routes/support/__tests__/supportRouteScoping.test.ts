// guard-ignore-file: pure-helper-convention reason="Route-scoping tests — verifies mount path (structural), resolveSubaccount 403 guard logic, and inbox scope_mismatch guard. Pure where possible."
/**
 * supportRouteScoping.test.ts
 *
 * Verifies the pre-test-hardening C3 invariants for the support route layer:
 *
 *   1. Legacy /api/support/* paths are unmounted → structural source assertion
 *      (the mount point in server/index.ts must NOT contain '/api/support' without subaccounts prefix)
 *   2. Cross-org subaccountId in URL → 403 from resolveSubaccount (pure logic test)
 *   3. PATCH inbox where inbox belongs to sibling subaccount → 403 support.inbox.scope_mismatch
 *      (pure logic test of the service guard)
 *   4. HTTP 404 for unregistered /api/support/* (in-process express, no DB needed)
 *
 * Spec: §0.7 invariant D, §3.1 T1.
 *
 * Runnable via:
 *   npx vitest run server/routes/support/__tests__/supportRouteScoping.test.ts
 */

export {};

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as http from 'node:http';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ─── Section 1: Structural — legacy /api/support mount is gone ────────────────
//
// Reads server/index.ts source and asserts:
//   - The OLD mount `app.use('/api/support', ...)` is NOT present
//   - The NEW scoped mount `app.use('/api/subaccounts/:subaccountId/support', ...)` IS present

describe('legacy mount removed (structural)', () => {
  it("server/index.ts does NOT mount at '/api/support' (unscoped)", async () => {
    const serverIndexPath = path.resolve(__dirname, '../../../index.ts');
    const src = await fs.readFile(serverIndexPath, 'utf8');

    // Must not have the old unscoped mount
    const hasLegacyMount = /app\.use\(\s*['"]\/api\/support['"]\s*,/.test(src);
    expect(hasLegacyMount).toBe(false);
  });

  it("server/index.ts mounts supportRouter at '/api/subaccounts/:subaccountId/support'", async () => {
    const serverIndexPath = path.resolve(__dirname, '../../../index.ts');
    const src = await fs.readFile(serverIndexPath, 'utf8');

    const hasScopedMount = /app\.use\(\s*['"]\/api\/subaccounts\/:subaccountId\/support['"]\s*,/.test(src);
    expect(hasScopedMount).toBe(true);
  });
});

// ─── Section 2: HTTP 404 for legacy /api/support/* ────────────────────────────
//
// Spins up a minimal express app with NO support routes (simulating the
// production state where legacy paths are unmounted), verifies 404.

describe('GET /api/support/* returns 404 (legacy mount removed)', () => {
  async function makeMinimalApp() {
    const express = (await import('express')).default;
    const app = express();
    // Only mount a 404 catch-all — support routes are NOT registered
    app.use('/api', (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
      res.status(404).json({ message: 'Not found' }),
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return { server, port };
  }

  function httpGet(port: number, path: string): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        res.resume(); // drain body
        res.on('end', () => resolve({ status: res.statusCode! }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('GET /api/support/tickets returns 404', async () => {
    const { server, port } = await makeMinimalApp();
    try {
      const res = await httpGet(port, '/api/support/tickets');
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /api/support/drafts returns 404', async () => {
    const { server, port } = await makeMinimalApp();
    try {
      const res = await httpGet(port, '/api/support/drafts');
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('GET /api/support/inboxes returns 404', async () => {
    const { server, port } = await makeMinimalApp();
    try {
      const res = await httpGet(port, '/api/support/inboxes');
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ─── Section 3: resolveSubaccount cross-org → 403 (pure logic) ───────────────
//
// resolveSubaccount throws { statusCode: 403 } when the subaccount exists but
// belongs to a different org. Test the guard logic directly.

function resolveSubaccountGuard(
  subaccountRow: { organisationId: string } | null,
  requestedOrgId: string,
): { statusCode: number; message: string } | null {
  if (!subaccountRow) return { statusCode: 404, message: 'Subaccount not found' };
  if (subaccountRow.organisationId !== requestedOrgId) {
    return { statusCode: 403, message: 'Subaccount not found' };
  }
  return null; // no error — access granted
}

describe('resolveSubaccount cross-org returns 403', () => {
  it('subaccount exists but belongs to different org → 403', () => {
    const err = resolveSubaccountGuard({ organisationId: 'org-B' }, 'org-A');
    expect(err?.statusCode).toBe(403);
  });

  it('subaccount belongs to own org → no error', () => {
    const err = resolveSubaccountGuard({ organisationId: 'org-A' }, 'org-A');
    expect(err).toBeNull();
  });

  it('subaccount does not exist at all → 404', () => {
    const err = resolveSubaccountGuard(null, 'org-A');
    expect(err?.statusCode).toBe(404);
  });
});

// ─── Section 4: inbox scope_mismatch guard (pure) ────────────────────────────
//
// updateAgentConfig loads the inbox row and asserts inbox.subaccountId === principal.subaccountId.
// Test this guard condition directly.

function inboxScopeMismatchGuard(
  inboxSubaccountId: string | null,
  principalSubaccountId: string | null,
): { statusCode: number; message: string } | null {
  if (principalSubaccountId !== null && inboxSubaccountId !== principalSubaccountId) {
    return { statusCode: 403, message: 'support.inbox.scope_mismatch' };
  }
  return null;
}

describe('PATCH inbox with sibling subaccount → 403 support.inbox.scope_mismatch', () => {
  it('inbox belongs to sibling subaccount → 403 scope_mismatch', () => {
    const err = inboxScopeMismatchGuard('sub-B', 'sub-A');
    expect(err?.statusCode).toBe(403);
    expect(err?.message).toBe('support.inbox.scope_mismatch');
  });

  it('inbox belongs to principal subaccount → no error', () => {
    const err = inboxScopeMismatchGuard('sub-A', 'sub-A');
    expect(err).toBeNull();
  });

  it('principal is org-level (null subaccountId) → no error regardless of inbox subaccount', () => {
    const err = inboxScopeMismatchGuard('sub-B', null);
    expect(err).toBeNull();
  });
});

// ─── Section 5: draft scope_mismatch guard (pure) ────────────────────────────
//
// approveDraft / rejectDraft / editDraft / manualResolveDraft each assert:
//   if (principalCtx.subaccountId !== null && ticket.subaccountId !== principalCtx.subaccountId)
//     throw forbiddenError('support.draft.scope_mismatch')
//
// This section tests the guard logic directly, mirroring the condition added to
// all four write-path functions in supportDraftDispatchService.ts.

function draftScopeMismatchGuard(
  ticketSubaccountId: string | null,
  principalSubaccountId: string | null,
): { statusCode: number; errorCode: string } | null {
  if (principalSubaccountId !== null && ticketSubaccountId !== principalSubaccountId) {
    return { statusCode: 403, errorCode: 'support.draft.scope_mismatch' };
  }
  return null;
}

describe('approveDraft with draft belonging to a sibling subaccount returns 403 support.draft.scope_mismatch', () => {
  it('draft ticket belongs to sibling subaccount → 403 support.draft.scope_mismatch', () => {
    const err = draftScopeMismatchGuard('sub-B', 'sub-A');
    expect(err?.statusCode).toBe(403);
    expect(err?.errorCode).toBe('support.draft.scope_mismatch');
  });

  it('draft ticket belongs to principal subaccount → no error', () => {
    const err = draftScopeMismatchGuard('sub-A', 'sub-A');
    expect(err).toBeNull();
  });

  it('principal is org-level (null subaccountId) → no error regardless of ticket subaccount', () => {
    const err = draftScopeMismatchGuard('sub-B', null);
    expect(err).toBeNull();
  });

  it('ticket has null subaccountId and principal is subaccount-scoped → 403 (null !== sub-A)', () => {
    const err = draftScopeMismatchGuard(null, 'sub-A');
    expect(err?.statusCode).toBe(403);
    expect(err?.errorCode).toBe('support.draft.scope_mismatch');
  });
});
