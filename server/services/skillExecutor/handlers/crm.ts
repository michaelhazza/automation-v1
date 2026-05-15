import type { SkillHandler } from '../context.js';
import { proposeReviewGatedAction, executeWithActionAudit } from '../gating.js';

export const crmHandlers: Record<string, SkillHandler> = {
  'crm.fire_automation': async (input, context) => {
    return proposeReviewGatedAction('crm.fire_automation', input, context);
  },
  'crm.send_email': async (input, context) => {
    return proposeReviewGatedAction('crm.send_email', input, context);
  },
  'crm.send_sms': async (input, context) => {
    return proposeReviewGatedAction('crm.send_sms', input, context);
  },
  'crm.create_task': async (input, context) => {
    return proposeReviewGatedAction('crm.create_task', input, context);
  },
  'crm.query': async (input, context) => {
    const suppliedSubaccountId = typeof input.subaccountId === 'string' && input.subaccountId.length > 0
      ? input.subaccountId
      : null;
    const targetSubaccountId = suppliedSubaccountId ?? context.subaccountId;

    if (!targetSubaccountId) {
      return {
        success: false,
        error:   'missing_permission',
        message: 'crm.query requires a subaccount — supply input.subaccountId or bind the agent to a subaccount.',
      };
    }

    if (suppliedSubaccountId && suppliedSubaccountId !== context.subaccountId) {
      const allowed = context.allowedSubaccountIds;
      const isOrgScope = allowed === null || allowed === undefined;
      const inAllowlist = Array.isArray(allowed) && allowed.includes(suppliedSubaccountId);
      if (!isOrgScope && !inAllowlist) {
        return {
          success: false,
          error:   'missing_permission',
          message: 'Agent is not authorised to read the specified subaccount.',
        };
      }
    }

    const { runQuery } = await import('../../crmQueryPlanner/index.js');
    const result = await runQuery(
      {
        rawIntent:    String(input.rawIntent ?? ''),
        subaccountId: targetSubaccountId,
        briefId:      typeof input.briefId === 'string' ? input.briefId : undefined,
      },
      {
        orgId:                  context.organisationId,
        organisationId:         context.organisationId,
        subaccountId:           targetSubaccountId,
        runId:                  context.runId,
        briefId:                typeof input.briefId === 'string' ? input.briefId : undefined,
        principalType:          'agent',
        principalId:            context.agentId,
        teamIds:                [],
        callerCapabilities:     new Set<string>(['crm.query']),
        defaultSenderIdentifier: undefined,
      },
    );
    return { success: true, ...result };
  },
  read_crm: async (input, context) => {
    const crmQueryType = typeof input.query_type === 'string' ? input.query_type : '';
    return executeWithActionAudit('read_crm', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      query_type: crmQueryType,
      records: [],
      message: 'CRM integration not configured. Downstream analyse_pipeline, detect_churn_risk, and draft_followup should handle stub status by noting data unavailability.',
    }));
  },
  update_crm: async (input, context) => {
    return proposeReviewGatedAction('update_crm', input, context);
  },
};

