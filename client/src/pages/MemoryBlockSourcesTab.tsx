import { useEffect, useState } from 'react';
import api from '../lib/api';

interface SourceEntry {
  id: string;
  content: string;
  isDeleted: boolean;
}

interface SourceRun {
  id: string;
  label: string;
  isDeleted: boolean;
}

interface SourceItem {
  rowId: string;
  sourceType: string;
  contributionRank: number;
  capturedAt: string;
  qualityScoreAtCapture: number | null;
  sourceEntry: SourceEntry | null;
  sourceEntryIdHash: string;
  contentHash: string;
  sourceRun: SourceRun | null;
  sourceRunLabelAtCapture: string | null;
  usedInOtherBlocksCount?: number;
}

interface MemoryBlockSourcesPayload {
  blockId: string;
  // Null when the block has no version rows (legacy blocks predating version
  // tracking). The empty-sources branch below renders before these fields are
  // read, so consumers never observe null here in practice.
  blockVersionId: string | null;
  versionNumber: number | null;
  capturedAt: string | null;
  sources: SourceItem[];
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

  const runLabel = (s: SourceItem): string | null =>
    s.sourceRun?.label ?? s.sourceRunLabelAtCapture;

  const runHref = (s: SourceItem): string | null =>
    s.sourceRun && !s.sourceRun.isDeleted ? `/admin/runs/${s.sourceRun.id}` : null;

  return (
    <div>
      {payload.versionNumber !== null && (
        <p className="text-xs text-slate-400 mb-3">
          Version {payload.versionNumber} · {payload.sources.length} source
          {payload.sources.length !== 1 ? 's' : ''}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {payload.sources.map((s) => {
          const deleted = s.sourceEntry?.isDeleted ?? s.sourceEntry === null;
          const content = s.sourceEntry?.content ?? null;
          const label = runLabel(s);
          const href = runHref(s);

          return (
            <div
              key={s.rowId}
              className={`border rounded p-3 ${deleted ? 'opacity-50' : 'border-slate-200'}`}
            >
              {content !== null && content !== '' ? (
                <p className={`text-sm text-slate-700 mb-1 ${deleted ? 'line-through' : ''}`}>
                  {content}
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic mb-1">(source removed)</p>
              )}

              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                {label && (
                  <span>
                    {href ? (
                      <a href={href} className="text-indigo-600 hover:underline">
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                  </span>
                )}
                <span>{new Date(s.capturedAt).toLocaleString()}</span>
                {s.qualityScoreAtCapture !== null && (
                  <span>Quality: {(s.qualityScoreAtCapture * 100).toFixed(0)}%</span>
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
          );
        })}
      </div>
    </div>
  );
}
