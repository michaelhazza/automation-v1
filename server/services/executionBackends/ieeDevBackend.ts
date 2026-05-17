/**
 * ieeDevBackend — delegated dev-task adapter.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (IEE rows), § 11 (IEE adapter rows), § 13.1.1, § 14 Chunk 3.
 *       Spec B (sandbox-isolation) §18, §7.2.
 *
 * The dev variant of the IEE adapter pair. Shares storage (`iee_runs`),
 * event queue (`iee-run-completed`), and dispatch / lifecycle plumbing with
 * `ieeBrowserBackend`; the only per-adapter delta is the `iee_runs.type`
 * discriminator (`'dev'` here vs `'browser'` in the sibling). Common code
 * lives in `_ieeShared.ts`.
 *
 * Dispatch is now classification-aware (Spec B §18.2):
 *   - classifyExecutionClass() is consulted on every dispatch.
 *   - 'sandbox' class → SandboxExecutionService.runTask (Tier 4).
 *   - 'worker_trusted' / 'worker_orchestration' → ieeDispatch (unchanged).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ieeRunCompletedPayloadSchema,
  IEE_COMPLETED_QUEUE,
  IEE_TERMINAL_STATE_TABLE,
  ieeDispatch,
  ieeLoadTerminalState,
  ieeFinalise,
  ieeReconcile,
  ieeCancel,
} from './_ieeShared.js';
import { classifyExecutionClass } from './ieeDevBackendPure.js';
import { parseCurrentVersion } from '../sandbox/templateVersionParserPure.js';
import { FailureError } from '../../../shared/iee/failure.js';
import { failure } from '../../../shared/iee/failure.js';

import type { ExecutionBackend } from './types.js';
import { BackendOptionsMismatch } from './types.js';
import type { SandboxPolicy } from '../../../shared/types/sandbox.js';

// ---------------------------------------------------------------------------
// V1 default sandbox policy — applied when a sandbox-class task is dispatched
// without an explicit policy in the payload. All Tier 4 tasks in V1 operate
// with network deny-all, /workspace writable, and spec §10.1 default ceilings.
// ---------------------------------------------------------------------------

const V1_DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  network: { mode: 'none' },
  filesystem: { writableRoot: '/workspace' },
  ceilings: {
    wallClockMs: 600_000,  // 10 min (spec §10.1 default)
    costCents: 50,         // 50 cents (spec §10.1 default)
  },
  artefactLimits: {
    perArtefactBytes: 10_485_760,   // 10 MB
    totalBytes: 104_857_600,        // 100 MB
  },
  allowRuntimeInstall: false,
  inputLimits: {
    maxBytes: 26_214_400,           // 25 MB
    allowedMimes: [],               // any MIME allowed by default; tasks restrict if needed
  },
  providerThresholds: {
    startTimeoutMs: 30_000,         // 30 s provider-start soft timeout
  },
};

// Pinned allowlist of known-valid template versions for the synthetos-sandbox
// template. Deferred-decision: this list should be driven from CURRENT_VERSION
// coherence checks (C14) rather than maintained inline. TODO: consolidate in
// verify-template-version-coherence CI gate when C14 lands.
//
// `local-dev-v1.0.0` is the pre-first-publish sentinel per KNOWLEDGE.md
// [2026-05-11] — the strict CI gate exempts `local-dev-*` versions to keep
// the pre-first-publish flow green. The operator flips the prefix off at
// first-publish time (SANDBOX-F1 step 0). Without this entry every
// `iee_dev` sandbox-class dispatch in local dev throws
// `sandbox_input_rejected` because the committed CURRENT_VERSION carries
// `version=local-dev-v1.0.0`.
const ALLOWED_TEMPLATE_VERSIONS = ['v1.0.0', 'local-dev-v1.0.0'] as const;

/**
 * Resolve the current template version for a given template name from
 * infra/sandbox-templates/{name}/CURRENT_VERSION.
 * Falls back to SANDBOX_TEMPLATE_VERSION env var (then 'v1.0.0') when the
 * file cannot be read (local dev without template files on disk).
 * Throws FailureError('sandbox_input_rejected') for any version not in
 * the pinned allowlist.
 *
 * Exported for unit testing.
 */
export function resolveTemplateVersion(templateName: string): string {
  const filePath = join(process.cwd(), 'infra', 'sandbox-templates', templateName, 'CURRENT_VERSION');

  // Narrow the fallback to file-read errors only (ENOENT — file absent, common
  // in local-dev / CI before sandbox templates land on disk). Parse failures
  // MUST propagate as `sandbox_input_rejected` rather than silently falling
  // back to env/default, otherwise a malformed CURRENT_VERSION defeats the
  // template-version integrity guard.
  let content: string | null = null;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // Permission errors, file-system corruption, etc. — surface verbatim.
      throw err;
    }
    // File absent — fall back to env / default.
  }

  let version: string;
  if (content !== null) {
    // Do NOT wrap in try/catch — parse failures must propagate so the
    // allowlist check below rejects malformed sentinels rather than silently
    // accepting an env/default value.
    const parsed = parseCurrentVersion(content);
    version = parsed.version;
  } else {
    version = process.env['SANDBOX_TEMPLATE_VERSION'] ?? 'v1.0.0';
  }

  if (!(ALLOWED_TEMPLATE_VERSIONS as readonly string[]).includes(version)) {
    throw new FailureError(
      failure('sandbox_input_rejected', `template version not in allowlist: ${version}`, {
        templateName,
        received: version,
        allowed: ALLOWED_TEMPLATE_VERSIONS,
      }),
    );
  }

  return version;
}

