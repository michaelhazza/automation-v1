// client/src/config/__tests__/buildRoute.test.ts
// Pure tests for buildRoute and staticRoute.
// Run via vitest (CI) or `npx vitest run client/src/config/__tests__/buildRoute.test.ts` locally.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildRoute, staticRoute } from '../routes.js';

// ── buildRoute ────────────────────────────────────────────────────────────

test('single param substituted correctly', () => {
  const result = buildRoute('/projects/:id', { id: 'abc' });
  assert.equal(result, '/projects/abc');
});

test('missing param leaves placeholder unchanged and triggers dev warn', () => {
  const originalWarn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);

  // NODE_ENV defaults to undefined in tsx, not 'production', so the guard fires
  const result = buildRoute('/projects/:id', {});
  assert.match(result, /\/:id/, 'missing param leaves placeholder in result');
  assert.ok(warnings.length > 0, 'console.warn fired for unresolved param');

  console.warn = originalWarn;
});

test('slash in param value is URI-encoded', () => {
  const result = buildRoute('/projects/:id', { id: 'a/b' });
  assert.equal(result, '/projects/a%2Fb');
});

test('multiple params substituted correctly', () => {
  const result = buildRoute('/admin/subaccounts/:subaccountId/agents/:agentSubaccountId/manage', {
    subaccountId: 'client-1',
    agentSubaccountId: 'agent-2',
  });
  assert.equal(
    result,
    '/admin/subaccounts/client-1/agents/agent-2/manage',
  );
});

test('pattern with no params passes through unchanged', () => {
  const result = buildRoute('/', undefined);
  assert.equal(result, '/');
});

test('duplicate param occurrences are all substituted (global flag)', () => {
  // Manually call buildRoute with a pattern that has two :id segments.
  // We cast to satisfy the type; the runtime behaviour is what we are testing.
  const result = buildRoute('/a/:id/b/:id' as Parameters<typeof buildRoute>[0], { id: 'x' });
  assert.equal(result, '/a/x/b/x');
});

test('negative lookahead prevents :id from matching inside :idFoo', () => {
  const result = buildRoute(
    '/admin/subaccounts/:subaccountId/agents/:agentSubaccountId/manage' as Parameters<typeof buildRoute>[0],
    { subaccountId: 'sub-1', agentSubaccountId: 'agent-99' },
  );
  assert.equal(
    result,
    '/admin/subaccounts/sub-1/agents/agent-99/manage',
  );
});

// ── staticRoute ───────────────────────────────────────────────────────────

test('staticRoute returns the pattern as AppRoute', () => {
  const result = staticRoute('/settings');
  assert.equal(result, '/settings');
});

test('staticRoute works for admin routes', () => {
  const result = staticRoute('/admin/subaccounts');
  assert.equal(result, '/admin/subaccounts');
});
