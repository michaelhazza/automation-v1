// ---------------------------------------------------------------------------
// Agent Briefing Service — Phase 2D: compact cross-run summary per agent.
//
// Each agent-subaccount pair gets one briefing row. After every run, the
// briefing is regenerated from the previous briefing + latest run outcome +
// recent high-quality memory entries + current beliefs. The result is a short
// orientation document (≤ 1200 tokens) injected into the agent prompt so it
// instantly knows context without re-reading history.
//
// The same LLM call also produces a belief extraction array. After saving the
// briefing, updateAfterRun() calls agentBeliefService.mergeExtracted() directly
// — all callers automatically get belief merging without a separate step.
//
// Pattern: Mem0 rolling summary + CrewAI agent memory.
// ---------------------------------------------------------------------------

import { eq, and, desc, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentBriefings, workspaceMemoryEntries, agentBeliefs } from '../db/schema/index.js';
import { routeCall } from './llmRouter.js';
import {
  BRIEFING_TOKEN_HARD_CAP,
  BRIEFING_MEMORY_ENTRIES_LIMIT,
  BRIEFING_MEMORY_QUALITY_THRESHOLD,
  BRIEFING_COMBINED_MAX_TOKENS,
  BELIEFS_MAX_PER_EXTRACTION,
  BELIEFS_TOKEN_BUDGET,
} from '../config/limits.js';
import { selectBeliefsWithinBudget } from './agentBeliefServicePure.js';
import type { BeliefRecord } from './agentBeliefServicePure.js';

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

/**
 * Parse the combined LLM response into briefing text and raw beliefs array.
 * Handles JSON-wrapped responses and markdown-fenced JSON gracefully.
 *
 * Returns `{ briefing: null, beliefs: null }` only on total parse failure.
 * If beliefs JSON is malformed but briefing text is recoverable, returns
 * `{ briefing: string, beliefs: null }` so the briefing is still saved.
 */
