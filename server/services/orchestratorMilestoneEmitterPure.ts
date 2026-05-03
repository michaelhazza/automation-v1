/**
 * orchestratorMilestoneEmitterPure.ts — pure classifier for milestone events.
 *
 * Decides whether a given raw event kind is milestone-worthy (surfaced to the
 * operator in the chat/activity feed) or is just narration (stays in the
 * activity log only).
 *
 * Spec: docs/workflows-dev-spec.md §9.2 / §13
 * No I/O — safe to unit-test without any mocks.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type MilestoneCategory =
  | 'file_produced'
  | 'decision_made'
  | 'handoff_complete'
  | 'plan_changed'
  | 'narration';

// ─── Classification map ───────────────────────────────────────────────────────

/**
 * Event kinds that always map to a fixed category regardless of payload.
 * Everything not in this map defaults to 'narration'.
 */
const KIND_TO_CATEGORY: Readonly<Record<string, MilestoneCategory>> = {
  // File operations
  'file.created': 'file_produced',
  'file.edited': 'file_produced',

  // Decisions
  'approval.decided': 'decision_made',
  'step.branch_decided': 'decision_made',

  // Delegation / handoff
  'agent.delegation.closed': 'handoff_complete',

  // Plan changes (routing / queueing events that represent material plan changes)
  'task.routed': 'plan_changed',
  'step.queued': 'plan_changed',
};

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Classify a raw task event into a milestone category.
 *
 * The `eventPayload` parameter is accepted for forward-compatibility (future
 * rules may inspect payload fields) but is not currently used — the kind alone
 * determines the category in V1.
 */
export function classifyForMilestone(input: {
  eventKind: string;
  eventPayload: unknown;
}): MilestoneCategory {
  return KIND_TO_CATEGORY[input.eventKind] ?? 'narration';
}
