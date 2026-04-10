import { useState, useEffect, useRef } from 'react';
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (currentJob.status === 'completed' || currentJob.status === 'failed') return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/api/system/skill-analyser/jobs/${jobId}`);
        const { job: j, results: r } = res.data as { job: AnalysisJob; results: AnalysisResult[] };
        if (!mountedRef.current) return;
        setCurrentJob(j);

        if (j.status === 'completed') {
          clearInterval(intervalRef.current!);
          onComplete(j, r);
        } else if (j.status === 'failed') {
          clearInterval(intervalRef.current!);
        }
      } catch (err) {
        console.error('[SkillAnalyzer] Polling error:', err);
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const isFailed = currentJob.status === 'failed';
  const pct = currentJob.progressPct ?? 0;

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
