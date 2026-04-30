/**
 * Wraps processSkillAnalyzerJob with TERMINAL-failure incident emission.
 * Re-throws the original error so pg-boss retry semantics are preserved.
 *
 * Extracted from the inline try/catch in server/index.ts so that tests can
 * invoke this directly to verify the emission contract without a live pg-boss.
 *
 * Terminal-only contract: emission only fires when retryCount >= retryLimit
 * (i.e. this throw IS the final attempt failing — no more retries are
 * scheduled). Earlier-attempt failures rethrow without emitting so that
 * transient errors that succeed on retry don't create high-severity
 * false-positive incidents. The fingerprint `skill_analyzer:terminal_failure`
 * names this contract explicitly.
 */

import { recordIncident } from '../services/incidentIngestor.js';
import { processSkillAnalyzerJob } from './skillAnalyzerJob.js';
import { getJobConfig } from '../config/jobConfig.js';

export interface SkillAnalyzerJobDependencies {
  processFn?: (jobId: string) => Promise<void>;
}

/**
 * @param jobId - The skill-analyzer job ID payload.
 * @param retryCount - pg-boss `job.retrycount` (0 on first attempt).
 * @param deps - Optional dependency injection seam for tests.
 */
export async function runSkillAnalyzerJobWithIncidentEmission(
  jobId: string,
  retryCount: number = 0,
  deps: SkillAnalyzerJobDependencies = {},
): Promise<void> {
  const processFn = deps.processFn ?? processSkillAnalyzerJob;
  try {
    await processFn(jobId);
  } catch (err) {
    const retryLimit = getJobConfig('skill-analyzer').retryLimit ?? 0;
    const isTerminalAttempt = retryCount >= retryLimit;
    if (isTerminalAttempt) {
      await recordIncident({
        source: 'job',
        severity: 'high',
        summary: `Skill analyzer terminal failure for job ${jobId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        errorCode: 'skill_analyzer_failed',
        stack: err instanceof Error ? err.stack : undefined,
        fingerprintOverride: 'skill_analyzer:terminal_failure',
        errorDetail: { jobId, retryCount },
      });
    }
    throw err; // preserve pg-boss retry semantics
  }
}
