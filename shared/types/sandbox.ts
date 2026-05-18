// Pure TypeScript types for the Sandbox Isolation primitive (Spec B).
// Consumed by adapters, the harvest pipeline, and UI in future phases.
// No Zod schemas here — those live in *Pure.ts files in the service layer (C5, C6).

/**
 * The closed set of terminal states a sandbox execution can reach (spec §13.1).
 * Exactly 8 values; adding a 9th requires a spec amendment. The DB CHECK constraint
 * on `sandbox_executions.status` enforces this closure at the storage layer.
 * `classifyTerminal()` in `sandboxExecutionServicePure.ts` is the only producer.
 */
export type SandboxTerminalState =
  | 'completed'
  | 'timed_out'
  | 'cost_ceiling_hit'
  | 'crashed'
  | 'output_validation_failed'
  | 'harvest_failed'
  | 'artefact_upload_failed'
  | 'provider_unavailable';

/**
 * Non-terminal states tracked on `sandbox_executions.status` (spec §13.1).
 * These three values appear in the DB CHECK constraint alongside the 8 terminal
 * states but are not part of the closed terminal taxonomy.
 */
export type SandboxNonTerminalStatus = 'pending' | 'running' | 'harvesting';

/**
 * The full set of valid `sandbox_executions.status` values — terminals + non-terminals.
 * Used internally to type the DB column and state-machine guards.
 */
export type SandboxExecutionStatus = SandboxTerminalState | SandboxNonTerminalStatus;

/**
 * The three sandbox provider implementations (spec §8.2).
 * `e2b` is the production provider. `local_docker` is used in local dev.
 * `inlineSandbox` is test-only and hard-guarded against non-test environments.
 */
export type SandboxProviderName = 'e2b' | 'local_docker' | 'inline';

/**
 * Network policy shape for a sandbox execution (spec §9.1).
 * V1 default is `none` (deny-all egress). `allowlist` enables explicit per-task
 * egress to declared hosts/ports. Egress audit logging is mandatory whenever
 * `mode !== 'none'`.
 */
export interface SandboxNetworkPolicy {
  mode: 'none' | 'allowlist';
  allowlist?: Array<{
    host: string;
    port: number;
    protocol: 'http' | 'https' | 'tcp' | 'other';
  }>;
}

/**
 * Filesystem policy shape for a sandbox execution (spec §9.2).
 * V1 writable root is always `/workspace`. Other paths are read-only or denied.
 */
export interface SandboxFilesystemPolicy {
  writableRoot: '/workspace';
}

/**
 * Wall-clock and cost ceiling declarations (spec §10.1).
 * `wallClockMs` triggers provider-side termination (e2b SDK `timeout`) plus
 * the worker-side `sandbox-wall-clock-kill` job belt-and-braces. `costCents`
 * triggers the `sandbox-ceiling-monitor` job via the upper-bound estimator
 * (spec §10.2). Both ceilings are per-task; the hard V1 cap is 30 min / 200 cents.
 */
export interface SandboxCeilings {
  wallClockMs: number;
  costCents: number;
  /** Monitor interval for the worker-side ceiling-monitor job. V1 default: 5000 ms. */
  monitorIntervalMs?: number;
}

/**
 * Per-artefact and total-artefact byte limits (spec §9.4).
 * Over-cap routes to terminal state `artefact_upload_failed` (sub-reason `artefact_oversized`).
 */
export interface SandboxArtefactLimits {
  /** Per-artefact maximum in bytes. V1 default: 10 MB (10_485_760). */
  perArtefactBytes: number;
  /** Total per-task artefact maximum in bytes. V1 default: 100 MB (104_857_600). */
  totalBytes: number;
}

/**
 * Preflight input validation limits (spec §9.6).
 * Validated BEFORE sandbox creation; failures emit `sandbox_input_rejected`
 * on the calling run without writing a `sandbox_executions` row.
 */
export interface SandboxInputLimits {
  /** Maximum total input bytes. V1 default: 25 MB (26_214_400). */
  maxBytes: number;
  /** MIME-type allow-list. Content-sniffed, not extension-matched. */
  allowedMimes: string[];
}

/**
 * Provider-side thresholds distinct from the task-level wall-clock ceiling (spec §8.2).
 * `startTimeoutMs` bounds how long the wrapper waits for a provider start-API response
 * before treating it as `provider_unavailable`.
 */
export interface SandboxProviderThresholds {
  startTimeoutMs: number;
}

/**
 * The policy sub-object that travels with every sandbox execution (spec §9, §20.1).
 * Captured as `policy_json` on the `sandbox_executions` row at run start.
 * `allowRuntimeInstall` is the literal type `false` in V1 — enabling it for any
 * task requires a spec amendment (spec §9.5 invariant).
 */
export interface SandboxPolicy {
  network: SandboxNetworkPolicy;
  filesystem: SandboxFilesystemPolicy;
  ceilings: SandboxCeilings;
  artefactLimits: SandboxArtefactLimits;
  /** V1 invariant: always `false`. Literal type enforced here. See spec §9.5. */
  allowRuntimeInstall: false;
  inputLimits: SandboxInputLimits;
  providerThresholds: SandboxProviderThresholds;
}

