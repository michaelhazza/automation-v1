/**
 * ceilingMonitorRaceDecisionPure.ts — Pure race-outcome decision for the
 * ceiling monitor vs provider-success concurrent write path (spec §8.3 SANDBOX-ADV-3.2).
 *
 * No imports — pure function, no DB, no network, no side effects.
 * Consumed by sandboxCeilingMonitorJob.ts applyCeilingTransition.
 */

import type { SandboxExecutionStatus } from '../../shared/types/sandbox.js';

// Terminal states are all values except the three non-terminal ones.
const NON_TERMINAL: ReadonlySet<SandboxExecutionStatus> = new Set([
  'pending',
  'running',
  'harvesting',
] satisfies SandboxExecutionStatus[]);

function isTerminal(status: SandboxExecutionStatus): boolean {
  return !NON_TERMINAL.has(status);
}

/**
 * Decide which writer wins when the ceiling monitor and the provider path
 * compete to write the terminal state on a sandbox execution row.
 *
 * Rule summary (§8.3 SANDBOX-ADV-3.2):
 *   1. Row is already in a terminal state → provider already wrote it; monitor loses.
 *   2. Row is `harvesting` + provider output available → provider is in flight; monitor loses.
 *   3. Row is `harvesting` + no provider output + monitor claimed first → monitor wins.
 *   4. Both observe `harvesting` with no provider output and monitorClaimedFirst is false
 *      → tied; conservative resolution is provider wins (caller treats `tied` like `provider`).
 *   5. Row is in a non-terminal pre-monitor state and monitor claims first → monitor wins.
 *
 * Suppression-is-success per §8.33: `winner: 'provider'` means the monitor should
 * return without issuing an UPDATE — the provider path owns the terminal write.
 */
export function decideCeilingVsProviderRaceOutcome(input: {
  rowStatusAtMonitorTick: SandboxExecutionStatus;
  providerOutputAvailable: boolean;
  monitorClaimedFirst: boolean;
}): { winner: 'provider' | 'monitor' | 'tied'; rationale: string } {
  const { rowStatusAtMonitorTick, providerOutputAvailable, monitorClaimedFirst } = input;

  // Rule 1: row is in a terminal state — provider already wrote it.
  if (isTerminal(rowStatusAtMonitorTick)) {
    return {
      winner: 'provider',
      rationale: `row_already_terminal:${rowStatusAtMonitorTick}`,
    };
  }

  // Rule 2: row is harvesting AND provider output is available — provider is in flight.
  if (rowStatusAtMonitorTick === 'harvesting' && providerOutputAvailable) {
    return {
      winner: 'provider',
      rationale: 'harvesting_with_provider_output_available',
    };
  }

  // Rule 3: row is harvesting, no provider output yet, monitor claimed first → monitor wins.
  if (rowStatusAtMonitorTick === 'harvesting' && !providerOutputAvailable && monitorClaimedFirst) {
    return {
      winner: 'monitor',
      rationale: 'harvesting_no_provider_output_monitor_claimed_first',
    };
  }

  // Rule 4: row is harvesting, no provider output, monitor did not claim first → tied.
  // Conservative resolution: provider wins; caller treats 'tied' like 'provider'.
  if (rowStatusAtMonitorTick === 'harvesting' && !providerOutputAvailable && !monitorClaimedFirst) {
    return {
      winner: 'tied',
      rationale: 'tied_both_observe_harvesting_no_provider_output:conservative_provider_wins',
    };
  }

  // Rule 5: row in a starting (non-terminal, non-harvesting) state; monitor is first to act.
  return {
    winner: 'monitor',
    rationale: `non_terminal_pre_monitor_state:${rowStatusAtMonitorTick}`,
  };
}
