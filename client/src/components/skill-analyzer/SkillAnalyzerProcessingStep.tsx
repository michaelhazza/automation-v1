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

type SkillRowStatus = 'done' | 'classifying' | 'stale' | 'failed' | 'queued';

function deriveRowStatus(
  slug: string,
  results: AnalysisResult[],
  inFlight: Record<string, number>,
  nowMs: number,
): SkillRowStatus {
  const result = results.find((r) => r.candidateSlug === slug);
  if (result) return result.classificationFailed ? 'failed' : 'done';
  const startedAt = inFlight[slug];
  if (startedAt !== undefined) {
    // 120s threshold: per-call classify budget is 180s (SKILL_CLASSIFY_TIMEOUT_MS)
    // with a one-shot retry, so anything under 2 min is still well inside the
    // normal envelope — flagging earlier just creates false-alarm noise.
    return nowMs - startedAt > 120_000 ? 'stale' : 'classifying';
  }
  return 'queued';
}

function failureReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'timed_out':   return 'timed out';
    case 'rate_limit':  return 'rate limited';
    case 'parse_error': return 'parse error';
    default:            return 'classification failed';
  }
}

export default function SkillAnalyzerProcessingStep({ jobId, initialJob, onComplete, onStartNew }: Props) {
  const [currentJob, setCurrentJob] = useState<AnalysisJob>(initialJob);
  const [pollErrorCount, setPollErrorCount] = useState(0);
  const [liveResults, setLiveResults] = useState<AnalysisResult[]>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [lastProgressAt, setLastProgressAt] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

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
        setLiveResults(r);
        setLastProgressAt((prev) => {
          const newTs = new Date(j.updatedAt).getTime();
          return newTs > prev ? newTs : prev;
        });
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

  const classifyQueue = currentJob.classifyState?.queue ?? [];
  const inFlight = currentJob.classifyState?.inFlight ?? {};

  return (
    <div className="space-y-4">
      {/* Page header — matches Results step layout */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 mb-0.5">
            {isFailed ? 'Analysis Failed' : 'Analyzing Skills…'}
          </h1>
          {currentJob.candidateCount != null && (
            <p className="text-xs text-slate-400">
              Found {currentJob.candidateCount} skill{currentJob.candidateCount === 1 ? '' : 's'} in the import
              {currentJob.status === 'classifying' && classifyQueue.length > 0 && classifyQueue.length < currentJob.candidateCount && (
                <span> · {classifyQueue.length} need AI classification</span>
              )}
            </p>
          )}
        </div>
        {isFailed && (
          <button
            onClick={onStartNew}
            className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Start New Analysis
          </button>
        )}
      </div>

      {isFailed && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {currentJob.errorMessage || 'An unexpected error occurred during processing.'}
        </div>
      )}

      {!isFailed && (
        <>
          {/* Progress bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">
                {currentJob.progressMessage ?? PHASE_LABELS[currentJob.status] ?? currentJob.status}
              </span>
              <span className="text-xs text-slate-500">{pct}%</span>
            </div>

            {!(currentJob.status === 'classifying' && classifyQueue.length > 0) && (
              <div className="flex justify-center mt-4">
                <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Per-skill classification rows */}
          {currentJob.status === 'classifying' && classifyQueue.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="space-y-px">
                {classifyQueue.map((slug) => {
                  const status = deriveRowStatus(slug, liveResults, inFlight, nowMs);
                  const result = liveResults.find((r) => r.candidateSlug === slug);
                  return (
                    <div
                      key={slug}
                      className={`flex items-center gap-2 px-4 py-2 text-sm ${
                        status === 'done'        ? 'bg-green-950 text-green-200' :
                        status === 'failed'      ? 'bg-red-950 text-red-300' :
                        status === 'stale'       ? 'bg-amber-950 text-amber-300' :
                        status === 'classifying' ? 'bg-indigo-950 text-indigo-200' :
                                                   'bg-zinc-900 text-zinc-500'
                      }`}
                    >
                      <span className="w-4 text-center shrink-0">
                        {status === 'done'        ? <span>✓</span> :
                         status === 'failed'      ? <span>✗</span> :
                         status === 'stale'       ? <span>●</span> :
                         status === 'classifying' ? <span className="animate-pulse">●</span> :
                                                     <span>○</span>}
                      </span>
                      <span className="flex-1 truncate font-mono text-xs">{slug}</span>
                      <span className="text-xs shrink-0">
                        {status === 'done'        ? (result?.classification ?? '') :
                         status === 'failed'      ? failureReasonLabel(result?.classificationFailureReason) :
                         status === 'stale'       ? 'stalled' :
                         status === 'classifying' ? 'classifying…' : 'queued'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Footer row: last-update timestamp + stall warning */}
              <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-950">
                <p className="text-xs text-zinc-500">
                  Last update:{' '}
                  {(() => {
                    const diffS = Math.floor((nowMs - new Date(currentJob.updatedAt).getTime()) / 1_000);
                    return diffS < 60 ? `${diffS}s ago` : `${Math.floor(diffS / 60)}m ago`;
                  })()}
                </p>
              </div>
            </div>
          )}

          {currentJob.status === 'classifying' && nowMs - lastProgressAt > 120_000 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="shrink-0">⚠</span>
              <span>
                No progress for over 2 min — one or more classification calls may be stalled.
                The job will recover automatically; any calls that don&apos;t complete fall back
                to a rule-based merge for reviewer triage.
              </span>
            </div>
          )}

          {showPollWarning && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              Connection issue — retrying. Status may be stale.
            </div>
          )}
        </>
      )}
    </div>
  );
}
