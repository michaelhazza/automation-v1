import type { SkillExecutionContext } from '../context.js';
import { taskService } from '../../taskService.js';

// ---------------------------------------------------------------------------
// write_spec — post-approval executor
// ---------------------------------------------------------------------------

export async function executeWriteSpecApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(payload.task_id ?? '');
  const specContent = String(payload.spec_content ?? '');
  const reasoning = String(payload.reasoning ?? '');
  const storiesCount = Number(payload.user_stories_count ?? 0);
  const acCount = Number(payload.ac_count ?? 0);

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!specContent) return { success: false, error: 'spec_content is required' };

  let version = 1;
  try {
    const existing = await taskService.listActivities(taskId, context.organisationId);
    const priorSpecs = existing.filter((a: { activityType: string; message: string }) =>
      a.activityType === 'note' && a.message.startsWith('SPEC_APPROVED:')
    );
    version = priorSpecs.length + 1;
  } catch { /* treat as first version */ }

  const specReferenceId = `SPEC-${taskId}-v${version}`;

  try {
    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'note',
      message: `SPEC_APPROVED:${specReferenceId}\n\n${specContent}`,
      agentId: context.agentId,
    });

    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'completed',
      message: `Requirements spec approved.\nReference: ${specReferenceId}\nStories: ${storiesCount} | ACs: ${acCount}\nReasoning: ${reasoning}`,
      agentId: context.agentId,
    });

    await taskService.updateTask(taskId, context.organisationId, { status: 'spec-approved' });

    return {
      success: true,
      spec_reference_id: specReferenceId,
      task_id: taskId,
      message: `Spec ${specReferenceId} approved and written to workspace memory. Task status updated to spec-approved.`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to persist approved spec: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// executePublishPostApproved
// ---------------------------------------------------------------------------

export async function executePublishPostApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const platform = String(payload.platform ?? '');
  const postContent = String(payload.post_content ?? '');
  const scheduleAt = payload.schedule_at ? String(payload.schedule_at) : null;
  const campaignTag = payload.campaign_tag ? String(payload.campaign_tag) : null;
  const reasoning = String(payload.reasoning ?? '');

  if (!platform) return { success: false, error: 'platform is required' };
  if (!postContent) return { success: false, error: 'post_content is required' };

  if (context.taskId) {
    try {
      const logMsg = [
        `PUBLISH_POST_APPROVED:${platform}`,
        `campaign: ${campaignTag ?? 'none'}`,
        scheduleAt ? `scheduled: ${scheduleAt}` : 'publish: immediate',
        `reasoning: ${reasoning}`,
        `---\n${postContent}`,
      ].join('\n');

      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: logMsg,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    platform,
    publish_status: 'pending_integration',
    scheduled_for: scheduleAt,
    campaign_tag: campaignTag,
    message: `Publish approved for ${platform}. Platform integration not yet connected — action logged. When integration is live, this will ${scheduleAt ? `schedule the post for ${scheduleAt}` : 'publish immediately'}.`,
  };
}

// ---------------------------------------------------------------------------
// executeAdsActionApproved
// ---------------------------------------------------------------------------

export async function executeAdsActionApproved(
  actionType: string,
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const platform = String(payload.platform ?? '');
  const campaignId = String(payload.campaign_id ?? '');
  const campaignName = String(payload.campaign_name ?? '');
  const reasoning = String(payload.reasoning ?? '');

  if (!platform) return { success: false, error: 'platform is required' };
  if (!campaignId) return { success: false, error: 'campaign_id is required' };

  if (context.taskId) {
    try {
      const logMsg = [
        `ADS_ACTION_APPROVED:${actionType}`,
        `platform: ${platform}`,
        `campaign_id: ${campaignId}`,
        `campaign: ${campaignName}`,
        `reasoning: ${reasoning}`,
      ].join('\n');

      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: logMsg,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    action_type: actionType,
    platform,
    campaign_id: campaignId,
    status: 'pending_integration',
    message: `${actionType} approved for campaign ${campaignName} on ${platform}. Platform integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeCrmUpdateApproved
// ---------------------------------------------------------------------------

export async function executeCrmUpdateApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const recordType = String(payload.record_type ?? '');
  const recordId = String(payload.record_id ?? '');
  const recordIdentifier = String(payload.record_identifier ?? '');
  const updates = payload.updates as Record<string, unknown> ?? {};
  const reasoning = String(payload.reasoning ?? '');

  if (!recordType) return { success: false, error: 'record_type is required' };
  if (!recordId) return { success: false, error: 'record_id is required' };

  if (context.taskId) {
    try {
      const fieldsUpdated = Object.keys(updates).join(', ');
      const logMsg = [
        `CRM_UPDATE_APPROVED:${recordType}:${recordId}`,
        `identifier: ${recordIdentifier}`,
        `fields: ${fieldsUpdated}`,
        `reasoning: ${reasoning}`,
      ].join('\n');

      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: logMsg,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    record_type: recordType,
    record_id: recordId,
    fields_updated: Object.keys(updates),
    status: 'pending_integration',
    message: `CRM update approved for ${recordType} ${recordIdentifier}. Integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeFinancialRecordUpdateApproved
// ---------------------------------------------------------------------------

export async function executeFinancialRecordUpdateApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const recordType = String(payload.record_type ?? '');
  const recordDescription = String(payload.record_description ?? '');
  const updates = payload.updates as Record<string, unknown> ?? {};
  const reasoning = String(payload.reasoning ?? '');

  if (!recordType) return { success: false, error: 'record_type is required' };

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: [
          `FINANCIAL_RECORD_UPDATE_APPROVED:${recordType}`,
          `description: ${recordDescription}`,
          `fields: ${Object.keys(updates).join(', ')}`,
          `reasoning: ${reasoning}`,
        ].join('\n'),
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    record_type: recordType,
    fields_written: Object.keys(updates),
    status: 'pending_integration',
    message: `Financial record update approved (${recordType}: ${recordDescription}). Accounting integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// executeLeadMagnetApproved
// ---------------------------------------------------------------------------

export async function executeLeadMagnetApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const assetType = String(payload.asset_type ?? '');
  const topic = String(payload.topic ?? '');
  const reasoning = String(payload.reasoning ?? '');

  if (!assetType) return { success: false, error: 'asset_type is required' };

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `LEAD_MAGNET_APPROVED:${assetType}\ntopic: ${topic}\nreasoning: ${reasoning}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    asset_type: assetType,
    topic,
    status: 'approved',
    message: `Lead magnet approved (${assetType}: ${topic}). Attach to task deliverables via add_deliverable.`,
  };
}

// ---------------------------------------------------------------------------
// executeDeliverReportApproved
// ---------------------------------------------------------------------------

export async function executeDeliverReportApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const reportTitle = String(payload.report_title ?? '');
  const clientName = String(payload.client_name ?? '');
  const clientEmail = String(payload.client_email ?? '');
  const deliveryChannel = String(payload.delivery_channel ?? 'email');
  const reportingPeriod = payload.reporting_period ? String(payload.reporting_period) : null;

  if (!reportTitle) return { success: false, error: 'report_title is required' };
  if (!clientEmail) return { success: false, error: 'client_email is required' };

  const deliveredAt = new Date().toISOString();

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: [
          `REPORT_DELIVERED:${reportTitle}`,
          `client: ${clientName} <${clientEmail}>`,
          `channel: ${deliveryChannel}`,
          reportingPeriod ? `period: ${reportingPeriod}` : '',
          `delivered_at: ${deliveredAt}`,
        ].filter(Boolean).join('\n'),
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    client_name: clientName,
    delivery_channel: deliveryChannel,
    delivered_at: deliveredAt,
    status: 'pending_integration',
    message: `Report delivery approved for ${clientName} via ${deliveryChannel}. Delivery integration not yet connected — action logged.`,
  };
}

