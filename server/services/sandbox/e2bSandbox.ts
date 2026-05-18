/**
 * e2bSandbox.ts — e2b provider implementation of SandboxExecutionService.
 *
 * Spec B §4 (vendor model), §8.2.1, §11, §15.3, §19.1, §22.
 *
 * MODULE-INIT SIDE EFFECT: at import time this module calls
 * registerSandboxProvider('e2b', () => new E2bSandbox(...)) so that C4's
 * resolver can resolve the 'e2b' provider without statically importing this
 * file. Bootstrap must import this module before resolveSandboxProvider() runs.
 * (F1 fix — registration-seam pattern, plan-review round 2.)
 *
 * E2B SDK STATUS: the e2b SDK (@e2b/sdk or 'e2b') is NOT yet installed in
 * node_modules. All SDK calls are made through the E2bSdkClient interface
 * defined below. At construction time, consumers inject the real SDK client;
 * when no client is supplied, the default stub throws with:
 *   "e2b SDK not yet installed — see SANDBOX-DEF-EGRESS-MECH decision in C9"
 * This is intentional: the stub converts a missing-install to a loud error
 * at the first SDK call, not at module load. Real SDK installation is
 * deferred to operator post-merge once the e2b account is provisioned and
 * the SDK's surface is verified (see SANDBOX-DEF-EGRESS-MECH below).
 *
 * SANDBOX-DEF-EGRESS-MECH DECISION (spec §9.1, §27 deferred row):
 * This chunk records that the egress interception mechanism choice is
 * DEFERRED to actual SDK installation. Candidates: (a) e2b SDK network-policy
 * hooks if they expose per-decision callbacks, (b) application-layer egress
 * proxy with mandatory routing from the template entrypoint, (c) CNI/eBPF
 * hooks if e2b exposes them. The audit-row schema (C1b §20.6) is unaffected
 * by the mechanism choice. Decision lands when the e2b account is provisioned
 * and the SDK's exposed surface is verified. See tasks/todo.md entry for
 * SANDBOX-DEF-EGRESS-MECH.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  registerSandboxProvider,
  type SandboxExecutionService,
} from './sandboxProviderResolver.js';
import { withSandboxProvider, type ProviderDiagnosticEvent } from '../../lib/withSandboxProvider.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { allocateAndInsertTelemetryEvent } from '../../lib/sandboxTelemetrySequencePure.js';
import { parsePublishedVersion } from './templateVersionParserPure.js';
import {
  e2bTerminalSignalToInternal,
  assertNotLatestTemplateVersion,
  buildE2bMetadataTags,
  credentialAliasPath,
  resolveTemplateAlias,
  type E2bTerminalSignal,
} from './e2bSandboxPure.js';
import { FailureError, failure } from '../../../shared/iee/failure.js';
import { logger } from '../../lib/logger.js';
import { verifyTeardown } from './teardownVerifierPure.js';
import type {
  SandboxRunTaskInput,
  SandboxRunTaskOutput,
  SandboxArtefactRef,
  SandboxLogRefs,
  SandboxExecutionMetrics,
} from '../../../shared/types/sandbox.js';
import type { ProxyAlignment } from '../../../shared/types/proxyAlignment.js';
import type { HumanizeOptions } from '../../../shared/types/humanize.js';

// ---------------------------------------------------------------------------
// E2b SDK client interface (thin stub until real SDK is installed)
//
// Defines only the methods e2bSandbox.ts actually calls. The real e2b SDK
// will implement this interface once installed. The names and signatures here
// are informed by public e2b documentation and the spec §8.2.1 contract, but
// MUST be verified against the actual SDK surface at installation time.
// ---------------------------------------------------------------------------

export interface E2bSandboxHandle {
  /**
   * The provider-assigned sandbox ID (opaque string). Written to
   * sandbox_executions.provider_sandbox_id on successful start.
   */
  sandboxId: string;
}

export interface E2bFileInfo {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
}

/**
 * Thin client interface for the e2b SDK methods consumed by this provider.
 *
 * Inject a real SDK instance at construction time. When the SDK is installed:
 *   1. Verify the actual method names and signatures match this interface.
 *   2. Update or remove this interface — the real SDK types take precedence.
 *   3. Remove the defaultSdkStub and supply the real client via DI or env.
 */
