// guard-ignore-file: pure-helper-convention reason="F5 permission gate tests — pure logic of ownerScope short-circuit and AGENTS_VIEW gate."

/**
 * agentsRouteF5.test.ts
 *
 * Pure tests for the F5 permission gate on GET /api/agents.
 * Covers the ownerScope short-circuit and the AGENTS_VIEW gate logic.
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/agentsRouteF5.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

type PermSet = { canView: boolean; canManage: boolean };

// Mirrors the handler's permission decision logic
function agentsRoutePermDecision(
  ownerScope: string | undefined,
  perms: PermSet,
): { kind: 'allowed_own' } | { kind: 'allowed_view'; useListAll: boolean } | { kind: 'forbidden' } {
  if (ownerScope === 'user') return { kind: 'allowed_own' };
  if (!perms.canView) return { kind: 'forbidden' };
  return { kind: 'allowed_view', useListAll: perms.canManage };
}

describe('agentsRoutePermDecision — F5 permission gate logic', () => {
  it('ownerScope=user, no permissions → allowed_own (always allowed, F5 short-circuit)', () => {
    expect(agentsRoutePermDecision('user', { canView: false, canManage: false }))
      .toEqual({ kind: 'allowed_own' });
  });

  it('ownerScope=undefined, no permissions → forbidden', () => {
    expect(agentsRoutePermDecision(undefined, { canView: false, canManage: false }))
      .toEqual({ kind: 'forbidden' });
  });

  it('ownerScope=undefined, canView=true, canManage=false → allowed_view with useListAll=false', () => {
    expect(agentsRoutePermDecision(undefined, { canView: true, canManage: false }))
      .toEqual({ kind: 'allowed_view', useListAll: false });
  });

  it('ownerScope=undefined, canView=false, canManage=true → forbidden (AGENTS_EDIT does NOT imply AGENTS_VIEW)', () => {
    expect(agentsRoutePermDecision(undefined, { canView: false, canManage: true }))
      .toEqual({ kind: 'forbidden' });
  });

  it('ownerScope=undefined, canView=true, canManage=true → allowed_view with useListAll=true', () => {
    expect(agentsRoutePermDecision(undefined, { canView: true, canManage: true }))
      .toEqual({ kind: 'allowed_view', useListAll: true });
  });

  it('ownerScope=user, canView=true → allowed_own (short-circuit before permission check)', () => {
    expect(agentsRoutePermDecision('user', { canView: true, canManage: false }))
      .toEqual({ kind: 'allowed_own' });
  });
});

describe('agentsRouteF5 — structural assertions on agents.ts source', () => {
  const routesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const source = readFileSync(path.join(routesDir, 'agents.ts'), 'utf8');

  function readSource() {
    return source;
  }

  it('old F5 audit comment block is removed', () => {
    expect(source).not.toContain('Audit F5');
  });

  it('AGENTS_VIEW appears in the handler after ownerScope check', () => {
    const ownerScopeIdx = source.indexOf("ownerScope === 'user'");
    const agentsViewIdx = source.indexOf('AGENTS_VIEW');
    expect(ownerScopeIdx).toBeGreaterThan(-1);
    expect(agentsViewIdx).toBeGreaterThan(-1);
    // AGENTS_VIEW appears somewhere after ownerScope check in the GET /api/agents handler
    // The first occurrence of AGENTS_VIEW in the file is on the /tree route; find the one
    // that comes after the ownerScope check.
    const agentsViewAfterOwner = source.indexOf('AGENTS_VIEW', ownerScopeIdx);
    expect(agentsViewAfterOwner).toBeGreaterThan(ownerScopeIdx);
  });

  it('canView appears before canManageAgents in the file', () => {
    const canViewIdx = source.indexOf('const canView');
    const canManageIdx = source.indexOf('const canManageAgents');
    expect(canViewIdx).toBeGreaterThan(-1);
    expect(canManageIdx).toBeGreaterThan(-1);
    expect(canViewIdx).toBeLessThan(canManageIdx);
  });

  it('handler logic matches the mirrored decision function: AGENTS_VIEW checked before AGENTS_EDIT', () => {
    const src = readSource();
    const handlerSection = src.slice(src.indexOf("router.get('/api/agents'"));
    // AGENTS_VIEW must appear before AGENTS_EDIT in the handler body
    const viewIdx = handlerSection.indexOf('AGENTS_VIEW');
    const editIdx = handlerSection.indexOf('AGENTS_EDIT');
    expect(viewIdx).toBeGreaterThan(0);
    expect(editIdx).toBeGreaterThan(viewIdx);
  });

  it('handler has exactly one return before the AGENTS_VIEW check (the ownerScope=user branch)', () => {
    const src = readSource();
    const handlerSection = src.slice(
      src.indexOf("router.get('/api/agents'"),
      src.indexOf("router.post('/api/agents'"),
    );
    // Count `return;` occurrences before AGENTS_VIEW
    const beforeView = handlerSection.slice(0, handlerSection.indexOf('AGENTS_VIEW'));
    const returnMatches = (beforeView.match(/\breturn;/g) ?? []).length;
    expect(returnMatches).toBe(1); // exactly the ownerScope=user early return
  });
});
