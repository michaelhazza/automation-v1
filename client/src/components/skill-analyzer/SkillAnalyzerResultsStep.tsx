import { useState, useMemo } from 'react';
import api from '../../lib/api';
import type {
  AnalysisJob,
  AnalysisResult,
  AgentProposal,
  AvailableSystemAgent,
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

// ---------------------------------------------------------------------------
// Phase 4 of skill-analyzer-v2: handler status warning + agent chip block
// ---------------------------------------------------------------------------

/** Renders the "Handler: registered / unregistered" status above a New Skill
 *  card. Reads job.unregisteredHandlerSlugs.includes(result.candidateSlug) to
 *  decide which state. Per spec §7.1, the warning state hides the agent
 *  chip block and disables the Approve button (handled by the parent). */
function HandlerStatusBlock({ unregistered }: { unregistered: boolean }) {
  if (!unregistered) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span aria-hidden="true">✓</span>
        <span>Handler registered</span>
      </div>
    );
  }
  return (
    <div className="mt-2 p-2 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800">
      <p className="font-medium mb-1">
        <span aria-hidden="true">⚠</span> No handler registered for this skill
      </p>
      <p>
        An engineer must add an entry to{' '}
        <code className="text-[11px]">SKILL_HANDLERS</code> in{' '}
        <code className="text-[11px]">server/services/skillExecutor.ts</code>{' '}
        before this skill can be imported.
      </p>
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
      const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
      const msg = e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Failed to update agent proposal.';
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
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleSelected(proposal)}
              className="flex items-center gap-1"
              aria-label={proposal.selected ? 'Deselect' : 'Select'}
            >
              <span aria-hidden="true">{proposal.selected ? '✓' : '○'}</span>
              <span className="font-medium">{proposal.nameSnapshot}</span>
              <span className="text-[10px] opacity-70">{Math.round(proposal.score * 100)}%</span>
            </button>
            <button
              type="button"
              onClick={() => removeProposal(proposal)}
              className="ml-0.5 text-slate-400 hover:text-red-600"
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
  unregisteredHandler,
  availableSystemAgents,
  onActionChange,
  onProposalsUpdated,
}: {
  result: AnalysisResult;
  jobId: string;
  unregisteredHandler: boolean;
  availableSystemAgents: AvailableSystemAgent[];
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = e?.response?.data?.error ?? e?.message ?? 'Failed to save action.';
      console.error('[SkillAnalyzer] Failed to set result action:', err);
      setActionError(msg);
    }
  }

  const confidence = Math.round(result.confidence * 100);
  const similarity = result.similarityScore != null ? Math.round(result.similarityScore * 100) : null;

  // Phase 4 of skill-analyzer-v2: Approve is disabled on DISTINCT cards
  // whose candidate slug has no registered handler. Per spec §7.1 the
  // gate also hides the agent chip block (no point assigning a broken
  // skill to agents). Other classifications are unaffected — partial
  // overlaps target existing rows whose handler is guaranteed by the
  // boot-time validator.
  const isDistinct = result.classification === 'DISTINCT';
  const approveDisabled = isDistinct && unregisteredHandler;
  const approveTooltip = approveDisabled
    ? 'No handler registered for this skill. An engineer must add an entry to SKILL_HANDLERS in server/services/skillExecutor.ts before this skill can be imported.'
    : undefined;

  return (
    <div className={`bg-white border rounded-lg p-4 ${approveDisabled ? 'border-red-200' : 'border-slate-200'}`}>
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
          {/* Handler status badge / warning — only on DISTINCT cards */}
          {isDistinct && <HandlerStatusBlock unregistered={unregisteredHandler} />}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => !approveDisabled && setAction('approved')}
            disabled={approveDisabled}
            title={approveTooltip}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              approveDisabled
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                : result.actionTaken === 'approved'
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

      {/* Phase 4: Agent chip block — only on DISTINCT cards with a registered
          handler. Hidden when the handler is unregistered (the warning above
          covers it). */}
      {isDistinct && !unregisteredHandler && (
        <AgentChipBlock
          result={result}
          jobId={jobId}
          availableSystemAgents={availableSystemAgents}
          onProposalsUpdated={onProposalsUpdated}
        />
      )}

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
  unregisteredHandlerSlugs,
  availableSystemAgents,
  onActionChange,
  onBulkAction,
  onProposalsUpdated,
}: {
  classification: Classification;
  results: AnalysisResult[];
  jobId: string;
  unregisteredHandlerSlugs: Set<string>;
  availableSystemAgents: AvailableSystemAgent[];
  onActionChange: (resultId: string, action: 'approved' | 'rejected' | 'skipped' | null) => void;
  onBulkAction: (classification: Classification, action: 'approved' | 'rejected' | 'skipped') => void;
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
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
              unregisteredHandler={unregisteredHandlerSlugs.has(r.candidateSlug)}
              availableSystemAgents={availableSystemAgents}
              onActionChange={onActionChange}
              onProposalsUpdated={onProposalsUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SkillAnalyzerResultsStep({ job, results, onResultsUpdated, onContinue }: Props) {
  const CLASSIFICATIONS: Classification[] = ['IMPROVEMENT', 'DISTINCT', 'PARTIAL_OVERLAP', 'DUPLICATE'];
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkInfo, setBulkInfo] = useState<string | null>(null);

  // Phase 4 of skill-analyzer-v2: client-side handler gate. The set is
  // computed from the live job.unregisteredHandlerSlugs snapshot the GET
  // response includes; cards in this set get a disabled Approve button +
  // warning, and the "Approve all new" bulk action filters them out.
  const unregisteredHandlerSlugs = useMemo(
    () => new Set(job.unregisteredHandlerSlugs ?? []),
    [job.unregisteredHandlerSlugs],
  );
  const availableSystemAgents = job.availableSystemAgents ?? [];

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

  async function handleBulkAction(classification: Classification, action: 'approved' | 'rejected' | 'skipped') {
    setBulkError(null);
    setBulkInfo(null);
    const sectionResults = results.filter((r) => r.classification === classification);
    if (sectionResults.length === 0) return;

    // Phase 4 handler gate: skip DISTINCT cards whose handler is not
    // registered. Spec §7.1 + §7.2.
    let eligible = sectionResults;
    let skippedCount = 0;
    if (classification === 'DISTINCT' && action === 'approved') {
      eligible = sectionResults.filter((r) => !unregisteredHandlerSlugs.has(r.candidateSlug));
      skippedCount = sectionResults.length - eligible.length;
    }
    if (eligible.length === 0) {
      setBulkInfo(
        skippedCount > 0
          ? `Skipped ${skippedCount} card${skippedCount === 1 ? '' : 's'} (no handler registered — engineer must wire up handlers first).`
          : 'No eligible rows for this bulk action.',
      );
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
          `Approved ${eligible.length}, skipped ${skippedCount} (no handler registered — engineer must wire up handlers first).`,
        );
      }
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = e?.response?.data?.error ?? e?.message ?? 'Bulk action failed.';
      console.error('[SkillAnalyzer] Failed to bulk-set actions:', err);
      setBulkError(msg);
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
          unregisteredHandlerSlugs={unregisteredHandlerSlugs}
          availableSystemAgents={availableSystemAgents}
          onActionChange={handleActionChange}
          onBulkAction={handleBulkAction}
          onProposalsUpdated={handleProposalsUpdated}
        />
      ))}

      {results.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">No results to display.</div>
      )}
    </div>
  );
}
