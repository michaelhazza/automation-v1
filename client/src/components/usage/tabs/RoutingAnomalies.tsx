import { anomalyColor } from '../format';
import { ANOMALY_THRESHOLDS } from '../constants';
import type { RoutingDistribution } from '../types';

export function RoutingAnomalies({ dist }: { dist: RoutingDistribution }) {
  if (dist.totalRequests === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: 'Fallback Rate', value: dist.fallbackPct, thresholds: ANOMALY_THRESHOLDS.fallback, desc: 'of requests required provider fallback' },
        { label: 'Escalation Rate', value: dist.escalationPct, thresholds: ANOMALY_THRESHOLDS.escalation, desc: 'of requests escalated from economy to frontier' },
        { label: 'Economy Usage', value: dist.downgradePct, thresholds: { warn: 2, danger: 2 }, desc: 'of requests used economy tier' },
      ].map(flag => (
        <div key={flag.label} className={`border rounded-xl px-4 py-3 ${flag.label === 'Economy Usage' ? 'text-slate-600 bg-slate-50 border-slate-200' : anomalyColor(flag.value, flag.thresholds)}`}>
          <div className="text-[20px] font-extrabold">{Math.round(flag.value * 100)}%</div>
          <div className="text-[11px] font-bold uppercase tracking-wider mt-0.5">{flag.label}</div>
          <div className="text-[11px] mt-0.5 opacity-75">{flag.desc}</div>
        </div>
      ))}
    </div>
  );
}
