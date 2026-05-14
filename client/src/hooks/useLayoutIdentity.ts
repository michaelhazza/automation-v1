import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import {
  getActiveOrgId, getActiveOrgName, setActiveOrg,
  getActiveClientId, getActiveClientName, setActiveClient, removeActiveClient,
  removeToken, removeUserRole, removeActiveOrg, removeSystemAdminOrgOverride,
  getSystemAdminOrgOverride, setSystemAdminOrgOverride,
} from '../lib/auth';
import type { User } from '../lib/auth';
import { disconnectSocket, reconnectSocket } from '../lib/socket';

export interface OrgOption { id: string; name: string; }
export interface ClientOption { id: string; name: string; slug: string; status: string; }

export interface LayoutIdentity {
  activeOrgId: string | null;
  activeOrgName: string | null;
  activeClientId: string | null;
  activeClientName: string | null;
  subaccounts: ClientOption[];
  hasOrgContext: boolean;
  isSystemAdmin: boolean;
  selectOrg(org: OrgOption): void;
  selectClient(sa: ClientOption): void;
  selectClientFromPalette(id: string, name: string): void;
  clearClient(): void;
  addSubaccount(sa: ClientOption): void;
  refreshSubaccounts(): Promise<void>;
  logout(): Promise<void>;
}

export function useLayoutIdentity(user: User): LayoutIdentity {
  const navigate = useNavigate();
  const isSystemAdmin = user.role === 'system_admin';

  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(getActiveOrgId);
  const [activeOrgName, setActiveOrgNameState] = useState<string | null>(getActiveOrgName);
  const [activeClientId, setActiveClientIdState] = useState<string | null>(getActiveClientId);
  const [activeClientName, setActiveClientNameState] = useState<string | null>(getActiveClientName);
  const [subaccounts, setSubaccounts] = useState<ClientOption[]>([]);

  const hasOrgContext = isSystemAdmin ? !!activeOrgId : !!user.organisationId;

  // Auto-set org context for non-system-admin users who belong to an org
  useEffect(() => {
    if (!isSystemAdmin && user.organisationId && !activeOrgId) {
      api.get('/api/organisations/mine').then(({ data }) => {
        const name = data?.name ?? 'My Organisation';
        setActiveOrg(user.organisationId, name);
        setActiveOrgIdState(user.organisationId);
        setActiveOrgNameState(name);
      }).catch(() => {
        // Fallback: set org ID without name so pages at least work
        setActiveOrg(user.organisationId, 'My Organisation');
        setActiveOrgIdState(user.organisationId);
        setActiveOrgNameState('My Organisation');
      });
    }
  }, [isSystemAdmin, user.organisationId, activeOrgId]);

  // Fetch subaccounts
  useEffect(() => {
    if (hasOrgContext) {
      api.get('/api/subaccounts').then(({ data }) => setSubaccounts(data)).catch((err) => { console.error('[Layout] Failed to fetch subaccounts:', err); setSubaccounts([]); });
    } else {
      setSubaccounts([]);
      if (activeClientId) { removeActiveClient(); setActiveClientIdState(null); setActiveClientNameState(null); }
    }
    // activeClientId is intentionally excluded — this effect is an org-change effect.
    // Including it would refetch subaccounts on every client switch, which is wasteful
    // and incorrect (subaccount list is org-scoped, not client-scoped).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOrgContext, activeOrgId]);

  const selectOrg = useCallback((org: OrgOption) => {
    setActiveOrg(org.id, org.name);
    setActiveOrgIdState(org.id);
    setActiveOrgNameState(org.name);
    removeActiveClient();
    setActiveClientIdState(null);
    setActiveClientNameState(null);
    reconnectSocket(); // Reconnect with new org context
    navigate('/');
  }, [navigate]);

  const selectClient = useCallback((sa: ClientOption) => {
    setActiveClient(sa.id, sa.name);
    setActiveClientIdState(sa.id);
    setActiveClientNameState(sa.name);
    // Selecting a client must drop the system override; otherwise a system admin
    // can pick a workspace and remain in System mode, which contradicts spec §4.6
    // (workspace selection => mode flips to workspace).
    if (getSystemAdminOrgOverride()) setSystemAdminOrgOverride(false);
  }, []);

  const selectClientFromPalette = useCallback((id: string, name: string) => {
    // Persist to localStorage so the selection survives reload / cross-tab.
    setActiveClient(id, name);
    setActiveClientIdState(id);
    setActiveClientNameState(name);
    // Selecting a client must drop the system override; otherwise a system admin
    // can pick a workspace and remain in System mode, which contradicts spec §4.6
    // (workspace selection => mode flips to workspace).
    if (getSystemAdminOrgOverride()) setSystemAdminOrgOverride(false);
  }, []);

  const clearClient = useCallback(() => {
    removeActiveClient();
    setActiveClientIdState(null);
    setActiveClientNameState(null);
  }, []);

  // Optimistic insert used by CreateClientModal so the new subaccount icon
  // appears in the rail immediately, matching pre-refactor behaviour.
  const addSubaccount = useCallback((sa: ClientOption) => {
    setSubaccounts(prev => (prev.some(s => s.id === sa.id) ? prev : [...prev, sa]));
  }, []);

  // Background refetch used after CreateClientModal commits, so server-side
  // normalisation (slug, status, ordering, enrichment) lands in the rail.
  // Pairs with addSubaccount's optimistic insert.
  const refreshSubaccounts = useCallback(async () => {
    if (!hasOrgContext) return;
    try {
      const { data } = await api.get('/api/subaccounts');
      setSubaccounts(data);
    } catch (err) {
      console.error('[Layout] Failed to refresh subaccounts:', err);
    }
  }, [hasOrgContext]);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } finally {
      disconnectSocket();
      removeToken(); removeUserRole(); removeActiveOrg(); removeActiveClient(); removeSystemAdminOrgOverride();
      navigate('/login');
    }
  }, [navigate]);

  return {
    activeOrgId,
    activeOrgName,
    activeClientId,
    activeClientName,
    subaccounts,
    hasOrgContext,
    isSystemAdmin,
    selectOrg,
    selectClient,
    selectClientFromPalette,
    clearClient,
    addSubaccount,
    refreshSubaccounts,
    logout,
  };
}
