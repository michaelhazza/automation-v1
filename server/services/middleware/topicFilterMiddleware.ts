/**
 * topicFilterMiddleware — Sprint 5 P4.1
 *
 * PreCall middleware that classifies the user's message by topic, then
 * soft-reorders (or hard-removes) the active tool list based on topic
 * relevance. This narrows the agent's tool set to the most likely
 * candidates before the first LLM call, reducing hallucinated tool
 * calls and improving intent-to-action alignment.
 *
 * Pipeline position: runs in the `preCall` phase, AFTER
 * contextPressureMiddleware and budgetCheckMiddleware. Those guards
 * handle resource exhaustion; this middleware handles intent narrowing.
 *
 * Behaviour matrix (per HARD_REMOVAL_CONFIDENCE_THRESHOLD in limits.ts):
 *
 *   confidence >= 0.85  → hard removal: non-matching tools are removed
 *                         (universal skills are preserved via
 *                          mutateActiveToolsPreservingUniversal)
 *   confidence < 0.85   → soft reorder: matching tools move to the front,
 *                         all tools remain visible
 *   confidence === 0    → no-op (unclassified message, all tools kept)
 *
 * Contract: docs/improvements-roadmap-spec.md §P4.1.
 */

import type { PreCallMiddleware, PreCallResult, MiddlewareContext } from './types.js';
import { classifyTopics, skillsMatchingTopics, reorderToolsByTopicRelevance } from '../topicClassifierPure.js';
import { TOPIC_REGISTRY } from '../../config/topicRegistry.js';
import { ACTION_REGISTRY } from '../../config/actionRegistry.js';
import { HARD_REMOVAL_CONFIDENCE_THRESHOLD } from '../../config/limits.js';

/**
 * Build the action→topics lookup from the registry.
 * Cached at module level since ACTION_REGISTRY is static.
 */
const actionTopicsMap: Record<string, string[]> = {};
for (const [slug, def] of Object.entries(ACTION_REGISTRY)) {
  actionTopicsMap[slug] = def.topics ?? [];
}

export const topicFilterMiddleware: PreCallMiddleware = {
  name: 'topic_filter',

  execute(ctx: MiddlewareContext): PreCallResult {
    // Extract the last user message text for classification.
    // The trigger context carries the original user message for manual runs;
    // for scheduled runs, fall through to no-op.
    const userMessage = extractUserMessage(ctx);
    if (!userMessage) {
      return { action: 'continue' };
    }

    const classification = classifyTopics(userMessage, TOPIC_REGISTRY);

    // No topic detected — leave tools untouched
    if (!classification.primaryTopic || classification.confidence === 0) {
      return { action: 'continue' };
    }

    // Collect topics (primary + optional secondary)
    const topics = [classification.primaryTopic];
    if (classification.secondaryTopic) {
      topics.push(classification.secondaryTopic);
    }

    // Find skills matching the classified topics
    const matchingSkills = skillsMatchingTopics(topics, actionTopicsMap);

    // Store classification on context for downstream use (preTool confidence escape)
    // Use runMetadata-style stashing on the context object (duck-typed extension)
    (ctx as Record<string, unknown>)._topicClassification = classification;
    (ctx as Record<string, unknown>)._topicMatchingSkills = matchingSkills;

    if (classification.confidence >= HARD_REMOVAL_CONFIDENCE_THRESHOLD) {
      // Hard removal mode: filter to matching skills + universals only.
      // This is done via inject_message so the loop can apply the filter
      // before the first LLM call. The actual tool mutation happens in
      // the agentic loop's preCall handler.
      return {
        action: 'inject_message',
        message: `<system-reminder>Topic classification: ${classification.primaryTopic} (confidence: ${classification.confidence.toFixed(2)}). Tools have been filtered to topic-relevant skills.</system-reminder>`,
      };
    }

    // Soft reorder mode: matching tools move to front, nothing removed.
    // No message injection needed — reordering is transparent.
    return { action: 'continue' };
  },
};

/**
 * Extract the user's message text from the middleware context.
 * Checks triggerContext.message first, then triggerContext.taskDescription.
 */
function extractUserMessage(ctx: MiddlewareContext): string | null {
  const trigger = ctx.request.triggerContext as Record<string, unknown> | undefined;
  if (!trigger) return null;

  if (typeof trigger.message === 'string' && trigger.message.length > 0) {
    return trigger.message;
  }
  if (typeof trigger.taskDescription === 'string' && trigger.taskDescription.length > 0) {
    return trigger.taskDescription;
  }
  return null;
}
