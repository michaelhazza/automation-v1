// client/src/pages/govern/components/ManageMultiConnectDrawer.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 8

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { testConnection, listConnections } from '../../../api/governApi';
import type { Connection } from '../../../../../shared/types/govern.js';
import type { AppDefinition } from './AppIntegrationsTab';
import { DisconnectConfirmDialog } from './DisconnectConfirmDialog';
import { formatRelative } from './_utils';
import { acquireScrollLock, releaseScrollLock } from '../../../components/overlayScrollLock';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Connection row ────────────────────────────────────────────────────────────

interface ConnRowProps {
  connection: Connection;
  subaccountId: string;
  onDisconnectRequest: (connection: Connection) => void;
}

function ConnRow({ connection, onDisconnectRequest }: ConnRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'failed' | null>(null);
  const [testing, setTesting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const status = connection.status;
  const isOk = status === 'connected';
  const isExpired = status === 'expired' || status === 'failed';

  // S2: 3-dot menu outside-click close
  useEffect(() => {
    if (!menuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [menuOpen]);

  async function handleTest() {
    setMenuOpen(false);
    setTesting(true);
    try {
      const result = await testConnection(connection.id);
      setTestResult(result.status);
    } catch {
      setTestResult('failed');
    } finally {
      setTesting(false);
    }
  }

  const abbr = initials(connection.name);

  return (
    <div className="flex items-center gap-3 px-6 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors">
      {/* Avatar */}
      <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-[12px] font-bold text-indigo-700 flex-shrink-0">
        {abbr}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-slate-900 truncate">{connection.name}</div>
        <div className="text-[11px] text-slate-400 truncate">{connection.provider}</div>
      </div>

      {/* Status dot */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isOk ? 'bg-emerald-500' : isExpired ? 'bg-amber-400' : 'bg-slate-300'
          }`}
        />
        <span className="text-[11.5px] font-medium text-slate-500">
          {isOk ? 'Connected' : isExpired ? 'Needs sign in' : 'Pending'}
        </span>
        {testResult === 'ok' && <span className="text-[10.5px] text-emerald-600 font-semibold">Test passed</span>}
        {testResult === 'failed' && <span className="text-[10.5px] text-red-600 font-semibold">Test failed</span>}
        {testing && <span className="text-[10.5px] text-slate-400">Testing...</span>}
      </div>

      {/* Last sync */}
      <div className="text-[11px] text-slate-400 flex-shrink-0 whitespace-nowrap hidden sm:block">
        {formatRelative(connection.lastSyncAt)}
      </div>

      {/* 3-dot menu */}
      <div ref={menuRef} className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 border-0 bg-transparent cursor-pointer font-[inherit] text-base leading-none"
          aria-label="Connection actions"
        >
          &#8942;
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[180px] py-1">
            <button
              type="button"
              onClick={() => { void handleTest(); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-[12.5px] text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer bg-transparent border-0 font-[inherit]"
            >
              <span className="w-3.5 opacity-60 text-center text-[11px]">&#9654;</span>
              Test
            </button>
            <div className="border-t border-slate-100 my-1" />
            {/* V1: label edit deferred (no backend endpoint) */}
            <button
              type="button"
              onClick={() => { onDisconnectRequest(connection); setMenuOpen(false); }}
              className="w-full text-left px-3 py-2 text-[12.5px] text-red-600 hover:bg-red-50 flex items-center gap-2.5 cursor-pointer bg-transparent border-0 font-[inherit]"
            >
              <span className="w-3.5 opacity-75 text-center text-[11px]">&#8856;</span>
              Disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

interface Props {
  app: AppDefinition;
  subaccountId: string;
  onClose: () => void;
  onAddAnother: () => void;
  onDisconnected: () => void;
}

export function ManageMultiConnectDrawer({ app, subaccountId, onClose, onAddAnother, onDisconnected }: Props) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null);

  // B4: self-fetching live list, filtered by provider
  const fetchConnections = useCallback(() => {
    setFetchError(null);
    listConnections({ scope: 'workspace', subaccountId })
      .then((res) => {
        const filtered = res.rows.filter(
          (c) => c.provider === app.provider && c.authMethod !== 'ai_subscription',
        );
        setConnections(filtered);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Failed to load connections.';
        setFetchError(msg);
      });
  }, [subaccountId, app.provider]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections, refreshKey]);

  // S2: Escape-to-close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // S2: Body scroll lock
  useEffect(() => {
    acquireScrollLock();
    return () => releaseScrollLock();
  }, []);

  function handleDisconnected() {
    onDisconnected();
    const newCount = (connections?.length ?? 1) - 1;
    setRefreshKey((k) => k + 1);
    if (newCount <= 0) {
      onClose();
    }
  }

  const liveCount = connections?.length ?? 0;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-slate-900/25 cursor-pointer"
        onClick={onClose}
        role="presentation"
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${app.name} connections`}
        className="fixed top-0 right-0 bottom-0 z-[201] w-[420px] max-w-full bg-white shadow-[-6px_0_32px_rgba(0,0,0,0.14)] flex flex-col"
        style={{ animation: 'slideInRight 0.18s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl ${app.avatarBg} flex items-center justify-center flex-shrink-0`}
            >
              <span className={`text-[11px] font-extrabold leading-none ${app.avatarText}`}>{app.abbr}</span>
            </div>
            <div>
              <div className="text-[15px] font-bold text-slate-900 leading-tight">
                {app.name} connections
              </div>
              <div className="text-[12px] text-slate-400 mt-0.5">
                {liveCount} connection{liveCount !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 bg-transparent border-0 cursor-pointer text-lg leading-none font-[inherit]"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Toolbar: Add another */}
        <div className="flex items-center justify-end px-6 py-3 border-b border-slate-50">
          <button
            type="button"
            onClick={onAddAnother}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold border-0 cursor-pointer font-[inherit] transition-colors duration-150"
          >
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add another {app.name}
          </button>
        </div>

        {/* Connection list */}
        <div className="flex-1 overflow-y-auto">
          {fetchError && (
            <div className="mx-6 my-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
              {fetchError}
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                className="ml-2 underline cursor-pointer bg-transparent border-0 font-[inherit] text-red-700"
              >
                Retry
              </button>
            </div>
          )}
          {!fetchError && connections === null ? (
            <div className="text-center py-10 px-6">
              <p className="text-[13px] text-slate-400">Loading...</p>
            </div>
          ) : !fetchError && liveCount === 0 ? (
            <div className="text-center py-10 px-6">
              <p className="text-[13px] text-slate-400">No connections found.</p>
            </div>
          ) : (
            connections?.map((conn) => (
              <ConnRow
                key={conn.id}
                connection={conn}
                subaccountId={subaccountId}
                onDisconnectRequest={setDisconnectTarget}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100">
          <p className="text-[11.5px] text-slate-400 leading-relaxed mb-3">
            To rotate credentials, disconnect and reconnect.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-[13px] font-medium hover:border-indigo-300 hover:text-indigo-700 bg-white cursor-pointer font-[inherit] transition-all duration-150"
          >
            Close
          </button>
        </div>
      </aside>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* B3: Shared disconnect dialog */}
      {disconnectTarget && (
        <DisconnectConfirmDialog
          connectionId={disconnectTarget.id}
          onClose={() => setDisconnectTarget(null)}
          onDisconnected={() => {
            setDisconnectTarget(null);
            handleDisconnected();
          }}
        />
      )}
    </>,
    document.body,
  );
}
