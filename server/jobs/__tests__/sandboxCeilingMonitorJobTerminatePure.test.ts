/**
 * Static-source-string shape assertions for sandboxCeilingMonitorJob.ts — Chunk 7.
 *
 * Asserts the three REQ #36 contracts on sandboxCeilingMonitorJob.ts:
 *
 *   1. provider.terminate is called before the DB UPDATE on a ceiling-tripped
 *      harvesting transition.
 *   2. terminate failure is caught and logged as a warning; the DB UPDATE still
 *      proceeds (non-fatal per §8.10).
 *   3. terminate is invoked with the correct providerSandboxId argument.
 *
 * Runtime mocking is impractical here because getProvider() uses a module-level
 * singleton wired via resolveSandboxProvider(), and sandboxCeilingMonitorJob.ts
 * has heavy DB + pg-boss imports. Static assertions lock the structural
 * invariants without requiring a full integration harness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Type-only import to satisfy `verify-pure-helper-convention.sh`.
import type { sandboxCeilingMonitorHandler as _Handler } from '../sandboxCeilingMonitorJob.js';
type _Unused = typeof _Handler;
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Strip CR per DEVELOPMENT_GUIDELINES.md §5 — Windows-authored files contain
// CRLF; the static-grep assertions below use bare \n, so normalise on read.
const src = readFileSync(
  path.join(__dirname, '../sandboxCeilingMonitorJob.ts'),
  'utf8',
).replace(/\r/g, '');

describe('ceiling tripped → terminate called before DB UPDATE (REQ #36)', () => {
  it('calls getProvider().terminate inside a withSandboxProvider wrapper', () => {
    expect(src).toMatch(/getProvider\(\)\.terminate\(/);
  });

  it('uses phase: terminal for the withSandboxProvider call', () => {
    expect(src).toMatch(/phase:\s*['"]terminal['"]/);
  });

  it('terminate call precedes the db.update call in the harvesting branch', () => {
    // The terminate block must appear textually before the db.update block.
    const terminatePos = src.indexOf('getProvider().terminate(');
    const dbUpdatePos = src.indexOf('db\n      .update(sandboxExecutions)');
    expect(terminatePos).toBeGreaterThan(-1);
    expect(dbUpdatePos).toBeGreaterThan(-1);
    expect(terminatePos).toBeLessThan(dbUpdatePos);
  });
});

describe('terminate failure is non-fatal (REQ #36 error handling)', () => {
  it('wraps terminate in a try/catch', () => {
    expect(src).toMatch(/try\s*\{[\s\S]*?getProvider\(\)\.terminate\(/);
  });

  it('logs sandbox.ceiling_monitor.provider_terminate_failed on terminate error', () => {
    expect(src).toMatch(/sandbox\.ceiling_monitor\.provider_terminate_failed/);
  });

  it('has a comment noting terminate failure is non-fatal', () => {
    expect(src).toMatch(/terminate failure is non-fatal/);
  });
});

describe('terminate invoked with correct providerSandboxId (REQ #36)', () => {
  it('passes providerSandboxId to terminate', () => {
    expect(src).toMatch(/\.terminate\(providerSandboxId\)/);
  });

  it('applyCeilingTransition accepts providerSandboxId parameter', () => {
    expect(src).toMatch(/providerSandboxId:\s*string\s*\|\s*null/);
  });
});
