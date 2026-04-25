import { useState, useEffect } from 'react';
import api from '../../lib/api';
import SkillAnalyzerImportStep from './SkillAnalyzerImportStep';
import SkillAnalyzerProcessingStep from './SkillAnalyzerProcessingStep';
import SkillAnalyzerResultsStep from './SkillAnalyzerResultsStep';
import SkillAnalyzerExecuteStep from './SkillAnalyzerExecuteStep';
import type { RestoreOutcome } from './RestoreBackupControl';
import type {
  AnalysisJob,
  AnalysisResult,
  BackupMetadata,
  MatchedSkillContent,
  AgentProposal,
  ProposedMergedContent,
  AvailableSystemAgent,
  ParsedCandidate,
} from './types';
export type {
  AnalysisJob,
  AnalysisResult,
  BackupMetadata,
  MatchedSkillContent,
  AgentProposal,
  ProposedMergedContent,
  AvailableSystemAgent,
  ParsedCandidate,
} from './types';

type WizardStep = 'import' | 'processing' | 'results' | 'execute';

interface Props {
  initialJobId?: string;
  onClose: () => void;
  onJobCreated: (jobId: string) => void;
}

function resolveStep(job: AnalysisJob | null): WizardStep {
  if (!job) return 'import';
  if (job.status === 'completed') return 'results';
  if (job.status === 'failed') return 'processing'; // show error state
  return 'processing';
}

export default function SkillAnalyzerWizard({ initialJobId, onClose, onJobCreated }: Props) {
  const [step, setStep] = useState<WizardStep>(initialJobId ? 'processing' : 'import');
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [executeResult, setExecuteResult] = useState<{
    created: number;
    updated: number;
    failed: number;
    errors: Array<{ resultId: string; error: string }>;
    backupId: string | null;
  } | null>(null);
  const [backup, setBackup] = useState<BackupMetadata | null>(null);
  /** Sticky outcome of the most recent restore attempt. Lives here — not in
   *  RestoreBackupControl — so the success / "already restored" banner
   *  survives the parent's `backup.status` transition from 'active' to
   *  'restored', which unmounts the control itself. Scoped to the job so
   *  navigating away / starting new clears it implicitly. */
  const [lastRestoreOutcome, setLastRestoreOutcome] = useState<
    { jobId: string; outcome: RestoreOutcome } | null
  >(null);

  // Load existing job if jobId provided
  useEffect(() => {
    if (initialJobId) {
      loadJob(initialJobId);
    }
  }, [initialJobId]);

  async function loadJob(jobId: string) {
    try {
      const res = await api.get(`/api/system/skill-analyser/jobs/${jobId}`);
      const { job: j, results: r } = res.data;
      setJob(j);
      setResults(r);
      const resolved = resolveStep(j);
      setStep(resolved);
      await fetchBackup(jobId);
    } catch {
      // job not found or error — stay at import
    }
  }

  async function fetchBackup(jobId: string) {
    try {
      const res = await api.get<{ backup: BackupMetadata | null }>(
        `/api/system/skill-analyser/jobs/${jobId}/backup`,
      );
      setBackup(res.data.backup);
    } catch {
      setBackup(null);
    }
  }

  function handleRestoreOutcome(outcome: RestoreOutcome) {
    if (!job) return;
    setLastRestoreOutcome({ jobId: job.id, outcome });
    // Refetch so the control itself unmounts once the backup flips to
    // 'restored'. The banner persists because it reads from
    // lastRestoreOutcome, not from the control's local state.
    fetchBackup(job.id);
  }

  function dismissRestoreOutcome() {
    setLastRestoreOutcome(null);
  }

  function handleJobCreated(jobId: string, newJob: AnalysisJob) {
    setJob(newJob);
    setStep('processing');
    onJobCreated(jobId);
  }

  function handleJobComplete(updatedJob: AnalysisJob, updatedResults: AnalysisResult[]) {
    setJob(updatedJob);
    setResults(updatedResults);
    setStep('results');
  }

  function handleResultsReady() {
    setStep('execute');
  }

  function handleExecuted(result: typeof executeResult) {
    setExecuteResult(result);
    if (job) fetchBackup(job.id);
  }

  const STEPS: WizardStep[] = ['import', 'processing', 'results', 'execute'];
  const stepLabels: Record<WizardStep, string> = {
    import: 'Import',
    processing: 'Processing',
    results: 'Review',
    execute: 'Execute',
  };

  return (
    <div className="px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Skill Analyzer</h1>
          <p className="text-sm text-slate-500 mt-0.5">Compare incoming skills against your library</p>
        </div>
        <button
          onClick={onClose}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          ← Back to analyses
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const currentIdx = STEPS.indexOf(step);
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div key={s} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isCurrent
                    ? 'bg-indigo-50 text-indigo-700'
                    : isDone
                    ? 'text-slate-400'
                    : 'text-slate-400'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isDone
                      ? 'bg-indigo-600 text-white'
                      : isCurrent
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {isDone ? '✓' : i + 1}
                </span>
                {stepLabels[s]}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px w-6 ${i < currentIdx ? 'bg-indigo-300' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {step === 'import' && (
        <SkillAnalyzerImportStep onJobCreated={handleJobCreated} />
      )}
      {step === 'processing' && job && (
        <SkillAnalyzerProcessingStep
          jobId={job.id}
          initialJob={job}
          onComplete={handleJobComplete}
          onStartNew={() => { setJob(null); setBackup(null); setLastRestoreOutcome(null); setStep('import'); }}
        />
      )}
      {step === 'results' && job && (
        <SkillAnalyzerResultsStep
          job={job}
          results={results}
          onResultsUpdated={setResults}
          onContinue={handleResultsReady}
          backup={backup}
          onRestoreOutcome={handleRestoreOutcome}
          restoreOutcome={lastRestoreOutcome?.jobId === job.id ? lastRestoreOutcome.outcome : null}
          onDismissRestoreOutcome={dismissRestoreOutcome}
        />
      )}
      {step === 'execute' && job && (
        <SkillAnalyzerExecuteStep
          job={job}
          results={results}
          onExecuted={handleExecuted}
          executeResult={executeResult}
          onStartNew={() => { setJob(null); setResults([]); setExecuteResult(null); setBackup(null); setLastRestoreOutcome(null); setStep('import'); }}
          backup={backup}
          onRestoreOutcome={handleRestoreOutcome}
          restoreOutcome={lastRestoreOutcome?.jobId === job.id ? lastRestoreOutcome.outcome : null}
          onDismissRestoreOutcome={dismissRestoreOutcome}
        />
      )}
    </div>
  );
}