/**
 * One entry in the credential issuance request list (spec §11.1, §11.2).
 * Each alias maps to a broker-issued, sub-account-scoped credential mounted
 * under `/workspace/secrets/{alias}.token` for the lifetime of the execution.
 */
export interface CredentialIssuanceAlias {
  alias: string;
  connectionId: string;
  scope: string;
  /** Bounds the broker-issued token lifetime; includes wall-clock + buffer. */
  expectedDurationMs: number;
}

/**
 * Credential issuance context passed with the input descriptor (spec §11.2, §20.1).
 * The broker uses `(organisationId, subaccountId, connectionId)` scoping to ensure
 * the sandbox never receives credentials belonging to a different sub-account.
 * `aliases` may be empty when the task requires no external credentials.
 */
export interface CredentialIssuanceContext {
  aliases: CredentialIssuanceAlias[];
}

/**
 * Descriptor for a single input file staged in `/workspace/input/` (spec §20.1).
 * Content is read-only inside the sandbox. The `contentHash` is sha256 of the file
 * bytes; `mime` is the content-sniffed type used for preflight validation (spec §9.6).
 */
export interface SandboxInputFile {
  /** Path relative to `/workspace/input/`, e.g. `input/orders.csv`. */
  path: string;
  /** sha256:{hex} of the file bytes. */
  contentHash: string;
  bytes: number;
  mime: string;
}

/**
 * The full input descriptor passed to `SandboxExecutionService.runTask` (spec §8.1, §20.1).
 * All fields are required except `policy.network.allowlist` (present only when
 * `policy.network.mode === 'allowlist'`) and `credentialIssuanceContext.aliases`
 * (may be an empty array). `sandboxExecutionId` is caller-generated; if a row already
 * exists in `sandbox_executions` with the same ID, its pinned policy / ceilings / template
 * wins on read (idempotent retry contract — spec §20.1).
 *
 * `sandboxStartKey`, when set, enables idempotent adoption via `adoptOrStart()`: the
 * service will return the existing sandbox row keyed on this token if one exists in a
 * live state (`pending` / `running` / `harvesting`), rather than starting a fresh one.
 * The Operator Backend sets `sandboxStartKey = operator_run_id` so that a dispatch crash
 * and retry re-adopts the already-started sandbox rather than creating a duplicate.
 * Non-operator callers leave this field absent; behaviour is byte-identical to the V1 baseline.
 */
export interface SandboxRunTaskInput {
  /** Caller-generated UUID. Used as the idempotency key across harvest + cost-ledger writes. */
  sandboxExecutionId: string;
  /**
   * Optional idempotency token for adoption-based dispatch-crash recovery (Operator Backend).
   * When set, `adoptOrStart()` prefers an existing sandbox row keyed by this token.
   * Non-operator callers omit this field; `runTask()` behaviour is unchanged.
   */
  sandboxStartKey?: string;
  organisationId: string;
  subaccountId: string;
  runId: string;
  agentId: string;
  taskId: string;
  /** Template image name, e.g. `synthetos-sandbox`. */
  templateName: string;
  /** Template version string from `CURRENT_VERSION`, e.g. `v1.0.0`. */
  templateVersion: string;
  policy: SandboxPolicy;
  /** Total bytes of all input files combined. Used for preflight cap check (spec §9.6). */
  inputBytes: number;
  inputFiles: SandboxInputFile[];
  credentialIssuanceContext: CredentialIssuanceContext;
  /**
   * Ref to the Zod schema used for `output.json` validation in harvest step 3 (spec §8.3, §8.4).
   * In V1 this is a string key resolved by the harvest service to a registered schema.
   */
  outputSchemaRef: string;
  /**
   * Browser profile volume mount descriptor (IEE-browser, spec §8.1 extension).
   * Non-null only when templateName = 'iee-browser'. Non-browser tasks leave this absent;
   * the sandbox harness ignores it. sessionProfileId authorises the mount; volumeId and
   * userDataDirInSandbox are the physical parameters.
   */
  profileMount?: {
    sessionProfileId: string;       // uuid of the iee_browser_session_profiles row
    volumeId: string;
    userDataDirInSandbox: string;   // '/workspace/profile'
  };
  /**
   * Warm-session checkout ID (IEE-browser, spec §8.1 extension).
   * UUID of the browser_warm_sessions row leased for this task, or null for cold-start.
   * Non-browser tasks leave this absent.
   */
  warmSessionCheckoutId?: string | null;
  /**
   * Browser task envelope (IEE-browser, spec §8.1 extension).
   * The actual task instructions (URL, actions, contract, etc.) threaded from
   * `backendOptions.ieeTask` to the in-sandbox harness via /workspace/input.json.
   * Non-browser tasks leave this absent. Shape is provider-opaque (the harness
   * validates the envelope it expects).
   */
  browserTaskPayload?: unknown;
  /**
   * Provider-assigned sandbox ID of a pre-warmed sandbox (warm-pool dispatch).
   * When set, the provider MUST skip createSandbox() and adopt this sandbox
   * instead — semantically the warm-pool lease's whole point. Non-warm-pool
   * dispatches leave this absent and the provider creates a fresh sandbox.
   */
  leasedProviderSandboxId?: string;
  /**
   * Resolved proxy alignment for IEE-browser tasks (spec §6.1, BHP chunk 8).
   * When non-null, the harness applies locale/timezone/language and WebRTC policy
   * from this envelope. Null when no proxy is configured or PROXY_ALIGNMENT flag is off.
   * Credentials NEVER appear here — only locale/timezone/language/webrtcPolicy fields.
   */
  proxyAlignment?: import('./proxyAlignment.js').ProxyAlignment | null;
  /**
   * Name of the env var holding the credential-resolved proxy URL (e.g. 'IEE_BROWSER_PROXY_URL').
   * Set by credentialBrokerService.injectIntoEnvironment at sandbox-launch time.
   * The harness reads process.env[proxyUrlEnvKey] to assemble the --proxy-server Chromium flag.
   * Null when no proxy is configured or when proxyConfig has no credentialId.
   */
  proxyUrlEnvKey?: string | null;
}

