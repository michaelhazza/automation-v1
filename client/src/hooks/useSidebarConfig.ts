import { useState, useEffect } from 'react';
import api from '../lib/api';

interface SidebarConfigInput {
  isSystemAdmin: boolean;
  hasOrgContext: boolean;
  activeOrgId: string | null;
}

export interface SidebarConfig {
  sidebarLoaded: boolean;
  hasSidebarItem(slug: string): boolean;
}

export function useSidebarConfig({
  isSystemAdmin,
  hasOrgContext,
  activeOrgId,
}: SidebarConfigInput): SidebarConfig {
  const [sidebarItems, setSidebarItems] = useState<Set<string> | null>(null);
  const [sidebarLoaded, setSidebarLoaded] = useState(false);

  // Fetch module-driven sidebar config
  useEffect(() => {
    if (isSystemAdmin) { setSidebarItems(null); setSidebarLoaded(true); return; }
    if (hasOrgContext) {
      setSidebarLoaded(false);
      api.get('/api/my-sidebar-config').then(({ data }) => {
        if (data.items && Array.isArray(data.items) && data.items.length > 0) {
          setSidebarItems(new Set(data.items));
        } else {
          setSidebarItems(null); // No module config = show default (all items)
        }
      }).catch(() => setSidebarItems(null)).finally(() => setSidebarLoaded(true));
    } else { setSidebarItems(null); setSidebarLoaded(true); }
  }, [hasOrgContext, activeOrgId, isSystemAdmin]);

  /** Check if a nav-item slug is enabled by the module sidebar config. System admins bypass. Returns false while loading to prevent flash. */
  const hasSidebarItem = (slug: string) => {
    if (!sidebarLoaded) return false; // suppress until config loaded
    return !sidebarItems || sidebarItems.has(slug);
  };

  return { sidebarLoaded, hasSidebarItem };
}
