import { useState } from 'react';
import { useCompositionSnapshot } from '../../hooks/useSkillCompositionSnapshot.js';
import type { SnapshotAmendmentIncluded, SnapshotAmendmentExcluded } from '../../hooks/useSkillCompositionSnapshot.js';

interface RunTraceCompositionPanelProps {
  runId: string;
}

type PanelTab = 'snapshot' | 'amendments';

export function RunTraceCompositionPanel({ runId }: RunTraceCompositionPanelProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('snapshot');
  const { snapshot, loading, error } = useCompositionSnapshot(open ? runId : null);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer px-0 font-medium"
      >
        <svg
          className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 6 10"
        >
          <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {open ? 'Hide composition detail' : 'Show composition detail'}
      </button>

      {open && (
        <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-slate-200">
            {(['snapshot', 'amendments'] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-[12px] font-medium border-0 cursor-pointer transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-indigo-500 text-indigo-600 bg-transparent' : 'border-transparent text-slate-500 hover:text-slate-700 bg-transparent'}`}
              >
                {tab === 'snapshot' ? 'Snapshot' : 'Amendments used'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {loading && (
              <div className="text-[12px] text-slate-400">Loading…</div>
            )}
            {error && (
              <div className="text-[12px] text-red-600">{error}</div>
            )}
            {!loading && !error && snapshot === null && (
              <div className="text-[12.5px] text-slate-400">
                No amendment snapshot for this run.
              </div>
            )}
            {!loading && !error && snapshot !== null && (
              <>
                {activeTab === 'snapshot' && (
                  <SnapshotTab
                    resolverVersion={snapshot.resolverVersion}
                    composedSizeChars={snapshot.composedSizeChars}
                    amendmentVersionSetHash={snapshot.amendmentVersionSetHash}
                    truncated={snapshot.truncated}
                  />
                )}
                {activeTab === 'amendments' && (
                  <AmendmentsTab
                    includedAmendments={snapshot.includedAmendments}
                    excludedAmendments={snapshot.excludedAmendments}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Snapshot tab ──────────────────────────────────────────────────────────────

function SnapshotTab({
  resolverVersion,
  composedSizeChars,
  amendmentVersionSetHash,
  truncated,
}: {
  resolverVersion: string;
  composedSizeChars: number;
  amendmentVersionSetHash: string;
  truncated: boolean;
}) {
  const rows = [
    { key: 'Resolver version', val: resolverVersion },
    { key: 'Composed size', val: `${composedSizeChars.toLocaleString()} chars` },
    { key: 'Amendment set hash', val: amendmentVersionSetHash.slice(0, 16) + '…' },
    { key: 'Truncated', val: truncated ? 'Yes' : 'No' },
  ];
  return (
    <div className="divide-y divide-slate-100">
      {rows.map(({ key, val }) => (
        <div key={key} className="flex gap-2 py-1.5 text-[12px]">
          <span className="min-w-[140px] font-semibold text-slate-500 shrink-0">{key}</span>
          <span className="text-slate-700 font-mono text-[11.5px]">{val}</span>
        </div>
      ))}
    </div>
  );
}

// ── Amendments tab ────────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  instruction_extension: 'Add context',
  example:               'Add example',
  guardrail:             'Guardrail',
  context_fact:          'Context',
  exception:             'Exception',
};

const KIND_STYLES: Record<string, string> = {
  instruction_extension: 'bg-green-50 text-green-700',
  example:               'bg-blue-50 text-blue-700',
  guardrail:             'bg-red-50 text-red-700',
  context_fact:          'bg-amber-50 text-amber-700',
  exception:             'bg-slate-100 text-slate-600',
};

function AmendmentsTab({
  includedAmendments,
  excludedAmendments,
}: {
  includedAmendments: SnapshotAmendmentIncluded[];
  excludedAmendments: SnapshotAmendmentExcluded[];
}) {
  return (
    <div className="space-y-3">
      {includedAmendments.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Included ({includedAmendments.length})
          </div>
          <div className="space-y-2">
            {includedAmendments.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-[12px]">
                <span className="text-green-600 shrink-0 mt-0.5">✓</span>
                <span
                  className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${KIND_STYLES[a.kind] ?? 'bg-slate-100 text-slate-600'}`}
                >
                  {KIND_LABELS[a.kind] ?? a.kind}
                </span>
                <span className="text-slate-600 truncate">{a.bodyPreview}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {excludedAmendments.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Excluded ({excludedAmendments.length})
          </div>
          <div className="space-y-1">
            {excludedAmendments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="text-red-500 shrink-0">✗</span>
                <span className="text-slate-400 font-mono text-[11px]">{a.id.slice(0, 8)}…</span>
                {a.retirementReason && (
                  <span className="text-slate-400 text-[11px]">{a.retirementReason}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {includedAmendments.length === 0 && excludedAmendments.length === 0 && (
        <div className="text-[12.5px] text-slate-400">
          No amendments were applied during this run.
        </div>
      )}
    </div>
  );
}
