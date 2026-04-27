import type { SyntheticCheck, SyntheticResult } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

// Stub — activates in Slice C once sweep_completed events start being written.
// See spec §8.2 row 8 and plan §9 (stub rationale).
export const sweepCoverageDegraded: SyntheticCheck = {
  id: 'sweep-coverage-degraded',
  description: "The sweep job's coverage rate dropped below threshold — the monitor is silently leaving entities unevaluated.",
  defaultSeverity: 'high',

  async run(_ctx: HeuristicContext): Promise<SyntheticResult> {
    return { fired: false };
  },
};
