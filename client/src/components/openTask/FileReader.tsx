/**
 * FileReader — document reader pane with toolbar and optional diff view.
 *
 * Toolbar: Download button, Open-in-new-window, Version dropdown, Diff toggle.
 * Reader: monospace pre tag for V1. When diff is on and currentVersion > 1,
 * fetches and renders DiffRenderer.
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { useState, useEffect } from 'react';
import type { TabFile } from './filesTabPure.js';
import DiffRenderer, { type Hunk } from './DiffRenderer.js';

// ─── Diff fetch ───────────────────────────────────────────────────────────────

interface DiffPayload {
  hunks: Hunk[];
  mode: 'line' | 'row' | 'unsupported';
}

async function fetchDiff(
  taskId: string,
  fileId: string,
  fromVersion: number,
  toVersion: number,
): Promise<DiffPayload> {
  const url = `/api/tasks/${taskId}/files/${fileId}/diff?fromVersion=${fromVersion}&toVersion=${toVersion}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<DiffPayload>;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FileReaderProps {
  taskId: string;
  file: TabFile;
  /** Inline text content for the current version. Null if not loaded yet. */
  content: string | null;
  /** Called when a revert operation completes (trigger parent refetch). */
  onReverted?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FileReader({ taskId, file, content, onReverted }: FileReaderProps) {
  const [diffOn, setDiffOn] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(file.currentVersion);
  const [diffData, setDiffData] = useState<DiffPayload | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const currentVersion = file.currentVersion;

  // Reset state when the file changes.
  useEffect(() => {
    setDiffOn(false);
    setSelectedVersion(currentVersion);
    setDiffData(null);
    setDiffError(null);
  }, [file.id, currentVersion]);

  // Fetch diff when the toggle is on and versions are known.
  useEffect(() => {
    if (!diffOn || currentVersion <= 1) {
      setDiffData(null);
      return;
    }

    const fromVersion = selectedVersion - 1;
    const toVersion = selectedVersion;

    setDiffLoading(true);
    setDiffError(null);

    fetchDiff(taskId, file.id, fromVersion, toVersion)
      .then((payload) => {
        setDiffData(payload);
        setDiffLoading(false);
      })
      .catch((err: unknown) => {
        setDiffError(err instanceof Error ? err.message : 'Failed to load diff');
        setDiffLoading(false);
      });
  }, [diffOn, taskId, file.id, selectedVersion, currentVersion]);

  const canDiff = currentVersion > 1;

  const handleRevertDone = () => {
    setDiffOn(false);
    setDiffData(null);
    onReverted?.();
  };

  // Build version options for the dropdown.
  const versionOptions = Array.from(
    { length: currentVersion },
    (_, i) => i + 1,
  ).reverse();

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Document toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 flex-wrap">
        {/* File name */}
        <span className="text-[12px] font-medium text-slate-200 truncate min-w-0 flex-1" title={file.name}>
          {file.name}
        </span>

        {/* Version selector */}
        <select
          value={selectedVersion}
          onChange={(e) => {
            setSelectedVersion(Number(e.target.value));
            setDiffData(null);
          }}
          className="text-[11px] bg-slate-800 text-slate-300 border border-slate-700 rounded px-1.5 py-0.5 focus:outline-none"
          aria-label="Version"
        >
          {versionOptions.map((v) => (
            <option key={v} value={v}>
              v{v}{v === currentVersion ? ' (latest)' : ''}
            </option>
          ))}
        </select>

        {/* Diff toggle */}
        {canDiff && (
          <button
            type="button"
            onClick={() => setDiffOn((prev) => !prev)}
            className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
              diffOn
                ? 'bg-indigo-700 border-indigo-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            Diff
          </button>
        )}

        {/* Download */}
        <a
          href={`/api/tasks/${taskId}/files/${file.id}/download`}
          download={file.name}
          className="text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          title="Download"
        >
          Download
        </a>

        {/* Open in new window */}
        <a
          href={`/api/tasks/${taskId}/files/${file.id}/download`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          title="Open in new window"
        >
          Open
        </a>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto min-h-0">
        {diffOn && canDiff ? (
          <div>
            {diffLoading && (
              <p className="px-3 py-4 text-[12px] text-slate-500 italic">Loading diff...</p>
            )}
            {diffError && (
              <p className="px-3 py-4 text-[12px] text-red-400">Diff error: {diffError}</p>
            )}
            {!diffLoading && !diffError && diffData && (
              <DiffRenderer
                taskId={taskId}
                fileId={file.id}
                fromVersion={selectedVersion - 1}
                hunks={diffData.hunks}
                mode={diffData.mode}
                onReverted={handleRevertDone}
              />
            )}
          </div>
        ) : (
          <div>
            {content === null ? (
              <p className="px-3 py-4 text-[12px] text-slate-500 italic">Loading...</p>
            ) : (
              <pre className="px-3 py-3 text-[12px] text-slate-200 font-mono whitespace-pre-wrap break-words">
                {content}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
