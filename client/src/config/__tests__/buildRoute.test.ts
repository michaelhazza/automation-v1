// client/src/config/__tests__/buildRoute.test.ts
// Pure tests for buildRoute and staticRoute.
// Run with: npx tsx client/src/config/__tests__/buildRoute.test.ts

import assert from 'node:assert/strict';
import { buildRoute, staticRoute } from '../routes.js';

// ── buildRoute ────────────────────────────────────────────────────────────

// Parametric substitution
{
  const result = buildRoute('/projects/:id', { id: 'abc' });
  assert.equal(result, '/projects/abc', 'single param substituted correctly');
}

// Missing param leaves placeholder unchanged (and triggers dev warn — suppress)
{
  const originalWarn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);

  // NODE_ENV defaults to undefined in tsx, not 'production', so the guard fires
  const result = buildRoute('/projects/:id', {});
  assert.match(result, /\/:id/, 'missing param leaves placeholder in result');
  assert.ok(warnings.length > 0, 'console.warn fired for unresolved param');

  console.warn = originalWarn;
}

// URI encoding: slash in param value
{
  const result = buildRoute('/projects/:id', { id: 'a/b' });
  assert.equal(result, '/projects/a%2Fb', 'slash in param value is URI-encoded');
}

// Multiple params in one pattern
{
  const result = buildRoute('/admin/subaccounts/:subaccountId/agents/:agentSubaccountId/manage', {
    subaccountId: 'client-1',
    agentSubaccountId: 'agent-2',
  });
  assert.equal(
    result,
    '/admin/subaccounts/client-1/agents/agent-2/manage',
    'multiple params substituted correctly',
  );
}

// No params passed — static-looking use of buildRoute
{
  const result = buildRoute('/', undefined);
  assert.equal(result, '/', 'pattern with no params passes through unchanged');
}

// ── staticRoute ───────────────────────────────────────────────────────────

{
  const result = staticRoute('/settings');
  assert.equal(result, '/settings', 'staticRoute returns the pattern as AppRoute');
}

{
  const result = staticRoute('/admin/subaccounts');
  assert.equal(result, '/admin/subaccounts', 'staticRoute works for admin routes');
}

console.log('buildRoute: all tests passed');
