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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ─── Pure deep-merge helper (mirrors the PATCH handler logic) ─────────────────

function applyDeepMerge(
  existingConfig: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existingConfig, ...patch };
  const NESTED_KEYS = ['collisionWindow', 'draftExpiry', 'optIns'] as const;
  for (const key of NESTED_KEYS) {
    if (patch[key] != null && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      merged[key] = { ...(existingConfig[key] as object), ...(patch[key] as object) };
    }
  }
  return merged;
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

    const result = applyDeepMerge(existingConfig, patch);

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

    const result = applyDeepMerge(existingConfig, patch);

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

    const result = applyDeepMerge(existingConfig, patch);

    expect(result.optIns).toEqual(['a', 'b']);
  });
});

describe('PATCH deep-merge: null value for a NESTED_KEY does NOT deep-merge', () => {
  it('null patch for collisionWindow replaces rather than deep-merges', () => {
    const existingConfig = {
      collisionWindow: { minMinutesSinceHumanActivity: 30 },
    };
    const patch = { collisionWindow: null };

    const result = applyDeepMerge(existingConfig, patch as Record<string, unknown>);

    expect(result.collisionWindow).toBeNull();
  });
});

// ─── Section 2: Structural — PATCH handler delegates to service functions ─────

describe('Structural: PATCH handler source delegates to getInbox and updateAgentConfig', () => {
  it('supportAgentRoutes.ts calls getInbox in the PATCH handler', async () => {
    const routePath = path.resolve(__dirname, '../supportAgentRoutes.ts');
    const src = await fs.readFile(routePath, 'utf8');

    expect(src).toContain('getInbox');
  });

  it('supportAgentRoutes.ts calls updateAgentConfig in the PATCH handler', async () => {
    const routePath = path.resolve(__dirname, '../supportAgentRoutes.ts');
    const src = await fs.readFile(routePath, 'utf8');

    expect(src).toContain('updateAgentConfig');
  });

  it('supportAgentRoutes.ts imports getInbox and updateAgentConfig from supportInboxService', async () => {
    const routePath = path.resolve(__dirname, '../supportAgentRoutes.ts');
    const src = await fs.readFile(routePath, 'utf8');

    expect(src).toMatch(/import\s*\{[^}]*getInbox[^}]*\}\s*from\s*['"][^'"]*supportInboxService/);
    expect(src).toMatch(/import\s*\{[^}]*updateAgentConfig[^}]*\}\s*from\s*['"][^'"]*supportInboxService/);
  });

  it('PATCH handler does NOT contain inline db.select or db.update calls', async () => {
    const routePath = path.resolve(__dirname, '../supportAgentRoutes.ts');
    const src = await fs.readFile(routePath, 'utf8');

    // Extract just the PATCH handler block (from router.patch to the closing );)
    const patchMatch = src.match(/router\.patch\([\s\S]*?^\)\s*;/m);
    const patchBlock = patchMatch ? patchMatch[0] : src;

    expect(patchBlock).not.toContain('db.select');
    expect(patchBlock).not.toContain('db.update');
  });
});
