// client/src/pages/govern/components/ManageMultiConnectDrawer.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 8

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { disconnectConnection, testConnection } from '../../../api/governApi';
import type { Connection } from '../../../../../shared/types/govern.js';
import type { AppDefinition } from './AppIntegrationsTab';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs === 1 ? '1 hour' : `${hrs} hours`} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Disconnect confirm inline modal ───────────────────────────────────────────

interface DisconnectConfirmProps {
  connection: Connection;
  onCancel: () => void;
  onDisconnected: () => void;
}

function DisconnectConfirmInline({ connection, onCancel, onDisconnected }: DisconnectConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectConnection(connection.id);
      onDisconnected();
    } catch (e: unknown) {
      const msg = (() => {
        if (e instanceof Error) return e.message;
        const ax = e as { response?: { data?: { message?: string } } };
        return ax.response?.data?.message ?? 'Disconnect failed.';
      })();
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <div className="mx-6 my-3 p-4 bg-red-50 border border-red-200 rounded-xl">
      <p className="text-[13px] font-semibold text-slate-900 mb-1">
        Disconnect &quot;{connection.name}&quot;?
      </p>
      <p className="text-[12.5px] text-slate-500 mb-3 leading-relaxed">
        This stops agents from using this connection. It cannot be undone.
      </p>
      {error && (
        <p className="text-[12px] text-red-600 mb-2">{error}</p>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-[12.5px] font-medium text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer font-[inherit]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          disabled={busy}
          className="px-3 py-1.5 text-[12.5px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg border-0 cursor-pointer font-[inherit] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

// ── Connection row ────────────────────────────────────────────────────────────

interface ConnRowProps {
  connection: Connection;
  onDisconnected: () => void;
  onAddAnother: () => void;
}

type RowAction = 'menu' | 'disconnecting' | null;

function ConnRow({ connection, onDisconnected }: ConnRowProps) {
  const [action, setAction] = useState<RowAction>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'failed' | null>(null);
  const [testing, setTesting] = useState(false);

  const status = connection.status;
  const isOk = status === 'connected';
  const isExpired = status === 'expired' || status === 'failed';

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
    <>
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
        <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
              <button
                type="button"
                onClick={() => { setAction('disconnecting'); setMenuOpen(false); }}
                className="w-full text-left px-3 py-2 text-[12.5px] text-red-600 hover:bg-red-50 flex items-center gap-2.5 cursor-pointer bg-transparent border-0 font-[inherit]"
              >
                <span className="w-3.5 opacity-75 text-center text-[11px]">&#8856;</span>
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline disconnect confirm */}
      {action === 'disconnecting' && (
        <DisconnectConfirmInline
          connection={connection}
          onCancel={() => setAction(null)}
          onDisconnected={onDisconnected}
        />
      )}
    </>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

interface Props {
  app: AppDefinition;
  connections: Connection[];
  onClose: () => void;
  onAddAnother: () => void;
  onDisconnected: () => void;
}

export function ManageMultiConnectDrawer({ app, connections, onClose, onAddAnother, onDisconnected }: Props) {
  function handleDisconnected() {
    onDisconnected();
    // If no connections left after disconnect, close the drawer
    if (connections.length <= 1) {
      onClose();
    }
  }

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
                {connections.length} connection{connections.length !== 1 ? 's' : ''}
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
          {connections.length === 0 ? (
            <div className="text-center py-10 px-6">
              <p className="text-[13px] text-slate-400">No connections found.</p>
            </div>
          ) : (
            connections.map((conn) => (
              <ConnRow
                key={conn.id}
                connection={conn}
                onDisconnected={handleDisconnected}
                onAddAnother={onAddAnother}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100">
          <p className="text-[11.5px] text-slate-400 leading-relaxed mb-3">
            To rotate credentials, disconnect and reconnect. OAuth connections use the provider sign-in; there is no credential to paste inline.
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
    </>,
    document.body,
  );
}
