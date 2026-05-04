import { useEffect, useState, useCallback } from 'react';
import api from '../../lib/api';
import type { DiffHunk } from '../../../../server/services/fileDiffServicePure';

interface DiffRendererProps {
  taskId: string;
  fileId: string;
  fromVersion: number;
  producerAgentId?: string;
  updatedAt?: string;
  onReverted: () => void;
}

interface DiffData {
  hunks: DiffHunk[];
  from: string;
  to: string;
}

export function DiffRenderer({ taskId, fileId, fromVersion, producerAgentId, updatedAt, onReverted }: DiffRendererProps) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revertingHunk, setRevertingHunk] = useState<number | null>(null);

  const fetchDiff = useCallback(() => {
    setLoading(true);
    setError(false);
    api.get<DiffData>(`/api/tasks/${taskId}/files/${fileId}/diff?from_version=${fromVersion}`)
      .then(({ data: d }) => setData(d))
      .catch((err) => {
        console.error('[DiffRenderer] Failed to fetch diff', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [taskId, fileId, fromVersion]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  const handleRevert = async (hunkIndex: number) => {
    setRevertingHunk(hunkIndex);
    try {
      const res = await api.post<{ reverted: boolean; reason?: string; new_version?: number }>(
        `/api/tasks/${taskId}/files/${fileId}/revert-hunk`,
        { from_version: fromVersion, hunk_index: hunkIndex },
      );
      if (res.data.reverted) {
        onReverted();
      }
    } catch (err) {
      console.error('[DiffRenderer] Revert hunk failed', err);
    } finally {
      setRevertingHunk(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-[12px] text-slate-400">Loading diff...</div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 text-[12px] text-red-500">Diff unavailable</div>
    );
  }

  const caption = [
    producerAgentId ? `Edits requested by ${producerAgentId}` : 'Edits',
    updatedAt ? `at ${new Date(updatedAt).toLocaleString()}` : '',
    `Applied as v${fromVersion + 1}.`,
  ].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[11px] text-slate-500">{caption}</p>
      {data.hunks.length === 0 && (
        <p className="text-[12px] text-slate-400">No changes in this diff.</p>
      )}
      {data.hunks.map((hunk) => (
        <div key={hunk.hunkIndex} className="border border-slate-200 rounded overflow-hidden text-[12px] font-mono">
          <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 border-b border-slate-200">
            <span className="text-slate-500 text-[11px]">Hunk {hunk.hunkIndex + 1}</span>
            <button
              onClick={() => handleRevert(hunk.hunkIndex)}
              disabled={revertingHunk === hunk.hunkIndex}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center gap-1"
              title="Revert this hunk"
            >
              {revertingHunk === hunk.hunkIndex ? 'Reverting...' : 'Revert'}
            </button>
          </div>
          <div className="overflow-x-auto">
            {hunk.fromLines.map((line, i) => (
              <div
                key={`from-${i}`}
                className="px-3 py-0.5 bg-red-50 text-red-700 line-through whitespace-pre"
              >
                - {line}
              </div>
            ))}
            {hunk.toLines.map((line, i) => (
              <div
                key={`to-${i}`}
                className="px-3 py-0.5 bg-indigo-50 text-indigo-800 whitespace-pre"
              >
                + {line}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
