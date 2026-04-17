import type { UserPrincipal, ServicePrincipal, DelegatedPrincipal } from './types.js';

export interface BuildUserPrincipalArgs {
  userId: string;
  organisationId: string;
  subaccountId: string | null;
  teamIds: string[];
}

export function buildUserPrincipal(args: BuildUserPrincipalArgs): UserPrincipal {
  return {
    type: 'user',
    id: args.userId,
    organisationId: args.organisationId,
    subaccountId: args.subaccountId,
    teamIds: args.teamIds,
  };
}

export interface BuildServicePrincipalArgs {
  organisationId: string;
  subaccountId: string | null;
  serviceId: string;
  teamIds?: string[];
}

export function buildServicePrincipal(args: BuildServicePrincipalArgs): ServicePrincipal {
  return {
    type: 'service',
    id: args.serviceId,
    organisationId: args.organisationId,
    subaccountId: args.subaccountId,
    serviceId: args.serviceId,
    teamIds: args.teamIds ?? [],
  };
}

export interface BuildDelegatedPrincipalArgs {
  organisationId: string;
  subaccountId: string | null;
  delegatingUserId: string;
  grantId: string;
  allowedTables: string[];
  allowedActions: string[];
  teamIds?: string[];
}

export function buildDelegatedPrincipal(args: BuildDelegatedPrincipalArgs): DelegatedPrincipal {
  return {
    type: 'delegated',
    id: args.delegatingUserId,
    organisationId: args.organisationId,
    subaccountId: args.subaccountId,
    delegatingUserId: args.delegatingUserId,
    grantId: args.grantId,
    allowedTables: args.allowedTables,
    allowedActions: args.allowedActions,
    teamIds: args.teamIds ?? [],
  };
}
