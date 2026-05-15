import {
  appendBatchCollisionWarnings,
} from '../../services/skillAnalyzerService.js';
import {
  detectSkillGraphCollision,
  type MergeWarning,
  type ProposedMerge,
} from '../../services/skillAnalyzerServicePure.js';
import { logger } from '../../lib/logger.js';
import { type JobContext } from './types.js';

// -------------------------------------------------------------------------
// Stage 5b: Cross-batch collision detection (v3 Fix 3)
// -------------------------------------------------------------------------
// After all per-skill merges are written, compare each in-batch merged skill
// against every other in-batch merged skill to catch intra-batch capability
// overlaps (e.g. cold-email and email-sequence both owning cold outreach).
// Library-level collisions were already detected per-skill in Stage 5;
// this pass only handles candidate-vs-candidate collisions.
export async function runStage5b(ctx: JobContext, jobId: string): Promise<JobContext> {
  const { classifiedResults } = ctx;

  const batchMergeResults = classifiedResults.filter(
    (r) =>
      r.proposedMerge &&
      (r.classification === 'PARTIAL_OVERLAP' || r.classification === 'IMPROVEMENT'),
  );

  if (batchMergeResults.length >= 2) {
    const batchCatalog = batchMergeResults.map((r) => {
      const pm = r.proposedMerge as ProposedMerge;
      return {
        id: null as string | null,
        slug: r.candidate.slug,
        name: pm.name,
        instructions: pm.instructions ?? null,
      };
    });

    const batchWarningsBySlug = new Map<string, MergeWarning[]>();

    for (const result of batchMergeResults) {
      const catalogExcludingSelf = batchCatalog.filter(
        (b) => b.slug !== result.candidate.slug,
      );
      if (catalogExcludingSelf.length === 0) continue;

      const batchCollisions = detectSkillGraphCollision({
        merged: result.proposedMerge as ProposedMerge,
        libraryCatalog: catalogExcludingSelf,
        excludedId: null,
      });

      if (batchCollisions.length === 0) continue;

      const newWarnings: MergeWarning[] = batchCollisions.map((c) => ({
        code: 'SKILL_GRAPH_COLLISION' as const,
        severity: 'warning' as const,
        message: `Merged skill overlaps ~${Math.round(c.overlapRatio * 100)}% with incoming batch skill "${c.collidingName}".`,
        detail: JSON.stringify({
          collidingSkillId: null,
          collidingSlug: c.collidingSlug,
          collidingName: c.collidingName,
          overlapRatio: c.overlapRatio,
          overlappingFragments: c.overlappingFragments,
          batchCollision: true,
        }),
      }));

      batchWarningsBySlug.set(result.candidate.slug, newWarnings);
      logger.info('skill_analyzer_batch_collision', {
        jobId,
        candidateSlug: result.candidate.slug,
        collidingSlugs: batchCollisions.map((c) => c.collidingSlug),
      });
    }

    if (batchWarningsBySlug.size > 0) {
      await appendBatchCollisionWarnings(jobId, batchWarningsBySlug);
    }
  }

  return ctx;
}
