// client/src/pages/govern/ConnectionsPage.tsx
// Govern surface — Connections page (3-tab strip).
// Spec: tasks/builds/operator-session-identity/plan.md §Chunk 10

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { getActiveClientId } from '../../lib/auth';
import { useViewMode } from '../../hooks/useViewMode';
import ViewModeSwitcher from '../../components/ViewModeSwitcher';
import { AppIntegrationsTab } from './components/AppIntegrationsTab';
import { WebLoginsTab } from './components/WebLoginsTab';
import { AiSubscriptionsTab } from './components/AiSubscriptionsTab';

type TabKey = 'app-integrations' | 'web-logins' | 'ai-subscriptions';

const VALID_TABS: TabKey[] = ['app-integrations', 'web-logins', 'ai-subscriptions'];

const TAB_DEFS: { id: TabKey; label: string; subtitle: string }[] = [
  { id: 'app-integrations', label: 'App Integrations', subtitle: 'Connect the apps your agents use to do work.' },
  { id: 'web-logins',       label: 'Web Logins',       subtitle: 'Store logins for sites without an API.' },
  { id: 'ai-subscriptions', label: 'AI Subscriptions', subtitle: 'Connect a ChatGPT plan for your autonomous agents.' },
];

export default function ConnectionsPage() {
  const { viewMode, availableModes, setViewMode } = useViewMode();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab') as TabKey | null;
  const validInitial: TabKey = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'app-integrations';
  const [activeTab, setActiveTab] = useState<TabKey>(validInitial);

  // Keep URL ?tab=… in sync
  useEffect(() => {
    setSearchParams(p => { p.set('tab', activeTab); return p; }, { replace: true });
  }, [activeTab, setSearchParams]);

  const isWorkspace = viewMode !== 'org';
  // Prefer ?workspace= query param (set by SubaccountIntegrationsRoute redirect) when it looks
  // like a valid UUID, so the subaccount context is preserved across the redirect.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const workspaceParam = searchParams.get('workspace');
  const subaccountId = isWorkspace
    ? (workspaceParam && UUID_RE.test(workspaceParam) ? workspaceParam : getActiveClientId() ?? undefined)
    : undefined;

  const activeTabDef = TAB_DEFS.find(t => t.id === activeTab)!;

  return (
    <PageShell
      header={
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h1 className="text-lg font-semibold text-slate-900">Connections</h1>
          <div className="flex items-center gap-3">
            <ViewModeSwitcher
              value={viewMode}
              onChange={setViewMode}
              availableModes={availableModes}
            />
          </div>
        </div>
      }
    >
      {/* Tab strip */}
      <div className="flex border-b border-slate-200 px-6 pt-2 gap-1">
        {TAB_DEFS.map(t => (
          <button
            type="button"
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors bg-transparent cursor-pointer font-[inherit] ${
              activeTab === t.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab subtitle */}
      <div className="px-6 pt-3 pb-1">
        <p className="text-xs text-slate-500 m-0">{activeTabDef.subtitle}</p>
      </div>

      {/* Tab body */}
      <div className="px-6 py-3">
        {!isWorkspace || !subaccountId ? (
          <div className="py-12 text-center text-sm text-slate-500">
            Select a workspace to view connections.
          </div>
        ) : (
          <>
            {activeTab === 'app-integrations' && (
              <AppIntegrationsTab subaccountId={subaccountId} />
            )}
            {activeTab === 'web-logins' && (
              <WebLoginsTab subaccountId={subaccountId} />
            )}
            {activeTab === 'ai-subscriptions' && (
              <AiSubscriptionsTab subaccountId={subaccountId} />
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
