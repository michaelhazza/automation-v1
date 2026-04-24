// ---------------------------------------------------------------------------
// Priority Feed Service — Pure (scoring only, no DB access)
// Feature 2: Prioritized Work Feed
// ---------------------------------------------------------------------------

export type FeedEntrySource =
  | 'health_finding'
  | 'review_item'
  | 'agent_inbox'
  | 'task'
  | 'workflow_run'
  | 'agent_run_failure';

export type FeedEntry = {
  source: FeedEntrySource;
  id: string;
  subaccountId: string;
  severity: 'critical' | 'warning' | 'info';
  ageHours: number;
  assignedSubaccountId?: string;
  metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Scoring formula:
//   score = severity_weight × age_factor × assignment_relevance
//
// severity_weight: critical=1.0, warning=0.6, info=0.3
// age_factor: linear ramp from 1.0 at t=0 to 2.0 at 7 days, capped at 2.0
// assignment_relevance: 1.0 if item's subaccountId matches caller's,
//                       0.5 if org-wide, 0.1 if cross-subaccount
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 1.0,
  warning: 0.6,
  info: 0.3,
};

const MAX_AGE_HOURS = 7 * 24; // 7 days

export function scoreEntry(
  entry: FeedEntry,
  callerId: { subaccountId: string },
): number {
  const severityWeight = SEVERITY_WEIGHTS[entry.severity] ?? 0.3;

  // Linear ramp: 1.0 at t=0 → 2.0 at 7 days, capped at 2.0
  const clampedAge = Math.min(entry.ageHours, MAX_AGE_HOURS);
  const ageFactor = 1.0 + (clampedAge / MAX_AGE_HOURS);

  // Assignment relevance
  let assignmentRelevance: number;
  if (entry.subaccountId === callerId.subaccountId) {
    assignmentRelevance = 1.0;
  } else if (!entry.assignedSubaccountId) {
    assignmentRelevance = 0.5; // org-wide
  } else {
    assignmentRelevance = 0.1; // cross-subaccount
  }

  return severityWeight * ageFactor * assignmentRelevance;
}

export function rankFeed(
  entries: FeedEntry[],
  callerId: { subaccountId: string },
): FeedEntry[] {
  return [...entries]
    .map((e) => ({ entry: e, score: scoreEntry(e, callerId) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.entry);
}
