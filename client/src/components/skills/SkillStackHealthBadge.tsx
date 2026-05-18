import { useState } from 'react';
import { getStackHealth } from '../../lib/skillAmendmentsApi.js';
import type { StackHealthMetrics } from '../../../../shared/types/skillAmendments.js';

// ── Metric formatting helpers ──────────────────────────────────────────────

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtDensity(value: number): string {
  return value.toFixed(1);
}

function fmtTrend(value: number): string {
  if (value === 0) return '—';
  return value > 0 ? `+${value.toFixed(0)} chars` : `${value.toFixed(0)} chars`;
}

const METRIC_ROWS: Array<{
  label: string;
  key: keyof StackHealthMetrics;
  format: (v: number) => string;
}> = [
  { label: 'Density (accepted / 20)',  key: 'amendmentDensity',   format: fmtDensity },
  { label: 'Conflict rate',            key: 'conflictRate',        format: fmtPct },
  { label: 'Rollback rate (30 days)',  key: 'rollbackRate',        format: fmtPct },
  { label: 'Stale ratio (30 days)',    key: 'staleRatio',          format: fmtPct },
  { label: 'Edit frequency',           key: 'editFrequency',       format: fmtPct },
  { label: 'Composition size trend',   key: 'compositionSizeTrend', format: fmtTrend },
];

// ── Component ──────────────────────────────────────────────────────────────

interface SkillStackHealthBadgeProps {
  subaccountId: string;
  skillId: string;
}

export function SkillStackHealthBadge({ subaccountId, skillId }: SkillStackHealthBadgeProps) {
  const [open, setOpen] = useState(false);
  const [metrics, setMetrics] = useState<StackHealthMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (metrics !== null) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getStackHealth(subaccountId, skillId);
      setMetrics(data);
    } catch {
      setError('Failed to load stack health');
    } finally {
      setLoading(false);
    }
  };

  const allZero =
    metrics !== null &&
    METRIC_ROWS.every(({ key }) => metrics[key] === 0);

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 mt-3.5 text-[12px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer px-0"
      >
        <svg
          className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 6 10"
        >
          <path
            d="M1 1l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {open ? 'Hide advanced details' : 'Show advanced details'}
      </button>

      {open && (
        <div className="mt-3 px-4 py-3.5 bg-white border border-slate-200 rounded-lg">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
            Stack health
          </div>

          {loading ? (
            <div className="space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <p className="text-[12px] text-red-500">{error}</p>
          ) : allZero ? (
            <p className="text-[12px] text-slate-400">No metrics available</p>
          ) : (
            <ul className="space-y-1.5">
              {METRIC_ROWS.map(({ label, key, format }) => (
                <li key={key} className="flex items-center justify-between text-[12px]">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-semibold text-slate-700">
                    {metrics !== null ? format(metrics[key]) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
