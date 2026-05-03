/**
 * FilesTab — Files tab for the open task view.
 *
 * Layout: strip (left, file list) + reader (right, file content).
 * Group switcher above strip: Outputs | References | Versions (default: Outputs).
 * Latest-only toggle, search input, sort dropdown above strip.
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { useState, useEffect } from 'react';
import {
  classifyFileGroup,
  filterLatestOnly,
  sortFiles,
  searchFiles,
  type TabFile,
  type FileGroup,
  type FileSortKey,
} from './filesTabPure.js';
import FileReader from './FileReader.js';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FilesTabProps {
  taskId: string;
}

// ─── Group tab types ──────────────────────────────────────────────────────────

type GroupTab = 'output' | 'reference' | 'version';

const GROUP_TABS: Array<{ id: GroupTab; label: string }> = [
  { id: 'output', label: 'Outputs' },
  { id: 'reference', label: 'References' },
  { id: 'version', label: 'Versions' },
];

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchFiles(taskId: string): Promise<TabFile[]> {
  const resp = await fetch(`/api/tasks/${taskId}/deliverables`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const rows = await resp.json() as Array<{
    id: string;
    title: string;
    deliverableType: string;
    bodyText?: string | null;
    createdAt: string;
    updatedAt?: string | null;
  }>;
  // Map deliverables to TabFile shape.
  return rows.map((row): TabFile => ({
    id: row.id,
    name: row.title,
    mimeType: row.deliverableType === 'file' ? 'text/plain' : null,
    fileSizeBytes: row.bodyText ? new Blob([row.bodyText]).size : null,
    updatedAt: row.updatedAt ?? row.createdAt,
    producerKind: 'agent',
    currentVersion: 1, // V1: single version until version history endpoint lands
    agentName: undefined,
    tags: [],
  }));
}

async function fetchFileContent(taskId: string, fileId: string): Promise<string | null> {
  const resp = await fetch(`/api/tasks/${taskId}/deliverables/${fileId}`);
  if (!resp.ok) return null;
  const row = await resp.json() as { bodyText?: string | null };
  return row.bodyText ?? '';
}

// ─── FilesTab ────────────────────────────────────────────────────────────────

export default function FilesTab({ taskId }: FilesTabProps) {
  const [allFiles, setAllFiles] = useState<TabFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [activeGroup, setActiveGroup] = useState<GroupTab>('output');
  const [latestOnly, setLatestOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<FileSortKey>('updated');

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  // Fetch file list on mount or when taskId changes.
  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    fetchFiles(taskId)
      .then((files) => {
        setAllFiles(files);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setFetchError(err instanceof Error ? err.message : 'Failed to load files');
        setLoading(false);
      });
  }, [taskId]);

  // Fetch content when a file is selected.
  useEffect(() => {
    if (!selectedFileId) {
      setFileContent(null);
      return;
    }
    setFileContent(null);
    fetchFileContent(taskId, selectedFileId).then((c) => setFileContent(c));
  }, [taskId, selectedFileId]);

  // Refetch after a revert (so the content and version dropdown update).
  const handleReverted = () => {
    fetchFiles(taskId).then(setAllFiles);
    if (selectedFileId) {
      fetchFileContent(taskId, selectedFileId).then((c) => setFileContent(c));
    }
  };

  // Compute the visible file list.
  const grouped = allFiles.filter((f) => {
    const group: FileGroup = classifyFileGroup(f);
    // 'version' tab shows older versions; for now all files are current
    if (activeGroup === 'version') return f.currentVersion > 1;
    return group === activeGroup;
  });

  const afterLatest = latestOnly ? filterLatestOnly(grouped) : grouped;
  const afterSearch = searchFiles(afterLatest, search);
  const visible = sortFiles(afterSearch, sortBy);

  const selectedFile = visible.find((f) => f.id === selectedFileId) ?? null;

  return (
    <div className="flex h-full min-w-0">
      {/* ── Strip (left) ─────────────────────────────────────────────────── */}
      <div className="w-56 shrink-0 flex flex-col border-r border-slate-700/50 min-w-0">
        {/* Group switcher */}
        <div className="flex border-b border-slate-700/50">
          {GROUP_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveGroup(tab.id)}
              className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                activeGroup === tab.id
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + controls */}
        <div className="flex flex-col gap-1.5 px-2 py-2 border-b border-slate-700/50">
          <input
            type="text"
            placeholder="Search files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-[11px] bg-slate-800 text-slate-300 border border-slate-700 rounded px-2 py-1 focus:outline-none focus:border-slate-500 placeholder:text-slate-600"
          />
          <div className="flex items-center justify-between gap-1.5">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as FileSortKey)}
              className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 rounded px-1 py-0.5 focus:outline-none"
              aria-label="Sort by"
            >
              <option value="updated">Newest</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={latestOnly}
                onChange={(e) => setLatestOnly(e.target.checked)}
                className="w-3 h-3 rounded accent-indigo-500"
              />
              <span className="text-[10px] text-slate-500">Latest</span>
            </label>
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <p className="px-3 py-4 text-[12px] text-slate-500 italic">Loading...</p>
          )}
          {fetchError && (
            <p className="px-3 py-4 text-[12px] text-red-400">{fetchError}</p>
          )}
          {!loading && !fetchError && visible.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-slate-500 italic">No files yet.</p>
          )}
          {!loading && visible.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => setSelectedFileId(file.id)}
              className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 border-b border-slate-700/30 transition-colors ${
                selectedFileId === file.id
                  ? 'bg-slate-700/60 text-slate-100'
                  : 'hover:bg-slate-800/40 text-slate-300'
              }`}
            >
              <span className="text-[12px] font-medium truncate" title={file.name}>
                {file.name}
              </span>
              <span className="text-[10px] text-slate-500">
                {file.currentVersion > 1 ? `v${file.currentVersion}` : ''}
                {file.fileSizeBytes ? ` ${formatBytes(file.fileSizeBytes)}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Reader (right) ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedFile ? (
          <FileReader
            taskId={taskId}
            file={selectedFile}
            content={fileContent}
            onReverted={handleReverted}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[13px] text-slate-500 italic">Select a file to view.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
