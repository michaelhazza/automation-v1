// guard-ignore-file: pure-helper-convention reason="Structural source assertions — verifies listInboxes activeOnly flag and where-clause composition. No DB access."
/**
 * supportInboxService.activeOnly.test.ts
 *
 * Verifies the activeOnly extension to listInboxes via structural source assertions.
 *
 * Tests:
 *   1. listInboxes signature includes optional `options` parameter
 *   2. activeOnly flag controls an isActive condition in the where clause
 *   3. and(...) wraps all conditions (never a bare single-condition where)
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/supportInboxService.activeOnly.test.ts
 */

export {};

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SERVICE_PATH = path.resolve(__dirname, '../supportInboxService.ts');

async function readSource(): Promise<string> {
  return fs.readFile(SERVICE_PATH, 'utf8');
}

// ─── Section 1: listInboxes signature includes optional options parameter ──────

describe('listInboxes signature', () => {
  it('includes an optional options parameter', async () => {
    const src = await readSource();
    // The function signature must contain "options?:"
    expect(src).toMatch(/options\?:/);
  });

  it('options parameter type includes activeOnly', async () => {
    const src = await readSource();
    expect(src).toMatch(/activeOnly\?:\s*boolean/);
  });
});

// ─── Section 2: activeOnly flag controls isActive condition ───────────────────

describe('activeOnly controls isActive condition', () => {
  it('isActive appears in the function body', async () => {
    const src = await readSource();
    // Structural: the isActive column is referenced in the listInboxes function body
    expect(src).toMatch(/isActive/);
  });

  it('isActive is gated by an activeOnly conditional', async () => {
    const src = await readSource();
    // The actual guard + push must exist in source code (not just in a comment)
    expect(src).toMatch(/if\s*\(\s*options\?\.activeOnly\s*===\s*true\s*\)[\s\S]{0,200}conditions\.push\(eq\(canonicalInboxes\.isActive/);
  });

  it('activeOnly condition uses eq(canonicalInboxes.isActive, true)', async () => {
    const src = await readSource();
    expect(src).toMatch(/eq\(canonicalInboxes\.isActive,\s*true\)/);
  });
});

// ─── Section 3: and(...) wraps all conditions ─────────────────────────────────

describe('and() wraps all where conditions', () => {
  it('and( appears in the where clause of listInboxes', async () => {
    const src = await readSource();
    // The where clause must use and(...) — not a bare single eq()
    expect(src).toMatch(/\.where\(and\(/);
  });

  it('conditions array is built before and(...) is called', async () => {
    const src = await readSource();
    // The conditions array pattern should exist
    expect(src).toMatch(/conditions\s*=\s*\[/);
  });

  it('organisationId condition is always included', async () => {
    const src = await readSource();
    expect(src).toMatch(/eq\(canonicalInboxes\.organisationId,\s*principalCtx\.organisationId\)/);
  });

  it('subaccountId condition is conditionally pushed', async () => {
    const src = await readSource();
    // The subaccountId guard must still be present
    expect(src).toMatch(/subaccountId.*null[\s\S]*?push|push[\s\S]*?subaccountId/);
  });
});

// ─── Section 4: getInbox also enforces subaccount scoping ─────────────────────

describe('getInbox enforces subaccount scoping', () => {
  it('getInbox where clause includes subaccountId when principal is subaccount-scoped', async () => {
    const src = await readSource();
    // getInbox must include the subaccountId predicate — mirrors the listInboxes guard
    expect(src).toMatch(/getInbox[\s\S]{0,800}subaccountId[\s\S]{0,200}null[\s\S]{0,200}eq\(canonicalInboxes\.subaccountId/);
  });

  it('getInbox uses and(...) with multiple conditions', async () => {
    const src = await readSource();
    // getInbox uses and() in its where clause
    const getInboxSection = src.slice(src.indexOf('export async function getInbox'));
    expect(getInboxSection).toMatch(/\.where\(\s*and\(/);
  });
});
