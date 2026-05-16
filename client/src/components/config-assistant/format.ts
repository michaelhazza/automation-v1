// PAGE-SPLITS-T1 (audit 2026-05-15): formatTime and formatConvDate moved to
// `client/src/lib/dateFormat.ts` so the same helpers are not duplicated across
// agent-chat and config-assistant. Re-exporting here preserves the existing
// import surface; extractPlan stays local because it is config-assistant-only.
export { formatTime, formatConvDate } from '../../lib/dateFormat';

import { type ConfigPlan } from '../ConfigPlanPreview';

/** Try to extract a JSON config plan from a code block in an assistant message. */
export function extractPlan(content: string): ConfigPlan | null {
  // Only parse JSON from code blocks — avoids false positives on free-text JSON
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (!codeBlockMatch) return null;
  try {
    const parsed = JSON.parse(codeBlockMatch[1]);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps) && parsed.summary) {
      return parsed as ConfigPlan;
    }
  } catch {
    // Not valid JSON or not a plan
  }
  return null;
}
