import type { WorkspaceIdentityStatus } from '../../../shared/types/workspace.js';

export type IdentityAction = 'activate' | 'suspend' | 'resume' | 'revoke' | 'archive';

const VALID_TRANSITIONS: Record<WorkspaceIdentityStatus, WorkspaceIdentityStatus[]> = {
  provisioned: ['active'],
  active: ['suspended', 'revoked', 'archived'],
  suspended: ['active', 'revoked', 'archived'],
  revoked: ['archived'],
  archived: [],
};

const ACTION_TARGETS: Record<IdentityAction, WorkspaceIdentityStatus> = {
  activate: 'active',
  suspend: 'suspended',
  resume: 'active',
  revoke: 'revoked',
  archive: 'archived',
};

export function canTransition(from: WorkspaceIdentityStatus, to: WorkspaceIdentityStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function nextStatus(from: WorkspaceIdentityStatus, action: IdentityAction): WorkspaceIdentityStatus {
  const target = ACTION_TARGETS[action];
  if (!canTransition(from, target)) {
    throw new Error(`Forbidden transition ${from} -> ${target} via ${action}`);
  }
  return target;
}
