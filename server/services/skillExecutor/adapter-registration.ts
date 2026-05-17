import { registerAdapter } from '../executionLayerService.js';
import { resolveActionSlug } from '../../config/actionRegistry.js';
import { createWorkerAdapter } from '../adapters/workerAdapter.js';
import type { SkillExecutionContext } from './context.js';
import {
  executeCreatePage,
  executeUpdatePage,
  executePublishPage,
} from './handlers/pages.js';
import {
  executeWriteSpecApproved,
  executePublishPostApproved,
  executeAdsActionApproved,
  executeCrmUpdateApproved,
  executeFinancialRecordUpdateApproved,
  executeLeadMagnetApproved,
  executeDeliverReportApproved,
  executeConfigureIntegrationApproved,
  executeDocProposalApproved,
  executeWriteDocsApproved,
} from './handlers/delegation.js';

// ---------------------------------------------------------------------------
// Register worker adapter for execution layer (handles review-gated worker actions)
// ---------------------------------------------------------------------------
registerAdapter('worker', createWorkerAdapter(async (rawActionType, payload, ctx) => {
  const context = ctx as unknown as SkillExecutionContext;
  // actionRegistry §1.3: every inbound action-slug surface MUST normalise via
  // resolveActionSlug so legacy slugs (e.g. config_update_hierarchy_template,
  // clientpulse.operator_alert) route to the current canonical handler. Without
  // this call, any review-gated action queued before the Session 1 renames is
  // silently dropped at the worker dispatch switch.
  const actionType = resolveActionSlug(rawActionType);
  switch (actionType) {
    case 'create_page': return executeCreatePage(payload, context);
    case 'update_page': return executeUpdatePage(payload, context);
    case 'publish_page': return executePublishPage(payload, context);
    case 'write_spec': return executeWriteSpecApproved(payload, context);
    case 'publish_post': return executePublishPostApproved(payload, context);
    case 'update_bid': return executeAdsActionApproved('update_bid', payload, context);
    case 'update_copy': return executeAdsActionApproved('update_copy', payload, context);
    case 'pause_campaign': return executeAdsActionApproved('pause_campaign', payload, context);
    case 'increase_budget': return executeAdsActionApproved('increase_budget', payload, context);
    case 'update_crm': return executeCrmUpdateApproved(payload, context);
    case 'update_financial_record': return executeFinancialRecordUpdateApproved(payload, context);
    case 'create_lead_magnet': return executeLeadMagnetApproved(payload, context);
    case 'deliver_report': return executeDeliverReportApproved(payload, context);
    case 'configure_integration': return executeConfigureIntegrationApproved(payload, context);
    case 'propose_doc_update': return executeDocProposalApproved(payload, context);
    case 'write_docs': return executeWriteDocsApproved(payload, context);

    // ── Phase 4.5 — config_update_organisation_config approval-execute ─────
    // When the operator approves a sensitive-path config change, re-validate
    // (drift check) and commit the merge + config_history row (B5 ship gate).
    case 'config_update_organisation_config': {
      const { executeApprovedOrganisationConfigUpdate } = await import('../configUpdateOrganisationService.js');
      const actionId = (ctx as unknown as { actionId?: string }).actionId ?? '';
      const result = await executeApprovedOrganisationConfigUpdate({
        actionId,
        organisationId: context.organisationId,
      });
      if (!result.success) {
        throw new Error(`${result.errorCode}: ${result.message}`);
      }
      return result;
    }

    // ── Session 2 — notify_operator fan-out (spec §7.3) ──────────────────
    case 'notify_operator': {
      const fanoutModule = await import('../notifyOperatorFanoutService.js');
      const alertPayload = payload as unknown as import('../notifyOperatorFanoutService.js').OperatorAlertPayload;
      const actionId = (context as unknown as { actionId?: string }).actionId ?? '';
      const fanoutResults = await fanoutModule.fanoutOperatorAlert({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        actionId,
        payload: alertPayload,
      });
      return {
        queued: true,
        channels: alertPayload.channels,
        fanoutResults,
      };
    }

    default: return { success: false, error: `No worker handler for: ${actionType}` };
  }
}));
