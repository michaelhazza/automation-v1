import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import { skillAnalyzerServicePure } from '../../services/skillAnalyzerServicePure.js';
import { type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 4b: Non-skill detection — heuristic pre-classification
// -------------------------------------------------------------------------
// Flag any parsed candidates that appear to be documentation files (e.g.
// a repo README) or context/foundation documents (e.g.
// product-marketing-context) rather than executable tool skills.
// These flags travel through the pipeline and are persisted on the result
// row so the Review UI can show appropriate badges / warnings.
export async function runStage4b(ctx: JobContext, jobId: string): Promise<JobContext> {
  const { bestMatches, candidates } = ctx;

  const nonSkillFlagsByIndex = new Map<number, { isDocumentationFile: boolean; isContextFile: boolean }>();
  for (const m of bestMatches) {
    const candidate = candidates[m.candidateIndex];
    if (candidate) {
      nonSkillFlagsByIndex.set(
        m.candidateIndex,
        skillAnalyzerServicePure.detectNonSkillFile(candidate),
      );
    }
  }

  const distinctResults = bestMatches.filter((m) => m.band === 'distinct');
  const llmQueue = bestMatches.filter((m) => m.band !== 'distinct');

  await updateJobProgress(jobId, {
    progressPct: 60,
    progressMessage: `${distinctResults.length} distinct, ${llmQueue.length} need classification...`,
    comparisonCount: bestMatches.length,
  });

  return { ...ctx, nonSkillFlagsByIndex, distinctResults, llmQueue };
}
