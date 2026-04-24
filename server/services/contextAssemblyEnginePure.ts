import { createHash } from 'node:crypto';
import type { PrefixHashComponents, HitlBudgetBlockPayload, ResolvedExecutionBudget } from '../../shared/types/cachedContext.js';

// ---------------------------------------------------------------------------
// contextAssemblyEnginePure — deterministic serialization, hashing, validation
// (§6.4). All functions are pure — no I/O, no DB calls.
//
// ASSEMBLY_VERSION bump required whenever: sort order, separator tokens,
// delimiter shape, metadata ordering, breakpoint placement, or serialization
// format changes. A golden-fixture test in __tests__/ asserts ASSEMBLY_VERSION
// against a known hash so a format change without a version bump fails CI.
// ---------------------------------------------------------------------------

/** Current assembly version. Bump manually when format changes. */
export const ASSEMBLY_VERSION = 1 as const;

// Delimiter tokens — shared with referenceDocumentServicePure.ts.
// Documents containing ---DOC_END--- are rejected at upload time (§6.1).
const DOC_DELIMITER_START = '---DOC_START---';
const DOC_DELIMITER_END   = '---DOC_END---';

/**
 * Deterministic serialization of one document for the cached prefix.
 * Contract (v1, ASSEMBLY_VERSION=1):
 *
 *   ---DOC_START---
 *   id: <document_id>
 *   version: <document_version>
 *   ---
 *   <content verbatim>
 *   ---DOC_END---
 *
 * Trailing newline after DOC_END. Between documents: a single blank line.
 */
export function serializeDocument(args: {
  documentId: string;
  version: number;
  content: string;
}): string {
  return `${DOC_DELIMITER_START}\nid: ${args.documentId}\nversion: ${args.version}\n---\n${args.content}\n${DOC_DELIMITER_END}\n`;
}

/**
 * Assembles the full cached prefix string from an ordered snapshot set plus
 * the pinned version-row contents.
 *
 * Ordering (deterministic):
 *   1. Snapshots sorted by bundleId ascending.
 *   2. Within each snapshot, documents in their recorded order (already sorted
 *      by documentId ascending at resolution time — §6.3).
 *
 * Documents within each snapshot are separated by a single blank line.
 * Bundles are separated by a single blank line.
 */
export function assemblePrefix(input: {
  snapshots: Array<{
    bundleId: string;
    orderedDocumentVersions: Array<{ documentId: string; documentVersion: number }>;
  }>;
  versionsByDocumentVersionKey: Map<string, { content: string }>;
}): string {
  const sortedSnapshots = [...input.snapshots].sort((a, b) => a.bundleId.localeCompare(b.bundleId));

  const parts: string[] = [];
  for (const snapshot of sortedSnapshots) {
    for (const dv of snapshot.orderedDocumentVersions) {
      const key = `${dv.documentId}:${dv.documentVersion}`;
      const versionRow = input.versionsByDocumentVersionKey.get(key);
      if (!versionRow) {
        throw new Error(`Missing version row for key ${key}`);
      }
      parts.push(serializeDocument({
        documentId: dv.documentId,
        version: dv.documentVersion,
        content: versionRow.content,
      }));
    }
  }

  // Join with a blank line between documents
  return parts.join('\n');
}

/**
 * Computes the PER-BUNDLE prefix hash from its components (§4.4).
 * Stored on bundle_resolution_snapshots.prefix_hash.
 */
