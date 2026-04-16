/**
 * memoryInspectorService — natural-language memory inspector (§5.9 S13)
 *
 * Answers "why did the agent do X?" or "what does the system know about X?"
 * queries by retrieving the relevant run context / memories and producing a
 * plain-English explanation.
 *
 * Two tier exposures:
 *   - agency: full response with internal operational details
 *   - client_portal: tier-filtered response — strips internal agent
 *     instructions + task configurations; only facts and outcomes shown
 *
 * Invariant: the client-portal filter is a SEPARATE system-prompt path, not
 * a post-processing strip. No internal operational detail is ever included
 * in the client-portal LLM's context. This prevents prompt-injection leaks.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.9 (S13)
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agentRuns,
  workspaceMemoryEntries,
  memoryBlocks,
} from '../db/schema/index.js';
import { routeCall } from './llmRouter.js';
import { logger } from '../lib/logger.js';

export type InspectorAudience = 'agency' | 'client_portal';

export interface AskInspectorInput {
  subaccountId: string;
  organisationId: string;
  userId: string;
  /** User-asked question. */
  question: string;
  /** Optional: scope to a specific run. */
  runId?: string;
  audience: InspectorAudience;
  correlationId: string;
}

export interface InspectorResponse {
  answer: string;
  citations: Array<{ kind: 'memory_entry' | 'memory_block' | 'run'; id: string; snippet: string }>;
  audience: InspectorAudience;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const AGENCY_SYSTEM_PROMPT = `
You are the Memory Inspector for an agency staff member. Answer the user's
question about what the system knows or why the agent did what it did.

Context you receive:
  - Recent run transcripts + tool calls (when scoped to a run)
  - Relevant memory entries + memory blocks
  - Agent beliefs with confidence scores

Guidelines:
  - Be specific. Cite entry IDs and run IDs in your answer.
  - Plain English. Avoid jargon like "qualityScore" or "RRF" — use everyday
    language ("the system was confident because it had seen this in 5 prior runs").
  - When uncertain, say so. Don't fabricate.
  - If the question is outside the system's knowledge, say what's missing
    rather than guessing.
`.trim();

const CLIENT_PORTAL_SYSTEM_PROMPT = `
You are the Memory Inspector for a client. Answer the client's question
about what the system knows about them.

Context you receive (filtered):
  - Memory-derived facts (blocks + entries)
  - Outcomes of recent deliverables

You do NOT receive and MUST NOT mention:
  - Internal agent instructions
  - Task configurations or scheduled-task RRULEs
  - Agent reasoning chain / prompts
  - qualityScore / beliefs metadata / internal operational detail

Guidelines:
  - Plain English. Friendly tone.
  - Answer in terms the client would recognise — their brand, their services,
    their audience.
  - If the question strays into agency operations, say: "That's an operational
    detail your agency manages — they can tell you more."
`.trim();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function askInspector(input: AskInspectorInput): Promise<InspectorResponse> {
  // 1. Gather context
  const citations: InspectorResponse['citations'] = [];

  const memories = await db
    .select({
      id: workspaceMemoryEntries.id,
      content: workspaceMemoryEntries.content,
      topic: workspaceMemoryEntries.topic,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, input.subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
      ),
    )
    .orderBy(desc(workspaceMemoryEntries.createdAt))
    .limit(10);

  for (const m of memories) {
    citations.push({ kind: 'memory_entry', id: m.id, snippet: m.content.slice(0, 200) });
  }

  const blocks = await db
    .select({
      id: memoryBlocks.id,
      name: memoryBlocks.name,
      content: memoryBlocks.content,
    })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.subaccountId, input.subaccountId),
        eq(memoryBlocks.organisationId, input.organisationId),
        isNull(memoryBlocks.deletedAt),
        eq(memoryBlocks.status, 'active'),
      ),
    )
    .limit(5);

  for (const b of blocks) {
    citations.push({ kind: 'memory_block', id: b.id, snippet: b.content.slice(0, 200) });
  }

  if (input.runId) {
    const [run] = await db
      .select({
        id: agentRuns.id,
        summary: agentRuns.summary,
        citedEntryIds: agentRuns.citedEntryIds,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.organisationId, input.organisationId),
        ),
      )
      .limit(1);

    if (run) {
      citations.push({
        kind: 'run',
        id: run.id,
        snippet: (run.summary ?? '').slice(0, 300),
      });
    }
  }

  // 2. Build the context payload — tier-filtered for client portal
  const contextPayload = buildContextPayload(input.audience, memories, blocks);

  // 3. Call the LLM with the tier-appropriate system prompt
  const systemPrompt =
    input.audience === 'client_portal' ? CLIENT_PORTAL_SYSTEM_PROMPT : AGENCY_SYSTEM_PROMPT;

  const response = await routeCall({
    messages: [
      {
        role: 'user',
        content: `QUESTION: ${input.question}\n\nCONTEXT:\n${contextPayload}`,
      },
    ],
    system: systemPrompt,
    maxTokens: 1500,
    temperature: 0.2,
    context: {
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      correlationId: input.correlationId,
      taskType: 'memory_inspector',
    } as Parameters<typeof routeCall>[0]['context'],
  });

  const contentBlocks = response?.content ?? [];
  const answer = Array.isArray(contentBlocks)
    ? contentBlocks
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: string }).text) : ''))
        .join('\n')
    : String(contentBlocks);

  logger.info('memoryInspectorService.answered', {
    subaccountId: input.subaccountId,
    audience: input.audience,
    questionLength: input.question.length,
    answerLength: answer.length,
  });

  return {
    answer,
    citations,
    audience: input.audience,
  };
}

function buildContextPayload(
  audience: InspectorAudience,
  memories: Array<{ id: string; content: string; topic: string | null }>,
  blocks: Array<{ id: string; name: string; content: string }>,
): string {
  const parts: string[] = [];

  parts.push('== MEMORY BLOCKS ==');
  for (const b of blocks) {
    // Client-portal excludes internal admin blocks (names prefixed with config- or internal-)
    if (audience === 'client_portal' && /^(config|internal)[-_]/i.test(b.name)) continue;
    parts.push(`[${b.name}] ${b.content.slice(0, 800)}`);
  }

  parts.push('');
  parts.push('== MEMORY ENTRIES ==');
  for (const m of memories) {
    parts.push(`(entry ${m.id}, topic=${m.topic ?? 'n/a'}): ${m.content.slice(0, 400)}`);
  }

  return parts.join('\n');
}
