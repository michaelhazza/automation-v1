import type { SkillHandler } from '../context.js';
import { executeWithActionAudit, proposeReviewGatedAction } from '../gating.js';

export const orgInsightHandlers: Record<string, SkillHandler> = {
  assign_task: async (input, context) => {
    const { executeAssignTask } = await import('../../../tools/internal/assignTask.js');
    return executeWithActionAudit('assign_task', input, context, () =>
      executeAssignTask(input, { runId: context.runId, organisationId: context.organisationId, subaccountId: context.subaccountId!, agentId: context.agentId }),
    );
  },
  query_subaccount_cohort: async (input, context) => {
    const { executeQuerySubaccountCohort } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('query_subaccount_cohort', input, context, () =>
      executeQuerySubaccountCohort(input, context));
  },
  read_org_insights: async (input, context) => {
    const { executeReadOrgInsights } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('read_org_insights', input, context, () =>
      executeReadOrgInsights(input, context));
  },
  write_org_insight: async (input, context) => {
    const { executeWriteOrgInsight } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('write_org_insight', input, context, () =>
      executeWriteOrgInsight(input, context));
  },
  compute_health_score: async (input, context) => {
    const { executeComputeHealthScore } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('compute_health_score', input, context, () =>
      executeComputeHealthScore(input, context));
  },
  detect_anomaly: async (input, context) => {
    const { executeDetectAnomaly } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('detect_anomaly', input, context, () =>
      executeDetectAnomaly(input, context));
  },
  compute_churn_risk: async (input, context) => {
    const { executeComputeChurnRisk } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('compute_churn_risk', input, context, () =>
      executeComputeChurnRisk(input, context));
  },
  compute_staff_activity_pulse: async (input, context) => {
    const { executeComputeStaffActivityPulse } = await import('../../computeStaffActivityPulseService.js');
    return executeWithActionAudit('compute_staff_activity_pulse', input, context, async () => {
      const subaccountId = (input.subaccount_id as string | undefined) ?? context.subaccountId;
      if (!subaccountId) throw new Error('subaccount_id is required');
      return executeComputeStaffActivityPulse({
        organisationId: context.organisationId,
        subaccountId,
        sourceRunId: input.source_run_id as string | undefined,
      });
    });
  },
  scan_integration_fingerprints: async (input, context) => {
    const { executeScanIntegrationFingerprints } = await import('../../scanIntegrationFingerprintsService.js');
    return executeWithActionAudit('scan_integration_fingerprints', input, context, async () => {
      const subaccountId = (input.subaccount_id as string | undefined) ?? context.subaccountId;
      if (!subaccountId) throw new Error('subaccount_id is required');
      return executeScanIntegrationFingerprints({
        organisationId: context.organisationId,
        subaccountId,
        sourceRunId: input.source_run_id as string | undefined,
      });
    });
  },
  generate_portfolio_report: async (input, context) => {
    const { executeGeneratePortfolioReport } = await import('../../intelligenceSkillExecutor.js');
    return executeWithActionAudit('generate_portfolio_report', input, context, () =>
      executeGeneratePortfolioReport(input, context));
  },
  trigger_account_intervention: async (input, context) => {
    return proposeReviewGatedAction('trigger_account_intervention', input, context);
  },
};
