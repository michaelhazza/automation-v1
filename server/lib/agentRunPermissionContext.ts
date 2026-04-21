// Shared helper to materialise a PermissionMaskUserContext /
// AgentRunVisibilityUser snapshot from an Express request + the target
// run. Used by server/routes/agentExecutionLog.ts + (future) the
// WebSocket join:agent-run handler.
//
// Spec: tasks/live-agent-execution-log-spec.md §7.1, §7.2, §7.3.

import type { Request } from 'express';
import { hasOrgPermission, hasSubaccountPermission } from '../middleware/auth.js';

export interface AgentRunResolvedContext {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  executionScope: 'subaccount' | 'org';
}

export interface AgentRunUserContext {
  id: string;
  role: 'system_admin' | 'org_admin' | 'user' | string;
  organisationId: string;
  orgPermissions: ReadonlySet<string>;
  /** `subaccountId → permission set` resolver — only called if needed. */
  subaccountPermissionsFor: (subaccountId: string) => ReadonlySet<string>;
  canManageWorkspace: boolean;
  canManageSkills: boolean;
  canEditAgents: boolean;
}

/**
 * Materialise a user-context snapshot for the permission mask + visibility
 * resolvers. Uses the request-scoped permission cache populated by the
 * existing `hasOrgPermission` / `hasSubaccountPermission` helpers, so this
 * stays O(1) on a warm cache.
 */
export async function buildUserContextForRun(
  req: Request,
  run: AgentRunResolvedContext,
): Promise<AgentRunUserContext> {
  const user = req.user;
  if (!user) {
    throw Object.assign(new Error('buildUserContextForRun: no user on request'), {
      statusCode: 401,
    });
  }

  // Force-populate the org-permission cache by calling hasOrgPermission with
  // a cheap key. Side-effect is that req._orgPermissionCache is hydrated.
  await hasOrgPermission(req, 'org.agents.view');
  const orgPermissions: ReadonlySet<string> =
    req._orgPermissionCache ?? new Set<string>();

  const isSuper = user.role === 'system_admin' || user.role === 'org_admin';

  // Workspace-manage: tier-aware. Subaccount-tier runs check subaccount
  // permission first; org-tier runs fall through to org permission.
  let canManageWorkspace = isSuper || orgPermissions.has('org.workspace.manage');
  let canManageSkills = isSuper || orgPermissions.has('subaccount.skills.manage');
  if (run.subaccountId) {
    canManageWorkspace =
      canManageWorkspace ||
      (await hasSubaccountPermission(req, run.subaccountId, 'subaccount.workspace.manage'));
    canManageSkills =
      canManageSkills ||
      (await hasSubaccountPermission(req, run.subaccountId, 'subaccount.skills.manage'));
  }

  const canEditAgents = isSuper || orgPermissions.has('org.agents.edit');

  return {
    id: user.id,
    role: user.role,
    organisationId: req.orgId ?? user.organisationId,
    orgPermissions,
    subaccountPermissionsFor: (_sub: string) => new Set<string>(),
    canManageWorkspace,
    canManageSkills,
    canEditAgents,
  };
}
