import { useEffect, useState } from 'react';
import api from '../lib/api';

interface SourceRow {
  sourceEntryId: string | null;
  sourceEntryIdHash: string;
  contentHash: string;
  sourceType: string;
  capturedAt: string;
  qualityScoreAtCapture: string | null;
  contributionRank: number;
  sourceRunId: string | null;
  sourceRunLabel: string | null;
  contentExcerpt: string | null;
  isDeleted: boolean;
  usedInOtherBlocksCount?: number;
}

interface MemoryBlockSourcesPayload {
  blockId: string;
  blockSource: string;
  versionNumber: number | null;
  sources: SourceRow[];
  reverseLineageByEntry?: Record<string, number>;
}

interface Props {
  blockId: string;
  orgId: string;
}

export default function MemoryBlockSourcesTab({ blockId, orgId }: Props) {
  const [payload, setPayload] = useState<MemoryBlockSourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedHashes, setExpandedHashes] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<MemoryBlockSourcesPayload>(
        `/api/orgs/${orgId}/memory-blocks/${blockId}/sources`,
      )
      .then(({ data }) => setPayload(data))
      .catch(() => setError('Failed to load sources.'))
      .finally(() => setLoading(false));
  }, [orgId, blockId]);

  async function expandReverseLineage(hash: string) {
    if (!orgId || expandedHashes.has(hash)) return;
    setExpandedHashes((prev) => new Set([...prev, hash]));
    try {
      const { data } = await api.get<MemoryBlockSourcesPayload>(
        `/api/orgs/${orgId}/memory-blocks/${blockId}/sources?include_reverse=true`,
      );
      setPayload(data);
    } catch {
      // non-fatal
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
        {error}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setLoading(true);
            api
              .get<MemoryBlockSourcesPayload>(
                `/api/orgs/${orgId}/memory-blocks/${blockId}/sources`,
              )
              .then(({ data }) => setPayload(data))
              .catch(() => setError('Failed to load sources.'))
              .finally(() => setLoading(false));
          }}
          className="ml-2 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!payload || payload.sources.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic">
        No lineage data available. This block was synthesised before lineage tracking was enabled.
      </div>
    );
  }

  return (
    <div>
      {payload.versionNumber !== null && (
        <p className="text-xs text-slate-400 mb-3">
          Version {payload.versionNumber} · {payload.sources.length} source
          {payload.sources.length !== 1 ? 's' : ''}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {payload.sources.map((s) => (
          <div
            key={s.sourceEntryIdHash}
            className={`border rounded p-3 ${s.isDeleted ? 'opacity-50' : 'border-slate-200'}`}
          >
            {s.contentExcerpt !== null ? (
              <p className={`text-sm text-slate-700 mb-1 ${s.isDeleted ? 'line-through' : ''}`}>
                {s.contentExcerpt}
              </p>
            ) : (
              <p className="text-sm text-slate-400 italic mb-1">(source removed)</p>
            )}

            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              {s.sourceRunLabel && (
                <span>
                  {s.sourceRunId ? (
                    <a
                      href={`/admin/runs/${s.sourceRunId}`}
                      className="text-indigo-600 hover:underline"
                    >
                      {s.sourceRunLabel}
                    </a>
                  ) : (
                    s.sourceRunLabel
                  )}
                </span>
              )}
              <span>{new Date(s.capturedAt).toLocaleString()}</span>
              {s.qualityScoreAtCapture && (
                <span>Quality: {(parseFloat(s.qualityScoreAtCapture) * 100).toFixed(0)}%</span>
              )}
              <span>Rank #{s.contributionRank}</span>
            </div>

            {s.usedInOtherBlocksCount !== undefined ? (
              <p className="text-xs text-slate-400 mt-1">
                Used in {s.usedInOtherBlocksCount} other block
                {s.usedInOtherBlocksCount !== 1 ? 's' : ''}
              </p>
            ) : (
              s.sourceEntryIdHash && (
                <button
                  type="button"
                  onClick={() => expandReverseLineage(s.sourceEntryIdHash)}
                  className="text-xs text-indigo-500 hover:underline mt-1 block"
                >
                  Show usage in other blocks
                </button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
