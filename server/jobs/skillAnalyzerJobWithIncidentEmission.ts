/**
 * Wraps processSkillAnalyzerJob with terminal-failure incident emission.
 * Re-throws the original error so pg-boss retry semantics are preserved.
 *
 * Extracted from the inline try/catch in server/index.ts so that tests can
 * invoke this directly to verify the emission contract without a live pg-boss.
 */

import { recordIncident } from '../services/incidentIngestor.js';
import { processSkillAnalyzerJob } from './skillAnalyzerJob.js';

export interface SkillAnalyzerJobDependencies {
  processFn?: (jobId: string) => Promise<void>;
}

export async function runSkillAnalyzerJobWithIncidentEmission(
  jobId: string,
  deps: SkillAnalyzerJobDependencies = {},
): Promise<void> {
  const processFn = deps.processFn ?? processSkillAnalyzerJob;
  try {
    await processFn(jobId);
  } catch (err) {
    recordIncident({
      source: 'job',
      severity: 'high',
      summary: `Skill analyzer terminal failure for job ${jobId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      errorCode: 'skill_analyzer_failed',
      stack: err instanceof Error ? err.stack : undefined,
      fingerprintOverride: 'skill_analyzer:terminal_failure',
      errorDetail: { jobId },
    });
    throw err; // preserve pg-boss retry semantics
  }
}
