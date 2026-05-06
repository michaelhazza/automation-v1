/**
 * server/services/optimiser/renderVersion.ts
 *
 * Monotonically-increasing integer constant that is part of the render-cache
 * key: (category, dedupe_key, evidence_hash, render_version).
 *
 * BUMP POLICY — increment RENDER_VERSION when ANY of the following changes:
 *   1. The render-prompt template for any category.
 *   2. A per-category evidence shape contract (shared/types/agentRecommendations.ts).
 *   3. The output-format contract (title / body length, markdown rules, etc.).
 *
 * A RENDER_VERSION bump invalidates ALL cached render output for ALL categories,
 * so bump only when the change meaningfully affects the operator-visible copy.
 * Fixing a typo in an evidence field name that has no user-facing representation
 * does NOT require a bump; changing the render prompt to produce different sentence
 * structure DOES.
 *
 * Spec: docs/sub-account-optimiser-spec.md §2 / §6.2
 */

export const RENDER_VERSION = 1;
