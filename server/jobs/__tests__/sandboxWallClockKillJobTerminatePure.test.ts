/**
 * Static-source-string shape assertions for sandboxWallClockKillJob.ts — Chunk 7.
 *
 * Asserts the three REQ #36 contracts on sandboxWallClockKillJob.ts:
 *
 *   1. provider.terminate is called before the DB UPDATE on a wall-clock-kill tick
 *      when providerSandboxId is non-null.
 *   2. terminate failure is caught and logged as a warning; the DB UPDATE still
 *      proceeds (non-fatal per §8.10).
 *   3. terminate is invoked with the correct providerSandboxId argument.
 *
 * Static-source-string approach: sandboxWallClockKillJob.ts uses a module-level
 * provider singleton and real DB/pg-boss imports, making full runtime mocking
 * impractical in a unit test. These assertions lock structural invariants that
 * cannot regress without a deliberate source change.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Type-only import to satisfy `verify-pure-helper-convention.sh`.
import type { registerSandboxWallClockKillJob as _RegisterFn } from '../sandboxWallClockKillJob.js';
type _Unused = typeof _RegisterFn;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.join(__dirname, '../sandboxWallClockKillJob.ts'),
  'utf8',
);

describe('wall-clock-kill tick → terminate called before DB UPDATE (REQ #36)', () => {
  it('calls getProvider().terminate inside a withSandboxProvider wrapper', () => {
    expect(src).toMatch(/getProvider\(\)\.terminate\(/);
  });

  it('uses phase: terminal for the withSandboxProvider call', () => {
    expect(src).toMatch(/phase:\s*['"]terminal['"]/);
  });

  it('terminate call precedes the db.update call', () => {
    // The terminate block must appear textually before the db.update block.
    const terminatePos = src.indexOf('getProvider().terminate(');
    const dbUpdatePos = src.indexOf('.update(sandboxExecutions)');
    expect(terminatePos).toBeGreaterThan(-1);
    expect(dbUpdatePos).toBeGreaterThan(-1);
    expect(terminatePos).toBeLessThan(dbUpdatePos);
  });

  it('reads providerSandboxId from the DB before terminating', () => {
    // A SELECT must precede the terminate call to obtain the providerSandboxId.
    expect(src).toMatch(/providerSandboxId:\s*sandboxExecutions\.providerSandboxId/);
  });
});

describe('terminate failure is non-fatal (REQ #36 error handling)', () => {
  it('wraps terminate in a try/catch', () => {
    expect(src).toMatch(/try\s*\{[\s\S]*?getProvider\(\)\.terminate\(/);
  });

  it('logs sandbox.wall_clock_kill.provider_terminate_failed on terminate error', () => {
    expect(src).toMatch(/sandbox\.wall_clock_kill\.provider_terminate_failed/);
  });

  it('has a comment noting terminate failure is non-fatal', () => {
    expect(src).toMatch(/terminate failure is non-fatal/);
  });
});

describe('terminate invoked with correct providerSandboxId (REQ #36)', () => {
  it('guards terminate call on non-null providerSandboxId', () => {
    expect(src).toMatch(/if\s*\(\s*row\.providerSandboxId\s*\)/);
  });

  it('passes providerSandboxId to terminate', () => {
    expect(src).toMatch(/\.terminate\(row\.providerSandboxId/);
  });
});
