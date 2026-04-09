/**
 * trajectoryService.ts — impure trajectory service (DB reads).
 *
 * Sprint 4 P3.3: structural trajectory comparison. The impure service
 * loads actual trajectories from the `actions` table keyed by
 * `agentRunId`. Pure comparison/formatting logic lives in
 * `trajectoryServicePure.ts`.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions } from '../db/schema/index.js';
import type { TrajectoryEvent } from '../../shared/iee/trajectorySchema.js';
import type { ReferenceTrajectory, TrajectoryDiff } from '../../shared/iee/trajectorySchema.js';
import { compare, formatDiff } from './trajectoryServicePure.js';

export const trajectoryService = {
  /**
   * Reads the actions table for a run and returns the typed trajectory
   * ordered by creation time.
   */
  async loadTrajectory(runId: string): Promise<TrajectoryEvent[]> {
    const rows = await db
      .select({
        actionType: actions.actionType,
        payloadJson: actions.payloadJson,
        createdAt: actions.createdAt,
      })
      .from(actions)
      .where(eq(actions.agentRunId, runId))
      .orderBy(actions.createdAt);

    return rows.map((row) => ({
      actionType: row.actionType,
      args: (row.payloadJson as Record<string, unknown>) ?? undefined,
      timestamp: row.createdAt?.toISOString(),
    }));
  },

  /**
   * Compares actual trajectory against expected per the match mode.
   * Delegates to the pure helper.
   */
  compare(actual: TrajectoryEvent[], expected: ReferenceTrajectory): TrajectoryDiff {
    return compare(actual, expected);
  },

  /**
   * Pretty-print a diff for CI output.
   * Delegates to the pure helper.
   */
  formatDiff(diff: TrajectoryDiff): string {
    return formatDiff(diff);
  },
};
