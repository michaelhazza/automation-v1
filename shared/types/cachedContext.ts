// Shared types for the Cached Context Infrastructure.
// Spec: docs/cached-context-infrastructure-spec.md §4

// ---------------------------------------------------------------------------
// §4.1 — Resolved Execution Budget
// ---------------------------------------------------------------------------

export interface ResolvedExecutionBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  reserveOutputTokens: number;
  perDocumentMaxTokens: number;
  maxTotalCostUsdCents: number;
  softWarnThreshold: number; // = maxInputTokens * softWarnRatio
  modelFamily: string;
}

// ---------------------------------------------------------------------------
// §4.4 — Prefix Hash Components
// ---------------------------------------------------------------------------

export interface PrefixHashComponentIncludedFlag {
  documentId: string;
  included: true;
  reason: 'attached_and_active';
}

export interface PrefixHashComponents {
  orderedDocumentIds: string[];
  documentSerializedBytesHashes: string[];
  includedFlags: PrefixHashComponentIncludedFlag[];
  modelFamily: string;
  assemblyVersion: number;
}

// ---------------------------------------------------------------------------
// §4.5 — HITL Budget Block Payload
// ---------------------------------------------------------------------------

export interface HitlBudgetBlockPayload {
  kind: 'cached_context_budget_breach';
  thresholdBreached: 'max_input_tokens' | 'per_document_cap';
  budgetUsed: {
    inputTokens: number;
    worstPerDocumentTokens: number;
  };
  budgetAllowed: {
    maxInputTokens: number;
    perDocumentCap: number;
  };
  topContributors: Array<{
    documentId: string;
    documentName: string;
    tokens: number;
    percentOfBudget: number;
  }>;
  suggestedActions: Array<'trim_bundle' | 'upgrade_model' | 'split_task' | 'abort'>;
  resolvedBudget: ResolvedExecutionBudget;
  intendedPrefixHashComponents: PrefixHashComponents;
}

// ---------------------------------------------------------------------------
// §4.6 — Run Outcome Classification
// ---------------------------------------------------------------------------

export type RunOutcome = 'completed' | 'degraded' | 'failed';

/** Internal-only diagnostic tag. NEVER surfaced to users. */
export type DegradedReason = 'soft_warn' | 'token_drift' | 'cache_miss';

// ---------------------------------------------------------------------------
// §4.2 — Context Assembly Result
// ---------------------------------------------------------------------------

export type ContextAssemblyResult =
  | {
      kind: 'ready';
      assembledPrefix: string;
      assembledPrefixHash: string;
      prefixHashComponents: PrefixHashComponents;
      estimatedPrefixTokens: number;
      softWarnTripped: boolean;
    }
  | {
      kind: 'budget_breach';
      thresholdBreached: 'max_input_tokens' | 'per_document_cap';
      budgetUsed: { inputTokens: number; worstPerDocumentTokens: number };
      budgetAllowed: { maxInputTokens: number; perDocumentCap: number };
      topContributors: HitlBudgetBlockPayload['topContributors'];
    };

// ---------------------------------------------------------------------------
// §4.3 — Bundle Resolution Snapshot (runtime type; persisted form in DB schema)
// ---------------------------------------------------------------------------

export interface BundleResolutionSnapshotEntry {
  documentId: string;
  documentVersion: number;
  serializedBytesHash: string;
  tokenCount: number;
}
