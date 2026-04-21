// Pure permission-mask builder — no DB imports.
// Split from agentRunEditPermissionMask.ts so the pure test suite can
// import this file without triggering env/DB validation.
//
// Spec: tasks/live-agent-execution-log-spec.md §4.1a, §7.2.

import type { LinkedEntityType, PermissionMask } from '../../shared/types/agentExecutionLog.js';

export interface PermissionMaskUserContext {
  id: string;
  role: 'system_admin' | 'org_admin' | 'user' | string;
  organisationId: string;
  orgPermissions: ReadonlySet<string>;
  canManageWorkspace: boolean;
  canManageSkills: boolean;
  canEditAgents: boolean;
}

interface BuildMaskInput {
  entityType: LinkedEntityType | null;
  entityId: string | null;
  user: PermissionMaskUserContext;
  runOrganisationId: string;
  runSubaccountId: string | null;
}

const EMPTY_MASK: PermissionMask = {
  canView: false,
  canEdit: false,
  canViewPayload: false,
  viewHref: null,
  editHref: null,
};

export function buildPermissionMask(input: BuildMaskInput): PermissionMask {
  const { user, entityType, entityId, runOrganisationId, runSubaccountId } = input;

  const baseCanViewPayload =
    user.role === 'system_admin' || user.role === 'org_admin' || user.canEditAgents;

  if (!entityType || !entityId) {
    return {
      canView:
        user.role === 'system_admin' ||
        user.role === 'org_admin' ||
        user.orgPermissions.has('org.agents.view'),
      canEdit: false,
      canViewPayload: baseCanViewPayload,
      viewHref: null,
      editHref: null,
    };
  }

  if (user.role !== 'system_admin' && user.organisationId !== runOrganisationId) {
    return EMPTY_MASK;
  }

  const superUser = user.role === 'system_admin' || user.role === 'org_admin';
  const subaccountPrefix = runSubaccountId ? `/subaccounts/${runSubaccountId}` : '';

  switch (entityType) {
    case 'memory_entry':
      return {
        canView:
          superUser || user.canManageWorkspace || user.orgPermissions.has('org.workspace.view'),
        canEdit: superUser || user.canManageWorkspace,
        canViewPayload: baseCanViewPayload,
        viewHref: `${subaccountPrefix}/memory/${entityId}`,
        editHref:
          superUser || user.canManageWorkspace
            ? `${subaccountPrefix}/memory/${entityId}/edit`
            : null,
      };

    case 'memory_block':
      return {
        canView:
          superUser || user.canManageWorkspace || user.orgPermissions.has('org.workspace.view'),
        canEdit: superUser || user.canManageWorkspace,
        canViewPayload: baseCanViewPayload,
        viewHref: `${subaccountPrefix}/memory-blocks/${entityId}`,
        editHref:
          superUser || user.canManageWorkspace
            ? `${subaccountPrefix}/memory-blocks/${entityId}/edit`
            : null,
      };

    case 'policy_rule':
      return {
        canView:
          superUser || user.canManageWorkspace || user.orgPermissions.has('org.workspace.view'),
        canEdit: superUser || user.canManageWorkspace,
        canViewPayload: baseCanViewPayload,
        viewHref: `${subaccountPrefix}/rules/${entityId}`,
        editHref:
          superUser || user.canManageWorkspace
            ? `${subaccountPrefix}/rules/${entityId}/edit`
            : null,
      };

    case 'skill':
      return {
        canView:
          superUser || user.canManageSkills || user.orgPermissions.has('subaccount.skills.view'),
        canEdit: superUser || user.canManageSkills,
        canViewPayload: baseCanViewPayload,
        viewHref: `${subaccountPrefix}/skills/${entityId}`,
        editHref:
          superUser || user.canManageSkills
            ? `${subaccountPrefix}/skills/${entityId}/edit`
            : null,
      };

    case 'data_source':
      // No per-item data-source route exists in the client. Link to the
      // subaccount knowledge page (the closest parent page that lists
      // available context sources). editHref is null — there is no
      // dedicated edit route for individual data sources.
      return {
        canView: superUser || user.canEditAgents || user.orgPermissions.has('org.agents.view'),
        canEdit: false,
        canViewPayload: baseCanViewPayload,
        viewHref: runSubaccountId
          ? `/admin/subaccounts/${runSubaccountId}/knowledge`
          : null,
        editHref: null,
      };

    case 'agent':
      return {
        canView: superUser || user.canEditAgents || user.orgPermissions.has('org.agents.view'),
        canEdit: superUser || user.canEditAgents,
        canViewPayload: baseCanViewPayload,
        viewHref: `/admin/agents/${entityId}`,
        editHref: superUser || user.canEditAgents ? `/admin/agents/${entityId}` : null,
      };

    case 'prompt':
      return {
        canView: superUser || user.orgPermissions.has('org.agents.view'),
        canEdit: false,
        canViewPayload: baseCanViewPayload,
        viewHref: `/runs/prompt/${entityId}`,
        editHref: null,
      };

    case 'llm_request':
      return {
        canView: superUser || user.orgPermissions.has('org.agents.view'),
        canEdit: false,
        canViewPayload: baseCanViewPayload,
        viewHref: `/runs/llm-request/${entityId}`,
        editHref: null,
      };

    case 'action':
      return {
        canView: superUser || user.orgPermissions.has('org.review.view'),
        canEdit: false,
        canViewPayload: baseCanViewPayload,
        viewHref: `${subaccountPrefix}/review/actions/${entityId}`,
        editHref: null,
      };

    default: {
      const _unused: never = entityType;
      return EMPTY_MASK;
    }
  }
}
