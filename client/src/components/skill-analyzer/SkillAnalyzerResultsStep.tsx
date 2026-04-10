import { useState } from 'react';
import api from '../../lib/api';
import type { AnalysisJob, AnalysisResult } from './SkillAnalyzerWizard';

interface Props {
  job: AnalysisJob;
  results: AnalysisResult[];
  onResultsUpdated: (results: AnalysisResult[]) => void;
  onContinue: () => void;
}

type Classification = 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';

const SECTION_CONFIG: Record<Classification, {
  label: string;
  subtitle: string;
  colour: string;
  headerColour: string;
  defaultOpen: boolean;
}> = {
  DUPLICATE: {
    label: 'Duplicates',
    subtitle: 'Already in your library — recommend skipping',
    colour: 'border-red-200 bg-red-50/30',
    headerColour: 'text-red-700 bg-red-50',
    defaultOpen: false,
  },
  IMPROVEMENT: {
    label: 'Improvements',
    subtitle: 'Better versions of existing skills — recommend approving',
    colour: 'border-blue-200 bg-blue-50/30',
    headerColour: 'text-blue-700 bg-blue-50',
    defaultOpen: true,
  },
  PARTIAL_OVERLAP: {
    label: 'Partial Overlaps',
    subtitle: 'Shared purpose — human judgment required',
    colour: 'border-amber-200 bg-amber-50/30',
    headerColour: 'text-amber-700 bg-amber-50',
    defaultOpen: true,
  },
  DISTINCT: {
    label: 'New Skills',
    subtitle: 'Novel skills not in your library — recommend importing',
    colour: 'border-green-200 bg-green-50/30',
    headerColour: 'text-green-700 bg-green-50',
    defaultOpen: true,
  },
};

function DiffView({ result }: { result: AnalysisResult }) {
  if (!result.diffSummary) return null;
  const { addedFields, removedFields, changedFields } = result.diffSummary;
  if (addedFields.length === 0 && removedFields.length === 0 && changedFields.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-xs">
      <p className="font-medium text-slate-600 mb-2">Field differences:</p>
      <div className="space-y-1">
        {addedFields.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-green-50 text-green-700 rounded">
            + {f}
          </span>
        ))}
        {removedFields.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-red-50 text-red-700 rounded">
            − {f}
          </span>
        ))}
        {changedFields.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-amber-50 text-amber-700 rounded">
            ~ {f}
          </span>
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  jobId,
  onActionChange,
}: {
  result: AnalysisResult;
  jobId: string;
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);

  async function setAction(action: 'approved' | 'rejected' | 'skipped') {
    const next = result.actionTaken === action ? null : action;
    try {
      if (next) {
        await api.patch(`/api/skill-analyzer/jobs/${jobId}/results/${result.id}`, { action: next });
      } else {
        // Sending 'skipped' as a neutral reset
        await api.patch(`/api/skill-analyzer/jobs/${jobId}/results/${result.id}`, { action: 'skipped' });
      }
      onActionChange(result.id, next);
    } catch {
      // ignore
    }
  }

  const confidence = Math.round(result.confidence * 100);
  const similarity = result.similarityScore != null ? Math.round(result.similarityScore * 100) : null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-slate-800 text-sm">{result.candidateName}</span>
            <code className="text-xs text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{result.candidateSlug}</code>
          </div>
          {result.matchedSkillName && (
            <p className="text-xs text-slate-500 mb-1">
              vs. <strong>{result.matchedSkillName}</strong>
              {similarity != null && ` · ${similarity}% similar`}
              {` · ${confidence}% confidence`}
            </p>
          )}
          {result.classificationReasoning && (
            <p className="text-xs text-slate-600 mt-1">{result.classificationReasoning}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setAction('approved')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              result.actionTaken === 'approved'
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-green-400 hover:text-green-600'
            }`}
          >
            Approve
          </button>
          <button
            onClick={() => setAction('rejected')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              result.actionTaken === 'rejected'
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-red-400 hover:text-red-600'
            }`}
          >
            Reject
          </button>
          <button
            onClick={() => setAction('skipped')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              result.actionTaken === 'skipped'
                ? 'bg-slate-400 text-white border-slate-400'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            Skip
          </button>
        </div>
      </div>

      {/* Diff toggle */}
      {result.diffSummary && (
        <button
          onClick={() => setShowDiff((v) => !v)}
          className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {showDiff ? 'Hide' : 'Show'} field differences
        </button>
      )}
      {showDiff && <DiffView result={result} />}
    </div>
  );
}

