import { MIN_MEMORY_CONTENT_LENGTH } from '../../config/limits.js';

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

export function scoreMemoryEntry(entry: { content: string; entryType: string }): number {
  const { content } = entry;

  // Hard floor: trivially short content is always zero
  if (content.length < MIN_MEMORY_CONTENT_LENGTH) return 0;

  const completeness = Math.min(content.length / 200, 1.0);

  const specificitySignals = [
    /\d+/.test(content),
    /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/.test(content),
    /"[^"]+"/.test(content),
    /\b\d{4}-\d{2}-\d{2}\b/.test(content),
    /\$[\d,]+/.test(content),
  ];
  const specificity = specificitySignals.filter(Boolean).length / specificitySignals.length;

  const typeBoosts: Record<string, number> = {
    preference: 1.0, pattern: 0.9, decision: 0.85, issue: 0.8, observation: 0.6,
  };
  const relevance = typeBoosts[entry.entryType] ?? 0.5;

  const actionability = /should|must|always|never|prefers?|requires?|wants?|needs?|avoid/i
    .test(content) ? 0.9 : 0.4;

  return 0.25 * completeness + 0.25 * relevance + 0.25 * specificity + 0.25 * actionability;
}
