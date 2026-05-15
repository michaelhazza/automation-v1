import {
  enqueueExecution as enqueueExecutionFn,
  sendJob as sendJobFn,
  cleanupExpiredExecutionFiles as cleanupExpiredExecutionFilesFn,
  cleanupExpiredComputeReservations as cleanupExpiredComputeReservationsFn,
  enqueueWorkflowResume as enqueueWorkflowResumeFn,
  enqueueRegressionCapture as enqueueRegressionCaptureFn,
} from './queueService/enqueueHelpers.js';
import { runStartMaintenanceJobs } from './queueService/maintenanceJobs/start.js';

// ---------------------------------------------------------------------------
// Exported queue service
// ---------------------------------------------------------------------------
export const queueService = {
  enqueueExecution: enqueueExecutionFn,
  sendJob: sendJobFn,
  cleanupExpiredExecutionFiles: cleanupExpiredExecutionFilesFn,
  cleanupExpiredComputeReservations: cleanupExpiredComputeReservationsFn,
  enqueueWorkflowResume: enqueueWorkflowResumeFn,
  enqueueRegressionCapture: enqueueRegressionCaptureFn,

  /**
   * Start periodic maintenance jobs.
   * Uses pg-boss scheduled workers when available, otherwise falls back to
   * in-process setInterval guarded by pg advisory locks to prevent duplicate
   * runs across horizontally-scaled instances. Call once at application startup.
   */
  startMaintenanceJobs: () => runStartMaintenanceJobs(queueService),
};
