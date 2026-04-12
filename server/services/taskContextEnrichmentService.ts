/**
 * taskContextEnrichmentService — Phase 3A of Agent Intelligence Upgrade.
 *
 * Given a task description, generates an embedding and performs semantic search
 * over workspace memories to assemble a context block that can be injected into
 * an agent's prompt. Respects a caller-supplied token budget so the enriched
 * context never blows past model limits.
 */

import { generateEmbedding } from '../lib/embeddings.js';
import { workspaceMemoryService } from './workspaceMemoryService.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;
const SEMANTIC_SEARCH_TOP_K = 5;
const SECTION_HEADER = '## Relevant Context for This Task\n\n';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function enrichContextForTask(params: {
  orgId: string;
  subaccountId: string;
  agentId: string;
  taskDescription: string;
  existingEagerSourceIds: string[];
  tokenBudget: number;
}): Promise<{ content: string; sourceIds: string[] }> {
  const { orgId, subaccountId, taskDescription, existingEagerSourceIds, tokenBudget } = params;

  // 1. Generate embedding for the task description
  const embedding = await generateEmbedding(taskDescription);

  // 2. Semantic search over workspace memories
  const memories = await workspaceMemoryService.semanticSearchMemories({
    query: taskDescription,
    orgId,
    subaccountId,
    topK: SEMANTIC_SEARCH_TOP_K,
    ...(embedding ? { queryEmbedding: embedding } : {}),
  });

  // Filter out any memories whose source IDs are already loaded as eager data sources
  const existingSet = new Set(existingEagerSourceIds);
  const newMemories = memories.filter((m) => !existingSet.has(m.id));

  if (newMemories.length === 0) {
    return { content: '', sourceIds: [] };
  }

  // 3. Assemble formatted context section
  const charBudget = tokenBudget * CHARS_PER_TOKEN;
  const headerChars = SECTION_HEADER.length;
  let remaining = charBudget - headerChars;

  if (remaining <= 0) {
    return { content: '', sourceIds: [] };
  }

  const includedIds: string[] = [];
  const lines: string[] = [];

  for (const memory of newMemories) {
    const line = `- **[${memory.sourceAgentName}]** (score: ${memory.score.toFixed(2)}): ${memory.summary ?? '(no summary)'}\n`;

    if (line.length > remaining) {
      // No room for this entry — stop adding (truncate from bottom)
      break;
    }

    lines.push(line);
    includedIds.push(memory.id);
    remaining -= line.length;
  }

  if (lines.length === 0) {
    return { content: '', sourceIds: [] };
  }

  const content = SECTION_HEADER + lines.join('\n');
  return { content, sourceIds: includedIds };
}
