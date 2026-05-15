import { type ConfigPlan } from '../ConfigPlanPreview';

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatConvDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

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
