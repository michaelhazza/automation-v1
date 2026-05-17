import { skillParserService } from '../../services/skillParserService.js';
import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import type { ParsedSkill } from '../../services/skillParserServicePure.js';
import type { skillAnalyzerJobs } from '../../db/schema/index.js';
import { JobAlreadyFailedAbort, type JobContext } from './types.js';

type JobRow = typeof skillAnalyzerJobs.$inferSelect;

// -------------------------------------------------------------------------
// Stage 1: Parse (0% → 10%)
// -------------------------------------------------------------------------
export async function runStage1(
  ctx: JobContext,
  jobId: string,
  job: JobRow,
): Promise<JobContext> {
  await updateJobProgress(jobId, {
    status: 'parsing',
    progressPct: 0,
    progressMessage: 'Parsing skill definitions...',
  });

  let candidates: ParsedSkill[];

  try {
    // Two distinct signals that collapse into "use stored / re-parse / fail":
    //   • Array.isArray(parsedCandidates) === true  → authoritative list from
    //     a prior run (possibly empty, e.g. valid paste that yielded zero
    //     skills). Use it as-is; the "no valid skill definitions" check
    //     below handles the empty case with a user-friendly error.
    //   • Array.isArray(parsedCandidates) === false → null / undefined / a
    //     non-array JSONB value. For paste/upload this signals a corrupt
    //     row (the create path always writes an array before enqueueing);
    //     for github/download it's the expected first-run state, so we
    //     re-parse from the remote URL.
    // Collapsing "empty array" and "not-an-array" into the same check was
    // a real regression — it misreported a zero-skill paste as DB corruption.
    if (Array.isArray(job.parsedCandidates)) {
      candidates = job.parsedCandidates as ParsedSkill[];
    } else if (job.sourceType === 'paste' || job.sourceType === 'upload') {
      await updateJobProgress(jobId, {
        status: 'failed',
        errorMessage: 'parsedCandidates is missing on this job row — re-submit the analysis.',
      });
      throw new JobAlreadyFailedAbort();
    } else if (job.sourceType === 'github') {
      const githubMeta = job.sourceMetadata as { url: string };
      candidates = await skillParserService.parseFromGitHub(githubMeta.url);
    } else if (job.sourceType === 'download') {
      const downloadMeta = job.sourceMetadata as { url: string };
      candidates = await skillParserService.parseFromDownloadUrl(downloadMeta.url);
    } else {
      candidates = [];
    }
  } catch (err) {
    if (err instanceof JobAlreadyFailedAbort) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobProgress(jobId, {
      status: 'failed',
      errorMessage: `Failed to parse skills: ${msg}`,
    });
    throw new JobAlreadyFailedAbort();
  }

  if (candidates.length === 0) {
    await updateJobProgress(jobId, {
      status: 'failed',
      errorMessage: 'No valid skill definitions found in the provided input.',
    });
    throw new JobAlreadyFailedAbort();
  }

  // Enforce 500-candidate limit
  if (candidates.length > 500) {
    candidates = candidates.slice(0, 500);
  }

  await updateJobProgress(jobId, {
    progressPct: 10,
    progressMessage: `Found ${candidates.length} skill${candidates.length === 1 ? '' : 's'} - checking for exact duplicates...`,
    candidateCount: candidates.length,
    // Store (possibly freshly parsed) candidates for display/replay
    parsedCandidates: candidates,
  });

  return { ...ctx, candidates };
}
