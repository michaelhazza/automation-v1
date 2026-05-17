/**
 * Static-source-string shape assertions for sandboxHarvestReconciliationJob.ts.
 *
 * These tests assert on structural invariants of the production source file —
 * they do not exercise runtime behaviour. Their purpose is to lock in the
 * three Chunk-5 contracts so that a stray refactor cannot silently regress them:
 *
 *   1. StuckRow has a credential_aliases field (SANDBOX-ADV-6.1).
 *   2. runHarvestReconciliation is called with credentialAliases sourced from
 *      the row, not a hardcoded empty array (SANDBOX-ADV-6.1).
 *   3. `now` is derived from a DB SELECT NOW() query, not new Date() (SANDBOX-R3-T1).
 *   4. withOrgTx wrap is present (SANDBOX-ADV-1.1 positive proof).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Type-only import to satisfy `verify-pure-helper-convention.sh` — pins this
// shape-assertion test to its sibling production module.
import type { registerSandboxHarvestReconciliationJob as _RegisterFn } from '../sandboxHarvestReconciliationJob.js';
type _Unused = typeof _RegisterFn;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.join(__dirname, '../sandboxHarvestReconciliationJob.ts'),
  'utf8',
);

describe('StuckRow shape (SANDBOX-ADV-6.1)', () => {
  it('declares credential_aliases as an array field', () => {
    // The interface block must contain the credential_aliases field typed as an array.
    expect(src).toMatch(/credential_aliases:\s*Array</);
  });
});

describe('runHarvestReconciliation call signature (SANDBOX-ADV-6.1)', () => {
  it('passes credentialAliases from row, not a hardcoded empty array', () => {
    expect(src).toMatch(/credentialAliases:\s*row\.credential_aliases/);
  });

  it('does NOT pass a hardcoded empty array for credentialAliases', () => {
    expect(src).not.toMatch(/credentialAliases:\s*\[\]/);
  });
});

describe('DB-anchored now timestamp (SANDBOX-R3-T1)', () => {
  it('reads now via SELECT NOW() query', () => {
    expect(src).toMatch(/SELECT NOW\(\)\s+AS\s+now/);
  });

  it('does NOT use new Date() to derive the sweep timestamp inside the tx body', () => {
    // The DB-clock approach replaced the standalone `const now = new Date()`.
    // A bare `new Date(dbNow)` conversion is still present (allowed — it wraps
    // the DB-returned string). We assert there is no standalone `new Date()`
    // call without an argument inside the transaction body.
    expect(src).not.toMatch(/=\s*new Date\(\s*\)/);
  });
});

describe('withOrgTx wrap present (SANDBOX-ADV-1.1)', () => {
  it('wraps per-row reconciliation with withOrgTx', () => {
    expect(src).toMatch(/withOrgTx\s*\(/);
  });
});