/**
 * A pointer to a harvested artefact persisted in object storage (spec §8.4 step 8, §20.4).
 * The `objectKey` is the full S3 prefix path; downstream consumers use it to fetch the file.
 * `contentHash` is sha256 of the uploaded bytes (verified at upload).
 */
export interface SandboxArtefactRef {
  filename: string;
  objectKey: string;
  bytes: number;
  /** sha256:{hex} of the artefact bytes. */
  contentHash: string;
}

/**
 * References to the redacted log line rows written to `sandbox_logs` (spec §20.8).
 * In V1, `stdout` and `stderr` are opaque log-ref identifiers usable by downstream
 * consumers (Run Trace virtual view, Phase 3.5+ log-tail surface) to address the rows.
 */
export interface SandboxLogRefs {
  stdout: string;
  stderr: string;
}

/**
 * Execution metrics emitted at harvest time (spec §20.2).
 * `vcpuSeconds` and `peakMemoryMb` are provider-reported where available;
 * `local_docker` and `inline` providers synthesise them from local observations.
 * `egressBytes` is captured only when `policy.network.mode !== 'none'`.
 */
export interface SandboxExecutionMetrics {
  wallClockMs: number;
  vcpuSeconds: number;
  peakMemoryMb: number;
  egressBytes: number;
}

/**
 * Telemetry event types emitted by the browser detection harness (spec §12).
 * Three events cover the run lifecycle: completion, regression detection, and
 * baseline establishment.
 */
export type HarnessRunEventType =
  | 'browser.detection.harness.run.completed'
  | 'browser.detection.harness.run.regression'
  | 'browser.detection.harness.baseline.updated';

/**
 * Feature flag name for the browser detection harness gating mode (spec §13).
 * When the runtime config key `DETECTION_HARNESS_GATING` is `'true'`, per-PR harness
 * failures BLOCK merge. Default is `'false'` (advisory only). Flip to `'true'`
 * per-site after two stable nightly runs confirm the baseline.
 * See server/tests/browser-detection-harness/runHarness.ts for the runtime consumer.
 */
export const DETECTION_HARNESS_GATING_FLAG = 'detection-harness-gating' as const;
export type DetectionHarnessFlagName = typeof DETECTION_HARNESS_GATING_FLAG;

/**
 * Proxy alignment telemetry event types emitted by the proxy alignment service (spec §12).
 * Three events cover resolution outcomes: full resolution, partial (some fields fell back),
 * and complete failure (GeoIP lookup error or DB unavailable).
 */
export type ProxyAlignmentEventType =
  | 'browser.proxy.alignment.resolved'
  | 'browser.proxy.alignment.failed'
  | 'browser.proxy.alignment.partial';

/**
 * GeoIP database telemetry event types emitted by the GeoIP refresh job and reader (spec §12).
 * Three events cover the refresh lifecycle and source-selection at session boot.
 */
export type GeoIpEventType =
  | 'geoip.db.refreshed'
  | 'geoip.db.refresh.failed'
  | 'geoip.db.source.selected';

/**
 * The result returned by `SandboxExecutionService.runTask` after harvest completes (spec §8.1, §20.2).
 * `terminalState` always matches `sandbox_executions.status` exactly at the moment the output
 * is returned. `output` is `null` for all non-`completed` terminal states — callers must branch
 * on `terminalState` before reading `output`. `artefactRefs` is empty for non-`completed` states.
 */
export interface SandboxRunTaskOutput {
  sandboxExecutionId: string;
  terminalState: SandboxTerminalState;
  /**
   * Schema-validated, redacted structured result from `/workspace/output.json`.
   * `null` for any terminal state other than `completed`.
   */
  output: unknown | null;
  artefactRefs: SandboxArtefactRef[];
  logRefs: SandboxLogRefs;
  metrics: SandboxExecutionMetrics;
  /** Provider-reported cost in integer cents. Zero for `local_docker` and `inline` providers. */
  costCents: number;
  templateName: string;
  templateVersion: string;
  provider: SandboxProviderName;
}
