// ---------------------------------------------------------------------------
// pg-boss subscription for iee-browser-task. Spec §6.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { handleIEEJob } from './runHandler.js';
import { buildBrowserExecutor } from '../browser/executor.js';

const QUEUE = 'iee-browser-task';

export async function registerBrowserHandler(boss: PgBoss, workerInstanceId: string): Promise<void> {
  await boss.work(
    QUEUE,
    { teamSize: env.IEE_BROWSER_CONCURRENCY, teamConcurrency: 1 },
    async (job) => {
      await handleIEEJob({
        job,
        workerInstanceId,
        buildExecutor: async (run, payload) => {
          if (payload.task.type !== 'browser') {
            throw new Error(`browser handler received non-browser task: ${payload.task.type}`);
          }
          return buildBrowserExecutor({
            ieeRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            sessionKey: payload.task.sessionKey,
            startUrl: payload.task.startUrl,
          });
        },
      });
    },
  );
}
