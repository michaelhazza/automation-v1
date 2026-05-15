import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface NavListsInput {
  activeClientId: string | null;
}

export interface NavProject { id: string; name: string; color: string; status: string; }
export interface NavAgent { id: string; agentId: string; agent: { name: string; icon: string | null; status: string }; agentRole: string | null; isActive: boolean; }

export interface NavLists {
  navProjects: NavProject[];
  navAgents: NavAgent[];
  refresh: {
    projects(): void;
    agents(): void;
  };
}

export function useNavLists({ activeClientId }: NavListsInput): NavLists {
  const [navProjects, setNavProjects] = useState<NavProject[]>([]);
  const [navAgents, setNavAgents] = useState<NavAgent[]>([]);

  // Dynamic nav: projects + agents for active client
  useEffect(() => {
    if (!activeClientId) { setNavProjects([]); setNavAgents([]); return; }
    api.get(`/api/subaccounts/${activeClientId}/projects`).then(({ data }) =>
      setNavProjects((data as NavProject[]).filter(p => p.status === 'active').slice(0, 12))
    ).catch((err) => { console.error('[Layout] Failed to fetch nav projects:', err); setNavProjects([]); });
    api.get(`/api/subaccounts/${activeClientId}/agents`).then(({ data }) =>
      setNavAgents((data as NavAgent[]).filter(a => a.isActive))
    ).catch((err) => { console.error('[Layout] Failed to fetch nav agents:', err); setNavAgents([]); });
  }, [activeClientId]);

  const refreshProjects = useCallback(() => {
    if (!activeClientId) return;
    api.get(`/api/subaccounts/${activeClientId}/projects`).then(({ data }) =>
      setNavProjects((data as NavProject[]).filter(p => p.status === 'active').slice(0, 12))
    ).catch((err) => { console.error('[Layout] Failed to fetch nav projects:', err); setNavProjects([]); });
  }, [activeClientId]);

  const refreshAgents = useCallback(() => {
    if (!activeClientId) return;
    api.get(`/api/subaccounts/${activeClientId}/agents`).then(({ data }) =>
      setNavAgents((data as NavAgent[]).filter(a => a.isActive))
    ).catch((err) => { console.error('[Layout] Failed to fetch nav agents:', err); setNavAgents([]); });
  }, [activeClientId]);

  return {
    navProjects,
    navAgents,
    refresh: { projects: refreshProjects, agents: refreshAgents },
  };
}
