/**
 * HealthAuditWidget.tsx — Brain Tree OS adoption P4 dashboard widget.
 *
 * Compact card showing the active workspace health finding count grouped
 * by severity. "Refresh" button calls the on-demand audit endpoint.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P4
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

interface Finding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
}

interface AuditCounts {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

export default function HealthAuditWidget() {
  const [counts, setCounts] = useState<AuditCounts>({ critical: 0, warning: 0, info: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    try {
      const res = await api.get<Finding[]>('/api/org/health-audit/findings');
      const findings = res.data ?? [];
      const c: AuditCounts = { critical: 0, warning: 0, info: 0, total: findings.length };
      for (const f of findings) {
        if (f.severity === 'critical') c.critical++;
        else if (f.severity === 'warning') c.warning++;
        else c.info++;
      }
      setCounts(c);
      setError(null);
    } catch (err: any) {
      // Most likely 403 — user lacks the permission. Hide silently.
      if (err.response?.status !== 403) {
        setError('Failed to load health findings');
      } else {
        setError('hidden');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadFindings(); }, [loadFindings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post('/api/org/health-audit/run');
      await loadFindings();
    } catch (err: any) {
      // 403 means the user lost permission since the widget rendered. Hide
      // silently to mirror the loadFindings path. Any other error surfaces.
      if (err.response?.status === 403) {
        setError('hidden');
      } else {
        setError(err.response?.data?.message ?? 'Audit failed');
      }
    } finally {
      setRefreshing(false);
    }
  };

  // Permission denied — render nothing
  if (error === 'hidden') return null;

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 h-[120px] animate-pulse" />
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-bold text-slate-500 uppercase tracking-wider m-0">Workspace Health</h3>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 border-0 bg-transparent cursor-pointer p-0 disabled:text-slate-300 disabled:cursor-not-allowed"
        >
          {refreshing ? 'Running…' : 'Refresh'}
        </button>
      </div>

      {counts.total === 0 ? (
        <div className="text-[13.5px] text-slate-500">No issues detected.</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <SeverityCell label="Critical" count={counts.critical} cls="text-red-700 bg-red-50 border-red-200" />
          <SeverityCell label="Warning" count={counts.warning} cls="text-amber-700 bg-amber-50 border-amber-200" />
          <SeverityCell label="Info" count={counts.info} cls="text-slate-600 bg-slate-50 border-slate-200" />
        </div>
      )}

      {error && error !== 'hidden' && (
        <div className="mt-2 text-[11.5px] text-red-600">{error}</div>
      )}

      <div className="mt-3 text-right">
        <Link
          to="/admin/health-findings"
          className="text-[11.5px] font-semibold text-indigo-500 hover:text-indigo-700 no-underline"
        >
          View findings →
        </Link>
      </div>
    </div>
  );
}

function SeverityCell({ label, count, cls }: { label: string; count: number; cls: string }) {
  return (
    <div className={`border rounded-lg px-2 py-2 text-center ${cls}`}>
      <div className="text-[20px] font-extrabold leading-tight">{count}</div>
      <div className="text-[10px] uppercase font-semibold tracking-wider">{label}</div>
    </div>
  );
}
