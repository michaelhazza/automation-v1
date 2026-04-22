// Phase 6 / W3.5 — Pure parser for ruleConflictDetectorService LLM output.
// Spec: docs/universal-brief-dev-spec.md §6.3.3

import type { RuleScope, RuleConflict } from '../../shared/types/briefRules.js';

export interface RuleConflictInput {
  newRule: { text: string; scope: RuleScope };
  candidatePool: Array<{
    id: string;
    text: string;
    scope: RuleScope;
    isAuthoritative: boolean;
    priority: 'low' | 'medium' | 'high';
  }>;
}

export interface RuleConflictOutput {
  conflicts: RuleConflict[];
  checkedAt: string;
}

const VALID_CONFLICT_KINDS = new Set([
  'direct_contradiction',
  'scope_overlap',
  'subset',
  'superset',
]);

const VALID_RESOLUTIONS = new Set([
  'keep_new',
  'keep_existing',
  'keep_both_with_priorities',
  'user_decides',
]);

/**
 * Validates and shapes raw LLM JSON into a RuleConflictOutput.
 * Fails open — on any malformed output returns empty conflicts rather than
 * blocking the user (per spec §6.3.3 "fail-open" posture).
 */
export function parseConflictReportPure(
  llmRawOutput: unknown,
  input: RuleConflictInput,
): RuleConflictOutput {
  const checkedAt = new Date().toISOString();

  if (!llmRawOutput || typeof llmRawOutput !== 'object') {
    return { conflicts: [], checkedAt };
  }

  const raw = llmRawOutput as Record<string, unknown>;
  if (!Array.isArray(raw['conflicts'])) {
    return { conflicts: [], checkedAt };
  }

  const candidateIds = new Set(input.candidatePool.map((c) => c.id));

  const conflicts: RuleConflict[] = [];
  for (const item of raw['conflicts']) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;

    const existingRuleId = typeof c['existingRuleId'] === 'string' ? c['existingRuleId'] : '';
    const existingText = typeof c['existingText'] === 'string' ? c['existingText'] : '';
    const conflictKind = c['conflictKind'] as string;
    const confidence = typeof c['confidence'] === 'number' ? c['confidence'] : 0;
    const suggestedResolution = c['suggestedResolution'] as string;

    if (!existingRuleId || !candidateIds.has(existingRuleId)) continue;
    if (!VALID_CONFLICT_KINDS.has(conflictKind)) continue;
    if (!VALID_RESOLUTIONS.has(suggestedResolution)) continue;
    if (confidence < 0 || confidence > 1) continue;

    const candidate = input.candidatePool.find((c) => c.id === existingRuleId);
    if (!candidate) continue;

    conflicts.push({
      existingRuleId,
      existingText: existingText || candidate.text,
      existingScope: candidate.scope,
      conflictKind: conflictKind as RuleConflict['conflictKind'],
      confidence,
      suggestedResolution: suggestedResolution as RuleConflict['suggestedResolution'],
    });
  }

  return { conflicts, checkedAt };
}
