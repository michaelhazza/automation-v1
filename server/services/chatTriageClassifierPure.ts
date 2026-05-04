import type { FastPathDecision, FastPathRoute, BriefUiContext } from '../../shared/types/briefFastPath.js';

export interface ChatTriageInput {
  text: string;
  uiContext: BriefUiContext;
  conversationContext?: {
    priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  };
  config: ChatTriageConfig;
}

export interface ChatTriageConfig {
  tier1ConfidenceThreshold: number;
  riskySecondLookRoutes: FastPathRoute[];
  writeIntentKeywords: string[];
  scopeOverrideKeywords: {
    org: string[];
    system: string[];
  };
}

export const DEFAULT_CHAT_TRIAGE_CONFIG: ChatTriageConfig = {
  tier1ConfidenceThreshold: 0.75,
  riskySecondLookRoutes: ['needs_orchestrator'],
  writeIntentKeywords: ['send', 'email', 'create', 'update', 'schedule', 'delete', 'cancel', 'post', 'publish', 'remove'],
  scopeOverrideKeywords: {
    org: ['all clients', 'across subaccounts', 'agency-wide', 'all companies', 'every client'],
    system: ['router config', 'platform-wide', 'add integration', 'system setting'],
  },
};

// Patterns for simple filler responses that need no orchestration
const FILLER_RE = /^(thanks|ok|yes|no|got it|lgtm|👍|acknowledged|noted|sure|great|perfect|done|k|okay)\.?$/i;

// Deictic pronouns that signal clarification needed
const DEICTIC_RE = /\b(that|this|them|those|it|these|here|there)\b/i;

// Cheap-answer canned query patterns (Phase 3 v1 catalogue)
const CHEAP_ANSWER_PATTERNS: RegExp[] = [
  /\bpipeline velocity\b/i,
  /\bmonthly recurring revenue\b/i,
  /\bactive contacts\b/i,
  /\bopen opportunities\b/i,
  /\bchurn rate\b/i,
];

function detectScope(
  text: string,
  uiContext: BriefUiContext,
  config: ChatTriageConfig,
): FastPathDecision['scope'] {
  const lower = text.toLowerCase();
  for (const kw of config.scopeOverrideKeywords.system) {
    if (lower.includes(kw)) return 'system';
  }
  for (const kw of config.scopeOverrideKeywords.org) {
    if (lower.includes(kw)) return 'org';
  }
  return uiContext.currentSubaccountId ? 'subaccount' : 'org';
}

function hasWriteIntent(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    return re.test(lower);
  });
}

function isCheapAnswer(text: string): boolean {
  return CHEAP_ANSWER_PATTERNS.some((re) => re.test(text));
}

// "make this a workflow" intent pattern
const WORKFLOW_DRAFT_RE = /\b(make (this|it) a workflow|save (this|it) as a workflow|turn (this|it) into a workflow|workflow-ify)\b/i;

/**
 * Detects whether the text is a request to save the current task as a workflow draft.
 * Returns 'workflow_draft_request' if matched, null otherwise.
 * Pure, no I/O.
 */
export function detectWorkflowDraftIntent(text: string): 'workflow_draft_request' | null {
  if (WORKFLOW_DRAFT_RE.test(text)) {
    return 'workflow_draft_request';
  }
  return null;
}

/**
 * Tier 1 heuristic classifier — pure, no I/O, P99 < 2ms target.
 *
 * Returns a FastPathDecision with tier=1. If confidence < tier1ConfidenceThreshold,
 * the async wrapper escalates to tier 2 LLM call.
 */
export function classifyChatIntentPure(input: ChatTriageInput): FastPathDecision {
  const { text, uiContext, config } = input;
  const trimmed = text.trim();

  // Rule 1: very short or filler → simple_reply
  if (trimmed.length < 4 || FILLER_RE.test(trimmed)) {
    return {
      route: 'simple_reply',
      scope: detectScope(trimmed, uiContext, config),
      confidence: 0.95,
      tier: 1,
      secondLookTriggered: false,
    };
  }

  // Rule 2: cheap-answer canned patterns
  if (isCheapAnswer(trimmed)) {
    return {
      route: 'cheap_answer',
      scope: detectScope(trimmed, uiContext, config),
      confidence: 0.85,
      tier: 1,
      secondLookTriggered: false,
    };
  }

  // Rule 3: deictic + short → needs_clarification (low confidence → tier 2)
  if (DEICTIC_RE.test(trimmed) && trimmed.length < 30) {
    return {
      route: 'needs_clarification',
      scope: detectScope(trimmed, uiContext, config),
      confidence: 0.6,
      tier: 1,
      secondLookTriggered: false,
    };
  }

  const scope = detectScope(trimmed, uiContext, config);
  const write = hasWriteIntent(trimmed, config.writeIntentKeywords);

  // Rule 4: write-intent → needs_orchestrator, flag for second-look
  if (write) {
    const isRiskyRoute = config.riskySecondLookRoutes.includes('needs_orchestrator');
    return {
      route: 'needs_orchestrator',
      scope,
      confidence: 0.8,
      tier: 1,
      secondLookTriggered: isRiskyRoute,
      keywords: config.writeIntentKeywords.filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(trimmed)),
    };
  }

  // Rule 5: default read-intent → needs_orchestrator
  return {
    route: 'needs_orchestrator',
    scope,
    confidence: 0.78,
    tier: 1,
    secondLookTriggered: false,
  };
}
