// ---------------------------------------------------------------------------
// withSandboxProvider.ts — sandbox provider call wrapper.
//
// Mirrors withBackoff's shape but adds:
//   - Sandbox-specific failure classification (transient / ambiguous / fatal).
//   - Ambiguous-terminal reconciliation enqueue (boss.send) without importing
//     the handler module — the string-constant seam in sandboxJobNames.ts is
//     the only coupling to C11a.
//   - Structured log events on retry / slow-start / rate-limit (spec §16.6).
//     DB sandbox_telemetry_events rows are written by the calling service (which
//     has the full execution context required by the table's NOT NULL columns).
//   - Respect for provider-returned Retry-After headers (spec §16.5).
//   - No silent fallback — every failure surfaces as FailureError (spec §16.2).
//
// Spec B §16.2, §16.3, §16.4, §16.5, §16.6, §22 (provider-call retry), §24.2.
// ---------------------------------------------------------------------------

import { withBackoff } from './withBackoff.js';
import { logger } from './logger.js';
import { getPgBoss } from './pgBossInstance.js';
import { SANDBOX_HARVEST_RECONCILIATION_JOB } from './sandboxJobNames.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import {
  classifyProviderSignal,
  extractRetryAfterMs,
  type ProviderSignal,
} from './withSandboxProviderPure.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type SandboxProviderPhase = 'start' | 'mid_execution' | 'terminal' | 'harvest';

export interface ProviderDiagnosticEvent {
  subKind: 'slow_start' | 'rate_limit' | 'retry' | 'ambiguous_terminal';
  attempt?: number;
  elapsedMs?: number;
  status?: number;
  code?: string;
}

export interface WithSandboxProviderOpts<T> {
  phase: SandboxProviderPhase;
  sandboxExecutionId: string;
  call: () => Promise<T>;
  telemetryWriter?: (event: ProviderDiagnosticEvent) => Promise<void>;
}

// Slow-start threshold per spec §16.4 (default 30 s).
const SLOW_START_THRESHOLD_MS = 30_000;

// ---------------------------------------------------------------------------
// Main wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a provider call with 3-attempt exponential-backoff retry, sandbox-
 * specific failure classification, Retry-After header respect, slow-start
 * detection, and ambiguous-terminal reconciliation enqueue.
 *
 * Returns T on success. Throws FailureError(sandbox_provider_unavailable)
 * after the backoff cap or on a fatal / ambiguous provider signal.
 *
 * Emits structured log events for every diagnostic signal. The calling
 * service (harvest pipeline) is responsible for writing the corresponding
 * sandbox_telemetry_events DB rows — those rows require NOT NULL context
 * fields (organisationId, runId, etc.) that only the service holds.
 */
