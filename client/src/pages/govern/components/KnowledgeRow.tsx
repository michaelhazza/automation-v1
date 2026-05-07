// client/src/pages/govern/components/KnowledgeRow.tsx
// Row renderer for the Knowledge table.
// Spec: tasks/builds/consolidation-govern/spec.md §4.1, §4.12, §4.13, §4.14

import { useState } from 'react';
import Modal from '../../../components/Modal';
import { approveKnowledge } from '../../../api/governApi';
import type { KnowledgeEntry } from '../../../../../shared/types/govern.js';

interface Props {
  row: KnowledgeEntry;
  hasWritePerm: boolean;
  onOverride: (row: KnowledgeEntry) => void;
  onReject: (row: KnowledgeEntry) => void;
  onApproveSuccess: () => void;
}

const KIND_LABELS: Record<KnowledgeEntry['kind'], string> = {
  belief: 'Belief',
  fact: 'Fact',
  observation: 'Observation',
  preference: 'Preference',
  issue: 'Issue',
};

const KIND_TOOLTIPS: Record<KnowledgeEntry['kind'], string> = {
  belief: 'A durable assumption the agent holds about the workspace or its users.',
  fact: 'A verified, objective piece of information.',
  observation: 'A pattern or signal noticed during a run, not yet verified.',
  preference: 'A stated preference from the user or workspace configuration.',
  issue: 'A problem or risk flagged by the agent during a run.',
};

const STATUS_CLASSES: Record<KnowledgeEntry['status'], string> = {
  pending_review: 'bg-amber-100 text-amber-700',
  in_use: 'bg-green-100 text-green-700',
  ignored: 'bg-slate-100 text-slate-500',
};

const STATUS_LABELS: Record<KnowledgeEntry['status'], string> = {
  pending_review: 'Pending review',
  in_use: 'In use',
  ignored: 'Ignored',
};

function truncateBody(body: string, max = 120): string {
  if (body.length <= max) return body;
  return body.slice(0, max) + '...';
}

export function KnowledgeRow({ row, hasWritePerm, onOverride, onReject, onApproveSuccess }: Props) {
  const [runTraceOpen, setRunTraceOpen] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);

  const isHighConfidence = row.status === 'pending_review' && row.confidence > 0.8;

  async function handleApprove() {
    if (approveBusy) return;
    setApproveBusy(true);
    try {
      await approveKnowledge(row.id);
      onApproveSuccess();
    } finally {
      setApproveBusy(false);
    }
  }

  return (
    <div className="knowledge-row py-1 space-y-1">
      {/* Body excerpt + lock icon */}
      <div className="flex items-start gap-1.5">
        {row.autoUpdateDisabled && (
          <span title="Auto-updates disabled (overridden)" aria-label="Auto-updates disabled">
            <svg
              className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        )}
        <span className="text-sm text-slate-800">{truncateBody(row.body)}</span>
      </div>

      {/* Chips row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Status chip */}
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_CLASSES[row.status]}`}>
          {STATUS_LABELS[row.status]}
        </span>

        {/* Kind chip with tooltip */}
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700"
          title={KIND_TOOLTIPS[row.kind]}
        >
          {KIND_LABELS[row.kind]}
        </span>

        {/* High-confidence badge (spec §4.12) */}
        {isHighConfidence && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">
            High confidence
          </span>
        )}
      </div>

      {/* Provenance: agentName + run trace link */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span>{row.source.agentName}</span>
        {row.source.runId && (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => setRunTraceOpen(true)}
              className="text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
            >
              run {row.source.runId.slice(0, 8)}
            </button>
          </>
        )}
      </div>

      {/* Action buttons (spec §4.14 — hidden when no write perm) */}
      {hasWritePerm && (
        <div className="flex items-center gap-2 pt-0.5">
          {row.status === 'pending_review' && (
            <button
              type="button"
              disabled={approveBusy}
              onClick={handleApprove}
              className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50 transition-colors"
            >
              {approveBusy ? 'Approving...' : 'Approve'}
            </button>
          )}
          {row.status !== 'ignored' && (
            <button
              type="button"
              onClick={() => onReject(row)}
              className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
            >
              Reject
            </button>
          )}
          {row.status === 'in_use' && !row.autoUpdateDisabled && (
            <button
              type="button"
              onClick={() => onOverride(row)}
              className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Edit and override
            </button>
          )}
        </div>
      )}

      {/* Run trace modal (spec §4.12) */}
      {runTraceOpen && row.source.runId && (
        <Modal
          title="Run trace"
          size="iframe"
          onClose={() => setRunTraceOpen(false)}
          bodyPadding="none"
        >
          <iframe
            src={`/run-trace/${encodeURIComponent(row.source.runId)}?embedded=1`}
            className="w-full h-[calc(100vh-120px)] border-0"
            title="Run trace"
          />
        </Modal>
      )}
    </div>
  );
}
