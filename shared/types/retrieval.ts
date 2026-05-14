// Shared wire types for the auto-knowledge-retrieval ranker.
// Spec: tasks/builds/auto-knowledge-retrieval/spec.md §6.1–§6.3, §11.4

export type RetrievalMode = 'auto' | 'always_available' | 'reference_only';

export type RetrievalRejectionReason =
  | 'budget_exhausted'
  | 'lower_score_in_tie'
  | 'mode_excluded'
  | 'authorization_filtered'
  | 'below_threshold';

// Closed enum — spec §1.5 #13, §13.5 (D-phase additions)
export type RetrievalDegradedReason =
  | 'pool_query_failed'
  | 'embedding_provider_failed'
  | 'rank_failed'
  | 'retrieval.embedding_failed'
  | 'retrieval.empty_after_semantic'
  | 'unknown';

export interface RetrievalCandidate {
  id: string;              // memory block id or document chunk id
  documentId?: string;     // set for document chunks; undefined for memory blocks
  organisationId: string;
  kind: 'memory_block' | 'document_chunk';
  mode: RetrievalMode;
  scopeTier: number;       // 5=task_instance, 4=scheduled_task, 3=agent, 2=subaccount, 1=organisation
  finalScore: number;      // cosine similarity score
  updatedAt: Date;
  tokenCount: number;
  content: string;
}

export interface RetrievalRejected {
  aboveThreshold: {
    total: number;
    retained: number;       // number actually kept in the array (truncated to MAX_REJECTED_ABOVE_THRESHOLD)
    items: Array<{ id: string; reason: RetrievalRejectionReason; finalScore: number }>;
  };
  belowThreshold: {
    count: number;
    sample: Array<{ id: string; finalScore: number }>; // top-N by score
  };
  modeExcluded: {
    total: number;
    retained: number;
    items: Array<{ id: string; mode: RetrievalMode }>;
  };
}

export interface RetrievalResultLoaded {
  id: string;
  documentId?: string;
  kind: 'memory_block' | 'document_chunk';
  mode: RetrievalMode;
  scopeTier: number;
  finalScore: number;
  tokenCount: number;
  content: string;
}

export interface RetrievalResult {
  loaded: RetrievalResultLoaded[];
  alwaysAvailable: RetrievalResultLoaded[];   // subset of loaded where mode === 'always_available'
  referenceOnlyManifest: Array<{ id: string; documentId?: string }>; // mode === 'reference_only' (not loaded but named)
  rejected: RetrievalRejected;
  totalTokensLoaded: number;
  degraded: boolean;
  degradedReason: RetrievalDegradedReason | null;
}
