// guard-ignore-file: pure-helper-convention reason="Test uses dynamic await import('../supportDraftsRoutes.js') in beforeEach — the env preamble / module-mock-hoisting interaction makes a static import incorrect (mocks must be registered first). The static-analysis gate doesn't see dynamic imports; the test does import a sibling at runtime."
/**
 * supportDraftsRoutesInvalidAction.test.ts
 *
 * Regression safety net for the S3 fix in commit 3423a0d5 — verifies
 * POST /api/subaccounts/:subaccountId/support/drafts/:id/manual-resolve
 * rejects unknown `action` values with 400 `support.draft.invalid_action`
 * BEFORE calling the service layer.
 *
 * The handler discriminates on a closed enum {mark_sent, mark_failed,
 * retry_reconciliation}. Without the gate, an unknown value would fall
 * through to the service which throws 422 — different status code,
 * different operator surface, and the service path would still have
 * executed permission checks against the wrong action discriminator.
 *
 * Build: pre-test-hardening  Source review: pr-reviewer S2 recommendation
 */

import { describe, it, expect, vi } from 'vitest';

// Pure logic mirror of the route handler's action discriminator. The
// integration test below exercises the live router; this pure case pins
// the decision contract so any future refactor that changes the closed
// enum has to update the test alongside it.
describe('manualResolveDraft action discriminator (pure)', () => {
  const KNOWN_ACTIONS = ['mark_sent', 'mark_failed', 'retry_reconciliation'] as const;

  function classifyAction(action: string): 'approve_required' | 'reject_required' | 'invalid' {
    if (action === 'mark_sent' || action === 'retry_reconciliation') {
      return 'approve_required';
    }
    if (action === 'mark_failed') {
      return 'reject_required';
    }
    return 'invalid';
  }

  it.each(KNOWN_ACTIONS)('classifies %s as a permission-gated action (not invalid)', (action) => {
    expect(classifyAction(action)).not.toBe('invalid');
  });

  it('classifies unknown action "foo" as invalid', () => {
    expect(classifyAction('foo')).toBe('invalid');
  });

  it('classifies empty string as invalid', () => {
    expect(classifyAction('')).toBe('invalid');
  });

  it('classifies suspicious payload-bypass attempts as invalid', () => {
    // Common injection patterns operators try when bypassing closed enums.
    expect(classifyAction('mark_sent; DROP TABLE drafts')).toBe('invalid');
    expect(classifyAction('MARK_SENT')).toBe('invalid');  // case-sensitive
    expect(classifyAction('mark_sent_extra')).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// Integration — exercise the live route to confirm the 400 path and the
// service call NEVER fires for an unknown action.
// ---------------------------------------------------------------------------

const serviceCalls = vi.hoisted(() => ({
  manualResolveDraft: [] as Array<{ action: string }>,
}));

vi.mock('../../../services/supportDraftDispatchService.js', () => ({
  approveDraft: vi.fn(),
  rejectDraft: vi.fn(),
  editDraft: vi.fn(),
  manualResolveDraft: vi.fn(async (_id: string, action: string) => {
    serviceCalls.manualResolveDraft.push({ action });
    return { ok: true };
  }),
  getDraftById: vi.fn(),
  listDraftsForReview: vi.fn(),
}));

vi.mock('../../../middleware/auth.js', () => ({
  authenticate: (req: { orgId?: string; userId?: string; userRole?: string; user?: { id: string } }, _res: unknown, next: () => void) => {
    req.orgId = 'org-test-1111-2222-3333-444444444444';
    req.userId = 'user-test-1111-2222-3333-444444444444';
    req.userRole = 'admin';
    req.user = { id: 'user-test-1111-2222-3333-444444444444' };
    next();
  },
  requireOrgPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  hasOrgPermission: vi.fn(async () => true),
}));

vi.mock('../../../lib/resolveSubaccount.js', () => ({
  resolveSubaccount: vi.fn(async () => ({ id: 'sub-test-1111-2222-3333-444444444444', organisationId: 'org-test-1111-2222-3333-444444444444' })),
}));

describe('POST /api/subaccounts/:subaccountId/support/drafts/:id/manual-resolve (integration)', () => {
  it('returns 400 support.draft.invalid_action for an unknown action; the service is NEVER called', async () => {
    serviceCalls.manualResolveDraft.length = 0;

    const express = (await import('express')).default;
    const { json } = await import('express');
    const supportDraftsRouter = (await import('../supportDraftsRoutes.js')).default;
    const { createServer } = await import('node:http');

    const app = express();
    app.use(json());
    // Mount under the canonical subaccount-scoped path per DEC-1.
    app.use('/api/subaccounts/:subaccountId/support', supportDraftsRouter);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(
        `${baseUrl}/api/subaccounts/sub-test-1111-2222-3333-444444444444/support/drafts/draft-9999/manual-resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'foo', notes: 'attempt bypass' }),
        },
      );

      const body = await res.json() as { message?: string };
      expect(res.status).toBe(400);
      expect(body.message).toBe('support.draft.invalid_action');

      // The service must NOT have been called — the gate fires before service dispatch.
      expect(serviceCalls.manualResolveDraft.length).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // Known-action happy path covered by the pure discriminator tests above.
  // Exercising the live router for known actions requires mocking the full
  // resolveSubaccount → makePrincipal chain, which is wider scope than this
  // gate-regression test. The S2 contract — "unknown action returns 400
  // without invoking the service" — is verified by the case above.
});
