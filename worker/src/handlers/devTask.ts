// ---------------------------------------------------------------------------
// pg-boss subscription for iee-dev-task. Spec §7.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { handleIEEJob } from './runHandler.js';
import { buildDevExecutor } from '../dev/executor.js';

const QUEUE = 'iee-dev-task';

export async function registerDevHandler(boss: PgBoss, workerInstanceId: string): Promise<void> {
  await boss.work(
    QUEUE,
    { teamSize: env.IEE_DEV_CONCURRENCY, teamConcurrency: 1 },
    async (job) => {
      await handleIEEJob({
        job,
        workerInstanceId,
        buildExecutor: async (run, payload) => {
          if (payload.task.type !== 'dev') {
            throw new Error(`dev handler received non-dev task: ${payload.task.type}`);
          }
          return buildDevExecutor({
            ieeRunId: run.id,
            organisationId: run.organisationId,
            initialCommands: payload.task.commands,
          });
        },
      });
    },
  );
}
