import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import SkillAnalyzerWizard from '../components/skill-analyzer/SkillAnalyzerWizard';

interface JobSummary {
  id: string;
  sourceType: 'paste' | 'upload' | 'github' | 'download';
  status: string;
  progressPct: number;
  candidateCount: number | null;
  exactDuplicateCount: number | null;
  comparisonCount: number | null;
  createdAt: string;
  completedAt: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    pending: 'bg-slate-100 text-slate-600',
    parsing: 'bg-blue-50 text-blue-700',
    hashing: 'bg-blue-50 text-blue-700',
    embedding: 'bg-blue-50 text-blue-700',
    comparing: 'bg-blue-50 text-blue-700',
    classifying: 'bg-indigo-50 text-indigo-700',
    completed: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${colours[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

export default function SkillAnalyzerPage({ user: _user }: { user: User }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showWizard, setShowWizard] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const jobIdParam = searchParams.get('jobId');

  useEffect(() => {
    // If there's a jobId in the URL, show the wizard for that job
    if (jobIdParam) {
      setShowWizard(true);
    }
  }, [jobIdParam]);

  useEffect(() => {
    if (!showWizard) {
      loadJobs();
    }
  }, [showWizard]);

  async function loadJobs() {
    setLoading(true);
    try {
      const res = await api.get('/api/system/skill-analyser/jobs?limit=20');
      setJobs(res.data.jobs || []);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  function handleNewAnalysis() {
    setSearchParams({});
    setShowWizard(true);
  }

  function handleWizardClose() {
    setSearchParams({});
    setShowWizard(false);
  }

  function handleJobSelected(jobId: string) {
    setSearchParams({ jobId });
    setShowWizard(true);
  }

  if (showWizard) {
    return (
      <SkillAnalyzerWizard
        initialJobId={jobIdParam ?? undefined}
        onClose={handleWizardClose}
        onJobCreated={(jobId) => setSearchParams({ jobId })}
      />
    );
  }

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Skill Analyser</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Import skills from external sources and compare them against your library.
          </p>
        </div>
        <button
          onClick={handleNewAnalysis}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          New Analysis
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl">
          <p className="text-slate-500 text-sm">No analyses yet.</p>
          <button
            onClick={handleNewAnalysis}
            className="mt-3 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Start by importing skills
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => handleJobSelected(job.id)}
              className="w-full text-left flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-800 capitalize">{job.sourceType} import</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {job.candidateCount != null ? `${job.candidateCount} skills` : 'Processing…'}
                    {job.comparisonCount != null && ` · ${job.comparisonCount} compared`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={job.status} />
                <span className="text-xs text-slate-400">
                  {new Date(job.createdAt).toLocaleDateString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
