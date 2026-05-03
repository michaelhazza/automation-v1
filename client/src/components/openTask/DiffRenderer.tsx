/**
 * DiffRenderer — inline diff renderer with per-hunk revert.
 *
 * Renders deletion lines with a strikethrough/red background and
 * addition lines with a green background. Shows a Revert button per hunk.
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { useState } from 'react';

// ─── Hunk shape (must match server fileDiffServicePure.ts) ───────────────────

export interface Hunk {
  index: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  type: 'add' | 'del' | 'change';
  oldContent: string[];
  newContent: string[];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiffRendererProps {
  taskId: string;
  fileId: string;
  /** The version being shown (the "to" version in the diff). */
  fromVersion: number;
  hunks: Hunk[];
  mode: 'line' | 'row' | 'unsupported';
  /** Called after a successful hunk revert so the parent can refetch. */
  onReverted: () => void;
}

// ─── Per-hunk revert ─────────────────────────────────────────────────────────

interface RevertState {
  hunkIndex: number;
  status: 'loading' | 'error';
  message?: string;
}

async function revertHunkRequest(
  taskId: string,
  fileId: string,
  fromVersion: number,
  hunkIndex: number,
): Promise<
  | { ok: true; newVersion: number }
  | { ok: false; reason: string; currentVersion?: number }
> {
  const resp = await fetch(`/api/tasks/${taskId}/files/${fileId}/revert-hunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_version: fromVersion, hunk_index: hunkIndex }),
  });

  if (resp.status === 409) {
    const body = await resp.json() as { error: string; current_version?: number };
    return { ok: false, reason: body.error, currentVersion: body.current_version };
  }

  if (!resp.ok) {
    return { ok: false, reason: `HTTP ${resp.status}` };
  }

  const body = await resp.json() as { reverted: boolean; new_version?: number; reason?: string };
  if (body.reverted) {
    return { ok: true, newVersion: body.new_version! };
  }
  return { ok: false, reason: body.reason ?? 'unknown' };
}

// ─── HunkBlock ────────────────────────────────────────────────────────────────

function HunkBlock({
  hunk,
  taskId,
  fileId,
  fromVersion,
  onReverted,
}: {
  hunk: Hunk;
  taskId: string;
  fileId: string;
  fromVersion: number;
  onReverted: () => void;
}) {
  const [revertState, setRevertState] = useState<RevertState | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const handleRevert = async () => {
    setRevertState({ hunkIndex: hunk.index, status: 'loading' });
    const result = await revertHunkRequest(taskId, fileId, fromVersion, hunk.index);
    setRevertState(null);

    if (result.ok) {
      onReverted();
      return;
    }

    if (result.reason === 'already_absent') {
      showToast('This change is already absent in the current version.');
      onReverted(); // refetch to show updated state
    } else if (result.reason === 'base_version_changed') {
      showToast('This draft has been edited again. Refreshing.');
      onReverted();
    } else {
      setRevertState({ hunkIndex: hunk.index, status: 'error', message: result.reason });
    }
  };

  const isLoading = revertState?.hunkIndex === hunk.index && revertState.status === 'loading';
  const hasError = revertState?.hunkIndex === hunk.index && revertState.status === 'error';

  return (
    <div className="my-2 rounded border border-slate-700/50 overflow-hidden text-[12px] font-mono">
      {/* Hunk header */}
      <div className="flex items-center justify-between px-3 py-1 bg-slate-800/60 border-b border-slate-700/50">
        <span className="text-slate-500 text-[11px]">
          @@ -{hunk.oldStart},{hunk.oldEnd - hunk.oldStart} +{hunk.newStart},{hunk.newEnd - hunk.newStart} @@
        </span>
        <button
          type="button"
          onClick={handleRevert}
          disabled={isLoading}
          className="text-[11px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Reverting...' : 'Revert'}
        </button>
      </div>

      {/* Error inline */}
      {hasError && (
        <div className="px-3 py-1 bg-red-950/30 text-red-400 text-[11px]">
          Revert failed: {revertState!.message}
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="px-3 py-1 bg-amber-950/30 text-amber-300 text-[11px]">
          {toastMsg}
        </div>
      )}

      {/* Deletion lines */}
      {hunk.oldContent.map((line, i) => (
        <div key={`del-${i}`} className="px-3 py-px bg-red-950/30 text-red-300 line-through whitespace-pre-wrap break-all">
          - {line}
        </div>
      ))}

      {/* Addition lines */}
      {hunk.newContent.map((line, i) => (
        <div key={`add-${i}`} className="px-3 py-px bg-emerald-950/30 text-emerald-300 whitespace-pre-wrap break-all">
          + {line}
        </div>
      ))}
    </div>
  );
}

// ─── DiffRenderer ─────────────────────────────────────────────────────────────

export default function DiffRenderer({
  taskId,
  fileId,
  fromVersion,
  hunks,
  mode,
  onReverted,
}: DiffRendererProps) {
  if (mode === 'unsupported') {
    return (
      <div className="py-4 px-3 text-[12px] text-slate-500 italic">
        Diff not available for this file type.
      </div>
    );
  }

  if (hunks.length === 0) {
    return (
      <div className="py-4 px-3 text-[12px] text-slate-500 italic">
        No changes between these versions.
      </div>
    );
  }

  return (
    <div className="space-y-1 py-2 px-3">
      {hunks.map((hunk) => (
        <HunkBlock
          key={hunk.index}
          hunk={hunk}
          taskId={taskId}
          fileId={fileId}
          fromVersion={fromVersion}
          onReverted={onReverted}
        />
      ))}
    </div>
  );
}
