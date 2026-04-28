import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

interface QueueSummary {
  queue: string;
  tier: string;
  active: number;
  pending: number;
  completed: number;
  failed: number;
  dlqDepth: number;
  avgDurationMs: number | null;
  retryRate: number;
  oldestPendingAge: number | null;
}

interface DlqJob {
  id: string;
  queue: string;
  createdAt: string;
  completedAt: string;
  data: Record<string, unknown>;
}

const TIER_ORDER = ['agent_execution', 'financial', 'maintenance', 'memory'];
const TIER_LABELS: Record<string, string> = {
  agent_execution: 'Agent Execution',
  financial: 'Financial / Billing',
  maintenance: 'Maintenance',
  memory: 'Memory Enrichment',
};

function getHealthColor(summary: QueueSummary): string {
  if (summary.pending > 10 || summary.failed > 20) return 'border-red-300 bg-red-50';
  if (summary.dlqDepth > 0 || summary.retryRate > 15) return 'border-amber-300 bg-amber-50';
  return 'border-green-200 bg-green-50';
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatAge(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

export default function JobQueueDashboardPage() {
  const [summaries, setSummaries] = useState<QueueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [dlqJobs, setDlqJobs] = useState<DlqJob[]>([]);
  const [dlqLoading, setDlqLoading] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const fetchSummaries = useCallback(async () => {
    try {
      const res = await api.get('/api/system/job-queues');
      setSummaries(res.data.data);
    } catch (err) {
      console.error('Failed to fetch queue summaries:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummaries();
    let interval = setInterval(fetchSummaries, 30000);

    // Pause polling when tab is not visible
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        fetchSummaries();
        interval = setInterval(fetchSummaries, 30000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchSummaries]);

  const fetchDlq = async (queue: string) => {
    setSelectedQueue(queue);
    setDlqLoading(true);
    try {
      const res = await api.get(`/api/system/job-queues/${queue}/dlq`);
      setDlqJobs(res.data);
    } catch {
      setDlqJobs([]);
    } finally {
      setDlqLoading(false);
    }
  };

  const groupedByTier = TIER_ORDER.map(tier => ({
    tier,
    label: TIER_LABELS[tier] ?? tier,
    queues: summaries.filter(s => s.tier === tier),
  })).filter(g => g.queues.length > 0);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-6">Job Queue Health</h1>
        <div className="animate-pulse grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-slate-100 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Job Queue Health</h1>
        <button
          onClick={fetchSummaries}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Queue cards grouped by tier */}
      {groupedByTier.map(group => (
        <div key={group.tier} className="mb-8">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            {group.label}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.queues.map(summary => (
              <button
                key={summary.queue}
                onClick={() => summary.dlqDepth > 0 ? fetchDlq(summary.queue) : null}
                className={`border rounded-lg p-4 text-left transition-shadow hover:shadow-sm ${getHealthColor(summary)} ${
                  selectedQueue === summary.queue ? 'ring-2 ring-indigo-300' : ''
                }`}
              >
                <div className="font-medium text-sm text-slate-800 truncate mb-2">{summary.queue}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="text-slate-500">Pending</div>
                  <div className="font-medium">{summary.pending}</div>
                  <div className="text-slate-500">Active</div>
                  <div className="font-medium">{summary.active}</div>
                  <div className="text-slate-500">Failed (24h)</div>
                  <div className={`font-medium ${summary.failed > 0 ? 'text-red-600' : ''}`}>{summary.failed}</div>
                  <div className="text-slate-500">DLQ</div>
                  <div className={`font-medium ${summary.dlqDepth > 0 ? 'text-amber-600' : ''}`}>
                    {summary.dlqDepth}{summary.dlqDepth > 0 ? ' ⚠' : ''}
                  </div>
                  <div className="text-slate-500">Avg duration</div>
                  <div className="font-medium">{formatMs(summary.avgDurationMs)}</div>
                  <div className="text-slate-500">Retry rate</div>
                  <div className={`font-medium ${summary.retryRate > 15 ? 'text-amber-600' : ''}`}>{summary.retryRate}%</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* DLQ Inspector */}
      {selectedQueue && (
        <div className="mt-6 border rounded-lg bg-white">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">DLQ: {selectedQueue} ({dlqJobs.length} jobs)</h3>
            <button onClick={() => setSelectedQueue(null)} className="text-slate-400 hover:text-slate-600 text-sm">
              Close
            </button>
          </div>

          {dlqLoading ? (
            <div className="p-4 text-sm text-slate-400">Loading DLQ jobs...</div>
          ) : dlqJobs.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">No DLQ jobs for this queue.</div>
          ) : (
            <div className="divide-y">
              {dlqJobs.map(job => (
                <div key={job.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-mono text-xs text-slate-500">{job.id.slice(0, 8)}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="text-slate-500">
                        {job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      {expandedJob === job.id ? 'Hide' : 'View'} Payload
                    </button>
                  </div>
                  {expandedJob === job.id && (
                    <pre className="mt-2 p-3 bg-slate-50 rounded text-xs overflow-x-auto max-h-48 text-slate-700">
                      {JSON.stringify(job.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
