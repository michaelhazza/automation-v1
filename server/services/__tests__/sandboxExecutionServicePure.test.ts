/**
 * sandboxExecutionServicePure.test.ts — Pure function tests for sandboxExecutionServicePure.
 *
 * Covers every documented branch of:
 *   - classifyTerminal      (spec §13.1)
 *   - resolveSandboxCeilings (spec §10.1)
 *   - mapPolicyToProviderFlags (spec §8.1, §9)
 *
 * No DB, no network, no provider SDKs. Pure input → output assertions only.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/sandboxExecutionServicePure.test.ts
 */

import { describe, test, expect } from 'vitest';
import {
  classifyTerminal,
  resolveSandboxCeilings,
  mapPolicyToProviderFlags,
  DEFAULT_WALL_CLOCK_MS,
  HARD_CAP_WALL_CLOCK_MS,
  DEFAULT_COST_CENTS,
  HARD_CAP_COST_CENTS,
  DEFAULT_MONITOR_INTERVAL_MS,
  type ProviderSignal,
  type HarvestStepResult,
  type ResolvedCeilings,
} from '../sandboxExecutionServicePure.js';
import type { SandboxPolicy } from '../../../shared/types/sandbox.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<SandboxPolicy['ceilings']> = {}): SandboxPolicy {
  return {
    network: { mode: 'none' },
    filesystem: { writableRoot: '/workspace' },
    ceilings: {
      wallClockMs: DEFAULT_WALL_CLOCK_MS,
      costCents: DEFAULT_COST_CENTS,
      monitorIntervalMs: DEFAULT_MONITOR_INTERVAL_MS,
      ...overrides,
    },
    artefactLimits: { perArtefactBytes: 10_485_760, totalBytes: 104_857_600 },
    allowRuntimeInstall: false,
    inputLimits: { maxBytes: 26_214_400, allowedMimes: ['text/csv'] },
    providerThresholds: { startTimeoutMs: 30_000 },
  };
}

// ---------------------------------------------------------------------------
// § classifyTerminal
// ---------------------------------------------------------------------------

describe('classifyTerminal', () => {
  // Provider-unavailable wins over all harvest results.
  describe('provider_unavailable signal', () => {
    const signal: ProviderSignal = { kind: 'provider_unavailable' };

    test('with harvest ok → provider_unavailable', () => {
      expect(classifyTerminal(signal, { ok: true })).toBe('provider_unavailable');
    });

    test('with harvest failed harvest_failed → provider_unavailable', () => {
      expect(classifyTerminal(signal, { ok: false, reason: 'harvest_failed' })).toBe(
        'provider_unavailable',
      );
    });

    test('with harvest failed completed → provider_unavailable', () => {
      expect(classifyTerminal(signal, { ok: false, reason: 'completed' as never })).toBe(
        'provider_unavailable',
      );
    });
  });

  // Non-zero exit → crashed regardless of harvest.
  describe('non_zero_exit signal', () => {
    const signal: ProviderSignal = { kind: 'non_zero_exit' };

    test('with harvest ok → crashed', () => {
      expect(classifyTerminal(signal, { ok: true })).toBe('crashed');
    });

    test('with harvest failed → crashed (provider takes precedence)', () => {
      expect(classifyTerminal(signal, { ok: false, reason: 'harvest_failed' })).toBe('crashed');
    });
  });

  // Timed_out → timed_out.
  describe('timed_out signal', () => {
    const signal: ProviderSignal = { kind: 'timed_out' };

    test('with harvest ok → timed_out', () => {
      expect(classifyTerminal(signal, { ok: true })).toBe('timed_out');
    });

    test('with harvest failed → timed_out', () => {
      expect(classifyTerminal(signal, { ok: false, reason: 'output_validation_failed' })).toBe(
        'timed_out',
      );
    });
  });

  // cost_ceiling_hit → cost_ceiling_hit.
  describe('cost_ceiling_hit signal', () => {
    const signal: ProviderSignal = { kind: 'cost_ceiling_hit' };

    test('with harvest ok → cost_ceiling_hit', () => {
      expect(classifyTerminal(signal, { ok: true })).toBe('cost_ceiling_hit');
    });

    test('with harvest failed → cost_ceiling_hit', () => {
      expect(classifyTerminal(signal, { ok: false, reason: 'artefact_upload_failed' })).toBe(
        'cost_ceiling_hit',
      );
    });
  });

  // clean_exit + harvest result determines outcome.
  describe('clean_exit signal', () => {
    const signal: ProviderSignal = { kind: 'clean_exit' };

    test('harvest ok → completed', () => {
      expect(classifyTerminal(signal, { ok: true })).toBe('completed');
    });

    test('harvest failed output_validation_failed → output_validation_failed', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'output_validation_failed' };
      expect(classifyTerminal(signal, harvest)).toBe('output_validation_failed');
    });

    test('harvest failed harvest_failed → harvest_failed', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'harvest_failed' };
      expect(classifyTerminal(signal, harvest)).toBe('harvest_failed');
    });

    test('harvest failed artefact_upload_failed → artefact_upload_failed', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'artefact_upload_failed' };
      expect(classifyTerminal(signal, harvest)).toBe('artefact_upload_failed');
    });

    test('harvest failed timed_out → timed_out (harvest can report provider timeout late)', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'timed_out' };
      expect(classifyTerminal(signal, harvest)).toBe('timed_out');
    });

    test('harvest failed crashed → crashed', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'crashed' };
      expect(classifyTerminal(signal, harvest)).toBe('crashed');
    });

    test('harvest failed cost_ceiling_hit → cost_ceiling_hit', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'cost_ceiling_hit' };
      expect(classifyTerminal(signal, harvest)).toBe('cost_ceiling_hit');
    });

    test('harvest failed provider_unavailable → provider_unavailable', () => {
      const harvest: HarvestStepResult = { ok: false, reason: 'provider_unavailable' };
      expect(classifyTerminal(signal, harvest)).toBe('provider_unavailable');
    });
  });
});

