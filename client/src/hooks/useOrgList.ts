import { useState, useEffect } from 'react';
import api from '../lib/api';
import type { OrgOption } from './useLayoutIdentity';

export interface OrgList {
  orgs: OrgOption[];
}

export function useOrgList(isSystemAdmin: boolean): OrgList {
  const [orgs, setOrgs] = useState<OrgOption[]>([]);

  // Fetch orgs list (system admin)
  useEffect(() => {
    if (isSystemAdmin) {
      api.get('/api/organisations').then(({ data }) => setOrgs(data)).catch((err) => console.error('[Layout] Failed to fetch organisations:', err));
    }
  }, [isSystemAdmin]);

  if (!isSystemAdmin) return { orgs: [] };

  return { orgs };
}
