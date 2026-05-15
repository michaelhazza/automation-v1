import { useState, useEffect } from 'react';
import api from '../lib/api';

interface PermissionsInput {
  isSystemAdmin: boolean;
  hasOrgContext: boolean;
  activeOrgId: string | null;
  activeClientId: string | null;
}

export interface LayoutPermissions {
  hasAnyOrgPerm: boolean;
  hasOrgPerm(key: string): boolean;
  hasClientPerm(key: string): boolean;
}

export function useLayoutPermissions({
  isSystemAdmin,
  hasOrgContext,
  activeOrgId,
  activeClientId,
}: PermissionsInput): LayoutPermissions {
  const [orgPerms, setOrgPerms] = useState<Set<string>>(new Set());
  const [clientPerms, setClientPerms] = useState<Set<string>>(new Set());

  // Fetch org permissions
  useEffect(() => {
    if (isSystemAdmin) { setOrgPerms(new Set(['__system_admin__'])); return; }
    if (hasOrgContext) {
      api.get('/api/my-permissions').then(({ data }) => setOrgPerms(new Set(data.permissions))).catch((err) => { console.error('[Layout] Failed to fetch org permissions:', err); setOrgPerms(new Set()); });
    } else { setOrgPerms(new Set()); }
  }, [hasOrgContext, activeOrgId, isSystemAdmin]);

  // Fetch client permissions
  useEffect(() => {
    if (isSystemAdmin) { setClientPerms(new Set(['__system_admin__'])); return; }
    if (activeClientId) {
      api.get(`/api/subaccounts/${activeClientId}/my-permissions`).then(({ data }) => setClientPerms(new Set(data.permissions))).catch((err) => { console.error('[Layout] Failed to fetch client permissions:', err); setClientPerms(new Set()); });
    } else { setClientPerms(new Set()); }
  }, [activeClientId, isSystemAdmin]);

  const hasAnyOrgPerm = orgPerms.size > 0;
  const hasOrgPerm = (key: string) => orgPerms.has('__system_admin__') || orgPerms.has('__org_admin__') || orgPerms.has(key);
  const hasClientPerm = (key: string) => clientPerms.has('__system_admin__') || clientPerms.has('__org_admin__') || orgPerms.has('__org_admin__') || clientPerms.has(key);

  return { hasAnyOrgPerm, hasOrgPerm, hasClientPerm };
}
