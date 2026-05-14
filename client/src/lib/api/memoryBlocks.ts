// client/src/lib/api/memoryBlocks.ts
// Typed API client for memory block list with provenance source filter.
// Trust & Verification Layer spec §13.4.

import { listKnowledge } from '../../api/governApi';
import type { KnowledgeListResponse, KnowledgeSourceFilter } from '../../../../shared/types/govern.js';

export interface MemoryBlockListParams {
  scope?: 'workspace' | 'org';
  subaccountId?: string;
  source?: KnowledgeSourceFilter;
  q?: string;
  cursor?: string;
  limit?: number;
}

export function listMemoryBlocks(params: MemoryBlockListParams): Promise<KnowledgeListResponse> {
  return listKnowledge(params);
}
