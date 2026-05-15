import { getPgBoss } from '../../../lib/pgBossInstance.js';
import { setSystemWorkerContext } from '../../connectionTokenService.js';
import { getQueueBackend } from '../backend.js';
import { startIntervalFallback } from './intervalFallback.js';
import { registerAllPgBossWorkers } from './pgBossRegistrations.js';

export async function runStartMaintenanceJobs(
  queueService: {
    cleanupExpiredExecutionFiles(): Promise<unknown>;
    cleanupExpiredComputeReservations(): Promise<unknown>;
  },
): Promise<void> {
  const backend = await getQueueBackend();

  if (backend.kind === 'pg-boss') {
    const boss = await getPgBoss();

    // Mark this process as a system worker so that refreshIfExpired allows
    // null-principal (org-less) flows from pg-boss workers.
    setSystemWorkerContext(true);

    await registerAllPgBossWorkers(boss, queueService, null);

    console.log(JSON.stringify({ event: 'maintenance:started', mode: 'pg-boss' }));
  } else {
    startIntervalFallback();
  }
}
