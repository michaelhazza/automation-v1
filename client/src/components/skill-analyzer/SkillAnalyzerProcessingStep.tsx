import { useState, useEffect } from 'react';
import api from '../../lib/api';
import type { AnalysisJob, AnalysisResult } from './SkillAnalyzerWizard';

interface Props {
  jobId: string;
  initialJob: AnalysisJob;
  onComplete: (job: AnalysisJob, results: AnalysisResult[]) => void;
  onStartNew: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  pending: 'Queued',
  parsing: 'Parsing skill definitions',
  hashing: 'Checking for exact duplicates',
  embedding: 'Generating embeddings',
  comparing: 'Computing similarity scores',
  classifying: 'Classifying with AI',
  completed: 'Complete',
  failed: 'Failed',
};

export default function SkillAnalyzerProcessingStep({ jobId, initialJob, onComplete, onStartNew }: Props) {
  const [currentJob, setCurrentJob] = useState<AnalysisJob>(initialJob);
  const [pollErrorCount, setPollErrorCount] = useState(0);

  useEffect(() => {
    // Terminal state at mount — no polling needed.
    if (initialJob.status === 'completed' || initialJob.status === 'failed') return;

    // Local `cancelled` flag instead of a ref — refs + StrictMode double-mount
    // leave the cleanup-set ref stuck at false across the second mount, which
    // silently discards every poll result and pins the UI to the initial state.
    let cancelled = false;

    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/api/system/skill-analyser/jobs/${jobId}`);
        if (cancelled) return;
        const { job: j, results: r } = res.data as { job: AnalysisJob; results: AnalysisResult[] };
        setCurrentJob(j);
        setPollErrorCount(0);

        if (j.status === 'completed') {
          clearInterval(interval);
          onComplete(j, r);
        } else if (j.status === 'failed') {
          clearInterval(interval);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[SkillAnalyzer] Polling error:', err);
        setPollErrorCount((n) => n + 1);
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const isFailed = currentJob.status === 'failed';
  const pct = currentJob.progressPct ?? 0;
  const showPollWarning = !isFailed && currentJob.status !== 'completed' && pollErrorCount >= 2;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl mx-auto">
      <h2 className="text-base font-semibold text-slate-800 mb-6 text-center">
        {isFailed ? 'Analysis Failed' : 'Analyzing Skills…'}
      </h2>

      {!isFailed && (
        <>
          {/* Progress bar */}
          <div className="mb-4">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-xs text-slate-500">
                {PHASE_LABELS[currentJob.status] ?? currentJob.status}
              </span>
              <span className="text-xs text-slate-500">{pct}%</span>
            </div>
          </div>

          {currentJob.progressMessage && (
            <p className="text-sm text-slate-600 text-center">{currentJob.progressMessage}</p>
          )}

          {currentJob.candidateCount != null && (
            <p className="text-sm text-slate-500 text-center mt-2">
              Found <strong>{currentJob.candidateCount}</strong> skill
              {currentJob.candidateCount === 1 ? '' : 's'} in the import
            </p>
          )}

          {showPollWarning && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 text-center">
              Connection issue — retrying. Status may be stale.
            </div>
          )}

          <div className="flex justify-center mt-6">
            <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        </>
      )}

      {isFailed && (
        <>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-6">
            {currentJob.errorMessage || 'An unexpected error occurred during processing.'}
          </div>
          <div className="flex justify-center">
            <button
              onClick={onStartNew}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Start New Analysis
            </button>
          </div>
        </>
      )}
    </div>
  );
}
