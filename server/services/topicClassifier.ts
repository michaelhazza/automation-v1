/**
 * topicClassifier.ts — impure wrapper around the pure topic classifier.
 *
 * Sprint 5 P4.1: topics-to-actions filter. This wrapper exists to allow
 * future per-org classifier configuration (e.g. custom keyword overrides
 * or flash-model classifier). For now it delegates directly to the pure
 * keyword-based classifier.
 */

import { classifyTopics } from './topicClassifierPure.js';
import type { TopicClassification } from './topicClassifierPure.js';
import { TOPIC_REGISTRY } from '../config/topicRegistry.js';

export const topicClassifierService = {
  /**
   * Classify the intent of the last user message. Currently uses the
   * keyword-based classifier. In the future, can load org-specific
   * config or route to a flash-model classifier based on telemetry.
   */
  classify(messageText: string): TopicClassification {
    return classifyTopics(messageText, TOPIC_REGISTRY);
  },
};
