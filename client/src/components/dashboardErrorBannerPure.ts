const labelMap: Record<string, string> = {
  agents: 'Agents',
  activity: 'Activity feed',
  pulseAttention: 'Pending approvals',
  clientHealth: 'Client health',
  summary: 'Health summary',
  prioritised: 'High-risk clients',
};

export function failedSourceNames(errors: Record<string, boolean>): string[] {
  return Object.entries(errors)
    .filter(([, failed]) => failed)
    .map(([key]) => labelMap[key] ?? key);
}
