// client/src/pages/govern/components/AppIntegrationsTab.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 8

import { useState, useEffect, useCallback } from 'react';
import { listConnections } from '../../../api/governApi';
import type { Connection } from '../../../../../shared/types/govern.js';
import { ConnectAppModal } from './ConnectAppModal';
import { ManageMultiConnectDrawer } from './ManageMultiConnectDrawer';

// ── Static app registry ──────────────────────────────────────────────────────

export type AppCategory = 'All' | 'Communication' | 'CRM' | 'Calendar' | 'Files';

export const APP_CATEGORIES: AppCategory[] = ['All', 'Communication', 'CRM', 'Calendar', 'Files'];

export interface AppDefinition {
  id: string;
  name: string;
  category: Exclude<AppCategory, 'All'>;
  /** Abbreviation shown in the letter-form avatar */
  abbr: string;
  /** Tailwind bg + text classes for the avatar */
  avatarBg: string;
  avatarText: string;
  /** Provider value as stored in Connection.provider */
  provider: string;
}

export const APP_REGISTRY: AppDefinition[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Communication',
    abbr: 'GM',
    avatarBg: 'bg-[#fce8e6]',
    avatarText: 'text-[#c5221f]',
    provider: 'gmail',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Communication',
    abbr: 'SL',
    avatarBg: 'bg-[#f3e5f5]',
    avatarText: 'text-[#6a1b9a]',
    provider: 'slack',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    category: 'Communication',
    abbr: 'OL',
    avatarBg: 'bg-[#e3f2fd]',
    avatarText: 'text-[#0078d4]',
    provider: 'outlook',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'CRM',
    abbr: 'HS',
    avatarBg: 'bg-[#fff3e0]',
    avatarText: 'text-[#e8460a]',
    provider: 'hubspot',
  },
  {
    id: 'ghl',
    name: 'GoHighLevel',
    category: 'CRM',
    abbr: 'GHL',
    avatarBg: 'bg-[#e8f5e9]',
    avatarText: 'text-[#2e7d32]',
    provider: 'ghl',
  },
  {
    id: 'teamwork',
    name: 'Teamwork',
    category: 'CRM',
    abbr: 'TW',
    avatarBg: 'bg-[#e3f2fd]',
    avatarText: 'text-[#1565c0]',
    provider: 'teamwork',
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    category: 'Calendar',
    abbr: 'GC',
    avatarBg: 'bg-[#fce8e6]',
    avatarText: 'text-[#1a73e8]',
    provider: 'google_calendar',
  },
  {
    id: 'microsoft_calendar',
    name: 'Microsoft Calendar',
    category: 'Calendar',
    abbr: 'MC',
    avatarBg: 'bg-[#e3f2fd]',
    avatarText: 'text-[#0078d4]',
    provider: 'microsoft_calendar',
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    category: 'Files',
    abbr: 'GD',
    avatarBg: 'bg-[#e8f5e9]',
    avatarText: 'text-[#188038]',
    provider: 'google_drive',
  },
];

// ── Helper: group connections by provider ────────────────────────────────────

