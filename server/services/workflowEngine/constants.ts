import { getPgBoss } from '../../lib/pgBossInstance.js';
import { getJobConfig } from '../../config/jobConfig.js';

export const TICK_QUEUE = 'workflow-run-tick';
export const WATCHDOG_QUEUE = 'workflow-watchdog';
export const AGENT_STEP_QUEUE = 'workflow-agent-step';

// Engine constants (spec §1.5, §3.6, §5.2)
export const MAX_PARALLEL_STEPS_DEFAULT = 8;
export const MAX_CONTEXT_BYTES_SOFT = 512 * 1024;
export const MAX_CONTEXT_BYTES_HARD = 1024 * 1024;
export const STEP_RUN_TIMEOUT_DEFAULT_MS = 30 * 60 * 1000; // 30 min
export const WATCHDOG_INTERVAL_SECONDS = 60;

/**
 * Enqueues a tick for the given run via pg-boss with singletonKey + useSingletonQueue.
 * Multiple step completions firing simultaneously collapse into a single tick.
 * Spec §5.6 layer 1 (queue deduplication).
 */
export async function enqueueTick(runId: string): Promise<void> {
  const pgboss = (await getPgBoss()) as unknown as {
    send: (
      name: string,
      data: object,
      options: Record<string, unknown>,
    ) => Promise<string | null>;
  };
  await pgboss.send(
    TICK_QUEUE,
    { runId },
    {
      ...getJobConfig('workflow-run-tick'),
      singletonKey: runId,
      useSingletonQueue: true,
    },
  );
}
