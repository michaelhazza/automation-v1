import type { skillAnalyzerResults, skillAnalyzerJobs } from '../../db/schema/index.js';
import type { ParsedSkill } from '../../services/skillParserServicePure.js';
import type {
  LibrarySkillSummary,
  ValidationThresholds,
} from '../../services/skillAnalyzerServicePure.js';
import type { AgentProposal } from '../../services/skillAnalyzerServicePure/agentRanking.js';
import type { SkillAnalyzerConfig } from '../../db/schema/skillAnalyzerConfig.js';

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

/** A candidate that survived exact-duplicate filtering in Stage 2. */
export type RemainingCandidate = {
  index: number;
  candidate: ParsedSkill;
  hash: string;
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
  /** The loaded job row — set in the orchestrator before Stage 1. */
  job: typeof skillAnalyzerJobs.$inferSelect;

  /** The config snapshot from the job row — set in the orchestrator before Stage 1. */
  configSnapshot: SkillAnalyzerConfig | null;

  /** Parsed candidate skills for this run (capped at 500). */
  candidates: ParsedSkill[];

  /** Library skills keyed by skill id (null-id skills are excluded). */
  libraryById: Map<string, LibrarySkillSummary>;

  /** Library skills keyed by lowercased name for slug/name fallback lookup. */
  libraryByName: Map<string, LibrarySkillSummary>;

  /** All library skills as a flat array (needed by Stage 3 embedding + Stage 5 classification). */
  librarySkills: LibrarySkillSummary[];

  /** Candidates that survived exact-duplicate filtering in Stage 2 (needed by Stages 3 + 4). */
  remainingCandidates: RemainingCandidate[];

  /** Embedding vectors keyed by content hash (candidate + library). */
  embeddingByContent: Map<string, number[]>;

  /** Accumulated result rows for the batch write in Stage 8. */
  resultRows: (typeof skillAnalyzerResults.$inferInsert)[];

  /** Pipeline thresholds from the job's config_snapshot. */
  validationThresholds: ValidationThresholds;

  /** Classified results that landed on DISTINCT (for agent-propose + Stage 7b). */
  classifiedDistinct: ClassifiedResult[];

  /** Best-match records from Stage 4 (all bands — used by Stage 4b and Stage 5). */
  bestMatches: BestMatch[];

  /** Best-match records that are unambiguously distinct (band === 'distinct'). */
  distinctResults: BestMatch[];

  /** Best-match records that require LLM classification (band !== 'distinct'). */
  llmQueue: BestMatch[];

  /** Per-candidate non-skill flags set in Stage 4b (used by Stage 5 inserts). */
  nonSkillFlagsByIndex: Map<number, { isDocumentationFile: boolean; isContextFile: boolean }>;

  /**
   * Candidate embeddings with their index, produced in Stage 4 for the cosine
   * comparison. Kept on the context for Stage 7 (agent-propose), which needs
   * the embedding for each DISTINCT result.
   */
  candidateEmbeddingsForCompare: Array<{ index: number; embedding: number[] }>;

  /** Exact-duplicate records from Stage 2. */
  exactDuplicates: ExactDuplicateResult[];

  /**
   * Returns the SHA-256 content hash for a candidate by its index.
   * Throws if the index was not hashed in Stage 2 (should be unreachable).
   */
  hashFromCandidateContent: (idx: number) => string;

  /**
   * Classified results from Stage 5 — populated by runStage5, consumed by
   * Stages 5b, 5c, 7, 7b, and 8.
   */
  classifiedResults: ClassifiedResult[];

  /**
   * Set of candidate indices that already had rows written by a prior worker
   * run (crash-resume). Populated by Stage 5, used by Stage 8 to avoid
   * duplicate inserts.
   */
  completedCandidateIndices: Set<number>;

  /**
   * Active system agents with their cached embeddings — populated by Stage 6,
   * consumed by Stage 7, Stage 7b, and Stage 8b.
   */
  rankableAgents: Array<{
    systemAgentId: string;
    slug: string;
    name: string;
    embedding: number[];
  }>;

  /**
   * Agent proposals keyed by candidateIndex — populated by Stage 7, mutated
   * by Stage 7b, read by Stage 8 and Stage 8b.
   */
  agentProposalsByCandidateIndex: Map<number, AgentProposal[]>;
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
