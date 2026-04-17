import type { PrincipalContext } from './types.js';

export interface VisibilityRow {
  organisationId: string;
  subaccountId: string | null;
  ownerUserId: string | null;
  visibilityScope: 'private' | 'shared_team' | 'shared_subaccount' | 'shared_org';
  sharedTeamIds: string[];
}

export function isVisibleTo(row: VisibilityRow, principal: PrincipalContext): boolean {
  if (row.organisationId !== principal.organisationId) return false;

  switch (principal.type) {
    case 'service':
      if (row.visibilityScope === 'private') return false;
      if (row.visibilityScope === 'shared_team') return false;
      if (row.visibilityScope === 'shared_subaccount') {
        return row.subaccountId === null || row.subaccountId === principal.subaccountId;
      }
      return true; // shared_org

    case 'user':
      switch (row.visibilityScope) {
        case 'private':
          return row.ownerUserId === principal.id;
        case 'shared_team':
          return row.sharedTeamIds.some((tid) => principal.teamIds.includes(tid));
        case 'shared_subaccount':
          return row.subaccountId === null || row.subaccountId === principal.subaccountId;
        case 'shared_org':
          return true;
      }
      break;

    case 'delegated':
      return row.visibilityScope === 'private' && row.ownerUserId === principal.id;
  }

  return false;
}
