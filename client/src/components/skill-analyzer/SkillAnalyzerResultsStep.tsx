import { useState } from 'react';
import api from '../../lib/api';
import RestoreBackupControl, { type RestoreOutcome } from './RestoreBackupControl';
import RestoreOutcomeBanner from './RestoreOutcomeBanner';
import type {
  AnalysisJob,
  AnalysisResult,
  AgentProposal,
  BackupMetadata,
} from './types';
import { evaluateApprovalState } from './mergeTypes';
import { SECTION_CONFIG, type Classification } from './resultsStep/constants';
import ResultSection from './resultsStep/ResultSection';
import ProposedAgentBanner from './resultsStep/ProposedAgentBanner';

interface Props {
  job: AnalysisJob;
  results: AnalysisResult[];
  onResultsUpdated: (results: AnalysisResult[]) => void;
  onContinue: () => void;
  backup: BackupMetadata | null;
  onRestoreOutcome: (outcome: RestoreOutcome) => void;
  restoreOutcome: RestoreOutcome | null;
  onDismissRestoreOutcome: () => void;
}

export default function SkillAnalyzerResultsStep({ job, results, onResultsUpdated, onContinue, backup, onRestoreOutcome, restoreOutcome, onDismissRestoreOutcome }: Props) {
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
          className="btn btn-primary shrink-0"
        >
          Continue to Execute →{approvedCount > 0 && ` (${approvedCount})`}
        </button>
      </div>

      {restoreOutcome && (
        <RestoreOutcomeBanner outcome={restoreOutcome} onDismiss={onDismissRestoreOutcome} />
      )}

      {backup?.status === 'active' && (
        <RestoreBackupControl jobId={job.id} onOutcome={onRestoreOutcome} variant="header" />
      )}

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
