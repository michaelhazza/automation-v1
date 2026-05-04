/**
 * qualityChecks — pure logic tests.
 *
 * runQualityChecks uses runShellCommand which spawns bash processes —
 * not suitable for isolated unit tests. This file tests the observable
 * contracts of the quality-check layer without shell execution:
 *
 *   1. Config selection  — only configured commands run; unconfigured keys
 *                          are absent from the result.
 *   2. Empty config      — returns undefined (clean observation shape).
 *   3. Output truncation — truncateMiddle caps at OUTPUT_CAP (1500 chars).
 *   4. Result shape      — exitCode, passed, output fields present & typed.
 *   5. Error surfacing   — shell errors are caught as { exitCode: -1, passed: false }.
 *
 * Run via: npx tsx worker/tests/dev/qualityChecks.unit.ts
 */

import { truncateMiddle } from '../../src/logger.js';
import type { DevTaskChecks } from '../../../shared/iee/jobPayload.js';

export {}; // make this a module

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Replicated core helpers (mirror qualityChecks.ts internals) ────────────────
// These replicate the pure mapping logic so we can verify the contracts
// without spawning shell processes.

const OUTPUT_CAP = 1500;

interface CheckResult {
  exitCode: number;
  passed: boolean;
  output: string;
}

/** Maps a shell result to a CheckResult — mirrors runOne in qualityChecks.ts. */
function mapShellResult(exitCode: number, stdout: string, stderr: string): CheckResult {
  const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
  return {
    exitCode,
    passed: exitCode === 0,
    output: truncateMiddle(combined.trim(), OUTPUT_CAP),
  };
}

/** Maps a caught error to a failed CheckResult — mirrors runOne catch block. */
function mapShellError(err: unknown): CheckResult {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    exitCode: -1,
    passed: false,
    output: truncateMiddle(`check command failed to run: ${msg}`, OUTPUT_CAP),
  };
}

/**
 * Simulates runQualityChecks config-selection logic.
 * Returns the keys that would be run given the config.
 */
function selectConfigKeys(config: DevTaskChecks): Array<'lint' | 'typecheck' | 'test'> {
  const keys: Array<'lint' | 'typecheck' | 'test'> = [];
  if (config.lintCommand)      keys.push('lint');
  if (config.typecheckCommand) keys.push('typecheck');
  if (config.testCommand)      keys.push('test');
  return keys;
}

function wouldReturnUndefined(config: DevTaskChecks): boolean {
  return !config.lintCommand && !config.typecheckCommand && !config.testCommand;
}

// ── §1: Config selection ──────────────────────────────────────────────────────

console.log('\n── Config selection ──');

test('empty config → no keys selected (returns undefined)', () => {
  assert(wouldReturnUndefined({}), 'empty config must produce undefined result');
  assertEqual(selectConfigKeys({}), [], 'no keys selected');
});

test('lint only → only lint key selected', () => {
  const keys = selectConfigKeys({ lintCommand: 'npm run lint' });
  assertEqual(keys, ['lint'], 'only lint');
});

test('typecheck only → only typecheck key selected', () => {
  const keys = selectConfigKeys({ typecheckCommand: 'npx tsc --noEmit' });
  assertEqual(keys, ['typecheck'], 'only typecheck');
});

test('test only → only test key selected', () => {
  const keys = selectConfigKeys({ testCommand: 'npm test' });
  assertEqual(keys, ['test'], 'only test');
});

test('all three configured → all three keys selected', () => {
  const keys = selectConfigKeys({
    lintCommand: 'npm run lint',
    typecheckCommand: 'npx tsc --noEmit',
    testCommand: 'npm test',
  });
  assertEqual(keys, ['lint', 'typecheck', 'test'], 'all three keys');
});

test('lint + typecheck, no test (default posture) → lint + typecheck selected', () => {
  const keys = selectConfigKeys({
    lintCommand: 'npm run -s lint --if-present',
    typecheckCommand: 'npx tsc --noEmit --pretty false',
  });
  assertEqual(keys, ['lint', 'typecheck'], 'lint + typecheck only');
});

