export interface DelegationGrant {
  id: string;
  grantorUserId: string;
  granteeKind: 'user' | 'service';
  granteeId: string;
  allowedCanonicalTables: string[];
  allowedActions: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

export type GrantValidation =
  | { permitted: true }
  | { permitted: false; reason: string };

export function validateGrant(
  grant: DelegationGrant,
  action: string,
  table: string,
  now: Date,
): GrantValidation {
  if (grant.revokedAt !== null) {
    return { permitted: false, reason: 'Grant has been revoked' };
  }

  if (now >= grant.expiresAt) {
    return { permitted: false, reason: 'Grant has expired' };
  }

  if (!grant.allowedCanonicalTables.includes(table) && !grant.allowedCanonicalTables.includes('*')) {
    return { permitted: false, reason: `Table ${table} not in allowed tables` };
  }

  if (!grant.allowedActions.includes(action) && !grant.allowedActions.includes('*')) {
    return { permitted: false, reason: `Action ${action} not in allowed actions` };
  }

  return { permitted: true };
}
