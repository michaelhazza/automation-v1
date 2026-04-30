import React, { useState, useRef, useEffect } from 'react';
import { formatCostCents, formatTokenCount } from '../lib/formatCost.js';
import type { ConversationCostResponse } from '../../../shared/types/conversationCost.js';

// ---------------------------------------------------------------------------
// CostMeterPill — per-thread cost/token meter shown in the AgentChatPage header.
//
// Renders a compact pill: "{tokenCount} · ${cost}"
// On click, opens a dropdown with a per-model breakdown table.
// Receives the latest cost data as a prop (parent fetches and passes it in).
// Shows nothing (returns null) when conversationId is absent.
// ---------------------------------------------------------------------------

interface CostMeterPillProps {
  cost: ConversationCostResponse | null;
}

export default function CostMeterPill({ cost }: CostMeterPillProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  if (!cost) return null;

  const hasData = cost.totalTokens > 0 || cost.totalCostCents > 0;
  const tokenLabel = formatTokenCount(cost.totalTokens);
  const costLabel  = formatCostCents(cost.totalCostCents, true);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Conversation cost breakdown"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11.5px] font-mono text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors cursor-pointer"
      >
        <span>{tokenLabel}</span>
        <span className="text-slate-300">·</span>
        <span>{costLabel}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[260px] py-2">
          <div className="px-3 pb-1.5 border-b border-slate-100 mb-1">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Cost breakdown</p>
          </div>

          {!hasData ? (
            <p className="px-3 py-2 text-[12px] text-slate-400">No cost data yet</p>
          ) : (
            <>
              {/* Per-model rows */}
              {cost.modelBreakdown.length > 0 && (
                <div className="px-3 py-1">
                  {cost.modelBreakdown.map((row) => (
                    <div key={row.modelId} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-[11.5px] font-mono text-slate-600 truncate max-w-[140px]" title={row.modelId}>
                        {row.modelId}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-400">{formatTokenCount(row.tokensIn + row.tokensOut)}t</span>
                        <span className="text-[11.5px] font-mono text-slate-700">{formatCostCents(row.costCents, true)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals row */}
              <div className="mx-3 mt-1 pt-1.5 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11.5px] text-slate-500">
                  {cost.messageCount} {cost.messageCount === 1 ? 'message' : 'messages'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">{tokenLabel}t</span>
                  <span className="text-[11.5px] font-semibold text-slate-700">{costLabel}</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
