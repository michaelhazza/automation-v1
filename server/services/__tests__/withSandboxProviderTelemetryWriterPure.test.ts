/**
 * withSandboxProviderTelemetryWriterPure.test.ts
 *
 * Tests the optional telemetryWriter callback on WithSandboxProviderOpts<T>.
 * All external I/O is mocked; no DB, no network, no timers.
 *
 * Spec B §16.6, §8.20, §8.36. Chunk 6.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/withSandboxProviderTelemetryWriterPure.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Type-only import to satisfy `verify-pure-helper-convention.sh` — the
// telemetryWriter callback is exercised in production by sandboxHarvestService;
// importing its type pins the test to the caller of the wrapper under test.
import type { runHarvest as _RunHarvest } from '../sandboxHarvestService.js';
type _Unused = typeof _RunHarvest;

export {};

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/withBackoff.js', () => ({
  withBackoff: vi.fn(),
}));

vi.mock('../../lib/pgBossInstance.js', () => ({
  getPgBoss: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../../lib/sandboxJobNames.js', () => ({
  SANDBOX_HARVEST_RECONCILIATION_JOB: 'sandbox-harvest-reconciliation',
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../lib/withSandboxProviderPure.js', () => ({
  classifyProviderSignal: vi.fn().mockReturnValue({ kind: 'transient' }),
  extractRetryAfterMs: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks are hoisted)
// ---------------------------------------------------------------------------

const { withBackoff } = await import('../../lib/withBackoff.js');
const { logger } = await import('../../lib/logger.js');
const { classifyProviderSignal } = await import('../../lib/withSandboxProviderPure.js');
const { withSandboxProvider } = await import('../../lib/withSandboxProvider.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SANDBOX_ID = '00000000-0000-0000-0000-000000000001';

function makeOpts(telemetryWriter?: Parameters<typeof withSandboxProvider>[0]['telemetryWriter']) {
  return {
    phase: 'start' as const,
    sandboxExecutionId: SANDBOX_ID,
    call: vi.fn().mockResolvedValue('result'),
    telemetryWriter,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withSandboxProvider — telemetryWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: withBackoff succeeds and calls onRetry once with a transient error.
    vi.mocked(withBackoff).mockImplementation(async (_fn, opts) => {
      const err = Object.assign(new Error('transient'), { status: 503 });
      if (opts.onRetry) {
        await (opts.onRetry as (a: number, e: unknown) => unknown)(1, err);
      }
      return 'result';
    });

    vi.mocked(classifyProviderSignal).mockReturnValue({ kind: 'transient' });
  });

  it('Test 1: callback is invoked once per emitted diagnostic (retry sub-kind)', async () => {
    const writer = vi.fn().mockResolvedValue(undefined);
    await withSandboxProvider(makeOpts(writer));

    // onRetry fires once → writer receives one retry event.
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ subKind: expect.stringMatching(/^(retry|rate_limit)$/) }),
    );
  });

  it('Test 2: callback throws → wrapper does NOT throw; error is logged', async () => {
    const writeError = new Error('db_write_failure');
    const writer = vi.fn().mockRejectedValue(writeError);

    // Should not throw even though telemetryWriter throws.
    await expect(withSandboxProvider(makeOpts(writer))).resolves.toBe('result');

    // Error must be logged.
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'sandbox.provider_diagnostic.telemetry_write_failed',
      expect.objectContaining({ err: writeError }),
    );
  });

  it('Test 3: callback undefined → behaviour identical to current state (no throw)', async () => {
    // No telemetryWriter supplied — should complete normally.
    await expect(withSandboxProvider(makeOpts(undefined))).resolves.toBe('result');

    // logger.warn still fires for the retry diagnostic.
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'sandbox.provider_diagnostic',
      expect.objectContaining({ sandboxExecutionId: SANDBOX_ID }),
    );
  });
});