// ---------------------------------------------------------------------------
// redactSensitiveFields helper
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERN = /(^|_)(key|secret|token|password|credential|auth|bearer)|api_key|client_secret|access_token|refresh_token/i;

export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// executeConfigureIntegrationApproved
// ---------------------------------------------------------------------------

export async function executeConfigureIntegrationApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const integrationType = String(payload.integration_type ?? '');
  const providerName = String(payload.provider_name ?? '');
  const reasoning = String(payload.reasoning ?? '');
  const configuration = (payload.configuration as Record<string, unknown>) ?? {};

  if (!integrationType) return { success: false, error: 'integration_type is required' };
  if (!providerName) return { success: false, error: 'provider_name is required' };

  const redactedConfig = redactSensitiveFields(configuration);

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `INTEGRATION_APPROVED:${integrationType}:${providerName}\nreasoning: ${reasoning}\nconfig: ${JSON.stringify(redactedConfig)}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    integration_type: integrationType,
    provider_name: providerName,
    configuration: redactedConfig,
    status: 'pending_integration',
    message: `Integration configuration approved (${integrationType}: ${providerName}). Integration storage not yet connected — configuration logged with credentials redacted.`,
  };
}

// ---------------------------------------------------------------------------
// executeDocProposalApproved
// ---------------------------------------------------------------------------

export async function executeDocProposalApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageTitle = String(payload.page_title ?? '');
  const changeType = String(payload.change_type ?? '');
  const changesCount = Array.isArray(payload.proposed_changes) ? payload.proposed_changes.length : 0;

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `DOC_PROPOSAL_APPROVED:${pageTitle}\nchange_type: ${changeType}\nchanges: ${changesCount}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    page_title: pageTitle,
    changes_approved: changesCount,
    message: `Doc update proposal approved for "${pageTitle}". Invoke write_docs with the full updated content to apply the changes.`,
  };
}

// ---------------------------------------------------------------------------
// executeWriteDocsApproved
// ---------------------------------------------------------------------------

export async function executeWriteDocsApproved(
  payload: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const pageTitle = String(payload.page_title ?? '');
  const changeSummary = String(payload.change_summary ?? '');
  const reasoning = String(payload.reasoning ?? '');

  if (!pageTitle) return { success: false, error: 'page_title is required' };

  if (context.taskId) {
    try {
      await taskService.addActivity(context.taskId, context.organisationId, {
        activityType: 'note',
        message: `DOCS_WRITE_APPROVED:${pageTitle}\nchange_summary: ${changeSummary}\nreasoning: ${reasoning}`,
        agentId: context.agentId,
      });
    } catch { /* non-fatal */ }
  }

  return {
    success: true,
    page_title: pageTitle,
    status: 'pending_integration',
    message: `Documentation write approved for "${pageTitle}". Documentation integration not yet connected — update logged.`,
  };
}