export function computePrefixHash(components: PrefixHashComponents): string {
  const canonical = JSON.stringify({
    orderedDocumentIds: components.orderedDocumentIds,
    documentSerializedBytesHashes: components.documentSerializedBytesHashes,
    includedFlags: components.includedFlags,
    modelFamily: components.modelFamily,
    assemblyVersion: components.assemblyVersion,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Computes the CALL-LEVEL assembled prefix hash (§4.4).
 * Stored on llm_requests.prefix_hash.
 * Input: per-bundle prefix hashes in bundleId-ascending order.
 */
export function computeAssembledPrefixHash(input: {
  snapshotPrefixHashesByBundleIdAsc: string[];
  modelFamily: string;
  assemblyVersion: number;
}): string {
  const canonical = JSON.stringify({
    snapshotPrefixHashesByBundleIdAsc: input.snapshotPrefixHashesByBundleIdAsc,
    modelFamily: input.modelFamily,
    assemblyVersion: input.assemblyVersion,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Estimates token count for a string using a simple character-based heuristic.
 * NOT a provider round-trip — used only for variable-input estimation at
 * assembly time (§6.4 step 3). Stored version-row tokenCounts are the
 * authoritative counts for the document prefix.
 *
 * Approximation: 1 token ≈ 4 characters (conservative for English prose).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

const FIXED_SYSTEM_OVERHEAD_TOKENS = 100;

/**
 * Validates the assembled context against the resolved budget.
 * Returns either { kind: 'ok', softWarnTripped } or { kind: 'breach', payload }.
 * Pure — does not write to DB, does not throw.
 */
export function validateAssembly(input: {
  assembledPrefixTokens: number;
  variableInputTokens: number;
  perDocumentTopTokens: Array<{ documentId: string; documentName: string; tokens: number }>;
  resolvedBudget: ResolvedExecutionBudget;
}): { kind: 'ok'; softWarnTripped: boolean } | { kind: 'breach'; payload: HitlBudgetBlockPayload } {
  const { resolvedBudget } = input;
  const totalInputTokens = input.assembledPrefixTokens + input.variableInputTokens
    + resolvedBudget.reserveOutputTokens + FIXED_SYSTEM_OVERHEAD_TOKENS;

  const worstPerDocumentTokens = input.perDocumentTopTokens.length > 0
    ? Math.max(...input.perDocumentTopTokens.map((d) => d.tokens))
    : 0;

  // Check per-document cap first (§4.5 thresholdBreached order)
  if (worstPerDocumentTokens > resolvedBudget.perDocumentMaxTokens) {
    return {
      kind: 'breach',
      payload: buildBreachPayload({
        thresholdBreached: 'per_document_cap',
        inputTokens: totalInputTokens,
        worstPerDocumentTokens,
        resolvedBudget,
        perDocumentTopTokens: input.perDocumentTopTokens,
      }),
    };
  }

  // Check total input tokens
  if (totalInputTokens > resolvedBudget.maxInputTokens) {
    return {
      kind: 'breach',
      payload: buildBreachPayload({
        thresholdBreached: 'max_input_tokens',
        inputTokens: totalInputTokens,
        worstPerDocumentTokens,
        resolvedBudget,
        perDocumentTopTokens: input.perDocumentTopTokens,
      }),
    };
  }

  // Soft-warn check
  const softWarnTripped = totalInputTokens > resolvedBudget.maxInputTokens * resolvedBudget.softWarnRatio;

  return { kind: 'ok', softWarnTripped };
}

function buildBreachPayload(input: {
  thresholdBreached: 'max_input_tokens' | 'per_document_cap';
  inputTokens: number;
  worstPerDocumentTokens: number;
  resolvedBudget: ResolvedExecutionBudget;
  perDocumentTopTokens: Array<{ documentId: string; documentName: string; tokens: number }>;
}): HitlBudgetBlockPayload {
  const { resolvedBudget, perDocumentTopTokens } = input;
  const topContributors = [...perDocumentTopTokens]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
    .map((d) => ({
      documentId: d.documentId,
      documentName: d.documentName,
      tokens: d.tokens,
      percentOfBudget: parseFloat(((d.tokens / resolvedBudget.maxInputTokens) * 100).toFixed(1)),
    }));

  return {
    kind: 'cached_context_budget_breach',
    thresholdBreached: input.thresholdBreached,
    budgetUsed: {
      inputTokens: input.inputTokens,
      worstPerDocumentTokens: input.worstPerDocumentTokens,
    },
    budgetAllowed: {
      maxInputTokens: resolvedBudget.maxInputTokens,
      perDocumentCap: resolvedBudget.perDocumentMaxTokens,
    },
    topContributors,
    suggestedActions: ['trim_bundle', 'upgrade_model', 'split_task', 'abort'],
    resolvedBudget,
    intendedPrefixHashComponents: null as any, // populated by the stateful engine wrapper
  };
}
