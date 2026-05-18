import { useState, useEffect } from 'react';
import CommandPalette from './CommandPalette';
import { useNavigate, useLocation } from 'react-router-dom';
import { User } from '../lib/auth';
import { getSocket } from '../lib/socket';
import { useConfigAssistantPopup } from '../hooks/useConfigAssistantPopup';
import { useViewMode } from '../hooks/useViewMode';
import { useUserOwnedAgents } from '../hooks/useUserOwnedAgents';
import { buildNavItems } from '../config/sidebar';
import type { NavContext } from '../config/sidebar';
import { buildBreadcrumbs } from './layout/breadcrumbs';
import { useLayoutIdentity } from '../hooks/useLayoutIdentity';
import { useLayoutPermissions } from '../hooks/useLayoutPermissions';
import { useSidebarConfig } from '../hooks/useSidebarConfig';
import { useLayoutBadges } from '../hooks/useLayoutBadges';
import { useNavLists } from '../hooks/useNavLists';
import { useCommandPaletteKeybind } from '../hooks/useCommandPaletteKeybind';
import { useOrgList } from '../hooks/useOrgList';
import { IconRail } from './layout/IconRail';
import { SidebarShell } from './layout/SidebarShell';
import { TopBar } from './layout/TopBar';
import { BudgetAlertBanner } from './layout/BudgetAlertBanner';
import { CreateProjectModal } from './layout/modals/CreateProjectModal';
import { CreateAgentModal } from './layout/modals/CreateAgentModal';
import { CreateClientModal } from './layout/modals/CreateClientModal';
import { NewTaskModal } from './layout/modals/NewTaskModal';

interface LayoutProps {
  user: User;
  children: React.ReactNode;
}

