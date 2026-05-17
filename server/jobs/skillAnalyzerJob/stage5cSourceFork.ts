import {
  appendBatchCollisionWarnings,
  applyBatchDeductionAndWarningAtomic,
} from '../../services/skillAnalyzerService.js';
import {
  detectContentOverlap,
  type MergeWarning,
  type ProposedMerge,
} from '../../services/skillAnalyzerServicePure.js';
import { logger } from '../../lib/logger.js';
import { type JobContext } from './types.js';

// Pure helper extracted Wave 5 Session K (PR #327 F1 follow-up): filter the
// fork group's display-name array by index identity. Exported so the unit
// test exercises the real callsite instead of a copy — see
// `__tests__/stage5cSourceFork.filterByIndex.test.ts`.
export function othersForIndex(names: readonly string[], i: number): string[] {
  return names.filter((_, j) => j !== i);
}

// -------------------------------------------------------------------------
// Stage 5c: Source fork detection (v4 Fix 3) + content overlap (v4 Fix 8)
// -------------------------------------------------------------------------
export async function runStage5c(ctx: JobContext, jobId: string): Promise<JobContext> {
  const { classifiedResults } = ctx;

  // Fix 3: group PARTIAL_OVERLAP / IMPROVEMENT candidates by matched library
  // skill ID — multiple candidates mapping to the same library skill produce
  // overlapping merged tools with no disambiguation.
  const byLibraryId = new Map<string, typeof classifiedResults>();
  for (const r of classifiedResults) {
    if (!r.libraryId) continue;
    if (r.classification !== 'PARTIAL_OVERLAP' && r.classification !== 'IMPROVEMENT') continue;
    const group = byLibraryId.get(r.libraryId) ?? [];
    group.push(r);
    byLibraryId.set(r.libraryId, group);
  }
  const forkEntries: Array<{ slug: string; deduction: number; warning: MergeWarning }> = [];
  for (const group of byLibraryId.values()) {
    if (group.length < 2) continue;
    const names = group.map(r => r.candidate.name);
    for (let i = 0; i < group.length; i++) {
      const r = group[i]!;
      // F1 carry-forward fix (PR #327, audit 2026-05-15): filter by index
      // identity rather than name. Two candidates with the same display name
      // collapsed to a single "other" via `filter(n => n !== r.candidate.name)`,
      // which underreported the fork count when imported/templated skills
      // share names. Helper extracted in Wave 5 Session K so the test pins
      // the real implementation rather than a re-implementation.
      const others = othersForIndex(names, i);
      forkEntries.push({
        slug: r.candidate.slug,
        // v6 Fix 4 follow-up — coefficient mirrors adjustClassifierConfidence.
        deduction: 0.05,
        warning: {
          code: 'SOURCE_FORK',
          severity: 'warning',
          message: `Source fork detected: this skill and ${others.length} other(s) (${others.join(', ')}) all merged from the same library skill. Approving multiple forks creates overlapping tools.`,
          detail: JSON.stringify({ librarySkillId: r.libraryId, forkCandidates: names }),
        },
      });
    }
  }
  if (forkEntries.length > 0) {
    // v6 Fix 4 follow-up (Codex iter-2 review): single atomic UPDATE per
    // slug sets confidence AND appends the SOURCE_FORK warning together.
    // Separating the two calls left a crash window where the deduction
    // committed without the marker, causing the same slug to be deducted
    // again on resume. The atomic helper closes that window AND keeps the
    // marker-based idempotency guard so re-runs over already-marked rows
    // are no-ops.
    await applyBatchDeductionAndWarningAtomic(jobId, forkEntries, 'SOURCE_FORK');
    logger.info('skill_analyzer_source_forks_detected', {
      jobId, forkCount: forkEntries.length,
    });
  }

  // Fix 8: content overlap — flag pairs of in-batch merges that share H3+
  // section headings with > 70% content similarity.
  const mergesForOverlap = classifiedResults
    .filter(r => r.proposedMerge && (r.classification === 'PARTIAL_OVERLAP' || r.classification === 'IMPROVEMENT'))
    .map(r => ({
      slug: r.candidate.slug,
      instructions: (r.proposedMerge as ProposedMerge | null)?.instructions ?? null,
    }));

  if (mergesForOverlap.length >= 2) {
    const overlaps = detectContentOverlap(mergesForOverlap, 0.60);
    if (overlaps.length > 0) {
      const overlapWarningsBySlug = new Map<string, MergeWarning[]>();
      for (const o of overlaps) {
        const msg = `Content overlap with "${o.candidateSlugB}": section "${o.overlappingHeading}" is ~${o.similarityPct}% similar. Ensure each skill has a distinct scope.`;
        const existing = overlapWarningsBySlug.get(o.candidateSlugA) ?? [];
        existing.push({ code: 'CONTENT_OVERLAP', severity: 'warning', message: msg, detail: JSON.stringify(o) });
        overlapWarningsBySlug.set(o.candidateSlugA, existing);

        const msgB = `Content overlap with "${o.candidateSlugA}": section "${o.overlappingHeading}" is ~${o.similarityPct}% similar.`;
        const existingB = overlapWarningsBySlug.get(o.candidateSlugB) ?? [];
        existingB.push({ code: 'CONTENT_OVERLAP', severity: 'warning', message: msgB, detail: JSON.stringify(o) });
        overlapWarningsBySlug.set(o.candidateSlugB, existingB);
      }
      await appendBatchCollisionWarnings(jobId, overlapWarningsBySlug);
      logger.info('skill_analyzer_content_overlaps_detected', {
        jobId, overlapCount: overlaps.length,
      });
    }
  }

  return ctx;
}
