import type { SkillHandler } from '../context.js';
import { executeWithActionAudit } from '../gating.js';

export const configShellHandlers: Record<string, SkillHandler> = {
  // ── Configuration Assistant: mutation tools (review-gated via action registry) ──
  config_create_agent: async (input, context) => {
    const { executeConfigCreateAgent } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_create_agent', input, context, () => executeConfigCreateAgent(input, context));
  },
  config_update_agent: async (input, context) => {
    const { executeConfigUpdateAgent } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_agent', input, context, () => executeConfigUpdateAgent(input, context));
  },
  config_activate_agent: async (input, context) => {
    const { executeConfigActivateAgent } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_activate_agent', input, context, () => executeConfigActivateAgent(input, context));
  },
  config_link_agent: async (input, context) => {
    const { executeConfigLinkAgent } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_link_agent', input, context, () => executeConfigLinkAgent(input, context));
  },
  config_update_link: async (input, context) => {
    const { executeConfigUpdateLink } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_link', input, context, () => executeConfigUpdateLink(input, context));
  },
  config_set_link_skills: async (input, context) => {
    const { executeConfigSetLinkSkills } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_skills', input, context, () => executeConfigSetLinkSkills(input, context));
  },
  config_set_link_instructions: async (input, context) => {
    const { executeConfigSetLinkInstructions } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_instructions', input, context, () => executeConfigSetLinkInstructions(input, context));
  },
  config_set_link_schedule: async (input, context) => {
    const { executeConfigSetLinkSchedule } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_schedule', input, context, () => executeConfigSetLinkSchedule(input, context));
  },
  config_set_link_limits: async (input, context) => {
    const { executeConfigSetLinkLimits } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_set_link_limits', input, context, () => executeConfigSetLinkLimits(input, context));
  },
  config_create_subaccount: async (input, context) => {
    const { executeConfigCreateSubaccount } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_create_subaccount', input, context, () => executeConfigCreateSubaccount(input, context));
  },
  config_create_scheduled_task: async (input, context) => {
    const { executeConfigCreateScheduledTask } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_create_scheduled_task', input, context, () => executeConfigCreateScheduledTask(input, context));
  },
  config_update_scheduled_task: async (input, context) => {
    const { executeConfigUpdateScheduledTask } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_scheduled_task', input, context, () => executeConfigUpdateScheduledTask(input, context));
  },
  config_attach_data_source: async (input, context) => {
    const { executeConfigAttachDataSource } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_attach_data_source', input, context, () => executeConfigAttachDataSource(input, context));
  },
  config_update_data_source: async (input, context) => {
    const { executeConfigUpdateDataSource } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_update_data_source', input, context, () => executeConfigUpdateDataSource(input, context));
  },
  config_remove_data_source: async (input, context) => {
    const { executeConfigRemoveDataSource } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_remove_data_source', input, context, () => executeConfigRemoveDataSource(input, context));
  },
  config_restore_version: async (input, context) => {
    const { executeConfigRestoreVersion } = await import('../../../tools/config/configSkillHandlers.js');
    return executeWithActionAudit('config_restore_version', input, context, () => executeConfigRestoreVersion(input, context));
  },

  // ── Configuration Assistant: read-only tools (no action audit needed) ──
  config_list_agents: async (input, context) => {
    const { executeConfigListAgents } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListAgents(input, context);
  },
  config_list_subaccounts: async (input, context) => {
    const { executeConfigListSubaccounts } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListSubaccounts(input, context);
  },
  config_list_links: async (input, context) => {
    const { executeConfigListLinks } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListLinks(input, context);
  },
  config_list_scheduled_tasks: async (input, context) => {
    const { executeConfigListScheduledTasks } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListScheduledTasks(input, context);
  },
  config_list_data_sources: async (input, context) => {
    const { executeConfigListDataSources } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListDataSources(input, context);
  },
  config_list_system_skills: async (input, context) => {
    const { executeConfigListSystemSkills } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListSystemSkills(input, context);
  },
  config_list_org_skills: async (input, context) => {
    const { executeConfigListOrgSkills } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigListOrgSkills(input, context);
  },
  config_get_agent_detail: async (input, context) => {
    const { executeConfigGetAgentDetail } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigGetAgentDetail(input, context);
  },
  config_get_link_detail: async (input, context) => {
    const { executeConfigGetLinkDetail } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigGetLinkDetail(input, context);
  },

  // ── Configuration Assistant: validation and history tools ──
  config_run_health_check: async (input, context) => {
    const { executeConfigRunHealthCheck } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigRunHealthCheck(input, context);
  },
  config_preview_plan: async (input, context) => {
    const { executeConfigPreviewPlan } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigPreviewPlan(input, context);
  },
  config_view_history: async (input, context) => {
    const { executeConfigViewHistory } = await import('../../../tools/config/configSkillHandlers.js');
    return executeConfigViewHistory(input, context);
  },

  // ── Workflow portal / email skills ──
  config_publish_workflow_output_to_portal: async (input, context) => {
    const { executeConfigPublishWorkflowOutputToPortal } = await import('../../../tools/config/workflowSkillHandlers.js');
    return executeWithActionAudit('config_publish_workflow_output_to_portal', input, context, () => executeConfigPublishWorkflowOutputToPortal(input, context));
  },
  config_send_workflow_email_digest: async (input, context) => {
    const { executeConfigSendWorkflowEmailDigest } = await import('../../../tools/config/workflowSkillHandlers.js');
    return executeWithActionAudit('config_send_workflow_email_digest', input, context, () => executeConfigSendWorkflowEmailDigest(input, context));
  },

  // ── Organisation config update (Phase 4.5) ──
  config_update_organisation_config: async (input, context) => {
    const { applyOrganisationConfigUpdate } = await import('../../configUpdateOrganisationService.js');
    return applyOrganisationConfigUpdate({
      organisationId: context.organisationId,
      path: input.path as string,
      value: input.value,
      reason: (input.reason as string) ?? 'config_agent write',
      sourceSession: (input.sourceSession as string | null | undefined) ?? null,
      changedByUserId: (context.userId as string | undefined) ?? null,
      agentId: context.agentId,
    });
  },

  // ── Workflow delivery skill ──
  config_deliver_workflow_output: async (input, context) => {
    const { deliveryService } = await import('../../deliveryService.js');
    const {
      subaccountId,
      organisationId,
      artefactTitle,
      artefactContent,
      deliveryChannels,
    } = input as Record<string, unknown>;

    if (!subaccountId || !organisationId || !artefactTitle || !artefactContent) {
      return { success: false, error: 'subaccountId, organisationId, artefactTitle, artefactContent required' };
    }

    const config =
      (deliveryChannels as { email?: boolean; portal?: boolean; slack?: boolean } | undefined) ??
      { email: true, portal: true, slack: false };

    const result = await deliveryService.deliver(
      {
        title: String(artefactTitle),
        content: String(artefactContent),
        createdByAgentId: context.agentId,
      },
      {
        email: Boolean(config.email ?? true),
        portal: Boolean(config.portal ?? true),
        slack: Boolean(config.slack ?? false),
      },
      String(subaccountId),
      String(organisationId),
    );

    return {
      success: true,
      taskId: result.taskId,
      channels: result.channels,
    };
  },

  // ── Weekly digest gather ──
  config_weekly_digest_gather: async (input) => {
    const { executeWeeklyDigestGather } = await import('../../../tools/internal/weeklyDigestGather.js');
    return executeWeeklyDigestGather(input);
  },
};
