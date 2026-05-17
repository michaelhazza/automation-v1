import { DistributionBar } from '../atoms/DistributionBar';
import { formatCents } from '../format';
import type { RoutingDistribution } from '../types';

export function RoutingDistribution({ dist }: { dist: RoutingDistribution }) {
  if (dist.totalRequests === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-bold text-slate-900 m-0">Routing Distribution</h3>
        <div className="text-[13px] text-slate-500">
          <span className="font-semibold text-slate-900">{formatCents(dist.totalCostCents)}</span>
          <span className="mx-1.5 text-slate-300">·</span>
          {dist.totalRequests.toLocaleString()} requests
        </div>
      </div>

      <DistributionBar
        label="Capability Tier"
        items={[
          { name: 'frontier', count: dist.byTier.frontier, cost: dist.costByTier.frontier, color: 'bg-indigo-400' },
          { name: 'economy', count: dist.byTier.economy, cost: dist.costByTier.economy, color: 'bg-emerald-400' },
        ]}
      />
      <DistributionBar
        label="Routing Reason"
        items={Object.entries(dist.byReason).map(([name, count]) => ({
          name, count, cost: dist.costByReason[name] ?? 0,
          color: name === 'forced' ? 'bg-purple-400' : name === 'ceiling' ? 'bg-blue-400' : name === 'economy' ? 'bg-emerald-400' : 'bg-amber-400',
        }))}
      />
      <DistributionBar
        label="Status"
        items={Object.entries(dist.byStatus).map(([name, count]) => ({
          name, count, cost: 0,
          color: name === 'success' ? 'bg-emerald-400' : name === 'error' ? 'bg-red-400' : name === 'timeout' ? 'bg-amber-400' : 'bg-slate-400',
        }))}
      />
      <DistributionBar
        label="Execution Phase"
        items={Object.entries(dist.byPhase).map(([name, count]) => ({
          name, count, cost: 0,
          color: name === 'planning' ? 'bg-blue-400' : name === 'execution' ? 'bg-emerald-400' : 'bg-violet-400',
        }))}
      />

      {/* Latency summary */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Avg Model Time</h4>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
          <span className="text-slate-500">Frontier: <span className="font-semibold text-slate-700">{dist.latencyByTier.frontier ? `${(dist.latencyByTier.frontier / 1000).toFixed(1)}s` : '—'}</span></span>
          <span className="text-slate-500">Economy: <span className="font-semibold text-slate-700">{dist.latencyByTier.economy ? `${(dist.latencyByTier.economy / 1000).toFixed(1)}s` : '—'}</span></span>
          {Object.entries(dist.latencyByProvider).map(([p, ms]) => (
            <span key={p} className="text-slate-500 capitalize">{p}: <span className="font-semibold text-slate-700">{ms ? `${(ms / 1000).toFixed(1)}s` : '—'}</span></span>
          ))}
        </div>
      </div>
    </div>
  );
}
