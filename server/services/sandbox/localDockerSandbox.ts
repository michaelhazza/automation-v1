/**
 * localDockerSandbox.ts — Local Docker provider implementation of SandboxExecutionService.
 *
 * Spec B §8.2.2, §12.5, §15.3, §15.5, §22.
 *
 * MODULE-INIT SIDE EFFECT: at import time this module calls
 * registerSandboxProvider('local_docker', () => new LocalDockerSandbox(...)) so that
 * C4's resolver can resolve the 'local_docker' provider without statically importing
 * this file. Bootstrap must import this module before resolveSandboxProvider() runs.
 * (F1 fix — registration-seam pattern, plan-review round 2.)
 *
 * Wraps `docker run --rm` against the synthetos-sandbox template image (C12).
 *
 * Parity gaps vs e2bSandbox (documented in infra/sandbox-templates/synthetos-sandbox/README.md):
 *   - Network: --network=none by default (spec §9.1 deny-all, no allowlist support in V1).
 *   - Cost: zero-cost rows always (spec §12.5). No provider cost for local execution.
 *   - Egress audit: no audit rows (network=none means no egress — spec §9.1 last rule).
 *   - Provider telemetry: synthetic vcpuSeconds / peakMemoryMb (wall-clock observed only).
 *   - Template digest: local-dev-{commitShort} format, not an OCI image digest.
 */

import { readFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import {
  registerSandboxProvider,
  type SandboxExecutionService,
} from './sandboxProviderResolver.js';
import { withSandboxProvider, type ProviderDiagnosticEvent } from '../../lib/withSandboxProvider.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { allocateAndInsertTelemetryEvent } from '../../lib/sandboxTelemetrySequencePure.js';
import { parseCurrentVersion } from './templateVersionParserPure.js';
import {
  dockerExitCodeToTerminal,
  assertNotLatestLocalTemplateVersion,
} from './localDockerSandboxPure.js';
import { FailureError, failure } from '../../../shared/iee/failure.js';
import { logger } from '../../lib/logger.js';
import type {
  SandboxRunTaskInput,
  SandboxRunTaskOutput,
  SandboxArtefactRef,
  SandboxLogRefs,
  SandboxExecutionMetrics,
} from '../../../shared/types/sandbox.js';

// ---------------------------------------------------------------------------
// LocalDockerSandbox configuration
// ---------------------------------------------------------------------------

export interface LocalDockerSandboxConfig {
  /**
   * Docker image reference to run — e.g. `synthetos-sandbox:local-dev-abc1234`.
   * Resolved at construction time from CURRENT_VERSION + git commit short hash.
   * Override for tests.
   */
  imageRef: string;

  /**
   * Path to the synthetos-sandbox CURRENT_VERSION file.
   * Default: 'infra/sandbox-templates/synthetos-sandbox/CURRENT_VERSION'
   * relative to process.cwd(). Overridable for tests.
   */
  currentVersionPath: string;
}

// ---------------------------------------------------------------------------
// LocalDockerSandbox — the provider implementation
// ---------------------------------------------------------------------------

export class LocalDockerSandbox implements SandboxExecutionService {
  private readonly config: LocalDockerSandboxConfig;
  private readonly templateVersion: string;

  constructor(config: LocalDockerSandboxConfig) {
    this.config = config;

    // Validate CURRENT_VERSION at construction to catch misconfiguration early.
    const rawText = readFileSync(config.currentVersionPath, 'utf-8');
    parseCurrentVersion(rawText); // throws descriptively on malformed file

    // The imageRef is the local-dev pin (e.g. synthetos-sandbox:local-dev-abc1234).
    // Extract the tag portion as the templateVersion.
    const tagSep = config.imageRef.lastIndexOf(':');
    this.templateVersion = tagSep >= 0 ? config.imageRef.slice(tagSep + 1) : config.imageRef;

    assertNotLatestLocalTemplateVersion(this.templateVersion, 'LocalDockerSandbox.constructor');
  }

  // ---------------------------------------------------------------------------
  // terminate — no-op for local_docker; docker run --rm exits on its own
  // when the container finishes or the ceiling monitor sends SIGTERM.
  // ---------------------------------------------------------------------------

  async terminate(_providerSandboxId: string): Promise<void> {
    // no-op — local_docker containers are managed via SIGTERM forwarding in _runContainer
  }

  // ---------------------------------------------------------------------------
  // runTask — one container per task, no reuse (spec §8.2.2)
  // ---------------------------------------------------------------------------

  async runTask(input: SandboxRunTaskInput): Promise<SandboxRunTaskOutput> {
    const {
      sandboxExecutionId,
      organisationId,
      subaccountId,
      runId,
      agentId,
      taskId,
      templateName,
      templateVersion,
      policy,
    } = input;

    // Create a temp workspace directory bind-mounted at /workspace inside the container.
    const hostWorkspaceDir = mkdtempSync(join(tmpdir(), `sandbox-${sandboxExecutionId}-`));

    // Wall-clock ceiling → --stop-timeout (seconds, rounded up).
    // docker stop sends SIGTERM then waits stop-timeout before SIGKILL.
    const stopTimeoutSeconds = Math.ceil(policy.ceilings.wallClockMs / 1000);

    const startMs = Date.now();

    const makeTelemetryWriter = (): (event: ProviderDiagnosticEvent) => Promise<void> =>
      async (event) => {
        const db = getOrgScopedDb('localDockerSandbox.telemetryWriter');
        await allocateAndInsertTelemetryEvent(db, {
          sandboxExecutionId,
          organisationId,
          subaccountId,
          runId,
          agentId,
          taskId,
          provider: 'local_docker',
          templateName,
          templateVersion,
          eventType: 'provider_diagnostic',
          criticality: 'info',
          payloadJson: {
            subKind: event.subKind,
            attempt: event.attempt,
            elapsedMs: event.elapsedMs,
            status: event.status,
            code: event.code,
          },
        });
      };

    // --- Phase: start (spawn docker run) ---
    const exitCode = await withSandboxProvider({
      phase: 'start',
      sandboxExecutionId,
      telemetryWriter: makeTelemetryWriter(),
      call: () =>
        this._runContainer({
          sandboxExecutionId,
          hostWorkspaceDir,
          stopTimeoutSeconds,
        }),
    });

    const wallClockMs = Date.now() - startMs;

    const terminalState = dockerExitCodeToTerminal(exitCode);

    // Read output.json from the host workspace (bind-mounted /workspace).
    let rawOutput: unknown | null = null;
    if (terminalState === 'completed' || terminalState === 'crashed') {
      try {
        const outputPath = join(hostWorkspaceDir, 'output.json');
        const content = readFileSync(outputPath, 'utf-8');
        rawOutput = JSON.parse(content) as unknown;
      } catch (err) {
        // Missing or unreadable output.json — harvest pipeline classifies as
        // output_validation_failed. rawOutput stays null.
        logger.warn('sandbox.local_docker.output_read_failed', {
          sandboxExecutionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Read log files from the host workspace.
    const logRefs = this._harvestLogs(hostWorkspaceDir, sandboxExecutionId);

    // Artefact enumeration (stub — full wiring in C7 harvest pipeline).
    const artefactRefs: SandboxArtefactRef[] = [];

    // Metrics: wall-clock observed from spawn start to exit.
    // vcpuSeconds and peakMemoryMb are synthetic for local_docker (spec §8.2.2).
    const metrics: SandboxExecutionMetrics = {
      wallClockMs,
      vcpuSeconds: 0,       // not observable from docker CLI without stats polling
      peakMemoryMb: 0,      // not observable without docker stats
      egressBytes: 0,       // --network=none, no egress
    };

    // Cost: always zero for local_docker (spec §12.5).
    const costCents = 0;

    return {
      sandboxExecutionId,
      terminalState,
      output: terminalState === 'completed' ? rawOutput : null,
      artefactRefs,
      logRefs,
      metrics,
      costCents,
      templateName,
      templateVersion: this.templateVersion,
      provider: 'local_docker',
    };
  }

  // ---------------------------------------------------------------------------
  // Container spawn
  // ---------------------------------------------------------------------------

  /**
   * Spawn `docker run --rm` and wait for exit. Returns the container exit code.
   *
   * Docker flags:
   *   --rm              — remove container after exit (no residue)
   *   --network=none    — deny-all egress (spec §9.1, §8.2.2 parity gap)
   *   --stop-timeout    — provider-side wall-clock ceiling (seconds)
   *   -v                — bind-mount host temp dir as /workspace
   *   --read-only       — read-only container root fs; /workspace is the only
   *                       writable surface via the bind mount
   *
   * Signal handling: the outer process may receive SIGTERM (e.g. from the
   * ceiling-monitor job). We forward it to the docker process to trigger
   * container stop (docker stop then issues SIGTERM → wait → SIGKILL per
   * --stop-timeout). The spawn wrapper exits once docker exits.
   */
  private _runContainer(opts: {
    sandboxExecutionId: string;
    hostWorkspaceDir: string;
    stopTimeoutSeconds: number;
  }): Promise<number> {
    const { sandboxExecutionId, hostWorkspaceDir, stopTimeoutSeconds } = opts;

    return new Promise<number>((resolve, reject) => {
      const args = [
        'run',
        '--rm',
        '--network=none',
        `--stop-timeout=${stopTimeoutSeconds}`,
        '--read-only',
        '-v',
        `${hostWorkspaceDir}:/workspace`,
        this.config.imageRef,
      ];

      const child = spawn('docker', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        // detached: false — child dies with parent on SIGKILL
      });

      // Forward SIGTERM from parent to docker process so docker stop propagates.
      const onSigterm = (): void => {
        child.kill('SIGTERM');
      };
      process.on('SIGTERM', onSigterm);

      // stdout/stderr are piped but discarded here — C7 harvest reads the log
      // files directly from the bind-mounted workspace directory. Consuming the
      // streams prevents the child from blocking on a full pipe buffer.
      child.stdout?.resume();
      child.stderr?.resume();

      child.on('error', (err: Error) => {
        process.off('SIGTERM', onSigterm);
        // docker binary not found or spawn failure — map to provider_unavailable.
        reject(
          Object.assign(err, {
            code: 'docker_spawn_failed',
            sandboxExecutionId,
          }),
        );
      });

      child.on('close', (code: number | null) => {
        process.off('SIGTERM', onSigterm);
        // null exit code means the process was killed by a signal; treat as 137
        // (SIGKILL equivalent) so the exit-code mapper maps it to timed_out.
        resolve(code ?? 137);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Log harvest (reads from bind-mounted workspace; stub — full wiring in C7)
  // ---------------------------------------------------------------------------

  private _harvestLogs(hostWorkspaceDir: string, sandboxExecutionId: string): SandboxLogRefs {
    // C7 (harvest pipeline) reads these files, redacts lines, and persists to
    // sandbox_logs. This provider surfaces opaque log-ref strings — same pattern
    // as e2bSandbox. The actual file paths under hostWorkspaceDir are:
    //   {hostWorkspaceDir}/logs/stdout.log
    //   {hostWorkspaceDir}/logs/stderr.log
    // C7 reads them after runTask returns (via the bind-mount path on the host).
    void hostWorkspaceDir; // path used by C7; suppressed until C7 wires it
    return {
      stdout: `local_docker:${sandboxExecutionId}:stdout`,
      stderr: `local_docker:${sandboxExecutionId}:stderr`,
    };
  }
}

// ---------------------------------------------------------------------------
// Module-init registration (F1 fix — registration-seam pattern)
//
// Called at module-import time so that C4's resolveSandboxProvider() can find
// the 'local_docker' constructor without statically importing this file.
// The factory reads DOCKER_IMAGE_TAG or falls back to deriving the local-dev
// pin from the CURRENT_VERSION file + NODE_ENV at construction time (not at
// module-load time) so tests can override.
// ---------------------------------------------------------------------------

registerSandboxProvider('local_docker', () => {
  const currentVersionPath = join(
    process.cwd(),
    'infra',
    'sandbox-templates',
    'synthetos-sandbox',
    'CURRENT_VERSION',
  );

  // Resolve the local-dev image reference.
  // DOCKER_IMAGE_TAG may be set by the local dev compose setup or CI. If not set,
  // derive from the CURRENT_VERSION `version` field with a `local-dev-` prefix.
  let imageRef = process.env['DOCKER_IMAGE_TAG'];

  if (!imageRef) {
    // Read version from CURRENT_VERSION to build the local-dev pin.
    let version: string;
    try {
      const rawText = readFileSync(currentVersionPath, 'utf-8');
      const parsed = parseCurrentVersion(rawText);
      version = parsed.version;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new FailureError(
        failure(
          'sandbox_provider_unavailable',
          `local_docker provider: failed to read CURRENT_VERSION: ${msg}`,
          { currentVersionPath },
        ),
      );
    }

    // local-dev-{version} is the conventional tag for locally-built images.
    // The `local-dev-` prefix distinguishes local builds from published digests
    // and satisfies the assertNotLatestLocalTemplateVersion guard (spec §15.3).
    imageRef = `synthetos-sandbox:local-dev-${version}`;
  }

  return new LocalDockerSandbox({
    imageRef,
    currentVersionPath,
  });
});