function groupByProvider(rows: Connection[]): Record<string, Connection[]> {
  const out: Record<string, Connection[]> = {};
  for (const row of rows) {
    if (!out[row.provider]) out[row.provider] = [];
    out[row.provider].push(row);
  }
  return out;
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function AppAvatar({ app }: { app: AppDefinition }) {
  return (
    <div
      className={`w-12 h-12 rounded-xl ${app.avatarBg} flex items-center justify-center flex-shrink-0 mb-3`}
    >
      <span className={`text-[12px] font-extrabold leading-none ${app.avatarText}`}>{app.abbr}</span>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col items-center text-center animate-pulse">
      <div className="w-12 h-12 rounded-xl bg-slate-100 mb-3" />
      <div className="h-3.5 w-20 bg-slate-100 rounded mb-1.5" />
      <div className="h-3 w-16 bg-slate-100 rounded mb-2.5" />
      <div className="h-5 w-24 bg-slate-100 rounded mb-3" />
      <div className="h-8 w-full bg-slate-100 rounded-lg" />
    </div>
  );
}

// ── App card ──────────────────────────────────────────────────────────────────

interface AppCardProps {
  app: AppDefinition;
  connections: Connection[];
  onConnect: (app: AppDefinition) => void;
  onManage: (app: AppDefinition, connections: Connection[]) => void;
}

function AppCard({ app, connections, onConnect, onManage }: AppCardProps) {
  const count = connections.length;
  const isConnected = count > 0;

  return (
    <div className="bg-white border-[1.5px] border-slate-200 rounded-2xl p-5 flex flex-col items-center text-center cursor-pointer transition-all duration-150 hover:border-indigo-400 hover:shadow-[0_4px_16px_rgba(99,102,241,0.13)] hover:-translate-y-0.5">
      <AppAvatar app={app} />
      <div className="text-[13.5px] font-bold text-slate-900 mb-0.5">{app.name}</div>
      <div className="text-[11px] text-slate-400 font-medium mb-2.5">{app.category}</div>

      {/* Status badge */}
      {isConnected ? (
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
          {count === 1 ? '1 connected' : `${count} connected`}
        </div>
      ) : (
        <div className="inline-flex items-center text-[11px] font-medium text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full mb-3">
          Not connected
        </div>
      )}

      {/* CTA */}
      {isConnected ? (
        <button
          type="button"
          onClick={() => onManage(app, connections)}
          className="w-full inline-flex items-center justify-center py-[7px] rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-[12.5px] font-semibold hover:bg-slate-200 hover:text-slate-900 transition-colors duration-120 cursor-pointer font-[inherit] border-solid"
        >
          Manage
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onConnect(app)}
          className="w-full inline-flex items-center justify-center py-[7px] rounded-lg bg-indigo-600 text-white border-0 text-[12.5px] font-semibold hover:bg-indigo-700 transition-colors duration-120 cursor-pointer font-[inherit]"
        >
          Connect
        </button>
      )}
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-400 mb-3.5">
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  subaccountId: string;
}

export function AppIntegrationsTab({ subaccountId }: Props) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const [activeCategory, setActiveCategory] = useState<AppCategory>('All');
  const [connectingApp, setConnectingApp] = useState<AppDefinition | null>(null);
  const [managingApp, setManagingApp] = useState<{ app: AppDefinition; connections: Connection[] } | null>(null);

  const reload = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    setConnections(null);
    setError(null);
    listConnections({ scope: 'workspace', subaccountId })
      .then((res) => setConnections(res.rows))
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [subaccountId, fetchKey]);

  const isLoading = connections === null && !error;

  // Group active connections by provider
  const byProvider = connections ? groupByProvider(connections) : {};

  // Filter: exclude ai_subscription from this tab (those belong to AI Subscriptions tab)
  const filteredByProvider: Record<string, Connection[]> = {};
  for (const [provider, rows] of Object.entries(byProvider)) {
    const appRows = rows.filter((r) => r.authMethod !== 'ai_subscription');
    if (appRows.length > 0) filteredByProvider[provider] = appRows;
  }

  // Apply category filter to the registry
  const visibleApps = APP_REGISTRY.filter(
    (app) => activeCategory === 'All' || app.category === activeCategory,
  );

  // Mutually exclusive sections
  const connectedApps = visibleApps.filter((app) => (filteredByProvider[app.provider]?.length ?? 0) > 0);
  const availableApps = visibleApps.filter((app) => (filteredByProvider[app.provider]?.length ?? 0) === 0);

  return (
    <div>
      {/* Tab subtitle */}
      <p className="text-xs text-slate-400 mb-3 mt-1">
        Apps your agents use to do work, like Gmail or HubSpot
      </p>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-3 mb-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
          <span className="flex-1">Failed to load connections: {error.message}</span>
          <button
            type="button"
            onClick={reload}
            className="text-xs font-semibold text-red-700 underline cursor-pointer bg-transparent border-0 font-[inherit]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Category filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap mb-6">
        {APP_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`inline-flex items-center text-[12px] font-medium px-3 py-1 rounded-full border whitespace-nowrap cursor-pointer transition-all duration-120 font-[inherit] ${
              activeCategory === cat
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold'
                : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-indigo-700'
            }`}
          >
            {cat === 'All' ? 'All categories' : cat}
          </button>
        ))}
      </div>

      {/* Skeleton */}
      {isLoading && (
        <div>
          <SectionHeading>Your connected apps</SectionHeading>
          <div className="grid gap-3.5 mb-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
          <SectionHeading>Apps you can connect</SectionHeading>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      )}

      {/* Loaded state */}
      {!isLoading && !error && (
        <>
          {/* Connected apps section */}
          {connectedApps.length > 0 && (
            <div className="mb-8">
              <SectionHeading>Your connected apps</SectionHeading>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {connectedApps.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    connections={filteredByProvider[app.provider] ?? []}
                    onConnect={setConnectingApp}
                    onManage={(a, conns) => setManagingApp({ app: a, connections: conns })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Available apps section */}
          {availableApps.length > 0 && (
            <div>
              {connectedApps.length > 0 && (
                <hr className="border-0 border-t border-slate-100 mb-6" />
              )}
              <SectionHeading>Apps you can connect</SectionHeading>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {availableApps.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    connections={[]}
                    onConnect={setConnectingApp}
                    onManage={(a, conns) => setManagingApp({ app: a, connections: conns })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state: category filter yielded nothing */}
          {connectedApps.length === 0 && availableApps.length === 0 && (
            <div className="text-center py-14 px-8">
              <div className="w-12 h-12 rounded-xl bg-slate-50 mx-auto mb-4 flex items-center justify-center text-2xl">
                <svg width="24" height="24" fill="none" stroke="#94a3b8" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <p className="text-[14px] font-semibold text-slate-700 mb-1">No apps in this category</p>
              <p className="text-[13px] text-slate-400">
                <button
                  type="button"
                  onClick={() => setActiveCategory('All')}
                  className="text-indigo-600 underline cursor-pointer bg-transparent border-0 font-[inherit] text-[13px]"
                >
                  Show all categories
                </button>
              </p>
            </div>
          )}
        </>
      )}

      {/* Connect modal */}
      {connectingApp && (
        <ConnectAppModal
          app={connectingApp}
          subaccountId={subaccountId}
          onClose={() => setConnectingApp(null)}
          onConnected={() => { setConnectingApp(null); reload(); }}
        />
      )}

      {/* Manage drawer */}
      {managingApp && (
        <ManageMultiConnectDrawer
          app={managingApp.app}
          subaccountId={subaccountId}
          onClose={() => setManagingApp(null)}
          onAddAnother={() => { setManagingApp(null); setConnectingApp(managingApp.app); }}
          onDisconnected={reload}
        />
      )}
    </div>
  );
}