export interface E2bSdkClient {
  /**
   * Start a new sandbox from a template alias (digest string).
   * Passes wall-clock ceiling as the SDK `timeout` parameter (ms → seconds).
   * Returns an opaque sandbox handle with the provider-assigned sandboxId.
   */
  createSandbox(options: {
    templateAlias: string;
    timeoutSeconds: number;
    metadata: Record<string, string>;
  }): Promise<E2bSandboxHandle>;

  /**
   * Terminate a running sandbox. Idempotent: no-op if sandbox already closed.
   */
  terminateSandbox(sandboxId: string): Promise<void>;

  /**
   * Read a file from the sandbox filesystem. Returns a Buffer.
   * Throws if the path does not exist or the sandbox is not running.
   */
  readFile(sandboxId: string, path: string): Promise<Buffer>;

  /**
   * Write a file to the sandbox filesystem with optional mode.
   * Used to inject credential files under /workspace/secrets/.
   * Permissions default to 0o600 (owner-read-write) per spec §11.1.
   */
  writeFile(
    sandboxId: string,
    path: string,
    contents: Buffer,
    options?: { mode?: number },
  ): Promise<void>;

  /**
   * List files in a directory inside the sandbox filesystem.
   * Returns an empty array when the directory does not exist.
   */
  listFiles(sandboxId: string, path: string): Promise<E2bFileInfo[]>;

  /**
   * Read the terminal state of a sandbox.
   * Returns the E2bTerminalSignal once the sandbox has exited (any reason).
   * Should be called after the sandbox's process has completed.
   */
  getTerminalState(sandboxId: string): Promise<E2bTerminalSignal>;

