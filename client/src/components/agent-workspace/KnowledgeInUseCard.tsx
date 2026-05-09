import { useState } from 'react';
import api from '../../lib/api';
import { relativeTime } from '../../lib/relativeTime';

export interface KnowledgeInUseEntry {
  id: string;
  title: string;
  sourceKind: string;
  retrievedAt: string;
  runId: string;
}

interface Props {
  entries: KnowledgeInUseEntry[];
  agentId: string;
}


export default function KnowledgeInUseCard({ entries, agentId }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [provenanceData, setProvenanceData] = useState<Record<string, unknown | null>>({});
  const [provenanceLoading, setProvenanceLoading] = useState<Record<string, boolean>>({});

  async function handleToggle(entryId: string) {
    if (expandedId === entryId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entryId);
    if (provenanceData[entryId] !== undefined) return;
    setProvenanceLoading(prev => ({ ...prev, [entryId]: true }));
    try {
      const res = await api.get<unknown>(
        `/api/agents/${agentId}/knowledge-in-use/${entryId}/provenance`
      );
      setProvenanceData(prev => ({ ...prev, [entryId]: res.data }));
    } catch {
      setProvenanceData(prev => ({ ...prev, [entryId]: null }));
    } finally {
      setProvenanceLoading(prev => ({ ...prev, [entryId]: false }));
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-100 p-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-3">Knowledge in Use</h4>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-4">
          No retrieval-summary events yet — these appear after the agent's next run.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map(entry => (
            <li key={entry.id}>
              <button
                className="w-full flex items-center gap-2 text-left"
                onClick={() => handleToggle(entry.id)}
              >
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 shrink-0">
                  {entry.sourceKind}
                </span>
                <span className="text-xs text-slate-700 flex-1 truncate">{entry.title}</span>
                <span className="text-xs text-slate-400 shrink-0">{relativeTime(entry.retrievedAt)}</span>
              </button>
              {expandedId === entry.id && (
                <div className="mt-1 ml-2 rounded bg-slate-50 border border-slate-100 p-2">
                  <p className="text-xs font-medium text-slate-500 mb-1">Provenance</p>
                  {provenanceLoading[entry.id] ? (
                    <p className="text-xs text-slate-400">loading...</p>
                  ) : provenanceData[entry.id] === null ? (
                    <p className="text-xs text-red-500">Failed to load provenance.</p>
                  ) : (
                    <pre className="text-xs text-slate-600 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(provenanceData[entry.id], null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
