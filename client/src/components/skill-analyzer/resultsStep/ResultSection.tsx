import { useState, useEffect, useRef } from 'react';
import api from '../../../lib/api';
import type {
  AnalysisResult,
  AgentProposal,
  AvailableSystemAgent,
  ParsedCandidate,
} from '../types';
import { SECTION_CONFIG, type Classification } from './constants';
import ResultRow from './ResultRow';

export default function ResultSection({
  classification,
  results,
  jobId,
  availableSystemAgents,
  parsedCandidates,
  onActionChange,
  onBulkAction,
  onProposalsUpdated,
  onResultPatched,
  onResultsReplaced,
  expandSectionVersion,
  collapseSectionVersion,
}: {
  classification: Classification;
  results: AnalysisResult[];
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  parsedCandidates: ParsedCandidate[];
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onBulkAction: (classification: Classification, action: 'approved' | 'rejected' | 'skipped') => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
  onResultPatched: (next: AnalysisResult) => void;
  onResultsReplaced: (results: AnalysisResult[]) => void;
  expandSectionVersion: number;
  collapseSectionVersion: number;
}) {
  const [open, setOpen] = useState(SECTION_CONFIG[classification].defaultOpen);
  const [rowExpandVersion, setRowExpandVersion] = useState(0);
  const [rowCollapseVersion, setRowCollapseVersion] = useState(0);

  const prevExpandSectionVersion = useRef(expandSectionVersion);
  const prevCollapseSectionVersion = useRef(collapseSectionVersion);
  useEffect(() => {
    if (expandSectionVersion !== prevExpandSectionVersion.current) {
      prevExpandSectionVersion.current = expandSectionVersion;
      setOpen(true);
      setRowExpandVersion((v) => v + 1);
    }
  }, [expandSectionVersion]);
  useEffect(() => {
    if (collapseSectionVersion !== prevCollapseSectionVersion.current) {
      prevCollapseSectionVersion.current = collapseSectionVersion;
      setOpen(true); // keep section open but collapse its rows
      setRowCollapseVersion((v) => v + 1);
    }
  }, [collapseSectionVersion]);
  const cfg = SECTION_CONFIG[classification];
  const failedResults = results.filter((r) => r.classificationFailed);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [bulkRetryStatus, setBulkRetryStatus] = useState<string | null>(null);

  async function handleBulkRetry() {
    setBulkRetrying(true);
    setBulkRetryStatus(null);
    try {
      const { data: retryData } = await api.post<{ ok: boolean; retried: number; stillFailed: number }>(
        `/api/system/skill-analyser/jobs/${jobId}/retry-failed-classifications`,
      );
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      onResultsReplaced(data.results);
      setBulkRetryStatus(
        retryData.stillFailed === 0
          ? `All ${retryData.retried} retried successfully`
          : `Retried ${retryData.retried}, ${retryData.stillFailed} still failed`,
      );
    } catch (err) {
      console.error('[SkillAnalyzer] Bulk retry failed:', err);
      setBulkRetryStatus('Retry failed — check console for details');
    } finally {
      setBulkRetrying(false);
    }
  }

  if (results.length === 0) return null;

  const approvedInSection = results.filter((r) => r.actionTaken != null).length;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      {/* Coloured band header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ backgroundColor: cfg.bandBg, borderBottom: `2px solid ${cfg.bandBorder}` }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">{cfg.label}</span>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: cfg.badgeBg, color: cfg.badgeText }}
        >
          {results.length}
        </span>
        <span className="text-xs text-slate-400">{approvedInSection} reviewed</span>
        <div className="ml-auto flex items-center gap-2">
          {(classification === 'IMPROVEMENT' || classification === 'DISTINCT' || classification === 'PARTIAL_OVERLAP') && (
            <button
              className="btn btn-secondary btn-xs"
              onClick={(e) => { e.stopPropagation(); onBulkAction(classification, 'approved'); }}
            >
              Approve all
            </button>
          )}
          {classification === 'DUPLICATE' && (
            <button
              className="btn btn-secondary btn-xs"
              onClick={(e) => { e.stopPropagation(); onBulkAction(classification, 'rejected'); }}
            >
              Reject all
            </button>
          )}
          {classification === 'PARTIAL_OVERLAP' && failedResults.length > 0 && (
            <button
              type="button"
              disabled={bulkRetrying}
              className="text-xs px-2.5 py-1 rounded-md border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors"
              onClick={(e) => { e.stopPropagation(); handleBulkRetry(); }}
            >
              {bulkRetrying ? 'Retrying…' : `Retry failed (${failedResults.length})`}
            </button>
          )}
          <button
            className="btn btn-secondary btn-xs"
            onClick={(e) => { e.stopPropagation(); setRowExpandVersion((v) => v + 1); if (!open) setOpen(true); }}
            title="Expand all rows in this section"
          >
            Expand all
          </button>
          <button
            className="btn btn-secondary btn-xs"
            onClick={(e) => { e.stopPropagation(); setRowCollapseVersion((v) => v + 1); }}
            title="Collapse all rows in this section"
          >
            Collapse all
          </button>
          <span className="text-xs text-slate-400">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="divide-y divide-slate-50">
          {results.map((r) => (
            <ResultRow
              key={r.id}
              result={r}
              jobId={jobId}
              availableSystemAgents={availableSystemAgents}
              candidate={parsedCandidates[r.candidateIndex]}
              onActionChange={onActionChange}
              onProposalsUpdated={onProposalsUpdated}
              onResultPatched={onResultPatched}
              expandVersion={rowExpandVersion}
              collapseVersion={rowCollapseVersion}
            />
          ))}
        </div>
      )}

      {classification === 'PARTIAL_OVERLAP' && bulkRetryStatus && !bulkRetrying && (
        <div className="px-4 py-2 text-xs text-slate-600 border-t border-slate-100">{bulkRetryStatus}</div>
      )}
    </div>
  );
}
