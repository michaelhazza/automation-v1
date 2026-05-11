/**
 * localDockerSandboxPure.test.ts — Pure tests for localDockerSandboxPure.ts helpers.
 *
 * Spec B §8.2.2, §13.1, §15.3, §25.1.
 *
 * Covers:
 *   - dockerExitCodeToTerminal: all specified exit codes + signaledBy branches
 *   - assertNotLatestLocalTemplateVersion: 'latest' throws; valid pins pass
 *
 * No DB, no network, no Docker.
 *
 * Runnable via:
 *   npx vitest run server/services/sandbox/__tests__/localDockerSandboxPure.test.ts
 */

import { describe, test, expect } from 'vitest';
import {
  dockerExitCodeToTerminal,
  assertNotLatestLocalTemplateVersion,
} from '../localDockerSandboxPure.js';

// ---------------------------------------------------------------------------
// dockerExitCodeToTerminal
// ---------------------------------------------------------------------------

describe('dockerExitCodeToTerminal', () => {
  // SIGTERM signal override (worker-initiated wall-clock kill)
  test('signaledBy=SIGTERM → timed_out (any exit code)', () => {
    expect(dockerExitCodeToTerminal(0, 'SIGTERM')).toBe('timed_out');
  });

  test('signaledBy=SIGTERM with non-zero code → timed_out', () => {
    expect(dockerExitCodeToTerminal(137, 'SIGTERM')).toBe('timed_out');
  });

  // Exit code 0 — successful completion
  test('exitCode=0 → completed', () => {
    expect(dockerExitCodeToTerminal(0)).toBe('completed');
  });

  test('exitCode=0, no signaledBy → completed', () => {
    expect(dockerExitCodeToTerminal(0, undefined)).toBe('completed');
  });

  // Exit code 124 — GNU timeout
  test('exitCode=124 → timed_out (GNU timeout)', () => {
    expect(dockerExitCodeToTerminal(124)).toBe('timed_out');
  });

  // Exit code 125 — docker run itself failed
  test('exitCode=125 → provider_unavailable (docker daemon / image error)', () => {
    expect(dockerExitCodeToTerminal(125)).toBe('provider_unavailable');
  });

  // Exit codes 126/127 — command issues
  test('exitCode=126 → crashed (container command cannot be invoked)', () => {
    expect(dockerExitCodeToTerminal(126)).toBe('crashed');
  });

  test('exitCode=127 → crashed (container command not found)', () => {
    expect(dockerExitCodeToTerminal(127)).toBe('crashed');
  });

  // Exit code 137 — SIGKILL (OOM or --stop-timeout expiry)
  test('exitCode=137 → timed_out (SIGKILL via --stop-timeout)', () => {
    expect(dockerExitCodeToTerminal(137)).toBe('timed_out');
  });

  // Exit code 139 — SIGSEGV
  test('exitCode=139 → crashed (SIGSEGV)', () => {
    expect(dockerExitCodeToTerminal(139)).toBe('crashed');
  });

  // Exit code 143 — SIGTERM encoded as exit code
  test('exitCode=143 → timed_out (128+15, SIGTERM exit code)', () => {
    expect(dockerExitCodeToTerminal(143)).toBe('timed_out');
  });

  // General non-zero exit codes
  test('exitCode=1 → crashed (general non-zero)', () => {
    expect(dockerExitCodeToTerminal(1)).toBe('crashed');
  });

  test('exitCode=2 → crashed', () => {
    expect(dockerExitCodeToTerminal(2)).toBe('crashed');
  });

  test('exitCode=128 → crashed (signal base without specific mapping)', () => {
    expect(dockerExitCodeToTerminal(128)).toBe('crashed');
  });

  test('exitCode=255 → crashed (generic error)', () => {
    expect(dockerExitCodeToTerminal(255)).toBe('crashed');
  });

  // Signal name other than SIGTERM does not override exit code
  test('signaledBy=SIGKILL does not override exit code (uses exit code path)', () => {
    // When the process is killed by SIGKILL, node reports exit code 137.
    // The signaledBy guard only fires for SIGTERM.
    expect(dockerExitCodeToTerminal(137, 'SIGKILL')).toBe('timed_out');
  });

  test('signaledBy=other string does not trigger SIGTERM branch', () => {
    expect(dockerExitCodeToTerminal(1, 'SIGUSR1')).toBe('crashed');
  });
});

// ---------------------------------------------------------------------------
// assertNotLatestLocalTemplateVersion
// ---------------------------------------------------------------------------

describe('assertNotLatestLocalTemplateVersion', () => {
  test("throws when version is 'latest'", () => {
    expect(() =>
      assertNotLatestLocalTemplateVersion('latest', 'LocalDockerSandbox.constructor'),
    ).toThrow(/latest.*not allowed.*local_docker/);
  });

  test('error message includes context label', () => {
    expect(() =>
      assertNotLatestLocalTemplateVersion('latest', 'TestContext'),
    ).toThrow(/TestContext/);
  });

  test("does not throw for local-dev-{commitShort} format", () => {
    expect(() =>
      assertNotLatestLocalTemplateVersion('local-dev-abc1234', 'TestContext'),
    ).not.toThrow();
  });

  test('does not throw for local-dev-{7-char hash}', () => {
    expect(() =>
      assertNotLatestLocalTemplateVersion('local-dev-f3a9c21', 'TestContext'),
    ).not.toThrow();
  });

  test('does not throw for semver string (e.g. v1.2.3)', () => {
    expect(() =>
      assertNotLatestLocalTemplateVersion('v1.2.3', 'TestContext'),
    ).not.toThrow();
  });

  test("case-sensitive: 'LATEST' does not throw (only exact 'latest' is banned)", () => {
    // Spec §15.3 bans exactly 'latest'. Other casing is not banned.
    expect(() =>
      assertNotLatestLocalTemplateVersion('LATEST', 'TestContext'),
    ).not.toThrow();
  });

  test("does not throw for sha256 digest format", () => {
    expect(() =>
      assertNotLatestLocalTemplateVersion(
        'sha256:abc123def456abc123def456',
        'TestContext',
      ),
    ).not.toThrow();
  });
});
