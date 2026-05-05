import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { RunCostResponse } from '../../../../shared/types/runCost';
import {
  buildTokensLabel,
  formatCost,
  selectRenderMode,
  type FetchState,
} from './RunCostPanelPure';

// ---------------------------------------------------------------------------
// RunCostPanel — per-run cost visibility for direct agent-run surfaces.
//
// Spec: tasks/hermes-audit-tier-1-spec.md §5 (Phase A).
//
// Props contract (§5.3):
//   - `runId`: the agent run to fetch cost for
//   - `runIsTerminal`: caller-computed terminal-status assertion via
//     `isTerminalRunStatus` from `client/src/lib/runStatus`. When false,
//     the panel renders the "Run in progress" placeholder and does NOT
//     fetch /api/runs/:runId/cost (§5.2.1).
//   - `compact`: single-line layout for in-card rendering (e.g.
//     SessionLogCardList, AdminAgentEditPage). Default false (full layout).
//
// Host surfaces (§5.5):
//   - `SessionLogCardList` (compact)
//   - `RunTraceView`       (full)
//   - `AdminAgentEditPage` (compact; replaces the inline fetch at
//     AdminAgentEditPage.tsx:1697-1702)
//
// Branch decisions + formatted strings live in `RunCostPanelPure.ts`.
// This file only wires the fetch lifecycle and renders the JSX for each
// decision the pure module returns.
// ---------------------------------------------------------------------------

interface RunCostPanelProps {
  runId:         string;
  runIsTerminal: boolean;
  compact?:      boolean;
}

function Skeleton({ compact }: { compact: boolean }) {
  const shimmer =
    'bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] ' +
    'bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] rounded';
  if (compact) {
    return <div className={`h-4 w-40 ${shimmer}`} data-testid="run-cost-skeleton" />;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="run-cost-skeleton">
      <div className={`h-5 w-32 ${shimmer}`} />
      <div className={`h-4 w-48 ${shimmer}`} />
      <div className={`h-16 w-full ${shimmer}`} />
    </div>
  );
}

function InProgressPlaceholder() {
  return (
    <div className="text-[12px] text-slate-400 italic" data-testid="run-cost-in-progress">
      Run in progress — cost available after completion
    </div>
  );
}

function ErrorState() {
  return (
    <div className="text-[12px] text-slate-400" data-testid="run-cost-error">
      Cost data unavailable
    </div>
  );
}

function ZeroCostState() {
  return (
    <div className="text-[12px] text-slate-400" data-testid="run-cost-zero">
      — no LLM spend recorded
    </div>
  );
}

function CompactBody({ data }: { data: RunCostResponse }) {
  return (
    <dl
      className="flex items-baseline gap-3 text-[12px] text-slate-600"
      data-testid="run-cost-panel"
      data-mode="compact"
    >
      <div className="flex items-baseline gap-1.5">
        <dt className="sr-only">Total cost</dt>
        <dd className="font-semibold text-slate-800">{formatCost(data.totalCostCents)}</dd>
      </div>
      <div className="text-slate-500">
        <dt className="sr-only">Call count and tokens</dt>
        <dd>{buildTokensLabel(data)}</dd>
      </div>
    </dl>
  );
}

function FullBody({ data }: { data: RunCostResponse }) {
  return (
    <div className="flex flex-col gap-2" data-testid="run-cost-panel" data-mode="full">
      <dl className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <dt className="text-[11px] text-slate-400 uppercase tracking-wider">Total cost</dt>
          <dd className="text-[15px] font-semibold text-slate-800">
            {formatCost(data.totalCostCents)}
          </dd>
        </div>
        <div className="text-[12px] text-slate-500">
          <dt className="sr-only">Call count and tokens</dt>
          <dd>{buildTokensLabel(data)}</dd>
        </div>
      </dl>
      <table className="w-full text-[12px] border border-slate-200 rounded">
        <caption className="sr-only">Call-site cost breakdown</caption>
        <thead>
          <tr className="text-left text-slate-400 uppercase tracking-wider text-[10px]">
            <th scope="col" className="px-2 py-1 font-medium">Call site</th>
            <th scope="col" className="px-2 py-1 font-medium text-right">Cost</th>
            <th scope="col" className="px-2 py-1 font-medium text-right">Calls</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100" data-row="app">
            <th scope="row" className="px-2 py-1 font-normal text-slate-600">app</th>
            <td className="px-2 py-1 text-right text-slate-700 font-medium tabular-nums">
              {formatCost(data.callSiteBreakdown.app.costCents)}
            </td>
            <td className="px-2 py-1 text-right text-slate-600 tabular-nums">
              {data.callSiteBreakdown.app.requestCount}
            </td>
          </tr>
          <tr className="border-t border-slate-100" data-row="worker">
            <th scope="row" className="px-2 py-1 font-normal text-slate-600">worker</th>
            <td className="px-2 py-1 text-right text-slate-700 font-medium tabular-nums">
              {formatCost(data.callSiteBreakdown.worker.costCents)}
            </td>
            <td className="px-2 py-1 text-right text-slate-600 tabular-nums">
              {data.callSiteBreakdown.worker.requestCount}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function RunCostPanel({ runId, runIsTerminal, compact = false }: RunCostPanelProps) {
  const [state, setState] = useState<FetchState>(() =>
    runIsTerminal ? { status: 'loading' } : { status: 'idle' },
  );

  useEffect(() => {
    if (!runIsTerminal) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .get<RunCostResponse>(`/api/runs/${runId}/cost`)
      .then((r) => {
        if (cancelled) return;
        setState({ status: 'loaded', data: r.data });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, runIsTerminal]);

  const mode = selectRenderMode(runIsTerminal, state);
  switch (mode.kind) {
    case 'inProgress': return <InProgressPlaceholder />;
    case 'loading':    return <Skeleton compact={compact} />;
    case 'error':      return <ErrorState />;
    case 'zero':       return <ZeroCostState />;
    case 'data':       return compact ? <CompactBody data={mode.data} /> : <FullBody data={mode.data} />;
  }
}

export default RunCostPanel;
