import { useState } from 'react';
import type { AgentObservation, ObservationType } from '../../../../shared/types/agentObservations';
import api from '../../lib/api';

const TYPE_BADGE_COLORS: Record<ObservationType, string> = {
  learned: 'bg-blue-50 text-blue-700',
  detected: 'bg-orange-50 text-orange-700',
  decided: 'bg-purple-50 text-purple-700',
  flagged: 'bg-red-50 text-red-700',
  produced: 'bg-green-50 text-green-700',
};

interface Props {
  observations: AgentObservation[];
  agentId: string;
}

export default function RecentObservationsCard({ observations, agentId }: Props) {
  const [rows, setRows] = useState<AgentObservation[]>(observations);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showLoadMore, setShowLoadMore] = useState(observations.length >= 3);

  async function handleLoadMore() {
    const lastId = rows[rows.length - 1]?.id;
    if (!lastId) return;
    setIsLoadingMore(true);
    setLoadError(false);
    try {
      const res = await api.get<AgentObservation[]>(
        `/api/agents/${agentId}/observations?limit=2&cursor=${lastId}`
      );
      const next = res.data;
      setRows(prev => [...prev, ...next]);
      setShowLoadMore(next.length === 2);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Recent Observations</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">
          No observations yet — these appear as the agent runs.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(obs => (
            <li key={obs.id} className="flex items-start gap-2">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${TYPE_BADGE_COLORS[obs.observationType]}`}
              >
                {obs.observationType}
              </span>
              <span className="text-xs text-slate-600 leading-4 mt-0.5">
                {obs.body}
                {obs.bodyTruncated && (
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                    Truncated
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showLoadMore && !isLoadingMore && (
        <button
          onClick={handleLoadMore}
          className="mt-3 text-xs text-slate-500 hover:text-slate-700 underline"
        >
          Show 2 more
        </button>
      )}
      {isLoadingMore && (
        <p className="mt-3 text-xs text-slate-400">Loading...</p>
      )}
      {loadError && (
        <p className="mt-3 text-xs text-red-500">Failed to load more observations.</p>
      )}
    </div>
  );
}
