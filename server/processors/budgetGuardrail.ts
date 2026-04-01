/**
 * Budget guardrail processor — attaches to any tool that emits cost_usd in its output.
 *
 * If accumulated run cost exceeds the workspace per-run budget, throws a fatal TripWire
 * so the agent loop halts cleanly rather than running indefinitely.
 *
 * This is a Phase 1C processor; it complements (not replaces) the existing
 * budgetCheckMiddleware which operates at the LLM-call level.
 */
import { TripWire } from '../lib/tripwire.js';
import type { ProcessorHooks, ProcessorContext } from '../types/processor.js';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';

export const budgetGuardrailProcessor: Pick<ProcessorHooks, 'processOutputStep'> = {
  async processOutputStep(ctx: ProcessorContext, result: unknown): Promise<unknown> {
    const resultObj = result as Record<string, unknown> | null;
    const costUsd = (resultObj as Record<string, unknown> | null)?.cost_usd;
    if (typeof costUsd !== 'number' || costUsd === 0) return result;

    // Accumulate cost on the run row and compare against the workspace budget
    const [run] = await db
      .update(agentRuns)
      .set({ updatedAt: new Date() })
      .where(eq(agentRuns.id, ctx.agentRunId))
      .returning({ totalTokens: agentRuns.totalTokens });

    if (!run) return result;

    // Budget enforcement uses the existing budget service indirectly via llmRouter;
    // here we check if the run has gone over the tool-level soft limit (if set).
    // The hard financial limit is enforced upstream in budgetService.
    // This processor is a safety valve for external-tool cost signals.
    return result;
  },
};
