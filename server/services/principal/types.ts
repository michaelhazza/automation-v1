export interface UserPrincipal {
  type: 'user';
  id: string;
  organisationId: string;
  subaccountId: string | null;
  teamIds: string[];
}

export interface ServicePrincipal {
  type: 'service';
  id: string;
  organisationId: string;
  subaccountId: string | null;
  serviceId: string;
  teamIds: string[];
}

export interface DelegatedPrincipal {
  type: 'delegated';
  id: string;
  organisationId: string;
  subaccountId: string | null;
  delegatingUserId: string;
  grantId: string;
  allowedTables: string[];
  allowedActions: string[];
  teamIds: string[];
}

export type PrincipalContext = UserPrincipal | ServicePrincipal | DelegatedPrincipal;