export async function withSandboxProvider<T>(
  opts: WithSandboxProviderOpts<T>,
): Promise<T> {
  const { phase, sandboxExecutionId, call } = opts;

  let slowStartEmitted = false;
  const callStart = Date.now();
  let lastProviderSignal: ProviderSignal | undefined;

  const result = await withBackoff(call, {
    label: `sandbox.provider.${phase}`,
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    correlationId: sandboxExecutionId,
    runId: sandboxExecutionId,

    isRetryable: (err: unknown): boolean => {
      const signal = extractSignal(err);
      lastProviderSignal = signal;
      const { kind } = classifyProviderSignal(signal);
      // fatal and ambiguous exit the backoff loop immediately; ambiguous is
      // handled after the loop via reconciliation enqueue.
      return kind === 'transient';
    },

    retryAfterMs: (err: unknown): number | undefined => {
      return extractRetryAfterMs(
        extractSignal(err) as ProviderSignal & { retryAfterSeconds?: number },
      );
    },

    onRetry: async (attempt: number, err: unknown): Promise<void> => {
      const signal = extractSignal(err);
      const isRateLimit = signal.status === 429 || signal.code === 'rate_limited';
      const subKind = isRateLimit ? 'rate_limit' : 'retry';

      // Slow-start detection on 'start' phase.
      if (
        phase === 'start' &&
        !slowStartEmitted &&
        Date.now() - callStart > SLOW_START_THRESHOLD_MS
      ) {
        slowStartEmitted = true;
        const slowStartElapsedMs = Date.now() - callStart;
        logger.warn('sandbox.provider_diagnostic', {
          sandboxExecutionId,
          phase,
          subKind: 'slow_start',
          elapsedMs: slowStartElapsedMs,
        });
        if (opts.telemetryWriter) {
          try {
            await opts.telemetryWriter({ subKind: 'slow_start', elapsedMs: slowStartElapsedMs });
          } catch (telErr) {
            logger.error('sandbox.provider_diagnostic.telemetry_write_failed', { err: telErr });
          }
        }
      }

      logger.warn('sandbox.provider_diagnostic', {
        sandboxExecutionId,
        phase,
        subKind,
        attempt,
        status: signal.status,
        code: signal.code,
      });
      if (opts.telemetryWriter) {
        try {
          await opts.telemetryWriter({
            subKind: subKind as 'rate_limit' | 'retry',
            attempt,
            status: signal.status,
            code: signal.code,
          });
        } catch (telErr) {
          logger.error('sandbox.provider_diagnostic.telemetry_write_failed', { err: telErr });
        }
      }
    },
  }).catch(async (err: unknown) => {
    // withBackoff threw after exhausting transient retries, or threw
    // immediately for a non-transient (fatal / ambiguous) signal.
    const signal = lastProviderSignal ?? extractSignal(err);
    const { kind } = classifyProviderSignal(signal);

    if (kind === 'ambiguous') {
      logger.warn('sandbox.provider_diagnostic', {
        sandboxExecutionId,
        phase,
        subKind: 'ambiguous_terminal',
        code: signal.code,
        status: signal.status,
      });
      if (opts.telemetryWriter) {
        try {
          await opts.telemetryWriter({
            subKind: 'ambiguous_terminal',
            status: signal.status,
            code: signal.code,
          });
        } catch (telErr) {
          logger.error('sandbox.provider_diagnostic.telemetry_write_failed', { err: telErr });
        }
      }

      // Enqueue reconciliation job via the string-constant seam only.
      // C11a wires boss.work(SANDBOX_HARVEST_RECONCILIATION_JOB, handler).
      try {
        const boss = await getPgBoss();
        await boss.send(
          SANDBOX_HARVEST_RECONCILIATION_JOB,
          { sandboxExecutionId },
          { singletonKey: sandboxExecutionId },
        );
      } catch (bossErr: unknown) {
        // Enqueue failure is non-fatal: the reconciliation job runs on a
        // scheduled cadence and picks up stale rows independently.
        logger.error('sandbox.provider.reconciliation_enqueue_failed', {
          sandboxExecutionId,
          phase,
          err: bossErr instanceof Error ? bossErr.message : String(bossErr),
        });
      }
    }

    const errMessage = (err instanceof Error ? err.message : String(err)).slice(0, 100);
    throw new FailureError(
      failure(
        'sandbox_provider_unavailable',
        `${phase}:${kind}:${errMessage}`,
        { sandboxExecutionId, phase, kind },
      ),
    );
  });

  // Post-success slow-start check: provider was slow but eventually succeeded.
  if (phase === 'start' && !slowStartEmitted && Date.now() - callStart > SLOW_START_THRESHOLD_MS) {
    const postSuccessElapsedMs = Date.now() - callStart;
    logger.warn('sandbox.provider_diagnostic', {
      sandboxExecutionId,
      phase,
      subKind: 'slow_start',
      elapsedMs: postSuccessElapsedMs,
      outcome: 'success',
    });
    if (opts.telemetryWriter) {
      try {
        await opts.telemetryWriter({ subKind: 'slow_start', elapsedMs: postSuccessElapsedMs });
      } catch (err) {
        logger.error('sandbox.provider_diagnostic.telemetry_write_failed', { err });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a thrown value into a ProviderSignal. Handles HTTP-response-
 * shaped objects, Error subclasses with status/code properties, and plain
 * objects thrown by provider SDKs.
 */
function extractSignal(err: unknown): ProviderSignal {
  if (err === null || err === undefined || typeof err !== 'object') return {};

  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    ambiguous?: unknown;
  };

  return {
    status:
      typeof e.status === 'number'
        ? e.status
        : typeof e.statusCode === 'number'
          ? e.statusCode
          : undefined,
    code: typeof e.code === 'string' ? e.code : undefined,
    ambiguous: e.ambiguous === true,
  };
}
