/**
 * measureInterventionOutcomeJobPure — pure helpers for the B2 outcome job.
 *
 * Extracted so the measurement-window + outcome-row-builder logic can be
 * exercised with a deterministic unit test (B2 ship-gate end-to-end fixture
 * lives here). No DB / no env in this module.
 */

export interface ActionRowForMeasurement {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  actionType: string;
  status: 'completed' | 'failed';
  executedAt: Date;
  metadata: {
    triggerTemplateSlug?: string;
    healthScoreAtProposal?: number;
    bandAtProposal?: string;
    configVersion?: string;
  };
}

export interface PostWindowSnapshotForMeasurement {
  score: number;
  observedAt: Date;
}

export interface PostWindowAssessmentForMeasurement {
  band: string;
  observedAt: Date;
}

export interface OutcomeRecordArgs {
  organisationId: string;
  interventionId: string;
  accountId: string;
  interventionTypeSlug: string;
  healthScoreBefore?: number;
  healthScoreAfter?: number;
  measuredAfterHours: number;
  triggerEventId?: string;
  configVersion?: string;
  bandBefore?: string;
  bandAfter?: string;
  executionFailed: boolean;
}

export interface MeasurementDecision {
  kind: 'measure' | 'too_early' | 'no_post_snapshot';
  windowEnds: Date;
  recordArgs?: OutcomeRecordArgs;
}

const DEFAULT_WINDOW_HOURS = 24;

/**
 * Decide whether to measure the given action, and if so, build the args
 * for interventionService.recordOutcome(). Pure — callers inject all the
 * state (action row, post-window snapshot/assessment, account id, now).
 */
export function decideOutcomeMeasurement(params: {
  action: ActionRowForMeasurement;
  accountId: string | null;
  measurementWindowHours?: number;
  postSnapshot?: PostWindowSnapshotForMeasurement;
  postAssessment?: PostWindowAssessmentForMeasurement;
  now: Date;
}): MeasurementDecision {
  const windowHours = params.measurementWindowHours ?? DEFAULT_WINDOW_HOURS;
  const windowEnds = new Date(
    params.action.executedAt.getTime() + windowHours * 60 * 60 * 1000,
  );

  if (windowEnds > params.now) {
    return { kind: 'too_early', windowEnds };
  }
  if (!params.accountId) {
    return { kind: 'no_post_snapshot', windowEnds };
  }
  // For non-operator-alert primitives a post-window snapshot is required; without
  // it we can't compute a delta, so we wait. Operator alerts have no signal to
  // measure — we still write an outcome row with null delta so cooldown logic
  // respects the firing.
  const isOperatorAlert = params.action.actionType === 'clientpulse.operator_alert';
  if (!params.postSnapshot && !isOperatorAlert) {
    return { kind: 'no_post_snapshot', windowEnds };
  }

  return {
    kind: 'measure',
    windowEnds,
    recordArgs: {
      organisationId: params.action.organisationId,
      interventionId: params.action.id,
      accountId: params.accountId,
      // Use the template slug when available so cooldown lookups in
      // checkCooldown() (which key on template.slug) find this outcome row.
      // Fall back to actionType for actions created without a template.
      interventionTypeSlug: params.action.metadata.triggerTemplateSlug ?? params.action.actionType,
      healthScoreBefore: params.action.metadata.healthScoreAtProposal,
      healthScoreAfter: params.postSnapshot?.score,
      measuredAfterHours: windowHours,
      triggerEventId: params.action.id,
      configVersion: params.action.metadata.configVersion,
      bandBefore: params.action.metadata.bandAtProposal,
      bandAfter: params.postAssessment?.band,
      executionFailed: params.action.status === 'failed',
    },
  };
}

/**
 * Classify the outcome (improved/unchanged/worsened) based on the health-score
 * delta. Mirrors the threshold used by interventionService.recordOutcome.
 */
export function classifyOutcome(
  before: number | undefined,
  after: number | undefined,
): 'improved' | 'unchanged' | 'worsened' | undefined {
  if (before == null || after == null) return undefined;
  const delta = after - before;
  if (delta > 5) return 'improved';
  if (delta < -5) return 'worsened';
  return 'unchanged';
}
