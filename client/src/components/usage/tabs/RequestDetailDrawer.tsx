import { DetailField } from '../atoms/DetailField';
import { formatCents, formatTokens, parseFallbackChain } from '../format';
import type { RoutingLogItem } from '../types';

export function RequestDetailDrawer({ request: r, onClose }: { request: RoutingLogItem; onClose: () => void }) {
  const fallbackChain = parseFallbackChain(r.fallbackChain);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 animate-[fadeIn_0.15s_ease-out_both]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-bold text-slate-900 m-0">Request Detail</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 bg-transparent border-0 cursor-pointer text-[18px] leading-none">&times;</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[12px]">
        <DetailField label="ID" value={r.id} mono />
        <DetailField label="Idempotency Key" value={r.idempotencyKey} mono />
        <DetailField label="Run ID" value={r.runId} mono />
        <DetailField label="Execution ID" value={r.executionId} mono />
        <DetailField label="Task Type" value={r.taskType} />
        <DetailField label="Agent" value={r.agentName} />
        <DetailField label="Created At" value={new Date(r.createdAt).toLocaleString()} />
        <DetailField label="Status" value={r.status} />
        <DetailField label="Execution Phase" value={r.executionPhase} />
        <DetailField label="Capability Tier" value={r.capabilityTier} />
        <DetailField label="Routing Reason" value={r.routingReason} />
        <DetailField label="Was Downgraded" value={String(r.wasDowngraded)} />
        <DetailField label="Was Escalated" value={String(r.wasEscalated)} />
        {r.escalationReason && <DetailField label="Escalation Reason" value={r.escalationReason} />}
      </div>

      {/* Provider routing */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Provider Routing</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-[12px]">
          <DetailField label="Requested" value={r.requestedProvider && r.requestedModel ? `${r.requestedProvider}/${r.requestedModel}` : '—'} />
          <DetailField label="Actual" value={`${r.provider}/${r.model}`} />
          <DetailField label="Model Time" value={r.providerLatencyMs ? `${(r.providerLatencyMs / 1000).toFixed(2)}s` : '—'} />
          <DetailField label="Routing Time" value={r.routerOverheadMs ? `${r.routerOverheadMs}ms` : '—'} />
        </div>
      </div>

      {/* Fallback chain timeline */}
      {fallbackChain && fallbackChain.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Fallback Chain</h4>
          <div className="space-y-1.5">
            {fallbackChain.map((attempt, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${attempt.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="font-medium text-slate-700">{attempt.provider}/{attempt.model}</span>
                {attempt.error && <span className="text-red-500 truncate">{attempt.error}</span>}
                {attempt.success && <span className="text-emerald-600 font-semibold">Success</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tokens & cost */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Tokens & Cost</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-[12px]">
          <DetailField label="Tokens In" value={formatTokens(r.tokensIn)} />
          <DetailField label="Tokens Out" value={formatTokens(r.tokensOut)} />
          <DetailField label="Cached Tokens" value={formatTokens(r.cachedPromptTokens)} />
          <DetailField label="Raw Cost" value={`$${Number(r.costRaw).toFixed(6)}`} />
          <DetailField label="Cost w/ Margin" value={`$${Number(r.costWithMargin).toFixed(6)}`} />
          <DetailField label="Margin" value={`${r.marginMultiplier}x`} />
          <DetailField label="Final Cost" value={formatCents(r.costWithMarginCents)} />
        </div>
      </div>

      {/* Hashes */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Audit Hashes</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-[12px]">
          <DetailField label="Request Hash" value={r.requestPayloadHash} mono />
          <DetailField label="Response Hash" value={r.responsePayloadHash} mono />
        </div>
      </div>
    </div>
  );
}
