import { useState, useEffect, useRef } from 'react';
import api from '../../../lib/api';
import Modal from '../../Modal';
import MergeReviewBlock from '../MergeReviewBlock';
import { evaluateApprovalState } from '../mergeTypes';
import type {
  AnalysisResult,
  AgentProposal,
  AvailableSystemAgent,
  ParsedCandidate,
} from '../types';
import DiffView from './DiffView';
import AgentChipBlock from './AgentChipBlock';

export default function ResultRow({
  result,
  jobId,
  availableSystemAgents,
  candidate,
  onActionChange,
  onProposalsUpdated,
  onResultPatched,
  expandVersion,
  collapseVersion,
}: {
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  candidate: ParsedCandidate | undefined;
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
  onResultPatched: (next: AnalysisResult) => void;
  expandVersion: number;
  collapseVersion: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showSkill, setShowSkill] = useState(false);

  // Respond to section-level expand/collapse all signals without clobbering
  // individual row toggles that happen after the signal fires.
  const prevExpandVersion = useRef(expandVersion);
  const prevCollapseVersion = useRef(collapseVersion);
  useEffect(() => {
    if (expandVersion !== prevExpandVersion.current) {
      prevExpandVersion.current = expandVersion;
      setExpanded(true);
    }
  }, [expandVersion]);
  useEffect(() => {
    if (collapseVersion !== prevCollapseVersion.current) {
      prevCollapseVersion.current = collapseVersion;
      setExpanded(false);
    }
  }, [collapseVersion]);

  const confidence = Math.round(result.confidence * 100);
  const similarity = result.similarityScore != null ? Math.round(result.similarityScore * 100) : null;
  const isDistinct = result.classification === 'DISTINCT';
  const isDecided = result.actionTaken != null;
  const approvalState = evaluateApprovalState(
    result.mergeWarnings ?? null,
    result.warningResolutions ?? null,
  );
  const hasBlockingWarning = approvalState.blocked;

  async function setAction(action: 'approved' | 'rejected' | 'skipped') {
    setActionError(null);
    try {
      await api.patch(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}`,
        { actionTaken: action },
      );
      onActionChange(result.id, action);
      setExpanded(false);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Action failed.';
      setActionError(msg);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await api.post(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/retry-classification`,
      );
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      const updated = data.results.find((r) => r.id === result.id);
      if (updated) onResultPatched(updated);
    } catch (err) {
      console.error('[SkillAnalyzer] Retry classification failed:', err);
    } finally {
      setRetrying(false);
    }
  }

  // "replaces X" on IMPROVEMENT rows; "vs. X" on all others
  const matchLine = result.matchedSkillContent
    ? `${result.classification === 'IMPROVEMENT' ? 'replaces' : 'vs.'} ${result.matchedSkillContent.name}${similarity != null ? ` · ${similarity}% similar` : ''}`
    : null;

  const statusBadge =
    result.actionTaken === 'approved' ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">approved</span>
    ) : result.actionTaken === 'rejected' ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">rejected</span>
    ) : result.actionTaken === 'skipped' ? (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">skipped</span>
    ) : null;

  return (
    <div style={isDecided ? { opacity: 0.4 } : undefined}>
      {/* Collapsed row header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => { if (!isDecided) setExpanded((v) => !v); }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`text-sm font-medium text-slate-800 leading-snug${isDecided ? ' line-through' : ''}`}>
              {result.candidateName}
            </p>
            {result.isDocumentationFile && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium shrink-0">
                doc file
              </span>
            )}
            {result.isContextFile && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium shrink-0">
                context
              </span>
            )}
          </div>
          {matchLine && <p className="text-xs text-slate-400 mt-0.5">{matchLine}</p>}
        </div>
        {isDecided && statusBadge}
        {!isDecided && <span className="text-xs text-slate-300 flex-shrink-0">{confidence}%</span>}
        {!isDecided && (
          <span
            className="text-slate-300 text-sm flex-shrink-0 transition-transform duration-150"
            style={expanded ? { transform: 'rotate(90deg)' } : undefined}
          >›</span>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && !isDecided && (
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-4 space-y-3">
          {/* Non-skill file warnings */}
          {result.isDocumentationFile && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-800">
              <span className="shrink-0">!</span>
              <span>
                This file appears to be a <strong>documentation file</strong> (README or similar) rather than an executable skill. Importing it as a skill is likely a mistake — consider rejecting it.
              </span>
            </div>
          )}
          {result.isContextFile && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-800">
              <span className="shrink-0">i</span>
              <span>
                This file has no tool definition — it is a <strong>context document</strong> rather than an executable skill. It may belong in the Knowledge Management Agent if you have one, not as a standalone skill.
                {isDistinct && (
                  <span className="block mt-1 font-medium">
                    If approved, this skill will be imported as instructions-only (no structured input schema). Create a tool definition before approving if you need one.
                  </span>
                )}
              </span>
            </div>
          )}
          {/* Reasoning block */}
          {result.classificationReasoning && (
            <p className="text-xs text-slate-500 italic leading-relaxed pl-3 py-2 pr-3 bg-white rounded border-l-2 border-slate-200">
              {result.classificationReasoning}
            </p>
          )}

          {/* Classification failed banner */}
          {result.classificationFailed && (
            <div className="flex items-center gap-3 p-3 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-800">
              <span className="flex-1">
                Couldn't classify this skill
                {result.classificationFailureReason === 'rate_limit' && ' · Rate limit'}
                {result.classificationFailureReason === 'parse_error' && ' · Parse error'}
              </span>
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying || !result.classificationFailed}
                className="px-2 py-1 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}

          {/* Three-column merge view (PARTIAL_OVERLAP / IMPROVEMENT) */}
          {(result.classification === 'PARTIAL_OVERLAP' || result.classification === 'IMPROVEMENT') && candidate && (
            <MergeReviewBlock
              result={result}
              candidate={candidate}
              jobId={jobId}
              onResultUpdated={onResultPatched}
            />
          )}

          {/* Legacy diff pills — shown when no merge proposal exists */}
          {result.diffSummary && !result.proposedMergedContent && (
            <DiffView result={result} />
          )}

          {/* Agent chips (DISTINCT rows only) */}
          {isDistinct && (
            <AgentChipBlock
              result={result}
              jobId={jobId}
              availableSystemAgents={availableSystemAgents}
              onProposalsUpdated={onProposalsUpdated}
            />
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setAction('approved')}
              disabled={hasBlockingWarning}
              title={hasBlockingWarning ? 'Fix critical merge warnings before approving' : undefined}
              className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setAction('rejected')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:text-red-600 transition-colors"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => setAction('skipped')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-400 transition-colors"
            >
              Skip
            </button>
            {candidate && (
              <button
                type="button"
                onClick={() => setShowSkill(true)}
                className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 transition-colors"
              >
                View skill
              </button>
            )}
          </div>

          {actionError && <p className="text-xs text-red-600 -mt-1">{actionError}</p>}
        </div>
      )}

      {/* View skill modal */}
      {showSkill && candidate && (
        <Modal title={candidate.name || result.candidateName} onClose={() => setShowSkill(false)} maxWidth={700}>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Slug</p>
              <code className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700">{result.candidateSlug}</code>
            </div>
            {candidate.description && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Description</p>
                <p className="text-slate-700 text-sm">{candidate.description}</p>
              </div>
            )}
            {candidate.instructions && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Instructions</p>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap text-slate-700">{candidate.instructions}</pre>
              </div>
            )}
            {candidate.definition && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Definition</p>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-48 text-slate-700">{JSON.stringify(candidate.definition, null, 2)}</pre>
              </div>
            )}
            {candidate.rawSource && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Raw source</p>
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap text-slate-700">{candidate.rawSource}</pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
