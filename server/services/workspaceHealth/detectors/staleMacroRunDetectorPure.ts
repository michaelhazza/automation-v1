/**
 * staleMacroRunDetectorPure.ts — Phase 1 Showcase §4.6.2 (pure helpers).
 *
 * Pure function: determines which running 42 Macro IEE runs have exceeded the
 * stuck threshold. No DB access — the async wrapper feeds pre-fetched rows.
 */

export const MACRO_STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export interface MacroRunCandidate {
  ieeRunId: string;
  agentRunId: string;
  organisationId: string;
  lastHeartbeatAt: Date;
  stepCount: number;
}

export interface StaleMacroRunFinding {
  type: 'macro.run_stuck';
  agentRunId: string;
  ieeRunId: string;
  organisationId: string;
  currentStep: string;
  stuckSinceMs: number;
  thresholdMs: number;
}

/**
 * Returns findings for every candidate run where the elapsed time since
 * lastHeartbeatAt strictly exceeds thresholdMs.
 * Threshold is exclusive: elapsed === threshold is NOT considered stuck.
 */
export function computeStuckMacroRuns(
  runs: MacroRunCandidate[],
  now: Date,
  thresholdMs: number,
): StaleMacroRunFinding[] {
  const findings: StaleMacroRunFinding[] = [];
  for (const run of runs) {
    const stuckSinceMs = now.getTime() - run.lastHeartbeatAt.getTime();
    if (stuckSinceMs > thresholdMs) {
      findings.push({
        type: 'macro.run_stuck',
        agentRunId: run.agentRunId,
        ieeRunId: run.ieeRunId,
        organisationId: run.organisationId,
        currentStep: String(run.stepCount),
        stuckSinceMs,
        thresholdMs,
      });
    }
  }
  return findings;
}
