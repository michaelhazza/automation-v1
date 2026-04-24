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
    // 210s threshold: per-call classify budget is 180s (SKILL_CLASSIFY_TIMEOUT_MS)
    // with a one-shot retry, so a skill can legitimately be in flight up to
    // ~180s before we should expect a result. 210s (3.5 min) gives a comfortable
    // 30s margin above the per-call budget before flagging as stale.
    return nowMs - startedAt > 210_000 ? 'stale' : 'classifying';
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

// Threshold for treating an in-flight job as "stuck". The worker publishes
// progress every time it advances a candidate through Stage 5 (classify) or
// enters a new stage, so 5 min of true silence means the worker has died
// (SIGKILL / OOM / pg-boss expireIn fired) or has been wedged on a call that
// somehow bypassed its own per-call timeout. At that point we surface the
// Resume button — the backend will refuse if pg-boss still has a live entry.
const STALLED_THRESHOLD_MS = 5 * 60_000;

export default function SkillAnalyzerProcessingStep({ jobId, initialJob, onComplete, onStartNew }: Props) {
  const [currentJob, setCurrentJob] = useState<AnalysisJob>(initialJob);
  const [pollErrorCount, setPollErrorCount] = useState(0);
  const [liveResults, setLiveResults] = useState<AnalysisResult[]>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  // Seed from initialJob.updatedAt so the stalled-detection threshold is
  // measured against the server's last real progress tick — not against
  // page-mount. A job that's been silent for 60 min before the user opens
  // the tab must flip to "stalled" immediately, not 5 min later.
  const [lastProgressAt, setLastProgressAt] = useState<number>(
    () => new Date(initialJob.updatedAt).getTime(),
  );
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // Bumped on successful Resume to re-arm the polling loop below (which
  // halts itself on terminal 'failed' state).
  const [pollVersion, setPollVersion] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Terminal state at mount — no polling needed.
    // (On pollVersion > 0 this effect was re-run by Resume, so don't early-out
    // based on initialJob anymore — use currentJob.)
    const snapshot = pollVersion === 0 ? initialJob : currentJob;
    if (snapshot.status === 'completed' || snapshot.status === 'failed') return;

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
  }, [jobId, pollVersion]);

  const isFailed = currentJob.status === 'failed';
  const pct = currentJob.progressPct ?? 0;
  const showPollWarning = !isFailed && currentJob.status !== 'completed' && pollErrorCount >= 2;
  // Stalled = worker likely died silently mid-pipeline. Job row still says
  // 'classifying'/'embedding'/etc., but no progress message in 5+ min.
  const isStalled =
    !isFailed
    && currentJob.status !== 'completed'
    && currentJob.status !== 'pending'
    && nowMs - lastProgressAt > STALLED_THRESHOLD_MS;
  const canResume = isFailed || isStalled;

  async function handleResume() {
    setResuming(true);
    setResumeError(null);
    try {
      await api.post(`/api/system/skill-analyser/jobs/${jobId}/resume`);
      // Optimistically reset local state so the UI flips out of the
      // failed/stalled view immediately; the next poll tick replaces this
      // with the authoritative row written by the handler.
      setCurrentJob((j) => ({
        ...j,
        status: 'pending',
        errorMessage: null,
        progressMessage: 'Resuming analysis...',
      }));
      setLastProgressAt(Date.now());
      setPollErrorCount(0);
      // Re-arm the main polling effect (it halted itself on terminal state).
      setPollVersion((v) => v + 1);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to resume analysis.';
      setResumeError(msg);
    } finally {
      setResuming(false);
    }
  }

  const classifyQueue = currentJob.classifyState?.queue ?? [];
  const inFlight = currentJob.classifyState?.inFlight ?? {};

  // Unified slug list for the per-skill rows. The queue alone isn't enough:
  // after a resume, every skill is already classified, so classifyQueue is
  // empty — but liveResults still holds all 19 persisted rows. Showing the
  // queue OR the persisted results keeps the list populated through every
  // stage (mid-classify, post-resume, Stage 6/7/7b agent enrichment).
  //
  // Ordering: queue items first (preserves "classifying now at top" during a
  // live run), then any persisted result not in the queue, sorted by
  // candidateIndex for a stable listing.
  const displaySlugs = (() => {
    const queued = new Set(classifyQueue);
    const doneOnly = liveResults
      .filter((r) => !queued.has(r.candidateSlug))
      .sort((a, b) => a.candidateIndex - b.candidateIndex)
      .map((r) => r.candidateSlug);
    return [...classifyQueue, ...doneOnly];
  })();
  const showSkillList =
    !isFailed
    && currentJob.status !== 'completed'
    && displaySlugs.length > 0;

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
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleResume}
              disabled={resuming}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {resuming ? 'Resuming…' : 'Resume analysis'}
            </button>
            <button
              onClick={onStartNew}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Start New
            </button>
          </div>
        )}
      </div>

      {isFailed && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 space-y-2">
          <p>{currentJob.errorMessage || 'An unexpected error occurred during processing.'}</p>
          <p className="text-xs text-red-600">
            Resuming picks up from the last persisted step — classifications already completed are not re-run, so no extra AI cost.
          </p>
          {resumeError && (
            <p className="text-xs font-medium text-red-800">{resumeError}</p>
          )}
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

            {!showSkillList && (
              <div className="flex justify-center mt-4">
                <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Progress warnings — kept directly under the progress bar so they
              stay above the fold regardless of how many skills are in the queue. */}
          {isStalled && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="shrink-0">⚠</span>
              <div className="flex-1 space-y-2">
                <p>
                  No progress for over 5 minutes. The worker may have crashed or been timed out.
                  Classifications already completed are safe on the server — resuming picks up
                  from where it stopped without re-running any AI calls.
                </p>
                {resumeError && (
                  <p className="text-xs font-medium text-amber-900">{resumeError}</p>
                )}
                <button
                  onClick={handleResume}
                  disabled={resuming}
                  className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {resuming ? 'Resuming…' : 'Resume analysis'}
                </button>
              </div>
            </div>
          )}

          {currentJob.status === 'classifying' && nowMs - lastProgressAt > 210_000 && !isStalled && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="shrink-0">⚠</span>
              <span>
                No progress for over 3 min — one or more classification calls may be stalled.
                The job will recover automatically; any calls that don&apos;t complete fall back
                to a rule-based merge for reviewer triage.
              </span>
            </div>
          )}

          {/* Per-skill classification rows */}
          {showSkillList && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="space-y-px">
                {displaySlugs.map((slug) => {
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