function ResultSection({
  classification,
  results,
  jobId,
  onActionChange,
  onBulkAction,
}: {
  classification: Classification;
  results: AnalysisResult[];
  jobId: string;
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onBulkAction: (classification: Classification, action: 'approved' | 'rejected' | 'skipped') => void;
}) {
  const [open, setOpen] = useState(SECTION_CONFIG[classification].defaultOpen);
  const cfg = SECTION_CONFIG[classification];

  if (results.length === 0) return null;

  return (
    <div className={`border rounded-xl overflow-hidden ${cfg.colour}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 ${cfg.headerColour}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{cfg.label}</span>
          <span className="text-xs font-medium px-2 py-0.5 bg-white/60 rounded-full">{results.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs opacity-70">{cfg.subtitle}</span>
          <span className="text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {/* Bulk action bar */}
          <div className="flex items-center gap-2 pb-3 border-b border-white/50">
            <span className="text-xs text-slate-500 font-medium">Bulk:</span>
            {classification === 'IMPROVEMENT' && (
              <button
                onClick={() => onBulkAction(classification, 'approved')}
                className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Approve all improvements
              </button>
            )}
            {classification === 'DISTINCT' && (
              <button
                onClick={() => onBulkAction(classification, 'approved')}
                className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Approve all new
              </button>
            )}
            {classification === 'DUPLICATE' && (
              <button
                onClick={() => onBulkAction(classification, 'rejected')}
                className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Reject all duplicates
              </button>
            )}
          </div>

          {results.map((r) => (
            <ResultCard
              key={r.id}
              result={r}
              jobId={jobId}
              onActionChange={onActionChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SkillAnalyzerResultsStep({ job, results, onResultsUpdated, onContinue }: Props) {
  const CLASSIFICATIONS: Classification[] = ['IMPROVEMENT', 'DISTINCT', 'PARTIAL_OVERLAP', 'DUPLICATE'];

  function handleActionChange(resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) {
    onResultsUpdated(
      results.map((r) => (r.id === resultId ? { ...r, actionTaken: action } : r))
    );
  }

  async function handleBulkAction(classification: Classification, action: 'approved' | 'rejected' | 'skipped') {
    const ids = results.filter((r) => r.classification === classification).map((r) => r.id);
    if (ids.length === 0) return;

    try {
      await api.post(`/api/skill-analyzer/jobs/${job.id}/results/bulk-action`, {
        resultIds: ids,
        action,
      });
      onResultsUpdated(
        results.map((r) =>
          r.classification === classification ? { ...r, actionTaken: action } : r
        )
      );
    } catch {
      // ignore
    }
  }

  const approvedCount = results.filter((r) => r.actionTaken === 'approved').length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="flex gap-6 text-sm">
          {CLASSIFICATIONS.map((c) => {
            const count = results.filter((r) => r.classification === c).length;
            if (count === 0) return null;
            const cfg = SECTION_CONFIG[c];
            return (
              <span key={c} className={`font-medium ${cfg.headerColour.split(' ')[0]}`}>
                {count} {cfg.label}
              </span>
            );
          })}
        </div>
        <button
          onClick={onContinue}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Continue to Execute
          {approvedCount > 0 && ` (${approvedCount} approved)`}
        </button>
      </div>

      {/* Result sections */}
      {CLASSIFICATIONS.map((c) => (
        <ResultSection
          key={c}
          classification={c}
          results={results.filter((r) => r.classification === c)}
          jobId={job.id}
          onActionChange={handleActionChange}
          onBulkAction={handleBulkAction}
        />
      ))}

      {results.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No results to display.</div>
      )}
    </div>
  );
}
