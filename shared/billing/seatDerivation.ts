import type { WorkspaceIdentityStatus } from '../types/workspace.js';

export function deriveSeatConsumption(status: WorkspaceIdentityStatus): boolean {
  return status === 'active';
}

export function countActiveIdentities(
  identities: { status: WorkspaceIdentityStatus }[],
): number {
  return identities.filter((i) => deriveSeatConsumption(i.status)).length;
}