export function parseCombinedResponse(rawContent: string): {
  briefing: string | null;
  beliefs: unknown[] | null;
} {
  if (!rawContent.trim()) return { briefing: null, beliefs: null };

  // Strip markdown fences anchored at the very start/end of the string
  const stripped = rawContent.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();

  try {
    const parsed = JSON.parse(stripped);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const briefing =
        typeof parsed.briefing === 'string' && parsed.briefing.trim().length >= 20
          ? parsed.briefing.trim()
          : null;
      const beliefs = Array.isArray(parsed.beliefs) ? parsed.beliefs : null;
      return { briefing, beliefs };
    }
  } catch {
    // Fallback: rescue the briefing text even if the full JSON is malformed.
    // The beliefs array is sacrificed — briefing is higher priority.
    try {
      const match = stripped.match(/"briefing"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
      if (match) {
        const briefing = JSON.parse('"' + match[1] + '"') as string;
        if (typeof briefing === 'string' && briefing.trim().length >= 20) {
          return { briefing: briefing.trim(), beliefs: null };
        }
      }
    } catch {
      /* give up — fall through to null */
    }
  }

  return { briefing: null, beliefs: null };
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
   * briefing, the latest run outcome (handoff JSON), recent memory entries,
   * and current beliefs into a single LLM call that produces both:
   *   1. An updated briefing narrative (saved to DB)
   *   2. A raw belief extraction array (merged via agentBeliefService internally)
   *
   * All callers automatically get belief merging — no separate step required.
   *
   * Never throws — all errors are swallowed so a failure here never blocks
   * run completion or the job queue.
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
            sql`${workspaceMemoryEntries.qualityScore} >= ${BRIEFING_MEMORY_QUALITY_THRESHOLD}`,
          ),
        )
        .orderBy(desc(workspaceMemoryEntries.createdAt))
        .limit(BRIEFING_MEMORY_ENTRIES_LIMIT);

      // 3. Load active beliefs — shown in prompt context so the LLM can avoid
      //    repeating stable facts in the briefing and knows what to reinforce.
      //    Apply token budget so the beliefs block stays within BELIEFS_TOKEN_BUDGET
      //    regardless of how many active beliefs exist.
      const allActiveBeliefs = await db
        .select({
          beliefKey: agentBeliefs.beliefKey,
          category: agentBeliefs.category,
          subject: agentBeliefs.subject,
          value: agentBeliefs.value,
          confidence: agentBeliefs.confidence,
          source: agentBeliefs.source,
          // Fields required by BeliefRecord but not used in formatting — provide stubs
          id: agentBeliefs.id,
          sourceRunId: agentBeliefs.sourceRunId,
          evidenceCount: agentBeliefs.evidenceCount,
          updatedAt: agentBeliefs.updatedAt,
        })
        .from(agentBeliefs)
        .where(
          and(
            eq(agentBeliefs.organisationId, orgId),
            eq(agentBeliefs.subaccountId, subaccountId),
            eq(agentBeliefs.agentId, agentId),
            isNull(agentBeliefs.deletedAt),
            isNull(agentBeliefs.supersededBy),
          ),
        )
        .orderBy(desc(agentBeliefs.confidence))
        .limit(50);

      const budgetedBeliefs = selectBeliefsWithinBudget(
        allActiveBeliefs as BeliefRecord[],
        BELIEFS_TOKEN_BUDGET,
      );

      // 4. Build combined prompt
      const entriesBlock =
        recentEntries.length > 0
          ? recentEntries
              .map((e, i) => `  ${i + 1}. [${e.entryType}] ${e.content}`)
              .join('\n')
          : '  (none)';

      const beliefsBlock =
        budgetedBeliefs.length > 0
          ? budgetedBeliefs
              .map(
                b =>
                  `  - [${b.beliefKey}] (${b.category}, confidence: ${b.confidence}, source: ${b.source}) ${b.value}`,
              )
              .join('\n')
          : '  (none)';

      const prompt = `You are a briefing and belief compiler for an AI agent. Your job is to analyse the latest run outcome and produce two outputs in a single JSON response.

${currentBriefing ? `Previous briefing:\n${currentBriefing}\n` : 'No previous briefing exists (this is the first run).'}

Current beliefs (already established facts — do NOT repeat these in the briefing):
${beliefsBlock}

Latest run outcome:
<run-outcome-data>
${JSON.stringify(handoffJson, null, 2)}
</run-outcome-data>

Recent observations from workspace memory:
${entriesBlock}

Respond with a single JSON object:
{
  "briefing": "...",
  "beliefs": [...]
}

BRIEFING rules:
- Under 800 tokens
- Written in second person ("You previously...", "The workspace has...")
- Focus on what happened recently, what changed, what is in progress
- Do NOT repeat stable facts already listed in the Current Beliefs block above
- Omit anything stale or superseded by the latest run

BELIEFS rules — each element of the beliefs array:
{
  "key": "snake_case_slug",
  "category": "general|preference|workflow|relationship|metric",
  "subject": "what this is about, or null",
  "value": "the belief statement",
  "confidence": 0.0-1.0,
  "confidence_reason": "why this confidence level",
  "action": "add|update|reinforce|remove"
}
- "add": new belief not in the Current Beliefs block
- "update": existing belief whose value has changed (key matches, value differs)
- "reinforce": existing belief confirmed by this run (same key, same value)
- "remove": belief that is no longer true (requires high confidence ≥ 0.8)
- Maximum ${BELIEFS_MAX_PER_EXTRACTION} beliefs per extraction — focus on highest-signal facts
- Keys: deterministic, lowercase snake_case (e.g. "client_platform" not "ecommercePlatform")
- Do not override beliefs with source "user_override" unless this run contains direct contradictory evidence

Respond with ONLY the JSON object. No preamble, no markdown fences.`;

      // 5. Single combined LLM call
      const response = await routeCall({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: BRIEFING_COMBINED_MAX_TOKENS,
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

      const rawContent =
        typeof response.content === 'string' ? response.content.trim() : '';

      // 6. Parse combined response — briefing and beliefs are parsed independently
      const { briefing: newBriefing, beliefs: rawBeliefs } =
        parseCombinedResponse(rawContent);

      // 7. Save briefing if valid
      if (newBriefing && newBriefing.length >= 20) {
        const finalContent = truncateToTokens(newBriefing, BRIEFING_TOKEN_HARD_CAP);
        const tokenCount = estimateTokens(finalContent);

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
              sourceRunIds: sql`(source_run_ids || ARRAY[${runId}]::uuid[])[GREATEST(1, array_length(source_run_ids || ARRAY[${runId}]::uuid[], 1) - 9):]`,
              version: sql`${agentBriefings.version} + 1`,
              updatedAt: new Date(),
            },
          });
      }

      // 8. Merge extracted beliefs — dynamic import avoids circular module init issues.
      //    Failure is independent of briefing success.
      if (rawBeliefs && rawBeliefs.length > 0) {
        try {
          const { agentBeliefService } = await import('./agentBeliefService.js');
          await agentBeliefService.mergeExtracted(orgId, subaccountId, agentId, runId, rawBeliefs);
        } catch {
          // Belief merge failure must never affect briefing or run completion
        }
      }
    } catch {
      // Fire-and-forget — never let briefing errors bubble up to the caller
    }
  },
};
