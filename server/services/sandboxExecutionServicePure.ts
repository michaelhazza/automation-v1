/**
 * sandboxExecutionServicePure.ts — Pure helpers for the sandbox execution primitive.
 *
 * Spec B §8.1, §10.1, §13.1. Three exported pure functions; no I/O, no DB, no
 * provider SDK. Safe to call from tests, reconciliation jobs, and the harvest pipeline.
 *
 * Runnable test: npx vitest run server/services/__tests__/sandboxExecutionServicePure.test.ts
 */

import type { SandboxPolicy, SandboxTerminalState } from '../../shared/types/sandbox.js';

// ---------------------------------------------------------------------------
// ProviderFlags — structural shape mirroring policy fields for the provider
// SDK layer (C9 / C10). Defined inline here; consumed by e2bSandbox /
// localDockerSandbox constructors when they arrive in C9 / C10.
// ---------------------------------------------------------------------------

export interface ProviderFlags {
  /** Network mode to configure on the provider sandbox. */
  networkMode: 'none' | 'allowlist';
  /** Explicit allowlist entries when networkMode === 'allowlist'. */
  networkAllowlist: Array<{
    host: string;
    port: number;
    protocol: 'http' | 'https' | 'tcp' | 'other';
  }>;
  /** Paths that are read-only inside the sandbox filesystem. */
  fsReadOnlyPaths: string[];
  /** Paths that are writable inside the sandbox filesystem. */
  fsWritablePaths: string[];
  /** Hosts explicitly allowed for egress (derived from network allowlist). */
  allowedHosts: string[];
  /** Whether runtime package installation is permitted (V1 invariant: always false). */
  runtimeInstall: boolean;
  /** Provider-side wall-clock timeout in milliseconds. */
  wallClockMs: number;
  /** Provider-side soft cost ceiling in cents (best-effort enforcement). */
  costCents: number;
  /** Per-artefact maximum bytes. */
  perArtefactBytes: number;
  /** Total-artefact maximum bytes for the task. */
  totalArtefactBytes: number;
  /** Provider-start soft timeout in milliseconds (slow-start diagnostic threshold). */
  startTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// HarvestSignal — intermediate shape produced by the harvest pipeline (C7)
// and consumed by classifyTerminal. Defined here so the pure classifier can
// reference it without a circular import on C7.
// ---------------------------------------------------------------------------

export type HarvestStepResult =
  | { ok: true }
  | { ok: false; reason: SandboxTerminalState };

// ---------------------------------------------------------------------------
// ProviderSignal — the terminal signal from a sandbox provider (C9 / C10).
// ---------------------------------------------------------------------------

export type ProviderTerminalKind =
  | 'clean_exit'
  | 'timed_out'
  | 'cost_ceiling_hit'
  | 'non_zero_exit'
  | 'provider_unavailable';

export interface ProviderSignal {
  kind: ProviderTerminalKind;
}

// ---------------------------------------------------------------------------
// § 1: classifyTerminal
//
// Maps a provider terminal signal and a harvest pipeline result to exactly one
// of the 8 terminal states from spec §13.1. This is the single producer of
// SandboxTerminalState values. Every input combination → exactly one output.
//
// Decision table (read top-to-bottom; first match wins):
//
//  1. provider_unavailable                           → provider_unavailable
//  2. provider non_zero_exit                         → crashed
//  3. provider timed_out                             → timed_out
//  4. provider cost_ceiling_hit                      → cost_ceiling_hit
//  5. harvest artefact_upload step failed            → artefact_upload_failed
//  6. harvest any other step failed                  → the step's reported state
//  7. provider clean_exit + all harvest steps ok     → completed
//  8. (impossible — exhaustive safety net)           → provider_unavailable
// ---------------------------------------------------------------------------

export function classifyTerminal(
  providerSignal: ProviderSignal,
  harvestResult: HarvestStepResult,
): SandboxTerminalState {
  // Provider-side failures always win over harvest results.
  if (providerSignal.kind === 'provider_unavailable') {
    return 'provider_unavailable';
  }
  if (providerSignal.kind === 'non_zero_exit') {
    return 'crashed';
  }
  if (providerSignal.kind === 'timed_out') {
    return 'timed_out';
  }
  if (providerSignal.kind === 'cost_ceiling_hit') {
    return 'cost_ceiling_hit';
  }

  // Provider exited cleanly (clean_exit). Harvest result determines the outcome.
  if (!harvestResult.ok) {
    return harvestResult.reason;
  }

  return 'completed';
}

// ---------------------------------------------------------------------------
// § 2: resolveSandboxCeilings
//
// Computes the active wall-clock, cost, and monitor-interval ceilings from
// the policy snapshot. Applies spec §10.1 defaults and hard caps:
//   - wallClockMs  default: 600_000 ms (10 min)  hard cap: 1_800_000 ms (30 min)
//   - costCents    default: 50 cents              hard cap: 200 cents
//   - monitorIntervalMs default: 5_000 ms         no hard cap (bounded by business logic)
//
// Inputs from the policy's `ceilings` object; undefined fields fall back to
// spec defaults. Returns a fully-resolved, bounded triple.
// ---------------------------------------------------------------------------

const DEFAULT_WALL_CLOCK_MS = 600_000;   // 10 minutes
const HARD_CAP_WALL_CLOCK_MS = 1_800_000; // 30 minutes
const DEFAULT_COST_CENTS = 50;
const HARD_CAP_COST_CENTS = 200;
const DEFAULT_MONITOR_INTERVAL_MS = 5_000;

export interface ResolvedCeilings {
  wallClockMs: number;
  costCents: number;
  monitorIntervalMs: number;
}

export function resolveSandboxCeilings(policy: SandboxPolicy): ResolvedCeilings {
  const { ceilings } = policy;

  const rawWallClock = ceilings.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  const rawCost = ceilings.costCents ?? DEFAULT_COST_CENTS;
  const rawMonitor = ceilings.monitorIntervalMs ?? DEFAULT_MONITOR_INTERVAL_MS;

  return {
    wallClockMs: Math.min(rawWallClock, HARD_CAP_WALL_CLOCK_MS),
    costCents: Math.min(rawCost, HARD_CAP_COST_CENTS),
    monitorIntervalMs: rawMonitor,
  };
}

// ---------------------------------------------------------------------------
// § 3: mapPolicyToProviderFlags
//
// Pure transformation from a SandboxPolicy to the ProviderFlags shape consumed
// by the provider SDK layer. No defaults are applied here beyond what the
// policy already carries; ceiling resolution is a separate concern handled by
// resolveSandboxCeilings (called by the caller, not inside this function).
// ---------------------------------------------------------------------------

export function mapPolicyToProviderFlags(
  policy: SandboxPolicy,
  resolvedCeilings: ResolvedCeilings,
): ProviderFlags {
  const { network, filesystem, artefactLimits, inputLimits: _inputLimits, providerThresholds } = policy;

  const networkAllowlist =
    network.mode === 'allowlist' && network.allowlist ? network.allowlist : [];

  const allowedHosts = networkAllowlist.map((entry) => entry.host);

  return {
    networkMode: network.mode,
    networkAllowlist,
    // The writable root is the only writable path in V1.
    fsReadOnlyPaths: [],
    fsWritablePaths: [filesystem.writableRoot],
    allowedHosts,
    runtimeInstall: policy.allowRuntimeInstall,
    wallClockMs: resolvedCeilings.wallClockMs,
    costCents: resolvedCeilings.costCents,
    perArtefactBytes: artefactLimits.perArtefactBytes,
    totalArtefactBytes: artefactLimits.totalBytes,
    startTimeoutMs: providerThresholds.startTimeoutMs,
  };
}

// Re-export the constants so callers (C7 harvest pipeline, C11 jobs) can
// reference them without duplicating magic numbers.
export {
  DEFAULT_WALL_CLOCK_MS,
  HARD_CAP_WALL_CLOCK_MS,
  DEFAULT_COST_CENTS,
  HARD_CAP_COST_CENTS,
  DEFAULT_MONITOR_INTERVAL_MS,
};
