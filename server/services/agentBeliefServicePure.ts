// ---------------------------------------------------------------------------
// agentBeliefServicePure.ts — Pure functions for the Agent Belief system.
//
// Extracted from agentBeliefService.ts for testability. No db, env, or
// service imports — only types and pure logic.
//
// Spec: docs/beliefs-spec.md
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types (subset of AgentBelief — avoids importing the Drizzle schema)
// ---------------------------------------------------------------------------

export interface BeliefRecord {
  id: string;
  beliefKey: string;
  category: string;
  subject: string | null;
  value: string;
  confidence: number;
  evidenceCount: number;
  source: string;
  sourceRunId: string | null;
  updatedAt: Date;
}

export interface ExtractionItem {
  key: string;
  category?: string;
  subject?: string | null;
  value: string;
  confidence?: number;
  confidence_reason?: string | null;
  action: string;
}

export type EffectiveAction = 'add' | 'update' | 'reinforce' | 'remove' | 'skip';

// ---------------------------------------------------------------------------
// Key normalization & aliases
// ---------------------------------------------------------------------------

/** Known key synonyms. No chaining — every target must be a canonical key. */
export const KEY_ALIASES: Record<string, string> = {
  ecommerce_platform: 'client_platform',
  cms: 'client_platform',
  cms_platform: 'client_platform',
  preferred_reporting_cadence: 'reporting_cadence',
  report_frequency: 'reporting_cadence',
};

export function validateKeyAliases(aliases: Record<string, string>): string | null {
  for (const [source, target] of Object.entries(aliases)) {
    if (target in aliases) {
      return `Chaining detected: "${source}" → "${target}", but "${target}" is itself an alias`;
    }
  }
  return null;
}

export function normalizeKey(raw: string, aliases: Record<string, string> = KEY_ALIASES): {
  key: string;
  aliased: boolean;
  originalKey?: string;
} {
  const normalized = raw.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (normalized in aliases) {
    return { key: aliases[normalized], aliased: true, originalKey: normalized };
  }
  return { key: normalized, aliased: false };
}

// ---------------------------------------------------------------------------
// Value normalization for comparison (prevents false updates)
// ---------------------------------------------------------------------------

export function normalizeValueForComparison(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?'"]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Token estimation (matches briefing service)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

// ---------------------------------------------------------------------------
// Extraction item parsing (from raw LLM output)
// ---------------------------------------------------------------------------

export function parseExtractionItem(raw: Record<string, unknown>, maxValueLength: number): ExtractionItem | null {
  if (!raw.key || !raw.value) return null;
  if (typeof raw.key !== 'string' || typeof raw.value !== 'string') return null;

  return {
    key: raw.key,
    value: (raw.value as string).slice(0, maxValueLength),
    category: typeof raw.category === 'string' ? raw.category : 'general',
    subject: typeof raw.subject === 'string' ? raw.subject : null,
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.7,
    confidence_reason: typeof raw.confidence_reason === 'string' ? raw.confidence_reason : null,
    action: typeof raw.action === 'string' ? raw.action : 'add',
  };
}

// ---------------------------------------------------------------------------
// Effective action determination (core merge logic)
// ---------------------------------------------------------------------------

export interface MergeConfig {
  removeMinConfidence: number;
  confidenceCeiling: number;
  updateConfidenceCap: number;
  confidenceBoost: number;
}

/**
 * Determines the effective action for a belief, given the LLM's hint and
 * the current DB state. Merge logic is authoritative — the LLM action is
 * a hint, not an instruction.
 */
export function determineEffectiveAction(
  item: ExtractionItem,
  existing: BeliefRecord | undefined,
  currentRunId: string,
  config: MergeConfig,
): EffectiveAction {
  // Idempotency guard: skip if already applied by this run
  if (existing?.sourceRunId === currentRunId) return 'skip';

  // User override guard: agent extraction never modifies user-set beliefs
  if (existing?.source === 'user_override') return 'skip';

  // Remove action — strict gating
  if (item.action === 'remove') {
    if (!existing) return 'skip';
    const itemConfidence = item.confidence ?? 0.7;
    if (itemConfidence < config.removeMinConfidence) return 'skip';
    if (itemConfidence < existing.confidence) return 'skip';
    return 'remove';
  }

  // No existing belief → add
  if (!existing) return 'add';

  // Same value (after normalization) → reinforce
  if (normalizeValueForComparison(existing.value) === normalizeValueForComparison(item.value)) {
    return 'reinforce';
  }

  // Different value → update
  return 'update';
}

/**
 * Compute the new confidence after an update (value change).
 * Caps at the lower of: existing confidence, new confidence, and the
 * update confidence cap. Prevents oscillation.
 */
export function computeUpdateConfidence(
  existingConfidence: number,
  newConfidence: number,
  cap: number,
): number {
  return Math.min(existingConfidence, newConfidence, cap);
}

/**
 * Compute the new confidence after a reinforcement.
 * Boosts by a fixed increment, capped at ceiling.
 */
export function computeReinforceConfidence(
  existingConfidence: number,
  boost: number,
  ceiling: number,
): number {
  return Math.min(ceiling, existingConfidence + boost);
}

// ---------------------------------------------------------------------------
// Belief formatting for prompt injection
// ---------------------------------------------------------------------------

export function formatSingleBelief(b: BeliefRecord): string {
  return `- [${b.confidence.toFixed(2)}] ${b.value}`;
}

export function formatBeliefsForPrompt(beliefs: BeliefRecord[]): string {
  if (beliefs.length === 0) return '';

  const grouped = new Map<string, BeliefRecord[]>();
  for (const b of beliefs) {
    const list = grouped.get(b.category) ?? [];
    list.push(b);
    grouped.set(b.category, list);
  }

  const parts: string[] = [
    'These are facts you have formed from previous runs. Treat them as your working knowledge — they may be updated or corrected over time.',
    '',
  ];

  for (const [category, items] of grouped) {
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    parts.push(`**${label}:**`);
    for (const b of items) {
      parts.push(formatSingleBelief(b));
    }
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Budget-based belief selection
// ---------------------------------------------------------------------------

export function selectBeliefsWithinBudget(
  beliefs: BeliefRecord[],
  tokenBudget: number,
): BeliefRecord[] {
  // Sort by confidence descending — highest confidence survives budget cuts
  const sorted = [...beliefs].sort((a, b) => b.confidence - a.confidence);
  const selected: BeliefRecord[] = [];
  let tokens = 0;
  const safetyBudget = tokenBudget * 0.9; // 10% safety buffer

  for (const belief of sorted) {
    const beliefTokens = estimateTokens(formatSingleBelief(belief));
    if (tokens + beliefTokens > safetyBudget) break;
    selected.push(belief);
    tokens += beliefTokens;
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Extraction JSON parsing (handles markdown fences from LLM output)
// ---------------------------------------------------------------------------

export function parseExtractionResponse(rawContent: string): unknown[] | null {
  if (!rawContent.trim()) return null;
  try {
    const jsonStr = rawContent.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
