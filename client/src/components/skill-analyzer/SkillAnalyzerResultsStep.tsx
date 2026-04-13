import { useState, useMemo } from 'react';
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
    await patchProposal({
      systemAgentId: proposal.systemAgentId,
      selected: !proposal.selected,
    });
  }

  async function removeProposal(proposal: AgentProposal) {
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
            key={proposal.systemAgentId}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition-colors ${
              proposal.selected
                ? 'bg-emerald-600 border-emerald-600 text-white'
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
              <span className={`text-[10px] ${proposal.selected ? 'opacity-80' : 'opacity-60'}`}>{Math.round(proposal.score * 100)}%</span>
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

function ResultCard({
  result,
  jobId,
  availableSystemAgents,
  candidate,
  onActionChange,
  onProposalsUpdated,
  onResultPatched,
}: {
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  candidate: ParsedCandidate | undefined;
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
  onResultPatched: (next: AnalysisResult) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [showSkill, setShowSkill] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function setAction(action: 'approved' | 'rejected' | 'skipped') {
    const next = result.actionTaken === action ? null : action;
    setActionError(null);
    try {
      if (next) {
        await api.patch(`/api/system/skill-analyser/jobs/${jobId}/results/${result.id}`, { action: next });
      } else {
        // Sending 'skipped' as a neutral reset
        await api.patch(`/api/system/skill-analyser/jobs/${jobId}/results/${result.id}`, { action: 'skipped' });
      }
      onActionChange(result.id, next);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Failed to save action.';
      console.error('[SkillAnalyzer] Failed to set result action:', err);
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

  const confidence = Math.round(result.confidence * 100);
  const similarity = result.similarityScore != null ? Math.round(result.similarityScore * 100) : null;

  const isDistinct = result.classification === 'DISTINCT';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-slate-800 text-sm">{result.candidateName}</span>
            <code className="text-xs text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{result.candidateSlug}</code>
          </div>
          {result.matchedSkillContent && (
            <p className="text-xs text-slate-500 mb-1">
              vs. <strong>{result.matchedSkillContent.name}</strong>
              {similarity != null && ` · ${similarity}% similar`}
              {` · ${confidence}% confidence`}
            </p>
          )}
          {result.classificationReasoning && (
            <p className="text-xs text-slate-600 mt-1">{result.classificationReasoning}</p>
          )}
          {result.classificationFailed && (
            <div className="mt-2 p-2 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-800">
              <p className="font-medium mb-1">
                Couldn't classify (temporary issue)
                {result.classificationFailureReason === 'rate_limit' && (
                  <span className="ml-1 font-normal opacity-70">· Rate limit</span>
                )}
                {result.classificationFailureReason === 'parse_error' && (
                  <span className="ml-1 font-normal opacity-70">· Parse error</span>
                )}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying || !result.classificationFailed}
                className="text-xs px-2 py-1 rounded border border-amber-300 bg-white text-amber-700 hover:bg-amber-50 disabled:opacity-50"
              >
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {candidate && (
            <button
              onClick={() => setShowSkill(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700"
            >
              View
            </button>
          )}
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

      {actionError && (
        <p className="mt-2 text-xs text-red-600">{actionError}</p>
      )}

      {/* Agent chip block — only on DISTINCT cards. */}
      {isDistinct && (
        <AgentChipBlock
          result={result}
          jobId={jobId}
          availableSystemAgents={availableSystemAgents}
          onProposalsUpdated={onProposalsUpdated}
        />
      )}

      {/* Phase 5: Three-column merge view — only on PARTIAL_OVERLAP /
          IMPROVEMENT cards. Reads the candidate from the job's
          parsedCandidates array indexed by result.candidateIndex. */}
      {(result.classification === 'PARTIAL_OVERLAP' || result.classification === 'IMPROVEMENT') && candidate && (
        <MergeReviewBlock
          result={result}
          candidate={candidate}
          jobId={jobId}
          onResultUpdated={onResultPatched}
        />
      )}

      {/* Legacy diff pills — kept for partial overlaps that have no
          merge proposal yet (LLM fallback path) so the reviewer still
          sees field-level differences. */}
      {result.diffSummary && !result.proposedMergedContent && (
        <button
          onClick={() => setShowDiff((v) => !v)}
          className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
        >
          {showDiff ? 'Hide' : 'Show'} field differences
        </button>
      )}
      {showDiff && !result.proposedMergedContent && <DiffView result={result} />}

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
}) {
  const [open, setOpen] = useState(SECTION_CONFIG[classification].defaultOpen);
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
            />
          ))}
        </div>
      )}

      {classification === 'PARTIAL_OVERLAP' && bulkRetryStatus && !bulkRetrying && open && (
        <div className="px-4 py-2 text-xs text-slate-600 border-t border-slate-100">{bulkRetryStatus}</div>
      )}
    </div>
  );
}

export default function SkillAnalyzerResultsStep({ job, results, onResultsUpdated, onContinue }: Props) {
  const CLASSIFICATIONS: Classification[] = ['PARTIAL_OVERLAP', 'IMPROVEMENT', 'DISTINCT', 'DUPLICATE'];
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkInfo, setBulkInfo] = useState<string | null>(null);

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
    // in the response.
    let eligible = sectionResults;
    let skippedCount = 0;
    if ((classification === 'PARTIAL_OVERLAP' || classification === 'IMPROVEMENT') && action === 'approved') {
      eligible = sectionResults.filter((r) => r.proposedMergedContent != null);
      skippedCount = sectionResults.length - eligible.length;
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
      if (skippedCount > 0) {
        setBulkInfo(
          `Approved ${eligible.length}, skipped ${skippedCount} (no merge proposal yet).`,
        );
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
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 w-48 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-400 rounded-full transition-all"
                style={{ width: results.length > 0 ? `${(reviewedCount / results.length) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-xs text-slate-400">{reviewedCount} of {results.length} reviewed</span>
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
        />
      ))}

      {results.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No results to display.</div>
      )}
    </div>
  );
}
