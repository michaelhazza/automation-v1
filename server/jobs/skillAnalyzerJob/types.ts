import type { skillAnalyzerResults } from '../../db/schema/index.js';
import type { ParsedSkill } from '../../services/skillParserServicePure.js';
import type {
  LibrarySkillSummary,
  ValidationThresholds,
} from '../../services/skillAnalyzerServicePure.js';

// ---------------------------------------------------------------------------
// Local types — shared across all stage modules
// ---------------------------------------------------------------------------

export type ExactDuplicateResult = {
  candidateIndex: number;
  matchedLib: LibrarySkillSummary;
};

export type BestMatch = {
  candidateIndex: number;
  libraryId: string | null;
  librarySlug: string | null;
  libraryName: string | null;
  similarity: number;
  band: 'likely_duplicate' | 'ambiguous' | 'distinct';
};

export type ClassifiedResult = {
  candidateIndex: number;
  candidate: ParsedSkill;
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  similarityScore: number | null;
  classificationReasoning: string | null;
  libraryId: string | null;
  librarySlug: string | null;
  libraryName: string | null;
  diffSummary: object | null;
  proposedMerge: object | null;
  classificationFailed: boolean;
  classificationFailureReason: 'rate_limit' | 'parse_error' | 'timed_out' | 'unknown' | null;
};

// ---------------------------------------------------------------------------
// JobContext — the threaded state object passed through every stage function
// ---------------------------------------------------------------------------

export interface JobContext {
  /** Parsed candidate skills for this run (capped at 500). */
  candidates: ParsedSkill[];

  /** Library skills keyed by skill id (null-id skills are excluded). */
  libraryById: Map<string, LibrarySkillSummary>;

  /** Library skills keyed by lowercased name for slug/name fallback lookup. */
  libraryByName: Map<string, LibrarySkillSummary>;

  /** Embedding vectors keyed by content hash (candidate + library). */
  embeddingByContent: Map<string, number[]>;

  /** Accumulated result rows for the batch write in Stage 8. */
  resultRows: (typeof skillAnalyzerResults.$inferInsert)[];

  /** Pipeline thresholds from the job's config_snapshot. */
  validationThresholds: ValidationThresholds;

  /** Classified results that landed on DISTINCT (for agent-propose + Stage 7b). */
  classifiedDistinct: ClassifiedResult[];

  /** Best-match records that are unambiguously distinct (band === 'distinct'). */
  distinctResults: BestMatch[];

  /** Exact-duplicate records from Stage 2. */
  exactDuplicates: ExactDuplicateResult[];

  /**
   * Returns the SHA-256 content hash for a candidate by its index.
   * Throws if the index was not hashed in Stage 2 (should be unreachable).
   */
  hashFromCandidateContent: (idx: number) => string;
}

// ---------------------------------------------------------------------------
// Sentinel — signals a stage-driven abort to the orchestrator
// ---------------------------------------------------------------------------

/** Thrown by a stage that writes a 'failed' status and wants to stop the pipeline. */
export class JobAlreadyFailedAbort extends Error {
  constructor() {
    super('JobAlreadyFailedAbort');
    this.name = 'JobAlreadyFailedAbort';
  }
}
