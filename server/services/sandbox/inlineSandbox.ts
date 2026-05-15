/**
 * inlineSandbox.ts — Test-only in-process sandbox implementation.
 *
 * Spec B §8.2.3: Runs the task in-process with NO isolation. Exists solely so
 * unit tests for harvest-layer logic, cost classification, and redaction can
 * call a sandbox primitive without spinning up Docker or the e2b SDK.
 *
 * Hard guard: construction throws if process.env.NODE_ENV !== 'test' OR
 * process.env.SANDBOX_ALLOW_INLINE !== '1'. This closes the "silent fallback to
 * in-process execution" hole forbidden by brief §2.2 and spec §6 invariants.
 *
 * runTask returns a deterministic completed result (echoes inputFiles back as
 * output content with synthetic metrics) — genuinely useful for harvest pipeline
 * tests, not a no-op stub.
 */

import { FailureError } from '../../../shared/iee/failure.js';
import type {
  SandboxRunTaskInput,
  SandboxRunTaskOutput,
} from '../../../shared/types/sandbox.js';
import type { SandboxExecutionService } from './sandboxProviderResolver.js';

export class InlineSandbox implements SandboxExecutionService {
  constructor() {
    const nodeEnv = process.env['NODE_ENV'];
    const allowInline = process.env['SANDBOX_ALLOW_INLINE'];
    if (nodeEnv !== 'test' || allowInline !== '1') {
      throw new FailureError({
        failureReason: 'sandbox_provider_unavailable',
        failureDetail:
          'inlineSandbox is test-only — set NODE_ENV=test and SANDBOX_ALLOW_INLINE=1 to use',
      });
    }
  }

  async terminate(_providerSandboxId: string): Promise<void> {
    // no-op — inline runs in-process; no external sandbox to terminate
  }

  async runTask(input: SandboxRunTaskInput): Promise<SandboxRunTaskOutput> {
    const startMs = Date.now();

    // Deterministic in-process result: echoes the input descriptor back as the
    // output payload. Tests can assert on this shape without a real sandbox.
    const output = {
      sandboxExecutionId: input.sandboxExecutionId,
      inputFiles: input.inputFiles.map((f) => ({ path: f.path, bytes: f.bytes })),
    };

    const wallClockMs = Date.now() - startMs;

    return {
      sandboxExecutionId: input.sandboxExecutionId,
      terminalState: 'completed',
      output,
      artefactRefs: [],
      logRefs: {
        stdout: `inline:${input.sandboxExecutionId}:stdout`,
        stderr: `inline:${input.sandboxExecutionId}:stderr`,
      },
      metrics: {
        wallClockMs,
        vcpuSeconds: 0,
        peakMemoryMb: 0,
        egressBytes: 0,
      },
      costCents: 0,
      templateName: input.templateName,
      templateVersion: input.templateVersion,
      provider: 'inline',
    };
  }
}
