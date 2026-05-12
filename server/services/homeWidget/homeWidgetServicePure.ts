export interface AgentForWidget {
  id: string;
  name: string;
  createdAt: Date;
}

// Stable createdAt ASC sort with UUID tiebreaker (per DG §8.21 sort stability)
export function orderAgents(agents: AgentForWidget[]): AgentForWidget[] {
  return [...agents].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

export interface ShouldRefetchArgs {
  refreshPolicy: 'every_5m' | 'on_login' | 'on_demand';
  lastFetchedAt: Date | null;
  now: Date;
}

export function shouldRefetch({ refreshPolicy, lastFetchedAt, now }: ShouldRefetchArgs): boolean {
  if (refreshPolicy === 'on_demand') return false;
  if (refreshPolicy === 'on_login') return lastFetchedAt === null;
  // every_5m
  if (lastFetchedAt === null) return true;
  return now.getTime() - lastFetchedAt.getTime() > 5 * 60 * 1000;
}
