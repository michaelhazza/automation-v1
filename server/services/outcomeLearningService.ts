// ---------------------------------------------------------------------------
// Outcome Learning Service — collapses human edits into workspace memory.
//
// When a human approves an action with edited args, we compare the agent's
// original proposal against the edited version and write a lesson to
// workspace memory so future runs avoid the same mistake.
//
// Pattern: CrewAI HumanFeedbackResult + Mem0 explicit memory write.
// Called fire-and-forget from the review approval handler.
// ---------------------------------------------------------------------------

import { routeCall } from './llmRouter.js';
import { workspaceMemoryService } from './workspaceMemoryService.js';
import { EXTRACTION_MAX_TOKENS } from '../config/limits.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutcomeLearningInput {
  toolSlug: string;
  originalArgs: Record<string, unknown>;
  editedArgs: Record<string, unknown>;
  agentRunId: string;
  agentId: string;
  organisationId: string;
  subaccountId: string;
  /** Optional task type slug for memory scoping. */
  taskSlug?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare original vs edited args, generate a lesson, and write it to
 * workspace memory as an 'observation' entry.
 *
 * Safe to call fire-and-forget — all errors are swallowed.
 */
export async function collapseOutcome(input: OutcomeLearningInput): Promise<void> {
  try {
    const diff = buildDiffSummary(input.originalArgs, input.editedArgs);
    if (!diff) return; // no meaningful difference

    const lesson = await generateLesson(input.toolSlug, diff);
    if (!lesson) return;

    await workspaceMemoryService.extractRunInsights(
      input.agentRunId,
      input.agentId,
      input.organisationId,
      input.subaccountId,
      lesson,
      input.taskSlug,
    );
  } catch {
    // Fire-and-forget — never let learning errors bubble up to the caller
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Build a human-readable diff summary between two arg objects. */
function buildDiffSummary(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
): string | null {
  const allKeys = new Set([...Object.keys(original), ...Object.keys(edited)]);
  const changes: string[] = [];

  for (const key of allKeys) {
    const orig = JSON.stringify(original[key] ?? null);
    const edit = JSON.stringify(edited[key] ?? null);
    if (orig !== edit) {
      changes.push(`  ${key}: ${orig} → ${edit}`);
    }
  }

  if (changes.length === 0) return null;
  return changes.join('\n');
}

/** Ask the LLM to turn a diff into a concise, reusable lesson. */
async function generateLesson(
  toolSlug: string,
  diffSummary: string,
): Promise<string | null> {
  const prompt = `A human reviewer edited the arguments for the "${toolSlug}" action before approving it.

Argument changes:
${diffSummary}

Write a single concise sentence (max 120 chars) describing what the agent should do differently next time.
Respond with only the lesson — no preamble, no quotes.`;

  try {
    const response = await routeCall({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: EXTRACTION_MAX_TOKENS,
      context: {
        organisationId: 'system',
        subaccountId: 'system',
        runId: 'outcome-learning',
        sourceType: 'system',
        agentName: 'outcome-learning',
        taskType: 'memory_compile',
        executionPhase: 'execution',
        routingMode: 'ceiling',
      },
    });

    const text =
      typeof response.content?.[0] === 'object' &&
      'text' in response.content[0]
        ? (response.content[0] as { text: string }).text.trim()
        : null;

    return text && text.length > 10 ? text : null;
  } catch {
    return null;
  }
}
