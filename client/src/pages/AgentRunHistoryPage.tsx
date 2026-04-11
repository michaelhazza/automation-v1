/**
 * AgentRunHistoryPage.tsx — Brain Tree OS adoption P3.
 *
 * Standalone page wrapping SessionLogCardList with pagination and filters.
 * Two routes (org-scope and subaccount-scope) feed into the same component.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P3
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import SessionLogCardList, { type SessionLogRun } from '../components/SessionLogCardList';

interface Agent {
  id: string;
  name: string;
}

const PAGE_SIZE = 50;

export default function AgentRunHistoryPage({ user: _user }: { user: User }) {
  const params = useParams<{ agentId: string; subaccountId?: string }>();
  const navigate = useNavigate();
  const agentId = params.agentId!;
  const subaccountId = params.subaccountId ?? null;

  const [runs, setRuns] = useState<SessionLogRun[]>([]);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = subaccountId
        ? `/api/subaccounts/${subaccountId}/agents/${agentId}/runs`
        : `/api/org/agents/${agentId}/runs`;
      const queryParams: Record<string, string> = {
        limit: String(PAGE_SIZE + 1),
        offset: String(page * PAGE_SIZE),
      };
      if (statusFilter) queryParams.status = statusFilter;
      const res = await api.get(url, { params: queryParams });
      const fetched: SessionLogRun[] = res.data;
      setHasMore(fetched.length > PAGE_SIZE);
      setRuns(fetched.slice(0, PAGE_SIZE));
    } catch (err) {
      console.error('[AgentRunHistoryPage] failed to load', err);
    } finally {
      setLoading(false);
    }
  }, [agentId, subaccountId, page, statusFilter]);

  useEffect(() => {
    api.get(`/api/agents/${agentId}`).then(({ data }) => setAgent(data)).catch(() => setAgent(null));
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelectRun = (runId: string) => {
    if (subaccountId) {
      navigate(`/admin/subaccounts/${subaccountId}/runs/${runId}`);
    } else {
      // Org-scope runs do not have a subaccountId in the URL — open the run
      // detail via the standalone agent-run viewer route. The viewer page
      // already supports this via its own data fetch.
      navigate(`/admin/subaccounts/_/runs/${runId}`);
    }
  };

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-[840px] mx-auto">
      <div className="mb-4 text-[13px] text-slate-500 flex items-center gap-1.5">
        <Link to="/agents" className="text-indigo-600 hover:text-indigo-700 no-underline font-medium">Agents</Link>
        <span>/</span>
        {agent && (
          <>
            <Link to={`/agents/${agentId}`} className="text-indigo-600 hover:text-indigo-700 no-underline font-medium">
              {agent.name}
            </Link>
            <span>/</span>
          </>
        )}
        <span>Run history</span>
      </div>

      <div className="mb-5">
        <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">
          {agent ? `${agent.name} — Run History` : 'Run History'}
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-1">Most recent runs first. Click a card to open the trace viewer.</p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <label className="text-[12.5px] text-slate-500 font-medium">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 bg-white"
        >
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="timeout">Timeout</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
          ))}
        </div>
      ) : (
        <SessionLogCardList
          runs={runs}
          startNumber={runs.length + page * PAGE_SIZE}
          onSelectRun={handleSelectRun}
          emptyMessage="No runs match these filters."
        />
      )}

      <div className="flex items-center justify-between mt-4">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="text-[13px] font-semibold px-4 py-2 rounded-md border border-slate-200 bg-white text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed hover:bg-slate-50 disabled:hover:bg-white"
        >
          ← Previous
        </button>
        <span className="text-[12.5px] text-slate-400">Page {page + 1}</span>
        <button
          type="button"
          disabled={!hasMore}
          onClick={() => setPage((p) => p + 1)}
          className="text-[13px] font-semibold px-4 py-2 rounded-md border border-slate-200 bg-white text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed hover:bg-slate-50 disabled:hover:bg-white"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
