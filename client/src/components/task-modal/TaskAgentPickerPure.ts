export interface SubaccountAgent {
  agentId: string;
  parentSubaccountAgentId: string | null;
  agent: { name: string; icon: string | null };
  agentRole?: string | null;
}

export function defaultAgentId(
  agents: SubaccountAgent[],
  variant: 'layout' | 'review-queue',
): string | null {
  if (variant === 'layout') return null;
  const topLevel = agents.find((a) => !a.parentSubaccountAgentId);
  return topLevel?.agentId ?? agents[0]?.agentId ?? null;
}