export const ieeDevBackend: ExecutionBackend = {
  // Identity
  id: 'iee_dev',
  capabilities: ['delegated', 'code_execution', 'cancellation'],
  costModel: 'per_token',
  sandboxRequirement: 'code_execution',

  // Delegated-lifecycle slots
  completedEventQueue: IEE_COMPLETED_QUEUE,
  terminalStateTable: IEE_TERMINAL_STATE_TABLE,
  completedEventPayload: ieeRunCompletedPayloadSchema,

  async dispatch(input) {
    // Fail-closed guard — iee-worker-retirement spec §3.5 / §4 Chunk 2.
    // The standalone IEE worker process (worker/) is retired. ieeDevBackend
    // stays registered for adapter-contract compatibility, but production
    // dispatch must refuse rather than silently enqueue to a queue with no
    // consumer. Re-enablement: model dev tasks as a new operator_managed-style
    // backend; do NOT rehydrate the worker process.
    if (process.env.IEE_DEV_TASK_CONSUMER !== 'enabled') {
      throw new FailureError(
        failure('iee_dev_backend_retired', 'no consumer in this deployment', {
          runId: input.runId,
          agentId: input.agentId,
        }),
      );
    }

    const opts = input.backendOptions;

    // Mismatch check — adapter first statement invariant (Spec A § 4.1).
    if (opts.backendId !== 'iee_dev') {
      throw new BackendOptionsMismatch('iee_dev', opts.backendId);
    }

    const ieeTask = opts.ieeTask;
    if (!ieeTask) {
      throw Object.assign(new Error(`adapter 'iee_dev' requires ieeTask but received undefined`), {
        statusCode: 400,
        errorCode: 'IEE_TASK_REQUIRED',
      });
    }
    if (ieeTask.type !== 'dev') {
      throw Object.assign(new Error(`adapter 'iee_dev' requires ieeTask.type='dev', got '${ieeTask.type}'`), {
        statusCode: 400,
        errorCode: 'IEE_TASK_TYPE_MISMATCH',
      });
    }

    // Classification — Spec B §18.2. classifyExecutionClass is the single
    // producer of dispatch-class verdicts for this adapter.
    const executionClass = classifyExecutionClass(ieeTask);

    if (executionClass === 'sandbox') {
      // Tier 4 sandbox path. subaccountId must be non-null for all sandbox
      // tasks — sandbox isolation is scoped per subaccount (Spec B §11).
      if (!input.subaccountId) {
        throw new FailureError(
          failure(
            'sandbox_input_rejected',
            'sandbox-class task requires a non-null subaccountId for isolation scoping',
            { runId: input.runId, agentId: input.agentId },
          ),
        );
      }

      // Late import — avoids import cycle through the adapter registry.
      const { runTask } = await import('../sandboxExecutionService.js');

      const sandboxOutput = await runTask({
        sandboxExecutionId: randomUUID(),
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        runId: input.runId,
        agentId: input.agentId,
        // One sandbox execution per adapter dispatch; use runId as the
        // proxy task identifier until payload variants carry explicit taskIds.
        taskId: input.runId,
        templateName: 'synthetos-sandbox',
        templateVersion: resolveTemplateVersion('synthetos-sandbox'),
        policy: V1_DEFAULT_SANDBOX_POLICY,
        inputBytes: 0,
        inputFiles: [],
        credentialIssuanceContext: { aliases: [] },
        outputSchemaRef: 'generic',
      });

      // Translate sandbox output → BackendDispatchResult (lifecycle: in_process).
      // The calling orchestrator finalises the agent run inline using loopResult.
      const summary = sandboxOutput.terminalState === 'completed'
        ? `Sandbox completed (${sandboxOutput.templateName}@${sandboxOutput.templateVersion})`
        : `Sandbox ${sandboxOutput.terminalState} (sandboxExecutionId=${sandboxOutput.sandboxExecutionId})`;

      return {
        lifecycle: 'in_process',
        backendTaskId: sandboxOutput.sandboxExecutionId,
        loopResult: {
          summary,
          toolCallsLog: [],
          totalToolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          tasksCreated: 0,
          tasksUpdated: 0,
          deliverablesCreated: 0,
          finalStatus: sandboxOutput.terminalState,
        },
        deduplicated: false,
      };
    }

    // 'worker_trusted' and 'worker_orchestration' — existing IEE delegated
    // path. Unchanged from Spec A. ieeDispatch repeats the mismatch and task
    // type guards; that duplication is harmless and preserves the shared
    // helper's self-contained contract.
    return ieeDispatch({ type: 'dev', adapterId: 'iee_dev', input });
  },

  async loadTerminalState(tx, backendTaskId) {
    return ieeLoadTerminalState(tx, backendTaskId);
  },

  async finalise(input) {
    return ieeFinalise(input);
  },

  async reconcile() {
    const { finaliseAgentRunFromBackend } = await import('../agentRunFinalizationService.js');
    return ieeReconcile({
      type: 'dev',
      adapterId: 'iee_dev',
      finaliseAgentRunFromBackend,
    });
  },

  async cancel(input) {
    return ieeCancel(input);
  },
};
