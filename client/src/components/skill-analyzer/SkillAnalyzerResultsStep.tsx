import { useState, useMemo, useEffect, useRef } from 'react';
import api from '../../lib/api';
import Modal from '../Modal';
import MergeReviewBlock from './MergeReviewBlock';
import type {
  AnalysisJob,
  AnalysisResult,
  AgentProposal,
  AvailableSystemAgent,
  ParsedCandidate,
} from './SkillAnalyzerWizard';
import { evaluateApprovalState } from './mergeTypes';

interface Props {
  job: AnalysisJob;
  results: AnalysisResult[];
  onResultsUpdated: (results: AnalysisResult[]) => void;
  onContinue: () => void;
}

type Classification = 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';

const SECTION_CONFIG: Record<Classification, {
  label: string;
  dot: string;         // Tailwind bg-* class for the section dot
  bandBg: string;      // hex colour for header band background
  bandBorder: string;  // hex colour for header band bottom border
  badgeBg: string;     // hex colour for count badge background
  badgeText: string;   // hex colour for count badge text
  defaultOpen: boolean;
}> = {
  PARTIAL_OVERLAP: {
    label: 'Partial Overlaps',
    dot: 'bg-amber-400',
    bandBg: '#fffbeb',
    bandBorder: '#fcd34d',
    badgeBg: '#fef3c7',
    badgeText: '#92400e',
    defaultOpen: true,
  },
  IMPROVEMENT: {
    label: 'Replacements — incoming is strictly better',
    dot: 'bg-blue-400',
    bandBg: '#eff6ff',
    bandBorder: '#93c5fd',
    badgeBg: '#dbeafe',
    badgeText: '#1e40af',
    defaultOpen: true,
  },
  DISTINCT: {
    label: 'New Skills',
    dot: 'bg-green-400',
    bandBg: '#f0fdf4',
    bandBorder: '#86efac',
    badgeBg: '#dcfce7',
    badgeText: '#166534',
    defaultOpen: true,
  },
  DUPLICATE: {
    label: 'Duplicates — already in library',
    dot: 'bg-red-400',
    bandBg: '#fef2f2',
    bandBorder: '#fca5a5',
    badgeBg: '#fee2e2',
    badgeText: '#991b1b',
    defaultOpen: false,
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

/** Agent chip block on a DISTINCT card. Renders one chip per agentProposals
 *  entry — pre-checked when proposal.selected is true, click toggles selection
 *  via PATCH. Includes an "Add another system agent..." combobox populated
 *  from job.availableSystemAgents (filtered to agents not already in
 *  agentProposals). See spec §7.1 New Skill cards. */
function AgentChipBlock({
  result,
  jobId,
  availableSystemAgents,
  onProposalsUpdated,
}: {
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');
  const proposals = result.agentProposals ?? [];

  // Agents not already in agentProposals — eligible for the manual-add
  // combobox. Pure derivation, no state.
  const addableAgents = useMemo(() => {
    const inProposals = new Set(proposals.map((p) => p.systemAgentId));
    return availableSystemAgents.filter((a) => !inProposals.has(a.systemAgentId));
  }, [proposals, availableSystemAgents]);

  async function patchProposal(body: {
    systemAgentId: string;
    selected?: boolean;
    remove?: boolean;
    addIfMissing?: boolean;
  }) {
    setError(null);
    try {
      const { data } = await api.patch<AnalysisResult>(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/agents`,
        body,
      );
      // The PATCH endpoint returns the freshly enriched result row with
      // the updated agentProposals array. Push it back to the parent.
      onProposalsUpdated(result.id, data.agentProposals ?? []);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Failed to update agent proposal.';
      console.error('[SkillAnalyzer] Failed to PATCH agent proposal:', err);
      setError(msg);
    }
  }

  async function toggleSelected(proposal: AgentProposal) {
    if (!proposal.systemAgentId) return;    // retro-injected proposed-new-agent; no backing agent yet
    await patchProposal({
      systemAgentId: proposal.systemAgentId,
      selected: !proposal.selected,
    });
  }

  async function removeProposal(proposal: AgentProposal) {
    if (!proposal.systemAgentId) return;
    await patchProposal({ systemAgentId: proposal.systemAgentId, remove: true });
  }

  async function addAgent() {
    if (!selectedToAdd) return;
    await patchProposal({ systemAgentId: selectedToAdd, addIfMissing: true });
    setSelectedToAdd('');
  }

  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-xs">
      <p className="font-medium text-slate-600 mb-2">Assign to system agents:</p>
      {proposals.length === 0 && availableSystemAgents.length === 0 && (
        <p className="text-slate-400 italic">No system agents available.</p>
      )}
      {proposals.length === 0 && availableSystemAgents.length > 0 && (
        <p className="text-slate-400 italic mb-2">No suggested agents — add one below.</p>
      )}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {proposals.map((proposal) => (
          <span
            key={proposal.systemAgentId ?? `proposed:${proposal.proposedAgentIndex ?? 0}`}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition-colors ${
              proposal.selected
                ? proposal.isProposedNewAgent
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleSelected(proposal)}
              className="flex items-center gap-1"
              aria-label={proposal.selected ? 'Deselect' : 'Select'}
            >
              <span className="font-medium">{proposal.nameSnapshot}</span>
              {proposal.isProposedNewAgent && (
                <span className="text-[9px] font-normal px-1 py-[1px] rounded bg-indigo-200 text-indigo-900">
                  Proposed (not yet created)
                </span>
              )}
              {!proposal.isProposedNewAgent && (
                <span className={`text-[10px] ${proposal.selected ? 'opacity-80' : 'opacity-60'}`}>{Math.round(proposal.score * 100)}%</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => removeProposal(proposal)}
              className={`ml-0.5 ${proposal.selected ? 'text-emerald-200 hover:text-white' : 'text-slate-400 hover:text-red-600'}`}
              aria-label="Remove proposal"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {addableAgents.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedToAdd}
            onChange={(e) => setSelectedToAdd(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700"
          >
            <option value="">+ Add another system agent…</option>
            {addableAgents.map((a) => (
              <option key={a.systemAgentId} value={a.systemAgentId}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addAgent}
            disabled={!selectedToAdd}
            className="text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>
  );
}

function ResultRow({
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
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

function ResultSection({
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
              className="text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
              onClick={(e) => { e.stopPropagation(); onBulkAction(classification, 'approved'); }}
            >
              Approve all
            </button>
          )}
          {classification === 'DUPLICATE' && (
            <button
              className="text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
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
            className="text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={(e) => { e.stopPropagation(); setRowExpandVersion((v) => v + 1); if (!open) setOpen(true); }}
            title="Expand all rows in this section"
          >
            Expand all
          </button>
          <button
            className="text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
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

export default function SkillAnalyzerResultsStep({ job, results, onResultsUpdated, onContinue }: Props) {
  const CLASSIFICATIONS: Classification[] = ['PARTIAL_OVERLAP', 'IMPROVEMENT', 'DISTINCT', 'DUPLICATE'];
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkInfo, setBulkInfo] = useState<string | null>(null);
  const [globalExpandVersion, setGlobalExpandVersion] = useState(0);
  const [globalCollapseVersion, setGlobalCollapseVersion] = useState(0);

  const availableSystemAgents = job.availableSystemAgents ?? [];
  const parsedCandidates = job.parsedCandidates ?? [];

  function handleActionChange(resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) {
    onResultsUpdated(
      results.map((r) => (r.id === resultId ? { ...r, actionTaken: action } : r))
    );
  }

  function handleProposalsUpdated(resultId: string, proposals: AgentProposal[]) {
    onResultsUpdated(
      results.map((r) => (r.id === resultId ? { ...r, agentProposals: proposals } : r)),
    );
  }

  /** Phase 5: replace a single result row with the freshly enriched
   *  version returned by the merge PATCH / reset endpoints. The whole row
   *  is swapped (not field-merged) because the server response includes
   *  every field including matchedSkillContent. */
  function handleResultPatched(next: AnalysisResult) {
    onResultsUpdated(results.map((r) => (r.id === next.id ? next : r)));
  }

  async function handleBulkAction(classification: Classification, action: 'approved' | 'rejected' | 'skipped') {
    setBulkError(null);
    setBulkInfo(null);
    const sectionResults = results.filter((r) => r.classification === classification);
    if (sectionResults.length === 0) return;

    // Phase 5 partial-overlap gate: skip PARTIAL_OVERLAP / IMPROVEMENT
    // cards with no proposedMergedContent (LLM fallback path). The
    // executeApproved server-side path also enforces this, but the
    // client-side filter avoids surfacing the failure as a per-row error
    // in the response. Also skip results with blocking merge warnings —
    // those must be resolved before approval.
    let eligible = sectionResults;
    let skippedNone = 0;
    let skippedCritical = 0;
    if ((classification === 'PARTIAL_OVERLAP' || classification === 'IMPROVEMENT') && action === 'approved') {
      eligible = sectionResults.filter((r) => {
        if (!r.proposedMergedContent) return false;
        const state = evaluateApprovalState(r.mergeWarnings ?? null, r.warningResolutions ?? null);
        if (state.blocked) return false;
        return true;
      });
      skippedNone = sectionResults.filter(
        (r) => !r.proposedMergedContent,
      ).length;
      skippedCritical = sectionResults.filter(
        (r) => r.proposedMergedContent != null
          && evaluateApprovalState(r.mergeWarnings ?? null, r.warningResolutions ?? null).blocked,
      ).length;
    }
    if (eligible.length === 0) {
      setBulkInfo('No eligible rows for this bulk action.');
      return;
    }
    const ids = eligible.map((r) => r.id);

    try {
      await api.post(`/api/system/skill-analyser/jobs/${job.id}/results/bulk-action`, {
        resultIds: ids,
        action,
      });
      onResultsUpdated(
        results.map((r) =>
          r.classification === classification && ids.includes(r.id)
            ? { ...r, actionTaken: action }
            : r,
        ),
      );
      const skippedParts: string[] = [];
      if (skippedNone > 0) skippedParts.push(`${skippedNone} (no merge proposal yet)`);
      if (skippedCritical > 0) skippedParts.push(`${skippedCritical} (critical warnings must be resolved)`);
      if (skippedParts.length > 0) {
        setBulkInfo(`Approved ${eligible.length}, skipped ${skippedParts.join(', skipped ')}.`);
      }
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Bulk action failed.';
      console.error('[SkillAnalyzer] Failed to bulk-set actions:', err);
      setBulkError(msg);
    }
  }

  const approvedCount = results.filter((r) => r.actionTaken === 'approved').length;
  const reviewedCount = results.filter((r) => r.actionTaken != null).length;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 mb-0.5">Review Skills</h1>
          <p className="text-xs text-slate-400">
            {results.length} candidates · approve, reject, or skip each skill
          </p>
          <div className="flex gap-2 flex-wrap mt-2">
            {CLASSIFICATIONS.map((c) => {
              const count = results.filter((r) => r.classification === c).length;
              if (count === 0) return null;
              const cfg = SECTION_CONFIG[c];
              return (
                <span
                  key={c}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: cfg.badgeBg, color: cfg.badgeText }}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                  {count} {cfg.label}
                </span>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <div className="h-1.5 w-48 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-400 rounded-full transition-all"
                style={{ width: results.length > 0 ? `${(reviewedCount / results.length) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs text-slate-400">{reviewedCount} of {results.length} reviewed</span>
            <span className="text-slate-200">·</span>
            <button
              type="button"
              className="text-xs text-indigo-500 hover:text-indigo-700 underline-offset-2 hover:underline"
              onClick={() => setGlobalExpandVersion((v) => v + 1)}
            >
              Expand all
            </button>
            <button
              type="button"
              className="text-xs text-indigo-500 hover:text-indigo-700 underline-offset-2 hover:underline"
              onClick={() => setGlobalCollapseVersion((v) => v + 1)}
            >
              Collapse all
            </button>
          </div>
        </div>
        <button
          onClick={onContinue}
          className="shrink-0 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
        >
          Continue to Execute →{approvedCount > 0 && ` (${approvedCount})`}
        </button>
      </div>

      {bulkError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {bulkError}
        </div>
      )}
      {bulkInfo && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          {bulkInfo}
        </div>
      )}

      {/* Agent cluster recommendation banner — v2 Fix 5: Confirm/Reject */}
      {(job.agentRecommendation?.shouldCreateAgent || (job.proposedNewAgents?.length ?? 0) > 0) && (
        <ProposedAgentBanner jobId={job.id} job={job} onJobRefetched={onResultsUpdated} />
      )}

      {/* Result sections */}
      {CLASSIFICATIONS.map((c) => (
        <ResultSection
          key={c}
          classification={c}
          results={results.filter((r) => r.classification === c)}
          jobId={job.id}
          availableSystemAgents={availableSystemAgents}
          parsedCandidates={parsedCandidates}
          onActionChange={handleActionChange}
          onBulkAction={handleBulkAction}
          onProposalsUpdated={handleProposalsUpdated}
          onResultPatched={handleResultPatched}
          onResultsReplaced={onResultsUpdated}
          expandSectionVersion={globalExpandVersion}
          collapseSectionVersion={globalCollapseVersion}
        />
      ))}

      {results.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No results to display.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProposedAgentBanner — v2 Fix 5
// Shows the cluster-recommended new agent with Confirm / Reject buttons.
// Once confirmed, the agent appears as a top-ranked chip in each affected
// skill's AgentChipBlock (via the retro-injected agentProposals entry).
// ---------------------------------------------------------------------------

function ProposedAgentBanner({
  jobId,
  job,
  onJobRefetched,
}: {
  jobId: string;
  job: AnalysisJob;
  onJobRefetched: (results: AnalysisResult[]) => void;
}) {
  // Derive the list of proposed agents — prefer the plural array (v2 Fix 5);
  // fall back to synthesising a single entry from the legacy scalar
  // agentRecommendation for pre-v2 jobs.
  const initialAgents: Array<{
    proposedAgentIndex: number;
    slug: string;
    name: string;
    description: string;
    reasoning: string;
    skillSlugs: string[];
    status: 'proposed' | 'confirmed' | 'rejected';
  }> = job.proposedNewAgents && job.proposedNewAgents.length > 0
    ? job.proposedNewAgents.map((p) => ({
        proposedAgentIndex: p.proposedAgentIndex,
        slug: p.slug,
        name: p.name,
        description: p.description,
        reasoning: p.reasoning,
        skillSlugs: p.skillSlugs,
        status: p.status,
      }))
    : job.agentRecommendation
    ? [{
        proposedAgentIndex: 0,
        slug: job.agentRecommendation.agentSlug ?? 'proposed-agent',
        name: job.agentRecommendation.agentName ?? 'Proposed Agent',
        description: job.agentRecommendation.agentDescription ?? job.agentRecommendation.reasoning,
        reasoning: job.agentRecommendation.reasoning,
        skillSlugs: job.agentRecommendation.skillSlugs ?? [],
        status: 'proposed',
      }]
    : [];

  const [agents, setAgents] = useState(initialAgents);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(proposedAgentIndex: number, action: 'confirm' | 'reject') {
    setPendingIndex(proposedAgentIndex);
    setError(null);
    try {
      await api.patch(`/api/system/skill-analyser/jobs/${jobId}/proposed-agents`, {
        proposedAgentIndex,
        action,
      });
      // Refetch the whole job so retro-injected agentProposals on
      // DISTINCT results reflect the confirmation/rejection.
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      onJobRefetched(data.results);
      setAgents((prev) =>
        prev.map((p) =>
          p.proposedAgentIndex === proposedAgentIndex
            ? { ...p, status: action === 'confirm' ? 'confirmed' : 'rejected' }
            : p,
        ),
      );
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to update proposed agent.');
    } finally {
      setPendingIndex(null);
    }
  }

  if (agents.length === 0) return null;

  return (
    <div className="space-y-2">
      {agents.map((agent) => (
        <div
          key={agent.proposedAgentIndex}
          className={`p-4 rounded-xl border ${
            agent.status === 'confirmed'
              ? 'bg-emerald-50 border-emerald-200'
              : agent.status === 'rejected'
              ? 'bg-slate-50 border-slate-200'
              : 'bg-indigo-50 border-indigo-200'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 mb-0.5">
                {agent.status === 'confirmed' && '✓ '}
                {agent.status === 'rejected' && '✗ '}
                New agent suggested: {agent.name}
                {agent.status === 'confirmed' && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900">Confirmed</span>}
                {agent.status === 'rejected' && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">Rejected</span>}
              </p>
              {agent.description && (
                <p className="text-xs text-slate-700 mb-2">{agent.description}</p>
              )}
              <p className="text-xs text-slate-600 italic">{agent.reasoning}</p>
              {agent.skillSlugs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {agent.skillSlugs.map((slug) => (
                    <span key={slug} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                      {slug}
                    </span>
                  ))}
                </div>
              )}
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
            {agent.status === 'proposed' && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={pendingIndex === agent.proposedAgentIndex}
                  onClick={() => handle(agent.proposedAgentIndex, 'confirm')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={pendingIndex === agent.proposedAgentIndex}
                  onClick={() => handle(agent.proposedAgentIndex, 'reject')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
          {agent.status === 'confirmed' && (
            <p className="mt-2 text-[11px] text-emerald-800">
              This agent will be created with status=&quot;draft&quot; during Execute. Skills in the list above will attach to it; the draft is promoted to active when at least one skill attaches successfully.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
