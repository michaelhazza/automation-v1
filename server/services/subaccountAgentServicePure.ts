export interface RoutingCandidate { id: string; deletedAt: Date | null; subaccountId: string; }

export function selectActiveRoutingCandidates(
  candidates: RoutingCandidate[],
  targetSubaccountId: string,
): RoutingCandidate[] {
  return candidates.filter(c => c.deletedAt === null && c.subaccountId === targetSubaccountId);
}
