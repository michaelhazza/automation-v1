import { Badge } from '../atoms/Badge';
import { formatCents, parseFallbackChain } from '../format';
import { TIER_COLORS, REASON_COLORS, STATUS_COLORS, SHIMMER_CLASS } from '../constants';
import type { RoutingLogItem } from '../types';

interface RoutingLogTableProps {
  log: RoutingLogItem[];
  selectedRequest: RoutingLogItem | null;
  tabLoading: boolean;
  nextCursor: string | null;
  nextCursorId: string | null;
  loadingMore: boolean;
  onSelectRequest: (r: RoutingLogItem | null) => void;
  onLoadMore: () => void;
}

export function RoutingLogTable({ log, selectedRequest, tabLoading, nextCursor, loadingMore, onSelectRequest, onLoadMore }: RoutingLogTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/50">
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time</th>
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent</th>
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Provider / Model</th>
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Phase</th>
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tier</th>
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Reason</th>
            <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
            <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Model Time</th>
            <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {tabLoading && log.length === 0 ? (
            [...Array(5)].map((_, i) => (
              <tr key={i}>
                {[...Array(9)].map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className={`h-4 rounded ${SHIMMER_CLASS}`} style={{ width: j === 2 ? '140px' : '60px' }} /></td>
                ))}
              </tr>
            ))
          ) : log.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-5 py-12 text-center">
                <div className="text-slate-400 text-sm">No routing data for this period.</div>
                <div className="text-slate-400 text-[12px] mt-1">Try expanding the date range or removing filters.</div>
              </td>
            </tr>
          ) : (
            log.map(row => {
              const hadFallback = row.requestedProvider && row.requestedModel && (row.requestedProvider !== row.provider || row.requestedModel !== row.model);
              const fallbackChainParsed = parseFallbackChain(row.fallbackChain);
              const failedAfterN = row.status !== 'success' && fallbackChainParsed && !fallbackChainParsed.some(a => a.success);
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectRequest(selectedRequest?.id === row.id ? null : row)}
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-slate-700 font-medium max-w-[120px] truncate">{row.agentName ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {hadFallback ? (
                      <div className="text-[12px]">
                        <span className="text-slate-400">{row.requestedProvider}/{row.requestedModel}</span>
                        <span className="text-slate-300 mx-1">&rarr;</span>
                        <span className="text-slate-900 font-medium">{row.provider}/{row.model}</span>
                      </div>
                    ) : (
                      <div className="text-[12px] text-slate-900 font-medium">{row.provider}/{row.model}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5"><Badge label={row.executionPhase} colorMap={{ planning: 'bg-blue-100 text-blue-700', execution: 'bg-emerald-100 text-emerald-700', synthesis: 'bg-violet-100 text-violet-700' }} /></td>
                  <td className="px-4 py-2.5"><Badge label={row.capabilityTier} colorMap={TIER_COLORS} /></td>
                  <td className="px-4 py-2.5"><Badge label={row.routingReason} colorMap={REASON_COLORS} /></td>
                  <td className="px-4 py-2.5">
                    {failedAfterN
                      ? <span className="text-[11px] font-semibold text-red-600">Failed after {fallbackChainParsed!.length} attempts</span>
                      : <Badge label={row.status} colorMap={STATUS_COLORS} />
                    }
                  </td>
                  <td className="px-4 py-2.5 text-right text-[12px] text-slate-500">
                    {row.providerLatencyMs ? `${(row.providerLatencyMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[12px] font-semibold text-slate-900">{formatCents(row.costWithMarginCents)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {nextCursor && (
        <div className="px-5 py-3 border-t border-slate-100 text-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer disabled:opacity-50 [font-family:inherit]"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