  /**
   * Check whether a sandbox is still alive (running).
   * Returns true if the sandbox is reachable and running; false if terminated.
   * Used by teardown verification (§7.7 REQ #55) — called after terminateSandbox
   * to confirm the sandbox is actually gone.
   *
   * NOTE: method name must be verified against the real e2b SDK surface at
   * installation time. If the real SDK uses a different name, update this
   * interface and the defaultSdkStub accordingly.
   */
  isSandboxAlive(sandboxId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Default stub (throws on any call — boot-time silent, first-call loud)
// ---------------------------------------------------------------------------

function makeNotInstalledStub(): E2bSdkClient {
  const notInstalled = (): never => {
    throw new Error(
      'e2b SDK not yet installed — see SANDBOX-DEF-EGRESS-MECH decision in C9. ' +
        'Install the e2b package and inject a real E2bSdkClient at E2bSandbox construction.',
    );
  };
  return {
    createSandbox: notInstalled,
    terminateSandbox: notInstalled,
    readFile: notInstalled,
    writeFile: notInstalled,
    listFiles: notInstalled,
    getTerminalState: notInstalled,
    // Teardown verification stub: returns false (not alive) when SDK not installed.
    // The real SDK implementation must be verified at installation time.
    isSandboxAlive: async (_sandboxId: string) => false,
  };
}

// ---------------------------------------------------------------------------
// E2bSandbox configuration
// ---------------------------------------------------------------------------

export interface E2bSandboxConfig {
  /**
   * e2b project name — 'synthetos-prod' or 'synthetos-staging'.
   * Read from E2B_PROJECT_PROD / E2B_PROJECT_STAGING env vars by the default
   * factory registered at module init. Tests or custom bootstrap inject directly.
   */
  projectName: string;

  /**
   * Path to the synthetos-sandbox PUBLISHED_VERSION file.
   * Default: 'infra/sandbox-templates/synthetos-sandbox/PUBLISHED_VERSION'
   * relative to process.cwd(). Overridable for tests.
   */
  publishedVersionPath: string;

  /**
   * Path to the iee-browser PUBLISHED_VERSION file.
   * When set, enables browser-class sandbox execution (templateName = 'iee-browser').
   * Default: 'infra/sandbox-templates/iee-browser/PUBLISHED_VERSION'
   * relative to process.cwd().
   */
  browserPublishedVersionPath?: string;
}

// ---------------------------------------------------------------------------
// E2bSandbox — the provider implementation
// ---------------------------------------------------------------------------

export class E2bSandbox implements SandboxExecutionService {
  private readonly sdkClient: E2bSdkClient;
  private readonly config: E2bSandboxConfig;
  private readonly templateDigest: string;
  private readonly browserTemplateDigest: string | null;

  constructor(sdkClient: E2bSdkClient, config: E2bSandboxConfig) {
    this.sdkClient = sdkClient;
    this.config = config;

    // Resolve the immutable template digest from PUBLISHED_VERSION at
    // construction time (spec §15.3). This makes every subsequent runTask
    // call use the same pinned digest — consistent with the one-sandbox-per-
    // task, no-pooling-no-reuse contract (§8.2.1).
    const rawText = readFileSync(config.publishedVersionPath, 'utf-8');
    const published = parsePublishedVersion(rawText);

    assertNotLatestTemplateVersion(published.image_digest, 'E2bSandbox.constructor');
    this.templateDigest = published.image_digest;

    // Load iee-browser template digest if configured (enables browser-class tasks).
    if (config.browserPublishedVersionPath) {
      const browserRaw = readFileSync(config.browserPublishedVersionPath, 'utf-8');
      const browserPublished = parsePublishedVersion(browserRaw);
      assertNotLatestTemplateVersion(browserPublished.image_digest, 'E2bSandbox.constructor(browser)');
      this.browserTemplateDigest = browserPublished.image_digest;
    } else {
      this.browserTemplateDigest = null;
    }
  }

  // ---------------------------------------------------------------------------
  // runTask — one sandbox per task, no pooling, no reuse (spec §8.2.1)
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
      credentialIssuanceContext,
    } = input;

    // Wall-clock ceiling → SDK timeout parameter (ms → seconds, rounded up).
    const timeoutSeconds = Math.ceil(policy.ceilings.wallClockMs / 1000);

    const makeTelemetryWriter = (): (event: ProviderDiagnosticEvent) => Promise<void> =>
      async (event) => {
        const db = getOrgScopedDb('e2bSandbox.telemetryWriter');
        await allocateAndInsertTelemetryEvent(db, {
          sandboxExecutionId,
          organisationId,
          subaccountId,
          runId,
          agentId,
          taskId,
          provider: 'e2b',
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

    const metadataTags = buildE2bMetadataTags({
      organisationId,
      subaccountId,
      runId,
      agentId,
      taskId,
      sandboxExecutionId,
      templateName,
      templateVersion,
    });

    // --- Phase: start ---
    // Warm-pool adoption: if a leased provider sandbox id is supplied, use it
    // directly and skip createSandbox(). This is the whole point of the
    // warm-pool lease — the sandbox was pre-created by refillIfEligible.
    // Cold-start dispatches (no lease) fall through to createSandbox.
    let providerSandboxId: string;
    if (input.leasedProviderSandboxId) {
      providerSandboxId = input.leasedProviderSandboxId;
    } else {
      const handle = await withSandboxProvider({
        phase: 'start',
        sandboxExecutionId,
        telemetryWriter: makeTelemetryWriter(),
        call: () =>
          this.sdkClient.createSandbox({
            templateAlias: resolveTemplateAlias(templateName, {
              synthetos: this.templateDigest,
              browser: this.browserTemplateDigest ?? undefined,
            }),
            timeoutSeconds,
            metadata: metadataTags,
          }),
      });
      providerSandboxId = handle.sandboxId;
    }

    // --- Phase: credential injection (spec §11) ---
    // Write each credential alias under /workspace/secrets/{alias}.token at
    // 0600 permissions. The caller (sandboxExecutionService / adapter) has
    // already issued credentials via credentialBrokerService; the values
    // arrive through credentialIssuanceContext.
    // In V1 this stub writes no actual files (credential values are not yet
    // threaded through the input descriptor — that wiring is C13's concern).
    // The per-execution redaction pattern set (§11.3) is assembled by the
    // harvest pipeline (C7); this provider does not manage redaction patterns.
    for (const alias of credentialIssuanceContext.aliases) {
      const targetPath = credentialAliasPath(alias.alias);
      // Credential value is not available in the input descriptor in V1.
      // C13 (adapter rewiring) threads the issued credential value through.
      // When available: this.sdkClient.writeFile(providerSandboxId, targetPath,
      //   Buffer.from(credentialValue), { mode: 0o600 });
      void (alias.alias + targetPath); // suppress lint unused-var until C13 wires
    }

    // --- Phase: harness input injection (browser tasks only) ---
    // For iee-browser tasks, write /workspace/input.json so the harness can
    // read the task payload and profile mount descriptor at startup.
    // The harness uses profileMount.userDataDirInSandbox to set up the
    // Playwright user-data directory (spec §7.3, §8.1 extension).
    //
    // The task envelope (URL, actions, contract, etc.) is threaded through
    // `input.browserTaskPayload` (NOT `inputFiles` — inputFiles is for file
    // attachments). The harness validates the envelope it expects.
    //
    // Note: the sandbox is already running when this write happens, so the
    // harness entrypoint must wait for /workspace/input.json before launching
    // (see entrypoint.sh wait-loop, 30s default).
    if (templateName === 'iee-browser' && input.profileMount) {
      // proxy alignment: resolved by proxyAlignmentService.resolve at dispatch time
      // when PROXY_ALIGNMENT=true and the subaccount has a proxyConfig configured.
      // proxyUrlEnvKey names the env var (set by credentialBrokerService.injectIntoEnvironment)
      // holding the credential-resolved proxy URL. Credentials never appear in taskPayload.
      // Full wiring (DB read of proxy_config + locale_overrides → resolve call) is threaded
      // in the IEE dispatch layer when the proxy-config UI and credential-broker integration land.
      const proxyAlignment: ProxyAlignment | null = input.proxyAlignment ?? null;
      const proxyUrlEnvKey: string | null = input.proxyUrlEnvKey ?? null;
      const humanize: HumanizeOptions | null = input.humanize ?? null;
      const harnessInput = {
        taskPayload: input.browserTaskPayload ?? null,
        profileMount: {
          userDataDirInSandbox: input.profileMount.userDataDirInSandbox,
        },
        artefactsDir: '/workspace/artefacts',
        proxyAlignment,
        proxyUrlEnvKey,
        humanize,
      };
      await withSandboxProvider({
        phase: 'start',
        sandboxExecutionId,
        telemetryWriter: makeTelemetryWriter(),
        call: () =>
          this.sdkClient.writeFile(
            providerSandboxId,
            '/workspace/input.json',
            Buffer.from(JSON.stringify(harnessInput)),
          ),
      });
    }

    // --- Phase: mid_execution / terminal harvest ---
    // The harvest pipeline runs inline within runTask (spec §22).
    // Steps 1-12 per spec §8.4 are owned by sandboxHarvestService (C7), which
    // is invoked by sandboxExecutionService (C5). This provider's responsibility
    // is to:
    //   (a) read the terminal state via the SDK
    //   (b) read /workspace/output.json, /workspace/artefacts/, /workspace/logs/
    //   (c) terminate the sandbox when done
    //   (d) surface a typed SandboxRunTaskOutput
    //
    // In V1 the harvest pipeline (C7) is separate: sandboxExecutionService calls
    // sandboxHarvestService.runHarvest(input, providerAdapter). This method
    // returns a minimal output representing the raw provider result before
    // the full harvest pipeline processes it. C5 orchestrates the full flow.

    const terminalSignal = await withSandboxProvider({
      phase: 'terminal',
      sandboxExecutionId,
      telemetryWriter: makeTelemetryWriter(),
      call: () => this.sdkClient.getTerminalState(providerSandboxId),
    });

    const terminalState = e2bTerminalSignalToInternal(terminalSignal);

    // Read output.json from the sandbox filesystem.
    let rawOutput: unknown | null = null;
    if (terminalState === 'completed' || terminalState === 'crashed') {
      // Attempt output read even on crash — harvest pipeline classifies the
      // result. Provider reads are wrapped for retry / signal classification.
      try {
        const outputBuf = await withSandboxProvider({
          phase: 'harvest',
          sandboxExecutionId,
          telemetryWriter: makeTelemetryWriter(),
          call: () => this.sdkClient.readFile(providerSandboxId, '/workspace/output.json'),
        });
        rawOutput = JSON.parse(outputBuf.toString('utf-8')) as unknown;
      } catch (err) {
        // Missing or unreadable output.json — harvest pipeline classifies this
        // as output_validation_failed. rawOutput stays null.
        logger.warn('sandbox.e2b.output_read_failed', {
          sandboxExecutionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Read log files.
    const logRefs = await this._harvestLogs(providerSandboxId, sandboxExecutionId);

    // Enumerate and upload artefacts (stub — full wiring in C7).
    const artefactRefs = await this._harvestArtefacts(providerSandboxId, sandboxExecutionId);

    // Terminate the sandbox. Idempotent — no-op if already closed.
    await withSandboxProvider({
      phase: 'harvest',
      sandboxExecutionId,
      telemetryWriter: makeTelemetryWriter(),
      call: () => this.sdkClient.terminateSandbox(providerSandboxId),
    }).catch((err: unknown) => {
      // Terminate failure is non-fatal: the sandbox may already be closed
      // (timeout, cost-ceiling), or the provider API is temporarily down.
      // The ceiling-monitor job (C11a) and the wall-clock-kill job (C11a)
      // both terminate independently as belt-and-braces.
      logger.warn('sandbox.e2b.terminate_failed', {
        sandboxExecutionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    // Post-terminate verification (§7.7 REQ #55). Runs even if terminate above
    // threw — health-check throw maps to verified:false/health_check_threw.
    const verification = await verifyTeardown({
      providerSandboxId,
      postTerminateHealthCheck: () => this.sdkClient.isSandboxAlive(providerSandboxId),
    });

    if (verification.verified) {
      logger.info('sandbox.teardown.verified', { providerSandboxId });
    } else {
      logger.error('sandbox.teardown.unverified', {
        providerSandboxId,
        reason: verification.reason,
      });
    }

    // Metrics: populated from provider-reported data where available.
    // In V1 the e2b SDK surface for per-execution vCPU / memory metrics is
    // unknown until the real SDK is installed. Stubs carry wall-clock only.
    const metrics: SandboxExecutionMetrics = {
      wallClockMs: policy.ceilings.wallClockMs, // provider-reported not yet available
      vcpuSeconds: 0,
      peakMemoryMb: 0,
      egressBytes: 0,
    };

    // Cost: provider-reported at harvest time. Stubbed at 0 until the real
    // SDK exposes a cost API (see SANDBOX-DEF-EGRESS-MECH decision).
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
      templateVersion,
      provider: 'e2b',
    };
  }

  // ---------------------------------------------------------------------------
  // terminate — kill a running sandbox by its provider-assigned id.
  // Idempotent: no-op if the sandbox is already closed.
  // ---------------------------------------------------------------------------

  async terminate(providerSandboxId: string): Promise<void> {
    await this.sdkClient.terminateSandbox(providerSandboxId);

    const verification = await verifyTeardown({
      providerSandboxId,
      postTerminateHealthCheck: () => this.sdkClient.isSandboxAlive(providerSandboxId),
    });

    if (verification.verified) {
      logger.info('sandbox.teardown.verified', { providerSandboxId });
    } else {
      logger.error('sandbox.teardown.unverified', {
        providerSandboxId,
        reason: verification.reason,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Log harvest (stub — full wiring in C7 harvest pipeline)
  // ---------------------------------------------------------------------------

  private async _harvestLogs(
    providerSandboxId: string,
    sandboxExecutionId: string,
  ): Promise<SandboxLogRefs> {
    const readLog = async (stream: 'stdout' | 'stderr'): Promise<string> => {
      try {
        // no-tenancy-context: defaults to log-only. This private method takes only
        // (providerSandboxId, sandboxExecutionId) — the full tenancy fields required
        // by sandbox_telemetry_events (organisationId, runId, agentId, taskId,
        // templateName, templateVersion) are not threaded here. Diagnostics surface
        // via logger.warn in withSandboxProvider only; DB-row persistence at this
        // site requires a method-signature refactor and is tracked in tasks/todo.md
        // under REQ #31 follow-up.
        await withSandboxProvider({
          phase: 'harvest',
          sandboxExecutionId,
          call: () =>
            this.sdkClient.readFile(providerSandboxId, `/workspace/logs/${stream}.log`),
        });
        // C7 (harvest pipeline) processes the raw buffer through redaction and
        // persists to sandbox_logs. This stub returns an opaque log-ref string.
      } catch (err) {
        logger.warn('sandbox.e2b.log_harvest_read_failed', {
          sandboxExecutionId,
          providerSandboxId,
          stream,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      return `e2b:${sandboxExecutionId}:${stream}`;
    };

    return {
      stdout: await readLog('stdout'),
      stderr: await readLog('stderr'),
    };
  }

  // ---------------------------------------------------------------------------
  // Artefact harvest (stub — full wiring in C7 harvest pipeline)
  // ---------------------------------------------------------------------------

  private async _harvestArtefacts(
    providerSandboxId: string,
    sandboxExecutionId: string,
  ): Promise<SandboxArtefactRef[]> {
    try {
      // no-tenancy-context: defaults to log-only. This private method takes only
      // (providerSandboxId, sandboxExecutionId) — the full tenancy fields required
      // by sandbox_telemetry_events (organisationId, runId, agentId, taskId,
      // templateName, templateVersion) are not threaded here. Diagnostics surface
      // via logger.warn in withSandboxProvider only; DB-row persistence at this
      // site requires a method-signature refactor and is tracked in tasks/todo.md
      // under REQ #31 follow-up.
      const entries = await withSandboxProvider({
        phase: 'harvest',
        sandboxExecutionId,
        call: () => this.sdkClient.listFiles(providerSandboxId, '/workspace/artefacts'),
      });

      // C7 handles: per-artefact size check (§9.4), total-bytes cap, metadata
      // redaction (§8.4 step 7), and S3 upload (§8.4 step 8). This stub
      // returns an empty list — artefact wiring lands in C7.
      void entries;
    } catch (err) {
      logger.warn('sandbox.e2b.artefact_harvest_list_failed', {
        sandboxExecutionId,
        providerSandboxId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Module-init registration (F1 fix — registration-seam pattern)
//
// Called at module-import time so that C4's resolveSandboxProvider() can find
// the 'e2b' constructor without statically importing this file.
// The factory reads E2B_PROJECT_PROD / E2B_PROJECT_STAGING from process.env
// at construction time (not at module-load time) so tests can override.
// ---------------------------------------------------------------------------

registerSandboxProvider('e2b', () => {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const stubAllowed = process.env['E2B_SDK_STUBBED'] === 'true';

  // Fail-fast guard: the e2b SDK is not installed yet. Refusing to construct
  // an e2b provider when the SDK is absent prevents the resolver from handing
  // back a provider that "looks valid" at boot but throws on first real call.
  // Tests construct E2bSandbox directly with an injected client and never
  // reach this factory. Local / dev work that wants the not-installed stub
  // must opt in explicitly via E2B_SDK_STUBBED=true; production NEVER opts in.
  if (nodeEnv === 'production' || !stubAllowed) {
    throw new FailureError(
      failure(
        'sandbox_provider_unavailable',
        nodeEnv === 'production'
          ? 'e2b SDK is not installed — production cannot use the not-installed stub; install the SDK and inject a real client before setting SANDBOX_PROVIDER=e2b'
          : 'e2b SDK is not installed — set E2B_SDK_STUBBED=true to use the not-installed stub in non-production, or install the SDK and inject a real client at module init',
        { nodeEnv, sdkInstalled: false, stubAllowed },
      ),
    );
  }

  const projectEnvKey =
    nodeEnv === 'production' ? 'E2B_PROJECT_PROD' : 'E2B_PROJECT_STAGING';
  const projectName = process.env[projectEnvKey];

  if (!projectName) {
    throw new FailureError(
      failure(
        'sandbox_provider_unavailable',
        `${projectEnvKey} env var is not set — required for e2b sandbox provider`,
        { projectEnvKey, nodeEnv },
      ),
    );
  }

  const publishedVersionPath = join(
    process.cwd(),
    'infra',
    'sandbox-templates',
    'synthetos-sandbox',
    'PUBLISHED_VERSION',
  );

  // Browser template loading is gated behind E2B_BROWSER_TEMPLATE_ENABLED.
  // The committed iee-browser/PUBLISHED_VERSION carries a placeholder
  // (all-zero) image_digest until the CI sandbox-template-build pipeline
  // publishes a real one (see SANDBOX-DEF-EGRESS-MECH). Without the gate,
  // assertNotLatestTemplateVersion rejects the placeholder and blocks the
  // synthetos-sandbox provider from constructing in dev — even though dev
  // only needs the base template.
  const browserTemplateEnabled = process.env['E2B_BROWSER_TEMPLATE_ENABLED'] === 'true';
  const browserPublishedVersionPath = browserTemplateEnabled
    ? join(
        process.cwd(),
        'infra',
        'sandbox-templates',
        'iee-browser',
        'PUBLISHED_VERSION',
      )
    : undefined;

  return new E2bSandbox(makeNotInstalledStub(), {
    projectName,
    publishedVersionPath,
    browserPublishedVersionPath,
  });
});
