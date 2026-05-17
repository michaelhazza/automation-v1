import { db } from '../../../db/index.js';
import { skillAnalyzerJobs } from '../../../db/schema/index.js';
import * as skillAnalyzerConfigService from '../../skillAnalyzerConfigService.js';
import { skillParserService } from '../../skillParserService.js';
import { getPgBoss } from '../../../lib/pgBossInstance.js';
import { getJobConfig } from '../../../config/jobConfig.js';

/** Create a new analysis job and enqueue it for background processing.
 *  For paste/github, rawInput is the text/url string.
 *  For upload, rawInput is the array of Multer files. */
export async function createJob(params: {
  organisationId: string;
  userId: string;
  sourceType: 'paste' | 'upload' | 'github' | 'download';
  sourceMetadata: Record<string, unknown>;
  rawInput: string | Express.Multer.File[];
}): Promise<{ jobId: string }> {
  const { organisationId, userId, sourceType, sourceMetadata, rawInput } = params;

  // For paste source, parse immediately and store candidates on the job row.
  // For upload/github, the job handler will fetch/parse during processing.
  let parsedCandidates: unknown = null;

  if (sourceType === 'paste' && typeof rawInput === 'string') {
    const candidates = skillParserService.parseFromPaste(rawInput);
    parsedCandidates = candidates;
  } else if (sourceType === 'upload' && Array.isArray(rawInput)) {
    // Parse synchronously at job creation — files are already in temp dir
    const candidates = await skillParserService.parseUploadedFiles(rawInput);
    parsedCandidates = candidates;
  }
  // For github and download, candidates are fetched during job processing

  // v2 §11.11.4: capture the full config row at job start so mid-job config
  // edits never apply to an in-flight run. Downstream stages (merge validation,
  // approval gate, Execute) read from `jobs.config_snapshot`, not the live
  // table.
  const configSnapshot = await skillAnalyzerConfigService.snapshotForJob();

  const rows = await db
    .insert(skillAnalyzerJobs)
    .values({
      organisationId,
      createdBy: userId,
      sourceType,
      sourceMetadata,
      parsedCandidates,
      status: 'pending',
      progressPct: 0,
      configSnapshot,
      configVersionUsed: configSnapshot.configVersion,
    })
    .returning({ id: skillAnalyzerJobs.id });

  const jobId = rows[0].id;

  // Enqueue pg-boss job. Passing getJobConfig so the queue actually
  // respects the retry/expire settings declared in jobConfig.ts; without
  // this, pg-boss defaults applied (notably a 15-min expireIn) which
  // killed otherwise-healthy long runs mid-Stage-5. singletonKey stays
  // undefined — one-shot enqueue per jobId.
  const boss = await getPgBoss();
  await boss.send('skill-analyzer', { jobId, organisationId }, {
    ...getJobConfig('skill-analyzer'),
    singletonKey: undefined,
  });

  return { jobId };
}
