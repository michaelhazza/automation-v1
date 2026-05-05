// Shared types for the Cached Context Infrastructure.
// Spec: docs/cached-context-infrastructure-spec.md §4

// ---------------------------------------------------------------------------
// §4.1 — Resolved Execution Budget
// ---------------------------------------------------------------------------

export interface ResolvedExecutionBudget {
  /** Max input-side tokens (bundle prefix + variable input). */
  maxInputTokens: number;
  /** Max output-side tokens (response reservation). */
  maxOutputTokens: number;
  /** Hard per-call cost ceiling in USD (not cents). */
  maxTotalCostUsd: number;
  /** Per-document hard cap in tokens. */
  perDocumentMaxTokens: number;
  /** Reserved output tokens subtracted from maxInputTokens headroom. */
  reserveOutputTokens: number;
  /** Soft-warn threshold as a fraction of maxInputTokens (0 < x < 1). */
  softWarnRatio: number;
  /** Source inputs recorded for debugging / audit. */
  resolvedFrom: {
    taskConfigId: string | null;
    modelTierPolicyId: string;
    orgCeilingPolicyId: string | null;
  };
  /** Model family this budget was resolved against. */
  modelFamily: 'anthropic.claude-sonnet-4-6' | 'anthropic.claude-opus-4-7' | 'anthropic.claude-haiku-4-5';
  /** Declared model context window at resolution time. */
  modelContextWindow: number;
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
      kind: 'ok';
      /** Fully formed LLM payload ready to hand to llmRouter.routeCall. */
      routerPayload: {
        system: { stablePrefix: string; dynamicSuffix: string };
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        estimatedContextTokens: number;
      };
      /** Call-level assembled-prefix-hash identity (§4.4). */
      prefixHash: string;
      /** Hash of the variable input alone (not cached). */
      variableInputHash: string;
      /** Snapshot IDs referenced by this assembly. */
      bundleSnapshotIds: string[];
      /** Soft-warn signal carried forward for run-outcome classification. */
      softWarnTripped: boolean;
      /** Assembly-version constant that produced this payload. */
      assemblyVersion: number;
    }
  | {
      kind: 'budget_breach';
      /** Structured HITL block payload. */
      blockPayload: HitlBudgetBlockPayload;
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
