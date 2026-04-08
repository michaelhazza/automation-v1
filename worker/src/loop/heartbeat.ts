// ---------------------------------------------------------------------------
// Heartbeat. Spec §13.3 + §13.6.1.b.
//
// Driven by setInterval(...).unref() so it fires even while a step is awaiting
// a long-running async call (e.g. page.goto). Write coalescing guard ensures
// at most one DB write per interval.
// ---------------------------------------------------------------------------

import { eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { ieeRuns } from '../../../server/db/schema/ieeRuns.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

export interface HeartbeatHandle {
  stop: () => void;
}

export function startHeartbeat(ieeRunId: string): HeartbeatHandle {
  let lastWritten = 0;
  let stopped = false;

  const interval = setInterval(async () => {
    if (stopped) return;
    const now = Date.now();
    if (now - lastWritten < env.IEE_HEARTBEAT_INTERVAL_MS - 500) return;
    lastWritten = now;
    try {
      await db
        .update(ieeRuns)
        .set({ lastHeartbeatAt: new Date() })
        .where(eq(ieeRuns.id, ieeRunId));
    } catch (err) {
      // Don't take down the loop because of a heartbeat write failure.
      logger.warn('iee.worker.heartbeat_write_failed', {
        ieeRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, env.IEE_HEARTBEAT_INTERVAL_MS);

  // Allow the process to exit if this is the only thing keeping it alive
  interval.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}
