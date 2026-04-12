// ---------------------------------------------------------------------------
// Agent Briefing Service — Phase 2D: compact cross-run summary per agent.
//
// Each agent-subaccount pair gets one briefing row. After every run, the
// briefing is regenerated from the previous briefing + latest run outcome +
// recent high-quality memory entries. The result is a short orientation
// document (≤ 1200 tokens) injected into the agent prompt so it instantly
// knows context without re-reading history.
//
// Pattern: Mem0 rolling summary + CrewAI agent memory.
// ---------------------------------------------------------------------------

import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentBriefings, workspaceMemoryEntries } from '../db/schema/index.js';
import { routeCall } from './llmRouter.js';
import { EXTRACTION_MAX_TOKENS } from '../config/limits.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard token cap for stored briefings. Anything above is truncated. */
const BRIEFING_TOKEN_HARD_CAP = 1200;

/** Number of recent high-quality memory entries to feed the LLM. */
const MEMORY_ENTRIES_LIMIT = 5;

/** Minimum quality score for memory entries included in briefing context. */
const MEMORY_QUALITY_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rough token count approximation (words ÷ 0.75). Good enough for budget
 * checks — the LLM is instructed to stay under 800 tokens, and we hard-cap
 * at 1200 as a safety net.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

/**
 * Truncate text to approximately `maxTokens` tokens. Cuts at the last
 * sentence boundary within the budget when possible.
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const words = text.split(/\s+/);
  const wordBudget = Math.floor(maxTokens * 0.75);
  if (words.length <= wordBudget) return text;

  const truncated = words.slice(0, wordBudget).join(' ');

  // Try to cut at the last sentence boundary for cleaner output
  const lastSentence = truncated.lastIndexOf('. ');
  if (lastSentence > truncated.length * 0.5) {
    return truncated.slice(0, lastSentence + 1);
  }
  return truncated + '…';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const agentBriefingService = {
  /**
   * Get the current briefing content for an agent-subaccount pair.
   * Returns null when no briefing has been generated yet.
   */
  async get(
    orgId: string,
    subaccountId: string,
    agentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ content: agentBriefings.content })
      .from(agentBriefings)
      .where(
        and(
          eq(agentBriefings.organisationId, orgId),
          eq(agentBriefings.subaccountId, subaccountId),
          eq(agentBriefings.agentId, agentId),
        ),
      )
      .limit(1);

    return row?.content ?? null;
  },

  /**
   * Regenerate the briefing after a run completes. Combines the previous
   * briefing, the latest run outcome (handoff JSON), and recent memory
   * entries into a new compact summary via LLM.
   *
   * Safe to call fire-and-forget — all errors are swallowed so a briefing
   * failure never blocks the critical run-completion path.
   */
  async updateAfterRun(
    orgId: string,
    subaccountId: string,
    agentId: string,
    runId: string,
    handoffJson: object,
  ): Promise<void> {
    try {
      // 1. Load current briefing (may be null for first run)
      const currentBriefing = await this.get(orgId, subaccountId, agentId);

      // 2. Load recent high-quality memory entries for this agent+subaccount
      const recentEntries = await db
        .select({
          content: workspaceMemoryEntries.content,
          entryType: workspaceMemoryEntries.entryType,
        })
        .from(workspaceMemoryEntries)
        .where(
          and(
            eq(workspaceMemoryEntries.organisationId, orgId),
            eq(workspaceMemoryEntries.subaccountId, subaccountId),
            eq(workspaceMemoryEntries.agentId, agentId),
            sql`${workspaceMemoryEntries.qualityScore} >= ${MEMORY_QUALITY_THRESHOLD}`,
          ),
        )
        .orderBy(desc(workspaceMemoryEntries.createdAt))
        .limit(MEMORY_ENTRIES_LIMIT);

      // 3. Build LLM prompt
      const entriesBlock =
        recentEntries.length > 0
          ? recentEntries
              .map((e, i) => `  ${i + 1}. [${e.entryType}] ${e.content}`)
              .join('\n')
          : '  (none)';

      const prompt = `You are a briefing compiler for an AI agent. Your job is to produce a concise orientation document that helps the agent understand its current context at the start of a new run.

${currentBriefing ? `Previous briefing:\n${currentBriefing}\n` : 'No previous briefing exists (this is the first run).'}

Latest run outcome:
${JSON.stringify(handoffJson, null, 2)}

Recent observations from workspace memory:
${entriesBlock}

Given the previous briefing, latest run outcome, and recent observations, produce an updated briefing under 800 tokens. The briefing should:
- Summarise the current state of affairs for this workspace
- Highlight any recurring patterns, open issues, or preferences
- Note what changed in the latest run
- Be written in second person ("You previously…", "The workspace has…")
- Omit anything stale or superseded by the latest run

Respond with only the briefing text — no preamble, no markdown headers, no quotes.`;

      const response = await routeCall({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: EXTRACTION_MAX_TOKENS,
        context: {
          organisationId: orgId,
          subaccountId,
          runId,
          sourceType: 'system',
          agentName: 'agent-briefing',
          taskType: 'memory_compile',
          executionPhase: 'execution',
          routingMode: 'ceiling',
        },
      });

      // Extract text from response (routeCall returns ProviderResponse.content: string)
      const newContent = typeof response.content === 'string' && response.content.trim().length > 0
        ? response.content.trim()
        : null;

      if (!newContent || newContent.length < 20) return;

      // 4. Hard-cap token count
      const finalContent = truncateToTokens(newContent, BRIEFING_TOKEN_HARD_CAP);
      const tokenCount = estimateTokens(finalContent);

      // 5. Upsert briefing row with atomic version increment to avoid TOCTOU race.
      // sourceRunIds uses array_append + trim to last 10 atomically.
      const runIdLiteral = sql`ARRAY[${runId}]::uuid[]`;
      await db
        .insert(agentBriefings)
        .values({
          organisationId: orgId,
          subaccountId,
          agentId,
          content: finalContent,
          tokenCount,
          sourceRunIds: runIdLiteral,
          version: 1,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            agentBriefings.organisationId,
            agentBriefings.subaccountId,
            agentBriefings.agentId,
          ],
          set: {
            content: finalContent,
            tokenCount,
            // Atomic: append runId — Postgres trims to last 10 via array slice
            sourceRunIds: sql`(source_run_ids || ARRAY[${runId}]::uuid[])[GREATEST(1, array_length(source_run_ids || ARRAY[${runId}]::uuid[], 1) - 9):]`,
            version: sql`${agentBriefings.version} + 1`,
            updatedAt: new Date(),
          },
        });
    } catch {
      // Fire-and-forget — never let briefing errors bubble up to the caller
    }
  },
};