// ── §2: Empty config returns undefined ───────────────────────────────────────

console.log('\n── Empty config → undefined ──');

test('undefined lintCommand is falsy (skipped)', () => {
  assert(!undefined, 'undefined must be falsy');
});

test('all three undefined → no keys, returns undefined', () => {
  const config: DevTaskChecks = {};
  assertEqual(selectConfigKeys(config).length, 0, 'zero keys');
  assert(wouldReturnUndefined(config), 'must return undefined when no commands');
});

// ── §3: Output truncation (truncateMiddle at 1500 chars) ──────────────────────

console.log('\n── Output truncation ──');

test('short output: not truncated', () => {
  const out = mapShellResult(0, 'All good.', '');
  assertEqual(out.output, 'All good.', 'short output passes through unchanged');
});

test('output exactly at cap: not truncated', () => {
  const at = 'x'.repeat(OUTPUT_CAP);
  const out = truncateMiddle(at, OUTPUT_CAP);
  assertEqual(out.length, OUTPUT_CAP, 'at-cap string untouched');
});

test('output over cap: truncated with middle marker', () => {
  const big = 'a'.repeat(OUTPUT_CAP + 500);
  const out = truncateMiddle(big, OUTPUT_CAP);
  assert(out.length <= OUTPUT_CAP + 30, 'truncated output near cap');
  assert(out.includes('…'), 'truncated output contains ellipsis');
});

test('stderr appended with [stderr] label before truncation', () => {
  const result = mapShellResult(1, 'out', 'some error');
  assert(result.output.includes('[stderr]'), 'stderr label present');
  assert(result.output.includes('some error'), 'stderr content present');
});

test('empty stdout + stderr: combined is empty string after trim', () => {
  const result = mapShellResult(0, '', '');
  assertEqual(result.output, '', 'empty in → empty output');
});

// ── §4: Result shape — exitCode, passed, output ───────────────────────────────

console.log('\n── Result shape ──');

test('exitCode 0 → passed: true', () => {
  const r = mapShellResult(0, 'ok', '');
  assertEqual(r.passed, true, 'exitCode 0 → passed true');
  assertEqual(r.exitCode, 0, 'exitCode preserved');
});

test('exitCode 1 → passed: false', () => {
  const r = mapShellResult(1, '', 'error');
  assertEqual(r.passed, false, 'exitCode 1 → passed false');
  assertEqual(r.exitCode, 1, 'exitCode preserved');
});

test('exitCode 127 (command not found) → passed: false', () => {
  const r = mapShellResult(127, '', 'command not found');
  assertEqual(r.passed, false, 'non-zero exit is always failed');
});

test('all three result fields present', () => {
  const r = mapShellResult(0, 'output', '');
  assert('exitCode' in r, 'exitCode field');
  assert('passed' in r, 'passed field');
  assert('output' in r, 'output field');
});

// ── §5: Error surfacing ───────────────────────────────────────────────────────

console.log('\n── Error surfacing (shell command fails to run) ──');

test('timeout error → exitCode -1, passed false', () => {
  const r = mapShellError(new Error('command timed out'));
  assertEqual(r.exitCode, -1, 'exitCode -1 for thrown errors');
  assertEqual(r.passed, false, 'passed false for thrown errors');
});

test('denylist error → exitCode -1, message in output', () => {
  const r = mapShellError(new Error('command not allowed by denylist'));
  assertEqual(r.exitCode, -1, 'exitCode -1');
  assert(r.output.includes('check command failed to run:'), 'error prefix in output');
  assert(r.output.includes('denylist'), 'error message in output');
});

test('non-Error thrown → stringified in output', () => {
  const r = mapShellError('unexpected string thrown');
  assert(r.output.includes('unexpected string thrown'), 'string error in output');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
