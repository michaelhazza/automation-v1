// ---------------------------------------------------------------------------
// localDockerSandboxPure.ts — Pure helpers for the localDockerSandbox provider.
//
// Extracts decision logic from the async localDockerSandbox implementation so
// it can be unit-tested without Docker, DB, or network.
//
// Spec B §8.2.2, §13.1, §15.3.
//
// verify-pure-helper-convention.sh checks that test files import from this
// module using a relative path ending in `.js`.
// ---------------------------------------------------------------------------

import type { SandboxTerminalState } from '../../../shared/types/sandbox.js';

// ---------------------------------------------------------------------------
// Mapping: Docker exit code → SandboxTerminalState
// ---------------------------------------------------------------------------

/**
 * Map a Docker process exit code (and optional signal name) to the internal
 * SandboxTerminalState taxonomy (spec §13.1 closed set of 8 terminal states).
 *
 * This is the single mapping point consumed by the harvest pipeline's step 1
 * (terminal classification — spec §8.4 step 1) for the local_docker provider.
 * Pure: no I/O, no DB, no Docker.
 *
 * Decision rules:
 * 1. `signaledBy === 'SIGTERM'` → `timed_out` (worker-initiated wall-clock kill).
 * 2. exitCode 0 → `completed`.
 * 3. exitCode 124 → `timed_out` (GNU timeout utility exit code).
 * 4. exitCode 125 → `provider_unavailable` (docker run itself failed to start).
 * 5. exitCode 126 → `crashed` (container command cannot be invoked).
 * 6. exitCode 127 → `crashed` (container command not found).
 * 7. exitCode 137 → `timed_out` (SIGKILL — typically OOM or --stop-timeout expiry
 *    from `docker run --stop-timeout`; for local_docker the primary kill mechanism
 *    is the stop-timeout, so we prefer timed_out over crashed).
 * 8. exitCode 139 → `crashed` (SIGSEGV — process segfault, not a timeout).
 * 9. exitCode 143 → `timed_out` (SIGTERM exit code, equivalent to rule 1).
 * 10. All other non-zero → `crashed`.
 */
export function dockerExitCodeToTerminal(
  exitCode: number,
  signaledBy?: string,
): SandboxTerminalState {
  // Worker-initiated SIGTERM (wall-clock kill or ceiling-monitor kill).
  if (signaledBy === 'SIGTERM') {
    return 'timed_out';
  }

  switch (exitCode) {
    case 0:
      return 'completed';

    case 124:
      // GNU timeout(1) exit code — also used by `docker run --stop-timeout` path.
      return 'timed_out';

    case 125:
      // docker run itself failed to start (docker daemon error, image not found, etc.).
      return 'provider_unavailable';

    case 137:
      // SIGKILL — could be OOM, or --stop-timeout expiry after SIGTERM.
      // For local_docker the stop-timeout is the V1 wall-clock mechanism, so this
      // maps to timed_out rather than crashed.
      return 'timed_out';

    case 139:
      // SIGSEGV — process segfault.
      return 'crashed';

    case 143:
      // SIGTERM encoded as exit code (128 + 15).
      return 'timed_out';

    default:
      if (exitCode !== 0) {
        return 'crashed';
      }
      return 'completed';
  }
}

// ---------------------------------------------------------------------------
// Local-dev template version guard
// ---------------------------------------------------------------------------

/**
 * Assert that a local-dev template version string is NOT the floating `latest`
 * alias (spec §15.3).
 *
 * Local dev pins to `local-dev-{commitShort}` (e.g. `local-dev-abc1234`).
 * Production uses the immutable digest from PUBLISHED_VERSION.image_digest and
 * the `assertNotLatestTemplateVersion` guard in e2bSandboxPure.ts. This guard
 * applies only to the local_docker provider path.
 *
 * Accepts any version string EXCEPT the exact string `'latest'`. The
 * `local-dev-{commitShort}` shape is validated separately by the
 * verify-template-version-coherence CI gate (C14) — not here, because the
 * pure helper cannot access git.
 *
 * Throws a plain Error (programming error caught at construction time, not a
 * runtime recoverable failure).
 *
 * @param version  - the resolved version string (e.g. from CURRENT_VERSION or git)
 * @param context  - short label for the error message (e.g. 'LocalDockerSandbox.constructor')
 */
export function assertNotLatestLocalTemplateVersion(
  version: string,
  context: string,
): void {
  if (version === 'latest') {
    throw new Error(
      `${context}: templateVersion 'latest' is not allowed for local_docker — ` +
        'pin to local-dev-{commitShort} derived from git rev-parse HEAD (spec §15.3)',
    );
  }
}
