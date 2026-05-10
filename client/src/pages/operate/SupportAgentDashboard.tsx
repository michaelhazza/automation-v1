import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { PageShell } from '../../components/PageShell';

// ── Types ────────────────────────────────────────────────────────────────────

type AgentMode = 'autonomous' | 'assisted' | 'disabled';
type EvalDriftStatus = 'green' | 'amber' | 'red';

interface InboxDashboardRow {
  inboxId: string;
  inboxName: string;
  mode: AgentMode;
  draftsPending: number;
  sentToday: number;
  escalations: number;
  evalDriftStatus: EvalDriftStatus;
}

// ── Inline mode toggle ────────────────────────────────────────────────────────

const MODE_SEQUENCE: AgentMode[] = ['disabled', 'assisted', 'autonomous'];

function ModeToggle({ inboxId, mode, onModeChange }: { inboxId: string; mode: AgentMode; onModeChange: (m: AgentMode) => void }) {
  const [saving, setSaving] = useState(false);

  async function setMode(nextMode: AgentMode) {
    if (nextMode === mode || saving) return;
    setSaving(true);
    try {
      await api.patch(`/api/support/inboxes/${inboxId}/agent-config`, { mode: nextMode });
      onModeChange(nextMode);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium">
      {MODE_SEQUENCE.map((m) => (
        <button
          key={m}
          type="button"
          disabled={saving}
          onClick={() => void setMode(m)}
          className={`px-2.5 py-1 capitalize transition-colors ${
            m === mode
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          } disabled:opacity-50`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

// ── Mode pill ────────────────────────────────────────────────────────────────

const MODE_STYLES: Record<AgentMode, string> = {
  disabled: 'bg-slate-100 text-slate-600',
  assisted: 'bg-amber-50 text-amber-700',
  autonomous: 'bg-emerald-50 text-emerald-700',
};

function ModePill({ mode }: { mode: AgentMode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize ${MODE_STYLES[mode]}`}>
      {mode}
    </span>
  );
}

// ── Eval drift dot ───────────────────────────────────────────────────────────

const DRIFT_DOT_STYLES: Record<EvalDriftStatus, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
};

function EvalDriftDot({ status }: { status: EvalDriftStatus }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${DRIFT_DOT_STYLES[status]}`}
      title={`Eval drift: ${status}`}
    />
  );
}

// ── Loading shimmer ──────────────────────────────────────────────────────────

function ShimmerRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <tr key={i}>
          {[1, 2, 3, 4, 5, 6, 7].map((j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SupportAgentDashboard() {
  const [inboxes, setInboxes] = useState<InboxDashboardRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function handleModeChange(inboxId: string, newMode: AgentMode) {
    setInboxes((prev) =>
      prev ? prev.map((r) => r.inboxId === inboxId ? { ...r, mode: newMode } : r) : prev,
    );
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get('/api/support/agent/dashboard')
      .then(({ data }) => {
        if (!cancelled) setInboxes(data.inboxes ?? []);
      })
      .catch((err: unknown) => {
        const axiosError = err as { response?: { data?: { error?: string } } };
        if (!cancelled) setError(axiosError.response?.data?.error ?? 'Failed to load dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell
      header={
        <div className="px-6 py-4 border-b border-slate-200 bg-white">
          <h1 className="text-[18px] font-semibold text-slate-800">Support Agent</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Per-inbox agent status and configuration</p>
        </div>
      }
    >
      <div className="px-6 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700 mb-4">
            {error}
          </div>
        )}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Inbox</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Mode</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Drafts pending</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Sent today</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Escalations</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Eval drift</th>
                <th className="px-4 py-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <ShimmerRows />
              ) : !inboxes || inboxes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-[13px]">
                    No active inboxes found.
                  </td>
                </tr>
              ) : (
                inboxes.map((row) => (
                  <tr key={row.inboxId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.inboxName}</td>
                    <td className="px-4 py-3">
                      <ModeToggle
                        inboxId={row.inboxId}
                        mode={row.mode}
                        onModeChange={(m) => handleModeChange(row.inboxId, m)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{row.draftsPending}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{row.sentToday}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{row.escalations}</td>
                    <td className="px-4 py-3 text-center">
                      <EvalDriftDot status={row.evalDriftStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          to="/activity"
                          className="text-[12px] font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          Run history
                        </Link>
                        <Link
                          to="/support/inboxes"
                          className="text-[12px] font-medium text-slate-500 hover:text-slate-700"
                        >
                          Configure
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
