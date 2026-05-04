export interface CadenceSignal {
  name: string;
  weight: number;
}

export interface CadenceDetectionResult {
  score: number;  // 0-1 — 0.5+ = likely recurring; 0.7+ = strong signal
  signals: CadenceSignal[];
}

/**
 * Detects cadence/scheduling intent in a prompt.
 * Returns score 0-1; signals that contributed.
 */
export function detectCadenceSignals(promptText: string): CadenceDetectionResult {
  const lower = promptText.toLowerCase();
  const signals: CadenceSignal[] = [];

  const patterns: Array<{ name: string; weight: number; regex: RegExp }> = [
    { name: 'weekly', weight: 0.4, regex: /\b(weekly|every week|each week|once a week)\b/ },
    { name: 'daily', weight: 0.4, regex: /\b(daily|every day|each day|once a day)\b/ },
    { name: 'monthly', weight: 0.4, regex: /\b(monthly|every month|each month|once a month)\b/ },
    { name: 'day_of_week', weight: 0.35, regex: /\b(every (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/ },
    { name: 'recurring_phrasing', weight: 0.3, regex: /\b(recurring|repeating|scheduled|automate|regular(ly)?)\b/ },
    { name: 'calendar_phrase', weight: 0.25, regex: /\b(remind me|set a reminder|calendar|schedule|every \d+ (days?|weeks?|months?))\b/ },
    { name: 'periodic_report', weight: 0.3, regex: /\b(report|summary|digest)\b/ },
  ];

  for (const { name, weight, regex } of patterns) {
    if (regex.test(lower)) {
      signals.push({ name, weight });
    }
  }

  const score = Math.min(1, signals.reduce((acc, s) => acc + s.weight, 0));
  return { score, signals };
}
