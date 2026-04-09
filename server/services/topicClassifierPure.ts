/**
 * topicClassifierPure.ts — pure keyword-based topic classifier.
 *
 * Sprint 5 P4.1: deterministic topic classification using keyword rules
 * from the topic registry. No DB, no IO. Testable without runtime services.
 *
 * Returns 1-2 topics with a confidence score. Confidence is based on
 * keyword match density: more matches = higher confidence. The threshold
 * for hard removal vs soft narrowing is enforced by the caller.
 */

import { TOPIC_REGISTRY } from '../config/topicRegistry.js';
import type { TopicRule } from '../config/topicRegistry.js';

export interface TopicClassification {
  primaryTopic: string | null;
  secondaryTopic?: string;
  confidence: number;
  matchedKeywords: number;
}

/**
 * Classify the user's message into 1-2 topics using keyword rules.
 * Returns the best match(es) and a confidence score.
 *
 * Confidence heuristic:
 *   - 0 matches: confidence 0.0
 *   - 1 match: confidence 0.4
 *   - 2 matches: confidence 0.6
 *   - 3+ matches: confidence 0.75
 *   - 5+ matches in same topic: confidence 0.9
 *
 * This is intentionally conservative — keyword rules rarely hit the
 * HARD_REMOVAL_CONFIDENCE_THRESHOLD (0.85) so most classifications
 * stay in soft-narrowing mode.
 */
export function classifyTopics(
  messageText: string,
  registry: TopicRule[] = TOPIC_REGISTRY
): TopicClassification {
  if (!messageText || messageText.trim().length === 0) {
    return { primaryTopic: null, confidence: 0, matchedKeywords: 0 };
  }

  const scores: Array<{ topic: string; matchCount: number }> = [];

  for (const rule of registry) {
    let matchCount = 0;
    for (const kw of rule.keywords) {
      if (kw.test(messageText)) {
        matchCount++;
      }
    }
    if (matchCount > 0) {
      scores.push({ topic: rule.topic, matchCount });
    }
  }

  if (scores.length === 0) {
    return { primaryTopic: null, confidence: 0, matchedKeywords: 0 };
  }

  // Sort by match count descending
  scores.sort((a, b) => b.matchCount - a.matchCount);

  const primary = scores[0];
  const secondary = scores.length > 1 ? scores[1] : undefined;
  const totalMatches = primary.matchCount + (secondary?.matchCount ?? 0);

  // Confidence heuristic
  let confidence: number;
  if (primary.matchCount >= 5) {
    confidence = 0.9;
  } else if (primary.matchCount >= 3) {
    confidence = 0.75;
  } else if (primary.matchCount >= 2) {
    confidence = 0.6;
  } else {
    confidence = 0.4;
  }

  return {
    primaryTopic: primary.topic,
    secondaryTopic: secondary?.topic,
    confidence,
    matchedKeywords: totalMatches,
  };
}

/**
 * Given classified topics, return the set of action types that match
 * any of the classified topics. Actions with no topics are always
 * included (topic-unclassified safety net).
 */
export function skillsMatchingTopics(
  topics: string[],
  actionTopicsMap: Record<string, string[]>
): string[] {
  const matched: string[] = [];
  const topicSet = new Set(topics);

  for (const [actionType, actionTopics] of Object.entries(actionTopicsMap)) {
    // Topic-unclassified: no topics declared → always visible
    if (!actionTopics || actionTopics.length === 0) {
      matched.push(actionType);
      continue;
    }
    // Match if any of the action's topics intersect with the classified topics
    if (actionTopics.some((t) => topicSet.has(t))) {
      matched.push(actionType);
    }
  }

  return matched;
}

/**
 * Reorder tools by topic relevance. Matching tools appear first;
 * non-matching tools stay visible but appear later. No tool is removed.
 * Used for soft-narrowing mode (low confidence).
 */
export function reorderToolsByTopicRelevance<T extends { name: string }>(
  tools: T[],
  topicSkillNames: string[],
  coreSkillNames: string[]
): T[] {
  const topicSet = new Set(topicSkillNames);
  const coreSet = new Set(coreSkillNames);

  const core: T[] = [];
  const matching: T[] = [];
  const rest: T[] = [];

  for (const tool of tools) {
    if (coreSet.has(tool.name)) {
      core.push(tool);
    } else if (topicSet.has(tool.name)) {
      matching.push(tool);
    } else {
      rest.push(tool);
    }
  }

  return [...core, ...matching, ...rest];
}
