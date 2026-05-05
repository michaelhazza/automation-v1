// Phase 7 / W3b — LLM call producing candidate rule texts for approval-gate suggestion panel.
// Spec: docs/universal-brief-dev-spec.md §6.3.5

import { routeCall } from './llmRouter.js';
import { ParseFailureError } from '../lib/parseFailureError.js';
import type { BriefApprovalCard } from '../../shared/types/briefResultContract.js';
import type { RuleScope } from '../../shared/types/briefRules.js';

export type RuleCategory = 'preference' | 'targeting' | 'content' | 'timing' | 'approval' | 'scope';

const VALID_CATEGORIES = new Set<RuleCategory>([
  'preference', 'targeting', 'content', 'timing', 'approval', 'scope',
]);

export interface CandidateRule {
  text: string;
  category: RuleCategory;
  suggestedScope: RuleScope;
  confidence: number;
}

export interface CandidateDraftInput {
  approvalCard: BriefApprovalCard;
  wasApproved: boolean;
  briefContext: string;
  existingRelatedRules: Array<{ id: string; text: string; category: string }>;
  organisationId: string;
}

function buildPrompt(input: CandidateDraftInput): string {
  const action = input.wasApproved ? 'approved' : 'rejected';
  const existing = input.existingRelatedRules.length > 0
    ? `\nExisting rules (avoid duplicating):\n${input.existingRelatedRules.map((r) => `- ${r.text}`).join('\n')}`
    : '';

  return `You help users teach the system their preferences based on approval decisions.

The user just ${action} this action: "${input.approvalCard.summary}"
Brief context: "${input.briefContext}"
Risk level: ${input.approvalCard.riskLevel}
${existing}

Draft 2–3 candidate rules that would capture the user's preference. Use plain English, ≤ 140 chars each.
Each rule fits one category: preference, targeting, content, timing, approval, scope.

Respond with JSON only:
{
  "candidates": [
    {
      "text": "...",          // ≤ 140 chars
      "category": "preference|targeting|content|timing|approval|scope",
      "suggestedScope": { "kind": "org" },  // or { "kind": "subaccount", "subaccountId": "..." }
      "confidence": 0.0–1.0
    }
  ]
}`;
}

function parseCandidates(raw: string): CandidateRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ParseFailureError({ rawExcerpt: raw.slice(0, 256) });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ParseFailureError({ rawExcerpt: raw.slice(0, 256) });
  }

  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p['candidates'])) {
    throw new ParseFailureError({ rawExcerpt: raw.slice(0, 256) });
  }

  const candidates: CandidateRule[] = [];
  for (const item of p['candidates'] as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const text = typeof c['text'] === 'string' ? c['text'].slice(0, 140) : '';
    const category = c['category'] as string;
    const confidence = typeof c['confidence'] === 'number' ? c['confidence'] : 0.5;

    if (!text || !VALID_CATEGORIES.has(category as RuleCategory)) continue;

    const rawScope = c['suggestedScope'] as Record<string, unknown> | undefined;
    let suggestedScope: RuleScope = { kind: 'org' };
    if (rawScope?.kind === 'subaccount' && typeof rawScope['subaccountId'] === 'string') {
      suggestedScope = { kind: 'subaccount', subaccountId: rawScope['subaccountId'] };
    } else if (rawScope?.kind === 'agent' && typeof rawScope['agentId'] === 'string') {
      suggestedScope = { kind: 'agent', agentId: rawScope['agentId'] };
    }

    candidates.push({ text, category: category as RuleCategory, suggestedScope, confidence });
  }

  return candidates.slice(0, 3);
}

export async function draftCandidates(
  input: CandidateDraftInput,
): Promise<{ candidates: CandidateRule[]; confidenceSource: 'llm' }> {
  const prompt = buildPrompt(input);

  const response = await routeCall({
    messages: [{ role: 'user', content: `Draft rule candidates for a ${input.wasApproved ? 'approved' : 'rejected'} action.` }],
    system: prompt,
    maxTokens: 512,
    context: {
      sourceType: 'system',
      taskType: 'general',
      featureTag: 'rule-candidate-drafter',
      organisationId: input.organisationId,
    },
    postProcess: (content: string) => {
      try {
        parseCandidates(content);
      } catch {
        throw new ParseFailureError({ rawExcerpt: content.slice(0, 256) });
      }
    },
  });

  return {
    candidates: parseCandidates(response.content),
    confidenceSource: 'llm',
  };
}
