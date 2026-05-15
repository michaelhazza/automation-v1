// guard-ignore-file: pure-helper-convention reason="Deep-merge logic tests are pure; structural assertions verify service delegation pattern."
/**
 * supportAgentRoutes.test.ts
 *
 * Tests the PATCH /inboxes/:inboxId/agent-config deep-merge logic and verifies
 * structural service delegation in the route handler.
 *
 * Runnable via:
 *   npx vitest run server/routes/support/__tests__/supportAgentRoutes.test.ts
 */

export {};

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';
import { mergeAgentConfigPatch } from '../../../services/supportInboxConfigMergePure.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const ROUTE_PATH = path.resolve(__dirname, '../supportAgentRoutes.ts');

async function readRouteSource() {
  return fs.readFile(ROUTE_PATH, 'utf8');
}

// ─── Section 1: Deep-merge logic ─────────────────────────────────────────────

describe('PATCH deep-merge: nested collisionWindow patch preserves sibling fields', () => {
  it('partial collisionWindow patch merges without discarding siblings', () => {
    const existingConfig = {
      mode: 'assisted',
      collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: true },
      draftExpiry: { awaitingReviewHours: 72 },
    };
    const patch = {
      collisionWindow: { respectHumanAssignee: false },
    };

    const result = mergeAgentConfigPatch(existingConfig, patch);

    expect((result.collisionWindow as Record<string, unknown>).minMinutesSinceHumanActivity).toBe(30);
    expect((result.collisionWindow as Record<string, unknown>).respectHumanAssignee).toBe(false);
    expect((result.draftExpiry as Record<string, unknown>).awaitingReviewHours).toBe(72);
  });
});

describe('PATCH deep-merge: top-level non-nested patch replaces whole field', () => {
  it('non-nested key replaces value and leaves nested fields untouched', () => {
    const existingConfig = {
      mode: 'assisted',
      collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: true },
    };
    const patch = { mode: 'autonomous' };

    const result = mergeAgentConfigPatch(existingConfig, patch);

    expect(result.mode).toBe('autonomous');
    expect((result.collisionWindow as Record<string, unknown>).minMinutesSinceHumanActivity).toBe(30);
    expect((result.collisionWindow as Record<string, unknown>).respectHumanAssignee).toBe(true);
  });
});

describe('PATCH deep-merge: array value for a NESTED_KEY does NOT deep-merge', () => {
  it('array patch for optIns replaces rather than deep-merges', () => {
    const existingConfig = {
      optIns: { summarise: true },
    };
    const patch = { optIns: ['a', 'b'] };

    const result = mergeAgentConfigPatch(existingConfig, patch);

    expect(result.optIns).toEqual(['a', 'b']);
  });
});

describe('PATCH deep-merge: null value for a NESTED_KEY does NOT deep-merge', () => {
  it('null patch for collisionWindow replaces rather than deep-merges', () => {
    const existingConfig = {
      collisionWindow: { minMinutesSinceHumanActivity: 30 },
    };
    const patch = { collisionWindow: null };

    const result = mergeAgentConfigPatch(existingConfig, patch as Record<string, unknown>);

    expect(result.collisionWindow).toBeNull();
  });
});

// ─── Section 2: Structural — PATCH handler delegates to service functions ─────

describe('Structural: PATCH handler source delegates to getInbox and updateAgentConfig', () => {
  it('supportAgentRoutes.ts calls getInboxForOrg in the PATCH handler', async () => {
    const src = await readRouteSource();

    expect(src).toContain('getInboxForOrg');
  });

  it('supportAgentRoutes.ts calls updateAgentConfig in the PATCH handler', async () => {
    const src = await readRouteSource();

    expect(src).toContain('updateAgentConfig');
  });

  it('supportAgentRoutes.ts imports getInboxForOrg and updateAgentConfig from supportInboxService', async () => {
    const src = await readRouteSource();

    expect(src).toMatch(/import\s*\{[^}]*getInboxForOrg[^}]*\}\s*from\s*['"][^'"]*supportInboxService/);
    expect(src).toMatch(/import\s*\{[^}]*updateAgentConfig[^}]*\}\s*from\s*['"][^'"]*supportInboxService/);
  });

  it('PATCH handler does NOT contain inline db.select or db.update calls', async () => {
    const src = await readRouteSource();

    // Extract just the PATCH handler block (from router.patch to the closing );)
    const patchMatch = src.match(/router\.patch\([\s\S]*?^\)\s*;/m);
    const patchBlock = patchMatch ? patchMatch[0] : src;

    expect(patchBlock).not.toContain('db.select');
    expect(patchBlock).not.toContain('db.update');
  });

  it('route imports and uses mergeAgentConfigPatch', async () => {
    const src = await readRouteSource();
    expect(src).toMatch(/mergeAgentConfigPatch/);
  });

  it('updateAgentConfig result flows through asyncHandler for 403 scope_mismatch', async () => {
    const src = await readRouteSource();
    // The route calls updateAgentConfig which throws 403 for sibling-subaccount inboxes
    // asyncHandler propagates this — assert the call exists and is not immediately inside a try block
    expect(src).toMatch(/await updateAgentConfig\(inboxId,\s*parsedConfig,\s*principal\)/);
    // The 200 chars immediately preceding the updateAgentConfig call must not start a try block
    const callIdx = src.indexOf('await updateAgentConfig(inboxId');
    const preceding = src.slice(Math.max(0, callIdx - 200), callIdx);
    expect(preceding).not.toMatch(/try\s*\{\s*$/);
  });

  it('PATCH handler uses getInboxForOrg (org-only load) so sibling-subaccount returns 403 not 404', async () => {
    const src = await readRouteSource();
    // The merge-read must use getInboxForOrg (org-only, no subaccount predicate)
    // so that the subaccount scope check fires at updateAgentConfig and returns 403
    // rather than getInbox returning 404 before the write step.
    expect(src).toContain('getInboxForOrg');
    expect(src).not.toMatch(/await getInbox\(/);
  });
});
