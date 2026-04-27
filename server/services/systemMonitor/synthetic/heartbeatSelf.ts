import type { SyntheticCheck, SyntheticResult } from './types.js';
import { bucket15min } from './types.js';
import type { HeuristicContext } from '../heuristics/types.js';

// Process-local heartbeat store (system_kv not present — per plan §4.5 fallback).
// Survives restarts only at the cost of a false-negative on tick 1 after restart;
// that window is acceptable and is closed by the pg-boss-queue-stalled check.
const heartbeatStore = new Map<string, Date>();
const HEARTBEAT_KEY = 'system_monitor:last_heartbeat';

const HEARTBEAT_STALE_TICKS = Number(process.env.SYSTEM_MONITOR_HEARTBEAT_STALE_TICKS) || 3;
const TICK_INTERVAL_SECONDS = Number(process.env.SYSTEM_MONITOR_SYNTHETIC_CHECK_INTERVAL_SECONDS) || 60;

export const heartbeatSelf: SyntheticCheck = {
  id: 'heartbeat-self',
  description: 'The synthetic-check job records its own heartbeat. If the heartbeat is stale on the next tick, fire.',
  defaultSeverity: 'critical',

  async run(ctx: HeuristicContext): Promise<SyntheticResult> {
    const prior = heartbeatStore.get(HEARTBEAT_KEY) ?? null;

    // Write the current tick timestamp before evaluating — so next tick can read it.
    heartbeatStore.set(HEARTBEAT_KEY, ctx.now);

    if (prior === null) {
      // First tick after (re)start — no baseline yet; healthy.
      return { fired: false };
    }

    const staleThresholdMs = HEARTBEAT_STALE_TICKS * TICK_INTERVAL_SECONDS * 1000;
    const ageMs = ctx.now.getTime() - prior.getTime();

    if (ageMs > staleThresholdMs) {
      return {
        fired: true,
        severity: 'critical',
        resourceKind: 'job',
        resourceId: 'system-monitor-synthetic-checks',
        summary: `Synthetic-check heartbeat is stale by ${Math.round(ageMs / 1000)}s (threshold: ${staleThresholdMs / 1000}s). The synthetic-check job may have stopped running.`,
        bucketKey: bucket15min(ctx.now),
        metadata: {
          checkId: 'heartbeat-self',
          isSelfCheck: true,
          lastHeartbeatAt: prior.toISOString(),
          ageMs,
          staleThresholdMs,
        },
      };
    }

    return { fired: false };
  },
};