// ── Main Layout ────────────────────────────────────────────────────────────
export default function Layout({ user, children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { openConfigAssistant } = useConfigAssistantPopup();

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const identity = useLayoutIdentity(user);
  const permissions = useLayoutPermissions({
    isSystemAdmin: identity.isSystemAdmin,
    hasOrgContext: identity.hasOrgContext,
    activeOrgId: identity.activeOrgId,
    activeClientId: identity.activeClientId,
  });
  const sidebar = useSidebarConfig({
    isSystemAdmin: identity.isSystemAdmin,
    hasOrgContext: identity.hasOrgContext,
    activeOrgId: identity.activeOrgId,
  });
  const badges = useLayoutBadges({
    activeClientId: identity.activeClientId,
    isSystemAdmin: identity.isSystemAdmin,
  });
  const navLists = useNavLists({ activeClientId: identity.activeClientId });
  const commandPalette = useCommandPaletteKeybind();
  const { orgs } = useOrgList(identity.isSystemAdmin);

  // Modal open/close flags
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [showNewBrief, setShowNewBrief] = useState(false);

  // ViewMode — wires to command palette for client selection
  const { viewMode, availableModes, setViewMode } = useViewMode({
    onRequireClientSelection: commandPalette.open,
    // Sync Layout's React mirror state when setViewMode('org') clears the
    // active client at the localStorage layer. Without this, downstream
    // effects keep the stale client until something else triggers a render.
    onClientCleared: identity.clearClient,
  });

  // User-owned agents (personal nav group)
  const { data: userOwnedAgents } = useUserOwnedAgents();

  // Initialise WebSocket connection
  useEffect(() => {
    getSocket();
    return () => { /* Keep connection alive across Layout re-renders */ };
  }, []);

  const breadcrumbs = buildBreadcrumbs(location.pathname, identity.activeClientName);

  // ── Config-driven nav ──────────────────────────────────────────────────
  const navCtx: NavContext = {
    isSystemAdmin: identity.isSystemAdmin,
    hasOrgContext: identity.hasOrgContext,
    hasAnyOrgPerm: permissions.hasAnyOrgPerm,
    activeClientId: identity.activeClientId,
    hasOrgPerm: permissions.hasOrgPerm,
    hasClientPerm: permissions.hasClientPerm,
    hasSidebarItem: sidebar.hasSidebarItem,
    viewMode,
    navProjects: navLists.navProjects.map(p => ({ id: p.id, name: p.name, color: p.color, status: p.status })),
    navAgents: navLists.navAgents.map(a => ({ id: a.id, agentId: a.agentId, name: a.agent.name, icon: a.agent.icon })),
    userOwnedAgents: userOwnedAgents.map(a => ({ agentId: a.id, name: a.name })),
    reviewCount: badges.reviewCount,
    liveAgentCount: badges.liveAgentCount,
    incidentCount: badges.incidentCount,
    onCreateProject: () => setShowCreateProject(true),
    onCreateAgent: () => setShowCreateAgent(true),
    onOpenNewBrief: () => setShowNewBrief(true),
    onLogout: identity.logout,
    onOpenConfigAssistant: () => openConfigAssistant(),
  };
  const navItems = buildNavItems(navCtx);

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette
        isOpen={commandPalette.cmdOpen}
        onClose={commandPalette.close}
        activeClientId={identity.activeClientId}
        onSelectClient={identity.selectClientFromPalette}
      />

      {/* ── Icon Rail ─────────────────────────────────────────────────── */}
      <IconRail
        user={user}
        identity={identity}
        orgs={orgs}
        subaccounts={identity.subaccounts}
        canCreateClient={permissions.hasOrgPerm('org.subaccounts.edit')}
        onCreateClient={() => { setShowCreateClient(true); }}
      />

      {/* ── Main Sidebar ──────────────────────────────────────────────── */}
      <SidebarShell
        identity={identity}
        viewMode={viewMode}
        availableModes={availableModes}
        setViewMode={setViewMode}
        hasAnyOrgPerm={permissions.hasAnyOrgPerm}
        navItems={navItems}
      />

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-50">

        {/* Breadcrumb bar + Cmd-K trigger */}
        <TopBar
          breadcrumbs={breadcrumbs}
          hasOrgContext={identity.hasOrgContext}
          onOpenCommandPalette={commandPalette.open}
        />

        {/* Budget alert banner */}
        <BudgetAlertBanner
          alert={badges.budgetAlert}
          activeClientId={identity.activeClientId}
          onDismiss={badges.dismissBudgetAlert}
        />

        {/* Page content */}
        <div className="flex-1 overflow-auto py-7 px-6 page-enter">
          {children}
        </div>
      </main>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <CreateProjectModal
        open={showCreateProject}
        activeClientId={identity.activeClientId ?? ''}
        onClose={() => setShowCreateProject(false)}
        onCreated={(projectId) => { navLists.refresh.projects(); navigate(`/projects/${projectId}`); }}
      />
      <CreateAgentModal
        open={showCreateAgent}
        activeClientId={identity.activeClientId ?? ''}
        onClose={() => setShowCreateAgent(false)}
        onCreated={(agentId) => { navLists.refresh.agents(); navigate(`/agents/${agentId}`); }}
      />
      <CreateClientModal
        open={showCreateClient}
        onClose={() => setShowCreateClient(false)}
        onCreated={(client) => {
          identity.addSubaccount(client);
          identity.selectClient(client);
          // Background refetch syncs server-side normalisation (slug / status /
          // ordering / enrichment). Pre-refactor Layout.tsx ran an /api/subaccounts
          // refetch right after the create.
          void identity.refreshSubaccounts();
        }}
      />
      <NewTaskModal
        open={showNewBrief}
        onClose={() => setShowNewBrief(false)}
        identity={identity}
        orgs={orgs}
        subaccounts={identity.subaccounts}
        onSubmitted={(taskId, ctx) => { if (ctx.org) identity.selectOrg(ctx.org); if (ctx.subaccount) identity.selectClient(ctx.subaccount); navigate(`/admin/tasks/${taskId}`); }}
      />
    </div>
  );
}
