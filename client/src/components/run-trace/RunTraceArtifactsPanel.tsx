// client/src/components/run-trace/RunTraceArtifactsPanel.tsx
// Lists artifacts for a run with Preview / Download / Copy link affordances.
// Spec §4.5.1, §4.5.2, §4.5.3.

import { useEffect, useState } from 'react';
import { listArtifacts, issueSignedUrl } from '../../lib/api/runArtifacts';
import type { RunArtifact } from '../../lib/api/runArtifacts';

// ── Pill class ───────────────────────────────────────────────────────────────

const KIND_PILL_BASE =
  'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium';

function artifactKindPillClass(kind: RunArtifact['artifactKind']): string {
  switch (kind) {
    case 'report':
      return `${KIND_PILL_BASE} bg-indigo-50 text-indigo-700`;
    case 'transcript':
      return `${KIND_PILL_BASE} bg-slate-100 text-slate-600`;
    case 'media':
      return `${KIND_PILL_BASE} bg-violet-50 text-violet-700`;
    case 'attachment':
      return `${KIND_PILL_BASE} bg-amber-50 text-amber-700`;
    case 'log':
      return `${KIND_PILL_BASE} bg-slate-50 text-slate-400`;
  }
}

// ── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  label,
  onClick,
  loading,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="text-[12px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
    >
      {loading ? '...' : label}
    </button>
  );
}

// ── Single artifact row ──────────────────────────────────────────────────────

function ArtifactRow({ artifact }: { artifact: RunArtifact }) {
  const [actionLoading, setActionLoading] = useState<
    'preview' | 'download' | 'copy' | null
  >(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const isPdf = artifact.mimeType === 'application/pdf';

  async function handlePreview() {
    setRowError(null);
    setActionLoading('preview');
    // Open a blank window synchronously within the user gesture trust window;
    // popup blockers reject window.open() called after an async suspension.
    const win = window.open('', '_blank');
    try {
      const { url } = await issueSignedUrl(artifact.id, 'pdf_embed');
      if (win) {
        win.location.href = url;
      } else {
        setRowError('Popup blocked. Allow popups for this site to preview files.');
      }
    } catch {
      win?.close();
      setRowError('Could not open preview. Please try again.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDownload() {
    setRowError(null);
    setActionLoading('download');
    // Open synchronously before await — same popup-blocker reason as handlePreview.
    const win = window.open('', '_blank');
    try {
      const { url } = await issueSignedUrl(artifact.id, 'run_trace_panel');
      if (win) {
        win.location.href = url;
      } else {
        setRowError('Popup blocked. Allow popups for this site to download files.');
      }
    } catch {
      win?.close();
      setRowError('Could not start download. Please try again.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCopyLink() {
    setRowError(null);
    setActionLoading('copy');
    try {
      const { url } = await issueSignedUrl(artifact.id, 'copy_link');
      if (!navigator.clipboard) {
        setRowError('Clipboard not available in this context. Copy the link manually.');
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {
      setRowError('Could not copy link. Please try again.');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Kind pill */}
        <span className={artifactKindPillClass(artifact.artifactKind)}>
          {artifact.artifactKind}
        </span>

        {/* Display name */}
        <span className="flex-1 text-[13px] font-medium text-slate-800 truncate min-w-0">
          {artifact.displayName}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isPdf && (
            <ActionButton
              label="Preview"
              onClick={handlePreview}
              loading={actionLoading === 'preview'}
            />
          )}
          <ActionButton
            label="Download"
            onClick={handleDownload}
            loading={actionLoading === 'download'}
          />
          <ActionButton
            label="Copy link"
            onClick={handleCopyLink}
            loading={actionLoading === 'copy'}
          />
        </div>
      </div>

      {/* Inline error — shown per row, does not affect other rows */}
      {rowError !== null && (
        <div className="px-4 pb-3 text-[12px] text-red-600">
          {rowError}
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export interface RunTraceArtifactsPanelProps {
  runId: string;
}

export function RunTraceArtifactsPanel({ runId }: RunTraceArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<RunArtifact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listArtifacts(runId)
      .then((result) => {
        if (!cancelled) setArtifacts(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : 'Failed to load artifacts';
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 animate-[fadeIn_0.2s_ease-out_both]">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-12 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]"
          />
        ))}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-[13px]">
        {error}
      </div>
    );
  }

  if (artifacts === null || artifacts.length === 0) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-slate-500 text-[13px]">
        No artifacts for this run.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 animate-[fadeIn_0.2s_ease-out_both]">
      <div className="text-[12px] text-slate-400 font-medium uppercase tracking-wider mb-1">
        Artifacts ({artifacts.length})
      </div>
      {artifacts.map((artifact) => (
        <ArtifactRow key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}
