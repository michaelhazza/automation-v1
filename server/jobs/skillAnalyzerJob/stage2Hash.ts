import { updateJobProgress } from '../../services/skillAnalyzerService.js';
import { skillParserServicePure } from '../../services/skillParserServicePure.js';
import type { ParsedSkill } from '../../services/skillParserServicePure.js';
import type { LibrarySkillSummary } from '../../services/skillAnalyzerServicePure.js';
import { systemSkillService } from '../../services/systemSkillService.js';
import { type JobContext, type ExactDuplicateResult, type RemainingCandidate } from './types.js';

// -------------------------------------------------------------------------
// Stage 2: Hash (10% → 20%)
// -------------------------------------------------------------------------
export async function runStage2(ctx: JobContext, jobId: string): Promise<JobContext> {
  await updateJobProgress(jobId, {
    status: 'hashing',
    progressPct: 10,
    progressMessage: 'Computing content hashes...',
  });

  // Load all library skills from system_skills. listSkills() returns every
  // row regardless of isActive / visibility so retired skills still
  // participate in dedup. See spec §10 Phase 0 listSkills() contract.
  const systemSkillRows = await systemSkillService.listSkills();

  const librarySkills: LibrarySkillSummary[] = systemSkillRows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    definition: s.definition as object | null,
    instructions: s.instructions,
    // isSystem is now always true (the analyzer is system-only post Phase 1).
    // Field kept for backwards compatibility with the LibrarySkillSummary
    // type used by skillAnalyzerServicePure helpers.
    isSystem: true,
  }));

  const { candidates } = ctx;

  // Compute candidate hashes
  const candidateHashes = candidates.map((c) =>
    skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(c))
  );

  // Compute library hashes
  const libraryHashMap = new Map<string, LibrarySkillSummary>();
  for (const lib of librarySkills) {
    const libAsCandidate: ParsedSkill = {
      name: lib.name,
      slug: lib.slug,
      description: lib.description,
      definition: lib.definition,
      instructions: lib.instructions,
      rawSource: '',
    };
    const hash = skillParserServicePure.contentHash(skillParserServicePure.normalizeForHash(libAsCandidate));
    libraryHashMap.set(hash, lib);
  }

  // Find exact duplicates
  const exactDuplicates: ExactDuplicateResult[] = [];
  const remainingCandidates: RemainingCandidate[] = [];

  // Also deduplicate candidates within the batch (same hash → only first one proceeds)
  const seenCandidateHashes = new Map<string, number>();

  for (let i = 0; i < candidates.length; i++) {
    const hash = candidateHashes[i];
    const candidate = candidates[i];
    const libMatch = libraryHashMap.get(hash);

    if (libMatch) {
      exactDuplicates.push({ candidateIndex: i, matchedLib: libMatch });
    } else if (seenCandidateHashes.has(hash)) {
      // Intra-batch duplicate — classify same as first occurrence (resolved later)
      // For now, mark as exact duplicate pointing to the same candidate
      exactDuplicates.push({ candidateIndex: i, matchedLib: {
        id: null,
        slug: candidate.slug,
        name: `${candidate.name} (duplicate in import)`,
        description: candidate.description,
        definition: candidate.definition,
        instructions: candidate.instructions,
          isSystem: false,
      }});
    } else {
      seenCandidateHashes.set(hash, i);
      remainingCandidates.push({ index: i, candidate, hash });
    }
  }

  await updateJobProgress(jobId, {
    progressPct: 20,
    progressMessage: `${exactDuplicates.length} exact duplicate${exactDuplicates.length === 1 ? '' : 's'} found - embedding ${remainingCandidates.length} remaining...`,
    exactDuplicateCount: exactDuplicates.length,
  });

  // Helper: look up the SHA-256 hash for a given candidate index. Defined
  // here (after Stage 2) so it is available in Stage 5's incremental inserts
  // as well as Stage 8's batch writes. The hash is computed in Stage 2 and
  // persisted on each result row for the Phase 4 manual-add PATCH path.
  const hashByIndex = new Map<number, string>();
  for (let i = 0; i < candidates.length; i++) {
    hashByIndex.set(i, candidateHashes[i]);
  }
  const hashFromCandidateContent = (idx: number): string => {
    const h = hashByIndex.get(idx);
    if (h === undefined) {
      // Should be unreachable — every candidate is hashed in Stage 2.
      throw new Error(`candidateContentHash missing for candidateIndex=${idx}`);
    }
    return h;
  };

  const libraryById = new Map(
    librarySkills
      .filter((l): l is LibrarySkillSummary & { id: string } => l.id !== null)
      .map((l) => [l.id, l])
  );
  const libraryByName = new Map(
    librarySkills.map((l) => [l.name.toLowerCase(), l])
  );

  return {
    ...ctx,
    exactDuplicates,
    remainingCandidates,
    librarySkills,
    libraryById,
    libraryByName,
    hashFromCandidateContent,
  };
}
