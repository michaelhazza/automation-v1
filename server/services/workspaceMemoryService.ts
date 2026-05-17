import {
  agentRoleToDomain,
  type ExtractRunInsightsOptions,
} from './workspaceMemoryService/types.js';
import * as readMethods from './workspaceMemoryService/read.js';
import { extractRunInsights } from './workspaceMemoryService/extract.js';
import * as retrieveMethods from './workspaceMemoryService/retrieve.js';
import * as entitiesMethods from './workspaceMemoryService/entities.js';
import { regenerateSummary } from './workspaceMemoryService/regenerateSummary.js';

export type { ExtractRunInsightsOptions };
export { agentRoleToDomain };

export {
  pruneStaleMemoryEntries,
  reembedEntry,
  getStaleEmbeddingsBatch,
  recomputeStaleEmbeddings,
} from './workspaceMemoryService/decayAndEmbedding.js';

export {
  setContextEnrichmentJobSender,
  processContextEnrichment,
} from './workspaceMemoryService/enrichmentJob.js';

// ---------------------------------------------------------------------------
// Workspace Memory Service — shared memory across agents in a workspace
// ---------------------------------------------------------------------------

export const workspaceMemoryService = {
  // ─── Read ──────────────────────────────────────────────────────────────────
  ...readMethods,

  // ─── Post-Run Extraction ───────────────────────────────────────────────────
  extractRunInsights,

  // ─── Retrieve ──────────────────────────────────────────────────────────────
  ...retrieveMethods,

  // ─── Entities ──────────────────────────────────────────────────────────────
  ...entitiesMethods,

  // ─── Summary Regeneration (single LLM call for both memory + board) ───────
  regenerateSummary,
};
