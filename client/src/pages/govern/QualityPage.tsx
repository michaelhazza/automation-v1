// client/src/pages/govern/QualityPage.tsx
// Govern / Quality page — three tabs: Agents drift, Scorecards, Bench history.
// Trust & Verification Layer spec §12, §14.

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ScorecardLibraryTab } from './ScorecardLibraryTab';
import {
  listAgentsDrift,
  listBenchHistory,
  type AgentDriftRow,
  type BenchRun,
} from '../../lib/api/benchRuns';
import { benchStateLabel, formatCostEstimate } from '../../lib/benchUiPure';

type Tab = 'agents' | 'scorecards' | 'bench';

const TAB_LABELS: Record<Tab, string> = {
  agents:     'Agents',
  scorecards: 'Scorecards',
  bench:      'Bench history',
};

// ── Agents drift tab ─────────────────────────────────────────────────────────

function AgentsDriftTab() {
  const [rows, setRows] = useState<AgentDriftRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    listAgentsDrift()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);

  if (error) {
    return <ErrorState error={error} retry={() => setError(null)} />;
  }

  if (rows === null) {
    return <div className="text-sm text-slate-500 py-8 px-6">Loading...</div>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No agents found"
        body="Attach a scorecard to an agent to start tracking quality."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Agent</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Avg score</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Pending</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Last judged</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r) => (
            <tr key={r.agentId} className="hover:bg-slate-50">
              <td className="px-6 py-3 font-medium text-slate-900">{r.agentName}</td>
              <td className="px-6 py-3 text-right text-slate-700">
                {r.avgScore !== null ? r.avgScore.toFixed(2) : '—'}
              </td>
              <td className="px-6 py-3 text-right">
                {r.pendingCount > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
                    {r.pendingCount}
                  </span>
                ) : (
                  <span className="text-slate-400">0</span>
                )}
              </td>
              <td className="px-6 py-3 text-right text-slate-400 text-xs">
                {r.lastJudgedAt ? new Date(r.lastJudgedAt).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Bench history tab ─────────────────────────────────────────────────────────

function BenchHistoryTab() {
  const [runs, setRuns] = useState<BenchRun[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setRuns(null);
    setError(null);
    listBenchHistory()
      .then(setRuns)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);

  if (error) {
    return <ErrorState error={error} retry={() => setError(null)} />;
  }

  if (runs === null) {
    return <div className="text-sm text-slate-500 py-8 px-6">Loading...</div>;
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        title="No bench runs yet"
        body="Run a model bench to compare candidates."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Run</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">State</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Candidates</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Cost</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Approved model</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {runs.map((run) => (
            <tr key={run.id} className="hover:bg-slate-50">
              <td className="px-6 py-3 text-slate-500 text-xs font-mono">{run.id.slice(0, 8)}</td>
              <td className="px-6 py-3">
                <span className="text-slate-700">{benchStateLabel(run.state)}</span>
              </td>
              <td className="px-6 py-3 text-right text-slate-600">{run.candidateModelIds.length}</td>
              <td className="px-6 py-3 text-right text-slate-600">
                {run.actualCostCents !== null
                  ? formatCostEstimate(run.actualCostCents)
                  : formatCostEstimate(run.estimatedCostCents) + '*'}
              </td>
              <td className="px-6 py-3 text-slate-700 text-xs font-mono">
                {run.approvedModelId ?? '—'}
              </td>
              <td className="px-6 py-3 text-right text-slate-400 text-xs">
                {new Date(run.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function QualityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: Tab = (searchParams.get('tab') as Tab) ?? 'agents';

  function setTab(tab: Tab) {
    setSearchParams({ tab });
  }

  return (
    <PageShell
      header={
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h1 className="text-lg font-semibold text-slate-900">Quality</h1>
        </div>
      }
    >
      {/* Tab bar */}
      <div className="border-b border-slate-100 px-6">
        <nav className="-mb-px flex gap-6">
          {(['agents', 'scorecards', 'bench'] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setTab(tab)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'agents'     && <AgentsDriftTab />}
      {activeTab === 'scorecards' && <ScorecardLibraryTab />}
      {activeTab === 'bench'      && <BenchHistoryTab />}
    </PageShell>
  );
}