// ---------------------------------------------------------------------------
// § resolveSandboxCeilings
// ---------------------------------------------------------------------------

describe('resolveSandboxCeilings', () => {
  // Default path: policy carries the spec defaults.
  test('returns spec defaults when policy carries default values', () => {
    const result = resolveSandboxCeilings(makePolicy());
    expect(result.wallClockMs).toBe(DEFAULT_WALL_CLOCK_MS);
    expect(result.costCents).toBe(DEFAULT_COST_CENTS);
    expect(result.monitorIntervalMs).toBe(DEFAULT_MONITOR_INTERVAL_MS);
  });

  // Override path: caller-provided values below the hard cap.
  test('uses caller overrides when below hard caps', () => {
    const result = resolveSandboxCeilings(
      makePolicy({ wallClockMs: 60_000, costCents: 10, monitorIntervalMs: 2_000 }),
    );
    expect(result.wallClockMs).toBe(60_000);
    expect(result.costCents).toBe(10);
    expect(result.monitorIntervalMs).toBe(2_000);
  });

  // Hard cap: wall-clock capped at 30 min.
  test('clamps wallClockMs to HARD_CAP_WALL_CLOCK_MS when over cap', () => {
    const result = resolveSandboxCeilings(makePolicy({ wallClockMs: 9_999_999 }));
    expect(result.wallClockMs).toBe(HARD_CAP_WALL_CLOCK_MS);
  });

  // Hard cap: cost capped at 200 cents.
  test('clamps costCents to HARD_CAP_COST_CENTS when over cap', () => {
    const result = resolveSandboxCeilings(makePolicy({ costCents: 9999 }));
    expect(result.costCents).toBe(HARD_CAP_COST_CENTS);
  });

  // Exact cap boundary values should not be clamped.
  test('does not clamp when wallClockMs equals the hard cap exactly', () => {
    const result = resolveSandboxCeilings(makePolicy({ wallClockMs: HARD_CAP_WALL_CLOCK_MS }));
    expect(result.wallClockMs).toBe(HARD_CAP_WALL_CLOCK_MS);
  });

  test('does not clamp when costCents equals the hard cap exactly', () => {
    const result = resolveSandboxCeilings(makePolicy({ costCents: HARD_CAP_COST_CENTS }));
    expect(result.costCents).toBe(HARD_CAP_COST_CENTS);
  });

  // monitorIntervalMs has no hard cap — arbitrary large value is preserved.
  test('preserves monitorIntervalMs beyond any cap (no hard cap applies)', () => {
    const result = resolveSandboxCeilings(makePolicy({ monitorIntervalMs: 999_000 }));
    expect(result.monitorIntervalMs).toBe(999_000);
  });

  // Zero-value overrides are accepted (caller explicitly requested 0).
  test('accepts zero wallClockMs (caller override)', () => {
    const result = resolveSandboxCeilings(makePolicy({ wallClockMs: 0 }));
    expect(result.wallClockMs).toBe(0);
  });

  test('accepts zero costCents (caller override)', () => {
    const result = resolveSandboxCeilings(makePolicy({ costCents: 0 }));
    expect(result.costCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// § mapPolicyToProviderFlags
// ---------------------------------------------------------------------------

describe('mapPolicyToProviderFlags', () => {
  function makeResolved(overrides: Partial<ResolvedCeilings> = {}): ResolvedCeilings {
    return {
      wallClockMs: DEFAULT_WALL_CLOCK_MS,
      costCents: DEFAULT_COST_CENTS,
      monitorIntervalMs: DEFAULT_MONITOR_INTERVAL_MS,
      ...overrides,
    };
  }

  // Default deny-all network policy.
  test('network mode=none → networkMode=none, empty allowlist, empty allowedHosts', () => {
    const flags = mapPolicyToProviderFlags(makePolicy(), makeResolved());
    expect(flags.networkMode).toBe('none');
    expect(flags.networkAllowlist).toEqual([]);
    expect(flags.allowedHosts).toEqual([]);
  });

  // Allowlist network policy with entries.
  test('network mode=allowlist → allowlist entries and allowedHosts derived from hosts', () => {
    const policy: SandboxPolicy = {
      ...makePolicy(),
      network: {
        mode: 'allowlist',
        allowlist: [
          { host: 'api.openai.com', port: 443, protocol: 'https' },
          { host: 'storage.example.com', port: 443, protocol: 'https' },
        ],
      },
    };
    const flags = mapPolicyToProviderFlags(policy, makeResolved());
    expect(flags.networkMode).toBe('allowlist');
    expect(flags.networkAllowlist).toHaveLength(2);
    expect(flags.allowedHosts).toEqual(['api.openai.com', 'storage.example.com']);
  });

  // Empty allowlist when mode=allowlist but allowlist is undefined.
  test('mode=allowlist with no allowlist array → empty allowlist, empty allowedHosts', () => {
    const policy: SandboxPolicy = {
      ...makePolicy(),
      network: { mode: 'allowlist', allowlist: undefined },
    };
    const flags = mapPolicyToProviderFlags(policy, makeResolved());
    expect(flags.networkAllowlist).toEqual([]);
    expect(flags.allowedHosts).toEqual([]);
  });

  // Filesystem: writable root mapped to fsWritablePaths.
  test('writableRoot /workspace → fsWritablePaths includes /workspace', () => {
    const flags = mapPolicyToProviderFlags(makePolicy(), makeResolved());
    expect(flags.fsWritablePaths).toContain('/workspace');
    expect(flags.fsReadOnlyPaths).toEqual([]);
  });

  // runtimeInstall is always false in V1 (literal type).
  test('allowRuntimeInstall=false → runtimeInstall=false in flags', () => {
    const flags = mapPolicyToProviderFlags(makePolicy(), makeResolved());
    expect(flags.runtimeInstall).toBe(false);
  });

  // Ceilings are taken from the resolved ceilings, not re-derived from policy.
  test('wallClockMs and costCents are taken from resolvedCeilings', () => {
    const resolved = makeResolved({ wallClockMs: 120_000, costCents: 25 });
    const flags = mapPolicyToProviderFlags(makePolicy(), resolved);
    expect(flags.wallClockMs).toBe(120_000);
    expect(flags.costCents).toBe(25);
  });

  // Artefact limits propagated.
  test('artefact limits propagated from policy', () => {
    const flags = mapPolicyToProviderFlags(makePolicy(), makeResolved());
    expect(flags.perArtefactBytes).toBe(10_485_760);
    expect(flags.totalArtefactBytes).toBe(104_857_600);
  });

  // Provider thresholds propagated.
  test('startTimeoutMs propagated from policy.providerThresholds', () => {
    const flags = mapPolicyToProviderFlags(makePolicy(), makeResolved());
    expect(flags.startTimeoutMs).toBe(30_000);
  });

  // Custom thresholds.
  test('custom providerThresholds.startTimeoutMs is propagated', () => {
    const policy: SandboxPolicy = {
      ...makePolicy(),
      providerThresholds: { startTimeoutMs: 60_000 },
    };
    const flags = mapPolicyToProviderFlags(policy, makeResolved());
    expect(flags.startTimeoutMs).toBe(60_000);
  });

  // Mixed resolved ceilings with custom artefact limits.
  test('custom artefact limits propagated from policy', () => {
    const policy: SandboxPolicy = {
      ...makePolicy(),
      artefactLimits: { perArtefactBytes: 5_000_000, totalBytes: 50_000_000 },
    };
    const flags = mapPolicyToProviderFlags(policy, makeResolved());
    expect(flags.perArtefactBytes).toBe(5_000_000);
    expect(flags.totalArtefactBytes).toBe(50_000_000);
  });
});
