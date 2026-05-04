export type MilestoneKind = 'file_produced' | 'decision_made' | 'handoff_complete' | 'plan_changed';

export function classifyAsMilestone(actionDescription: string): { isMilestone: boolean; kind?: MilestoneKind; summary: string } {
  const lower = actionDescription.toLowerCase();
  if (/\b(file|document|report|draft|output)\b/.test(lower)) {
    return { isMilestone: true, kind: 'file_produced', summary: actionDescription };
  }
  if (/\b(decided|decision|approved|rejected|resolved)\b/.test(lower)) {
    return { isMilestone: true, kind: 'decision_made', summary: actionDescription };
  }
  if (/\b(handed off|escalated|delegated|passed to)\b/.test(lower)) {
    return { isMilestone: true, kind: 'handoff_complete', summary: actionDescription };
  }
  if (/\b(plan|restructured|reorganised|changed the approach)\b/.test(lower)) {
    return { isMilestone: true, kind: 'plan_changed', summary: actionDescription };
  }
  return { isMilestone: false, summary: actionDescription };
}
