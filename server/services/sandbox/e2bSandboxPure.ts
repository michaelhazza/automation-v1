// ---------------------------------------------------------------------------
// e2bSandboxPure.ts — pure helpers for the e2b sandbox provider.
//
// Extracts decision logic from the async e2bSandbox implementation so it can
// be unit-tested without the e2b SDK, DB, or network.
//
// Spec B §8.2.1, §13.1, §15.3.
//
// verify-pure-helper-convention.sh checks that test files import from this
// module using a relative path ending in `.js`.
// ---------------------------------------------------------------------------

import type { SandboxTerminalState } from '../../../shared/types/sandbox.js';

// ---------------------------------------------------------------------------
// E2b terminal signal types (mirroring the subset of the e2b SDK surface
// that the provider inspects). Kept minimal: only the fields the mapper reads.
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a terminal signal from the e2b SDK or the
 * e2bSandbox wrapper. The real SDK may surface these as enum values, exit
 * codes, or status strings — the adapter normalises them to this shape before
 * calling e2bTerminalSignalToInternal.
 */
export interface E2bTerminalSignal {
  /**
   * The terminal type as reported by the e2b SDK or inferred by the wrapper.
   *
   * Known e2b SDK values (as of current SDK surface):
   *   'finished'   — sandbox process exited with code 0 (normal completion)
   *   'timeout'    — e2b enforced the wall-clock ceiling (SDK `timeout` param)
   *   'killed'     — sandbox was explicitly terminated via the terminate API
   *   'error'      — sandbox process exited with non-zero code or crashed
   *   'unknown'    — e2b cannot determine the terminal cause (ambiguous)
   *
   * The provider wrapper normalises provider-side SDK output into these string
   * values before calling this function. When the e2b SDK is installed and
   * its actual enum shape is verified, this union will be updated to match.
   */
  type: 'finished' | 'timeout' | 'killed' | 'error' | 'unknown';
  /**
   * Process exit code where applicable. Non-zero exit codes with type
   * `finished` are reclassified as `error` by the mapper.
   */
  exitCode?: number;
  /**
   * Whether the e2b SDK itself declared the state to be ambiguous (e.g.,
   * network blip prevented a definitive status read). When true, the mapper
   * returns `provider_unavailable` regardless of `type`.
   */
  ambiguous?: boolean;
}

// ---------------------------------------------------------------------------
// Mapping: e2b terminal signal → SandboxTerminalState
// ---------------------------------------------------------------------------

/**
 * Map an e2b SDK terminal signal to the internal SandboxTerminalState taxonomy
 * (spec §13.1 closed set of 8 terminal states).
 *
 * This is the single mapping point consumed by the harvest pipeline's step 1
 * (terminal classification — spec §8.4 step 1). Pure: no I/O, no DB, no SDK.
 *
 * Decision rules:
 * 1. Explicit `ambiguous: true` → `provider_unavailable` (fail-closed).
 * 2. `type === 'unknown'` → `provider_unavailable` (fail-closed, spec §8.2.1).
 * 3. `type === 'finished'` with `exitCode === 0` (or exitCode undefined) → `completed`.
 * 4. `type === 'finished'` with non-zero `exitCode` → `crashed` (process signalled completion
 *    but with an error exit code; treat same as `error`).
 * 5. `type === 'timeout'` → `timed_out`.
 * 6. `type === 'killed'` → signal came from the worker-side terminate API call. Mapping
 *    depends on the context that triggered the kill — but since this pure function does not
 *    have that context, it returns `timed_out` as the default (the worker-side kill job
 *    writes the authoritative terminal state directly; this path is the harvest-reconciliation
 *    path). Callers that know the kill was cost-ceiling-driven should override.
 * 7. `type === 'error'` → `crashed`.
 */
export function e2bTerminalSignalToInternal(signal: E2bTerminalSignal): SandboxTerminalState {
  if (signal.ambiguous === true) {
    return 'provider_unavailable';
  }

  switch (signal.type) {
    case 'unknown':
      return 'provider_unavailable';

    case 'finished':
      if (signal.exitCode !== undefined && signal.exitCode !== 0) {
        return 'crashed';
      }
      return 'completed';

    case 'timeout':
      return 'timed_out';

    case 'killed':
      // Conservative default: the worker-side kill jobs write the authoritative
      // terminal state. When the harvest pipeline sees 'killed', it means the
      // sandbox was terminated externally; we default to timed_out because
      // wall-clock expiry is the most common cause of explicit termination.
      return 'timed_out';

    case 'error':
      return 'crashed';
  }
}

// ---------------------------------------------------------------------------
// Production-mode guard: no floating `latest` template version
// ---------------------------------------------------------------------------

/**
 * Assert that a template version string is not the floating `latest` alias.
 *
 * Production execution paths call this BEFORE constructing the e2bSandbox or
 * passing the template alias to the e2b SDK. Spec §15.3 locks this invariant.
 *
 * Throws a plain Error (not FailureError — this is a programming error caught
 * at construction time, not a runtime recoverable failure).
 *
 * @param templateVersion - the resolved version string from PUBLISHED_VERSION
 * @param context - short label for the error message (e.g. 'E2bSandbox.constructor')
 */
export function assertNotLatestTemplateVersion(
  templateVersion: string,
  context: string,
): void {
  if (templateVersion === 'latest') {
    throw new Error(
      `${context}: templateVersion 'latest' is not allowed in production — ` +
        'pin to the immutable digest from PUBLISHED_VERSION.image_digest (spec §15.3)',
    );
  }
}

// ---------------------------------------------------------------------------
// Metadata tag assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the e2b sandbox metadata tag map from an execution context.
 *
 * Spec §8.2.1: "Sandbox is tagged at creation with { org_id, subaccount_id,
 * run_id, agent_id, task_id, sandbox_execution_id, template_name,
 * template_version }. Metadata tags are the multi-tenancy boundary."
 *
 * Pure: no I/O. Returns a plain Record<string, string> consumed by the SDK
 * tag API at sandbox creation.
 */
export function buildE2bMetadataTags(ctx: {
  organisationId: string;
  subaccountId: string;
  runId: string;
  agentId: string;
  taskId: string;
  sandboxExecutionId: string;
  templateName: string;
  templateVersion: string;
}): Record<string, string> {
  return {
    org_id: ctx.organisationId,
    subaccount_id: ctx.subaccountId,
    run_id: ctx.runId,
    agent_id: ctx.agentId,
    task_id: ctx.taskId,
    sandbox_execution_id: ctx.sandboxExecutionId,
    template_name: ctx.templateName,
    template_version: ctx.templateVersion,
  };
}

// ---------------------------------------------------------------------------
// Credential path helper
// ---------------------------------------------------------------------------

/**
 * Compute the absolute path under which a credential alias is mounted inside
 * the sandbox (spec §11.1).
 *
 * Mounted as `/workspace/secrets/{alias}.token` — tmpfs, never persisted to
 * the sandbox image, and never logged.
 */
export function credentialAliasPath(alias: string): string {
  return `/workspace/secrets/${alias}.token`;
}
