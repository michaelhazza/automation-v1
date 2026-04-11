/**
 * AdminHealthFindingsPage.tsx — Brain Tree OS adoption P4.
 *
 * Lists active workspace health findings grouped by severity, with a
 * per-row "Mark resolved" button.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P4
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Finding {
  id: string;
  detector: string;
  severity: 'info' | 'warning' | 'critical';
  resourceKind: string;
  resourceId: string;
  resourceLabel: string;
  message: string;
  recommendation: string;
  detectedAt: string;
}

const SEVERITY_PILL: Record<Finding['severity'], string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning:  'bg-amber-50 text-amber-700 border-amber-200',
  info:     'bg-slate-100 text-slate-600 border-slate-200',
};

const SEVERITY_ORDER: Finding['severity'][] = ['critical', 'warning', 'info'];

export default function AdminHealthFindingsPage({ user: _user }: { user: User }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Finding[]>('/api/org/health-audit/findings');
      setFindings(res.data ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load findings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/api/org/health-audit/run');
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Audit failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleResolve = async (id: string) => {
    setResolvingId(id);
    try {
      await api.post(`/api/org/health-audit/findings/${id}/resolve`);
      setFindings((prev) => prev.filter((f) => f.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to resolve finding');
    } finally {
      setResolvingId(null);
    }
  };

  // Group by severity in a stable order
  const grouped: Record<Finding['severity'], Finding[]> = { critical: [], warning: [], info: [] };
  for (const f of findings) grouped[f.severity].push(f);

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-[840px] mx-auto">
      <div className="mb-4 text-[13px] text-slate-500 flex items-center gap-1.5">
        <Link to="/" className="text-indigo-600 hover:text-indigo-700 no-underline font-medium">Dashboard</Link>
        <span>/</span>
        <span>Workspace health</span>
      </div>

      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">Workspace Health Findings</h1>
          <p className="text-[13.5px] text-slate-500 mt-1">Active issues detected in your org's agent and process configuration.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[13px] font-semibold px-4 py-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? 'Running audit…' : 'Run audit now'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-[13px] text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
          ))}
        </div>
      ) : findings.length === 0 ? (
        <div className="bg-white border border-dashed border-emerald-200 rounded-xl p-10 text-center">
          <div className="text-[15px] text-emerald-700 font-semibold mb-1">No active findings</div>
          <div className="text-[13px] text-slate-500">Your workspace is healthy. Click "Run audit now" to refresh.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {SEVERITY_ORDER.map((sev) => {
            const list = grouped[sev];
            if (list.length === 0) return null;
            return (
              <section key={sev}>
                <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  {sev} ({list.length})
                </h2>
                <div className="flex flex-col gap-2">
                  {list.map((f) => (
                    <div key={f.id} className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${SEVERITY_PILL[f.severity]}`}>
                              {f.severity}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">{f.detector}</span>
                          </div>
                          <div className="text-[14px] font-semibold text-slate-800">{f.resourceLabel}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResolve(f.id)}
                          disabled={resolvingId === f.id}
                          className="shrink-0 text-[11.5px] font-semibold text-emerald-600 hover:text-emerald-800 border border-emerald-200 rounded-md px-2.5 py-1 bg-white hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {resolvingId === f.id ? 'Resolving…' : 'Mark resolved'}
                        </button>
                      </div>
                      <div className="text-[13px] text-slate-700 mt-1">{f.message}</div>
                      <div className="text-[12px] text-slate-500 italic mt-1">Recommendation: {f.recommendation}</div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
