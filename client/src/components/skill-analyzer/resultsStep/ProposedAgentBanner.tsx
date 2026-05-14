import { useState } from 'react';
import api from '../../../lib/api';
import type { AnalysisJob, AnalysisResult } from '../types';

export default function ProposedAgentBanner({
  jobId,
  job,
  onJobRefetched,
}: {
  jobId: string;
  job: AnalysisJob;
  onJobRefetched: (results: AnalysisResult[]) => void;
}) {
  // Derive the list of proposed agents — prefer the plural array (v2 Fix 5);
  // fall back to synthesising a single entry from the legacy scalar
  // agentRecommendation for pre-v2 jobs.
  const initialAgents: Array<{
    proposedAgentIndex: number;
    slug: string;
    name: string;
    description: string;
    reasoning: string;
    skillSlugs: string[];
    status: 'proposed' | 'confirmed' | 'rejected';
  }> = job.proposedNewAgents && job.proposedNewAgents.length > 0
    ? job.proposedNewAgents.map((p) => ({
        proposedAgentIndex: p.proposedAgentIndex,
        slug: p.slug,
        name: p.name,
        description: p.description,
        reasoning: p.reasoning,
        skillSlugs: p.skillSlugs,
        status: p.status,
      }))
    : job.agentRecommendation
    ? [{
        proposedAgentIndex: 0,
        slug: job.agentRecommendation.agentSlug ?? 'proposed-agent',
        name: job.agentRecommendation.agentName ?? 'Proposed Agent',
        description: job.agentRecommendation.agentDescription ?? job.agentRecommendation.reasoning,
        reasoning: job.agentRecommendation.reasoning,
        skillSlugs: job.agentRecommendation.skillSlugs ?? [],
        status: 'proposed',
      }]
    : [];

  const [agents, setAgents] = useState(initialAgents);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(proposedAgentIndex: number, action: 'confirm' | 'reject') {
    setPendingIndex(proposedAgentIndex);
    setError(null);
    try {
      await api.patch(`/api/system/skill-analyser/jobs/${jobId}/proposed-agents`, {
        proposedAgentIndex,
        action,
      });
      // Refetch the whole job so retro-injected agentProposals on
      // DISTINCT results reflect the confirmation/rejection.
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      onJobRefetched(data.results);
      setAgents((prev) =>
        prev.map((p) =>
          p.proposedAgentIndex === proposedAgentIndex
            ? { ...p, status: action === 'confirm' ? 'confirmed' : 'rejected' }
            : p,
        ),
      );
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to update proposed agent.');
    } finally {
      setPendingIndex(null);
    }
  }

  if (agents.length === 0) return null;

  return (
    <div className="space-y-2">
      {agents.map((agent) => (
        <div
          key={agent.proposedAgentIndex}
          className={`p-4 rounded-xl border ${
            agent.status === 'confirmed'
              ? 'bg-emerald-50 border-emerald-200'
              : agent.status === 'rejected'
              ? 'bg-slate-50 border-slate-200'
              : 'bg-indigo-50 border-indigo-200'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 mb-0.5">
                {agent.status === 'confirmed' && '✓ '}
                {agent.status === 'rejected' && '✗ '}
                New agent suggested: {agent.name}
                {agent.status === 'confirmed' && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900">Confirmed</span>}
                {agent.status === 'rejected' && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">Rejected</span>}
              </p>
              {agent.description && (
                <p className="text-xs text-slate-700 mb-2">{agent.description}</p>
              )}
              <p className="text-xs text-slate-600 italic">{agent.reasoning}</p>
              {agent.skillSlugs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {agent.skillSlugs.map((slug) => (
                    <span key={slug} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                      {slug}
                    </span>
                  ))}
                </div>
              )}
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
            {agent.status === 'proposed' && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={pendingIndex === agent.proposedAgentIndex}
                  onClick={() => handle(agent.proposedAgentIndex, 'confirm')}
                  className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={pendingIndex === agent.proposedAgentIndex}
                  onClick={() => handle(agent.proposedAgentIndex, 'reject')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:border-red-300 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
          {agent.status === 'confirmed' && (
            <p className="mt-2 text-[11px] text-emerald-800">
              This agent will be created with status=&quot;draft&quot; during Execute. Skills in the list above will attach to it; the draft is promoted to active when at least one skill attaches successfully.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
