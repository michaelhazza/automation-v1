/**
 * orchestratorCadenceDetectionPure.ts — pure cadence-signal detection.
 *
 * Detects whether an operator's prompt contains signals that the task should
 * be run on a recurring schedule, so the orchestrator can recommend saving it
 * as a workflow.
 *
 * Spec: docs/workflows-dev-spec.md §13.1
 * No I/O — safe to unit-test without any mocks.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CadenceSignal {
  name: string;
  weight: number;
}

export interface CadenceDetectionResult {
  score: number;
  signals: CadenceSignal[];
}

export interface CadenceDetectionInput {
  promptText: string;
  /** Count of prior runs by this user with a similar prompt. */
  priorRunCount: number;
  /** Average gap between prior runs in days, if known. */
  priorRunFrequencyDays?: number;
}

// ─── Internal pattern sets ────────────────────────────────────────────────────

const CALENDAR_PATTERNS: ReadonlyArray<RegExp> = [
  /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bweekly\b/i,
  /\bevery\s+week\b/i,
  /\bdaily\b/i,
  /\bevery\s+(morning|evening|day)\b/i,
  /\bmonthly\b/i,
  /\bfirst\s+of\s+the\s+month\b/i,
  /\beach\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\beach\s+(morning|week|month|day)\b/i,
  /\bevery\s+\d+\s+(days?|weeks?|months?)\b/i,
];

const RECURRING_INTENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bagain\b/i,
  /\bnext\s+time\b/i,
  /\bregularly\b/i,
  /\bas\s+usual\b/i,
];

const EXPLICIT_WORKFLOW_PATTERNS: ReadonlyArray<RegExp> = [
  /\bmake\s+this\s+a\s+workflow\b/i,
  /\bsave\s+as\s+(?:a\s+)?workflow\b/i,
  /\bautomate\s+this\b/i,
  /\bset\s+up\s+(?:a\s+)?workflow\b/i,
  /\bschedule\s+this\b/i,
  /\brun\s+this\s+automatically\b/i,
];

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Minimum score to recommend a workflow. */
export const CADENCE_RECOMMEND_THRESHOLD = 0.6;

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Detect cadence signals in an operator's prompt.
 *
 * Returns a score in [0.0, 1.0] and the list of detected signals. A score
 * >= CADENCE_RECOMMEND_THRESHOLD means a workflow recommendation should be
 * surfaced after the task completes.
 */
export function detectCadenceSignals(input: CadenceDetectionInput): CadenceDetectionResult {
  const { promptText, priorRunCount, priorRunFrequencyDays } = input;
  const signals: CadenceSignal[] = [];
  let rawScore = 0;

  // Explicit workflow intent saturates the score immediately.
  for (const pattern of EXPLICIT_WORKFLOW_PATTERNS) {
    if (pattern.test(promptText)) {
      signals.push({ name: 'explicit_workflow_intent', weight: 1.0 });
      return { score: 1.0, signals };
    }
  }

  // Calendar phrasing (+0.4)
  for (const pattern of CALENDAR_PATTERNS) {
    if (pattern.test(promptText)) {
      signals.push({ name: 'calendar_phrasing', weight: 0.4 });
      rawScore += 0.4;
      break; // Count the calendar category only once
    }
  }

  // Recurring intent verbs (+0.2)
  for (const pattern of RECURRING_INTENT_PATTERNS) {
    if (pattern.test(promptText)) {
      signals.push({ name: 'recurring_intent_verb', weight: 0.2 });
      rawScore += 0.2;
      break; // Count the recurring-intent category only once
    }
  }

  // Prior-run pattern (+0.4)
  if (
    priorRunCount >= 3 &&
    priorRunFrequencyDays !== undefined &&
    priorRunFrequencyDays <= 14
  ) {
    signals.push({ name: 'prior_run_pattern', weight: 0.4 });
    rawScore += 0.4;
  }

  // Cap at 1.0 (explicit signal already returns early above, but cap remaining
  // paths in case the weights change in the future).
  const score = Math.min(rawScore, 1.0);
  return { score, signals };
}
