export type InterventionActionType =
  | 'crm.fire_automation'
  | 'crm.send_email'
  | 'crm.send_sms'
  | 'crm.create_task'
  | 'notify_operator';

export interface InterventionContext {
  subaccount: { id: string; name: string };
  band: 'healthy' | 'watch' | 'atRisk' | 'critical' | null;
  healthScore: number | null;
  healthScoreDelta7d: number | null;
  topSignals: Array<{ signal: string; contribution: number }>;
  recentInterventions: Array<{
    id: string;
    actionType: string;
    status: string;
    occurredAt: string;
    templateSlug: string | null;
  }>;
  cooldownState: { blocked: boolean; reason?: string };
  recommendedActionType: InterventionActionType | null;
  recommendedReason: 'outcome_weighted' | 'priority_fallback' | 'no_candidates' | null;
}
