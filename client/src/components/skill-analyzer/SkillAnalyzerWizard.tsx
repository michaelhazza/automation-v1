import { useState, useEffect } from 'react';
import api from '../../lib/api';
import SkillAnalyzerImportStep from './SkillAnalyzerImportStep';
import SkillAnalyzerProcessingStep from './SkillAnalyzerProcessingStep';
import SkillAnalyzerResultsStep from './SkillAnalyzerResultsStep';
import SkillAnalyzerExecuteStep from './SkillAnalyzerExecuteStep';

/** Pre-computed live snapshot of a system_skills row for the matched library
 *  skill on a partial-overlap result. Provided by the GET /jobs/:id endpoint
 *  via a live lookup so the Review UI can render the Current column of the
 *  three-column merge view (Phase 5) without an extra round-trip. */
export interface MatchedSkillContent {
  id: string;
  slug: string;
  name: string;
  description: string;
  // Anthropic tool definition shape — JSON object, never a string.
  definition: Record<string, unknown>;
  instructions: string | null;
}

/** One agent proposal entry for a DISTINCT result. Populated by the Phase 2
 *  agent-propose pipeline stage. systemAgentId is the stable identity key —
 *  slug and name are display-only snapshots captured at analysis time. */
export interface AgentProposal {
  systemAgentId: string;
  slugSnapshot: string;
  nameSnapshot: string;
  score: number;
  selected: boolean;
}

/** LLM-generated merge proposal for PARTIAL_OVERLAP / IMPROVEMENT results.
 *  Populated by the Phase 3 classify-stage extension. Editable via PATCH. */
export interface ProposedMergedContent {
  name: string;
  description: string;
  definition: Record<string, unknown>;
  instructions: string | null;
}

/** A system agent surfaced for the "Add another system agent..." combobox. */
export interface AvailableSystemAgent {
  systemAgentId: string;
  slug: string;
  name: string;
}

/** Parsed candidate skill content stashed on the job row. The client uses
 *  this to render the "Incoming" column of the Phase 5 three-column merge
 *  view — the row's candidateIndex points into this array. */
export interface ParsedCandidate {
  name: string;
  slug: string;
  description: string;
  definition: object | null;
  instructions: string | null;
  rawSource?: string;
}

export interface AnalysisJob {
  id: string;
  status: string;
  progressPct: number;
  progressMessage: string | null;
  errorMessage: string | null;
  candidateCount: number | null;
  exactDuplicateCount: number | null;
  comparisonCount: number | null;
  sourceType: string;
  createdAt: string;
  completedAt: string | null;
  /** Parsed candidates as stored on the job row (JSONB). The client uses
   *  these for the Phase 5 three-column merge view's "Incoming" column —
   *  result.candidateIndex indexes into this array. */
  parsedCandidates?: ParsedCandidate[] | null;
  /** Phase 1 of skill-analyzer-v2: live snapshot of the system_agents
   *  inventory, populated for the Phase 4 "Add another system agent..."
   *  combobox. Empty when there are no system agents. */
  availableSystemAgents?: AvailableSystemAgent[];
}

export interface AnalysisResult {
  id: string;
  candidateIndex: number;
  candidateName: string;
  candidateSlug: string;
  matchedSkillId: string | null;
  classification: 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';
  confidence: number;
  similarityScore: number | null;
  classificationReasoning: string | null;
  diffSummary: {
    addedFields: string[];
    removedFields: string[];
    changedFields: string[];
  } | null;
  actionTaken: 'approved' | 'rejected' | 'skipped' | null;
  executionResult: 'created' | 'updated' | 'skipped' | 'failed' | null;
  executionError: string | null;
  /** Phase 1 of skill-analyzer-v2: live system_skills lookup attached when
   *  matchedSkillId is set and the row still exists. Replaces the legacy
   *  matchedSkillName / matchedSystemSkillSlug fields which were dropped
   *  from the schema in migration 0098. */
  matchedSkillContent?: MatchedSkillContent;
  /** Phase 1 of skill-analyzer-v2: SHA-256 of the candidate content. Used
   *  by the Phase 4 manual-add PATCH to look up the candidate embedding in
   *  skill_embeddings without an extra OpenAI call. */
  candidateContentHash?: string;
  /** Phase 2 of skill-analyzer-v2: top-K system agent proposals for DISTINCT
   *  results (always [] for other classifications and when no system agents
   *  exist). */
  agentProposals?: AgentProposal[];
  /** Phase 3 of skill-analyzer-v2: LLM-generated merge proposal for
   *  PARTIAL_OVERLAP / IMPROVEMENT results. Editable via PATCH. */
  proposedMergedContent?: ProposedMergedContent | null;
  /** Phase 3 of skill-analyzer-v2: the LLM's untouched original. The Reset
   *  endpoint copies this back into proposedMergedContent. */
  originalProposedMerge?: ProposedMergedContent | null;
  /** Phase 3 of skill-analyzer-v2: set true when the user edits any field
   *  in proposedMergedContent. Used to gate the "Reset to AI suggestion"
   *  link in the merge view. */
  userEditedMerge?: boolean;
  /** ISO timestamp of the last merge write (patchMergeFields or resetMergeToOriginal).
   *  Null on rows that have never been merge-edited. Echoed back on PATCH requests
   *  as ifUnmodifiedSince for optimistic concurrency. */
  mergeUpdatedAt?: string | null;
  /** Task 3: true when the Anthropic classification call failed (rate limit or
   *  parse error). Distinguishes retryable API failures from genuine
   *  PARTIAL_OVERLAP model output. */
  classificationFailed?: boolean;
  /** Task 3: reason for the failure: 'rate_limit' | 'parse_error' | 'unknown'.
   *  Null on rows where classificationFailed is false or undefined. */
  classificationFailureReason?: 'rate_limit' | 'parse_error' | 'unknown' | null;
}

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
  } | null>(null);

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
    } catch {
      // job not found or error — stay at import
    }
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
          onStartNew={() => { setJob(null); setStep('import'); }}
        />
      )}
      {step === 'results' && job && (
        <SkillAnalyzerResultsStep
          job={job}
          results={results}
          onResultsUpdated={setResults}
          onContinue={handleResultsReady}
        />
      )}
      {step === 'execute' && job && (
        <SkillAnalyzerExecuteStep
          job={job}
          results={results}
          onExecuted={handleExecuted}
          executeResult={executeResult}
          onStartNew={() => { setJob(null); setResults([]); setExecuteResult(null); setStep('import'); }}
        />
      )}
    </div>
  );
}
