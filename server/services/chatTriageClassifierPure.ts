import type { FastPathDecision, FastPathRoute, BriefUiContext, FileEditIntent } from '../../shared/types/briefFastPath.js';

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

/**
 * File-edit intent patterns.
 *
 * Detect messages like:
 *   "Edit file X to ..."
 *   "Change Y in file Z"
 *   "Update the doc"
 *   "Rewrite section 3 of the report"
 *   "Modify the draft"
 */
const FILE_EDIT_PATTERNS: RegExp[] = [
  /\bedit\s+(?:file\s+)?(\S+)/i,
  /\bchange\s+.{1,60}\bin\s+(?:file\s+)?(\S+)/i,
  /\bupdate\s+(?:the\s+)?(?:doc|document|file|draft|report|spreadsheet|csv)\b/i,
  /\brewrite\s+(?:the\s+|section\s+\S+\s+of\s+(?:the\s+)?)?\b(?:doc|document|file|draft|report)\b/i,
  /\bmodify\s+(?:the\s+)?(?:doc|document|file|draft|report)\b/i,
  /\bappend\s+.{1,60}\bto\s+(?:the\s+)?(?:file|doc|document|draft)\b/i,
];

/**
 * Extract a file reference from a file-edit message.
 * Returns the captured group from the matching pattern, or undefined.
 */
function extractFileRef(text: string): string | undefined {
  // Pattern: "edit file X" or "change ... in file X" — capture the file name.
  const editMatch = /\bedit\s+(?:file\s+)(\S+)/i.exec(text)
    ?? /\bin\s+(?:file\s+)?([A-Za-z0-9._-]+)/i.exec(text);
  return editMatch?.[1] ?? undefined;
}

/**
 * Detect file-edit intent in a message.
 * Returns a FileEditIntent when detected, otherwise null.
 */
export function detectFileEditIntent(text: string): FileEditIntent | null {
  for (const re of FILE_EDIT_PATTERNS) {
    if (re.test(text)) {
      return { kind: 'file_edit_intent', fileRef: extractFileRef(text) };
    }
  }
  return null;
}

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
    const fileEditIntent = detectFileEditIntent(trimmed) ?? undefined;
    return {
      route: 'needs_orchestrator',
      scope,
      confidence: 0.8,
      tier: 1,
      secondLookTriggered: isRiskyRoute,
      keywords: config.writeIntentKeywords.filter((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(trimmed)),
      fileEditIntent,
    };
  }

  // Rule 5: check for file-edit intent even without generic write keywords
  const fileEditIntent = detectFileEditIntent(trimmed) ?? undefined;
  if (fileEditIntent) {
    const isRiskyRoute = config.riskySecondLookRoutes.includes('needs_orchestrator');
    return {
      route: 'needs_orchestrator',
      scope,
      confidence: 0.82,
      tier: 1,
      secondLookTriggered: isRiskyRoute,
      fileEditIntent,
    };
  }

  // Rule 6: default read-intent → needs_orchestrator
  return {
    route: 'needs_orchestrator',
    scope,
    confidence: 0.78,
    tier: 1,
    secondLookTriggered: false,
  };
}
