import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { InFlightEntry } from '../../../../shared/types/systemPnl';

// ---------------------------------------------------------------------------
// Live-mode payload drawer for the In-Flight tab (deferred-items brief §7).
//
// Opens when the admin clicks a live row. Fetches the in-memory payload
// snapshot from GET /api/admin/llm-pnl/in-flight/:runtimeKey/payload.
//
// Deliberately kept as a sibling of `PnlCallDetailDrawer` rather than
// folded into it — the live entry and the landed CallDetail have
// non-overlapping shapes, so a single component trying to render both
// ends up with every field wrapped in a null guard. Separate drawers
// keep each render tight.
// ---------------------------------------------------------------------------

interface PayloadSnapshotResponse {
  runtimeKey:  string;
  payload:     {
    messages:           unknown;
    system?:            unknown;
    tools?:             unknown;
    maxTokens?:         number;
    temperature?:       number;
    capturedAt:         string;
    truncated:          boolean;
    originalSizeBytes:  number | null;
  };
  generatedAt: string;
}

interface Props {
  entry:   InFlightEntry | null;
  onClose: () => void;
}

export default function PnlInFlightPayloadDrawer({ entry, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<PayloadSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) {
      setSnapshot(null);
      setError(null);
      return;
    }
    // Guard against stale responses: if the admin clicks row A then row B
    // quickly, A's slower response must not overwrite B's drawer. An
    // AbortController signals cancellation to axios on cleanup; the
    // `currentRuntimeKey` closure check is a belt-and-suspenders guard
    // in case the abort races the response.
    const controller = new AbortController();
    const currentRuntimeKey = entry.runtimeKey;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    api.get(`/api/admin/llm-pnl/in-flight/${encodeURIComponent(entry.runtimeKey)}/payload`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (controller.signal.aborted) return;
        const data = r.data as PayloadSnapshotResponse;
        // Confirm the response still belongs to the row the drawer is showing.
        if (data.runtimeKey !== currentRuntimeKey) return;
        setSnapshot(data);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        // 410 Gone = the call completed or was evicted between click and fetch.
        const maybeErr = e as { response?: { status?: number; data?: { message?: string } }; message?: string };
        if (maybeErr.response?.status === 410) {
          setError('This call has already completed — the payload snapshot is no longer available. Use the [ledger] link in "Recently landed" instead.');
        } else {
          setError(maybeErr.response?.data?.message ?? maybeErr.message ?? 'Failed to load payload');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [entry]);

  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end" aria-modal="true" role="dialog">
      <div className="fixed inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg h-full shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Live call payload</h2>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5 break-all">{entry.runtimeKey}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 text-sm"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="px-5 py-4 text-xs space-y-4">
          <section>
            <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Call</h3>
            <div className="grid grid-cols-2 gap-y-1">
              <div className="text-slate-500">Provider / model</div>
              <div className="font-mono text-slate-700">{entry.label}</div>
              <div className="text-slate-500">Feature</div>
              <div>{entry.featureTag}</div>
              <div className="text-slate-500">Source type</div>
              <div>{entry.sourceType}</div>
              <div className="text-slate-500">Attempt</div>
              <div>
                #{entry.attempt}
                {entry.attemptSequence !== entry.attempt && (
                  <span className="ml-1 text-slate-400">(seq #{entry.attemptSequence})</span>
                )}
              </div>
              <div className="text-slate-500">Started</div>
              <div className="font-mono">{new Date(entry.startedAt).toLocaleTimeString()}</div>
            </div>
          </section>

          {loading && <div className="text-sm text-slate-500">Loading payload…</div>}
          {error && <div className="text-sm text-rose-600">{error}</div>}

          {snapshot && (
            <>
              {snapshot.payload.truncated && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                  Payload too large to snapshot — body was dropped at the store layer.
                  {snapshot.payload.originalSizeBytes !== null && (
                    <>
                      {' '}Original size:{' '}
                      <strong>{formatBytes(snapshot.payload.originalSizeBytes)}</strong>
                      {' '}(cap 200 KB).
                    </>
                  )}
                  {' '}Use the ledger detail once the call lands.
                </div>
              )}
              {snapshot.payload.system !== undefined && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">System prompt</h3>
                  <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
                    {stringify(snapshot.payload.system)}
                  </pre>
                </section>
              )}
              {snapshot.payload.tools !== undefined && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Tools</h3>
                  <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
                    {stringify(snapshot.payload.tools)}
                  </pre>
                </section>
              )}
              {snapshot.payload.messages !== null && snapshot.payload.messages !== undefined && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Messages</h3>
                  <pre className="bg-slate-50 border border-slate-200 rounded p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
                    {stringify(snapshot.payload.messages)}
                  </pre>
                </section>
              )}
              <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-100">
                Captured {new Date(snapshot.payload.capturedAt).toLocaleTimeString()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
